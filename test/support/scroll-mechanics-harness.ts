import { Animator } from '../../src/core/animator.js'
import type { Capabilities } from '../../src/core/capabilities.js'
import { createActivationBinder } from '../../src/core/activation.js'
import { collectingReporter } from '../../src/core/reporter.js'
import type { CollectingReporter } from '../../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler, ScrollSubscriber } from '../../src/core/scroll-scheduler.js'
import { createRegistry } from '../../src/effects/index.js'

/**
 * Shared scroll-mechanics test rig: a fake scheduler and a fake measurer.
 *
 * Real scrolling is not available in jsdom and would be non-deterministic anywhere else, so the
 * scheduler is driven directly. Extracted out of scroll-mechanics.test.ts (which every describe
 * block in that file depends on) so the file itself has room to grow test cases without crossing
 * ESLint's per-file line cap — `test/support/channel-properties.ts` is the existing precedent for
 * this pattern. Not `*.test.ts`, so vitest's `test/**\/*.test.ts` include never collects it as a
 * suite of its own; eslint's broader `test/**\/*.ts` block still lints it.
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

export interface FakeScheduler extends ScrollScheduler {
  /** Deliver a frame to every subscriber. */
  emit(scrollTop: number, epoch?: number): void
  subscriberCount(): number
}

export function fakeScheduler(): FakeScheduler {
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
          metrics: { scrollTop, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800, viewportTop: 0, viewportLeft: 0 },
          epoch,
        })
      }
    },
    subscriberCount: () => subscribers.size,
  }
}

export const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({ scrollTop: 0, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800, viewportTop: 0, viewportLeft: 0 }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

// Live bindings: `build` reassigns these on every call, and importers read the current value
// through the module namespace rather than a snapshot taken at import time.
export let scheduler: FakeScheduler
export let reporter: CollectingReporter

/**
 * Force `getBoundingClientRect` to a known value. jsdom returns all-zero rects, which would make
 * every progress calculation trivially 0.
 */
export function stubRect(el: Element, top: number, height = 400): void {
  el.getBoundingClientRect = () =>
    ({ top, left: 0, width: 200, height, bottom: top + height, right: 200 }) as DOMRect
}

export function build(html: string) {
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

export const el = (selector = '[data-kui]'): HTMLElement =>
  document.body.querySelector(selector) as HTMLElement
