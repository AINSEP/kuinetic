// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'
import {
  RING_FIT_PROPERTY,
  createRingFit,
  fitBounds,
  reachableAngles,
  solveRingFit,
} from '../src/effects/carousel/fit.js'
import type { RingFitGeometry } from '../src/effects/carousel/fit.js'

/**
 * The depth ring's fit to its page (`effects/carousel/fit.ts`).
 *
 * The solver is checked against closed forms it does not use: each case below is a ring whose
 * widest point has a formula (a flat card's half-width added to the rim; a radial card's corner at
 * `sqrt(R^2 + (w/2)^2)`; the live card magnified by `P / (P - R)`), so an error in the sampled
 * projection shows up as a number that disagrees with geometry, not with a copy of itself. The real
 * browser's projection is checked against the same solver in `test/browser/carousel-motion.test.mjs`.
 */

const base: RingFitGeometry = {
  width: 100,
  height: 60,
  perspective: Infinity,
  tiltDeg: 0,
  inside: false,
  facing: 'camera',
  fromDeg: -180,
  toDeg: 180,
  originOffset: 0,
  minX: -400,
  maxX: 400,
}

describe('reachableAngles', () => {
  it('is the whole circle for a full ring', () => {
    expect(reachableAngles(360, 6)).toEqual({ fromDeg: -180, toDeg: 180 })
    expect(reachableAngles(-720, 6)).toEqual({ fromDeg: -180, toDeg: 180 })
  })

  it('is the circular offsets widened by half a spacing each side', () => {
    // Nine over 180deg: offsets -4..4, spacing 20deg.
    expect(reachableAngles(180, 9)).toEqual({ fromDeg: -90, toDeg: 90 })
    // Eight over 120deg: offsets -3..4, spacing 15deg — lopsided, as the ring is.
    expect(reachableAngles(120, 8)).toEqual({ fromDeg: -52.5, toDeg: 67.5 })
  })

  it('orders a negative arc and treats an empty deck as one place', () => {
    expect(reachableAngles(-120, 8)).toEqual({ fromDeg: -67.5, toDeg: 52.5 })
    expect(reachableAngles(90, 0)).toEqual({ fromDeg: -45, toDeg: 45 })
  })
})

describe('solveRingFit against closed forms', () => {
  it('flat cards on an orthographic ring: the rim plus half a card', () => {
    expect(solveRingFit(base)).toBeCloseTo(400 - 50, 1)
  })

  it('radial cards on an orthographic ring: the corner at sqrt(R^2 + (w/2)^2)', () => {
    expect(solveRingFit({ ...base, facing: 'radial' })).toBeCloseTo(Math.sqrt(400 ** 2 - 50 ** 2), 1)
  })

  it('the live card alone under perspective: magnified by P / (P - R)', () => {
    const fit = solveRingFit({ ...base, perspective: 1000, fromDeg: 0, toDeg: 0 })
    // 50 * 1000 / (1000 - R) = 400  =>  R = 875
    expect(fit).toBeCloseTo(875, 1)
  })

  it('an inside ring counts only the front half: the edge-on card at a quarter turn is the limit', () => {
    // Everything past 90deg is hidden; the flat card at exactly 90deg reaches R + w/2.
    expect(solveRingFit({ ...base, inside: true })).toBeCloseTo(350, 1)
    // Under perspective the hidden back half would sit nearer the camera than the rim and be
    // magnified past it; the fit must not count it. The flat card at 90deg has z = 0, so still 350.
    expect(solveRingFit({ ...base, inside: true, perspective: 1000 })).toBeCloseTo(350, 1)
  })

  it('uses the tighter side when the ring is off-centre, and the slot offset from the origin', () => {
    expect(solveRingFit({ ...base, minX: -300 })).toBeCloseTo(250, 1)
    expect(solveRingFit({ ...base, originOffset: 50 })).toBeCloseTo(300, 1)
    expect(solveRingFit({ ...base, maxX: 300, originOffset: 50 })).toBeCloseTo(200, 1)
  })

  it('tilt moves the corners the ring reaches, so it moves the fit', () => {
    const tall = { ...base, perspective: 1200, height: 400 }
    const flat = solveRingFit(tall)
    const tilted = solveRingFit({ ...tall, tiltDeg: -60 })
    expect(Math.abs(tilted - flat)).toBeGreaterThan(5)
  })

  it('never lets a card reach the camera', () => {
    const fit = solveRingFit({ ...base, perspective: 500, minX: -1e6, maxX: 1e6, fromDeg: 0, toDeg: 0 })
    expect(fit).toBeLessThan(500)
    expect(fit).toBeGreaterThan(400)
  })

  it('is 0 when not even a card at the centre fits, and unbounded when every radius does', () => {
    expect(solveRingFit({ ...base, maxX: 40 })).toBe(0)
    // An inside slice of 120deg under perspective converges on P * tan(60deg) however large it gets.
    expect(solveRingFit({ ...base, inside: true, perspective: 900, fromDeg: -60, toDeg: 60, minX: -1e4, maxX: 1e4 })).toBe(Infinity)
  })

  it('floors to a hundredth of a pixel, so rounding never lands outside', () => {
    const fit = solveRingFit({ ...base, maxX: 400.007, minX: -400.007 })
    expect(Math.round(fit * 100)).toBe(fit * 100)
    expect(fit).toBeLessThanOrEqual(350.007)
  })
})

/** Stub a node's laid-out box. */
function box(node: Element, left: number, width: number, extra: Record<string, number> = {}): void {
  node.getBoundingClientRect = () => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} })
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(node, key, { configurable: true, value })
}

describe('fitBounds', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('is the page when nothing between the ring and <body> contains overflow, whatever <body> says', () => {
    document.body.innerHTML = '<div><div id="ring"></div></div>'
    document.body.style.overflowX = 'hidden'
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
    expect(fitBounds(document.getElementById('ring')!, window)).toEqual({ left: -0, right: 390 })
    document.body.style.overflowX = ''
  })

  it('is nothing at all under an ancestor that clips: the bleed is the author’s', () => {
    for (const value of ['clip', 'hidden']) {
      document.body.innerHTML = `<div style="overflow-x: ${value}"><div id="ring"></div></div>`
      expect(fitBounds(document.getElementById('ring')!, window)).toBeNull()
    }
  })

  it('is the padding box of an ancestor that would scroll', () => {
    for (const value of ['auto', 'scroll']) {
      document.body.innerHTML = `<div id="scroller" style="overflow-x: ${value}"><div id="ring"></div></div>`
      box(document.getElementById('scroller')!, 20, 300, { clientLeft: 2, clientWidth: 280 })
      expect(fitBounds(document.getElementById('ring')!, window)).toEqual({ left: 22, right: 302 })
    }
  })
})

/**
 * This window, with `getComputedStyle` reporting a perspective for the ring and frames that run on
 * demand. Spied rather than faked wholesale: the deck reads more of the window than the fit does.
 */
function layoutWin(style: Partial<CSSStyleDeclaration>): { win: Window; flush: () => void } {
  let pending: FrameRequestCallback | undefined
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element) => {
    const computed = real(node)
    if (node.id !== 'ring') return computed
    return new Proxy(computed, {
      get: (target, key) => (key in style ? style[key as keyof CSSStyleDeclaration] : Reflect.get(target, key)),
    })
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pending = callback
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    pending = undefined
  })
  return {
    win: window,
    flush: () => {
      const run = pending
      pending = undefined
      run?.(0)
    },
  }
}

function mountRing(html: string, win: Window, params: Record<string, string> = {}) {
  document.body.innerHTML = html
  const host = document.getElementById('ring')!
  const ctx = { win, doc: document, reducedMotion: false, warn: () => {}, style: createStyleLedger(host) } as unknown as PrepareContext
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(host, readEffectParams(params, SPATIAL_RING_PRIMITIVE.parameters, () => {}), ctx)
  return { host, instance }
}

const RING = '<div id="ring"><div class="slide">1</div><div class="slide">2</div><div class="slide">3</div><div class="slide">4</div></div>'
/** The same ring with one wrapper per slide: the child `facing:camera` counter-rotates. */
const WRAPPED = RING.replace(/>(\d)</g, '><p>$1</p><')

describe('the fit on a live ring', () => {
  afterEach(() => {
    document.body.replaceChildren()
    document.body.removeAttribute('style')
    vi.restoreAllMocks()
  })

  function page(width: number): void {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  }

  it('publishes the solved radius, re-solves on resize, and gives the property back on destroy', () => {
    page(390)
    const { win, flush } = layoutWin({ perspective: 'none', perspectiveOrigin: '195px 40px' } as Partial<CSSStyleDeclaration>)
    const { host: live, instance } = mountRing(RING, win)
    box(live, 0, 390)
    box(live.children[0]!, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
    instance.activate()
    // Flat cards (`facing:radial`, orthographic here): the corner reaches sqrt(R^2 + 50^2) = 195.
    const radial = Math.floor(Math.sqrt(195 ** 2 - 50 ** 2) * 100) / 100
    expect(live.style.getPropertyValue(RING_FIT_PROPERTY)).toBe(`${radial}px`)

    page(300)
    win.dispatchEvent(new Event('resize'))
    flush()
    // Same host box, narrower page: the right edge is now 105px from the origin.
    expect(parseFloat(live.style.getPropertyValue(RING_FIT_PROPERTY))).toBeLessThan(radial)

    instance.destroy()
    expect(live.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
    page(390)
    win.dispatchEvent(new Event('resize'))
    flush()
    expect(live.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
  })

  it('reads the inside name, the tilt and the facing off the ring it serves', () => {
    page(390)
    const { win } = layoutWin({ perspective: '900px', perspectiveOrigin: '195px 40px' } as Partial<CSSStyleDeclaration>)
    const read = (fx: string, params: Record<string, string>, html = RING): string => {
      const { host, instance } = mountRing(html, win, params)
      host.setAttribute('data-kui-fx', fx)
      box(host, 0, 390)
      box(host.children[0]!, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
      instance.activate()
      const value = host.style.getPropertyValue(RING_FIT_PROPERTY)
      instance.destroy()
      return value
    }
    const outside = read('carousel-3d', {})
    // On a full ring both are bound by the card edge-on at a quarter turn, so compare them on a slice.
    const slice = read('carousel-3d', { arc: '120deg' })
    const inside = read('carousel-3d-inside', { arc: '120deg' })
    const tilted = read('carousel-3d', { tilt: '40deg' })
    const camera = read('carousel-3d', { facing: 'camera' }, WRAPPED)
    expect(new Set([outside, tilted, camera]).size, JSON.stringify([outside, tilted, camera])).toBe(3)
    // A bare-text slot has no child to counter-rotate, so the stylesheet draws it radial.
    expect(read('carousel-3d', { facing: 'camera' })).toBe(outside)
    expect(inside).not.toBe(slice)
  })

  it('publishes nothing for a card not laid out, a clipped ring, or a flat ring', () => {
    page(390)
    const { win } = layoutWin({ perspective: '900px', perspectiveOrigin: '' } as Partial<CSSStyleDeclaration>)

    const unlaid = mountRing(RING, win)
    box(unlaid.host, 0, 390)
    unlaid.instance.activate()
    expect(unlaid.host.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
    unlaid.instance.destroy()

    const clipped = mountRing(`<div style="overflow-x: clip">${RING}</div>`, win)
    box(clipped.host.children[0]!, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
    clipped.instance.activate()
    expect(clipped.host.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
    clipped.instance.destroy()

    const flat = mountRing(RING, win, { plane: 'screen' })
    box(flat.host, 0, 390)
    box(flat.host.children[0]!, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
    flat.instance.activate()
    expect(flat.host.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
    flat.instance.destroy()
  })

  it('publishes nothing when the page leaves room for any radius', () => {
    page(100_000)
    const { win } = layoutWin({ perspective: '900px', perspectiveOrigin: '50000px 40px' } as Partial<CSSStyleDeclaration>)
    const { host, instance } = mountRing(RING, win, { arc: '120deg' })
    host.setAttribute('data-kui-fx', 'carousel-3d-inside')
    box(host, 0, 100_000)
    box(host.children[0]!, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
    instance.activate()
    expect(host.style.getPropertyValue(RING_FIT_PROPERTY)).toBe('')
    instance.destroy()
  })

  it('solves once per change of card or count, not on every render', () => {
    page(390)
    const { win } = layoutWin({ perspective: '900px', perspectiveOrigin: '195px 40px' } as Partial<CSSStyleDeclaration>)
    const styles = { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: vi.fn(() => []), peek: vi.fn() }
    document.body.innerHTML = RING
    const host = document.getElementById('ring')!
    box(host, 0, 390)
    const cards = [...host.children]
    for (const card of cards) box(card, 0, 0, { offsetWidth: 100, offsetHeight: 60 })
    const fit = createRingFit({ el: host, ctx: { win } as unknown as PrepareContext, styles, arcDeg: 360, tiltParamDeg: 0, facing: 'radial' })
    fit.render(cards, 4)
    fit.render(cards, 4)
    expect(styles.set).toHaveBeenCalledTimes(1)
    fit.render(cards, 3)
    fit.render(cards.slice(1), 3)
    expect(styles.set).toHaveBeenCalledTimes(3)
    fit.release()
  })

  it('watches both the host and the page for size changes', () => {
    const observed: Element[] = []
    class FakeResizeObserver {
      observe(node: Element): void {
        observed.push(node)
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const styles = { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: vi.fn(() => []), peek: vi.fn() }
    const host = document.createElement('div')
    const fit = createRingFit({ el: host, ctx: { win: window } as unknown as PrepareContext, styles, arcDeg: 360, tiltParamDeg: 0, facing: 'radial' })
    expect(observed).toEqual([host, document.documentElement])
    fit.release()
    vi.unstubAllGlobals()
  })

  it('does nothing in a realm with no layout', () => {
    const styles = { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: vi.fn(() => []), peek: vi.fn() }
    const host = document.createElement('div')
    for (const win of [{}, { getComputedStyle: () => ({}) }]) {
      const fit = createRingFit({ el: host, ctx: { win } as unknown as PrepareContext, styles, arcDeg: 360, tiltParamDeg: 0, facing: 'radial' })
      fit.render([host], 1)
      fit.release()
    }
    expect(styles.set).not.toHaveBeenCalled()
  })
})
