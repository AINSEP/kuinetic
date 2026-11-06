// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { GESTURE_PRIMITIVES } from '../src/effects/gestures/primitives.js'
import { catalogRegistry } from './support/registry.js'
import { Animator } from '../src/core/animator.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'

const markup = [
  'elastic-pull axis:x publish:true',
  'long-press held:true 1200ms',
  "drag-x publish:true detents:'-120 0 120'",
]

function pointer(el: EventTarget, type: string, x = 0, extra = {}) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX: x, clientY: 0, pointerId: 1, button: 0, isPrimary: true }, extra)
  el.dispatchEvent(event)
}

function mount(id: string, values: Record<string, string>) {
  const el = document.createElement('button')
  document.body.append(el)
  el.style.setProperty('--kui-drag-x', 'authored')
  el.setAttribute('data-kui-pressing', 'authored')
  const style = createStyleLedger(el)
  const warn = vi.fn()
  const ctx = { doc: document, win: window, style, warn, invalidate: vi.fn() } as unknown as PrepareContext
  const params = createParams(values)
  const instance = GESTURE_PRIMITIVES.find(p => p.id === id)!.prepare!(el, params, ctx)
  instance.activate()
  return { el, warn, params, destroy() { instance.destroy(); style.restore() } }
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren() })

it('compiles the exact lab markup and owns outputs only on opted-in variants', () => {
  const registry = catalogRegistry()
  for (const value of markup) expect(compile(parse(value), registry, 'time').warnings).toEqual([])
  const plain = compile(parse('fade-up on:enter, drag-x'), registry, 'time')
  const opted = compile(parse('fade-up on:enter, drag-x publish:true'), registry, 'time')
  expect(plain.warnings).toEqual([])
  expect(opted.warnings).toEqual([])
  expect(plain.channels).not.toContain('--kui-drag-x')
  expect(opted.channels).toContain('--kui-drag-x')
  expect(compile(parse('long-press held:true'), registry, 'time').channels).toContain('attr:data-kui-pressing')
  expect(compile(parse('long-press'), registry, 'time').channels).not.toContain('attr:data-kui-pressing')
  expect(opted.reducedMotion).toBe('disable')
  document.body.innerHTML = `<button data-kui="${markup[1]}">Hold</button><div data-kui="${markup[0]}"></div>`
  const animator = new Animator({ root: document.body, registry, capabilities: { ...CAPS, reducedMotion: true }, binder: fakeBinder() })
  animator.start()
  for (const el of document.body.children) {
    pointer(el, 'pointerdown')
    pointer(el, 'pointermove', 40)
    expect(el.hasAttribute('data-kui-pressing')).toBe(false)
    expect((el as HTMLElement).style.getPropertyValue('--kui-drag-x')).toBe('')
  }
  animator.destroy()
})

it('publishes signed numeric pixels in step with drag, pickup and spring return, then restores', () => {
  const { el, destroy } = mount('draggable', { axis: 'x', publish: 'true', return: 'true' })
  pointer(el, 'pointerdown')
  pointer(el, 'pointermove', -42.5)
  expect(el.style.getPropertyValue('--kui-drag-x')).toBe('-42.50')
  expect(el.style.getPropertyValue('--kui-drag-y')).toBe('0.00')
  pointer(el, 'pointerup', -42.5)
  vi.advanceTimersByTime(80)
  expect(Number(el.style.getPropertyValue('--kui-drag-x'))).toBeCloseTo(Number.parseFloat(el.style.translate), 2)
  const pickup = Number(el.style.getPropertyValue('--kui-drag-x'))
  pointer(el, 'pointerdown')
  pointer(el, 'pointermove', 10)
  expect(Number(el.style.getPropertyValue('--kui-drag-x'))).toBeCloseTo(pickup + 10, 1)
  pointer(el, 'pointercancel', 10)
  vi.advanceTimersByTime(3000)
  expect(el.style.getPropertyValue('--kui-drag-x')).toBe('0.00')
  destroy()
  expect(el.style.getPropertyValue('--kui-drag-x')).toBe('authored')
})

it.each([['x', 'pan-y'], ['y', 'pan-x'], ['both', '']])('snaps detents for %s and preserves the other touch axis', (axis, pan) => {
  const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
  const { el, destroy } = mount('draggable', { axis, publish: 'true', detents: '-120 0 120' })
  pointer(el, 'pointerdown')
  pointer(el, 'pointermove', 80, { clientY: 80 })
  pointer(el, 'pointerup', 80)
  vi.advanceTimersByTime(3000)
  expect(el.style.getPropertyValue('--kui-drag-x')).toBe(axis === 'y' ? '0.00' : '120.00')
  if (pan) expect(set).toHaveBeenCalledWith('touch-action', `${pan} pinch-zoom`)
  else expect(set.mock.calls.some(([name]) => name === 'touch-action')).toBe(false)
  destroy()
})

it('leaves plain hosts alone and warns once for invalid detents', () => {
  const plain = mount('draggable', {})
  pointer(plain.el, 'pointerdown')
  pointer(plain.el, 'pointermove', 30)
  expect(plain.el.style.getPropertyValue('--kui-drag-x')).toBe('authored')
  plain.destroy()
  const bad = mount('draggable', { detents: 'oops' })
  pointer(bad.el, 'pointerdown')
  pointer(bad.el, 'pointermove', 40)
  pointer(bad.el, 'pointerup', 40)
  vi.advanceTimersByTime(3000)
  expect(bad.el.style.translate).toBe('40.00px 0.00px')
  expect(bad.warn).toHaveBeenCalledTimes(1)
  expect(bad.warn).toHaveBeenCalledWith('draggable detents needs space-separated pixel numbers')
  bad.destroy()
})

it.each(['false', 'true'])('reads publish:%s only during preparation and gates touch-action on plain drag-x', publish => {
  const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
  const values: Record<string, string> = publish === 'true' ? { axis: 'x', publish, return: 'true' } : { axis: 'x', return: 'true' }
  const { el, params, destroy } = mount('draggable', values)
  if (publish === 'true') expect(set).toHaveBeenCalledWith('touch-action', 'pan-y pinch-zoom')
  else expect(set.mock.calls.some(([name]) => name === 'touch-action')).toBe(false)
  const reads = vi.spyOn(params, 'is')
  pointer(el, 'pointerdown')
  pointer(el, 'pointermove', 40)
  pointer(el, 'pointerup', 40)
  vi.advanceTimersByTime(3000)
  expect(reads.mock.calls.filter(([name]) => name === 'publish')).toHaveLength(0)
  expect(el.style.getPropertyValue('--kui-drag-x')).toBe(publish === 'true' ? '0.00' : 'authored')
  destroy()
})

it.each(['pointerup', 'pointercancel', 'pointermove', 'second-pointer', 'lostpointercapture'])('cancels held state and its completion timer on %s', type => {
  const { el, destroy } = mount('pressable', { held: 'true' })
  el.setPointerCapture = vi.fn()
  el.releasePointerCapture = vi.fn()
  pointer(el, 'pointerdown')
  expect(el.getAttribute('data-kui-pressing')).toBe('true')
  vi.advanceTimersByTime(100)
  if (type === 'second-pointer') pointer(el, 'pointerdown', 0, { pointerId: 2 })
  else pointer(el, type, 10)
  expect(el.getAttribute('data-kui-pressing')).toBe('false')
  vi.advanceTimersByTime(1000)
  expect(el.getAttribute('data-kui-pressed')).not.toBe('true')
  destroy()
  expect(el.getAttribute('data-kui-pressing')).toBe('authored')
})

it('keeps held state pointer-only, accepts primary presses and restores on teardown', () => {
  const { el, destroy } = mount('pressable', { held: 'true' })
  pointer(el, 'pointerdown', 0, { button: 2 })
  pointer(el, 'pointerdown', 0, { isPrimary: false })
  expect(el.getAttribute('data-kui-pressing')).toBe('authored')
  for (const key of [' ', 'Enter']) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key }))
    expect(el.getAttribute('data-kui-pressing')).toBe('authored')
    el.dispatchEvent(new KeyboardEvent('keyup', { key }))
  }
  pointer(el, 'pointerdown')
  expect(el.getAttribute('data-kui-pressing')).toBe('true')
  vi.advanceTimersByTime(500)
  expect(el.getAttribute('data-kui-pressed')).toBe('true')
  destroy()
  vi.advanceTimersByTime(1000)
  expect(el.getAttribute('data-kui-pressing')).toBe('authored')
})
