// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build, el } from './support/js-effect-harness.js'
import { collectingReporter } from '../src/core/reporter.js'

// jsdom cannot lay out bottom/centred hosts. Model their viewport movement explicitly;
// these tests check frame arithmetic and keyframes, not CSS layout or browser painting.
function rect(node: Element, position: () => [number, number], visible = () => true): void {
  node.getBoundingClientRect = vi.fn(() => {
    const [left, top] = visible() ? position() : [0, 0]
    const size = visible() ? 50 : 0
    return { left, top, width: size, height: size } as DOMRect
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.scrollTop = 0
})
afterEach(() => vi.unstubAllGlobals())
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

describe('FLIP host movement in a scroll-stable frame', () => {
  it.each([
    ['bottom', 'absolute', -52, 'none'],
    ['centred', 'absolute', -26, 'none'],
    ['bottom', 'absolute', -52, 'window'],
    ['centred', 'absolute', -26, 'ancestor'],
    ['bottom', 'fixed', -52, 'window'],
  ])('animates a %s %s host moving %ipx with %s scroll', async (anchor, position, shift, scrolling) => {
    const reporter = collectingReporter()
    const app = build('<section><div data-kui="flip-reorder 600ms"><i>a</i><i>b</i><i>c</i></div></section>', reporter)
    const host = el()
    host.style.position = position
    if (anchor === 'bottom') host.style.bottom = '0'
    else {
      host.style.top = '50%'
      host.style.transform = 'translateY(-50%)'
    }
    const parent = host.parentElement!
    Object.defineProperty(host, 'offsetParent', { value: parent })
    let hostTop = 1000
    let scroll = 0
    const pageScroll = () => scrolling === 'window' ? scroll : 0
    Object.defineProperty(parent, 'scrollTop', { get: () => scrolling === 'ancestor' ? scroll : 0 })
    rect(parent, () => [0, -pageScroll()])
    const hostScroll = () => position === 'fixed' ? 0 : scroll
    rect(host, () => [0, hostTop - hostScroll()])
    const frames: Keyframe[][] = []
    for (const [index, child] of [...host.children].entries()) {
      rect(child, () => [0, hostTop + index * 52 - hostScroll()])
      ;(child as HTMLElement).animate = ((keys: Keyframe[]) => {
        frames.push(keys)
        return { finished: new Promise(() => {}), cancel: vi.fn() }
      }) as never
    }
    app.start()
    const measured = [parent, host, ...host.children]
    const reads = () => measured.map((node) => vi.mocked(node.getBoundingClientRect).mock.calls.length)
    const beforeScroll = reads()
    scroll = scrolling === 'none' ? 0 : 5066
    document.documentElement.scrollTop = pageScroll()
    window.dispatchEvent(new Event('scroll'))
    parent.dispatchEvent(new Event('scroll'))
    expect(reads()).toEqual(beforeScroll)
    hostTop += shift
    host.append(document.createElement('i'))
    await flush()
    expect(frames).toHaveLength(3)
    for (const keys of frames) {
      expect(keys[0]).toMatchObject({ translate: `0px ${-shift}px` })
      expect(keys[1]).toMatchObject({ translate: '0px 0px' })
    }
    expect(reporter.messages).toEqual([])
    app.destroy()
  })

  it('uses the absolute containing block when a static scrolling parent does not move the host', async () => {
    const app = build('<section><article><div data-kui="flip-reorder 600ms"><i>a</i></div></article></section>')
    const host = el()
    host.style.position = 'absolute'
    const scroller = host.parentElement!
    const block = scroller.parentElement!
    Object.defineProperty(host, 'offsetParent', { value: block })
    let scroll = 0
    let top = 100
    Object.defineProperty(scroller, 'scrollTop', { get: () => scroll })
    rect(block, () => [0, 0])
    rect(scroller, () => [0, 0])
    rect(host, () => [0, top])
    const child = host.firstElementChild!
    rect(child, () => [0, top])
    const animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }))
    ;(child as HTMLElement).animate = animate as never
    app.start()
    scroll = 500
    top -= 50
    host.append(document.createElement('b'))
    await flush()
    expect(animate.mock.calls[0]).toBeDefined()
    expect(vi.mocked(child.animate).mock.calls[0]![0]).toMatchObject([{ translate: '0px 50px' }, {}])
    app.destroy()
  })

  it('reveals hidden children instantly after scrolling while visible siblings animate', async () => {
    const app = build('<section><div data-kui="flip-filter 600ms"><i hidden>a</i><i hidden>b</i><i>c</i></div></section>')
    const host = el()
    const [child, stillHidden, visible] = [...host.children] as HTMLElement[]
    let scroll = 0
    let offset = 0
    rect(host.parentElement!, () => [0, -scroll])
    rect(host, () => [0, 5000 - scroll])
    rect(child!, () => [10, 5010 - scroll], () => !child!.hidden)
    rect(stillHidden!, () => [0, 0], () => false)
    rect(visible!, () => [0, 5000 + offset - scroll])
    const animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }))
    child!.animate = animate as never
    const hiddenAnimate = vi.fn()
    stillHidden!.animate = hiddenAnimate
    const siblingAnimate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }))
    visible!.animate = siblingAnimate as never
    app.start()
    scroll = 4900
    document.documentElement.scrollTop = scroll
    offset = 52
    child!.hidden = false
    await flush()
    expect(animate).not.toHaveBeenCalled()
    expect(hiddenAnimate).not.toHaveBeenCalled()
    expect(vi.mocked(visible!.animate).mock.calls[0]![0]).toMatchObject([{ translate: '0px -52px' }, {}])
    child!.hidden = true
    await flush()
    expect(animate).not.toHaveBeenCalled()
    app.destroy()
  })

  it('removes page scroll for a nested host activated inside a closed panel', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const app = build('<section hidden><div data-kui="flip-reorder nested:true 600ms"><i>a</i></div></section>')
    const host = el()
    const panel = host.parentElement! as HTMLElement
    const child = host.firstElementChild!
    let scroll = 0
    let top = 1000
    rect(panel, () => [0, 900 - scroll])
    rect(host, () => [0, 1000 - scroll], () => !panel.hidden)
    rect(child, () => [0, top - scroll], () => !panel.hidden)
    const painted: Keyframe[] = []
    host.animate = (() => ({ finished: new Promise(() => {}), cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
      effect: { getComputedTiming: () => ({ progress: 0 }), setKeyframes: (keys: Keyframe[]) => painted.push(keys[0]!) } })) as never
    ;(child as HTMLElement).animate = host.animate
    app.start()
    panel.hidden = false
    window.dispatchEvent(new Event('resize'))
    scroll = 500
    document.documentElement.scrollTop = scroll
    top = 1052
    host.append(document.createElement('b'))
    await flush()
    expect(painted[0]).toMatchObject({ translate: '0px 0px' })
    expect(painted[1]).toMatchObject({ translate: '0px -52px' })
    app.destroy()
  })

  it.each(['static', 'sticky'])('includes %s host content scrolling in both axes for plain children', async (position) => {
    const app = build('<section><div data-kui="flip-reorder 600ms"><i>a</i></div></section>')
    const host = el()
    host.style.position = position
    const child = host.firstElementChild! as HTMLElement
    let scroll = 0
    let offset = 0
    Object.defineProperties(host, {
      scrollLeft: { get: () => scroll },
      scrollTop: { get: () => scroll },
    })
    rect(host.parentElement!, () => [0, 0])
    rect(host, () => [100, 100])
    rect(child, () => [100 + offset - scroll, 100 + offset - scroll])
    child.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() })) as never
    app.start()
    scroll = 500
    offset = 52
    host.append(document.createElement('b'))
    await flush()
    expect(vi.mocked(child.animate).mock.calls[0]![0]).toMatchObject([{ translate: '-52px -52px' }, {}])
    app.destroy()
  })

  it('removes window scroll for children of an already-stuck sticky host', async () => {
    const app = build('<section><div data-kui="flip-reorder 600ms"><i>a</i></div></section>')
    const host = el()
    host.style.position = 'sticky'
    const child = host.firstElementChild! as HTMLElement
    let top = 100
    rect(host.parentElement!, () => [0, -document.documentElement.scrollTop])
    rect(host, () => [0, 100])
    rect(child, () => [0, top])
    child.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() })) as never
    app.start()
    document.documentElement.scrollTop = 5066
    top = 152
    host.append(document.createElement('b'))
    await flush()
    expect(vi.mocked(child.animate).mock.calls[0]![0]).toMatchObject([{ translate: '0px -52px' }, {}])
    app.destroy()
  })
})
