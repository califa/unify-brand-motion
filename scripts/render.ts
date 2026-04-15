/**
 * Headless brand animation renderer.
 *
 * Starts the Motion Canvas dev server (if not running), launches headless
 * Chromium with ?render to trigger ffmpeg export, waits for completion.
 *
 * Usage:
 *   npx tsx scripts/render.ts [--output path/to/video.mp4]
 */

import {chromium} from 'playwright';
import {spawn, ChildProcess} from 'child_process';
import {existsSync, statSync, copyFileSync, unlinkSync, mkdirSync} from 'fs';
import {dirname, resolve} from 'path';
import {createConnection} from 'net';

const PROJECT_DIR = resolve(import.meta.dirname, '..');
const OUTPUT_FILE = resolve(PROJECT_DIR, 'output/project.mp4');
const DEFAULT_PORT = 9001;

// ─── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let output: string | null = null;
  let port = DEFAULT_PORT;
  let noServer = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      output = resolve(args[++i]);
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === '--no-server') {
      noServer = true;
    }
  }

  return {output, port, noServer};
}

// ─── Server lifecycle ──────────────────────────────────────────

async function isPortOpen(port: number): Promise<boolean> {
  // Try both IPv4 and IPv6 (Vite may listen on either)
  for (const host of ['127.0.0.1', '::1']) {
    const open = await new Promise<boolean>((resolve) => {
      const conn = createConnection({port, host});
      conn.on('connect', () => { conn.end(); resolve(true); });
      conn.on('error', () => resolve(false));
      conn.setTimeout(1000, () => { conn.destroy(); resolve(false); });
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
    {
      cwd: PROJECT_DIR,
      stdio: 'pipe',
      detached: true,
    },
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

// ─── Render completion detection ───────────────────────────────

async function waitForOutput(timeoutMs = 300_000): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  let stableAt = 0;

  while (Date.now() - start < timeoutMs) {
    if (existsSync(OUTPUT_FILE)) {
      const size = statSync(OUTPUT_FILE).size;
      if (size > 0 && size === lastSize) {
        if (!stableAt) stableAt = Date.now();
        if (Date.now() - stableAt > 2000) return; // stable for 2s
      } else {
        lastSize = size;
        stableAt = 0;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Render did not complete within ${timeoutMs / 1000}s`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const {output, port, noServer} = parseArgs();
  let server: ChildProcess | null = null;

  try {
    // Clean previous output
    if (existsSync(OUTPUT_FILE)) {
      unlinkSync(OUTPUT_FILE);
    }

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
    const browser = await chromium.launch({
      args: ['--use-gl=angle'],
    });
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

    // Wait for the renderer to finish. The page title changes during rendering.
    // Also check if render actually started by waiting for the output file to grow.
    console.log('Waiting for render to start...');

    // Poll: wait for output file to exist with size > 48 bytes (empty MP4 header),
    // or for 60s max start time
    const startTime = Date.now();
    let renderStarted = false;
    while (Date.now() - startTime < 60_000) {
      if (existsSync(OUTPUT_FILE) && statSync(OUTPUT_FILE).size > 100) {
        renderStarted = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!renderStarted) {
      // Check the renderer state via the page
      const state = await page.evaluate(() => {
        return document.title;
      });
      console.log(`  Page title: ${state}`);
      throw new Error('Render did not start producing frames within 60s');
    }

    console.log('Rendering... (waiting for output to stabilize)');
    await waitForOutput();

    const size = statSync(OUTPUT_FILE).size;
    console.log(`Render complete: ${OUTPUT_FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);

    await browser.close();

    // Copy to output path if specified
    if (output) {
      mkdirSync(dirname(output), {recursive: true});
      copyFileSync(OUTPUT_FILE, output);
      console.log(`Copied to: ${output}`);
    }
  } finally {
    if (server) {
      console.log('Stopping dev server...');
      try {
        process.kill(-server.pid!, 'SIGTERM');
      } catch {
        server.kill('SIGTERM');
      }
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
