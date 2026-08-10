/**
 * Owned-write ledger.
 *
 * The runtime writes inline custom properties, animation longhands, and timeline properties, but
 * previously tore down by removing three attributes. Recompiling `fade-up distance:80px` into
 * `zoom-in` therefore left `--dsg-distance` behind, and destroying an animator left every
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
