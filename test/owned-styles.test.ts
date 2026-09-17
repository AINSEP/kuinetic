import { describe, expect, it } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'

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
