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
`COLORS.background` re-exported. Use as `view.fill(BACKGROUND)`.

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

---

## Scene Structure

```tsx
import {makeScene2D} from '@motion-canvas/2d';
import {createBrandShape, updateBrandShape, BACKGROUND, TRITONE_SHADER} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';

export default makeScene2D(function* (view) {
  view.fill(BACKGROUND);

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
