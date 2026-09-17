// Created by Gemini 3.8 Flash
/**
 * GLSL Shader Sources for kUInetic Advanced Modules
 */

export const QUAD_VS = `#version 300 es
in vec2 a_position;
uniform vec2 u_uvOrigin;
uniform vec2 u_uvScale;
out vec2 v_uv;
void main() {
  vec2 uv = (a_position + 1.0) * 0.5;
  uv.y = 1.0 - uv.y;
  v_uv = u_uvOrigin + uv * u_uvScale;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const FULLSCREEN_QUAD_VS = QUAD_VS

export const DISPLACE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_strength;
uniform float u_frequency;
uniform float u_chromatic;
uniform vec2 u_mouse;
uniform vec4 u_tint;
uniform int u_blend;
uniform float u_duotone;
uniform vec4 u_color1;
uniform vec4 u_color2;
uniform float u_progress;

vec4 applyBlend(vec4 base, vec4 tint, int mode) {
  if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - tint);
  if (mode == 2) return base * tint;
  if (mode == 3) return min(base + tint, vec4(1.0));
  return base * tint;
}

void main() {
  vec2 m = u_mouse;
  float d = distance(v_uv, m);
  float ripple = sin(d * u_frequency - u_time * 3.0) * exp(-d * 4.0);
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  vec2 disp = normalize(v_uv - m + 0.0001) * ripple * u_strength * 0.05 * pFactor;

  float cr = texture(u_image, v_uv + disp * (1.0 + u_chromatic)).r;
  float cg = texture(u_image, v_uv + disp).g;
  float cb = texture(u_image, v_uv + disp * (1.0 - u_chromatic)).b;
  float ca = texture(u_image, v_uv + disp).a;
  vec4 color = vec4(cr, cg, cb, ca);

  if (u_duotone > 0.5) {
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(u_color1.rgb, u_color2.rgb, lum);
  }

  fragColor = applyBlend(color, u_tint, u_blend);
}
`

export const FLUID_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_strength;
uniform vec2 u_mouse;
uniform vec4 u_tint;
uniform float u_progress;

void main() {
  vec2 uv = v_uv;
  vec2 m = u_mouse;
  float d = distance(uv, m);
  float force = exp(-d * 6.0) * u_strength;
  vec2 flow = vec2(sin(u_time + uv.y * 10.0), cos(u_time + uv.x * 10.0)) * 0.02;
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  vec2 offset = (flow + (uv - m) * force * 0.1) * pFactor;
  fragColor = texture(u_image, uv + offset) * u_tint;
}
`

export const LIQUID_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_strength;
uniform vec4 u_tint;
uniform float u_progress;

void main() {
  vec2 uv = v_uv;
  float w1 = sin(uv.y * 12.0 + u_time * 2.0) * 0.015;
  float w2 = cos(uv.x * 10.0 - u_time * 1.5) * 0.015;
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  vec2 offset = vec2(w1, w2) * u_strength * pFactor;
  fragColor = texture(u_image, uv + offset) * u_tint;
}
`

export const PARTICLES_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_strength;
uniform vec2 u_mouse;
uniform vec4 u_tint;
uniform float u_progress;

void main() {
  vec2 uv = v_uv;
  vec2 grid = fract(uv * 40.0) - 0.5;
  float dist = length(grid);
  float sparkle = sin(u_time * 5.0 + dot(uv, vec2(100.0))) * 0.5 + 0.5;
  vec4 tex = texture(u_image, uv);
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  float dotMask = smoothstep(0.4, 0.2, dist) * u_strength * pFactor;
  fragColor = mix(tex, tex * u_tint + sparkle * 0.3, dotMask);
}
`

export const MORPH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform sampler2D u_image_to;
uniform float u_time;
uniform float u_strength;
uniform float u_progress;

void main() {
  vec2 uv = v_uv;
  float progress = u_progress >= 0.0 ? clamp(u_progress, 0.0, 1.0) : clamp(u_strength, 0.0, 1.0);
  float noise = sin(uv.x * 20.0 + u_time) * cos(uv.y * 20.0 + u_time) * 0.05;
  vec4 c1 = texture(u_image, uv + vec2(noise * (1.0 - progress)));
  vec4 c2 = texture(u_image_to, uv - vec2(noise * progress));
  fragColor = mix(c1, c2, smoothstep(0.2, 0.8, progress));
}
`
