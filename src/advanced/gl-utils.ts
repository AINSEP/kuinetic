// Created by Gemini 3.8 Flash
/**
 * Low-level WebGL helper utilities for kUInetic Shaders
 */

export interface ProgramLocations {
  program?: WebGLProgram
  a_position?: number
  u_image?: WebGLUniformLocation | null
  u_image_to?: WebGLUniformLocation | null
  u_uvOrigin?: WebGLUniformLocation | null
  u_uvScale?: WebGLUniformLocation | null
  u_maskBox?: WebGLUniformLocation | null
  u_maskRx?: WebGLUniformLocation | null
  u_maskRy?: WebGLUniformLocation | null
  u_maskAlpha?: WebGLUniformLocation | null
  u_time?: WebGLUniformLocation | null
  u_strength?: WebGLUniformLocation | null
  u_frequency?: WebGLUniformLocation | null
  u_chromatic?: WebGLUniformLocation | null
  u_iridescence?: WebGLUniformLocation | null
  u_mouse?: WebGLUniformLocation | null
  u_tint?: WebGLUniformLocation | null
  u_color1?: WebGLUniformLocation | null
  u_color2?: WebGLUniformLocation | null
  u_duotone?: WebGLUniformLocation | null
  u_blend?: WebGLUniformLocation | null
  u_progress?: WebGLUniformLocation | null
  /* The generative mode's own uniforms. Absent (null) in every image-filter program. */
  u_seed?: WebGLUniformLocation | null
  u_scale?: WebGLUniformLocation | null
  u_warp?: WebGLUniformLocation | null
  u_grain?: WebGLUniformLocation | null
  u_hue?: WebGLUniformLocation | null
  u_detail?: WebGLUniformLocation | null
  u_bands?: WebGLUniformLocation | null
  u_colorCount?: WebGLUniformLocation | null
  /** Element 0 of `vec4 u_colors[5]`; one `uniform4fv` of 20 floats fills the whole array. */
  u_colors?: WebGLUniformLocation | null
  /** Which stencil the generative program cuts its field with. See `glyphMask()` in `glsl.ts`. */
  u_maskMode?: WebGLUniformLocation | null
  /** `hover:` as bits — 1 stir, 2 light, 3 both. See `kuiHoverFalloff()` in `glsl.ts`. */
  u_hover?: WebGLUniformLocation | null
  /** The colour the generative field is composited over, straight (non-premultiplied) RGBA. */
  u_backdrop?: WebGLUniformLocation | null
  /** The field's orientation in **radians**; also the axis `motion: drift` travels along. */
  u_angle?: WebGLUniformLocation | null
  /** `motion:` — 0 evolve, 1 drift, 2 swirl. */
  u_motion?: WebGLUniformLocation | null
}

export function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (typeof gl.getProgramParameter === 'function' && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function extractLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram | null,
): ProgramLocations | null {
  if (!program) return null
  return {
    program,
    a_position: gl.getAttribLocation(program, 'a_position'),
    u_image: gl.getUniformLocation(program, 'u_image'),
    u_image_to: gl.getUniformLocation(program, 'u_image_to'),
    u_uvOrigin: gl.getUniformLocation(program, 'u_uvOrigin'),
    u_uvScale: gl.getUniformLocation(program, 'u_uvScale'),
    u_maskBox: gl.getUniformLocation(program, 'u_maskBox'),
    u_maskRx: gl.getUniformLocation(program, 'u_maskRx'),
    u_maskRy: gl.getUniformLocation(program, 'u_maskRy'),
    u_maskAlpha: gl.getUniformLocation(program, 'u_maskAlpha'),
    u_time: gl.getUniformLocation(program, 'u_time'),
    u_strength: gl.getUniformLocation(program, 'u_strength'),
    u_frequency: gl.getUniformLocation(program, 'u_frequency'),
    u_chromatic: gl.getUniformLocation(program, 'u_chromatic'),
    u_iridescence: gl.getUniformLocation(program, 'u_iridescence'),
    u_mouse: gl.getUniformLocation(program, 'u_mouse'),
    u_tint: gl.getUniformLocation(program, 'u_tint'),
    u_color1: gl.getUniformLocation(program, 'u_color1'),
    u_color2: gl.getUniformLocation(program, 'u_color2'),
    u_duotone: gl.getUniformLocation(program, 'u_duotone'),
    u_blend: gl.getUniformLocation(program, 'u_blend'),
    u_progress: gl.getUniformLocation(program, 'u_progress'),
    u_seed: gl.getUniformLocation(program, 'u_seed'),
    u_scale: gl.getUniformLocation(program, 'u_scale'),
    u_warp: gl.getUniformLocation(program, 'u_warp'),
    u_grain: gl.getUniformLocation(program, 'u_grain'),
    u_hue: gl.getUniformLocation(program, 'u_hue'),
    u_detail: gl.getUniformLocation(program, 'u_detail'),
    u_bands: gl.getUniformLocation(program, 'u_bands'),
    u_colorCount: gl.getUniformLocation(program, 'u_colorCount'),
    u_colors: gl.getUniformLocation(program, 'u_colors'),
    // Which stencil the generative program applies: 0 none (`gradient`), 1 alpha, 2 luma,
    // 3 inverted luma. See `glyphMask()` in `glsl.ts`.
    u_maskMode: gl.getUniformLocation(program, 'u_maskMode'),
    u_hover: gl.getUniformLocation(program, 'u_hover'),
    u_backdrop: gl.getUniformLocation(program, 'u_backdrop'),
    u_angle: gl.getUniformLocation(program, 'u_angle'),
    u_motion: gl.getUniformLocation(program, 'u_motion'),
  }
}

export function disposeGLResources(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
  quadBuffer: WebGLBuffer | null,
  programs: Record<string, ProgramLocations | WebGLProgram | null | undefined>,
): void {
  if (!gl) return
  if (quadBuffer && gl.deleteBuffer) gl.deleteBuffer(quadBuffer)
  for (const info of Object.values(programs)) {
    const prog = info && typeof info === 'object' && 'program' in info ? info.program : (info as WebGLProgram)
    if (prog && gl.deleteProgram) gl.deleteProgram(prog)
  }
}

type AnyGL = WebGLRenderingContext | WebGL2RenderingContext

/**
 * The source's own pixel dimensions, as `[0, 0]` when it does not report any.
 *
 * Three different property pairs, because `TexImageSource` is a union: an `<img>` carries
 * `naturalWidth`, a `<video>` `videoWidth`, and a canvas or `ImageBitmap` a plain `width`. `[0, 0]`
 * is "unknown", which the size check below reads as "do not refuse" — an unmeasurable source is not
 * evidence of an oversized one.
 */
function sourceExtent(source: TexImageSource): [number, number] {
  const s = source as unknown as Record<string, unknown>
  const w = Number(s.naturalWidth ?? s.videoWidth ?? s.width ?? 0)
  const h = Number(s.naturalHeight ?? s.videoHeight ?? s.height ?? 0)
  return [Number.isFinite(w) ? w : 0, Number.isFinite(h) ? h : 0]
}

/**
 * Whether this source is larger than the device will accept as a texture.
 *
 * `MAX_TEXTURE_SIZE` is 4096 on plenty of mid-range Android GPUs, and a 2× srcset asset reaches
 * 3840-5120 routinely, so this is an ordinary hero image rather than a pathological one. Over the
 * limit, `texImage2D` sets `INVALID_VALUE` and leaves the texture *incomplete* — it does not throw,
 * so the `catch` below never sees it — and WebGL2 samples an incomplete texture as opaque black.
 * Refusing here is what keeps the caller's `drew` false, and therefore keeps the element visible
 * instead of hidden behind a black rectangle.
 *
 * Every read is guarded and every non-numeric answer means "no limit known". The unit suites' GL
 * doubles do not implement `getParameter`, and a double that answered `undefined` would otherwise
 * make *every* mocked upload oversized, turning the guard into a dead-effect generator.
 */
function exceedsTextureLimit(gl: AnyGL, source: TexImageSource): boolean {
  if (typeof gl.getParameter !== 'function') return false
  const limit = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
  if (!Number.isFinite(limit) || limit <= 0) return false
  const [w, h] = sourceExtent(source)
  return w > limit || h > limit
}

/**
 * Empty the GL error queue, so a later `getError()` reports only what happened in between.
 *
 * `getError` returns one error and clears that flag, and the flags it reports were set by whatever
 * ran before — a neighbouring instance's draw included. Without draining first, this module's
 * texture upload gets blamed for someone else's error. Bounded because a context that answers a
 * non-zero code forever would otherwise spin here.
 */
function drainGLErrors(gl: AnyGL): void {
  if (typeof gl.getError !== 'function') return
  for (let i = 0; i < 8; i += 1) {
    if (Number(gl.getError()) === 0) return
  }
}

/** Whether a GL error was raised since {@link drainGLErrors}. A non-numeric answer means "no". */
function glRaisedError(gl: AnyGL): boolean {
  if (typeof gl.getError !== 'function') return false
  const code = gl.getError()
  return typeof code === 'number' && code !== 0
}

export function createGLTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  source: TexImageSource,
): WebGLTexture | null {
  // Before allocating anything: an oversized source can only produce an incomplete texture, and
  // the whole point is to hand the caller a `null` it will read as "did not draw".
  if (exceedsTextureLimit(gl, source)) return null
  const tex = gl.createTexture()
  if (!tex) return null
  drainGLErrors(gl)
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // The context is created `premultipliedAlpha: true`, so the framebuffer is read back as
    // premultiplied — upload straight-alpha image data into it and every semi-transparent pixel
    // composites too bright (the classic halo around an antialiased PNG edge). It is also what
    // makes the corner mask exact: masking multiplies all four channels, which is only the right
    // operation on premultiplied colour.
    //
    // Guarded because the unit suites' GL doubles declare neither the function nor the constant,
    // and this whole body is inside a `try` that answers `null` — an unguarded call there would
    // turn every mocked texture upload into "failed", i.e. into a dead effect.
    if (typeof gl.pixelStorei === 'function') gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    // The upload can fail without throwing — `OUT_OF_MEMORY` on a constrained device, or a
    // dimension the size check above could not see because the source reports none. Only a JS
    // exception reaches the `catch`; a GL error has to be asked for.
    if (glRaisedError(gl)) {
      if (gl.deleteTexture) gl.deleteTexture(tex)
      return null
    }
    return tex
  } catch {
    if (gl.deleteTexture) gl.deleteTexture(tex)
    return null
  }
}
