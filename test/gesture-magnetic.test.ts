import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/**
 * Unit coverage for `magnetic`, which had none.
 *
 * Two things look like they need a browser and do not. `getBoundingClientRect` is the only geometry
 * the primitive reads, and it reads it off one node, so a stub is the whole of layout as far as
 * this effect is concerned. The spring runs on rAF, and a fake clock drives rAF exactly as it
 * drives `setTimeout` — the runner snaps to its target on the settled frame, so "where does it come
 * to rest" is an exact equality rather than an approximation.
 *
 * These tests read the offsets the primitive writes rather than anything rendered: `writeOffset` is
 * its only output and `translate` is the whole contract.
 */

const magnetic = GESTURE_PRIMITIVES.find((primitive) => primitive.id === 'magnetic')!

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

/**
 * A 100x100 box at (100,100), so its centre is exactly (150,150).
 *
 * Deliberately not at the origin: a centre calculation that dropped `box.left`/`box.top`, or one
 * that forgot to halve the size, both still read zero for a zero-positioned zero-sized jsdom node.
 */
function boxedElement(): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 100, height: 100, right: 200, bottom: 200, x: 100, y: 100 }) as DOMRect
  return el
}

function movePointer(x: number, y: number): void {
  const event = new Event('pointermove', { bubbles: true }) as PointerEvent & {
    clientX: number
    clientY: number
  }
  Object.assign(event, { clientX: x, clientY: y })
  window.dispatchEvent(event)
}

/** Long enough for a default spring to reach its rest thresholds and snap to target. */
const SETTLE_MS = 3000

function mount(params: Record<string, string> = {}): {
  el: HTMLElement
  writes: string[]
  destroy: () => void
} {
  const el = boxedElement()
  const { ctx, writes } = recordingCtx()
  // `deferPrepare` means the wiring only happens on `activate()` — the animator decides when a
  // gesture starts listening, the same as every other JS-rendered effect.
  const instance = magnetic.prepare!(el, createParams(params), ctx)
  instance.activate()
  return { el, writes, destroy: () => instance.destroy() }
}

describe('magnetic', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drifts toward a pointer inside the radius and rests at strength x offset', () => {
    const { writes, destroy } = mount()

    // 50px right of centre, 0 down. Well inside the 120px default radius.
    movePointer(200, 150)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(latest(writes)).toEqual({ x: 17.5, y: 0 })

    destroy()
  })

  it('resolves the offset from the box centre on both axes independently', () => {
    const { writes, destroy } = mount()

    // 40 left and 60 below centre: hypot is ~72, still inside 120.
    movePointer(110, 210)
    vi.advanceTimersByTime(SETTLE_MS)

    // Signs and magnitudes both matter — two springs, one per axis, is the design.
    expect(latest(writes)).toEqual({ x: -14, y: 21 })

    destroy()
  })

  it('lags the pointer rather than snapping to it', () => {
    const { writes, destroy } = mount()

    movePointer(200, 150)
    vi.advanceTimersByTime(20)

    // The spring is the entire effect: without it this would be a per-mousemove `translate` write
    // and the very first frame would already read the full 17.5.
    expect(writes.length).toBeGreaterThan(0)
    expect(latest(writes).x).toBeGreaterThan(0)
    expect(latest(writes).x).toBeLessThan(2)

    vi.advanceTimersByTime(SETTLE_MS)
    // And it does arrive, rather than merely creeping.
    expect(latest(writes)).toEqual({ x: 17.5, y: 0 })

    destroy()
  })

  it('returns to rest when the pointer leaves the radius', () => {
    const { writes, destroy } = mount()

    movePointer(200, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(writes)).toEqual({ x: 17.5, y: 0 })

    // 250px right of centre — beyond the 120px radius, so the attraction is released entirely
    // rather than merely weakened by distance.
    movePointer(400, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(writes)).toEqual({ x: 0, y: 0 })

    destroy()
  })

  it('treats the radius as a strict boundary', () => {
    const inside = mount()
    // 119px from centre.
    movePointer(269, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(inside.writes).x).toBeCloseTo(41.65, 2)
    inside.destroy()

    const onEdge = mount()
    // Exactly 120px from centre. `< radius` excludes it; `<=` would not.
    movePointer(270, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(onEdge.writes)).toEqual({ x: 0, y: 0 })
    onEdge.destroy()
  })

  it('scales the pull with strength: and the range with radius:', () => {
    const strong = mount({ strength: '0.5' })
    movePointer(200, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    // 50 x 0.5, not 50 x 0.35.
    expect(latest(strong.writes)).toEqual({ x: 25, y: 0 })
    strong.destroy()

    const wide = mount({ radius: '300' })
    // 250px out: outside the default radius, inside this one.
    movePointer(400, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(latest(wide.writes)).toEqual({ x: 87.5, y: 0 })
    wide.destroy()
  })

  it('listens on the window, so a pointer that never touches the element still pulls it', () => {
    // Never appended to the document. A listener bound to the element could not possibly see an
    // event dispatched on `window`, so this distinguishes the two wirings — proximity is the whole
    // idea, and an element only attracted while hovered would be pointless.
    const { el, writes, destroy } = mount()
    expect(el.isConnected).toBe(false)

    movePointer(200, 150)
    vi.advanceTimersByTime(SETTLE_MS)

    expect(latest(writes)).toEqual({ x: 17.5, y: 0 })

    destroy()
  })

  it('stops writing on teardown, mid-flight', () => {
    const { writes, destroy } = mount()

    movePointer(200, 150)
    // Torn down while the spring is still travelling, which is the case that leaks: a settled
    // runner has already released the frame loop on its own.
    vi.advanceTimersByTime(20)
    expect(latest(writes).x).toBeLessThan(2)

    destroy()
    const afterDestroy = writes.length

    vi.advanceTimersByTime(SETTLE_MS)
    // The in-flight frame loop was cancelled...
    expect(writes.length).toBe(afterDestroy)

    movePointer(200, 150)
    vi.advanceTimersByTime(SETTLE_MS)
    // ...and the window listener was removed, so a later pointer move cannot restart it.
    expect(writes.length).toBe(afterDestroy)
  })
})
