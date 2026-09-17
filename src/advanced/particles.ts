// Created by Gemini 3.8 Flash
/**
 * kUInetic DOM Particle Dissolve & Mesh Emitter Module
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import { createLedgerSet, type LedgerSet } from '../core/owned-styles.js'
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
  styleOf,
} from './base.js'

export { clamp }

export type ParticleParamAccessor = EffectParams | {
  num?: (name: string, fallback?: number) => number
  text?: (name: string, fallback?: string) => string
}

export interface Particle {
  x: number
  y: number
  originX: number
  originY: number
  vx: number
  vy: number
  radius: number
  color: string
}

export interface ParticleOptions {
  count?: number
  radius?: number
  color?: string
}

/**
 * Pure physics step for a single particle.
 */
export function stepParticle(p: Particle, mouseX: number, mouseY: number, repelRadius: number): void {
  const dx = mouseX - p.x
  const dy = mouseY - p.y
  const dist = Math.hypot(dx, dy)

  if (dist < repelRadius && dist > 0) {
    const force = (repelRadius - dist) / repelRadius
    p.vx -= (dx / dist) * force * 5
    p.vy -= (dy / dist) * force * 5
  }

  const ox = p.originX - p.x
  const oy = p.originY - p.y
  p.vx += ox * 0.05
  p.vy += oy * 0.05

  p.vx *= 0.88
  p.vy *= 0.88

  p.x += p.vx
  p.y += p.vy
}

export function spawnParticlesGrid(count: number, color: string, width: number, height: number): Particle[] {
  const cols = Math.max(1, Math.round(Math.sqrt(count * (width / Math.max(height, 1)))))
  const rows = Math.max(1, Math.ceil(count / cols))
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    const originX = (i % cols) * (width / cols) + (width / (cols * 2))
    const originY = Math.floor(i / cols) * (height / rows) + (height / (rows * 2))
    particles.push({
      x: originX,
      y: originY,
      originX,
      originY,
      vx: 0,
      vy: 0,
      radius: (i % 3) + 1.5,
      color,
    })
  }
  return particles
}

function isParticleMoving(p: Particle): boolean {
  if (Math.abs(p.vx) > 0.02 || Math.abs(p.vy) > 0.02) return true
  return Math.abs(p.x - p.originX) > 0.5 || Math.abs(p.y - p.originY) > 0.5
}

export class ParticleEmitter {
  element: HTMLElement
  options: ParticleOptions
  env: AdvancedEnv
  window: Window | WindowLike | null
  document: Document | DocumentLike | null
  createCanvas: () => HTMLCanvasElement | null
  raf: RafFunction
  caf: CafFunction
  canvas: HTMLCanvasElement | null = null
  ctx: CanvasRenderingContext2D | null = null
  particles: Particle[] = []
  mouse = { x: -999, y: -999 }
  rafId: number | null = null
  isListening = false
  dpr = 1

  /**
   * The host's `position`, and what it was before this module needed a positioning context.
   *
   * The hand-rolled pair this replaced read back only the value, never the priority, so an
   * author's `position: relative !important` came back as a plain declaration on teardown. The
   * canvas's own `cssText` needs no ledger — that element is created and removed here.
   */
  private ledgers: LedgerSet

  constructor(element: HTMLElement, options: ParticleOptions = {}, env: AdvancedEnv = {}) {
    this.element = element
    this.options = options
    this.env = env
    this.ledgers = createLedgerSet(element)
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.document = resolved.document
    this.createCanvas = resolved.createCanvas
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.onMouseMove = this.onMouseMove.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
    this.onResize = this.onResize.bind(this)
  }

  syncDimensions(): number {
    if (!this.canvas || !this.element?.getBoundingClientRect) return 1
    const rect = this.element.getBoundingClientRect()
    this.dpr = Math.min(this.window?.devicePixelRatio ?? 1, 2)
    const cw = Math.round(rect.width * this.dpr)
    const ch = Math.round(rect.height * this.dpr)
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
      this.canvas.style.width = `${rect.width}px`
      this.canvas.style.height = `${rect.height}px`
    }
    return this.dpr
  }

  setupPosition(): void {
    if (!this.window?.getComputedStyle) return
    if (this.window.getComputedStyle(this.element).position !== 'static') return
    styleOf(this.ledgers, this.element)?.set('position', 'relative')
  }

  init(): boolean {
    if (!this.document || !this.element?.getBoundingClientRect) return false
    this.canvas = this.createCanvas()
    if (!this.canvas) return false

    this.canvas.className = 'kui-particle-canvas'
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:10;'
    this.ctx = this.canvas.getContext ? (this.canvas.getContext('2d') as CanvasRenderingContext2D | null) : null
    if (!this.ctx) return false

    this.setupPosition()
    this.element.appendChild(this.canvas)
    this.syncDimensions()

    const rect = this.element.getBoundingClientRect()
    this.spawnParticles(rect.width, rect.height)
    this.bindEvents()
    return true
  }

  spawnParticles(width: number, height: number): void {
    const count = this.options.count || 60
    const color = this.options.color || '#e4f222'
    this.particles = spawnParticlesGrid(count, color, width, height)
  }

  resizeObserver: ResizeObserver | null = null

  bindEvents(): void {
    if (this.isListening) return
    this.element.addEventListener('pointermove', this.onMouseMove as EventListener, { passive: true })
    this.element.addEventListener('pointerleave', this.onMouseLeave as EventListener, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize())
      this.resizeObserver.observe(this.element)
    } else if (this.window?.addEventListener) {
      this.window.addEventListener('resize', this.onResize, { passive: true })
    }
    this.isListening = true
  }

  unbindEvents(): void {
    if (!this.isListening) return
    if (this.element?.removeEventListener) {
      this.element.removeEventListener('pointermove', this.onMouseMove as EventListener)
      this.element.removeEventListener('pointerleave', this.onMouseLeave as EventListener)
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    if (this.window?.removeEventListener) {
      this.window.removeEventListener('resize', this.onResize)
    }
    this.isListening = false
  }

  onResize(): void {
    this.syncDimensions()
    if (this.element?.getBoundingClientRect) {
      const rect = this.element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        this.spawnParticles(rect.width, rect.height)
      }
    }
    this.draw()
  }

  onMouseMove(e: MouseEvent | { clientX: number; clientY: number }): void {
    if (!this.canvas?.getBoundingClientRect) return
    const rect = this.canvas.getBoundingClientRect()
    this.mouse.x = e.clientX - rect.left
    this.mouse.y = e.clientY - rect.top
    this.startLoop()
  }

  onMouseLeave(): void {
    this.mouse.x = -999
    this.mouse.y = -999
  }

  startLoop(): void {
    if (this.rafId) return
    const tick = () => {
      const moving = this.update()
      this.draw()
      if (this.isListening && (moving || this.mouse.x !== -999)) {
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

  update(): boolean {
    const repelRadius = this.options.radius || 80
    let anyMoving = false
    for (const p of this.particles) {
      stepParticle(p, this.mouse.x, this.mouse.y, repelRadius)
      if (isParticleMoving(p)) {
        anyMoving = true
      }
    }
    return anyMoving
  }

  draw(): void {
    if (!this.ctx || !this.canvas) return
    const dpr = this.dpr || 1
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    for (const p of this.particles) {
      this.ctx.beginPath()
      this.ctx.arc(p.x * dpr, p.y * dpr, p.radius * dpr, 0, Math.PI * 2)
      this.ctx.fillStyle = p.color
      this.ctx.fill()
    }
  }

  destroy(): void {
    this.stopLoop()
    this.unbindEvents()
    this.ledgers.restore()
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
    this.ctx = null
    this.particles = []
  }
}

export function prepareParticles(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (isReducedMotion(ctx)) return createInertInstance()

  const resolvedEnv = resolveEnv(ctx)
  const count = clamp(params.num ? params.num('count', 60) : 60, 10, 300)
  const radius = clamp(params.num ? params.num('radius', 80) : 80, 20, 300)
  const color = params.text ? params.text('color', '#e4f222') : '#e4f222'

  const htmlEl = el as HTMLElement
  const emitter = new ParticleEmitter(htmlEl, { count, radius, color }, resolvedEnv)
  let isMounted = false

  return createEffectInstance({
    continuous: true,
    activate() {
      if (!isMounted) {
        isMounted = emitter.init()
      } else if (!emitter.isListening) {
        emitter.bindEvents()
      }
      if (isMounted) {
        emitter.startLoop()
      }
    },
    cancel() {
      emitter.stopLoop()
      emitter.unbindEvents()
    },
    finish() {
      emitter.stopLoop()
      emitter.unbindEvents()
    },
    destroy() {
      if (isMounted) {
        emitter.destroy()
        isMounted = false
      }
    },
  })
}

export const PARTICLE_PARAMETERS = {
  count: { type: 'number' as const, default: '60', minimum: 10, maximum: 300, cssProperty: '--kui-particle-count' },
  radius: { type: 'number' as const, default: '80', minimum: 20, maximum: 300, cssProperty: '--kui-particle-radius' },
  color: { type: 'color' as const, default: '#e4f222', cssProperty: '--kui-particle-color' },
}

export const PARTICLE_PRIMITIVES: Primitive[] = [
  {
    id: 'particle-dissolve',
    renderer: 'javascript',
    channels: ['position'],
    parameters: PARTICLE_PARAMETERS,
    supportedTimelines: ['time'],
    supportedActivations: ['hover', 'load'],
    defaultActivation: 'hover',
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare: prepareParticles,
  },
]

export const PARTICLE_PRESETS: Preset[] = [
  { name: 'particle-dissolve', primitive: 'particle-dissolve' },
]

export function registerParticles(target: unknown): Registry | Animator {
  return registerInto(target, PARTICLE_PRIMITIVES, PARTICLE_PRESETS, 'Particles')
}
