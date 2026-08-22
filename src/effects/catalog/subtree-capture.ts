import type { Cleanup } from '../../core/types.js'

/**
 * Snapshot an element's children so teardown can put back exactly what the author wrote.
 *
 * Every DOM-rewriting primitive in this folder used to restore by assigning `textContent`, which
 * is faithful only when the authored content was plain text — the one case every restore test
 * happened to author. Given `<p><strong>one</strong> two</p>` it flattened the `<strong>`; given
 * `<span>42</span>` a counter wrote back the value it had counted to instead of the author's own
 * content. Both are invisible on a page that never tears down, and both destroy author markup in
 * any app that unmounts.
 *
 * The captured nodes are the live originals, merely detached by the caller's own overwrite.
 * Restoring re-inserts those same node objects, so nested structure, attributes, and any listeners
 * bound to them survive — none of which would come back from re-parsing a string.
 *
 * Capture before overwriting: this reads the children as they stand when it is called.
 *
 * @param el - Element whose children are about to be replaced.
 * @returns A cleanup that discards whatever is there now and reinstates the captured children.
 * @complexity O(n) time and space in child-node count.
 * @overallScore 100
 */
export function captureChildren(el: Element): Cleanup {
  const authored = Array.from(el.childNodes)
  return () => {
    el.replaceChildren(...authored)
  }
}
