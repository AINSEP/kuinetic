// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { travelSign } from '../src/effects/carousel/deck.js'
import { faceAt, SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'

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
let geometry = false
const radians = (a: number): number => a * Math.PI / 180
const turnY = (a: number): string => {
  const c = Math.cos(radians(a)), s = Math.sin(radians(a))
  return `matrix3d(${[c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1].join(',')})`
}
const MIRROR = 'matrix(-1,0,0,1,0,0)'
const FLIP_X = 'matrix3d(1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1)'
const place = (host: HTMLElement): number => Number(host.style.getPropertyValue('--kui-step-position'))
function moved(from: number, to: number, count = 6): number {
  const raw = (((to - from) % count) + count) % count
  return raw > count / 2 ? raw - count : raw
}

/** CSS rotateX(tilt) rotateY(angle) translateZ(radius), resolved for a real card fixture. */
function cardMatrix(card: HTMLElement): number[] {
  const host = card.closest<HTMLElement>('[data-test-ring]')!
  const count = Number(host.style.getPropertyValue('--kui-item-count')) || 1
  const drift = place(host) - Number(host.getAttribute('data-kui-step'))
  const a = radians((Number(card.getAttribute('data-kui-step-offset')) - drift) *
    (Number.parseFloat(host.style.getPropertyValue('--kui-arc')) || 360) / count)
  const t = radians(-Number.parseFloat(host.style.getPropertyValue('--kui-tilt') || '0'))
  const c = Math.cos(a), s = Math.sin(a), ct = Math.cos(t), st = Math.sin(t)
  const r = host.matches('[data-kui-fx~="carousel-3d-inside"]') ? -240 : 240
  return [c, st*s, -ct*s, 0, 0, ct, st, 0, s, -st*c, ct*c, 0, r*s, -r*st*c, r*ct*c, 1]
}

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

function mount(params: Record<string, string> = {}, count = 6, transform?: string, flat?: string) {
  document.body.innerHTML = `<div data-test-ring>${'<div class="slide">x</div>'.repeat(count)}</div>`
  const host = document.body.firstElementChild as HTMLElement
  if (flat) {
    const outerSlide = document.createElement('div')
    outerSlide.style.transform = flat
    outerSlide.style.transformStyle = 'flat'
    outerSlide.setAttribute('data-kui-step-offset', '6')
    host.before(outerSlide)
    outerSlide.append(host)
  }
  let rig = host
  if (transform !== undefined) {
    geometry = true
    host.style.transformStyle = 'preserve-3d'
    rig = document.createElement('div')
    rig.style.transformStyle = 'preserve-3d'
    rig.style.transform = transform
    rig.append(...host.children)
    host.append(rig)
  }
  for (const key of ['arc', 'tilt']) if (params[key]) host.style.setProperty(`--kui-${key}`, params[key])
  const instance: EffectInstance = SPATIAL_RING_PRIMITIVE.prepare!(
    host, readEffectParams({ target: '.slide', ...params }, SPATIAL_RING_PRIMITIVE.parameters, () => {}), fakeCtx(host),
  )
  instance.activate()
  return { host, rig, cards: [...host.querySelectorAll<HTMLElement>('.slide')], instance }
}
const ring = (params: Record<string, string> = {}, count = 12, transform = turnY(180), flat?: string) =>
  mount({ radius: '240px', ...params }, count, transform, flat)
function leftMove(host: HTMLElement): number {
  const from = place(host)
  host.dispatchEvent(pointer('pointerdown', 500))
  host.dispatchEvent(pointer('pointermove', 456))
  return moved(from, place(host))
}
function expectFaces(cards: HTMLElement[], degrees = 0): void {
  for (const card of cards) {
    const host = card.closest<HTMLElement>('[data-test-ring]')!
    const drift = place(host) - Number(host.getAttribute('data-kui-step'))
    const expected = faceAt((Number(card.getAttribute('data-kui-step-offset')) - drift) * 30 + degrees)
    expect(card.getAttribute('data-kui-ring-face')).toBe(expected)
    expect(card.hasAttribute('inert')).toBe(expected === 'back')
  }
}
const flush = async (): Promise<void> => { await Promise.resolve(); vi.advanceTimersByTime(32) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  side = 1
  geometry = false
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
    const style = computed(node)
    if (!geometry || !node.matches('.slide')) return style
    return new Proxy(style, { get: (target, key) =>
      key === 'transform' ? `matrix3d(${cardMatrix(node as HTMLElement).join(',')})` : Reflect.get(target, key) })
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const x = 500 + side * Number(this.getAttribute('data-kui-step-offset')) * SPACING_PX
    return { left: x-40, width: 80, top: 0, height: 60, right: x+40, bottom: 60, x: x-40, y: 0 } as DOMRect
  })
})

describe('the ring in its 3D context', () => {
  it.each([110, 180, 540])('uses the front side through a %s° wrapper', angle => {
    const { host, instance } = ring({}, 12, turnY(angle))
    expect(leftMove(host)).toBeCloseTo(0.2)
    instance.destroy()
  })
  it.each([89, 180, 250, -179])('marks every face through %s°', angle => {
    const { cards, instance } = ring({}, 12, turnY(angle))
    expectFaces(cards, angle)
    instance.destroy()
  })
  it('measures at drag start and holds the sign through the gesture', () => {
    const { host, rig, instance } = ring({}, 12, turnY(0))
    rig.style.transform = FLIP_X
    expect(leftMove(host)).toBeCloseTo(-0.2)
    rig.style.transform = turnY(0)
    host.dispatchEvent(pointer('pointermove', 412))
    expect(place(host)).toBeCloseTo(-0.4)
    instance.destroy()
  })
  it('refreshes idle faces on scroll through the wrapper inside the host', () => {
    const { rig, cards, instance } = ring({}, 12, turnY(0))
    rig.style.transform = turnY(180)
    document.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(32)
    expectFaces(cards, 180)
    instance.destroy()
  })
  it.each(['pointerenter', 'focusin'])('accepts stale timer-only turns until %s', async event => {
    const { host, rig, cards, instance } = ring({}, 12, turnY(0))
    rig.style.transform = turnY(180)
    await flush()
    expectFaces(cards)
    host.dispatchEvent(new Event(event))
    expectFaces(cards, 180)
    instance.destroy()
  })
  it('preserves the inside slice and reverses inward travel', () => {
    for (const angle of [0, 180]) {
      const { host, cards, instance } = ring({ arc: '120deg', tilt: '30deg' }, 12, turnY(angle))
      host.setAttribute('data-kui-fx', 'carousel-3d-inside')
      expect(cards.every(card => card.getAttribute('data-kui-ring-face') === (angle ? 'back' : 'front'))).toBe(true)
      if (!angle) expect(leftMove(host)).toBeCloseTo(-0.2)
      instance.destroy()
    }
    const { host, instance } = ring({ tilt: '30deg' })
    host.setAttribute('data-kui-fx', 'carousel-3d-inside')
    expect(leftMove(host)).toBeCloseTo(-0.2)
    instance.destroy()
  })
  it('composes host and intermediate wrapper turns with tilt', () => {
    const { host, cards, instance } = ring({ tilt: '65deg' }, 12, turnY(110))
    host.style.transform = turnY(70)
    expect(leftMove(host)).toBeCloseTo(0.2)
    expectFaces(cards, 180)
    instance.destroy()
  })
  it.each([1, 2, 3])('uses near-side travel with %s cards, without reading cards', count => {
    const { host, cards, instance } = ring({ spin: '-2s' }, count, FLIP_X)
    vi.advanceTimersByTime(256)
    const style = vi.mocked(window.getComputedStyle).getMockImplementation()!
    let cardReads = 0
    vi.mocked(window.getComputedStyle).mockImplementation(node => {
      if (cards.includes(node as HTMLElement) && host.getAttribute('data-kui-ring-dragging') !== 'true') cardReads++
      return style(node)
    })
    const from = place(host)
    host.dispatchEvent(pointer('pointerdown', 500))
    host.dispatchEvent(pointer('pointermove', 456))
    expect(moved(from, place(host), count)).toBeCloseTo(-0.2)
    expect(cardReads).toBe(0)
    instance.destroy()
  })
  it.each([false, true])('stops at a flat outer slide (grouped: %s)', grouped => {
    const { host, cards, instance } = ring({}, 12, turnY(0), turnY(180))
    if (grouped) {
      host.parentElement!.style.transformStyle = 'preserve-3d'
      host.parentElement!.style.opacity = '0.5'
      host.dispatchEvent(new Event('pointerenter'))
    }
    expectFaces(cards)
    expect(leftMove(host)).toBeCloseTo(-0.2)
    instance.destroy()
  })
  it('keeps faces on a mirrored wrapper and reverses travel', () => {
    const { host, cards, instance } = ring({}, 12, MIRROR)
    expectFaces(cards)
    expect(leftMove(host)).toBeCloseTo(-0.2)
    instance.destroy()
  })
  it('reflects a flat picture without changing its card faces', () => {
    const { host, cards, instance } = ring({}, 12, turnY(0), MIRROR)
    expectFaces(cards)
    expect(leftMove(host)).toBeCloseTo(-0.2)
    instance.destroy()
  })
  it('composes two flat quarter turns with a mirrored picture', () => {
    const { host, cards, instance } = ring({}, 12, turnY(0), MIRROR)
    for (let i = 0; i < 2; i++) {
      const outer = document.createElement('div')
      outer.style.transform = 'matrix(0,1,-1,0,0,0)'
      host.parentElement!.before(outer)
      outer.append(host.parentElement!)
    }
    host.dispatchEvent(new Event('pointerenter'))
    expectFaces(cards)
    expect(leftMove(host)).toBeCloseTo(0.2)
    instance.destroy()
  })
  it('does no reads on an unturned spin or scroll', async () => {
    const { host, rig, cards, instance } = ring({ spin: '40s', tilt: '30deg' }, 12, turnY(0))
    rig.replaceWith(...cards) // ordinary ring: the host is the only preserve-3d link
    host.dispatchEvent(new Event('pointerenter'))
    await flush()
    const reads = vi.mocked(window.getComputedStyle).mock.calls.length
    for (let i = 0; i < 8; i++) {
      document.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    }
    expect(vi.mocked(window.getComputedStyle).mock.calls.length).toBe(reads)
    host.style.transform = turnY(180) // a resize media query can change this transform
    window.dispatchEvent(new Event('resize'))
    expectFaces(cards, 180)
    instance.destroy()
  })
  it('leaves plane:screen unchanged and releases pending updates on teardown', () => {
    const { host, cards, instance } = ring({ plane: 'screen' })
    expect(cards.every(card => card.getAttribute('data-kui-ring-face') === 'front')).toBe(true)
    expect(leftMove(host)).toBeCloseTo(0.2) // existing rectangle fixture
    document.dispatchEvent(new Event('scroll'))
    instance.destroy()
    const reads = vi.mocked(window.getComputedStyle).mock.calls.length
    vi.advanceTimersByTime(32)
    expect(vi.mocked(window.getComputedStyle).mock.calls.length).toBe(reads)
    expect(cards.every(card => !card.hasAttribute('data-kui-ring-face'))).toBe(true)
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
