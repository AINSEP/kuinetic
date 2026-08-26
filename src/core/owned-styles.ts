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

/**
 * Every element one authored `data-kui` wrote to, and the ledgers that unwind them.
 *
 * The host owns the lifecycle — one `InstanceState`, one gate, one event stream — but the *writes*
 * do not all land on the host. `target:` names elements the effect animates instead of the element
 * the attribute sits on, and each of those needs its own pair of ledgers: `createStyleLedger`
 * closes over one element's `style` object and one snapshot of whether that element had a `style`
 * attribute to begin with, so it cannot be shared and cannot be reconstructed later.
 *
 * A set rather than an array of pairs because the same element is reached repeatedly — once per
 * effect in a composed attribute, once more by the stagger pass — and a second ledger over an
 * element the first has already written to would snapshot *this library's* values as the author's
 * own and restore to them. Memoising per element is what makes "what was there before" mean before
 * this instance existed, rather than before this particular call.
 */
export interface LedgerSet {
  /** This element's inline-style ledger, created on first ask. */
  style(el: Element): StyleLedger
  /** This element's attribute ledger, created on first ask. */
  attributes(el: Element): AttributeLedger
  /** Unwind every element this set ever handed out a ledger for. Host last — see below. */
  restore(): void
  /** Every element with a ledger, host first. Diagnostics and leak assertions. */
  elements(): Element[]
}

/**
 * Open a ledger set over one authored host.
 *
 * **Restore is host-last, and that ordering is load-bearing.** The host carries `data-kui-state`,
 * which is the cloak layer's per-element release key: `html[data-kui-cloak] [data-kui][data-kui-reveal]:not([data-kui-state])`
 * holds a subtree at `opacity: 0`, and the attribute's presence is what lets go. Restoring the host
 * first removes that key while the elements underneath still carry library styles, reopening the
 * cloak over a half-unwound subtree. Doing it last means the page is already back to the author's
 * markup at the instant it becomes visible again.
 *
 * Style before attributes within each element, matching the order `release()` has always used: a
 * primitive's teardown may write styles, and the attributes are what CSS keys on to decide whether
 * those styles mean anything.
 *
 * @param host - The authored element. Always present in the set, always restored last.
 * @returns A set that hands out memoised ledgers and unwinds all of them together.
 * @complexity O(1) per lookup; O(n) space and O(n) time to restore, in elements written to.
 * @overallScore 100
 */
export function createLedgerSet(host: Element): LedgerSet {
  const styles = new Map<Element, StyleLedger>()
  const attributes = new Map<Element, AttributeLedger>()

  function memoise<T>(cache: Map<Element, T>, el: Element, make: (el: Element) => T): T {
    let ledger = cache.get(el)
    if (!ledger) {
      ledger = make(el)
      cache.set(el, ledger)
    }
    return ledger
  }

  function restoreOne(el: Element): void {
    styles.get(el)?.restore()
    attributes.get(el)?.restore()
  }

  return {
    style: (el) => memoise(styles, el, createStyleLedger),
    attributes: (el) => memoise(attributes, el, createAttributeLedger),
    restore() {
      // Insertion order, minus the host, then the host — rather than trusting the host to have
      // been asked for first. It always is today (`install` writes the host's style plan before
      // anything else), but "restore order is correct because of the order an unrelated function
      // happens to call us in" is exactly the kind of invariant that breaks silently.
      for (const el of new Set([...styles.keys(), ...attributes.keys()])) {
        if (el !== host) restoreOne(el)
      }
      restoreOne(host)
      styles.clear()
      attributes.clear()
    },
    elements() {
      const all = new Set<Element>([host])
      for (const el of styles.keys()) all.add(el)
      for (const el of attributes.keys()) all.add(el)
      return [...all]
    },
  }
}
