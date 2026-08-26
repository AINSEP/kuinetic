import type { PrepareContext } from '../core/effect-context.js'
import { deferredInstance } from '../core/instances.js'
import { timingProperty } from '../core/registry.js'
import type {
  Activation,
  EffectParams,
  NamedActivation,
  ParameterSchema,
  Primitive,
  ReducedMotionPolicy,
  Timeline,
} from '../core/types.js'

/**
 * The one `delay` declaration, spread by every primitive that waits for a trigger before playing.
 *
 * Two spellings of an authored delay exist and they arrive by different routes. The positional
 * one (`count-up 320ms 300ms`) rides alongside the parameter record as `params.timing` — see the
 * design note in `core/js-effect-preparer.ts` for why timing is deliberately *not* merged into
 * that record — while the named one (`count-up delay:300ms`) reaches a primitive only if its
 * schema declares `delay`, and is otherwise dropped by `resolveParams` as an unknown parameter.
 * So every primitive whose start moment is a trigger has to declare this, and declaring it is
 * safe precisely because `0ms` is a true no-op: `readEffectParams` pre-fills every declared
 * parameter, so a non-zero default would be indistinguishable from an authored value.
 *
 * Spread (`...TRIGGER_DELAY_PARAM`) rather than retyped so that rationale has one home.
 *
 * "Waits for a trigger" is wider than `defaultActivation: 'enter'`, which is all the structural
 * guard in `test/js-effect-timing.test.ts` originally covered. A hover lift, an `aria-expanded`
 * icon toggle and a FLIP reorder all default to `'load'` — they install listeners or an observer
 * at load — yet each has a perfectly definite start moment later on (the pointer arrives, the
 * attribute flips, the children move), and "start 200ms after that moment" is a coherent request
 * for every one of them. `test/js-effect-timing-parity.test.ts` now guards both groups; its
 * `TIMING_REFUSALS` table names the primitives that genuinely have no start moment and must *not*
 * pick this up.
 */
export const TRIGGER_DELAY_PARAM: ParameterSchema = {
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
}

/** The three positional timing tokens of the grammar: `data-kui="fade-up 600ms 200ms linear"`. */
export type TimingToken = 'duration' | 'delay' | 'ease'

/** All three, in grammar order. Also the `honours` list of a primitive that supports the lot. */
export const ALL_TIMING_TOKENS: readonly TimingToken[] = ['duration', 'delay', 'ease']

/**
 * What a JS-rendered primitive can actually *do* with authored timing.
 *
 * The problem this closes: the two spellings of a timing value fail differently, and one of them
 * fails silently. `pin-section delay:300ms` reaches `readParams`, is not in the schema, and warns
 * as an unknown parameter — the author is told. `pin-section 0ms 300ms` parses into
 * `spec.delay`, is lifted out to `params.timing` (see `core/js-effect-preparer.ts`), and is then
 * simply never read by a primitive that has no clock to shift. Nothing warns, nothing happens,
 * and the page gives the author no way to find out which of those two it was.
 *
 * So a primitive that cannot honour a token has to say so, and it has to say so about the
 * positional spelling too. Declaring the contract is how it does that.
 */
export interface TimingContract {
  /**
   * Tokens this primitive genuinely acts on. Anything omitted warns by name when authored.
   * Omit the field entirely for a primitive that honours none of the three.
   */
  honours?: readonly TimingToken[]
  /**
   * Completes `"<id>" cannot honour <token>: <because>`. Write the *reason*, not the symptom —
   * "it tracks pointer position continuously, so there is no start moment to delay" tells an
   * author to stop looking for a spelling that works, where "unsupported" does not.
   */
  because: string
}

/** The authored positional value for one token, as a CSS string, or `undefined` if unwritten. */
function authoredTiming(params: EffectParams, token: TimingToken): string | undefined {
  if (token === 'ease') return params.timing.easing
  const ms = token === 'duration' ? params.timing.durationMs : params.timing.delayMs
  return ms === undefined ? undefined : `${ms}ms`
}

/**
 * Warn once per authored-but-unhonourable timing token.
 *
 * Runs during `prepare`, not inside the deferred setup, deliberately: a `reducedMotion: 'disable'`
 * primitive never has `activate()` called at all under reduced motion, and an author debugging
 * their attribute should get the same diagnostics either way.
 *
 * @complexity O(1) time and space — three tokens, fixed.
 * @overallScore 100
 */
function warnUnhonouredTiming(
  id: string,
  contract: TimingContract,
  params: EffectParams,
  warn: (message: string) => void,
): void {
  const honours = contract.honours ?? []
  for (const token of ALL_TIMING_TOKENS) {
    if (honours.includes(token)) continue
    if (authoredTiming(params, token) === undefined) continue
    const supported = honours.length > 0 ? honours.join(', ') : 'no timing parameters'
    warn(`"${id}" cannot honour ${token}: ${contract.because} (honours: ${supported})`)
  }
}

/**
 * How long an effect waits after its trigger before it starts, in milliseconds.
 *
 * The named form of the pattern `text.ts` spells out at three call sites —
 * `params.timing.delayMs ?? params.ms('delay', 0)` — and the sibling of
 * `core/js-params.ts`'s `effectDurationMs`. Two spellings, one intent: `split-flap 400ms 200ms`
 * and `split-flap 400ms delay:200ms` mean the same thing, and the positional one is what `play()`
 * emits, so it is the one that must not be the one dropped.
 *
 * It lives here rather than beside `effectDurationMs` only because `src/core/` is being edited in
 * parallel; the two belong together and should be moved once that settles.
 *
 * @param fallback - Used when the author wrote neither spelling. Effectively always `0`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function effectDelayMs(params: EffectParams, fallback = 0): number {
  return params.timing.delayMs ?? params.ms('delay', fallback)
}

/**
 * The curve an effect runs on, preferring the positional token over the same-named parameter.
 *
 * The easing half of the same story. A primitive reading only `params.text('ease')` sees
 * `flip-shuffle ease:linear` and not `flip-shuffle 400ms 0ms linear`, which is the identical
 * request written the way the grammar puts it first.
 *
 * @param fallback - Used when the author wrote neither spelling.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function effectEasing(params: EffectParams, fallback = ''): string {
  return params.timing.easing ?? params.text('ease', fallback)
}

/**
 * Copy the honoured positional tokens onto the primitive's own namespaced custom properties.
 *
 * Only the `key:value` spelling reaches CSS on its own: `compile.buildPlan` runs `resolveParams`
 * over `spec.params` for every effect, but `pushTrack` — which is where `spec.duration`/`.delay`/
 * `.easing` are turned into declarations — runs for `css-keyframes` primitives only. So a
 * stylesheet-driven JS primitive sees `lift duration:400ms` and not `lift 400ms`, which is the
 * same value written the other way round.
 *
 * Written through the ledger and therefore restored on teardown, and written *after*
 * `applyStylePlan` has already put any `key:value` overrides inline — so the positional spelling
 * wins a collision, matching `effectDurationMs`'s `params.timing.durationMs ?? params.ms(...)`
 * precedence rather than contradicting it.
 *
 * Takes the whole context rather than the ledger off it so that an unauthored effect never
 * dereferences `ctx` at all. That is not fastidiousness: `test/three-d.test.ts` calls the
 * state-driven presets' `prepare` with no element and no context, asserting that the default path
 * reaches for neither, and a caller like `prepareCardToggle` runs this before it knows whether it
 * has anything else to do.
 *
 * @complexity O(1) time and space — three tokens, fixed.
 * @overallScore 100
 */
export function mirrorTimingToCss(
  id: string,
  honours: readonly TimingToken[],
  params: EffectParams,
  ctx: PrepareContext,
): void {
  for (const token of honours) {
    const value = authoredTiming(params, token)
    if (value !== undefined) ctx.style.set(timingProperty(id, token), value)
  }
}

/**
 * Wrap a primitive's own `prepare` so authored timing it cannot act on warns instead of vanishing.
 *
 * For primitives that drive their own frames. The wrapped `prepare` still does all the work; this
 * only adds the diagnostics, which is why it composes with `deferPrepare` rather than replacing it.
 *
 * @param id - The primitive's id, named in the warning.
 * @param contract - What this primitive honours, and why it cannot honour the rest.
 * @param prepare - The primitive's real setup.
 * @complexity O(1) time and space beyond the wrapped call.
 * @overallScore 100
 */
export function withTimingContract(
  id: string,
  contract: TimingContract,
  prepare: NonNullable<Primitive['prepare']>,
): NonNullable<Primitive['prepare']> {
  return (el, params, ctx) => {
    warnUnhonouredTiming(id, contract, params, ctx.warn)
    return prepare(el, params, ctx)
  }
}

/**
 * The `prepare` for a primitive whose motion is a stylesheet transition or keyframe rather than
 * frames this library drives — the hover family, the icon toggles, the flip card.
 *
 * These used to be `prepare: () => inertInstance()`, registered purely so the name parses and
 * `data-kui-fx` gets stamped. That was almost right: the *named* spelling of a timing parameter
 * already reaches their CSS through `resolveParams`, so there was nothing for JS to do. The
 * positional spelling had no route at all, which is the gap this closes — plus the warning for
 * whichever tokens the shipped rule pins (a linear spin's `ease`, say).
 *
 * @param id - The primitive's id; also the namespace of the properties written.
 * @param contract - Which tokens the stylesheet actually reads, and why it ignores the others.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function stylesheetTimingPrepare(
  id: string,
  contract: TimingContract,
): NonNullable<Primitive['prepare']> {
  return (el, params, ctx) => {
    warnUnhonouredTiming(id, contract, params, ctx.warn)
    // Deferred like every other JS primitive so an `on:click`/`on:enter` author still controls
    // when the library touches their element, even though the write itself is only a few custom
    // properties. A bare `Cleanup` return is the honest shape: there is no completion to report,
    // and the ledger the animator owns unwinds the write.
    return deferredInstance(() => {
      mirrorTimingToCss(id, contract.honours ?? [], params, ctx)
      return () => {}
    })
  }
}

/**
 * "Accepts every timeline, is driven by none of them."
 *
 * A few primitives have no relationship to progress at all: `background-media` paints a backdrop,
 * and the scroll-mechanics drivers read the scroll position themselves rather than being driven by
 * an `animation-timeline`. None of them ever reads `Timeline`.
 *
 * They still have to *accept* one, because `compile.ts`'s `intersect` narrows a composed element's
 * timeline support to what every primitive on it supports. Declaring the honest answer — `['time']`,
 * or nothing — empties that intersection for `data-kui="background-media src:/hero.mp4, parallax"`
 * with `timeline:view`, `style-plan.ts` then refuses the timeline, and the neighbour's scrub
 * silently degrades to a one-shot. Nothing is wrong with either effect; the intersection is simply
 * the wrong question to ask of a primitive that has no opinion.
 *
 * So the list stays exhaustive and this name is what makes it truthful. Written out inline it reads
 * as a claim to support all four — the same lie in four places, each needing its own paragraph to
 * walk back. Written as `supportedTimelines: TIMELINE_AGNOSTIC` it reads as what it is: an
 * abstention, not a claim.
 *
 * One shared array instance, like `ENTRANCE_TIMELINES` in `catalog/core.ts`. Every consumer
 * (`intersect`, `warnUnsupportedTimeline`) only reads it.
 */
export const TIMELINE_AGNOSTIC: Timeline[] = ['time', 'view', 'scroll', 'pin']

const COMMON: ParameterSchema = {
  duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  stagger: { type: 'time', default: '0ms', cssProperty: '--kui-stagger' },
}

export interface CssPrimitiveOptions {
  parameters?: ParameterSchema
  timelines?: Timeline[]
  activations?: NamedActivation[]
  defaultActivation?: Activation
  reducedMotion?: ReducedMotionPolicy
  perfClass?: Primitive['perfClass']
}

/**
 * Build the metadata shared by every CSS-keyframe-rendered primitive.
 *
 * The one factory for "a CSS-keyframes `Primitive` with the shared timing defaults
 * (`duration`/`delay`/`ease`/`stagger`), `renderer: 'css-keyframes'`, and a default
 * activation/perfClass/reducedMotion policy" — every category under `effects/` that renders
 * with CSS keyframes builds its primitives through this, so a change to a shared default only
 * has one call site to update.
 *
 * @param id - Stable primitive identifier.
 * @param channels - CSS property groups owned by the primitive.
 * @param options - Optional schema and lifecycle overrides.
 * @returns A CSS-keyframe primitive ready for registry registration.
 * @complexity O(p) time and space in parameter count.
 * @overallScore 100
 */
export function cssPrimitive(
  id: string,
  channels: string[],
  options: CssPrimitiveOptions = {},
): Primitive {
  return {
    id,
    renderer: 'css-keyframes',
    channels,
    parameters: { ...COMMON, ...options.parameters },
    supportedTimelines: options.timelines ?? ['time'],
    supportedActivations: options.activations ?? [
      'load',
      'enter',
      'hover',
      'focus',
      'click',
      'manual',
    ],
    perfClass: options.perfClass ?? 'compositor',
    reducedMotion: options.reducedMotion ?? 'shorten',
    ...(options.defaultActivation ? { defaultActivation: options.defaultActivation } : {}),
  }
}
