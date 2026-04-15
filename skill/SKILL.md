---
name: brand-animation
description: |
  Generate brand animations with Echo + Tritone + Motion Blur effects using Motion Canvas.
  Accepts natural language descriptions of abstract shape animations, writes the scene code,
  and renders to MP4.
  **Triggers:** "brand animation", "render brand", "logo animation", "motion brand",
  "brand video", "animate", "motion asset", "brand motion"
  Use when the user wants to create or render a brand-aligned motion graphic.
---

# Brand Animation Generator

Create brand animations by writing Motion Canvas scenes with the Echo + Tritone + Motion Blur effect pipeline. User describes the animation → you write the scene → render to MP4.

## What This Produces

- 1080x1080 30fps MP4 video
- Shapes rendered with 50-copy echo trail (ghosting/motion trail effect)
- Tritone color mapping: dark brown-black (#241E20) → red-orange (#FE3C01) → warm white (#FFFEF4)
- 16-sample motion blur (additive `lighter` blending)
- Warm cream background (#FFFEF4)

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
  scripts/render.ts     ← headless render CLI
  output/               ← rendered MP4s (gitignored)
```

Animations go in `animations/`, engine code lives in `src/`. The `@brand/` import alias resolves to `src/`, so animation files import like:
```typescript
import {createBrandShape, ...} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';
import {createControlPanel} from '@brand/controls';
```

## Setup

### First time on a new machine

Check whether Node.js is installed:
```bash
node --version  # need v18+
```
If missing, install from https://nodejs.org (LTS).

Clone the repo and install dependencies:
```bash
git clone https://github.com/califa/unify-motion.git ~/vibe/motion-brand
cd ~/vibe/motion-brand
npm install
npx playwright install chromium
```

The repo path (`~/vibe/motion-brand`) is the default assumed below. If the user has it elsewhere, use that path instead.

### Already have the repo

```bash
cd ~/vibe/motion-brand
npm install       # if you haven't already, or after pulling changes
npx playwright install chromium  # only needed once
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
import {createBrandShape, updateBrandShape, BACKGROUND, TRITONE_SHADER} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';
import {createControlPanel} from '@brand/controls';

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
  createControlPanel();
  view.fill(BACKGROUND);

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
- Each shape needs its own `createBrandShape(width, height)` call
- The transform function receives a fractional frame number and returns `{scale: number, rotation: number}`
- `scale` of 0 hides the shape; use this before the animation starts
- Apply `TRITONE_SHADER` to all sub-frames at the start
- `yield` advances one frame — the loop must run for `TOTAL_FRAMES` iterations
- Use `cubicBezier(x1, y1, x2, y2, t)` for easing. Brand defaults: `EASING.inner` (sharp S-curve), `EASING.outer` (fast attack)
- For **position animation**, write a custom `updateWithPosition` function (see `references/scene-example.md` for the pattern) — the default `updateBrandShape` only handles scale + rotation
- For **circles**, use `createBrandShape(d, d)` then set `radius(d/2)` on all rects (main + echoes)
- For **looping animations**, make transform functions periodic so the last frame matches the first

**Layer transforms when a shape moves.** A shape sliding from A to B is more compelling when rotation and scale change simultaneously. The echo trail captures all three axes of movement at once, producing a richer smear. A few reliable combinations:
- **Slide + spin**: rotate 45–90° over the same duration as the position move. A square arriving at its destination while rotating lands with authority.
- **Slide + scale punch**: scale down slightly (0.85×) during travel, then snap back to 1.0 on arrival — like a shape compressing through space.
- **Slide + scale in**: if the shape doesn't exist before this move, start at scale 0 and reach scale 1 right as position arrives. The shape appears to materialize at its destination.
- **Scale out + slide**: invert of the above — shrink to 0 while drifting away. The shape dissolves mid-travel.

Don't layer all three on every move — pick one or two that reinforce the intended feel. A clean slide alone is fine when contrast with the previous/next move calls for restraint.

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
npm run render
# Output: output/project.mp4

# Copy to a specific location:
npm run render -- --output ~/Desktop/animation.mp4
```

The render script auto-starts the dev server, launches headless Chromium, triggers the render via Motion Canvas's `?render` URL parameter, waits for ffmpeg to produce the MP4, then cleans up.

### Step 5: Preview (optional)

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

## Architecture

For deep context on the rendering pipeline (echo stacking, tritone shader, additive blur, what worked and what didn't), read `HANDOFF.md` in the repo root.
