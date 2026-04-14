#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;

void main() {
    vec4 src = textureLod(sourceTexture, sourceUV, 0.0);

    if (src.a < 0.001) {
      outColor = vec4(0.0);
      return;
    }

    // AE Tritone operates on premultiplied RGB values directly.
    // This is a known AE behavior ("the fundamental alpha flaw") —
    // semi-transparent pixels compute darker luminance than their
    // true color. We match this intentionally for AE compatibility.
    float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));

    // 3-stop linear gradient: shadows(0) → midtones(0.5) → highlights(1)
    vec3 mapped;
    if (lum < 0.5) {
      mapped = mix(u_shadows, u_midtones, lum * 2.0);
    } else {
      mapped = mix(u_midtones, u_highlights, (lum - 0.5) * 2.0);
    }

    // Alpha pass-through (AE Tritone preserves original alpha)
    outColor = vec4(mapped, src.a);
}
