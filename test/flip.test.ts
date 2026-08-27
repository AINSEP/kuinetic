import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlipEngine, mutationWatcher, observeLayout } from '../src/core/flip.js'
import type { Box, FlipDeps } from '../src/core/flip.js'

/**
 * FLIP is tested entirely through injected measurement and animation. jsdom reports a zero rect
 * for every element, so an engine that read `getBoundingClientRect` directly could not be
 * asserted at all — the injection is what makes this suite possible.
 */

function fakeDeps(positions: Map<Element, Box[]>) {
  const reads = new Map<Element, number>()
  const captured: Array<{ el: Element; keyframes: Keyframe[] }> = []

  const deps: FlipDeps = {
    measure(el) {
      const index = reads.get(el) ?? 0
      reads.set(el, index + 1)
      const list = positions.get(el) ?? []
      return list[Math.min(index, list.length - 1)] ?? { x: 0, y: 0, width: 0, height: 0 }
    },
    animate(el, keyframes) {
      captured.push({ el, keyframes })
      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation
    },
  }
  return { deps, captured }
}

function box(x: number, y: number, width = 100, height = 50): Box {
  return { x, y, width, height }
}

function makeElement(): Element {
  return document.createElement('div')
}

/** A `getBoundingClientRect()`-shaped return value, for exercising the real `domMeasure`. */
function domRect(left: number, top: number, width = 100, height = 50): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe('createFlipEngine', () => {
  it('animates an element that moved, using the inverse of the delta', () => {
    const el = makeElement()
    // Measured at x=0 first, then x=200: it moved right, so the inverse translate is -200.
    const { deps, captured } = fakeDeps(new Map([[el, [box(0, 0), box(200, 0)]]]))
    const engine = createFlipEngine(deps)

    const before = engine.snapshot([el])
    const run = engine.play(before, [el])

    expect(run.moved).toEqual([el])
    expect(captured).toHaveLength(1)
    expect(captured[0]?.keyframes[0]).toMatchObject({ translate: '-200px 0px' })
    expect(captured[0]?.keyframes[1]).toMatchObject({ translate: '0px 0px' })
  })

  it('computes vertical deltas', () => {
    const el = makeElement()
    const { deps, captured } = fakeDeps(new Map([[el, [box(0, 0), box(0, 80)]]]))
    const engine = createFlipEngine(deps)
    engine.play(engine.snapshot([el]), [el])
    expect(captured[0]?.keyframes[0]).toMatchObject({ translate: '0px -80px' })
  })

  it('skips elements that did not move, rather than animating them to identity', () => {
    const el = makeElement()
    const { deps, captured } = fakeDeps(new Map([[el, [box(10, 10), box(10, 10)]]]))
    const engine = createFlipEngine(deps)

    const run = engine.play(engine.snapshot([el]), [el])
    expect(run.moved).toEqual([])
    expect(captured).toEqual([])
    // Nothing to cancel, but the handle's cancel() must still be a safe, real no-op call.
    expect(() => run.cancel()).not.toThrow()
  })

  it('treats sub-pixel drift as noise', () => {
    const el = makeElement()
    const { deps, captured } = fakeDeps(new Map([[el, [box(0, 0), box(0.2, 0.1)]]]))
    const engine = createFlipEngine(deps)
    engine.play(engine.snapshot([el]), [el])
    expect(captured).toEqual([])
  })

  it('ignores size changes unless scale is requested', () => {
    const el = makeElement()
    const { deps, captured } = fakeDeps(new Map([[el, [box(0, 0, 100, 50), box(0, 0, 200, 50)]]]))
    const engine = createFlipEngine(deps)
    engine.play(engine.snapshot([el]), [el])
    expect(captured).toEqual([])
  })

  it('inverts size changes when scale is requested', () => {
    const el = makeElement()
    const { deps, captured } = fakeDeps(new Map([[el, [box(0, 0, 100, 50), box(0, 0, 200, 100)]]]))
    const engine = createFlipEngine(deps)
    engine.play(engine.snapshot([el]), [el], { scale: true })
    expect(captured[0]?.keyframes[0]).toMatchObject({ scale: '0.5 0.5' })
  })

  it('skips elements absent from the snapshot', () => {
    const known = makeElement()
    const added = makeElement()
    const { deps, captured } = fakeDeps(
      new Map([
        [known, [box(0, 0), box(50, 0)]],
        [added, [box(0, 0), box(999, 0)]],
      ]),
    )
    const engine = createFlipEngine(deps)

    const before = engine.snapshot([known])
    const run = engine.play(before, [known, added])
    expect(run.moved).toEqual([known])
    expect(captured).toHaveLength(1)
  })

  it('resolves finished with nothing to animate', async () => {
    const el = makeElement()
    const { deps } = fakeDeps(new Map([[el, [box(0, 0), box(0, 0)]]]))
    const engine = createFlipEngine(deps)
    await expect(engine.play(engine.snapshot([el]), [el]).finished).resolves.toBeUndefined()
  })

  it('cancels every in-flight animation it started', () => {
    const el = makeElement()
    const cancel = vi.fn()
    const reads = new Map<Element, Box[]>([[el, [box(0, 0), box(200, 0)]]])
    const readIndex = new Map<Element, number>()
    const deps: FlipDeps = {
      measure(target) {
        const index = readIndex.get(target) ?? 0
        readIndex.set(target, index + 1)
        return reads.get(target)?.[index] ?? { x: 0, y: 0, width: 0, height: 0 }
      },
      animate: () => ({ finished: new Promise(() => {}), cancel }) as unknown as Animation,
    }
    const engine = createFlipEngine(deps)
    const run = engine.play(engine.snapshot([el]), [el])

    expect(run.moved).toEqual([el])
    run.cancel()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('survives an environment with no Web Animations API', () => {
    const el = makeElement()
    const positions = new Map([[el, [box(0, 0), box(10, 0)]]])
    const engine = createFlipEngine({ ...fakeDeps(positions).deps, animate: () => null })
    const run = engine.play(engine.snapshot([el]), [el])
    expect(run.moved).toEqual([el])
    expect(() => run.cancel()).not.toThrow()
  })
})

describe('createFlipEngine — default DOM deps', () => {
  // These bypass `fakeDeps` entirely so `domMeasure`/`domAnimate` themselves run, against a real
  // element whose `getBoundingClientRect`/`animate` are stubbed directly.
  it('uses the real DOM animate implementation when the element supports it', () => {
    const el = makeElement()
    vi.spyOn(el, 'getBoundingClientRect')
      .mockReturnValueOnce(domRect(0, 0))
      .mockReturnValueOnce(domRect(200, 0))
    const animateSpy = vi.fn().mockReturnValue({ finished: Promise.resolve(), cancel: vi.fn() })
    ;(el as unknown as { animate: typeof animateSpy }).animate = animateSpy

    const engine = createFlipEngine()
    const run = engine.play(engine.snapshot([el]), [el])

    expect(run.moved).toEqual([el])
    expect(animateSpy).toHaveBeenCalledOnce()
    const [keyframes, options] = animateSpy.mock.calls[0]!
    expect(keyframes[0]).toMatchObject({ translate: '-200px 0px' })
    expect(options).toMatchObject({ duration: 400, fill: 'none' })
  })

  it('falls back to an instant move when the element has no animate method (the jsdom default)', async () => {
    const el = makeElement()
    vi.spyOn(el, 'getBoundingClientRect')
      .mockReturnValueOnce(domRect(0, 0))
      .mockReturnValueOnce(domRect(200, 0))

    const engine = createFlipEngine()
    const run = engine.play(engine.snapshot([el]), [el])

    expect(run.moved).toEqual([el])
    await expect(run.finished).resolves.toBeUndefined()
    expect(() => run.cancel()).not.toThrow()
  })
})

describe('mutationWatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a no-op cleanup when MutationObserver is unavailable', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const container = document.createElement('div')
    const cleanup = mutationWatcher(container)(() => {})
    expect(() => cleanup()).not.toThrow()
  })

  it('observes child list, subtree, and the hidden attribute, and disconnects on cleanup', () => {
    let observedTarget: Node | undefined
    let observedOptions: MutationObserverInit | undefined
    let disconnected = false
    class FakeMutationObserver {
      observe(target: Node, options: MutationObserverInit): void {
        observedTarget = target
        observedOptions = options
      }
      disconnect(): void {
        disconnected = true
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const container = document.createElement('div')
    const cleanup = mutationWatcher(container)(() => {})

    expect(observedTarget).toBe(container)
    expect(observedOptions).toMatchObject({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })

    cleanup()
    expect(disconnected).toBe(true)
  })
})

describe('observeLayout', () => {
  it('re-snapshots after each change, so consecutive moves are measured independently', () => {
    const container = document.createElement('ul')
    const child = document.createElement('li')
    container.append(child)

    const { deps, captured } = fakeDeps(
      new Map([[child, [box(0, 0), box(0, 40), box(0, 40), box(0, 90)]]]),
    )
    const engine = createFlipEngine(deps)

    let fire = (): void => {}
    const cleanup = observeLayout(container, engine, {}, (callback) => {
      fire = callback
      return () => {}
    })

    fire()
    fire()

    // Two moves, each measured against the position recorded after the previous one.
    expect(captured).toHaveLength(2)
    expect(captured[0]?.keyframes[0]).toMatchObject({ translate: '0px -40px' })
    expect(captured[1]?.keyframes[0]).toMatchObject({ translate: '0px -50px' })
    cleanup()
  })

  it('returns the watcher teardown', () => {
    const container = document.createElement('ul')
    const disconnect = vi.fn()
    const engine = createFlipEngine(fakeDeps(new Map()).deps)

    observeLayout(container, engine, {}, () => disconnect)()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

/**
 * A FLIP run outlives the call that started it — `engine.play` hands back live Web Animations and
 * returns immediately. Teardown therefore has to reach them, or `duration:10s` keeps animating for
 * ten seconds on elements the animator has already released.
 */
describe('observeLayout teardown', () => {
  /**
   * Animations that stay in flight until the test says otherwise. The shared `fakeDeps` above
   * resolves `finished` immediately, which is the one state that cannot show whether a *playing*
   * run gets cancelled.
   */
  function playingDeps(positions: Map<Element, Box[]>) {
    const reads = new Map<Element, number>()
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; complete: () => void }> = []

    const deps: FlipDeps = {
      measure(el) {
        const index = reads.get(el) ?? 0
        reads.set(el, index + 1)
        const list = positions.get(el) ?? []
        return list[Math.min(index, list.length - 1)] ?? { x: 0, y: 0, width: 0, height: 0 }
      },
      animate() {
        let settle = (): void => {}
        const finished = new Promise<void>((resolve) => {
          settle = resolve
        })
        // A real `Animation.cancel()` settles `finished` (by rejecting, which `FlipRun` swallows),
        // so the fake settles it too — otherwise the tracker would look leak-free for the wrong
        // reason.
        const cancel = vi.fn(() => settle())
        animations.push({ cancel, complete: () => settle() })
        return { finished, cancel } as unknown as Animation
      },
    }
    return { deps, animations }
  }

  /** One child that moves 50px further down on each of `moves` mutations. */
  function movingChild(moves: number) {
    const container = document.createElement('ul')
    const child = document.createElement('li')
    container.append(child)
    const steps: Box[] = []
    for (let i = 0; i <= moves * 2; i++) steps.push(box(0, i * 50))
    return { container, positions: new Map([[child, steps]]) }
  }

  // The count is varied on purpose: the defect is "the handle was dropped", and a single-run test
  // would still pass against a fix that only remembered the newest run.
  it.each([1, 2, 3])('cancels all %i moves still playing when teardown runs', (moves) => {
    const { container, positions } = movingChild(moves)
    const { deps, animations } = playingDeps(positions)

    let fire = (): void => {}
    const cleanup = observeLayout(
      container,
      createFlipEngine(deps),
      { durationMs: 10_000 },
      (callback) => {
        fire = callback
        return () => {}
      },
    )

    for (let i = 0; i < moves; i++) fire()
    expect(animations).toHaveLength(moves)
    for (const animation of animations) expect(animation.cancel).not.toHaveBeenCalled()

    cleanup()

    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledOnce()
  })

  it('lets a move that already completed go, instead of holding it until teardown', async () => {
    const { container, positions } = movingChild(1)
    const { deps, animations } = playingDeps(positions)

    let fire = (): void => {}
    const cleanup = observeLayout(container, createFlipEngine(deps), {}, (callback) => {
      fire = callback
      return () => {}
    })

    fire()
    animations[0]!.complete()
    // `FlipRun.finished` is a `Promise.all(...).then(...)` over each animation's own
    // `.catch(...)`, so the tracker's `.then` is several microtask hops down. One macrotask drains
    // all of them without having to count.
    await new Promise((resolve) => setTimeout(resolve, 0))

    cleanup()

    // Cancelling an already-finished animation is harmless in a browser, but never pruning the set
    // would make it grow with every mutation the page ever makes.
    expect(animations[0]!.cancel).not.toHaveBeenCalled()
  })
})
