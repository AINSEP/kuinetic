import { beforeEach, describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler, ScrollSubscriber } from '../src/core/scroll-scheduler.js'
import { progressFrom } from '../src/effects/scroll-mechanics/tracker.js'
import { createRegistry } from '../src/effects/index.js'

/**
 * Scroll mechanics under test with a fake scheduler and a fake measurer.
 *
 * Real scrolling is not available in jsdom and would be non-deterministic anywhere else, so the
 * scheduler is driven directly. This is exactly what the injected scheduler was added for.
 */

const CAPS: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: false,
  intersectionObserver: true,
  reducedMotion: false,
}

interface FakeScheduler extends ScrollScheduler {
  /** Deliver a frame to every subscriber. */
  emit(scrollTop: number, epoch?: number): void
  subscriberCount(): number
}

function fakeScheduler(): FakeScheduler {
  const subscribers = new Set<ScrollSubscriber>()
  return {
    subscribe(_root: ScrollRoot, onFrame: ScrollSubscriber) {
      subscribers.add(onFrame)
      return () => subscribers.delete(onFrame)
    },
    invalidate() {},
    rootCount: () => (subscribers.size > 0 ? 1 : 0),
    destroy: () => subscribers.clear(),
    emit(scrollTop, epoch = 0) {
      for (const subscriber of [...subscribers]) {
        subscriber({
          metrics: { scrollTop, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800 },
          epoch,
        })
      }
    },
    subscriberCount: () => subscribers.size,
  }
}

const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({ scrollTop: 0, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800 }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

let scheduler: FakeScheduler
let reporter: CollectingReporter

/**
 * Force `getBoundingClientRect` to a known value. jsdom returns all-zero rects, which would make
 * every progress calculation trivially 0.
 */
function stubRect(el: Element, top: number, height = 400): void {
  el.getBoundingClientRect = () =>
    ({ top, left: 0, width: 200, height, bottom: top + height, right: 200 }) as DOMRect
}

function build(html: string) {
  document.body.innerHTML = html
  scheduler = fakeScheduler()
  reporter = collectingReporter()
  const animator = new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: CAPS,
    reporter,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler,
    rootResolver: () => fakeRoot,
  })
  return animator
}

const el = (selector = '[data-dsg]'): HTMLElement =>
  document.body.querySelector(selector) as HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('progressFrom', () => {
  it('is 0 before the element reaches the top of the scrollport', () => {
    expect(progressFrom(100, 400)).toBe(0)
  })

  it('is a ratio while travelling', () => {
    expect(progressFrom(-200, 400)).toBeCloseTo(0.5)
  })

  it('clamps to 1 past the end', () => {
    expect(progressFrom(-900, 400)).toBe(1)
  })

  it('returns 0 for a degenerate span rather than dividing by zero', () => {
    // An element measured before layout settles reports height 0; Infinity here would poison
    // every downstream style write.
    expect(progressFrom(-100, 0)).toBe(0)
    expect(progressFrom(-100, -5)).toBe(0)
  })
})

/** Pin measures its containing block, so that is what the stub must describe. */
const stubContainer = (top: number, height = 400): void => stubRect(document.body, top, height)

describe('pin', () => {
  it('makes the element sticky and subscribes to the scheduler', () => {
    const animator = build('<div data-dsg="pin-section"></div>')
    stubContainer(0)
    animator.start()

    expect(el().style.position).toBe('sticky')
    expect(scheduler.subscriberCount()).toBe(1)
  })

  it('publishes progress as a custom property', () => {
    const animator = build('<div data-dsg="pin-until distance:400px"></div>')
    stubContainer(0)
    animator.start()

    scheduler.emit(0)
    expect(el().style.getPropertyValue('--dsg-progress')).toBe('0.0000')

    stubContainer(-200)
    scheduler.emit(200, 1)
    expect(Number(el().style.getPropertyValue('--dsg-progress'))).toBeCloseTo(0.5)
  })

  it('marks the pinned window with an attribute', () => {
    const animator = build('<div data-dsg="pin-until distance:400px"></div>')
    stubContainer(-200)
    animator.start()
    scheduler.emit(200)
    expect(el().getAttribute('data-dsg-pinned')).toBe('true')
  })

  it('adds a spacer so a pin longer than its container still holds', () => {
    // Sticky silently does nothing once its containing block scrolls away; the spacer is the fix.
    const animator = build('<div data-dsg="pin-section distance:600px"></div>')
    stubContainer(0)
    animator.start()

    const spacer = document.querySelector('[data-dsg-spacer]') as HTMLElement
    expect(spacer).not.toBeNull()
    expect(spacer.style.height).toBe('600px')
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
  })

  it('omits the spacer when not requested', () => {
    const animator = build('<div data-dsg="pin-until"></div>')
    stubContainer(0)
    animator.start()
    expect(document.querySelector('[data-dsg-spacer]')).toBeNull()
  })

  it('restores the element and removes the spacer on destroy', () => {
    const animator = build('<div data-dsg="pin-section"></div>')
    stubContainer(0)
    animator.start()
    animator.destroy()

    expect(el().style.position).toBe('')
    expect(document.querySelector('[data-dsg-spacer]')).toBeNull()
    expect(el().hasAttribute('data-dsg-pinned')).toBe(false)
    expect(scheduler.subscriberCount()).toBe(0)
  })
})

describe('scroll-progress', () => {
  it('publishes a discrete step index for scrollytelling', () => {
    const animator = build('<div data-dsg="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), 0)
    animator.start()

    scheduler.emit(0)
    expect(el().getAttribute('data-dsg-step')).toBe('0')

    stubRect(el(), -300)
    scheduler.emit(300, 1)
    expect(el().getAttribute('data-dsg-step')).toBe('3')
  })

  it('clamps the final step rather than going one past the end', () => {
    const animator = build('<div data-dsg="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), -400)
    animator.start()
    scheduler.emit(400)
    expect(el().getAttribute('data-dsg-step')).toBe('3')
  })

  it('omits the step attribute when steps is 0', () => {
    const animator = build('<div data-dsg="scroll-progress"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    expect(el().hasAttribute('data-dsg-step')).toBe(false)
  })
})

describe('horizontal-scroll', () => {
  it('translates the track in proportion to progress', () => {
    const animator = build('<div data-dsg="horizontal-scroll distance:400px travel:1000px"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().style.translate).toBe('-500px 0')
  })

  it('clears the translation on destroy', () => {
    const animator = build('<div data-dsg="horizontal-scroll travel:100px"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    animator.destroy()
    expect(el().style.translate).toBe('')
  })
})

describe('scroll-snap', () => {
  it('applies native snapping to the container and its children', () => {
    const animator = build('<ul data-dsg="scroll-snap-x"><li></li><li></li></ul>')
    animator.start()

    expect(el('ul').style.scrollSnapType).toContain('x')
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items.every((item) => item.style.scrollSnapAlign === 'start')).toBe(true)
  })
})

describe('registration and parameters', () => {
  it('registers every v2 scroll name', () => {
    const registry = createRegistry()
    for (const name of [
      'pin-section',
      'pin-until',
      'pin-spacer',
      'stacking-cards',
      'scroll-progress',
      'scrollytelling-step',
      'horizontal-scroll',
      'sequence-scrub',
      'video-scrub',
      'scroll-spy',
      'scroll-snap-x',
      'scroll-snap-y',
    ]) {
      expect(registry.has(name), name).toBe(true)
    }
  })

  it('rejects a dangerous parameter before it reaches the primitive', () => {
    const animator = build('<div data-dsg="pin-until distance:url(http://evil.test)"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(reporter.messages.join()).toContain('disallowed CSS syntax')
  })

  it('never writes a text parameter into the element style', () => {
    const animator = build('<div data-dsg="scroll-spy target:nav a"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(el().style.getPropertyValue('--dsg-target')).toBe('')
  })
})
