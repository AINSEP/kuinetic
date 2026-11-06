// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import { validate } from '../src/core/params.js'
import { createFlipEngine } from '../src/core/flip.js'
import type { Box } from '../src/core/flip.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { ParamSpec } from '../src/core/types.js'
import { SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'

/** Gaps found by the 100% coverage gate on 2026-11-06; each test asserts behaviour, not just reach. */

describe('an empty calc() body', () => {
  const length: ParamSpec = { type: 'length', default: '24px', cssProperty: '--kui-distance' }

  it.each(['calc()', 'calc(   )', 'calc(var(--x) + calc())'])('is rejected as a length: %s', (value) => {
    expect(validate(value, length)).toMatchObject({ ok: false, value: '24px' })
  })

  it('still accepts a non-empty calc beside it', () => {
    expect(validate('calc(1px + calc(2px))', length).ok).toBe(true)
  })
})

describe('cancelling a nested FLIP run', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cancels the clock, every paint animation and the pending frame', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7))
    const cancelFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const nodes = [document.createElement('div'), document.createElement('div')]
    const boxes = new Map<Element, Box[]>(nodes.map((node, i) => [node, [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 40 * (i + 1), y: 30, width: 100, height: 50 },
    ]]))
    const reads = new Map<Element, number>()
    const animations: Array<{ cancel: ReturnType<typeof vi.fn> }> = []
    const engine = createFlipEngine({
      measure(el) {
        const n = reads.get(el) ?? 0
        reads.set(el, n + 1)
        return boxes.get(el)![Math.min(n, 1)]!
      },
      animate() {
        const animation = {
          cancel: vi.fn(),
          pause: vi.fn(),
          finished: new Promise<void>(() => {}),
          playbackRate: 1,
          effect: { getComputedTiming: () => ({ progress: 0.5 }), setKeyframes: vi.fn() },
        }
        animations.push(animation)
        return animation as unknown as Animation
      },
    })
    const before = engine.snapshot(nodes)

    const run = engine.play(before, nodes, { nested: true })
    expect(run.moved).toEqual(nodes)
    expect(animations).toHaveLength(3)
    animations.forEach((animation) => expect(animation.cancel).not.toHaveBeenCalled())

    run.cancel()

    expect(cancelFrame).toHaveBeenCalledWith(7)
    animations.forEach((animation) => expect(animation.cancel).toHaveBeenCalledTimes(1))
  })
})

describe('a nested FLIP run with nothing to move', () => {
  it('starts no animation, and cancelling it is a harmless no-op', async () => {
    const node = document.createElement('div')
    const animate = vi.fn()
    const engine = createFlipEngine({ measure: () => ({ x: 5, y: 5, width: 100, height: 50 }), animate })
    const run = engine.play(engine.snapshot([node]), [node], { nested: true })

    expect(run.moved).toEqual([])
    expect(() => run.cancel()).not.toThrow()
    await expect(run.finished).resolves.toBeUndefined()
    expect(animate).not.toHaveBeenCalled()
  })
})

describe('ring travel direction through unusual 3D contexts', () => {
  let side: 1 | -1 = 1
  const FLAT_QUARTER_TURN_X = 'matrix3d(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1)'
  const TURN_Y_180 = 'matrix3d(-1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1)'

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    side = 1
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const x = 500 + side * Number(this.getAttribute('data-kui-step-offset')) * 100
      return { left: x - 40, width: 80, top: 0, height: 60, right: x + 40, bottom: 60, x: x - 40, y: 0 } as DOMRect
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function pointer(type: string, clientX: number): Event {
    const event = new Event(type, { bubbles: true }) as Event & Record<string, number>
    Object.assign(event, { clientX, clientY: 0, pointerId: 1, button: 0 })
    return event
  }

  function mount(transform: string, hideFrom?: (node: Element) => boolean) {
    document.body.innerHTML = '<div data-test-ring>' + '<div class="slide">x</div>'.repeat(12) + '</div>'
    const host = document.body.firstElementChild as HTMLElement
    host.style.transformStyle = 'preserve-3d'
    const rig = document.createElement('div')
    rig.style.transformStyle = 'preserve-3d'
    rig.style.transform = transform
    rig.append(...host.children)
    host.append(rig)
    const ctx = {
      win: {
        setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
        clearTimeout: (handle: number) => clearTimeout(handle),
        requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
        cancelAnimationFrame: (handle: number) => cancelAnimationFrame(handle),
        getComputedStyle: (node: Element) => hideFrom?.(node) ? undefined : window.getComputedStyle(node),
      } as unknown as Window,
      doc: window.document,
      reducedMotion: false,
      warn: () => {},
      style: createStyleLedger(host),
    } as unknown as PrepareContext
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide', radius: '240px' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      ctx,
    )
    instance.activate()
    return { host, instance }
  }

  /** Slots the ring advanced by a 44px leftward drag, read off the published step position. */
  function leftMove(host: HTMLElement): number {
    const read = (): number => Number(host.style.getPropertyValue('--kui-step-position'))
    const from = read()
    host.dispatchEvent(pointer('pointerdown', 500))
    host.dispatchEvent(pointer('pointermove', 456))
    return read() - from
  }

  it('falls back to the on-screen card order when the ring is edge-on to the camera', () => {
    for (const [direction, expected] of [[1, 0.2], [-1, -0.2]] as const) {
      side = direction
      const { host, instance } = mount(FLAT_QUARTER_TURN_X)
      expect(leftMove(host)).toBeCloseTo(expected)
      instance.destroy()
    }
  })

  it('does not consult the on-screen card order when the ring faces the camera', () => {
    for (const direction of [1, -1] as const) {
      side = direction
      const { host, instance } = mount(TURN_Y_180)
      expect(leftMove(host)).toBeCloseTo(0.2)
      instance.destroy()
    }
  })

  it('measures through ancestors whose computed style is unavailable', () => {
    const unreadable = (node: Element): boolean => node === document.body || node === document.documentElement
    const { host, instance } = mount(TURN_Y_180, unreadable)
    expect(leftMove(host)).toBeCloseTo(0.2)
    instance.destroy()
  })
})

describe('a recycled card that is exactly touching the viewport edge during an animated step', () => {
  let animator: Animator | undefined
  afterEach(() => {
    animator?.destroy()
    animator = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('keeps its current cycle instead of jumping across the viewport', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    // Three 100px cards, 20px gaps: cycle 360, stride 120, so the loop needs 360 - 100 - 120 = 140px.
    // At exactly 140px, card 2 sits at -70 with its right edge on the viewport's left edge.
    const widths = [100, 100, 100]
    const links = widths.map((_, i) => '<a href="#s' + i + '"><span>' + i + '</span></a>').join('')
    document.body.innerHTML = '<div data-kui="carousel-loop" style="gap:20px">' + links + '</div>'
    const host = document.body.firstElementChild as HTMLElement
    const slides = [...host.children] as HTMLElement[]
    Object.defineProperty(host, 'offsetWidth', { get: () => 140, configurable: true })
    slides.forEach((slide, i) => {
      Object.defineProperty(slide, 'offsetLeft', { get: () => i * 120, configurable: true })
      Object.defineProperty(slide, 'offsetWidth', { get: () => 100, configurable: true })
    })
    animator = animatorOverBody()
    animator.start()
    const cycle = (i: number): number => parseFloat(slides[i]!.style.getPropertyValue('--kui-row-cycle'))
    expect(host.getAttribute('data-kui-row-static')).toBe('false')
    expect(cycle(2)).toBe(-360)

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))

    // The step was animated (the host slid by one stride), and the touching card was not recycled.
    expect(parseFloat(host.style.getPropertyValue('--kui-row-x'))).toBe(70 - 170)
    expect(cycle(2)).toBe(-360)
  })
})
