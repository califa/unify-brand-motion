import {makeScene2D} from '@motion-canvas/2d';
import {
  BACKGROUND,
  createBrandShape,
  updateBrandShape,
  TRITONE_SHADER,
  ALPHA_CORRECT_SHADER,
} from '../presets/brand-echo';
import {LOGO, CANVAS, EASING, cubicBezier, STROKE} from '../presets/brand';
import {createControlPanel, getControls} from '../controls';

const FPS = CANVAS.fps;
// Motion finishes at the last rotEnd; use that as the true end of the forward
// phase so the hold duration is exactly 1 second, not 1s + the built-in plateau.
const MOTION_END = Math.max(LOGO.inner.rotEnd, LOGO.outer.rotEnd); // 67
const FORWARD_FRAMES = MOTION_END;                                   // 67
const REVERSE_START = MOTION_END;                                     // 67
const TOTAL_FRAMES = MOTION_END * 2;                                  // 134
const RECT_SIZE = LOGO.rectSize;

function applyEase(t: number, bezier: readonly [number, number, number, number]): number {
  return cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], t);
}

// ─── Forward transforms (unchanged) ──────────────────────────────────────────

function getInnerTransform(frame: number) {
  const {animStart, scaleEnd, rotEnd, nullRotation, scaleTo, rotTo} = LOGO.inner;

  let scale = 0;
  if (frame >= scaleEnd) scale = scaleTo;
  else if (frame > animStart) {
    const t = (frame - animStart) / (scaleEnd - animStart);
    scale = applyEase(t, EASING.inner) * scaleTo;
  }

  let rotation = 0;
  if (frame >= rotEnd) rotation = rotTo;
  else if (frame > animStart) {
    const t = (frame - animStart) / (rotEnd - animStart);
    rotation = applyEase(t, EASING.inner) * rotTo;
  }

  return {scale, rotation: rotation + nullRotation};
}

function getOuterTransform(frame: number) {
  const {animStart, scaleEnd, rotEnd, scaleFrom, scaleTo, rotTo} = LOGO.outer;

  let scale = scaleFrom;
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

// ─── Full timeline: forward → hold → reverse (CW) ────────────────────────────
// During reverse, scale mirrors the forward collapse while rotation *continues*
// clockwise (same direction) by the same angular amount it travelled forward.

const innerFinal = getInnerTransform(FORWARD_FRAMES);
const outerFinal = getOuterTransform(FORWARD_FRAMES);

function getInnerFull(frame: number) {
  if (frame < REVERSE_START) return getInnerTransform(Math.min(frame, FORWARD_FRAMES));
  const rf = FORWARD_FRAMES + REVERSE_START - frame; // FORWARD_FRAMES → 0
  const fwd = getInnerTransform(rf);
  return {scale: fwd.scale, rotation: 2 * innerFinal.rotation - fwd.rotation};
}

function getOuterFull(frame: number) {
  if (frame < REVERSE_START) return getOuterTransform(Math.min(frame, FORWARD_FRAMES));
  const rf = FORWARD_FRAMES + REVERSE_START - frame;
  const fwd = getOuterTransform(rf);
  return {scale: fwd.scale, rotation: 2 * outerFinal.rotation - fwd.rotation};
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export default makeScene2D(function* (view) {
  createControlPanel();

  view.fill(BACKGROUND);

  const outer = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(outer.group);
  // Outer ends at scaleTo=1.51 so lineWidth scales up with it; compensate so
  // it renders the same apparent stroke width as the inner square.
  const outerLineWidth = STROKE.width / LOGO.outer.scaleTo;
  for (const sf of outer.subFrames) {
    sf.main.lineWidth(outerLineWidth);
    for (const echo of sf.echoes) echo.lineWidth(outerLineWidth);
  }

  const inner = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(inner.group);

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const c = getControls();

    const shader = c.tritone ? TRITONE_SHADER : null;
    for (const sf of outer.subFrames) sf.tritoneWrapper.shaders(shader);
    for (const sf of inner.subFrames) sf.tritoneWrapper.shaders(shader);

    updateBrandShape(outer, frame, FPS, getOuterFull);
    updateBrandShape(inner, frame, FPS, getInnerFull);
    yield;
  }
});
