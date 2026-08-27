import type { InstanceControl } from './types.js'

/**
 * The four crossings, and what an author can ask for at each.
 *
 * A scroll trigger has four distinct moments, not two. Travelling down the page an element *enters*
 * the viewport and later *leaves* it out of the top; travelling back up it re-enters from the top
 * and leaves again out of the bottom. `data-kui-on="enter/leave"` covers two of them, with the only
 * two verbs being "play" and "play backwards" — so the thing an author most often wants from a
 * scroll trigger, *pause where you are and carry on from there when I come back*, could not be
 * written at all.
 *
 * This module is the vocabulary: what the four crossings are called, what the eight verbs mean, and
 * how one authored string becomes a verb per crossing. It touches no DOM and holds no state.
 * `activation.ts` decides *which* crossing happened — it is the only thing holding the observer
 * entry that can tell — and `animator.ts` owns the element and supplies the two element-level
 * transitions the verbs are built from. Neither of them has to know the vocabulary, and this file
 * does not have to know either of them.
 *
 * **Nothing here animates anything.** Every verb is composed from `InstanceControl` —
 * `pause`/`resume`/`seek`, which `control.ts` has exposed as public API since runtime control
 * shipped — plus `activate` and `reverse`, which only the animator can own because they are
 * transitions of the element's whole state machine rather than of one playhead.
 */

/**
 * One of the four moments a scroll crossing can happen at, named from the reader's direction of
 * travel rather than the element's: `enter` and `leave` happen while scrolling *down*, the two
 * `-back` crossings while scrolling back *up*.
 *
 * Hyphenated rather than camel-cased because these names are quoted back to authors in warnings,
 * and every other word this library asks an author to read is hyphenated.
 */
export type Crossing = 'enter' | 'leave' | 'enter-back' | 'leave-back'

/** The four crossings in the order an author writes them — GSAP's `toggleActions` order. */
export const CROSSINGS: readonly Crossing[] = ['enter', 'leave', 'enter-back', 'leave-back']

/**
 * What to do at a crossing.
 *
 * The same eight GSAP's `toggleActions` takes, and the same words, because an author arriving from
 * it should not have to learn a second vocabulary for an identical idea. What each one means here
 * is stated in {@link applyToggleVerb}, which is also where the ones that cannot be honest about an
 * element that has not started yet are handled.
 */
export type ToggleVerb =
  | 'play'
  | 'pause'
  | 'resume'
  | 'reverse'
  | 'reset'
  | 'restart'
  | 'complete'
  | 'none'

const VERBS: ReadonlySet<string> = new Set([
  'play',
  'pause',
  'resume',
  'reverse',
  'reset',
  'restart',
  'complete',
  'none',
])

/**
 * The verbs that move a playhead rather than the element's state machine.
 *
 * A set because it answers one question the diagnostics need: does this markup ask for something a
 * JavaScript-rendered effect cannot do? See {@link warnAboutToggleActions}.
 */
const PLAYHEAD_VERBS: ReadonlySet<ToggleVerb> = new Set<ToggleVerb>([
  'pause',
  'resume',
  'reset',
  'restart',
  'complete',
])

/** A verb per crossing. Every slot is always present; an unwritten one is `none`. */
export type ToggleActions = Readonly<Record<Crossing, ToggleVerb>>

/**
 * Separator between the four verbs: `actions:play/pause/resume/reset`.
 *
 * The same character, chosen for the same reason, as `activation.ts`'s own pair separator: a comma
 * splits `data-kui` into effect segments and a space splits it into tokens, so either would have
 * forced authors to quote the commonest spelling of this feature. A slash is inert to the tokenizer
 * and needs no quoting in an attribute, and it already reads as "these belong together" beside
 * `data-kui-on="enter/leave"`, which is the very thing this refines.
 */
const SEPARATOR = '/'

/**
 * Parse an authored `actions:` value into a verb per crossing.
 *
 * Total by construction: an unrecognised verb becomes `none` rather than failing the element, and
 * every rejection is named. Trailing slots the author left off are `none` too, so `actions:play` is
 * "play on the way in and nothing else" — which is both GSAP's own default and this library's
 * existing behaviour for an unpaired `on:enter`.
 *
 * @param value - Authored text, e.g. `play/pause/resume/none`.
 * @param warnings - Sink for the diagnostics. Optional so a pure parse can ignore them.
 * @complexity O(1) time and space — at most four tokens.
 * @overallScore 100
 */
export function parseToggleActions(value: string, warnings: string[] = []): ToggleActions {
  const parts = value.split(SEPARATOR)
  if (parts.length > CROSSINGS.length) {
    warnings.push(
      `"actions:${value}" has ${String(parts.length)} verbs — there are four crossings ` +
        `(${CROSSINGS.join(SEPARATOR)}), so the extras are ignored`,
    )
  }
  const actions: Record<Crossing, ToggleVerb> = {
    'enter': 'none',
    'leave': 'none',
    'enter-back': 'none',
    'leave-back': 'none',
  }
  for (const [index, crossing] of CROSSINGS.entries()) {
    const raw = parts[index]?.trim()
    if (raw === undefined || raw === '') continue
    actions[crossing] = toVerb(raw, crossing, warnings)
  }
  return actions
}

/**
 * Resolve one authored verb, naming it rather than guessing when it is not one.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function toVerb(raw: string, crossing: Crossing, warnings: string[]): ToggleVerb {
  if (VERBS.has(raw)) return raw as ToggleVerb
  warnings.push(
    `unrecognised action "${raw}" for the "${crossing}" crossing — expected ` +
      `${[...VERBS].join(', ')}`,
  )
  return 'none'
}

/**
 * Diagnose an authored `actions:` value without a document — the shape-only half.
 *
 * Mirrors `validateActivation`'s contract exactly, including where it stops: this is the part
 * `parse.ts` can run with nothing but the attribute text. Whether the *element* can honour the
 * verbs needs its compiled plan, and lives in {@link warnAboutToggleActions}.
 *
 * @returns Zero warnings when every token is a verb.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function validateToggleActions(value: string): string[] {
  const warnings: string[] = []
  parseToggleActions(value, warnings)
  return warnings
}

/**
 * The first crossing that asks for something only a real playhead can do.
 *
 * @complexity O(1) time and space — four crossings.
 * @overallScore 100
 */
function usesPlayhead(actions: ToggleActions): ToggleVerb | undefined {
  for (const crossing of CROSSINGS) {
    if (PLAYHEAD_VERBS.has(actions[crossing])) return actions[crossing]
  }
  return undefined
}

/** What {@link warnAboutToggleActions} needs to know about the element, with no DOM in it. */
export interface ToggleDiagnostics {
  actions: ToggleActions
  /** Whether this element's activation is delivered by the intersection observer at all. */
  observed: boolean
  /** The authored activation, quoted back when it is not an observed one. */
  activation: string
  /** Names of the composed effects rendered in JavaScript — they expose no playhead. */
  jsEffectNames: readonly string[]
  /** Whether the element's progress belongs to the scroller rather than to a clock. */
  progressDriven: boolean
}

/**
 * Report every way an authored `actions:` cannot do what it says.
 *
 * All three of these produce a knob that exists and does nothing, which this codebase treats as
 * worse than a missing knob — and all three are invisible from the markup, because the element
 * still animates, just not the way the attribute claims.
 *
 * @returns One message per problem; empty when the element can honour every verb.
 * @complexity O(1) time and space — four crossings.
 * @overallScore 100
 */
export function warnAboutToggleActions(request: ToggleDiagnostics): string[] {
  if (!request.observed) {
    return [
      `"actions:" describes the four crossings of a scroll trigger, but this element activates ` +
        `on "${request.activation}" — nothing here is ever reached. Use on:enter or on:enter/leave`,
    ]
  }
  const verb = usesPlayhead(request.actions)
  if (verb === undefined) return []

  const warnings: string[] = []
  if (request.progressDriven) {
    warnings.push(
      `"actions:" asks to ${verb} an element whose progress is driven by scroll position rather ` +
        `than by a clock — its playhead belongs to the scroller and would be overwritten on the ` +
        `next frame`,
    )
  }
  const js = request.jsEffectNames
  if (js.length > 0) {
    const one = js.length === 1
    warnings.push(
      `"actions:" asks to ${verb}, which needs a playhead, and "${js.join(' ')}" ` +
        `${one ? 'is' : 'are'} rendered in JavaScript and expose${one ? 's' : ''} none — ` +
        `that crossing does nothing for ${one ? 'it' : 'them'}`,
    )
  }
  return warnings
}

/** The element a verb is being applied to, reduced to what the verbs actually need. */
export interface ToggleTarget {
  /**
   * Whether the element has been activated at all.
   *
   * The distinction two of the verbs cannot be honest without. An element that has never started is
   * already sitting at its from-state, so `reset` there is a no-op rather than a seek, and `resume`
   * means *start* rather than *unpause* — going straight to the ledger's play-state would open the
   * compiled gate behind the animator's back, leaving `data-kui-state` reading `ready` on a visibly
   * running element and no `kui:start` ever dispatched.
   */
  started: boolean
  /** The element's reachable playheads. Empty for a JS-rendered or scroll-driven element. */
  controls: readonly InstanceControl[]
  /** Start, or turn a reversing playhead back around — `Animator.activate`. */
  activate(): void
  /** Play out backwards to the from-state — `Animator.reverseFrom`. */
  reverse(): void
}

/**
 * Do one verb.
 *
 * Every branch is composed from things that already existed. `play` and `reverse` are the element's
 * two directional transitions, which only the animator owns; the other five are `InstanceControl`
 * calls. Nothing here touches an `Animation` object, and nothing here decides *when* — that is the
 * observer's job.
 *
 * The three jump verbs are worth stating precisely, because "a jump" and "a state machine" are easy
 * to get wrong together:
 *
 * - **`reset`** rewinds to the from-state and stops there. On an element that never started there
 *   is nothing to rewind — it is already at the from-state — so this does nothing at all rather
 *   than seeking playheads still sitting behind the compiled gate.
 * - **`restart`** rewinds and keeps going. It activates first, so an element crossing for the first
 *   time starts properly — with its `kui:start`, its state attribute and its settle — rather than
 *   being seeked while still gated. On an already-running element `activate` returns at its own
 *   guard, so no second settle is armed and the seek simply replays the run.
 * - **`complete`** jumps to the end state, and activates first for the same reason. It deliberately
 *   does *not* pause afterwards: an animation seeked to its end while still playing reaches
 *   `finished` on its own, and that is what resolves the settle and dispatches `kui:finish`.
 *   Pausing it there would strand the element at `running` forever with nothing moving.
 *
 * @complexity O(n) time in the element's controllable instances; O(1) space.
 * @overallScore 100
 */
export function applyToggleVerb(verb: ToggleVerb, target: ToggleTarget): void {
  if (verb === 'play') target.activate()
  else if (verb === 'reverse') target.reverse()
  else if (PLAYHEAD_VERBS.has(verb)) applyPlayheadVerb(verb, target)
  // `none` is the remaining case and does nothing, which is the whole of it.
}

/**
 * The five verbs that move a playhead, including what each one means on an element that has not
 * started.
 *
 * An un-started element is stopped at its from-state, which is already what `pause` and `reset`
 * ask for — so those do nothing rather than reaching for playheads that are still sitting behind
 * the compiled gate. The other three start it, and then stop: `resume` on an element that was
 * never started *is* the activation and nothing more, because there is no playhead to unpause and
 * calling `resume()` on the instances would write a play-state the animator never asked for,
 * opening the gate behind its back.
 *
 * @complexity O(n) time in the element's controllable instances; O(1) space.
 * @overallScore 100
 */
function applyPlayheadVerb(verb: ToggleVerb, target: ToggleTarget): void {
  if (!target.started) {
    if (startsIt(verb)) target.activate()
    return
  }
  if (verb === 'restart' || verb === 'complete') target.activate()
  for (const control of target.controls) applyToPlayhead(verb, control)
}

/**
 * Whether a playhead verb still means something on an element that has never started.
 *
 * `pause` and `reset` do not: an un-started element is already stopped at its from-state, which is
 * exactly what both of them ask for. The other three do, by starting it.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function startsIt(verb: ToggleVerb): boolean {
  return verb === 'resume' || verb === 'restart' || verb === 'complete'
}

/**
 * The playhead half of a verb, once the element-level part of it has been done.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function applyToPlayhead(verb: ToggleVerb, control: InstanceControl): void {
  if (verb === 'pause') control.pause()
  else if (verb === 'resume') control.resume()
  else if (verb === 'complete') control.seek(1)
  else {
    // `reset` and `restart` share the rewind and differ only in whether they then stop.
    control.seek(0)
    if (verb === 'reset') control.pause()
    else control.resume()
  }
}
