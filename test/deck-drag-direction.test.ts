// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { travelSign } from '../src/effects/carousel/deck.js'
import { SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'

/**
 * A drag moves the card under the pointer the way the pointer went, whatever the deck's shape.
 *
 * The direction is read off where the cards are on screen (`deck.ts`'s `travelSign`), so these
 * stand in a layout: each slot's box is placed from its published offset, the way the stylesheet
 * would place it — outside a ring the next card is to the right, from inside one it is to the left.
 * Which name produces which layout is the stylesheet's (`carousel.css`, `translateZ(±r)`) and the
 * browser tier's (`test/browser/deck-drag-direction.test.mjs`) to prove; this proves the drag obeys
 * whatever the layout is.
 */

const SPACING_PX = 100
let side: 1 | -1 = 1

function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, number>
  Object.assign(event, { clientX, clientY: 0, pointerId: 1, button: 0 })
  return event
}

function fakeCtx(el: Element): PrepareContext {
  return {
    win: {
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (handle: number) => clearTimeout(handle),
      requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
      cancelAnimationFrame: (handle: number) => cancelAnimationFrame(handle),
      getComputedStyle: (node: Element) => window.getComputedStyle(node),
    } as unknown as Window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

function mount(params: Record<string, string> = {}, count = 6): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = `<div>${'<div class="slide">x</div>'.repeat(count)}</div>`
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(
    host,
    readEffectParams({ target: '.slide', ...params }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
    fakeCtx(host),
  )
  instance.activate()
  return { host, instance }
}

const place = (host: HTMLElement): number => Number(host.style.getPropertyValue('--kui-step-position'))

/** Signed places from `from` to `to` on a six-card deck, the short way round. */
function moved(from: number, to: number): number {
  const raw = (((to - from) % 6) + 6) % 6
  return raw > 3 ? raw - 6 : raw
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  })
  side = 1
  // The stand-in layout: a slot's centre is its offset times the spacing, on `side`.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const offset = Number(this.getAttribute('data-kui-step-offset'))
    const x = 500 + side * offset * SPACING_PX
    return { left: x - 40, width: 80, top: 0, height: 60, right: x + 40, bottom: 60, x: x - 40, y: 0 } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('travelSign', () => {
  it('is 1 when the next card is on the right, -1 when on the left', () => {
    expect(travelSign(500, 600, 400)).toBe(1)
    expect(travelSign(500, 400, 600)).toBe(-1)
  })

  it('falls back to the previous card, then to 1', () => {
    expect(travelSign(500, null, 400)).toBe(1)
    expect(travelSign(500, null, 600)).toBe(-1)
    expect(travelSign(500, null, null)).toBe(1)
    // No layout: every box at 0.
    expect(travelSign(0, 0, 0)).toBe(1)
  })
})

describe('a drag moves the cards with the pointer', () => {
  /** Drag left by half a place of travel, slowly, and return how far the deck's place moved. */
  function dragLeft(host: HTMLElement): { mid: number; settled: number } {
    const from = place(host)
    host.dispatchEvent(pointer('pointerdown', 500))
    for (let x = 490; x >= 390; x -= 10) {
      vi.advanceTimersByTime(200)
      host.dispatchEvent(pointer('pointermove', x))
    }
    const mid = moved(from, place(host))
    vi.advanceTimersByTime(200)
    host.dispatchEvent(pointer('pointerup', 390))
    return { mid, settled: moved(from, place(host)) }
  }

  it('outside a ring (next card on the right): a left drag advances', () => {
    const { host, instance } = mount({ travel: '220' })
    const { mid } = dragLeft(host)
    expect(mid).toBeCloseTo(110 / 220, 5)
    instance.destroy()
  })

  it('inside a ring (next card on the left): a left drag goes back', () => {
    side = -1
    const { host, instance } = mount({ travel: '220' })
    const { mid } = dragLeft(host)
    expect(mid).toBeCloseTo(-110 / 220, 5)
    instance.destroy()
  })

  /** 100px left at 1000px/s: under half a place dragged, about 1.3 more projected — two in all. */
  function flickLeft(host: HTMLElement): void {
    host.dispatchEvent(pointer('pointerdown', 500))
    for (let x = 490; x >= 400; x -= 10) {
      vi.advanceTimersByTime(10)
      host.dispatchEvent(pointer('pointermove', x))
    }
    host.dispatchEvent(pointer('pointerup', 400))
  }

  it('a fast flick coasts the way the hand went, outside and inside', () => {
    const outside = mount({ travel: '220' })
    flickLeft(outside.host)
    expect(outside.host.getAttribute('data-kui-step')).toBe('2')
    outside.instance.destroy()

    side = -1
    const inside = mount({ travel: '220' })
    flickLeft(inside.host)
    expect(inside.host.getAttribute('data-kui-step')).toBe('4')
    inside.instance.destroy()
  })

  it('a deck too small to have neighbours, or no cards at all, still drags without throwing', () => {
    side = -1
    for (const count of [0, 1, 2]) {
      const { host, instance } = mount({ travel: '220' }, count)
      expect(() => dragLeft(host)).not.toThrow()
      instance.destroy()
    }
  })

  it('inside a ring spinning backwards: the drag still follows the pointer', () => {
    side = -1
    const { host, instance } = mount({ travel: '220', spin: '-40s' })
    vi.advanceTimersByTime(500)
    const { mid } = dragLeft(host)
    // Not to the digit: the spin runs on between the press and the drag threshold (200ms of a
    // 40s backwards turn, ~0.03 of a place), the same direction a backwards drag goes.
    expect(mid).toBeCloseTo(-110 / 220, 1)
    expect(mid).toBeLessThan(0)
    instance.destroy()
  })
})
