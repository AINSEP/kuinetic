// Created by Gemini 3.8 Flash
/**
 * GLSL Shader Sources for kUInetic Advanced Modules
 */

/**
 * The audio-reactive term every program below shares.
 *
 * `u_audio` is one band of an `audio-source`'s output (0..1), uploaded every frame — 0 when the
 * author selected no band, which is also what a silent driver reports. Clamped here as well as in
 * JavaScript because the uniform is reachable directly (`uploadUniforms`) and a shader that
 * multiplies by an unbounded number is one bad caller away from a white screen.
 *
 * The term is a *gain on what the program already does*, in 1..2: silence leaves each program
 * exactly where it was (`x * 1.0` is exact in IEEE 754, so audio-off output is bit-identical to
 * the version before this uniform existed) and a full-scale band at most doubles it. That is the
 * whole reason it is a multiplier rather than an additive push — `strength` stays the author's
 * amplitude control, and audio cannot take a scene anywhere `strength: <double>` could not.
 */
const AUDIO_GAIN_GLSL = `uniform float u_audio;
float audioGain() { return 1.0 + clamp(u_audio, 0.0, 1.0); }
`

/**
 * The element's own shape, applied as the last thing every program does.
 *
 * The draw happens on one shared, full-viewport canvas standing in for an element that has been
 * hidden, so the element's rounded corners exist nowhere else: there is no per-element CSS box to
 * carry a `border-radius`, and the scissor box can only ever be a rectangle. This puts the corners
 * back in the fragment shader instead.
 *
 * `u_maskBox` is the element's border box in device pixels — centre in `xy`, half-extents in `zw`
 * — measured in the same space as `gl_FragCoord`, i.e. y up from the bottom of the canvas.
 * `u_maskRx`/`u_maskRy` are the four corner radii in TL, TR, BR, BL order, with x and y kept apart
 * so a percentage radius on a non-square box stays the ellipse CSS draws rather than a circle.
 * `u_maskAlpha` folds in what the ancestors' own `opacity` leaves the element painted at.
 *
 * Multiplying all four channels is correct because the context is `premultipliedAlpha: true` and
 * `createGLTexture` uploads premultiplied data to match. A zero half-extent means "no box measured"
 * and leaves the fragment alone, which is what keeps a caller that never uploads these uniforms
 * (the unit suites' GL doubles, or any external user of `drawElementQuad`) drawing exactly as
 * before.
 */
const SHAPE_MASK_GLSL = `uniform vec4 u_maskBox;
uniform vec4 u_maskRx;
uniform vec4 u_maskRy;
uniform float u_maskAlpha;
float shapeMask() {
  if (u_maskBox.z <= 0.0 || u_maskBox.w <= 0.0) return u_maskAlpha;
  vec2 p = gl_FragCoord.xy - u_maskBox.xy;
  vec2 h = u_maskBox.zw;
  bool left = p.x < 0.0;
  float rx = p.y >= 0.0 ? (left ? u_maskRx.x : u_maskRx.y) : (left ? u_maskRx.w : u_maskRx.z);
  float ry = p.y >= 0.0 ? (left ? u_maskRy.x : u_maskRy.y) : (left ? u_maskRy.w : u_maskRy.z);
  rx = min(rx, h.x);
  ry = min(ry, h.y);
  if (rx <= 0.0 || ry <= 0.0) return u_maskAlpha;
  vec2 q = abs(p) - (h - vec2(rx, ry));
  if (q.x <= 0.0 || q.y <= 0.0) return u_maskAlpha;
  float d = (length(q / vec2(rx, ry)) - 1.0) * min(rx, ry);
  return u_maskAlpha * clamp(0.5 - d, 0.0, 1.0);
}
`

export const FULLSCREEN_QUAD_VS = `#version 300 es
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}
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
  // Audio widens the ripple's throw (up to 2x), leaving its shape and speed alone.
  vec2 disp = normalize(v_uv - m + 0.0001) * ripple * u_strength * 0.05 * pFactor * audioGain();

  float cr = texture(u_image, v_uv + disp * (1.0 + u_chromatic)).r;
  float cg = texture(u_image, v_uv + disp).g;
  float cb = texture(u_image, v_uv + disp * (1.0 - u_chromatic)).b;
  float ca = texture(u_image, v_uv + disp).a;
  vec4 color = vec4(cr, cg, cb, ca);

  if (u_duotone > 0.5) {
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(u_color1.rgb, u_color2.rgb, lum);
  }

  fragColor = applyBlend(color, u_tint, u_blend) * shapeMask();
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}
void main() {
  vec2 uv = v_uv;
  vec2 m = u_mouse;
  float d = distance(uv, m);
  // Audio scales both halves of the flow — the ambient drift and the pointer's push — so a beat
  // reads as the whole surface moving faster, not just around the cursor.
  float gain = audioGain();
  float force = exp(-d * 6.0) * u_strength * gain;
  vec2 flow = vec2(sin(u_time + uv.y * 10.0), cos(u_time + uv.x * 10.0)) * 0.02 * gain;
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  vec2 offset = (flow + (uv - m) * force * 0.1) * pFactor;
  fragColor = texture(u_image, uv + offset) * u_tint * shapeMask();
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}
void main() {
  vec2 uv = v_uv;
  float w1 = sin(uv.y * 12.0 + u_time * 2.0) * 0.015;
  float w2 = cos(uv.x * 10.0 - u_time * 1.5) * 0.015;
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  // Audio deepens the wave (up to 2x) without changing its wavelength or speed.
  vec2 offset = vec2(w1, w2) * u_strength * pFactor * audioGain();
  fragColor = texture(u_image, uv + offset) * u_tint * shapeMask();
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}
void main() {
  vec2 uv = v_uv;
  vec2 grid = fract(uv * 40.0) - 0.5;
  float dist = length(grid);
  float sparkle = sin(u_time * 5.0 + dot(uv, vec2(100.0))) * 0.5 + 0.5;
  vec4 tex = texture(u_image, uv);
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;
  float dotMask = smoothstep(0.4, 0.2, dist) * u_strength * pFactor;
  // Audio brightens the sparkle (0.3 -> at most 0.6) rather than growing the dots: the mask is
  // already multiplied by an unbounded u_strength and feeds a mix(), so widening it would
  // extrapolate past the texture over a larger and larger area.
  fragColor = mix(tex, tex * u_tint + sparkle * 0.3 * audioGain(), dotMask) * shapeMask();
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}
void main() {
  vec2 uv = v_uv;
  float progress = u_progress >= 0.0 ? clamp(u_progress, 0.0, 1.0) : clamp(u_strength, 0.0, 1.0);
  // Audio wobbles the crossfade harder. Deliberately not applied to u_progress: the morph's
  // position between the two images belongs to the author (or to scroll), and letting a beat
  // drive it would make the transition jump backwards on every quiet frame.
  float noise = sin(uv.x * 20.0 + u_time) * cos(uv.y * 20.0 + u_time) * 0.05 * audioGain();
  vec4 c1 = texture(u_image, uv + vec2(noise * (1.0 - progress)));
  vec4 c2 = texture(u_image_to, uv - vec2(noise * progress));
  fragColor = mix(c1, c2, smoothstep(0.2, 0.8, progress)) * shapeMask();
}
`
