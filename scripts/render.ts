/**
 * Headless brand animation renderer with multi-format output.
 *
 * Renders via Motion Canvas (ProRes 4444 intermediate), then converts
 * to the requested format with ffmpeg.
 *
 * Usage:
 *   npx tsx scripts/render.ts [options]
 *
 * Options:
 *   --format mp4|webm|gif|mov   Output format (default: mp4, or inferred from --output extension)
 *   --transparent                Render with transparent background (for webm/gif/mov)
 *   --output <path>              Output file path (default: output/project.<format>)
 *   --port <N>                   Dev server port (default: 9001)
 *   --no-server                  Don't auto-start the dev server
 *   --preflight                  Run environment checks only, don't render
 */

import {chromium} from 'playwright';
import {spawn, execSync, execFileSync, ChildProcess} from 'child_process';
import {existsSync, statSync, copyFileSync, unlinkSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync} from 'fs';
import {dirname, resolve, extname} from 'path';
import {createConnection} from 'net';
import {createRequire} from 'module';

const PROJECT_DIR = resolve(import.meta.dirname, '..');
const INTERMEDIATE_FILE = resolve(PROJECT_DIR, 'output/project.mov');
const LOCKFILE = resolve(PROJECT_DIR, 'output/.render.lock');
const DEFAULT_PORT = 9001;

// ─── Process-level state ─────────────────────────────────────

let serverProcess: ChildProcess | null = null;
let serverCrashed = false;
let browserInstance: Awaited<ReturnType<typeof chromium.launch>> | null = null;

function setupSignalHandlers() {
  const cleanup = () => {
    restoreFromTransparent();
    releaseLock();
    if (browserInstance) {
      try { browserInstance.close(); } catch {}
      browserInstance = null;
    }
    if (serverProcess) {
      try { process.kill(-serverProcess.pid!, 'SIGTERM'); } catch { serverProcess.kill('SIGTERM'); }
    }
    process.exit(1);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

type Format = 'mp4' | 'webm' | 'gif' | 'mov';
const VALID_FORMATS = new Set<Format>(['mp4', 'webm', 'gif', 'mov']);

// ─── ffmpeg path ─────────────────────────────────────────────

function findFfmpeg(): string {
  try {
    const req = createRequire(resolve(PROJECT_DIR, 'package.json'));
    const {path: bundled} = req('@ffmpeg-installer/ffmpeg');
    if (bundled && existsSync(bundled)) return bundled;
  } catch {}
  try {
    const sys = execSync('which ffmpeg', {encoding: 'utf8'}).trim();
    if (sys) return sys;
  } catch {}
  throw new Error('ffmpeg not found. Run: npm run setup');
}

function findFfprobe(): string | null {
  try {
    const req = createRequire(resolve(PROJECT_DIR, 'package.json'));
    const {path: bundled} = req('@ffprobe-installer/ffprobe');
    if (bundled && existsSync(bundled)) return bundled;
  } catch {}
  try {
    const sys = execSync('which ffprobe', {encoding: 'utf8'}).trim();
    if (sys) return sys;
  } catch {}
  return null;
}

// ─── CLI args ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let output: string | null = null;
  let format: Format | null = null;
  let port = DEFAULT_PORT;
  let noServer = false;
  let transparent = false;
  let preflightOnly = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--output requires a path');
        output = resolve(args[++i]);
        break;
      case '--format':
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--format requires a value');
        format = args[++i] as Format;
        if (!VALID_FORMATS.has(format)) {
          throw new Error(`Invalid format "${format}". Use: ${[...VALID_FORMATS].join(', ')}`);
        }
        break;
      case '--port':
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--port requires a number');
        port = parseInt(args[++i], 10);
        if (isNaN(port)) throw new Error(`Invalid port: ${args[i]}`);
        break;
      case '--no-server':
        noServer = true;
        break;
      case '--transparent':
        transparent = true;
        break;
      case '--preflight':
        preflightOnly = true;
        break;
    }
  }

  if (!format && output) {
    const ext = extname(output).slice(1).toLowerCase() as Format;
    if (VALID_FORMATS.has(ext)) format = ext;
  }
  if (!format) format = 'mp4';

  if (!output) {
    output = resolve(PROJECT_DIR, `output/project.${format}`);
  }

  if (transparent && format === 'mp4') {
    console.log('  Warning: --transparent has no effect with MP4 (no alpha channel). Use --format webm or gif for transparency.');
  }

  return {output, format, port, noServer, transparent, preflightOnly};
}

// ─── Preflight checks ───────────────────────────────────────

function preflight(): {ok: boolean; errors: string[]} {
  const errors: string[] = [];

  // node_modules
  if (!existsSync(resolve(PROJECT_DIR, 'node_modules'))) {
    errors.push('node_modules missing. Run: npm install');
  }

  // Vite binary
  if (!existsSync(resolve(PROJECT_DIR, 'node_modules/.bin/vite'))) {
    errors.push('Vite not installed. Run: npm install');
  }

  // Playwright Chromium — check if the binary exists
  try {
    const chromiumPath = execSync(
      'node -e "const {chromium}=require(\'playwright\');console.log(chromium.executablePath())"',
      {cwd: PROJECT_DIR, encoding: 'utf8', timeout: 10_000},
    ).trim();
    if (!existsSync(chromiumPath)) {
      errors.push('Chromium browser not installed. Run: npx playwright install chromium');
    }
  } catch {
    errors.push('Cannot locate Playwright Chromium. Run: npx playwright install chromium');
  }

  // ffmpeg (for format conversion)
  try { findFfmpeg(); } catch {
    errors.push('ffmpeg not found. Run: npm run setup');
  }

  // Patch applied
  const ffmpegServer = resolve(PROJECT_DIR, 'node_modules/@motion-canvas/ffmpeg/lib/server/FFmpegExporterServer.js');
  if (existsSync(ffmpegServer)) {
    const content = readFileSync(ffmpegServer, 'utf8');
    if (!content.includes('prores_ks')) {
      errors.push('ffmpeg exporter patch not applied. Run: npx patch-package');
    }
  }

  // animations/ directory exists
  const animDir = resolve(PROJECT_DIR, 'animations');
  if (!existsSync(animDir)) {
    mkdirSync(animDir, {recursive: true});
    console.log('  Created animations/ directory');
  }

  // project.ts has a scene import and the scene file exists
  const projectTs = resolve(PROJECT_DIR, 'src/project.ts');
  if (existsSync(projectTs)) {
    const content = readFileSync(projectTs, 'utf8');
    if (!content.includes('?scene')) {
      errors.push('src/project.ts does not import any scene (missing ?scene import)');
    } else {
      const sceneMatch = content.match(/from\s+['"]\.\.\/animations\/([^?'"]+)\?scene['"]/);
      if (sceneMatch) {
        const scenePath = resolve(PROJECT_DIR, 'animations', `${sceneMatch[1]}.tsx`);
        if (!existsSync(scenePath)) {
          errors.push(`Scene file missing: animations/${sceneMatch[1]}.tsx — create it first or update the import in src/project.ts`);
        }
      }
    }
  } else {
    errors.push('src/project.ts is missing');
  }

  // Stale transparent patch check
  const brandEcho = resolve(PROJECT_DIR, 'src/presets/brand-echo.ts');
  if (existsSync(brandEcho)) {
    const content = readFileSync(brandEcho, 'utf8');
    if (content.includes("BACKGROUND = 'rgba(0,0,0,0)'")) {
      errors.push('brand-echo.ts has a stale transparent patch. Restoring...');
      const restored = content.replace(
        /export const BACKGROUND = 'rgba\(0,0,0,0\)';/,
        'export const BACKGROUND = RENDER_BG;',
      );
      writeFileSync(brandEcho, restored);
      // Remove this error since we fixed it
      errors.pop();
      console.log('  Auto-restored stale transparent patch in brand-echo.ts');
    }
  }

  return {ok: errors.length === 0, errors};
}

// ─── TypeScript validation ──────────────────────────────────

function validateScene(): boolean {
  const projectTs = resolve(PROJECT_DIR, 'src/project.ts');
  const content = readFileSync(projectTs, 'utf8');
  const match = content.match(/from\s+['"]\.\.\/animations\/([^?'"]+)\?scene['"]/);
  if (!match) {
    console.log('  Warning: could not find scene import in project.ts');
    return true;
  }

  const sceneName = match[1];
  const scenePath = resolve(PROJECT_DIR, 'animations', `${sceneName}.tsx`);
  if (!existsSync(scenePath)) {
    console.error(`  Scene file not found: animations/${sceneName}.tsx`);
    return false;
  }

  console.log(`Validating scene: animations/${sceneName}.tsx`);
  try {
    execSync(
      `npx tsc --noEmit --project tsconfig.json`,
      {cwd: PROJECT_DIR, encoding: 'utf8', stdio: 'pipe', timeout: 30_000},
    );
    console.log('  TypeScript validation passed.');
    return true;
  } catch (e: any) {
    const output = (e.stdout || '') + (e.stderr || '');
    // Only fail if the ACTIVE scene file has errors — ignore errors in other animation files
    const sceneFile = `animations/${sceneName}.tsx`;
    const sceneErrors = output.split('\n').filter((l: string) => l.includes(sceneFile) && l.includes('error TS'));
    if (sceneErrors.length > 0) {
      console.error(`  TypeScript errors in ${sceneFile}:`);
      for (const line of sceneErrors.slice(0, 15)) console.error(`    ${line}`);
      return false;
    }
    console.log('  Scene validation passed.');
    return true;
  }
}

// ─── Render lock ─────────────────────────────────────────────

function acquireLock(): boolean {
  mkdirSync(dirname(LOCKFILE), {recursive: true});

  // Check for existing lock
  if (existsSync(LOCKFILE)) {
    const lockContent = readFileSync(LOCKFILE, 'utf8').trim();
    const lockPid = parseInt(lockContent, 10);
    if (lockPid && isProcessRunning(lockPid)) {
      return false;
    }
    unlinkSync(LOCKFILE);
  }

  // Atomic create — wx flag fails if file already exists (avoids TOCTOU race)
  try {
    const fd = openSync(LOCKFILE, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCKFILE)) {
      const content = readFileSync(LOCKFILE, 'utf8').trim();
      if (content === String(process.pid)) {
        unlinkSync(LOCKFILE);
      }
    }
  } catch {}
}

function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ─── Transparent background ──────────────────────────────────

const BRAND_ECHO_PATH = resolve(PROJECT_DIR, 'src/presets/brand-echo.ts');
let brandEchoBackup: string | null = null;

function patchForTransparent() {
  brandEchoBackup = readFileSync(BRAND_ECHO_PATH, 'utf8');
  const patched = brandEchoBackup.replace(
    /export const BACKGROUND = RENDER_BG;/,
    "export const BACKGROUND = 'rgba(0,0,0,0)';",
  );
  if (patched === brandEchoBackup) {
    console.log('  Warning: could not patch BACKGROUND for transparent mode');
    brandEchoBackup = null;
    return;
  }
  writeFileSync(BRAND_ECHO_PATH, patched);
  console.log('  Patched brand-echo.ts for transparent background');
}

function restoreFromTransparent() {
  if (brandEchoBackup) {
    writeFileSync(BRAND_ECHO_PATH, brandEchoBackup);
    brandEchoBackup = null;
  }
}

// ─── Server lifecycle ────────────────────────────────────────

async function isPortOpen(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1']) {
    const open = await new Promise<boolean>((res) => {
      const conn = createConnection({port, host});
      conn.on('connect', () => { conn.end(); res(true); });
      conn.on('error', () => res(false));
      conn.setTimeout(1000, () => { conn.destroy(); res(false); });
    });
    if (open) return true;
  }
  return false;
}

async function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (serverCrashed) {
      throw new Error('Vite dev server failed to start. Check the [vite] output above.');
    }
    if (await isPortOpen(port)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Dev server not ready after ${timeoutMs / 1000}s on port ${port}`);
}

function startServer(port: number): ChildProcess {
  console.log(`Starting dev server on port ${port}...`);
  const child = spawn(
    process.execPath,
    [resolve(PROJECT_DIR, 'node_modules/.bin/vite'), '--port', String(port), '--strictPort'],
    {cwd: PROJECT_DIR, stdio: 'pipe', detached: true},
  );
  child.stdout?.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`  [vite] ${line}`);
  });
  child.stderr?.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`  [vite] ${line}`);
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      serverCrashed = true;
      console.error(`  Vite server exited with code ${code}`);
    }
  });
  return child;
}

// ─── Render completion detection ─────────────────────────────

async function waitForOutput(timeoutMs = 300_000): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  let stableAt = 0;
  let lastProgressLog = 0;
  while (Date.now() - start < timeoutMs) {
    if (serverCrashed) {
      throw new Error('Vite dev server crashed during render. Check the [vite] output above.');
    }
    if (existsSync(INTERMEDIATE_FILE)) {
      const size = statSync(INTERMEDIATE_FILE).size;
      if (size > 0 && size === lastSize) {
        if (!stableAt) stableAt = Date.now();
        if (Date.now() - stableAt > 15_000) return;
      } else {
        lastSize = size;
        stableAt = 0;
        const now = Date.now();
        if (now - lastProgressLog > 5_000) {
          const elapsed = ((now - start) / 1000).toFixed(0);
          console.log(`  Rendering... ${(size / 1024 / 1024).toFixed(1)} MB written (${elapsed}s)`);
          lastProgressLog = now;
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Render did not complete within ${timeoutMs / 1000}s`);
}

// ─── Output verification ────────────────────────────────────

function verifyOutput(path: string, format: Format): void {
  if (!existsSync(path)) {
    throw new Error(`Output file not created: ${path}`);
  }
  const size = statSync(path).size;
  if (size === 0) {
    throw new Error(`Output file is empty (0 bytes): ${path}`);
  }

  // Minimum viable sizes per format
  const minSizes: Record<Format, number> = {
    mp4: 1024,   // A valid MP4 with at least a few frames
    webm: 512,
    gif: 256,
    mov: 4096,
  };
  if (size < minSizes[format]) {
    throw new Error(`Output file suspiciously small (${size} bytes): ${path}. Likely corrupt.`);
  }

  // Probe with ffprobe for duration if available
  try {
    const probePath = findFfprobe();
    if (probePath) {
      const info = execFileSync(
        probePath,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
        {encoding: 'utf8'},
      ).trim();
      const duration = parseFloat(info);
      if (isNaN(duration) || duration < 0.1) {
        throw new Error(`Output file has invalid duration (${info}s): ${path}`);
      }
      console.log(`  Verified: ${(size / 1024).toFixed(0)} KB, ${duration.toFixed(1)}s`);
      return;
    }
  } catch (e: any) {
    if (e.message?.includes('invalid duration') || e.message?.includes('suspiciously small')) throw e;
  }

  console.log(`  Verified: ${(size / 1024).toFixed(0)} KB`);
}

// ─── Format conversion ──────────────────────────────────────

function convertToFormat(ffmpeg: string, intermediate: string, output: string, format: Format, transparent: boolean) {
  mkdirSync(dirname(output), {recursive: true});
  if (existsSync(output)) unlinkSync(output);

  const run = (args: string[]) => {
    console.log(`  $ ffmpeg ${args.join(' ')}`);
    execFileSync(ffmpeg, args, {stdio: 'inherit'});
  };

  switch (format) {
    case 'mov':
      copyFileSync(intermediate, output);
      break;

    case 'mp4':
      run([
        '-y', '-i', intermediate,
        '-c:v', 'libx264', '-crf', '32',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        output,
      ]);
      break;

    case 'webm':
      run([
        '-y', '-i', intermediate,
        '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
        '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p',
        ...(transparent ? ['-auto-alt-ref', '0'] : []),
        output,
      ]);
      break;

    case 'gif': {
      const palette = resolve(dirname(intermediate), 'palette.png');
      if (transparent) {
        run(['-y', '-i', intermediate, '-vf', 'palettegen=reserve_transparent=1:stats_mode=diff', palette]);
        run(['-y', '-i', intermediate, '-i', palette, '-lavfi', 'paletteuse=dither=sierra2_4a:alpha_threshold=128', output]);
      } else {
        run(['-y', '-i', intermediate, '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=sierra2_4a', output]);
      }
      if (existsSync(palette)) unlinkSync(palette);
      break;
    }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  setupSignalHandlers();
  const {output, format, port, noServer, transparent, preflightOnly} = parseArgs();

  // Always run preflight
  console.log('Running preflight checks...');
  const check = preflight();
  if (!check.ok) {
    for (const err of check.errors) console.error(`  FAIL: ${err}`);
    process.exit(1);
  }
  console.log('  All checks passed.');
  if (preflightOnly) return;

  // Acquire render lock
  if (!acquireLock()) {
    throw new Error('Another render is in progress (lockfile exists). Wait for it to finish or remove output/.render.lock');
  }

  console.log(`Format: ${format} | Transparent: ${transparent} | Output: ${output}`);

  try {
    // Validate scene TypeScript before spending time on render
    if (!validateScene()) {
      throw new Error('Scene has TypeScript errors. Fix them before rendering.');
    }

    // Clean previous intermediate
    if (existsSync(INTERMEDIATE_FILE)) unlinkSync(INTERMEDIATE_FILE);

    // Patch for transparent background if requested
    if (transparent) patchForTransparent();

    // Start server if needed
    const running = await isPortOpen(port);
    if (!running && !noServer) {
      serverProcess = startServer(port);
      await waitForServer(port);
      console.log('Dev server ready.');
    } else if (!running) {
      throw new Error(`No server on port ${port} and --no-server was set`);
    } else {
      console.log(`Dev server already running on port ${port}.`);
    }

    // Launch headless browser and trigger render
    console.log('Launching headless browser...');
    browserInstance = await chromium.launch({args: ['--use-gl=angle']});
    const page = await browserInstance.newPage();
    await page.setViewportSize({width: 1280, height: 960});

    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`  [browser:${type}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`  [browser:error] ${err.message}`);
    });

    const url = `http://localhost:${port}?render`;
    console.log(`Navigating to ${url}`);
    await page.goto(url, {waitUntil: 'load'});

    // Wait for render to start
    console.log('Waiting for render to start...');
    const startTime = Date.now();
    let renderStarted = false;
    while (Date.now() - startTime < 60_000) {
      if (serverCrashed) {
        throw new Error('Vite dev server crashed before render started. Check the [vite] output above.');
      }
      if (existsSync(INTERMEDIATE_FILE) && statSync(INTERMEDIATE_FILE).size > 100) {
        renderStarted = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!renderStarted) {
      const state = await page.evaluate(() => document.title);
      console.log(`  Page title: ${state}`);
      throw new Error('Render did not start producing frames within 60s. Check browser console errors above.');
    }

    console.log('Rendering... (waiting for output to stabilize)');
    await waitForOutput();

    const movSize = statSync(INTERMEDIATE_FILE).size;
    console.log(`Intermediate render complete: ${(movSize / 1024 / 1024).toFixed(1)} MB`);

    await browserInstance.close();
    browserInstance = null;

    // Restore brand-echo.ts before format conversion
    restoreFromTransparent();

    // Convert to target format
    if (format === 'mov' && output === INTERMEDIATE_FILE) {
      console.log('Output is already ProRes MOV.');
    } else if (format === 'mov') {
      copyFileSync(INTERMEDIATE_FILE, output);
    } else {
      const ffmpeg = findFfmpeg();
      console.log(`Converting to ${format}...`);
      convertToFormat(ffmpeg, INTERMEDIATE_FILE, output, format, transparent);
    }

    // Verify output
    verifyOutput(output, format);

  } finally {
    restoreFromTransparent();
    releaseLock();
    if (browserInstance) {
      try { await browserInstance.close(); } catch {}
      browserInstance = null;
    }
    if (serverProcess) {
      console.log('Stopping dev server...');
      try { process.kill(-serverProcess.pid!, 'SIGTERM'); } catch { serverProcess.kill('SIGTERM'); }
      serverProcess = null;
    }
  }
}

main().catch((e) => {
  restoreFromTransparent();
  releaseLock();
  console.error(e.message || e);
  process.exit(1);
});
