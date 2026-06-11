# Brand System API Reference

## `src/presets/brand.ts` — Visual Constants

### COLORS
```typescript
COLORS.background  // '#FFFEF4' — warm cream (background + tritone highlights)
COLORS.accent      // '#FE3C01' — red-orange (tritone midtones)
COLORS.dark        // '#241E20' — brown-black (tritone shadows)
COLORS.black       // '#000000' — pure black (pre-tritone stroke color)
```

### TRITONE
Derives from COLORS. Maps greyscale luminance → 3-stop color gradient.
```typescript
TRITONE.highlights  // COLORS.background (#FFFEF4)
TRITONE.midtones    // COLORS.accent (#FE3C01)
TRITONE.shadows     // COLORS.dark (#241E20)
```

### STROKE
```typescript
STROKE.color  // '#000000'
STROKE.width  // 2
```

### CANVAS
```typescript
CANVAS.width   // 1080
CANVAS.height  // 1080
CANVAS.fps     // 30
```

### ECHO
```typescript
ECHO.time              // -0.002 (seconds between echoes, negative = look back)
ECHO.count             // 50
ECHO.startingIntensity // 1.0
ECHO.decay             // 0.93 (opacity multiplier per step)
```

### MOTION_BLUR
```typescript
MOTION_BLUR.shutterAngle  // 180 (degrees)
MOTION_BLUR.shutterPhase  // -90 (degrees, centered on frame)
MOTION_BLUR.samples       // 16 (sub-frame samples)
```

### EASING
```typescript
EASING.inner  // [0.89, 0, 0.11, 1] — sharp S-curve
EASING.outer  // [0.2, 0, 0.11, 1] — fast attack, slow settle
```

### cubicBezier(x1, y1, x2, y2, t) → number
Evaluates a CSS cubic-bezier timing function. `t` in [0,1], returns eased value in [0,1].
Uses Newton's method to invert the x-coordinate bezier.

### LOGO (current two-square animation timing)
```typescript
LOGO.rectSize   // 498
LOGO.duration   // 4 (seconds)

LOGO.inner.animStart     // 11 (frame)
LOGO.inner.scaleEnd      // 40
LOGO.inner.rotEnd        // 51
LOGO.inner.nullRotation  // 180 (constant offset)
LOGO.inner.scaleTo       // 1
LOGO.inner.rotTo         // 90

LOGO.outer.animStart     // 28
LOGO.outer.scaleEnd      // 56
LOGO.outer.rotEnd        // 67
LOGO.outer.scaleTo       // 1.51
LOGO.outer.rotTo         // 45
```

---

## `src/presets/brand-echo.ts` — Shape Builder + Shaders

### BACKGROUND
`COLORS.background` re-exported. Prefer `applyBackground(view)` which auto-handles transparent render mode.

### applyBackground(view)
Sets the view background. Uses cream (#FFFEF4) normally, transparent when rendered with `--transparent` flag.

### TRITONE_SHADER
WebGL shader object to apply to `tritoneWrapper.shaders()`. Maps greyscale → brand colors.

### createBrandShape(width, height) → BrandShape
Creates a shape with full echo trail + motion blur sub-frame infrastructure.

Returns:
```typescript
interface BrandShape {
  group: Node;  // Add to view. Has cache:true for additive compositing.
  subFrames: {
    container: Node;       // opacity=1/N, compositeOperation='lighter'
    tritoneWrapper: Node;  // apply shaders here
    main: Rect;            // the primary shape (white fill + black stroke)
    echoes: Rect[];        // 50 echo copies at decaying opacity
  }[];  // 16 sub-frames
}
```

Each shape is a white-filled rectangle with black stroke. The echo trail and motion blur are handled automatically by `updateBrandShape`.

### updateBrandShape(shape, frame, fps, getTransform)
Updates all echo copies and blur sub-frames for a given frame.

- `shape` — from `createBrandShape()`
- `frame` — current integer frame number
- `fps` — frames per second (use `CANVAS.fps`)
- `getTransform` — function `(frame: number) => {scale: number, rotation: number}`
  - Called for every echo copy at fractional frame positions
  - `scale`: 0 = invisible, 1 = 100%, >1 = enlarged
  - `rotation`: degrees

The transform function is called many times per frame (50 echoes × 16 sub-frames = 800 calls). Keep it fast.

### BrandShape type
When writing custom update functions, import the type directly:
```typescript
import {BrandShape} from '@brand/presets/brand-echo';
```

### Making a circle
`createBrandShape` always creates rectangles. To make a circle, set `radius` on both the main rect and all echoes immediately after creation:

```typescript
const d = 200; // diameter
const circle = createBrandShape(d, d);
view.add(circle.group);
for (const sf of circle.subFrames) {
  sf.main.radius(d / 2);
  for (const echo of sf.echoes) echo.radius(d / 2);
  sf.tritoneWrapper.shaders(TRITONE_SHADER);
}
```

### Static group placement
To fix a shape at a specific canvas position (without animating position in the echo loop), set `group.position` once after creation — before the frame loop:

```typescript
const shape = createBrandShape(300, 300);
view.add(shape.group);
shape.group.position({x: 200, y: -150}); // canvas coords, origin = center
```

This is different from `updateWithPosition`, which animates position frame-by-frame. Use `group.position` when a shape stays in one place but scale/rotates; use `updateWithPosition` when it moves.

---

## Available Shape Types

All shape types are exported from `@motion-canvas/2d`. All support `fill`, `stroke`, `lineWidth`, `opacity`, `scale`, `rotation`, `position`.

| Component | Extra props | Notes |
|-----------|------------|-------|
| `Rect` | `width`, `height`, `radius` | Default for brand shapes |
| `Path` | `data` (SVG path string) | For logos and custom shapes |
| `Circle` | `width`, `height` | Use equal width/height for a circle |
| `Polygon` | `sides`, `radius` | Regular polygon |
| `Line` | `points[]`, `lineWidth` | Polylines |
| `Svg` | `svg` (SVG string), `width`, `height` | Full SVG |

No need to verify these in node_modules — they all exist in `@motion-canvas/2d`.

---

## updateWithPosition — Shapes That Move

`updateBrandShape` only handles scale and rotation. For shapes that also translate (slide across canvas), use this function — copy it directly into your scene file:

```typescript
import {ECHO, MOTION_BLUR} from '@brand/presets/brand';
import {getControls} from '@brand/controls';
import {BrandShape} from '@brand/presets/brand-echo';

const FPS = CANVAS.fps;

interface T { scale: number; rotation: number; x: number; y: number; }

function updateWithPosition(shape: BrandShape, frame: number, fn: (f: number) => T) {
  const numSamples = MOTION_BLUR.samples;
  const echoFrameStep = ECHO.time * FPS;
  const shutterFraction = MOTION_BLUR.shutterAngle / 360;
  const phaseOffset = MOTION_BLUR.shutterPhase / 360;
  const echoCount = ECHO.count;
  for (let s = 0; s < shape.subFrames.length; s++) {
    const sf = shape.subFrames[s];
    if (s >= numSamples) { sf.container.opacity(0); continue; }
    sf.container.opacity(1 / numSamples);
    sf.container.compositeOperation('lighter');
    const sampleT = numSamples === 1 ? 0.5 : s / (numSamples - 1);
    const subFrame = frame + phaseOffset + sampleT * shutterFraction;
    const t = fn(subFrame);
    sf.main.scale(t.scale); sf.main.rotation(t.rotation);
    sf.main.position.x(t.x); sf.main.position.y(t.y);
    for (let i = 0; i < echoCount; i++) {
      const et = fn(subFrame + (echoCount - i) * echoFrameStep);
      sf.echoes[i].scale(et.scale); sf.echoes[i].rotation(et.rotation);
      sf.echoes[i].position.x(et.x); sf.echoes[i].position.y(et.y);
    }
  }
}
```

x/y are in canvas pixels (origin = center of 1080×1080 canvas). Transform function receives fractional frames.

**Shape limit:** Keep scenes to ≤8 shapes when using `updateWithPosition`. Each shape creates 816 Rect nodes; more exhausts the WebGL context.

---

## Animating SVG Paths (Logos, Custom Shapes)

When the subject is SVG path data (e.g. a logo), use `Path` instead of `Rect`. Since `createBrandShape` creates `Rect` nodes internally, build a custom echo system:

```typescript
import {makeScene2D, Path, Node} from '@motion-canvas/2d';
import {applyBackground, TRITONE_SHADER} from '@brand/presets/brand-echo';
import {CANVAS, ECHO, MOTION_BLUR, STROKE, cubicBezier, EASING} from '@brand/presets/brand';
import {createControlPanel, getControls} from '@brand/controls';

const FPS = CANVAS.fps;
const ECHO_COUNT = ECHO.count;      // 50
const MAX_SAMPLES = MOTION_BLUR.samples; // 16

const echoIntensities = Array.from({length: ECHO_COUNT}, (_, i) =>
  Math.pow(ECHO.decay, ECHO_COUNT - i),
);

interface PathShape {
  group: Node;
  subFrames: { container: Node; tritoneWrapper: Node; main: Path; echoes: Path[] }[];
}

function createPathShape(pathData: string): PathShape {
  const group = new Node({cache: true});
  const subFrames: PathShape['subFrames'] = [];
  for (let s = 0; s < MAX_SAMPLES; s++) {
    const container = new Node({opacity: 0});
    group.add(container);
    const tritoneWrapper = new Node({});
    container.add(tritoneWrapper);
    const main = new Path({data: pathData, fill: '#ffffff', stroke: STROKE.color, lineWidth: STROKE.width});
    tritoneWrapper.add(main);
    const echoes: Path[] = [];
    for (let i = ECHO_COUNT - 1; i >= 0; i--) {
      const p = new Path({data: pathData, fill: '#ffffff', stroke: STROKE.color, lineWidth: STROKE.width, opacity: echoIntensities[i]});
      tritoneWrapper.add(p);
      echoes[i] = p;
    }
    subFrames.push({container, tritoneWrapper, main, echoes});
  }
  return {group, subFrames};
}

// Minimal update — position only. Extend T with scale/rotation if needed.
interface T { x: number; y: number; }

function updatePathShape(shape: PathShape, frame: number, fn: (f: number) => T) {
  const c = getControls();
  const numSamples = c.motionBlur ? MAX_SAMPLES : 1;
  const echoFrameStep = ECHO.time * FPS;
  const shutterFraction = MOTION_BLUR.shutterAngle / 360;
  const phaseOffset = MOTION_BLUR.shutterPhase / 360;
  for (let s = 0; s < MAX_SAMPLES; s++) {
    const sf = shape.subFrames[s];
    if (s >= numSamples) { sf.container.opacity(0); continue; }
    sf.container.opacity(1 / numSamples);
    sf.container.compositeOperation(numSamples > 1 ? 'lighter' : 'source-over');
    const sampleT = numSamples === 1 ? 0.5 : s / (numSamples - 1);
    const subFrame = frame + phaseOffset + sampleT * shutterFraction;
    const t = fn(subFrame);
    sf.main.position.x(t.x); sf.main.position.y(t.y);
    for (let i = 0; i < ECHO_COUNT; i++) {
      const et = fn(subFrame + (ECHO_COUNT - i) * echoFrameStep);
      sf.echoes[i].position.x(et.x); sf.echoes[i].position.y(et.y);
    }
  }
}
```

**Centering SVG path data on canvas:**

SVG paths have absolute coordinates from their original viewBox. To center a logo on canvas:

```typescript
const LOGO_W = 163; const LOGO_H = 110; // original SVG viewBox dimensions
const SCALE = 5;    // scale factor (163×110 → 815×550 at 5×)

const wrapper = new Node({scale: SCALE});
view.add(wrapper);
const origin = new Node({x: -(LOGO_W / 2), y: -(LOGO_H / 2)});
wrapper.add(origin);
// add path shapes to `origin` — they render at SVG coords, centered on canvas
```

Position offsets in `updatePathShape` are in pre-scale SVG units. Entry offset must exceed `canvas half-width / SCALE` = `540 / 5 = 108` SVG units to be fully off-screen.

---

## Scene Structure

```tsx
import {makeScene2D} from '@motion-canvas/2d';
import {createBrandShape, updateBrandShape, TRITONE_SHADER, applyBackground} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';

export default makeScene2D(function* (view) {
  applyBackground(view);

  // 1. Create shapes
  const shape = createBrandShape(width, height);
  view.add(shape.group);

  // 2. Apply tritone
  for (const sf of shape.subFrames) sf.tritoneWrapper.shaders(TRITONE_SHADER);

  // 3. Frame loop
  for (let frame = 0; frame < totalFrames; frame++) {
    updateBrandShape(shape, frame, CANVAS.fps, myTransformFn);
    yield;
  }
});
```

## project.ts Registration

When creating a new scene, update `src/project.ts`:

```typescript
import {makeProject} from '@motion-canvas/core';
import scene from '../animations/my-scene?scene';  // note the ?scene suffix
import {setPlayer} from './controls';

export default makeProject({
  scenes: [scene],
  experimentalFeatures: true,  // required for shaders
  plugins: [{
    name: 'echo-controls',
    player(player) { setPlayer(player); },
  }],
});
```

The `?scene` import suffix is required — it tells the Motion Canvas Vite plugin to compile the file as a scene. Scene files live in `animations/` and use the `@brand/` alias to import engine code from `src/`.
