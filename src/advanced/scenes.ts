// Created by Gemini 3.8 Flash
/**
 * kUInetic Cinematic Scene & Timeline Choreography Module
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
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
  ownedDescendants,
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
  /**
   * Which clock drives `progress`. The two keywords, and nothing else.
   *
   * This carried a `| string` arm, which defeated the union entirely. `SCENE_PARAMETERS.progress`
   * is a `keyword` spec with a closed list, so `core/params.ts` already rejects `progress:tiem`
   * before `prepare` runs — but the *type* said any string was a mode, so a typo written in
   * library code type-checked and then silently behaved as `scroll`, because every read of this
   * field is `=== 'time'`. The same spirit as `ValueParamSpec` declaring `keywords?: never`: where
   * the schema closes a set, the type has to close it too, or one of the two is lying.
   *
   * {@link prepareScene} is what makes the narrowing honest rather than asserted — it maps the
   * authored text onto these two rather than casting it.
   */
  progress?: 'scroll' | 'time'
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
 *   `prepare` ever runs, in a diagnostic that names the parameter.
 *
 * That last point is about *timing*, not about there being nowhere to complain — `PrepareContext`
 * does carry a diagnostic sink (`warn`, wired to the reporter in `core/js-effect-preparer.ts`),
 * and {@link prepareScene} uses it for the one fault only `prepare` can see. The division of
 * labour is: `core/params.ts` catches text that is not a number, because by the time `prepare`
 * runs the value has already been replaced by the declared default and the author's typo is gone;
 * `prepare` catches a window that is two perfectly valid numbers in the wrong order, which no
 * per-parameter schema can express.
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

/**
 * The viewport height {@link SceneController.calculateProgress} assumes when the environment
 * cannot supply one.
 *
 * Narrow, but reachable. The live scroll path never gets here without a window — `start()`'s first
 * guard returns outright — and a real `Window` always answers `innerHeight` with a number. What is
 * left is a caller stepping the controller by hand, and an `AdvancedEnv` whose `WindowLike` omits
 * the field; both land on this number.
 *
 * It is a guess and is deliberately still a guess. The tempting alternative, `0`, is the honest
 * "no viewport" and the worse answer: it collapses `totalDist` to `rect.height` and `currentDist`
 * to `-rect.top`, so every element below the fold gets a progress that runs *backwards* —
 * plausible values, wrong in a direction nobody would think to question. A fixed 800 is wrong by a
 * scale factor instead, which at least moves the right way. Note `??` does not catch a window that
 * genuinely answers `innerHeight: 0`; that case falls to the `totalDist > 0` guard and reads 0.
 *
 * `camera-3d.ts`'s `updateScroll` carries the same constant for the same reason — they are two
 * readings of one viewport, so if either ever stops guessing, both must.
 */
const FALLBACK_VIEWPORT_HEIGHT = 800

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
   * Sharing is also what keeps two *legitimate* owners of one element honest. A nested `scene` is
   * no longer one of them — `prepareScene` scopes its scan with {@link ownedDescendants}, so an
   * outer scene stops at an inner one instead of claiming its steps — but an element authored as
   * both a `scene-step` and a `camera-layer` still has two, because those are different kinds of
   * host, and so does any controller constructed directly rather than through `prepare`.
   */
  private ledgers: AdvancedLedgers

  constructor(
    container: HTMLElement,
    options: SceneOptions = {},
    env: AdvancedEnv = {},
  ) {
    this.container = container
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.ledgers = createAdvancedLedgers(container)
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
      /*
       * Cancelled is not finished, and this is where the two used to be one branch.
       *
       * `stop()` clears `isListening` and cancels the pending frame, but the frame can still
       * arrive: a `caf` that does not really cancel (an `AdvancedEnv` double, or a host that has
       * already dispatched the callback) delivers it anyway. That run reaching the completion
       * branch below called `onComplete`, which `prepareScene` wires to `inst.finish()` — so the
       * animator was told an effect had *finished* when the caller had just stopped it, and
       * `EffectInstance.finished` resolved as a success. Two different facts, so two exits.
       *
       * Returning before the write, not after it, for the same reason: a stopped scene should not
       * paint one more frame on its way out.
       */
      if (!this.isListening) {
        this.rafId = null
        return
      }
      const elapsed = now() - this.timeStart
      this.progress = clamp(elapsed / duration, 0, 1)
      this.updateAll()
      if (this.progress < 1) {
        this.rafId = this.raf(tick)
        return
      }
      this.rafId = null
      this.isListening = false
      if (onComplete) onComplete()
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
    const winHeight = this.window?.innerHeight ?? FALLBACK_VIEWPORT_HEIGHT
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
    // An empty or inverted window has no interpolation to do: `end - start` is zero (NaN) or
    // negative (a step that runs backwards through its own transitions). Returning is right, and
    // returning *silently* is right here — this is a per-frame hot path and a programmatic entry
    // point, not an authoring surface. `prepareScene` is where an authored `from:`/`to:` is read,
    // so that is where the author is told, once, that they wrote a window that never opens.
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
  /*
   * Narrowed here rather than cast, which is what lets {@link SceneOptions.progress} be the closed
   * pair it declares. `params.text` is typed `string` and this is the boundary the authored value
   * crosses, so the mapping belongs at the boundary. Anything that is not `time` becoming `scroll`
   * is not a new decision, it is the one the controller already made — every read of the field is
   * `=== 'time'` — written down instead of implied. In practice nothing else can arrive: the
   * `keyword` schema's list is closed, so `core/params.ts` has already rejected a typo and
   * substituted `scroll` before this runs.
   */
  const authoredProgress = params.text ? params.text('progress', 'scroll') : 'scroll'
  const progressMode = authoredProgress === 'time' ? 'time' : 'scroll'
  const duration = clamp(params.num ? params.num('duration', 1000) : 1000, 100, 60000)

  const htmlEl = el as HTMLElement
  // One capture per element, shared with every other writer on it — core's `LedgerSet`
  // included — because the registry lives on the element itself. Nothing is handed over.
  const controller = new SceneController(
    htmlEl,
    { progress: progressMode, duration },
    resolvedEnv,
  )
  /*
   * The steps are scanned once, here, and never again — there is no `MutationObserver` on the
   * container.
   *
   * A step element added to the subtree after this runs is never found, never added to the
   * controller, and never animates; nothing is watching for it, so nothing says so. And "after
   * this runs" is most of the page's life rather than a sliver at load: `prepare` can happen a
   * long way before the scene is ever on screen, for the reason the note on
   * {@link SceneController.ledgers} gives. On a statically authored scene — the shape this module
   * is written for — that costs nothing. On a list rendered by a framework after hydration it
   * presents as a completely dead effect, which is worth naming here rather than leaving someone
   * to find in a console that says nothing.
   *
   * Deliberately not fixed with an observer. Watching the subtree is a feature, not a tidy-up: an
   * observer per scene and a teardown for it, a rescan that re-derives each new step's window, and
   * a decision about what a step *removed* mid-flight does to the ledger entry that is currently
   * holding its author's value. The supported answer today is to re-run `Animator.scan(container)`
   * after the markup changes, which rebuilds the scene from the DOM as it now is.
   */
  const childSteps = ownedDescendants<HTMLElement>(htmlEl, 'scene', 'scene-step')
  for (const child of childSteps) {
    const config = parseChildStep(child)
    const [start, end] = config.range
    /*
     * The one fault only `prepare` can see, reported at the one place that can see it.
     *
     * `from:` and `to:` are each validated alone — both bounded to 0..1, both defaulted — and both
     * can pass while the pair they form is nonsense. `from:0.8 to:0.2` is two perfectly legal
     * numbers describing a window that never opens, and `updateElement` answers it by returning,
     * so the step simply never moves. Before this warning that was indistinguishable from a step
     * the author had not written a transition for.
     *
     * Reported against the *resolved* window rather than the raw attribute text, so the numbers
     * named are the ones the controller will actually use — `readEnd` substitutes the declared
     * default for an out-of-range end, and a message quoting the author's rejected value instead
     * would send them looking at the wrong number.
     */
    if (start >= end) {
      ctx?.warn(
        `scene-step from:${start} to:${end} is an empty window — from: must be less than to:, so this step never animates`,
      )
    }
    controller.addStep(child, config)
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

/**
 * `scene`'s own parameters.
 *
 * There used to be a third, `name`, and it did nothing at all. It was declared `text`, read into
 * `SceneOptions.name` by `prepareScene`, carried on every controller — and never read again by
 * anything: no branch, no diagnostic, no selector. Nor could its `cssProperty` save it, because
 * `resolveParams` drops every `text` parameter before the stylesheet by design (`core/params.ts`
 * — a `text` value reaching CSS is the injection surface that rule exists to close), so
 * `--kui-scene-name` was never written either. A parameter that is declared, validated, plumbed
 * and inert is a documented lie: it tells an author the scene can be named and then ignores the
 * name. Deleted rather than wired up, because nothing in the module ever wanted it.
 */
export const SCENE_PARAMETERS = {
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
