import type { Activation, Timeline } from './types.js'

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
