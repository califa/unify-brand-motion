/**
 * Brand Visual System
 *
 * Core visual constants and timing for the brand identity.
 * Reuse these across all animations and elements.
 */

// ─── Colors ──────────────────────────────────────────────────
export const COLORS = {
  /** Near-white background / highlights — #FFFFFA */
  background: '#FFFFFA',
  /** Red-orange midtone accent — #FE3C01 */
  accent: '#FE3C01',
  /** Dark brown-black shadows — #241E20 */
  dark: '#241E20',
  /** Pure black for strokes pre-Tritone */
  black: '#000000',
} as const;

// ─── Tritone Color Mapping ───────────────────────────────────
// Applied as a post-process shader on composited greyscale.
// Maps luminance: 0 → shadows, 0.5 → midtones, 1.0 → highlights
export const TRITONE = {
  highlights: COLORS.background,
  midtones: COLORS.accent,
  shadows: COLORS.dark,
} as const;

// ─── Stroke ──────────────────────────────────────────────────
export const STROKE = {
  color: COLORS.black,
  width: 2,
} as const;

// ─── Canvas ──────────────────────────────────────────────────
export const CANVAS = {
  width: 1080,
  height: 1080,
  fps: 30,
} as const;

// ─── Echo Effect ─────────────────────────────────────────────
// Creates trailing copies at past time positions.
// 50 echoes × 0.002s = 0.1s total trail span ≈ 3 frames at 30fps.
export const ECHO = {
  /** Seconds between each echo copy (negative = look back in time) */
  time: -0.002,
  /** Number of echo copies */
  count: 50,
  /** Starting opacity for the newest echo */
  startingIntensity: 1.0,
  /** Opacity multiplier per echo step (0.93^50 ≈ 0.025 for oldest) */
  decay: 0.93,
} as const;

// ─── Motion Blur ─────────────────────────────────────────────
export const MOTION_BLUR = {
  /** Shutter angle in degrees (180° = half-frame exposure) */
  shutterAngle: 180,
  /** Shutter phase in degrees (-90° = centered on frame) */
  shutterPhase: -90,
  /** Number of sub-frame samples for blur averaging (16 = smooth motion blur). */
  samples: 16 as number,
} as const;

// ─── Easing ──────────────────────────────────────────────────
// Exact cubic bezier curves exported from AE.

/**
 * Evaluate a CSS cubic-bezier timing function.
 * Given t in [0,1], returns the eased value in [0,1].
 * Uses Newton's method to invert the x-coordinate.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Find parameter u where B_x(u) = t using Newton's method
  let u = t; // initial guess
  for (let i = 0; i < 10; i++) {
    const u2 = u * u;
    const u3 = u2 * u;
    const _1u = 1 - u;
    const _1u2 = _1u * _1u;

    // B_x(u) = 3(1-u)²u·x1 + 3(1-u)u²·x2 + u³
    const bx = 3 * _1u2 * u * x1 + 3 * _1u * u2 * x2 + u3;
    // B_x'(u) derivative
    const dbx = 3 * _1u2 * x1 + 6 * _1u * u * (x2 - x1) + 3 * u2 * (1 - x2);

    if (Math.abs(dbx) < 1e-10) break;
    u -= (bx - t) / dbx;
    u = Math.max(0, Math.min(1, u));
  }

  // Compute B_y(u)
  const _1u = 1 - u;
  return 3 * _1u * _1u * u * y1 + 3 * _1u * u * u * y2 + u * u * u;
}

// AE bezier curves (exported via addon)
export const EASING = {
  /** Inner square: cubic-bezier(0.89, 0, 0.11, 1) — sharp S-curve */
  inner: [0.89, 0, 0.11, 1] as readonly [number, number, number, number],
  /** Outer square: cubic-bezier(0.2, 0, 0.11, 1) — fast attack, long settle */
  outer: [0.2, 0, 0.11, 1] as readonly [number, number, number, number],
} as const;

// ─── Render mode ─────────────────────────────────────────────
function isTransparentRender(): boolean {
  try {
    return typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('transparent');
  } catch { return false; }
}

export const RENDER_BG   = COLORS.background;
export const RENDER_FILL = '#ffffff';

export function getRenderBg(): string {
  return isTransparentRender() ? 'rgba(0,0,0,0)' : COLORS.background;
}

// ─── Logo Animation Timing ───────────────────────────────────
// Two-square logo: inner square scales up + rotates, outer square follows.
export const LOGO = {
  rectSize: 498,
  duration: 4,

  inner: {
    animStart: 11,
    scaleEnd: 40,
    rotEnd: 51,
    nullRotation: 180,
    scaleFrom: 0,
    scaleTo: 1,
    rotFrom: 0,
    rotTo: 90,
  },

  outer: {
    animStart: 28,
    scaleEnd: 56,
    rotEnd: 67,
    scaleFrom: 0,
    scaleTo: 1.51,       // ends at 151%
    rotFrom: 0,
    rotTo: 45,
  },
} as const;
