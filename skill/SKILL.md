---
name: brand-animation
description: |
  Generate brand animations with Echo + Tritone + Motion Blur effects using Motion Canvas.
  Accepts natural language descriptions of abstract shape animations, writes the scene code,
  and renders to MP4/WebM/GIF/MOV.
  **Triggers:** "brand animation", "render brand", "logo animation", "motion brand",
  "brand video", "brand effect", "brand motion", "motion asset",
  "unify animation", "unify effect", "unify motion"
  Use this skill whenever someone wants to create any kind of motion graphic, video asset,
  animated logo, loading animation, or visual effect for the Unify brand — even if they
  don't say "brand animation" explicitly. If the request involves shapes moving with trails
  or echoes, or any video/GIF output of geometric animation, this is the right skill.
---

# Brand Animation Generator

User describes an animation → you write a Motion Canvas scene → render to video.

## Before You Write Any Code

The echo trail and motion blur are the visual signature of this system. They work best as **punctuation on decisive movements**, not constant motion. Internalize these principles — they should shape every scene you write:

- **Animate in → hold → animate out.** Most frames should be at rest. A 4-second clip: ~20 frames animating in, ~80 static, ~20 animating out.
- **Scale from 0 to appear.** Objects should arrive, not fade in. Start at `scale: 0`, snap up with a fast easing curve.
- **One shape moves at a time.** Simultaneous motion dilutes the trails into noise. Stagger entrances.
- **Avoid continuous motion** (perpetual spin, orbiting). If it must loop, use discrete snaps separated by stillness.

The orange trail is an exclamation mark. Use it sparingly.

## Find the Repo

```bash
# Run this first — all subsequent commands use $MB as the working directory
MB=""; for d in ~/vibe/motion-brand ~/motion-brand /tmp/motion-brand; do [ -f "$d/package.json" ] && MB="$d" && break; done
if [ -z "$MB" ]; then bash <(curl -fsSL https://raw.githubusercontent.com/califa/unify-brand-motion/main/scripts/setup.sh); MB="${MOTION_BRAND_DIR:-$HOME/vibe/motion-brand}"; fi
```

If setup runs, warn the user it may take a few minutes (installs Homebrew, Node, ffmpeg, Chromium).

**Important:** `cd` doesn't persist between bash calls in Claude Code. Always prefix commands with `cd "$MB" &&` or use absolute paths.

## Workflow

### Step 1: Choose the right pattern

Match the user's request to a code pattern:

| User wants... | Pattern | Reference |
|---------------|---------|-----------|
| Shape(s) that scale/rotate in place | `createBrandShape` + `updateBrandShape` | Inline template below |
| Shape(s) that move across the canvas | `createBrandShape` + `updateWithPosition` (copy from `references/brand-api.md`) | "updateWithPosition" section |
| Shape at a fixed position, animates scale/rotation | `createBrandShape` + `group.position()` + `updateBrandShape` | "Static group placement" in `references/brand-api.md` |
| SVG logo or custom path shape | Custom `createPathShape` + `updatePathShape` (copy from `references/brand-api.md`) | "Animating SVG Paths" section |
| Circle | `createBrandShape(d, d)` then set `radius(d/2)` on main + echoes | "Making a circle" in `references/brand-api.md` |

Only read the reference files when you need the advanced patterns (position animation, SVG paths, circles). The inline template below is sufficient for simple scale+rotation animations.

**Limits:** ≤8 shapes with `updateWithPosition` (816 Rect nodes each — more exhausts WebGL). `updateBrandShape` scenes can use more.

### Step 2: Write the scene

Create `$MB/animations/<name>.tsx`:

```tsx
import {makeScene2D} from '@motion-canvas/2d';
import {createBrandShape, updateBrandShape, TRITONE_SHADER, applyBackground} from '@brand/presets/brand-echo';
import {CANVAS, cubicBezier} from '@brand/presets/brand';

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
  applyBackground(view);

  const shape = createBrandShape(500, 500);
  view.add(shape.group);
  for (const sf of shape.subFrames) sf.tritoneWrapper.shaders(TRITONE_SHADER);

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    updateBrandShape(shape, frame, FPS, getTransform);
    yield;
  }
});
```

**Rules:**
- `applyBackground(view)` — supports `--transparent` mode. Never use `view.fill(BACKGROUND)` directly.
- Each shape needs its own `createBrandShape(width, height)`.
- Transform functions receive fractional frame numbers → return `{scale, rotation}`.
- `scale: 0` hides the shape. Use this before the animation starts.
- `yield` advances one frame. The loop must run exactly `TOTAL_FRAMES` iterations.
- Apply `TRITONE_SHADER` to all sub-frames before the frame loop.
- Easing: `cubicBezier(0.89, 0, 0.11, 1, t)` (sharp S-curve) or `cubicBezier(0.2, 0, 0.11, 1, t)` (fast attack).

**Layer transforms for richer motion.** A shape sliding from A to B is more compelling when rotation and scale change simultaneously:
- **Slide + spin**: rotate 45–90° during the position move.
- **Slide + scale punch**: scale to 0.85× during travel, snap back to 1.0 on arrival.
- **Scale in from 0**: shape materializes at its destination.

### Step 3: Register the scene

```bash
cd "$MB" && cat > src/project.ts << 'EOF'
import {makeProject} from '@motion-canvas/core';
import scene from '../animations/<name>?scene';
import {setPlayer} from './controls';

export default makeProject({
  scenes: [scene],
  experimentalFeatures: true,
  plugins: [{
    name: 'echo-controls',
    player(player) { setPlayer(player); },
  }],
});
EOF
```

Replace `<name>` with your scene filename (without `.tsx`). The `?scene` suffix is required.

### Step 4: Render

```bash
cd "$MB" && npm run render -- --output ~/Desktop/animation.mp4
```

| Format | Command | Notes |
|--------|---------|-------|
| MP4 (default) | `npm run render` | CRF 32 optimized, no alpha |
| WebM + transparency | `npm run render -- --format webm --transparent` | VP9, alpha channel |
| GIF | `npm run render -- --format gif` | Two-pass palette |
| GIF + transparency | `npm run render -- --format gif --transparent` | 1-bit alpha |
| ProRes MOV | `npm run render -- --format mov` | Lossless, full alpha |

In Cowork, render to `$OUTPUTS_DIR` instead of Desktop:
```bash
cd "$MB" && npm run render -- --output "$OUTPUTS_DIR/animation.mp4"
```

### Step 5: When the render fails

The render script validates TypeScript and runs preflight checks automatically. If it still fails:

1. **Read the error output.** Lines prefixed `[browser:error]` or `[browser:warning]` are from the scene running in headless Chrome.
2. **Fix the scene.** Common causes: wrong import path, missing `?scene` suffix, too many shapes, typo in transform function.
3. **Re-render.** The script cleans up automatically — just run the render command again.
4. **If it's an environment issue** (missing Chromium, port conflict), run `cd "$MB" && npm run render -- --preflight` to diagnose.

See the troubleshooting table below for specific error messages.

## Output Formats

| Format | Extension | Alpha | Use case |
|--------|-----------|-------|----------|
| MP4    | `.mp4`    | No    | Default. Web, Slack, presentations. CRF 32 optimized. |
| WebM   | `.webm`   | Yes   | Transparent background overlays. Use with `--transparent`. |
| GIF    | `.gif`    | Yes*  | Inline previews, docs. 1-bit alpha with `--transparent`. |
| MOV    | `.mov`    | Yes   | Lossless ProRes 4444. Editing/compositing. |

`--transparent` has no effect with MP4 (no alpha channel). The render script warns.

## Customizing the Brand System

Edit `src/presets/brand.ts`:

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

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank/white output | Too many shapes with `updateWithPosition` (>8) | Reduce to ≤8 shapes, or use `updateBrandShape` |
| Render never starts | Port 9001 occupied | Kill the other process or use `--port 9002` |
| Shader errors in console | Missing `experimentalFeatures: true` | Check project.ts |
| "Render did not start" | Scene runtime error | Fix the `[browser:error]` lines, re-render |
| TypeScript errors | Scene has type errors | Fix them — tsc runs before render to catch these fast |
| "Another render in progress" | Stale lockfile | Delete `output/.render.lock` if no render is running |
| Transparent mode didn't work | Scene uses `view.fill(BACKGROUND)` | Replace with `applyBackground(view)` |
| Output tiny/corrupt | ffmpeg conversion failed | Check stderr; verify intermediate .mov exists |
| `.meta` file errors | Stale metadata | Delete `animations/<name>.meta` and re-render |

### Preflight check

```bash
cd "$MB" && npm run render -- --preflight
```

Verifies: node_modules, Chromium, ffmpeg, patch, scene import, animations/ dir, no stale transparent patch.

## Architecture

For deep context on the rendering pipeline (echo stacking, tritone shader, additive blur), read `HANDOFF.md` in the repo root.
