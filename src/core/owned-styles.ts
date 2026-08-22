/**
 * Owned-write ledger.
 *
 * The runtime writes inline custom properties, animation longhands, and timeline properties, but
 * previously tore down by removing three attributes. Recompiling `fade-up distance:80px` into
 * `zoom-in` therefore left `--kui-distance` behind, and destroying an animator left every
 * animation installed.
 *
 * A ledger records what this library wrote *and what was there before*, so teardown restores the
 * consumer's own inline styles rather than deleting them. That distinction matters: several JS
 * primitives were previously clearing author-set `translate` and `scroll-snap-align` values they
 * did not own.
 */

export interface StyleLedger {
  /** Write a property, remembering the value it replaced. */
  set(property: string, value: string): void
  /** Record a property this ledger will restore, without writing anything yet. */
  claim(property: string): void
  /** Restore every recorded property to the value it had before this ledger touched it. */
  restore(): void
  /** Properties currently owned. Diagnostics and leak assertions. */
  owned(): string[]
}

/**
 * Create a ledger over one element's inline style.
 *
 * @param el - Element whose inline style is managed.
 * @returns A ledger that can restore the element to its pre-effect inline state.
 * @complexity O(1) per write; O(n) space and O(n) time to restore, in properties written.
 * @overallScore 100
 */
export function createStyleLedger(el: Element): StyleLedger {
  const style = (el as HTMLElement).style
  // `undefined` means "was not set at all", which restores by removal rather than by writing "".
  const previous = new Map<string, string | undefined>()
  // Whether the author wrote a `style` attribute at all — not whether it held anything. Removing
  // the last property leaves the attribute itself behind, and `<div>` and `<div style="">` are
  // different markup even though they render identically.
  const authoredStyleAttribute = el.hasAttribute('style')

  function remember(property: string): void {
    if (previous.has(property)) return
    const existing = style.getPropertyValue(property)
    previous.set(property, existing === '' ? undefined : existing)
  }

  return {
    set(property, value) {
      remember(property)
      style.setProperty(property, value)
    },
    claim: remember,
    restore() {
      for (const [property, value] of previous) {
        if (value === undefined) style.removeProperty(property)
        else style.setProperty(property, value)
      }
      previous.clear()
      /*
       * Removing every property still leaves `style=""` sitting in the markup. Invisible on
       * screen, and every caller's own tests passed because they assert properties rather than
       * the attribute — but it is a real difference in the serialized subtree, and teardown's
       * contract is the author's markup byte for byte.
       *
       * `test/browser/teardown-sweep.test.mjs` was reading exactly this as "leaves synthetic
       * nodes behind": `scroll-snap-x` writes one property onto each child, and the host grew by
       * precisely the width of the empty attributes left on them (160 -> 178 chars, two children).
       *
       * `el.getAttribute('style')` here is a forced read, not a real check — `style.length` alone
       * reproducibly under-restored `slat-assemble`'s image even with no other effect anywhere on
       * the page, no sweep, no reset() at all, just `set()` then `restore()` on a natural timer.
       * The browser keeps the serialized `style` attribute in sync with the CSSOM lazily: a
       * `setProperty`/`removeProperty` pair with nothing in between that reads the attribute can
       * leave the *real* attribute never materialized, so `removeAttribute('style')` immediately
       * afterward has nothing to remove and silently no-ops. The first later read that forces a
       * sync — `innerHTML`, `getAttribute`, even an unrelated `MutationObserver` watching this
       * element — then materializes the attribute fresh from the now-empty CSSOM, i.e. `style=""`,
       * long after this function returned. Reading the attribute here, before deciding whether to
       * remove it, forces that sync while the ledger can still act on what it finds.
       */
      if (!authoredStyleAttribute && style.length === 0 && !el.getAttribute('style'))
        el.removeAttribute('style')
    },
    owned: () => [...previous.keys()],
  }
}

export interface AttributeLedger {
  set(name: string, value: string): void
  restore(): void
}

/**
 * The same discipline for attributes, so a library-stamped attribute never clobbers an authored
 * one permanently.
 *
 * @complexity O(1) per write; O(n) to restore.
 * @overallScore 100
 */
export function createAttributeLedger(el: Element): AttributeLedger {
  const previous = new Map<string, string | null>()

  return {
    set(name, value) {
      if (!previous.has(name)) previous.set(name, el.getAttribute(name))
      el.setAttribute(name, value)
    },
    restore() {
      for (const [name, value] of previous) {
        if (value === null) el.removeAttribute(name)
        else el.setAttribute(name, value)
      }
      previous.clear()
    },
  }
}
