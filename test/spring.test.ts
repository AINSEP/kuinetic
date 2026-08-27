import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSpringRunner,
  DEFAULT_SPRING,
  defaultSpringDeps,
  isSettled,
  stepSpring,
} from '../src/core/spring.js'
import type { SpringDeps } from '../src/core/spring.js'

/**
 * The integrator is a pure function of (state, target, config, dt), so the physics is asserted
 * with numbers alone — no rAF, no timers, no DOM.
 */

const CONFIG = DEFAULT_SPRING

function settle(from: number, target: number, steps = 600): number {
  let state = { value: from, velocity: 0 }
  for (let i = 0; i < steps; i++) state = stepSpring(state, target, CONFIG, 1 / 60)
  return state.value
}

describe('stepSpring', () => {
  it('moves toward the target', () => {
    const next = stepSpring({ value: 0, velocity: 0 }, 100, CONFIG, 1 / 60)
    expect(next.value).toBeGreaterThan(0)
    expect(next.value).toBeLessThan(100)
  })

  it('converges on the target', () => {
    expect(settle(0, 100)).toBeCloseTo(100, 1)
  })

  it('converges from above as well as below', () => {
    expect(settle(200, 100)).toBeCloseTo(100, 1)
  })

  it('does not mutate the input state', () => {
    const state = { value: 0, velocity: 0 }
    stepSpring(state, 100, CONFIG, 1 / 60)
    expect(state).toEqual({ value: 0, velocity: 0 })
  })

  it('carries initial velocity into the motion', () => {
    // A throw must start at the finger's speed; this is the whole reason a spring is used.
    const still = stepSpring({ value: 0, velocity: 0 }, 0, CONFIG, 1 / 60)
    const thrown = stepSpring({ value: 0, velocity: 500 }, 0, CONFIG, 1 / 60)
    expect(thrown.value).toBeGreaterThan(still.value)
  })

  it('overshoots when underdamped', () => {
    const bouncy = { ...CONFIG, damping: 4 }
    let state = { value: 0, velocity: 0 }
    let maximum = 0
    for (let i = 0; i < 120; i++) {
      state = stepSpring(state, 100, bouncy, 1 / 60)
      maximum = Math.max(maximum, state.value)
    }
    expect(maximum).toBeGreaterThan(100)
  })

  it('does not overshoot when critically damped', () => {
    // damping = 2 * sqrt(k * m)
    const critical = { ...CONFIG, stiffness: 100, damping: 2 * Math.sqrt(100) }
    let state = { value: 0, velocity: 0 }
    let maximum = 0
    for (let i = 0; i < 300; i++) {
      state = stepSpring(state, 100, critical, 1 / 60)
      maximum = Math.max(maximum, state.value)
    }
    expect(maximum).toBeLessThanOrEqual(100.5)
  })

  it('stays stable across a huge dt instead of diverging', () => {
    // A backgrounded tab returns a multi-second dt. Explicit Euler at that step size gains
    // energy every frame and throws the value to infinity; the fixed substep prevents it.
    const next = stepSpring({ value: 0, velocity: 0 }, 100, CONFIG, 10)
    expect(Number.isFinite(next.value)).toBe(true)
    expect(Math.abs(next.value)).toBeLessThan(1000)
  })

  it('produces the same result at 30fps and 120fps', () => {
    let slow = { value: 0, velocity: 0 }
    let fast = { value: 0, velocity: 0 }
    for (let i = 0; i < 30; i++) slow = stepSpring(slow, 100, CONFIG, 1 / 30)
    for (let i = 0; i < 120; i++) fast = stepSpring(fast, 100, CONFIG, 1 / 120)
    expect(slow.value).toBeCloseTo(fast.value, 0)
  })

  it('ignores a negative dt rather than integrating backwards', () => {
    expect(stepSpring({ value: 5, velocity: 0 }, 100, CONFIG, -1)).toEqual({
      value: 5,
      velocity: 0,
    })
  })
})

describe('isSettled', () => {
  it('is false while still moving fast', () => {
    expect(isSettled({ value: 100, velocity: 50 }, 100, CONFIG)).toBe(false)
  })

  it('is false when far from the target', () => {
    expect(isSettled({ value: 0, velocity: 0 }, 100, CONFIG)).toBe(false)
  })

  it('requires both conditions — passing through the target at speed is not settled', () => {
    expect(isSettled({ value: 100, velocity: 400 }, 100, CONFIG)).toBe(false)
  })

  it('is true when slow and close', () => {
    expect(isSettled({ value: 100.01, velocity: 0.01 }, 100, CONFIG)).toBe(true)
  })
})

describe('createSpringRunner', () => {
  function fakeDeps() {
    const frames: Array<(time: number) => void> = []
    const deps: SpringDeps = {
      requestFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
      now: () => 0,
    }
    /** Run queued frames, advancing 16ms each. */
    const tick = (count: number): void => {
      for (let i = 0; i < count; i++) {
        const next = frames.shift()
        if (next) next((i + 1) * 16)
      }
    }
    return { deps, tick, pending: () => frames.length }
  }

  it('emits values while moving and stops on settle', () => {
    const { deps, tick, pending } = fakeDeps()
    const values: number[] = []
    let settledFlag = false

    const runner = createSpringRunner(
      CONFIG,
      (value, settled) => {
        values.push(value)
        settledFlag ||= settled
      },
      deps,
    )
    runner.to(100)
    tick(400)

    expect(values.length).toBeGreaterThan(1)
    expect(settledFlag).toBe(true)
    expect(values.at(-1)).toBe(100)
    // The loop must not keep scheduling after settling.
    expect(pending()).toBe(0)
  })

  it('adopts a position and velocity without animating from zero', () => {
    const { deps } = fakeDeps()
    const runner = createSpringRunner(CONFIG, () => {}, deps)
    runner.set(50, 300)
    expect(runner.current()).toEqual({ value: 50, velocity: 300 })
  })

  it('retargets without losing velocity, so an interrupted spring stays continuous', () => {
    const { deps, tick } = fakeDeps()
    const runner = createSpringRunner(CONFIG, () => {}, deps)
    runner.to(100)
    tick(5)
    const mid = runner.current()
    expect(mid.velocity).toBeGreaterThan(0)

    runner.to(0)
    expect(runner.current().velocity).toBe(mid.velocity)
  })

  it('cancels its pending frame on stop', () => {
    const { deps } = fakeDeps()
    const runner = createSpringRunner(CONFIG, () => {}, deps)
    runner.to(100)
    runner.stop()
    expect(deps.cancelFrame).toHaveBeenCalled()
  })

  it('falls back from an invalid config instead of scheduling forever', () => {
    const { deps, tick, pending } = fakeDeps()
    deps.warn = vi.fn()
    const runner = createSpringRunner({ ...CONFIG, stiffness: 0 }, () => {}, deps)
    runner.set(100)
    runner.to(0)
    tick(400)
    expect(deps.warn).toHaveBeenCalledWith('invalid spring configuration; using defaults')
    expect(pending()).toBe(0)
  })

  it('aborts and reports a non-finite state', () => {
    const { deps, tick, pending } = fakeDeps()
    deps.warn = vi.fn()
    const runner = createSpringRunner(CONFIG, () => {}, deps)
    runner.set(Number.POSITIVE_INFINITY)
    runner.to(0)
    tick(1)
    expect(deps.warn).toHaveBeenCalledWith('spring produced non-finite state')
    expect(pending()).toBe(0)
  })

  it('aborts to a fallback of 0 when the target itself, not just the state, is non-finite', () => {
    const { deps, tick } = fakeDeps()
    deps.warn = vi.fn()
    const values: number[] = []
    const runner = createSpringRunner(CONFIG, (value) => values.push(value), deps)
    runner.to(Number.POSITIVE_INFINITY)
    tick(1)
    expect(deps.warn).toHaveBeenCalledWith('spring produced non-finite state')
    expect(values.at(-1)).toBe(0)
  })

  it('adopts an explicit retarget velocity synchronously, before any frame runs', () => {
    const { deps } = fakeDeps()
    const runner = createSpringRunner(CONFIG, () => {}, deps)
    runner.to(50, 200)
    expect(runner.current().velocity).toBe(200)
  })

  it('stops a valid but non-settling run at the settle budget', () => {
    const { deps, tick, pending } = fakeDeps()
    deps.warn = vi.fn()
    const runner = createSpringRunner(
      { ...CONFIG, stiffness: 0.000001, damping: 0.000001 },
      () => {},
      deps,
    )
    runner.set(100)
    runner.to(0)
    tick(700)
    expect(deps.warn).toHaveBeenCalledWith('spring exceeded 10000ms settle budget')
    expect(pending()).toBe(0)
  })
})

describe('defaultSpringDeps', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to a setTimeout-based frame source when requestAnimationFrame is unavailable', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.useFakeTimers()
    const deps = defaultSpringDeps()
    expect(typeof deps.now()).toBe('number')

    const callback = vi.fn()
    const handle = deps.requestFrame(callback)
    vi.advanceTimersByTime(16)
    expect(callback).toHaveBeenCalledOnce()

    const secondHandle = deps.requestFrame(callback)
    deps.cancelFrame(secondHandle)
    vi.advanceTimersByTime(16)
    expect(callback).toHaveBeenCalledOnce()
    expect(handle).not.toBe(secondHandle)
    vi.useRealTimers()
  })

  it('uses requestAnimationFrame when it is available', () => {
    const deps = defaultSpringDeps()
    expect(typeof deps.now()).toBe('number')
    const callback = vi.fn()
    const handle = deps.requestFrame(callback)
    expect(() => deps.cancelFrame(handle)).not.toThrow()
  })
})

/**
 * A retarget is not a restart.
 *
 * Pointer-driven springs (`cursor-lag`, `magnetic`) are re-aimed on every `pointermove`, which
 * lands microseconds before the frame it causes. The integration clock has to survive that: a
 * spring that re-aims at 120Hz must advance by exactly as much wall time as one that was aimed
 * once, or the whole effect crawls and does so by a frame-order-dependent amount.
 */
describe('createSpringRunner retarget timing', () => {
  /**
   * Run the same spring for `frames` steps of `frameMs`, optionally re-aiming at the *same* target
   * `retargetLeadMs` before each frame. Re-aiming at a value the spring is already pulling toward
   * carries no new information, so it must not change a single integrated value.
   */
  function runFrames(options: {
    frames: number
    frameMs: number
    retargetLeadMs: number | null
  }): number {
    let time = 0
    const queue: Array<(t: number) => void> = []
    const deps: SpringDeps = {
      requestFrame: (callback) => queue.push(callback),
      cancelFrame: () => {},
      now: () => time,
    }
    let latest = 0
    const runner = createSpringRunner(CONFIG, (value) => {
      latest = value
    }, deps)
    runner.to(100)

    for (let i = 0; i < options.frames; i++) {
      if (options.retargetLeadMs === null) {
        time += options.frameMs
      } else {
        time += options.frameMs - options.retargetLeadMs
        runner.to(100)
        time += options.retargetLeadMs
      }
      queue.shift()?.(time)
    }
    return latest
  }

  // The lead is varied deliberately: the defect scaled with how close the event landed to the
  // frame, so freezing one lead would leave every other pointer cadence untested.
  it.each([
    { frameMs: 16, retargetLeadMs: 0.2 },
    { frameMs: 16, retargetLeadMs: 1 },
    { frameMs: 16, retargetLeadMs: 8 },
    { frameMs: 8, retargetLeadMs: 0.5 },
    { frameMs: 33, retargetLeadMs: 2 },
  ])(
    'integrates the same physics whether or not it is re-aimed $retargetLeadMs ms before each $frameMs ms frame',
    ({ frameMs, retargetLeadMs }) => {
      const frames = 20
      const aimedOnce = runFrames({ frames, frameMs, retargetLeadMs: null })
      const reAimed = runFrames({ frames, frameMs, retargetLeadMs })

      // Guard against both runs being trivially equal at ~0.
      expect(aimedOnce).toBeGreaterThan(50)
      expect(reAimed).toBeCloseTo(aimedOnce, 6)
    },
  )

  it('starts a fresh integration clock when re-aimed after the loop has gone idle', () => {
    // The other half of the same rule: an idle gap is not physics either. A spring that settled,
    // sat for five seconds, and is then re-aimed must integrate one frame, not five seconds
    // clamped to the catch-up ceiling.
    let time = 0
    const queue: Array<(t: number) => void> = []
    const deps: SpringDeps = {
      requestFrame: (callback) => queue.push(callback),
      cancelFrame: () => {},
      now: () => time,
    }
    let latest = 0
    const runner = createSpringRunner(CONFIG, (value) => {
      latest = value
    }, deps)

    runner.to(100)
    while (queue.length > 0) {
      time += 16
      queue.shift()?.(time)
    }
    expect(latest).toBe(100)

    time += 5000
    runner.to(0)
    time += 16
    queue.shift()?.(time)

    expect(latest).toBeCloseTo(stepSpring({ value: 100, velocity: 0 }, 0, CONFIG, 0.016).value, 6)
  })
})
