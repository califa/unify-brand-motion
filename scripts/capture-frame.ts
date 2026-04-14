import {chromium} from 'playwright';
import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';

const FRAME = parseInt(process.argv[2] || '30', 10);
const OUTPUT = process.argv[3] || `output/frame_${FRAME.toString().padStart(3, '0')}.png`;
const TRITONE = process.argv.includes('--tritone');
const BLUR = process.argv.includes('--blur');
const URL = process.env.MC_URL || 'http://localhost:9001';

async function captureFrame() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({width: 1280, height: 960});

  console.log(`Loading ${URL}...`);
  await page.goto(URL);
  await page.waitForTimeout(3000);

  // Toggle controls
  await page.evaluate(({tritone, blur}) => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb: any) => {
      const label = cb.nextElementSibling?.textContent || '';
      if (label.includes('Tritone') && cb.checked !== tritone) {
        cb.checked = tritone;
        cb.dispatchEvent(new Event('change'));
      }
      if (label.includes('Motion Blur') && cb.checked !== blur) {
        cb.checked = blur;
        cb.dispatchEvent(new Event('change'));
      }
    });
  }, {tritone: TRITONE, blur: BLUR});

  await page.waitForTimeout(500);

  // Seek
  console.log(`Seeking to frame ${FRAME} (tritone=${TRITONE}, blur=${BLUR})...`);
  await page.evaluate((frame) => {
    const player = (window as any).__echoPlayer;
    if (player) player.requestSeek(frame);
  }, FRAME);

  await page.waitForTimeout(2000);

  // Extract the canvas data at full resolution via toDataURL
  const dataUrl = await page.evaluate(() => {
    // Find the stage canvas (the one Motion Canvas renders to)
    const canvases = document.querySelectorAll('canvas');
    let biggest: HTMLCanvasElement | null = null;
    let biggestArea = 0;
    canvases.forEach(c => {
      const area = c.width * c.height;
      if (area > biggestArea) {
        biggestArea = area;
        biggest = c;
      }
    });
    if (!biggest) return null;
    console.log(`Canvas: ${biggest.width}x${biggest.height}`);
    return biggest.toDataURL('image/png');
  });

  if (!dataUrl) {
    console.error('No canvas found');
    await browser.close();
    process.exit(1);
  }

  // Convert data URL to file
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  mkdirSync(dirname(OUTPUT), {recursive: true});
  writeFileSync(OUTPUT, Buffer.from(base64, 'base64'));
  console.log(`Saved to ${OUTPUT}`);

  await browser.close();
}

captureFrame().catch(e => {
  console.error(e);
  process.exit(1);
});
