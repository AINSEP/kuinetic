// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { projectSphere } from '../src/effects/carousel/shape-fit.js'
import { sphereLatitude, sphereNormal } from '../src/effects/carousel/sphere.js'
import { catalogRegistry } from './support/registry.js'

const RAD = Math.PI / 180
let animator: Animator | undefined
function mount(effect: string, count = 12) {
  document.body.innerHTML = `<div data-kui="${effect}">${'<a href="#art"><img src="/art.jpg" alt="Art"></a>'.repeat(count)}</div>`
  const host = document.body.firstElementChild as HTMLElement
  const reads = vi.fn()
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
  Object.defineProperty(host, 'offsetWidth', { value: 390 })
  host.getBoundingClientRect = () => ({ left: 0, width: 390, height: 300 }) as DOMRect
  for (const child of host.children) {
    Object.defineProperty(child, 'offsetWidth', { get: () => { reads(); return 100 } })
    Object.defineProperty(child, 'offsetHeight', { get: () => { reads(); return 130 } })
  }
  const reporter = collectingReporter()
  animator = animatorOverBody(reporter)
  animator.start()
  return { host, reporter, reads }
}
function pointer(type: string, clientX: number, clientY: number): Event {
  return Object.assign(new Event(type, { bubbles: true }), { clientX, clientY, pointerId: 1 })
}
const press = (host: HTMLElement, type: string, x: number, y: number): boolean => host.dispatchEvent(pointer(type, x, y))
const key = (host: HTMLElement): boolean => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
const latOf = (node: Element): number => parseFloat((node as HTMLElement).style.getPropertyValue('--kui-sphere-lat'))
function expectFaces(host: HTMLElement, tiltDeg: number, pitchDeg: number): void {
  const count = host.children.length
  ;[...host.children].forEach((node, index) => {
    const angle = Number(node.getAttribute('data-kui-step-offset')) * 360 / count * RAD
    const z = sphereNormal(angle, sphereLatitude(index, count) * RAD, (tiltDeg + pitchDeg) * RAD)[2]
    expect(node.getAttribute('data-kui-ring-face')).toBe(z > 1e-10 ? 'front' : 'back')
  })
}
afterEach(() => { animator?.destroy(); animator = undefined; vi.restoreAllMocks(); document.body.replaceChildren() })

it('spreads latitudes for equal area, off the poles, with the first card on the equator', () => {
  for (const count of [1, 2, 3, 7, 12, 16, 33]) {
    const lats = Array.from({ length: count }, (_, i) => sphereLatitude(i, count))
    expect(lats[0]).toBeCloseTo(0)
    expect(new Set(lats.map(lat => lat.toFixed(6))).size).toBe(count)
    if (count > 1) expect(Math.max(...lats.map(Math.abs))).toBeLessThan(90)
  }
  const heights = Array.from({ length: 16 }, (_, i) => Math.sin(sphereLatitude(i, 16) * RAD)).sort((a, b) => a - b)
  heights.slice(1).forEach((height, i) => expect(height - heights[i]!).toBeCloseTo(2 / 16 * 15 / 16))
})

it('computes the face normal the CSS transform produces', () => {
  expect(sphereNormal(0, 0, 0)[2]).toBe(1)
  expect(sphereNormal(90 * RAD, 0, 0)[0]).toBeCloseTo(1)
  expect(sphereNormal(0, 90 * RAD, 0)[1]).toBeCloseTo(-1)
  expect(sphereNormal(60 * RAD, 0, 0)[2]).toBeCloseTo(.5)
  expect(sphereNormal(0, 30 * RAD, 0)[2]).toBeCloseTo(Math.cos(30 * RAD))
  // A card high on the sphere and turned towards the camera by the tilt.
  expect(sphereNormal(0, 80 * RAD, -60 * RAD)[2]).toBeGreaterThan(.8)
  expect(sphereNormal(0, 80 * RAD, 60 * RAD)[2]).toBeLessThan(0)
})

it('bounds the silhouette as a circle and refuses one that reaches the camera', () => {
  const g = { width: 0, height: 0, radius: 300, rise: 0, count: 1, arc: 360, tilt: 0, perspective: 500, camera: false }
  expect(projectSphere(g).maxX).toBeCloseTo(375)
  expect(projectSphere(g).minY).toBeCloseTo(-375)
  expect(projectSphere({ ...g, perspective: 300 }).maxX).toBe(Infinity)
})

it('places latitudes and a derived radius, keeps the ring index, and restores ownership', () => {
  const { host, reporter, reads } = mount('carousel-3d shape:sphere gap:0px', 16)
  expect(reporter.messages).toEqual([])
  expect(host.getAttribute('data-kui-ring-shape')).toBe('sphere')
  expect(parseFloat(host.style.getPropertyValue('--kui-sphere-radius'))).toBeCloseTo(Math.sqrt(16 * 100 * 130 / (4 * Math.PI * .3)))
  expect(host.style.getPropertyValue('--kui-shape-fit')).toBe('1')
  expect(parseFloat(host.style.getPropertyValue('--kui-shape-height'))).toBeGreaterThan(300)
  expect(host.style.getPropertyValue('--kui-helix-centre')).toBe('')
  ;[...host.children].forEach((node, i) => expect(latOf(node)).toBeCloseTo(sphereLatitude(i, 16)))
  expect((host.children[0] as HTMLElement).getAttribute('data-kui-step-state')).toBe('active')
  reads.mockClear()
  for (let i = 0; i < 32; i++) key(host)
  expect(reads).not.toHaveBeenCalled()
  expect(host.getAttribute('data-kui-step')).toBe('0')
  animator!.destroy()
  animator = undefined
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
  expect(host.style.getPropertyValue('--kui-sphere-radius')).toBe('')
  expect(latOf(host.children[3]!)).toBeNaN()
})

it('marks far cards from latitude as well as angle under a tilt, so a turned ring test is not enough', () => {
  const { host } = mount('carousel-3d shape:sphere tilt:40deg', 16)
  expectFaces(host, -40, 0)
  const back = [...host.querySelectorAll('[data-kui-ring-face="back"]')]
  expect(back.length).toBeGreaterThan(0)
  expect(back.every(node => node.hasAttribute('inert'))).toBe(true)
  key(host)
  expectFaces(host, -40, 0)
})

it('rewrites latitudes only when the slides change', () => {
  const { host } = mount('carousel-3d shape:sphere')
  const first = host.children[1] as HTMLElement
  first.style.setProperty('--kui-sphere-lat', '5deg')
  key(host)
  expect(latOf(first)).toBe(5)
  host.append(document.createElement('a'))
  key(host)
  ;[...host.children].forEach((node, i) => expect(latOf(node)).toBeCloseTo(sphereLatitude(i, 13)))
})

it('warns when the sphere reaches the camera', () => {
  const { reporter } = mount('carousel-3d shape:sphere radius:2000px perspective:1000px')
  expect(reporter.messages.join()).toContain('sphere reaches the camera plane')
})

it.each(['carousel-orbit shape:sphere', 'carousel-3d-inside shape:sphere'])('warns and ignores %s', effect => {
  const { host, reporter } = mount(effect)
  expect(reporter.messages.join()).toContain('outward depth ring')
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
  expect(latOf(host.children[1]!)).toBeNaN()
})

it('leaves an ordinary ring untouched', () => {
  const { host, reporter } = mount('carousel-3d, pop')
  expect(reporter.messages).toEqual([])
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
  expect(latOf(host.children[1]!)).toBeNaN()
  press(host, 'pointerdown', 100, 100)
  press(host, 'pointermove', 100, 300)
  expect(host.getAttribute('data-kui-ring-dragging')).not.toBe('true')
  expect(host.style.getPropertyValue('--kui-sphere-pitch')).toBe('')
})

it.each(['', ' drag-axis:both'])('leaves vertical touches to the page: carousel-3d shape:sphere%s', param => {
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
  mount(`carousel-3d shape:sphere${param}`)
  const touch = writes.mock.calls.filter(([name]) => name === 'touch-action').map(([, value]) => value)
  expect(touch).toContain('pan-y')
  expect(touch).not.toContain('none')
})

it('keeps one axis on a sphere unless drag-axis:both asks for two', () => {
  const { host } = mount('carousel-3d shape:sphere')
  press(host, 'pointerdown', 100, 100)
  press(host, 'pointermove', 100, 300)
  expect(host.getAttribute('data-kui-ring-dragging')).not.toBe('true')
  expect(host.style.getPropertyValue('--kui-sphere-pitch')).toBe('')
})

it('drag-axis:both pitches one host variable, bounded, resumes from where it rested, and keeps page scroll', () => {
  const { host } = mount('carousel-3d shape:sphere drag-axis:both tilt:0deg')
  press(host, 'pointerdown', 100, 100)
  // 110 of 220px per place is half a place of twelve: 15 degrees, front of the sphere following the hand.
  press(host, 'pointermove', 100, 210)
  expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
  expect(parseFloat(host.style.getPropertyValue('--kui-sphere-pitch'))).toBeCloseTo(-15)
  expectFaces(host, 0, -15)
  press(host, 'pointermove', 100, 100000)
  expect(parseFloat(host.style.getPropertyValue('--kui-sphere-pitch'))).toBe(-80)
  expectFaces(host, 0, -80)
  press(host, 'pointerup', 100, 100000)
  expect(host.getAttribute('data-kui-step')).toBe('0')
  press(host, 'pointerdown', 100, 100)
  press(host, 'pointermove', 100, 0)
  expect(parseFloat(host.style.getPropertyValue('--kui-sphere-pitch'))).toBeCloseTo(-80 + 100 / 220 / 12 * 360)
  press(host, 'pointerup', 100, 0)
  animator!.destroy()
  animator = undefined
  expect(host.style.getPropertyValue('--kui-sphere-pitch')).toBe('')
})

it('bounds pitch against the tilt the camera already has', () => {
  const { host } = mount('carousel-3d shape:sphere drag-axis:both tilt:30deg')
  press(host, 'pointerdown', 100, 100)
  press(host, 'pointermove', 100, -100000)
  expect(parseFloat(host.style.getPropertyValue('--kui-sphere-pitch'))).toBe(110)
  press(host, 'pointerup', 100, -100000)
})

it('claims the fit scale for a sphere only and diagnoses drag-axis without one', () => {
  const registry = catalogRegistry()
  expect(compile(parse('carousel-3d, pop'), registry, 'time').warnings).toEqual([])
  expect(compile(parse('carousel-3d shape:sphere, pop'), registry, 'time').warnings.join()).toContain('scale')
  expect(compile(parse('carousel-3d drag-axis:both'), registry, 'time').warnings.join()).toContain('requires shape:sphere')
})

it.each([
  'carousel-3d shape:sphere gap:0px spin:30s',
  'carousel-3d shape:sphere gap:0px drag-axis:both',
])('compiles exact lab markup: %s', effect => {
  expect(compile(parse(effect), catalogRegistry(), 'time').warnings).toEqual([])
})
