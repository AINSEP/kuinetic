// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

let animator: Animator | undefined
function mount(effect: string, count = 12) {
  document.body.innerHTML = `<div data-kui="${effect}">${Array.from({ length: count }, () => '<a href="#art"><img src="/art.jpg" alt="Artwork"></a>').join('')}</div>`
  const host = document.body.firstElementChild as HTMLElement
  const reads = vi.fn()
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
  Object.defineProperty(host, 'offsetWidth', { value: 390 })
  host.getBoundingClientRect = () => ({ left: 0, width: 390, height: 130 }) as DOMRect
  for (const child of host.children) {
    Object.defineProperty(child, 'offsetWidth', { get: () => { reads(); return 100 } })
    Object.defineProperty(child, 'offsetHeight', { get: () => { reads(); return 130 } })
  }
  const reporter = collectingReporter()
  animator = animatorOverBody(reporter)
  animator.start()
  return { host, reporter, reads }
}
afterEach(() => { animator?.destroy(); animator = undefined; vi.restoreAllMocks(); document.body.replaceChildren() })

it.each([11, 12])('publishes helix sizing and parity without changing face safety for %s cards', count => {
  const { host, reporter, reads } = mount('carousel-3d shape:helix rise:32px arc:540deg radius:240px spin:30s', count)
  expect(reporter.messages).toEqual([])
  expect(host.getAttribute('data-kui-ring-shape')).toBe('helix')
  expect(host.style.getPropertyValue('--kui-helix-centre')).toBe(count % 2 ? '0' : '0.5')
  expect(Number(host.style.getPropertyValue('--kui-shape-fit'))).toBeGreaterThan(0)
  expect(Number(host.style.getPropertyValue('--kui-shape-fit'))).toBeLessThan(1)
  expect(parseFloat(host.style.getPropertyValue('--kui-shape-height'))).toBeGreaterThan(130)
  const back = [...host.querySelectorAll('[data-kui-ring-face="back"]')]
  expect(back.length).toBeGreaterThan(0)
  expect(back.every(node => node.hasAttribute('inert'))).toBe(true)
  reads.mockClear()
  for (let i = 0; i < count * 2; i++) host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(reads).not.toHaveBeenCalled()
  expect(host.getAttribute('data-kui-step')).toBe('0')
  animator!.destroy()
  animator = undefined
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
  expect(host.style.getPropertyValue('--kui-shape-fit')).toBe('')
})

it('leaves ordinary rings and composition untouched', () => {
  const { host, reporter } = mount('carousel-3d, pop')
  expect(reporter.messages).toEqual([])
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
  expect(host.style.getPropertyValue('--kui-shape-fit')).toBe('')
})

it.each(['carousel-orbit shape:helix rise:32px', 'carousel-3d-inside shape:helix rise:32px'])('warns and ignores unsupported shape placement: %s', effect => {
  const { host, reporter } = mount(effect)
  expect(reporter.messages.join()).toContain('outward depth ring')
  expect(host.hasAttribute('data-kui-ring-shape')).toBe(false)
})

it('claims optional scale and opacity only for the helix and diagnoses rise without it', () => {
  const registry = catalogRegistry()
  expect(compile(parse('carousel-3d, pop'), registry, 'time').warnings).toEqual([])
  expect(compile(parse('carousel-3d shape:helix, pop'), registry, 'time').warnings.join()).toMatch(/scale|opacity/)
  expect(compile(parse('carousel-3d rise:32px'), registry, 'time').warnings.join()).toContain('requires shape:helix')
})
