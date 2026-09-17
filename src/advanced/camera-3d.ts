// Created by Gemini 3.8 Flash
/**
 * kUInetic 3D Virtual Camera & Depth Projection Module
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import { createLedgerSet, type LedgerSet } from '../core/owned-styles.js'
import {
  type AdvancedEnv,
  type WindowLike,
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

export type CameraParamAccessor = EffectParams | {
  num?: (name: string, fallback?: number) => number
  text?: (name: string, fallback?: string) => string
}

export interface CameraLayer {
  element: HTMLElement
  depthZ: number
}

export interface CameraOptions {
  depth?: number
  mouseTilt?: boolean
}

/**
 * Parse depth value from CSS string.
 */
export function parseDepth(str?: string | null): number {
  if (!str) return 0
  const num = parseFloat(str)
  return Number.isNaN(num) ? 0 : num
}

/**
 * Pure 3D transform calculation for a single layer.
 */
export function computeLayerTransform(depthZ: number, cameraZ: number, tiltX = 0, tiltY = 0): string {
  const zOffset = depthZ + cameraZ * 0.5
  if (tiltX || tiltY) {
    return `translate3d(0, 0, ${zOffset}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`
  }
  return `translate3d(0, 0, ${zOffset}px)`
}

export class CameraController {
  container: HTMLElement
  options: CameraOptions
  env: AdvancedEnv
  window: Window | WindowLike | null
  raf: RafFunction
  caf: CafFunction
  layers: CameraLayer[] = []
  cameraZ = 0
  mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }
  rafId: number | null = null
  scrollRafId: number | null = null
  isListening = false

  /** Container and every depth layer, each ledger opened at that element's first write. */
  private ledgers: LedgerSet

  constructor(container: HTMLElement, options: CameraOptions = {}, env: AdvancedEnv = {}) {
    this.container = container
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.ledgers = createLedgerSet(container)
    this.onScroll = this.onScroll.bind(this)
    this.onMouseMove = this.onMouseMove.bind(this)
  }

  addLayer(element: HTMLElement, depthZ: number): void {
    this.layers.push({ element, depthZ })
  }

  applyLayer3D(): void {
    for (const layer of this.layers) {
      styleOf(this.ledgers, layer.element)?.set('transform-style', 'preserve-3d')
    }
  }

  bindEvents(): void {
    if (this.window?.addEventListener) {
      this.window.addEventListener('scroll', this.onScroll, { passive: true })
      if (this.options.mouseTilt) {
        this.window.addEventListener('pointermove', this.onMouseMove as EventListener, { passive: true })
      }
    }
  }

  start(): void {
    if (this.isListening || !this.container) return

    const stage = styleOf(this.ledgers, this.container)
    stage?.set('perspective', `${this.options.depth || 1000}px`)
    stage?.set('transform-style', 'preserve-3d')

    this.applyLayer3D()
    this.bindEvents()
    this.isListening = true
    this.updateScroll()
    // The scene's depth is a scroll position, and until something renders it every layer sits at
    // z = 0. `startLoop()` returns immediately when `mouse-tilt: off`, so a scene that never got
    // this call stayed visibly flat from load until the visitor's first scroll or resize.
    this.render()
    this.startLoop()
  }

  stop(): void {
    if (!this.isListening) return
    if (this.window?.removeEventListener) {
      this.window.removeEventListener('scroll', this.onScroll)
      this.window.removeEventListener('pointermove', this.onMouseMove as EventListener)
    }
    if (this.rafId) this.caf(this.rafId)
    this.rafId = null
    if (this.scrollRafId) this.caf(this.scrollRafId)
    this.scrollRafId = null
    this.isListening = false
  }

  updateScroll(): void {
    if (!this.container?.getBoundingClientRect) return
    const winHeight = this.window?.innerHeight ?? 800
    const rect = this.container.getBoundingClientRect()
    const travel = winHeight + rect.height
    const dist = winHeight - rect.top
    const progress = travel > 0 ? clamp(dist / travel, 0, 1) : 0
    this.cameraZ = progress * (this.options.depth || 1000)
  }

  onScroll(): void {
    if (this.scrollRafId) return
    const id = this.raf(() => {
      this.scrollRafId = null
      this.updateScroll()
      this.render()
    })
    if (id == null) {
      this.updateScroll()
      this.render()
    } else {
      this.scrollRafId = id
    }
  }

  onMouseMove(e: MouseEvent | { clientX: number; clientY: number }): void {
    if (!this.options.mouseTilt) return
    const winWidth = this.window?.innerWidth ?? 1000
    const winHeight = this.window?.innerHeight ?? 800
    const cx = winWidth * 0.5
    const cy = winHeight * 0.5
    this.mouse.targetX = (e.clientX - cx) / cx
    this.mouse.targetY = (e.clientY - cy) / cy
    this.startLoop()
  }

  stepMouse(): boolean {
    const dx = this.mouse.targetX - this.mouse.x
    const dy = this.mouse.targetY - this.mouse.y
    this.mouse.x += dx * 0.08
    this.mouse.y += dy * 0.08
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      this.mouse.x = this.mouse.targetX
      this.mouse.y = this.mouse.targetY
      return false
    }
    return true
  }

  startLoop(): void {
    if (this.rafId || !this.options.mouseTilt) return
    const tick = () => {
      const moving = this.stepMouse()
      this.render()
      if (this.isListening && moving) {
        this.rafId = this.raf(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = this.raf(tick)
  }

  /**
   * Tilt the whole stage toward the pointer.
   *
   * The author's own transform is read here, at the first frame that overwrites it, rather than
   * when the effect activated. Between those two moments sits at least one frame in which the
   * page's own code can write a transform, and a capture taken at activation would both overwrite
   * that write and hand the older value back on destroy as if it had never happened.
   *
   * `claim()` is what makes that true without a private snapshot field: it remembers `transform`'s
   * current value the first time this runs and is a no-op on every call after, so `peek()` always
   * answers with whatever was there just before this method's first write — the ledger already
   * tracks that for `restore()`; `peek()` is just asking it without writing.
   */
  private renderStageTilt(tiltX: number, tiltY: number): void {
    const stage = styleOf(this.ledgers, this.container)
    if (!stage) return
    stage.claim('transform')
    // Exactly-zero tilt writes the resting transform rather than removing the property, so a
    // pointer settling back to centre lands on the author's own transform, not on nothing.
    const resting = stage.peek('transform') || 'rotateX(0deg) rotateY(0deg)'
    stage.set('transform', (tiltX !== 0 || tiltY !== 0)
      ? `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`
      : resting)
  }

  render(): void {
    if (this.options.mouseTilt) {
      this.renderStageTilt(this.mouse.y * -8, this.mouse.x * 8)
    }

    for (const layer of this.layers) {
      styleOf(this.ledgers, layer.element)?.set(
        'transform',
        computeLayerTransform(layer.depthZ, this.cameraZ),
      )
    }
  }

  destroy(): void {
    this.stop()
    this.ledgers.restore()
    this.layers = []
  }
}

function parseMouseTilt(params: EffectParams): boolean {
  if (params.is) return params.is('mouse-tilt', 'on')
  if (params.text) return params.text('mouse-tilt', 'on') === 'on'
  return true
}

export function prepareCameraScene(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (isReducedMotion(ctx)) return createInertInstance()

  const resolvedEnv = resolveEnv(ctx)
  const depth = clamp(params.num ? params.num('depth', 1000) : 1000, 100, 5000)
  const mouseTilt = parseMouseTilt(params)

  const htmlEl = el as HTMLElement
  const controller = new CameraController(htmlEl, { depth, mouseTilt }, resolvedEnv)
  const layerEls = htmlEl.querySelectorAll ? htmlEl.querySelectorAll<HTMLElement>('[data-kui*="camera-layer"]') : []

  for (const layer of layerEls) {
    const kui = layer.getAttribute('data-kui') || ''
    const zMatch = /z:([+-]?[0-9.]+)(?:px)?/.exec(kui)
    const depthZ = zMatch ? parseDepth(zMatch[1]) : 0
    controller.addLayer(layer, depthZ)
  }

  return createEffectInstance({
    continuous: true,
    activate() {
      controller.start()
    },
    cancel() {
      controller.stop()
    },
    finish() {
      controller.stop()
    },
    destroy() {
      controller.destroy()
    },
  })
}

export const CAMERA_PARAMETERS = {
  depth: { type: 'number' as const, default: '1000', minimum: 100, maximum: 5000, cssProperty: '--kui-camera-depth' },
  'mouse-tilt': {
    type: 'keyword' as const,
    default: 'on',
    keywords: ['on', 'off'],
    cssProperty: '--kui-camera-tilt',
  },
}

export const CAMERA_PRIMITIVES: Primitive[] = [
  {
    id: 'camera-scene',
    renderer: 'javascript',
    channels: ['skew', 'perspective', 'transform-style'],
    parameters: CAMERA_PARAMETERS,
    supportedTimelines: ['scroll', 'time'],
    supportedActivations: ['load', 'enter'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare: prepareCameraScene,
  },
]

export const CAMERA_PRESETS: Preset[] = [
  { name: 'camera-scene', primitive: 'camera-scene' },
]

export function registerCamera(target: unknown): Registry | Animator {
  return registerInto(target, CAMERA_PRIMITIVES, CAMERA_PRESETS, 'Camera')
}
