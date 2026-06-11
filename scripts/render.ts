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
 */

import {chromium} from 'playwright';
import {spawn, execSync, ChildProcess} from 'child_process';
import {existsSync, statSync, copyFileSync, unlinkSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, resolve, extname} from 'path';
import {createConnection} from 'net';
import {createRequire} from 'module';

const PROJECT_DIR = resolve(import.meta.dirname, '..');
const INTERMEDIATE_FILE = resolve(PROJECT_DIR, 'output/project.mov');
const DEFAULT_PORT = 9001;

type Format = 'mp4' | 'webm' | 'gif' | 'mov';
const VALID_FORMATS = new Set<Format>(['mp4', 'webm', 'gif', 'mov']);

// ─── ffmpeg path ─────────────────────────────────────────────

function findFfmpeg(): string {
  // Prefer the bundled ffmpeg from @ffmpeg-installer (guaranteed codecs)
  try {
    const req = createRequire(resolve(PROJECT_DIR, 'package.json'));
    const {path: bundled} = req('@ffmpeg-installer/ffmpeg');
    if (bundled && existsSync(bundled)) return bundled;
  } catch {}
  // Fall back to system ffmpeg
  try {
    const sys = execSync('which ffmpeg', {encoding: 'utf8'}).trim();
    if (sys) return sys;
  } catch {}
  throw new Error('ffmpeg not found. Run: npm run setup');
}

// ─── CLI args ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let output: string | null = null;
  let format: Format | null = null;
  let port = DEFAULT_PORT;
  let noServer = false;
  let transparent = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        output = resolve(args[++i]);
        break;
      case '--format':
        format = args[++i] as Format;
        if (!VALID_FORMATS.has(format)) {
          throw new Error(`Invalid format "${format}". Use: ${[...VALID_FORMATS].join(', ')}`);
        }
        break;
      case '--port':
        port = parseInt(args[++i], 10);
        break;
      case '--no-server':
        noServer = true;
        break;
      case '--transparent':
        transparent = true;
        break;
    }
  }

  // Infer format from output extension if not explicitly set
  if (!format && output) {
    const ext = extname(output).slice(1).toLowerCase() as Format;
    if (VALID_FORMATS.has(ext)) format = ext;
  }
  if (!format) format = 'mp4';

  // Default output path
  if (!output) {
    output = resolve(PROJECT_DIR, `output/project.${format}`);
  }

  return {output, format, port, noServer, transparent};
}

// ─── Transparent background ──────────────────────────────────

const BRAND_ECHO_PATH = resolve(PROJECT_DIR, 'src/presets/brand-echo.ts');
let brandEchoBackup: string | null = null;

function patchForTransparent() {
  brandEchoBackup = readFileSync(BRAND_ECHO_PATH, 'utf8');
  // Replace the static BACKGROUND export with transparent
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
    console.log('  Restored brand-echo.ts');
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
  return child;
}

// ─── Render completion detection ─────────────────────────────

async function waitForOutput(timeoutMs = 300_000): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  let stableAt = 0;
  while (Date.now() - start < timeoutMs) {
    if (existsSync(INTERMEDIATE_FILE)) {
      const size = statSync(INTERMEDIATE_FILE).size;
      if (size > 0 && size === lastSize) {
        if (!stableAt) stableAt = Date.now();
        if (Date.now() - stableAt > 15_000) return;
      } else {
        lastSize = size;
        stableAt = 0;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Render did not complete within ${timeoutMs / 1000}s`);
}

// ─── Format conversion ──────────────────────────────────────

function convertToFormat(ffmpeg: string, intermediate: string, output: string, format: Format, transparent: boolean) {
  mkdirSync(dirname(output), {recursive: true});

  // If the output file already exists, remove it (ffmpeg -y also handles this, but be safe)
  if (existsSync(output)) unlinkSync(output);

  const run = (args: string[]) => {
    const cmd = `"${ffmpeg}" ${args.join(' ')}`;
    console.log(`  $ ${cmd}`);
    execSync(cmd, {stdio: 'inherit'});
  };

  switch (format) {
    case 'mov':
      copyFileSync(intermediate, output);
      break;

    case 'mp4':
      run([
        '-y', '-i', `"${intermediate}"`,
        '-c:v', 'libx264', '-crf', '32',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        `"${output}"`,
      ]);
      break;

    case 'webm':
      if (transparent) {
        run([
          '-y', '-i', `"${intermediate}"`,
          '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
          '-pix_fmt', 'yuva420p',
          '-auto-alt-ref', '0',
          `"${output}"`,
        ]);
      } else {
        run([
          '-y', '-i', `"${intermediate}"`,
          '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
          '-pix_fmt', 'yuv420p',
          `"${output}"`,
        ]);
      }
      break;

    case 'gif': {
      const palette = intermediate.replace('.mov', '-palette.png');
      if (transparent) {
        run([
          '-y', '-i', `"${intermediate}"`,
          '-vf', '"palettegen=reserve_transparent=1:stats_mode=diff"',
          `"${palette}"`,
        ]);
        run([
          '-y', '-i', `"${intermediate}"`, '-i', `"${palette}"`,
          '-lavfi', '"paletteuse=dither=sierra2_4a:alpha_threshold=128"',
          `"${output}"`,
        ]);
      } else {
        run([
          '-y', '-i', `"${intermediate}"`,
          '-vf', '"split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=sierra2_4a"',
          `"${output}"`,
        ]);
      }
      if (existsSync(palette)) unlinkSync(palette);
      break;
    }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const {output, format, port, noServer, transparent} = parseArgs();
  let server: ChildProcess | null = null;

  console.log(`Format: ${format} | Transparent: ${transparent} | Output: ${output}`);

  try {
    // Clean previous intermediate
    if (existsSync(INTERMEDIATE_FILE)) unlinkSync(INTERMEDIATE_FILE);

    // Patch for transparent background if requested
    if (transparent) patchForTransparent();

    // Start server if needed
    const running = await isPortOpen(port);
    if (!running && !noServer) {
      server = startServer(port);
      await waitForServer(port);
      console.log('Dev server ready.');
    } else if (!running) {
      throw new Error(`No server on port ${port} and --no-server was set`);
    } else {
      console.log(`Dev server already running on port ${port}.`);
    }

    // Launch headless browser and trigger render
    console.log('Launching headless browser...');
    const browser = await chromium.launch({args: ['--use-gl=angle']});
    const page = await browser.newPage();
    await page.setViewportSize({width: 1280, height: 960});

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [browser] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.log(`  [browser] ${err.message}`);
    });

    const url = `http://localhost:${port}?render`;
    console.log(`Navigating to ${url}`);
    await page.goto(url, {waitUntil: 'load'});

    // Wait for render to start
    console.log('Waiting for render to start...');
    const startTime = Date.now();
    let renderStarted = false;
    while (Date.now() - startTime < 60_000) {
      if (existsSync(INTERMEDIATE_FILE) && statSync(INTERMEDIATE_FILE).size > 100) {
        renderStarted = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!renderStarted) {
      const state = await page.evaluate(() => document.title);
      console.log(`  Page title: ${state}`);
      throw new Error('Render did not start producing frames within 60s');
    }

    console.log('Rendering... (waiting for output to stabilize)');
    await waitForOutput();

    const movSize = statSync(INTERMEDIATE_FILE).size;
    console.log(`Intermediate render complete: ${(movSize / 1024 / 1024).toFixed(1)} MB`);

    await browser.close();

    // Restore brand-echo.ts before format conversion (server may still be watching)
    restoreFromTransparent();

    // Convert to target format
    if (format === 'mov' && output === INTERMEDIATE_FILE) {
      console.log('Output is already ProRes MOV.');
    } else if (format === 'mov') {
      copyFileSync(INTERMEDIATE_FILE, output);
      console.log(`Copied to: ${output}`);
    } else {
      const ffmpeg = findFfmpeg();
      console.log(`Converting to ${format}...`);
      convertToFormat(ffmpeg, INTERMEDIATE_FILE, output, format, transparent);
      const finalSize = statSync(output).size;
      console.log(`Done: ${output} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
    }
  } finally {
    restoreFromTransparent();
    if (server) {
      console.log('Stopping dev server...');
      try { process.kill(-server.pid!, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    }
  }
}

main().catch((e) => {
  restoreFromTransparent();
  console.error(e.message || e);
  process.exit(1);
});
