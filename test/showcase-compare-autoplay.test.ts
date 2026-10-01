// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { COMPARE_PRIMITIVE, MAX_FRAME_MS, MIN_SWEEP_MS } from '../src/showcase/compare.js'

/**
 * `compare autoplay:` — the divider sweeping by itself, and yielding the moment a person takes it.
 *
 * Same rig as `carousel-spin.test.ts`: vitest's fake clock, frames included, handed in through a
 * stand-in `win`, and an observer stub the test drives (jsdom has none). What is asserted is
 * `--kui-compare`, the one number the clip-path and the handle read.
 */

const observers: { last: FakeObserver | null; count: number } = { last: null, count: 0 }

class FakeObserver {
  disconnected = false
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    observers.last = this
    observers.count += 1
  }
  observe(): void {}
  disconnect(): void {
    this.disconnected = true
  }
  report(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

interface MountOptions {
  reducedMotion?: boolean
  warn?: (m: string) => void
  noObserver?: boolean
  durationMs?: number
}

function fakeWin(options: MountOptions): Window {
  const win: Record<string, unknown> = {
    requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => requestAnimationFrame(cb)),
    cancelAnimationFrame: vi.fn((handle: number) => cancelAnimationFrame(handle)),
  }
  if (!options.noObserver) win.IntersectionObserver = FakeObserver
  return win as unknown as Window
}

function mount(
  params: Record<string, string>,
  options: MountOptions = {},
): { host: HTMLElement; range: HTMLInputElement; instance: EffectInstance; win: Window } {
  document.body.innerHTML = '<figure><img src="a.jpg" alt="A"><img src="b.jpg" alt="B"></figure>'
  const host = document.body.firstElementChild as HTMLElement
  const win = fakeWin(options)
  const ctx = {
    win,
    doc: window.document,
    reducedMotion: options.reducedMotion ?? false,
    warn: options.warn ?? (() => {}),
    style: createStyleLedger(host),
  } as unknown as PrepareContext
  const timing = options.durationMs === undefined ? {} : { durationMs: options.durationMs }
  const instance = COMPARE_PRIMITIVE.prepare!(
    host,
    readEffectParams(params, COMPARE_PRIMITIVE.parameters, () => {}, timing),
    ctx,
  )
  instance.activate()
  const range = host.querySelector('.kui-compare-range') as HTMLInputElement
  return { host, range, instance, win }
}

/** The divider, in percent. */
function at(host: HTMLElement): number {
  return parseFloat(host.style.getPropertyValue('--kui-compare'))
}

/** Advance the clock in whole frames so the per-frame clamp never bites. */
function run(ms: number): void {
  for (let left = ms; left > 0; left -= 16) vi.advanceTimersByTime(Math.min(16, left))
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  })
  observers.last = null
  observers.count = 0
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('compare autoplay:', () => {
  it('stays still by default', () => {
    const { host, win } = mount({})
    run(2000)
    expect(at(host)).toBe(50)
    expect(win.requestAnimationFrame).not.toHaveBeenCalled()
    expect(observers.count).toBe(0)
  })

  it('always: sweeps out to 100%, across to 0%, and home to position in two durations', () => {
    const { host, range } = mount({ autoplay: 'always', duration: '1s' })
    // Half a sweep from 50% is the far edge (100%).
    run(500)
    expect(at(host)).toBeCloseTo(100, 0)
    expect(range.value).toBe('100')
    expect(range.getAttribute('aria-valuetext')).toBe('100% after')
    // A full sweep later it has crossed to the near edge.
    run(1000)
    expect(at(host)).toBeCloseTo(0, 0)
    // And it ends exactly where it started, and stops asking for frames.
    run(600)
    expect(at(host)).toBe(50)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('eases into each edge: the step near a turn is shorter than the step through the middle', () => {
    const { host } = mount({ autoplay: 'always', duration: '1s' })
    run(16)
    run(16)
    const before = at(host)
    run(16)
    const middleStep = at(host) - before
    run(500 - 48 - 16)
    const nearEdge = at(host)
    run(16)
    expect(Math.abs(at(host) - nearEdge)).toBeLessThan(middleStep)
  })

  it('reverse: heads toward 0% first', () => {
    const { host } = mount({ autoplay: 'always', duration: '1s', reverse: 'true' })
    run(100)
    expect(at(host)).toBeLessThan(50)
    run(400)
    expect(at(host)).toBeCloseTo(0, 0)
  })

  it('starts from an authored position', () => {
    const { host } = mount({ autoplay: 'always', duration: '1s', position: '0%' })
    run(1000)
    expect(at(host)).toBeCloseTo(100, 0)
  })

  it('honours the positional duration over the named one', () => {
    const { host } = mount({ autoplay: 'always', duration: '10s' }, { durationMs: 1000 })
    run(500)
    expect(at(host)).toBeCloseTo(100, 0)
  })

  it('clamps a too-short duration and says so', () => {
    const warn = vi.fn()
    const { host } = mount({ autoplay: 'always', duration: '10ms' }, { warn })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`minimum is ${MIN_SWEEP_MS}ms`))
    // Half the floor (plus the clock-reading first frame) reaches the far edge; at 10ms it would
    // have cycled six times over and be anywhere.
    run(MIN_SWEEP_MS / 2 + 16)
    expect(at(host)).toBeGreaterThan(98)
  })

  it('loop: keeps sweeping past one cycle', () => {
    const { host } = mount({ autoplay: 'always', duration: '1s', loop: 'true' })
    observers.last!.report(true)
    run(2000 + 500)
    expect(at(host)).toBeCloseTo(100, 0)
    run(1000)
    expect(at(host)).toBeCloseTo(0, 0)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('loop: pauses off screen and resumes where it left off', () => {
    const { host, win } = mount({ autoplay: 'always', duration: '1s', loop: 'true' })
    const observer = observers.last!
    observer.report(true)
    run(200)
    observer.report(false)
    const paused = at(host)
    expect(win.cancelAnimationFrame).toHaveBeenCalled()
    run(5000)
    expect(at(host)).toBe(paused)
    expect(vi.getTimerCount()).toBe(0)
    observer.report(true)
    // The first frame back only reads the clock, so the divider does not jump by the gap.
    run(16)
    expect(at(host)).toBe(paused)
    run(16)
    expect(at(host)).toBeGreaterThan(paused)
  })

  it('a single always pass does not watch the viewport', () => {
    mount({ autoplay: 'always', duration: '1s' })
    expect(observers.count).toBe(0)
  })

  it('in-view: waits until the slider is on screen', () => {
    const { host, win } = mount({ autoplay: 'in-view', duration: '1s' })
    run(1000)
    expect(at(host)).toBe(50)
    expect(win.requestAnimationFrame).not.toHaveBeenCalled()
    observers.last!.report(true)
    run(500)
    expect(at(host)).toBeCloseTo(100, 0)
  })

  it('in-view in a realm with no observer runs as if on screen', () => {
    const { host } = mount({ autoplay: 'in-view', duration: '1s' }, { noObserver: true })
    run(500)
    expect(at(host)).toBeCloseTo(100, 0)
  })

  it('clamps one long frame, so a tab back from the background does not jump the divider', () => {
    const { host, win } = mount({ autoplay: 'always', duration: '1s', position: '0%' })
    const raf = win.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>
    // Drive frames by hand: a hidden tab is one frame arriving a long time after the last.
    const frame = (now: number): void => {
      const callback = raf.mock.calls.at(-1)![0] as FrameRequestCallback
      callback(now)
    }
    frame(0)
    frame(5000)
    // Five seconds unclamped would be 2.5 cycles; clamped, it is MAX_FRAME_MS of travel from 0%.
    const expected = 50 - 50 * Math.cos((Math.PI * 100 * MAX_FRAME_MS) / 1000 / 100)
    expect(at(host)).toBeCloseTo(expected, 2)
  })

  it.each([
    ['pointerdown', (range: HTMLInputElement) => range.dispatchEvent(new Event('pointerdown'))],
    ['focus', (range: HTMLInputElement) => range.dispatchEvent(new Event('focus'))],
  ])('stops for good on %s and hands the divider to the person', (_name, grab) => {
    const { host, range } = mount({ autoplay: 'always', duration: '1s', loop: 'true' })
    const observer = observers.last!
    observer.report(true)
    run(200)
    grab(range)
    const held = at(host)
    run(3000)
    expect(at(host)).toBe(held)
    expect(vi.getTimerCount()).toBe(0)
    expect(observer.disconnected).toBe(true)
    // Coming back on screen does not restart it.
    observer.report(true)
    run(500)
    expect(at(host)).toBe(held)
    // The person's input still drives it.
    range.value = '20'
    range.dispatchEvent(new Event('input'))
    expect(host.style.getPropertyValue('--kui-compare')).toBe('20%')
  })

  it('never moves under reduced motion', () => {
    const { host, win } = mount({ autoplay: 'always', duration: '1s', loop: 'true' }, { reducedMotion: true })
    run(2000)
    expect(at(host)).toBe(50)
    expect(win.requestAnimationFrame).not.toHaveBeenCalled()
    expect(observers.count).toBe(0)
  })

  it('teardown cancels the pending frame and disconnects the observer', () => {
    const { host, instance, win } = mount({ autoplay: 'always', duration: '1s', loop: 'true' })
    const observer = observers.last!
    observer.report(true)
    run(200)
    expect(vi.getTimerCount()).toBe(1)
    instance.destroy()
    expect(win.cancelAnimationFrame).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(observer.disconnected).toBe(true)
    expect(host.querySelector('.kui-compare-range')).toBeNull()
    expect(host.style.getPropertyValue('--kui-compare')).toBe('')
  })
})
