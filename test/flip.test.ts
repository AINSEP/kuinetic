import { describe, expect, it, vi } from 'vitest'
import { createFlipEngine, observeLayout } from '../src/core/flip.js'
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

  it('survives an environment with no Web Animations API', () => {
    const el = makeElement()
    const positions = new Map([[el, [box(0, 0), box(10, 0)]]])
    const engine = createFlipEngine({ ...fakeDeps(positions).deps, animate: () => null })
    const run = engine.play(engine.snapshot([el]), [el])
    expect(run.moved).toEqual([el])
    expect(() => run.cancel()).not.toThrow()
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
