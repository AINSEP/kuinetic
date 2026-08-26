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
 * `data-kui` list when their channel sets are disjoint — see `core/channels.ts`.
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
  /**
   * Skew is the one transform CSS never gave an independent property to — there is no `skew:`
   * beside `translate:`/`rotate:`/`scale:`, so it can only be written through the `transform`
   * shorthand. That makes it its own channel: anything writing `transform` clobbers the whole
   * shorthand, so every primitive that does is on this channel, whatever the transform is for.
   * `scroll-skew` is one member; `flip-face` (`effects/three-d`) and `flip-3d`
   * (`effects/catalog/core`, the `flip-in-*`/`flip-out-*` family) are the other two — both need
   * the `perspective()` transform *function* for an element to have depth on itself, which
   * likewise only exists inside `transform`.
   */
  skew: 'skew',
} as const

/**
 * A CSS property group an effect writes to. Two effects may only be composed in one `data-kui`
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

/**
 * The activations the library gives a name of its own, because the DOM has no event for them or
 * because the name bundles more than one event. See `core/activation.ts` for what each
 * one binds.
 */
export type NamedActivation =
  | 'load'
  | 'enter'
  | 'leave'
  | 'hover'
  | 'unhover'
  | 'focus'
  | 'blur'
  | 'click'
  | 'manual'

/**
 * What starts the animation. Distinct from — and never a substitute for — a Timeline.
 *
 * The open `string` arm is the whole point of `data-kui-on`: any DOM event type an author can pass
 * to `addEventListener` — `input`, `submit`, `pointerleave`, `cart:updated` — starts an animation,
 * and a `start/end` pair (`pointerenter/pointerleave`) plays it out again on the second one. The
 * union documents the names the library adds on top of that without closing the set, the same
 * shape and for the same reason as `Channel` above.
 *
 * A value may therefore be a `NamedActivation`, a raw event type, or a pair of either joined by
 * `/`. Anything reading it for meaning must go through `resolveActivationSpec` rather than
 * comparing strings — an equality test against `'load'` silently stops being true for
 * `'load/pointerleave'`.
 *
 * Plain `string`, not `NamedActivation | (string & {})`. The latter spelling — which `Channel`
 * above uses, and which preserves editor autocomplete for the documented names — is right where
 * the set is genuinely a set that third parties extend. This is not that: an authored activation
 * is an arbitrary event type by design, and pretending otherwise would put a hint in front of a
 * value that has no closed vocabulary at all. The place a closed vocabulary *does* still apply is
 * `Primitive.supportedActivations`, which is why that one is typed `NamedActivation[]` and keeps
 * its autocomplete.
 */
// Not redundant, despite resolving to `string`: this alias is the domain name the whole codebase
// and the published `.d.ts` read in — twenty-odd signatures, one public export — and the fact that
// an activation is *carried* as a string is the least interesting thing about it. Replacing it
// with `string` as the rule asks would delete the only place that says what those strings are.
// The alternative spelling `NamedActivation | (string & {})`, which keeps a literal hint, trades
// this one suppression for three `sonarjs/function-return-type` suppressions on every function
// that returns one, and puts an autocomplete list in front of a value with no closed vocabulary.
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type Activation = string

/**
 * What drives progress.
 *
 * `time` runs a clock. `view` / `scroll` map progress continuously to scroll position and so
 * *reverse when the user scrolls back*, which a time-based reveal does not. These are different
 * animation models, not fallbacks for each other. See docs/design.md §5.
 */
/**
 * `pin` is the odd one out and deliberately so. `view`/`scroll` map to a native CSS
 * `animation-timeline`; `pin` has no native equivalent because CSS has no way to say "drive this
 * from another element's published progress". A pinned element's `view()` timeline *stalls* — it
 * stops travelling through the viewport, so its progress freezes for the whole hold, which is
 * exactly the span an author wants to animate across. `pin` fills that hole: the animation is
 * held paused and seeked with a negative `animation-delay` proportional to `--kui-progress`,
 * which the scroll-mechanics primitives already publish every frame. Verified in Chrome:
 * progress 0/0.25/0.5/0.75/1 renders -180/-135/-90/-45/0deg on a half-turn keyframe, re-seeks
 * live on every variable change, and composes with `--kui-stagger`.
 */
export type Timeline = 'time' | 'view' | 'scroll' | 'pointer' | 'pin'

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
  /** Custom property this parameter feeds, e.g. `--kui-reveal-distance`. */
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
  /**
   * Resume forward playback from wherever the effect currently sits.
   *
   * Optional, and deliberately so: only a renderer with a real playhead can honour it. A
   * CSS-rendered effect has an `Animation` handle and simply sets `playbackRate` back to 1; a
   * JS-rendered one has no playhead at all (`getAnimations()` returns `[]` for it — see
   * `core/play.ts`), and there is no honest shim for "half-way through a `split-flap`, backwards".
   * Leaving it undefined is how a primitive says so, and `animator.ts` warns by name rather than
   * pretending — a knob that exists and does nothing is worse than a missing knob.
   */
  play?(): void
  /**
   * Play backwards from wherever the effect currently sits, ending at the from-state.
   *
   * The exit half of a paired activation (`data-kui-on="pointerenter/pointerleave"`) is built on
   * this. Optional for the same reason as `play` above.
   */
  reverse?(): void
  /** Resolves when the effect completes. Resolves — never rejects — on cancel. */
  readonly finished: Promise<void>
  /**
   * Whether this effect has no end — a pin, a scroll progress track, a media scrub.
   *
   * Such an effect keeps an already-resolved `finished` on purpose, so that composing it with a
   * one-shot on the same element does not stop the one-shot ever reporting complete. That is
   * right for composition and wrong for the element's own reported state: an element whose *only*
   * effects are continuous would otherwise read `data-kui-state="finished"` from the first
   * microtask onwards and never say anything else, which is a lie an author cannot style around.
   *
   * The animator therefore reads this to decide whether there is any completion to wait for at
   * all. Read after `activate()`, never before — a deferred setup only learns which kind it is
   * once it has actually run.
   */
  readonly continuous?: boolean
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
 * Author timing for one effect segment — the positional `2s 1s linear` of `data-kui`.
 *
 * Separate from `EffectParams` because it is not a parameter: it is not declared in any
 * `ParameterSchema`, it means the same thing for every effect, and the CSS renderer already reads
 * it straight off the `EffectSpec` in `compile.pushTrack`. A JS-rendered primitive gets the same
 * three values here rather than having to declare look-alike parameters of its own.
 *
 * Every field is optional and `undefined` means *the author named none* — a primitive must be able
 * to tell that apart from an explicit `0ms` so its own default still applies.
 */
export interface EffectTiming {
  /** Total time the whole effect should take, in milliseconds. */
  durationMs?: number
  /** Time before the effect starts, in milliseconds. */
  delayMs?: number
  /** Validated CSS easing keyword or function. */
  easing?: string
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
  /**
   * Author timing for this effect segment. Time-driven primitives should honour it; the many that
   * are driven by a pointer or the scroll position instead can ignore it entirely.
   */
  readonly timing: EffectTiming
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
  /**
   * Which activations this primitive is built to handle.
   *
   * `NamedActivation[]`, not `Activation[]`: the authored value is open (any DOM event starts an
   * animation), but a primitive declaring what it supports is choosing from a closed vocabulary —
   * it is saying "I work when observed" or "I work on a listener", not enumerating event types it
   * has never heard of. `animator.ts` maps an authored half onto this vocabulary before checking
   * it; see `SUPPORT_PROXIES` in `activation.ts`.
   */
  supportedActivations: NamedActivation[]
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
   * Whether this primitive, left alone to finish with nobody calling `reset()`/`destroy()`, ends
   * with the element's markup indistinguishable from what the author wrote.
   *
   * There are two separate teardown contracts, and `test/browser/teardown-sweep.test.mjs` used to
   * conflate them into one check:
   *
   * - **Interruption restores.** Calling `reset()` mid-effect puts the markup back byte-for-byte.
   *   This is unconditional and every primitive owes it — it is not gated by this field at all, and
   *   never will be, because a caller can `reset()` anything at any moment.
   * - **Natural finish restores** (this field). The effect, left alone to run to completion, ends
   *   with the markup back as authored. This is `slat-assemble`'s whole point: it disassembles a
   *   picture into slats and reassembles it, and the slats are scaffolding that must be gone once
   *   the illusion lands — not just when someone happens to call `reset()`.
   *
   * **Defaults to `false` — a primitive has to opt in.** The tempting default is `true` ("assume it
   * restores unless told otherwise"), on the theory that a forgotten declaration should never
   * silently skip a check. That is the wrong default in this codebase specifically: the majority of
   * the catalog is JS/CSS-driven effects that either never resolve `finished` at all (ambient
   * loops, hover/pointer effects, anything `reducedMotion: 'disable'` marks as unboundable) or
   * finish *by design* in a state that differs from authored markup — `data-kui-state="finished"`
   * and the `--kui-*` custom properties `createCssInstance` leaves in place are the point, not a
   * bug, and every `css-keyframes` primitive in the catalog would need an explicit opt-out under a
   * `true` default. Defaulting to `true` would have meant "almost every primitive needs a
   * non-default declaration," which is the sign from the design notes above that a default is
   * wrong. `false` means "no claim is being made" for the ordinary case, and only the small set of
   * primitives that build their own temporary DOM as scaffolding — `slat-assemble` today — assert
   * this explicitly. The unconditional interruption check above is what actually closes the "a new
   * scaffold-building primitive forgets to opt in" gap: `reset()` is still guaranteed to restore it
   * even if nobody ever wrote `restoresOnFinish: true` for it.
   *
   * `test/browser/teardown-sweep.test.mjs` reads this to decide whether a primitive owes a
   * natural-finish check at all, and its failure messages name which law was broken instead of the
   * generic "leaves synthetic nodes behind" that previously misdescribed a `style=""` leak as extra
   * DOM nodes for a whole debugging session.
   */
  restoresOnFinish?: boolean
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
  /**
   * This effect begins from a state the visitor must not see — invisible, displaced, unsplit, or
   * un-assembled — so painting the element at its rest state before the runtime installs that
   * from-state is a visible flash. `scripts/generate-preset-css.mjs` emits a pre-JS cloak rule for
   * every preset that declares it; see the `kui.cloak` layer in `src/css/base.css`.
   *
   * **This has to be declared, not derived.** Both plausible signals were measured and both are
   * wrong. Keying on "owns the opacity channel" cloaks `hamburger-to-x`, `checkbox-draw` and
   * `dropdown-open` — stateful controls with no entrance — while missing `blur-in` and `bounce-in`.
   * Keying on "supports the entrance timelines" cloaks `pin-section`, `scroll-spy` and
   * `horizontal-scroll`, and hiding a pinned section at opacity 0 is precisely the failure the
   * opt-in rule in `base.css` was written to avoid. Whether a name is an entrance with a
   * from-state worth hiding is a fact only its author knows, which is why it sits here beside
   * `params` rather than being inferred from either.
   *
   * Exits are deliberately excluded: `fade-out` starts at the rest state, so there is nothing to
   * hide and cloaking it would blank an element that should be visible until it leaves.
   */
  cloak?: boolean
}

export type ResolvedParams = Record<string, string>

/** One effect segment parsed out of a `data-kui` value. */
export interface EffectSpec {
  name: string
  duration?: string
  delay?: string
  easing?: string
  params: Record<string, string>
}

/** The full parse of one element's `data-kui` attribute. */
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
  /** Whole-configuration identity, not just `data-kui` — see `fingerprintOf`. */
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
  /**
   * Releases a one-shot `enter` binding, set only for that activation and cleared once spent.
   * Present so `Animator.activate` can disarm an observer a programmatic activation just made
   * redundant; a toggle activation (`hover`/`focus`/`click`) deliberately leaves this undefined.
   */
  releaseActivation?: Cleanup
  /**
   * Which way the effects are currently playing. Only meaningful while `status === 'running'`.
   *
   * Runtime truth, not an attribute, for the reason at the top of this interface: a reversing
   * element is still `running`, and `data-kui-state` has no vocabulary for the difference. It is
   * here because two decisions need it and neither can be re-derived from the DOM — `activate`
   * must turn a reversing element back around instead of being swallowed by its own re-entrancy
   * guard, and the `finished` handler that writes the final state must not let a stale promise
   * from the run it superseded write over the run in flight.
   */
  direction?: 'forward' | 'reverse'
  status: 'pending' | 'ready' | 'running' | 'finished' | 'failed'
}
