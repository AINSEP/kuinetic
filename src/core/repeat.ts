import type { EffectSpec, Renderer, Timeline } from './types.js'

/**
 * `repeat:` and `yoyo:` — how many times one segment plays, and whether it alternates.
 *
 * ## Why these two words
 *
 * `repeat` is free: no primitive in the catalog declares it, and it is the word every animation
 * library uses for the count. `yoyo` is GSAP's word for `animation-direction: alternate`, and it is
 * used here in preference to the CSS one for a concrete reason rather than a stylistic one —
 * **`direction` is already a parameter**, on the split-text primitive
 * (`effects/catalog/text.ts`, `values: ['fade', 'up', 'down', 'mask']`), and shipped presets use
 * it. A key lifted onto the spec never reaches `spec.params`, so spelling this `direction:` would
 * make `data-kui="split-chars direction:up"` unwritable — the identical collision `parse.ts`
 * documents for `from:` → `order:`, and resolved the same way: keep the existing parameter, choose
 * a word no primitive claims.
 *
 * Overloading `direction:` by value (lift it only when it reads `alternate`, leave it in `params`
 * otherwise) was considered and rejected. It works exactly until somebody adds `reverse` to a
 * split-text `values` list, at which point one of the two meanings silently stops arriving.
 *
 * `yoyo` is a boolean rather than the full `animation-direction` keyword set. `reverse` and
 * `alternate-reverse` are the two the set would add, and the catalog already ships directional
 * pairs (`fade-in`/`fade-out`, `slide-up`/`slide-down`) for the first; the second starts an
 * entrance at its end state, which is the trap this module warns about below rather than a feature.
 *
 * ## Why per-segment rather than hoisted element-wide
 *
 * `declarations.ts` writes `animation-iteration-count` as a **per-track** value list precisely so a
 * composed one-shot effect cannot inherit its neighbour's loop. Hoisting `repeat:` to the element
 * (the `on:`/`timeline:` pattern) would undo that in the grammar layer after the compiler had gone
 * to the trouble of preventing it in the CSS layer: `data-kui="pulse repeat:infinite, fade-up"`
 * has to leave `fade-up` alone. So this is lifted onto the `EffectSpec`, beside `at:` and the
 * breakpoint gate, which are per-segment for the same "each segment can differ" reason.
 *
 * ## Why no new custom property
 *
 * An authored count is written *literally* into the track, replacing
 * `var(--kui-fx-<preset>-iterations, 1)`. Writing it as an inline custom property instead would put
 * it in the flat, inherited `--kui-*` namespace, where a descendant carrying the same preset would
 * silently pick up an ancestor's count — the failure `--kui-i` is reset in `kui.tokens` to avoid.
 * `animation-iteration-count` is not an inherited property, so the literal cannot travel.
 */

/** The one keyword `repeat:` accepts besides a number. Spelled exactly as CSS spells it. */
const INFINITE = 'infinite'

/**
 * A play count: unitless, unsigned, optionally fractional (CSS allows `0.5` and means it).
 *
 * Written with the same non-backtracking alternation as `parse.ts`'s `TIME_RE` and
 * `sequence.ts`'s `AT_OFFSET` — `\d+\.?\d*` lets `1.2.3.4.5` backtrack super-linearly.
 */
const COUNT_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/

/**
 * Timelines whose progress comes from scroll position, where "how many times" is not a question a
 * finite, position-mapped range can answer forever. `pointer` is deliberately absent: nothing
 * drives it natively, so `style-plan.ts` degrades it to an ordinary clock where a repeat is exact.
 */
const PROGRESS_DRIVEN: ReadonlySet<Timeline> = new Set<Timeline>(['view', 'scroll', 'pin'])

export type PlaybackKey = 'repeat' | 'yoyo'

const PLAYBACK_KEYS: ReadonlySet<string> = new Set<PlaybackKey>(['repeat', 'yoyo'])

/**
 * Whether a `key:value` key is one this module owns, so `parse.ts` can dispatch with one lookup
 * rather than a growing `||` chain against its own complexity ceiling.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function isPlaybackKey(key: string): key is PlaybackKey {
  return PLAYBACK_KEYS.has(key)
}

/** Where a playback token came from, so the diagnostics can quote it back. */
export interface PlaybackContext {
  segment: string
  warn: (message: string) => void
}

/**
 * Validate and lift one `repeat:`/`yoyo:` token onto the spec being built.
 *
 * Validated here, at parse time, for the reason `rm:` is: both are closed value sets with no
 * expression forms, so there is nothing a later stage could know that this one does not, and the
 * author is owed the diagnostic next to every other grammar diagnostic. The *timeline*-dependent
 * refusals are the opposite case and live in {@link resolvePlayback}, which runs where the
 * element's timeline and renderer are known.
 *
 * Every rejection is a warning plus no value, never a warning plus a half-applied one — the same
 * fail-open `applyGate` uses. A mistyped count leaves the effect playing exactly once, which is
 * what it did before the author added the key.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function applyPlayback(
  spec: EffectSpec,
  key: PlaybackKey,
  value: string,
  context: PlaybackContext,
): void {
  if (spec[key] !== undefined) {
    context.warn(`duplicate parameter "${key}" in "${context.segment}"`)
  }
  if (key === 'yoyo') applyYoyo(spec, value, context)
  else applyRepeat(spec, value, context)
}

/**
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function applyRepeat(spec: EffectSpec, value: string, context: PlaybackContext): void {
  if (value === INFINITE) {
    spec.repeat = INFINITE
    return
  }
  if (!COUNT_RE.test(value)) {
    context.warn(countRefusal(value, context.segment))
    return
  }
  if (Number(value) === 0) {
    // Accepted rather than refused — `animation-iteration-count: 0` is legal CSS and this is
    // exactly what it does — but named, because GSAP's `repeat: 0` means "play once, no repeats"
    // and an author carrying that habit over would otherwise get a blank element and no clue why.
    context.warn(
      `"repeat:0" in "${context.segment}" means the effect never plays — with animation-fill-mode: ` +
        `both it jumps straight to its end state. Write "repeat:1" to play it once, or drop the key.`,
    )
  }
  spec.repeat = value
}

/**
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function applyYoyo(spec: EffectSpec, value: string, context: PlaybackContext): void {
  if (value !== 'true' && value !== 'false') {
    context.warn(
      `"yoyo:${value}" in "${context.segment}" is not a boolean — expected yoyo:true or yoyo:false`,
    )
    return
  }
  spec.yoyo = value === 'true'
}

/**
 * Explain a rejected `repeat:` value.
 *
 * The negative case gets its own sentence because `-1` is how several other libraries spell
 * "forever", so an author writing it has a specific wrong idea rather than a typo, and telling
 * them the spelling that works is the difference between a warning and a shrug.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function countRefusal(value: string, segment: string): string {
  if (value.startsWith('-')) {
    return (
      `"repeat:${value}" in "${segment}" is negative — a play count cannot be. Write ` +
      `"repeat:infinite" to loop forever, or a non-negative number such as repeat:3.`
    )
  }
  return (
    `"repeat:${value}" in "${segment}" is not a play count — expected a non-negative number such ` +
    `as repeat:3, or repeat:infinite`
  )
}

/** What {@link resolvePlayback} needs to know about one compiled segment. */
export interface PlaybackInput {
  /** Preset name. Only ever used in warnings, which have to name what the author wrote. */
  name: string
  renderer: Renderer
  /** Whether the preset's from-state is one the visitor must not see. See `Preset.cloak`. */
  cloak?: boolean
  timeline: Timeline
  repeat?: string
  yoyo?: boolean
}

/** The playback settings that survived, plus anything the author needs told. */
export interface PlaybackResolution {
  repeat?: string
  yoyo?: boolean
  warnings: string[]
}

/**
 * Decide what an authored `repeat:`/`yoyo:` actually compiles to, given the renderer and timeline.
 *
 * Refusals here **drop the modifier and keep the effect**, which is the same fail-open
 * `refuseContainerGate` uses one function away in `compile.ts`: the effect still runs, it simply
 * runs the way it would have without the key, and the author is told by name. It is the right
 * direction for this feature specifically because the failure mode of *keeping* an impossible
 * repeat is not "nothing happens" but a visibly broken element — see the progress-timeline case.
 *
 * @complexity O(1) time; O(1) space beyond the returned warnings.
 * @overallScore 100
 */
export function resolvePlayback(input: PlaybackInput): PlaybackResolution {
  const warnings: string[] = []
  if (input.repeat === undefined && input.yoyo === undefined) return { warnings }

  if (input.renderer !== 'css-keyframes') return { warnings: [rendererRefusal(input)] }

  if (input.repeat === INFINITE && PROGRESS_DRIVEN.has(input.timeline)) {
    warnings.push(infiniteTimelineRefusal(input.name, input.timeline))
    return { yoyo: input.yoyo, warnings }
  }

  const hidden = endsHidden(input)
  if (hidden) warnings.push(hidden)
  return { repeat: input.repeat, yoyo: input.yoyo, warnings }
}

/**
 * Name a segment whose alternating playback lands it back on a from-state the visitor must not see.
 *
 * `animation-direction: alternate` with an **even** count ends on a reversed iteration, and
 * `animation-fill-mode: both` then holds that reversed end — which for a cloaked preset is the
 * invisible/displaced state `Preset.cloak` exists to describe. `fade-up yoyo:true repeat:2` leaves
 * the element blank on the page. That is a real request with a real answer (`repeat:3`), so it is
 * warned and kept rather than refused; silently dropping the yoyo would change the motion the
 * author asked for to hide a problem they can fix in one character.
 *
 * Only cloaked presets are named. An even yoyo on `pulse` or `shake` ends at rest and is simply
 * what yoyo means; warning about it would be noise on every correct use of the feature.
 *
 * @returns The warning, or `null` when this segment does not end hidden.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function endsHidden(input: PlaybackInput): string | null {
  if (!input.cloak || input.yoyo !== true) return null
  const count = repeatCount(input.repeat)
  if (count === undefined || count === 0 || count % 2 !== 0) return null
  return (
    `"${input.name}" with yoyo:true and an even repeat:${input.repeat} ends on a reversed ` +
    `iteration, and this effect's from-state is one the visitor is not meant to see — the element ` +
    `finishes hidden. Use an odd count (repeat:${count + 1}) to end at the rest state.`
  )
}

/**
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function rendererRefusal(input: PlaybackInput): string {
  const authored = [
    input.repeat === undefined ? '' : `repeat:${input.repeat}`,
    input.yoyo === undefined ? '' : `yoyo:${input.yoyo}`,
  ]
    .filter(Boolean)
    .join(' and ')
  return (
    `"${input.name}" is rendered in JavaScript and compiles no animation-iteration-count, so ` +
    `${authored} does nothing — it plays once. Repeat is a CSS-keyframes capability; a JS-rendered ` +
    `effect that loops does it through a parameter of its own (typewriter's "loop:"), if it has one.`
  )
}

/**
 * Explain that "forever" is not a thing a finite scroll range can express.
 *
 * The two reasons are genuinely different, so they get two sentences rather than one hedge. Under
 * `view()`/`scroll()` the effect's iteration duration is the range divided by the iteration count,
 * which for `infinite` collapses the active interval to zero — the same shape as the out-of-range
 * `animation-range` note in `style-plan.ts`, and with the same visible result: the element renders
 * permanently at its end state. Under `pin` the animation is held paused and seeked by a negative
 * `animation-delay` of `progress x duration`, a head that spans one playthrough, so nothing past
 * the first iteration is reachable however far the page is scrolled.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function infiniteTimelineRefusal(name: string, timeline: Timeline): string {
  const because =
    timeline === 'pin'
      ? `a pin scrubs a single playthrough with a negative animation-delay, so no iteration past ` +
        `the first is ever reachable`
      : `a "${timeline}" timeline is a finite range driven by scroll position rather than a clock, ` +
        `and an infinite iteration count collapses the animation's active duration to zero there — ` +
        `the element renders frozen at its end state`
  return (
    `"${name}" has repeat:infinite on a "${timeline}" timeline: ${because}. Dropping the repeat, ` +
    `so it plays once across the range — put an infinite loop on a "time" timeline instead.`
  )
}

/**
 * The finite number of plays a validated `repeat:` asks for.
 *
 * @returns The count, or `undefined` for `infinite` and for an unwritten `repeat:` — the two cases
 *   where no caller may do arithmetic with it.
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function repeatCount(repeat: string | undefined): number | undefined {
  if (repeat === undefined || repeat === INFINITE) return undefined
  return Number(repeat)
}

/** Whether a validated `repeat:` asks for a loop with no end. */
export function isInfiniteRepeat(repeat: string | undefined): boolean {
  return repeat === INFINITE
}

/** The value a track's `animation-direction` takes. `normal` is the CSS initial value. */
export function directionValue(yoyo: boolean | undefined): string {
  return yoyo ? 'alternate' : 'normal'
}

/**
 * A CSS time expression scaled from one iteration to the whole playback.
 *
 * Used by both consumers of a repeat that has to do arithmetic — the `at:` sequencer's "after the
 * previous one ends", and the pin scrub head in `declarations.ts` — so the two cannot disagree
 * about how long a repeated effect takes.
 *
 * Returns `duration` untouched for an unwritten or single repeat, which is what makes every
 * attribute written before this parameter existed compile byte-for-byte identically. Never called
 * with `infinite`: both callers refuse that case by name first, because `calc(600ms * infinite)`
 * is not an expression and a browser drops the whole declaration rather than reporting it.
 *
 * @complexity O(n) time in the expression's length; O(1) space.
 * @overallScore 100
 */
export function playbackExpression(duration: string, repeat: string | undefined): string {
  const count = repeatCount(repeat)
  if (count === undefined || count === 1) return duration
  return `${duration} * ${count}`
}
