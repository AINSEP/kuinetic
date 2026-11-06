// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build, el } from './support/js-effect-harness.js'
import { collectingReporter } from '../src/core/reporter.js'

// Viewport rects and native animations are modelled, not provided by jsdom layout.
function place(node: Element, at: () => number): void {
  node.getBoundingClientRect = vi.fn(() => ({ left: 0, top: at(), width: 100, height: 100 }) as DOMRect)
}

function capture(node: Element): Keyframe[][] {
  const frames: Keyframe[][] = []
  const paint = (keys: Keyframe[]): void => { frames.push(keys) }
  ;(node as HTMLElement).animate = ((keys: Keyframe[]) => {
    if (keys[0]?.translate !== undefined) paint(keys)
    return { finished: new Promise(() => {}), cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
      effect: { getComputedTiming: () => ({ progress: 0 }), setKeyframes: paint } }
  }) as never
  return frames
}

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.scrollTop = 0
  document.documentElement.scrollLeft = 0
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  document.documentElement.scrollTop = 0
  document.documentElement.scrollLeft = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FLIP scroll-chain coordinates', () => {
  it('keeps a list inside a stuck ancestor in its host frame through page scroll and a real mutation', async () => {
    const app = build('<aside style="position:sticky"><div data-kui="flip-reorder attribute:data-layout"><i>a</i></div></aside>')
    const host = el()
    const row = host.firstElementChild!
    let offset = 0
    place(host.parentElement!, () => 40)
    place(host, () => 50)
    place(row, () => 50 + offset)
    const frames = capture(row)
    app.start()
    document.documentElement.scrollTop = 500
    host.setAttribute('data-layout', 'unchanged')
    await flush()
    expect(frames).toHaveLength(0)
    offset = 30
    host.setAttribute('data-layout', 'moved')
    await flush()
    expect(frames[0]![0]!.translate).toBe('0px -30px')
    app.destroy()
  })
  it.each(['flip-reorder attribute:data-layout 600ms', 'flip-reorder attribute:data-layout nested:true 600ms'])(
    'converts cached boxes when docking, scrolling and undocking: %s', async (effect) => {
      const reporter = collectingReporter()
      const app = build(`<section><div data-kui="${effect}"><i>a</i><i>b</i><i>c</i></div></section>`, reporter)
      const host = el()
      host.style.position = 'relative'
      document.documentElement.scrollTop = 200
      let top = 300
      place(host.parentElement!, () => 500 - document.documentElement.scrollTop)
      place(host, () => top)
      const hostFrames = capture(host)
      const children = [...host.children]
      const childFrames = children.map((child) => { place(child, () => top); return capture(child) })
      const frames = effect.includes('nested:true') ? hostFrames : childFrames[0]!
      app.start()
      const styles = vi.spyOn(window, 'getComputedStyle')
      host.style.position = 'fixed'
      top = 600
      host.setAttribute('data-layout', 'docked')
      await flush()
      expect(frames[0]?.[0]).toMatchObject({ translate: '0px -300px' })
      expect(styles.mock.calls.filter(([node]) => node === host)).toHaveLength(1)
      styles.mockClear()
      document.documentElement.scrollTop = 2000
      host.style.position = 'relative'
      top = -700 // document Y 1300; the fixed endpoint before undocking was viewport Y 600
      host.setAttribute('data-layout', 'undocked')
      await flush()
      expect(frames[1]?.[0]).toMatchObject({ translate: '0px 1300px' })
      expect(styles.mock.calls.filter(([node]) => node === host)).toHaveLength(1)
      expect(reporter.messages).toEqual([])
      app.destroy()
    },
  )

  it.each([
    ['centred dialog / plain', '<dialog open style="position:fixed">', '</dialog>', false],
    ['fixed wrapper / plain', '<div style="position:fixed;bottom:0">', '</div>', false],
    ['nested centring / plain', '<section><div>', '</div></section>', false],
    ['centred dialog / nested', '<dialog open style="position:fixed">', '</dialog>', true],
    ['fixed wrapper / nested', '<div style="position:fixed;bottom:0">', '</div>', true],
    ['nested centring / nested', '<section><div>', '</div></section>', true],
  ])('preserves movement shared with a %s', async (_name, open, close, nested) => {
    const app = build(`${open}<ul data-kui="flip-reorder ${nested ? 'nested:true ' : ''}600ms"><li>a</li></ul>${close}`)
    const host = el()
    let top = 1000
    place(host.parentElement!, () => top)
    place(host, () => top)
    const child = host.firstElementChild!
    place(child, () => top)
    const frames = capture(nested ? host : child)
    if (nested) capture(child)
    app.start()
    top -= 52
    host.append(document.createElement('li'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px 52px' })
    app.destroy()
  })

  it('converts the old chain using its current scroll rather than its cached scroll', async () => {
    const app = build('<section><div data-kui="flip-reorder attribute:data-layout 600ms"><i>a</i></div></section>')
    const host = el()
    host.style.position = 'relative'
    document.documentElement.scrollTop = 200
    place(host.parentElement!, () => 500 - document.documentElement.scrollTop)
    place(host, () => 300)
    const child = host.firstElementChild!
    place(child, () => 300)
    const frames = capture(child)
    app.start()
    document.documentElement.scrollTop = 500 // the old flow box would now be at viewport Y 0
    host.style.position = 'fixed' // its new viewport Y is 300
    host.setAttribute('data-layout', 'docked')
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -300px' })
    app.destroy()
  })

  it.each(['', 'nested:true '])('ignores window scroll through a display:contents parent (%s)', async (nested) => {
    const app = build(`<section style="display:contents"><div data-kui="flip-reorder ${nested}600ms"><i>a</i></div></section>`)
    const host = el()
    const child = host.firstElementChild!
    let top = 1000
    host.parentElement!.getBoundingClientRect = (() => ({ left: 0, top: 0, width: 0, height: 0 })) as never
    place(host, () => 1000 - document.documentElement.scrollTop)
    place(child, () => top - document.documentElement.scrollTop)
    const frames = capture(child)
    const hostFrames = nested ? capture(host) : []
    app.start()
    document.documentElement.scrollTop = 5066
    top = 1052
    host.append(document.createElement('b'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
    if (nested) expect(hostFrames[0]?.[0]).toMatchObject({ translate: '0px 0px' })
    app.destroy()
  })

  it('converts between different ancestor scrollers even when chain lengths match', async () => {
    const app = build('<section><div data-kui="flip-reorder attribute:data-layout 600ms"><i>a</i></div></section><section></section>')
    const host = el()
    const oldParent = host.parentElement!
    const newParent = document.querySelectorAll('section')[1]!
    oldParent.scrollTop = 300
    newParent.scrollTop = 700
    document.documentElement.scrollTop = 100
    let top = 100
    place(oldParent, () => 0)
    place(newParent, () => 0)
    place(host, () => top)
    const child = host.firstElementChild!
    place(child, () => top)
    const frames = capture(child)
    app.start()
    newParent.append(host)
    top = 150
    host.setAttribute('data-layout', 'moved')
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -50px' })
    app.destroy()
  })

  it('keeps a nested host fixed in its own scroll frame while its child moves', async () => {
    const app = build('<div data-kui="flip-reorder nested:true 600ms"><i>a</i></div>')
    const host = el()
    const child = host.firstElementChild!
    let top = 1000
    place(host, () => 1000)
    place(child, () => top - host.scrollTop)
    const hostFrames = capture(host)
    const childFrames = capture(child)
    app.start()
    host.scrollTop = 500
    top = 1052
    host.append(document.createElement('b'))
    await flush()
    expect(hostFrames[0]?.[0]).toMatchObject({ translate: '0px 0px' })
    expect(childFrames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
    app.destroy()
  })

  it('adds both axes of window scroll and every ancestor scroller', async () => {
    const app = build('<section><article><div data-kui="flip-reorder 600ms"><i>a</i></div></article></section>')
    const host = el()
    const inner = host.parentElement!
    const outer = inner.parentElement!
    const root = document.documentElement
    let moved = false
    outer.getBoundingClientRect = (() => ({ left: -root.scrollLeft, top: -root.scrollTop, width: 100, height: 100 })) as never
    inner.getBoundingClientRect = (() => ({ left: -root.scrollLeft - outer.scrollLeft,
      top: -root.scrollTop - outer.scrollTop, width: 100, height: 100 })) as never
    host.getBoundingClientRect = (() => ({ left: 1000 - root.scrollLeft - outer.scrollLeft - inner.scrollLeft,
      top: 1000 - root.scrollTop - outer.scrollTop - inner.scrollTop, width: 100, height: 100 })) as never
    const child = host.firstElementChild!
    child.getBoundingClientRect = (() => ({ left: 1000 + (moved ? 17 : 0) - root.scrollLeft - outer.scrollLeft - inner.scrollLeft,
      top: 1000 + (moved ? 52 : 0) - root.scrollTop - outer.scrollTop - inner.scrollTop, width: 100, height: 100 })) as never
    const frames = capture(child)
    app.start()
    root.scrollLeft = 400
    root.scrollTop = 5000
    outer.scrollLeft = 120
    outer.scrollTop = 300
    inner.scrollLeft = 30
    inner.scrollTop = 70
    moved = true
    host.append(document.createElement('b'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '-17px -52px' })
    app.destroy()
  })

  it('updates the scroll batch before taking a resting resize snapshot', async () => {
    const app = build('<div data-kui="flip-reorder 600ms"><i>a</i></div>')
    const host = el()
    let top = 1000
    place(host, () => 1000 - document.documentElement.scrollTop)
    const child = host.firstElementChild!
    place(child, () => top - document.documentElement.scrollTop)
    const frames = capture(child)
    app.start()
    document.documentElement.scrollTop = 5000
    top = 1100
    window.dispatchEvent(new Event('resize'))
    top = 1152
    host.append(document.createElement('b'))
    await flush()
    expect(frames[0]?.[0]).toMatchObject({ translate: '0px -52px' })
    app.destroy()
  })
})
