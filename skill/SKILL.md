---
name: brand-animation
description: |
  Generate brand animations with Echo + Tritone + Motion Blur effects using Motion Canvas.
  Accepts natural language descriptions of abstract shape animations, writes the scene code,
  and renders to MP4.
  **Triggers:** "brand animation", "render brand", "logo animation", "motion brand",
  "brand video", "brand effect", "brand motion", "motion asset",
  "unify animation", "unify effect", "unify motion"
  Use when the user wants to create or render a brand-aligned motion graphic.
---

# Brand Animation Generator

Create brand animations by writing Motion Canvas scenes with the Echo + Tritone + Motion Blur effect pipeline. User describes the animation → you write the scene → render to video.

## Output Formats

| Format | Extension | Alpha | Use case |
|--------|-----------|-------|----------|
| MP4    | `.mp4`    | No    | Default. Web, Slack, presentations. CRF 32 optimized. |
| WebM   | `.webm`   | Yes   | Transparent background overlays. Use with `--transparent`. |
| GIF    | `.gif`    | Yes*  | Inline previews, docs. 1-bit alpha with `--transparent`. |
| MOV    | `.mov`    | Yes   | Lossless ProRes 4444 intermediate. Editing/compositing. |

## Project Location

The repo may be at any path. To find it:
```bash
# Check common locations
for dir in ~/vibe/motion-brand ~/motion-brand; do
  [ -f "$dir/package.json" ] && echo "$dir" && break
done
```

If the repo isn't found, run setup:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/califa/unify-brand-motion/main/scripts/setup.sh)
```

## Project Structure

```
motion-brand/
  src/                  ← ENGINE (committed)
    presets/brand.ts       colors, timing, easing constants
    presets/brand-echo.ts  echo shape builder + shaders
    shaders/               WebGL tritone + alpha correction
    controls.ts            effect state (always-on)
    project.ts             scene registration (edit import path here)
    scenes/echo.tsx        reference example scene
  animations/           ← GENERATED SCENES (gitignored)
    *.tsx                  scene files you create
    *.meta                 auto-generated metadata
  scripts/
    render.ts           ← headless render CLI
    setup.sh            ← one-command setup for new machines
  patches/              ← ffmpeg exporter patch (auto-applied by npm install)
  output/               ← rendered videos (gitignored)
```

Animations go in `animations/`, engine code lives in `src/`. The `@brand/` import alias resolves to `src/`, so animation files import like:
```typescript
import {createBrandShape, ...} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';
import {createControlPanel} from '@brand/controls';
```

## Setup

### First time (one command)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/califa/unify-brand-motion/main/scripts/setup.sh)
```

This installs Homebrew, Node.js, ffmpeg, clones the repo, installs npm dependencies, patches the ffmpeg exporter, and installs Playwright Chromium. Nothing else needed.

### Already have the repo

```bash
cd <repo-path>
npm install   # postinstall auto-patches ffmpeg + installs Chromium
```

## Workflow

### Step 1: Understand the animation request

The user describes shapes and their motion. Common elements:
- **Shapes**: squares/rectangles (Rect), circles (Rect with radius), lines, polygons
- **Transforms**: scale (grow/shrink), rotation (spin), position (slide)
- **Timing**: when things start, how long they animate, what easing to use

### Step 2: Write the scene

Create a scene file at `animations/<name>.tsx`. Read `references/scene-example.md` for a complete annotated template and `references/brand-api.md` for the full API.

**Minimal scene structure:**

```tsx
import {makeScene2D} from '@motion-canvas/2d';
import {createBrandShape, updateBrandShape, TRITONE_SHADER, applyBackground} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';

const FPS = CANVAS.fps;
const DURATION = 4; // seconds
const TOTAL_FRAMES = DURATION * FPS;

function getTransform(frame: number) {
  const animStart = 10;
  const animEnd = 50;
  let scale = 0;
  let rotation = 0;
  if (frame >= animEnd) {
    scale = 1; rotation = 90;
  } else if (frame > animStart) {
    const t = (frame - animStart) / (animEnd - animStart);
    const eased = cubicBezier(0.89, 0, 0.11, 1, t);
    scale = eased; rotation = eased * 90;
  }
  return {scale, rotation};
}

export default makeScene2D(function* (view) {
  applyBackground(view);

  const shape = createBrandShape(500, 500);
  view.add(shape.group);
  for (const sf of shape.subFrames) sf.tritoneWrapper.shaders(TRITONE_SHADER);

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    updateBrandShape(shape, frame, FPS, getTransform);
    yield;
  }
});
```

**Key rules:**
- Use `applyBackground(view)` instead of `view.fill(BACKGROUND)` — this automatically supports transparent rendering mode
- Each shape needs its own `createBrandShape(width, height)` call
- The transform function receives a fractional frame number and returns `{scale: number, rotation: number}`
- `scale` of 0 hides the shape; use this before the animation starts
- Apply `TRITONE_SHADER` to all sub-frames at the start
- `yield` advances one frame — the loop must run for `TOTAL_FRAMES` iterations
- Use `cubicBezier(x1, y1, x2, y2, t)` for easing. Brand defaults: `EASING.inner` (sharp S-curve), `EASING.outer` (fast attack)
- For **position animation**, copy `updateWithPosition` from `references/brand-api.md` — the default `updateBrandShape` only handles scale + rotation
- For **SVG path data** (logos, custom shapes), use `Path` from `@motion-canvas/2d` with a custom echo system — see `references/brand-api.md` "Animating SVG Paths" for the full copy-paste template. No need to read the codebase to figure this out.
- For **circles**, use `createBrandShape(d, d)` then set `radius(d/2)` on all rects (main + echoes)
- For **looping animations**, make transform functions periodic so the last frame matches the first
- **Shape limit**: scenes using `updateWithPosition` crash silently above ~8 shapes (the per-shape rect count — 816 rects each — exhausts the WebGL context). Stay at 8 or fewer shapes when using `updateWithPosition`. `updateBrandShape` scenes can use more (grid-snap uses 9).

**Layer transforms when a shape moves.** A shape sliding from A to B is more compelling when rotation and scale change simultaneously. The echo trail captures all three axes of movement at once, producing a richer smear. A few reliable combinations:
- **Slide + spin**: rotate 45–90° over the same duration as the position move. A square arriving at its destination while rotating lands with authority.
- **Slide + scale punch**: scale down slightly (0.85×) during travel, then snap back to 1.0 on arrival — like a shape compressing through space.
- **Slide + scale in**: if the shape doesn't exist before this move, start at scale 0 and reach scale 1 right as position arrives. The shape appears to materialize at its destination.
- **Scale out + slide**: invert of the above — shrink to 0 while drifting away. The shape dissolves mid-travel.


### Step 3: Register the scene

Edit `src/project.ts` to import your scene from `animations/`:

```typescript
import {makeProject} from '@motion-canvas/core';
import scene from '../animations/my-scene?scene';
import {setPlayer} from './controls';

export default makeProject({
  scenes: [scene],
  experimentalFeatures: true,
  plugins: [{
    name: 'echo-controls',
    player(player) { setPlayer(player); },
  }],
});
```

### Step 4: Render

```bash
# Default: MP4 with CRF 32 optimization
npm run render

# Specific format
npm run render -- --format webm --transparent
npm run render -- --format gif
npm run render -- --format mov

# Custom output path (format inferred from extension)
npm run render -- --output ~/Desktop/animation.webm --transparent

# All options
npm run render -- --format mp4 --output ~/Desktop/logo.mp4 --port 9001
```

The render script auto-starts the dev server, launches headless Chromium, triggers the render via Motion Canvas's `?render` URL parameter, produces a ProRes 4444 intermediate, converts to the target format with ffmpeg, then cleans up.

**Transparency note:** `--transparent` only works with webm, gif, and mov. MP4 has no alpha channel — the render script warns if you try. For transparent backgrounds, use `--format webm --transparent`.

### Step 5: Deliver the output

After rendering, copy the file to a user-accessible location:
```bash
cp output/project.mp4 ~/Desktop/animation.mp4
```
Or render directly to the destination:
```bash
npm run render -- --output ~/Desktop/animation.mp4
```
Tell the user where the file is so they can open it.

### Step 6: Preview (optional)

For interactive preview with timeline scrubbing:

```bash
npm start
# Open http://localhost:9001 in a browser
```

## Design Principles

**Objects should be mostly static.** The echo trail and motion blur effects are the visual signature of this system — they work best as punctuation on discrete, decisive movements. An object that animates in, holds its position, then animates out reads as intentional and powerful. An object in constant motion means the orange trails are always present everywhere, which makes them invisible noise instead of a highlight.

Concrete guidance:
- **Animate in → hold → animate out.** Spend the majority of frames at rest. A 4-second clip might use 20 frames to animate in, 80 frames static, 20 frames to animate out.
- **Avoid looping continuous motion** (e.g. perpetual spinning or orbiting). If something must loop, give it clear beats — discrete snaps or pulses separated by stillness.
- **Use scale=0 before an object enters.** Objects should appear to arrive, not fade in. Start at scale 0 (invisible), then scale up quickly with a snappy easing curve.
- **One shape moving at a time** is generally more effective than multiple shapes in simultaneous motion — it focuses the trails and avoids visual chaos.

The orange trail is an exclamation mark. Use it sparingly.

## Customizing the Brand System

Edit `src/presets/brand.ts` to change the visual system:

| Setting | Location | Default |
|---------|----------|---------|
| Background | `COLORS.background` | `#FFFEF4` (warm white) |
| Accent | `COLORS.accent` | `#FE3C01` (red-orange) |
| Dark | `COLORS.dark` | `#241E20` (brown-black) |
| Stroke width | `STROKE.width` | `2` |
| Canvas size | `CANVAS.width/height` | `1080` |
| FPS | `CANVAS.fps` | `30` |
| Echo count | `ECHO.count` | `50` |
| Echo decay | `ECHO.decay` | `0.93` |
| Blur samples | `MOTION_BLUR.samples` | `16` |

The Tritone mapping (`TRITONE.shadows/midtones/highlights`) derives from COLORS automatically.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank/white output | Too many shapes with `updateWithPosition` (>8 shapes exhausts WebGL context) | Reduce to ≤8 shapes, or use `updateBrandShape` (scale+rotation only) which is lighter |
| Render never starts | Port 9001 occupied by another process | Kill the other process or use `--port 9002` |
| Shader errors in console | Missing `experimentalFeatures: true` in project.ts | Ensure project.ts has `experimentalFeatures: true` in `makeProject()` |
| "Render did not start" | Scene has a runtime error (check `[browser]` lines above) | Fix the error logged by the browser, then retry |
| TypeScript errors before render | Scene file has type errors | Fix the errors shown — the validator runs `tsc` before spending time on a render |
| "Another render in progress" | Previous render crashed without cleaning up | Check if another render is actually running; if not, delete `output/.render.lock` |
| Transparent mode didn't work | Scene uses `view.fill(BACKGROUND)` directly | Replace with `applyBackground(view)` — the old pattern bypasses transparent mode |
| Output file is tiny/corrupt | ffmpeg conversion failed silently | Check the ffmpeg stderr output; ensure the intermediate .mov exists and is valid |
| `.meta` file errors | Stale .meta files from a renamed scene | Delete `animations/<name>.meta` and re-render |

### Preflight check

Run `npm run render -- --preflight` to verify the environment without rendering. This checks:
- node_modules and Vite are installed
- Playwright Chromium is available
- ffmpeg is found (bundled or system)
- The ffmpeg exporter patch is applied
- project.ts has a valid scene import
- No stale transparent patch is left in brand-echo.ts

## Architecture

For deep context on the rendering pipeline (echo stacking, tritone shader, additive blur, what worked and what didn't), read `HANDOFF.md` in the repo root.
