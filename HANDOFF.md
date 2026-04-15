# Motion Brand — AE Echo Effect Recreation

## Goal
Replicate After Effects' Echo + Tritone + Motion Blur effects in Motion Canvas to create a pipeline for generating brand assets with motion.

## Current State: Working
The core pipeline is functional and producing near-accurate results. Easing curves are now exact (cubic bezier from AE export). Tritone shader, echo stacking, and motion blur (additive `lighter` blending) are all working. Remaining differences from AE are minor — mostly from linear interpolation at fractional echo times vs AE's bezier interpolation.

## Architecture
```
src/
  project.ts              — experimentalFeatures: true, controls plugin
  project.meta            — 1080x1080, 30fps, ffmpeg MP4 exporter
  presets/
    brand.ts              — ★ REUSABLE: colors, tritone, stroke, easing, timing
    brand-echo.ts         — echo shape builder + shaders
  scenes/
    echo.tsx              — two-square logo animation
  shaders/
    tritone.glsl          — WebGL Tritone (luminance → 3-stop color)
    alpha-correct.glsl    — alpha stacking correction (unused currently)
  controls.ts             — floating UI panel (Tritone/Blur toggles)
  scripts/
    capture-frame.ts      — Playwright script to capture frames for comparison
vite.config.ts            — @motion-canvas/vite-plugin + @motion-canvas/ffmpeg
```

## Brand Visual System (`brand.ts`)
All values needed to recreate the brand look in any animation:

### Colors
```
background: '#FFFEF4'    — near-white, warm
accent:     '#FE3C01'    — red-orange
dark:       '#241E20'    — dark brown-black
black:      '#000000'    — pre-Tritone stroke color
```

### Tritone (post-process shader)
Maps composited greyscale luminance through a 3-stop gradient:
- Luminance 0.0 → shadows (#241E20)
- Luminance 0.5 → midtones (#FE3C01)
- Luminance 1.0 → highlights (#FFFEF4)

Operates on premultiplied RGB (matching AE's behavior). Applied per sub-frame via a wrapper node INSIDE each blur container. See rendering pipeline below.

### Stroke
- Width: **2px** (AE says 4 but 2 looks correct at 1080p)
- Color: pure black (pre-Tritone)

### Easing — Exact Cubic Bezier from AE
Exported via AE addon. Verified to 0.0% error against 13 sampled AE data points.

```typescript
cubicBezier(x1, y1, x2, y2, t) // Newton's method solver

EASING.inner = [0.89, 0, 0.11, 1]  // sharp S-curve (both scale + rotation)
EASING.outer = [0.2, 0, 0.11, 1]   // fast attack, long settle
```

The generalized sigmoid `t^a/(t^a+(1-t)^b)` was tried extensively but couldn't match AE's bezier curves (3%+ RMS error). The cubic bezier matches exactly.

### Echo Effect
- Echo time: -0.002s (50 echoes × 0.002s = 3 frames of trail at 30fps)
- Count: 50, Decay: 0.93 (oldest echo at 0.93^50 ≈ 2.5% opacity)

### Motion Blur
- Shutter angle: 180°, phase: -90° (centered on frame)
- 16 sub-frame samples

### Logo Animation Timing
```
Inner square: frames 11→40 (scale 0→100%), frames 11→51 (rotation 0→90°)
  + 180° constant rotation from null parent → settles at 270° (axis-aligned)
  Easing: cubic-bezier(0.89, 0, 0.11, 1)

Outer square: frames 27→56 (scale 0→151%), frames 27→67 (rotation 0→45°)
  Easing: cubic-bezier(0.2, 0, 0.11, 1)
  Note: AE has scaleFrom=52%, but we use 0 to keep it hidden until animation starts
```

## Rendering Pipeline

### Per shape, the node tree is:
```
Group (cache: true)                    ← additive sub-frames composite here
  ├─ Container 0 (opacity: 1/N, compositeOperation: 'lighter')
  │   └─ TritoneWrapper (shaders: tritone.glsl)
  │       ├─ Main Rect (white fill + black stroke)
  │       ├─ Echo 49 (newest, opacity: 0.93)    ← just above main
  │       ├─ Echo 48 (opacity: 0.865)
  │       ├─ ...
  │       └─ Echo 0 (oldest, opacity: 0.025)    ← on top
  ├─ Container 1 ...
  └─ Container 15 ...
```

### Why this structure:
1. **Echoes render greyscale** (white fill + black stroke at decay opacity)
2. **Main at bottom, echoes on top** — main's fill is visible; echo strokes trail behind
3. **TritoneWrapper** applies the Tritone shader to each sub-frame's echo stack BEFORE blur averaging (matching AE's order: Echo → Tritone → Motion Blur)
4. **Container** uses `compositeOperation: 'lighter'` (additive) at `1/N` opacity for true averaging — fixes the alpha stacking problem where `1-(1-1/N)^N ≈ 0.63`
5. **Group** has `cache: true` so containers composite into an isolated buffer (not directly onto the scene's white background, which would break additive blending)
6. **Shader and compositeOperation on SEPARATE nodes** — having both on the same node causes blank rendering in Motion Canvas

### When motion blur is OFF (samples=1):
- Single container at opacity 1.0, source-over compositing
- TritoneWrapper still applies the shader
- No additive blending needed

## What Worked

1. **Cubic bezier easing from AE export** — perfect 0% error match to all sampled data points. The generalized sigmoid couldn't do this.
2. **Post-process Tritone shader** — per-echo coloring accumulated to wrong colors (orange instead of dark). The WebGL shader on composited greyscale matches AE.
3. **Additive (`lighter`) blur averaging** — solves the alpha stacking problem. Each sub-frame contributes exactly 1/N. Requires `cache: true` on the parent group.
4. **Per-sub-frame Tritone via wrapper node** — matches AE's pipeline order (Tritone before blur). Shader on wrapper, compositeOperation on container (different nodes).
5. **Pure white (#ffffff) fills in greyscale stage** — using the background color (#FFFEF4) caused yellow artifacts from 8-bit quantization in additive blending (B channel rounds differently at 1/16 per step).
6. **Tritone on premultiplied values** — matches AE's known behavior. No unpremultiply.

## What Didn't Work

1. **Per-echo Tritone coloring** — colors accumulate to orange when stacked, not dark. Tritone must be post-process on accumulated luminance.
2. **Generalized sigmoid easing** — 3%+ RMS error vs AE bezier. Close but not close enough — causes visible timing/speed differences that affect echo spacing and blur intensity.
3. **Alpha blending for blur averaging** — `1-(1-1/N)^N ≈ 0.63`, never reaches 100%. Makes everything washed out.
4. **Opacity boost to compensate** — over-darkens blur edges (too much contribution from partially-covered pixels).
5. **Alpha correction shader on group** — dividing by maxAlpha causes per-channel clamping at 1.0 → yellow color shift.
6. **Shader + compositeOperation on same node** — produces blank output in Motion Canvas. Must be on separate nodes.
7. **`compositeOperation: 'lighter'` without `cache: true` on parent** — containers composite directly onto the scene canvas (white background), additive of anything onto white = still white = blank.
8. **`Color.lerp`** — interpolates in HSL, producing yellow. Use explicit RGB lerp.
9. **`#include` in inline GLSL** — must use separate `.glsl` files imported as modules.
10. **Unpremultiplying in shader** — per-channel `src.rgb / src.a` produces cyan at anti-aliased edges. Scalar `premulLum / src.a` is safer but still unnecessary since AE operates on premultiplied values.

## Reference Files
- `~/vibe/chat/test.mp4` — full effects
- `~/vibe/chat/test-no-blur.mp4` — Echo + Tritone, no blur
- `~/vibe/chat/test-only-echo-no-blur.mp4` — Echo only (greyscale)
- `~/vibe/motion-brand/test-blur.mp4` — Echo + blur, no Tritone
- Extracted frames: `reference-frames/`, `reference-no-blur/`, `reference-echo-only/`, `reference-blur/`, `reference-clean/`

## AE Keyframe Export (raw)
From AE addon, comp duration 6s at 30fps. Times as fractions of duration.
```json
{
  "square2Scale": [[0.06111, 0, bezier(0.89,0,0.11,1)], [0.22222, 100]],
  "square2Rotation": [[0.06111, 0, bezier(0.89,0,0.11,1)], [0.28333, 90]],
  "middleScale": [[0.15, 52, bezier(0.2,0,0.11,1)], [0.31111, 151]],
  "middleRotation": [[0.15, 0, bezier(0.2,0,0.11,1)], [0.37222, 45]]
}
```

## Dev Setup
```bash
npm start          # dev server + editor (vite, port 9001)
npm run build      # production build
npm run render     # headless render → output/project.mp4

# Render and copy output:
npm run render -- --output ~/Desktop/animation.mp4

# Capture a single frame for comparison:
npx tsx scripts/capture-frame.ts 30 output/frame.png --blur --tritone
```

## Controls
Tritone and Motion Blur are always on (hardcoded in `controls.ts`). The floating toggle panel was removed — effects are integral to the brand look.

## Headless Rendering (`scripts/render.ts`)
Playwright-based headless renderer that produces MP4 via Motion Canvas's `?render` URL parameter + ffmpeg exporter.

### How it works
1. Checks if Vite dev server is running on port 9001; starts one if not
2. Launches headless Chromium with `--use-gl=angle` (WebGL for Tritone shader)
3. Navigates to `http://localhost:9001?render` — this triggers Motion Canvas's built-in render pipeline
4. Watches `output/project.mp4` for completion (file size stable for 2s)
5. Kills spawned server, closes browser

### CLI options
- `--output <path>` — copy the rendered MP4 to this location
- `--port <N>` — dev server port (default: 9001)
- `--no-server` — don't auto-start the dev server (use an already-running one)

### Key constraints
- **WebGL required** — Tritone shader needs GPU context (headless Chrome handles this)
- **Dev server required** — `@motion-canvas/ffmpeg` pipes frames via WebSocket to the Vite dev server
- **Shaders need `experimentalFeatures: true`** — already set in `project.ts`

## Claude Skill
A Claude skill at `~/.claude/skills/brand-animation/` lets users describe animations in natural language. Claude writes the Motion Canvas scene, registers it in `project.ts`, and renders to MP4. See the skill's `SKILL.md` for the full workflow and API reference.

## Other Remaining Work
1. **Fine-tune outer square timing** — scaleFrom is 0 (hidden) but AE has it at 52% from frame 0. May need creative solution to match AE's echo trail timing while keeping it hidden initially.
2. **Denser easing at sub-frame level** — cubic bezier is exact at integer frames, but echo positions at fractional frames use linear interpolation. AE uses bezier at every fractional time.
3. **Performance** — 16 sub-frames × 51 rects × 2 shapes × shader passes = heavy. Could lazy-create sub-frames only when blur is on.
