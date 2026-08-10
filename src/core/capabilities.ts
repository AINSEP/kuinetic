/**
 * Per-feature detection.
 *
 * One global `CSS.supports('animation-timeline','view()')` check is not an abstraction boundary:
 * `animation-range`, named timelines, and individual transform properties all ship separately.
 * Each capability is probed independently and cached. See docs/design.md §6.
 */

function supports(property: string, value: string): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  try {
    return CSS.supports(property, value)
  } catch {
    return false
  }
}

export interface Capabilities {
  viewTimeline: boolean
  scrollTimeline: boolean
  animationRange: boolean
  individualTransforms: boolean
  scrollTimelineName: boolean
  viewTransitions: boolean
  intersectionObserver: boolean
  reducedMotion: boolean
}

let cached: Capabilities | undefined

export function detect(force = false): Capabilities {
  if (cached && !force) return cached
  cached = {
    viewTimeline: supports('animation-timeline', 'view()'),
    scrollTimeline: supports('animation-timeline', 'scroll()'),
    animationRange: supports('animation-range', 'entry 0% cover 30%'),
    // `translate`/`rotate`/`scale` as independent properties is what makes the channel model
    // possible at all — under the `transform` shorthand every effect would collide.
    individualTransforms: supports('translate', '0 10px') && supports('scale', '1.1'),
    scrollTimelineName: supports('scroll-timeline-name', '--x'),
    viewTransitions: typeof document !== 'undefined' && 'startViewTransition' in document,
    intersectionObserver: typeof IntersectionObserver !== 'undefined',
    reducedMotion:
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
  return cached
}

export function resetCapabilities(): void {
  cached = undefined
}
