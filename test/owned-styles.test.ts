// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createAttributeClaim, createAttributeLedger, createLedgerSet, createStyleClaim, createStyleLedger } from '../src/core/owned-styles.js'

/*
 * Teardown's contract is the authored markup, byte for byte.
 *
 * `restore()` has always put every *property* back correctly, which is what the existing callers
 * assert and why this went unnoticed. But removing the last property off an element that had no
 * `style` attribute to begin with leaves `style=""` sitting in the markup — invisible on screen,
 * and a real difference in the serialized subtree. `test/browser/teardown-sweep.test.mjs` reads
 * that difference as "this effect left synthetic nodes behind": `scroll-snap-x` writes one
 * property onto each of its children, and the sweep measured the host growing by exactly the
 * width of the empty attributes it left on them.
 */
describe('createStyleLedger restore', () => {
  it('puts every written property back', () => {
    const el = document.createElement('div')
    el.style.color = 'red'
    const ledger = createStyleLedger(el)
    ledger.set('color', 'blue')
    ledger.set('display', 'grid')
    expect(el.style.color).toBe('blue')

    ledger.restore()
    expect(el.style.color).toBe('red')
    expect(el.style.display).toBe('')
  })

  it('leaves no style attribute behind on an element that never had one', () => {
    const el = document.createElement('div')
    expect(el.hasAttribute('style')).toBe(false)

    const ledger = createStyleLedger(el)
    ledger.set('scroll-snap-align', 'start')
    ledger.restore()

    // Not merely "no properties" — no attribute. `<div>` and `<div style="">` are different markup.
    expect(el.getAttribute('style')).toBe(null)
    expect(el.outerHTML).toBe('<div></div>')
  })

  it('keeps an authored style attribute, even once every property it wrote is gone', () => {
    const el = document.createElement('div')
    el.setAttribute('style', 'color: red')
    const ledger = createStyleLedger(el)
    ledger.set('display', 'grid')
    ledger.restore()

    expect(el.hasAttribute('style')).toBe(true)
    expect(el.style.color).toBe('red')
  })

  it("restores a property's !important priority, not just its value", () => {
    // Regression: `remember` only ever captured `getPropertyValue`, so an author's
    // `animation-duration:2s!important` came back as a plain `2s` — the declaration survived
    // teardown but its priority silently didn't, changing what the cascade does for the rest of
    // the page's life.
    const el = document.createElement('div')
    el.setAttribute('style', 'animation-duration:2s!important')
    expect(el.style.getPropertyPriority('animation-duration')).toBe('important')

    const ledger = createStyleLedger(el)
    ledger.set('animation-duration', '800ms')
    expect(el.style.getPropertyPriority('animation-duration')).toBe('')

    ledger.restore()
    expect(el.style.getPropertyValue('animation-duration')).toBe('2s')
    expect(el.style.getPropertyPriority('animation-duration')).toBe('important')
  })

  it('restores a plain (non-important) value with a plain priority, same as before', () => {
    const el = document.createElement('div')
    el.style.setProperty('opacity', '0.5')
    const ledger = createStyleLedger(el)
    ledger.set('opacity', '1')
    ledger.restore()

    expect(el.style.getPropertyValue('opacity')).toBe('0.5')
    expect(el.style.getPropertyPriority('opacity')).toBe('')
  })

  it('is the difference the teardown sweep measures, on a scroll-snap-shaped subtree', () => {
    const host = document.createElement('div')
    host.innerHTML = '<i>a</i><i>b</i>'
    const authored = host.innerHTML

    const ledgers = [...host.children].map((child) => createStyleLedger(child))
    for (const ledger of ledgers) ledger.set('scroll-snap-align', 'start')
    for (const ledger of ledgers) ledger.restore()

    expect(host.innerHTML).toBe(authored)
  })
})

describe('createStyleLedger peek', () => {
  it('returns undefined for a property this ledger has never touched', () => {
    const el = document.createElement('div')
    const ledger = createStyleLedger(el)
    expect(ledger.peek('transform')).toBeUndefined()
  })

  it("returns the author's value from immediately before the first write", () => {
    const el = document.createElement('div')
    el.style.transform = 'scale(1.2)'
    const ledger = createStyleLedger(el)
    ledger.set('transform', 'rotateX(10deg)')

    expect(ledger.peek('transform')).toBe('scale(1.2)')
    // The element's live value has moved on; peek keeps answering with the pre-write one.
    expect(el.style.transform).toBe('rotateX(10deg)')
  })

  it('keeps answering with the original value across repeated writes', () => {
    const el = document.createElement('div')
    el.style.opacity = '0.8'
    const ledger = createStyleLedger(el)
    // Three separate writes to the same property, deliberately — proving peek() doesn't drift
    // toward whichever one ran most recently.
    for (const value of ['0', '0.5', '1']) ledger.set('opacity', value)

    expect(ledger.peek('opacity')).toBe('0.8')
  })

  it("distinguishes 'never captured' from 'captured, and there was nothing there'", () => {
    const el = document.createElement('div')
    const ledger = createStyleLedger(el)

    // Not yet asked about `transform` at all.
    expect(ledger.peek('transform')).toBeUndefined()

    // `claim()` captures without writing, same as `set()` does before its own write.
    ledger.claim('transform')
    expect(ledger.peek('transform')).toBe('')
    expect(el.style.transform).toBe('')
  })

  it('reports a captured !important value without its priority — value only, by design', () => {
    const el = document.createElement('div')
    el.style.setProperty('opacity', '0.4', 'important')
    const ledger = createStyleLedger(el)
    ledger.set('opacity', '0')

    expect(ledger.peek('opacity')).toBe('0.4')
    // The priority still round-trips correctly on the write path that matters: restore().
    ledger.restore()
    expect(el.style.getPropertyPriority('opacity')).toBe('important')
  })

  it('forgets what it captured once restore() runs', () => {
    const el = document.createElement('div')
    el.style.transform = 'scale(1.2)'
    const ledger = createStyleLedger(el)
    ledger.set('transform', 'rotateX(10deg)')
    ledger.restore()

    expect(ledger.peek('transform')).toBeUndefined()
  })
})

describe('createStyleLedger claim/owned', () => {
  /**
   * `claim()` is "I will restore this, I have not written it yet" — the shape a primitive needs
   * when the *browser* is about to write the property (a WAAPI animation's fill, a `@starting-style`
   * transition) and the ledger still has to capture what was there first. Writing anything here
   * would defeat the purpose by replacing the value it is supposed to be remembering.
   */
  it('captures a property without writing it, and lists it as owned', () => {
    const el = document.createElement('div')
    el.style.transform = 'scale(1.2)'
    const ledger = createStyleLedger(el)

    ledger.claim('transform')
    ledger.claim('opacity')

    expect(el.style.transform).toBe('scale(1.2)')
    expect(el.getAttribute('style')).toBe('transform: scale(1.2);')
    expect(ledger.owned().sort((a, b) => a.localeCompare(b))).toEqual(['opacity', 'transform'])
  })

  it('restores a claimed property the browser wrote after the claim', () => {
    const el = document.createElement('div')
    el.style.transform = 'scale(1.2)'
    const ledger = createStyleLedger(el)

    ledger.claim('transform')
    // Stand-in for whatever wrote it afterwards without going through the ledger.
    el.style.transform = 'rotateX(90deg)'
    ledger.restore()

    expect(el.style.transform).toBe('scale(1.2)')
  })
})

/*
 * The same discipline for attributes, and the asymmetry between its two restore paths is the whole
 * point: an attribute this library *invented* has to be removed, and one it *overwrote* has to be
 * put back. Only the first had a test, and the difference is invisible to every caller that writes
 * a `data-kui-*` name of its own — it shows up on the ones that write ARIA state onto markup an
 * author already had an opinion about (`effects/navigation`, `effects/forms`, `scroll-spy`), where
 * removing instead of restoring silently strips the page's own accessibility contract.
 */
describe('createAttributeLedger restore', () => {
  it('puts an overwritten attribute back at the value the author wrote, rather than removing it', () => {
    const el = document.createElement('button')
    el.setAttribute('aria-expanded', 'false')
    const ledger = createAttributeLedger(el)

    ledger.set('aria-expanded', 'true')
    expect(el.getAttribute('aria-expanded')).toBe('true')

    ledger.restore()
    expect(el.getAttribute('aria-expanded')).toBe('false')
  })

  it('removes an attribute the author never wrote', () => {
    const el = document.createElement('div')
    const ledger = createAttributeLedger(el)

    ledger.set('data-kui-step', '2')
    ledger.restore()

    expect(el.hasAttribute('data-kui-step')).toBe(false)
    expect(el.outerHTML).toBe('<div></div>')
  })

  /**
   * "What was there before" means before *this ledger*, not before this call. A per-write snapshot
   * would capture the library's own previous value on the second write — which is every write after
   * the first, since these attributes are re-stamped on each render — and restore to it.
   */
  it('remembers only the value it first replaced, however many times it rewrites', () => {
    const el = document.createElement('div')
    el.setAttribute('data-kui-step', 'author')
    const ledger = createAttributeLedger(el)

    // Three flips, the way a stepper re-stamps on every press.
    for (const step of ['1', '2', '3']) ledger.set('data-kui-step', step)
    expect(el.getAttribute('data-kui-step')).toBe('3')

    ledger.restore()
    expect(el.getAttribute('data-kui-step')).toBe('author')
  })

  it('forgets everything once restored, so a second restore cannot undo a later author write', () => {
    const el = document.createElement('div')
    const ledger = createAttributeLedger(el)
    ledger.set('data-kui-step', '1')
    ledger.restore()

    el.setAttribute('data-kui-step', 'authored-afterwards')
    ledger.restore()

    expect(el.getAttribute('data-kui-step')).toBe('authored-afterwards')
  })
})

describe('createLedgerSet', () => {
  /**
   * Restore is host-last, and the reason is the cloak: the host's `data-kui-state` is the per-element
   * release key that lets `html[data-kui-cloak] [data-kui][data-kui-reveal]:not([data-kui-state])`
   * stop holding the subtree at `opacity: 0`. Asserted as *what the subtree looked like at the
   * instant the key was dropped* rather than as a call order, because that instant is the whole
   * claim — restoring the host first uncloaks a page still wearing this library's inline styles.
   */
  it('has the subtree already back to the authored markup when the host releases data-kui-state', () => {
    const host = document.createElement('div')
    const child = document.createElement('span')
    host.append(child)
    const set = createLedgerSet(host)

    set.attributes(host).set('data-kui-state', 'finished')
    set.style(child).set('opacity', '0')

    let childAtRelease: string | null = 'never observed'
    const realRemove = host.removeAttribute.bind(host)
    vi.spyOn(host, 'removeAttribute').mockImplementation((name: string) => {
      if (name === 'data-kui-state') childAtRelease = child.getAttribute('style')
      realRemove(name)
    })

    set.restore()

    expect(childAtRelease).toBe(null)
    expect(host.outerHTML).toBe('<div><span></span></div>')
  })

  /**
   * Memoised per element, which is what makes "before" mean before this instance existed. A second
   * ledger handed out for an element the first has already written to would capture *this library's*
   * values as the author's own and restore to them — and the same element really is asked for
   * repeatedly, once per effect in a composed attribute and again by the stagger pass.
   */
  it('hands out one ledger pair per element, so a repeat ask cannot re-snapshot our own writes', () => {
    const host = document.createElement('div')
    host.style.opacity = '0.5'
    host.setAttribute('data-kui-step', 'author')
    const set = createLedgerSet(host)

    set.style(host).set('opacity', '0')
    set.attributes(host).set('data-kui-step', '1')
    expect(set.style(host)).toBe(set.style(host))
    expect(set.attributes(host)).toBe(set.attributes(host))

    // The second ask, after this library has already written, must still restore the author's.
    set.style(host).set('opacity', '1')
    set.attributes(host).set('data-kui-step', '2')
    set.restore()

    expect(host.style.opacity).toBe('0.5')
    expect(host.getAttribute('data-kui-step')).toBe('author')
  })

  it('restores an element it only ever handed an attribute ledger for, not just the styled ones', () => {
    const host = document.createElement('div')
    const child = document.createElement('a')
    host.append(child)
    const set = createLedgerSet(host)

    set.attributes(child).set('aria-current', 'true')
    set.restore()

    expect(child.hasAttribute('aria-current')).toBe(false)
  })

  /**
   * Two sets over one element, which memoising *within* a set cannot survive.
   *
   * One element really does get written by two hosts at once — two authored `data-kui` elements
   * whose `target:` resolves to the same node, a stagger group and the child's own `ElementState`,
   * a core effect and an advanced controller. Before the shared claim, the second set to write
   * opened its own `createStyleLedger` and captured the *first set's frame value* as the author's,
   * so whichever set restored last pinned the element to a library value forever.
   */
  it('two sets over one element share the capture, and the last one out restores', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const shared = document.createElement('p')
    first.append(shared)

    shared.style.setProperty('opacity', '0.2', 'important')

    const firstSet = createLedgerSet(first)
    const secondSet = createLedgerSet(second)
    firstSet.style(shared).set('opacity', '0.6')
    // After the first set has already written — the ordering a private ledger cannot survive.
    secondSet.style(shared).set('opacity', '0.9')
    expect(shared.style.opacity).toBe('0.9')

    firstSet.restore()
    // The second host is still driving this element. Handing the author's value back here would
    // put it underneath a live effect.
    expect(shared.style.opacity).toBe('0.9')

    secondSet.restore()
    expect(shared.style.opacity).toBe('0.2')
    expect(shared.style.getPropertyPriority('opacity')).toBe('important')
  })
})

/**
 * The shared per-element capture, asked directly rather than through a `LedgerSet`.
 *
 * `createLedgerSet` is one owner of it and `src/advanced/base.ts`'s `createAdvancedLedgers` is
 * another, and the contract they share — one capture per element, ref-counted by owner, restored
 * by whoever lets go last — belongs here rather than being inferred from either caller.
 */
describe('createStyleClaim', () => {
  it('lets the last owner out restore, not the first', () => {
    const el = document.createElement('div')
    el.style.setProperty('opacity', '0.2', 'important')
    const first = createStyleClaim()
    const second = createStyleClaim()

    first.style(el).set('opacity', '0.6')
    second.style(el).set('opacity', '0.9')
    expect(el.style.opacity).toBe('0.9')

    first.release(el)
    expect(el.style.opacity).toBe('0.9')

    second.release(el)
    expect(el.style.opacity).toBe('0.2')
    expect(el.style.getPropertyPriority('opacity')).toBe('important')
  })

  it('hands one owner the same handle every time, and releases it once', () => {
    const el = document.createElement('div')
    const claim = createStyleClaim()

    expect(claim.style(el)).toBe(claim.style(el))
    expect(claim.elements()).toEqual([el])

    claim.style(el).set('opacity', '0.6')
    // `restore()` on the handle is this owner letting go, which is the same thing `release` does —
    // not a second decrement of a claim already dropped.
    claim.style(el).restore()
    expect(el.hasAttribute('style')).toBe(false)
    expect(claim.elements()).toEqual([])
  })

  /**
   * A handle outliving its own release.
   *
   * Handles are held for a long time and released early: `PrepareContext.style` is handed to a
   * primitive once at prepare and kept for the element's whole life, a controller cancels and
   * re-activates, a `LedgerSet` is restored and the element is re-entered. The first version of
   * this registry closed each handle over the shared *entry*, so a write after release went
   * straight to a ledger the registry had already deleted and restored: the value landed on the
   * element, the claim was empty, and nothing anywhere would ever put it back. The author's
   * `!important` was gone for the life of the page with no effect running.
   *
   * Writing is claiming. A handle that writes takes the element back, whatever happened before.
   * Reading is not claiming: a released handle answers that it owns nothing rather than reporting
   * on a capture it has no part in.
   */
  it('a handle that writes after its own release claims the element again', () => {
    const el = document.createElement('div')
    el.style.setProperty('opacity', '0.2', 'important')
    const claim = createStyleClaim()
    const handle = claim.style(el)

    handle.set('opacity', '0.6')
    expect(handle.owned()).toEqual(['opacity'])

    handle.restore()
    expect(el.style.opacity).toBe('0.2')
    expect(claim.elements()).toEqual([])
    expect(handle.owned()).toEqual([])
    expect(handle.peek('opacity')).toBeUndefined()

    handle.set('opacity', '0.9')
    expect(el.style.opacity).toBe('0.9')
    // The decisive one: the write re-opened a claim, so there is an owner to restore it.
    expect(claim.elements()).toEqual([el])
    expect(handle.peek('opacity')).toBe('0.2')

    handle.restore()
    expect(el.style.opacity).toBe('0.2')
    expect(el.style.getPropertyPriority('opacity')).toBe('important')
  })

  /**
   * The half of "reading is not claiming" that the test above cannot reach.
   *
   * There, the released handle was the *only* owner, so the registry had already deleted the entry
   * and `owned()` had nothing to find however it looked. The answer only becomes a choice while a
   * second owner is still holding the element: a released handle that reads through to the live
   * shared entry would report that owner's properties as its own, and — because `peek` is what a
   * primitive consults for the value it will fall back to — hand out a capture it is not entitled
   * to restore. It must answer for itself, and it owns nothing.
   */
  it('a released handle owns nothing even while another owner still holds the element', () => {
    const el = document.createElement('div')
    el.style.opacity = '0.2'
    const mine = createStyleClaim()
    const other = createStyleClaim()
    const handle = mine.style(el)

    handle.set('opacity', '0.6')
    other.style(el).set('color', 'red')
    handle.restore()

    // The element is still held, still written, and still restorable — by the other owner.
    expect(el.style.opacity).toBe('0.6')
    expect(other.style(el).owned().sort((a, b) => a.localeCompare(b))).toEqual(['color', 'opacity'])

    // But not by this one. Reading did not rejoin, either.
    expect(handle.owned()).toEqual([])
    expect(handle.peek('opacity')).toBeUndefined()
    expect(mine.elements()).toEqual([])

    other.release(el)
    expect(el.style.opacity).toBe('0.2')
  })

  it('a claim() after release re-opens the claim as a write does', () => {
    const el = document.createElement('div')
    el.style.setProperty('height', '10px')
    const claim = createStyleClaim()
    const handle = claim.style(el)

    handle.claim('height')
    handle.restore()
    expect(claim.elements()).toEqual([])

    // `claim()` records without writing, and the recording is exactly as much of a claim on the
    // element as a `set()` is — `layout/primitives.ts` claims `height` and lets the browser write
    // it, so a `claim()` nobody owns loses the author's value just as completely.
    handle.claim('height')
    expect(claim.elements()).toEqual([el])
    el.style.setProperty('height', '99px')

    handle.restore()
    expect(el.style.height).toBe('10px')
  })

  /**
   * The attribute half of the same model. `animator.ts`'s `installMatch` stamps `data-kui-fx` and
   * `data-kui-rm` on every element a group's `target:` resolves to, and under `scope:page` two
   * authored hosts can resolve to the same element — so the second set captured the first's stamp
   * as the author's attribute and put *that* back.
   */
  it('shares one attribute capture per element, and the last owner out restores', () => {
    const el = document.createElement('div')
    el.setAttribute('data-kui-fx', 'author')
    const first = createAttributeClaim()
    const second = createAttributeClaim()

    first.attributes(el).set('data-kui-fx', 'fade-up')
    second.attributes(el).set('data-kui-fx', 'zoom-in')
    expect(el.getAttribute('data-kui-fx')).toBe('zoom-in')

    // Through the handle rather than the claim: a `LedgerSet` releases by element, but everything
    // holding only the ledger — every caller of `ledgers.attributes(el)` — says it is done by
    // calling `restore()` on the thing it was given.
    first.attributes(el).restore()
    expect(el.getAttribute('data-kui-fx')).toBe('zoom-in')
    expect(first.elements()).toEqual([])

    second.attributes(el).restore()
    expect(el.getAttribute('data-kui-fx')).toBe('author')
  })

  it('an attribute handle that writes after its own release claims the element again', () => {
    const el = document.createElement('div')
    const claim = createAttributeClaim()
    const handle = claim.attributes(el)

    handle.set('aria-current', 'true')
    handle.restore()
    expect(el.hasAttribute('aria-current')).toBe(false)

    handle.set('aria-current', 'page')
    expect(claim.elements()).toEqual([el])
    handle.restore()
    expect(el.hasAttribute('aria-current')).toBe(false)
  })

  /**
   * An element that cannot carry the registry property refuses the claim, loudly.
   *
   * `Object.defineProperty` throws on a frozen or non-extensible object, where the module-level
   * `WeakMap` this replaced never could. The tempting fix is to catch that and fall back to a
   * `WeakMap` — and it is wrong: the fallback is per *bundle*, so a page running `kuinetic.js` and
   * `kuinetic.advanced.js` against one frozen element gets two captures, which is the defect this
   * whole file exists to prevent, arriving silently. Throwing is contained where it happens:
   * `js-effect-preparer.ts` runs each `prepare` in a try/catch and warns `failed to initialise`
   * against the element. One odd element loses one effect and says so. This test is here so the
   * fallback is not re-invented.
   */
  it('refuses an element that cannot carry the registry property, rather than splitting it', () => {
    const el = document.createElement('div')
    el.style.opacity = '0.2'
    Object.freeze(el)

    expect(() => createStyleClaim().style(el).set('opacity', '0.6')).toThrow(TypeError)
    // Untouched: no half-open capture, and the author's value is exactly as they left it.
    expect(el.style.opacity).toBe('0.2')
  })

  it('ignores a release of an element this owner never claimed', () => {
    const el = document.createElement('div')
    const owner = createStyleClaim()
    const bystander = createStyleClaim()

    owner.style(el).set('opacity', '0.6')
    // Reached on every `LedgerSet.restore()`: the walk covers the union of styled and
    // attribute-stamped elements, and an attribute-only element has no style claim to drop.
    bystander.release(el)
    expect(el.style.opacity).toBe('0.6')
    expect(bystander.elements()).toEqual([])

    owner.release(el)
    expect(el.hasAttribute('style')).toBe(false)
  })

  it('answers owned() and peek() from the shared capture rather than from one owner\'s writes', () => {
    const el = document.createElement('div')
    el.style.setProperty('opacity', '0.2')
    const first = createStyleClaim()
    const second = createStyleClaim()

    first.style(el).set('opacity', '0.6')
    second.style(el).claim('color')

    // Two private ledgers would each list one property, and `peek('opacity')` through the second
    // owner would answer `undefined` — or, worse, `0.6`.
    expect(first.style(el).owned()).toEqual(['opacity', 'color'])
    expect(second.style(el).owned()).toEqual(['opacity', 'color'])
    expect(second.style(el).peek('opacity')).toBe('0.2')

    first.release(el)
    second.release(el)
    expect(el.style.opacity).toBe('0.2')
    expect(el.style.color).toBe('')
  })

  /**
   * Where the capture lives, which is what makes "one per element" true across *bundles* and not
   * only across owners. `scripts/build-tiers.mjs` builds `kuinetic.advanced.js` from its own entry
   * point, so that bundle inlines its own copy of this module; a module-level `WeakMap` would give
   * a page loading both one registry each and one element two captures. `Symbol.for` resolves
   * through the runtime's own global symbol registry, so both copies compute the same key.
   */
  it('keeps the entry on the element, under a key any copy of this module computes', () => {
    const el = document.createElement('div')
    const claim = createStyleClaim()
    claim.style(el).set('opacity', '0.6')

    const entries = (el as unknown as Record<symbol, Map<string, unknown> | undefined>)[
      Symbol.for('kuinetic.owned-styles.1')
    ]
    expect(entries?.get('style')).toBeDefined()
    // Not enumerable and not serialized — the author's markup is unchanged apart from the
    // property this library actually wrote.
    expect(Object.keys(el)).toEqual([])
    expect(el.outerHTML).toBe('<div style="opacity: 0.6;"></div>')

    claim.release(el)
    // Dropped with the last owner. A stale entry left here would be adopted by the next effect on
    // this element as if it were the author's capture.
    expect(entries?.get('style')).toBeUndefined()
    expect(el.hasAttribute('style')).toBe(false)
  })

  it('opens a fresh capture after the last owner has gone, not the one it just restored', () => {
    const el = document.createElement('div')
    el.style.opacity = '0.2'
    const first = createStyleClaim()

    first.style(el).set('opacity', '0.6')
    first.release(el)

    // The author moved on in between. A registry that kept the spent entry would restore `0.2`
    // here and silently undo a value it never owned.
    el.style.opacity = '0.4'
    const second = createStyleClaim()
    second.style(el).set('opacity', '0.9')
    second.release(el)
    expect(el.style.opacity).toBe('0.4')
  })
})
