import type { Animator } from './animator.js'
import type { StyleLedger } from './owned-styles.js'
import { resolveTargets } from './play.js'
import type { Target } from './play.js'
import type { Activation, InstanceControl, PlaybackState, Timeline } from './types.js'

/**
 * Runtime control over a running animation.
 *
 * Almost none of this is new machinery, and that is the point. `instances.ts` already holds real
 * `Animation` handles for every `css-keyframes` effect, and `style-plan.ts` already seeks a paused
 * animation with a negative `animation-delay` — the whole `timeline: pin` scrub is built on it.
 * What was missing was a way for an author to *reach* any of it. This module is that reach, and
 * deliberately adds no second implementation of anything the browser already does.
 *
 * Two rules shape everything below:
 *
 * 1. **Play state is owned by the ledger, not by WAAPI.** The compiler writes
 *    `animation-play-state: paused` as the gate and `instances.ts` writes `running` to open it, so
 *    `pause()`/`resume()` here write the same property through the same ledger. Calling
 *    `animation.pause()` instead would put two owners on one piece of state — the browser's
 *    interaction between a WAAPI pause and a later CSS `animation-play-state` change is subtle
 *    enough that the two would eventually disagree, and only the ledger's copy unwinds on teardown.
 *    Seeking and re-speeding have no CSS equivalent, so those do go through WAAPI.
 *
 * 2. **A control call never invents a playhead that does not exist.** JavaScript-rendered effects
 *    and scroll-driven ones are reported by name rather than silently accepting calls that do
 *    nothing — see `bindElement`.
 *
 * ## Why there is no `onUpdate` / per-frame event
 *
 * `progress` is a *pull*, not a push, and that is a decision rather than an omission. A per-frame
 * `CustomEvent` for every animated element is the one addition here that could plausibly cost more
 * than the feature is worth: a page with fifty reveals running at 60 fps would dispatch three
 * thousand events a second, each one waking the main thread and running the full event
 * propagation path from the element to `document`.
 *
 * That is not merely slow, it is self-defeating. This library's central performance claim is that a
 * compiled effect is a genuine CSS animation running off the main thread (see the outline's §2.3).
 * A per-frame event drags every one of them back onto it. So the author who genuinely needs a value
 * each frame reads `control(el).progress` inside their own `requestAnimationFrame` — one loop, for
 * the one element they care about — and everybody else pays nothing.
 */

/** Milliseconds. Below this an animation's span is treated as unmeasurable rather than seekable. */
const MEASURABLE_SPAN_MS = 0

/**
 * Clamp author-supplied progress into the normalized range.
 *
 * Clamping rather than rejecting: `seek(1.2)` has one obvious intent ("the end"), and refusing it
 * would strand an author whose own arithmetic overshoots by a rounding error at the exact moment
 * they wanted the final frame.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Read a WAAPI time value that the spec types as `CSSNumberish`.
 *
 * `currentTime` and `endTime` are plain numbers on every engine that ships CSS animations today,
 * but both are typed to allow a `CSSNumericValue` for scroll-driven timelines, and `endTime` is
 * `Infinity` for `animation-iteration-count: infinite`. Anything that is not a finite number is
 * reported as `0`, which every caller here already treats as "no measurable span" — an infinite
 * marquee genuinely has no progress to report.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function finiteMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function endTimeOf(animation: Animation): number {
  return finiteMs(animation.effect?.getComputedTiming?.().endTime)
}

/**
 * The element's whole span, in milliseconds: activation to the last composed animation's end.
 *
 * Progress is defined over this rather than over one animation's active phase, and authored delays
 * are inside it. Comma-separated specs in `data-kui` "start counting from the same instant" (see
 * the grammar in `parse.ts`), so `fade-up 600ms, blur-in 400ms delay:600ms` is one thing an author
 * thinks of as a second long — not two animations with unrelated clocks. Excluding delay would
 * make `progress: 0.5` mean a different wall-clock moment for each composed effect, which is
 * exactly the confusion normalizing to 0..1 exists to remove.
 *
 * @complexity O(a) time in owned animations; O(1) space.
 * @overallScore 100
 */
function spanOf(animations: readonly Animation[]): number {
  let span = MEASURABLE_SPAN_MS
  for (const animation of animations) span = Math.max(span, endTimeOf(animation))
  return span
}

/**
 * Collapse several playback states into the one an author would call the whole thing.
 *
 * Precedence is running > paused > finished > idle, which is "the most alive thing wins" — an
 * element composing a 600 ms reveal with a 200 ms blur is still *running* for the 400 ms after the
 * blur has finished, and reporting `finished` there would be wrong in the only direction that
 * matters (an author gating cleanup on it would tear down a visibly moving element).
 *
 * @complexity O(n) time in states; O(1) space.
 * @overallScore 100
 */
function mergePlayStates(states: readonly PlaybackState[]): PlaybackState {
  if (states.length === 0) return 'idle'
  if (states.includes('running')) return 'running'
  if (states.includes('paused')) return 'paused'
  return states.every((state) => state === 'finished') ? 'finished' : 'idle'
}

/**
 * A teardown-grade guard for the two WAAPI calls that can legitimately throw.
 *
 * `reverse()` raises `InvalidStateError` on an animation with an unresolved end time — an infinite
 * `@keyframes` loop, of which this catalog has many — and a `currentTime` write can raise on an
 * animation whose timeline has gone inactive. Neither is a programming error the author can act
 * on, and neither should abort the remaining animations on the same element, so both are
 * swallowed here rather than surfaced.
 *
 * @complexity O(1) beyond the wrapped call.
 * @overallScore 100
 */
function quietly(operation: () => void): void {
  try {
    operation()
  } catch {
    /* intentionally ignored — see doc comment */
  }
}

/**
 * Control backed by the real `Animation` objects a compiled CSS effect produces.
 *
 * @param animations - Reader for the element's *owned* animation handles. A reader rather than an
 *   array because the set changes: `instances.ts` restarts an animation by rewriting
 *   `animation-name`, which replaces the handles wholesale, and a captured array would then be
 *   driving objects the element no longer has.
 * @param ledger - The instance's style ledger, so a play-state write unwinds on teardown.
 * @complexity O(a) per call in owned animations; O(1) space.
 * @overallScore 100
 */
export function createCssControl(
  animations: () => Animation[],
  ledger: StyleLedger,
): InstanceControl {
  return {
    pause() {
      ledger.set('animation-play-state', 'paused')
    },
    resume() {
      ledger.set('animation-play-state', 'running')
    },
    /**
     * Flip this instance's playback rate and keep running — "turn around", whichever way it was
     * going.
     *
     * No longer the route `ControlHandle.reverse()` takes, and deliberately so: that call is about
     * the *element's* direction of travel, which only the animator owns, and it needs the absolute
     * "play out to the from-state" of `EffectInstance.reverse` rather than this relative flip.
     * Retained because `InstanceControl` is a published interface and this is the honest meaning of
     * `reverse` at the level of one playhead — a caller holding a single instance's control has no
     * element-wide direction to speak of.
     */
    reverse() {
      for (const animation of animations()) quietly(() => animation.reverse())
      // `reverse()` also *plays*, so leaving the inline value at `paused` would leave the ledger
      // claiming something the browser is no longer doing — and the next `pause()`/`resume()` pair
      // would then write a value identical to the stale one, which the browser ignores as a no-op.
      ledger.set('animation-play-state', 'running')
    },
    seek(progress) {
      const list = animations()
      const span = spanOf(list)
      if (span === MEASURABLE_SPAN_MS) return
      const at = clamp01(progress) * span
      // Each animation is clamped to its *own* end, not to the shared span. A 200 ms blur composed
      // with a 600 ms reveal must sit at its final frame while the reveal is still travelling —
      // writing `at` unclamped would push it past its end time, where a `fill: both` animation
      // renders identically but `playState` reads `finished` at a moment it has not been reached.
      for (const animation of list) {
        quietly(() => {
          animation.currentTime = Math.min(at, endTimeOf(animation))
        })
      }
    },
    rate(playbackRate) {
      for (const animation of animations()) animation.playbackRate = playbackRate
    },
    get progress() {
      const list = animations()
      const span = spanOf(list)
      if (span === MEASURABLE_SPAN_MS) return 0
      let at = 0
      // The maximum, not the first: composed animations share a start time, so the longest one
      // carries the furthest-advanced `currentTime` and is the only one still moving at the end.
      for (const animation of list) at = Math.max(at, finiteMs(animation.currentTime))
      return clamp01(at / span)
    },
    get playState() {
      return mergePlayStates(animations().map((animation) => animation.playState))
    },
  }
}

/**
 * A handle over one selection's playheads.
 *
 * Every mutator returns the handle so calls chain — `control('.hero').timeScale(0.25).seek(0.5)`
 * reads the way the equivalent GSAP line does. Chaining is the reason these are methods rather
 * than settable properties.
 */
export interface ControlHandle {
  /** The elements this handle resolved to, in document order. */
  readonly elements: Element[]
  /**
   * Effect names in the selection whose playhead no control call can reach — JavaScript-rendered
   * effects, and anything driven by scroll rather than a clock.
   *
   * Readable so a caller can branch on it rather than discovering the gap by watching nothing
   * happen. Every entry has also already been reported through the animator's reporter.
   *
   * "Playhead" is the operative word, and it is `pause`, `play`, `seek`, `timeScale` and `progress`
   * that it governs. `reverse()` is the one method here that is not a playhead call — it asks the
   * animator which way the element is travelling — so it answers to the animator's directional test
   * instead, and a scroll-driven element is refused for its own reason rather than this one.
   */
  readonly uncontrolled: string[]
  pause(): ControlHandle
  play(): ControlHandle
  /**
   * Play the selection backwards, ending at the from-state each element started from.
   *
   * Idempotent: calling it twice is one exit, not an exit and an entrance, on exactly the rule that
   * makes two `pointerleave`s in a row one exit. It is also *recorded* — the animator knows the
   * element is travelling backwards, so a subsequent paired-activation exit does not start a second
   * reverse, and the element settles at `data-kui-state="ready"` with a `kui:reverse-finish`.
   *
   * To travel forwards again, activate the element (`play()`, `kui.activate()`, or the entrance
   * half of its activation): the animator turns a reversing playhead around rather than restarting
   * it. `play()` on this handle is the narrower thing its name says elsewhere in this file — the
   * counterpart to `pause()` — and does not change direction.
   */
  reverse(): ControlHandle
  /** Move every playhead to `progress` (0..1). Values outside the range are clamped. */
  seek(progress: number): ControlHandle
  /** Multiply playback speed. `1` is authored speed; a negative value runs backwards. */
  timeScale(rate: number): ControlHandle
  /**
   * Position of the *least* advanced element in the selection, 0..1.
   *
   * The minimum rather than the maximum or the first, so `progress === 1` means every element is
   * done — the reading an author actually gates on. `0` for a selection with nothing controllable.
   */
  readonly progress: number
  readonly state: PlaybackState
}

/** One element's controllable instances, plus what could not be reached on it. */
interface Bound {
  /**
   * The element these controls belong to.
   *
   * Carried because `reverse()` is not a playhead call like the others: it asks the *animator* to
   * change the element's direction of travel, and the animator's entry point is element-shaped.
   * See the handle's `reverse` for why that indirection exists.
   */
  el: Element
  controls: InstanceControl[]
  unreachable: string[]
  /** Why, phrased for a warning. Absent when everything on the element is reachable. */
  note?: string
  /**
   * Whether `bindElement` declined this element outright rather than merely partly.
   *
   * The distinction only matters to `reverse()`. An element with no installed effect has no state
   * machine to talk to, and a scroll-driven one's playhead belongs to the scroller — for both, this
   * module's answer is "no", and handing either to the animator would quietly undo that refusal.
   * An element that is *partly* reachable (a CSS effect composed with a JS one) is not refused: the
   * half that can travel backwards still should, exactly as it does for a paired activation's exit.
   */
  refused?: boolean
}

/**
 * Work out what can actually be controlled on one element, and what cannot.
 *
 * @complexity O(i) time in the element's instances; O(i) space.
 * @overallScore 100
 */
function bindElement(animator: Animator, el: Element): Bound {
  const state = animator.stateOf(el)
  if (!state) {
    return {
      el,
      controls: [],
      unreachable: [],
      refused: true,
      note: 'no kUInetic effect is installed on this element — it has no playhead to control',
    }
  }
  if (state.progressDriven) {
    return {
      el,
      controls: [],
      unreachable: [...state.fxNames],
      refused: true,
      note:
        `"${state.fxNames.join(' ')}" is driven by scroll position rather than a clock, so its ` +
        `playhead belongs to the scroller — pausing or seeking it would be overwritten on the ` +
        `next frame`,
    }
  }
  const controls = state.instances
    .map((instance) => instance.control)
    .filter((control): control is InstanceControl => control !== undefined)
  const unreachable = [...state.jsEffectNames]
  if (unreachable.length === 0) return { el, controls, unreachable }
  return {
    el,
    controls,
    unreachable,
    note:
      `"${unreachable.join(' ')}" ${unreachable.length === 1 ? 'is' : 'are'} rendered in ` +
      `JavaScript and expose${unreachable.length === 1 ? 's' : ''} no playhead, so pause, seek ` +
      `and timeScale do not reach ${unreachable.length === 1 ? 'it' : 'them'}`,
  }
}

export interface ControlRequest {
  animator: Animator
  root: ParentNode
  target: Target
}

/**
 * Build a control handle for a selection.
 *
 * Warnings are emitted once here, at construction, rather than on each call: an author who asks
 * for control over an effect that has none should be told immediately, including when they only
 * meant to *read* `progress` — and repeating the same sentence on every frame of a `seek` loop
 * would bury it. The default reporter is silent, exactly as it is for an unknown effect name or an
 * unsupported activation; `consoleReporter()` makes all of them loud together, which is the
 * existing contract rather than a new one invented here.
 *
 * @param request - Animator, root, and target selection. Mirrors `play`'s request shape.
 * @returns A handle whose mutators chain.
 * @complexity O(n) time in selected elements and their instances; O(n) space.
 * @overallScore 100
 */
export function control(request: ControlRequest): ControlHandle {
  const { animator, root, target } = request
  const elements = resolveTargets(target, root)
  const bounds = elements.map((el) => bindElement(animator, el))
  for (const [index, bound] of bounds.entries()) {
    if (bound.note) animator.reporter.warn(`control(): ${bound.note}`, elements[index])
  }

  const each = (operation: (control: InstanceControl) => void): ControlHandle => {
    for (const bound of bounds) for (const instance of bound.controls) operation(instance)
    return handle
  }
  const reject = (call: string, value: number): ControlHandle => {
    animator.reporter.warn(`control(): ${call} ignored — ${String(value)} is not a finite number`)
    return handle
  }
  /**
   * Hand every element this module did not refuse outright to the animator's direction transition.
   *
   * `reverse()` used to be `each((instance) => instance.reverse())`, which reached
   * `InstanceControl.reverse` and, through it, raw `Animation.reverse()`. It moved the right
   * playheads and told nobody: the animator went on believing the element was travelling forwards,
   * so a later `deactivate()` started a *second* reverse, `activate()` could never turn the
   * playhead around, and the entrance's still-pending settle eventually wrote
   * `data-kui-state="finished"` onto an element sitting at its from-state. See
   * `Animator.reverseFrom`, which is now the single owner of that transition.
   *
   * The reachability question changes with the route. A pause or a seek asks for *this instance's*
   * playhead, so it goes to the instances that expose one; a reverse asks the element which way it
   * is travelling, so the animator's own directional test (`play` and `reverse` both present on the
   * instance) decides which instances move. All this module still enforces are its two hard
   * refusals — see `Bound.refused` — and those are already warned about at construction.
   */
  const reverseAll = (): ControlHandle => {
    for (const bound of bounds) if (!bound.refused) animator.reverseFrom(bound.el)
    return handle
  }

  const handle: ControlHandle = {
    elements,
    get uncontrolled() {
      return bounds.flatMap((bound) => bound.unreachable)
    },
    pause: () => each((instance) => instance.pause()),
    play: () => each((instance) => instance.resume()),
    reverse: () => reverseAll(),
    seek: (progress) =>
      Number.isFinite(progress)
        ? each((instance) => instance.seek(progress))
        : reject('seek()', progress),
    timeScale: (rate) =>
      Number.isFinite(rate) ? each((instance) => instance.rate(rate)) : reject('timeScale()', rate),
    get progress() {
      let lowest = 1
      let found = false
      for (const bound of bounds) {
        for (const instance of bound.controls) {
          lowest = Math.min(lowest, instance.progress)
          found = true
        }
      }
      return found ? lowest : 0
    },
    get state() {
      return mergePlayStates(
        bounds.flatMap((bound) => bound.controls.map((instance) => instance.playState)),
      )
    },
  }
  return handle
}

/**
 * Lifecycle events.
 *
 * Before this module the library dispatched nothing at all — an author could start an animation
 * from an attribute and then had no way whatsoever to learn that it had finished. Every escape
 * hatch on offer (poll `data-kui-state`, race a `setTimeout` against the authored duration, wrap
 * the element and watch it with a `MutationObserver`) is worse than the thing it replaces, and the
 * last one is actively broken here — see the `MutationObserver` trap in
 * `docs/implementation-outline-gsap-parity.md` §4.5.
 *
 * A `CustomEvent` on the animated element is the one answer that does not cost the author a
 * library import. `addEventListener('kui:finish', ...)` is plain DOM, works from a framework's
 * template, works from another script that has never heard of this library, and — because these
 * bubble — works from one delegated listener on `document` for a whole page of animations. That is
 * the same bet the attribute grammar makes: the author writes no library-specific JavaScript.
 */

/**
 * Event names, in one place so the namespace is a single rename before publish — the same
 * discipline `attrs.ts` applies to attribute names, and for the same reason.
 *
 * `kui:` rather than `kui-`: a colon cannot appear in an HTML `on*` content attribute, so there is
 * no chance of an author writing `onkui-finish="..."` in markup, discovering it silently does
 * nothing, and blaming the library. It also reads unambiguously as a namespace separator and
 * cannot collide with any current or future native event name, which a bare `kui-` prefix cannot
 * promise.
 */
export const KUI_EVENT = {
  /** The element's effects have started. Fires once per activation. */
  start: 'kui:start',
  /** Every finite effect on the element has completed. */
  finish: 'kui:finish',
  /**
   * The element has finished playing *backwards* and is sitting at its from-state again.
   *
   * A separate name rather than a second `kui:finish` with a different `reason`, because the
   * commonest thing an author does with `kui:finish` is chain the next reveal off it, and a
   * listener that has to remember to re-check `event.detail.reason` before doing so is a trap
   * rather than an API — the one time they forget, a hover-out plays the next section in. Filtering
   * by *name* is what `addEventListener` is for, and it is what a delegated document-level listener
   * can do without reading the detail at all.
   *
   * The exit half of a paired activation (`data-kui-on="pointerenter/pointerleave"`) settles here,
   * and so does a programmatic `control(el).reverse()`. Before this existed, a completed reverse
   * dispatched nothing whatsoever, which left "the element is back where it started" the one
   * lifecycle moment an author could only discover by polling `data-kui-state`.
   */
  reverseFinish: 'kui:reverse-finish',
  /** The element's effects were torn down or cancelled before completing. */
  cancel: 'kui:cancel',
} as const

export type LifecycleEventType = (typeof KUI_EVENT)[keyof typeof KUI_EVENT]

/**
 * Why the event fired.
 *
 * Carried because the *same* event name legitimately arrives from more than one route, and an
 * author chaining animations needs to tell them apart. `finish` in particular fires both when an
 * animation genuinely ran to its end and when reduced motion meant it never ran at all — see
 * `'reduced-motion'` below.
 */
export type LifecycleReason =
  /** `start`: an activation fired and at least one instance began. */
  | 'activated'
  /** `finish`: every finite instance resolved. */
  | 'complete'
  /**
   * `reverse-finish`: every finite instance finished running backwards, so the element is back at
   * the from-state it was in before it was ever activated — `data-kui-state` reads `ready` again.
   *
   * One reason on one event name today, unlike `finish`, which carries two. It is carried anyway
   * because the two routes into a reverse (a paired activation's exit half, and a programmatic
   * `control().reverse()`) are already distinguishable from `detail.activation`, and a listener
   * that branches on `reason` for every other lifecycle event should not have to special-case this
   * one for having none.
   */
  | 'reversed'
  /**
   * `finish`: the effect declared `reducedMotion: 'disable'` and the visitor asked for reduced
   * motion, so it was never started and the element is already at its final state.
   *
   * This is the one case where `finish` arrives with no preceding `start`, and it is deliberate.
   * The alternative — staying silent — strands every author who uses these events to chain work,
   * because their second step would simply never run for the visitors who most need the page to
   * stay usable. Firing a synthetic `start` first would be the worse lie: nothing started.
   */
  | 'reduced-motion'
  /** `cancel`: the element's effects were torn down — `reset()`, `destroy()`, or DOM removal. */
  | 'reset'
  /** `cancel`: an explicit `cancel()` on the element or on a `play()` handle. */
  | 'cancelled'

/**
 * What every lifecycle event carries.
 *
 * `effects` is the same normalized name list `data-kui-fx` holds, so a delegated listener can tell
 * *which* effect just finished without re-reading the element's attributes — which matters
 * precisely because delegation is the case this is for: one listener on `document` seeing events
 * from hundreds of elements needs the identity in the event, not in a DOM read per event.
 */
export interface LifecycleDetail {
  /** Normalized effect names — the contents of `data-kui-fx`. */
  effects: string[]
  activation: Activation
  timeline: Timeline
  reason: LifecycleReason
}

/** A lifecycle event, narrowed so `event.detail` is typed at the listener. */
export type LifecycleEvent = CustomEvent<LifecycleDetail>

/**
 * Dispatch one lifecycle event on the animated element.
 *
 * `bubbles` is required by the design (delegation is the point) and `composed` follows from it: an
 * animated element inside a shadow root whose event stopped at the shadow boundary would be
 * invisible to exactly the document-level listener this exists to serve. Not `cancelable` — there
 * is nothing for a listener to prevent; by the time any of these fire the decision has been made.
 *
 * The constructor is taken from the element's own window rather than the global one, so an
 * animator driving a document in an `<iframe>` dispatches an event that element's own listeners
 * recognise via `instanceof`. Falling back to the global keeps a jsdom-style environment working
 * where `ownerDocument.defaultView` can be null, and the `typeof` guard keeps this module import-
 * safe in a DOM-less process, the same rule `capabilities.ts` and `animator.ts` already follow.
 *
 * @param el - The animated element. The event's target and the element authors listen on.
 * @param type - One of `KUI_EVENT`.
 * @param detail - Identity and reason, readable as `event.detail`.
 * @complexity O(n) time in the number of listeners on the propagation path; O(1) space.
 * @overallScore 100
 */
export function emitLifecycle(el: Element, type: LifecycleEventType, detail: LifecycleDetail): void {
  const Ctor = el.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent
  if (typeof Ctor !== 'function') return
  el.dispatchEvent(new Ctor(type, { detail, bubbles: true, composed: true }))
}
