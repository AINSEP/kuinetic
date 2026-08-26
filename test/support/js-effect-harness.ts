import { createActivationBinder } from '../../src/core/activation.js'
import { Animator } from '../../src/core/animator.js'
import type { Capabilities } from '../../src/core/capabilities.js'
import type { Reporter } from '../../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../../src/core/scroll-scheduler.js'
import { createRegistry } from '../../src/effects/index.js'

/**
 * Shared rig for the JS-renderer timing suites.
 *
 * Both `js-effect-timing.test.ts` (does an authored timing value *arrive*) and
 * `js-effect-timing-parity.test.ts` (does a primitive that cannot act on one *say so*) drive the
 * real attribute → `parse` → `compile` → `Animator` pipeline rather than calling a primitive's
 * `prepare` directly, because every defect either file covers lived in the wiring between those
 * stages rather than inside any one primitive. That shared requirement is this module.
 *
 * Extracted when the second suite pushed the first past ESLint's per-file line cap;
 * `test/support/scroll-mechanics-harness.ts` is the existing precedent for the shape. Not
 * `*.test.ts`, so vitest never collects it as a suite of its own.
 */

/**
 * A deliberately un-capable browser: no native timelines, so nothing under test can quietly
 * depend on one, and `reducedMotion: false`, so the `reducedMotion: 'disable'` primitives these
 * suites cover still activate and can be observed at all.
 */
export const CAPS: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: true,
  scrollTimelineName: false,
  viewTransitions: false,
  intersectionObserver: true,
  reducedMotion: false,
}

/** A scheduler that never emits a frame: nothing here is testing scroll. */
export const idleScheduler: ScrollScheduler = {
  subscribe: () => () => {},
  invalidate: () => {},
  rootCount: () => 0,
  destroy: () => {},
}

export const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({
    scrollTop: 0,
    scrollLeft: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    viewportTop: 0,
    viewportLeft: 0,
  }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

/**
 * An animator over whatever is already in the document body.
 *
 * The variant a test needs when it has to stub geometry *before* `start()` — a deferred
 * primitive's setup runs at activation, which `start()` reaches synchronously for `on:load`.
 *
 * @complexity O(1) to construct; `start()` is O(n) in the elements scanned.
 * @overallScore 100
 */
export function animatorOverBody(reporter?: Reporter): Animator {
  return new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
  })
}

/**
 * Write markup into the body and build an animator over it. Does not start it — several tests
 * need to reach in between installation and activation.
 *
 * @complexity O(1) beyond the parse of `html`.
 * @overallScore 100
 */
export function build(html: string, reporter?: Reporter): Animator {
  document.body.innerHTML = html
  return animatorOverBody(reporter)
}

/** The one element under test. Every fixture in these suites carries exactly one `data-kui`. */
export const el = (): HTMLElement => document.body.querySelector('[data-kui]') as HTMLElement
