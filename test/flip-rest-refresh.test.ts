// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlipEngine, observeLayout } from '../src/core/flip.js'
import { build, el } from './support/js-effect-harness.js'

afterEach(() => vi.unstubAllGlobals())
const settle = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)) }

function flight() {
  const host = document.createElement('div')
  const child = document.createElement('i')
  host.append(child)
  let x = 0
  let change = (): void => {}
  let resize = (): void => {}
  const ends: Array<() => void> = []
  const frames: Keyframe[][] = []
  const measure = vi.fn(() => ({ x, y: 0, width: 10, height: 10 }))
  const engine = createFlipEngine({ measure, animate: (_el, keys) => {
    frames.push(keys)
    return { finished: new Promise<void>((resolve) => { ends.push(resolve) }), cancel: vi.fn() } as unknown as Animation
  } })
  const stop = observeLayout(host, engine, { watchRest: (callback) => { resize = callback; return vi.fn() } },
    (callback) => { change = callback; return vi.fn() })
  return { frames, measure, ends, stop, change: () => change(), resize: () => resize(), move: (value: number) => { x = value } }
}

describe('FLIP resting layout refresh', () => {
  it.each(['parent', 'page'])('refreshes after a late image resizes the %s and disconnects on teardown', async (resized) => {
    const observed: Element[] = []
    let resize = (): void => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe(node: Element): void { observed.push(node) }
      disconnect = disconnect
    })
    const app = build('<section><div data-kui="flip-reorder 600ms"><i>a</i></div></section>')
    const host = el()
    const child = host.firstElementChild! as HTMLElement
    let top = 100
    host.parentElement!.getBoundingClientRect = (() => ({ left: 0, top: 0, width: 200, height: 1000 })) as never
    child.getBoundingClientRect = (() => ({ left: 0, top, width: 10, height: 10 })) as never
    child.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() })) as never
    app.start()
    expect(observed).toContain(host)
    expect(observed).toContain(host.parentElement)
    const changed = resized === 'page' ? document.documentElement : host.parentElement!
    top = 200 // image loads above the host
    if (observed.includes(changed)) resize()
    top = 252
    host.append(document.createElement('b'))
    await Promise.resolve()
    expect(vi.mocked(child.animate).mock.calls[0]![0]).toMatchObject([{ translate: '0px -52px' }, {}])
    app.destroy()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('defers a mid-flight resize and snapshots the settled layout before the next move', async () => {
    const rig = flight()
    rig.move(50)
    rig.change()
    const reads = rig.measure.mock.calls.length
    rig.move(999) // a live transform must never enter the resting snapshot
    rig.resize()
    expect(rig.measure).toHaveBeenCalledTimes(reads)
    rig.move(100) // final layout after the image/resize
    rig.ends[0]!()
    await settle()
    expect(rig.measure).toHaveBeenCalledTimes(reads + 1)
    rig.move(150)
    rig.change()
    expect(rig.frames[1]![0]).toMatchObject({ translate: '-50px 0px' })
    rig.stop()
  })

  it('does not let an older completion read geometry during the replacement flight', async () => {
    const rig = flight()
    rig.move(50)
    rig.change()
    rig.resize()
    rig.move(100)
    rig.change()
    rig.resize()
    const reads = rig.measure.mock.calls.length
    rig.ends[0]!()
    await settle()
    expect(rig.measure).toHaveBeenCalledTimes(reads)
    rig.move(150)
    rig.ends[1]!()
    await settle()
    expect(rig.measure).toHaveBeenCalledTimes(reads + 1)
    rig.move(200)
    rig.change()
    expect(rig.frames[2]![0]).toMatchObject({ translate: '-50px 0px' })
    rig.stop()
  })

  it('does not read a deferred resize after teardown', async () => {
    const rig = flight()
    rig.move(50)
    rig.change()
    rig.resize()
    rig.stop()
    const reads = rig.measure.mock.calls.length
    rig.ends[0]!()
    await settle()
    rig.resize()
    expect(rig.measure).toHaveBeenCalledTimes(reads)
  })
})
