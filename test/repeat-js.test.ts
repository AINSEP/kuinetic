// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repeatedInstance } from '../src/core/instances.js'
import { play } from '../src/core/play.js'
import type { EffectInstance } from '../src/core/types.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `repeatedInstance` replays a finite JS instance. The inner instance here is a hand-rolled fake
 * whose `finished` the test resolves by hand, and the frame clock is a queue the test drains.
 */

interface Fake extends EffectInstance {
  starts: number
  complete(): Promise<void>
  cancels: number
  destroys: number
}

function fakeInner(finite = true): Fake {
  let resolve: () => void = () => {}
  let finished = Promise.resolve()
  const inner: Fake = {
    starts: 0,
    cancels: 0,
    destroys: 0,
    activate() {
      inner.starts++
      finished = new Promise<void>((r) => {
        resolve = r
      })
    },
    cancel() {
      inner.cancels++
      resolve()
    },
    finish() {
      resolve()
    },
    destroy() {
      inner.destroys++
      resolve()
    },
    get finished() {
      return finished
    },
    get finite() {
      return finite
    },
    async complete() {
      resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
  return inner
}

let frames: Array<() => void>
let win: Window

beforeEach(() => {
  frames = []
  win = {
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => {}
    },
  } as unknown as Window
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flushFrame = (): void => {
  const queued = frames
  frames = []
  for (const fn of queued) fn()
}

describe('repeatedInstance', () => {
  it('runs the setup repeat:3 times and resolves once after the third', async () => {
    const inner = fakeInner()
    const outer = repeatedInstance(inner, '3', win)
    let done = false
    outer.activate()
    void outer.finished.then(() => { done = true })
    for (let i = 0; i < 2; i++) {
      await inner.complete()
      expect(done).toBe(false)
      flushFrame()
    }
    await inner.complete()
    await Promise.resolve()
    expect(inner.starts).toBe(3)
    expect(done).toBe(true)
  })

  it('schedules the next run on a frame, not synchronously', async () => {
    const inner = fakeInner()
    const outer = repeatedInstance(inner, '2', win)
    outer.activate()
    await inner.complete()
    expect(inner.starts).toBe(1)
    flushFrame()
    expect(inner.starts).toBe(2)
  })

  it('never resolves for infinite until cancelled, and cancel stops further runs', async () => {
    const inner = fakeInner()
    const outer = repeatedInstance(inner, 'infinite', win)
    let done = false
    outer.activate()
    void outer.finished.then(() => { done = true })
    for (let i = 0; i < 5; i++) {
      await inner.complete()
      flushFrame()
    }
    expect(inner.starts).toBe(6)
    expect(done).toBe(false)
    outer.cancel()
    await Promise.resolve()
    expect(done).toBe(true)
    flushFrame()
    expect(inner.starts).toBe(6)
  })

  it('stops after one run when the setup was not finite', async () => {
    const inner = fakeInner(false)
    const outer = repeatedInstance(inner, 'infinite', win)
    outer.activate()
    await inner.complete()
    flushFrame()
    expect(inner.starts).toBe(1)
  })

  it('destroy cancels a pending frame and destroys the inner instance', async () => {
    const inner = fakeInner()
    const outer = repeatedInstance(inner, '5', win)
    outer.activate()
    await inner.complete()
    outer.destroy()
    flushFrame()
    expect(inner.starts).toBe(1)
    expect(inner.destroys).toBe(1)
  })

  it('a second activate restarts the count', async () => {
    const inner = fakeInner()
    const outer = repeatedInstance(inner, '2', win)
    outer.activate()
    await inner.complete()
    flushFrame()
    outer.activate()
    expect(inner.starts).toBe(3)
    await inner.complete()
    flushFrame()
    expect(inner.starts).toBe(4)
  })

  it('exposes no control, play or reverse: JS has no playhead', () => {
    const outer = repeatedInstance(fakeInner(), '2', win)
    expect(outer.control).toBeUndefined()
    expect(outer.play).toBeUndefined()
    expect(outer.reverse).toBeUndefined()
  })
})

describe('repeatable primitives', () => {
  it('repeats on a timer when frames are unavailable and clears the pending replay on finish', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const animator = build('<p data-kui="typewriter step:50ms repeat:3">X</p>')
    const target = el()
    const typed = () => el().querySelector('.kui-typewriter')?.textContent
    try {
      const playback = play({ animator, root: document.body, target, effect: 'typewriter' })
      expect(animator.stateOf(target)?.instances[0]?.finite).toBe(true)
      await vi.advanceTimersByTimeAsync(55)
      expect(typed()).toBe('X')
      await vi.advanceTimersByTimeAsync(20)
      expect(typed()).toBe('')
      await vi.advanceTimersByTimeAsync(50)
      expect(typed()).toBe('X')
      expect(vi.getTimerCount()).toBe(1)
      playback.finish()
      expect(vi.getTimerCount()).toBe(0)
      await playback.finished
    } finally {
      animator.destroy()
    }
  })

  it('every repeatable primitive is JS-rendered and has a prepare', () => {
    const registry = catalogRegistry()
    const primitives = new Map(
      registry.names().map((name) => [registry.resolve(name)!.primitive.id, registry.resolve(name)!.primitive]),
    )
    const repeatable = [...primitives.values()].filter((p) => p.repeatable === true)
    expect(repeatable.length).toBeGreaterThan(0)
    for (const primitive of repeatable) {
      expect(primitive.renderer).not.toBe('css-keyframes')
      expect(primitive.prepare).toBeTypeOf('function')
    }
  })
})
