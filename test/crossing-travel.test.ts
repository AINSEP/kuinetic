// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import type { ActivationBinder, ActivationRequest } from '../src/core/activation.js'
import type { Crossing } from '../src/core/toggle-actions.js'
import { createTravelTracker } from '../src/core/travel.js'

/**
 * Classifying a crossing when the observer never delivered the one before it.
 *
 * Split from `toggle-actions.test.ts`, which owns the four crossings as delivered — the ordinary
 * case, where every crossing arrives and `binding.outside` is enough. Everything here is about the
 * case where one did not arrive, which is a question about the reader rather than about the
 * entries, and answered by `src/core/travel.ts`.
 */

describe('four-way crossing delivery after a crossing the observer never delivered', () => {
  /**
   * The gesture behind this whole block, measured in Chrome and not reproducible from the entries
   * alone: a scroll that lands in a single frame — an `<a href="#anchor">` click,
   * `scrollIntoView()`, `scrollTo({ behavior: 'instant' })`, scroll restoration — carries the
   * element from "not intersecting" straight past to "not intersecting" on the far side. Neither
   * `isIntersecting` nor the threshold ratio changes at any frame the browser samples, so the
   * observer delivers *no entry at all* for either crossing. There is nothing to simulate on the
   * observer here: the skip is modelled by simply not delivering, which is what the browser does.
   *
   * What is left behind is a `binding.outside` describing a position the reader is nowhere near,
   * and the next real delivery classified against it comes out backwards.
   */
  function harness(): {
    seen: Crossing[]
    deliver: (
      entry: { intersecting: boolean; top: number; bottom: number },
      time?: number,
    ) => void
    release: () => void
    binder: ActivationBinder
  } {
    let send: IntersectionObserverCallback = () => {}
    const binder = createActivationBinder({
      createObserver: (callback) => {
        send = callback
        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as IntersectionObserver
      },
    })
    const el = document.createElement('div')
    const seen: Crossing[] = []
    const release = binder.bind(el, 'enter/leave', {
      threshold: '0%',
      activate: () => seen.push('enter'),
      deactivate: () => seen.push('leave'),
      cross: (crossing) => seen.push(crossing),
    })
    return {
      seen,
      release,
      binder,
      deliver: (box, time) =>
        send(
          [
            {
              target: el,
              isIntersecting: box.intersecting,
              boundingClientRect: { top: box.top, bottom: box.bottom, left: 0, right: 100 },
              rootBounds: { top: 0, bottom: 800, left: 0, right: 1000 },
              time: time ?? performance.now(),
            },
          ] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
    }
  }

  /**
   * Move the page and fire the `scroll` the browser would fire, from the target it fires it on.
   *
   * `timeStamp` is stamped explicitly because jsdom does not put it in `performance.now()`'s
   * timebase the way a browser does (measured in Chrome: an entry's `time` runs 1–14ms behind the
   * `scroll` that caused it, on the same clock). Writing both clocks here is what lets the
   * staleness check below be about the window rather than about jsdom.
   */
  function scrollPageTo(y: number, at = performance.now()): void {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    const event = new Event('scroll')
    Object.defineProperty(event, 'timeStamp', { value: at })
    document.dispatchEvent(event)
  }

  const below = { intersecting: false, top: 900, bottom: 1000 }
  // Deliberately clear of both root edges: this is what the browser actually reports on arrival,
  // measured in Chrome — one frame of scroll is bigger than the element, so the box lands wholly
  // inside and its geometry says nothing at all about which side it came from.
  const inside = { intersecting: true, top: 100, bottom: 200 }

  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('reads a reader who scrolled back up as re-entering, though no leave was ever delivered', () => {
    const { seen, deliver } = harness()
    deliver(below)
    // The jump past the element, and back — the two crossings in between are the ones the observer
    // silently drops.
    scrollPageTo(6000)
    scrollPageTo(3000)
    deliver(inside)
    expect(seen).toEqual(['enter-back'])
  })

  it('without the reader’s direction, the same sequence comes out backwards', () => {
    // The discriminator for the test above: it is the travel that fixes it, not the delivery order.
    const { seen, deliver } = harness()
    deliver(below)
    deliver(inside)
    expect(seen).toEqual(['enter'])
  })

  it('still calls a genuine first arrival an enter when the reader is going forwards', () => {
    const { seen, deliver } = harness()
    deliver(below)
    scrollPageTo(3000)
    deliver(inside)
    expect(seen).toEqual(['enter'])
  })

  it('ignores travel too old to explain the delivery, and falls back to the remembered side', () => {
    // An element that comes into view on its own — a lazy image reflowing the content above it —
    // long after the reader stopped moving must not be attributed to that last scroll.
    const { seen, deliver } = harness()
    deliver(below)
    scrollPageTo(6000)
    scrollPageTo(3000)
    deliver(inside, performance.now() + 1000)
    expect(seen).toEqual(['enter'])
  })

  it('follows a nested scroller’s own axis, not just the page’s', () => {
    // `scroll` does not bubble, so only a capture-phase listener sees a nested scroller at all —
    // and a carousel scrolls sideways, which is the same question with a different axis.
    const { seen, deliver } = harness()
    deliver(below)
    const box = document.createElement('div')
    document.body.append(box)
    const scrollBoxTo = (x: number): void => {
      Object.defineProperty(box, 'scrollLeft', { value: x, configurable: true })
      const event = new Event('scroll', { bubbles: false })
      Object.defineProperty(event, 'timeStamp', { value: performance.now() })
      box.dispatchEvent(event)
    }
    scrollBoxTo(600)
    scrollBoxTo(300)
    deliver(inside)
    box.remove()
    expect(seen).toEqual(['enter-back'])
  })

  /**
   * Leaving with no side in the geometry either.
   *
   * The mirror of everything above: those are *arrivals* the geometry cannot classify, these are
   * *departures* it cannot. An element clipped away by an ancestor — `overflow: hidden`,
   * `content-visibility`, a `<details>` closing — stops intersecting without moving, so the entry
   * reports `isIntersecting: false` while the element's own border box still straddles the root
   * edge. `sideOf` answers `undefined` for that box, and the direction of travel is the only thing
   * left that knows whether the reader was heading down the page or back up it.
   */
  // The element has not moved; the ancestor stopped painting it. Its box still overlaps the root,
  // so it is on neither side of it.
  const clippedAway = { intersecting: false, top: 700, bottom: 900 }

  it('reads a clipped-away element as a forward leave when the reader is going down', () => {
    const { seen, deliver } = harness()
    deliver(below)
    deliver(inside)
    expect(seen).toEqual(['enter'])

    scrollPageTo(3000)
    deliver(clippedAway)
    // Travelling forwards, an element entering right now would arrive from `after`, so one
    // leaving is on its way to `before` — the side already scrolled past, which is a plain `leave`.
    expect(seen).toEqual(['enter', 'leave'])
  })

  it('reads the same disappearance as leave-back when the reader is going back up', () => {
    // The discriminator for the test above. Identical entries, opposite reader: the crossing an
    // author wired `actions:` to is decided entirely by the travel, because the box says nothing.
    const { seen, deliver } = harness()
    deliver(below)
    deliver(inside)
    scrollPageTo(6000)
    scrollPageTo(3000)
    deliver(clippedAway)
    expect(seen).toEqual(['enter', 'leave-back'])
  })

  it('calls it a plain leave when neither the box nor the reader says which way', () => {
    // No scroll at all — a `<details>` collapsing under a reader who is sitting still. There is
    // nothing to read, and `leave` is the answer that matches what the two-way binding would have
    // delivered before four crossings existed.
    const { seen, deliver } = harness()
    deliver(below)
    deliver(inside)
    deliver(clippedAway)
    expect(seen).toEqual(['enter', 'leave'])
  })
})

describe('the travel listener’s lifetime', () => {
  function countScrollListeners(run: (binder: ActivationBinder) => void): {
    added: number
    removed: number
  } {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const binder = createActivationBinder({
      createObserver: () =>
        ({
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        }) as unknown as IntersectionObserver,
    })
    run(binder)
    const scrolls = (spy: typeof add): number =>
      spy.mock.calls.filter(([type]) => type === 'scroll').length
    const counts = { added: scrolls(add), removed: scrolls(remove) }
    add.mockRestore()
    remove.mockRestore()
    return counts
  }

  const fourWay = (seen: Crossing[]): ActivationRequest => ({
    threshold: '0%',
    activate: () => {},
    deactivate: () => {},
    cross: (crossing) => seen.push(crossing),
  })

  it('adds nothing at all for a page of plain enter/leave effects', () => {
    const counts = countScrollListeners((binder) => {
      for (let i = 0; i < 5; i++) {
        binder.bind(document.createElement('div'), 'enter/leave', {
          threshold: '0%',
          activate: () => {},
          deactivate: () => {},
        })
      }
    })
    expect(counts.added).toBe(0)
  })

  it('adds one for any number of four-way bindings, and drops it with the last of them', () => {
    const seen: Crossing[] = []
    const counts = countScrollListeners((binder) => {
      const releases = [1, 2, 3].map(() =>
        binder.bind(document.createElement('div'), 'enter/leave', fourWay(seen)),
      )
      expect(releases).toHaveLength(3)
      for (const release of releases.slice(0, 2)) release()
      // Two of three gone: the reader is still being tracked for the third.
      releases[2]?.()
    })
    expect(counts).toEqual({ added: 1, removed: 1 })
  })

  it('drops it when the binder is destroyed with bindings still on it', () => {
    const seen: Crossing[] = []
    const counts = countScrollListeners((binder) => {
      binder.bind(document.createElement('div'), 'enter/leave', fourWay(seen))
      binder.destroy()
    })
    expect(counts).toEqual({ added: 1, removed: 1 })
  })
})

/**
 * The tracker directly, for the one thing the binder cannot put in front of it: what arrives on a
 * capture listener attached to `window`.
 *
 * That listener sees *every* `scroll` dispatched anywhere in the document, including ones from
 * targets this library knows nothing about and never asked for — a text node, a document from
 * another realm. `scrollPositionOf` answers `undefined` for all of them, and the tempting wrong
 * answer is to fall back to the *window's* position instead of declining: the call is already
 * reading `window.scrollX/scrollY` one branch above, so the fallback looks free. It is not. The
 * page moves for all sorts of reasons that never produce a `scroll` event on `document`, and
 * attributing that movement to whichever foreign event happened to arrive next manufactures a
 * direction of travel out of nothing — which then reclassifies the next real crossing.
 */
describe('createTravelTracker against foreign scroll events', () => {
  const scrollAt = (target: EventTarget, at: number): void => {
    const event = new Event('scroll')
    Object.defineProperty(event, 'timeStamp', { value: at })
    target.dispatchEvent(event)
  }

  const pageAt = (y: number): void => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  }

  it('reads no direction at all from a scroll whose target has no scroll position of its own', () => {
    pageAt(0)
    const tracker = createTravelTracker()
    tracker.retain()
    const text = document.body.appendChild(document.createTextNode('not a scroller'))

    try {
      scrollAt(text, 1000)
      // The page really did move between the two — the point being that it moved without saying so
      // on any target this tracker can read. Positions are remembered per target, so reading the
      // window's for a text node would make these two events look like 900px of forward travel.
      pageAt(900)
      scrollAt(text, 1001)
      expect(tracker.arrivedFrom(1001)).toBeUndefined()

      // Nothing was poisoned: the same movement, reported on a target that does have a position,
      // still reads as travel.
      scrollAt(document, 1002)
      expect(tracker.arrivedFrom(1002)).toBe('after')
    } finally {
      text.remove()
      tracker.reset()
      pageAt(0)
    }
  })
})
