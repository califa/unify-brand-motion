import {defineConfig} from 'vite';
// @ts-ignore - CJS/ESM interop
import mc from '@motion-canvas/vite-plugin';
// @ts-ignore - CJS/ESM interop
import ff from '@motion-canvas/ffmpeg';
const motionCanvas = mc.default ?? mc;
const ffmpeg = ff.default ?? ff;

export default defineConfig({
  plugins: [
    ...motionCanvas(),
    ffmpeg(),
  ],
});
