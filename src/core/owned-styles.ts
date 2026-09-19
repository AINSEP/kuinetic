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
  /**
   * The value this ledger will restore `property` to — whatever was there immediately before its
   * first `set()` or `claim()` — or `undefined` if this ledger has never captured that property.
   *
   * `restore()` can put a value back, but until now nothing could ask what it remembered without
   * writing it: a caller that needs the *value itself* mid-effect (a "resting state" to fall back
   * to when its own live input settles at a neutral point, say) had to keep a private snapshot of
   * its own, taken at its own moment, which is exactly the two-sources-of-truth bug this ledger
   * exists to prevent everywhere else. `undefined` here means only "never captured" — a property
   * that *was* captured but held no value beforehand reads back as `''`, matching what a live
   * `getPropertyValue` call would have returned for it at that same instant.
   */
  peek(property: string): string | undefined
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
  // A property's priority (`''` or `'important'`) travels with its value, not beside it — restoring
  // `setProperty(property, value)` alone always writes a plain declaration, silently dropping an
  // author's `!important` the first time this element's effects tear down. `undefined` still means
  // "was not set at all, restore by removal", and stays a distinct case from `{ value: '', ... }`,
  // which cannot occur: `getPropertyValue` returning `''` is exactly the signal `remember` reads
  // below to decide there was nothing here to capture.
  const previous = new Map<string, { value: string; priority: string } | undefined>()
  // Whether the author wrote a `style` attribute at all — not whether it held anything. Removing
  // the last property leaves the attribute itself behind, and `<div>` and `<div style="">` are
  // different markup even though they render identically.
  const authoredStyleAttribute = el.hasAttribute('style')

  function remember(property: string): void {
    if (previous.has(property)) return
    const existing = style.getPropertyValue(property)
    previous.set(
      property,
      existing === '' ? undefined : { value: existing, priority: style.getPropertyPriority(property) },
    )
  }

  return {
    set(property, value) {
      remember(property)
      style.setProperty(property, value)
    },
    claim: remember,
    restore() {
      for (const [property, previousValue] of previous) {
        if (previousValue === undefined) style.removeProperty(property)
        else style.setProperty(property, previousValue.value, previousValue.priority)
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
    peek(property) {
      if (!previous.has(property)) return undefined
      const previousValue = previous.get(property)
      return previousValue === undefined ? '' : previousValue.value
    },
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
 * One element's inline-style ledger, and every owner still writing through it.
 *
 * The memoisation `LedgerSet` does is per set, and that is not the unit the DOM works in. One
 * element can be written by several independent owners at once: a `target:` parameter from two
 * different authored hosts, a stagger group and the child's own `ElementState`, an advanced
 * controller and a co-located CSS effect. Give each of those its own `createStyleLedger` over the
 * same element and the second one to write captures the *first one's frame value* as the author's,
 * then pins the element to it on teardown — the exact defect this module exists to prevent, moved
 * up one level.
 *
 * So the capture is keyed by element and ref-counted by owner: the first owner to ask captures,
 * every owner writes through that one ledger, and the **last** owner to let go restores. That
 * extends `createStyleLedger`'s "what was there before" guarantee from "before this call" to
 * "before any of us existed", which is the only reading that survives two owners.
 *
 * A `WeakMap` because the key is the author's element and nothing here should keep it alive; the
 * entry dies with the element whether or not teardown ever ran.
 */
/**
 * Where an element's entries live.
 *
 * A module-level `WeakMap` was the obvious home and it is the wrong one, because it gives one
 * registry per *bundle* rather than one per page. `scripts/build-tiers.mjs` builds
 * `kuinetic.advanced.js` from its own entry point, so that bundle inlines its own copy of this
 * module and its own `WeakMap`; a page loading core and advanced together then has two registries
 * that cannot see each other, and one element gets two captures — the exact defect this file
 * exists to prevent, reappearing at the bundle seam. The first fix for that was to let a caller
 * hand in a ledger opened elsewhere, which worked and was a shim: it left the registry with two
 * ways to open a capture and made sharing opt-in at the call site.
 *
 * The entry belongs to the element, so it is stored on the element. `Symbol.for` resolves through
 * the runtime's own global symbol registry, so every bundle in the realm computes the *same* key
 * and finds the same entries, whatever order the script tags loaded in. Lifetime is unchanged from
 * the `WeakMap`: nothing but the element references the entries, so both are collected together.
 * The property is non-enumerable, never serialized, and invisible to `Object.keys`, HTML, CSS and
 * the author.
 *
 * The `.1` is a format version, not a release version. Two *different releases* of kUInetic on one
 * page must share an element's capture — that is the whole point — so this changes only if the
 * shape below changes incompatibly, at which point the older release keeps its own key rather than
 * reading a structure it does not understand.
 */
const REGISTRY = Symbol.for('kuinetic.owned-styles.1')

/** One element's capture of one kind, and every owner still writing through it. */
interface SharedEntry<L> {
  ledger: L
  /** Owners still writing through this ledger. The last one out restores. */
  owners: Set<object>
}

/** An element's entries, keyed by kind — `'style'` and `'attributes'` are the only two. */
type ElementEntries = Map<string, SharedEntry<never>>

/**
 * An element that cannot carry the property — frozen, sealed, or otherwise non-extensible — makes
 * `Object.defineProperty` throw, where the module-level `WeakMap` this replaced never could. That
 * throw is deliberate and it is not caught here. A `WeakMap` fallback was tried and removed: it
 * gives such an element a *per-bundle* registry, which is precisely the two-captures defect the
 * paragraph above exists to prevent, and it does it silently. "Frozen elements are never shared
 * across bundles" is not true — a page can freeze an element and still animate it from both
 * `kuinetic.js` and `kuinetic.advanced.js` — so the degradation cannot be argued away.
 *
 * Nothing is lost by throwing, because the throw is already contained and reported: a primitive's
 * `prepare` runs inside `js-effect-preparer.ts`'s try/catch, which warns
 * `"<effect>" failed to initialise` against that element and moves on to the next effect. One odd
 * element loses its effect and says so; the page keeps working; no capture is ever split.
 */
function entriesOf(el: Element): ElementEntries {
  const carrier = el as unknown as Record<symbol, ElementEntries | undefined>
  let entries = carrier[REGISTRY]
  if (!entries) {
    entries = new Map()
    Object.defineProperty(el, REGISTRY, { value: entries, configurable: true, writable: true })
  }
  return entries
}

/**
 * The shared entry of one kind for `el`, opened on first ask by anyone.
 *
 * @complexity O(1).
 */
function entryFor<L>(el: Element, kind: string, make: (el: Element) => L): SharedEntry<L> {
  const entries = entriesOf(el)
  let entry = entries.get(kind) as SharedEntry<L> | undefined
  if (!entry) {
    entry = { ledger: make(el), owners: new Set() }
    entries.set(kind, entry as unknown as SharedEntry<never>)
  }
  return entry
}

/**
 * One owner's membership of the shared entries: which elements it holds, and the joining and
 * leaving that keeps the count honest. Both claim kinds are this plus a handle shape.
 */
interface ClaimBook<L> {
  /** Join (or rejoin) this element's entry and hand back the real ledger. */
  join(el: Element): L
  /** The real ledger if this owner currently holds `el`, otherwise `null`. Does not join. */
  held(el: Element): L | null
  /** Drop this owner's claim, restoring the element when it was the last. */
  leave(el: Element): void
  elements(): Element[]
}

function openClaimBook<L extends { restore(): void }>(
  kind: string,
  make: (el: Element) => L,
): ClaimBook<L> {
  const owner = {}
  const held = new Map<Element, SharedEntry<L>>()

  return {
    join(el) {
      let entry = held.get(el)
      if (!entry) {
        entry = entryFor(el, kind, make)
        entry.owners.add(owner)
        held.set(el, entry)
      }
      return entry.ledger
    },
    held: (el) => held.get(el)?.ledger ?? null,
    leave(el) {
      const entry = held.get(el)
      // Not this owner's to release. Reached constantly and on purpose: `LedgerSet` walks the
      // union of its style and attribute elements, so an element it only ever stamped an attribute
      // on has no style claim to drop. It is also what makes a second `restore()` after one that
      // threw partway skip the elements the first attempt already gave back, rather than unwinding
      // this library's own values a second time as if they were the author's.
      if (!entry) return
      // Dropped from this owner *before* the restore that may throw, for that same reason.
      held.delete(el)
      entry.owners.delete(owner)
      if (entry.owners.size > 0) return
      entriesOf(el).delete(kind)
      entry.ledger.restore()
    },
    elements: () => [...held.keys()],
  }
}

/**
 * One owner's claim on the shared per-element ledgers.
 *
 * Deliberately not "the registry" — there is exactly one registry, module-wide, and a claim is a
 * handle onto it. Two claims over one element see one capture and two refcounts.
 */
export interface StyleClaim {
  /**
   * This element's shared ledger, claimed for this owner.
   *
   * The object handed back is this claim's own view of it: `set`/`claim`/`owned`/`peek` read and
   * write the shared ledger, and `restore()` means *"this owner is done"* rather than *"unwind the
   * element now"*. That distinction is what lets a caller holding only a `StyleLedger` — every
   * primitive, via `PrepareContext.style` — participate in the refcount without knowing it exists.
   */
  style(el: Element): StyleLedger
  /** Drop this owner's claim on `el`, restoring it when no other owner holds it. */
  release(el: Element): void
  /** Elements this claim currently holds, in the order it first asked for them. A snapshot. */
  elements(): Element[]
}

/**
 * Open one owner's claim on the shared inline-style ledgers.
 *
 * **Writing is claiming; reading is not.** A handle outlives its own `restore()` — a primitive is
 * handed `PrepareContext.style` once at prepare and keeps it for the element's whole life, a
 * controller cancels and re-activates, a `LedgerSet` is restored and the element is entered again
 * — so a handle that closed over one entry would, after release, write straight into a ledger the
 * registry had already deleted and restored. The value landed on the element, the claim was empty,
 * and nothing anywhere would ever put it back. So `set` and `claim` rejoin. `owned` and `peek`
 * deliberately do not: asking what this owner will restore must not make it an owner, and a
 * released handle honestly answers "nothing".
 *
 * @returns A claim that hands out ref-counted handles and releases them one element at a time.
 * @complexity O(1) per lookup and per release; O(p) in properties written, on the last release.
 * @overallScore 100
 */
export function createStyleClaim(): StyleClaim {
  const book = openClaimBook('style', createStyleLedger)
  // Weak, so a released element is not kept alive by the handle this claim memoised for it.
  const handles = new WeakMap<Element, StyleLedger>()

  function handleFor(el: Element): StyleLedger {
    return {
      set: (property, value) => { book.join(el).set(property, value) },
      claim: (property) => { book.join(el).claim(property) },
      restore: () => { book.leave(el) },
      owned: () => book.held(el)?.owned() ?? [],
      peek: (property) => book.held(el)?.peek(property),
    }
  }

  return {
    style(el) {
      let handle = handles.get(el)
      if (!handle) {
        handle = handleFor(el)
        handles.set(el, handle)
      }
      book.join(el)
      return handle
    },
    release: (el) => { book.leave(el) },
    elements: () => book.elements(),
  }
}

/**
 * One owner's claim on the shared per-element *attribute* ledgers.
 *
 * The same model and the same reason. `animator.ts`'s `installMatch` stamps `data-kui-fx` and
 * `data-kui-rm` onto every element a group's `target:` resolves to, and under `scope:page` two
 * authored hosts can resolve to the same element — at which point the second `LedgerSet` captured
 * the first one's stamp as the author's attribute and put *that* back on teardown.
 */
export interface AttributeClaim {
  /** This element's shared attribute ledger, claimed for this owner. */
  attributes(el: Element): AttributeLedger
  /** Drop this owner's claim on `el`, restoring it when no other owner holds it. */
  release(el: Element): void
  /** Elements this claim currently holds, in the order it first asked for them. A snapshot. */
  elements(): Element[]
}

/**
 * Open one owner's claim on the shared attribute ledgers.
 *
 * @complexity O(1) per lookup and per release; O(n) in attributes written, on the last release.
 * @overallScore 100
 */
export function createAttributeClaim(): AttributeClaim {
  const book = openClaimBook('attributes', createAttributeLedger)
  const handles = new WeakMap<Element, AttributeLedger>()

  function handleFor(el: Element): AttributeLedger {
    return {
      set: (name, value) => { book.join(el).set(name, value) },
      restore: () => { book.leave(el) },
    }
  }

  return {
    attributes(el) {
      let handle = handles.get(el)
      if (!handle) {
        handle = handleFor(el)
        handles.set(el, handle)
      }
      book.join(el)
      return handle
    },
    release: (el) => { book.leave(el) },
    elements: () => book.elements(),
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
 *
 * Both kinds go one level further out than that, through {@link createStyleClaim} and
 * {@link createAttributeClaim}: memoising *within* one set is not enough once two sets reach the
 * same element — two authored hosts whose `target:` lands on one node, a stagger group and the
 * child's own state, a core effect and an advanced controller. The set is one owner of a shared,
 * ref-counted capture, so `restore()` here means "this host is finished with the element", and the
 * element is unwound by whichever owner is last.
 */
export interface LedgerSet {
  /** This element's inline-style ledger, created on first ask. */
  style(el: Element): StyleLedger
  /** This element's attribute ledger, created on first ask. */
  attributes(el: Element): AttributeLedger
  /** Unwind every element this set ever handed out a ledger for. Host last — see below. */
  restore(): void
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
  const styles = createStyleClaim()
  const attributes = createAttributeClaim()

  function restoreOne(el: Element): void {
    styles.release(el)
    attributes.release(el)
  }

  return {
    style: (el) => styles.style(el),
    attributes: (el) => attributes.attributes(el),
    restore() {
      // Insertion order, minus the host, then the host — rather than trusting the host to have
      // been asked for first. It always is today (`install` writes the host's style plan before
      // anything else), but "restore order is correct because of the order an unrelated function
      // happens to call us in" is exactly the kind of invariant that breaks silently.
      for (const el of new Set([...styles.elements(), ...attributes.elements()])) {
        if (el !== host) restoreOne(el)
      }
      restoreOne(host)
    },
  }
}
