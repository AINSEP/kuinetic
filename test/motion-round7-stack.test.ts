// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { SPATIAL_STACK_PRIMITIVE } from '../src/effects/carousel/stack.js'
import { catalogRegistry } from './support/registry.js'
import { FACE_ATTR, WRAP_ATTR } from '../src/effects/carousel/deck.js'

const markup = [
  'carousel-stack leave:swipe leave-x:260px leave-rotate:18deg rest-rotate:5deg shift:0px rise:0px shrink:0 blur:0px fade:0 travel:260',
  'carousel-stack leave:swipe leave-x:240px leave-rotate:10deg leave-fade:1 shift:0px rise:6px shrink:0 blur:0px fade:0 travel:240',
]

function pointer(host: HTMLElement, type: string, dx: number) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX: dx, clientY: 0, pointerId: 1, button: 0 })
  host.dispatchEvent(event)
}

function mount(values: Record<string, string> = {}) {
  document.body.innerHTML = `<div data-kui-fx="carousel-stack">${'<a href="#">Card</a>'.repeat(6)}</div>`
  const host = document.body.firstElementChild as HTMLElement
  const cards = [...host.querySelectorAll('a')]
  const wrapped: Element[] = []
  const ctx = {
    doc: document,
    win: {
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (handle: number) => clearTimeout(handle),
      requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
      cancelAnimationFrame: (handle: number) => cancelAnimationFrame(handle),
      getComputedStyle: (node: Element) => {
        if (node.hasAttribute(WRAP_ATTR)) wrapped.push(node)
        return window.getComputedStyle(node)
      },
    } as unknown as Window,
    reducedMotion: false,
    style: createStyleLedger(host),
    warn: vi.fn(),
  } as unknown as PrepareContext
  const instance = SPATIAL_STACK_PRIMITIVE.prepare!(host, readEffectParams({ travel: '200', ...values }, SPATIAL_STACK_PRIMITIVE.parameters, ctx.warn), ctx)
  instance.activate()
  return { host, cards, wrapped, destroy() { instance.destroy(); ctx.style.restore() } }
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }))
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

it('compiles exact lab markup without warnings and leaves plain stacks without new output', () => {
  const registry = catalogRegistry()
  for (const value of markup) expect(compile(parse(value), registry, 'time').warnings).toEqual([])
  const { host, cards, destroy } = mount()
  pointer(host, 'pointerdown', 0)
  pointer(host, 'pointermove', -120)
  expect(cards[0]!.getAttribute(FACE_ATTR)).toBe('back')
  expect(host.hasAttribute('data-kui-stack-leave')).toBe(false)
  expect(host.style.getPropertyValue('--kui-stack-swipe-sign')).toBe('')
  destroy()
})

it.each([-1, 1])('advances one place for direction %s, keeps the leaving card through half a place, and restores', direction => {
  const { host, cards, destroy } = mount({ leave: 'swipe' })
  expect(cards[5]!.hasAttribute('inert')).toBe(true)
  pointer(host, 'pointerdown', 0)
  pointer(host, 'pointermove', direction * 120)
  expect(host.style.getPropertyValue('--kui-stack-swipe-sign')).toBe(String(direction))
  expect(cards[0]!.getAttribute(FACE_ATTR)).toBe('front')
  expect(cards[0]!.hasAttribute('inert')).toBe(false)
  expect(Number(host.style.getPropertyValue('--kui-step-position'))).toBeCloseTo(0.6)
  pointer(host, 'pointerup', direction * 120)
  expect(host.getAttribute('data-kui-step')).toBe('1')
  expect(cards[0]!.getAttribute(FACE_ATTR)).toBe('back')
  expect(cards[0]!.hasAttribute('inert')).toBe(true)
  destroy()
  expect(host.hasAttribute('data-kui-stack-leave')).toBe(false)
  expect(cards.every(card => !card.hasAttribute(FACE_ATTR) && !card.hasAttribute('inert'))).toBe(true)
  expect(host.style.getPropertyValue('--kui-stack-swipe-sign')).toBe('')
})

it('returns a short swipe, keeps a long swipe visible until release, and recycles hidden cards without a transition', () => {
  const { host, cards, wrapped, destroy } = mount({ leave: 'swipe' })
  pointer(host, 'pointerdown', 0)
  pointer(host, 'pointermove', 20)
  pointer(host, 'pointerup', 20)
  expect(host.getAttribute('data-kui-step')).toBe('0')
  for (let step = 0; step < 6; step++) {
    pointer(host, 'pointerdown', 0)
    pointer(host, 'pointermove', 1000)
    expect(cards[step]!.getAttribute(FACE_ATTR)).toBe('front')
    expect(cards[step]!.hasAttribute('inert')).toBe(false)
    expect(Number(host.style.getPropertyValue('--kui-step-position'))).toBeCloseTo((step + 1) % 6 - 0.001, 4)
    pointer(host, 'pointerup', 1000)
    expect(host.getAttribute('data-kui-step')).toBe(String((step + 1) % 6))
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index]!
      const stable = (Number(card.style.getPropertyValue('--kui-offset')) + Number(host.getAttribute('data-kui-step')) + 6) % 6
      expect(stable).toBe(index)
    }
  }
  expect(wrapped).toContain(cards[0])
  expect(cards.some(card => card.hasAttribute(WRAP_ATTR))).toBe(false)
  destroy()
})

it('a swiped card fades by default, an explicit zero keeps it opaque', () => {
  const css = readFileSync('src/css/carousel.css', 'utf8')
  expect(css).toMatch(/\[data-kui-stack-leave='swipe'\][\s\S]*?--kui-stack-leave-fade: 1;/)
  expect(SPATIAL_STACK_PRIMITIVE.parameters['leave-fade']!.default).toBe('1')
  expect(compile(parse('carousel-stack leave:swipe leave-fade:0'), catalogRegistry(), 'time').vars['--kui-stack-leave-fade']).toBe('0')
})

it('keeps fade optional and resting tilt tied to card index rather than current stack place', () => {
  const css = readFileSync('src/css/carousel.css', 'utf8')
  expect(css).toContain('1 - var(--kui-stack-leave-fade, 2) * var(--kui-stack-gone)')
  expect(css).toContain('mod(var(--kui-offset, 0) + var(--kui-step, 0), max(1, var(--kui-item-count, 1)))')
  expect(css).toContain('var(--kui-stack-rest-rotate, 0deg)')
  expect(css).toContain('var(--kui-stack-leave-x, calc(-1 * var(--kui-stack-shift, 48px)))')
  const registry = catalogRegistry()
  expect(compile(parse(markup[1]!), registry, 'time').vars['--kui-stack-leave-fade']).toBe('1')
  const plain = compile(parse('carousel-stack'), registry, 'time')
  expect(Object.keys(plain.vars).some(key => key.includes('leave') || key.includes('rest-rotate'))).toBe(false)
})
