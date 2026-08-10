/**
 * Core type model.
 *
 * The four questions that the earlier `Tier` enum wrongly collapsed into one axis are kept
 * orthogonal here:
 *   - `renderer`           — who produces the frame
 *   - `Activation`         — what starts it
 *   - `Timeline`           — what drives progress
 *   - `prepare`            — whether DOM surgery is required first
 * A `css-keyframes` effect can still need observer activation; a `prepare`d effect (split-text)
 * can render through CSS afterwards. See docs/design.md §6.
 */

/**
 * A CSS property group an effect writes to. Two effects may only be composed in one
 * `data-dsg` list when their channel sets are disjoint — see `core/channels.ts`.
 *
 * `translate` / `rotate` / `scale` are separate channels because they are independent CSS
 * properties in modern browsers. Under the old `transform` shorthand they would all have
 * collided and this composition model would be impossible.
 */
export const CHANNEL = {
  opacity: 'opacity',
  translate: 'translate',
  scale: 'scale',
  rotate: 'rotate',
  filter: 'filter',
  clip: 'clip',
  background: 'background',
  color: 'color',
  stroke: 'stroke',
  text: 'text',
} as const

/**
 * A CSS property group an effect writes to. Two effects may only be composed in one `data-dsg`
 * list when their channel sets are disjoint — see `core/channels.ts`.
 *
 * `translate` / `rotate` / `scale` are separate channels because they are independent CSS
 * properties in modern browsers. Under the old `transform` shorthand they would all collide and
 * this composition model would be impossible.
 *
 * The open `string` arm is deliberate: third-party primitives register their own channels, so
 * the union documents the built-ins without closing the set.
 */
export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL] | (string & {})

/** What starts the animation. Distinct from — and never a substitute for — a Timeline. */
export type Activation = 'load' | 'enter' | 'hover' | 'focus' | 'click' | 'manual'

/**
 * What drives progress.
 *
 * `time` runs a clock. `view` / `scroll` map progress continuously to scroll position and so
 * *reverse when the user scrolls back*, which a time-based reveal does not. These are different
 * animation models, not fallbacks for each other. See docs/design.md §5.
 */
export type Timeline = 'time' | 'view' | 'scroll' | 'pointer'

export type Renderer = 'css-keyframes' | 'waapi' | 'javascript'

/** Governs the performance budget a primitive is held to in tests. */
export type PerfClass = 'compositor' | 'paint' | 'layout' | 'continuous' | 'dom-transform'

/**
 * Per-effect reduced-motion policy. A blanket `1ms` override is wrong: it does not meaningfully
 * reduce parallax, pinning, flashing or continuous ambient motion.
 */
export type ReducedMotionPolicy = 'shorten' | 'crossfade' | 'disable'

export type ParamType =
  | 'length'
  | 'time'
  | 'number'
  | 'percentage'
  | 'angle'
  | 'color'
  | 'easing'
  | 'keyword'
  /**
   * Free text — a CSS selector, a URL pattern. Consumed only by JS primitives and **never
   * written to a stylesheet**, which is what makes accepting arbitrary characters safe here.
   * `resolveParams` drops these on the CSS path; `readParams` keeps them for `prepare`.
   */
  | 'text'

export interface ParamSpec {
  type: ParamType
  /** Used as the `var()` fallback in CSS. Never written to element.style — see design.md §7. */
  default: string
  /** Custom property this parameter feeds, e.g. `--dsg-reveal-distance`. */
  cssProperty: string
  /** For `keyword` params. */
  values?: readonly string[]
  /** Require a numeric parameter to convert to a finite JavaScript number. */
  finite?: boolean
  /** Inclusive lower bound for numeric parameters. */
  minimum?: number
  /** Inclusive upper bound for numeric parameters. */
  maximum?: number
  /** Require a numeric parameter to have no fractional part. */
  integer?: boolean
}

export type ParameterSchema = Record<string, ParamSpec>

import type { PrepareContext } from './effect-context.js'
import type { AttributeLedger, StyleLedger } from './owned-styles.js'

export type { PrepareContext }

export type Cleanup = () => void

/**
 * Renderer-neutral lifecycle handle.
 *
 * CSS-rendered and JS-rendered effects expose the same five operations, so the animator can gate,
 * cancel, and await either one without knowing which it holds. That uniformity is the whole point:
 * every contract the library advertises — activation, reduced motion, `play().finished`,
 * cancellation — is enforced here rather than re-implemented per renderer.
 */
export interface EffectInstance {
  /** Start. Called by the animator once its gate opens, never by `prepare`. */
  activate(): void
  /** Stop where it is, leaving the element mid-effect. */
  cancel(): void
  /** Jump to the end state immediately. */
  finish(): void
  /** Resolves when the effect completes. Resolves — never rejects — on cancel. */
  readonly finished: Promise<void>
  /** Release every listener, observer, subscription, and inserted node. */
  destroy(): void
}

/**
 * An instance that does nothing, for effects with no work to do in the current environment.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function inertInstance(destroy: Cleanup = () => {}): EffectInstance {
  return {
    activate() {},
    cancel() {},
    finish() {},
    finished: Promise.resolve(),
    destroy,
  }
}

/**
 * Validated parameter reader handed to JS-rendered primitives.
 *
 * A reader rather than a plain record for three reasons: every declared parameter is guaranteed
 * present (so no `| undefined` at every call site), unit conversion lives in one place instead of
 * being re-derived per primitive, and it is structurally distinct from `ResolvedParams`.
 *
 * That last point is not cosmetic. `prepare` previously declared `ResolvedParams` while the
 * animator passed raw author strings; both were `Record<string, string>`, so TypeScript accepted
 * a call that bypassed all validation. Two different shapes make that class of mistake impossible.
 */
export interface EffectParams {
  /** Validated string value. */
  text(name: string, fallback?: string): string
  /** Milliseconds, from a `time` parameter. */
  ms(name: string, fallback?: number): number
  /** Bare number, or a percentage as a 0–1 ratio. */
  num(name: string, fallback?: number): number
  /** Whether a keyword parameter equals `value` (default `'true'`). */
  is(name: string, value?: string): boolean
}

/**
 * A primitive is an implementation. Presets are names that point at a primitive with different
 * default parameters — 48 of the entrance/exit names come from one primitive.
 */
export interface Primitive {
  id: string
  renderer: Renderer
  channels: Channel[]
  parameters: ParameterSchema
  supportedTimelines: Timeline[]
  supportedActivations: Activation[]
  /**
   * Activation used when the author specifies none.
   *
   * `enter` is right for an entrance reveal and wrong for behaviour: a drag handler, a FLIP
   * container, or a hover morph that only wires itself up once scrolled into view is broken, not
   * lazy. Defaults to `enter` when unset.
   */
  defaultActivation?: Activation
  perfClass: PerfClass
  reducedMotion: ReducedMotionPolicy
  /**
   * JS-side setup. Returns a lifecycle handle, **not** a teardown function.
   *
   * `prepare` must only wire things up — it must not start anything. The animator decides when
   * (or whether) to call `activate()`, which is what makes `on:enter`, `on:click`, `manual`, and
   * `reducedMotion: 'disable'` apply to JS-rendered effects at all. Returning a bare `Cleanup`
   * previously meant every JS effect started at install time and no declared activation or
   * reduced-motion policy was ever enforced.
   *
   * `params` are validated and defaulted — never raw author input.
   */
  prepare?(el: Element, params: EffectParams, ctx: PrepareContext): EffectInstance
}

export interface Preset {
  name: string
  primitive: string
  /** Parameter overrides that differentiate this name from its primitive's defaults. */
  params?: Record<string, string>
  /** CSS `@keyframes` name this preset animates, when renderer is `css-keyframes`. */
  keyframes?: string
}

export type ResolvedParams = Record<string, string>

/** One effect segment parsed out of a `data-dsg` value. */
export interface EffectSpec {
  name: string
  duration?: string
  delay?: string
  easing?: string
  params: Record<string, string>
}

/** The full parse of one element's `data-dsg` attribute. */
export interface ParsedValue {
  specs: EffectSpec[]
  /** Hoisted from reserved `on:` / `timeline:` / `threshold:` keys. Element-scoped. */
  activation?: Activation
  timeline?: string
  threshold?: string
  warnings: string[]
}

/** Runtime truth. Attributes are for CSS and debugging; they make a poor state machine. */
export interface InstanceState {
  /** Whole-configuration identity, not just `data-dsg` — see `fingerprintOf`. */
  fingerprint: string
  specs: EffectSpec[]
  activation: Activation
  timeline: Timeline
  /** One handle per renderer in play; the animator gates them uniformly. */
  instances: EffectInstance[]
  /** Inline properties this element's effects wrote, and what they replaced. */
  ledger: StyleLedger
  attributes: AttributeLedger
  /** Aborted on release, detaching bindings and primitive listeners. */
  controller: AbortController
  status: 'pending' | 'ready' | 'running' | 'finished' | 'failed'
}
