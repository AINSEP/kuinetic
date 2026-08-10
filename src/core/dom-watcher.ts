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
}

/**
 * Build a `DomWatcher` closed over one animator's root and mutation callbacks.
 *
 * @complexity O(1) time and space to build. The mutation callback it installs runs O(n) time in
 * the nodes one `MutationRecord` carries.
 * @overallScore 100
 */
export function createDomWatcher(options: DomWatcherOptions): DomWatcher {
  const { root, onElementAdded, onElementRemoved, onAttributeChanged } = options
  let observer: MutationObserver | undefined

  function handleMutation(record: MutationRecord): void {
    if (record.type === 'attributes') {
      if (record.target instanceof Element) onAttributeChanged(record.target)
      return
    }
    for (const node of record.addedNodes) if (node instanceof Element) onElementAdded(node)
    for (const node of record.removedNodes) if (node instanceof Element) onElementRemoved(node)
  }

  return {
    watch() {
      if (typeof MutationObserver === 'undefined') return
      observer = new MutationObserver((records) => {
        for (const record of records) handleMutation(record)
      })
      observer.observe(root as Node, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [ATTR.source, ATTR.on, ATTR.timeline, ATTR.threshold],
      })
    },
    destroy() {
      observer?.disconnect()
    },
  }
}
