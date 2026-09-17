// Created by Gemini 3.8 Flash
/**
 * kUInetic Cinematic Scene & Timeline Choreography Module
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
  lerp,
  registerInto,
  resolveEnv,
  styleOf,
} from './base.js'

export { clamp, lerp }

export type SceneParamAccessor = EffectParams | {
  num?: (name: string, fallback?: number) => number
  text?: (name: string, fallback?: string) => string
}

export interface TransitionValue {
  from: number
  to: number
  unit: string
}

export interface StepConfig {
  range: [number, number]
  opacity?: TransitionValue | null
  x?: TransitionValue | null
  y?: TransitionValue | null
  scale?: TransitionValue | null
}

export interface StepRecord {
  element: HTMLElement
  config: StepConfig
}

export interface SceneOptions {
  name?: string
  progress?: 'scroll' | 'time' | string
  duration?: number
}

const AT_REGEX = /\bat:([0-9.]+)\.\.([0-9.]+)/
const OPACITY_REGEX = /\bopacity:([0-9.]+)->([0-9.]+)/
const X_REGEX = /\bx:([+-]?[0-9.]+[a-z%]*)->([+-]?[0-9.]+[a-z%]*)/i
const Y_REGEX = /\by:([+-]?[0-9.]+[a-z%]*)->([+-]?[0-9.]+[a-z%]*)/i
const SCALE_REGEX = /\bscale:([0-9.]+)->([0-9.]+)/

/**
 * Parse an interval range string "start..end" into [start, end].
 */
export function parseRange(rangeStr?: string | null): [number, number] {
  if (!rangeStr || !rangeStr.includes('..')) return [0, 1]
  const [s, e] = rangeStr.split('..').map((v) => parseFloat(v.trim()))
  return [Number.isNaN(s) ? 0 : s!, Number.isNaN(e) ? 1 : e!]
}

/**
 * Extract unit from CSS dimension string (e.g. '100px' -> 'px', '50%' -> '%').
 */
function extractUnit(str: string): string {
  let i = str.length - 1
  while (i >= 0 && ((str[i]! >= 'a' && str[i]! <= 'z') || (str[i]! >= 'A' && str[i]! <= 'Z') || str[i] === '%')) {
    i--
  }
  return str.slice(i + 1)
}

/**
 * Parse a transition expression like "0->1", "0->100px", or "40px->0px".
 */
export function parseTransitionValue(str?: string | null): TransitionValue | null {
  if (!str) return null
  const arrowIdx = str.indexOf('->')
  if (arrowIdx === -1) return null
  const fromStr = str.slice(0, arrowIdx).trim()
  const toStr = str.slice(arrowIdx + 2).trim()
  const fromNum = parseFloat(fromStr)
  const toNum = parseFloat(toStr)
  if (Number.isNaN(fromNum) || Number.isNaN(toNum)) return null

  const unit = extractUnit(fromStr) || extractUnit(toStr)
  return { from: fromNum, to: toNum, unit }
}

/**
 * Parse a child element's `data-kui` attribute into scene step transitions.
 */
export function parseChildStep(child: Element | null): StepConfig {
  const kui = child?.getAttribute ? (child.getAttribute('data-kui') || '') : ''
  const atMatch = AT_REGEX.exec(kui)
  const range: [number, number] = atMatch ? [parseFloat(atMatch[1]!), parseFloat(atMatch[2]!)] : [0, 1]

  const opMatch = OPACITY_REGEX.exec(kui)
  const opacity = opMatch ? parseTransitionValue(`${opMatch[1]}->${opMatch[2]}`) : null

  const xMatch = X_REGEX.exec(kui)
  const x = xMatch ? parseTransitionValue(`${xMatch[1]}->${xMatch[2]}`) : null

  const yMatch = Y_REGEX.exec(kui)
  const y = yMatch ? parseTransitionValue(`${yMatch[1]}->${yMatch[2]}`) : null

  const scMatch = SCALE_REGEX.exec(kui)
  const scale = scMatch ? parseTransitionValue(`${scMatch[1]}->${scMatch[2]}`) : null

  return { range, opacity, x, y, scale }
}

/**
 * Build transform CSS string from config and local progress.
 */
function buildStepTransforms(cfg: StepConfig, localT: number): string {
  const transforms: string[] = []
  if (cfg.x) {
    transforms.push(`translateX(${lerp(cfg.x.from, cfg.x.to, localT)}${cfg.x.unit})`)
  }
  if (cfg.y) {
    transforms.push(`translateY(${lerp(cfg.y.from, cfg.y.to, localT)}${cfg.y.unit})`)
  }
  if (cfg.scale) {
    transforms.push(`scale(${lerp(cfg.scale.from, cfg.scale.to, localT)})`)
  }
  return transforms.join(' ')
}

export class SceneController {
  container: HTMLElement
  options: SceneOptions
  env: AdvancedEnv
  window: Window | WindowLike | null
  raf: RafFunction
  caf: CafFunction
  steps: StepRecord[] = []
  progress = 0
  rafId: number | null = null
  isListening = false
  timeStart = 0

  /**
   * One ledger per step element, each opened at that step's first write and shared with every
   * other controller writing to the same element — see `createAdvancedLedgers`.
   *
   * Steps are collected during `prepare`, which can be a long way before the scene ever scrolls
   * into view. Recording opacity and transform *there* meant destroy restored the markup as it
   * looked at preparation time, discarding anything the author wrote in between.
   *
   * Sharing is what makes a nested `scene` safe: `prepareScene`'s `[data-kui*="scene-step"]` query
   * is descendant-wide and does not stop at an inner `scene`, so a step inside two scenes is
   * claimed by both and written by both, every frame.
   */
  private ledgers: AdvancedLedgers

  constructor(
    container: HTMLElement,
    options: SceneOptions = {},
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
  }

  addStep(element: HTMLElement, config: StepConfig): void {
    this.steps.push({ element, config })
  }

  start(onComplete?: () => void): void {
    if (this.isListening) return
    if (!this.window && this.options.progress !== 'time') return
    this.isListening = true

    if (this.options.progress === 'time') {
      this.startTimeLoop(onComplete)
    } else {
      if (this.window?.addEventListener) {
        this.window.addEventListener('scroll', this.onScroll, { passive: true })
        this.window.addEventListener('resize', this.onScroll, { passive: true })
      }
      this.onScroll()
    }
  }

  stop(): void {
    if (!this.isListening) return
    if (this.window?.removeEventListener) {
      this.window.removeEventListener('scroll', this.onScroll)
      this.window.removeEventListener('resize', this.onScroll)
    }
    if (this.rafId) this.caf(this.rafId)
    this.rafId = null
    this.isListening = false
  }

  startTimeLoop(onComplete?: () => void): void {
    const duration = this.options.duration || 1000
    const now = () => (this.window?.performance?.now ? this.window.performance.now() : Date.now())
    this.timeStart = now()

    const tick = () => {
      const elapsed = now() - this.timeStart
      this.progress = clamp(elapsed / duration, 0, 1)
      this.updateAll()
      if (this.isListening && this.progress < 1) {
        this.rafId = this.raf(tick)
      } else {
        this.rafId = null
        this.isListening = false
        if (onComplete) onComplete()
      }
    }
    this.rafId = this.raf(tick)
  }

  onScroll(): void {
    if (this.rafId) return
    this.rafId = this.raf(() => {
      this.rafId = null
      this.calculateProgress()
      this.updateAll()
    })
  }

  calculateProgress(): void {
    if (!this.container?.getBoundingClientRect) {
      this.progress = 0
      return
    }
    const winHeight = this.window?.innerHeight ?? 800
    const rect = this.container.getBoundingClientRect()
    const totalDist = winHeight + rect.height
    const currentDist = winHeight - rect.top
    this.progress = totalDist > 0 ? clamp(currentDist / totalDist, 0, 1) : 0
  }

  updateAll(): void {
    for (const step of this.steps) {
      this.updateElement(step.element, step.config, this.progress)
    }
  }

  updateElement(el: HTMLElement, cfg: StepConfig, globalProgress: number): void {
    const [start, end] = cfg.range
    if (start >= end) return
    const style = styleOf(this.ledgers, el)
    if (!style) return
    const localT = clamp((globalProgress - start) / (end - start), 0, 1)

    if (cfg.opacity) {
      style.set('opacity', String(lerp(cfg.opacity.from, cfg.opacity.to, localT)))
    }

    const t = buildStepTransforms(cfg, localT)
    if (t) style.set('transform', t)
  }

  destroy(): void {
    this.stop()
    this.ledgers.restore()
    this.steps = []
  }
}

export function prepareScene(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (isReducedMotion(ctx)) return createInertInstance()

  const resolvedEnv = resolveEnv(ctx)
  const name = params.text ? params.text('name', 'default') : 'default'
  const progressMode = params.text ? params.text('progress', 'scroll') : 'scroll'
  const duration = clamp(params.num ? params.num('duration', 1000) : 1000, 100, 60000)

  const htmlEl = el as HTMLElement
  // `ctx.style` is this element's entry in the animator's own `LedgerSet`; see `camera-3d.ts`.
  const controller = new SceneController(
    htmlEl,
    { name, progress: progressMode, duration },
    resolvedEnv,
    ctx?.style,
  )
  const childSteps = htmlEl.querySelectorAll ? htmlEl.querySelectorAll<HTMLElement>('[data-kui*="scene-step"]') : []
  for (const child of childSteps) {
    controller.addStep(child, parseChildStep(child))
  }

  const inst: EffectInstance = createEffectInstance({
    continuous: progressMode === 'scroll',
    activate() {
      if (progressMode === 'time') {
        controller.start(() => inst.finish())
      } else {
        controller.start()
      }
    },
    cancel() {
      controller.stop()
    },
    finish() {
      controller.progress = 1
      controller.updateAll()
      controller.stop()
    },
    destroy() {
      controller.destroy()
    },
  })
  return inst
}

export const SCENE_PARAMETERS = {
  name: { type: 'text' as const, default: 'default', cssProperty: '--kui-scene-name' },
  progress: {
    type: 'keyword' as const,
    default: 'scroll',
    keywords: ['scroll', 'time'],
    cssProperty: '--kui-scene-progress',
  },
  duration: {
    type: 'number' as const,
    default: '1000',
    minimum: 100,
    maximum: 60000,
    cssProperty: '--kui-scene-duration',
  },
}

export const SCENE_PRIMITIVES: Primitive[] = [
  {
    id: 'scene',
    renderer: 'javascript',
    channels: ['opacity', 'skew'],
    parameters: SCENE_PARAMETERS,
    supportedTimelines: ['scroll', 'time'],
    supportedActivations: ['load', 'enter'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare: prepareScene,
  },
]

export const SCENE_PRESETS: Preset[] = [
  { name: 'scene', primitive: 'scene' },
]

export function registerScenes(target: unknown): Registry | Animator {
  return registerInto(target, SCENE_PRIMITIVES, SCENE_PRESETS, 'Scenes')
}
