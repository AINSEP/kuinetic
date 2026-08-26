import { afterEach, describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import { resolveParams } from '../src/core/params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { registerThreeD } from '../src/effects/three-d/index.js'

function registry(): Registry {
  return registerThreeD(new Registry())
}

function fakeCtx(el: Element, overrides: Partial<PrepareContext> = {}): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
    ...overrides,
  } as unknown as PrepareContext
}

/** A card with the markup `flip-card` documents: two faces plus the control that holds the state. */
function buildCard(): { card: HTMLElement; control: HTMLElement } {
  const card = document.createElement('div')
  card.innerHTML =
    '<div class="kui-face-front"></div><div class="kui-face-back"></div>' +
    '<button type="button" class="kui-flip-control" aria-pressed="false"></button>'
  document.body.append(card)
  return { card, control: card.querySelector('.kui-flip-control') as HTMLElement }
}

function mount(card: Element, params: Record<string, string>, ctx?: PrepareContext) {
  const resolved = registry().resolve('flip-card')!
  const instance = resolved.primitive.prepare!(card, createParams(params), ctx ?? fakeCtx(card))
  instance.activate()
  return instance
}

const enter = (el: Element): void => {
  el.dispatchEvent(new Event('pointerenter'))
}
const leave = (el: Element): void => {
  el.dispatchEvent(new Event('pointerleave'))
}
const flipped = (control: Element): boolean => control.getAttribute('aria-pressed') === 'true'

afterEach(() => {
  document.body.replaceChildren()
})

describe('flip-card trigger:', () => {
  it('accepts each documented value and rejects anything else', () => {
    const { parameters } = registry().resolve('flip-card')!.primitive
    // `resolveParams` keys its output by each spec's `cssProperty`, not by the authored name.
    for (const value of ['click', 'hover', 'hover-latch', 'hover-toggle']) {
      expect(resolveParams({ trigger: value }, parameters, () => {})).toMatchObject({
        '--kui-flip-trigger': value,
      })
    }
    expect(resolveParams({ trigger: 'mouseover' }, parameters, () => {})).toEqual({})
  })

  it('defaults to click, which wires no hover listener at all', () => {
    const { card, control } = buildCard()
    const instance = mount(card, {})
    enter(card)
    expect(flipped(control)).toBe(false)
    instance.destroy()
  })

  // The three hover modes differ only in what happens *after* the pointer leaves, so that is
  // exactly what each case below asserts.
  it('trigger:hover flips on enter and back on leave', () => {
    const { card, control } = buildCard()
    const instance = mount(card, { trigger: 'hover' })

    enter(card)
    expect(flipped(control)).toBe(true)
    leave(card)
    expect(flipped(control)).toBe(false)

    instance.destroy()
  })

  it('trigger:hover-latch flips once and never comes back', () => {
    const { card, control } = buildCard()
    const instance = mount(card, { trigger: 'hover-latch' })

    enter(card)
    leave(card)
    expect(flipped(control)).toBe(true)
    enter(card)
    leave(card)
    expect(flipped(control)).toBe(true)

    instance.destroy()
  })

  it('trigger:hover-toggle stays on leave, and the next enter turns it back', () => {
    const { card, control } = buildCard()
    const instance = mount(card, { trigger: 'hover-toggle' })

    enter(card)
    leave(card)
    expect(flipped(control)).toBe(true)
    enter(card)
    expect(flipped(control)).toBe(false)
    leave(card)
    expect(flipped(control)).toBe(false)

    instance.destroy()
  })

  it('no-ops on a coarse pointer, where an enter fires from a tap', () => {
    const { card, control } = buildCard()
    const coarseWin = { matchMedia: () => ({ matches: false }) } as unknown as Window
    const instance = mount(card, { trigger: 'hover-toggle' }, fakeCtx(card, { win: coarseWin }))

    enter(card)
    expect(flipped(control)).toBe(false)

    instance.destroy()
  })

  it('releases its listener on destroy', () => {
    const { card, control } = buildCard()
    mount(card, { trigger: 'hover' }).destroy()
    enter(card)
    expect(flipped(control)).toBe(false)
  })

  it('does not throw on a card that has no control to hold the state', () => {
    const card = document.createElement('div')
    document.body.append(card)
    const instance = mount(card, { trigger: 'hover' })
    expect(() => enter(card)).not.toThrow()
    instance.destroy()
  })
})
