// Created by Gemini 3.8 Flash
/**
 * kUInetic Fluid Cursor - Interactive Liquid Cursor Trails
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import {
  type AdvancedEnv,
  type WindowLike,
  type DocumentLike,
  type RafFunction,
  type CafFunction,
  clamp,
  createEffectInstance,
  createInertInstance,
  isReducedMotion,
  registerInto,
  resolveEnv,
} from './base.js'

export { clamp }

export type FluidParamAccessor = EffectParams | {
  num?: (name: string, fallback?: number) => number
  text?: (name: string, fallback?: string) => string
}

export interface FluidDrop {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  color: string
  viscosity?: number
}

export interface FluidTrailOptions {
  size?: number
  viscosity?: number
  color?: string
}

export interface FluidClient {
  options: FluidTrailOptions
  el?: Element
}

export function stepFluidDrop(drop: FluidDrop, friction: number): boolean {
  drop.x += drop.vx
  drop.y += drop.vy
  drop.vx *= friction
  drop.vy *= friction
  drop.alpha *= 0.94
  return drop.alpha < 0.02
}

export function syncCanvasSize(canvas: HTMLCanvasElement | null, win: Window | WindowLike | null): number {
  if (!canvas) return 1
  const dpr = Math.min(win?.devicePixelRatio ?? 1, 2)
  const w = Math.round((win?.innerWidth ?? 1000) * dpr)
  const h = Math.round((win?.innerHeight ?? 800) * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return dpr
}

export class FluidTrail {
  options: FluidTrailOptions
  env: AdvancedEnv
  window: Window | WindowLike | null
  document: Document | DocumentLike | null
  createCanvas: () => HTMLCanvasElement | null
  raf: RafFunction
  caf: CafFunction
  drops: FluidDrop[] = []
  canvas: HTMLCanvasElement | null = null
  ctx: CanvasRenderingContext2D | null = null
  rafId: number | null = null
  isListening = false
  lastMouse = { x: 0, y: 0 }
  hasLastMouse = false
  wasOutside = false
  refCount = 0
  clients = new Map<number, FluidClient>()
  activeClients = new Map<number, FluidClient>()
  private nextClientId = 1
  onResize?: () => void
  onPointerMove?: (e: PointerEvent | { clientX: number; clientY: number }) => void
  mapKey: object

  constructor(options: FluidTrailOptions = {}, env: AdvancedEnv = {}) {
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.document = resolved.document
    this.createCanvas = resolved.createCanvas
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.mapKey = (resolved.document ?? resolved.window ?? fallbackFluidKey) as object
  }

  acquire(): boolean {
    if (this.ctx) {
      this.refCount++
      return true
    }
    const ok = this.init()
    if (ok) this.refCount++
    return ok
  }

  release(): void {
    if (this.refCount > 0) this.refCount--
    if (this.refCount === 0 && this.clients.size === 0) this.destroy()
  }

  registerClient(options: FluidTrailOptions, el?: Element): number {
    const id = this.nextClientId++
    this.clients.set(id, { options, el })
    return id
  }

  activateClient(id: number): boolean {
    const client = this.clients.get(id)
    if (!client) return false
    this.activeClients.set(id, client)
    if (!this.canvas && !this.setupCanvas()) return false
    this.attachListeners()
    this.startLoop()
    return true
  }

  deactivateClient(id: number): void {
    this.activeClients.delete(id)
    if (this.activeClients.size > 0 || this.refCount > 0) return
    this.detachListeners()
    this.stopLoop()
    this.clearOverlay()
  }

  /**
   * Wipe the overlay when the last client stands down.
   *
   * `draw()` clears the canvas at the *start* of a frame, so stopping the loop leaves whatever was
   * in flight painted. The overlay is `position: fixed` at `z-index: 9998` across the whole
   * viewport, so a `fluid-trail` on `on:pointerenter`/`pointerleave` — or an author's
   * `control.cancel()` mid-move — left a frozen blob of drops over the entire page until something
   * reactivated it or the element was destroyed.
   *
   * The canvas itself stays mounted on purpose: registration happens at prepare, so the last
   * *unregister* owns the teardown and no client can have the canvas pulled from under it.
   *
   * @complexity O(1).
   */
  private clearOverlay(): void {
    this.drops = []
    const canvas = this.canvas
    if (!canvas || typeof this.ctx?.clearRect !== 'function') return
    this.ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  unregisterClient(id: number): void {
    this.deactivateClient(id)
    this.clients.delete(id)
    if (this.clients.size === 0 && this.refCount === 0) {
      this.destroy()
    }
  }

  setupCanvas(): boolean {
    if (this.canvas && this.ctx) return true
    if (!this.document?.body?.appendChild) return false
    this.canvas = this.createCanvas()
    if (!this.canvas) return false

    this.canvas.className = 'kui-fluid-canvas'
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;'
    this.ctx = this.canvas.getContext ? (this.canvas.getContext('2d') as CanvasRenderingContext2D | null) : null
    if (!this.ctx) {
      this.canvas = null
      return false
    }

    this.document.body.appendChild(this.canvas)
    syncCanvasSize(this.canvas, this.window)
    return true
  }

  attachListeners(): void {
    if (this.isListening) return
    this.onResize = () => syncCanvasSize(this.canvas, this.window)
    this.onPointerMove = (e: PointerEvent | { clientX: number; clientY: number; target?: EventTarget | null }) => {
      const client = this.resolveClientOwner(e)
      if (!client) {
        this.lastMouse.x = e.clientX; this.lastMouse.y = e.clientY; this.wasOutside = true; return
      }
      const isEntry = this.wasOutside
      const dx = isEntry ? 0 : e.clientX - this.lastMouse.x
      const dy = isEntry ? 0 : e.clientY - this.lastMouse.y
      this.wasOutside = false
      if (Math.hypot(dx, dy) > 2 || isEntry || !this.hasLastMouse) {
        this.hasLastMouse = true
        const vx = Math.max(-20, Math.min(20, dx * 0.2))
        const vy = Math.max(-20, Math.min(20, dy * 0.2))
        this.spawnDrop(e.clientX, e.clientY, vx, vy, client.options)
        this.startLoop()
      }
      this.lastMouse.x = e.clientX
      this.lastMouse.y = e.clientY
    }

    if (this.window?.addEventListener) {
      this.window.addEventListener('resize', this.onResize, { passive: true })
      this.window.addEventListener('pointermove', this.onPointerMove as EventListener, { passive: true })
      this.isListening = true
    }
  }

  detachListeners(): void {
    if (this.window?.removeEventListener && this.isListening) {
      if (this.onResize) this.window.removeEventListener('resize', this.onResize)
      if (this.onPointerMove) this.window.removeEventListener('pointermove', this.onPointerMove as EventListener)
      this.isListening = false
      this.hasLastMouse = false
      this.wasOutside = false
    }
  }

  init(): boolean {
    if (!this.setupCanvas()) return false
    this.attachListeners()
    return true
  }

  private findClientByTarget(target?: EventTarget | null): FluidClient | null {
    let curr = (target && typeof (target as Node).nodeType === 'number') ? (target as Node | null) : null
    while (curr) {
      for (const client of this.activeClients.values()) {
        if (client.el && client.el === (curr as unknown as HTMLElement)) return client
      }
      curr = curr.parentNode
    }
    return null
  }

  private findClientByCoords(x: number, y: number): FluidClient | null {
    for (const client of this.activeClients.values()) {
      const rect = client.el?.getBoundingClientRect?.()
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return client
    }
    return null
  }

  resolveClientOwner(e: { clientX: number; clientY: number; target?: EventTarget | null }): FluidClient | null {
    if (this.activeClients.size === 0) return { options: this.options, el: undefined }
    return this.findClientByTarget(e.target) ?? this.findClientByCoords(e.clientX, e.clientY)
  }

  getOptionsAt(x: number, y: number): FluidTrailOptions | null {
    return this.findClientByCoords(x, y)?.options ?? null
  }

  // eslint-disable-next-line max-params -- (x, y, vx, vy, customOpts) is the established drop coordinate and velocity signature
  spawnDrop(x: number, y: number, vx: number, vy: number, customOpts?: FluidTrailOptions): void {
    const activeOpts = customOpts ?? (this.activeClients.size === 0 ? this.options : this.getOptionsAt(x, y))
    if (!activeOpts) return
    this.drops.push({
      x,
      y,
      vx,
      vy,
      size: activeOpts.size ?? this.options.size ?? 28,
      alpha: 0.8,
      color: activeOpts.color ?? this.options.color ?? '#e4f222',
      viscosity: activeOpts.viscosity ?? this.options.viscosity ?? 0.88,
    })
  }

  startLoop(): void {
    if (this.rafId) return
    const tick = () => {
      this.update()
      this.draw()
      if (this.drops.length > 0 && this.ctx) {
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

  update(): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i]
      if (drop && stepFluidDrop(drop, drop.viscosity ?? 0.88)) {
        this.drops.splice(i, 1)
      }
    }
  }

  draw(): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    const dpr = syncCanvasSize(this.canvas, this.window)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    for (const drop of this.drops) {
      if (typeof ctx.save === 'function') ctx.save()
      ctx.globalAlpha = drop.alpha
      ctx.fillStyle = drop.color
      ctx.beginPath()
      ctx.arc(drop.x * dpr, drop.y * dpr, drop.size * dpr * 0.5, 0, Math.PI * 2)
      ctx.fill()
      if (typeof ctx.restore === 'function') ctx.restore()
    }
  }

  destroy(): void {
    this.stopLoop()
    this.detachListeners()
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
    this.ctx = null
    this.drops = []
    this.refCount = 0
    this.clients.clear()
    this.activeClients.clear()
    fluidTrails.delete(this.mapKey)
  }
}

const fluidTrails = new WeakMap<object, FluidTrail>()
const fallbackFluidKey = {}

export function getSharedFluidTrail(env?: AdvancedEnv): FluidTrail {
  const resolved = resolveEnv(null, env)
  const key = (resolved.document ?? resolved.window ?? fallbackFluidKey) as object
  let trail = fluidTrails.get(key)
  if (!trail) {
    trail = new FluidTrail({}, env)
    fluidTrails.set(key, trail)
  }
  return trail
}

/**
 * Install (or clear) the trail for one document.
 *
 * Same asymmetry `setSharedShaderRenderer` closes, for the same reason: `destroy()` deletes only
 * `this.mapKey`, so an instance stored under a different document's key outlives its own teardown
 * and is handed to every later lookup for that document with its canvas already removed. The
 * instance's own key wins; a mismatched caller key is cleared rather than left dangling.
 */
export function setSharedFluidTrail(instance: FluidTrail | null, env?: AdvancedEnv): void {
  const resolved = resolveEnv(null, env)
  const key = (resolved.document ?? resolved.window ?? fallbackFluidKey) as object
  if (!instance) {
    fluidTrails.delete(key)
    return
  }
  const own = instance.mapKey ?? key
  if (own !== key) fluidTrails.delete(key)
  fluidTrails.set(own, instance)
}

export function prepareFluidCursor(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  /*
   * Inert, considered and kept. The tier's reduced-motion target is a still frame where one
   * exists (`shaders.ts`, and now `camera-3d.ts` and `scenes.ts`); a pointer trail has none. The
   * effect is a shared canvas over the whole document whose entire content is where the cursor
   * has just been — with no pointer there is no trail, only a blob parked at a position the
   * visitor never chose. This primitive declares `channels: []` and never writes to the host at
   * all, so "no effect" already leaves the author's page exactly as written.
   */
  if (isReducedMotion(ctx)) return createInertInstance()
  const hostDoc = el?.ownerDocument
  const resolvedEnv = resolveEnv(ctx, hostDoc ? { document: hostDoc, window: hostDoc.defaultView } : undefined)
  if (!resolvedEnv.document?.body) {
    return createInertInstance()
  }

  const size = clamp(params.num ? params.num('size', 28) : 28, 4, 120)
  const viscosity = clamp(params.num ? params.num('viscosity', 0.88) : 0.88, 0.1, 0.99)
  const color = params.text ? params.text('color', '#e4f222') : '#e4f222'

  const trail = getSharedFluidTrail(resolvedEnv)
  const clientId = trail.registerClient({ size, viscosity, color }, el)

  return createEffectInstance({
    continuous: true,
    activate() { trail.activateClient(clientId) },
    cancel() { trail.deactivateClient(clientId) },
    finish() { trail.deactivateClient(clientId) },
    destroy() { trail.unregisterClient(clientId) },
  })
}

export const FLUID_PARAMETERS = {
  size: { type: 'number' as const, default: '28', minimum: 4, maximum: 120, cssProperty: '--kui-fluid-size' },
  viscosity: { type: 'number' as const, default: '0.88', minimum: 0.1, maximum: 0.99, cssProperty: '--kui-fluid-viscosity' },
  color: { type: 'color' as const, default: '#e4f222', cssProperty: '--kui-fluid-color' },
}

export const FLUID_PRIMITIVES: Primitive[] = [
  {
    id: 'fluid-trail', renderer: 'javascript', channels: [], parameters: FLUID_PARAMETERS,
    supportedTimelines: ['time'], supportedActivations: ['load', 'hover'], defaultActivation: 'load',
    perfClass: 'continuous', reducedMotion: 'disable', prepare: prepareFluidCursor,
  },
]

export const FLUID_PRESETS: Preset[] = [
  { name: 'fluid-trail', primitive: 'fluid-trail' },
  { name: 'cursor-fluid', primitive: 'fluid-trail' },
  { name: 'fluid-cursor', primitive: 'fluid-trail' },
]

export function registerFluidCursor(target: unknown): Registry | Animator {
  return registerInto(target, FLUID_PRIMITIVES[0]!, FLUID_PRESETS, 'FluidCursor')
}
