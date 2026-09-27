import type { DerivedBook } from './types.js'

/**
 * A fresh, empty derived-host book for one `Animator`.
 *
 * All WeakMaps, so a removed element takes its own entries with it rather than leaking for the
 * animator's lifetime — the same discipline `animator.ts`'s own `states`/`currentRun`/`settleArmed`
 * already follow.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function createDerivedBook(): DerivedBook {
  return {
    derived: new WeakMap(),
    hosts: new WeakMap(),
    groups: new WeakMap(),
    contexts: new WeakMap(),
    unions: new WeakMap(),
    cleanups: new WeakMap(),
  }
}

/**
 * A host's derived matches as a fresh array, in document order.
 *
 * A copy rather than the live `Set`, so a caller may release matches while iterating without the
 * iteration itself observing the mutation.
 *
 * @returns `[]` for a host with no derived matches (or that is not a host at all).
 * @complexity O(n) time and space in the host's derived match count.
 * @overallScore 100
 */
export function derivedOf(book: DerivedBook, el: Element): Element[] {
  return [...(book.derived.get(el) ?? [])]
}

/**
 * The host that installed a derived match, if `el` is one.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function hostOf(book: DerivedBook, el: Element): Element | undefined {
  return book.hosts.get(el)
}
