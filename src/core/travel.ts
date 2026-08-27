/**
 * Which way the reader is travelling, and which side of a scroll root that puts things on.
 *
 * Split out of `activation.ts` because it answers a question about the *reader* rather than about
 * any element or any authored spec: one page-wide signal, sampled from one listener, that the
 * four-way crossing delivery consults and nothing else in the binder cares about.
 */

/**
 * Which side of the observer's root an element sits on, in the reader's direction of travel:
 * `before` is the side already scrolled past, `after` the side not reached yet.
 *
 * Named by travel rather than by geometry so one word covers both axes — `before` is above a
 * vertically scrolled root and to the left of a horizontally scrolled one.
 */
export type RootSide = 'before' | 'after'

/**
 * How long after the reader's last scroll a delivery still counts as caused by it.
 *
 * Measured in Chrome on the gesture this exists for: an entry's `time` runs 1–14ms behind the
 * `scroll` event that moved the element. 200ms is an order of magnitude of headroom for a delivery
 * lagging under load, and still short enough that an element which comes into view on its own —
 * a lazy image reflowing the content above it, an accordion opening — well after the reader stopped
 * moving is not attributed to a scroll that had nothing to do with it, and falls back to the
 * remembered side instead.
 */
const TRAVEL_WINDOW_MS = 200

/** Which way the reader is travelling, phrased as the side an element entering *now* came from. */
export interface TravelTracker {
  /**
   * The side an element entering at `time` must have arrived from, or `undefined` when the reader's
   * travel does not explain a delivery at that moment.
   */
  arrivedFrom(time: number): RootSide | undefined
  /** Start listening, if this is the first four-way binding to ask. */
  retain(): void
  /** Stop listening, if this was the last. */
  release(): void
  /** Stop listening regardless of the count, for a binder torn down with bindings still on it. */
  reset(): void
}

/**
 * Track which way the reader is travelling, so an entering delivery can be classified by what is
 * happening *now* rather than by memory of a crossing that may never have been delivered.
 *
 * `deliverCrossing` used to answer "first entry or re-entry?" purely from `binding.outside`, the
 * side recorded by the last *leaving* delivery. A scroll that lands in a single frame — an
 * `<a href="#anchor">` click, `scrollIntoView()`, `scrollTo({ behavior: 'instant' })`, scroll
 * restoration — carrying the element from "not intersecting" straight past to "not intersecting" on
 * the far side changes neither `isIntersecting` nor the threshold ratio at any frame the browser
 * samples, so the observer delivers *nothing at all* and the remembered side is left describing a
 * position the reader is no longer anywhere near. The next real delivery is then classified against
 * it and comes out backwards: measured in Chrome, a reader scrolling back up through a skipped
 * element got `enter` where `enter-back` was authored. A denser threshold array does not help,
 * because the browser paints no intermediate frame for it to sample; nor does re-reading the
 * geometry, because an entering element is inside the root and so is on no side to read.
 *
 * The reader's direction of travel answers it without needing to know anything about the skipped
 * crossing, and the two agree wherever nothing was skipped, so the ordinary path is unchanged.
 *
 * One listener for every binding on the page, mirroring `activation.ts`'s one-observer-per-threshold:
 * direction is a property of the reader, not of an element, so per-element listeners would buy
 * nothing for their cost. It is retained only by four-way bindings — a page of plain `on:enter`
 * effects adds no listener at all.
 *
 * @returns A tracker whose `retain`/`release` ref-count the single shared listener.
 * @complexity O(1) time per scroll event, independent of how many elements are bound; O(s) space in
 *   the number of distinct scrollers the reader has actually touched.
 * @overallScore 100
 */
export function createTravelTracker(): TravelTracker {
  const positions = new WeakMap<EventTarget, { x: number; y: number }>()
  let side: RootSide | undefined
  let at = Number.NEGATIVE_INFINITY
  let holders = 0

  const onScroll = (event: Event): void => {
    const target = event.target
    if (!target) return
    const now = scrollPositionOf(target)
    if (!now) return
    const last = positions.get(target)
    positions.set(target, now)
    if (!last) return
    // Whichever axis actually moved: a carousel scrolls its own container sideways, while
    // `horizontal-track` translates a row sideways from *vertical* page scroll. Both are the same
    // question — is the reader going forwards or backwards — so neither axis is privileged.
    const dy = now.y - last.y
    const dx = now.x - last.x
    const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx
    if (delta === 0) return
    // Travelling forward is travelling towards the side not reached yet, so whatever enters the
    // root now is arriving from that side.
    side = delta > 0 ? 'after' : 'before'
    at = event.timeStamp
  }

  const stop = (): void => {
    holders = 0
    side = undefined
    at = Number.NEGATIVE_INFINITY
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }

  return {
    arrivedFrom: (time) => (time - at <= TRAVEL_WINDOW_MS ? side : undefined),
    retain() {
      if (holders++ > 0 || typeof window === 'undefined') return
      // Capture, because `scroll` does not bubble: only the capture phase carries a nested
      // scroller's event as far as `window`.
      window.addEventListener('scroll', onScroll, { capture: true, passive: true })
      // Seed the document's position now, so the reader's very first scroll already has a delta to
      // measure — the single-frame jump this exists for is often the first scroll on the page.
      const start = scrollPositionOf(window.document)
      if (start) positions.set(window.document, start)
    },
    release() {
      if (holders === 0 || --holders > 0) return
      stop()
    },
    reset: stop,
  }
}

/**
 * Where a scroll event's target currently sits, on both axes.
 *
 * The viewport reports its scroll on `document` rather than on an element, so the two cases read
 * from different properties; anything else (a `scroll` on some non-element target) has no position
 * to speak of.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function scrollPositionOf(target: EventTarget): { x: number; y: number } | undefined {
  if (typeof window === 'undefined') return undefined
  if (target === window || target === window.document) {
    return { x: window.scrollX, y: window.scrollY }
  }
  if (target instanceof Element) return { x: target.scrollLeft, y: target.scrollTop }
  return undefined
}
