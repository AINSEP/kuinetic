// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { preparePathFit, transformPath } from '../src/effects/motion-path/fit.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('fits through real parsing, subtracts flow offsets, refits on resize and restores styles', () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div><div data-kui="motion-path path:\'M10 20 Q60 120 110 20 T210 20\' viewbox:\'10 20 200 100\'" style="--kui-motion-path:author"></div></div>'
  const node = document.querySelector<HTMLElement>('[data-kui]')!
  const parent = node.parentElement!
  let width = 420
  Object.defineProperties(parent, { clientWidth: { get: () => width }, clientHeight: { value: 220 } })
  Object.defineProperties(node, {
    offsetWidth: { value: 20 }, offsetHeight: { value: 20 }, offsetLeft: { value: 35 }, offsetTop: { value: 45 },
    offsetParent: { value: parent },
  })
  const reporter = collectingReporter()
  const animator = animatorOverBody(reporter).start()
  expect(reporter.messages).toEqual([])
  expect(node.style.getPropertyValue('--kui-motion-path')).toBe('"M -35   -45  Q 65   155   165   -45  T 365   -45 "')
  width = 220
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(20)
  expect(node.style.getPropertyValue('--kui-motion-path')).toContain('T 165   5 ')
  animator.destroy()
  window.dispatchEvent(new Event('resize'))
  vi.runAllTimers()
  expect(node.style.getPropertyValue('--kui-motion-path')).toBe('author')
})

it('scales relative segments, implicit moveto pairs, H/V, exponent numbers and arcs correctly', () => {
  const numbers = (path: string) => path.match(/[-+]?[\d.]+(?:e[-+]?\d+)?/gi)?.map(Number)
  expect(numbers(transformPath('m1 2 3 4 h5 v6 a7 8 30 0 1 9 10 z', 2, 10, 20)))
    .toEqual([12, 24, 6, 8, 10, 12, 14, 16, 30, 0, 1, 18, 20])
  expect(numbers(transformPath('M1e1 2 H3 V4 A5 6 45 1 0 7 8', 2, 10, 20)))
    .toEqual([30, 24, 16, 28, 10, 12, 45, 1, 0, 24, 36])
  expect(transformPath('M.5.6 L1. 2.', 2, 0, 0).trim()).toBe('M 1  1.2  L 2   4')
  expect(numbers(transformPath('M0 0 A10 20 30 0110 20', 2, 5, 7)))
    .toEqual([5, 7, 20, 40, 30, 0, 1, 25, 47])
})

it('warns for invalid source bounds and leaves ordinary paths native', () => {
  const registry = catalogRegistry()
  expect(compile(parse('motion-path'), registry, 'time').jsEffects).toHaveLength(0)
  for (const bounds of ['0 0 0 100', '0 0 -1 10', '0 0 10 0', '0 0 10', '0 0 Infinity 10']) {
    document.body.innerHTML = `<div><div data-kui="motion-path viewbox:'${bounds}'"></div></div>`
    const reporter = collectingReporter()
    const animator = animatorOverBody(reporter).start()
    expect(reporter.messages.join()).toContain('viewbox expects')
    animator.destroy()
  }
  const warn = vi.fn()
  const detached = preparePathFit(document.createElement('div'), createParams({ viewbox: '0 0 100 100' }), { warn, win: window } as unknown as PrepareContext)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('containing element'))
  detached.destroy()
})

it.each([
  ['center', [10, 10, 210, 210]],
  ['bottom right', [20, 20, 220, 220]],
])('fits the actual extent for anchor:%s', (anchor, expected) => {
  document.body.innerHTML = `<div><div data-kui="motion-path path:'M0 0 L100 100' viewbox:'0 0 100 100' anchor:'${anchor}'"></div></div>`
  const node = document.querySelector<HTMLElement>('[data-kui]')!
  Object.defineProperties(node.parentElement!, { clientWidth: { value: 220 }, clientHeight: { value: 220 } })
  Object.defineProperties(node, { offsetWidth: { value: 20 }, offsetHeight: { value: 20 } })
  const animator = animatorOverBody().start()
  expect(node.style.getPropertyValue('--kui-motion-path').match(/[-+]?\d+/g)!.map(Number)).toEqual(expected)
  animator.destroy()
})

it('keeps a zero-sized box finite', () => {
  document.body.innerHTML = '<div><div data-kui="motion-path viewbox:\'0 0 100 100\' anchor:center"></div></div>'
  const animator = animatorOverBody().start()
  const node = document.querySelector<HTMLElement>('[data-kui]')!
  expect(node.style.getPropertyValue('--kui-motion-path')).not.toMatch(/NaN|Infinity/)
  animator.destroy()
})

it('keeps the valid default path intact after rejecting malformed authored data', () => {
  document.body.innerHTML = '<div><div data-kui="motion-path path:\'bad\' viewbox:\'0 0 120 100\'"></div></div>'
  const node = document.querySelector<HTMLElement>('[data-kui]')!
  Object.defineProperties(node.parentElement!, { clientWidth: { value: 140 }, clientHeight: { value: 140 } })
  Object.defineProperties(node, { offsetWidth: { value: 20 }, offsetHeight: { value: 20 } })
  const reporter = collectingReporter()
  const animator = animatorOverBody(reporter).start()
  expect(reporter.messages.join()).toContain('parameter "path"')
  const path = node.style.getPropertyValue('--kui-motion-path')
  expect(path).toMatch(/^"M /)
  expect(path.match(/[-+]?\d+/g)!.map(Number)).toEqual([0, 10, 120, 10])
  animator.destroy()
})

it('refuses fitted geometry on SVG without writing non-finite offsets', () => {
  document.body.innerHTML = '<svg><circle data-kui="motion-path viewbox:\'0 0 100 100\'"/></svg>'
  const reporter = collectingReporter()
  const animator = animatorOverBody(reporter).start()
  expect(reporter.messages).toEqual([expect.stringContaining('HTML traveller')])
  expect(document.querySelector<SVGElement>('circle')!.style.getPropertyValue('--kui-motion-path')).toBe('')
  animator.destroy()
})
