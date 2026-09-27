// @vitest-environment jsdom
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
    // Prepare now runs `prepareCard` (target:-everywhere reconcile R-7), which reads `ctx.signal`
    // synchronously to register the parts' cleanup — every `mount()` below goes through it, even
    // though this file never asserts on that cleanup itself (nothing here calls `.abort()`).
    signal: new AbortController().signal,
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

  // Moved from `test/three-d.test.ts` (target:-everywhere reconcile, full-suite gate): that file is
  // deliberately DOM-free and used to call `prepare(undefined, {}, undefined)` directly, which
  // R-7's now-eager `prepareFlipParts` call can no longer tolerate — it stamps faces and injects a
  // control right away, so it needs a real element. The behavioural guarantee that check made still
  // holds and still needs covering: a `renderer: 'javascript'` primitive is handed to the animator,
  // which calls every hook on the instance it returns, so activate/cancel/finish/destroy all being
  // safe — and `finished` settling — has to be true on the default (click) path, here with the real
  // card this file already builds one for.
  it('is safe through its full lifecycle on the default (click) path', async () => {
    const { card } = buildCard()
    const instance = mount(card, {})

    expect(() => {
      instance.cancel()
      instance.finish()
      instance.destroy()
    }).not.toThrow()
    // Already settled, so the animator's `finished` bookkeeping cannot strand `data-kui-state` on
    // "running" for the life of the page.
    await expect(instance.finished).resolves.toBeUndefined()
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

  // Pre-target:-everywhere, a card authored with no control at all left `prepareCardToggle`'s
  // lookup empty and it silently bailed out. `prepareFlipParts`'s injected-control fallback
  // (target:-everywhere 7a, wired to prepare time by reconcile R-7) means there is no such thing
  // as "no control" any more — one gets built and wired instead — so this now asserts the
  // replacement behaviour rather than a no-op.
  it('injects a control and flips it, on a card authored with none at all', () => {
    const card = document.createElement('div')
    document.body.append(card)
    const instance = mount(card, { trigger: 'hover' })
    const control = card.querySelector('.kui-flip-control')
    expect(control).not.toBeNull()
    expect(() => enter(card)).not.toThrow()
    expect(flipped(control!)).toBe(true)
    instance.destroy()
  })
})
