// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCoast } from '../src/effects/carousel/coast.js'
import type { PrepareContext } from '../src/core/effect-context.js'

const ctx = (reducedMotion = false): PrepareContext => ({ win: window, doc: document, reducedMotion }) as unknown as PrepareContext
beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it.each([1, -1])('integrates a bounded finite coast and settles for sign %s', sign => {
  let distance = 0
  const done = vi.fn()
  const coast = createCoast(document.createElement('div'), ctx(), dx => { distance += dx }, done)
  coast.start(sign * 1000)
  vi.advanceTimersByTime(2000)
  expect(Math.sign(distance)).toBe(sign)
  expect(Math.abs(distance)).toBeGreaterThan(190)
  expect(Math.abs(distance)).toBeLessThan(200)
  expect(done).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  coast.release()
})

it('stops a live coast when hidden and refuses a new hidden or reduced-motion coast', () => {
  const move = vi.fn()
  const done = vi.fn()
  const coast = createCoast(document.createElement('div'), ctx(), move, done)
  coast.start(1000)
  vi.advanceTimersByTime(32)
  const moved = move.mock.calls.length
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(100)
  expect(move).toHaveBeenCalledTimes(moved)
  coast.start(1000)
  expect(vi.getTimerCount()).toBe(0)
  coast.release()
  const reduced = createCoast(document.createElement('div'), ctx(true), move, done)
  reduced.start(1000)
  reduced.release()
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels on offscreen observation and bounds excessive release velocities', () => {
  let observe!: (entries: IntersectionObserverEntry[]) => void
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: IntersectionObserverEntry[]) => void) { observe = callback }
    observe() {}
    disconnect = disconnect
  })
  let distance = 0
  const coast = createCoast(document.createElement('div'), ctx(), dx => { distance += dx }, vi.fn())
  coast.start(1_000_000)
  observe([{ isIntersecting: true }] as IntersectionObserverEntry[])
  vi.advanceTimersByTime(32)
  expect(distance).toBeGreaterThan(0)
  expect(distance).toBeLessThan(200)
  observe([{ isIntersecting: false }] as IntersectionObserverEntry[])
  expect(vi.getTimerCount()).toBe(0)
  coast.release()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

it.each([1, -1])('hands back at the configured spin speed rather than coasting below it: %s', sign => {
  let distance = 0
  const done = vi.fn()
  const coast = createCoast(document.createElement('div'), ctx(), dx => { distance += dx }, done)
  coast.start(sign * 1000, 100)
  vi.advanceTimersByTime(600)
  expect(done).toHaveBeenCalledTimes(1)
  expect(Math.abs(distance)).toBeGreaterThan(175)
  expect(Math.abs(distance)).toBeLessThan(190)
  expect(vi.getTimerCount()).toBe(0)
  coast.release()
})
