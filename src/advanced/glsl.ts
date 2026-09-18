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

/**
 * The procedural noise core — the one place this tier generates a pattern from mathematics.
 *
 * Written as a shared block, spliced into programs the same way {@link AUDIO_GAIN_GLSL} and
 * {@link SHAPE_MASK_GLSL} already are, because it is deliberately *not* the gradient mode's private
 * helper. Four of the five filter programs fake their noise with a single trigonometric term —
 * `FLUID_FS`'s `vec2(sin(t + uv.y * 10.0), cos(...))`, `LIQUID_FS`'s two `sin`/`cos` waves,
 * `PARTICLES_FS`'s `sin(t * 5.0 + dot(uv, vec2(100.0)))`, and `MORPH_FS`, which names its variable
 * `noise` while computing `sin(x) * cos(y)`. All four now reach this function through
 * {@link FILTER_NOISE_GLSL}, under the `noise:` parameter. (`DISPLACE_FS`'s term is a deliberate
 * radial ripple, not fake noise, and is not a candidate — it is the one filter that does not
 * splice this block in.)
 *
 * Gradient noise on a cubic lattice rather than value noise: a value-noise lattice shows as
 * square-ish blobs at the low frequencies a colour field runs at, which is the one artefact a
 * generated gradient cannot afford. Rather than simplex, because the skewed-lattice unpacking is
 * where hand-written implementations go wrong and the payoff is invisible under four octaves of
 * blur.
 *
 * Time is the third axis rather than a translation of a 2D field. Translating reads as the pattern
 * *sliding past* — legible as a cheat within a second or two — where a third axis is the pattern
 * genuinely evolving in place. It costs eight corner hashes per octave instead of four.
 */
const NOISE_GLSL = `const int KUI_MAX_OCTAVES = 6;

/**
 * Integer avalanche over one lattice coordinate.
 *
 * Deliberately not the \`fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)\` idiom. That relies
 * on the low bits of a large sine, which \`highp\` does not reliably have: on several mobile GPUs
 * neighbouring cells stay correlated and the field bands visibly. GLSL ES 3.00 has real unsigned
 * integer arithmetic, so a proper mix is both better distributed and cheaper.
 */
uint kuiHash(uvec3 v) {
  uint h = v.x * 0x8da6b343u ^ v.y * 0xd8163841u ^ v.z * 0xcb1ab31fu;
  h ^= h >> 15u; h *= 0x2c1b3c6du;
  h ^= h >> 12u; h *= 0x297a2d39u;
  h ^= h >> 15u;
  return h;
}

/**
 * A unit gradient vector for one lattice corner.
 *
 * The three components read *non-overlapping* 10-bit fields. Overlapping slices of one hash are
 * correlated with each other, which shows up as gradients clustering around a diagonal and the
 * noise developing a directional grain. The \`1e-5\` keeps \`normalize\` defined for the one input
 * that hashes to exactly zero.
 */
vec3 kuiGradient(uvec3 cell) {
  uint h = kuiHash(cell);
  vec3 g = vec3(
    float((h        ) & 1023u),
    float((h >> 10u ) & 1023u),
    float((h >> 20u ) & 1023u)
  ) * (2.0 / 1023.0) - 1.0;
  return normalize(g + vec3(1e-5));
}

/**
 * One octave of gradient noise, approximately -1..1.
 *
 * The lattice index is biased into unsigned space before hashing: seeds, scroll and a centred UV
 * field all reach negative coordinates, and \`uvec3\` of a negative \`ivec3\` wraps — which is
 * harmless for a hash, but only once every negative input maps somewhere distinct rather than
 * folding onto its positive twin.
 */
float kuiNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uvec3 c = uvec3(ivec3(i) + 0x10000);
  float n000 = dot(kuiGradient(c + uvec3(0u, 0u, 0u)), f - vec3(0.0, 0.0, 0.0));
  float n100 = dot(kuiGradient(c + uvec3(1u, 0u, 0u)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(kuiGradient(c + uvec3(0u, 1u, 0u)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(kuiGradient(c + uvec3(1u, 1u, 0u)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(kuiGradient(c + uvec3(0u, 0u, 1u)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(kuiGradient(c + uvec3(1u, 0u, 1u)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(kuiGradient(c + uvec3(0u, 1u, 1u)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(kuiGradient(c + uvec3(1u, 1u, 1u)), f - vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, w.x);
  float nx10 = mix(n010, n110, w.x);
  float nx01 = mix(n001, n101, w.x);
  float nx11 = mix(n011, n111, w.x);
  // 2/sqrt(3) — a 3D gradient-noise octave peaks near sqrt(3)/2, so this brings it to about -1..1.
  return mix(mix(nx00, nx10, w.y), mix(nx01, nx11, w.y), w.z) * 1.1547;
}

/**
 * Octaves summed and **normalised by the amplitude sum**, approximately -1..1 at every octave count.
 *
 * The division is the whole point of the function. Without it, raising the octave count raises the
 * total amplitude, so the one authored knob that means "how much fine structure" would silently be
 * a contrast control as well — two behaviours behind one parameter, which is the class of bug this
 * repository keeps rediscovering. Gain and lacunarity stay fixed at 0.5 and 2.0: they are the two
 * numbers that make layered noise look wrong in a hundred ways and right in one.
 *
 * The loop bound is a constant with an early break because a loop bound that is itself a uniform
 * forces some drivers to unroll against the worst case anyway, and this way the cost of a low
 * \`detail\` is genuinely low.
 */
float kuiFbm(vec3 p, int octaves) {
  float amp = 1.0;
  float freq = 1.0;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < KUI_MAX_OCTAVES; i++) {
    if (i >= octaves) break;
    sum += amp * kuiNoise(p * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / max(norm, 1e-5);
}
`

/**
 * The four filter programs' bridge to the noise core, under one authored amount.
 *
 * **Why a parameter and not a straight swap.** `fluid`, `liquid`, `particles` and `morph` shipped
 * with a trigonometric stand-in for noise, and pages are running on them today. Replacing the term
 * outright would restyle four modes for everyone on the next release. Making `scale`/`detail`/
 * `warp`/`seed` simply *apply* to these programs has the same problem by another route: `detail`
 * defaults to `3`, not to off, so a filter page would pick up the new field the moment the code
 * landed. The only existing knob whose default is already off is `warp: 0` — and overloading it to
 * mean both "use the noise core" and "how much to domain-warp" is two behaviours behind one
 * parameter, which is precisely what {@link NOISE_GLSL}'s `kuiFbm` comment records this directory
 * getting wrong before. So the switch is its own parameter.
 *
 * It is a 0..1 *amount* rather than an on/off keyword, matching `chromatic`, `iridescence`, `grain`
 * and `warp`, where `0` is off and the values between are a real dial: `u_noise` crossfades each
 * program's existing trig term into the fbm field, so an author can keep the shipped picture, take
 * the new one whole, or sit anywhere between. Above `0` is also what makes `seed`, `scale`, `warp`
 * and `detail` mean something on these four modes — the alternative was four more knobs.
 *
 * **Bit-identical at the default.** Every call site guards on `u_noise > 0.0`, so at `0` the fbm is
 * not merely mixed out, it is never evaluated: the trig path runs unchanged and costs what it
 * always did. The guard is on a uniform, so it is coherent across the warp and not a divergence
 * cost either.
 */
const FILTER_NOISE_GLSL = `uniform float u_noise;
uniform float u_seed;
uniform float u_scale;
uniform float u_warp;
uniform int u_detail;

/**
 * A sine's RMS is 0.707. Amplitude-normalised fbm's is about 0.23 — it reaches its \`1.0\` peak
 * rarely, which is what makes it look like noise rather than a wave. Handing the programs the raw
 * field would therefore read as the *effect being turned down*, not as it being re-textured, and
 * the first thing anyone trying \`noise: 1\` would do is reach for \`strength\`. This brings the two
 * to the same typical magnitude so the amount is a change of texture and nothing else.
 */
const float KUI_FBM_SINE_RMS = 3.0;

/**
 * One scalar of animated noise, scaled to stand in for a unit sine at a stated rate.
 *
 * \`cycles\` and \`rate\` are the spatial and temporal frequency of the term being replaced, in
 * cycles rather than radians — each call site divides its own trig coefficients by 2*pi and passes
 * the result, so \`noise: 1\` lands on the same feature size and the same speed as the wave it took
 * over from. That is the entire mechanism keeping this from being a new look.
 *
 * \`phase\` decorrelates sibling calls: two components of one flow vector must not be the same
 * field, and offsetting the seed is cheaper than hashing a second one.
 *
 * \`u_warp\` costs two further fbm evaluations and is skipped entirely when it is zero.
 */
float kuiFilterField(vec2 uv, float t, float cycles, float rate, float phase) {
  vec3 s = vec3(u_seed * 137.31, u_seed * 71.17, u_seed * 29.73) + phase;
  vec3 q = vec3((uv - 0.5) * cycles * max(u_scale, 0.05), t * rate) + s;
  if (u_warp > 0.0) {
    float wx = kuiFbm(q * 0.5 + vec3(5.2, 1.3, 7.1), u_detail);
    float wy = kuiFbm(q * 0.5 + vec3(19.7, 11.1, 3.7), u_detail);
    q.xy += vec2(wx, wy) * u_warp;
  }
  return kuiFbm(q, u_detail) * KUI_FBM_SINE_RMS;
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}${NOISE_GLSL}${FILTER_NOISE_GLSL}
void main() {
  vec2 uv = v_uv;
  vec2 m = u_mouse;
  float d = distance(uv, m);
  // Audio scales both halves of the flow — the ambient drift and the pointer's push — so a beat
  // reads as the whole surface moving faster, not just around the cursor.
  float gain = audioGain();
  float force = exp(-d * 6.0) * u_strength * gain;
  // The ambient drift. Two perpendicular waves at 10 rad across the box and 1 rad/s, which is
  // 10/2pi = 1.5915 cycles and 1/2pi = 0.1592 cycles a second — the numbers kuiFilterField needs
  // to put its field at the same size and speed. The drift is the whole of the ambient motion
  // here, so this is the mode where the noise core reads most strongly: a regular cross-hatched
  // sway becomes an irregular current.
  vec2 wave = vec2(sin(u_time + uv.y * 10.0), cos(u_time + uv.x * 10.0));
  if (u_noise > 0.0) {
    wave = mix(wave, vec2(
      kuiFilterField(uv, u_time, 1.5915, 0.1592, 0.0),
      kuiFilterField(uv, u_time, 1.5915, 0.1592, 31.4)
    ), u_noise);
  }
  vec2 flow = wave * 0.02 * gain;
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}${NOISE_GLSL}${FILTER_NOISE_GLSL}
void main() {
  vec2 uv = v_uv;
  // 12 rad and 2 rad/s is 1.9099 cycles at 0.3183 a second; 10 rad and 1.5 rad/s is 1.5915 at
  // 0.2387. The two waves keep their own rates under noise rather than being merged into one
  // field, because the difference between them is what stops the surface reading as a single
  // sheet sliding.
  float w1 = sin(uv.y * 12.0 + u_time * 2.0);
  float w2 = cos(uv.x * 10.0 - u_time * 1.5);
  if (u_noise > 0.0) {
    w1 = mix(w1, kuiFilterField(uv, u_time, 1.9099, 0.3183, 0.0), u_noise);
    w2 = mix(w2, kuiFilterField(uv, u_time, 1.5915, 0.2387, 47.3), u_noise);
  }
  w1 *= 0.015;
  w2 *= 0.015;
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}${NOISE_GLSL}${FILTER_NOISE_GLSL}
void main() {
  vec2 uv = v_uv;
  vec2 grid = fract(uv * 40.0) - 0.5;
  float dist = length(grid);
  // 100 rad across the box and 5 rad/s is 15.915 cycles at 0.7958 a second. That is by far the
  // highest frequency of the four, and deliberately so: the trig term here is a diagonal travelling
  // stripe, which is the most visible of the four repeats. Under noise the stripe becomes a
  // scintillation, which is the largest change of the set and is the reason the parameter exists
  // rather than the swap being unconditional.
  //
  // The clamp is not damage control. Mapped through KUI_FBM_SINE_RMS the field reaches 0 and 1
  // often, which is what a sine does too — sin()*0.5+0.5 is arcsine-distributed and spends most of
  // its time at the extremes. Clamping reproduces that; a soft field would give a duller sparkle
  // than the one being replaced.
  //
  // Cost: this is one fbm per pixel, three with warp on, over the whole quad. At detail 6 the
  // finest octave here sits near 509 cycles across the box, which is sub-pixel on a small element
  // and will alias — high detail belongs on the low-frequency modes.
  float sparkle = sin(u_time * 5.0 + dot(uv, vec2(100.0))) * 0.5 + 0.5;
  if (u_noise > 0.0) {
    float n = clamp(kuiFilterField(uv, u_time, 15.915, 0.7958, 0.0) * 0.5 + 0.5, 0.0, 1.0);
    sparkle = mix(sparkle, n, u_noise);
  }
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
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}${NOISE_GLSL}${FILTER_NOISE_GLSL}
void main() {
  vec2 uv = v_uv;
  float progress = u_progress >= 0.0 ? clamp(u_progress, 0.0, 1.0) : clamp(u_strength, 0.0, 1.0);
  // Audio wobbles the crossfade harder. Deliberately not applied to u_progress: the morph's
  // position between the two images belongs to the author (or to scroll), and letting a beat
  // drive it would make the transition jump backwards on every quiet frame.
  //
  // 20 rad and 1 rad/s is 3.1831 cycles at 0.1592 a second. The 0.7071 is the one place the shared
  // RMS gain is wrong by construction: the term being replaced is a *product* of two unit sines,
  // whose RMS is 0.5 rather than a single sine's 0.7071, so matching it means taking the field
  // down by that ratio. Without it the displacement under noise would be about 40% deeper than
  // the one it stands in for — a visibly stronger morph, not the same one better textured.
  float noise = sin(uv.x * 20.0 + u_time) * cos(uv.y * 20.0 + u_time);
  if (u_noise > 0.0) {
    noise = mix(noise, kuiFilterField(uv, u_time, 3.1831, 0.1592, 0.0) * 0.7071, u_noise);
  }
  noise = noise * 0.05 * audioGain();
  vec4 c1 = texture(u_image, uv + vec2(noise * (1.0 - progress)));
  vec4 c2 = texture(u_image_to, uv - vec2(noise * progress));
  fragColor = mix(c1, c2, smoothstep(0.2, 0.8, progress)) * shapeMask();
}
`

/**
 * The generative program: colour from mathematics rather than from a source image.
 *
 * **Two modes, one program.** `u_maskMode` is the whole difference between them:
 *
 * - `mode: gradient` (`u_maskMode 0`) — no texture is bound and the field fills the element's box.
 *   Every program above samples `u_image`, which is why every one of them is a *filter* and why
 *   the tier could not produce a background of its own until this one. `shaders.ts` skips the
 *   texture requirement for it (see `GENERATIVE_MODES`) and does not hide the host, because hiding
 *   an element the author may have put content in is destructive rather than merely useless.
 * - `mode: logo` (`u_maskMode 1` or `2`) — the host `<img>`'s own pixels are the *stencil*, and the
 *   field is painted only where the mark is. This is the ordinary filter path with nothing changed:
 *   the texture is required, the host is hidden, `object-fit` resolves through `v_uv` exactly as it
 *   does for `displace`. What arrives is not a recolour of the image but a generated field wearing
 *   its shape.
 *
 * The sampler is declared unconditionally and read only inside the `u_maskMode > 0` branch. In
 * `gradient` nothing is bound to the unit, which WebGL defines as sampling an incomplete texture —
 * `(0, 0, 0, 1)`, no error — and the branch means even that is never reached.
 *
 * Splitting these into two programs would mean a second copy of the noise core, and three
 * near-identical fbm implementations is the state this directory was already dug out of once.
 *
 * **`gradient`'s honest surface is still an element nothing overlaps**, though not for the reason
 * it first shipped with. The shared canvas is one `position: fixed` layer at `z-index: 1` by
 * default (movable page-wide with `--kui-shader-z`, which is a coping knob and not composition).
 * A *positioned* headline laid over a field now paints on top of it rather than vanishing behind
 * it; a static one still does not, because the canvas is `fixed` and it is not. So a full-bleed
 * band, a card face or a footer strip work, and anything needing real interleaving does not.
 * `logo` is the exception that needs nothing lifted: a mark *should* paint over the page, which is
 * exactly what the five filters already do.
 *
 * The parameter split worth understanding: `scale` zooms the field, `frequency` is the rate of the
 * *warping* field that distorts it, and `detail` is how many octaves ride on top. Three knobs that
 * sound similar and are not — one changes how big the shapes are, one how contorted, one how
 * intricate.
 */
export const GRADIENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform float u_time;
uniform float u_strength;
uniform float u_frequency;
uniform float u_chromatic;
uniform float u_iridescence;
uniform float u_progress;
uniform float u_seed;
uniform float u_scale;
uniform float u_warp;
uniform float u_grain;
uniform float u_hue;
uniform int u_detail;
uniform int u_bands;
uniform int u_colorCount;
uniform vec4 u_colors[5];
uniform vec4 u_tint;
uniform sampler2D u_image;
uniform int u_maskMode;
${AUDIO_GAIN_GLSL}${SHAPE_MASK_GLSL}${NOISE_GLSL}

/**
 * The host image read as a stencil: 1 where the mark is, 0 where the page should show through.
 *
 * Three ways to ask, because a logo file answers the question differently depending on what it is:
 *
 * - \`0\` — no stencil. \`mode: gradient\`; \`u_image\` is not sampled at all.
 * - \`1\` (\`mask: alpha\`) — the image's own alpha. An SVG or PNG mark on a transparent ground,
 *   which is what a logo asset usually is. The texture is uploaded premultiplied, so \`a\` is the
 *   coverage and multiplying all four channels by it stays premultiplied-correct.
 * - \`2\`/\`3\` (\`mask: luma\` / \`luma-invert\`) — luminance, for a format with no alpha to read. A
 *   JPEG has none, so a black-on-white mark under \`alpha\` would give an all-opaque stencil and
 *   fill the whole rectangle with field. \`luma\` takes the *bright* pixels as the mark (white on
 *   black); \`luma-invert\` takes the dark ones (black on white, which is the common logo file).
 *   Both directions exist because guessing one silently produces a perfect negative of the mark —
 *   an image that looks deliberate and is exactly wrong.
 *
 * Luminance is taken from the premultiplied colour, so a transparent pixel is black. Under
 * \`luma\` that reads as "not the mark", which is the sensible answer for a file that has alpha and
 * was asked for a luma stencil anyway. Under \`luma-invert\` the same pixel reads as *solid* mark —
 * correct for the opaque JPEG the keyword exists for, and wrong for anything with a transparent
 * surround, which should be using \`alpha\`.
 */
float glyphMask() {
  if (u_maskMode == 0) return 1.0;
  vec4 src = texture(u_image, v_uv);
  if (u_maskMode == 1) return src.a;
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  return u_maskMode == 2 ? lum : 1.0 - lum;
}

/**
 * The palette ramp, interpolated in linear-light rather than straight sRGB.
 *
 * \`mix()\` between two sRGB triples passes through a desaturated middle — the classic muddy
 * midpoint of a naive gradient, worst exactly where two saturated brand colours meet. Squaring
 * into approximately linear light, mixing there, and taking the square root back is a two-operation
 * approximation of a gamma-2.0 space that removes almost all of it.
 *
 * \`smoothstep\` on the segment fraction, not a straight lerp, so the ramp has no visible crease at
 * each stop — a crease that banding (\`u_bands\`) would otherwise land on and amplify.
 */
vec3 kuiPalette(float t) {
  int n = max(u_colorCount, 2);
  float x = clamp(t, 0.0, 1.0) * float(n - 1);
  int i = int(floor(x));
  int j = min(i + 1, n - 1);
  float f = smoothstep(0.0, 1.0, x - float(i));
  vec3 a = u_colors[i].rgb;
  vec3 b = u_colors[j].rgb;
  return sqrt(mix(a * a, b * b, f));
}

/** Rotate a colour about the grey axis — Rodrigues' formula, which needs no colour-space change. */
vec3 kuiHueRotate(vec3 c, float angle) {
  const vec3 axis = vec3(0.57735026);
  float s = sin(angle);
  float k = cos(angle);
  return c * k + cross(axis, c) * s + axis * dot(axis, c) * (1.0 - k);
}

/** Per-pixel film grain. Quantised in time so it flickers at ~60 steps a second rather than per frame. */
float kuiGrain(vec2 fragCoord, float t) {
  uint h = kuiHash(uvec3(uvec2(fragCoord), uint(int(t * 60.0) + 0x10000)));
  return float(h & 0xffffu) / 65535.0 - 0.5;
}

void main() {
  // Centred and aspect-free: the field is authored in the element's own UV space, so the same
  // parameters give the same picture whatever size the box is.
  vec2 p = (v_uv - 0.5) * max(u_scale, 0.05);
  vec3 seed = vec3(u_seed * 137.31, u_seed * 71.17, u_seed * 29.73);
  float t = u_time;
  float pFactor = u_progress >= 0.0 ? u_progress : 1.0;

  // Domain warp: a second field displaces the sample point of the first. This is the whole
  // difference between concentric fbm contours and something that reads as liquid.
  vec2 q = p;
  if (u_warp > 0.0) {
    float wf = u_frequency * 0.1;
    float wx = kuiFbm(vec3(p * wf, t * 0.35) + seed, u_detail);
    float wy = kuiFbm(vec3(p * wf + 5.2, t * 0.35 + 1.3) + seed, u_detail);
    q += vec2(wx, wy) * u_warp;
  }

  // Audio and progress scale the field's *amplitude*, leaving its shape and rate alone — so a
  // beat swells the contrast and a scroll at 0 leaves a flat single colour rather than a jump cut.
  float field = kuiFbm(vec3(q, t * 0.25) + seed, u_detail);
  field *= u_strength * pFactor * audioGain();
  float v = clamp(field * 0.5 + 0.5, 0.0, 1.0);

  // Iridescence wraps the ramp back on itself, so one palette reads as many sheens across the box.
  float wrapped = u_iridescence > 0.0 ? fract(v * u_iridescence) : v;

  // Posterise. Divided by bands-1 so the top step reaches the end of the ramp; a plain /bands
  // would stop one step short and quietly desaturate the brightest colour.
  if (u_bands > 0) {
    float steps = float(u_bands);
    wrapped = floor(wrapped * steps) / max(steps - 1.0, 1.0);
  }

  // Fringing offsets the *ramp position* per channel rather than re-sampling the field three
  // times: three palette lookups are nearly free, three more fbm evaluations would triple the
  // program's cost for a decorative edge.
  vec3 color;
  if (u_chromatic > 0.0) {
    float d = u_chromatic * 0.04;
    color = vec3(
      kuiPalette(wrapped + d).r,
      kuiPalette(wrapped).g,
      kuiPalette(wrapped - d).b
    );
  } else {
    color = kuiPalette(wrapped);
  }

  if (u_hue != 0.0) color = kuiHueRotate(color, u_hue);
  if (u_grain > 0.0) color += kuiGrain(gl_FragCoord.xy, t) * u_grain * 0.25;

  // Opaque before masking, and premultiplied trivially because alpha is 1 — the element's own
  // shape and its ancestors' opacity arrive through shapeMask(), the mark's shape through
  // glyphMask(), and both multiply all four channels, which is the right operation on
  // premultiplied colour and is what leaves the page visible around a logo.
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0) * u_tint * shapeMask() * glyphMask();
}
`
