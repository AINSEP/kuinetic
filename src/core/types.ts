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

export interface ParamSpec {
  type: ParamType
  /** Used as the `var()` fallback in CSS. Never written to element.style — see design.md §7. */
  default: string
  /** Custom property this parameter feeds, e.g. `--dsg-reveal-distance`. */
  cssProperty: string
  /** For `keyword` params. */
  values?: readonly string[]
}

export type ParameterSchema = Record<string, ParamSpec>

export interface PrepareContext {
  doc: Document
  warn(message: string): void
}

export type Cleanup = () => void

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
  perfClass: PerfClass
  reducedMotion: ReducedMotionPolicy
  /** JS-side setup (DOM surgery, listeners, rAF). Returns its own teardown. */
  prepare?(el: Element, params: ResolvedParams, ctx: PrepareContext): Cleanup
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
  source: string
  specs: EffectSpec[]
  activation: Activation
  timeline: Timeline
  cleanups: Cleanup[]
  status: 'pending' | 'ready' | 'running' | 'finished' | 'failed'
}
