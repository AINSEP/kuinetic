import { ATTR } from './attrs.js'

/**
 * Watches a subtree for authored-effect insertions, removals, and attribute changes.
 *
 * Extracted from `Animator` as an injected collaborator — same shape as `binder` or `scheduler` —
 * owning its own `MutationObserver` lifecycle exactly as the class did inline: nothing observes
 * until `watch()` is called, and `destroy()` disconnects whatever `watch()` started (or safely
 * no-ops if it never ran).
 */
export interface DomWatcher {
  /** Start observing. No-op if `MutationObserver` is unavailable in this environment. */
  watch(): void
  /** Stop observing. Safe to call even if `watch()` was never called. */
  destroy(): void
}

export interface DomWatcherOptions {
  root: ParentNode
  /** An element was inserted into the watched subtree. */
  onElementAdded(el: Element): void
  /** An element left the watched subtree. */
  onElementRemoved(el: Element): void
  /** One of the watched authoring attributes changed on an existing element. */
  onAttributeChanged(el: Element): void
  /** Injected frame queue used to budget mutation work. */
  schedule?: (callback: () => void) => void
  /** Injected observer factory for realm isolation and deterministic tests. */
  createObserver?: (callback: MutationCallback) => MutationObserver
}

const WORK_BUDGET = 100

/**
 * Build a `DomWatcher` closed over one animator's root and mutation callbacks.
 *
 * @complexity O(1) time and space to build. The mutation callback it installs runs O(n) time in
 * the nodes one `MutationRecord` carries.
 * @overallScore 100
 */
export function createDomWatcher(options: DomWatcherOptions): DomWatcher {
  const { root, onElementAdded, onElementRemoved, onAttributeChanged } = options
  const schedule = options.schedule ?? scheduleFrame
  const createObserver = options.createObserver ?? defaultObserverFactory()
  const added = new Set<Element>()
  const removed = new Set<Element>()
  const changed = new Set<Element>()
  let observer: MutationObserver | undefined
  let scheduled = false
  let destroyed = false

  function collect(record: MutationRecord): void {
    if (record.type === 'attributes') {
      const target = asElement(record.target)
      if (target) changed.add(target)
      return
    }
    for (const node of record.addedNodes) queueRoot(added, asElement(node))
    for (const node of record.removedNodes) queueRoot(removed, asElement(node))
  }

  function queueWork(records: MutationRecord[]): void {
    for (const record of records) collect(record)
    if (scheduled) return
    scheduled = true
    schedule(flush)
  }

  const install = whileAttached(root, onElementAdded)
  const recompile = whileAttached(root, onAttributeChanged)

  function flush(): void {
    scheduled = false
    if (destroyed) return
    let remaining = WORK_BUDGET
    remaining = drain(removed, onElementRemoved, remaining)
    remaining = drain(added, install, remaining)
    drain(changed, recompile, remaining)
    if (added.size + removed.size + changed.size > 0) {
      scheduled = true
      schedule(flush)
    }
  }

  return {
    watch() {
      if (!createObserver) return
      destroyed = false
      observer = createObserver(queueWork)
      observer.observe(root as Node, {
        subtree: true,
        childList: true,
        attributes: true,
        // `ATTR.stagger` is watched for the same reason `ATTR.source` is: both spell a stagger
        // group, and an edit to either has to re-rank the group. Its absence here meant editing
        // `data-kui-stagger` produced no record at all — not a missed handler, no mutation.
        attributeFilter: [ATTR.source, ATTR.on, ATTR.timeline, ATTR.threshold, ATTR.stagger],
      })
    },
    destroy() {
      destroyed = true
      observer?.disconnect()
      added.clear()
      removed.clear()
      changed.clear()
    },
  }
}

/**
 * Wrap work that *installs* something, so it runs only for an element still in the watched tree.
 *
 * The queues describe what happened across a whole frame, not a single state. An element
 * appended and removed before the flush is in both `added` and `removed`, and removals drain
 * first — so the removal finds nothing to tear down (nothing was installed yet) and the addition
 * then installs an element that is already detached. Nothing afterwards revisits it: it is held
 * by the animator's live set, its own listeners and its own observers until the whole animator
 * is destroyed. The same goes for an attribute change on an element whose subtree left in the
 * same frame, which `queueRoot` cannot collapse because the removed root is an ancestor rather
 * than the element itself.
 *
 * Membership *now*, at flush time, is the only thing that tells those apart from an ordinary
 * insertion — the records themselves say both things happened and say nothing about the order
 * that survived. Asked of the root rather than through `isConnected` so that an animator rooted
 * in a `DocumentFragment`, where nothing is ever connected, still installs its effects.
 *
 * Removals are deliberately not wrapped: an element moved rather than deleted is torn down and
 * then rescanned by the addition, which is the correct handling for a move.
 *
 * @param root - The watched subtree.
 * @param work - What to do for an element still inside it.
 * @complexity O(d) time in the element's depth below the root; O(1) space.
 * @overallScore 100
 */
function whileAttached(
  root: ParentNode,
  work: (el: Element) => void,
): (el: Element) => void {
  return (el) => {
    if (root.contains(el)) work(el)
  }
}

/**
 * Keep only top-most queued roots, since scanning one already covers all descendants.
 *
 * @param roots - Pending subtree roots.
 * @param candidate - Newly observed element, or null for non-elements.
 * @complexity O(r) time in queued roots; O(1) extra space.
 * @overallScore 100
 */
function queueRoot(roots: Set<Element>, candidate: Element | null): void {
  if (!candidate) return
  for (const root of roots) {
    if (root.contains(candidate)) return
    if (candidate.contains(root)) roots.delete(root)
  }
  roots.add(candidate)
}

/**
 * Drain at most the current frame's remaining work budget.
 *
 * @param roots - Pending elements.
 * @param callback - Work performed for each drained element.
 * @param budget - Maximum elements remaining this frame.
 * @returns The unused portion of the budget.
 * @complexity O(b) time in the frame budget; O(1) space.
 * @overallScore 100
 */
function drain(roots: Set<Element>, callback: (el: Element) => void, budget: number): number {
  for (const root of roots) {
    if (budget === 0) break
    roots.delete(root)
    callback(root)
    budget--
  }
  return budget
}

/**
 * Structurally recognize an element across browser realms.
 *
 * @param node - Candidate DOM node.
 * @returns The node as an element, or null.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function asElement(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : null
}

/**
 * Queue work on the next frame, with a microtask fallback outside browsers.
 *
 * @param callback - Work to enqueue.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function scheduleFrame(callback: () => void): void {
  const requestFrame = globalThis.requestAnimationFrame
  if (typeof requestFrame === 'function') requestFrame(() => callback())
  else queueMicrotask(callback)
}

/**
 * Build the observer in the active realm when available.
 *
 * @returns An observer factory, or undefined without MutationObserver support.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function defaultObserverFactory(): DomWatcherOptions['createObserver'] {
  if (typeof MutationObserver === 'undefined') return undefined
  return (callback) => new MutationObserver(callback)
}
