import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultGestureDeps,
  recognise,
  rubberBand,
  swipeDirection,
  velocityFrom,
} from '../src/core/gesture.js'
import type { GestureDeps, GestureVector } from '../src/core/gesture.js'

/**
 * Gestures are driven with synthetic pointer events and a fake clock, so timing-dependent
 * behaviour (velocity windows, long-press) is deterministic rather than flaky.
 */

let clock = 0
const timers = new Map<number, () => void>()
let nextTimer = 1

const deps: GestureDeps = {
  now: () => clock,
  // The duration is ignored: `runTimers` fires everything pending, which is what makes
  // long-press deterministic instead of dependent on real elapsed time.
  setTimer(callback) {
    const handle = nextTimer++
    timers.set(handle, callback)
    return handle
  },
  clearTimer: (handle) => timers.delete(handle),
}

/** Fire every pending timer, as if their durations elapsed. */
function runTimers(): void {
  for (const callback of [...timers.values()]) callback()
  timers.clear()
}

function pointer(type: string, x: number, y: number): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  return event
}

function drag(el: Element, path: Array<[number, number, number]>): void {
  const [start, ...rest] = path
  clock = start![2]
  el.dispatchEvent(pointer('pointerdown', start![0], start![1]))
  for (const [x, y, time] of rest) {
    clock = time
    el.dispatchEvent(pointer('pointermove', x, y))
  }
  const last = path[path.length - 1]!
  el.dispatchEvent(pointer('pointerup', last[0], last[1]))
}

beforeEach(() => {
  clock = 0
  timers.clear()
})

describe('velocityFrom', () => {
  it('is zero with fewer than two samples', () => {
    expect(velocityFrom([{ x: 0, y: 0, time: 0 }])).toEqual({ vx: 0, vy: 0 })
  })

  it('computes pixels per second', () => {
    const samples = [
      { x: 0, y: 0, time: 0 },
      { x: 100, y: 50, time: 100 },
    ]
    expect(velocityFrom(samples)).toEqual({ vx: 1000, vy: 500 })
  })

  it('ignores samples older than the window, so an early pause does not damp a late flick', () => {
    const samples = [
      { x: 0, y: 0, time: 0 },
      { x: 0, y: 0, time: 400 },
      { x: 100, y: 0, time: 500 },
    ]
    // Over the whole gesture this averages 200px/s; over the trailing window it is 1000px/s.
    expect(velocityFrom(samples).vx).toBeCloseTo(1000)
  })

  it('returns zero when two samples share a timestamp', () => {
    // Consecutive pointer events can land in the same millisecond; dividing by that span
    // produces an enormous speed that would throw an element off screen.
    const samples = [
      { x: 0, y: 0, time: 5 },
      { x: 60, y: 0, time: 5 },
    ]
    expect(velocityFrom(samples)).toEqual({ vx: 0, vy: 0 })
  })

  it('does not throw when the injected clock reports NaN, which fails every "at least as recent as the cutoff" comparison', () => {
    // `GestureDeps.now` is injectable, so a broken custom clock — not the default `Date.now()`/
    // `performance.now()` — is the only realistic way this happens: `cutoff` becomes NaN too, and
    // `NaN >= NaN` is always false, so `.find` exhausts the array and falls back to `samples[0]`.
    const samples = [
      { x: 0, y: 0, time: 5 },
      { x: 1, y: 1, time: Number.NaN },
    ]
    expect(() => velocityFrom(samples)).not.toThrow()
  })
})

describe('swipeDirection', () => {
  const vector = (vx: number, vy: number): GestureVector => ({ dx: 0, dy: 0, vx, vy })

  it.each([
    [800, 0, 'right'],
    [-800, 0, 'left'],
    [0, 800, 'down'],
    [0, -800, 'up'],
  ])('classifies (%s, %s) as %s', (vx, vy, expected) => {
    expect(swipeDirection(vector(vx, vy), 300)).toBe(expected)
  })

  it('returns null below the velocity threshold', () => {
    expect(swipeDirection(vector(100, 100), 300)).toBeNull()
  })

  it('picks the dominant axis', () => {
    expect(swipeDirection(vector(800, 400), 300)).toBe('right')
    expect(swipeDirection(vector(400, 800), 300)).toBe('down')
  })
})

describe('rubberBand', () => {
  it('is zero at the origin', () => {
    expect(rubberBand(0, 100)).toBe(0)
  })

  it('damps: output is always less than input', () => {
    expect(rubberBand(100, 100)).toBeLessThan(100)
    expect(rubberBand(500, 100)).toBeLessThan(500)
  })

  it('approaches the limit asymptotically rather than clamping', () => {
    // Hard clamping reads as broken; native scrollers all damp instead.
    const far = rubberBand(10000, 100)
    expect(far).toBeLessThan(100)
    expect(far).toBeGreaterThan(90)
  })

  it('preserves sign', () => {
    expect(rubberBand(-200, 100)).toBeLessThan(0)
  })

  it('returns zero for a non-positive limit instead of dividing by it', () => {
    expect(rubberBand(50, 0)).toBe(0)
  })
})

describe('defaultGestureDeps', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('falls back to Date.now() when performance is unavailable', () => {
    vi.stubGlobal('performance', undefined)
    expect(typeof defaultGestureDeps().now()).toBe('number')
  })

  it('reads performance.now() when it is available', () => {
    expect(typeof defaultGestureDeps().now()).toBe('number')
  })

  it('schedules and clears real timers', () => {
    vi.useFakeTimers()
    const deps = defaultGestureDeps()
    const callback = vi.fn()

    const fired = deps.setTimer(callback, 100)
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledOnce()

    const cleared = deps.setTimer(callback, 100)
    deps.clearTimer(cleared)
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledOnce()
    expect(fired).not.toBe(cleared)
  })
})

describe('recognise', () => {
  it('does not start a drag below the movement threshold', () => {
    const el = document.createElement('div')
    const onStart = vi.fn()
    recognise(el, { onStart }, { threshold: 10 }, deps)
    drag(el, [
      [0, 0, 0],
      [3, 0, 16],
    ])
    expect(onStart).not.toHaveBeenCalled()
  })

  it('starts once the threshold is crossed, and only once', () => {
    const el = document.createElement('div')
    const onStart = vi.fn()
    recognise(el, { onStart }, { threshold: 10 }, deps)
    drag(el, [
      [0, 0, 0],
      [20, 0, 16],
      [40, 0, 32],
    ])
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('reports cumulative displacement from the origin', () => {
    const el = document.createElement('div')
    const moves: GestureVector[] = []
    recognise(el, { onMove: (v) => moves.push(v) }, { threshold: 1 }, deps)
    drag(el, [
      [0, 0, 0],
      [10, 5, 16],
      [30, 15, 32],
    ])
    expect(moves.at(-1)).toMatchObject({ dx: 30, dy: 15 })
  })

  it('locks to the x axis', () => {
    const el = document.createElement('div')
    const moves: GestureVector[] = []
    recognise(el, { onMove: (v) => moves.push(v) }, { threshold: 1, axis: 'x' }, deps)
    drag(el, [
      [0, 0, 0],
      [30, 40, 16],
    ])
    expect(moves.at(-1)).toMatchObject({ dx: 30, dy: 0 })
  })

  it('locks to the y axis', () => {
    const el = document.createElement('div')
    const moves: GestureVector[] = []
    recognise(el, { onMove: (v) => moves.push(v) }, { threshold: 1, axis: 'y' }, deps)
    drag(el, [
      [0, 0, 0],
      [30, 40, 16],
    ])
    expect(moves.at(-1)).toMatchObject({ dx: 0, dy: 40 })
  })

  it('uses native pointer capture when the element supports it', () => {
    const el = document.createElement('div')
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.defineProperty(el, 'setPointerCapture', { value: setPointerCapture })
    Object.defineProperty(el, 'releasePointerCapture', { value: releasePointerCapture })
    recognise(el, {}, { threshold: 1 }, deps)
    drag(el, [
      [0, 0, 0],
      [20, 0, 16],
    ])
    expect(setPointerCapture).toHaveBeenCalledOnce()
    expect(releasePointerCapture).toHaveBeenCalledOnce()
  })

  it('drops the oldest sample once the retained window is exceeded', () => {
    const el = document.createElement('div')
    const onMove = vi.fn()
    recognise(el, { onMove }, { threshold: 1 }, deps)
    const path: Array<[number, number, number]> = [[0, 0, 0]]
    for (let i = 1; i <= 15; i++) path.push([i * 5, 0, i * 16])
    drag(el, path)
    expect(onMove).toHaveBeenCalled()
  })

  it('ignores a pointerup that arrives with no preceding pointerdown', () => {
    const el = document.createElement('div')
    const onEnd = vi.fn()
    recognise(el, { onEnd }, { threshold: 1 }, deps)
    expect(() => el.dispatchEvent(pointer('pointerup', 0, 0))).not.toThrow()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('emits a swipe on a fast release', () => {
    const el = document.createElement('div')
    const onSwipe = vi.fn()
    recognise(el, { onSwipe }, { threshold: 1, swipeVelocity: 300 }, deps)
    drag(el, [
      [0, 0, 0],
      [200, 0, 50],
    ])
    expect(onSwipe).toHaveBeenCalledWith('right', expect.anything())
  })

  it('does not emit a swipe on a slow release', () => {
    const el = document.createElement('div')
    const onSwipe = vi.fn()
    recognise(el, { onSwipe }, { threshold: 1, swipeVelocity: 300 }, deps)
    drag(el, [
      [0, 0, 0],
      [20, 0, 900],
    ])
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('fires long-press while the pointer is held still', () => {
    const el = document.createElement('div')
    const onLongPress = vi.fn()
    recognise(el, { onLongPress }, { longPressMs: 500 }, deps)
    el.dispatchEvent(pointer('pointerdown', 0, 0))
    runTimers()
    expect(onLongPress).toHaveBeenCalledOnce()
  })

  it('cancels long-press once the pointer moves past the threshold', () => {
    const el = document.createElement('div')
    const onLongPress = vi.fn()
    recognise(el, { onLongPress }, { longPressMs: 500, threshold: 4 }, deps)
    el.dispatchEvent(pointer('pointerdown', 0, 0))
    clock = 16
    el.dispatchEvent(pointer('pointermove', 40, 0))
    runTimers()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('fires onEnd on release when a long-press never crossed the drag threshold', () => {
    // Without a matching onEnd, a handler that sets an engaged state in onLongPress (pressable's
    // data-kui-pressed) never gets its release call, because `active` stays false for a long-press
    // that holds still and the main `if (active)` branch above never runs.
    const el = document.createElement('div')
    const onEnd = vi.fn()
    const onLongPress = vi.fn()
    recognise(el, { onEnd, onLongPress }, { longPressMs: 500 }, deps)
    el.dispatchEvent(pointer('pointerdown', 0, 0))
    runTimers()
    expect(onLongPress).toHaveBeenCalledOnce()

    el.dispatchEvent(pointer('pointerup', 0, 0))
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('ends the gesture on pointercancel, not just pointerup', () => {
    // A gesture interrupted by the browser otherwise leaves the recogniser permanently mid-drag.
    const el = document.createElement('div')
    const onEnd = vi.fn()
    recognise(el, { onEnd }, { threshold: 1 }, deps)
    el.dispatchEvent(pointer('pointerdown', 0, 0))
    clock = 16
    el.dispatchEvent(pointer('pointermove', 40, 0))
    el.dispatchEvent(pointer('pointercancel', 40, 0))
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('ignores moves that arrive before any pointerdown', () => {
    const el = document.createElement('div')
    const onMove = vi.fn()
    recognise(el, { onMove }, { threshold: 1 }, deps)
    el.dispatchEvent(pointer('pointermove', 50, 50))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('removes every listener on teardown', () => {
    const el = document.createElement('div')
    const onMove = vi.fn()
    recognise(el, { onMove }, { threshold: 1 }, deps)()
    drag(el, [
      [0, 0, 0],
      [50, 0, 16],
    ])
    expect(onMove).not.toHaveBeenCalled()
  })
})
