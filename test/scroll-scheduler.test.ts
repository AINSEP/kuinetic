import { describe, expect, it } from 'vitest'
import type { ScrollRoot, SchedulerDeps } from '../src/core/scroll-scheduler.js'
import {
  clamp01,
  createMeasureCache,
  createRootResolver,
  createScrollScheduler,
  progressBetween,
} from '../src/core/scroll-scheduler.js'

/**
 * The scheduler is asserted entirely through injected fakes — no scrolling, no rAF, no layout.
 * That is the point of the dependency shape: if these tests needed a real viewport, the module
 * would be untestable and the pin/scrub primitives built on it would be untestable too.
 */

/** A frame source under test control, so "did it schedule?" is directly observable. */
function fakeFrames() {
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  const deps: SchedulerDeps = {
    requestFrame(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancelFrame(handle) {
      callbacks.delete(handle)
    },
  }
  return {
    deps,
    pending: () => callbacks.size,
    flush() {
      const due = [...callbacks.values()]
      callbacks.clear()
      for (const callback of due) callback()
    },
  }
}

function fakeRoot(key = 'test') {
  const scrollHandlers = new Set<() => void>()
  const resizeHandlers = new Set<() => void>()
  const metrics = { scrollTop: 0, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800 }
  let reads = 0

  const root: ScrollRoot = {
    key,
    metrics() {
      reads++
      return { ...metrics }
    },
    onScroll(handler) {
      scrollHandlers.add(handler)
      return () => scrollHandlers.delete(handler)
    },
    onResize(handler) {
      resizeHandlers.add(handler)
      return () => resizeHandlers.delete(handler)
    },
  }

  return {
    root,
    reads: () => reads,
    listeners: () => scrollHandlers.size + resizeHandlers.size,
    scrollTo(top: number) {
      metrics.scrollTop = top
      for (const handler of scrollHandlers) handler()
    },
    resize() {
      for (const handler of resizeHandlers) handler()
    },
  }
}

describe('createScrollScheduler — frame discipline', () => {
  it('delivers an initial frame without waiting for user input', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    const seen: number[] = []

    scheduler.subscribe(source.root, (frame) => seen.push(frame.metrics.scrollTop))
    expect(seen).toEqual([])
    frames.flush()
    expect(seen).toEqual([0])
  })

  it('does not run a standing rAF loop — an idle scheduler schedules nothing', () => {
    const frames = fakeFrames()
    const scheduler = createScrollScheduler(frames.deps)
    scheduler.subscribe(fakeRoot().root, () => {})

    frames.flush()
    expect(frames.pending()).toBe(0)
    frames.flush()
    expect(frames.pending()).toBe(0)
  })

  it('coalesces a burst of scroll events into one frame', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    let calls = 0
    scheduler.subscribe(source.root, () => calls++)
    frames.flush()

    for (let i = 1; i <= 5; i++) source.scrollTo(i * 10)
    expect(frames.pending()).toBe(1)
    frames.flush()
    expect(calls).toBe(2)
  })

  it('reads root metrics once per frame however many subscribers there are', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    for (let i = 0; i < 4; i++) scheduler.subscribe(source.root, () => {})

    frames.flush()
    expect(source.reads()).toBe(1)
  })

  it('reports the current scroll position to subscribers', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    let last = -1
    scheduler.subscribe(source.root, (frame) => {
      last = frame.metrics.scrollTop
    })

    source.scrollTo(420)
    frames.flush()
    expect(last).toBe(420)
  })
})

describe('createScrollScheduler — roots and listeners', () => {
  it('shares one listener pair across every subscriber of the same root', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    scheduler.subscribe(source.root, () => {})
    scheduler.subscribe(source.root, () => {})

    expect(source.listeners()).toBe(2)
    expect(scheduler.rootCount()).toBe(1)
  })

  it('keeps nested scroll containers separate', () => {
    const frames = fakeFrames()
    const scheduler = createScrollScheduler(frames.deps)
    scheduler.subscribe(fakeRoot('outer').root, () => {})
    scheduler.subscribe(fakeRoot('inner').root, () => {})

    expect(scheduler.rootCount()).toBe(2)
  })

  it('detaches listeners when the last subscriber of a root leaves', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    const first = scheduler.subscribe(source.root, () => {})
    const second = scheduler.subscribe(source.root, () => {})

    first()
    expect(source.listeners()).toBe(2)
    second()
    expect(source.listeners()).toBe(0)
    expect(scheduler.rootCount()).toBe(0)
  })

  it('stops delivering to an unsubscribed callback', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    let calls = 0
    const unsubscribe = scheduler.subscribe(source.root, () => calls++)
    frames.flush()

    unsubscribe()
    source.scrollTo(100)
    frames.flush()
    expect(calls).toBe(1)
  })

  it('cancels the pending frame and detaches every root on destroy', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    scheduler.subscribe(source.root, () => {})

    scheduler.destroy()
    expect(frames.pending()).toBe(0)
    expect(source.listeners()).toBe(0)
    expect(scheduler.rootCount()).toBe(0)
  })
})

describe('createScrollScheduler — epoch', () => {
  it('holds the epoch steady while only scrolling', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    const epochs: number[] = []
    scheduler.subscribe(source.root, (frame) => epochs.push(frame.epoch))

    frames.flush()
    source.scrollTo(50)
    frames.flush()
    expect(epochs).toEqual([0, 0])
  })

  it('bumps the epoch on resize so cached geometry is discarded', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    const epochs: number[] = []
    scheduler.subscribe(source.root, (frame) => epochs.push(frame.epoch))

    frames.flush()
    source.resize()
    frames.flush()
    expect(epochs).toEqual([0, 1])
  })

  it('bumps the epoch on an explicit invalidate', () => {
    const frames = fakeFrames()
    const source = fakeRoot()
    const scheduler = createScrollScheduler(frames.deps)
    const epochs: number[] = []
    scheduler.subscribe(source.root, (frame) => epochs.push(frame.epoch))

    frames.flush()
    scheduler.invalidate()
    frames.flush()
    expect(epochs).toEqual([0, 1])
  })
})

describe('createRootResolver', () => {
  it('returns the nearest scrollable ancestor', () => {
    document.body.innerHTML = '<div id="outer"><div id="inner"><p id="target"></p></div></div>'
    const inner = document.getElementById('inner')!
    const resolve = createRootResolver({
      win: window,
      isScrollable: (el) => el === inner,
    })

    expect(resolve(document.getElementById('target')!).key).toMatch(/^el:/)
  })

  it('falls back to the window when no ancestor scrolls', () => {
    document.body.innerHTML = '<p id="target"></p>'
    const resolve = createRootResolver({ win: window, isScrollable: () => false })

    expect(resolve(document.getElementById('target')!).key).toBe('window')
  })

  it('gives the same key for two elements inside one scroller, so they share a listener', () => {
    document.body.innerHTML = '<div id="s"><p id="a"></p><p id="b"></p></div>'
    const scroller = document.getElementById('s')!
    const resolve = createRootResolver({ win: window, isScrollable: (el) => el === scroller })

    expect(resolve(document.getElementById('a')!).key).toBe(
      resolve(document.getElementById('b')!).key,
    )
  })
})

describe('progress helpers', () => {
  it('maps a position through its range', () => {
    expect(progressBetween(100, 300, 200)).toBe(0.5)
  })

  it('clamps outside the range rather than extrapolating', () => {
    expect(progressBetween(100, 300, 0)).toBe(0)
    expect(progressBetween(100, 300, 9999)).toBe(1)
  })

  it('returns 0 for a degenerate range instead of Infinity', () => {
    // An element shorter than its own pin distance produces this; NaN or Infinity here would
    // reach style.setProperty and silently kill the effect.
    expect(progressBetween(200, 200, 200)).toBe(0)
    expect(progressBetween(300, 100, 200)).toBe(0)
  })

  it('treats NaN as 0', () => {
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('createMeasureCache', () => {
  it('measures once per epoch', () => {
    let calls = 0
    const cache = createMeasureCache(() => ++calls)

    cache.read(3)
    cache.read(3)
    expect(calls).toBe(1)
  })

  it('re-measures when the epoch moves', () => {
    let calls = 0
    const cache = createMeasureCache(() => ++calls)

    cache.read(1)
    cache.read(2)
    expect(calls).toBe(2)
  })

  it('re-measures after an explicit clear', () => {
    let calls = 0
    const cache = createMeasureCache(() => ++calls)

    cache.read(1)
    cache.clear()
    cache.read(1)
    expect(calls).toBe(2)
  })
})
