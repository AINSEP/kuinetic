import type { Cleanup } from './types.js'

/**
 * FLIP — First, Last, Invert, Play.
 *
 * Measure where things are, let the layout change however it likes, measure again, then apply the
 * inverse transform and animate it away. The layout change itself is never animated, which is why
 * this works for reordering, filtering, sorting, and expanding: none of those are expressible as
 * keyframes, but all of them are expressible as two measurements.
 *
 * Measurement and animation are both injected. Reading `getBoundingClientRect` directly would make
 * every consumer untestable without real layout, and jsdom reports zeroes for everything.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface FlipSnapshot {
  boxes: Map<Element, Box>
}

export interface FlipOptions {
  durationMs?: number
  easing?: string
  /** Animate width/height differences as a scale. Off for elements with visible borders. */
  scale?: boolean
}

export interface FlipRun {
  /** Elements that actually moved. Unmoved elements are skipped, not animated to identity. */
  moved: Element[]
  finished: Promise<void>
  cancel(): void
}

export interface FlipDeps {
  measure(el: Element): Box
  /** Returns `null` where the Web Animations API is unavailable; the move then applies instantly. */
  animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null
}

/** Sub-pixel differences are layout noise, not motion. Animating them wastes a compositor layer. */
const EPSILON = 0.5

export interface FlipEngine {
  snapshot(elements: Iterable<Element>): FlipSnapshot
  play(before: FlipSnapshot, elements: Iterable<Element>, options?: FlipOptions): FlipRun
}

/**
 * Read an element's box from real layout.
 *
 * @complexity O(1) time, but forces layout — call once per batch, never per element in a loop.
 * @overallScore 100
 */
export function domMeasure(el: Element): Box {
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function domAnimate(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  const animate = (el as Element & { animate?: Element['animate'] }).animate
  return typeof animate === 'function' ? animate.call(el, keyframes, options) : null
}

/**
 * Create a FLIP engine.
 *
 * @param deps - Measurement and animation sources; both default to the DOM implementations.
 * @returns An engine exposing `snapshot` and `play`.
 * @complexity O(n) per call in the number of elements; O(n) space for the snapshot.
 * @overallScore 100
 */
export function createFlipEngine(deps: Partial<FlipDeps> = {}): FlipEngine {
  const measure = deps.measure ?? domMeasure
  const animate = deps.animate ?? domAnimate

  return {
    snapshot(elements) {
      const boxes = new Map<Element, Box>()
      for (const el of elements) boxes.set(el, measure(el))
      return { boxes }
    },

    play(before, elements, options = {}) {
      const deltas = collectDeltas(before, elements, measure, options.scale ?? false)
      if (deltas.length === 0) {
        return { moved: [], finished: Promise.resolve(), cancel: () => {} }
      }
      return runDeltas(deltas, animate, options)
    },
  }
}

interface Delta {
  el: Element
  dx: number
  dy: number
  sx: number
  sy: number
}

/**
 * Compute the inverse transform for every element that actually moved.
 *
 * All measurement happens in one pass before any write, so the batch costs a single layout rather
 * than one per element.
 *
 * @complexity O(n) time and space in the number of elements.
 * @overallScore 100
 */
function collectDeltas(
  before: FlipSnapshot,
  elements: Iterable<Element>,
  measure: (el: Element) => Box,
  scale: boolean,
): Delta[] {
  const deltas: Delta[] = []

  for (const el of elements) {
    const first = before.boxes.get(el)
    if (!first) continue
    const last = measure(el)
    const delta = deltaFor(el, first, last, scale)
    if (delta) deltas.push(delta)
  }
  return deltas
}

function deltaFor(el: Element, first: Box, last: Box, scale: boolean): Delta | null {
  const dx = first.x - last.x
  const dy = first.y - last.y
  const sx = scale && last.width > 0 ? first.width / last.width : 1
  const sy = scale && last.height > 0 ? first.height / last.height : 1

  const still =
    Math.abs(dx) < EPSILON &&
    Math.abs(dy) < EPSILON &&
    Math.abs(sx - 1) < 0.001 &&
    Math.abs(sy - 1) < 0.001
  return still ? null : { el, dx, dy, sx, sy }
}

/**
 * Apply each inverse transform and animate it back to identity.
 *
 * Uses the individual `translate`/`scale` properties rather than the `transform` shorthand so a
 * FLIP move composes with effects on other channels instead of clobbering them.
 *
 * @complexity O(n) time in moved elements; O(n) space.
 * @overallScore 100
 */
function runDeltas(deltas: Delta[], animate: FlipDeps['animate'], options: FlipOptions): FlipRun {
  const duration = options.durationMs ?? 400
  const easing = options.easing ?? 'cubic-bezier(0.2, 0, 0, 1)'
  const animations: Animation[] = []

  for (const { el, dx, dy, sx, sy } of deltas) {
    const animation = animate(
      el,
      [
        { translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` },
        { translate: '0px 0px', scale: '1 1' },
      ],
      { duration, easing, fill: 'none' },
    )
    if (animation) animations.push(animation)
  }

  const finished = Promise.all(
    animations.map((animation) => animation.finished.catch(() => undefined)),
  ).then(() => undefined)

  return {
    moved: deltas.map((delta) => delta.el),
    finished,
    cancel() {
      for (const animation of animations) animation.cancel()
    },
  }
}

/**
 * Watch a container and FLIP its children whenever its child list changes.
 *
 * This is what turns one engine into the whole layout category: reorder, filter, sort, shuffle,
 * and grid↔list are all "the children moved", and none of them need to know why.
 *
 * @param container - Element whose children are animated.
 * @param engine - FLIP engine to use.
 * @param options - Timing and scaling.
 * @param observe - MutationObserver factory, injected for tests.
 * @returns Teardown that disconnects the observer.
 * @complexity O(n) per mutation batch in the number of children.
 * @overallScore 100
 */
export function observeLayout(
  container: Element,
  engine: FlipEngine,
  options: FlipOptions,
  observe: (callback: () => void) => Cleanup,
): Cleanup {
  let before = engine.snapshot(container.children)

  const cleanup = observe(() => {
    engine.play(before, container.children, options)
    before = engine.snapshot(container.children)
  })

  return cleanup
}

/**
 * MutationObserver-backed layout watcher.
 *
 * @complexity O(1) to install; callback cost is the caller's.
 * @overallScore 100
 */
export function mutationWatcher(container: Element): (callback: () => void) => Cleanup {
  return (callback) => {
    if (typeof MutationObserver === 'undefined') return () => {}
    const observer = new MutationObserver(callback)
    // `subtree` is required for the `attributes`/`attributeFilter` half of this config to reach
    // children at all — a filter effect toggles `hidden` on each child `<figure>`, never on the
    // container itself, so without `subtree` those mutations were invisible to this observer and
    // no FLIP cycle ever ran. `flip-reorder`'s direct `childList` mutations on the container
    // already worked without it, which is why only the filter/toggle case went unnoticed.
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })
    return () => observer.disconnect()
  }
}
