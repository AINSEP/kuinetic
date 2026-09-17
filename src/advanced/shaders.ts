// Created by Gemini 3.8 Flash
/**
 * kUInetic Shaders - Shared WebGL2 Shader System
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import {
  DISPLACE_FS, FLUID_FS, FULLSCREEN_QUAD_VS, LIQUID_FS, MORPH_FS, PARTICLES_FS,
} from './glsl.js'
import { createLedgerSet, type LedgerSet } from '../core/owned-styles.js'
import {
  type AdvancedEnv, type AnyWindow, type AnyDocument, type RafFunction, type CafFunction,
  clamp, createEffectInstance, createInertInstance, isReducedMotion, registerInto, resolveEnv, styleOf,
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
export type ShaderProgramLocations = ProgramLocations & { u_audio?: WebGLUniformLocation | null }

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

let colorCtx: CanvasRenderingContext2D | null = null

function parseColorWithCanvas(val: string): [number, number, number, number] | null {
  try {
    if (!colorCtx && document?.createElement) {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      colorCtx = (canvas.getContext?.('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null) ?? null
    }
    if (!colorCtx) return null
    colorCtx.clearRect(0, 0, 1, 1)
    colorCtx.fillStyle = '#000000'
    colorCtx.fillStyle = val
    colorCtx.fillRect(0, 0, 1, 1)
    const data = colorCtx.getImageData(0, 0, 1, 1).data
    return [data[0]! / 255, data[1]! / 255, data[2]! / 255, data[3]! / 255]
  } catch {
    return null
  }
}

export function parseColor(str?: string): [number, number, number, number] {
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
  const canvasColor = parseColorWithCanvas(val)
  if (canvasColor) return canvasColor
  return [1, 1, 1, 1]
}

export const BLEND_MODES = {
  normal: 0,
  screen: 1,
  multiply: 2,
  add: 3,
}

export type ProgramOrLocations = ShaderProgramLocations | WebGLProgram | null

/**
 * Fill in `u_audio`'s location on first use, and remember the answer.
 *
 * `gl-utils.ts`'s `extractLocations` is the generic helper every caller shares and knows nothing
 * about this module's own uniforms, so the lookup happens here instead — once per program rather
 * than once per draw, with `undefined` meaning "not looked up yet" and `null` meaning "looked up,
 * the program does not declare it". Safe to cache on the record: a lost context rebuilds the
 * programs from scratch (`initPrograms`), so a stale location cannot outlive its program.
 */
function cacheAudioLocation(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locs: ShaderProgramLocations,
  program: WebGLProgram,
): ShaderProgramLocations {
  if (locs.u_audio === undefined) locs.u_audio = gl.getUniformLocation(program, 'u_audio')
  return locs
}

function resolveLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
): ShaderProgramLocations | null {
  if (!progInfo) return null
  if ('program' in progInfo && progInfo.program) return cacheAudioLocation(gl, progInfo, progInfo.program)
  const p = progInfo as WebGLProgram
  const g = (n: string) => gl.getUniformLocation(p, n)
  return {
    u_time: g('u_time'), u_strength: g('u_strength'), u_frequency: g('u_frequency'),
    u_chromatic: g('u_chromatic'), u_iridescence: g('u_iridescence'), u_mouse: g('u_mouse'),
    u_uvOrigin: g('u_uvOrigin'), u_uvScale: g('u_uvScale'), u_tint: g('u_tint'),
    u_blend: g('u_blend'), u_duotone: g('u_duotone'), u_color1: g('u_color1'),
    u_color2: g('u_color2'), u_image: g('u_image'), u_image_to: g('u_image_to'),
    u_progress: g('u_progress'), u_audio: g('u_audio'),
    u_maskBox: g('u_maskBox'), u_maskRx: g('u_maskRx'), u_maskRy: g('u_maskRy'),
    u_maskAlpha: g('u_maskAlpha'),
  }
}

/** A zero half-extent is `shapeMask()`'s "no box measured" signal — see `SHAPE_MASK_GLSL`. */
const NO_MASK_BOX: [number, number, number, number] = [0, 0, 0, 0]

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
 * NOT reproduced, and not reproducible from a single fixed canvas: **stacking order** — the canvas
 * sits at `z-index: 9999` above the whole document, so a sticky header or an open modal that
 * overlaps the element is painted under the replica. Also unreproduced: a transformed ancestor
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
  /** The product of the ancestors' opacities. This element's own is this module's to write. */
  alpha: number
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
 * @returns Its geometry, or `null` when it is not on screen at all.
 * @complexity O(d) in ancestor depth, capped at {@link ANCESTOR_WALK_LIMIT}.
 */
export function measureElementGeometry(el: HTMLElement, win?: AnyWindow): ElementGeometry | null {
  const rect = el.getBoundingClientRect()
  const { height } = getScissorEnv(win)
  if (!isRectVisible(rect, height)) return null
  const view = win ?? null
  const cs = cssStyleOf(el, view)
  const content = contentBoxOf(rect, cs)
  const walked = walkAncestors(el, view, content, cs?.position || 'static')
  return {
    border: boxOf(rect),
    paint: paintBoxOf(content, naturalSizeOf(el), cs),
    clip: walked.clip,
    radii: radiiOf(cs, rect),
    alpha: walked.alpha,
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

function computeMousePos(renderer: ShaderRendererLike, rect: DOMRect): { x: number; y: number } {
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

export function drawElementQuad(
  renderer: ShaderRendererLike,
  el: HTMLElement,
  opt: Partial<ShaderDrawOptions> = {},
): boolean {
  const gl = renderer.gl
  const canvas = renderer.canvas
  if (!gl || !canvas) return false

  const mode = opt.mode ?? 'displace'
  const info = renderer.programs[mode]
  if (info === undefined) return false
  const program = getProgram(info)
  if (!program) return false

  // The measured geometry when the render loop already took it this frame (the normal path), or a
  // fresh measurement for a caller that has none. `null` is a measurement — "off screen, nothing
  // to draw" — and must not send us back to the DOM for the same answer every frame.
  const geom = opt.geometry !== undefined ? opt.geometry : measureElementGeometry(el, renderer.window)
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

export function extractShaderOptions(params: ShaderParamAccessor): ShaderDrawOptions {
  const mode = ('keyword' in params && typeof params.keyword === 'function')
    ? params.keyword('mode')
    : params.text('mode', 'displace')
  const c1Text = params.text('color1', '')
  const c2Text = params.text('color2', '')
  const blendMap: Record<string, number> = { normal: 0, screen: 1, multiply: 2, add: 3 }

  return {
    mode,
    strength: params.num('strength', 0.5),
    speed: params.num('speed', 1.0),
    frequency: params.num('frequency', 10.0),
    chromatic: params.num('chromatic', 0.0),
    iridescence: params.num('iridescence', 0.0),
    tintRgba: parseColor(params.text('tint', '#ffffff')),
    isDuotone: Boolean(c1Text && c2Text),
    c1Rgba: parseColor(c1Text || '#000000'),
    c2Rgba: parseColor(c2Text || '#ffffff'),
    blendMode: blendMap[params.text('blend', 'normal')] ?? 0,
    to: params.text('to', ''),
    progress: params.num ? params.num('progress', -1) : -1,
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
  isContextLost = false
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

  acquire(): boolean {
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
    // No `width`/`height` here: `syncCanvasDimensions` owns both, in px, every frame.
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;'
    this.gl = this.canvas.getContext ? (this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null) : null
    if (!this.gl) return false

    syncCanvasDimensions(this.canvas, this.window, getScissorEnv(this.window).dpr)
    this.document.body.appendChild(this.canvas)
    this.initQuad()
    this.initPrograms()
    this.bindEvents()
    this.startLoop()
    return true
  }

  initQuad(): void {
    const gl = this.gl
    if (!gl) return
    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  }

  initPrograms(): void {
    const gl = this.gl
    if (!gl) return
    this.programs = {}
    for (const [n, fs] of [['displace', DISPLACE_FS], ['fluid', FLUID_FS], ['liquid', LIQUID_FS], ['particles', PARTICLES_FS], ['morph', MORPH_FS]] as const) {
      const prog = createProgram(gl, FULLSCREEN_QUAD_VS, fs)
      if (prog) this.programs[n] = extractLocations(gl, prog)
    }
  }

  bindEvents(): void {
    this.onPointer = (e: PointerEvent | { clientX: number; clientY: number }) => {
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
    }
    this.window?.addEventListener?.('pointermove', this.onPointer as EventListener, { passive: true })
    if (this.canvas) {
      this.onContextLost = (e: Event) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault()
        this.isContextLost = true
        this.stopLoop()
        for (const cb of this.contextCallbacks.values()) invokeIsolated(() => cb.onLost())
      }
      this.onContextRestored = () => {
        this.isContextLost = false
        this.initQuad()
        this.initPrograms()
        for (const cb of this.contextCallbacks.values()) invokeIsolated(() => cb.onRestored())
        this.startLoop()
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
    for (const [id, drawCall] of Array.from(this.drawCalls.entries())) {
      try {
        drawCall(gl, timeSeconds)
      } catch {
        const callbacks = this.contextCallbacks.get(id)
        if (callbacks) invokeIsolated(() => callbacks.onLost())
        this.unregister(id)
      }
    }
  }

  destroy(): void {
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
    shaderRenderers.delete(this.mapKey)
  }
}

const shaderRenderers = new WeakMap<object, SharedShaderRenderer>()
const fallbackShaderKey = {}

export function getSharedShaderRenderer(env?: AdvancedEnv): SharedShaderRenderer {
  const resolved = resolveEnv(null, env)
  const key = (resolved.document ?? resolved.window ?? fallbackShaderKey) as object
  let renderer = shaderRenderers.get(key)
  if (!renderer) {
    renderer = new SharedShaderRenderer(env)
    shaderRenderers.set(key, renderer)
  }
  return renderer
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
  reset: () => void
}

function initTextureHolder(
  getSource: () => TexImageSource | null,
  renderer: SharedShaderRenderer,
): TextureHolder {
  let tex: WebGLTexture | null = null
  return {
    get() {
      if (!tex && !renderer.isContextLost) {
        const src = getSource()
        if (src) tex = renderer.createTexture(src)
      }
      return tex
    },
    reset() { tex = null },
  }
}

function createShaderTextureHolders(
  htmlEl: HTMLElement,
  options: ShaderDrawOptions,
  renderer: SharedShaderRenderer,
): { texHolder: TextureHolder; toHolder: TextureHolder } {
  const isImg = (t: unknown): t is HTMLImageElement => t instanceof HTMLImageElement && t.complete && t.naturalWidth > 0
  const texHolder = initTextureHolder(() => (isImg(htmlEl) ? htmlEl : null), renderer)
  const toHolder = initTextureHolder(() => {
    if (!options.to || !renderer.document) return null
    try {
      const doc = renderer.document as Document
      const toEl = doc.querySelector?.(options.to) as HTMLElement | null
      return isImg(toEl) ? toEl : null
    } catch {
      return null
    }
  }, renderer)
  return { texHolder, toHolder }
}

function cleanupShaderTextures(texHolder: TextureHolder, toHolder: TextureHolder, renderer: SharedShaderRenderer): void {
  const tex = texHolder.get(), toTex = toHolder.get()
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
 * captured by `set()` at the instant of the write and put back with its priority intact, instead
 * of in a string this module read off `style.opacity` and wrote back as a plain declaration.
 */
interface ShaderInstanceState {
  ledgers: LedgerSet
  hiddenByRenderer: boolean
  progress: number
  audio: number
  /** This frame's measured box, or `null` when the element is off screen. */
  geometry: ElementGeometry | null
}

function hideBehindRenderer(el: HTMLElement, state: ShaderInstanceState): void {
  if (state.hiddenByRenderer) return
  const style = styleOf(state.ledgers, el)
  if (!style) return
  style.set('opacity', '0')
  state.hiddenByRenderer = true
}

function restoreInstanceOpacity(el: HTMLElement, state: ShaderInstanceState): void {
  if (!state.hiddenByRenderer) return
  state.hiddenByRenderer = false
  styleOf(state.ledgers, el)?.restore()
}

function createShaderInstance(info: {
  id: string; el: HTMLElement; opt: ShaderDrawOptions; renderer: SharedShaderRenderer; tex: TextureHolder; to: TextureHolder
}): EffectInstance {
  const state: ShaderInstanceState = {
    ledgers: createLedgerSet(info.el), hiddenByRenderer: false, progress: -1, audio: 0, geometry: null,
  }
  let isActive = false, isAcquired = false

  // Read once per frame, before this or any other instance draws — see `renderFrame`'s
  // `inputReaders` pass. `drawCall` below only ever reads the cached values back.
  //
  // The audio read is skipped entirely with no `audio:` band authored, rather than reading and
  // discarding: it is the half that can force a style recalculation, and an author who did not
  // ask for audio should not pay for one.
  //
  // The geometry measurement belongs here for the same reason and more so: it reads the element's
  // rect, its computed style and its clipping ancestors' (`measureElementGeometry`), all of which
  // a preceding instance's `opacity` write would have invalidated.
  const readInputs = () => {
    state.progress = info.opt.progress !== undefined && info.opt.progress >= 0
      ? info.opt.progress
      : readElementProgress(info.el)
    state.audio = info.opt.audioBand ? readAudioBand(info.el, info.opt.audioBand) : 0
    state.geometry = measureElementGeometry(info.el, info.renderer.window)
  }

  const drawCall: ShaderDrawFn = (_gl, time) => {
    let drew = false
    try {
      const texture = info.tex.get()
      drew = !!texture && drawElementQuad(info.renderer, info.el, {
        ...info.opt,
        texture,
        toTexture: info.to.get(),
        time,
        progress: state.progress,
        audio: state.audio,
        geometry: state.geometry,
      })
    } catch {
      restoreInstanceOpacity(info.el, state); info.renderer.unregister(info.id); return
    }
    if (drew) hideBehindRenderer(info.el, state)
    else restoreInstanceOpacity(info.el, state)
  }

  const restoreState = () => {
    if (!isActive) return
    isActive = false; info.renderer.unregister(info.id); restoreInstanceOpacity(info.el, state)
  }

  return createEffectInstance({
    continuous: true,
    activate() {
      if (isActive) return
      if (!isAcquired && !info.renderer.acquire()) return
      isAcquired = true; isActive = true
      info.renderer.register(info.id, drawCall, {
        onLost() { info.tex.reset(); info.to.reset(); restoreInstanceOpacity(info.el, state) },
        onRestored() {},
      }, readInputs)
      info.renderer.startLoop()
    },
    cancel: restoreState,
    finish: restoreState,
    destroy() {
      restoreState()
      if (isAcquired) { cleanupShaderTextures(info.tex, info.to, info.renderer); isAcquired = false }
    },
  })
}

export function prepareShaders(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (isReducedMotion(ctx)) return createInertInstance()
  const options = extractShaderOptions(params)
  if (!new Set(['displace', 'fluid', 'liquid', 'particles', 'morph']).has(options.mode)) return createInertInstance()

  const hostDoc = el?.ownerDocument
  const resolvedEnv = resolveEnv(ctx, hostDoc ? { document: hostDoc, window: hostDoc.defaultView } : undefined)
  const renderer = getSharedShaderRenderer(resolvedEnv)
  nextShaderId += 1
  const id = `kui-shader-instance-${nextShaderId}`
  const { texHolder, toHolder } = createShaderTextureHolders(el as HTMLElement, options, renderer)
  return createShaderInstance({ id, el: el as HTMLElement, opt: options, renderer, tex: texHolder, to: toHolder })
}

export const SHADER_PARAMETERS = {
  mode: { type: 'keyword' as const, default: 'displace', keywords: ['displace', 'fluid', 'liquid', 'particles', 'morph'], cssProperty: '--kui-shader-mode' },
  strength: { type: 'number' as const, default: '0.5', minimum: 0, maximum: 10, cssProperty: '--kui-shader-strength' },
  speed: { type: 'number' as const, default: '1.0', minimum: 0, maximum: 10, cssProperty: '--kui-shader-speed' },
  frequency: { type: 'number' as const, default: '10.0', minimum: 0.1, maximum: 50, cssProperty: '--kui-shader-frequency' },
  chromatic: { type: 'number' as const, default: '0.0', minimum: 0, maximum: 1, cssProperty: '--kui-shader-chromatic' },
  iridescence: { type: 'number' as const, default: '0.0', minimum: 0, maximum: 1, cssProperty: '--kui-shader-iridescence' },
  tint: { type: 'color' as const, default: '#ffffff', cssProperty: '--kui-shader-tint' },
  color1: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color1' },
  color2: { type: 'color' as const, default: '', cssProperty: '--kui-shader-color2' },
  blend: { type: 'keyword' as const, default: 'normal', keywords: ['normal', 'screen', 'multiply', 'add'], cssProperty: '--kui-shader-blend' },
  to: { type: 'text' as const, default: '', cssProperty: '--kui-shader-to' },
  progress: { type: 'number' as const, default: '-1', minimum: -1, maximum: 1, cssProperty: '--kui-progress' },
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
]

export function registerShaders(target: unknown): Registry | Animator {
  return registerInto(target, SHADERS_PRIMITIVE, SHADERS_PRESETS, 'Shaders')
}
