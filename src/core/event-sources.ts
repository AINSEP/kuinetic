import type { Reporter } from './reporter.js'
import { selectorBreadth } from './target.js'
import type { Cleanup } from './types.js'

/** One shared DOM listener and the animation callbacks currently retained through it. */
interface EventBinding {
  listener: EventListener
  runs: Set<() => void>
}

/** Everything needed to retain callbacks for a group of source elements and event types. */
export interface EventSourceBindingRequest {
  sources: readonly Element[]
  types: readonly string[]
  run(): void
}

/** Owns shared foreign-event listeners and releases all of them on destruction. */
export interface EventSourceBindings {
  bind(request: EventSourceBindingRequest): Cleanup
  destroy(): void
}

/**
 * Create a registry that shares one native listener per source/event pair.
 *
 * @returns A registry for binding callbacks and releasing every foreign listener it owns.
 * @complexity O(1) to build; retained listener costs are documented on the nested functions.
 */
export function createEventSourceBindings(): EventSourceBindings {
  const bindings = new Map<Element, Map<string, EventBinding>>()

  /**
   * Retain one callback on a source/event pair, installing a native listener only for its first
   * consumer and removing it after its last consumer releases. Every listener stays passive: this
   * binder starts animations but never cancels the source event, including `wheel` and `submit`.
   *
   * @complexity O(1) to retain or release; O(r) to deliver to r current callbacks.
   */
  function retain(source: Element, type: string, run: () => void): Cleanup {
    let types = bindings.get(source)
    if (!types) {
      types = new Map()
      bindings.set(source, types)
    }
    let binding = types.get(type)
    if (!binding) {
      const runs = new Set<() => void>()
      const listener: EventListener = () => {
        // Snapshotting preserves the browser's event-dispatch shape if a callback tears itself
        // down while this shared listener is delivering the event.
        for (const callback of [...runs]) callback()
      }
      binding = { listener, runs }
      types.set(type, binding)
      source.addEventListener(type, listener, { passive: true })
    }
    binding.runs.add(run)

    let retained = true
    return () => {
      if (!retained) return
      retained = false
      binding.runs.delete(run)
      if (binding.runs.size > 0) return
      source.removeEventListener(type, binding.listener)
      types?.delete(type)
      if (types?.size === 0) bindings.delete(source)
    }
  }

  return {
    bind({ sources, types, run }) {
      const cleanups: Cleanup[] = []
      for (const source of sources) {
        for (const type of types) cleanups.push(retain(source, type, run))
      }
      return () => {
        for (const cleanup of cleanups) cleanup()
      }
    },

    destroy() {
      for (const [source, types] of bindings) {
        for (const [type, binding] of types) source.removeEventListener(type, binding.listener)
      }
      bindings.clear()
    },
  }
}

/** Everything needed to resolve an optional foreign event source against the animated element's document. */
export interface EventSourceResolutionRequest {
  el: Element
  from?: string
  reporter?: Reporter
}

/**
 * Resolve an event source selector once while an animation is installed.
 *
 * `from:` deliberately resolves only at install time. The existing `observe: true` watcher tracks
 * animated elements, not arbitrary potential source nodes, so pretending that a missing source
 * would bind later would create a silent and unbounded document-wide observer. A named warning is
 * the established selector convention and gives the author an immediate correction path.
 *
 * @param request - Animated element, optional selector, and diagnostic sink.
 * @returns The event source elements, or an empty list when the selector is unusable or unmatched.
 * @complexity O(n) in document size for a selector query; O(s) space for s matching sources.
 */
export function resolveEventSources({ el, from, reporter }: EventSourceResolutionRequest): Element[] {
  if (!from) return [el]
  const doc = el.ownerDocument
  const breadth = selectorBreadth(from, doc)
  if (breadth !== 'ok') {
    const reason = breadth === 'invalid' ? 'is not a valid selector' : 'matches the whole document'
    reporter?.warn(`activation source "${from}" ${reason} and will be ignored`, el)
    return []
  }
  const sources = [...doc.querySelectorAll(from)]
  if (sources.length === 0) reporter?.warn(`activation source "${from}" matched nothing`, el)
  return sources
}
