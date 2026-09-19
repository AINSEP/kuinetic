// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/**
 * Unit coverage for `swipeable`, which had none.
 *
 * Until now this primitive was exercised only by `test/browser/gestures.test.mjs`, and
 * `vitest.config.ts` excluded the whole file from coverage on the stated grounds that pointer
 * gestures need a real browser. They do not: `recognise` takes its clock through injected deps and
 * reads nothing off a pointer event but `clientX`, `clientY` and `pointerId`, so a synthetic event
 * plus a fake clock drives the entire recogniser.
 *
 * Fake timers are not a convenience here, they are the point. A swipe is a *velocity* judgement,
 * and velocity is distance over elapsed time read from `performance.now()`. Under the real clock
 * the speed of a scripted flick is whatever the machine happened to manage, so neither the
 * `velocity:` threshold nor the direction classification can be asserted at all. Faking
 * `performance` makes every flick below exactly 1000px/s.
 */

const swipeable = GESTURE_PRIMITIVES.find((primitive) => primitive.id === 'swipeable')!

/** Enough of a context for `withTimingContract`; this primitive writes no styles. */
function stubCtx(): PrepareContext {
  return {
    doc: document,
    win: window,
    warn: vi.fn(),
    style: { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new Event(type, { bubbles: true }) as PointerEvent & {
    clientX: number
    clientY: number
    pointerId: number
  }
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 })
  target.dispatchEvent(event)
}

/**
 * A flick covering the distance from `from` to `to` in exactly 100ms of fake time.
 *
 * 100ms is `VELOCITY_WINDOW_MS`, so every sample taken is inside the window and the reported speed
 * is exactly `distance / 0.1` px/s — 1000px/s for the 100px flicks used throughout.
 */
function flick(el: Element, from: { x: number; y: number }, to: { x: number; y: number }): void {
  pointer(el, 'pointerdown', from.x, from.y)
  for (let step = 1; step <= 4; step++) {
    vi.advanceTimersByTime(25)
    pointer(el, 'pointermove', from.x + ((to.x - from.x) * step) / 4, from.y + ((to.y - from.y) * step) / 4)
  }
  pointer(el, 'pointerup', to.x, to.y)
}

function mount(params: Record<string, string> = {}): {
  el: HTMLElement
  destroy: () => void
} {
  const el = document.createElement('div')
  document.body.append(el)
  // `deferPrepare` means the wiring only happens on `activate()` — the animator decides when a
  // gesture starts listening, the same as every other JS-rendered effect.
  const instance = swipeable.prepare!(el, createParams(params), stubCtx())
  instance.activate()
  return {
    el,
    destroy: () => {
      instance.destroy()
      el.remove()
    },
  }
}

describe('swipeable', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['right', { x: 0, y: 0 }, { x: 100, y: 0 }],
    ['left', { x: 100, y: 0 }, { x: 0, y: 0 }],
    ['down', { x: 0, y: 0 }, { x: 0, y: 100 }],
    ['up', { x: 0, y: 100 }, { x: 0, y: 0 }],
  ])('publishes the direction actually travelled as data-kui-swipe=%s', (direction, from, to) => {
    const { el, destroy } = mount()

    flick(el, from, to)

    // All four, because the attribute is the entire output of this primitive: a handler that
    // stamped a constant, or read the wrong axis, would satisfy any single-direction assertion.
    expect(el.getAttribute('data-kui-swipe')).toBe(direction)

    destroy()
  })

  it('raises the bar with velocity:, so a flick that qualifies by default no longer does', () => {
    const fast = mount()
    flick(fast.el, { x: 0, y: 0 }, { x: 100, y: 0 })
    // 100px in 100ms is 1000px/s, comfortably past the 300px/s default.
    expect(fast.el.getAttribute('data-kui-swipe')).toBe('right')
    fast.destroy()

    const strict = mount({ velocity: '1200' })
    flick(strict.el, { x: 0, y: 0 }, { x: 100, y: 0 })
    // Same gesture, same speed: only the authored threshold differs, so this pins that `velocity:`
    // reaches `swipeVelocity` rather than the recogniser's own default being used regardless.
    expect(strict.el.hasAttribute('data-kui-swipe')).toBe(false)
    strict.destroy()
  })

  it('classifies within the locked axis, not across both', () => {
    // Travels three times as far down as right, so the dominant axis is unambiguously vertical.
    const free = mount()
    flick(free.el, { x: 0, y: 0 }, { x: 100, y: 300 })
    expect(free.el.getAttribute('data-kui-swipe')).toBe('down')
    free.destroy()

    const locked = mount({ axis: 'x' })
    flick(locked.el, { x: 0, y: 0 }, { x: 100, y: 300 })
    // `axis: 'x'` zeroes `vy` before classification, so the faster vertical travel is discarded
    // and the weaker horizontal component decides. Without `axis:` reaching the recogniser this
    // would read 'down' exactly as the unlocked case does.
    expect(locked.el.getAttribute('data-kui-swipe')).toBe('right')
    locked.destroy()
  })

  it('never takes pointer capture, so clicks still reach interactive children', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(el, { setPointerCapture, releasePointerCapture })

    const instance = swipeable.prepare!(el, createParams({}), stubCtx())
    instance.activate()
    flick(el, { x: 0, y: 0 }, { x: 100, y: 0 })

    // The gesture is recognised...
    expect(el.getAttribute('data-kui-swipe')).toBe('right')
    // ...without ever capturing. Capture retargets the following `click` at the capturing element,
    // which silently killed every dot and button inside a carousel shell carrying `swipe-x`. This
    // primitive moves nothing, so it has nothing to stay under the cursor for.
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(releasePointerCapture).not.toHaveBeenCalled()

    instance.destroy()
    el.remove()
  })

  it('clears the published direction on teardown and stops listening', () => {
    const { el, destroy } = mount()
    flick(el, { x: 0, y: 0 }, { x: 100, y: 0 })
    expect(el.getAttribute('data-kui-swipe')).toBe('right')

    destroy()
    expect(el.hasAttribute('data-kui-swipe')).toBe(false)

    // A stale attribute is the visible half of the leak; a live listener is the half that keeps
    // stamping one. Re-flicking a torn-down element must produce nothing at all.
    document.body.append(el)
    flick(el, { x: 0, y: 0 }, { x: 100, y: 0 })
    expect(el.hasAttribute('data-kui-swipe')).toBe(false)
    el.remove()
  })
})
