// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build, el } from './support/js-effect-harness.js'
import { parse } from '../src/core/parse.js'
import { compile } from '../src/core/compile.js'
import { createFlipEngine, measureWithin } from '../src/core/flip.js'
import { catalogRegistry } from './support/registry.js'

/** A browser's rects: layout position minus the page's scroll. */
function place(node: Element, layout: () => number, scroll: () => number): void {
  node.getBoundingClientRect = (() => {
    const top = layout() - scroll()
    return { left: 0, top, width: 10, height: 10, right: 10, bottom: top + 10 }
  }) as never
}

function capture(node: Element): Keyframe[][] {
  const frames: Keyframe[][] = []
  ;(node as HTMLElement).animate = ((keyframes: Keyframe[]) => {
    frames.push(keyframes)
    return { finished: new Promise(() => {}), cancel: vi.fn() } as unknown as Animation
  }) as unknown as HTMLElement['animate']
  return frames
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.scrollTop = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('a cached FLIP baseline', () => {
  function mount(effect: string) {
    let scroll = 0
    let childTop = 1000
    const app = build(`<div data-kui="${effect}"><i>a</i></div>`)
    const host = el()
    const child = host.querySelector('i')!
    place(host.parentElement!, () => 0, () => scroll)
    place(host, () => 1000, () => scroll)
    place(child, () => childTop, () => scroll)
    return { app, host, child, frames: capture(child),
      scrollTo: (y: number) => { scroll = y; document.documentElement.scrollTop = y },
      moveTo: (y: number) => { childTop = y } }
  }

  it('is not moved by scrolling the page between install and the change', async () => {
    const { app, host, frames, scrollTo, moveTo } = mount('flip-reorder attribute:data-layout scale:true 500ms')
    app.start()
    scrollTo(20800)
    moveTo(1052)
    host.setAttribute('data-layout', 'open')
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
  })

  it('keeps a plain host off the scroll too', async () => {
    const { app, host, frames, scrollTo, moveTo } = mount('flip-reorder 500ms')
    app.start()
    scrollTo(5066)
    moveTo(1052)
    host.append(document.createElement('b'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
  })

  it('cancels the live inversion before capturing the next baseline', async () => {
    const { app, host, child, moveTo } = mount('flip-reorder 500ms')
    const frames: Keyframe[][] = []
    let rest = 1052
    const cancel = vi.fn(() => moveTo(rest))
    ;(child as HTMLElement).animate = ((keys: Keyframe[]) => {
      frames.push(keys)
      moveTo(1000) // the live inversion stays visible until cancellation
      return { finished: new Promise(() => {}), cancel }
    }) as never
    app.start()
    moveTo(rest)
    host.append(document.createElement('b'))
    await flush()
    expect(cancel).not.toHaveBeenCalled()
    rest = 1100
    host.append(document.createElement('b'))
    await flush()
    expect(cancel).toHaveBeenCalledOnce()
    rest = 1150
    host.append(document.createElement('b'))
    await flush()
    expect(frames[2]?.[0]).toMatchObject({ translate: '0px -50px' })
    app.destroy()
  })

  it('refreshes after a resting layout change, and not during a flight', async () => {
    const { app, host, frames, moveTo } = mount('flip-reorder attribute:data-layout 500ms')
    app.start()
    moveTo(1100) // a late image above the child
    window.dispatchEvent(new Event('resize'))
    moveTo(1152)
    host.setAttribute('data-layout', 'open')
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
    moveTo(1300) // mid-flight: a read here would include the animation
    window.dispatchEvent(new Event('resize'))
    moveTo(1152)
    expect(frames).toHaveLength(1)
    host.setAttribute('data-layout', 'closed')
    await flush()
    expect(frames).toHaveLength(1) // endpoint kept: no movement from 1152 to 1152
  })

  it('refreshes a plain host after a viewport resize', async () => {
    const { app, host, frames, moveTo } = mount('flip-reorder 500ms')
    app.start()
    moveTo(1100)
    window.dispatchEvent(new Event('resize'))
    moveTo(1152)
    host.append(document.createElement('b'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
    app.destroy()
  })
})

describe('word-cycler from:', () => {
  it('reaches the parameter, which order: never could', () => {
    expect(compile(parse('word-cycler from:center'), catalogRegistry(), 'time').vars['--kui-resolve-order']).toBe('center')
  })
})

describe('nested FLIP', () => {
  const box = (x: number, width = 100) => ({ x, y: 0, width, height: 100 })

  it('starts nothing when nothing moved', () => {
    const host = document.createElement('div')
    const animate = vi.fn(() => null)
    const engine = createFlipEngine({ measure: () => box(0), animate })
    expect(engine.play(engine.snapshot([host]), [host], { nested: true }).moved).toEqual([])
    expect(animate).not.toHaveBeenCalled()
  })

  it('uses one clock however many elements move', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const host = document.createElement('div')
    host.innerHTML = '<i></i><i></i><i></i>'
    const nodes = [host, ...host.children]
    let x = 0
    const durations: unknown[] = []
    const engine = createFlipEngine({ measure: () => box(x), animate: (_el, _k, options) => {
      durations.push(options.duration)
      return { finished: new Promise(() => {}), cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
        effect: { getComputedTiming: () => ({ progress: 0 }), setKeyframes: vi.fn() } } as unknown as Animation
    } })
    const before = engine.snapshot(nodes)
    x = 50
    engine.play(before, nodes, { nested: true, durationMs: 300 })
    expect(durations.filter((duration) => duration === 300)).toHaveLength(1)
    expect(durations.filter((duration) => duration === 1)).toHaveLength(4)
  })

  it('corrects against the nearest painted ancestor when a zero-size wrapper is skipped', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const host = document.createElement('div')
    host.innerHTML = '<b><i></i></b>'
    const wrapper = host.firstElementChild!
    const leaf = wrapper.firstElementChild!
    const nodes = [host, wrapper, leaf]
    let wide = false
    const painted = new Map<Element, Keyframe[]>()
    const engine = createFlipEngine({
      measure: (node) => {
        if (node === host) return box(0, wide ? 200 : 100)
        return node === wrapper ? box(0, 0) : box(10, 20)
      },
      animate: (node) => ({ finished: new Promise(() => {}), cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
        effect: { getComputedTiming: () => ({ progress: 0 }), setKeyframes: (frames: Keyframe[]) => painted.set(node, frames) } }) as unknown as Animation,
    })
    const before = engine.snapshot(nodes)
    wide = true
    engine.play(before, nodes, { nested: true, scale: true })
    // The host starts at half its final width, so the leaf must cancel that scale.
    expect(painted.get(leaf)![0]).toMatchObject({ scale: '2 1' })
  })
})

describe('measureWithin', () => {
  it('adds the frame scroll, and keeps viewport boxes for no frame', () => {
    const frame = document.createElement('div')
    const child = document.createElement('i')
    Object.defineProperty(frame, 'scrollTop', { value: 30 })
    Object.defineProperty(frame, 'scrollLeft', { value: 7 })
    frame.getBoundingClientRect = (() => ({ left: 5, top: 100, width: 0, height: 0 })) as never
    child.getBoundingClientRect = (() => ({ left: 15, top: 130, width: 10, height: 10 })) as never
    expect(measureWithin(frame)(child)).toEqual({ x: 17, y: 60, width: 10, height: 10 })
    expect(measureWithin(null)(child)).toEqual({ x: 15, y: 130, width: 10, height: 10 })
    child.getBoundingClientRect = (() => ({ left: 15, top: 130, width: 0, height: 10 })) as never
    expect(measureWithin(frame)(child)).toEqual({ x: 17, y: 60, width: 0, height: 10 })
  })

  it.each([
    ['in flow, with page scroll removed', true, () => 500],
    ['fixed, on viewport boxes', false, () => 500],
  ])('a nested host %s ignores the scroll', async (_name, positioned, moved) => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let scroll = 0
    let childTop = 1000
    const app = build('<section><div data-kui="flip-reorder nested:true 500ms"><i>a</i></div></section>')
    const host = el()
    const child = host.firstElementChild!
    if (!positioned) host.style.position = 'fixed'
    place(host.parentElement!, () => 900, () => scroll)
    place(host, () => 1000, () => (positioned ? scroll : 0))
    place(child, () => childTop, () => (positioned ? scroll : 0))
    const painted: Keyframe[] = []
    ;(host as HTMLElement).animate = (() => ({ finished: new Promise(() => {}), cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
      effect: { getComputedTiming: () => ({ progress: 0 }), setKeyframes: (frames: Keyframe[]) => painted.push(frames[0]!) } })) as never
    ;(child as HTMLElement).animate = (host as HTMLElement).animate
    app.start()
    scroll = moved()
    document.documentElement.scrollTop = scroll
    childTop = 1052
    host.append(document.createElement('u'))
    await flush()
    expect(painted[0]).toMatchObject({ translate: '0px 0px' })
  })
})

describe('a host not using the new options', () => {
  it('plain FLIP ignores class changes and claims nothing new', async () => {
    const app = build('<div data-kui="flip-reorder"><i>a</i></div>')
    const host = el()
    const child = host.firstElementChild!
    let left = 0
    child.getBoundingClientRect = (() => ({ left, top: 0, width: 10, height: 10 })) as never
    const frames = capture(child)
    app.start()
    left = 50
    child.setAttribute('class', 'moved')
    host.setAttribute('class', 'moved')
    await flush()
    expect(frames).toEqual([])
    const primitive = catalogRegistry().resolve('flip-reorder')!.primitive
    expect(primitive.variantFor!({ params: {} } as never, () => {})).toEqual({})
    expect(primitive.variantFor!({ params: { nested: 'true' } } as never, () => {}).channels).toContain('subtree')
  })

  it('plain icon-morph adds no visibility listener and starts no frames', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    build(`<svg><path d="M0 0L10 10" data-kui="icon-morph to:'M0 0L20 20'"></path></svg>`).start()
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toEqual([])
    expect(frame).not.toHaveBeenCalled()
    add.mockRestore()
  })
})
