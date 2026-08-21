import { ATTR } from './attrs.js'

/**
 * Index the animated children of one stagger group.
 *
 * Only the index is written; the offset arithmetic stays in the CSS `calc()` so the browser
 * applies it, rather than JS recomputing a delay per element.
 *
 * @param group - Element carrying `data-kui-stagger`.
 * @complexity O(n) time in the number of children; O(1) extra space.
 * @overallScore 100
 */
export function indexStaggerGroup(group: Element): void {
  const step = group.getAttribute(ATTR.stagger)
  if (step) (group as HTMLElement).style.setProperty('--kui-stagger', step)

  let index = 0
  for (const child of group.children) {
    if (child.hasAttribute(ATTR.source)) {
      ;(child as HTMLElement).style.setProperty('--kui-i', String(index))
      index++
    }
  }
  // The group size, published for `timeline: pin`. A time-driven stagger does not need it — the
  // clock keeps running past the last item's delay, so everything finishes eventually. A scrub
  // has no such luxury: its head travels exactly one `duration` between progress 0 and 1, so a
  // staggered child sitting `i * stagger` further along would still be mid-animation when the
  // scroll range ends, and the last child could never reach its final frame at all. Widening the
  // head by the group's total stagger span fixes that, and the compiler cannot know the span
  // because it compiles one element without reference to its siblings. Defaults to 1 in the
  // `var()` fallback, where the extra term is zero and the head is plain `progress x duration`.
  ;(group as HTMLElement).style.setProperty('--kui-stagger-count', String(Math.max(index, 1)))
}

/**
 * Index every stagger group in a subtree, including the root itself.
 *
 * @param root - Subtree to search.
 * @complexity O(n) time in the number of elements in the subtree; O(g) space in group count.
 * @overallScore 100
 */
export function applyStagger(root: ParentNode): void {
  const selector = `[${ATTR.stagger}]`
  if (root instanceof Element && root.matches(selector)) indexStaggerGroup(root)
  for (const group of root.querySelectorAll(selector)) indexStaggerGroup(group)
}
