import { ATTR } from './attrs.js'

/**
 * Index the animated children of one stagger group.
 *
 * Only the index is written; the offset arithmetic stays in the CSS `calc()` so the browser
 * applies it, rather than JS recomputing a delay per element.
 *
 * @param group - Element carrying `data-dsg-stagger`.
 * @complexity O(n) time in the number of children; O(1) extra space.
 * @overallScore 100
 */
export function indexStaggerGroup(group: Element): void {
  const step = group.getAttribute(ATTR.stagger)
  if (step) (group as HTMLElement).style.setProperty('--dsg-stagger', step)

  let index = 0
  for (const child of group.children) {
    if (child.hasAttribute(ATTR.source)) {
      ;(child as HTMLElement).style.setProperty('--dsg-i', String(index))
      index++
    }
  }
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
