// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlipEngine, mutationWatcher, observeLayout } from '../src/core/flip.js'
import type { Box } from '../src/core/flip.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createJsEffectPreparer } from '../src/core/js-effect-preparer.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { collectingReporter } from '../src/core/reporter.js'
import { catalogRegistry } from './support/registry.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'

const registry = catalogRegistry()
const EXAMPLES = [
  'flip-reorder attribute:class nested:true scale:true 600ms',
  'flip-reorder attribute:data-layout scale:true 500ms',
  'underline-draw position:50% 300ms on:click',
]

afterEach(() => vi.unstubAllGlobals())

describe('Motion batch 20', () => {
  it('compiles all holding-page and report examples with no warnings and keeps plain variants unchanged', () => {
    const reporter = collectingReporter()
    const preparer = createJsEffectPreparer({ capabilities: CAPS, reporter, respectReducedMotion: true,
      scheduler: idleScheduler, rootResolver: () => fakeRoot })
    for (const source of EXAMPLES) {
      const plan = compile(parse(source), registry, 'time')
      expect(plan.warnings).toEqual([])
      const el = document.createElement('div')
      const instances = preparer.prepare({ el, plan, signal: new AbortController().signal, ledger: createStyleLedger(el) })
      expect(reporter.messages).toEqual([])
      instances.forEach((instance) => instance.destroy())
    }
    const plain = compile(parse('underline-draw'), registry, 'time')
    expect(plain.vars).toEqual({})
    expect(compile(parse('underline-draw, text-outline-fill'), registry, 'time').warnings).toEqual([])
    const strike = compile(parse(EXAMPLES[2]!), registry, 'time')
    expect(strike.vars['--kui-sweep-position']).toBe('50%')
    const css = readFileSync('src/css/text.css', 'utf8')
    expect(css).toContain('background-position: 0 var(--kui-sweep-position, 100%)')
  })

  it.each(['class', 'data-layout'])('captures the previous endpoint before a %s mutation and ignores its own animation', async (attribute) => {
    const host = document.createElement('div')
    const child = document.createElement('div')
    host.append(child)
    let x = 0
    const frames: Keyframe[][] = []
    const cancel = vi.fn()
    const engine = createFlipEngine({
      measure: () => ({ x, y: 0, width: 100, height: 100 }),
      animate: (_el, keyframes) => {
        frames.push(keyframes)
        // A fake live transform makes post-play snapshotting detectably wrong.
        x -= 10
        return { finished: new Promise(() => {}), cancel } as unknown as Animation
      },
    })
    const stop = observeLayout(host, engine, { attribute }, mutationWatcher(host, attribute))
    x = 100
    host.setAttribute(attribute, 'expanded')
    await Promise.resolve()
    expect(frames[0]?.[0]?.translate).toBe('-100px 0px')
    x = 200
    child.setAttribute(attribute, 'changed')
    await Promise.resolve()
    expect(frames[1]?.[0]?.translate).toBe('-100px 0px')
    await Promise.resolve()
    expect(frames).toHaveLength(2)
    expect(cancel).toHaveBeenCalledOnce()
    stop()
    expect(cancel).toHaveBeenCalledTimes(2)
    host.setAttribute(attribute, 'after-destroy')
    await Promise.resolve()
    expect(frames).toHaveLength(2)
  })

  it('corrects nested scale and translation at the start and middle without frame-time geometry reads', async () => {
    const host = document.createElement('div')
    const child = document.createElement('div')
    const leaf = document.createElement('div')
    host.append(child)
    child.append(leaf)
    const nodes: Element[] = [host, child, leaf]
    const first: Box[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 40, y: 40, width: 20, height: 20 },
      { x: 45, y: 45, width: 10, height: 10 },
    ]
    const last: Box[] = [
      { x: 50, y: 50, width: 200, height: 200 },
      { x: 140, y: 140, width: 20, height: 20 },
      { x: 145, y: 145, width: 10, height: 10 },
    ]
    let boxes = first
    let progress: number | null = 0
    let tick = (): void => {}
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { tick = callback; return 1 })
    const cancelFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const keyframes: Keyframe[][][] = []
    const animations: Animation[] = []
    let finish = (): void => {}
    const measure = vi.fn((el: Element) => boxes[nodes.indexOf(el)]!)
    const engine = createFlipEngine({ measure, animate: (_el, _frames, options) => {
      const painted: Keyframe[][] = []
      if (options.duration === 1) keyframes.push(painted)
      const animation = {
        finished: new Promise<void>((resolve) => { finish = resolve }),
        cancel: vi.fn(), pause: vi.fn(), currentTime: null,
        effect: { getComputedTiming: () => ({ progress }), setKeyframes: (frames: Keyframe[]) => painted.push(frames) },
      } as unknown as Animation
      animations.push(animation)
      return animation
    } })
    const before = engine.snapshot(nodes)
    boxes = last
    const run = engine.play(before, nodes, { nested: true, scale: true, delayMs: 100 })
    expect(keyframes[0]![0]![0]).toMatchObject({ scale: '0.5 0.5', translate: '-50px -50px' })
    expect(keyframes[1]![0]![0]).toMatchObject({ scale: '2 2', translate: '-10px -10px' })
    expect(keyframes[2]![0]![0]).toMatchObject({ scale: '1 1', translate: '0px 0px' })
    progress = null // native delay holds the first frame
    tick()
    expect(keyframes[1]!.at(-1)![0]!.scale).toBe('2 2')
    progress = 0.5
    tick()
    expect(keyframes[0]!.at(-1)![0]!.scale).toBe('0.75 0.75')
    expect(keyframes[1]!.at(-1)![0]!.scale).toBe(`${1 / 0.75} ${1 / 0.75}`)
    expect(measure).toHaveBeenCalledTimes(6)
    progress = 1
    tick()
    expect(keyframes[1]!.at(-1)![0]!.scale).toBe('1 1')
    run.cancel()
    tick()
    expect(cancelFrame).toHaveBeenCalled()
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalled()
    finish()
  })

  it('captures nested host geometry and cancels prior runs on a new state or removal', async () => {
    const host = document.createElement('div')
    const child = document.createElement('div')
    host.append(child)
    let fire = (): void => {}
    const cancel = vi.fn()
    const snapshot = vi.fn((elements: Iterable<Element>) => ({ boxes: new Map([...elements].map((el) => [el, { x: 0, y: 0, width: 20, height: 20 }])) }))
    const play = vi.fn(() => ({ moved: [child], finished: new Promise<void>(() => {}), cancel }))
    const stop = observeLayout(host, { snapshot, play }, { nested: true }, (callback) => { fire = callback; return vi.fn() })
    expect([...snapshot.mock.results[0]!.value.boxes.keys()]).toEqual([host, child])
    fire()
    child.remove()
    fire()
    expect(cancel).toHaveBeenCalledOnce()
    expect([...snapshot.mock.results.at(-1)!.value.boxes.keys()]).toEqual([host])
    stop()
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('degrades without WAAPI, ignores new and zero-size nodes, and supports position-only nested moves', async () => {
    const host = document.createElement('div')
    const child = document.createElement('div')
    host.append(child)
    let x = 0
    const measure = () => ({ x, y: 10, width: 100, height: 100 })
    const engine = createFlipEngine({ measure, animate: () => null })
    const before = engine.snapshot([host])
    x = 20
    const run = engine.play(before, [host, child], { nested: true })
    expect(run.moved).toEqual([host])
    await expect(run.finished).resolves.toBeUndefined()
    before.boxes.get(host)!.width = 0
    expect(engine.play(before, [host], { nested: true }).moved).toEqual([])
  })
})
