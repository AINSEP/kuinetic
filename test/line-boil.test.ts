// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/** The real parser, compiler and animator over one root. */
function mount(root: HTMLElement, reducedMotion = false): Animator {
  return new Animator({
    root,
    registry: catalogRegistry(),
    capabilities: { ...CAPS, reducedMotion },
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  }).start()
}

function start(html: string, reducedMotion = false): Animator {
  document.body.innerHTML = html
  return mount(document.body, reducedMotion)
}

const IMG = (params = ''): string => `<img src="a.png" alt="" data-kui="line-boil${params}">`
const filter = (): Element | null => document.querySelector('filter')
const seed = (): string | null | undefined => filter()?.children[0]?.getAttribute('seed')
const host = (index = 0): HTMLElement => document.querySelectorAll<HTMLElement>('[data-kui]')[index]!
const hostFilter = (): string => host().style.getPropertyValue('filter')

/** An observer the test fires by hand, so on-screen and off-screen are each one line. */
function stubObserver(): (target: Element, isIntersecting: boolean) => void {
  let fire!: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { fire = callback }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  return (target, isIntersecting) => fire([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (document as unknown as { hidden?: boolean }).hidden
  document.body.replaceChildren()
})

it('compiles the documented markup without a warning and claims only the filter', () => {
  const plan = compile(parse('line-boil amount:3 fps:10'), catalogRegistry(), 'time')
  expect(plan.warnings).toEqual([])
  expect(plan.channels).toEqual(['filter'])
})

it('points the host at a filter whose scale comes from amount, and restores the author filter', () => {
  stubObserver()
  const animator = start('<img src="a.png" alt="" style="filter: blur(1px)" data-kui="line-boil amount:4 fps:10">')
  expect(hostFilter()).toBe('url(#kui-line-boil-4-10)')
  expect(filter()?.id).toBe('kui-line-boil-4-10')
  expect(filter()?.children[1]?.getAttribute('scale')).toBe('8')
  animator.destroy()
  expect(hostFilter()).toBe('blur(1px)')
  expect(filter()).toBeNull()
})

it('steps the seed at fps only while on screen, and wraps its short ring of drawings', () => {
  const fire = stubObserver()
  const animator = start(IMG(' fps:10'))
  vi.advanceTimersByTime(500)
  expect(seed()).toBe('1')
  fire(host(), true)
  fire(host(), true)
  vi.advanceTimersByTime(100)
  expect(seed()).toBe('2')
  vi.advanceTimersByTime(400)
  expect(seed()).toBe('6')
  vi.advanceTimersByTime(100)
  expect(seed()).toBe('1')
  fire(host(), false)
  vi.advanceTimersByTime(500)
  expect(seed()).toBe('1')
  animator.destroy()
})

it('makes no change in a hidden tab', () => {
  const fire = stubObserver()
  const animator = start(IMG())
  fire(host(), true)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  vi.advanceTimersByTime(500)
  expect(seed()).toBe('1')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  vi.advanceTimersByTime(100)
  expect(seed()).toBe('2')
  animator.destroy()
})

it('shares one filter per setting and builds a new one after the last host leaves', () => {
  stubObserver()
  const animator = start(IMG(' amount:2') + IMG(' amount:2') + IMG(' amount:5'))
  expect([...document.querySelectorAll('filter')].map((node) => node.id)).toEqual(['kui-line-boil-2-10', 'kui-line-boil-5-10'])
  animator.destroy()
  expect(document.querySelector('svg')).toBeNull()
  const again = start(IMG(' amount:2'))
  expect(document.querySelectorAll('filter')).toHaveLength(1)
  again.destroy()
})

it('keeps a shared filter while another host still uses it', () => {
  stubObserver()
  document.body.innerHTML = `<section>${IMG(' amount:6')}</section><section>${IMG(' amount:6')}</section>`
  const [one, two] = document.querySelectorAll('section')
  const first = mount(one!)
  const second = mount(two!)
  first.destroy()
  expect(host(0).style.getPropertyValue('filter')).toBe('')
  expect(host(1).style.getPropertyValue('filter')).toBe('url(#kui-line-boil-6-10)')
  expect(filter()).not.toBeNull()
  second.destroy()
  expect(filter()).toBeNull()
})

it('runs without an IntersectionObserver, treating the host as on screen', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const animator = start(IMG(' fps:10'))
  vi.advanceTimersByTime(100)
  expect(seed()).toBe('2')
  animator.destroy()
  expect(filter()).toBeNull()
})

it('does nothing under reduced motion: no filter and no SVG', () => {
  stubObserver()
  const animator = start(IMG(), true)
  expect(hostFilter()).toBe('')
  expect(filter()).toBeNull()
  animator.destroy()
})
