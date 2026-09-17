// Created by Gemini 3.8 Flash
/**
 * kUInetic 3D Virtual Camera & Depth Projection Module
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import type { StyleLedger } from '../core/owned-styles.js'
import {
  type AdvancedEnv,
  type AdvancedLedgers,
  type WindowLike,
  type RafFunction,
  type CafFunction,
  clamp,
  createAdvancedLedgers,
  createEffectInstance,
  createInertInstance,
  isReducedMotion,
  registerInto,
  resolveEnv,
  styleOf,
} from './base.js'
import { AUDIO_BANDS, parseAudioBand, readAudioBand, type AudioBand } from './audio.js'

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
  /** Which `audio-source` band pushes the camera forward, or absent/null for none. */
  audio?: AudioBand | null
}

/**
 * How far a full-scale band pushes the camera, as a fraction of the scene's own `depth`.
 *
 * Expressed against `depth` rather than in pixels because `depth` is also the container's
 * `perspective`, and the two together are what decide how much closer the scene *looks*. A fixed
 * 60px push is a shove at `depth: 100` and invisible at `depth: 5000`; a tenth of `depth` reads as
 * the same ~5% swell at either end. It is a tenth rather than a half so a beat is a breath, not a
 * lurch: `cameraZ` already spans 0..depth across the scroll, so audio at full scale moves the
 * camera as far as scrolling 10% further through the scene.
 */
const AUDIO_PUSH_RATIO = 0.1

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
  audioRafId: number | null = null
  /** Last value read for the selected band, 0..1. Stays 0 for a scene with no `audio:`. */
  audioLevel = 0
  isListening = false

  /**
   * Container and every depth layer, each ledger opened at that element's first write and shared
   * with every other controller writing to the same element — see `createAdvancedLedgers`.
   *
   * A nested `camera-scene` matters here: `prepareCameraScene`'s `[data-kui*="camera-layer"]` query
   * is descendant-wide, so an inner scene claims the outer scene's layers too, and both write
   * `transform` to them.
   */
  private ledgers: AdvancedLedgers

  constructor(
    container: HTMLElement,
    options: CameraOptions = {},
    env: AdvancedEnv = {},
    hostLedger?: StyleLedger | null,
  ) {
    this.container = container
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.ledgers = createAdvancedLedgers(container, hostLedger)
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
    this.readAudio()
    // The scene's depth is a scroll position, and until something renders it every layer sits at
    // z = 0. `startLoop()` returns immediately when `mouse-tilt: off`, so a scene that never got
    // this call stayed visibly flat from load until the visitor's first scroll or resize.
    this.render()
    // Before `startLoop()`, which stands down when this one is running — see `startAudioLoop`.
    this.startAudioLoop()
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
    if (this.audioRafId) this.caf(this.audioRafId)
    this.audioRafId = null
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

  /** The selected band's current value, or 0 for a scene that asked for none. */
  readAudio(): void {
    this.audioLevel = this.options.audio ? readAudioBand(this.container, this.options.audio) : 0
  }

  /**
   * The one frame loop an audio-driven scene runs, doing every read before every write.
   *
   * An audio band changes on its own, without a scroll or a pointer move to hang a frame on, so
   * this scene needs a loop of its own — and then it needs to be the *only* loop, which is why
   * `onScroll` and `startLoop` both stand down while it is running. Three callbacks each reading
   * geometry (`getBoundingClientRect`) or style (`readAudioBand`'s computed fallback) and then
   * writing transforms would force a layout or style recalculation per callback per frame; one
   * pass that reads scroll position, reads the band, steps the pointer spring and only then
   * renders forces at most one.
   */
  startAudioLoop(): void {
    if (this.audioRafId || !this.options.audio) return
    const tick = () => {
      this.updateScroll()
      this.readAudio()
      if (this.options.mouseTilt) this.stepMouse()
      this.render()
      this.audioRafId = this.isListening ? this.raf(tick) : null
    }
    this.audioRafId = this.raf(tick)
  }

  onScroll(): void {
    // The audio loop already re-reads scroll position every frame.
    if (this.scrollRafId || this.audioRafId) return
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
    // The audio loop steps the pointer spring itself, so a second loop would only double the
    // renders and interleave its reads with this one's writes.
    if (this.rafId || this.audioRafId || !this.options.mouseTilt) return
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

    // `audioLevel` is 0 for every scene that did not ask for a band, and `+ 0` leaves `cameraZ`
    // and the transform string it produces exactly as they were.
    const cameraZ = this.cameraZ + this.audioLevel * (this.options.depth || 1000) * AUDIO_PUSH_RATIO
    for (const layer of this.layers) {
      styleOf(this.ledgers, layer.element)?.set(
        'transform',
        computeLayerTransform(layer.depthZ, cameraZ),
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
  // `off`, an unknown word and an accessor with no `text` at all all come back as `null`.
  const audio = parseAudioBand(params.text ? params.text('audio', 'off') : 'off')

  const htmlEl = el as HTMLElement
  // `ctx.style` is the host's entry in the animator's own `LedgerSet` (`animator.ts` hands every
  // JS primitive on an element the same one), so adopting it is what makes `camera-scene` and any
  // CSS-rendered effect on the same element share one capture instead of snapshotting each other.
  const controller = new CameraController(htmlEl, { depth, mouseTilt, audio }, resolvedEnv, ctx?.style)
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
  /**
   * Which `audio-source` band pushes the camera forward, if any.
   *
   * Same name, same words and the same `off` default as the `shaders` primitive's: one spelling
   * for "follow this band" across this directory rather than a second word per consumer. Opt-in
   * for the reason that one is — the value is written by another primitive, and a scene that read
   * it unasked would start pulsing the moment an unrelated `audio-source` appeared above it.
   *
   * Turning it on also changes *how* the scene renders: see `startAudioLoop`, which becomes the
   * scene's only frame loop.
   */
  audio: {
    type: 'keyword' as const,
    default: 'off',
    keywords: ['off', ...AUDIO_BANDS],
    cssProperty: '--kui-camera-audio',
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
