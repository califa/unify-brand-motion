import {makeScene2D} from '@motion-canvas/2d';
import {
  BACKGROUND,
  createBrandShape,
  updateBrandShape,
  TRITONE_SHADER,
  ALPHA_CORRECT_SHADER,
} from '../presets/brand-echo';
import {LOGO, CANVAS, EASING, cubicBezier} from '../presets/brand';
import {createControlPanel, getControls} from '../controls';

const FPS = CANVAS.fps;
const DURATION = LOGO.duration;
const TOTAL_FRAMES = DURATION * FPS;
const RECT_SIZE = LOGO.rectSize;

function applyEase(t: number, bezier: readonly [number, number, number, number]): number {
  return cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], t);
}

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

export default makeScene2D(function* (view) {
  createControlPanel();

  view.fill(BACKGROUND);

  const outer = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(outer.group);

  const inner = createBrandShape(RECT_SIZE, RECT_SIZE);
  view.add(inner.group);

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const c = getControls();

    // Tritone per sub-frame via wrapper node (before blur averaging).
    // Wrapper has shader, container has lighter — on separate nodes.
    const shader = c.tritone ? TRITONE_SHADER : null;
    for (const sf of outer.subFrames) sf.tritoneWrapper.shaders(shader);
    for (const sf of inner.subFrames) sf.tritoneWrapper.shaders(shader);

    updateBrandShape(outer, frame, FPS, getOuterTransform);
    updateBrandShape(inner, frame, FPS, getInnerTransform);
    yield;
  }
});
