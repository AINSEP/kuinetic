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
