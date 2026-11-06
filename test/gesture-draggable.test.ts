// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

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
function recordingCtx(el: Element): { ctx: PrepareContext; writes: string[]; properties: Map<string, string> } {
  const writes: string[] = []
  const properties = new Map<string, string>()
  const ledger = createStyleLedger(el)
  const ctx = {
    doc: document,
    win: window,
    warn: vi.fn(),
    style: {
      set: (property: string, value: string) => {
        properties.set(property, value)
        if (property === 'translate') writes.push(value)
        ledger.set(property, value)
      },
      claim: vi.fn(),
      restore: () => ledger.restore(),
      owned: () => [],
    },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
  return { ctx, writes, properties }
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

/** Layout boxes, including the translate already written by the effect. */
function boxFixture(el: HTMLElement, large = false) {
  const box = document.createElement('div')
  el.before(box)
  box.append(el)
  const size = { width: 200, height: 150 }
  Object.defineProperties(box, {
    offsetWidth: { get: () => size.width }, offsetHeight: { get: () => size.height },
    clientWidth: { get: () => size.width }, clientHeight: { get: () => size.height },
  })
  vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, width: size.width, height: size.height } as DOMRect))
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
    const pos = latest([el.style.translate || '0px 0px'])
    const left = (large ? 0 : 20) + pos.x
    const top = (large ? 0 : 30) + pos.y
    const width = large ? 500 : 50
    return { left, top, right: left + width, bottom: top + 40, width, height: 40 } as DOMRect
  })
  return size
}

function mount(params: Record<string, string> = {}, configure?: (el: HTMLElement) => void): {
  el: HTMLElement
  writes: string[]
  properties: Map<string, string>
  warn: (message: string) => void
  destroy: () => void
} {
  const el = document.createElement('div')
  document.body.append(el)
  configure?.(el)
  const { ctx, writes, properties } = recordingCtx(el)
  const instance = draggable.prepare!(el, createParams(params), ctx)
  instance.activate()
  return {
    el,
    writes,
    properties,
    warn: ctx.warn,
    destroy: () => {
      instance.destroy()
      ctx.style.restore()
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
    const { ctx, writes } = recordingCtx(el)
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
    const { ctx, writes } = recordingCtx(el)
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
    const { ctx, writes } = recordingCtx(el)
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

describe('drag review regressions', () => {
  beforeEach(() => vi.useFakeTimers(FAKE_CLOCK))
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })

  it.each(['x', 'y'])('keeps the disabled axis still when limits exclude the rest position: axis:%s', axis => {
    const a = mount({ axis, limits: 'parent' }, el => {
      boxFixture(el)
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        const pos = latest([el.style.translate || '0px 0px'])
        return { left: 100 + pos.x, top: 100 + pos.y, right: 250 + pos.x, bottom: 250 + pos.y, width: 150, height: 150 } as DOMRect
      })
    })
    drag(a.el, { x: 0, y: 0 }, { x: 40, y: 40 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)[axis === 'x' ? 'y' : 'x']).toBe(0)
    a.destroy()
  })

  it('retains an in-range throw on resize, then removes size listeners on destroy', () => {
    let size: { width: number; height: number }
    const a = mount({ axis: 'x', limits: 'parent', inertia: 'true' }, el => {
      size = boxFixture(el)
      size.width = 600
    })
    throwBy(a.el, a.writes, { x: 100, y: 0 })
    vi.advanceTimersByTime(32)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(300)
    const read = vi.mocked(a.el.getBoundingClientRect)
    a.destroy()
    const count = a.writes.length
    read.mockClear()
    size!.width = 50
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(a.writes).toHaveLength(count)
    expect(read).not.toHaveBeenCalled()
  })

  it('clamps a resized throw destination even when the current offset is still in range', () => {
    let size: { width: number; height: number }
    const a = mount({ axis: 'x', limits: 'parent', inertia: 'true' }, el => { size = boxFixture(el); size.width = 600 })
    throwBy(a.el, a.writes, { x: 100, y: 0 })
    vi.advanceTimersByTime(32)
    expect(latest(a.writes).x).toBeLessThan(150)
    size!.width = 220
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(150)
    a.destroy()
  })

  it('remeasures an active drag without starting release springs before the pointer lifts', () => {
    let size: { width: number; height: number }
    const a = mount({ axis: 'x', limits: 'parent' }, el => { size = boxFixture(el) })
    pressAndMove(a.el, { x: 80, y: 0 })
    size!.width = 100
    const count = a.writes.length
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(100)
    expect(a.writes).toHaveLength(count)
    pointer(a.el, 'pointermove', 100, 0)
    expect(latest(a.writes).x).toBeGreaterThan(30)
    pointer(a.el, 'pointerup', 100, 0)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(30)
    expect(a.properties.get('touch-action')).toBe('pan-y pinch-zoom')
    a.destroy()
  })

  it('uses the injected window size observer, observes both boxes, and disconnects it', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const size = boxFixture(el)
    const observed: Element[] = []
    const disconnect = vi.fn()
    let notify = () => {}
    class SizeObserver {
      constructor(callback: () => void) { notify = callback }
      observe(node: Element) { observed.push(node) }
      disconnect = disconnect
    }
    const add = vi.fn()
    const remove = vi.fn()
    const { ctx, writes } = recordingCtx(el)
    ctx.win = { ResizeObserver: SizeObserver, addEventListener: add, removeEventListener: remove } as unknown as Window
    const instance = draggable.prepare!(el, createParams({ axis: 'x', limits: 'parent' }), ctx)
    instance.activate()
    try {
      expect(observed).toEqual([el.parentElement, el])
      drag(el, { x: 0, y: 0 }, { x: 120, y: 0 })
      vi.advanceTimersByTime(SETTLE_MS)
      size.width = 100
      notify()
      vi.advanceTimersByTime(SETTLE_MS)
      expect(latest(writes).x).toBe(30)
    } finally { instance.destroy() }
    expect(disconnect).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('resize', add.mock.calls[0]![1])
  })

  it.each(['0', '-10', 'bad', '10 20 30', 'Infinity'])('rejects wrap:%s without breaking the opted-in drag or pinch zoom', wrap => {
    const a = mount({ wrap, lock: 'dominant' })
    drag(a.el, { x: 0, y: 0 }, { x: 50, y: 20 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(a.warn).toHaveBeenCalledOnce()
    expect(latest(a.writes)).toEqual({ x: 50, y: 0 })
    expect(a.properties.get('touch-action')).toBe('pinch-zoom')
    a.destroy()
  })

  it.each(['#missing-box', '['])('warns once for limits:%s and keeps the drag usable', limits => {
    const a = mount({ limits, lock: 'dominant' })
    drag(a.el, { x: 0, y: 0 }, { x: 50, y: 20 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(a.warn).toHaveBeenCalledOnce()
    expect(latest(a.writes)).toEqual({ x: 50, y: 0 })
    expect(a.properties.get('touch-action')).toBe('pinch-zoom')
    a.destroy()
  })

  it('warns for return:edge without limits and preserves the declared touch axis', () => {
    const a = mount({ axis: 'y', return: 'edge' })
    drag(a.el, { x: 0, y: 0 }, { x: 50, y: 20 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(a.warn).toHaveBeenCalledOnce()
    expect(latest(a.writes)).toEqual({ x: 0, y: 20 })
    expect(a.properties.get('touch-action')).toBe('pan-x pinch-zoom')
    a.destroy()
  })

  it('resolves a selector box and handles zero layout metrics with unscaled edges', () => {
    const a = mount({ limits: '#drag-box' }, el => {
      boxFixture(el)
      const box = el.parentElement!
      box.id = 'drag-box'
      vi.mocked(box.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 0, height: 0 } as DOMRect)
      // Zero screen dimensions over non-zero layout dimensions yields the fallback scale of one.
    })
    drag(a.el, { x: 0, y: 0 }, { x: 250, y: -150 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)).toEqual({ x: 130, y: -30 })
    expect(a.warn).not.toHaveBeenCalled()
    expect(a.properties.get('touch-action')).toBe('pinch-zoom')
    a.destroy()
  })
})

describe('round 2 drag options', () => {
  beforeEach(() => vi.useFakeTimers(FAKE_CLOCK))
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  it.each([
    'drag limits:parent return:edge',
    'drag lock:dominant',
    'drag-x limits:parent inertia:true',
    'drag-x inertia:true wrap:320',
    'drag inertia:true wrap:"320 240"',
    'drag lock:dominant, fade-up on:enter',
  ])('compiles exact batch markup without warnings: %s', source => {
    expect(compile(parse(source), catalogRegistry(), 'time').warnings).toEqual([])
  })

  it('damps only outside uneven box edges and returns to the nearest valid offset', () => {
    const a = mount({ limits: 'parent', return: 'edge' }, el => boxFixture(el))
    pressAndMove(a.el, { x: 80, y: 40 })
    expect(latest(a.writes)).toEqual({ x: 80, y: 40 })
    pointer(a.el, 'pointermove', 250, -150)
    const over = latest(a.writes)
    expect(over.x).toBeGreaterThan(130)
    expect(over.x).toBeLessThan(210)
    expect(over.y).toBeLessThan(-30)
    expect(over.y).toBeGreaterThan(-110)
    pointer(a.el, 'pointerup', 250, -150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)).toEqual({ x: 130, y: -30 })
    a.destroy()
  })

  it('clamps inertia targets at a wide track edge while allowing elastic overhang', () => {
    const a = mount({ axis: 'x', limits: 'parent', inertia: 'true' }, el => boxFixture(el, true))
    throwBy(a.el, a.writes, { x: -250, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)).toEqual({ x: -300, y: 0 })
    expect(Math.min(...a.writes.map(value => Number.parseFloat(value)))).toBeGreaterThan(-380)
    a.destroy()
  })

  it('return:edge ignores momentum rather than springing to the origin or coasting', () => {
    const a = mount({ axis: 'x', limits: 'parent', return: 'edge', inertia: 'true' }, el => boxFixture(el))
    throwBy(a.el, a.writes, { x: 80, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(80)
    a.destroy()
  })

  it('remeasures resize while offset without treating the live translate as the rest position', () => {
    let size: { width: number; height: number }
    const a = mount({ axis: 'x', limits: 'parent', return: 'edge' }, el => { size = boxFixture(el) })
    drag(a.el, { x: 0, y: 0 }, { x: 120, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    size!.width = 100
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(30)
    a.destroy()
  })

  it('keeps the point under the pointer when picking up an elastic overhang', () => {
    const a = mount({ limits: 'parent' }, el => boxFixture(el))
    pressAndMove(a.el, { x: 200, y: 0 })
    pointer(a.el, 'pointerup', 200, 0)
    const before = latest(a.writes).x
    pointer(a.el, 'pointerdown', 0, 0)
    pointer(a.el, 'pointermove', 4, 0)
    expect(latest(a.writes).x).toBeGreaterThan(before)
    expect(latest(a.writes).x - before).toBeLessThan(4)
    a.destroy()
  })

  it('locks a near diagonal once, filters release velocity, and chooses again on the next drag', () => {
    const a = mount({ lock: 'dominant', inertia: 'true' })
    pointer(a.el, 'pointerdown', 0, 0)
    pointer(a.el, 'pointermove', 3.1, 3)
    pointer(a.el, 'pointermove', 20, 100)
    pointer(a.el, 'pointerup', 20, 100)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).y).toBe(0)
    const x = latest(a.writes).x
    drag(a.el, { x: 0, y: 0 }, { x: 10, y: 40 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBe(x)
    expect(latest(a.writes).y).toBeGreaterThan(0)
    a.destroy()
  })

  it('wraps both signs on both axes and preserves the logical position across pickups', () => {
    const a = mount({ wrap: '100 80' })
    drag(a.el, { x: 0, y: 0 }, { x: -130, y: 175 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)).toEqual({ x: 70, y: 15 })
    drag(a.el, { x: 0, y: 0 }, { x: 50, y: -40 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes)).toEqual({ x: 20, y: 55 })
    a.destroy()
  })

  it('wraps every inertia write without a spring travelling backward at the seam', () => {
    const a = mount({ axis: 'x', wrap: '100', inertia: 'true' })
    throwBy(a.el, a.writes, { x: 90, y: 0 })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(a.writes).x).toBeCloseTo(70, 1)
    expect(a.writes.every(value => { const x = Number.parseFloat(value); return x >= 0 && x < 100 })).toBe(true)
    a.destroy()
  })

  it.each([{ axis: 'x', wrap: '100' }, { axis: 'y', limits: 'parent' }, { lock: 'dominant' }] as Record<string, string>[])('opts new hosts into touch-action: %j', params => {
    const a = mount(params, el => { boxFixture(el) })
    const expected = ({ x: 'pan-y pinch-zoom', y: 'pan-x pinch-zoom' } as Record<string, string>)[params.axis ?? 'both'] ?? 'pinch-zoom'
    expect(a.properties.get('touch-action')).toBe(expected)
    a.destroy()
  })

  it('leaves touch-action and measured geometry alone on a plain legacy host', () => {
    const enabled = mount({ lock: 'dominant' })
    expect(enabled.properties.get('touch-action')).toBe('pinch-zoom')
    enabled.destroy()
    const read = vi.fn()
    const a = mount({}, el => { el.getBoundingClientRect = read })
    drag(a.el, { x: 0, y: 0 }, { x: 80, y: 50 })
    expect(a.properties.has('touch-action')).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(latest(a.writes)).toEqual({ x: 80, y: 50 })
    a.destroy()
  })

  it('pointercancel drops new-option momentum while a plain legacy drag keeps its release behavior', () => {
    for (const enabled of [true, false]) {
      const a = mount({ axis: 'x', inertia: 'true', ...(enabled ? { wrap: '1000' } : {}) })
      pointer(a.el, 'pointerdown', 0, 0)
      vi.advanceTimersByTime(100)
      pointer(a.el, 'pointermove', 60, 0)
      pointer(a.el, 'pointercancel', 60, 0)
      vi.advanceTimersByTime(SETTLE_MS)
      expect(latest(a.writes).x).toBeCloseTo(enabled ? 60 : 180, 1)
      expect(a.el.getAttribute('data-kui-dragging')).toBe('false')
      a.destroy()
    }
  })
})
