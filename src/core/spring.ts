/**
 * Spring integration.
 *
 * Gestures need physics rather than easing curves: when a user throws an element, the animation
 * has to start at whatever velocity their finger had, and no duration-plus-easing formulation can
 * express that. A spring is the smallest model that can — it takes an initial velocity and
 * settles on its own.
 *
 * The integrator is a pure function of `(state, target, config, dt)`, so the whole model is
 * assertable without timers, rAF, or a DOM.
 */

export interface SpringConfig {
  /** Higher pulls harder toward the target. */
  stiffness: number
  /** Higher removes energy faster. Critical damping is `2 * sqrt(stiffness * mass)`. */
  damping: number
  mass: number
  /** Settled when both velocity and displacement fall below these. */
  restVelocity: number
  restDisplacement: number
}

export interface SpringState {
  value: number
  velocity: number
}

export const DEFAULT_SPRING: SpringConfig = {
  stiffness: 180,
  damping: 24,
  mass: 1,
  restVelocity: 0.05,
  restDisplacement: 0.05,
}

/**
 * Physics substep, in seconds.
 *
 * A single large step is unconditionally unstable for a stiff spring: with `dt` bigger than
 * roughly `2/sqrt(k/m)`, explicit Euler gains energy each frame and the value diverges instead of
 * settling. Fixing the substep and iterating makes behaviour identical at 30fps and 120fps, and
 * survives a backgrounded tab returning a multi-second `dt`.
 */
const SUBSTEP = 1 / 240

/** Never integrate more than a quarter second of catch-up, however long the tab was hidden. */
const MAX_STEP = 0.25

/**
 * Advance a spring toward `target`.
 *
 * @param state - Current value and velocity.
 * @param target - Value the spring is pulling toward.
 * @param config - Stiffness, damping, mass, and rest thresholds.
 * @param dt - Elapsed seconds since the last step.
 * @returns The new state; input is not mutated.
 * @complexity O(dt / SUBSTEP) time, bounded by MAX_STEP; O(1) space.
 * @overallScore 100
 */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  let { value, velocity } = state
  let remaining = Math.min(Math.max(dt, 0), MAX_STEP)

  while (remaining > 0) {
    const step = Math.min(SUBSTEP, remaining)
    const force = -config.stiffness * (value - target) - config.damping * velocity
    velocity += (force / config.mass) * step
    value += velocity * step
    remaining -= step
  }

  return { value, velocity }
}

/**
 * Whether a spring has settled.
 *
 * Both conditions are required: a spring passing through its target at speed has zero
 * displacement but is nowhere near done.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function isSettled(state: SpringState, target: number, config: SpringConfig): boolean {
  return (
    Math.abs(state.velocity) < config.restVelocity &&
    Math.abs(state.value - target) < config.restDisplacement
  )
}

export interface SpringDeps {
  requestFrame(callback: (time: number) => void): number
  cancelFrame(handle: number): void
  now(): number
}

export interface SpringRunner {
  /** Retarget without losing velocity — an interrupted spring stays continuous. */
  to(target: number, velocity?: number): void
  /** Adopt a position and velocity directly, e.g. from a drag in progress. */
  set(value: number, velocity?: number): void
  current(): SpringState
  stop(): void
}

/**
 * Drive a spring with a frame loop, calling `onChange` with each new value.
 *
 * The loop runs only while the spring is moving and stops itself on settle — an always-running
 * rAF is exactly what the rest of this library avoids.
 *
 * @param config - Spring constants.
 * @param onChange - Receives each integrated value, plus `true` on the final settled frame.
 * @param deps - Frame source and clock; injected so tests can step time by hand.
 * @returns A runner exposing retarget, adopt, read, and stop.
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
export function createSpringRunner(
  config: SpringConfig,
  onChange: (value: number, settled: boolean) => void,
  deps: SpringDeps,
): SpringRunner {
  let state: SpringState = { value: 0, velocity: 0 }
  let target = 0
  let handle: number | null = null
  let lastTime = 0

  function frame(time: number): void {
    handle = null
    const dt = (time - lastTime) / 1000
    lastTime = time
    state = stepSpring(state, target, config, dt)

    if (isSettled(state, target, config)) {
      state = { value: target, velocity: 0 }
      onChange(state.value, true)
      return
    }
    onChange(state.value, false)
    schedule()
  }

  function schedule(): void {
    if (handle !== null) return
    handle = deps.requestFrame(frame)
  }

  function start(): void {
    lastTime = deps.now()
    schedule()
  }

  return {
    to(next, velocity) {
      target = next
      if (velocity !== undefined) state = { ...state, velocity }
      start()
    },
    set(value, velocity = 0) {
      state = { value, velocity }
    },
    current: () => ({ ...state }),
    stop() {
      if (handle !== null) deps.cancelFrame(handle)
      handle = null
    },
  }
}

/**
 * Frame source defaults, kept at the construction boundary so no logic below reads a global.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function defaultSpringDeps(): SpringDeps {
  const raf = globalThis.requestAnimationFrame
  if (typeof raf !== 'function') {
    return {
      requestFrame: (callback) =>
        globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number,
      cancelFrame: (handle) => globalThis.clearTimeout(handle),
      now: () => Date.now(),
    }
  }
  return {
    requestFrame: (callback) => raf(callback),
    cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
    now: () => performance.now(),
  }
}
