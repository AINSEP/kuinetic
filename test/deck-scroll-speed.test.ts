// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { fakeRoot, fakeScheduler } from './support/scroll-mechanics-harness.js'
import { catalogRegistry } from './support/registry.js'
import { deckMotionParams } from '../src/effects/carousel/sources.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'

let animator: Animator | undefined
let host: HTMLElement
let scheduler: ReturnType<typeof fakeScheduler>
const num = (name: string): number => parseFloat(host.style.getPropertyValue(name))
function mount(effect: string, native = false, reducedMotion = false, controls = '') {
  document.body.innerHTML = `<div data-kui="${effect}" style="gap:20px"><img src="/one.jpg" alt="One"><img src="/two.jpg" alt="Two"><img src="/three.jpg" alt="Three"></div>${controls}`
  host = document.body.firstElementChild as HTMLElement
  Object.defineProperty(host, 'offsetWidth', { value: 390 })
  host.getBoundingClientRect = () => ({ top: 0, left: 0, width: 390, height: 200 }) as DOMRect
  host.querySelectorAll('img').forEach((image, i) => {
    Object.defineProperty(image, 'offsetLeft', { value: i * 180 })
    Object.defineProperty(image, 'offsetWidth', { value: 160 })
  })
  scheduler = fakeScheduler()
  const reporter = collectingReporter()
  animator = new Animator({ root: document.body, registry: catalogRegistry(), scheduler, reporter,
    rootResolver: () => fakeRoot, capabilities: defaultCapabilities({ individualTransforms: true, scrollTimeline: native, reducedMotion }),
    binder: createActivationBinder({ createObserver: undefined }) })
  animator.start()
  return reporter
}
function pointer(type: string, x: number): void {
  host.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: 0, pointerId: 1 }))
}
beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }))
afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('drives a whole cycle from scroll, publishes signed physical speed and decays at rest', () => {
  expect(mount('carousel-loop copies:auto timeline:scroll distance:1600px speed:true').messages).toEqual([])
  scheduler.emit(0)
  const initial = num('--kui-row-x')
  vi.advanceTimersByTime(20)
  scheduler.emit(160)
  expect(num('--kui-row-x')).toBeCloseTo(initial - 54)
  expect(num('--kui-motion-speed')).toBeCloseTo(-2700)
  vi.advanceTimersByTime(20)
  scheduler.emit(0)
  expect(num('--kui-motion-speed')).toBeCloseTo(2700)
  vi.advanceTimersByTime(2000)
  expect(num('--kui-motion-speed')).toBe(0)
  scheduler.emit(1600)
  expect(num('--kui-step-position')).toBe(0)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
  animator!.destroy()
  animator = undefined
  expect(scheduler.subscriberCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(host.style.getPropertyValue('--kui-motion-speed')).toBe('')
})

it('samples drag without a scroll subscriber and resets after a long gap', () => {
  expect(mount('carousel-loop copies:auto speed:true').messages).toEqual([])
  expect(scheduler.subscriberCount()).toBe(0)
  pointer('pointerdown', 0)
  pointer('pointermove', -20)
  vi.advanceTimersByTime(20)
  pointer('pointermove', -60)
  expect(num('--kui-motion-speed')).toBeCloseTo(-2000)
  vi.advanceTimersByTime(300)
  pointer('pointermove', -80)
  expect(num('--kui-motion-speed')).toBe(0)
})

it('allows drag to own a scroll-driven deck and resumes from the displayed position', () => {
  mount('carousel-loop copies:auto timeline:scroll distance:1600px speed:true')
  scheduler.emit(0)
  pointer('pointerdown', 0)
  pointer('pointermove', -20)
  vi.advanceTimersByTime(20)
  pointer('pointermove', -60)
  const held = num('--kui-row-x')
  scheduler.emit(160)
  expect(num('--kui-row-x')).toBe(held)
  pointer('pointerup', -60)
  const released = num('--kui-row-x')
  vi.advanceTimersByTime(20)
  scheduler.emit(320)
  expect(num('--kui-row-x')).toBeCloseTo(released - 54)
})

it.each(['carousel-loop', 'carousel-3d', 'carousel-stack'])('adds no source or speed output to plain %s', effect => {
  expect(mount(effect).messages).toEqual([])
  expect(scheduler.subscriberCount()).toBe(0)
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(host.style.getPropertyValue('--kui-motion-speed')).toBe('')
})

it.each(['', ', fade-up'])('preserves the native progress gate and play/pause policy with composition %s', suffix => {
  const reporter = mount(`carousel-loop copies:auto timeline:scroll distance:1600px${suffix}`, true)
  expect(reporter.messages).toEqual([])
  expect(animator!.stateOf(host)!.progressDriven).toBe(true)
  animator!.control(host).play().pause()
  expect(reporter.messages.join()).toContain('driven by scroll position')
  scheduler.emit(0)
  scheduler.emit(160)
  expect(num('--kui-step-position')).toBeCloseTo(.3)
})

it('refuses simultaneous clocks and resets speed across epochs and hidden transitions', () => {
  const reporter = mount('carousel-loop copies:auto timeline:scroll distance:1600px speed:true spin:4s autoplay:3s')
  expect(reporter.messages.join()).toContain('disables spin: and autoplay:')
  scheduler.emit(0)
  vi.advanceTimersByTime(20)
  scheduler.emit(160)
  expect(num('--kui-motion-speed')).not.toBe(0)
  scheduler.emit(320, 1)
  expect(num('--kui-motion-speed')).toBe(0)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(num('--kui-motion-speed')).toBe(0)
})

it.each(['carousel-3d', 'carousel-stack'])('shares scroll and drag speed sampling with %s', effect => {
  expect(mount(`${effect} timeline:scroll distance:1600px speed:true`).messages).toEqual([])
  scheduler.emit(0)
  vi.advanceTimersByTime(20)
  scheduler.emit(160)
  expect(num('--kui-motion-speed')).toBeCloseTo(-3300)
})


it('publishes zero decorative speed under reduced motion while keeping drag usable', () => {
  mount('carousel-loop copies:auto speed:true', false, true)
  pointer('pointerdown', 0)
  pointer('pointermove', -20)
  vi.advanceTimersByTime(20)
  pointer('pointermove', -60)
  expect(num('--kui-motion-speed')).toBe(0)
})

it('samples spin from the same row writer and settles after hover pauses it', () => {
  mount('carousel-loop copies:auto spin:4s speed:true')
  vi.advanceTimersByTime(160)
  expect(num('--kui-motion-speed')).toBeLessThan(0)
  host.dispatchEvent(new Event('pointerenter'))
  vi.advanceTimersByTime(2000)
  expect(num('--kui-motion-speed')).toBe(0)
})

it.each([-1, 1])('keeps snap release from reversing or enlarging drag speed: %s', sign => {
  mount('carousel-loop copies:auto speed:true')
  pointer('pointerdown', 0)
  pointer('pointermove', sign * 20)
  vi.advanceTimersByTime(20)
  pointer('pointermove', sign * 60)
  const releasedSpeed = num('--kui-motion-speed')
  expect(Math.sign(releasedSpeed)).toBe(sign)
  vi.advanceTimersByTime(10)
  pointer('pointerup', sign * 60)
  expect(num('--kui-motion-speed')).toBe(releasedSpeed)
  let previous = Math.abs(releasedSpeed)
  for (let frame = 0; frame < 150; frame++) {
    vi.advanceTimersByTime(16)
    const speed = num('--kui-motion-speed')
    expect(speed * sign).toBeGreaterThanOrEqual(0)
    expect(Math.abs(speed)).toBeLessThanOrEqual(previous)
    previous = Math.abs(speed)
  }
  expect(num('--kui-motion-speed')).toBe(0)
})

it('does not mistake quick discrete keys for instantaneous physical motion', () => {
  mount('carousel-loop copies:auto speed:true')
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  vi.advanceTimersByTime(100)
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(num('--kui-motion-speed')).toBe(0)
})

it('suppresses transitions only for scroll writes and restores them for snap, keys and jump', () => {
  mount('carousel-loop copies:auto timeline:scroll distance:1600px jump:.speed-jump', false, false,
    '<button class="speed-jump">One</button><button class="speed-jump">Two</button>')
  expect(host.getAttribute('data-kui-ring-spinning')).not.toBe('true')
  scheduler.emit(0)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
  pointer('pointerdown', 0)
  pointer('pointermove', -60)
  pointer('pointerup', -60)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  scheduler.emit(160)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  scheduler.emit(320)
  document.querySelectorAll<HTMLButtonElement>('.speed-jump')[1]!.click()
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  scheduler.emit(480)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
})

it('resets speed immediately when a spinning row remeasures on resize', () => {
  mount('carousel-loop copies:auto spin:4s speed:true')
  vi.advanceTimersByTime(160)
  expect(num('--kui-motion-speed')).toBeLessThan(0)
  window.dispatchEvent(new Event('resize'))
  expect(num('--kui-motion-speed')).toBe(0)
  vi.advanceTimersByTime(32)
  expect(num('--kui-motion-speed')).toBeLessThan(0)
})

it('does not carry pre-hidden velocity into the first resumed scroll frame', () => {
  mount('carousel-loop copies:auto timeline:scroll distance:1600px speed:true')
  scheduler.emit(0)
  vi.advanceTimersByTime(20)
  scheduler.emit(160)
  expect(num('--kui-motion-speed')).toBeLessThan(0)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  hidden.mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(20)
  scheduler.emit(320)
  expect(num('--kui-motion-speed')).toBe(0)
})

it('preserves other validated timing reads while scroll disables the two motion clocks', () => {
  const context = { timeline: 'scroll', warn: vi.fn() } as unknown as PrepareContext
  const wrapped = deckMotionParams(createParams({ spin: '4s', autoplay: '3s', duration: '400ms' }), context, 'deck')
  expect(wrapped.ms('spin')).toBe(0)
  expect(wrapped.ms('autoplay')).toBe(0)
  expect(wrapped.ms('duration', 5)).toBe(400)
  expect(wrapped.ms('missing', 5)).toBe(5)
})
