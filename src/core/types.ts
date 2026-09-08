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

/**
 * Parameter types that name exactly one grammar.
 *
 * Kept separate from {@link UnionParamType} so the union members can be spelled as
 * `'<a>|<b>'` and expanded back into this list by one table in `core/params.ts`, rather than
 * every validation site learning which spellings are compound.
 */
export type ScalarParamType =
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
  /**
   * SVG path data, for `offset-path: path(...)`.
   *
   * Deliberately *not* `text`. `text` is the "arbitrary characters, never reaches CSS" escape
   * hatch, and the whole point of a motion path is that the geometry reaches a stylesheet: the
   * travel is a real CSS animation, not something JavaScript drives frame by frame. So this needs
   * a type of its own, validated by an allowlist narrow enough to be safe in a declaration —
   * command letters, digits, and separators, nothing else. See `validate` in `core/params.ts`,
   * which also explains why an accepted value comes back wrapped in quotes.
   */
  | 'path'

/**
 * Parameter types that accept two grammars from one parameter.
 *
 * CSS properties routinely take "a keyword or a value", or "a number or a percentage", and a
 * parameter that models one has to accept both spellings without inventing a second parameter for
 * the second spelling. `offset-rotate` is `[ auto | reverse ] || <angle>`; `opacity` is
 * `<alpha-value>`, which is a number *or* a percentage and means the same thing either way.
 *
 * **This list is deliberately closed and deliberately short.** The alternative — a per-property
 * table of CSS grammars, so any parameter can declare any combination — is a second CSS parser to
 * own and keep correct, and every entry in it is a new way for an authored value to be accepted
 * into a declaration nobody checked. Three unions cover the properties the catalog actually has.
 * Adding a fourth should be a considered decision with a parameter that needs it, not a default.
 *
 * The member order is the order the grammars are tried, which matters only for
 * {@link ScalarParamType} overlaps; today there are none.
 */
export type UnionParamType =
  /**
   * `0.8` or `80%`, normalised to `0.8` before it reaches anything. Both spellings are legal CSS
   * for an `<alpha-value>` and mean the same thing, so accepting only one of them is a papercut
   * with no upside; normalising to the number means `minimum`/`maximum` still bound the parameter
   * whichever way it was written, and a custom property holding it composes inside `calc()`.
   */
  | 'number|percentage'
  /**
   * `24px` or `50%`. No normalisation is possible — a percentage resolves against a box this code
   * has not measured and must not guess at — so both spellings reach the stylesheet as written.
   *
   * Note that `length`'s own grammar has accepted `%` since it was written, and narrowing it now
   * would break authored pages, so this union is not currently wider than `length`. It exists
   * because it *says so*: a parameter declared `'length|percentage'` is one where a percentage is
   * a supported reading rather than an accident of the unit list, and a reader of the declaration
   * can tell which without going to look at the regex.
   */
  | 'length|percentage'
  /**
   * `45deg` or one of a closed set of words — the `offset-rotate` shape. The angle half also takes
   * the bare and `d`-suffixed spellings every `angle` parameter takes; the keyword half is
   * {@link KeywordParamSpec.keywords}, which is closed exactly as it is for `'keyword'` itself.
   */
  | 'angle|keyword'

export type ParamType = ScalarParamType | UnionParamType

/** Everything a parameter declares regardless of which grammar it accepts. */
interface ParamSpecBase {
  /** Used as the `var()` fallback in CSS. Never written to element.style — see design.md §7. */
  default: string
  /**
   * Custom property this parameter feeds, e.g. `--kui-reveal-distance`.
   *
   * **This is not, on its own, an escape hatch.** It is easy to read the field as a promise that
   * any parameter can be overridden from a page's own stylesheet by setting the custom property
   * directly — that a closed `keywords` list is therefore only a convenience, with the raw
   * property underneath it for anyone who needs a value the list does not have. That is true for
   * exactly one of the three ways a parameter is consumed:
   *
   * - **Read by CSS.** A stylesheet somewhere does `var(--kui-reveal-distance, 24px)`. The
   *   cascade decides, so a page rule genuinely wins and the parameter is overridable. Most of
   *   the catalog is here.
   * - **Read by JavaScript.** The property is written and then nothing reads it back: `prepare()`
   *   takes the *validated attribute string* through `readParams`, never `getComputedStyle`.
   *   `scramble-text`'s `charset` is the clearest case — `--kui-charset` is compiled and no
   *   `var()` anywhere consumes it, so setting it in a stylesheet changes nothing at all and says
   *   nothing about having changed nothing. There is **no** escape hatch for these, and widening
   *   one means widening its `keywords` list in this repository.
   * - **`type: 'text'`.** `resolveParams` drops these before the stylesheet, so the property is
   *   never written in the first place and this field is inert.
   *
   * Which class a parameter is in is not derivable from the declaration; it depends on whether
   * any shipped CSS reads the property. Do not tell an author to "just set the custom property"
   * without checking that something does.
   */
  cssProperty: string
  /** Require a numeric parameter to convert to a finite JavaScript number. */
  finite?: boolean
  /** Inclusive lower bound for numeric parameters. */
  minimum?: number
  /** Inclusive upper bound for numeric parameters. */
  maximum?: number
  /** Require a numeric parameter to have no fractional part. */
  integer?: boolean
}

/**
 * A parameter with a keyword half: either nothing but words (`'keyword'`), or words beside a
 * value grammar (`'angle|keyword'`).
 *
 * `keywords` is **required**, not optional. A keyword parameter with no list accepts nothing at
 * all and can only ever fall back to its default, which is a declaration bug that used to compile
 * and then report `expected one of (none declared)` at runtime. Requiring the field moves that to
 * the type checker.
 */
export interface KeywordParamSpec extends ParamSpecBase {
  type: 'keyword' | 'angle|keyword'
  /**
   * The complete set of words this parameter accepts. **Closed** — a value that is not in this
   * list is rejected, and for `'angle|keyword'` is then tried against the angle grammar and
   * nothing else.
   *
   * This field replaced `values`, which meant a closed set on `'keyword'` and *additive* extra
   * literals on every other type. One key with two meanings validated nothing on the second
   * reading while looking exactly like validation on the first: `{ type: 'number', values:
   * ['80%'] }` accepted every number in existence and said nothing. The additive meaning has not
   * been renamed, it has been removed — a parameter that wants "a value or a word" declares a
   * union type, which is checkable, instead of smuggling the words past the type.
   */
  keywords: readonly string[]
}

/**
 * A parameter whose grammar is entirely a value shape — a length, a time, a colour, a path.
 *
 * `keywords?: never` is the half of the split that does the work: it makes attaching a word list
 * to a numeric parameter a compile error rather than a silent no-op.
 */
export interface ValueParamSpec extends ParamSpecBase {
  type: Exclude<ParamType, 'keyword' | 'angle|keyword'>
  keywords?: never
}

/**
 * One parameter's declaration.
 *
 * A discriminated union on `type` rather than one interface with optional fields, so that the
 * relationship between the type and the word list is checked instead of documented.
 */
export type ParamSpec = KeywordParamSpec | ValueParamSpec

export type ParameterSchema = Record<string, ParamSpec>

import type { EffectGate } from './breakpoints.js'
import type { PrepareContext } from './effect-context.js'
import type { AttributeLedger, LedgerSet, StyleLedger } from './owned-styles.js'

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
  /**
   * Runtime control over this instance's playhead, when the renderer has one to offer.
   *
   * **Optional on purpose, and its absence is the contract.** A `css-keyframes` instance is backed
   * by real `Animation` objects with a `currentTime` and a `playbackRate`, so it can be paused,
   * seeked and re-sped honestly. A JavaScript-rendered instance has no such object — `element
   * .getAnimations()` returns `[]` for every one of them (see `play.ts`) — and it has no shared
   * notion of progress either: a drag handler, a scroll spy and a count-up are all "JS effects"
   * with nothing in common to seek.
   *
   * A shim that swallowed `pause()` and reported `progress: 0` would satisfy this interface and
   * lie to every caller, which is worse than the gap it papers over. So the field is simply absent,
   * and `control.ts` reports by name which effects on an element could not be reached.
   */
  readonly control?: InstanceControl
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
 * Playback state of an element's effects.
 *
 * Deliberately *not* `AnimationPlayState`: the native union has a `pending` member describing an
 * animation waiting on a style flush, which is an implementation detail of one renderer rather
 * than something an author can act on, and it has no member for "nothing has started yet", which
 * is the state every deferred effect sits in between install and activation.
 */
export type PlaybackState = 'idle' | 'running' | 'paused' | 'finished'

/**
 * One instance's playhead, as `control.ts` drives it.
 *
 * Progress is normalized 0..1 across the instance's whole span — from the instant the activation
 * fired to the moment its last composed animation ends, authored delays included. Milliseconds
 * would force the author to know each effect's duration to seek anywhere meaningful, and composed
 * effects on one element rarely share one.
 */
export interface InstanceControl {
  /** Hold the playhead where it is. */
  pause(): void
  /** Resume from wherever the playhead sits. */
  resume(): void
  /** Flip direction and keep running. */
  reverse(): void
  /** Move the playhead to `progress` (0..1), leaving the running/paused state alone. */
  seek(progress: number): void
  /** Multiply playback speed. `1` is authored speed; a negative value runs backwards. */
  rate(playbackRate: number): void
  /** Current position, 0..1. */
  readonly progress: number
  readonly playState: PlaybackState
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
 * it straight off the `EffectSpec` in `declarations.ts`'s `pushTrack`. A JS-rendered primitive gets the same
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
 * A primitive's refinement of itself for one authored spec.
 *
 * Almost every primitive in the catalog is fully described before it ever meets an attribute:
 * `fade-up 200ms` and `fade-up 900ms` claim the same channels and compile the same keyframe. The
 * generic tween (`effects/tween`) is the exception this exists for — `tween x:100` writes
 * `translate` and `tween opacity:0` writes `opacity`, so *which* channels it owns, and therefore
 * whether it may compose with a neighbour at all, is a fact about the attribute rather than about
 * the primitive.
 *
 * Neither static answer is honest. Declaring every channel a tween *could* write makes it collide
 * with everything and compose with nothing; declaring none makes the conflict detector wave
 * through two effects that both animate `opacity`, which is the one failure `core/channels.ts`
 * exists to prevent. So the primitive is asked, once per spec, instead.
 *
 * Every field is optional, and an absent field means "use the primitive's own declaration". A
 * primitive with no `variantFor` at all — which is all but two of them — is unaffected.
 */
export interface EffectVariant {
  /**
   * Channels this spec writes, unioned with the primitive's own declared list.
   *
   * Unioned rather than replacing, so a variant can only ever *widen* what a primitive admits to
   * touching. A refinement that could quietly drop a declared channel would be a way to opt out of
   * conflict detection, which is exactly backwards.
   */
  channels?: Channel[]
  /**
   * Keyframe blocks to compile, one animation track each, replacing the preset's single
   * `keyframes` name. Empty means this spec animates nothing and emits no `animation` declaration.
   */
  keyframes?: string[]
  /**
   * Authored parameter values to resolve in place of `spec.params`.
   *
   * For normalisation the schema cannot express — the tween reads `x:100` as `100px`, because a
   * bare number is the spelling the syntax was designed around and `params.ts` is deliberately
   * strict about units for everyone else. Still untrusted author input: it goes through
   * `resolveParams` exactly as `spec.params` would have.
   */
  params?: Record<string, string>
  /**
   * Extra parameter specs for keys this variant synthesised, merged *over* the primitive's own.
   *
   * One attribute can legitimately produce parameters the primitive could not have declared
   * statically. `tween x:'0,100,40'` is three values for one key, and each of them needs its own
   * custom property (`--kui-tween-x-1`, `-2`, `-3`) because a keyframe step can only read one — so
   * `variantFor` expands the list into `params` and declares the specs for the expansion here.
   *
   * **This is not a way around validation, and must never become one.** The merged schema is what
   * `resolveParams` validates `params` against, so every synthesised value is type-checked and
   * escape-screened exactly as an authored one is; what this field changes is only *which* specs
   * exist, never whether they are enforced. Merged over rather than replacing, so a variant cannot
   * quietly drop the primitive's own declarations and admit a value the schema forbids.
   */
  schema?: ParameterSchema
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
  /**
   * Refine this primitive for one authored spec — see {@link EffectVariant}.
   *
   * Called once per spec by `compile`, *before* composition analysis, because the answer decides
   * whether the spec's neighbours may compose with it at all. It is handed the raw `EffectSpec`
   * (author input, unvalidated — `resolveParams` still runs afterwards on whatever it returns) and
   * a warning sink, so a spec the primitive cannot make sense of can say so by name rather than
   * compiling to silence.
   *
   * Must be pure and must not mutate `spec`: `compile` is a pure function and the same parsed
   * value is compiled again on every rescan of the element.
   */
  variantFor?(spec: EffectSpec, warn: (message: string) => void): EffectVariant
}

/**
 * One property a preset transitions on its own host box — the `data-kui-fx` element itself, never
 * a pseudo-element, sibling, or descendant. `declarations.ts`'s `pushTransitions` reads these to build
 * the merged `--kui-transition` custom property `base.css`'s one `:where([data-kui-fx])` rule
 * consumes; see that rule's comment for why the merge has to happen here rather than in CSS.
 */
export interface TransitionSegment {
  /**
   * CSS property or registered custom property (e.g. `--kui-border-pct`) this segment eases.
   * `registerPreset` rejects `all` and `none` here: either would swallow every other segment in
   * the merged list, the same failure mode a shared `transition: all` shorthand has today.
   */
  property: string
  /** Literal, when the preset pins its own timing regardless of what the author writes. Omitted
   * means "the primitive's namespaced `--kui-<id>-duration`, or the author's positional value" —
   * the same precedence `pushTrack` already gives a compiled `animation-duration`. */
  duration?: string
  /** Same precedence as `duration`, for the easing curve. */
  easing?: string
}

/**
 * *When* an effect owns the channels it claims — the axis `core/channels.ts` needs to tell a real
 * collision apart from two effects that merely name the same CSS property.
 *
 * Channels alone answer "do these two write `translate`?" and the answer for `fade-up, lift` is
 * yes, which is why the compiler used to drop `lift`. It is the wrong question. `fade-up` is a
 * from-only `@keyframes` — `kui-in-up` declares a `from` block and no `to`, so its endpoint is the
 * *underlying* value the cascade supplies, re-evaluated every frame — and `lift` is a
 * `:hover`-scoped normal declaration with a transition. The entrance owns `translate` while it
 * plays and hands it straight back afterwards, which is precisely the layering an author asking for
 * "fade it in, then let it lift on hover" wants.
 *
 * The four values are the four ways an effect can hold a channel over time:
 *
 * - `entrance` — plays once on arrival from a hidden/displaced from-state, then yields the channel
 *   to whatever the cascade says. Every `cloak: true` preset in the catalog.
 * - `exit` — the mirror: starts at the rest state and plays once to a departed one.
 * - `idle` — runs unbounded, so it never yields the channel at all. Ambient loops, and anything an
 *   author promoted with `repeat:infinite`.
 * - `state` — held by a CSS state on the element (`:hover`, `[aria-expanded]`, a
 *   `data-kui-step-state`), so it changes only when the visitor does something.
 *
 * **This has to be declared, not derived** — the same conclusion `cloak` above reached, for the
 * same reason and after the same measurement. Phase cannot come from the `Primitive`: a primitive
 * carries no iteration count (that is a per-*preset* custom property, see
 * `declarations.ts`'s `iterationCountProperty`), and entrances and exits share primitives outright
 * — `fade-in` and `fade-out` are both `reveal`. A census of the 37 primitives backing two or more
 * presets found exactly two whose presets would disagree about phase (`path-draw`, six finite draws
 * beside an infinite `gradient-stroke`; `text-marquee`, an infinite `marquee` beside a
 * scroll-linked one), so preset granularity is where the fact actually lives.
 *
 * `entrance` is specifically "plays once and *releases* the channel". That is what makes the pairing
 * safe, and it is narrower than "is an entrance": fifteen of the catalog's fifty-four entrances
 * close their keyframe block with an explicit `to`, so their `animation-fill-mode: both` pins the
 * property for good and a composed hover would silently do nothing. `test/composition-phase.test.ts`
 * asserts the released half against the shipped stylesheets, the way `css-invariants.test.ts`
 * already does for `requiresOwnSubtree`.
 *
 * Undeclared is a real fifth state and not a synonym for any value: `compile.ts`'s `phaseOf` derives
 * `state` from `transitions` — sound by construction, a transition has no clock and emits no
 * animation track — and otherwise leaves the phase unknown, which conflicts with everything exactly
 * as the library behaved before this field existed. Nothing is guessed from `cloak`; see `phaseOf`
 * for the measurement that ruled it out.
 */
export type EffectPhase = 'entrance' | 'exit' | 'idle' | 'state'

/**
 * *How* a preset's motion reaches the element — the axis {@link EffectPhase} was mistaken for.
 *
 * `phase` answers **when** an effect holds a channel, and the `entrance|state` composition
 * exemption was built on it. Three of four auditors in the 2026-09-08 catalog review arrived
 * independently at the same correction: when is not the question that decides whether two effects
 * can coexist. *How each one's motion is delivered* is, because delivery decides which of them the
 * cascade lets win. Five mechanisms exist in this catalog:
 *
 * - **host transition / normal declaration** — sits in the cascade beneath a composed entrance, so
 *   a from-only keyframe resolves its missing endpoint against it. This is the one the exemption
 *   was actually reasoning about, and it is safe.
 * - **compiler-owned inline animation** — `compile.ts` writes `animation-name` and its longhands to
 *   `element.style`. Two of these on one channel replace each other by list order, which is what
 *   `channels.ts` already models.
 * - **stylesheet-owned host animation** — the motion is `[data-kui-fx~='name']:hover { animation: … }`
 *   in `src/css/*.css`, on the host box. **This is the one that needs declaring**, because an inline
 *   `animation-name` written by *any* composed neighbour outranks that author-rule shorthand
 *   outright, whatever channels either side claims. `fade-up, icon-spin` compiled with zero
 *   warnings and `icon-spin` could never run.
 * - **pseudo-element** — `::before`/`::after`. Inline style on the host cannot reach it, which is
 *   why `shine-sweep` and `beam-border` are unaffected and why `pseudo-before`/`sweep` model that
 *   box as a channel instead.
 * - **JS-driven** — the primitive writes inline style itself at runtime.
 *
 * Only the third has a name here, deliberately, and it is the same argument
 * `channels.ts`'s `CHANNEL_COMPOSITION` makes for being an allowlist with one member: a value the
 * compiler does not act on is documentation wearing a type's clothes. The other four are either
 * already modelled (inline animation is `renderer: 'css-keyframes'`; a pseudo-element box is a
 * channel) or need no rule at all, so naming them here would invite a declaration nothing reads.
 */
export type DeliveryMechanism = 'stylesheet-animation'

export interface Preset {
  name: string
  primitive: string
  /** Parameter overrides that differentiate this name from its primitive's defaults. */
  params?: Record<string, string>
  /** CSS `@keyframes` name this preset animates, when renderer is `css-keyframes`. */
  keyframes?: string
  /**
   * Properties this preset transitions on its own host box, merged by `compile.ts` into one
   * `--kui-transition` custom property so composed presets never fight over a bare `transition:`
   * shorthand the way two rules once did (`data-kui="lift, border-glow"` used to compile
   * `transition-property: box-shadow` only — `border-glow`'s rule replaced `lift`'s by source
   * order, and `lift` snapped instead of easing).
   *
   * Per-*preset*, not per-primitive, for the same reason `keyframes`/`cloak` are: `plus-to-minus`
   * and `hamburger-to-x` share the `icon-toggle` primitive, but only `plus-to-minus`'s control
   * itself rotates — the other two only move their `.kui-bar` children, a different box this field
   * deliberately does not describe (see `base.css`'s consuming rule for the host-box boundary).
   */
  transitions?: TransitionSegment[]
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
  /**
   * When this name holds the channels its primitive claims — see {@link EffectPhase} for what the
   * four values mean and why the fact is per-preset rather than per-primitive.
   *
   * Optional, and omitting it is not a shortcut for "entrance". `compile.ts`'s `phaseOf` derives
   * `state` from `transitions` and otherwise treats the preset as unphased, which composes exactly
   * as the library did before this field existed. Declaring it is how a name opts *into* composing
   * with a neighbour on a shared channel; it is never how one opts out.
   *
   * So everything except the seventeen presets carrying `transitions` declares its own phase or
   * composes as it always did. None of the three remaining values has a signal the compiler can
   * read: an `idle` loop keeps its `infinite` iteration count in CSS as
   * `--kui-fx-<name>-iterations`, an `exit` is structurally identical to an entrance at this layer
   * (same primitive, no cloak), and an `entrance` only qualifies if its keyframes leave the channel
   * open at the end, which is a fact about the stylesheet rather than about this record.
   */
  phase?: EffectPhase
  /**
   * How this name's motion reaches the element, when that is something the compiler has to act on —
   * see {@link DeliveryMechanism} for the full five-mechanism picture and why only one of them is
   * spelled here.
   *
   * Declared per *preset*, the same granularity as {@link cloak} and {@link phase}, because the
   * stylesheet rule it describes is keyed on the preset name (`[data-kui-fx~='icon-spin']:hover`)
   * and one primitive backs names on both sides of it — `HOVER_PRIMITIVES` holds `icon-spin`
   * beside `lift`, whose motion is a transition.
   *
   * Absent means "nothing the composition resolver needs to know", which is every preset but four.
   * That is a hand-written set of names and it is not allowed to stay one on trust:
   * `test/css-composition-invariants.test.ts` derives the true set from `src/css/*.css` with
   * `extractHostAnimationBindings` and asserts it *both* ways, so a fifth hover keyframe added to a
   * stylesheet without this declaration fails a test instead of shipping a silently dead effect —
   * the same shape `css-invariants.test.ts` already uses to police {@link requiresOwnSubtree}.
   */
  delivery?: DeliveryMechanism
  /**
   * This preset's CSS reaches past the `data-kui-fx`-stamped element — to a child, a sibling, or a
   * descendant it assumes exists — rather than animating the fx element itself. `target:` may not
   * relocate it: a relocated `data-kui-fx` would sit on the *matched* descendant instead of the
   * host, and the reaching selector (`[data-kui-fx~='card-flip-x'] > .kui-card-face`, say) would
   * then look for a grandchild the retargeted element was never authored with, compiling to
   * silence rather than a visible effect.
   *
   * Declared per *preset*, the same granularity as {@link cloak}: whether a name's CSS reaches past
   * itself is a fact only its author knows, and a primitive can back names on both sides of this —
   * `step-progress` and `media-scrub` already resolve their own `target:` internally and never
   * reach this flag at all, because `compile.ts` only consults it for a preset whose primitive does
   * *not* declare a `target` parameter of its own.
   *
   * `test/css-invariants.test.ts` derives the true set from `src/css/*.css` and asserts every name
   * on it declares this, so a future selector added without the flag fails a test instead of
   * silently compiling to an empty subtree in production.
   */
  requiresOwnSubtree?: boolean
}

export type ResolvedParams = Record<string, string>

/** One effect segment parsed out of a `data-kui` value. */
export interface EffectSpec {
  name: string
  duration?: string
  delay?: string
  easing?: string
  /**
   * Authored `at:` position — where this segment starts relative to the one before it in the comma
   * list. Untrusted and unparsed; `core/sequence.ts` owns the grammar and every diagnostic.
   *
   * Beside `delay` rather than inside `params` for the same reason `delay` itself is: it is not a
   * parameter. No `ParameterSchema` declares it, it means the same thing for every effect in the
   * catalog, and `resolveParams` would reject it as unknown on all 255 of them. It is also not
   * hoisted to `ParsedValue` the way `on:`/`timeline:` are, because a position is per-segment by
   * definition — the whole point is that each segment can sit somewhere different.
   */
  at?: string
  /**
   * Authored condition, on either or both of two independent axes: viewport (`above:md`,
   * `below:lg`, or both for a band) and container (`wide:md`, `narrow:lg`, or both for a band,
   * measured against the nearest `data-kui-container` ancestor). Absent when the segment is
   * unconditional, which is every segment written before the viewport half of this existed.
   *
   * Beside `at` rather than inside `params` for the same reason `at` is: it is not a parameter. No
   * `ParameterSchema` declares it, it means the same thing for every effect in the catalog, and
   * `resolveParams` would reject it as unknown on all of them. And not hoisted to `ParsedValue` the
   * way `on:`/`timeline:` are, because the point of a gate is that each segment can carry a
   * different one — `fade-up below:md, parallax-y above:md` is the case this feature exists for, and
   * an element-scoped gate could not express it at all.
   *
   * Already validated by the time it lands here: `parse.ts` refuses a name that is not on the
   * scale, and refuses a band that can never match, on either axis. `core/breakpoints.ts` owns all
   * of it. The container half is further narrowed by `compile.ts`'s `refuseContainerGate`: a
   * `wide`/`narrow` on a JavaScript-rendered primitive is stripped (with a warning) before the plan
   * is built, because there is no JS mirror for it the way `above`/`below` have one.
   */
  gate?: EffectGate
  /**
   * Authored `repeat:` — how many times this segment plays, as the CSS
   * `animation-iteration-count` value it compiles to: a non-negative number, or `infinite`.
   *
   * Beside `at` and `gate` rather than inside `params` for the reason both of those are: it is not
   * a parameter. No `ParameterSchema` declares it, it means the same thing for every effect in the
   * catalog, and `resolveParams` would reject it as unknown on all of them. And not hoisted to
   * `ParsedValue` the way `on:`/`timeline:` are, because `declarations.ts` writes
   * `animation-iteration-count` as a per-*track* list precisely so a composed one-shot effect does
   * not inherit its neighbour's loop — an element-scoped repeat would undo that in the grammar.
   *
   * Already validated by the time it lands here (`core/repeat.ts` owns the value grammar), but not
   * yet reconciled with the element's timeline or renderer: `compile.ts`'s `refusePlayback` strips
   * a repeat the compiled output cannot honour, with a warning, before the plan is built.
   */
  repeat?: string
  /**
   * Authored `yoyo:` — whether this segment alternates direction between iterations, compiling to
   * `animation-direction: alternate`. Spelled `yoyo` and not `direction` because `direction` is
   * already a parameter on the split-text primitive; see `core/repeat.ts`'s module comment.
   */
  yoyo?: boolean
  params: Record<string, string>
}

/** The full parse of one element's `data-kui` attribute. */
export interface ParsedValue {
  specs: EffectSpec[]
  /**
   * Hoisted from the reserved `on:` / `actions:` / `timeline:` / `threshold:` / `cascade:` /
   * `spread:` / `order:` / `cols:` / `along:` / `rm:` / `func:` keys. Element-scoped: one element
   * has one activation, one timeline, one stagger group, one reduced-motion policy and one
   * completion — so none of these can sensibly differ between the comma-separated segments of a
   * single attribute, and all of them are lifted out of the per-effect `params`.
   */
  activation?: Activation
  /**
   * What to do at each of the scroll trigger's four crossings, verbatim —
   * `play/pause/resume/reset`, in the order enter, leave, enter-back, leave-back.
   *
   * A refinement of `activation` rather than a peer of it: without one of the observed activations
   * there are no crossings to act on, and `toggle-actions.ts` says so rather than binding verbs
   * nothing will ever reach.
   */
  actions?: string
  timeline?: string
  threshold?: string
  /**
   * Stagger step for this element's animated children — the `data-kui` spelling of
   * `data-kui-stagger`'s positional step. Raw text, deliberately unvalidated here: `stagger.ts`
   * owns the grammar for both spellings and has always passed the step through verbatim so
   * `var(--speed)` and `calc(90ms * 2)` keep working.
   */
  cascade?: string
  /**
   * Total stagger budget for this element's animated children — GSAP's `stagger.amount` to
   * `cascade`'s `stagger.each`. The whole group finishes within this time however many children it
   * has, so `stagger.ts` divides it by the group's largest rank to get the per-item step.
   *
   * Raw text and unvalidated for the same reason `cascade` is: it ends up inside a `calc()` written
   * to `--kui-stagger`, and `var(--speed)` divides exactly as well as `600ms` does.
   */
  spread?: string
  /** Where the stagger wave starts — `data-kui-stagger`'s `from:`, under a name `data-kui` can hold. */
  order?: string
  /**
   * The stagger group's column count, or `auto` to measure it — what turns `order:` from a rank
   * over DOM index into a rank over distance through a real 2D layout.
   *
   * Raw text, validated in `stagger.ts` beside the `order:` it modifies: the two are one
   * diagnostic, and splitting them across two modules would mean an author reading half a message.
   */
  cols?: string
  /**
   * Restrict a grid stagger to one axis — `x` or `y`. Spelled `along:` rather than GSAP's `axis:`
   * because `axis` is already a parameter on four primitives and a hoisted key never reaches
   * `spec.params`; `data-kui-stagger` accepts both words.
   */
  along?: string
  /**
   * Author-chosen reduced-motion policy, folded into the primitives' own by `compile.ts`.
   *
   * Validated at parse time (unlike `cascade`/`order`) because it is a closed three-value set with
   * no expression forms, so there is nothing a later stage could know that `parse.ts` does not.
   */
  rm?: ReducedMotionPolicy
  /**
   * Name of a global function to call when the element's effects finish — the no-build spelling of
   * `addEventListener('kui:finish', fn)`, and registered as exactly that listener.
   *
   * Raw text, deliberately unvalidated at parse time: whether a name resolves depends on script
   * order at runtime, which the parser cannot see. `core/callback.ts` owns the lookup and carries
   * the note on why this key must not be built from untrusted input.
   */
  func?: string
  warnings: string[]
}

/** Runtime truth. Attributes are for CSS and debugging; they make a poor state machine. */
export interface InstanceState {
  /** Whole-configuration identity, not just `data-kui` — see `fingerprintOf`. */
  fingerprint: string
  specs: EffectSpec[]
  activation: Activation
  timeline: Timeline
  /**
   * Normalized effect names — the same list stamped into `data-kui-fx`.
   *
   * Retained rather than re-read off the attribute because both readers need it after teardown has
   * already restored the attribute: a `kui:cancel` event fires *after* `release()` has unwound the
   * ledgers (so listeners see the author's own markup, not the library's), and by then the
   * attribute is gone.
   */
  fxNames: string[]
  /**
   * Names of the composed effects rendered in JavaScript.
   *
   * Kept so `control.ts` can say *which* effects a control call could not reach instead of the
   * useless "some effect on this element". The names, not the instances: an instance whose
   * `prepare` threw is never constructed, and an author who wrote the name still deserves to be
   * told the name they wrote.
   */
  jsEffectNames: string[]
  /**
   * Whether progress here is driven by scroll position rather than a clock — `timeline: pin`'s
   * paused-plus-negative-delay scrub, or a native `view()`/`scroll()` timeline.
   *
   * `control.ts` refuses to act on these. Writing `animation-play-state: running` onto a scrubbed
   * animation hands it back to the document timeline and it plays forward in wall-clock time on
   * top of the seek (see `style-plan.ts`'s `Gate`), and seeking one is pointless anyway — the
   * scroll scheduler rewrites `--kui-progress` on the very next frame and overwrites the seek.
   */
  progressDriven: boolean
  /** One handle per renderer in play; the animator gates them uniformly. */
  instances: EffectInstance[]
  /** Inline properties this element's effects wrote, and what they replaced. */
  ledger: StyleLedger
  attributes: AttributeLedger
  /**
   * Every element these effects wrote to, host included, and the ledgers that unwind them.
   *
   * `ledger`/`attributes` above are this set's entries *for the host*, kept as named fields because
   * that is what every reader in `animator.ts` asks for and the host is the only element a
   * lifecycle write ever lands on: `data-kui-state` is stamped on the authored element and nowhere
   * else. The set exists for the writes that are not lifecycle — inline properties, `data-kui-fx`,
   * `--kui-i` — which `target:` relocates onto elements the host merely names.
   *
   * One element in the set is exactly the old singular behaviour, which is why this can be true
   * before anything is retargeted.
   */
  ledgers: LedgerSet
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
  /**
   * Whether this element's effects were cancelled rather than allowed to complete.
   *
   * Cancelling an instance resolves its `finished` promise (the "resolves, never rejects" contract
   * above), so the animator's completion handler still runs and still writes
   * `data-kui-state="finished"` — behaviour that predates lifecycle events and is left alone. What
   * it must *not* do is also dispatch `kui:finish`, which would tell an author chaining work that
   * an animation they explicitly cancelled had run to its end.
   */
  cancelled?: boolean
  status: 'pending' | 'ready' | 'running' | 'finished' | 'failed'
}
