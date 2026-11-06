// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { animatorOverBody, CAPS } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'

let animator: Animator | undefined
let host: HTMLElement
let slides: HTMLElement[]
let widths: number[]
let viewport: number
let reads: ReturnType<typeof vi.fn>
let resize: (() => void) | undefined
let observed: Element[]
let cssWrites: MockInstance<CSSStyleDeclaration['setProperty']>
const reduced = CAPS.reducedMotion
const nativeSetProperty = CSSStyleDeclaration.prototype.setProperty
const number = (node: HTMLElement, name: string): number => parseFloat(node.style.getPropertyValue(name))
const x = (): number => number(host, '--kui-row-x')
const cycle = (i: number): number => number(slides[i]!, '--kui-row-cycle')
const centres = (): number[] => widths.map((width, i) => widths.slice(0, i).reduce((sum, w) => sum + w + 20, 0) + width / 2)
const visual = (): number[] => centres().map((centre, i) => centre + x() + cycle(i))
const period = (): number => widths.reduce((sum, w) => sum + w + 20, 0)

function pointer(type: string, clientX: number, clientY = 0): Event {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX, clientY, pointerId: 1 })
  host.dispatchEvent(event)
  return event
}
function key(key: string): void {
  host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}
function mount(effect = 'carousel-loop', sizes = [100, 200, 140, 180], windowWidth = 300, beforeStart?: () => void): ReturnType<typeof collectingReporter> {
  widths = sizes
  viewport = windowWidth
  const links = sizes.map((_, i) => `<a href="#slide-${i}"><span>${i}</span></a>`).join('')
  document.body.innerHTML = `<div data-kui="${effect}" style="gap:20px">${links}</div>`
  host = document.body.firstElementChild as HTMLElement
  slides = [...host.children] as HTMLElement[]
  Object.defineProperty(host, 'offsetWidth', { get: () => { reads(); return viewport }, configurable: true })
  slides.forEach(stubSlide)
  beforeStart?.()
  const reporter = collectingReporter()
  animator = animatorOverBody(reporter)
  animator.start()
  return reporter
}

function stubSlide(slide: HTMLElement): void {
  Object.defineProperty(slide, 'offsetLeft', {
    get: () => { reads(); return widths.slice(0, slides.indexOf(slide)).reduce((sum, width) => sum + width + 20, 0) },
    configurable: true,
  })
  Object.defineProperty(slide, 'offsetWidth', {
    get: () => { reads(); return widths[slides.indexOf(slide)]! },
    configurable: true,
  })
}

function expectCoverage(): void {
  const boxes = visual().map((centre, i) => [centre - widths[i]! / 2, centre + widths[i]! / 2])
    .filter(([left, right]) => right! > 0 && left! < viewport).sort((a, b) => a[0]! - b[0]!)
  expect(boxes.length).toBeGreaterThan(0)
  expect(boxes[0]![0]).toBeLessThanOrEqual(20.001)
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]! - boxes[i - 1]![1]!).toBeCloseTo(20, 3)
  expect(viewport - boxes.at(-1)![1]!).toBeLessThanOrEqual(20.001)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
  reads = vi.fn()
  cssWrites = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
  observed = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe(node: Element) { observed.push(node) }
    unobserve(node: Element) { observed = observed.filter(element => element !== node) }
    disconnect() { observed = [] }
  })
})
afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  CAPS.reducedMotion = reduced
  document.body.replaceChildren()
})

describe('mixed-width flex loop', () => {
  it('centres measured anchors with several visible slides, and observes every box', () => {
    expect(mount().messages).toEqual([])
    expect(host.getAttribute('data-kui-row-static')).toBe('false')
    expect(visual()).toEqual([150, 320, -190, -10])
    expect(observed).toEqual([host, ...slides])
    expect(cssWrites).toHaveBeenCalledWith('touch-action', 'pan-y')
    expect(slides.every(slide => !slide.hasAttribute('inert'))).toBe(true)
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it.each([1, -1])('crosses the last/first seam without rewind in direction %s', direction => {
    mount()
    const read = window.getComputedStyle.bind(window)
    const committed: number[][] = []
    const commit = vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
      const i = slides.indexOf(node as HTMLElement)
      committed.push([i, centres()[i]! + x() + cycle(i)])
      return read(node)
    })
    let previous = visual()
    let previousX = x()
    for (let step = 0; step < 8; step++) {
      reads.mockClear()
      key(direction > 0 ? 'ArrowRight' : 'ArrowLeft')
      expect(reads).not.toHaveBeenCalled()
      const current = visual()
      const delta = x() - previousX
      expect(Math.sign(delta)).toBe(-direction)
      expect(Math.abs(delta)).toBeLessThan(220)
      current.forEach((value, i) => {
        const moved = value - previous[i]!
        if (Math.abs(moved - delta) < 0.01) return
        expect(Math.abs(moved - delta)).toBe(period())
        expect(Math.abs(previous[i]! - viewport / 2), JSON.stringify({ step, i, previous, current, delta })).toBeGreaterThan((viewport + widths[i]!) / 2)
        expect(Math.abs(value - delta - viewport / 2)).toBeGreaterThan((viewport + widths[i]!) / 2)
      })
      previous = current
      previousX = x()
    }
    expect(commit).toHaveBeenCalled()
    for (const [i, centre] of committed) {
      expect(Math.abs(centre! - viewport / 2)).toBeGreaterThan((viewport + widths[i!]!) / 2)
    }
    expect(slides.every(slide => !slide.hasAttribute('data-kui-ring-wrap'))).toBe(true)
  })

  it('maps mixed-width drag pixels exactly through a mid-drag wrap and snaps without coast', () => {
    mount()
    pointer('pointerdown', 0)
    pointer('pointermove', -40)
    reads.mockClear()
    const writes = vi.spyOn(host, 'setAttribute')
    const styleWrites = slides.map(slide => vi.spyOn(slide.style, 'setProperty'))
    const initial = x()
    pointer('pointermove', -50)
    pointer('pointermove', -60)
    expect(x()).toBeCloseTo(initial - 20)
    expect(writes.mock.calls.some(([name]) => name === 'data-kui-step')).toBe(false)
    expect(styleWrites.every(spy => spy.mock.calls.length === 0)).toBe(true)
    for (const distance of [160, 320, 480, 650, 710, 760]) {
      pointer('pointermove', -distance)
      expect(x()).toBeCloseTo(100 - distance)
    }
    expect(number(host, '--kui-step-position')).toBeCloseTo(0.3529, 4)
    expect(reads).not.toHaveBeenCalled()
    pointer('pointerdown', 0)
    pointer('pointermove', -20)
    expect(x()).toBeCloseTo(100 - 780)
    expect(number(host, '--kui-step-position')).toBeCloseTo(0.4706, 4)
    pointer('pointerup', -20)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    expect(x()).toBeCloseTo(100 - period())
  })

  it('remeasures on resize, preserves the place, and leaves frames free of measurements', () => {
    mount()
    key('ArrowRight')
    widths = [180, 240, 100, 200]
    viewport = 320
    reads.mockClear()
    resize!()
    expect(reads).toHaveBeenCalled()
    expect(visual()[1]).toBe(160)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    reads.mockClear()
    key('ArrowRight')
    expect(visual()[2]).toBe(160)
    expect(reads).not.toHaveBeenCalled()
  })

  it.each([
    { sizes: [], staysStatic: true },
    { sizes: [180], staysStatic: true },
    { sizes: [100, 140], staysStatic: true },
    { sizes: [100, 200, 140, 180], staysStatic: false },
  ])('keeps an undersized row static and recovers after resize: $sizes', ({ sizes, staysStatic }) => {
    mount('carousel-loop', sizes, 1200)
    expect(host.getAttribute('data-kui-row-static')).toBe('true')
    key('ArrowRight')
    pointer('pointerdown', 0)
    pointer('pointermove', -100)
    expect(x()).toBe(0)
    expect(slides.every((_, i) => cycle(i) === 0)).toBe(true)
    expect(cssWrites).toHaveBeenCalledWith('touch-action', 'auto')
    pointer('pointerup', -100)
    host.scrollLeft = 30
    viewport = 100
    window.dispatchEvent(new Event('resize'))
    expect(host.getAttribute('data-kui-row-static')).toBe(String(staysStatic))
    if (host.getAttribute('data-kui-row-static') === 'false') expect(host.scrollLeft).toBe(0)
  })

  it('keeps a zero-size hidden row finite and remeasures before enabling motion', () => {
    mount('carousel-loop', [0, 0, 0, 0], 0)
    key('ArrowRight')
    expect(x()).toBe(0)
    expect(host.getAttribute('data-kui-row-static')).toBe('true')
    widths = [100, 200, 140, 180]
    viewport = 300
    resize!()
    expect(host.getAttribute('data-kui-row-static')).toBe('false')
    expect(visual()[1]).toBe(150)
  })

  it('keeps a single zero-width slide finite', () => {
    mount('carousel-loop', [0], 0)
    key('ArrowRight')
    expect(x()).toBe(0)
    expect(cycle(0)).toBe(0)
  })

  it.each([1, -1])('keeps a 390px viewport covered through continuous mixed-width recycling in direction %s', direction => {
    mount('carousel-loop', [80, 260, 120, 200, 100], 390)
    expect(host.getAttribute('data-kui-row-static')).toBe('false')
    pointer('pointerdown', 0)
    for (let distance = 17; distance < period() * 2; distance += 17) {
      pointer('pointermove', -direction * distance)
      expect(x()).toBeCloseTo(viewport / 2 - widths[0]! / 2 - direction * distance)
      expectCoverage()
    }
  })

  it('preserves link presses and vertical panning, and suppresses only a completed drag click', () => {
    mount()
    const capture = vi.fn()
    host.setPointerCapture = capture
    const link = slides[0]!
    const click = (): boolean => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    pointer('pointerdown', 0)
    pointer('pointerup', 0)
    expect(capture).not.toHaveBeenCalled()
    expect(click()).toBe(true)
    pointer('pointerdown', 0)
    expect(pointer('pointermove', 0, 100).defaultPrevented).toBe(false)
    pointer('pointerup', 0, 100)
    expect(capture).not.toHaveBeenCalled()
    pointer('pointerdown', 0)
    pointer('pointermove', -50)
    pointer('pointerup', -50)
    expect(capture).toHaveBeenCalled()
    expect(click()).toBe(false)
    pointer('pointerdown', 0)
    pointer('pointerup', 0)
    expect(click()).toBe(true)
  })

  it.each(['spin:4s', 'spin:-4s'])('spins through geometry without measuring and cleans up during drag: %s', option => {
    mount(`carousel-loop ${option}`)
    reads.mockClear()
    vi.advanceTimersByTime(1600)
    expect(reads).not.toHaveBeenCalled()
    expect(Math.abs(x() - 100)).toBeGreaterThan(50)
    pointer('pointerdown', 0)
    pointer('pointermove', -40)
    const beforeDestroy = host
    animator!.destroy()
    animator = undefined
    expect(beforeDestroy.getAttribute('style')).toBe('gap: 20px;')
    expect(beforeDestroy.hasAttribute('data-kui-row-static')).toBe(false)
    expect(slides.every(slide => !slide.hasAttribute('style'))).toBe(true)
    expect(observed).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honours reduced motion by pausing automatic motion while preserving manual navigation', () => {
    CAPS.reducedMotion = true
    mount('carousel-loop spin:4s autoplay:2s')
    const initial = x()
    vi.advanceTimersByTime(3000)
    expect(x()).toBe(initial)
    key('ArrowRight')
    expect(visual()[1]).toBe(150)
    expect(host.hasAttribute('data-kui-rm')).toBe(true)
  })
})

it.each(['carousel-loop', 'carousel-loop target:a', 'carousel-loop grab:false', 'carousel-loop spin:4s', 'carousel-loop autoplay:2s timer:true'])('round 6 markup compiles with zero warnings and publishes row geometry: %s', effect => {
  expect(mount(effect).messages).toEqual([])
  expect(Number.isFinite(x())).toBe(true)
})

it.each(['carousel-3d', 'carousel-stack'])('preserves the existing composed %s deck without any row output', effect => {
  expect(mount(`tween y:10px, ${effect}`).messages).toEqual([])
  key('ArrowRight')
  expect(host.getAttribute('data-kui-step')).toBe('1')
  expect(host.style.getPropertyValue('--kui-row-x')).toBe('')
  expect(slides.every(slide => !slide.style.getPropertyValue('--kui-row-cycle'))).toBe(true)
})

describe('round 6 review regressions', () => {
  const wideSlides = [160, 200, 180, 240, 160, 200, 180, 240]

  function recordRowWrites(): boolean[] {
    const flags: boolean[] = []
    cssWrites.mockImplementation(function (this: CSSStyleDeclaration, name, value, priority) {
      if (this === host.style && name === '--kui-row-x') flags.push(host.getAttribute('data-kui-ring-wrap') === 'true')
      nativeSetProperty.call(this, name, value, priority)
    })
    return flags
  }

  it('commits initial, resize and late-size translations with transitions suspended', () => {
    const flags = recordRowWrites()
    mount()
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every(Boolean)).toBe(true)
    flags.length = 0
    viewport = 280
    resize!()
    widths[1] = 220
    resize!()
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every(Boolean)).toBe(true)
    expect(host.hasAttribute('data-kui-ring-wrap')).toBe(false)
  })

  it('centres only keyboard-visible focus, and removes the focus listener on teardown', () => {
    mount()
    const slide = slides[2]!
    const visible = vi.spyOn(slide, 'matches').mockReturnValue(false)
    const initial = x()
    slide.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(x()).toBe(initial)
    visible.mockReturnValue(true)
    slide.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('2')
    expect(visual()[2]).toBe(viewport / 2)
    vi.spyOn(host, 'matches').mockReturnValue(true)
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('2')
    animator!.destroy()
    animator = undefined
    slide.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(host.style.getPropertyValue('--kui-row-x')).toBe('')
  })

  it.each(['Home', 'End', 'jump'])('arrives without a blank or overlaps after a long %s move', action => {
    mount('carousel-loop target:a jump:.jump', [...wideSlides], 1000, () => {
      const buttons = wideSlides.map((_, i) => `<button class="jump">${i}</button>`).join('')
      document.body.insertAdjacentHTML('beforeend', buttons)
    })
    for (let step = 0; step < 4; step++) key('ArrowRight')
    const flags = recordRowWrites()
    if (action === 'jump') document.querySelector<HTMLButtonElement>('.jump')!.click()
    else key(action)
    expectCoverage()
    expect(flags).toEqual([true])
  })

  it.each(['ArrowRight', 'ArrowLeft'])('measures and observes an added slide before moving %s', direction => {
    mount('carousel-loop target:a', [...wideSlides], 800)
    const added = document.createElement('a')
    added.href = '#added'
    host.append(added)
    slides.push(added)
    widths.push(200)
    stubSlide(added)
    key(direction)
    expect(host.style.getPropertyValue('--kui-item-count')).toBe('9')
    expect(Number.isFinite(cycle(8))).toBe(true)
    expect(observed).toContain(added)
    expectCoverage()
    const replacement = document.createElement('a')
    slides[3]!.replaceWith(replacement)
    slides[3] = replacement
    stubSlide(replacement)
    key(direction)
    expect(observed).toContain(replacement)
    expect(Number.isFinite(cycle(3))).toBe(true)
    expectCoverage()
  })

  it.each(['ArrowRight', 'ArrowLeft'])('refreshes removed slides and observes the remaining set before moving %s', direction => {
    mount('carousel-loop target:a', [...wideSlides], 800)
    const removed = direction === 'ArrowRight' ? slides.shift()! : slides.pop()!
    if (direction === 'ArrowRight') widths.shift()
    else widths.pop()
    removed.remove()
    resize!()
    key(direction)
    expect(host.style.getPropertyValue('--kui-item-count')).toBe('7')
    expect(host.getAttribute('data-kui-row-static')).toBe('false')
    expect(observed).not.toContain(removed)
    expectCoverage()
  })

  it('warns once for a negative measured RTL period and stays static', () => {
    const reporter = mount('carousel-loop', [100, 200, 140, 180], 300, () => {
      host.dir = 'rtl'
      slides.forEach((slide, i) => Object.defineProperty(slide, 'offsetLeft', { get: () => 600 - i * 220 }))
    })
    resize!()
    resize!()
    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toMatch(/carousel-loop.*RTL/)
    expect(x()).toBe(0)
  })

  it.each([300, 1200])('restores the authored scroll position after a loop or static strip (%s)', windowWidth => {
    mount('carousel-loop', [100, 200, 140, 180], windowWidth, () => { host.scrollLeft = 70 })
    host.scrollLeft = 30
    animator!.destroy()
    animator = undefined
    expect(host.scrollLeft).toBe(70)
  })
})
