import type { Cleanup } from '../core/types.js'
import type { Direction } from '../core/gesture.js'

/**
 * How a swipe reaches a deck it does not sit on.
 *
 * A swipe either shares the deck's element (`data-kui="swipe-y, carousel"` — the two write
 * different attributes, so the channel check lets them compose) or sits on a wrapper around it.
 * Either way the last step — "a left flick means next" — was left to every page, as a
 * `MutationObserver` on `data-kui-swipe` that each one wrote slightly differently.
 *
 * ## Why an event from the swipe, heard by the deck
 *
 * The two alternatives both put the knowledge in the wrong place:
 *
 * - **The swipe steps the deck.** `swipeable` would have to find decks below it and call into
 *   their index, which makes the gesture primitive know what a carousel is, and makes every future
 *   stepper (a tab set, a gallery) an edit to the gesture module.
 * - **A deck parameter naming its swipe** (`swipe:'.shell'`). A second selector to keep in sync
 *   with markup that already says it — the deck is *inside* the swipe — and a deck and its wrapper
 *   cannot drift apart if nothing names the other.
 *
 * An event inverts it cleanly: the swipe announces "left, here" and knows nothing about decks; a
 * deck listens and decides whether the swipe was about it. It bubbles, so a page can still hear it
 * without a `MutationObserver`, and the attribute stays exactly as it was for CSS.
 *
 * The deck listens on its document rather than on an ancestor because it cannot know which ancestor
 * will be the swipe, and because the two start in either order — a listener on the document is
 * already there whichever element's effect prepares first.
 */

/** The event a swipe dispatches on its own element. `detail.direction` is the flick. */
export const SWIPE_EVENT = 'kui:swipe'

const DIRECTIONS: ReadonlySet<string> = new Set<Direction>(['left', 'right', 'up', 'down'])

/** The payload of {@link SWIPE_EVENT}. */
export interface SwipeDetail {
  direction: Direction
}

/**
 * Announce a recognised swipe from `el`.
 *
 * Built with the element's own realm's `CustomEvent`, so a deck in an iframe hears a swipe
 * dispatched there.
 *
 * @complexity O(depth) for the bubble; O(1) space.
 */
export function announceSwipe(win: Window, el: Element, direction: Direction): void {
  const Ctor = (win as Window & { CustomEvent: typeof CustomEvent }).CustomEvent
  el.dispatchEvent(new Ctor<SwipeDetail>(SWIPE_EVENT, { bubbles: true, detail: { direction } }))
}

/**
 * Which way a swipe moves a deck: the content follows the finger, as on any native pager.
 *
 * A flick left or up drags the next slide in (`1`); right or down brings the previous one back
 * (`-1`). Pure and exported so the mapping is assertable without a gesture.
 *
 * @complexity O(1) time and space.
 */
export function swipeStep(direction: Direction): 1 | -1 {
  return direction === 'left' || direction === 'up' ? 1 : -1
}

/**
 * Whether a swipe announced by `source` is about the deck `el`.
 *
 * It is when the swipe is on the deck itself, or contains it with no other deck between them. The
 * self case is checked first because the walk below starts at the deck's parent and so would never
 * meet a swipe on the deck: it would climb to the root and refuse at any outer deck. The second half is
 * what keeps a swipe on a page of decks-within-decks from stepping every level at once: an inner
 * deck (a gallery inside one slide of an outer one) is reached by its outer deck first, and the
 * outer deck is the one the wrapper was put around. A deck is recognised by `data-kui-step`, the
 * attribute every stepper in this library publishes on its own host.
 *
 * @complexity O(d) in the depth between the deck and the swipe; O(1) space.
 */
export function swipeReaches(source: Element, el: Element): boolean {
  if (source === el) return true
  if (!source.contains(el)) return false
  for (let node = el.parentElement; node && node !== source; node = node.parentElement) {
    if (node.hasAttribute('data-kui-step')) return false
  }
  return true
}

/**
 * Step a deck whenever a swipe around it is announced.
 *
 * @param step - Called with `1` for next and `-1` for previous.
 * @returns Removes the listener.
 * @complexity O(1) to install; O(d) per swipe (see {@link swipeReaches}).
 */
export function stepOnSwipe(doc: Document, el: Element, step: (direction: 1 | -1) => void): Cleanup {
  const onSwipe = (event: Event): void => {
    // Anything else dispatching the same name (a page's own synthetic event, or one fired at the
    // document itself) is ignored unless it carries a direction this library would have written,
    // from an element.
    const direction = (event as CustomEvent<Partial<SwipeDetail> | null>).detail?.direction
    const source = event.target as Node
    if (!direction || !DIRECTIONS.has(direction) || source.nodeType !== 1) return
    if (swipeReaches(source as Element, el)) step(swipeStep(direction))
  }
  doc.addEventListener(SWIPE_EVENT, onSwipe)
  return () => doc.removeEventListener(SWIPE_EVENT, onSwipe)
}
