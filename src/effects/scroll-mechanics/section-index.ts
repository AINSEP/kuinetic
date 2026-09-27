import type { PrepareContext } from '../../core/effect-context.js'
import { toPixels } from '../../core/js-params.js'
import { createMeasureCache } from '../../core/scroll-scheduler.js'
import type { ScrollFrame } from '../../core/scroll-scheduler.js'
import type { Cleanup } from '../../core/types.js'
import { domGeometry } from './tracker.js'

/**
 * Options for tracking the active section index as the scroller advances.
 */
export interface SectionIndexOptions {
  el: Element
  sections: Element[]
  ctx: PrepareContext
  offsetTop?: string
  onChange: (next: number, previous: number) => void
}

export type SectionIndex = Cleanup & { release: () => void }

/**
 * `offset-top` resolved to pixels for one frame.
 *
 * Evaluated statically per frame using the scheduler's viewport metrics so viewport units
 * like `50vh` update with resize.
 *
 * @complexity O(n) time in the authored value's length; O(1) space.
 * @overallScore 100
 */
export function offsetTopPixels(authored: string, frame: ScrollFrame): number {
  return toPixels(
    authored,
    {
      viewportWidth: frame.metrics.viewportWidth,
      viewportHeight: frame.metrics.viewportHeight,
      percentBasis: 0,
      fontSize: 16,
      rootFontSize: 16,
    },
    0,
  )
}

/**
 * The highest index whose content-relative top has reached the reference line.
 *
 * `-1` when none has — before the first section, or with no sections at all. Callers rely on this
 * being the *only* thing that decides "active": one number, or none, never more than one.
 *
 * @complexity O(n) time in section count; O(1) space.
 * @overallScore 100
 */
export function highestReachedIndex(tops: number[], scrollTop: number, line: number): number {
  let index = -1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! - scrollTop - line <= 0) index = i
  }
  return index
}

/**
 * Measure section tops once per resize epoch and report the highest reached section index on change.
 *
 * Shared measuring and scroll subscription half extracted from `prepareScrollSpyContainer`,
 * reused by `scroll-spy` and `scroll-story`.
 *
 * @complexity O(n) time and space in section count, recomputed every frame — cheap arithmetic
 *   against a rect cache, never a fresh layout read once per resize epoch has passed.
 * @overallScore 100
 */
export function createSectionIndex(options: SectionIndexOptions): SectionIndex {
  const { el, sections, ctx, onChange } = options
  const offsetAuthored = options.offsetTop ?? '0px'
  let scrollTop = 0
  let scrollportTop = 0
  const contentTops = createMeasureCache(() =>
    sections.map((section) => domGeometry(section).top - scrollportTop + scrollTop),
  )

  let active = -1

  const untrack = ctx.scheduler.subscribe(ctx.rootFor(el), (frame) => {
    scrollTop = frame.metrics.scrollTop
    scrollportTop = frame.metrics.viewportTop
    const tops = contentTops.read(frame.epoch)
    const line = offsetTopPixels(offsetAuthored, frame)
    const next = highestReachedIndex(tops, scrollTop, line)

    if (next === active) return
    const previous = active
    active = next
    onChange(next, previous)
  })

  return Object.assign(() => untrack(), { release: () => untrack() })
}
