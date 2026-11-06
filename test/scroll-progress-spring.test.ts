// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { build, el, scheduler, reporter, stubRect } from './support/scroll-mechanics-harness.js'
import type { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { Animator as AnimatorClass } from '../src/core/animator.js'
import { catalogRegistry } from './support/registry.js'
import { createActivationBinder } from '../src/core/activation.js'
import { fakeRoot } from './support/scroll-mechanics-harness.js'

let animator: Animator | undefined
const progress = (): number => Number(el().style.getPropertyValue('--kui-progress'))
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'] }))
afterEach(() => {
  animator?.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('smooths page progress to the real page end, keeps raw steps, and cancels its tail', () => {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 4000 })
  animator = build('<div data-kui="scroll-progress smooth:true page:true steps:4"></div>')
  animator.start()
  scheduler.emit(0)
  expect(progress()).toBe(0)
  scheduler.emit(1600)
  expect(progress()).toBe(0)
  expect(el().getAttribute('data-kui-step')).toBe('2')
  vi.advanceTimersByTime(80)
  expect(progress()).toBeGreaterThan(0)
  expect(progress()).toBeLessThan(.5)
  scheduler.emit(3200)
  vi.advanceTimersByTime(2000)
  expect(progress()).toBe(1)
  scheduler.emit(800)
  vi.advanceTimersByTime(2000)
  expect(progress()).toBe(.25)
  expect(reporter.messages).toEqual([])
  animator.destroy()
  animator = undefined
  expect(scheduler.subscriberCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('leaves plain progress direct and keeps its existing reduced-motion disable policy', () => {
  animator = build('<div data-kui="scroll-progress distance:800px"></div>')
  stubRect(el(), 0)
  animator.start()
  scheduler.emit(0)
  scheduler.emit(400)
  expect(progress()).toBe(.5)
  expect(vi.getTimerCount()).toBe(0)
  expect(el().getAttribute('data-kui-rm')).toBe('disable')
})

it('snaps an active smoothing tail when hidden and remeasures the page on a new epoch', () => {
  let height = 4000
  const reads = vi.fn(() => height)
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: reads })
  animator = build('<div data-kui="scroll-progress smooth:true page:true"></div>')
  animator.start()
  scheduler.emit(0)
  scheduler.emit(1600)
  expect(reads).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(progress()).toBe(.5)
  expect(vi.getTimerCount()).toBe(0)
  height = 2400
  scheduler.emit(1600, 1)
  expect(progress()).toBe(1)
  expect(reads).toHaveBeenCalledTimes(2)
})

it.each([true, false])('preserves the plain reduced-motion policy and snaps the opted-in variant: smooth=%s', smooth => {
  animator = build(`<div data-kui="scroll-progress smooth:${smooth} distance:800px"></div>`)
  animator.destroy()
  animator = new AnimatorClass({ root: document.body, registry: catalogRegistry(), scheduler,
    rootResolver: () => fakeRoot, capabilities: defaultCapabilities({ reducedMotion: true, individualTransforms: true }),
    binder: createActivationBinder({ createObserver: undefined }) })
  stubRect(el(), 0)
  animator.start()
  scheduler.emit(0)
  scheduler.emit(400)
  expect(progress()).toBe(smooth ? .5 : 0)
  expect(scheduler.subscriberCount()).toBe(smooth ? 1 : 0)
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps a page with no scroll range finite', () => {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 400 })
  animator = build('<div data-kui="scroll-progress smooth:true page:true"></div>')
  animator.start()
  scheduler.emit(0)
  expect(progress()).toBe(0)
  expect(reporter.messages).toEqual([])
})
