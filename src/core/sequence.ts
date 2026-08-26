import { toMilliseconds } from './js-params.js'
import { timingProperty } from './registry.js'
import type { Timeline } from './types.js'

/**
 * Relative sequencing — the `at:` position.
 *
 * ## Why relative, and only relative
 *
 * Serial and parallel playback were already expressible before this module existed. Two
 * comma-separated specs with no delay run together; giving the second a `delay:` past the first's
 * duration runs them one after the other. So an *absolute* `at:200ms` would have been `delay:200ms`
 * under a second name, and a previous investigation in this repo rejected exactly that kind of
 * respelling.
 *
 * What was genuinely missing is the position GSAP timelines express as `"-=0.2"`: **start this one
 * 200ms before the previous one ends**. Written by hand that is `delay: previousDelay +
 * previousDuration - 200ms`, arithmetic the author has to redo every time either of the other two
 * numbers changes — and cannot do at all when the previous duration is a preset default they never
 * wrote down. That is the capability this adds, and it is why every `at:` value has to be relative:
 * the absolute spelling is refused by name rather than accepted as a synonym.
 *
 * ## Why it compiles to a delay rather than a playhead
 *
 * A sequence resolves to arithmetic, and arithmetic can be done ahead of time. Building a
 * JavaScript playhead to drive frames would trade away the one thing the CSS renderer is for:
 * these are real CSS animations running off the main thread once started. So `at:` produces a
 * longer `animation-delay` expression and nothing else — no timer, no per-frame work, no runtime
 * state.
 *
 * Most of that expression is left *symbolic*. `fade-up`'s duration compiles to
 * `var(--kui-reveal-duration, 600ms)`, not to `600ms`, so an effect positioned after it re-derives
 * its own start the moment a consumer stylesheet restyles that duration — the browser does the
 * addition, exactly as `stagger.ts` already lets it do the multiplication. Resolving the numbers
 * here instead would have frozen the sequence at compile time and quietly broken the cascade
 * promise the rest of the library keeps.
 *
 * ## The numeric mirror, and where it is honest
 *
 * A JavaScript-rendered effect has no `animation-delay` to write to; it needs a number of
 * milliseconds. So every step is resolved twice — once symbolically for CSS, once numerically for
 * JS — and the numeric half reads the same values the generated stylesheet was built from
 * (`scripts/generate-preset-css.mjs` emits each preset's `duration`/`delay` from the very schema
 * read here). The two therefore agree for every effect the library ships.
 *
 * They can disagree in one case, and it is worth naming rather than hiding: a consumer stylesheet
 * that overrides `--kui-reveal-duration` moves the CSS half of a sequence and not the JS half,
 * because a compiler cannot read a cascade that has not been computed yet. Nothing here can fix
 * that; a JS effect positioned after a restyled CSS effect is simply the boundary of what a
 * compiled sequence can promise.
 */

/**
 * The `var()` fallbacks the compiled tracks have always carried. Kept here, with the expression
 * builders, because a sequence adds a *previous* segment's duration to a delay: if these two ever
 * disagreed about what an unwritten duration means, `at:` would position effects against a number
 * the track itself never used.
 */
const DURATION_FALLBACK = '600ms'
const DELAY_FALLBACK = '0ms'

/**
 * The duration one segment compiles to — the authored positional time, or the primitive's own
 * namespaced custom property.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function durationExpression(duration: string | undefined, primitiveId: string): string {
  return duration ?? `var(${timingProperty(primitiveId, 'duration')}, ${DURATION_FALLBACK})`
}

/**
 * The delay one segment compiles to, before stagger and scrub terms are folded in.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function delayExpression(delay: string | undefined, primitiveId: string): string {
  return delay ?? `var(${timingProperty(primitiveId, 'delay')}, ${DELAY_FALLBACK})`
}

/**
 * `at:` value grammar:
 *
 *   at-value := anchor | offset | anchor offset
 *   anchor   := "with" | "after"          (default "after")
 *   offset   := ("+" | "-") <time>
 *
 * `with` anchors to where the previous effect *starts*, `after` to where it *ends*. The sign is
 * mandatory on the offset and is the whole point — see the module note above.
 *
 * Matched in two pieces rather than one pattern with everything optional. One combined pattern is
 * both harder to read and — because every group in it is optional — matches the empty string,
 * which is not a position at all; splitting it means each half asserts exactly one thing.
 *
 * The number is written with the same non-backtracking alternation as `parse.ts`'s `TIME_RE`:
 * spelling it `\d+\.?\d*` lets `1.2.3.4.5ms` backtrack super-linearly against the unit check.
 */
const AT_ANCHOR = /^(with|after)/i
const AT_OFFSET = /^([+-])(\d+(?:\.\d+)?|\.\d+)(ms|s)$/i

/** A bare time, i.e. the absolute spelling this parameter deliberately refuses. */
const BARE_TIME = /^(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/i

/** Timelines whose progress comes from scroll position, where `animation-delay` has no meaning. */
const PROGRESS_DRIVEN: ReadonlySet<Timeline> = new Set<Timeline>(['view', 'scroll'])

interface Position {
  /** `'start'` for `with`, `'end'` for `after`. */
  anchor: 'start' | 'end'
  /** Signed offset in milliseconds, for the numeric mirror. */
  offsetMs: number
  /** The offset as a CSS term — `''`, `' + 200ms'`, `' - 0.2s'` — keeping the author's own unit. */
  term: string
}

type ParsedPosition = { ok: true; position: Position } | { ok: false; reason: string }

/**
 * Parse one `at:` value.
 *
 * @param raw - Author-supplied, untrusted.
 * @returns The position, or the reason it is not one. Never throws.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function parsePosition(raw: string): ParsedPosition {
  const value = raw.trim()
  const named = AT_ANCHOR.exec(value)
  const anchor = named?.[1]?.toLowerCase() === 'with' ? 'start' : 'end'
  const offset = named ? value.slice(named[0].length) : value

  // A bare anchor is a complete position: `at:after` is "exactly when the previous one ends".
  if (offset === '') {
    if (!named) return { ok: false, reason: refusalReason(value) }
    return { ok: true, position: { anchor, offsetMs: 0, term: '' } }
  }

  const parts = AT_OFFSET.exec(offset)
  if (!parts) return { ok: false, reason: refusalReason(value) }
  const [, sign, amount, unit] = parts
  const time = `${amount}${unit}`
  // Signed by hand rather than by handing `+100ms` to `toMilliseconds`, whose pattern accepts a
  // leading `-` and not a `+` — a CSS time is never written with an explicit plus, so that is
  // correct of it. Passing the signed string straight through fell off that pattern and returned
  // the zero fallback, which silently turned every `at:+100ms` into `at:after` for JS-rendered
  // effects while the CSS half, built from the text rather than the number, stayed right.
  const magnitude = toMilliseconds(time, 0)
  return {
    ok: true,
    position: {
      anchor,
      offsetMs: sign === '-' ? -magnitude : magnitude,
      // Spaces around the operator are required by `calc()`, not decoration: `calc(600ms -200ms)`
      // is a syntax error, and a browser drops the whole declaration rather than reporting it.
      term: ` ${sign} ${time}`,
    },
  }
}

/**
 * Explain a rejected `at:` value.
 *
 * The absolute spelling gets its own sentence because it is the mistake this parameter exists to
 * argue with: it looks like it should work, it is what GSAP's position parameter accepts, and it
 * is genuinely nothing but `delay:` renamed. Telling the author that, and showing them the three
 * relative spellings, is the difference between a warning and a lecture that helps.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function refusalReason(value: string): string {
  if (BARE_TIME.test(value)) {
    return (
      `at:"${value}" is an absolute position, which is only another spelling of delay:${value} — ` +
      `write at:+${value} to start that long after the previous effect ends, at:-${value} to ` +
      `overlap it by that much, or at:with to start alongside it`
    )
  }
  return (
    `at:"${value}" is not a position — expected at:with, at:after, or a signed time such as ` +
    `at:-200ms, at:+100ms or at:with+150ms`
  )
}

/** What the sequencer needs to know about one effect segment. */
export interface SequenceMember {
  /** Preset name. Only ever used in warnings, which have to name what the author wrote. */
  name: string
  primitiveId: string
  /** Authored `at:` value, untrusted and unvalidated. */
  at?: string
  /** Authored positional delay. Compiled verbatim, so the symbolic half can use it directly. */
  delay?: string
  /** Authored positional duration, likewise. */
  duration?: string
  /**
   * What `var(--kui-<id>-delay)` is expected to resolve to — the `delay:` key, the preset's own
   * override, or the primitive's declared default, in that order. Read only by the numeric mirror.
   */
  cascadeDelay?: string
  cascadeDuration?: string
  /**
   * Whether this segment's renderer can act on a computed delay at all.
   *
   * True for every `css-keyframes` segment. For a JavaScript-rendered one it means the primitive
   * declares a `delay` parameter, which is the only compile-time signal that it honours one —
   * `TRIGGER_DELAY_PARAM` in `effects/shared.ts` is what a primitive spreads in to say so. Of the
   * 57 JS primitives, 12 declared it when this was written; task F is closing that gap, and this
   * is deliberately a question about the schema rather than a hardcoded list, so a primitive that
   * gains `delay` becomes sequenceable without anything here changing.
   */
  positionable: boolean
}

export interface SequenceStep {
  /**
   * Flat CSS sum for this segment's base delay, deliberately *not* wrapped in `calc()`: the caller
   * folds the stagger and scrub terms into the same expression, and `calc(calc(a + b) + c)`, while
   * legal, buries the arithmetic an author has to read in a devtools panel.
   */
  delayExpr: string
  /**
   * The same instant in milliseconds — always a real number, never "unknown".
   *
   * That is an invariant this module maintains rather than a fact about its inputs: a duration it
   * cannot read is refused at the point it would have been added (`follow`), with a warning naming
   * both effects, so nothing downstream ever has to carry an unknown through the arithmetic and
   * every consumer of a sequenced step gets a number it can act on.
   */
  delayMs: number
  /** Whether `at:` actually moved this segment, as opposed to being refused or absent. */
  sequenced: boolean
}

/** The members resolved so far, plus where diagnostics go. Grouped to stay inside `max-params`. */
interface Chain {
  members: SequenceMember[]
  steps: SequenceStep[]
  warn: (message: string) => void
}

/**
 * Resolve every segment's start position, in authoring order.
 *
 * Each segment's position is computed from the one before it, so this is a single left-to-right
 * pass and a chain of any length costs one traversal. A segment with no `at:` keeps exactly the
 * delay it has always compiled to — that is what makes every attribute written before this
 * parameter existed compile byte-for-byte identically.
 *
 * @param members - One per compiled effect segment, in authoring order.
 * @param timeline - The element's timeline, which decides whether a delay means anything at all.
 * @param warn - Diagnostic sink; called once per refused or ignored `at:`.
 * @returns One step per member, index-aligned with `members`.
 * @complexity O(n) time in the number of segments; O(n) space for the steps, plus O(n) in the
 *   length of the accumulated expression for a fully chained list.
 * @overallScore 100
 */
export function resolveSequence(
  members: SequenceMember[],
  timeline: Timeline,
  warn: (message: string) => void,
): SequenceStep[] {
  const chain: Chain = { members, steps: [], warn }
  let warnedAboutTimeline = false

  for (const [index, member] of members.entries()) {
    if (member.at === undefined) {
      chain.steps.push(unsequenced(member))
      continue
    }
    if (!warnedAboutTimeline && PROGRESS_DRIVEN.has(timeline)) {
      warnedAboutTimeline = true
      warn(timelineRefusal(timeline))
    }
    chain.steps.push(place(chain, index))
  }
  return chain.steps
}

/**
 * The position a segment has when nothing sequences it: its own delay, exactly as before.
 *
 * Also the fallback for every refused `at:`. An `at:` the compiler cannot honour must leave the
 * effect where it would have been anyway rather than somewhere invented — the author gets a
 * warning naming the effect, and a page that still looks like the attribute without the `at:`.
 *
 * @complexity O(n) time in the delay string's length; O(1) space.
 * @overallScore 100
 */
function unsequenced(member: SequenceMember): SequenceStep {
  return {
    delayExpr: delayExpression(member.delay, member.primitiveId),
    // Falls back to the same `0ms` the compiled `var()` does. An unreadable delay can only reach
    // here from a direct caller — `compile` screens its candidates with `isReadableTime`, and a
    // positional delay was already matched against the parser's own time pattern.
    delayMs: timeMs(member.delay ?? member.cascadeDelay ?? DELAY_FALLBACK) ?? 0,
    sequenced: false,
  }
}

/**
 * Position one segment that carries an `at:`.
 *
 * @complexity O(n) time in the value's length; O(1) space beyond the returned step.
 * @overallScore 100
 */
function place(chain: Chain, index: number): SequenceStep {
  const member = chain.members[index]!
  const own = unsequenced(member)

  const parsed = parsePosition(member.at!)
  if (!parsed.ok) {
    chain.warn(`"${member.name}": ${parsed.reason}`)
    return own
  }
  const refused = refusalFor(chain, index)
  if (refused) {
    chain.warn(refused)
    return own
  }
  if (member.delay !== undefined) {
    chain.warn(
      `"${member.name}" has both a positional delay (${member.delay}) and at:"${member.at}" — ` +
        `the delay is ignored, because at: positions the effect itself`,
    )
  }
  return follow(chain, index, parsed.position, own)
}

/**
 * Whether this segment can be positioned at all, and why not when it cannot.
 *
 * @returns The warning to emit, or `null` when the segment is positionable.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function refusalFor(chain: Chain, index: number): string | null {
  const member = chain.members[index]!
  if (index === 0) {
    // The clean extension point for sequencing across *sibling elements* (a `data-kui-seq` parent,
    // outline §9.3): a first segment would then anchor to the previous animated sibling instead of
    // to nothing, and everything downstream of it in this list already chains correctly off that.
    // The rule stays the one sentence it is today — `at:` positions a segment relative to whatever
    // came before it — with only "what came before" widening. Nothing else here would move.
    return (
      `"${member.name}" is the first effect in the list, so at:"${member.at}" has nothing to be ` +
      `relative to — using its own delay instead`
    )
  }
  if (!member.positionable) {
    // Loud rather than silent, by design. A JS-rendered primitive that declares no `delay` reads
    // an authored one and does nothing with it, so an ignored `at:` would look exactly like a
    // working one until somebody watched the page closely enough to notice the overlap missing.
    return (
      `"${member.name}" is rendered in JavaScript and declares no "delay", so at:"${member.at}" ` +
      `cannot position it — it starts with the rest of the list`
    )
  }
  return null
}

/**
 * Build the step for a segment anchored to the one before it.
 *
 * @param position - The parsed `at:`.
 * @param own - The step to fall back to when the anchor cannot be measured.
 * @complexity O(1) time; O(n) space in the accumulated expression's length.
 * @overallScore 100
 */
function follow(
  chain: Chain,
  index: number,
  position: Position,
  own: SequenceStep,
): SequenceStep {
  const previous = chain.members[index - 1]!
  const anchor = chain.steps[index - 1]!

  if (position.anchor === 'start') {
    return {
      delayExpr: `${anchor.delayExpr}${position.term}`,
      delayMs: anchor.delayMs + position.offsetMs,
      sequenced: true,
    }
  }

  const durationMs = timeMs(previous.duration ?? previous.cascadeDuration ?? '')
  if (durationMs === undefined) {
    // A continuous effect — a pin, a drag handler, a scroll progress track — has no end to
    // measure from; `at:with` is the only relative position that means anything after one. This is
    // also the single place an unreadable duration is caught, which is what lets `delayMs` be a
    // plain number everywhere else rather than an "unknown" threaded through the whole chain.
    return refuseUnmeasurable(chain, index, own)
  }
  return {
    delayExpr:
      `${anchor.delayExpr} + ${durationExpression(previous.duration, previous.primitiveId)}` +
      position.term,
    delayMs: anchor.delayMs + durationMs + position.offsetMs,
    sequenced: true,
  }
}

/**
 * Refuse a position anchored to an effect that has no end.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function refuseUnmeasurable(chain: Chain, index: number, own: SequenceStep): SequenceStep {
  const member = chain.members[index]!
  const previous = chain.members[index - 1]!
  chain.warn(
    `cannot start "${member.name}" relative to the end of "${previous.name}": "${previous.name}" ` +
      `has no readable duration, so it has no end to measure from — give it an explicit duration, ` +
      `or use at:with to start alongside it instead`,
  )
  return own
}

/**
 * Explain that a scroll-driven timeline does not read delays.
 *
 * Warned rather than dropped. On a browser without scroll-driven animations `style-plan.ts`
 * degrades the element to an ordinary clock-driven animation, where the compiled delay is once
 * again exactly right — so removing it would break the fallback path to tidy up the native one.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function timelineRefusal(timeline: Timeline): string {
  return (
    `at: compiles to an animation-delay, and a "${timeline}" timeline is driven by scroll position ` +
    `rather than a clock, so it ignores one — position a scroll-driven effect with a range instead ` +
    `(the trailing tokens of data-kui-timeline, e.g. data-kui-timeline="${timeline} entry 0% cover ` +
    `60%"). The delay still applies where the browser has no scroll-driven animations and the ` +
    `effect degrades to a clock.`
  )
}

/**
 * Milliseconds from a CSS time, or `undefined` when it is not one.
 *
 * Distinct from `toMilliseconds`' own fallback parameter because the caller has to be able to tell
 * "unreadable" from "zero": defaulting a duration it could not parse to `0` would stack the next
 * effect straight on top of this one, which is a plausible-looking wrong answer rather than a
 * missing one, and `follow` refuses it by name instead.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function timeMs(value: string): number | undefined {
  const ms = toMilliseconds(value, Number.NaN)
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * Whether a value is a time this module can do arithmetic with.
 *
 * Exported for `compile`, which has to choose between several candidates for what a timing custom
 * property will resolve to. The CSS cascade skips a value the validator rejected and falls through
 * to the next one; the numeric mirror has to make the same choice, or the two halves of a sequence
 * would be built from different durations — `duration:banana` would leave CSS on the preset default
 * and the JS path with nothing.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function isReadableTime(value: string): boolean {
  return timeMs(value) !== undefined
}
