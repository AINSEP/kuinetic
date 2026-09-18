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

/**
 * The core's own number spelling — `NUM` in `core/params.ts`, kept character-for-character.
 *
 * Repeated here rather than imported because this module reads a step's window off the *raw*
 * `data-kui` attribute rather than through the step's validated parameters (see
 * {@link parseChildStep}). Two grammars read the same text, so they have to agree: a value the
 * core accepts and this module cannot read would be validated and then silently ignored, which is
 * the failure mode the whole `from:`/`to:` split exists to remove.
 */
const NUM = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`

/**
 * A step's progress window, as two independent parameters.
 *
 * Spelled `from:`/`to:` rather than the `at:0..0.4` this module used to accept, for three reasons
 * that all point the same way:
 *
 * - **`at:` is not this module's to take.** `core/parse.ts`'s `applyLifted` claims the key
 *   unconditionally, before any parameter schema is consulted and with no registry in scope, and
 *   hands it to `core/sequence.ts` as a *relative time position*. A registered `scene-step` that
 *   still spelled its window `at:0..0.4` would have traded the old "unknown effect" warning for
 *   `at:"0..0.4" is not a position` — a lecture telling the author to write `at:with`, which would
 *   break their scene.
 * - **`from:`/`to:` is what this repository already calls a pair.** It is one of the most common
 *   parameter names in the catalog (see `core/stagger-config.ts`, which routes its *own* group
 *   ordering to `order:` precisely so as not to collide with it).
 * - **Two numbers can be validated; one range string cannot.** `0..0.4` is none of the ten
 *   `ScalarParamType`s, so it could only ever be declared `text`, which validates nothing at all.
 *   Declared as two bounded `number` parameters, the core rejects `from:banana` and `to:5` before
 *   `prepare` ever runs — and `PrepareContext` carries no diagnostic sink, so a warning raised
 *   there was never an option.
 */
const FROM_REGEX = new RegExp(String.raw`\bfrom:(${NUM})`)
const TO_REGEX = new RegExp(String.raw`\bto:(${NUM})`)
const OPACITY_REGEX = /\bopacity:([0-9.]+)->([0-9.]+)/
const X_REGEX = /\bx:([+-]?[0-9.]+[a-z%]*)->([+-]?[0-9.]+[a-z%]*)/i
const Y_REGEX = /\by:([+-]?[0-9.]+[a-z%]*)->([+-]?[0-9.]+[a-z%]*)/i
const SCALE_REGEX = /\bscale:([0-9.]+)->([0-9.]+)/

/**
 * Read a step's progress window off its raw `data-kui`.
 *
 * Each end defaults independently — `from:` to 0, `to:` to 1 — so `scene-step to:0.4` means "from
 * the start until 40%" and `scene-step from:0.6` means "from 60% to the end", with neither needing
 * the other spelled out. The single-string form this replaced could not express that: a range
 * missing one end was not a range at all, so the whole value fell back to the full `0..1` and the
 * author was told nothing.
 *
 * Unreadable text can no longer reach here. `from:` and `to:` are declared `number` parameters
 * bounded to 0..1 (see {@link SCENE_STEP_PARAMETERS}), so `core/params.ts` rejects anything else
 * and substitutes the declared default *with a warning naming the parameter*, before `prepare`
 * runs. {@link NUM} matching the core's own pattern is what keeps that true for this second read
 * of the same attribute.
 *
 * @param kui - The step element's raw `data-kui` text.
 * @returns `[start, end]`, each either an authored 0..1 value or its declared default.
 */
export function parseWindow(kui: string): [number, number] {
  return [readEnd(FROM_REGEX, kui, 0), readEnd(TO_REGEX, kui, 1)]
}

/**
 * One end of a step's window, or its default.
 *
 * Out of range falls back to the default rather than clamping into range, because *falling back to
 * the declared default is what `core/params.ts` already did to the same text* — `minimum`/`maximum`
 * on a `number` parameter reject, they do not clamp (`checkNumericConstraints`). Clamping here
 * would make the two readings of one attribute disagree: the core would hand `prepare` a `from` of
 * `0` for `from:5` while this scan gave the controller `1`, which is the silent divergence the
 * shared {@link NUM} spelling exists to prevent.
 *
 * @complexity O(n) time in the attribute's length; O(1) space.
 */
function readEnd(pattern: RegExp, kui: string, fallback: number): number {
  const match = pattern.exec(kui)
  if (!match) return fallback
  const value = parseFloat(match[1]!)
  return value >= 0 && value <= 1 ? value : fallback
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
  const range = parseWindow(kui)

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

  /** `try`/`finally` for the reason `camera-3d.ts`'s `destroy()` documents. */
  destroy(): void {
    try {
      this.stop()
    } finally {
      this.ledgers.restore()
      this.steps = []
    }
  }
}

export function prepareScene(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
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

  /*
   * Reduced motion: the last keyframe, held. What `finish()` below writes, and written here for
   * the reason `shaders.ts`'s `prepareReducedMotion` documents — under this policy `openGate`
   * (`core/animator.ts`) marks the element finished and activates nothing, so `prepare` is the
   * only code that runs.
   *
   * The end state rather than some middle of the timeline because that is already the library's
   * answer everywhere else: *"A CSS effect is left at its final state by the policy layer"*, and
   * the `kui:finish` the animator then emits with reason `reduced-motion` claims exactly that —
   * *"the element really is at its end state"*. A scene that produced nothing made that claim
   * false for every author chaining a step off it.
   *
   * It is also the difference between a readable page and a blank one. A scene's steps get no
   * start state from this module — `updateElement` is the only thing that ever writes them — so
   * the common authoring shape, `.step { opacity: 0 }` in a stylesheet plus
   * `scene-step to:0.4 opacity:0->1`, left the content *permanently invisible* to a visitor who
   * asked for reduced motion. Holding progress 1 hands it to them.
   *
   * The converse — a step authored to fade *out* is held faded out — is the same trade every CSS
   * effect in the library already makes under this policy, and choosing differently here would
   * mean this one primitive disagreeing with all of them about what "finished" means.
   */
  if (isReducedMotion(ctx)) {
    controller.progress = 1
    controller.updateAll()
    // The steps are elements this module found for itself, in no ledger the animator will ever
    // restore; `destroy()` is what gives them back.
    return createInertInstance(() => controller.destroy())
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

/**
 * `scene-step`'s own parameters.
 *
 * Every one of these is read straight off the raw `data-kui` attribute by {@link parseChildStep},
 * which the *parent* `scene` runs over its descendants — not by this primitive's `prepare`, which
 * does nothing. Declaring them is what lets the compiler accept `from:0 to:0.4 opacity:0->1` on a
 * step instead of warning "unknown parameter" once "unknown effect" is fixed, exactly as
 * `camera-layer`'s `z` does in `camera-3d.ts`.
 *
 * `from`/`to` are real `number`s and are therefore genuinely validated — bounded to 0..1, rejected
 * with a diagnostic naming the parameter, and defaulted per end. The four transition parameters
 * cannot be: `0->1` and `40px->0px` are a pair grammar this module owns and no `ScalarParamType`
 * describes, so they are `text`, which `core/params.ts` accepts unconditionally. `parseTransitionValue`
 * returning `null` for unreadable text is all the safety they have, and a typo in one is still
 * silent. Splitting them the way the window was split would be the fix, and is deliberately not
 * done here — it is a second grammar change, and this one is already breaking.
 */
export const SCENE_STEP_PARAMETERS = {
  from: { type: 'number' as const, default: '0', minimum: 0, maximum: 1, cssProperty: '--kui-scene-step-from' },
  to: { type: 'number' as const, default: '1', minimum: 0, maximum: 1, cssProperty: '--kui-scene-step-to' },
  opacity: { type: 'text' as const, default: '', cssProperty: '--kui-scene-step-opacity' },
  x: { type: 'text' as const, default: '', cssProperty: '--kui-scene-step-x' },
  y: { type: 'text' as const, default: '', cssProperty: '--kui-scene-step-y' },
  scale: { type: 'text' as const, default: '', cssProperty: '--kui-scene-step-scale' },
}

/**
 * `scene-step` never runs on its own: `prepareScene`'s `[data-kui*="scene-step"]` scan reads each
 * step's window and transitions directly off its attribute, and the parent `SceneController` is
 * what writes `opacity`/`transform` to it every frame (`updateElement`). Without a registered
 * primitive for the name, every `scene-step` element compiled as an unrecognised effect — the
 * scene still animated it correctly, but the console warned "unknown effect scene-step" once per
 * step. This primitive exists only so the name resolves; it deliberately does nothing of its own.
 *
 * The same shape as `prepareCameraLayer` in `camera-3d.ts`, and fixed second because the key its
 * window used to be spelled with, `at:`, is owned by `core/parse.ts` — see {@link FROM_REGEX}.
 */
export function prepareSceneStep(): EffectInstance {
  return createInertInstance()
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
    // Still `disable`: it is what stops `openGate` activating the instance, which is precisely
    // what makes the held last keyframe in `prepareScene` the only thing that runs.
    reducedMotion: 'disable',
    prepare: prepareScene,
  },
  {
    id: 'scene-step',
    renderer: 'javascript',
    // The same pair the parent declares, and for the same reason: `updateElement` writes `opacity`
    // and the `transform` *shorthand*, and per `core/types.ts`'s `CHANNEL` note anything writing
    // the shorthand is on the `skew` channel whatever the transform is for. Not `translate`/`scale`
    // — those are the independent transform properties, which this module never writes.
    channels: ['opacity', 'skew'],
    parameters: SCENE_STEP_PARAMETERS,
    supportedTimelines: ['scroll', 'time'],
    supportedActivations: ['load', 'enter'],
    defaultActivation: 'load',
    perfClass: 'dom-transform',
    reducedMotion: 'disable',
    prepare: prepareSceneStep,
  },
]

export const SCENE_PRESETS: Preset[] = [
  { name: 'scene', primitive: 'scene' },
  { name: 'scene-step', primitive: 'scene-step' },
]

export function registerScenes(target: unknown): Registry | Animator {
  return registerInto(target, SCENE_PRIMITIVES, SCENE_PRESETS, 'Scenes')
}
