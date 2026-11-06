// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { catalogRegistry } from './support/registry.js'
import { CAPS, build, el, fakeRoot, idleScheduler } from './support/js-effect-harness.js'

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

function box(node: Element, top: () => number): void {
  node.getBoundingClientRect = vi.fn(() => ({ left: 20, top: top(), width: 100, height: 40 }) as DOMRect)
}

function animation(node: HTMLElement): { finish(): void; cancel: ReturnType<typeof vi.fn>; frames: Keyframe[][] } {
  const frames: Keyframe[][] = []
  const cancel = vi.fn()
  let finish = (): void => {}
  node.animate = vi.fn((keys) => {
    frames.push(keys as Keyframe[])
    return { finished: new Promise<void>((resolve) => { finish = resolve }), cancel }
  }) as never
  return { finish: () => finish(), cancel, frames }
}

describe('app-signalled direct-child departures', () => {
  it('measures every simultaneous departure before taking any row out of flow', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade"><i>a</i><i>b</i><i>c</i></div>')
    const host = el()
    box(host, () => 0)
    const rows = [...host.children] as HTMLElement[]
    for (const row of rows) {
      box(row, () => [...host.children].filter((node) => (node as HTMLElement).style.position !== 'absolute').indexOf(row) * 40)
      animation(row)
    }
    app.start()
    rows[0]!.setAttribute('data-kui-leaving', '')
    rows[1]!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(rows.slice(0, 2).map((row) => row.style.top)).toEqual(['0px', '40px'])
    app.destroy()
  })

  it('holds a departing row’s live slide before cancelling survivor FLIP', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade"><i>a</i><i>b</i></div>')
    const host = el()
    const [a, b] = [...host.children] as HTMLElement[]
    box(host, () => 0)
    box(a!, () => 0)
    box(b!, () => (a!.style.position === 'absolute' ? 0 : 40) + (Number.parseFloat(b!.style.translate.split(' ').at(-1)!) || 0))
    animation(a!)
    const slide = animation(b!)
    slide.cancel.mockImplementation(() => { b!.style.translate = '' })
    app.start()
    a!.setAttribute('data-kui-leaving', '')
    await flush()
    b!.style.translate = '0px 15px'
    b!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(slide.cancel).toHaveBeenCalled()
    expect(b!.style.top).toBe('15px')
    app.destroy()
  })

  it('refuses nested departures at runtime, leaving the original row interactive and in flow', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade nested:true"><i>a</i></div>', collectingReporter())
    const row = el().firstElementChild! as HTMLElement
    const done = vi.fn()
    row.addEventListener('kui:leave-end', done)
    app.start()
    row.setAttribute('data-kui-leaving', '')
    await flush()
    expect(row.style.position).toBe('')
    expect(row.hasAttribute('inert')).toBe(false)
    expect(done).not.toHaveBeenCalled()
    app.destroy()
  })

  it('keeps completed departures hidden and inert across repeated scrolls until app removal', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade"><i>a</i></div>')
    const row = el().firstElementChild! as HTMLElement
    const done = vi.fn()
    const run = animation(row)
    row.addEventListener('kui:leave-end', done)
    app.start()
    row.setAttribute('data-kui-leaving', '')
    await flush()
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))
    run.finish()
    await flush()
    expect(done).toHaveBeenCalledOnce()
    expect(row.style.position).toBe('absolute')
    expect(row.style.visibility).toBe('hidden')
    expect(row.hasAttribute('inert')).toBe(true)
    row.remove()
    await flush()
    expect(row.hasAttribute('inert')).toBe(false)
    app.destroy()
  })
  it.each([['50px', false], ['100px', true]] as const)('does not resurrect a child host’s foreign width after teardown (%s, important %s)', async (width, important) => {
    const app = build(`<div data-kui="flip-reorder leave:fade"><i style="width: ${width}${important ? ' !important' : ''}; margin-right: 9px"></i></div>`)
    const row = el().firstElementChild! as HTMLElement
    const childOwner = createStyleLedger(row)
    childOwner.set('width', '100px')
    childOwner.set('margin-right', '20px')
    box(row, () => 0)
    animation(row)
    app.start()
    row.setAttribute('data-kui-leaving', '')
    await flush()
    childOwner.restore()
    el().append(document.createElement('b'))
    await flush()
    app.destroy()
    expect(row.style.width).toBe(width)
    expect(row.style.getPropertyPriority('width')).toBe(important ? 'important' : '')
    expect(row.style.marginRight).toBe('9px')
    expect(row.style.position).toBe('')
  })
  it('compiles the lane examples and refuses nested departures without changing ordinary claims', () => {
    const registry = catalogRegistry()
    for (const value of ['flip-reorder leave:fade 300ms', 'underline-draw position:50% 300ms on:click']) {
      expect(compile(parse(value), registry, 'time').warnings).toEqual([])
    }
    expect(compile(parse('flip-reorder leave:fade nested:true'), registry, 'time').warnings.join()).toContain('direct children')
    expect(compile(parse('flip-reorder'), registry, 'time').channels).not.toContain('position')
  })

  it('pins the live row after a bottom host moves, closes the gap and completes once on that row', async () => {
    const reporter = collectingReporter()
    const app = build('<div data-kui="flip-reorder leave:fade 300ms"><i>a</i><i>b</i></div>', reporter)
    const host = el()
    const [a, b] = [...host.children] as HTMLElement[]
    const top = () => a!.style.position === 'absolute' ? 140 : 100
    box(host, top)
    box(a!, () => a!.style.position === 'absolute' ? top() + Number.parseFloat(a!.style.top || '0') : 107)
    box(b!, () => top() + (a!.style.position === 'absolute' ? 0 : 44))
    const exit = animation(a!)
    const survivor = animation(b!)
    const done = vi.fn()
    a!.addEventListener('kui:leave-end', done)
    app.start()
    a!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(a!.style.top).toBe('-33px')
    expect(a!.style.width).toBe('100px')
    expect(a!.hasAttribute('inert')).toBe(true)
    expect(survivor.frames[0]![0]!.translate).toBe('0px 4px')
    expect(exit.frames[0]).toEqual([{ opacity: '1' }, { opacity: 0 }])
    exit.finish()
    await flush()
    expect(done).toHaveBeenCalledOnce()
    expect(a!.style.visibility).toBe('hidden')
    a!.remove()
    await flush()
    expect(done).toHaveBeenCalledOnce()
    expect(a!.getAttribute('style')).toBeNull()
    expect(a!.hasAttribute('inert')).toBe(false)
    expect(reporter.messages).toEqual([])
    app.destroy()
    expect(host.style.position).toBe('')
  })

  it('keeps concurrent exits independent and restarts survivors from their current offset', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade 300ms"><i>a</i><i>b</i><i>c</i></div>')
    const host = el()
    const [a, b, c] = [...host.children] as HTMLElement[]
    box(host, () => 0)
    for (const child of [a!, b!, c!]) box(child, () => [...host.children].filter((el) => (el as HTMLElement).style.position !== 'absolute').indexOf(child) * 40)
    const one = animation(a!)
    const two = animation(b!)
    const three = animation(c!)
    app.start()
    a!.setAttribute('data-kui-leaving', '')
    await flush()
    c!.style.translate = '0px 20px'
    b!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(one.cancel).not.toHaveBeenCalled()
    expect(two.frames.at(-1)).toEqual([{ opacity: '1' }, { opacity: 0 }])
    expect(three.frames.at(-1)![0]!.translate).toBe('0px 60px')
    a!.removeAttribute('data-kui-leaving')
    await flush()
    expect(one.cancel).toHaveBeenCalledOnce()
    expect(a!.style.position).toBe('')
    app.destroy()
    expect(two.cancel).toHaveBeenCalled()
    expect(b!.hasAttribute('inert')).toBe(false)
  })

  it.each(['manual', 'click', 'load'])('completes under reduced motion with no animation even before %s activation', async (activation) => {
    document.body.innerHTML = `<div data-kui="flip-reorder leave:fade 300ms on:${activation}"><i>a</i><i>b</i></div>`
    const host = el()
    box(host, () => 0)
    for (const row of [...host.children]) box(row, () => [...host.children].indexOf(row) * 40)
    const animate = vi.fn(() => { throw new Error('no motion allowed') })
    for (const node of [host, ...host.children] as HTMLElement[]) node.animate = animate
    const app = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: { ...CAPS, reducedMotion: true },
      binder: createActivationBinder({ createObserver: undefined }), scheduler: idleScheduler, rootResolver: () => fakeRoot })
    const done = vi.fn((event: Event) => (event.target as Element).remove())
    host.addEventListener('kui:leave-end', done)
    app.start()
    host.firstElementChild!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(done).toHaveBeenCalledOnce()
    expect(host.children).toHaveLength(1)
    expect(animate).not.toHaveBeenCalled()
    app.destroy()
  })

  it('ignores nested marks and plain hosts, and falls back without WAAPI', async () => {
    const app = build('<div data-kui="flip-reorder leave:fade"><i inert style="width: 12px"><b></b></i></div>')
    const row = el().firstElementChild! as HTMLElement
    const done = vi.fn()
    row.addEventListener('kui:leave-end', done)
    app.start()
    row.firstElementChild!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(done).not.toHaveBeenCalled()
    row.setAttribute('data-kui-leaving', '')
    await flush()
    expect(done).toHaveBeenCalledOnce()
    app.destroy()
    expect(row.style.width).toBe('12px')
    expect(row.hasAttribute('inert')).toBe(true)
    const plain = build('<div data-kui="flip-reorder"><i></i></div>')
    plain.start()
    el().firstElementChild!.setAttribute('data-kui-leaving', '')
    await flush()
    expect(el().style.position).toBe('')
    expect(el().firstElementChild!.hasAttribute('style')).toBe(false)
    plain.destroy()
  })

  it.each(['scroll', 'resize', 'timeout'])('settles bounded departures on %s and restores on teardown', async (event) => {
    vi.useFakeTimers()
    const app = build('<div data-kui="flip-reorder leave:fade 300ms"><i></i></div>')
    const row = el().firstElementChild! as HTMLElement
    const run = animation(row)
    const done = vi.fn()
    row.addEventListener('kui:leave-end', done)
    app.start()
    row.setAttribute('data-kui-leaving', '')
    await flush()
    if (event === 'timeout') vi.advanceTimersByTime(350)
    else window.dispatchEvent(new Event(event))
    await flush()
    expect(done).toHaveBeenCalledOnce()
    expect(run.cancel).toHaveBeenCalled()
    app.destroy()
    expect(row.getAttribute('style')).toBeNull()
  })
})
