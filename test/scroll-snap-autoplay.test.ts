// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { collectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `autoplay:` on `scroll-snap-x` / `scroll-snap-y`, wired to the carousel's scheduler
 * (`effects/auto-motion.ts`, whose pause rules `carousel-spin.test.ts` covers one by one).
 *
 * jsdom lays nothing out, so the strip's geometry is stubbed: three 100px items in a 100px
 * viewport (scrollWidth 300), and `scrollTo` is a spy that also moves `scrollLeft`.
 */

let animator: Animator | undefined
let reporter: ReturnType<typeof collectingReporter>

const ITEMS = '<div class="s">1</div><div class="s">2</div><div class="s">3</div>'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }
}

/** Three 100px items; the strip is `axis`-scrollable with a 100px viewport. */
function stub(strip: HTMLElement, axis: 'x' | 'y'): ReturnType<typeof vi.fn> {
  const x = axis === 'x'
  let offset = 0
  const scrollTo = vi.fn((arg: ScrollToOptions) => { offset = (x ? arg.left : arg.top) ?? 0 })
  Object.defineProperty(strip, x ? 'scrollLeft' : 'scrollTop', { get: () => offset, configurable: true })
  Object.defineProperty(strip, x ? 'scrollWidth' : 'scrollHeight', { value: 300, configurable: true })
  Object.defineProperty(strip, x ? 'clientWidth' : 'clientHeight', { value: 100, configurable: true })
  strip.scrollTo = scrollTo as unknown as typeof strip.scrollTo
  strip.getBoundingClientRect = () => rect(0, 0, 100, 100)
  ;[...strip.querySelectorAll<HTMLElement>('.s')].forEach((item, i) => {
    item.getBoundingClientRect = () => (x ? rect(i * 100 - offset, 0, 100, 100) : rect(0, i * 100 - offset, 100, 100))
  })
  return scrollTo
}

function start(html: string, reducedMotion = false, setup?: (strip: HTMLElement) => void): void {
  document.body.innerHTML = html
  setup?.(document.getElementById('strip')!)
  reporter = collectingReporter()
  animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: { ...CAPS, reducedMotion },
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
    observe: false,
  })
  animator.start()
}

const strip = (): HTMLElement => document.getElementById('strip')!
const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('scroll-snap autoplay:', () => {
  it('scrolls the strip to the next item every period, and wraps', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s autoplay:3s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'x') })
    vi.advanceTimersByTime(2999)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spy).toHaveBeenLastCalledWith({ left: 100, behavior: 'smooth' })
    vi.advanceTimersByTime(3000)
    expect(spy).toHaveBeenLastCalledWith({ left: 200, behavior: 'smooth' })
    vi.advanceTimersByTime(3000)
    expect(spy).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })
  })

  it('steps backwards for a negative period, on the y axis with top', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-y target:.s autoplay:-2s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'y') })
    vi.advanceTimersByTime(2000)
    expect(spy).toHaveBeenLastCalledWith({ top: 200, behavior: 'smooth' })
  })

  it('aims at the centre of the next item for align:center, clamped to the range', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s align:center autoplay:2s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'x') })
    vi.advanceTimersByTime(2000)
    expect(spy).toHaveBeenLastCalledWith({ left: 100, behavior: 'smooth' })
  })

  it('floors the period at two seconds, and says so', () => {
    start(`<div id="strip" data-kui="scroll-snap-x target:.s autoplay:1s">${ITEMS}</div>`, false, (s) => stub(s, 'x'))
    expect(reporter.messages).toContain('scroll-snap autoplay: minimum is 2s; clamped to 2s')
  })

  it('does nothing without the parameter', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'x') })
    vi.advanceTimersByTime(60_000)
    expect(spy).not.toHaveBeenCalled()
    expect(strip().style.scrollSnapType).toContain('x')
  })

  it('leaves snapping enabled when there is only one item to autoplay', () => {
    start('<div id="strip" data-kui="scroll-snap-x autoplay:2s"><div>Only item</div></div>')
    expect(reporter.messages).toContain('scroll-snap autoplay: needs at least 2 items')
    expect(strip().style.scrollSnapType).toContain('x')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a pointerdown on the strip holds the motion for the settle period, then resumes', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s autoplay:3s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'x') })
    vi.advanceTimersByTime(2000)
    strip().dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(3000)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('the pause: control toggles the motion and carries aria-pressed', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(
      `<button class="p">pause</button><div id="strip" data-kui="scroll-snap-x target:.s autoplay:3s pause:.p">${ITEMS}</div>`,
      false,
      (s) => { spy = stub(s, 'x') },
    )
    const button = document.querySelector('.p')!
    click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(10_000)
    expect(spy).not.toHaveBeenCalled()
    click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(3000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refuses the page itself: snapping stays, no timer', () => {
    start('<div id="strip"></div>')
    animator?.destroy()
    document.documentElement.setAttribute('data-kui', 'scroll-snap-y target:body>* autoplay:3s')
    document.body.innerHTML = '<p>1</p><p>2</p>'
    reporter = collectingReporter()
    animator = new Animator({
      root: document.documentElement,
      registry: catalogRegistry(),
      capabilities: { ...CAPS, reducedMotion: false },
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
      reporter,
      observe: false,
    })
    animator.start()
    expect(reporter.messages.some((m) => m.includes('refused on the page itself'))).toBe(true)
    expect(document.documentElement.style.scrollSnapType).toContain('y')
    document.documentElement.removeAttribute('data-kui')
  })

  it('does not move under prefers-reduced-motion', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s autoplay:2s">${ITEMS}</div>`, true, (s) => { spy = stub(s, 'x') })
    vi.advanceTimersByTime(20_000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('stops on destroy', () => {
    let spy!: ReturnType<typeof vi.fn>
    start(`<div id="strip" data-kui="scroll-snap-x target:.s autoplay:2s">${ITEMS}</div>`, false, (s) => { spy = stub(s, 'x') })
    animator?.destroy()
    vi.advanceTimersByTime(20_000)
    expect(spy).not.toHaveBeenCalled()
  })
})
