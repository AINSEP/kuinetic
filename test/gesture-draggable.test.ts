import { describe, expect, it, vi } from 'vitest'
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
