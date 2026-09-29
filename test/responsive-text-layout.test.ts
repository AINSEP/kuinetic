// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { frameScheduler, watchElementSize } from '../src/core/element-size.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'
import { catalogRegistry } from './support/registry.js'

const source = 'alpha bravo charlie delta echo foxtrot'
const words = source.split(' ')
const css = readFileSync('src/css/text.css', 'utf8')
const split = catalogRegistry().resolve('text-reveal-mask')!.primitive
const indicator = LAYOUT_PRIMITIVES.find((item) => item.id === 'flip-indicator')!

class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = []
  readonly observed = new Set<Element>()
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(element: Element): void { this.observed.add(element) }
  unobserve(element: Element): void { this.observed.delete(element) }
  fire(): void { this.callback([], this as unknown as ResizeObserver) }
}

function context(el: Element): PrepareContext {
  return {
    win: window,
    doc: document,
    style: createStyleLedger(el),
    warn: vi.fn(),
  } as unknown as PrepareContext
}

function lineWords(el: Element): string[] {
  return Array.from(el.querySelectorAll('.kui-split-line > span'), (word) => word.textContent!)
}

function makeText(): {
  el: HTMLElement
  setWordsPerLine(count: number): void
  setWidth(width: number): void
  reads(): number
} {
  const el = document.createElement('p')
  el.textContent = source
  document.body.append(el)
  let width = 360
  let wordsPerLine = 3
  let offsetReads = 0
  el.getBoundingClientRect = () => ({ width, height: 60 }) as DOMRect
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      offsetReads++
      const siblings = Array.from(this.parentElement?.children ?? [])
      return Math.floor(siblings.indexOf(this) / wordsPerLine) * 20
    },
  })
  return {
    el,
    setWordsPerLine(count) { wordsPerLine = count },
    setWidth(next) { width = next },
    reads() { return offsetReads },
  }
}

function activateLines(el: HTMLElement) {
  const instance = split.prepare!(
    el,
    createParams({ unit: 'lines', direction: 'mask', duration: '100ms', stagger: '10ms' }),
    context(el),
  )
  instance.activate()
  return instance
}

describe('responsive split lines and flip indicator', () => {
  const originalRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
  const originalCancelRaf = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')

  beforeEach(() => {
    vi.useFakeTimers()
    FakeResizeObserver.instances.length = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16),
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => window.clearTimeout(id),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
    if (originalRaf) Object.defineProperty(window, 'requestAnimationFrame', originalRaf)
    else Reflect.deleteProperty(window, 'requestAnimationFrame')
    if (originalCancelRaf) Object.defineProperty(window, 'cancelAnimationFrame', originalCancelRaf)
    else Reflect.deleteProperty(window, 'cancelAnimationFrame')
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
    if (originalOffsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop)
  })

  it('unobserves a removed size target and keeps the remaining target live', () => {
    const changed = vi.fn()
    const watch = watchElementSize(window, changed)
    const first = document.createElement('div')
    const second = document.createElement('div')
    watch.observe(first)
    watch.observe(second)
    const observer = FakeResizeObserver.instances.at(-1)!
    expect(observer.observed.has(first)).toBe(true)
    watch.unobserve(first)
    expect(observer.observed.has(first)).toBe(false)
    expect(observer.observed.has(second)).toBe(true)
    watch.observe(first)
    expect(observer.observed.has(first)).toBe(true)
    observer.fire()
    expect(changed).toHaveBeenCalledOnce()
    watch.disconnect()
  })

  it('schedules a size notification with a timer when animation frames are unavailable', () => {
    Reflect.deleteProperty(window, 'requestAnimationFrame')
    const changed = vi.fn()
    const scheduler = frameScheduler(window, changed)
    scheduler.request()
    vi.advanceTimersByTime(15)
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(changed).toHaveBeenCalledOnce()
    scheduler.cancel()
  })

  it('uses window resizing when ResizeObserver is unavailable and cancels a pending timer', () => {
    Reflect.deleteProperty(window, 'ResizeObserver')
    Reflect.deleteProperty(window, 'requestAnimationFrame')
    const changed = vi.fn()
    const watch = watchElementSize(window, changed)
    const element = document.createElement('div')
    watch.observe(element)
    watch.observe(element)
    window.dispatchEvent(new Event('resize'))
    expect(changed).toHaveBeenCalledOnce()
    const scheduler = frameScheduler(window, changed)
    scheduler.request()
    scheduler.cancel()
    vi.advanceTimersByTime(16)
    expect(changed).toHaveBeenCalledOnce()
    watch.disconnect()
  })

  it('cancels a pending animation frame before its size notification', () => {
    const changed = vi.fn()
    const scheduler = frameScheduler(window, changed)
    scheduler.request()
    scheduler.cancel()
    vi.advanceTimersByTime(16)
    expect(changed).not.toHaveBeenCalled()
  })

  it('retains the mask preset cloak and reduced-motion policy', () => {
    expect(catalogRegistry().resolve('text-reveal-mask')?.preset.cloak).toBe(true)
    expect(split.reducedMotion).toBe('disable')
  })

  it('re-buckets vertical text when its inline height changes', () => {
    const { el, setWordsPerLine } = makeText()
    el.style.writingMode = 'vertical-rl'
    el.style.paddingBlockStart = '10px'
    el.style.paddingBlockEnd = '5px'
    let height = 100
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
    const instance = activateLines(el)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(2)
    el.style.paddingBlockStart = '20px'
    setWordsPerLine(2)
    FakeResizeObserver.instances[0]!.fire()
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(3)
    height = 200
    setWordsPerLine(3)
    FakeResizeObserver.instances[0]!.fire()
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(2)
    expect(lineWords(el)).toEqual(words)
    instance.destroy()
  })

  it('re-buckets a finished mask on inline resize, retaining every word and no settled animation', async () => {
    const { el, setWidth, setWordsPerLine } = makeText()
    const instance = activateLines(el)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(2)
    vi.advanceTimersByTime(130)
    await expect(instance.finished).resolves.toBeUndefined()
    expect(el.textContent).toBe(source)
    expect(el.querySelector('.kui-sr-only')).toBeNull()
    expect(el.querySelector('.kui-split-decorative')?.getAttribute('aria-hidden')).toBeNull()
    el.setAttribute('data-kui-state', 'finished')
    setWordsPerLine(2)
    FakeResizeObserver.instances[0]!.fire()
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(2)
    setWidth(220)
    FakeResizeObserver.instances[0]!.fire()
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(3)
    expect(lineWords(el)).toEqual(words)
    expect(el.querySelector('.kui-split-decorative')?.textContent).toBe(source)
    expect(el.textContent).toBe(source)
    expect(Array.from(el.querySelectorAll('.kui-split-line'), (line) =>
      (line as HTMLElement).style.getPropertyValue('--kui-i'))).toEqual(['0', '1', '2'])
    expect(css).toMatch(/\[data-kui-state='finished'\] > \[data-kui-split-fx\] \.kui-split-line \{[^}]*animation-name: none;[^}]*clip-path: none;/)
    instance.destroy()
  })

  it('replays line animations after a completed run', async () => {
    const { el } = makeText()
    const instance = activateLines(el)
    vi.advanceTimersByTime(130)
    await expect(instance.finished).resolves.toBeUndefined()
    el.setAttribute('data-kui-state', 'finished')
    for (let tick = 0; tick < 4; tick++) await Promise.resolve()
    el.setAttribute('data-kui-state', 'running')
    instance.activate()
    expect(FakeResizeObserver.instances[0]!.disconnect).toHaveBeenCalledOnce()
    expect(FakeResizeObserver.instances).toHaveLength(2)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(2)
    expect(lineWords(el)).toEqual(words)
    expect(el.matches("[data-kui-state='finished']")).toBe(false)
    instance.destroy()
  })

  it('re-buckets mid-reveal without losing words and settles after the new stagger', async () => {
    const { el, setWidth, setWordsPerLine, reads } = makeText()
    const instance = activateLines(el)
    vi.advanceTimersByTime(40)
    const beforeResize = reads()
    setWidth(180)
    setWordsPerLine(1)
    FakeResizeObserver.instances[0]!.fire()
    FakeResizeObserver.instances[0]!.fire()
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(6)
    expect(reads() - beforeResize).toBe(words.length)
    expect(lineWords(el)).toEqual(words)
    vi.advanceTimersByTime(150)
    await expect(instance.finished).resolves.toBeUndefined()
    el.setAttribute('data-kui-state', 'finished')
    expect(el.matches("[data-kui-state='finished']")).toBe(true)
    instance.destroy()
  })

  it('re-buckets after fonts.ready and ignores a font completion after destroy', async () => {
    let resolveFonts!: () => void
    const ready = new Promise<void>((resolve) => { resolveFonts = resolve })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready } })
    const { el, setWordsPerLine } = makeText()
    const instance = activateLines(el)
    setWordsPerLine(2)
    resolveFonts()
    await ready
    vi.advanceTimersByTime(16)
    expect(el.querySelectorAll('.kui-split-line')).toHaveLength(3)
    expect(lineWords(el)).toEqual(words)
    instance.destroy()
    expect(FakeResizeObserver.instances[0]!.disconnect).toHaveBeenCalledOnce()

    let resolveLate!: () => void
    const late = new Promise<void>((resolve) => { resolveLate = resolve })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready: late } })
    const second = activateLines(el)
    const observer = FakeResizeObserver.instances.at(-1)!
    second.destroy()
    resolveLate()
    await late
    vi.advanceTimersByTime(16)
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(el.querySelector('.kui-split-line')).toBeNull()
    expect(el.textContent).toBe(source)
  })

  it('settles lines only when the split host itself is finished, not a finished ancestor', () => {
    // A mask reveal nested in a `fade-up` section: the section finishes first, and a descendant
    // selector let its `data-kui-state="finished"` cancel the lede's still-delayed line reveal.
    const settled = /^\s*(\[data-kui-state='finished'\][^{}\n]*)\{\s*animation-name: none;\s*opacity: 1;\s*clip-path: none;/m.exec(css)![1]!.trim()
    const section = document.createElement('article')
    section.setAttribute('data-kui-state', 'finished')
    document.body.append(section)
    const { el } = makeText()
    section.append(el)
    el.setAttribute('data-kui-state', 'running')
    const instance = activateLines(el)
    const line = el.querySelector('.kui-split-line')!
    expect(line.matches(settled)).toBe(false)
    el.setAttribute('data-kui-state', 'finished')
    expect(line.matches(settled)).toBe(true)
    instance.destroy()
    section.remove()
  })

  it('restores authored children and disconnects on teardown', () => {
    const { el } = makeText()
    el.innerHTML = ' alpha <em>bravo</em> charlie '
    const html = el.innerHTML
    const child = el.querySelector('em')
    const instance = activateLines(el)
    instance.destroy()
    expect(el.innerHTML).toBe(html)
    expect(el.querySelector('em')).toBe(child)
    expect(FakeResizeObserver.instances[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('moves flip-indicator on target resize without an attribute change and disconnects', () => {
    const container = document.createElement('div')
    const el = document.createElement('div')
    const target = document.createElement('button')
    target.id = 'followed'
    container.append(el, target)
    document.body.append(container)
    let left = 50
    let width = 80
    let indicatorLeft = 0
    el.getBoundingClientRect = () => ({ left: indicatorLeft, width: 10, top: 0, height: 4 }) as DOMRect
    target.getBoundingClientRect = () => ({ left, width, top: 0, height: 30 }) as DOMRect
    const style = {
      set: vi.fn((property: string, value: string) => {
        if (property === 'translate') indicatorLeft = parseFloat(value)
      }),
      claim: vi.fn(), restore: vi.fn(), owned: () => [],
    }
    const ctx = { ...context(el), style } as unknown as PrepareContext
    const instance = indicator.prepare!(el, createParams({ follow: '#followed', attribute: 'aria-selected' }), ctx)
    instance.activate()
    const observer = FakeResizeObserver.instances[0]!
    expect(observer.observed.has(container)).toBe(true)
    expect(observer.observed.has(target)).toBe(true)
    left = 90
    width = 120
    observer.fire()
    vi.advanceTimersByTime(16)
    expect(style.set).toHaveBeenCalledWith('width', '120px')
    expect(style.set).toHaveBeenCalledWith('translate', '90px 0')
    instance.destroy()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })

  it('moves the size watch from the old tab to the newly selected one', async () => {
    const container = document.createElement('div')
    const el = document.createElement('div')
    const first = document.createElement('button')
    const second = document.createElement('button')
    first.setAttribute('aria-selected', 'true')
    second.setAttribute('aria-selected', 'false')
    container.append(el, first, second)
    document.body.append(container)
    el.getBoundingClientRect = () => ({ left: 0, width: 10, top: 0, height: 4 }) as DOMRect
    first.getBoundingClientRect = () => ({ left: 0, width: 80, top: 0, height: 30 }) as DOMRect
    second.getBoundingClientRect = () => ({ left: 90, width: 60, top: 0, height: 30 }) as DOMRect
    const style = { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] }
    const ctx = { ...context(el), style } as unknown as PrepareContext
    const instance = indicator.prepare!(
      el,
      createParams({ follow: "[aria-selected='true']", attribute: 'aria-selected' }),
      ctx,
    )
    instance.activate()
    const observer = FakeResizeObserver.instances[0]!
    expect(observer.observed.has(first)).toBe(true)
    expect(observer.observed.has(second)).toBe(false)

    first.setAttribute('aria-selected', 'false')
    second.setAttribute('aria-selected', 'true')
    await Promise.resolve()

    // A resize of the old tab must no longer move the bar; the new tab's must.
    expect(observer.observed.has(first)).toBe(false)
    expect(observer.observed.has(second)).toBe(true)
    expect(observer.observed.has(container)).toBe(true)
    instance.destroy()
  })
})
