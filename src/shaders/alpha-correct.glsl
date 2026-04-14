#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float u_scale;

void main() {
    vec4 src = textureLod(sourceTexture, sourceUV, 0.0);

    if (src.a < 0.001) {
      outColor = vec4(0.0);
      return;
    }

    // Correct alpha first, clamped to 1.0
    float correctedAlpha = min(src.a * u_scale, 1.0);
    // Scale RGB by the same ratio as alpha — avoids per-channel clamping
    // that shifts hue (e.g. R and G clamp to 1.0 but B doesn't → yellow)
    float rgbScale = correctedAlpha / src.a;
    outColor = vec4(src.rgb * rgbScale, correctedAlpha);
}
