// Created by Gemini 3.8 Flash
/**
 * kUInetic Shaders - Shared WebGL2 Shader System
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import {
  DISPLACE_FS, FLUID_FS, FULLSCREEN_QUAD_VS, GRADIENT_FS, LIQUID_FS, MORPH_FS, PARTICLES_FS,
} from './glsl.js'
import {
  type AdvancedEnv, type AdvancedLedgers, type AnyWindow, type AnyDocument, type RafFunction,
  type CafFunction, type SetTimerFunction, type ClearTimerFunction, clamp, createAdvancedLedgers,
  createEffectInstance, createInertInstance, isReducedMotion, registerInto, resolveEnv, styleOf,
} from './base.js'
import { createProgram, extractLocations, disposeGLResources, createGLTexture, type ProgramLocations } from './gl-utils.js'
import { AUDIO_BANDS, parseAudioBand, readAudioBand, type AudioBand } from './audio.js'

/**
 * `gl-utils.ts`'s location set plus the one uniform only this module's programs declare.
 *
 * Kept here rather than in `ProgramLocations` because `u_audio` is a `glsl.ts` uniform and this
 * file is the only thing that uploads it; every field is optional there, so a plain
 * `ProgramLocations` (an older cached program, or a caller that built one itself) still satisfies
 * this type and simply has no audio location to upload to.
 */
export type ShaderProgramLocations = ProgramLocations & {
  u_audio?: WebGLUniformLocation | null
  u_noise?: WebGLUniformLocation | null
}

export interface ShaderUniformOptions {
  time?: number
  speed?: number
  strength?: number
  frequency?: number
  chromatic?: number
  iridescence?: number
  progress?: number
  /** One audio band's current value (0..1), or 0/absent for "no audio". */
  audio?: number
  localMouse?: { x: number; y: number }
  tintRgba?: [number, number, number, number]
  blendMode?: number
  isDuotone?: boolean
  c1Rgba?: [number, number, number, number]
  c2Rgba?: [number, number, number, number]
  uvOrigin?: [number, number]
  uvScale?: [number, number]
  /** Border-box centre and half-extents in device px, y up from the canvas bottom. */
  maskBox?: [number, number, number, number]
  /** Corner radii in device px, TL, TR, BR, BL. */
  maskRx?: [number, number, number, number]
  maskRy?: [number, number, number, number]
  /** What the ancestors' own opacity leaves this element painted at. */
  maskAlpha?: number
  /* The field's own uniforms. `grain`, `hue`, `bands` and the palette are generative-only and find
   * a null location in every filter program, so `uploadFloat`/`uploadInt` skip them there. `seed`,
   * `scale`, `warp` and `detail` are no longer in that set: the four filter programs that adopted
   * the noise core declare them too, and read them once `noise` is above zero. */
  seed?: number
  scale?: number
  warp?: number
  /**
   * How much of `fluid`/`liquid`/`particles`/`morph`'s trig stand-in is replaced by real noise.
   *
   * Zero in the six programs that do not declare it, and zero by default in the four that do, which
   * is what keeps every page already running these modes rendering exactly what it rendered before.
   */
  noise?: number
  grain?: number
  /** Hue rotation in **radians**. The parameter is authored as an angle; `readAngleRadians` converts. */
  hue?: number
  detail?: number
  bands?: number
  /** How many of `color1`..`color5` the author actually set. Below 2 the palette falls back. */
  colorCount?: number
  /** The five palette stops, flattened to 20 floats for one `uniform4fv`. */
  palette?: Float32Array
  /**
   * Which stencil `mode: logo` cuts the field with — 0 none, 1 alpha, 2 luma, 3 inverted luma.
   *
   * See {@link MASK_MODES} and `glyphMask()` in `glsl.ts`. `0` in every mode but `logo`.
   */
  maskMode?: number
  /**
   * Which pointer gestures the generative field responds to, as bits — see {@link HOVER_MODES}.
   *
   * The pointer position itself already arrives as {@link localMouse}, which every program that
   * declares `u_mouse` has been receiving all along; this is only the switch that decides whether
   * `GRADIENT_FS` reads it. `0` — the default — is the one value under which the pointer cannot
   * reach a pixel at all.
   */
  hover?: number
  /** The colour the generative field is composited over, straight RGBA. Alpha `0` is "unset". */
  backdropRgba?: [number, number, number, number]
  /** The field's orientation in **radians**. Authored as an angle; `parseAngleRadians` converts. */
  angle?: number
  /** How the generative field moves — see {@link MOTION_MODES}. `0` (`evolve`) is the default. */
  motion?: number
}

export interface ShaderDrawOptions extends ShaderUniformOptions {
  mode: string
  strength: number
  speed: number
  frequency: number
  chromatic: number
  iridescence: number
  tintRgba: [number, number, number, number]
  isDuotone: boolean
  c1Rgba: [number, number, number, number]
  c2Rgba: [number, number, number, number]
  blendMode: number
  texture?: WebGLTexture | null
  to?: string
  toTexture?: WebGLTexture | null
  /**
   * Which `audio-source` band this instance follows, or `null` for none.
   *
   * The authored choice, not a value: the value is read per frame off the element (see
   * `readAudioBand`) and arrives at the draw as {@link ShaderUniformOptions.audio}.
   */
  audioBand?: AudioBand | null
  /**
   * Whether this instance follows `--kui-progress`, the property the scroll primitives publish.
   *
   * The authored choice, not a value — the same shape as {@link audioBand} and for the same
   * reason: the value is read per frame off the element (see `readElementProgress`) and arrives
   * at the draw as {@link ShaderUniformOptions.progress}.
   */
  scrubsFromScroll?: boolean
  /**
   * This element's already-measured box, or absent to measure it here.
   *
   * The render loop measures every registered instance in its read pass and passes the answer down
   * (see `renderFrame`); measuring inside the draw would interleave `getComputedStyle` and
   * `getBoundingClientRect` with the previous instance's `opacity` write and force a style
   * recalculation per element per frame.
   */
  geometry?: ElementGeometry | null
}

export type ShaderProgramEntry = ProgramLocations | WebGLProgram | null | undefined

export interface ShaderRendererLike {
  gl: WebGLRenderingContext | WebGL2RenderingContext | null
  canvas: HTMLCanvasElement | null
  window?: AnyWindow
  mouse: { x: number; y: number }
  /**
   * Whether `mouse` has ever been written by a real pointer event.
   *
   * `false` means it has not, and {@link computeMousePos} answers the element's centre instead of
   * believing the initial `{0, 0}`. `undefined` — a caller that does not model this at all — is
   * taken as "trust `mouse`", so nothing outside this module changes.
   */
  hasPointer?: boolean
  quadBuffer: WebGLBuffer | null
  programs: Record<string, ShaderProgramEntry>
}

function parseHex(raw: string): [number, number, number, number] | null {
  if (!/^[0-9a-fA-F]{3,8}$/.test(raw)) return null
  if (raw.length === 3 || raw.length === 4) {
    const a = raw.length === 4 ? parseInt(raw[3]! + raw[3]!, 16) / 255 : 1
    return [parseInt(raw[0]! + raw[0]!, 16) / 255, parseInt(raw[1]! + raw[1]!, 16) / 255, parseInt(raw[2]! + raw[2]!, 16) / 255, a]
  }
  if (raw.length === 6 || raw.length === 8) {
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
    return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255, a]
  }
  return null
}

const RGBA_REGEX = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i

function parseRgbFunctional(val: string): [number, number, number, number] | null {
  const match = RGBA_REGEX.exec(val)
  if (!match || !match[1] || !match[2] || !match[3]) return null
  const r = Math.min(255, Math.max(0, parseInt(match[1], 10))) / 255
  const g = Math.min(255, Math.max(0, parseInt(match[2], 10))) / 255
  const b = Math.min(255, Math.max(0, parseInt(match[3], 10))) / 255
  const a = match[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(match[4]))) : 1
  return [r, g, b, a]
}

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [1, 1, 1, 1], red: [1, 0, 0, 1],
  green: [0, 0.5, 0, 1], blue: [0, 0, 1, 1], yellow: [1, 1, 0, 1], cyan: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1], gray: [0.5, 0.5, 0.5, 1], grey: [0.5, 0.5, 0.5, 1], orange: [1, 0.647, 0, 1], purple: [0.5, 0, 0.5, 1],
}

/**
 * Where a colour parse gets its canvas from — the injected adapter, not a global.
 *
 * Structurally `ResolvedEnv['createCanvas']`, named here because that is the *only* part of the
 * environment the parser wants: everything above this line (hex, `rgb()`, {@link NAMED_COLORS}) is
 * pure string work that must stay callable with no browser at all.
 */
export type ColorCanvasFactory = () => HTMLCanvasElement | null

/**
 * One 1x1 colour context per canvas source, rather than one per module.
 *
 * Keyed on the *factory function*, because that is what decides which document the canvas comes
 * from: two jsdom documents, a page and an iframe, or a suite that swapped the global each get
 * their own entry, and a module-level `let` would hand the first one's context to all of them. Not
 * keyed on the `ResolvedEnv` object — `resolveEnv` builds a fresh one per call, so that key would
 * never hit; `resolveCreateCanvas` in `base.ts` memoises the default factory per document so the
 * uninjected path has a stable identity too.
 *
 * A `null` result is cached like any other. An environment with no 2D context does not grow one
 * between two colours on the same page, and retrying meant jsdom logging
 * `Not implemented: HTMLCanvasElement.prototype.getContext` once per colour parsed.
 */
const colorContexts = new WeakMap<ColorCanvasFactory, CanvasRenderingContext2D | null>()

function colorContextFor(createCanvas: ColorCanvasFactory): CanvasRenderingContext2D | null {
  const cached = colorContexts.get(createCanvas)
  if (cached !== undefined) return cached
  let ctx: CanvasRenderingContext2D | null = null
  try {
    const canvas = createCanvas()
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
      ctx = (canvas.getContext?.('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null) ?? null
    }
  } catch {
    ctx = null
  }
  colorContexts.set(createCanvas, ctx)
  return ctx
}

function parseColorWithCanvas(
  val: string,
  createCanvas: ColorCanvasFactory,
): [number, number, number, number] | null {
  try {
    const ctx = colorContextFor(createCanvas)
    if (!ctx) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000000'
    ctx.fillStyle = val
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    return [data[0]! / 255, data[1]! / 255, data[2]! / 255, data[3]! / 255]
  } catch {
    return null
  }
}

/**
 * An authored colour as premultiplied-free RGBA in 0..1.
 *
 * Hex, `rgb()`/`rgba()` and the small {@link NAMED_COLORS} table are parsed here. Anything else —
 * `hsl()`, `oklch()`, `rebeccapurple`, a `color-mix()` — is handed to a 1x1 canvas, which is the
 * browser's own parser and the only complete one.
 *
 * @param str - The authored value. Empty or unset answers opaque white, the harmless fallback for
 *   an unset `color1`; `backdrop` reads the raw string first precisely because white is *not*
 *   harmless there.
 * @param createCanvas - Where the fallback canvas comes from. Defaults to the ambient document's,
 *   resolved through `resolveEnv` rather than off a bare global, so a host with no document
 *   answers `null` instead of throwing a `ReferenceError` into the `catch` above — which is what
 *   reading `document` directly did, and it made the result silently environment-dependent.
 *   `prepareShaders` passes its own resolved env, so an injected canvas always wins.
 * @complexity O(n) in string length, plus one cached context construction per canvas source.
 */
export function parseColor(
  str?: string,
  createCanvas: ColorCanvasFactory = resolveEnv(null).createCanvas,
): [number, number, number, number] {
  if (!str) return [1, 1, 1, 1]
  const val = str.trim()
  if (val.startsWith('#')) {
    const hex = parseHex(val.slice(1))
    if (hex) return hex
  }
  const rgb = parseRgbFunctional(val)
  if (rgb) return rgb
  const lower = val.toLowerCase()
  if (lower in NAMED_COLORS) return NAMED_COLORS[lower]!
  const canvasColor = parseColorWithCanvas(val, createCanvas)
  if (canvasColor) return canvasColor
  return [1, 1, 1, 1]
}

const ANGLE_UNITS: Record<string, number> = {
  deg: Math.PI / 180,
  grad: Math.PI / 200,
  rad: 1,
  turn: Math.PI * 2,
}

/**
 * An authored `angle` parameter as radians, for a consumer that is GLSL rather than a stylesheet.
 *
 * `core/params.ts` normalises a bare `hue:30` to `30deg` but leaves an explicitly-united value
 * alone, so all four CSS angle units can arrive here. Parsed rather than fed through `params.num`,
 * which is documented as "bare number, or a percentage" and would answer the fallback for every
 * spelling an angle parameter actually accepts.
 *
 * @param raw - The validated parameter string, e.g. `"30deg"`, `"0.5turn"`.
 * @returns The angle in radians, or `0` for anything unparseable.
 * @complexity O(n) in string length.
 */
export function parseAngleRadians(raw: string | undefined): number {
  if (!raw) return 0
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(deg|grad|rad|turn)?$/i.exec(raw.trim())
  if (!match) return 0
  const value = parseFloat(match[1]!)
  if (!Number.isFinite(value)) return 0
  return value * (ANGLE_UNITS[(match[2] ?? 'deg').toLowerCase()] ?? ANGLE_UNITS.deg!)
}

/** How many palette stops the generative program's `u_colors` array holds. */
export const PALETTE_SIZE = 5

/**
 * The default palette, used when the author set fewer than two colours.
 *
 * A generator with no colours has to render *something*, and the honest choices are a grey ramp or
 * a chosen pair. Grey is what a broken effect looks like, so a bare `shader-gradient` would read as
 * a bug on first use — which is the one impression a new capability cannot afford. Two stops, so an
 * author who sets `color1` alone still gets their colour against a neutral rather than a surprise.
 */
const DEFAULT_PALETTE: [number, number, number, number][] = [
  [0.09, 0.11, 0.25, 1],
  [0.45, 0.29, 0.78, 1],
]

/**
 * The five palette stops as one flat `Float32Array`, plus how many are real.
 *
 * `colorCount` drives the ramp's segment count in GLSL, so the unset tail of the array is never
 * read — it is filled with the last real stop anyway rather than left at zero, because a driver
 * that clamps an index differently than expected should land on a colour that exists rather than
 * on black.
 *
 * @param authored - The five parameter strings in order, empty for unset.
 * @param createCanvas - Passed straight through to {@link parseColor}; see the note there.
 * @returns The flattened palette and the number of stops the ramp should span.
 * @complexity O(1) — the array is a fixed five entries.
 */
export function buildPalette(
  authored: string[],
  createCanvas?: ColorCanvasFactory,
): { palette: Float32Array; colorCount: number } {
  const set = authored.filter((raw) => raw.trim() !== '').slice(0, PALETTE_SIZE)
  const stops = set.length >= 2 ? set.map((raw) => parseColor(raw, createCanvas)) : [...DEFAULT_PALETTE]
  const palette = new Float32Array(PALETTE_SIZE * 4)
  for (let i = 0; i < PALETTE_SIZE; i += 1) {
    const stop = stops[Math.min(i, stops.length - 1)]!
    palette.set(stop, i * 4)
  }
  return { palette, colorCount: stops.length }
}

export const BLEND_MODES = {
  normal: 0,
  screen: 1,
  multiply: 2,
  add: 3,
}

export type ProgramOrLocations = ShaderProgramLocations | WebGLProgram | null

/**
 * Fill in this module's own uniform locations on first use, and remember the answers.
 *
 * `gl-utils.ts`'s `extractLocations` is the generic helper every caller shares and knows nothing
 * about this module's own uniforms, so the lookup happens here instead — once per program rather
 * than once per draw, with `undefined` meaning "not looked up yet" and `null` meaning "looked up,
 * the program does not declare it". Safe to cache on the record: a lost context rebuilds the
 * programs from scratch (`initPrograms`), so a stale location cannot outlive its program.
 *
 * `u_noise` joined `u_audio` here rather than in `extractLocations` for the same reason: it is
 * declared by four of the seven programs and means nothing to any other caller of the helper.
 */
function cacheLocalLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  program: WebGLProgram,
): ShaderProgramLocations {
  if (locs.u_audio === undefined) locs.u_audio = gl.getUniformLocation(program, 'u_audio')
  if (locs.u_noise === undefined) locs.u_noise = gl.getUniformLocation(program, 'u_noise')
  return locs
}

function resolveLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
): ShaderProgramLocations | null {
  if (!progInfo) return null
  if ('program' in progInfo && progInfo.program) return cacheLocalLocations(gl, progInfo, progInfo.program)
  const p = progInfo as WebGLProgram
  const g = (n: string) => gl.getUniformLocation(p, n)
  return {
    u_time: g('u_time'), u_strength: g('u_strength'), u_frequency: g('u_frequency'),
    u_chromatic: g('u_chromatic'), u_iridescence: g('u_iridescence'), u_mouse: g('u_mouse'),
    u_uvOrigin: g('u_uvOrigin'), u_uvScale: g('u_uvScale'), u_tint: g('u_tint'),
    u_blend: g('u_blend'), u_duotone: g('u_duotone'), u_color1: g('u_color1'),
    u_color2: g('u_color2'), u_image: g('u_image'), u_image_to: g('u_image_to'),
    u_progress: g('u_progress'), u_audio: g('u_audio'), u_noise: g('u_noise'),
    u_maskBox: g('u_maskBox'), u_maskRx: g('u_maskRx'), u_maskRy: g('u_maskRy'),
    u_maskAlpha: g('u_maskAlpha'),
    u_seed: g('u_seed'), u_scale: g('u_scale'), u_warp: g('u_warp'), u_grain: g('u_grain'),
    u_hue: g('u_hue'), u_detail: g('u_detail'), u_bands: g('u_bands'),
    u_colorCount: g('u_colorCount'), u_colors: g('u_colors'),
    // `u_maskMode` was missing from this branch while `extractLocations` looked it up, so an
    // external caller handing this module a bare `WebGLProgram` got a generative draw with no
    // stencil. Latent — everything inside this file goes through `extractLocations` — but the two
    // lists are supposed to answer the same question, and one of them was a stop short.
    u_maskMode: g('u_maskMode'),
    u_hover: g('u_hover'), u_backdrop: g('u_backdrop'),
    u_angle: g('u_angle'), u_motion: g('u_motion'),
  }
}

/** A zero half-extent is `shapeMask()`'s "no box measured" signal — see `SHAPE_MASK_GLSL`. */
const NO_MASK_BOX: [number, number, number, number] = [0, 0, 0, 0]

/** A zero alpha is the generative program's "no backdrop authored" test. */
const NO_BACKDROP: [number, number, number, number] = [0, 0, 0, 0]

/**
 * The element's own shape, uploaded unconditionally.
 *
 * Like `u_audio`, never left to the program's initial state: the five programs are shared by every
 * instance on the page, so a mask this instance skipped would keep whatever the last instance to
 * draw with the same `mode` put there — one rounded hero would round the square one beside it, and
 * one faded ancestor would fade a sibling that has none.
 */
function uploadMaskUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  opt: ShaderUniformOptions,
): void {
  if (locs.u_maskBox) gl.uniform4fv(locs.u_maskBox, opt.maskBox ?? NO_MASK_BOX)
  if (locs.u_maskRx) gl.uniform4fv(locs.u_maskRx, opt.maskRx ?? NO_MASK_BOX)
  if (locs.u_maskRy) gl.uniform4fv(locs.u_maskRy, opt.maskRy ?? NO_MASK_BOX)
  uploadFloat(gl, locs.u_maskAlpha, opt.maskAlpha ?? 1)
}

function uploadFloat(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  loc: WebGLUniformLocation | null | undefined,
  val: number | undefined,
): void {
  if (loc && val !== undefined) gl.uniform1f(loc, val)
}

function uploadInt(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  loc: WebGLUniformLocation | null | undefined,
  val: number | undefined,
): void {
  if (loc && val !== undefined) gl.uniform1i(loc, Math.round(val))
}

/**
 * The field's uniforms, uploaded unconditionally for the same reason `u_audio` is.
 *
 * `grain`, `hue`, `bands` and `maskMode` are still generative-only and find a `null` location in
 * every filter program, so they cost those modes nothing. `seed`, `scale`, `warp`, `detail` and
 * `noise` now land in `fluid`, `liquid`, `particles` and `morph` as well.
 *
 * It matters that none of these is ever skipped: a program is shared by every instance on the page
 * that uses it, so a uniform one instance left alone keeps whatever the last instance to draw put
 * there — two gradients on one page would trade seeds, and one `liquid` with `noise: 1` would hand
 * its field to the plain `liquid` next to it.
 */
/** Where in the noise field this instance samples, and how hard. */
function uploadFieldSamplingUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  opt: ShaderUniformOptions,
): void {
  uploadFloat(gl, locs.u_seed, opt.seed ?? 0)
  uploadFloat(gl, locs.u_scale, opt.scale ?? 1)
  uploadFloat(gl, locs.u_warp, opt.warp ?? 0)
  uploadFloat(gl, locs.u_noise, opt.noise ?? 0)
}

/** How much texture the sampled field carries, and what colour it comes out. */
function uploadFieldTextureUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  opt: ShaderUniformOptions,
): void {
  uploadFloat(gl, locs.u_grain, opt.grain ?? 0)
  uploadFloat(gl, locs.u_hue, opt.hue ?? 0)
  uploadInt(gl, locs.u_detail, opt.detail ?? 3)
  uploadInt(gl, locs.u_bands, opt.bands ?? 0)
}

/**
 * The four the program itself branches on: the stencil, the pointer gesture, and the direction and
 * kind of its motion. Each is a `if (u_x …)` or a `switch`-shaped test inside the shader, not a
 * scalar that scales something — see `glyphMask()` and the `u_motion` block in `glsl.ts`.
 */
function uploadFieldBranchUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  opt: ShaderUniformOptions,
): void {
  // Always uploaded, never left to the last instance that drew: `gradient` and `logo` share one
  // program, so a `gradient` that skipped this would inherit the stencil a `logo` beside it set
  // and sample a texture unit with nothing bound to it.
  uploadInt(gl, locs.u_maskMode, opt.maskMode ?? 0)
  uploadInt(gl, locs.u_hover, opt.hover ?? 0)
  uploadFloat(gl, locs.u_angle, opt.angle ?? 0)
  uploadInt(gl, locs.u_motion, opt.motion ?? 0)
}

function uploadFieldUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  opt: ShaderUniformOptions,
): void {
  uploadFieldSamplingUniforms(gl, locs, opt)
  uploadFieldTextureUniforms(gl, locs, opt)
  uploadFieldBranchUniforms(gl, locs, opt)
  // Here rather than in `uploadColorUniforms` with the palette, and unconditionally, for the same
  // reason as everything above it: one shared program means a skipped uniform keeps whatever the
  // last instance to draw left in it, so a `logo` with a plate would hand that plate to the bare
  // `gradient` beside it. `NO_BACKDROP`'s zero alpha is the shader's own "unset" test.
  if (locs.u_backdrop) gl.uniform4fv(locs.u_backdrop, opt.backdropRgba ?? NO_BACKDROP)
}

function uploadCoordUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ProgramLocations,
  opt: ShaderUniformOptions,
): void {
  if (locs.u_mouse && opt.localMouse) gl.uniform2f(locs.u_mouse, opt.localMouse.x, opt.localMouse.y)
  if (locs.u_uvOrigin && opt.uvOrigin) gl.uniform2f(locs.u_uvOrigin, opt.uvOrigin[0], opt.uvOrigin[1])
  if (locs.u_uvScale && opt.uvScale) gl.uniform2f(locs.u_uvScale, opt.uvScale[0], opt.uvScale[1])
}

export function uploadUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
  opt: ShaderUniformOptions,
): void {
  const locs = resolveLocations(gl, progInfo)
  if (!locs) return
  const timeVal = opt.time !== undefined ? opt.time * (opt.speed ?? 1) : undefined
  uploadFloat(gl, locs.u_time, timeVal)
  uploadFloat(gl, locs.u_strength, opt.strength)
  uploadFloat(gl, locs.u_frequency, opt.frequency)
  uploadFloat(gl, locs.u_chromatic, opt.chromatic)
  uploadFloat(gl, locs.u_iridescence, opt.iridescence)
  uploadFloat(gl, locs.u_progress, opt.progress ?? -1.0)
  // Always uploaded, never left to the program's initial state. The five programs are shared
  // between every instance on the page, so a uniform this instance skips keeps whatever the last
  // instance to draw with the same `mode` put there — an `audio:`-less shader would inherit a
  // neighbour's beat.
  uploadFloat(gl, locs.u_audio, opt.audio ?? 0)
  uploadCoordUniforms(gl, locs, opt)
  uploadMaskUniforms(gl, locs, opt)
  uploadFieldUniforms(gl, locs, opt)
}

function uploadDuotoneUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ProgramLocations,
  opt: ShaderUniformOptions,
): void {
  if (!opt.isDuotone) return
  if (locs.u_color1 && opt.c1Rgba) gl.uniform4fv(locs.u_color1, opt.c1Rgba)
  if (locs.u_color2 && opt.c2Rgba) gl.uniform4fv(locs.u_color2, opt.c2Rgba)
}

export function uploadColorUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
  opt: ShaderUniformOptions,
): void {
  const locs = resolveLocations(gl, progInfo)
  if (!locs) return
  if (locs.u_tint && opt.tintRgba) gl.uniform4fv(locs.u_tint, opt.tintRgba)
  if (locs.u_blend && opt.blendMode !== undefined) gl.uniform1i(locs.u_blend, opt.blendMode)
  if (locs.u_duotone) gl.uniform1f(locs.u_duotone, opt.isDuotone ? 1.0 : 0.0)
  uploadDuotoneUniforms(gl, locs, opt)
  if (locs.u_colors && opt.palette) gl.uniform4fv(locs.u_colors, opt.palette)
  uploadInt(gl, locs.u_colorCount, opt.colorCount)
}

function isRectVisible(rect: DOMRect, winHeight: number): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  return rect.bottom >= 0 && rect.top <= winHeight
}

function getScissorEnv(win?: AnyWindow): { height: number; dpr: number } {
  return {
    height: win?.innerHeight ?? 800,
    dpr: Math.min(win?.devicePixelRatio ?? 1, 2),
  }
}

/* ---------------------------------------------------------------------------
 * Matching the element the overlay replaces.
 *
 * The draw happens on one shared, full-viewport, fixed canvas, and the element it stands in for is
 * hidden — so everything the page does to that element has to be reproduced here or it is simply
 * lost. Before this layer the only geometry input was the border-box rect, which meant an
 * `object-fit: cover` hero was stretched the moment the shader turned on, rounded corners went
 * square, and a replica inside `overflow: hidden` painted straight through the clip.
 *
 * Reproduced: `object-fit`/`object-position` (as a UV window over the texture, so `cover` crops
 * exactly where CSS crops), border/padding insets, `border-radius` (masked in the fragment shader,
 * since one shared canvas cannot carry a per-element CSS radius), rectangular clipping ancestors,
 * and ancestor `opacity`.
 *
 * NOT reproduced, and not reproducible from a single fixed canvas: **stacking order.** The canvas
 * is one `position: fixed` layer for the whole page, so the replica cannot take the element's own
 * place in the stacking order — it takes the canvas's. The default is `z-index: 1`, which keeps it
 * above ordinary static content and below the page's own modals, sticky headers and toasts; a page
 * that needs it somewhere else moves it with `--kui-shader-z` (see {@link readShaderZIndex}).
 *
 * That knob lets one page cope. It does not close the ceiling: there is one canvas, so the value
 * moves every replica at once, and whatever is positioned above the new value now covers the
 * shaders instead. **A shader still cannot sit behind content that overlaps it** — at `z-index: 1`
 * a positioned card over a shader element paints on top of the replica, which is usually right and
 * is occasionally not what the author wanted. Fixing that properly means per-element canvases.
 *
 * Also unreproduced: a transformed ancestor
 * (the replica is drawn axis-aligned into the bounding box), a non-rectangular ancestor clip
 * (`clip-path`, `mask`, an ancestor's own `border-radius`), and the spec's uniform down-scaling of
 * overlapping corner radii (each corner is clamped on its own instead).
 * ------------------------------------------------------------------------- */

/** An axis-aligned box in viewport-relative CSS pixels. */
export interface Inset { left: number; top: number; right: number; bottom: number }

export interface ElementGeometry {
  /** Border box. What the corner mask is measured against. */
  border: Inset
  /** Where the replaced content would be painted if nothing clipped it. */
  paint: Inset
  /** Content box narrowed by every clipping ancestor. */
  clip: Inset
  /** Border-box corner radii, `[x, y]` per corner in TL, TR, BR, BL order. */
  radii: [number, number, number, number, number, number, number, number]
  /**
   * What the replica has to be painted at: the ancestors' opacities multiplied together, and the
   * element's own on top of them.
   *
   * The host's own used to be left out, on the reasoning that `opacity` is this module's to write —
   * but that confuses the property with the author's value for it. A `.hero { opacity: .25 }`
   * carrying a shader had its original hidden by `hideBehindRenderer` and its replica drawn at 1,
   * so the one element on the page that was meant to be a quarter visible was the only one at full
   * strength. See {@link hostAlpha} for how the author's value survives being overwritten.
   */
  alpha: number
  /**
   * The host's own opacity alone, already folded into {@link alpha}.
   *
   * Handed back so a caller can cache it. `hideBehindRenderer` writes `opacity: 0` on the very
   * element this is measured from, so from the second frame onwards a live read answers 0 — fold
   * that in and the replica vanishes, which leaves the host hidden behind nothing at all. The
   * instance therefore keeps the last value read while the element was still visible and passes it
   * back in; see `measureElementGeometry`'s `hostAlpha` parameter.
   */
  hostAlpha?: number
}

function numOr(raw: string | undefined | null, fallback = 0): number {
  const val = parseFloat(raw ?? '')
  return Number.isFinite(val) ? val : fallback
}

/**
 * `getComputedStyle` for one element, or `null` when this window cannot answer.
 *
 * Deliberately only the *passed* window: the unit suites hand the renderer plain
 * `{ innerHeight, devicePixelRatio }` doubles and mock elements that are not in any document, and
 * reaching past them to `el.ownerDocument.defaultView` would quietly put those cases on a code
 * path the caller did not ask for. No computed style means "fall back to the border box", which is
 * exactly the behaviour this layer replaced.
 */
function cssStyleOf(el: Element, win: AnyWindow): CSSStyleDeclaration | null {
  const gcs = (win as Window | null)?.getComputedStyle
  if (typeof gcs !== 'function') return null
  try {
    return gcs.call(win, el)
  } catch {
    return null
  }
}

function boxOf(rect: DOMRect): Inset {
  return { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height }
}

function intersectBox(a: Inset, b: Inset): Inset {
  return {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  }
}

/** `box` pulled inward by `by`, whose four fields are edge thicknesses rather than coordinates. */
function insetBox(box: Inset, by: Inset): Inset {
  return {
    left: box.left + by.left, top: box.top + by.top,
    right: box.right - by.right, bottom: box.bottom - by.bottom,
  }
}

function borderWidthsOf(cs: CSSStyleDeclaration): Inset {
  return {
    left: numOr(cs.borderLeftWidth), top: numOr(cs.borderTopWidth),
    right: numOr(cs.borderRightWidth), bottom: numOr(cs.borderBottomWidth),
  }
}

function contentBoxOf(rect: DOMRect, cs: CSSStyleDeclaration | null): Inset {
  const border = boxOf(rect)
  if (!cs) return border
  const edges = borderWidthsOf(cs)
  return insetBox(border, {
    left: edges.left + numOr(cs.paddingLeft), top: edges.top + numOr(cs.paddingTop),
    right: edges.right + numOr(cs.paddingRight), bottom: edges.bottom + numOr(cs.paddingBottom),
  })
}

/** The size `object-fit` paints the intrinsic image at inside a `bw` x `bh` content box. */
function fittedSize(fit: string, bw: number, bh: number, natural: [number, number]): [number, number] {
  const [iw, ih] = natural
  if (fit === 'cover') {
    const s = Math.max(bw / iw, bh / ih)
    return [iw * s, ih * s]
  }
  if (fit === 'none') return [iw, ih]
  if (fit === 'contain' || fit === 'scale-down') {
    const s = Math.min(bw / iw, bh / ih, fit === 'scale-down' ? 1 : Infinity)
    return [iw * s, ih * s]
  }
  return [bw, bh]
}

const POSITION_KEYWORDS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }

/** One axis of `object-position`: how far the painted box sits inside the content box, in px. */
function positionOffset(token: string, free: number): number {
  const keyword = POSITION_KEYWORDS[token]
  if (keyword !== undefined) return free * keyword
  if (token.endsWith('%')) return free * (numOr(token) / 100)
  return numOr(token, free * 0.5)
}

function paintBoxOf(content: Inset, natural: [number, number] | null, cs: CSSStyleDeclaration | null): Inset {
  if (!natural || !cs) return content
  const bw = content.right - content.left
  const bh = content.bottom - content.top
  if (bw <= 0 || bh <= 0) return content
  const [dw, dh] = fittedSize(cs.objectFit || 'fill', bw, bh, natural)
  const tokens = (cs.objectPosition || '50% 50%').trim().split(/\s+/)
  const left = content.left + positionOffset(tokens[0] ?? '50%', bw - dw)
  const top = content.top + positionOffset(tokens[1] ?? '50%', bh - dh)
  return { left, top, right: left + dw, bottom: top + dh }
}

function radiusPart(token: string | undefined, basis: number): number {
  if (!token) return 0
  return token.endsWith('%') ? Math.max(0, basis * (numOr(token) / 100)) : Math.max(0, numOr(token))
}

/** One corner's `[x, y]` radii in px. A computed percentage resolves against the border box. */
function cornerRadius(raw: string | undefined, bw: number, bh: number): [number, number] {
  const parts = (raw ?? '').trim().split(/\s+/)
  return [radiusPart(parts[0], bw), radiusPart(parts[1] ?? parts[0], bh)]
}

function radiiOf(cs: CSSStyleDeclaration | null, rect: DOMRect): ElementGeometry['radii'] {
  if (!cs) return [0, 0, 0, 0, 0, 0, 0, 0]
  const w = rect.width, h = rect.height
  const tl = cornerRadius(cs.borderTopLeftRadius, w, h)
  const tr = cornerRadius(cs.borderTopRightRadius, w, h)
  const br = cornerRadius(cs.borderBottomRightRadius, w, h)
  const bl = cornerRadius(cs.borderBottomLeftRadius, w, h)
  return [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]
}

function naturalSizeOf(el: HTMLElement): [number, number] | null {
  const { naturalWidth: w, naturalHeight: h } = el as HTMLImageElement
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return null
  return [w, h]
}

function isClipping(cs: CSSStyleDeclaration): boolean {
  for (const overflow of [cs.overflowX, cs.overflowY]) {
    if (overflow && overflow !== 'visible') return true
  }
  return false
}

/** How many levels of ancestor the clip/opacity walk climbs before giving up. */
const ANCESTOR_WALK_LIMIT = 12

/** Whether this element is a containing block for an out-of-flow descendant. */
function isContainingBlock(cs: CSSStyleDeclaration): boolean {
  if (cs.position && cs.position !== 'static') return true
  return [cs.transform, cs.filter, cs.perspective].some((v) => v && v !== 'none')
}

/**
 * Whether `position`'s overflow reaches a descendant whose own used `position` is `subject`.
 *
 * `overflow` clips a descendant only when the scroller is in that descendant's containing-block
 * chain, which is what stopped the first version of this walk working at all: every element in the
 * GL fixture is `position: absolute` under a `body { overflow: hidden }` whose height collapses to
 * zero, so treating body as a clip left nothing to draw anywhere. Real browsers do not clip those
 * elements, because a static body is not their containing block.
 */
function clipsSubject(subject: string, cs: CSSStyleDeclaration): boolean {
  if (subject === 'fixed') return false
  if (subject === 'absolute') return isContainingBlock(cs)
  return true
}

function narrowByAncestor(acc: { clip: Inset; alpha: number; subject: string }, node: HTMLElement, win: AnyWindow): void {
  const cs = cssStyleOf(node, win)
  if (!cs) return
  const opacity = numOr(cs.opacity, 1)
  if (opacity < 1) acc.alpha *= Math.max(0, opacity)
  if (clipsSubject(acc.subject, cs)) {
    const rect = isClipping(cs) ? node.getBoundingClientRect?.() : null
    if (rect) acc.clip = intersectBox(acc.clip, insetBox(boxOf(rect), borderWidthsOf(cs)))
    // Past its containing block, the subject for the levels above is this element itself.
    acc.subject = cs.position || 'static'
  }
}

/**
 * Narrow `start` by every clipping ancestor, and collect the opacity they are painted at.
 *
 * One `getComputedStyle` per ancestor per measurement, capped at {@link ANCESTOR_WALK_LIMIT}
 * levels. Affordable only because every measurement happens in the renderer's read pass, before
 * any instance writes a style (see `renderFrame`) — interleaved with writes this would force a
 * style recalculation per level.
 */
function walkAncestors(el: HTMLElement, win: AnyWindow, start: Inset, subject: string): { clip: Inset; alpha: number } {
  const acc = { clip: start, alpha: 1, subject }
  let node: HTMLElement | null = el.parentElement ?? null
  for (let depth = 0; node && depth < ANCESTOR_WALK_LIMIT; depth++) {
    narrowByAncestor(acc, node, win)
    node = node.parentElement ?? null
  }
  return acc
}

/**
 * Everything about one element's box the draw has to reproduce, in CSS pixels.
 *
 * Pure reads, no GL and no canvas: the device-pixel conversion needs the canvas dimensions and
 * happens later, in {@link resolveDrawBox}, so that a caller can measure once per frame in the
 * read pass and draw from the cached answer.
 *
 * @param el - The element the shader stands in for.
 * @param win - The window whose `innerHeight`/`devicePixelRatio`/`getComputedStyle` to use.
 * @param fullBox - Paint to the border box instead of the content box. What a *generated* image
 *   wants: it is a background, and backgrounds paint to the border box, so measuring the content
 *   box would inset the field by the element's border and padding while `radiiOf` keeps measuring
 *   the corner mask against the border box — visibly mismatched corners on any padded host.
 *   The replaced-content path (every image filter) must keep the content box, because that is the
 *   box `object-fit` resolves against.
 * @param hostAlpha - The element's own opacity, for a caller that already hid it. Omitted means
 *   "read it live", which is right up to the first `hideBehindRenderer` and right forever for a
 *   generative mode, which never hides its host. After that the live value is this module's own
 *   `0` and the author's has to be supplied from the caller's cache.
 * @returns Its geometry, or `null` when it is not on screen at all.
 * @complexity O(d) in ancestor depth, capped at {@link ANCESTOR_WALK_LIMIT}.
 */
export function measureElementGeometry(
  el: HTMLElement,
  win?: AnyWindow,
  fullBox = false,
  hostAlpha?: number,
): ElementGeometry | null {
  const rect = el.getBoundingClientRect()
  const { height } = getScissorEnv(win)
  if (!isRectVisible(rect, height)) return null
  const view = win ?? null
  const cs = cssStyleOf(el, view)
  const border = boxOf(rect)
  const content = fullBox ? border : contentBoxOf(rect, cs)
  const walked = walkAncestors(el, view, content, cs?.position || 'static')
  const own = Math.max(0, Math.min(1, hostAlpha ?? numOr(cs?.opacity, 1)))
  return {
    border,
    paint: fullBox ? border : paintBoxOf(content, naturalSizeOf(el), cs),
    clip: walked.clip,
    radii: radiiOf(cs, rect),
    alpha: walked.alpha * own,
    hostAlpha: own,
  }
}

export interface ScissorResult {
  rect: DOMRect
  uvOrigin: [number, number]
  uvScale: [number, number]
  /** Border-box centre and half-extents in device px, y measured up from the canvas bottom. */
  maskBox: [number, number, number, number]
  /** Corner x-radii in device px, TL, TR, BR, BL — matching `maskRy`. */
  maskRx: [number, number, number, number]
  maskRy: [number, number, number, number]
  alpha: number
}

function maskUniformsOf(geom: ElementGeometry, canvasHeight: number, dpr: number): {
  maskBox: [number, number, number, number]
  maskRx: [number, number, number, number]
  maskRy: [number, number, number, number]
} {
  const b = geom.border
  const r = geom.radii
  return {
    maskBox: [
      (b.left + b.right) * 0.5 * dpr,
      canvasHeight - (b.top + b.bottom) * 0.5 * dpr,
      (b.right - b.left) * 0.5 * dpr,
      (b.bottom - b.top) * 0.5 * dpr,
    ],
    maskRx: [r[0] * dpr, r[2] * dpr, r[4] * dpr, r[6] * dpr],
    maskRy: [r[1] * dpr, r[3] * dpr, r[5] * dpr, r[7] * dpr],
  }
}

/**
 * Turn one element's CSS-pixel geometry into a scissor rect and the UV window over its texture.
 *
 * The UV window is what makes `object-fit` work: the quad only ever covers the part of the painted
 * box that survives clipping, and `uvOrigin`/`uvScale` say which part of the *image* that is. A
 * `cover` hero therefore samples the same crop CSS shows, and a half-off-screen element samples
 * its visible half, through one mechanism rather than two.
 *
 * @returns `null` when nothing of the element is left to draw.
 * @complexity O(1).
 */
export function resolveDrawBox(
  geom: ElementGeometry,
  canvas: HTMLCanvasElement,
  dpr: number,
): (ScissorResult & { sx: number; sy: number; sw: number; sh: number }) | null {
  const paintW = geom.paint.right - geom.paint.left
  const paintH = geom.paint.bottom - geom.paint.top
  if (paintW <= 0 || paintH <= 0) return null
  const view: Inset = { left: 0, top: 0, right: canvas.width / dpr, bottom: canvas.height / dpr }
  const draw = intersectBox(intersectBox(geom.paint, geom.clip), view)
  const drawW = draw.right - draw.left
  const drawH = draw.bottom - draw.top
  if (drawW <= 0 || drawH <= 0) return null

  const sx = Math.round(draw.left * dpr)
  const sy = Math.round(canvas.height - draw.bottom * dpr)
  const sw = Math.min(canvas.width - sx, Math.round(drawW * dpr))
  const sh = Math.min(canvas.height - sy, Math.round(drawH * dpr))
  if (sw <= 0 || sh <= 0) return null

  const b = geom.border
  return {
    sx, sy, sw, sh,
    rect: { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top } as DOMRect,
    uvOrigin: [(draw.left - geom.paint.left) / paintW, (draw.top - geom.paint.top) / paintH],
    uvScale: [drawW / paintW, drawH / paintH],
    alpha: geom.alpha,
    ...maskUniformsOf(geom, canvas.height, dpr),
  }
}

/**
 * Measure `el`, point the viewport and scissor box at it, and hand back its UV window.
 *
 * Kept as one call for the unit suites and for any caller that has no cached geometry; the render
 * loop measures in its read pass instead and passes the result in as
 * {@link ShaderDrawOptions.geometry}.
 */
export function setupScissor(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  el: HTMLElement,
  canvas: HTMLCanvasElement,
  win?: AnyWindow,
): ScissorResult | null {
  const geom = measureElementGeometry(el, win)
  if (!geom) return null
  return applyDrawBox(gl, canvas, geom, getScissorEnv(win).dpr)
}

function applyDrawBox(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  geom: ElementGeometry,
  dpr: number,
): ScissorResult | null {
  const box = resolveDrawBox(geom, canvas, dpr)
  if (!box) return null
  gl.enable(gl.SCISSOR_TEST)
  gl.viewport(box.sx, box.sy, box.sw, box.sh)
  gl.scissor(box.sx, box.sy, box.sw, box.sh)
  return box
}

export function bindShaderTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
  texture: WebGLTexture | null | undefined,
  toTexture?: WebGLTexture | null | undefined,
): void {
  if (!texture) return
  const locs = resolveLocations(gl, progInfo)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  if (locs?.u_image) gl.uniform1i(locs.u_image, 0)
  if (locs?.u_image_to) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, toTexture || texture)
    gl.uniform1i(locs.u_image_to, 1)
  }
}

function getProgram(info: ProgramLocations | WebGLProgram | null | undefined): WebGLProgram | null {
  if (!info) return null
  return ('program' in info && info.program ? info.program : info) as WebGLProgram
}

/**
 * The pointer in this element's own 0..1 space, or its centre while there has been no pointer.
 *
 * `renderer.mouse` starts at the **viewport origin**, which is not a neutral value: clamped into an
 * element's box it lands on the top-left corner for every element on the page that is not touching
 * `(0, 0)`. `displace` decays its ripple by `exp(-4 * d)` from that point, so before the first
 * `pointermove` the entire visible effect was a few sub-pixel device pixels in one corner — on
 * load, on a phone where no `pointermove` is ever coming, and in every screenshot. The mode read as
 * dead, and `strength:` looked like it did nothing.
 *
 * The centre is the honest answer to "where is the pointer" when there isn't one, and it is the
 * only one under which these programs show what they do. A real pointer event takes over from the
 * first frame after it arrives.
 *
 * @complexity O(1).
 */
function computeMousePos(renderer: ShaderRendererLike, rect: DOMRect): { x: number; y: number } {
  if (renderer.hasPointer === false) return { x: 0.5, y: 0.5 }
  const mx = renderer.mouse.x - rect.left
  const my = renderer.mouse.y - rect.top
  return {
    x: clamp(mx / rect.width, 0, 1),
    y: clamp(my / rect.height, 0, 1),
  }
}

function bindQuadAttrib(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  quadBuffer: WebGLBuffer | null,
  info: ProgramLocations | WebGLProgram | null | undefined,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  const locs = info as ProgramLocations | undefined
  if (locs?.a_position !== undefined && locs.a_position !== -1) {
    gl.enableVertexAttribArray(locs.a_position)
    gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 0, 0)
  }
}

/**
 * The three things a draw cannot start without, or `null`.
 *
 * `quadBuffer` belongs here with the context and the canvas, and used not to be checked at all. It
 * is the six vertices every program in this module draws, and `gl.createBuffer()` answers `null`
 * under memory pressure rather than throwing; without it `vertexAttribPointer` and `drawArrays`
 * paint nothing and merely set a GL error, and `drawElementQuad` fell through to its unconditional
 * `return true`. The caller reads that as "the replica is up" and hides the element — so a failed
 * allocation did not cost a page its effect, it cost the page its images. `init()` now refuses to
 * come up without the buffer; this covers a context restored into the same failure.
 */
function drawTargets(
  renderer: ShaderRendererLike,
): { gl: WebGLRenderingContext | WebGL2RenderingContext; canvas: HTMLCanvasElement } | null {
  const { gl, canvas, quadBuffer } = renderer
  return gl && canvas && quadBuffer ? { gl, canvas } : null
}

export function drawElementQuad(
  renderer: ShaderRendererLike,
  el: HTMLElement,
  opt: Partial<ShaderDrawOptions> = {},
): boolean {
  const target = drawTargets(renderer)
  if (!target) return false
  const { gl, canvas } = target

  const mode = opt.mode ?? 'displace'
  const info = renderer.programs[mode]
  if (info === undefined) return false
  const program = getProgram(info)
  if (!program) return false

  // The measured geometry when the render loop already took it this frame (the normal path), or a
  // fresh measurement for a caller that has none. `null` is a measurement — "off screen, nothing
  // to draw" — and must not send us back to the DOM for the same answer every frame.
  const geom = opt.geometry !== undefined
    ? opt.geometry
    : measureElementGeometry(el, renderer.window, GENERATIVE_MODES.has(mode))
  if (!geom) return false
  const scissor = applyDrawBox(gl, canvas, geom, getScissorEnv(renderer.window).dpr)
  if (!scissor) return false

  const localMouse = computeMousePos(renderer, scissor.rect)
  gl.useProgram(program)
  bindShaderTexture(gl, info, opt.texture, opt.toTexture)
  uploadUniforms(gl, info, {
    ...opt,
    localMouse,
    uvOrigin: scissor.uvOrigin,
    uvScale: scissor.uvScale,
    maskBox: scissor.maskBox,
    maskRx: scissor.maskRx,
    maskRy: scissor.maskRy,
    maskAlpha: scissor.alpha,
  })
  uploadColorUniforms(gl, info, opt)

  bindQuadAttrib(gl, renderer.quadBuffer, info)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  return true
}

export type ShaderParamAccessor = EffectParams | {
  keyword?: (name: string) => string
  text: (name: string, fallback?: string) => string
  num: (name: string, fallback?: number) => number
}

/**
 * Modes that generate their image from mathematics rather than sampling a source.
 *
 * Three behaviours key off this set, and each one is a place the filter assumption is baked in:
 *
 * 1. **The texture requirement.** `drawCall`'s `drew = !!texture && …` is the single line that made
 *    every mode a filter — no loaded `<img>`, no draw. A generator has no source to wait for.
 * 2. **Hiding the host.** A filter stands in for the element it replaces, so hiding it is right. A
 *    generator is drawn over an element the author may have put content in, so hiding it would
 *    destroy that content to no purpose.
 * 3. **The quad's box.** A generator is a background, and backgrounds paint to the border box; the
 *    replaced-content path measures the content box, which insets by border and padding while the
 *    corner mask still measures the border box.
 */
export const GENERATIVE_MODES = new Set(['gradient'])

/**
 * Every mode the `mode:` keyword accepts, in one list.
 *
 * The single source for `SHADER_PARAMETERS.mode.keywords` *and* for `prepareShaders`' gate; they
 * were two literals before, which is one edit away from a keyword the gate rejects.
 *
 * `logo` is deliberately **not** in {@link GENERATIVE_MODES}. It generates its colour, but it
 * behaves in every other respect exactly like the five filters: its texture is required (the
 * image is the stencil), its host is hidden (the field replaces it), and it measures the content
 * box so `object-fit` resolves the way it does for `displace`. That is what made it the mode that
 * needed no structural change to ship.
 */
export const SHADER_MODES = ['displace', 'fluid', 'liquid', 'particles', 'morph', 'gradient', 'logo'] as const

/**
 * Which fragment source serves which modes.
 *
 * `gradient` and `logo` are one program reached by two names — `u_maskMode` is the entire
 * difference, and a second copy of the noise core is how this directory acquired three
 * near-identical fbm implementations the first time.
 */
const PROGRAM_SOURCES: readonly (readonly [readonly string[], string])[] = [
  [['displace'], DISPLACE_FS],
  [['fluid'], FLUID_FS],
  [['liquid'], LIQUID_FS],
  [['particles'], PARTICLES_FS],
  [['morph'], MORPH_FS],
  [['gradient', 'logo'], GRADIENT_FS],
]

/**
 * `mask:` as the `u_maskMode` the generative program branches on. See `glyphMask()` in `glsl.ts`.
 *
 * `gradient` is pinned to `0` whatever the author wrote: there is no texture bound in that mode,
 * so a stencil is not a thing it can have, and silently honouring `mask:` there would produce a
 * black rectangle rather than a warning.
 */
export const MASK_MODES: Record<string, number> = { alpha: 1, luma: 2, 'luma-invert': 3 }

/**
 * `hover:` as the bitfield `u_hover` tests — `both` is `stir | light` and not a third code path.
 *
 * Bits rather than four ordinals because the shader's two gestures act at different stages (one on
 * the sample coordinate, one on the colour that coordinate produced), so `both` is genuinely the
 * two of them and there is nothing for a third branch to say.
 */
export const HOVER_MODES: Record<string, number> = { none: 0, stir: 1, light: 2, both: 3 }

/**
 * `motion:` as the int `u_motion` branches on.
 *
 * `evolve` is `0` and is the default, because it is what this program has always done: time as the
 * noise field's third axis, the pattern changing in place. `drift` and `swirl` are additions on
 * top of it. See {@link SHADER_PARAMETERS.motion} for why the inert keyword had to exist.
 */
export const MOTION_MODES: Record<string, number> = { evolve: 0, drift: 1, swirl: 2 }

/**
 * `mode:` read through the validating accessor when there is one, and off the raw text when there
 * is not — an external caller may hand this module the bare `{ text, num }` shape.
 */
function readShaderMode(params: ShaderParamAccessor): string {
  return ('keyword' in params && typeof params.keyword === 'function')
    ? params.keyword('mode')
    : params.text('mode', 'displace')
}

/**
 * `mask:` as `u_maskMode`, pinned off outside `logo`: `gradient` binds no texture, and every filter
 * mode's program declares no `u_maskMode` at all, so honouring `mask:` there could only mislead.
 */
function readMaskMode(params: ShaderParamAccessor, mode: string): number {
  return mode === 'logo' ? (MASK_MODES[params.text('mask', 'alpha')] ?? MASK_MODES.alpha!) : 0
}

/**
 * The duotone pair, and whether the author authored one at all.
 *
 * Duotone is on only when *both* stops were written — one colour is a tint, not a pair — but each
 * stop still parses against its own fallback so the uniforms are never left undefined.
 */
function readDuotoneColors(c1Text: string, c2Text: string, createCanvas?: ColorCanvasFactory): {
  isDuotone: boolean
  c1Rgba: [number, number, number, number]
  c2Rgba: [number, number, number, number]
} {
  return {
    isDuotone: Boolean(c1Text && c2Text),
    c1Rgba: parseColor(c1Text || '#000000', createCanvas),
    c2Rgba: parseColor(c2Text || '#ffffff', createCanvas),
  }
}

/**
 * @param params - The authored parameters.
 * @param createCanvas - The env's canvas source, threaded to every colour parse below. Optional
 *   because a caller holding nothing but an accessor is a supported shape, and the colours it
 *   authored are overwhelmingly hex; `prepareShaders` resolves its env first and passes it, so the
 *   one path that reaches a real page never falls back.
 */
export function extractShaderOptions(
  params: ShaderParamAccessor,
  createCanvas?: ColorCanvasFactory,
): ShaderDrawOptions {
  const mode = readShaderMode(params)
  const c1Text = params.text('color1', '')
  const c2Text = params.text('color2', '')
  const backdropText = params.text('backdrop', '').trim()
  const blendMap: Record<string, number> = { normal: 0, screen: 1, multiply: 2, add: 3 }
  const { palette, colorCount } = buildPalette([
    c1Text, c2Text, params.text('color3', ''), params.text('color4', ''), params.text('color5', ''),
  ], createCanvas)

  return {
    mode,
    seed: params.num('seed', 0),
    scale: params.num('scale', 1),
    warp: params.num('warp', 0),
    noise: params.num('noise', 0),
    grain: params.num('grain', 0),
    hue: parseAngleRadians(params.text('hue', '0deg')),
    detail: params.num('detail', 3),
    bands: params.num('bands', 0),
    palette,
    colorCount,
    maskMode: readMaskMode(params, mode),
    hover: HOVER_MODES[params.text('hover', 'none')] ?? 0,
    angle: parseAngleRadians(params.text('angle', '0deg')),
    motion: MOTION_MODES[params.text('motion', 'evolve')] ?? 0,
    // Read through the raw string rather than straight into `parseColor`, which answers opaque
    // white for an empty input — the fallback that makes an unset `color1` harmless would make an
    // unset `backdrop` a white plate behind every logo on the page.
    backdropRgba: backdropText ? parseColor(backdropText, createCanvas) : [0, 0, 0, 0],
    strength: params.num('strength', 0.5),
    speed: params.num('speed', 1.0),
    frequency: params.num('frequency', 10.0),
    chromatic: params.num('chromatic', 0.0),
    iridescence: params.num('iridescence', 0.0),
    tintRgba: parseColor(params.text('tint', '#ffffff'), createCanvas),
    ...readDuotoneColors(c1Text, c2Text, createCanvas),
    blendMode: blendMap[params.text('blend', 'normal')] ?? 0,
    to: params.text('to', ''),
    progress: params.num ? params.num('progress', -1) : -1,
    // Compared against the one enabling word rather than "not `off`", so — exactly as with
    // `audioBand` below — a caller passing an unvalidated accessor, or an author who typed
    // `scrub: scrol`, cannot turn the bridge on by accident.
    scrubsFromScroll: params.text('scrub', 'off') === 'scroll',
    // `parseAudioBand` answers `null` for `off`, for an empty string, and for any word that is not
    // a band, so a caller passing an unvalidated accessor cannot turn the feature on by accident.
    audioBand: parseAudioBand(params.text('audio', 'off')),
  }
}

function parseProgressValue(raw: string | undefined | null): number | null {
  if (!raw) return null
  const val = parseFloat(raw)
  return Number.isFinite(val) ? clamp(val, 0, 1) : null
}

/**
 * This element's scroll/scrub progress, or -1 when nothing has declared one.
 *
 * **Only called for an instance that authored `scrub: scroll`** — see `readInputs`. Reading it
 * unasked is what the parameter exists to stop: the fallback below means an *ancestor's*
 * `scroll-progress` reaches this element, and at the top of a scroll range that value is `0`,
 * which every program treats as "no effect". A shader anywhere inside a scrollytelling section
 * therefore rendered a pixel-faithful copy of its own source and looked dead, with no way to say
 * no. The `audio:` parameter twelve lines below the schema entry had already been written against
 * exactly this failure; the scroll channel simply never got the same gate.
 *
 * Checks the element's own inline style first — the fast path, and the only one that mattered
 * while a shader element could only ever read a scroll-mechanics primitive on itself. Falling back
 * to `getComputedStyle` is what makes an *ancestor's* primitive reach it too: `--kui-progress` is
 * an ordinary, unregistered custom property (nothing in this codebase declares it with
 * `@property`), so it inherits down the DOM tree by default — a `scroll-progress` element three
 * levels up is already visible to `getComputedStyle` on this element without this module doing
 * anything special, once something here actually asks.
 *
 * Callers must not call this once per element as each one draws; see `SharedShaderRenderer`'s
 * `progressReaders` pass, which reads every registered instance's progress before any instance's
 * draw call runs and can write a style. Reading and writing style in the same pass across several
 * elements would force a style recalculation per element instead of at most once per frame.
 *
 * @complexity O(1) time (one inline read, at most one computed-style read); O(1) space.
 */
export function readElementProgress(el: HTMLElement): number {
  const fromInline = parseProgressValue(el.style?.getPropertyValue?.('--kui-progress'))
  if (fromInline !== null) return fromInline
  const view = el.ownerDocument?.defaultView
  const fromComputed = parseProgressValue(view?.getComputedStyle?.(el).getPropertyValue('--kui-progress'))
  return fromComputed !== null ? fromComputed : -1
}

let nextShaderId = 0

/**
 * Run one registered instance's context callback without letting it take the renderer with it.
 *
 * These callbacks belong to whichever effect registered them, and they run inside two loops that
 * every other instance depends on: the `webglcontextlost` fan-out, and `renderFrame`'s per-draw
 * error path. An unguarded throw from one of them escaped both — it skipped every instance after
 * it in the fan-out, abandoned the remaining draw calls for that frame, and returned before
 * `startLoop`/the tick could schedule the next one, so the whole canvas went quiet over a single
 * effect's failing cleanup.
 *
 * Swallowed rather than reported: this is already the failure path, and there is no one to tell.
 *
 * @param fn - The callback, wrapped by the caller so it keeps its own closure.
 * @complexity O(1) plus the callback.
 */
function invokeIsolated(fn: () => void): void {
  try {
    fn()
  } catch {
    return
  }
}

/**
 * Keep the backing store and the CSS box measuring the same viewport.
 *
 * The backing store is sized from `innerWidth`/`innerHeight` — the same quantity
 * `getBoundingClientRect` answers in — so the CSS box has to be pinned to those numbers too. It
 * used to be `width:100vw;height:100vh` in the canvas's `cssText`, and on a phone `100vh` is the
 * *large* viewport (URL bar hidden) while `innerHeight` is the *visual* one: the browser then
 * scaled the backing store to fit, and a pixel written at `rect.top * dpr` landed at
 * `rect.top * (100vh / innerHeight)`. On iOS Safari with the toolbar showing that is an element
 * 600px down the viewport drawn ~80px below where it actually is, sliding as the toolbar collapses.
 * Desktop never saw it, which is why it survived five reviews.
 */
function syncCanvasDimensions(canvas: HTMLCanvasElement, win: AnyWindow, dpr: number): void {
  const vw = win?.innerWidth ?? 1000
  const vh = win?.innerHeight ?? 800
  const cw = Math.round(vw * dpr)
  const ch = Math.round(vh * dpr)
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  const style = canvas.style
  if (!style) return
  const cssW = `${vw}px`
  const cssH = `${vh}px`
  if (style.width !== cssW) style.width = cssW
  if (style.height !== cssH) style.height = cssH
}

/**
 * Where the shared canvas sits in the page's stacking order when the author says nothing.
 *
 * **Deliberately low.** This was `9999` and the defence written for it — that anything lower hides
 * the replica behind a positioned card — does not survive examination: a positioned card that
 * overlaps a shader element probably *should* paint on top, which is stacking working rather than
 * stacking broken. What `9999` actually bought was the shared canvas painting over the page's own
 * modals, sticky headers and toasts, which is unambiguously wrong and is the bug that was filed.
 *
 * `1` rather than `0` or `auto` so the canvas still sits above the page's ordinary static content,
 * which is the one thing it does have to do.
 */
export const DEFAULT_SHADER_Z_INDEX = 1

/** The custom property an author sets to move the shared canvas. See {@link readShaderZIndex}. */
export const SHADER_Z_PROPERTY = '--kui-shader-z'

/**
 * The author's stacking order for the shared canvas, or {@link DEFAULT_SHADER_Z_INDEX}.
 *
 * ```css
 * :root { --kui-shader-z: 500; }
 * ```
 *
 * One line in the page's own stylesheet, no JS and no build step — custom properties inherit, so a
 * value on `:root` reaches a canvas this module created even though no stylesheet can name it.
 *
 * **Why not a `data-kui` parameter.** `SharedShaderRenderer` keeps *one* canvas for the whole page.
 * A per-element `zIndex:` would look per-element and silently not be — two shader elements asking
 * for different values, last writer wins, and the loser has no way to tell. That is the "one key,
 * two meanings" failure `core/types.ts` already documents. A page-level object gets a page-level
 * knob.
 *
 * **This does not close the architectural ceiling.** Moving the number lets *one page cope*; it
 * still does not let a shader sit *behind* content in any general way. There is one canvas, so the
 * value moves every replica on the page at once, and whatever is positioned above the new number
 * now covers the shaders instead. A shader that genuinely composes with the content over it needs
 * per-element canvases, which is a decision that has not been made. See `docs/advanced-modules.md`.
 *
 * Read the same shape as `readElementProgress`: inline first, computed as the fallback, so a value
 * set in a stylesheet reaches it. Anything that is not a finite number — `auto`, a `var()` that
 * resolved to nothing, junk — falls back to the default rather than writing a broken `z-index`.
 *
 * @complexity O(1): one inline read and at most one computed-style read, once per canvas.
 */
export function readShaderZIndex(doc: AnyDocument, win: AnyWindow): number {
  // `DocumentLike` is the minimum this tier's test envs implement and does not carry
  // `documentElement`; a real `Document` always does. Absent, the default stands.
  const root = (doc as unknown as { documentElement?: HTMLElement | null } | null)?.documentElement
  if (!root) return DEFAULT_SHADER_Z_INDEX
  const inline = parseZIndexValue(root.style?.getPropertyValue?.(SHADER_Z_PROPERTY))
  return inline ?? readComputedZIndex(root, win) ?? DEFAULT_SHADER_Z_INDEX
}

/** The stylesheet half of {@link readShaderZIndex} — the read that can force a style recalc. */
function readComputedZIndex(root: HTMLElement, win: AnyWindow): number | null {
  return parseZIndexValue(win?.getComputedStyle?.(root)?.getPropertyValue?.(SHADER_Z_PROPERTY))
}

/** A `z-index` an author wrote, or `null` for "nothing usable here". */
function parseZIndexValue(raw: string | undefined | null): number | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export type ShaderDrawFn = (gl: WebGLRenderingContext | WebGL2RenderingContext, timeSeconds: number) => void

/**
 * Singleton WebGL2 Renderer.
 */
export class SharedShaderRenderer {
  env: AdvancedEnv
  window: AnyWindow
  document: AnyDocument
  createCanvas: () => HTMLCanvasElement | null
  raf: RafFunction
  caf: CafFunction
  canvas: HTMLCanvasElement | null = null
  gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
  quadBuffer: WebGLBuffer | null = null
  rafId: number | null = null
  drawCalls = new Map<string, ShaderDrawFn>()
  contextCallbacks = new Map<string, { onLost: () => void; onRestored: () => void }>()
  /**
   * One style-reading pass per registered instance — scroll progress and, when the author asked
   * for one, an audio band — run in full before any instance's draw call this frame. See
   * `renderFrame` for why the ordering, not just the reads themselves, is the point.
   */
  inputReaders = new Map<string, () => void>()
  programs: Record<string, ShaderProgramLocations | null> = {}
  refCount = 0
  mouse = { x: 0, y: 0 }
  /** Cleared until a real `pointermove` lands. See {@link computeMousePos}. */
  hasPointer = false
  isContextLost = false
  /**
   * Bumped every time this renderer's GL objects stop being valid, i.e. on each context loss.
   *
   * It exists because "is this handle still real?" has no other answer. A `WebGLTexture` from a lost
   * context is an ordinary live JavaScript object — binding it raises `INVALID_OPERATION` and
   * samples nothing, and neither the draw nor `drawElementQuad`'s return value can tell.
   *
   * The hole it closes: `cancel()`/`finish()` unregister an instance, which takes its entry out of
   * `contextCallbacks` with it, so an *inactive* instance is never told the context went away. Its
   * texture holders kept answering with pre-loss handles, and `acquireRenderer` short-circuits on
   * re-activation because the renderer itself was never destroyed — so a hover, a hover-out, a
   * context loss and a second hover drew a blank replica over a hidden image, permanently.
   *
   * Stamping the holders rather than keeping every acquired instance registered for context events:
   * the stamp is checked where the stale handle is actually read, so it holds however the instance
   * came to miss the event, and it costs two compares per holder per frame. See
   * {@link initTextureHolder}.
   */
  contextGeneration = 0
  mapKey: object
  onPointer?: (e: PointerEvent | { clientX: number; clientY: number }) => void
  onContextLost?: (e: Event) => void
  onContextRestored?: () => void

  constructor(env: AdvancedEnv = {}) {
    this.env = env
    const r = resolveEnv(null, env)
    this.window = r.window
    this.document = r.document
    this.createCanvas = r.createCanvas
    this.raf = r.raf
    this.caf = r.caf
    this.mapKey = (r.document ?? r.window ?? fallbackShaderKey) as object
  }

  /**
   * Whether `destroy()` has run. A destroyed renderer never comes back to life.
   *
   * `destroy()` un-maps itself, so the object an already-prepared instance is still holding is no
   * longer the one `getSharedShaderRenderer` hands out. Letting `acquire()` re-`init()` that object
   * therefore built a *second* full-viewport canvas and WebGL2 context in one document — and then
   * a third, because the next element to be prepared found nothing in the map and made its own,
   * and whichever of them tore down next deleted the shared document key from under the live one.
   * Cycling shader elements on an SPA route walked straight into the browser's 8-16 context cap.
   *
   * So a teardown is final, and `RendererRef` is what gets an orphaned instance back onto the live
   * renderer.
   */
  isDestroyed = false

  acquire(): boolean {
    if (this.isDestroyed) return false
    if (this.canvas && this.isContextLost) { this.refCount++; return true }
    if (this.gl && !this.isContextLost) { this.refCount++; return true }
    const ok = this.init()
    if (ok) this.refCount++
    return ok
  }

  release(): void {
    if (this.refCount > 0) this.refCount--
    if (this.refCount === 0) this.destroy()
  }

  init(): boolean {
    if (!this.document?.body?.appendChild) return false
    this.canvas = this.createCanvas()
    if (!this.canvas) return false

    this.canvas.className = 'kui-shader-canvas'
    // No `width`/`height` here: `syncCanvasDimensions` owns both, in px, every frame. The
    // `z-index` is the author's if they set `--kui-shader-z`; see `readShaderZIndex`.
    this.canvas.style.cssText = `position:fixed;top:0;left:0;pointer-events:none;z-index:${readShaderZIndex(this.document, this.window)};`
    this.gl = this.canvas.getContext ? (this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null) : null
    if (!this.gl) return false

    syncCanvasDimensions(this.canvas, this.window, getScissorEnv(this.window).dpr)
    this.document.body.appendChild(this.canvas)
    if (!this.initQuad()) return this.abandonInit()
    this.initPrograms()
    this.bindEvents()
    this.startLoop()
    return true
  }

  /**
   * Undo a half-built `init()` and report it as a failure.
   *
   * Not `destroy()`: nothing has acquired this renderer yet, so there is no teardown to broadcast,
   * and marking it `isDestroyed` would retire an object that is free to try again the next time
   * something acquires it. Under transient memory pressure that retry is the whole point — the
   * alternative is a permanently dead renderer for a `createBuffer` that would succeed a second
   * later. The canvas goes because it is already in the document by this point; leaving it would
   * stack one invisible full-viewport canvas per attempt.
   */
  private abandonInit(): boolean {
    disposeGLResources(this.gl, this.quadBuffer, this.programs)
    this.canvas?.remove()
    this.canvas = null
    this.gl = null
    this.quadBuffer = null
    this.programs = {}
    return false
  }

  /**
   * Allocate and fill the one static buffer every draw in this module reads its vertices from.
   *
   * Returns whether it worked, and the caller has to care. `gl.createBuffer()` returns `null` under
   * memory pressure rather than throwing, and so does nothing else downstream: `vertexAttribPointer`
   * and `drawArrays` against a null binding only *set* a GL error, and `drawElementQuad` used to
   * return `true` regardless. The visible result was the worst possible one — every affected
   * element's `opacity` driven to 0 by `hideBehindRenderer` with nothing drawn over it, so the page
   * lost its images rather than losing an effect. A renderer that cannot allocate this is not a
   * renderer, so it fails here instead.
   *
   * `bufferData` is guarded too, and only for a host that throws rather than raising `OUT_OF_MEMORY`
   * through the error queue. Reading the queue is deliberately not done: `getError` is a
   * synchronous round-trip to the GPU process, and the allocation failure it would catch is already
   * caught by the null above.
   */
  initQuad(): boolean {
    const gl = this.gl
    if (!gl) return false
    this.quadBuffer = gl.createBuffer()
    if (!this.quadBuffer) return false
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    } catch {
      if (gl.deleteBuffer) gl.deleteBuffer(this.quadBuffer)
      this.quadBuffer = null
      return false
    }
    return true
  }

  initPrograms(): void {
    const gl = this.gl
    if (!gl) return
    this.programs = {}
    for (const [modes, fs] of PROGRAM_SOURCES) {
      const prog = createProgram(gl, FULLSCREEN_QUAD_VS, fs)
      if (!prog) continue
      // One `extractLocations` result shared by every mode this source serves, rather than one per
      // mode: two results would wrap the same `WebGLProgram` and `disposeGLResources` would delete
      // it twice.
      const locs = extractLocations(gl, prog)
      for (const mode of modes) this.programs[mode] = locs
    }
  }

  bindEvents(): void {
    this.onPointer = (e: PointerEvent | { clientX: number; clientY: number }) => {
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
      this.hasPointer = true
    }
    this.window?.addEventListener?.('pointermove', this.onPointer as EventListener, { passive: true })
    if (this.canvas) {
      this.onContextLost = (e: Event) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault()
        this.isContextLost = true
        // Before anything else: every texture, buffer and program this renderer handed out died
        // with the context, and an instance that is not in `contextCallbacks` will only find that
        // out by comparing this number against its own. See {@link contextGeneration}.
        this.contextGeneration++
        this.stopLoop()
        for (const cb of this.contextCallbacks.values()) invokeIsolated(() => cb.onLost())
      }
      this.onContextRestored = () => {
        this.isContextLost = false
        // A restore that cannot re-allocate the quad leaves the loop stopped rather than spinning
        // it up to draw nothing: `onContextLost` already handed every hidden element back its
        // opacity, so not restarting is the state where the page shows its own content. The
        // callbacks still run — an instance has to learn its textures are gone either way.
        const ok = this.initQuad()
        this.initPrograms()
        for (const cb of this.contextCallbacks.values()) invokeIsolated(() => cb.onRestored())
        if (ok) this.startLoop()
      }
      this.canvas.addEventListener('webglcontextlost', this.onContextLost, false)
      this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false)
    }
  }

  createTexture(source: TexImageSource): WebGLTexture | null {
    return this.gl ? createGLTexture(this.gl, source) : null
  }

  register(
    id: string,
    fn: ShaderDrawFn,
    callbacks?: { onLost: () => void; onRestored: () => void },
    readInputs?: () => void,
  ): void {
    this.drawCalls.set(id, fn)
    if (callbacks) this.contextCallbacks.set(id, callbacks)
    if (readInputs) this.inputReaders.set(id, readInputs)
    if (!this.isContextLost) this.startLoop()
  }

  unregister(id: string): void {
    this.drawCalls.delete(id); this.contextCallbacks.delete(id); this.inputReaders.delete(id)
  }

  startLoop(): void {
    if (this.rafId || this.isContextLost) return
    const tick = (ts: number) => {
      this.renderFrame(ts * 0.001)
      if (this.drawCalls.size > 0 && !this.isContextLost) {
        this.rafId = this.raf(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = this.raf(tick)
  }

  stopLoop(): void {
    if (this.rafId) {
      this.caf(this.rafId)
      this.rafId = null
    }
  }

  renderFrame(timeSeconds: number): void {
    const gl = this.gl
    if (!gl || !this.canvas || this.isContextLost) return
    const dpr = Math.min(this.window?.devicePixelRatio ?? 1, 2)
    syncCanvasDimensions(this.canvas, this.window, dpr)

    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // Every registered instance's inputs — scroll progress, and an audio band when one is
    // selected — are read before any of them draws (and, for a hidden instance, writes `opacity`;
    // see `hideBehindRenderer`/`restoreInstanceOpacity`). Both reads can fall back to
    // `getComputedStyle` (`readElementProgress`, `readAudioBand`), and interleaving that with
    // another instance's style write in the same pass would force a style recalculation once per
    // instance instead of once per frame.
    for (const readInputs of this.inputReaders.values()) invokeIsolated(readInputs)
    this.runDrawCalls(timeSeconds)
  }

  /**
   * Every registered instance's draw, in registration order, each one isolated from its neighbours.
   *
   * The snapshot is here because a draw call may unregister itself — the `catch` below does — and
   * mutating `drawCalls` under a live iterator would skip its neighbour. But a snapshot of the
   * *entries* must not become a snapshot of the *context*, which is why the `gl` is re-read per
   * iteration rather than taken from `renderFrame`'s. `destroy()` nulls `gl` and deletes the
   * programs, so a draw call that dropped the last reference mid-frame left every remaining entry
   * in the snapshot drawing through a disposed context, on a renderer already `isDestroyed` with
   * its `drawCalls` cleared. The same re-read covers a context lost mid-frame, where `gl` survives
   * but the programs and buffers do not.
   *
   * @param timeSeconds - This frame's timestamp, passed to every draw call.
   * @complexity O(n) in registered instances.
   */
  private runDrawCalls(timeSeconds: number): void {
    for (const [id, drawCall] of Array.from(this.drawCalls.entries())) {
      const live = this.gl
      if (!live || this.isContextLost) return
      try {
        drawCall(live, timeSeconds)
      } catch {
        const callbacks = this.contextCallbacks.get(id)
        if (callbacks) invokeIsolated(() => callbacks.onLost())
        this.unregister(id)
      }
    }
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.stopLoop()
    if (this.window?.removeEventListener && this.onPointer) {
      this.window.removeEventListener('pointermove', this.onPointer as EventListener)
    }
    if (this.canvas) {
      if (this.onContextLost) this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
      if (this.onContextRestored) this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
      this.canvas.remove()
      this.canvas = null
    }
    disposeGLResources(this.gl, this.quadBuffer, this.programs)
    this.gl = null; this.quadBuffer = null; this.isContextLost = false
    this.drawCalls.clear(); this.contextCallbacks.clear(); this.inputReaders.clear()
    this.programs = {}; this.refCount = 0
    // Only when the map still points at *us*. A renderer built after this one is stored under the
    // same document key, so an unconditional delete evicted a live renderer and left the next
    // element to be prepared building yet another canvas and context.
    if (shaderRenderers.get(this.mapKey) === this) shaderRenderers.delete(this.mapKey)
  }
}

const shaderRenderers = new WeakMap<object, SharedShaderRenderer>()
const fallbackShaderKey = {}

export function getSharedShaderRenderer(env?: AdvancedEnv): SharedShaderRenderer {
  const resolved = resolveEnv(null, env)
  const key = (resolved.document ?? resolved.window ?? fallbackShaderKey) as object
  let renderer = shaderRenderers.get(key)
  // `isDestroyed` as well as absent: `setSharedShaderRenderer` is free to install any instance,
  // and handing a torn-down one to a caller who will `acquire()` it is the whole of finding GL-1.
  if (!renderer || renderer.isDestroyed) {
    renderer = new SharedShaderRenderer(env)
    shaderRenderers.set(key, renderer)
  }
  return renderer
}

/**
 * The live shared renderer for one document, across a teardown.
 *
 * `prepareShaders` runs during the animator's scan while `activate()` can be much later — a
 * below-the-fold `on:enter` element is prepared on load and activated on scroll — so the renderer
 * an instance was handed at prepare time can be destroyed before it is ever used. This re-resolves
 * instead of reviving: `getSharedShaderRenderer` builds a fresh renderer, the map keeps pointing at
 * the live one, and the document still has exactly one canvas and one context.
 */
export interface RendererRef {
  get(): SharedShaderRenderer
}

export function createRendererRef(env?: AdvancedEnv): RendererRef {
  let current = getSharedShaderRenderer(env)
  return {
    get() {
      if (current.isDestroyed) current = getSharedShaderRenderer(env)
      return current
    },
  }
}

/**
 * Install (or clear) the renderer for one document.
 *
 * A renderer's `destroy()` removes exactly one map entry: the key it was built for. Storing an
 * instance under some *other* document's key therefore made the two halves asymmetric — destroy
 * cleaned up document A, and document B was left holding a renderer whose canvas had been removed
 * and whose GL resources were gone, handed out to every later `getSharedShaderRenderer` for B.
 *
 * So the instance's own key wins, and a mismatched caller key is cleared rather than pointed at
 * another document's renderer: whatever is reachable from the map is always reachable from the
 * key its own teardown will delete.
 */
export function setSharedShaderRenderer(instance: SharedShaderRenderer | null, env?: AdvancedEnv): void {
  const resolved = resolveEnv(null, env)
  const key = (resolved.document ?? resolved.window ?? fallbackShaderKey) as object
  if (!instance) {
    shaderRenderers.delete(key)
    return
  }
  const own = instance.mapKey ?? key
  if (own !== key) shaderRenderers.delete(key)
  shaderRenderers.set(own, instance)
}

interface TextureHolder {
  get: () => WebGLTexture | null
  /** The texture if one was ever created, without creating one. */
  peek: () => WebGLTexture | null
  reset: () => void
}

/**
 * A texture for one source, created on first use against whichever renderer is live.
 *
 * `host.renderer` rather than a captured instance: a renderer that has been torn down took its
 * textures with it, so a holder that kept answering with the old handle would hand a dead name to
 * a new context. Asking the host every time means the switch is invisible from here.
 *
 * The same question has a second half that asking the host does *not* answer: a renderer survives a
 * context loss, and the textures it created do not. So the holder records which renderer and which
 * {@link SharedShaderRenderer.contextGeneration} minted its handle, and treats a mismatch on either
 * as having no texture — `get()` uploads a fresh one, `peek()` reports nothing to delete. That is
 * what makes an *inactive* instance safe: it is unregistered, so no context callback reaches it, and
 * without this it re-activated onto a `WebGLTexture` that had been invalid since before the page
 * scrolled past it.
 */
function initTextureHolder(
  getSource: () => TexImageSource | null,
  host: { renderer: SharedShaderRenderer },
): TextureHolder {
  let tex: WebGLTexture | null = null
  let owner: SharedShaderRenderer | null = null
  let generation = -1
  /** Drop a handle minted by another renderer, or by this one before its context was lost. */
  const dropIfStale = (renderer: SharedShaderRenderer): void => {
    if (tex && (owner !== renderer || generation !== renderer.contextGeneration)) tex = null
  }
  return {
    get() {
      const renderer = host.renderer
      dropIfStale(renderer)
      if (!tex && !renderer.isContextLost) {
        const src = getSource()
        if (src) {
          tex = renderer.createTexture(src)
          owner = renderer
          generation = renderer.contextGeneration
        }
      }
      return tex
    },
    peek() {
      dropIfStale(host.renderer)
      return tex
    },
    reset() { tex = null },
  }
}

function createShaderTextureHolders(
  htmlEl: HTMLElement,
  options: ShaderDrawOptions,
  host: { renderer: SharedShaderRenderer },
): { texHolder: TextureHolder; toHolder: TextureHolder } {
  const isImg = (t: unknown): t is HTMLImageElement => t instanceof HTMLImageElement && t.complete && t.naturalWidth > 0
  const texHolder = initTextureHolder(() => (isImg(htmlEl) ? htmlEl : null), host)
  const toHolder = initTextureHolder(() => {
    const doc = host.renderer.document as Document | null
    if (!options.to || !doc) return null
    try {
      const toEl = doc.querySelector?.(options.to) as HTMLElement | null
      return isImg(toEl) ? toEl : null
    } catch {
      return null
    }
  }, host)
  return { texHolder, toHolder }
}

/** `peek`, not `get`: `get` is the *creating* accessor, and destroy was uploading one or two
 * textures to the GPU purely to delete them again for any instance that never drew. */
function cleanupShaderTextures(texHolder: TextureHolder, toHolder: TextureHolder, renderer: SharedShaderRenderer): void {
  const tex = texHolder.peek(), toTex = toHolder.peek()
  if (tex && renderer.gl) renderer.gl.deleteTexture(tex)
  if (toTex && toTex !== tex && renderer.gl) renderer.gl.deleteTexture(toTex)
  texHolder.reset(); toHolder.reset(); renderer.release()
}

/**
 * Whether the renderer is currently the one hiding this element, and the ledger that undoes it.
 *
 * The flag is the ownership record and stays exactly as it was — it is what keeps an author's own
 * `opacity: 0` from being read back as this module's write and cleared to `''` on the next failed
 * draw. What changed underneath it is the restore: the previous value now lives in the ledger,
 * captured by `set()` at the instant of the write, instead of in a string this module read off
 * `style.opacity`.
 */
interface ShaderInstanceState {
  ledgers: AdvancedLedgers
  hiddenByRenderer: boolean
  progress: number
  audio: number
  /** This frame's measured box, or `null` when the element is off screen. */
  geometry: ElementGeometry | null
  /**
   * The host's own `opacity`, as last read while this instance was not hiding it.
   *
   * The replica has to be painted at it — see {@link ElementGeometry.alpha} — and the one place it
   * cannot be read from is the element itself once `hideBehindRenderer` has written `0` there. So
   * it is tracked on every frame the element is visible and held across every frame it is not.
   */
  hostAlpha: number
}

function hideBehindRenderer(el: HTMLElement, state: ShaderInstanceState): void {
  if (state.hiddenByRenderer) return
  const style = styleOf(state.ledgers, el)
  if (!style) return
  style.set('opacity', '0')
  state.hiddenByRenderer = true
}

/**
 * Stop hiding the element, without unwinding anything else written through the same ledger.
 *
 * This is a *mid-life* give-back — a draw that failed this frame, a lost context, a cancelled
 * effect — and the ledger it goes through is now shared with every other writer on this element,
 * so whole-ledger `restore()` is no longer available: it would hand back a CSS effect's transform
 * or a camera layer's `transform-style` at the same time, while both are still running.
 * `StyleLedger` has no per-property give-back, but it does not need one. `peek()` is the value
 * `restore()` would have written for `opacity` alone, and writing `''` through CSSOM's
 * `setProperty` *removes* the declaration rather than setting an empty one, which is exactly what
 * `undefined` ("there was nothing here before") has to mean.
 *
 * What is lost against the old whole-ledger call is an `!important` priority on an author's own
 * inline `opacity`, which comes back plain until the real teardown restores it: `set()` writes
 * without priority. The hide had already dropped it — `setProperty('opacity', '0')` replaces the
 * whole declaration — so this narrows an existing gap rather than opening one. The ledger's own
 * record is untouched either way, so teardown still puts the priority back.
 */
function restoreInstanceOpacity(el: HTMLElement, state: ShaderInstanceState): void {
  if (!state.hiddenByRenderer) return
  state.hiddenByRenderer = false
  const style = styleOf(state.ledgers, el)
  if (style) style.set('opacity', style.peek('opacity') ?? '')
}

/**
 * One instance's mutable handle on the shared renderer.
 *
 * `renderer` is the one this instance holds a refCount on and draws through; `ref` is how it finds
 * the live one again if that gets torn down between prepare and activation. Everything else here
 * reads `info.renderer` rather than closing over an instance, so re-pointing it in `activate()` is
 * the whole of the switch.
 *
 * `setTimer`/`clearTimer` are held *here*, on the instance, and deliberately not read off
 * `info.renderer` — which does carry the rest of the resolved env. `acquireRenderer` re-points
 * `renderer` at whatever is live now, so a grace timer scheduled through one renderer could be
 * cancelled through another's. These are fixed for the instance's life, which is the only scope in
 * which "cancel the thing I scheduled" is meaningful.
 */
interface ShaderInstanceInfo {
  id: string
  el: HTMLElement
  opt: ShaderDrawOptions
  renderer: SharedShaderRenderer
  ref: RendererRef
  tex: TextureHolder
  to: TextureHolder
  setTimer: SetTimerFunction
  clearTimer: ClearTimerFunction
}

/**
 * How long an inactive shader keeps its textures and its renderer reference before giving them up.
 *
 * The window exists to survive an *accidental* give-back: a pointer clipping the corner of a card,
 * a scroll moving the element out from under a stationary cursor, a glance at a caption and back.
 * Those re-enter in well under a second, and paying a canvas rebuild plus six program recompiles
 * for one is the stall this module spent `e49d517` avoiding. It exists *not* to survive the user
 * moving on to another part of the page, which is the only case where the held memory buys nothing.
 * Five seconds sits above the first distribution and far below the second.
 *
 * It is cheap to be generous here, and the reason is easy to miss: `restoreState()` unregisters the
 * draw call, and `startLoop`'s `tick` stops rescheduling itself the moment `drawCalls` empties. A
 * waiting instance therefore costs GPU memory and nothing else — no frames, no style reads, no CPU.
 * That is also why the delay is counted in wall-clock rather than frames: a backgrounded tab gets
 * no frames at all, and a frame-counted window there would never elapse.
 *
 * Not author-facing. The number encodes how people move a pointer, which is not something an author
 * of one page knows better than this module does, and a knob nobody can set correctly is a knob
 * that only ever gets set wrong.
 */
const SHADER_TEXTURE_GRACE_MS = 5000

/**
 * Take — or keep — a refCount on the live renderer for this instance.
 *
 * A reference already held on a live renderer is kept as it was. Otherwise the reference goes on
 * whatever is live *now*, which after a teardown is a different object than the one `prepare`
 * handed out, with a context that never saw this instance's textures. Nothing is released on that
 * path: a destroyed renderer is already at `refCount` 0 with its GL resources gone.
 *
 * @param info - The instance's handle, whose `renderer` this re-points.
 * @param held - Whether this instance already counts against a renderer.
 * @returns Whether a reference is now held. `false` leaves the instance inactive.
 * @complexity O(1), plus one renderer `init()` when this is the first reference on it.
 */
function acquireRenderer(info: ShaderInstanceInfo, held: boolean): boolean {
  if (held && !info.renderer.isDestroyed) return true
  const live = info.ref.get()
  if (!live.acquire()) return false
  info.renderer = live
  info.tex.reset()
  info.to.reset()
  return true
}

/**
 * The scrub position one instance draws at this frame.
 *
 * Three sources, in order. An authored `progress:` number wins outright — `-1`, the schema
 * default, is precisely what marks it *unauthored*, which is what leaves room for the other two.
 * Then `scrub: scroll`, the opt-in, reads `--kui-progress` off the element or an ancestor. Then
 * `-1`, which every program in `glsl.ts` reads as "not scrubbed, run at full effect".
 *
 * So `scrub: scroll progress: 0.4` is a fixed 0.4 rather than a scrub. That precedence predates
 * the opt-in and is left alone: a number the author wrote down is not something a driver
 * elsewhere on the page should be able to overrule.
 *
 * @complexity O(1) time (at most one inline and one computed style read); O(1) space.
 */
function instanceProgress(info: ShaderInstanceInfo): number {
  const authored = info.opt.progress
  if (authored !== undefined && authored >= 0) return authored
  return info.opt.scrubsFromScroll ? readElementProgress(info.el) : -1
}

/**
 * One instance's per-frame draw, as the renderer will call it.
 *
 * Lifted out of `createShaderInstance` whole, so that function reads as the lifecycle wiring it is
 * rather than lifecycle and one frame's worth of drawing interleaved. `deactivate` is the one thing
 * it cannot do for itself: the `isActive` flag belongs to the instance, and a draw that throws has
 * to put it down — see the `catch`.
 *
 * @param info - The instance's handle; `info.renderer` is re-read per draw, never captured.
 * @param state - This instance's mutable per-frame state, written by `readInputs` before any draw.
 * @param isGenerative - Whether the mode draws *over* the host instead of replacing it.
 * @param deactivate - Puts down the instance's `isActive` flag after a draw that threw.
 * @complexity O(1) per frame, plus one `drawElementQuad`.
 */
function createShaderDrawCall(
  info: ShaderInstanceInfo,
  state: ShaderInstanceState,
  isGenerative: boolean,
  deactivate: () => void,
): ShaderDrawFn {
  return (_gl, time) => {
    let drew = false
    try {
      const texture = info.tex.get()
      drew = (!!texture || isGenerative) && drawElementQuad(info.renderer, info.el, {
        ...info.opt,
        texture,
        toTexture: info.to.get(),
        time,
        progress: state.progress,
        audio: state.audio,
        geometry: state.geometry,
      })
    } catch {
      // `isActive` goes with the unregistration, or the two disagree for the rest of the
      // instance's life: the draw is gone from the renderer while `activate()`'s own
      // `if (isActive) return` still reads as running, so an `on:hover` element that threw once
      // is dead until something calls `cancel()` or `finish()` on it first. Everything a
      // re-activation needs survives — `isAcquired` still holds the renderer reference, so
      // `acquireRenderer` keeps it and only re-registers.
      deactivate()
      restoreInstanceOpacity(info.el, state); info.renderer.unregister(info.id); return
    }
    // A filter replaces the element, so hiding it once the replica is up is the whole mechanism.
    // A generator draws *over* an element it does not replace and whose children are the author's,
    // so hiding it would destroy content and gain nothing — the canvas already covers the box.
    if (drew && !isGenerative) hideBehindRenderer(info.el, state)
    else if (!isGenerative) restoreInstanceOpacity(info.el, state)
  }
}

interface GraceTimer {
  /** Start the countdown, replacing any already running. */
  arm(): void
  /** Stop it. A no-op when nothing is armed. */
  cancel(): void
}

/**
 * One instance's countdown from "no longer drawing" to "give the GPU resources back".
 *
 * Scheduled through `info.setTimer` rather than a bare `setTimeout` so a host — and a suite — can
 * own it; see {@link ShaderInstanceInfo} for why the functions are held on the instance and not
 * read back off `info.renderer`, which moves.
 *
 * `isBusy` is re-checked inside the callback, and that is not belt-and-braces. A `clearTimer` that
 * does not really cancel is a real shape — `scenes.ts` documents the same one for `caf` — and
 * without the check such a host deletes the textures out from under a re-activated instance that is
 * drawing through them. The symptom would be a shader that dies a few seconds after a re-hover,
 * which is about as hard to trace back to here as a symptom gets.
 *
 * @param info - The instance's handle, for its timer functions.
 * @param onExpire - Called once the window closes with the instance still idle.
 * @param isBusy - Whether the instance has become active again since the timer was armed.
 * @complexity O(1) per call.
 */
function createGraceTimer(info: ShaderInstanceInfo, onExpire: () => void, isBusy: () => boolean): GraceTimer {
  let handle: number | null = null
  const cancel = () => {
    if (handle === null) return
    info.clearTimer(handle); handle = null
  }
  return {
    cancel,
    arm() {
      cancel()
      handle = info.setTimer(() => {
        handle = null
        if (!isBusy()) onExpire()
      }, SHADER_TEXTURE_GRACE_MS)
    },
  }
}

function createShaderInstance(info: ShaderInstanceInfo): EffectInstance {
  const state: ShaderInstanceState = {
    // Shared per element with every other writer, advanced or core — see `createAdvancedLedgers`.
    // A private `createLedgerSet` here captured whatever a CSS effect on the same element had
    // already written to `opacity` as the author's own value, and handed it back on teardown.
    ledgers: createAdvancedLedgers(info.el),
    hiddenByRenderer: false, progress: -1, audio: 0, geometry: null, hostAlpha: 1,
  }
  let isActive = false, isAcquired = false

  // A generator has no source image to wait for, so the texture requirement that gates every
  // filter would gate it out of existence. `bindShaderTexture` already returns early on a falsy
  // texture, and the generative program declares no sampler, so nothing downstream needs a guard.
  const isGenerative = GENERATIVE_MODES.has(info.opt.mode)

  // Read once per frame, before this or any other instance draws — see `renderFrame`'s
  // `inputReaders` pass. `drawCall` below only ever reads the cached values back.
  //
  // The audio read is skipped entirely with no `audio:` band authored, rather than reading and
  // discarding: it is the half that can force a style recalculation, and an author who did not
  // ask for audio should not pay for one. `scrub:` now buys the progress read the same gate, and
  // for the stronger of the two reasons — an unasked-for progress does not merely cost a style
  // read, it silently cancels the shader.
  //
  // The geometry measurement belongs here for the same reason and more so: it reads the element's
  // rect, its computed style and its clipping ancestors' (`measureElementGeometry`), all of which
  // a preceding instance's `opacity` write would have invalidated.
  // The element's own `opacity` is part of that measurement, and it is the one input this module
  // destroys by using it: `hideBehindRenderer` writes `0` to the very property being read. So the
  // author's value is taken live while the element is visible and replayed from the cache while it
  // is not. A generative mode never hides its host and is therefore always on the live read.
  const readInputs = () => {
    state.progress = instanceProgress(info)
    state.audio = info.opt.audioBand ? readAudioBand(info.el, info.opt.audioBand) : 0
    const cached = state.hiddenByRenderer ? state.hostAlpha : undefined
    state.geometry = measureElementGeometry(info.el, info.renderer.window, isGenerative, cached)
    if (state.geometry?.hostAlpha !== undefined) state.hostAlpha = state.geometry.hostAlpha
  }

  const drawCall = createShaderDrawCall(info, state, isGenerative, () => { isActive = false })

  const restoreState = () => {
    if (!isActive) return
    isActive = false; info.renderer.unregister(info.id); restoreInstanceOpacity(info.el, state)
  }

  /** Give the GPU resources back. Idempotent, because three paths can reach it. */
  const releaseResources = () => {
    if (!isAcquired) return
    isAcquired = false
    cleanupShaderTextures(info.tex, info.to, info.renderer)
  }

  const grace = createGraceTimer(info, releaseResources, () => isActive)

  /** Stop drawing, un-hide, and start counting down to the give-back. */
  const suspend = () => {
    if (!isActive) return
    restoreState()
    if (isAcquired) grace.arm()
  }

  return createEffectInstance({
    continuous: true,
    activate() {
      if (isActive) return
      if (!acquireRenderer(info, isAcquired)) return
      // After the acquire, never before. An acquire that fails leaves the instance inactive with
      // its resources still held, and a timer cancelled on the way in would then be the *only*
      // thing that was ever going to release them — so the failure path has to keep counting down.
      grace.cancel()
      isAcquired = true; isActive = true
      info.renderer.register(info.id, drawCall, {
        onLost() { info.tex.reset(); info.to.reset(); restoreInstanceOpacity(info.el, state) },
        onRestored() {},
      }, readInputs)
      info.renderer.startLoop()
    },
    // Unregister and un-hide, then hold the textures and the renderer reference for
    // {@link SHADER_TEXTURE_GRACE_MS} before giving them up.
    //
    // This is the grace-timer half of the trade `e49d517` set up and left open, taken deliberately
    // rather than closed as a tidy-up. That commit chose to retain until `destroy()` because
    // `release()` tears down the canvas, the context and all six linked programs, so dropping
    // `refCount` to zero on every hover-out makes the next hover pay a rebuild and six recompiles —
    // a stall worse, on a hover effect, than holding a texture roughly the size of the decoded
    // image the browser already has. It named a grace timer as the way to get the memory back
    // without the stall, and this is it. A give-back inside the window costs nothing: the instance
    // never let go, so `acquireRenderer` short-circuits and the texture holders still have their
    // handles. Past it the memory goes back, and a later `activate()` rebuilds against a live
    // renderer — `RendererRef.get()` re-resolves once the old one reports `isDestroyed`.
    //
    // A later audit read the original retention as an oversight and an agent "fixed" it; that was
    // reverted in `eccb8e5`, because releasing on *every* give-back with no window is the stall,
    // not the fix. The window is the whole difference.
    cancel: suspend,
    finish: suspend,
    destroy() {
      restoreState()
      // Immediately, and the timer with it: `destroy()` means the instance is over, so there is
      // nothing left for a grace window to protect, and a timer that outlived it would fire against
      // a renderer some other instance may since have re-acquired.
      grace.cancel()
      releaseResources()
      // Drop this instance's claim on the shared ledger. The last claim out restores the element —
      // and for the authored host, where the claim is over `ctx.style`, nothing is restored here at
      // all, because the animator owns `restore()` for its own set. Without this the owner count
      // never reaches zero and the *next* writer's teardown is suppressed for the element's life.
      state.ledgers.restore()
    },
  })
}

/**
 * The longest side, in device pixels, of the image baked for a reduced-motion static frame.
 *
 * The frame is written into the element's inline `background-image` as a data URL, and a full
 * device-resolution hero is several megabytes of base64 in a style attribute — which is a
 * performance problem of its own, on the code path whose entire purpose is to stop doing expensive
 * work. A generated field is smooth by construction and `background-size: 100% 100%` scales it back
 * up with nothing visible lost; grain softens, which is a fair trade for a frame that never moves.
 */
const STATIC_BAKE_MAX = 640

/**
 * The size to bake at: the element's aspect, capped by {@link STATIC_BAKE_MAX} and by the canvas.
 *
 * Aspect has to be preserved rather than squashed to a square, because the field is authored in the
 * quad's own 0..1 UV space — the picture genuinely stretches with the box, so a bake at the wrong
 * aspect is a different image, not a smaller one.
 */
function bakeExtent(rect: DOMRect, canvas: HTMLCanvasElement, dpr: number): [number, number] | null {
  // `Number.isFinite` rather than a bare `> 0`: a mock rect can answer `undefined` or `NaN`, and
  // `NaN <= 0` is false, so a plain comparison lets it straight through into `Math.round`.
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null
  if (rect.width <= 0 || rect.height <= 0) return null
  const longest = Math.max(rect.width, rect.height) * dpr
  const budget = Math.min(STATIC_BAKE_MAX, canvas.width, canvas.height)
  const factor = longest > budget ? budget / longest : dpr
  const w = Math.max(1, Math.round(rect.width * factor))
  const h = Math.max(1, Math.round(rect.height * factor))
  return w <= canvas.width && h <= canvas.height ? [w, h] : null
}

/**
 * The top-left `w`x`h` of a canvas, copied through a 2D context and encoded as a PNG data URL.
 *
 * Every step can legitimately fail — a runtime with no 2D context, a `toDataURL` refused on a
 * tainted canvas — and every failure means the same thing to the caller: no static frame, leave the
 * element alone.
 *
 * @complexity O(w·h).
 */
function readCanvasCorner(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  createCanvas: () => HTMLCanvasElement | null,
): string | null {
  const out = createCanvas()
  const out2d = out?.getContext?.('2d') as CanvasRenderingContext2D | null
  if (!out || !out2d) return null
  out.width = w
  out.height = h
  try {
    out2d.drawImage(canvas, 0, 0, w, h, 0, 0, w, h)
    return out.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * Draw one frame of the field into the canvas's top-left corner and read it back as a data URL.
 *
 * Drawn at the origin rather than at the element's real position, which is what frees the bake from
 * needing the element on screen at all: it completes on the first frame instead of waiting for a
 * scroll, and nothing has to stay registered in the meantime. Safe here specifically because under
 * reduced motion every image-filter instance is inert, so no other draw can be sharing the frame.
 *
 * The synthetic geometry carries zero corner radii on purpose. The live path masks corners in the
 * fragment shader because a replica on a shared canvas has no CSS box of its own — but this result
 * becomes a real `background-image` on the real element, which clips to its own `border-radius` for
 * free. Masking here would round the corners twice.
 *
 * `drawImage` from the WebGL canvas rather than `readPixels`: the browser does the row flip and the
 * un-premultiply, both of which a pixel-array path would have to redo by hand for every pixel.
 *
 * @returns A PNG data URL, or `null` if anything in the chain could not answer.
 * @complexity O(w·h) in the baked extent, once.
 */
function bakeStaticFrame(
  renderer: SharedShaderRenderer,
  el: HTMLElement,
  options: ShaderDrawOptions,
  createCanvas: () => HTMLCanvasElement | null,
): string | null {
  const gl = renderer.gl
  const canvas = renderer.canvas
  if (!gl || !canvas || typeof el.getBoundingClientRect !== 'function') return null
  const dpr = getScissorEnv(renderer.window).dpr
  const extent = bakeExtent(el.getBoundingClientRect(), canvas, dpr)
  if (!extent) return null
  const [w, h] = extent

  const box: Inset = { left: 0, top: 0, right: w / dpr, bottom: h / dpr }
  const drew = drawElementQuad(renderer, el, {
    ...options,
    time: 0,
    audio: 0,
    texture: null,
    geometry: { border: box, paint: box, clip: box, radii: [0, 0, 0, 0, 0, 0, 0, 0], alpha: 1 },
  })
  if (!drew) return null

  const url = readCanvasCorner(canvas, w, h, createCanvas)

  // Undo the draw before the frame is presented. Scissored to our own corner so that a second
  // generative instance baking in the same frame is not wiped along with it.
  gl.enable(gl.SCISSOR_TEST)
  gl.scissor(0, canvas.height - h, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  return url
}

/**
 * What a generative shader does for a visitor who asked for reduced motion: one still frame.
 *
 * The owner's decision is that the target is a static frame rather than "no effect", and a
 * generator is the ideal first case — one frame of a procedural gradient is simply a good image,
 * where one frame of a pointer-driven displacement is nothing at all. So the five image filters
 * keep bailing to an inert instance and only the generative modes bake.
 *
 * **Why this runs in `prepare` rather than in the instance's `activate()`.** It has to. Under
 * reduced motion the animator's `openGate` (`core/animator.ts`) sees `reducedMotion: 'disable'`,
 * marks the element finished, emits `kui:finish` with reason `reduced-motion`, and returns —
 * *without activating any instance*. An `activate()` body would be unreachable. Baking here keeps
 * the instance genuinely inert, so the lifecycle an author observes is byte-for-byte what it is
 * today, and the frame arrives anyway.
 *
 * The result is a real CSS background on the real element, which means it sits in the page's own
 * paint order — so unlike the live path it composes with content above it, keeps the element's own
 * `border-radius` and clipping, and costs nothing per frame once written.
 *
 * @returns An inert instance whose `destroy()` gives the author's background properties back.
 * @complexity One frame's draw plus one readback, then nothing.
 */
function prepareReducedMotion(
  el: HTMLElement,
  options: ShaderDrawOptions,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (!GENERATIVE_MODES.has(options.mode)) return createInertInstance()
  const hostDoc = el?.ownerDocument
  const env = resolveEnv(ctx, hostDoc ? { document: hostDoc, window: hostDoc.defaultView } : undefined)
  const renderer = getSharedShaderRenderer(env)
  if (!renderer.acquire()) return createInertInstance()

  const ledgers = createAdvancedLedgers(el)
  nextShaderId += 1
  const id = `kui-shader-static-${nextShaderId}`
  let released = false
  const release = () => {
    if (released) return
    released = true
    renderer.unregister(id)
    renderer.release()
  }

  // Registered rather than drawn inline: `prepare` runs during the animator's scan, before layout
  // has necessarily settled, and the renderer's own canvas is sized in its loop. A zero-sized
  // element simply returns `null` and is tried again on the next frame.
  renderer.register(id, () => {
    const url = bakeStaticFrame(renderer, el, options, env.createCanvas)
    if (!url) return
    const style = styleOf(ledgers, el)
    if (style) {
      style.set('background-image', `url("${url}")`)
      style.set('background-size', '100% 100%')
      style.set('background-repeat', 'no-repeat')
    }
    release()
  })
  renderer.startLoop()

  return createInertInstance(() => {
    release()
    ledgers.restore()
  })
}

export function prepareShaders(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  // Resolved before the options are read, not after: the colour parser's canvas fallback is part
  // of the environment like everything else here, and `extractShaderOptions` needs it in hand to
  // resolve a colour this module's own hex/rgb/named parsing cannot — `hsl()`, `oklch()`, any CSS
  // named colour outside the short table. Reading it off the global instead is what made a
  // colour's value depend on which document happened to be ambient.
  const hostDoc = el?.ownerDocument
  const resolvedEnv = resolveEnv(ctx, hostDoc ? { document: hostDoc, window: hostDoc.defaultView } : undefined)
  const options = extractShaderOptions(params, resolvedEnv.createCanvas)
  if (!(SHADER_MODES as readonly string[]).includes(options.mode)) return createInertInstance()
  if (isReducedMotion(ctx)) return prepareReducedMotion(el as HTMLElement, options, ctx)

  const ref = createRendererRef(resolvedEnv)
  nextShaderId += 1
  const id = `kui-shader-instance-${nextShaderId}`
  const info = {
    id, el: el as HTMLElement, opt: options, renderer: ref.get(), ref,
    setTimer: resolvedEnv.setTimer, clearTimer: resolvedEnv.clearTimer,
  } as ShaderInstanceInfo
  const holders = createShaderTextureHolders(el as HTMLElement, options, info)
  info.tex = holders.texHolder
  info.to = holders.toHolder
  // One capture per element, shared with every other writer on it — core's `LedgerSet`
  // included — because the registry lives on the element itself. Nothing is handed over.
  return createShaderInstance(info)
}

export const SHADER_PARAMETERS = {
  mode: { type: 'keyword' as const, default: 'displace', keywords: [...SHADER_MODES], cssProperty: '--kui-shader-mode' },
  strength: { type: 'number' as const, default: '0.5', minimum: 0, maximum: 10, cssProperty: '--kui-shader-strength' },
  speed: { type: 'number' as const, default: '1.0', minimum: 0, maximum: 10, cssProperty: '--kui-shader-speed' },
  frequency: { type: 'number' as const, default: '10.0', minimum: 0.1, maximum: 50, cssProperty: '--kui-shader-frequency' },
  chromatic: { type: 'number' as const, default: '0.0', minimum: 0, maximum: 1, cssProperty: '--kui-shader-chromatic' },
  /**
   * How far the colour ramp is wrapped back on itself — the shimmer count.
   *
   * Ranged 0..8 rather than the 0..1 it carried before `mode: gradient` existed. The old bound was
   * right for a mix amount and wrong for a wrap count, and it cost nothing to police because **no
   * fragment program declared `u_iridescence` at all** — the value was extracted and uploaded to a
   * location that was `null` in all five programs. It reaches a shader for the first time here.
   */
  iridescence: { type: 'number' as const, default: '0.0', minimum: 0, maximum: 8, cssProperty: '--kui-shader-iridescence' },
  tint: { type: 'color' as const, default: '#ffffff', cssProperty: '--kui-shader-tint' },
  /*
   * `color1`/`color2` keep their original meaning — the duotone pair `mode: displace` remaps a
   * photo through — and `mode: gradient` reads the same two as the first stops of its palette.
   * `color3`..`color5` extend that palette without touching the duotone contract.
   *
   * Five separate `color` parameters rather than one comma-separated list: the attribute grammar
   * splits effect segments on top-level commas, so a list would have to be quoted, and the only
   * type that could carry it (`text`) validates nothing — a mistyped stop would silently become
   * white through `parseColor`'s fallback, which is the worst failure a colour input can have.
   */
  color1: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color1' },
  color2: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color2' },
  color3: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color3' },
  color4: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color4' },
  color5: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color5' },
  /*
   * The generative field's own controls. Every one of these is read by this module's JavaScript and
   * by no stylesheet, so — as `ParamSpecBase.cssProperty` warns — setting the custom property
   * directly does nothing at all. Widening one means widening it here.
   */
  /** Which pattern. The same seed gives the same image on every load, which is the point of it. */
  seed: { type: 'number' as const, default: '0', minimum: 0, maximum: 9999, integer: true, cssProperty: '--kui-shader-seed' },
  /** How zoomed the field is. Larger means smaller, more numerous shapes. */
  scale: { type: 'number' as const, default: '1', minimum: 0.05, maximum: 20, cssProperty: '--kui-shader-scale' },
  /**
   * How many octaves of detail ride on the base shapes.
   *
   * Named `detail` rather than the reference tools' "definition" — the plainer word for the same
   * idea. Capped at 6, which is `KUI_MAX_OCTAVES` in the shader; a seventh would be accepted here
   * and silently ignored there.
   */
  detail: { type: 'number' as const, default: '3', minimum: 1, maximum: 6, integer: true, cssProperty: '--kui-shader-detail' },
  /** How far a second field distorts the first. The difference between contour rings and liquid. */
  warp: { type: 'number' as const, default: '0', minimum: 0, maximum: 2, cssProperty: '--kui-shader-warp' },
  /**
   * How much of `fluid`, `liquid`, `particles` and `morph`'s motion comes from real noise.
   *
   * Those four shipped with a single trigonometric term standing in for noise, which bands and
   * repeats visibly. This crossfades that term into the same `kuiFbm` field `mode: gradient`
   * generates from — `0` is the shipped picture exactly, `1` is the field on its own, and the
   * values between are a genuine dial rather than a rounded switch.
   *
   * **It is off by default and must stay that way.** Four modes are already in use; turning this
   * on for them without being asked would restyle live pages. See `FILTER_NOISE_GLSL` in
   * `glsl.ts` for why it is a parameter of its own rather than `warp` doing double duty.
   *
   * Above `0` it is also what gives `seed`, `scale`, `warp` and `detail` a meaning on these four
   * modes; below it they are read and uploaded but nothing samples them. `mode: displace`'s ripple
   * is a deliberate radial wave rather than fake noise, and `gradient`/`logo` are already nothing
   * but the noise core, so all three ignore this.
   */
  noise: { type: 'number' as const, default: '0', minimum: 0, maximum: 1, cssProperty: '--kui-shader-noise' },
  /** Posterise the ramp into this many steps. `0` is off, as with `chromatic` and `iridescence`. */
  bands: { type: 'number' as const, default: '0', minimum: 0, maximum: 32, integer: true, cssProperty: '--kui-shader-bands' },
  /** Film grain amount. */
  grain: { type: 'number' as const, default: '0', minimum: 0, maximum: 1, cssProperty: '--kui-shader-grain' },
  /**
   * Hue rotation, as a real angle (`hue: 30deg`, `hue: 0.25turn`).
   *
   * An `angle` rather than a normalised scalar, matching `carousel`'s `tilt:` and this repository's
   * standing rejection of normalised ranges where a CSS unit exists. A bare `hue: 30` is accepted
   * too — `core/params.ts` normalises it to `30deg`.
   */
  hue: { type: 'angle' as const, default: '0deg', cssProperty: '--kui-shader-hue' },
  /**
   * Which part of `mode: logo`'s host image is the mark. Ignored by every other mode.
   *
   * `alpha` for the usual transparent-ground SVG or PNG. `luma` and `luma-invert` are for a format
   * that has no alpha to read — a JPEG under `alpha` gives an all-opaque stencil and fills the
   * whole rectangle. `luma` takes the bright pixels as the mark, `luma-invert` the dark ones; both
   * directions are spelled out because guessing produces a perfect negative of the mark, which
   * looks deliberate and is exactly wrong.
   */
  mask: { type: 'keyword' as const, default: 'alpha', keywords: ['alpha', 'luma', 'luma-invert'], cssProperty: '--kui-shader-mask' },
  /**
   * How `mode: gradient` and `mode: logo` answer the pointer. Ignored by the five filter modes.
   *
   * Being *responsive to the pointer* is the one thing a shader background does that a video of a
   * shader cannot, and these two modes — the two built to stand in for a video background — were
   * the only ones in the tier with no pointer response at all. `displace` and `fluid` have read
   * `u_mouse` since they were written.
   *
   * - `stir` — the cursor drags the colour flow around it, like stirring thick paint. It moves the
   *   field's *sample point*, so on `mode: logo` the mark's edges do not move: `glyphMask()` reads
   *   the host image at the undistorted coordinate and multiplies the finished colour, which means
   *   the fill swirls inside a stencil that stays exactly where it was.
   * - `light` — the cursor is a torch held over the surface. Nothing moves; the colour under the
   *   pointer is multiplied up, which raises its saturation rather than washing it toward white.
   * - `both` — the two together. They compose cleanly because they act at different stages, one on
   *   the coordinate and one on the colour that coordinate produced.
   *
   * `none` by default, and `none` means the shader never reads `u_mouse` at all — not that it
   * reads it and multiplies by zero. Every page already running these modes renders what it always
   * rendered, byte for byte.
   *
   * With no pointer yet — the state of every page on load, every phone, and every screenshot —
   * `computeMousePos` answers the element's centre, so `light` rests as a centred glow and `stir`
   * as a centred swirl. Both are compositions someone might have authored on purpose, which is the
   * bar a resting state has to clear.
   */
  hover: { type: 'keyword' as const, default: 'none', keywords: ['none', 'stir', 'light', 'both'], cssProperty: '--kui-shader-hover' },
  /**
   * A colour painted behind the generative field, inside the element's own shape.
   *
   * What it is for is `mode: logo`: outside the mark the field has no coverage, so this is the
   * plate the mark sits on instead of the page showing through.
   *
   * On a bare `mode: gradient` it is **invisible**, and that is arithmetic rather than an
   * oversight — the field is opaque, so there is nothing behind it to see. It becomes visible
   * there through a `tint` whose alpha is below 1, which is how a field is made to sit *on* a page
   * colour rather than replace it. Unset by default, and read through the raw parameter string
   * rather than `parseColor`, whose empty-input fallback is opaque white.
   */
  backdrop: { type: 'color' as const, default: '', cssProperty: '--kui-shader-backdrop' },
  /**
   * The generative field's orientation: the axis it runs along.
   *
   * `transform: rotate()`'s convention — clockwise-positive, `0deg` pointing right — because that
   * is the one an author already has. It turns the field's whole domain, so it is visible at the
   * library defaults rather than only in company with another parameter, and it is the axis
   * `motion: drift` travels along. One idea with two consequences, not two behaviours: the field
   * has an axis, this names it, and `drift` slides along the thing it named.
   *
   * An `angle` rather than a normalised scalar, matching `hue` above and this repository's
   * standing rejection of 0..1 ranges where a CSS unit exists. A bare `angle: 30` is accepted —
   * `core/params.ts` normalises it to `30deg`.
   */
  angle: { type: 'angle' as const, default: '0deg', cssProperty: '--kui-shader-angle' },
  /**
   * How the generative field moves. Ignored by the five filter modes.
   *
   * - `evolve` — the field changes *in place*. Time is the noise function's third axis rather than
   *   a translation of a 2D field, which is why it reads as the pattern genuinely evolving instead
   *   of sliding past. See `NOISE_GLSL` in `glsl.ts`.
   * - `drift` — it also travels along `angle`, at a rate proportional to `scale` so the visual
   *   speed is the same at any zoom.
   * - `swirl` — it also turns about the element's centre.
   *
   * **`evolve` exists so that the default can be inert.** `drift` would have been the natural
   * default name, and it is what this parameter's brief asked for — but `drift` is a new look, and
   * defaulting to it would restyle every page already running `gradient` or `logo` on the next
   * release. That is the same trap `noise:` above is written around, and the reason `hover:`
   * defaults to `none`. So the shipped behaviour keeps the default and gets an accurate name, and
   * the two new ones are opt-in. `drift` and `swirl` add to `evolve` rather than replacing it, so
   * a travelling field is still changing as it goes rather than one frozen picture towed across
   * the box.
   */
  motion: { type: 'keyword' as const, default: 'evolve', keywords: ['evolve', 'drift', 'swirl'], cssProperty: '--kui-shader-motion' },
  blend: { type: 'keyword' as const, default: 'normal', keywords: ['normal', 'screen', 'multiply', 'add'], cssProperty: '--kui-shader-blend' },
  to: { type: 'text' as const, default: '', cssProperty: '--kui-shader-to' },
  /**
   * A fixed scrub position, 0..1. `-1` is the unauthored sentinel and means "no scrub".
   *
   * `--kui-shader-progress`, **not** `--kui-progress`. Every authored parameter reaches
   * `element.style` as its custom property — `core/compile.ts`'s `buildPlan` runs `resolveParams`
   * over JS-rendered entries too — so while this pointed at `--kui-progress` an authored
   * `progress: 0.4` wrote the scroll primitives' own channel onto the element: it raced
   * `scroll-progress` when the two were composed, and it inherited down to every descendant
   * shader and pinned timeline underneath. `test/carousel-3d.test.ts` already carries a
   * regression test that a primitive must not publish `--kui-progress` meaning something else.
   * Nothing is lost by renaming — this module reads the authored value from the parameter, never
   * back off the property.
   */
  progress: { type: 'number' as const, default: '-1', minimum: -1, maximum: 1, cssProperty: '--kui-shader-progress' },
  /**
   * Whether this shader is scrubbed by `--kui-progress` — the property `scroll-progress`,
   * `timeline: pin` and the rest of the scroll family publish.
   *
   * Opt-in, and `off` by default, for the same reason `audio:` below is: the value arrives as a
   * custom property written by some *other* primitive, and `--kui-progress` is an ordinary
   * inheriting custom property, so a shader that read one unasked changed its own output the
   * moment an unrelated `scroll-progress` appeared anywhere above it in the tree. That was not a
   * subtle drift — at the top of a scroll range the published value is `0`, every program
   * multiplies its effect by it, and the shader rendered an untouched copy of the source image.
   * Dead, silently, with no way for the author to decline.
   *
   * `keyword`, so the list is closed and a typo warns instead of quietly doing nothing.
   * `--kui-shader-scrub` is a name read by this module's JavaScript and by no stylesheet, so
   * setting the custom property directly does nothing; the value itself is read from
   * `--kui-progress`, which is a different contract entirely.
   */
  scrub: { type: 'keyword' as const, default: 'off', keywords: ['off', 'scroll'], cssProperty: '--kui-shader-scrub' },
  /**
   * Which `audio-source` band drives this shader, if any.
   *
   * Opt-in, and `off` by default: the value arrives as a custom property written by some *other*
   * primitive, so a shader that read one unasked would change its own output the moment an
   * unrelated `audio-source` appeared anywhere above it in the tree.
   *
   * `keyword`, so the list is closed — and `--kui-shader-audio` is a name, read by this module's
   * JavaScript and by no stylesheet, so setting the custom property in CSS does nothing. The
   * band values themselves are read from `--kui-audio-*`, which is a different contract entirely
   * (`audio.ts`'s `AUDIO_BAND_PROPERTIES`).
   */
  audio: { type: 'keyword' as const, default: 'off', keywords: ['off', ...AUDIO_BANDS], cssProperty: '--kui-shader-audio' },
}

export const SHADERS_PRIMITIVE: Primitive = {
  id: 'shaders', renderer: 'javascript', channels: ['opacity'],
  parameters: SHADER_PARAMETERS, supportedTimelines: ['time', 'view', 'scroll'],
  supportedActivations: ['load', 'enter', 'hover', 'click'],
  defaultActivation: 'load', perfClass: 'continuous', reducedMotion: 'disable',
  prepare: prepareShaders,
}

export const SHADERS_PRESETS: Preset[] = [
  { name: 'shaders', primitive: 'shaders' },
  { name: 'shader-displace', primitive: 'shaders', params: { mode: 'displace' } },
  { name: 'shader-fluid', primitive: 'shaders', params: { mode: 'fluid' } }, { name: 'fluid-pointer', primitive: 'shaders', params: { mode: 'fluid' } },
  { name: 'shader-liquid', primitive: 'shaders', params: { mode: 'liquid' } }, { name: 'liquid-distort', primitive: 'shaders', params: { mode: 'liquid' } },
  { name: 'shader-particles', primitive: 'shaders', params: { mode: 'particles' } }, { name: 'particle-field', primitive: 'shaders', params: { mode: 'particles' } },
  { name: 'shader-morph', primitive: 'shaders', params: { mode: 'morph' } }, { name: 'image-morph', primitive: 'shaders', params: { mode: 'morph' } },
  /*
   * The generative family. One fragment program, four sets of defaults — a preset here is a
   * starting point in the same parameter space, not a separate shader.
   *
   * These are the only presets in the catalog that work on an element with no image in it, and
   * their honest surface is still an element nothing overlaps — but for a different reason than it
   * used to be. The shared canvas now defaults to `z-index: 1`, so a positioned headline laid over
   * one of these paints on top of it, where before the headline vanished behind it. Better, and
   * still not composition: `border-radius`, ancestor clipping and ancestor opacity are reproduced
   * in the fragment shader, but the replica's place in the stacking order is the *canvas's*, not
   * the element's. `--kui-shader-z` moves that one canvas and every replica on it together. See
   * `docs/advanced-modules.md`.
   */
  { name: 'shader-gradient', primitive: 'shaders', params: { mode: 'gradient' } },
  { name: 'gradient-liquid', primitive: 'shaders', params: { mode: 'gradient', warp: '1.1', detail: '4', speed: '0.4' } },
  { name: 'gradient-bands', primitive: 'shaders', params: { mode: 'gradient', bands: '8', warp: '0.6', speed: '0.3' } },
  // No palette on purpose: with fewer than two colours set the ramp falls back to its default pair,
  // and the sheen comes from wrapping it rather than from the stops themselves.
  { name: 'gradient-holo', primitive: 'shaders', params: { mode: 'gradient', iridescence: '3', chromatic: '0.5', warp: '0.4', speed: '0.5' } },
  /*
   * `logo` is the one generative mode with no stacking caveat at all. It replaces an `<img>`
   * exactly as the five filters do — the host image is the stencil, not the picture — so a mark
   * painting over the page is what an author wants rather than the limitation above.
   *
   * `<img src="mark.svg" data-kui="shader-logo">` and nothing else: the asset already carries the
   * shape, `object-fit` already decides where it sits, and the element is already the right size.
   */
  { name: 'shader-logo', primitive: 'shaders', params: { mode: 'logo' } },
  { name: 'logo-gradient', primitive: 'shaders', params: { mode: 'logo', warp: '0.8', detail: '4', scale: '1.6', speed: '0.4' } },
]

export function registerShaders(target: unknown): Registry | Animator {
  return registerInto(target, SHADERS_PRIMITIVE, SHADERS_PRESETS, 'Shaders')
}
