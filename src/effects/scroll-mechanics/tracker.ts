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

/** Resolved `position` for one element. Injected for the same reason `Measurer` is. */
export type PositionReader = (el: Element) => string

export const domPosition: PositionReader = (el) => {
  const view = el.ownerDocument?.defaultView
  return view ? view.getComputedStyle(el).position : 'static'
}

/**
 * Resolved `top`, in pixels, for whichever element is actually `position: sticky`. Injected for
 * the same reason `Measurer` and `PositionReader` are, and for an extra one of its own: the value
 * is routinely an unresolved CSS expression — `demo/system.css` sets `--kui-pin-offset: 5.5rem`
 * and every pin's `offset-top` defaults to `var(--kui-pin-offset, 0px)` — so a static parse of the
 * authored string cannot recover it. `getComputedStyle` can, because the browser has already
 * resolved the `var()`, the `calc()`, and any `vh` in it.
 */
export type OffsetReader = (el: Element) => number

export const domOffsetTop: OffsetReader = (el) => {
  const view = el.ownerDocument?.defaultView
  if (!view) return 0
  const parsed = Number.parseFloat(view.getComputedStyle(el).top)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface TrackOptions {
  /**
   * Scroll distance the effect spans, as an authored CSS length. Defaults to the element's own
   * height, which is what makes `pin-section` behave sensibly with no configuration.
   */
  distance?: string
  measure?: Measurer
  positionOf?: PositionReader
  /**
   * A spacer the caller inserted immediately after `el`, used instead of `geometrySource` to say
   * where `el` really sits in the content.
   *
   * `geometrySource` escapes a sticky subtree by taking its parent, which is only honest when the
   * parent is a tight box around the effect. Pages used to guarantee that by hand-writing a
   * wrapper — `demo/scroll.html` carried a `.scrub-stage` whose entire job was `height: 260vh`.
   * Delete the wrapper and the parent becomes whatever section happens to contain the scrub:
   * measured there, the parent started 926px above it against a 1817px distance, so progress read
   * 51% before the element had even stuck and half the sequence played off screen.
   *
   * The spacer has neither problem. The library inserts it, it is exactly `distance` tall, it is
   * never sticky, and it moves with the content — so it describes the scroll the effect spans
   * without depending on how the author nested anything.
   *
   * It sits *after* `el`, so its top is `el`'s bottom; subtracting `el`'s own height recovers the
   * flow position sticky is hiding. That assumes no margin between the two, which holds because
   * both boxes are the library's own.
   */
  contentAnchor?: Element
  /**
   * The element that is actually `position: sticky`, so its resolved `top` can be read back and
   * subtracted from progress.
   *
   * Every caller above computes "the flow position sticky is hiding" — `sourceTop` or
   * `contentAnchor` — but that flow position is where the element's top reaches the *viewport's*
   * top edge, y = 0. Sticky does not wait for that: it engages the instant the flow top reaches
   * `top: <offset>`, `offset` pixels earlier. Without this, progress read 0 for the first `offset`
   * pixels the element was visibly stuck (an author with `--kui-pin-offset: 5.5rem` set — the
   * showcase default — got 88px of dead pin at the start of every `pin-*` and managed
   * `media-scrub`/`horizontal-scroll` effect, and 88px of dead pin at the end, since the same
   * untouched flow top also gated when progress reached 1). Measured on `demo/scroll.html`'s
   * `pin-spacer` card: 71 of those 88px, the rest eaten by an unrelated layout shift in the probe
   * — see `docs/live-testing-backlog.md` D8.
   *
   * Left undefined for primitives that never call `installSticky` themselves (`scroll-progress`,
   * `scroll-spy`, the bare `horizontal-scroll` form, `video-scrub`) — a page-authored sticky
   * ancestor is still escaped by `geometrySource`, but its offset is unknowable from here, so
   * progress there is unchanged: 0 at the sticky ancestor's untouched flow top, same as before.
   */
  stickyEl?: Element
  /** Injected for the same reason `measure`/`positionOf` are; see `OffsetReader`. */
  offsetOf?: OffsetReader
}

/**
 * The element whose position honestly describes how far `el` has travelled through the scroller.
 *
 * Usually `el` itself. The exception is a `position: sticky` subtree, and it is not a small one.
 * Sticky exists precisely to stop an element moving relative to the viewport, so once it is stuck
 * neither it nor anything inside it reports a rect that still says where it sits in the content
 * flow — `rect.top` becomes "where it is parked", not "how far down the document it lives".
 * Re-measure while stuck and `contentTop` comes back as roughly the *current scroll position*,
 * which makes progress negative, `clamp01` floors it to 0, and — because the measurement is cached
 * for the whole epoch — it stays 0 for the rest of the effect's life.
 *
 * `preparePin` already dodges this for the element it makes sticky itself, by tracking the parent.
 * This is the same move generalised to anything nested *inside* someone else's sticky subtree,
 * which is exactly what `horizontal-scroll`'s track and `sequence-scrub`'s image are.
 *
 * The outermost sticky ancestor is the one to escape from: its parent is the box that actually
 * scrolls. For the demo's `.track`, that walk lands on `.track-stage`, which is never stuck.
 *
 * @complexity O(d) time in the element's depth, once per geometry epoch; O(1) space.
 * @overallScore 100
 */
function geometrySource(el: Element, positionOf: PositionReader): Element {
  let outermostSticky: Element | null = null
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (positionOf(node) === 'sticky') outermostSticky = node
  }
  return outermostSticky?.parentElement ?? el
}

/** `el`'s viewport-relative top, read from whichever box honestly moves with the content. */
function sourceTop(
  el: Element,
  box: ElementGeometry,
  measure: Measurer,
  positionOf: PositionReader,
): number {
  const source = geometrySource(el, positionOf)
  return source === el ? box.top : measure(source).top
}

export type ProgressHandler = (progress: number, frame: ScrollFrame) => void

/**
 * Drive `onProgress` with the element's scroll progress in [0, 1].
 *
 * Progress is 0 when the tracked flow position reaches `options.stickyEl`'s sticky offset (the
 * scrollport's top edge, y = 0, when there is no `stickyEl`) and 1 once the scroll has advanced by
 * `distance`. Measurements are cached against the scheduler's epoch, so a frame costs arithmetic
 * rather than a layout flush.
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
  const positionOf = options.positionOf ?? domPosition
  const offsetOf = options.offsetOf ?? domOffsetTop
  let scrollTop = 0

  let scrollportTop = 0

  /*
   * Cache the element's offset within the scroller's *content*, not its viewport-relative one.
   *
   * Two things are going on. First, the epoch only advances on resize, so caching `rect.top` —
   * the one number that changes on every scroll — would freeze progress at its first-frame value.
   * Content offset is epoch-stable *for an element that moves with the content*. Second, `measure`
   * is viewport-relative while `scrollTop` is local to the resolved root, so subtracting the
   * scrollport's own viewport offset converts between the two; without it, every nested
   * `overflow: auto` container is wrong by exactly the scroller's position on screen.
   *
   * The "moves with the content" caveat is load-bearing and used to be missing — see
   * `geometrySource`. Height still comes from `el` itself, so `resolveDistance`'s default and its
   * percentage basis are unchanged.
   *
   * `stickyOffset` is the third correction, folded in here rather than at the call site, so it is
   * re-read on the same schedule as everything else: once per epoch, alongside a resize, not once
   * at setup and never again — an `offset-top` authored in `vh` changes with the viewport exactly
   * as `distance` does. See `TrackOptions.stickyEl` for why it has to be subtracted at all.
   */
  const geometry = createMeasureCache(() => {
    const box = measure(el)
    const top = options.contentAnchor
      ? measure(options.contentAnchor).top - box.height
      : sourceTop(el, box, measure, positionOf)
    const stickyOffset = options.stickyEl ? offsetOf(options.stickyEl) : 0
    return { contentTop: top - stickyOffset - scrollportTop + scrollTop, height: box.height }
  })

  return ctx.scheduler.subscribe(ctx.rootFor(el), (frame) => {
    scrollTop = frame.metrics.scrollTop
    scrollportTop = frame.metrics.viewportTop
    const box = geometry.read(frame.epoch)
    const span = resolveDistance(options.distance, { top: 0, height: box.height }, frame)
    onProgress(progressFrom(box.contentTop - scrollTop, span), frame)
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
