/**
 * Brand Echo Preset — v6
 *
 * All echo/blur/tritone parameters from brand.ts.
 * Tritone and motion blur toggleable via controls panel.
 */

import {Node, Rect} from '@motion-canvas/2d';
import tritoneShader from '../shaders/tritone.glsl';
import alphaCorrectShader from '../shaders/alpha-correct.glsl';
import {COLORS, TRITONE, STROKE, ECHO, MOTION_BLUR, RENDER_BG, RENDER_FILL, getRenderBg} from './brand';
import {getControls} from '../controls';

export {COLORS, RENDER_FILL} from './brand';
export const BACKGROUND = RENDER_BG;

export function applyBackground(view: any) {
  view.fill(getRenderBg());
}

// ─── Tritone Shader ──────────────────────────────────────────

function hexToVec3(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export const TRITONE_SHADER = {
  fragment: tritoneShader,
  uniforms: {
    u_shadows: hexToVec3(TRITONE.shadows),
    u_midtones: hexToVec3(TRITONE.midtones),
    u_highlights: hexToVec3(TRITONE.highlights),
  },
};

// ─── Brand Shape ─────────────────────────────────────────────

const MAX_SAMPLES = 16;  // AE uses 16 base samples
const MAX_ECHOES = 50;   // matches ECHO.count

// Alpha correction: 1-(1-1/N)^N ≈ 0.644 for N=16.
const maxAlpha = 1.0 - Math.pow(1.0 - 1.0 / MAX_SAMPLES, MAX_SAMPLES);
export const ALPHA_CORRECT_SHADER = {
  fragment: alphaCorrectShader,
  uniforms: {
    u_scale: 1.0 / maxAlpha,
  },
};

export interface BrandShape {
  group: Node;
  subFrames: {
    container: Node;
    tritoneWrapper: Node;
    main: Rect;
    echoes: Rect[];
  }[];
}

export function createBrandShape(
  width: number,
  height: number,
): BrandShape {
  const group = new Node({cache: true});
  const subFrames: BrandShape['subFrames'] = [];

  for (let s = 0; s < MAX_SAMPLES; s++) {
    // Container: lighter + opacity for additive blur averaging
    const container = new Node({opacity: 0});
    group.add(container);

    // Tritone wrapper: shader applied here, BEFORE container composites to group
    const tritoneWrapper = new Node({});
    container.add(tritoneWrapper);

    const main = new Rect({
      width,
      height,
      fill: RENDER_FILL,
      stroke: STROKE.color,
      lineWidth: STROKE.width,
    });
    tritoneWrapper.add(main);

    const echoes: Rect[] = [];
    for (let i = MAX_ECHOES - 1; i >= 0; i--) {
      const rect = new Rect({
        width,
        height,
        fill: RENDER_FILL,
        stroke: STROKE.color,
        lineWidth: STROKE.width,
        opacity: echoIntensities[i],
      });
      tritoneWrapper.add(rect);
      echoes[i] = rect;
    }

    subFrames.push({container, tritoneWrapper, main, echoes});
  }

  return {group, subFrames};
}

// Pre-compute echo intensities (constant across frames)
const echoIntensities = Array.from({length: MAX_ECHOES}, (_, i) =>
  Math.pow(ECHO.decay, MAX_ECHOES - i),
);

export function updateBrandShape(
  shape: BrandShape,
  frame: number,
  fps: number,
  getTransform: (frame: number) => {scale: number; rotation: number},
): void {
  const c = getControls();
  const numSamples = c.motionBlur ? MOTION_BLUR.samples : 1;
  const echoFrameStep = ECHO.time * fps;
  const shutterFraction = MOTION_BLUR.shutterAngle / 360;
  const phaseOffset = MOTION_BLUR.shutterPhase / 360;

  for (let s = 0; s < MAX_SAMPLES; s++) {
    const sf = shape.subFrames[s];

    if (s >= numSamples) {
      sf.container.opacity(0);
      continue;
    }

    sf.container.opacity(1 / numSamples);
    sf.container.compositeOperation(numSamples > 1 ? 'lighter' : 'source-over');

    const sampleT = numSamples === 1 ? 0.5 : s / (numSamples - 1);
    const subFrame = frame + phaseOffset + sampleT * shutterFraction;
    const subTransform = getTransform(subFrame);

    sf.main.scale(subTransform.scale);
    sf.main.rotation(subTransform.rotation);

    for (let i = 0; i < MAX_ECHOES; i++) {
      const echoIndex = MAX_ECHOES - i;
      const echoFrame = subFrame + echoIndex * echoFrameStep;
      const t = getTransform(echoFrame);
      sf.echoes[i].scale(t.scale);
      sf.echoes[i].rotation(t.rotation);
    }
  }
}
