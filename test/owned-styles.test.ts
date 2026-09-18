import { describe, expect, it, vi } from 'vitest'
import { createAttributeLedger, createLedgerSet, createStyleLedger } from '../src/core/owned-styles.js'

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
})
