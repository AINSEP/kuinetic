import type { Cleanup } from './types.js'

/** The ancestor marker a pause control writes on the container whose subtree it pauses. */
export const PAUSE_SCOPE_ATTR = 'data-kui-paused'

/** Dispatched (bubbling) whenever a scope's paused state changes, so schedulers can re-evaluate. */
export const PAUSE_SCOPE_EVENT = 'kui:pausescope'

/**
 * Whether `el`, or any ancestor, sits inside a paused scope.
 *
 * Mirrors `timeScaleOf`: the state is an attribute on an ancestor rather than a registry, so a
 * scheduler needs no handle on whatever primitive wrote it and nothing here has to be torn down.
 *
 * @complexity O(h) in ancestor depth; O(1) space.
 * @overallScore 100
 */
export function isPausedByScope(el: Element): boolean {
  return el.closest(`[${PAUSE_SCOPE_ATTR}]`) !== null
}

/**
 * Announce that a scope paused or resumed.
 *
 * Built with the document's own realm's `CustomEvent` (a scope in an iframe is heard by that
 * iframe's schedulers) and bubbled from `source` so a listener on the document sees it. Lives here
 * beside the event name so the writer and the readers cannot disagree on the shape.
 *
 * @complexity O(depth) for the bubble; O(1) space.
 * @overallScore 100
 */
export function announcePauseScope(doc: Document, source: Element): void {
  const Ctor =
    (doc.defaultView as (Window & { CustomEvent: typeof CustomEvent }) | null)?.CustomEvent ?? CustomEvent
  const target: EventTarget = source.isConnected ? source : doc
  target.dispatchEvent(new Ctor(PAUSE_SCOPE_EVENT, { bubbles: true }))
}

/**
 * Call `onChange` with `el`'s current scope-paused state whenever any scope announces a change.
 *
 * One listener on the document with a re-evaluation on every event, not a listener per scope: the
 * state is read fresh through `isPausedByScope`, so an event from an unrelated scope costs one
 * `closest` and reports an unchanged value, and the watcher never has to know which scope an
 * element belongs to (the same shape as the deck viewer's listener). The callback fires only when
 * the value differs from the last one it was given, so a scheduler can treat each call as an edge.
 *
 * @returns A cleanup that removes the listener.
 * @complexity O(1) to register; O(h) per announced event; O(1) space.
 * @overallScore 100
 */
export function watchPauseScope(
  el: Element,
  doc: Document,
  onChange: (paused: boolean) => void,
): Cleanup {
  let last = isPausedByScope(el)
  const listener = (): void => {
    const now = isPausedByScope(el)
    if (now === last) return
    last = now
    onChange(now)
  }
  doc.addEventListener(PAUSE_SCOPE_EVENT, listener)
  return () => doc.removeEventListener(PAUSE_SCOPE_EVENT, listener)
}
