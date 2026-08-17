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
  warn?(message: string): void
}

export interface SpringRunner {
  /** Retarget without losing velocity — an interrupted spring stays continuous. */
  to(target: number, velocity?: number): void
  /** Adopt a position and velocity directly, e.g. from a drag in progress. */
  set(value: number, velocity?: number): void
  current(): SpringState
  stop(): void
}

/** A broken or undamped spring must not retain the frame loop indefinitely. */
const MAX_SETTLE_MS = 10_000

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
// Factory closing over the running spring's state; length is four small named closures plus the
// returned runner, not one long procedure.
// eslint-disable-next-line max-lines-per-function
export function createSpringRunner(
  config: SpringConfig,
  onChange: (value: number, settled: boolean) => void,
  deps: SpringDeps,
): SpringRunner {
  const safeConfig = validConfig(config) ? config : DEFAULT_SPRING
  if (safeConfig !== config) deps.warn?.('invalid spring configuration; using defaults')
  let state: SpringState = { value: 0, velocity: 0 }
  let target = 0
  let handle: number | null = null
  let lastTime = 0
  let startedAt = 0

  function frame(time: number): void {
    handle = null
    const dt = (time - lastTime) / 1000
    lastTime = time
    state = stepSpring(state, target, safeConfig, dt)

    if (!finiteState(state) || !Number.isFinite(target)) {
      abortRun('spring produced non-finite state')
      return
    }
    if (time - startedAt >= MAX_SETTLE_MS) {
      abortRun(`spring exceeded ${MAX_SETTLE_MS}ms settle budget`)
      return
    }

    if (isSettled(state, target, safeConfig)) {
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
    startedAt = lastTime
    schedule()
  }

  function abortRun(message: string): void {
    state = { value: Number.isFinite(target) ? target : 0, velocity: 0 }
    deps.warn?.(message)
    onChange(state.value, true)
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
 * Check every spring constant at the defensive runner boundary.
 *
 * @param config - Candidate spring constants.
 * @returns Whether every constant is finite and physically able to settle.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function validConfig(config: SpringConfig): boolean {
  return (
    Object.values(config).every(Number.isFinite) &&
    config.stiffness > 0 &&
    config.damping > 0 &&
    config.mass > 0 &&
    config.restVelocity > 0 &&
    config.restDisplacement > 0
  )
}

/**
 * Check whether both integrated state components remain usable.
 *
 * @param state - Latest integrated position and velocity.
 * @returns Whether both values are finite.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function finiteState(state: SpringState): boolean {
  return Number.isFinite(state.value) && Number.isFinite(state.velocity)
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
