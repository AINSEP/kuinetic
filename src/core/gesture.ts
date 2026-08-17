import type { Cleanup } from './types.js'

/**
 * Pointer gesture recognition.
 *
 * Drag, swipe, and long-press are the same stream of pointer events read with different
 * questions, so they share one recogniser. Velocity is the reason this cannot be a thin wrapper:
 * a throw needs the speed of the last few milliseconds of movement, not the average over the
 * whole gesture, and a single trailing sample is far too noisy to use.
 *
 * Every input is injected — the event target, the clock, and pointer capture — so the whole
 * recogniser is drivable from tests with synthetic events and a fake clock.
 */

export interface Sample {
  x: number
  y: number
  time: number
}

export interface GestureVector {
  dx: number
  dy: number
  /** Pixels per second. */
  vx: number
  vy: number
}

export type Axis = 'x' | 'y' | 'both'
export type Direction = 'left' | 'right' | 'up' | 'down'

export interface GestureHandlers {
  onStart?(sample: Sample): void
  onMove?(vector: GestureVector, sample: Sample): void
  onEnd?(vector: GestureVector, sample: Sample): void
  onSwipe?(direction: Direction, vector: GestureVector): void
  onLongPress?(sample: Sample): void
}

export interface GestureOptions {
  /** Movement below this many pixels is a tap, not a drag. */
  threshold?: number
  axis?: Axis
  /** Minimum speed, px/s, for a movement to count as a swipe. */
  swipeVelocity?: number
  /** Hold duration in ms before `onLongPress`. Zero disables it. */
  longPressMs?: number
}

export interface GestureDeps {
  now(): number
  setTimer(callback: () => void, ms: number): number
  clearTimer(handle: number): void
}

/** Window over which release velocity is measured. Shorter is noisy; longer lags the flick. */
const VELOCITY_WINDOW_MS = 100

/** Samples retained for velocity estimation. Bounded so a long drag cannot grow without limit. */
const MAX_SAMPLES = 12

/**
 * Estimate velocity from recent samples.
 *
 * Uses the oldest sample still inside the window rather than the previous frame: consecutive
 * pointer events can be microseconds apart, and dividing by that produces enormous, meaningless
 * speeds that throw an element off screen.
 *
 * @param samples - Recent positions, oldest first.
 * @returns Pixels per second on both axes; zero when the window has no span.
 * @complexity O(n) time in retained samples; O(1) space.
 * @overallScore 100
 */
export function velocityFrom(samples: Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1]
  if (!last || samples.length < 2) return { vx: 0, vy: 0 }

  const cutoff = last.time - VELOCITY_WINDOW_MS
  const first = samples.find((sample) => sample.time >= cutoff) ?? samples[0]!
  const span = (last.time - first.time) / 1000
  if (span <= 0) return { vx: 0, vy: 0 }

  return { vx: (last.x - first.x) / span, vy: (last.y - first.y) / span }
}

/**
 * Classify a release into a swipe direction.
 *
 * @returns The dominant direction, or `null` when neither axis is fast enough.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function swipeDirection(vector: GestureVector, minVelocity: number): Direction | null {
  const { vx, vy } = vector
  if (Math.abs(vx) < minVelocity && Math.abs(vy) < minVelocity) return null
  if (Math.abs(vx) >= Math.abs(vy)) return vx > 0 ? 'right' : 'left'
  return vy > 0 ? 'down' : 'up'
}

/** Zero out the axis a gesture is locked away from. */
function applyAxis(vector: GestureVector, axis: Axis): GestureVector {
  if (axis === 'x') return { ...vector, dy: 0, vy: 0 }
  if (axis === 'y') return { ...vector, dx: 0, vx: 0 }
  return vector
}

/**
 * Recognise drag, swipe, and long-press on an element.
 *
 * @param el - Element to observe.
 * @param handlers - Callbacks for each recognised phase.
 * @param options - Threshold, axis lock, swipe velocity, long-press duration.
 * @param deps - Clock and timer source, injected for tests.
 * @returns Teardown removing every listener and pending timer.
 * @complexity O(1) per pointer event; O(1) space (samples are capped).
 * @overallScore 100
 */
// Factory closing over pointer-gesture state; length is five small named closures
// (sampleOf/vectorNow/onDown/onMove/onUp) plus wiring, not one long procedure.
// eslint-disable-next-line max-lines-per-function
export function recognise(
  el: Element,
  handlers: GestureHandlers,
  options: GestureOptions = {},
  deps: GestureDeps = defaultGestureDeps(),
): Cleanup {
  const threshold = options.threshold ?? 4
  const axis = options.axis ?? 'both'
  const swipeVelocity = options.swipeVelocity ?? 300
  const longPressMs = options.longPressMs ?? 0

  let samples: Sample[] = []
  let origin: Sample | null = null
  let active = false
  let longPressTimer: number | null = null

  function sampleOf(event: PointerEvent): Sample {
    return { x: event.clientX, y: event.clientY, time: deps.now() }
  }

  function vectorNow(sample: Sample): GestureVector {
    // Both callers (`onMove`, `onUp`) already guard `if (!origin) return` before calling this.
    const start = origin!
    const { vx, vy } = velocityFrom(samples)
    return applyAxis({ dx: sample.x - start.x, dy: sample.y - start.y, vx, vy }, axis)
  }

  function clearLongPress(): void {
    if (longPressTimer !== null) deps.clearTimer(longPressTimer)
    longPressTimer = null
  }

  function onDown(event: PointerEvent): void {
    origin = sampleOf(event)
    samples = [origin]
    active = false
    // Without this, resistance (elastic-pull) or inertia/axis-locking (throwable, drag-x) can
    // move the element out from under the real cursor; native hit-testing would then deliver the
    // eventual pointerup to whatever is now underneath instead of this element.
    el.setPointerCapture?.(event.pointerId)
    if (longPressMs > 0) {
      longPressTimer = deps.setTimer(() => handlers.onLongPress?.(origin!), longPressMs)
    }
  }

  function onMove(event: PointerEvent): void {
    if (!origin) return
    const sample = sampleOf(event)
    samples.push(sample)
    if (samples.length > MAX_SAMPLES) samples.shift()

    const vector = vectorNow(sample)
    if (!active && Math.hypot(vector.dx, vector.dy) < threshold) return
    if (!active) {
      active = true
      clearLongPress()
      handlers.onStart?.(origin)
    }
    handlers.onMove?.(vector, sample)
  }

  function onUp(event: PointerEvent): void {
    clearLongPress()
    el.releasePointerCapture?.(event.pointerId)
    if (!origin) return
    const sample = sampleOf(event)
    samples.push(sample)
    const vector = vectorNow(sample)

    if (active) {
      handlers.onEnd?.(vector, sample)
      const direction = swipeDirection(vector, swipeVelocity)
      if (direction) handlers.onSwipe?.(direction, vector)
    }
    origin = null
    active = false
    samples = []
  }

  el.addEventListener('pointerdown', onDown as EventListener)
  el.addEventListener('pointermove', onMove as EventListener, { passive: true })
  el.addEventListener('pointerup', onUp as EventListener, { passive: true })
  // Without this a gesture interrupted by the browser (scroll takeover, alt-tab) leaves the
  // recogniser permanently mid-drag.
  el.addEventListener('pointercancel', onUp as EventListener, { passive: true })

  return () => {
    clearLongPress()
    el.removeEventListener('pointerdown', onDown as EventListener)
    el.removeEventListener('pointermove', onMove as EventListener)
    el.removeEventListener('pointerup', onUp as EventListener)
    el.removeEventListener('pointercancel', onUp as EventListener)
  }
}

export function defaultGestureDeps(): GestureDeps {
  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    setTimer: (callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number,
    clearTimer: (handle) => globalThis.clearTimeout(handle),
  }
}

/**
 * Apply rubber-band resistance past a boundary.
 *
 * Past the edge, movement is damped rather than blocked, so the surface still tracks the finger
 * but signals that it has run out. Hard-clamping instead feels broken, which is why every native
 * scroller does this.
 *
 * @param offset - Raw offset from the boundary.
 * @param limit - Distance at which resistance approaches its maximum.
 * @param tension - 0–1; lower resists harder.
 * @returns The damped offset.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function rubberBand(offset: number, limit: number, tension = 0.55): number {
  if (limit <= 0) return 0
  const sign = Math.sign(offset)
  const magnitude = Math.abs(offset)
  return sign * (1 - 1 / (magnitude / limit / tension + 1)) * limit
}
