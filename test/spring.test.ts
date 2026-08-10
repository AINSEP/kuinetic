import { describe, expect, it, vi } from 'vitest'
import {
  createSpringRunner,
  DEFAULT_SPRING,
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
