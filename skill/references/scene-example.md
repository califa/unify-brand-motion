# Scene Example — Two-Square Logo Animation

This is the complete `src/scenes/echo.tsx` scene, annotated. Use it as a template for new animations.

```tsx
import {makeScene2D} from '@motion-canvas/2d';
import {
  BACKGROUND,
  createBrandShape,
  updateBrandShape,
  TRITONE_SHADER,
} from '@brand/presets/brand-echo';
import {LOGO, CANVAS, EASING, cubicBezier} from '@brand/presets/brand';
import {createControlPanel, getControls} from '@brand/controls';

const FPS = CANVAS.fps;           // 30
const DURATION = LOGO.duration;   // 4 seconds
const TOTAL_FRAMES = DURATION * FPS; // 120 frames
const RECT_SIZE = LOGO.rectSize;  // 498px

// ─── Transform functions ────────────────────────────────────────
// These return {scale, rotation} for a given frame number.
// The frame can be fractional (echo/blur sub-samples use fractional frames).

function applyEase(t: number, bezier: readonly [number, number, number, number]): number {
  return cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], t);
}

// Inner square: scales 0→1, rotates 0→90° + 180° null rotation = 270° final
function getInnerTransform(frame: number) {
  const {animStart, scaleEnd, rotEnd, nullRotation, scaleTo, rotTo} = LOGO.inner;

  let scale = 0;
  if (frame >= scaleEnd) scale = scaleTo;          // after animation: hold at 1.0
  else if (frame > animStart) {                     // during animation: ease
    const t = (frame - animStart) / (scaleEnd - animStart);
    scale = applyEase(t, EASING.inner) * scaleTo;
  }
  // else: before animation, scale stays 0 (invisible)

  let rotation = 0;
  if (frame >= rotEnd) rotation = rotTo;
  else if (frame > animStart) {
    const t = (frame - animStart) / (rotEnd - animStart);
    rotation = applyEase(t, EASING.inner) * rotTo;
  }

  return {scale, rotation: rotation + nullRotation};
}

// Outer square: scales 0→1.51, rotates 0→45°
function getOuterTransform(frame: number) {
  const {animStart, scaleEnd, rotEnd, scaleFrom, scaleTo, rotTo} = LOGO.outer;

  let scale = scaleFrom;  // 0 (hidden until animation starts)
  if (frame >= scaleEnd) scale = scaleTo;
  else if (frame > animStart) {
    const t = (frame - animStart) / (scaleEnd - animStart);
    scale = scaleFrom + applyEase(t, EASING.outer) * (scaleTo - scaleFrom);
  }

  let rotation = 0;
  if (frame >= rotEnd) rotation = rotTo;
  else if (frame > animStart) {
    const t = (frame - animStart) / (rotEnd - animStart);
    rotation = applyEase(t, EASING.outer) * rotTo;
  }

  return {scale, rotation};
}

// ─── Scene generator ────────────────────────────────────────────

export default makeScene2D(function* (view) {
  createControlPanel(); // no-op (controls simplified to always-on)

  view.fill(BACKGROUND); // warm cream background

  // Create shapes — each gets its own echo/blur/tritone pipeline
  const outer = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(outer.group);

  const inner = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(inner.group);

  // Main frame loop
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    // Apply tritone shader to all sub-frames
    const shader = TRITONE_SHADER;
    for (const sf of outer.subFrames) sf.tritoneWrapper.shaders(shader);
    for (const sf of inner.subFrames) sf.tritoneWrapper.shaders(shader);

    // Update each shape's echo trail + blur sub-frames
    updateBrandShape(outer, frame, FPS, getOuterTransform);
    updateBrandShape(inner, frame, FPS, getInnerTransform);
    yield; // advance one frame
  }
});
```

## Pattern for new animations

1. **Define your shapes** — `createBrandShape(width, height)` for each
2. **Write transform functions** — `(frame: number) => {scale, rotation}`. The frame can be fractional.
3. **Set duration** — `TOTAL_FRAMES = durationInSeconds * CANVAS.fps`
4. **Frame loop** — iterate `TOTAL_FRAMES` times, calling `updateBrandShape()` per shape, `yield` per frame
5. **Add shapes in back-to-front order** — first `view.add()` call is the backmost shape

## Transform function tips

- Return `scale: 0` to hide a shape (before its animation starts)
- Use `cubicBezier(x1, y1, x2, y2, t)` for smooth easing. `t` goes from 0 to 1.
- Common easing curves:
  - `EASING.inner` = `[0.89, 0, 0.11, 1]` — sharp S-curve (snappy in-out)
  - `EASING.outer` = `[0.2, 0, 0.11, 1]` — fast attack, slow settle
  - `[0.25, 0.1, 0.25, 1]` — CSS `ease` (gentle)
  - `[0.42, 0, 1, 1]` — CSS `ease-in`
  - `[0, 0, 0.58, 1]` — CSS `ease-out`
- For position animation, `scale` and `rotation` are the only properties `updateBrandShape` handles. For position changes, modify the shape's `group` node directly: `shape.group.position.x(value)` in the frame loop.
