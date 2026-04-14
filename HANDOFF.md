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
npm start          # dev server (vite, port 9000/9001)
npm run build      # production build

# Capture a frame for comparison:
npx tsx scripts/capture-frame.ts 30 output/frame.png --blur --tritone
```

## Controls
Floating panel in the editor (top-right corner):
- **Tritone** checkbox — toggles the color shader
- **Motion Blur** checkbox — toggles 16-sample additive blur

The `setPlayer()` plugin in `project.ts` gives the controls access to `player.requestSeek()` for live updates when toggling.

## Next Task: Headless Rendering Workflow

### Goal
Render the brand echo effect programmatically without the Motion Canvas editor UI — via CLI or API. This enables:
- CI/CD pipeline rendering (generate assets on push)
- Batch rendering with different parameters (colors, timing, shapes)
- Integration into other tools/services

### What exists already

**Playwright-based frame capture** (`scripts/capture-frame.ts`):
- Launches headless Chromium, loads the Motion Canvas editor at `localhost:9001`
- Toggles Tritone/Blur via the control panel checkboxes
- Seeks to a specific frame via `window.__echoPlayer.requestSeek(frame)`
- Extracts the canvas at source resolution (1080x1080) via `canvas.toDataURL()`
- Usage: `npx tsx scripts/capture-frame.ts 30 output/frame.png --blur --tritone`
- Requires the dev server running (`npm start`)

**Motion Canvas Renderer API** (`@motion-canvas/core` Renderer class):
- `render(settings)` — renders all frames with an exporter (ffmpeg or image sequence)
- `renderFrame(settings, time)` — renders a single frame
- The Renderer is used by the editor's "Render" button internally
- Requires a browser context (canvas + WebGL for shaders)

**ffmpeg plugin** already configured in `vite.config.ts` and `project.meta` (exporter set to `@motion-canvas/ffmpeg` with `fastStart: true`).

**Player plugin** in `project.ts` stores the player on `window.__echoPlayer` for external access.

### Possible approaches

1. **Playwright automation (extend existing script)**
   - Already working for single frames
   - Extend to render all frames as PNG sequence, then ffmpeg to MP4
   - Pros: no new dependencies, uses the exact same rendering path as the editor
   - Cons: slow (browser overhead per frame), needs dev server running

2. **Motion Canvas CLI rendering**
   - Motion Canvas may support headless rendering via its Renderer + Exporter APIs
   - Would need to programmatically create a Player/Renderer without the editor UI
   - The challenge: Motion Canvas rendering requires a real canvas + WebGL context (for the Tritone shader), so it can't be purely Node.js — needs a browser or headless GPU context
   - Could use Playwright to load a minimal page that creates the project and calls `renderer.render()` directly

3. **Custom headless runner**
   - Create a minimal HTML page (no editor UI) that imports the project, creates a Player + Renderer, and triggers rendering
   - Serve it via Vite, load in Playwright, wait for render to complete
   - The ffmpeg exporter communicates with the Vite dev server via WebSocket to pipe frames to ffmpeg — this architecture requires the dev server

4. **Parameterized rendering**
   - Extend `brand.ts` / scene to accept parameters (colors, timing, shape) via URL params or project variables
   - The headless script passes different params per render job
   - Could generate a family of brand assets (different color schemes, different shapes, etc.)

### Key constraints
- **WebGL required** — the Tritone shader is a WebGL fragment shader applied via Motion Canvas's experimental `shaders` property. Any headless solution needs a GPU-capable context (headless Chrome with `--use-gl=angle` or similar).
- **Dev server required for ffmpeg export** — `@motion-canvas/ffmpeg` uses a WebSocket connection to the Vite dev server to pipe frame data to the ffmpeg process. The ffmpeg binary runs server-side, not in the browser.
- **Shaders need `experimentalFeatures: true`** — already set in `project.ts`.

### Recommended first step
Extend the Playwright script to do a full render:
1. Load the editor headlessly
2. Toggle controls as needed
3. Click the editor's "Render" button programmatically (or call `renderer.render()` via `page.evaluate`)
4. Wait for the ffmpeg export to complete
5. The output MP4 appears in the project's `output/` directory

This piggybacks on Motion Canvas's existing render pipeline and ffmpeg integration without reinventing anything.

## Other Remaining Work
1. **Fine-tune outer square timing** — scaleFrom is 0 (hidden) but AE has it at 52% from frame 0. May need creative solution to match AE's echo trail timing while keeping it hidden initially.
2. **Denser easing at sub-frame level** — cubic bezier is exact at integer frames, but echo positions at fractional frames use linear interpolation. AE uses bezier at every fractional time.
3. **Performance** — 16 sub-frames × 51 rects × 2 shapes × shader passes = heavy. Could lazy-create sub-frames only when blur is on.
