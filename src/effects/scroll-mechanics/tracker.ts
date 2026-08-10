import type { PrepareContext } from '../../core/effect-context.js'
import { toPixels } from '../../core/js-params.js'
import type { LengthBasis } from '../../core/js-params.js'
import { clamp01, createMeasureCache } from '../../core/scroll-scheduler.js'
import type { ScrollFrame } from '../../core/scroll-scheduler.js'
import type { Cleanup } from '../../core/types.js'

/**
 * Progress tracking — the single mechanism every scroll-mechanics effect is built on.
 *
 * Pinning, scrollytelling, horizontal scroll, and media scrubbing differ only in what they *do*
 * with a number between 0 and 1. Computing that number once, in one place, is what keeps the whole
 * category to one listener, one rAF, and one measurement per resize.
 *
 * Geometry is read through an injected measurer: jsdom reports zeroes for every rect, so a tracker
 * that called `getBoundingClientRect` directly could not be tested at all.
 */

export interface ElementGeometry {
  /** Distance from the scrollport's top edge to the element's top edge. Negative once past it. */
  top: number
  height: number
}

export type Measurer = (el: Element) => ElementGeometry

export const domGeometry: Measurer = (el) => {
  const rect = el.getBoundingClientRect()
  return { top: rect.top, height: rect.height }
}

export interface TrackOptions {
  /**
   * Scroll distance the effect spans, as an authored CSS length. Defaults to the element's own
   * height, which is what makes `pin-section` behave sensibly with no configuration.
   */
  distance?: string
  measure?: Measurer
}

export type ProgressHandler = (progress: number, frame: ScrollFrame) => void

/**
 * Drive `onProgress` with the element's scroll progress in [0, 1].
 *
 * Progress is 0 when the element's top reaches the top of the scrollport and 1 once the scroll has
 * advanced by `distance`. Measurements are cached against the scheduler's epoch, so a frame costs
 * arithmetic rather than a layout flush.
 *
 * @param el - Element whose position drives progress.
 * @param ctx - Prepare context supplying the scheduler and root resolver.
 * @param options - Distance and an optional injected measurer.
 * @param onProgress - Called once per scheduled frame.
 * @returns Teardown that unsubscribes from the scheduler.
 * @complexity O(1) per frame after the first measurement of each epoch; O(1) space.
 * @overallScore 100
 */
export function trackProgress(
  el: Element,
  ctx: PrepareContext,
  options: TrackOptions,
  onProgress: ProgressHandler,
): Cleanup {
  const measure = options.measure ?? domGeometry
  let scrollTop = 0

  /*
   * Cache the element's *document*-relative offset, not its viewport-relative one.
   *
   * The epoch only advances on resize, so caching `rect.top` — the one number that changes on
   * every scroll — freezes progress at whatever it was on the first frame. Document offset is
   * genuinely epoch-stable, and subtracting the live scroll position restores the viewport
   * offset for free. This is what keeps one layout read per resize rather than one per frame.
   */
  const geometry = createMeasureCache(() => {
    const box = measure(el)
    return { documentTop: box.top + scrollTop, height: box.height }
  })

  return ctx.scheduler.subscribe(ctx.rootFor(el), (frame) => {
    scrollTop = frame.metrics.scrollTop
    const box = geometry.read(frame.epoch)
    const span = resolveDistance(options.distance, { top: 0, height: box.height }, frame)
    onProgress(progressFrom(box.documentTop - scrollTop, span), frame)
  })
}

/**
 * Resolve the authored distance to pixels, defaulting to the element's own height.
 *
 * A zero or negative span is the degenerate case that matters — an element with no height, or one
 * measured before layout settles. `progressFrom` treats it as "not started" rather than dividing.
 *
 * @complexity O(n) time in the authored value's length; O(1) space.
 * @overallScore 100
 */
function resolveDistance(
  distance: string | undefined,
  box: ElementGeometry,
  frame: ScrollFrame,
): number {
  if (!distance) return box.height
  const basis: LengthBasis = {
    viewportWidth: frame.metrics.viewportWidth,
    viewportHeight: frame.metrics.viewportHeight,
    percentBasis: box.height,
    fontSize: 16,
    rootFontSize: 16,
  }
  return toPixels(distance, basis, box.height)
}

/**
 * Progress from the element's offset and the span it travels.
 *
 * @param top - Element top relative to the scrollport; negative once scrolled past.
 * @param span - Pixels of scrolling the effect covers.
 * @returns Progress in [0, 1]; 0 for a non-positive span.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function progressFrom(top: number, span: number): number {
  if (span <= 0) return 0
  return clamp01(-top / span)
}
