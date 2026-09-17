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

export interface ShaderUniformOptions {
  time?: number
  speed?: number
  strength?: number
  frequency?: number
  chromatic?: number
  iridescence?: number
  progress?: number
  localMouse?: { x: number; y: number }
  tintRgba?: [number, number, number, number]
  blendMode?: number
  isDuotone?: boolean
  c1Rgba?: [number, number, number, number]
  c2Rgba?: [number, number, number, number]
  uvOrigin?: [number, number]
  uvScale?: [number, number]
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

export type ProgramOrLocations = ProgramLocations | WebGLProgram | null

function resolveLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  progInfo: ProgramOrLocations,
): ProgramLocations | null {
  if (!progInfo) return null
  if ('program' in progInfo && progInfo.program) return progInfo
  const p = progInfo as WebGLProgram
  const g = (n: string) => gl.getUniformLocation(p, n)
  return {
    u_time: g('u_time'), u_strength: g('u_strength'), u_frequency: g('u_frequency'),
    u_chromatic: g('u_chromatic'), u_iridescence: g('u_iridescence'), u_mouse: g('u_mouse'),
    u_uvOrigin: g('u_uvOrigin'), u_uvScale: g('u_uvScale'), u_tint: g('u_tint'),
    u_blend: g('u_blend'), u_duotone: g('u_duotone'), u_color1: g('u_color1'),
    u_color2: g('u_color2'), u_image: g('u_image'), u_image_to: g('u_image_to'),
    u_progress: g('u_progress'),
  }
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
  uploadCoordUniforms(gl, locs, opt)
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

export interface ScissorResult {
  rect: DOMRect
  uvOrigin: [number, number]
  uvScale: [number, number]
}

export function setupScissor(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  el: HTMLElement,
  canvas: HTMLCanvasElement,
  win?: AnyWindow,
): ScissorResult | null {
  const rect = el.getBoundingClientRect()
  const { height, dpr } = getScissorEnv(win)
  if (!isRectVisible(rect, height)) return null

  const x = Math.round(rect.left * dpr)
  const y = Math.round(canvas.height - rect.bottom * dpr)
  const w = Math.round(rect.width * dpr)
  const h = Math.round(rect.height * dpr)

  const sx = Math.max(0, x)
  const sy = Math.max(0, y)
  const sw = Math.max(0, Math.min(canvas.width - sx, w + Math.min(0, x)))
  const sh = Math.max(0, Math.min(canvas.height - sy, h + Math.min(0, y)))
  if (sw <= 0 || sh <= 0) return null

  gl.enable(gl.SCISSOR_TEST)
  gl.viewport(sx, sy, sw, sh)
  gl.scissor(sx, sy, sw, sh)

  const u0 = Math.max(0, Math.min(1, (sx - x) / w))
  const us = Math.max(0, Math.min(1 - u0, sw / w))
  const v0 = Math.max(0, Math.min(1, ((y + h) - (sy + sh)) / h))
  const vs = Math.max(0, Math.min(1 - v0, sh / h))
  return { rect, uvOrigin: [u0, v0], uvScale: [us, vs] }
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

  const scissor = setupScissor(gl, el, canvas, renderer.window)
  if (!scissor) return false

  const localMouse = computeMousePos(renderer, scissor.rect)
  gl.useProgram(program)
  bindShaderTexture(gl, info, opt.texture, opt.toTexture)
  uploadUniforms(gl, info, {
    ...opt,
    localMouse,
    uvOrigin: scissor.uvOrigin,
    uvScale: scissor.uvScale,
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

function syncCanvasDimensions(canvas: HTMLCanvasElement, win: AnyWindow, dpr: number): void {
  const cw = Math.round((win?.innerWidth ?? 1000) * dpr)
  const ch = Math.round((win?.innerHeight ?? 800) * dpr)
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
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
   * One progress read per registered instance, run in full before any instance's draw call this
   * frame. See `renderFrame` for why the ordering — not just the reads themselves — is the point.
   */
  progressReaders = new Map<string, () => void>()
  programs: Record<string, ProgramLocations | null> = {}
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
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;'
    this.gl = this.canvas.getContext ? (this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null) : null
    if (!this.gl) return false

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
    readProgress?: () => void,
  ): void {
    this.drawCalls.set(id, fn)
    if (callbacks) this.contextCallbacks.set(id, callbacks)
    if (readProgress) this.progressReaders.set(id, readProgress)
    if (!this.isContextLost) this.startLoop()
  }

  unregister(id: string): void {
    this.drawCalls.delete(id); this.contextCallbacks.delete(id); this.progressReaders.delete(id)
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
    // Every registered instance's progress is read before any of them draws (and, for a hidden
    // instance, writes `opacity` — see `hideBehindRenderer`/`restoreInstanceOpacity`). A progress
    // read can fall back to `getComputedStyle` (`readElementProgress`), and interleaving that with
    // another instance's style write in the same pass would force a style recalculation once per
    // instance instead of once per frame.
    for (const readProgress of this.progressReaders.values()) invokeIsolated(readProgress)
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
    this.drawCalls.clear(); this.contextCallbacks.clear(); this.progressReaders.clear()
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
interface ShaderInstanceState { ledgers: LedgerSet; hiddenByRenderer: boolean; progress: number }

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
  const state: ShaderInstanceState = { ledgers: createLedgerSet(info.el), hiddenByRenderer: false, progress: -1 }
  let isActive = false, isAcquired = false

  // Read once per frame, before this or any other instance draws — see `renderFrame`'s
  // `progressReaders` pass. `drawCall` below only ever reads the cached value back.
  const readProgress = () => {
    state.progress = info.opt.progress !== undefined && info.opt.progress >= 0
      ? info.opt.progress
      : readElementProgress(info.el)
  }

  const drawCall: ShaderDrawFn = (_gl, time) => {
    let drew = false
    try {
      const texture = info.tex.get()
      drew = !!texture && drawElementQuad(info.renderer, info.el, {
        ...info.opt, texture, toTexture: info.to.get(), time, progress: state.progress,
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
      }, readProgress)
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
