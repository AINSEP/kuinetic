// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/**
 * Unit coverage for `pressable`, which had none.
 *
 * `pressable` is the one member of the gesture family whose `duration` is honoured, and it does not
 * mean what `duration` means anywhere else in the catalog — it is the hold threshold, not a span of
 * motion. Nothing asserted that before, so `long-press 800ms` counting at 500ms would have gone
 * unnoticed.
 *
 * The whole primitive is timer-driven, which is precisely what a fake clock is for; no part of it
 * needs a real browser.
 */

const pressable = GESTURE_PRIMITIVES.find((primitive) => primitive.id === 'pressable')!

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

function mount(
  params: Record<string, string> = {},
  timing: { durationMs?: number } = {},
): { el: HTMLElement; destroy: () => void } {
  const el = document.createElement('div')
  document.body.append(el)
  // `deferPrepare` means the wiring only happens on `activate()` — the animator decides when a
  // gesture starts listening, the same as every other JS-rendered effect.
  const instance = pressable.prepare!(el, createParams(params, timing), stubCtx())
  instance.activate()
  return {
    el,
    destroy: () => {
      instance.destroy()
      el.remove()
    },
  }
}

describe('pressable', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('engages once the hold threshold passes and releases on pointerup', () => {
    const { el, destroy } = mount()

    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(499)
    // One millisecond short is still a tap. Pinning the moment *before* as well as after is what
    // makes this a threshold assertion rather than an "eventually true" one.
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    vi.advanceTimersByTime(1)
    expect(el.getAttribute('data-kui-pressed')).toBe('true')

    pointer(el, 'pointerup', 10, 10)
    // A long press never crosses the drag threshold, so the recogniser's `active` branch never
    // runs; without its `longPressFired` fallback the element would stay stuck engaged forever.
    expect(el.getAttribute('data-kui-pressed')).toBe('false')

    destroy()
  })

  it('leaves a short tap unmarked, and no late timer revives it', () => {
    const { el, destroy } = mount()

    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(400)
    pointer(el, 'pointerup', 10, 10)
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    // The pending hold timer must die with the gesture. If release only stopped listening, this
    // would stamp 'true' on an element the finger left a second ago.
    vi.advanceTimersByTime(5000)
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    destroy()
  })

  it('takes the hold threshold from duration:, which here means hold not motion', () => {
    const { el, destroy } = mount({ duration: '800ms' })

    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(500)
    // The default would have fired by now. This is the assertion that `long-press 800ms` counts at
    // 800ms and not at the built-in 500.
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    vi.advanceTimersByTime(300)
    expect(el.getAttribute('data-kui-pressed')).toBe('true')

    destroy()
  })

  it('prefers the segment timing the author wrote over the named parameter', () => {
    // Both spellings present and disagreeing, so only the precedence can explain the outcome.
    const { el, destroy } = mount({ duration: '800ms' }, { durationMs: 200 })

    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(200)
    // Reading `params.ms('duration')` directly instead of going through `effectDurationMs` would
    // give 800 here and this would still be unmarked.
    expect(el.getAttribute('data-kui-pressed')).toBe('true')

    destroy()
  })

  it('does not engage when the finger moves — a drag is not a hold', () => {
    const { el, destroy } = mount()

    pointer(el, 'pointerdown', 0, 0)
    vi.advanceTimersByTime(100)
    pointer(el, 'pointermove', 50, 0)
    vi.advanceTimersByTime(2000)
    // Well past the threshold in wall time, but the movement cancelled the pending hold.
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    pointer(el, 'pointerup', 50, 0)
    expect(el.getAttribute('data-kui-pressed')).toBe('false')

    destroy()
  })

  it('clears the pressed mark on teardown and stops listening', () => {
    const { el, destroy } = mount()

    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(500)
    expect(el.getAttribute('data-kui-pressed')).toBe('true')

    destroy()
    // Tearing down mid-press must not leave the element permanently styled as held.
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)

    document.body.append(el)
    pointer(el, 'pointerdown', 10, 10)
    vi.advanceTimersByTime(2000)
    expect(el.hasAttribute('data-kui-pressed')).toBe(false)
    el.remove()
  })
})
