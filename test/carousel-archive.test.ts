// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { createActivationBinder } from '../src/core/activation.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { fakeRoot, fakeScheduler } from './support/scroll-mechanics-harness.js'
import { catalogRegistry } from './support/registry.js'

const LAB = 'carousel-loop shape:line attribute:data-layout rise:-60px depth:120px perspective:1000px yaw:-25deg'
/** Every card is 200 tall with a 20px row gap, unless a test says otherwise. */
const STRIDE = 220
const FLIGHT_MS = 620 + 12 * 24

let animator: Animator | undefined
let scheduler: ReturnType<typeof fakeScheduler>

interface Mount { layout?: string; count?: number; heights?: number[]; reducedMotion?: boolean; after?: string; slide?: string; style?: string }
function mount(effect: string, { layout = 'line', count = 12, heights, reducedMotion = false, after = '', slide = '<a href="#art"><img alt="Art"></a>', style = 'row-gap:20px' }: Mount = {}) {
  document.body.innerHTML = `<div data-kui="${effect}" data-layout="${layout}" style="${style}">${slide.repeat(count)}</div>${after}`
  const host = document.body.firstElementChild as HTMLElement
  Object.defineProperty(host, 'offsetWidth', { value: 600 })
  host.getBoundingClientRect = () => ({ top: 0, left: 0, width: 600, height: 400 }) as DOMRect
  ;[...host.children].forEach((child, i) => {
    Object.defineProperty(child, 'offsetLeft', { value: i * 180 })
    Object.defineProperty(child, 'offsetWidth', { value: 160 })
    Object.defineProperty(child, 'offsetHeight', { value: heights?.[i] ?? 200 })
  })
  scheduler = fakeScheduler()
  const reporter = collectingReporter()
  animator = new Animator({ root: document.body, registry: catalogRegistry(), scheduler, reporter, rootResolver: () => fakeRoot,
    capabilities: defaultCapabilities({ individualTransforms: true, scrollTimeline: false, reducedMotion }),
    binder: createActivationBinder({ createObserver: undefined }) })
  animator.start()
  return { host, reporter }
}
const variable = (node: Element, name: string): string => (node as HTMLElement).style.getPropertyValue(name)
const columnY = (host: HTMLElement): number => parseFloat(variable(host, '--kui-column-y'))
const step = (host: HTMLElement): number => Number(host.getAttribute('data-kui-step'))
const press = (host: HTMLElement, key: string): boolean => host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
function pointer(host: HTMLElement, type: string, clientX: number, clientY: number): void {
  host.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX, clientY, pointerId: 1 }))
}
/** The observer's callback is queued when the attribute changes, so one awaited tick follows it. */
async function arrange(host: HTMLElement, value: string): Promise<void> {
  host.setAttribute('data-layout', value)
  await Promise.resolve()
}
const linePlace = (host: HTMLElement, node: Element): number =>
  parseFloat(variable(node, '--kui-row-centre')) + parseFloat(variable(node, '--kui-row-cycle')) +
  parseFloat(variable(host, '--kui-row-x')) - 300

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }))
afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('places a column from real heights and the row gap, with the live card at the origin', () => {
  const { host, reporter } = mount(LAB, { layout: 'column', count: 6, heights: [100, 200, 300, 100, 100, 100] })
  expect(reporter.messages).toEqual([])
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('column')
  const places = [...host.children].map(child => parseFloat(variable(child, '--kui-column-place')))
  expect(places).toEqual([0, 170, 440, 660, 780, 900])
  expect(columnY(host)).toBe(0)
  press(host, 'ArrowDown')
  expect(columnY(host)).toBe(170)
})

it('places a column with no gap when the host declares no row-gap', () => {
  const { host } = mount(LAB, { layout: 'column', count: 3, style: '' })
  expect(variable(host.children[1]!, '--kui-column-place')).toBe('200px')
})

it('keeps the live card through a switch both ways, ranks the flight by distance, then ends it', async () => {
  const { host } = mount(LAB)
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('line')
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  for (let i = 0; i < 3; i++) press(host, 'ArrowRight')
  expect(variable(host, '--kui-row-x')).toBe('-320px')
  await arrange(host, 'column')
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('column')
  expect(step(host)).toBe(3)
  expect(columnY(host)).toBe(3 * STRIDE)
  expect(host.getAttribute('data-kui-row-flight')).toBe('true')
  expect(variable(host.children[0]!, '--kui-flight-rank')).toBe('3')
  expect(variable(host.children[3]!, '--kui-flight-rank')).toBe('0')
  expect(variable(host.children[11]!, '--kui-flight-rank')).toBe('8')
  vi.advanceTimersByTime(FLIGHT_MS - 1)
  expect(host.getAttribute('data-kui-row-flight')).toBe('true')
  vi.advanceTimersByTime(1)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  await arrange(host, 'line')
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('line')
  expect(step(host)).toBe(3)
  expect(host.getAttribute('data-kui-row-flight')).toBe('true')
  expect(variable(host, '--kui-row-x')).toBe('-320px')
})

it('resolves no style between the attribute and the new transforms, so the flight starts from the picture', async () => {
  const { host } = mount(LAB)
  const styles = vi.spyOn(window, 'getComputedStyle')
  await arrange(host, 'column')
  // A far card is about to be recycled on arrival: on an ordinary step that commits a style.
  press(host, 'End')
  await arrange(host, 'line')
  expect(styles).not.toHaveBeenCalled()
})

it('arrives on the nearest turn of the line after the column moved far, with no card left a cycle away', async () => {
  const { host } = mount(LAB)
  await arrange(host, 'column')
  press(host, 'End')
  expect(step(host)).toBe(11)
  await arrange(host, 'line')
  expect(step(host)).toBe(11)
  for (const card of host.children) expect(Math.abs(linePlace(host, card))).toBeLessThanOrEqual(1080)
  expect(linePlace(host, host.children[11]!)).toBe(0)
})

it('stops at the real ends of the column for every key, and still loops on the line', async () => {
  const { host } = mount(LAB, { layout: 'column' })
  press(host, 'ArrowUp')
  expect(step(host)).toBe(0)
  press(host, 'ArrowLeft')
  expect(step(host)).toBe(0)
  press(host, 'End')
  expect(step(host)).toBe(11)
  expect(columnY(host)).toBe(11 * STRIDE)
  press(host, 'ArrowDown')
  press(host, 'PageDown')
  expect(step(host)).toBe(11)
  expect(columnY(host)).toBe(11 * STRIDE)
  press(host, 'Home')
  expect(step(host)).toBe(0)
  await arrange(host, 'line')
  press(host, 'ArrowLeft')
  expect(step(host)).toBe(11)
  press(host, 'ArrowRight')
  expect(step(host)).toBe(0)
})

it('clamps next: and prev: controls in the column', () => {
  const { host } = mount(`${LAB} next:.more prev:.less`, { layout: 'column', count: 6,
    after: '<button class="more">More</button><button class="less">Less</button>' })
  const more = document.querySelector<HTMLButtonElement>('.more')!
  const less = document.querySelector<HTMLButtonElement>('.less')!
  less.click()
  expect(step(host)).toBe(0)
  for (let i = 0; i < 8; i++) more.click()
  expect(step(host)).toBe(5)
  expect(columnY(host)).toBe(5 * STRIDE)
})

it('clamps autoplay and spin at the end of the column', () => {
  const autoplay = mount(`${LAB} autoplay:1s`, { layout: 'column', count: 6 }).host
  vi.advanceTimersByTime(20000)
  expect(step(autoplay)).toBe(5)
  expect(columnY(autoplay)).toBe(5 * STRIDE)
  animator!.destroy()
  const spin = mount(`${LAB} spin:6s`, { layout: 'column', count: 6 }).host
  vi.advanceTimersByTime(20000)
  expect(step(spin)).toBe(5)
  expect(variable(spin, '--kui-step-position')).toBe('5.0000')
})

it('holds a spin for the whole flight, then hands it back', async () => {
  const { host } = mount(`${LAB} spin:30s`)
  vi.advanceTimersByTime(100)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
  await arrange(host, 'column')
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  const held = variable(host, '--kui-step-position')
  vi.advanceTimersByTime(FLIGHT_MS - 1)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  expect(variable(host, '--kui-step-position')).toBe(held)
  vi.advanceTimersByTime(1)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('true')
})

it('keeps a spin held when the flight ends under a drag', async () => {
  const { host } = mount(`${LAB} spin:30s`)
  vi.advanceTimersByTime(100)
  await arrange(host, 'column')
  pointer(host, 'pointerdown', 100, 100)
  pointer(host, 'pointermove', 100, 100 - STRIDE)
  expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
  const held = variable(host, '--kui-step-position')
  vi.advanceTimersByTime(FLIGHT_MS + 1000)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
  expect(variable(host, '--kui-step-position')).toBe(held)
})

it('maps a vertical drag to the column, clamps it, and snaps on release', () => {
  const { host } = mount(LAB, { layout: 'column' })
  pointer(host, 'pointerdown', 100, 100)
  pointer(host, 'pointermove', 100, 100 - STRIDE)
  expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
  expect(columnY(host)).toBeCloseTo(STRIDE)
  pointer(host, 'pointermove', 100, 100 - 1.25 * STRIDE)
  expect(columnY(host)).toBeCloseTo(1.25 * STRIDE)
  pointer(host, 'pointermove', 100, 100000)
  expect(columnY(host)).toBe(0)
  pointer(host, 'pointermove', 100, -100000)
  expect(columnY(host)).toBeCloseTo(11 * STRIDE)
  pointer(host, 'pointermove', 100, 100 - 1.25 * STRIDE)
  pointer(host, 'pointerup', 100, 100 - 1.25 * STRIDE)
  expect(step(host)).toBe(1)
  expect(columnY(host)).toBe(STRIDE)
})

it('reads only the horizontal part of a drag on the line under attribute:', () => {
  const { host } = mount(LAB)
  const x = variable(host, '--kui-row-x')
  pointer(host, 'pointerdown', 100, 100)
  pointer(host, 'pointermove', 100, 300)
  expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
  expect(variable(host, '--kui-row-x')).toBe(x)
  expect(variable(host, '--kui-column-y')).toBe('')
})

it('keeps a plain line on one drag axis', () => {
  const { host } = mount('carousel-loop shape:line')
  pointer(host, 'pointerdown', 100, 100)
  pointer(host, 'pointermove', 100, 300)
  expect(host.getAttribute('data-kui-ring-dragging')).not.toBe('true')
})

it('leaves a one-card column at rest', () => {
  const { host } = mount(LAB, { layout: 'column', count: 1 })
  expect(columnY(host)).toBe(0)
  pointer(host, 'pointerdown', 100, 100)
  pointer(host, 'pointermove', 100, -200)
  expect(columnY(host)).toBe(0)
  pointer(host, 'pointerup', 100, -200)
  expect(step(host)).toBe(0)
})

it('runs a scroll-driven column over its whole distance, with the same card at the same scroll both ways', () => {
  const { host, reporter } = mount(`${LAB} timeline:scroll distance:1200px`, { layout: 'column', count: 6 })
  expect(reporter.messages).toEqual([])
  scheduler.emit(0)
  expect(columnY(host)).toBe(0)
  scheduler.emit(240)
  expect(columnY(host)).toBeCloseTo(STRIDE)
  scheduler.emit(960)
  expect(columnY(host)).toBeCloseTo(4 * STRIDE)
  scheduler.emit(1200)
  expect(step(host)).toBe(5)
  expect(columnY(host)).toBeCloseTo(5 * STRIDE)
  scheduler.emit(960)
  expect(columnY(host)).toBeCloseTo(4 * STRIDE)
  scheduler.emit(0)
  expect(step(host)).toBe(0)
  expect(columnY(host)).toBe(0)
})

it('re-arms the flight on a rapid reverse and ignores a value that does not change the arrangement', async () => {
  const { host } = mount(LAB)
  await arrange(host, 'grid')
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('line')
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  await arrange(host, 'column')
  vi.advanceTimersByTime(500)
  await arrange(host, 'line')
  vi.advanceTimersByTime(FLIGHT_MS - 1)
  expect(host.getAttribute('data-kui-row-flight')).toBe('true')
  vi.advanceTimersByTime(1)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
})

it('skips the flight under reduced motion but still switches', async () => {
  const { host } = mount(LAB, { reducedMotion: true })
  await arrange(host, 'column')
  expect(host.getAttribute('data-kui-row-arrangement')).toBe('column')
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  expect(variable(host.children[0]!, '--kui-flight-rank')).toBe('')
})

it('gives everything back at teardown, mid-flight, and stops watching', async () => {
  const { host } = mount(LAB)
  await arrange(host, 'column')
  animator!.destroy()
  animator = undefined
  expect(host.hasAttribute('data-kui-row-arrangement')).toBe(false)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  expect(variable(host, '--kui-column-y')).toBe('')
  expect(variable(host.children[0]!, '--kui-column-place')).toBe('')
  expect(variable(host.children[0]!, '--kui-flight-rank')).toBe('')
  expect(host.getAttribute('data-layout')).toBe('column')
  await arrange(host, 'line')
  vi.advanceTimersByTime(FLIGHT_MS)
  expect(host.hasAttribute('data-kui-row-arrangement')).toBe(false)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
})

it.each(['carousel-loop', 'carousel-loop shape:line', 'carousel-loop copies:auto attribute:data-layout'])('adds nothing to %s', async effect => {
  const { host } = mount(effect, { layout: 'column' })
  await arrange(host, 'line')
  await arrange(host, 'column')
  expect(host.hasAttribute('data-kui-row-arrangement')).toBe(false)
  expect(host.hasAttribute('data-kui-row-flight')).toBe(false)
  expect(variable(host, '--kui-column-y')).toBe('')
  expect(variable(host.children[0]!, '--kui-column-place')).toBe('')
  press(host, 'ArrowLeft')
  expect(step(host)).toBe(11)
})

it('diagnoses attribute: without shape:line, and with copies:auto where the copies are dropped', () => {
  const registry = catalogRegistry()
  expect(compile(parse('carousel-loop attribute:data-layout'), registry, 'time').warnings.join()).toContain('require shape:line')
  const both = 'carousel-loop shape:line attribute:data-layout copies:auto'
  expect(compile(parse(both), registry, 'time').warnings.join()).toContain('ignores copies:auto')
  // Direct images, the one thing copies:auto would copy.
  const { host } = mount(both, { count: 3, slide: '<img src="/art.jpg" alt="Art">' })
  expect(host.querySelectorAll('[data-kui-row-copy]').length).toBe(0)
})

it('compiles the exact lab markup with no warnings', () => {
  expect(compile(parse(LAB), catalogRegistry(), 'time').warnings).toEqual([])
})
