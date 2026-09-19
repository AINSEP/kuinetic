// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/**
 * Unit coverage for `draggable`, which had none.
 *
 * The whole family — `drag`, `drag-x`, `drag-y`, `drag-inertia`, `throwable`, `elastic-pull`,
 * `rubber-band`, `snap-back` — is one primitive with two booleans, and until 2026-08-22 it was
 * exercised only by `test/browser/gestures.test.mjs`. That suite drags **once**, from rest, which
 * is the single case where "delta from pointerdown" and "the element's position" are the same
 * number. Two real bugs lived in the gap:
 *
 *   1. a second pickup threw away the first drag and snapped back to the origin;
 *   2. `momentum` was applied on release even with `inertia:false`, so a plain `drag` glided past
 *      the finger — invisible to a suite that paused 150ms before `pointerup`.
 *
 * These tests read the offsets the primitive writes rather than anything rendered, so they need no
 * layout: `writeOffset` is the primitive's only output and `translate` is the whole contract.
 */

const draggable = GESTURE_PRIMITIVES.find((primitive) => primitive.id === 'draggable')!

/** Records every `translate` the primitive writes, in order. */
function recordingCtx(): { ctx: PrepareContext; writes: string[] } {
  const writes: string[] = []
  const ctx = {
    doc: document,
    win: window,
    warn: vi.fn(),
    style: {
      set: (property: string, value: string) => {
        if (property === 'translate') writes.push(value)
      },
      claim: vi.fn(),
      restore: vi.fn(),
      owned: () => [],
    },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
  return { ctx, writes }
}

/** The x/y of the most recent write, as numbers. */
const latest = (writes: string[]): { x: number; y: number } => {
  const [x, y] = (writes.at(-1) ?? '0px 0px').split(' ').map(Number.parseFloat)
  return { x: x ?? 0, y: y ?? 0 }
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const event = new Event(type, { bubbles: true }) as PointerEvent & {
    clientX: number
    clientY: number
    pointerId: number
  }
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 })
  el.dispatchEvent(event)
}

/** One complete press–move–release, in a few steps so the 4px activation threshold is crossed. */
function drag(el: Element, from: { x: number; y: number }, by: { x: number; y: number }): void {
  pointer(el, 'pointerdown', from.x, from.y)
  for (let step = 1; step <= 4; step++) {
    pointer(el, 'pointermove', from.x + (by.x * step) / 4, from.y + (by.y * step) / 4)
  }
  pointer(el, 'pointerup', from.x + by.x, from.y + by.y)
}

/**
 * Everything the release physics need faked.
 *
 * Both halves matter and for different reasons. `performance` is what `recognise` samples to
 * measure release velocity, so without it a throw's speed is whatever the machine managed that run
 * and nothing about `inertia` or `momentum` can be asserted. rAF is what the spring runs on, so
 * without it the settle never happens at all inside a synchronous test.
 */
const FAKE_CLOCK: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: [
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'performance',
    'Date',
  ],
}

/** Long enough for a default spring to reach its rest thresholds and snap onto its target. */
const SETTLE_MS = 3000

function mount(params: Record<string, string> = {}): {
  el: HTMLElement
  writes: string[]
  destroy: () => void
} {
  const el = document.createElement('div')
  document.body.append(el)
  const { ctx, writes } = recordingCtx()
  const instance = draggable.prepare!(el, createParams(params), ctx)
  instance.activate()
  return {
    el,
    writes,
    destroy: () => {
      instance.destroy()
      el.remove()
    },
  }
}

/**
 * A throw from rest covering `by` in exactly 100ms of fake clock.
 *
 * 100ms is the recogniser's whole velocity window, so every sample taken is inside it and the
 * reported release speed is exactly `by / 0.1` px/s — an authored number rather than a measurement.
 *
 * @returns The index the first post-release write will land at, so the settle can be read apart
 * from the drag that preceded it.
 */
function throwBy(el: Element, writes: string[], by: { x: number; y: number }): number {
  pointer(el, 'pointerdown', 0, 0)
  for (let step = 1; step <= 4; step++) {
    vi.advanceTimersByTime(25)
    pointer(el, 'pointermove', (by.x * step) / 4, (by.y * step) / 4)
  }
  const atRelease = writes.length
  pointer(el, 'pointerup', by.x, by.y)
  return atRelease
}

/** The furthest along one axis the element ever got after the finger left it. */
function peakAfter(writes: string[], from: number, axis: 'x' | 'y'): number {
  const component = axis === 'x' ? 0 : 1
  return Math.max(
    ...writes.slice(from).map((value) => Number.parseFloat(value.split(' ')[component]!)),
  )
}

/** Press and move to `to` without lifting, so the resisted offset can be read mid-gesture. */
function pressAndMove(el: Element, to: { x: number; y: number }): void {
  pointer(el, 'pointerdown', 0, 0)
  for (let step = 1; step <= 4; step++) {
    pointer(el, 'pointermove', (to.x * step) / 4, (to.y * step) / 4)
  }
}

describe('draggable', () => {
  it('continues from where the element rests when it is picked up again', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const { ctx, writes } = recordingCtx()
    // `deferPrepare` means the wiring only happens on `activate()` — the animator decides when a
    // gesture starts listening, the same as every other JS-rendered effect.
    const instance = draggable.prepare!(el, createParams({}), ctx)
    instance.activate()

    drag(el, { x: 100, y: 100 }, { x: 80, y: 40 })
    expect(latest(writes)).toEqual({ x: 80, y: 40 })

    // Second pickup starts somewhere else entirely — the element must move by the *new* delta from
    // where it already was, not jump to that delta's absolute value.
    drag(el, { x: 500, y: 300 }, { x: 30, y: 15 })
    expect(latest(writes)).toEqual({ x: 110, y: 55 })

    // And a third, to prove it accumulates rather than remembering only the previous one.
    drag(el, { x: 20, y: 900 }, { x: -50, y: 5 })
    expect(latest(writes)).toEqual({ x: 60, y: 60 })

    instance.destroy()
    el.remove()
  })

  it('tracks the pointer during a re-pickup, not only at the end of it', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const { ctx, writes } = recordingCtx()
    // `deferPrepare` means the wiring only happens on `activate()` — the animator decides when a
    // gesture starts listening, the same as every other JS-rendered effect.
    const instance = draggable.prepare!(el, createParams({}), ctx)
    instance.activate()

    drag(el, { x: 0, y: 0 }, { x: 100, y: 0 })
    const before = writes.length

    pointer(el, 'pointerdown', 400, 400)
    for (const step of [10, 20, 30, 40]) pointer(el, 'pointermove', 400 + step, 400)
    const during = writes.slice(before).map((value) => Number.parseFloat(value))
    // Every intermediate frame is offset by the held 100px; a jump to the origin would start at 10.
    expect(during).toEqual([110, 120, 130, 140])

    instance.destroy()
    el.remove()
  })

  it.each([
    ['x', { axis: 'x' }, { x: 60, y: 0 }],
    ['y', { axis: 'y' }, { x: 0, y: 25 }],
    ['both', {}, { x: 60, y: 25 }],
  ])('accumulates only along the %s axis it is locked to', (_name, params, expected) => {
    const el = document.createElement('div')
    document.body.append(el)
    const { ctx, writes } = recordingCtx()
    const instance = draggable.prepare!(el, createParams(params), ctx)
    instance.activate()

    drag(el, { x: 0, y: 0 }, { x: 30, y: 10 })
    drag(el, { x: 0, y: 0 }, { x: 30, y: 15 })
    expect(latest(writes)).toEqual(expected)

    instance.destroy()
    el.remove()
  })
})

/**
 * Where a released drag goes, and what a bound does to one in progress.
 *
 * `resist()` and `settle()` are what separate the eight names in this family from one another —
 * `drag`, `drag-x`, `drag-y`, `drag-inertia`, `throwable`, `elastic-pull`, `rubber-band` and
 * `snap-back` are one primitive with three parameters — and neither had ever run outside a
 * browser. That matters more than it sounds: `test/browser/gestures.test.mjs` pauses 150ms before
 * `pointerup`, which lets the velocity samples decay to nothing, so it asserted "rests exactly
 * where it was released" at the one release speed where an ungated momentum cannot show. It did
 * exactly that while the bug was live.
 *
 * Under a fake clock the release velocity is authored rather than measured, so every expectation
 * below is an exact number.
 */
describe('draggable release physics', () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_CLOCK)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays exactly where it was put, however fast the finger left', () => {
    const { el, writes, destroy } = mount()

    throwBy(el, writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    // Released at 1000px/s across and 500px/s down, and it does not move a pixel further. This is
    // the whole contract of the three plain `drag` names, and it was broken: the momentum target
    // was applied regardless of `inertia`, gliding this to (300, 150).
    expect(latest(writes)).toEqual({ x: 100, y: 50 })

    destroy()
  })

  it('glides on past the release point when inertia is asked for', () => {
    const { el, writes, destroy } = mount({ inertia: 'true' })

    throwBy(el, writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    // 1000px/s x the 0.2 default momentum on x, 500px/s x 0.2 on y — both axes carried, from one
    // release. An `inertia` gate that only reached the x runner would land y at 50.
    expect(latest(writes)).toEqual({ x: 300, y: 150 })

    destroy()
  })

  it('scales how far the glide carries with momentum:', () => {
    const { el, writes, destroy } = mount({ inertia: 'true', momentum: '0.5' })

    throwBy(el, writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    // Same throw as above; only the authored carry differs, so a hard-coded 0.2 would still read
    // (300, 150) here.
    expect(latest(writes)).toEqual({ x: 600, y: 300 })

    destroy()
  })

  it('returns to the origin when return is on, and no momentum can carry it away', () => {
    const { el, writes, destroy } = mount({ return: 'true', inertia: 'true' })

    throwBy(el, writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    // Both modes on at once, which is the case that pins the early exit: `return` aims at zero
    // first, and falling through to the momentum target afterwards would retarget this to (300,
    // 150) and land it there instead.
    expect(latest(writes)).toEqual({ x: 0, y: 0 })

    destroy()
  })

  it('carries the release velocity into a return, so a throw overshoots before it comes back', () => {
    const thrown = mount({ return: 'true', inertia: 'true' })
    const thrownRelease = throwBy(thrown.el, thrown.writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    const placed = mount({ return: 'true' })
    const placedRelease = throwBy(placed.el, placed.writes, { x: 100, y: 50 })
    vi.advanceTimersByTime(SETTLE_MS)

    // Both come to rest at the origin, so the endpoint cannot tell them apart — only the path can.
    // With the release velocity seeded, the element keeps travelling for a moment after the finger
    // lifts and only then is hauled back; without it, it just decays. That seed is the difference
    // between a thrown object and a released one, and nothing else observable pins it.
    expect(latest(thrown.writes)).toEqual({ x: 0, y: 0 })
    expect(latest(placed.writes)).toEqual({ x: 0, y: 0 })
    expect(peakAfter(thrown.writes, thrownRelease, 'x')).toBeGreaterThan(110)
    expect(peakAfter(placed.writes, placedRelease, 'x')).toBeLessThan(100)
    // Both axes, separately seeded from the same release. The two springs are independent, and an
    // `inertia` gate wired to only one of them leaves that axis quietly dead — invisible in any
    // assertion that reads the resting position, since both axes rest at zero either way.
    // The y bound is inclusive because the x runner writes first each frame, so the very first
    // post-release write still carries the y the finger left behind.
    expect(peakAfter(thrown.writes, thrownRelease, 'y')).toBeGreaterThan(55)
    expect(peakAfter(placed.writes, placedRelease, 'y')).toBeLessThanOrEqual(50)

    thrown.destroy()
    placed.destroy()
  })

  it('damps movement past a bound instead of clamping or ignoring it', () => {
    const free = mount()
    pressAndMove(free.el, { x: 100, y: 50 })
    expect(latest(free.writes)).toEqual({ x: 100, y: 50 })
    free.destroy()

    const bounded = mount({ bounds: '100' })
    pressAndMove(bounded.el, { x: 100, y: 50 })
    // Same gesture, and the element still moves on both axes — it is damped, not stopped. Clamping
    // at the bound would read (100, 50) here exactly as the unbounded case does, and only a
    // rubber-band curve produces these two different fractions from one 100px limit.
    expect(latest(bounded.writes).x).toBeCloseTo(64.52, 2)
    expect(latest(bounded.writes).y).toBeCloseTo(47.62, 2)
    bounded.destroy()
  })

  it('resists total displacement from rest, not each pickup on its own', () => {
    const { el, writes, destroy } = mount({ bounds: '100' })

    drag(el, { x: 0, y: 0 }, { x: 60, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(writes).x).toBeCloseTo(52.17, 2)

    drag(el, { x: 0, y: 0 }, { x: 60, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    // The second pickup starts from 52.17 and adds 60 raw pixels, so the damping is applied to
    // 112.17 of total displacement. Damping each gesture's own delta and adding the result would
    // give 104.35 — an element already pulled to its limit would get a fresh resistance budget
    // every time the finger lifted, and could be walked out to any distance in small steps.
    expect(latest(writes).x).toBeCloseTo(67.1, 2)

    destroy()
  })

  it('reads how hard the bound damps from resistance:', () => {
    const firm = mount({ bounds: '100', resistance: '0.9' })
    pressAndMove(firm.el, { x: 100, y: 0 })
    expect(latest(firm.writes).x).toBeCloseTo(52.63, 2)
    firm.destroy()

    const slack = mount({ bounds: '100', resistance: '0.2' })
    pressAndMove(slack.el, { x: 100, y: 0 })
    // The same 100px pull against the same 100px bound, landing in three different places across
    // this test and the last: the parameter reaches the curve rather than the 0.55 default being
    // used whatever the author wrote.
    expect(latest(slack.writes).x).toBeCloseTo(83.33, 2)
    slack.destroy()
  })
})
