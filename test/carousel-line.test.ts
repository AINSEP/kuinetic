// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

let animator: Animator | undefined
function mount(effect: string, { count = 12, slide = '<a href="#art"><img alt="Art"></a>', after = '', hostStyle = '' } = {}) {
  document.body.innerHTML = `<div data-kui="${effect}" style="${hostStyle}">${slide.repeat(count)}</div>${after}`
  const host = document.body.firstElementChild as HTMLElement
  Object.defineProperty(host, 'offsetWidth', { value: 600 })
  const reads = vi.fn()
  ;[...host.children].forEach((child, i) => {
    Object.defineProperty(child, 'offsetLeft', { get: () => { reads(); return i * 180 } })
    Object.defineProperty(child, 'offsetWidth', { value: 160 })
  })
  const reporter = collectingReporter()
  animator = animatorOverBody(reporter)
  animator.start()
  return { host, reads, reporter }
}
const place = (host: HTMLElement, node: HTMLElement): number =>
  parseFloat(node.style.getPropertyValue('--kui-row-centre')) + parseFloat(node.style.getPropertyValue('--kui-row-cycle')) +
  parseFloat(host.style.getPropertyValue('--kui-row-x')) - 300
afterEach(() => { animator?.destroy(); animator = undefined; vi.restoreAllMocks(); document.body.replaceChildren() })

it('places a line from measured centres, recycles only past its faded end, and restores ownership', () => {
  const { host, reads, reporter } = mount('carousel-loop shape:line rise:-36px depth:70px yaw:-25deg')
  expect(reporter.messages).toEqual([])
  expect(host.getAttribute('data-kui-row-shape')).toBe('line')
  expect(host.getAttribute('data-kui-row-static')).toBe('false')
  expect(host.style.getPropertyValue('--kui-line-rise-ratio')).toBe('-0.2')
  // Twelve strides of 180: half a cycle is 1080, less one stride of animated travel.
  const end = 900
  expect(host.style.getPropertyValue('--kui-line-high')).toBe(`${end}px`)
  expect(host.style.getPropertyValue('--kui-line-low')).toBe(`${-end}px`)
  expect((host.children[1] as HTMLElement).style.getPropertyValue('--kui-row-centre')).toBe('260px')
  reads.mockClear()
  for (let i = 0; i < 24; i++) {
    const nodes = [...host.children] as HTMLElement[]
    const before = nodes.map(node => place(host, node))
    const shifts = nodes.map(node => node.style.getPropertyValue('--kui-row-cycle'))
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    nodes.forEach((node, j) => {
      if (node.style.getPropertyValue('--kui-row-cycle') === shifts[j]) return
      expect(Math.abs(before[j]!)).toBeGreaterThanOrEqual(end)
      expect(Math.abs(place(host, node))).toBeGreaterThanOrEqual(end)
    })
  }
  expect(host.getAttribute('data-kui-step')).toBe('0')
  expect(reads).not.toHaveBeenCalled()
  animator!.destroy()
  animator = undefined
  expect(host.hasAttribute('data-kui-row-shape')).toBe(false)
  expect(host.style.getPropertyValue('--kui-line-high')).toBe('')
})

it('keeps a card that is still on the line through a long jump', () => {
  const buttons = Array.from({ length: 12 }, (_, i) => `<button class="dot">${i}</button>`).join('')
  const { host } = mount('carousel-loop shape:line jump:.dot', { after: buttons })
  const card = host.children[8] as HTMLElement
  expect(place(host, card)).toBe(-720)
  const cycle = card.style.getPropertyValue('--kui-row-cycle')
  document.querySelectorAll<HTMLButtonElement>('.dot')[6]!.click()
  expect(host.getAttribute('data-kui-step')).toBe('6')
  expect(card.style.getPropertyValue('--kui-row-cycle')).toBe(cycle)
})

it('stays a static line that never fades when too short to loop, and says so once', () => {
  const { host, reporter } = mount('carousel-loop shape:line', { count: 3 })
  expect(reporter.messages.join()).toContain('at least six cards')
  expect(host.getAttribute('data-kui-row-static')).toBe('true')
  expect(host.style.getPropertyValue('--kui-line-high')).toBe('1000000px')
  expect(host.style.getPropertyValue('--kui-line-low')).toBe('-1000000px')
  const count = reporter.messages.length
  host.append(document.createElement('a'))
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(host.style.getPropertyValue('--kui-item-count')).toBe('4')
  expect(reporter.messages.length).toBe(count)
})

it('fades near the camera before a card can reach it, on whichever end depth brings closer', () => {
  const towards = mount('carousel-loop shape:line depth:360px perspective:720px').host
  // 2 px of depth per px of travel: half of 720 is reached 180 px from centre.
  expect(towards.style.getPropertyValue('--kui-line-low')).toBe('-180px')
  expect(towards.style.getPropertyValue('--kui-line-high')).toBe('900px')
  animator!.destroy()
  const away = mount('carousel-loop shape:line depth:-360px perspective:720px').host
  expect(away.style.getPropertyValue('--kui-line-low')).toBe('-900px')
  expect(away.style.getPropertyValue('--kui-line-high')).toBe('180px')
})

it('names a property that flattens the line host', () => {
  const { reporter } = mount('carousel-loop shape:line', { hostStyle: 'overflow: hidden' })
  expect(reporter.messages.join()).toContain('shape:line overflow flattens the host')
})

it('copies far enough to cover the view twice', () => {
  const image = '<img src="/art.jpg" alt="Art">'
  expect(mount('carousel-loop copies:auto', { count: 3, slide: image }).host.querySelectorAll('[data-kui-row-copy]').length).toBe(3)
  animator!.destroy()
  const line = mount('carousel-loop shape:line copies:auto', { count: 3, slide: image }).host
  expect(line.querySelectorAll('[data-kui-row-copy]').length).toBe(9)
  expect(line.getAttribute('data-kui-row-static')).toBe('false')
})

it('does not add line geometry or claims to ordinary rows', () => {
  const { host, reporter } = mount('carousel-loop, pop')
  expect(reporter.messages).toEqual([])
  expect(host.hasAttribute('data-kui-row-shape')).toBe(false)
  expect(host.style.getPropertyValue('--kui-line-rise-ratio')).toBe('')
  const registry = catalogRegistry()
  expect(compile(parse('carousel-loop, pop'), registry, 'time').warnings).toEqual([])
  expect(compile(parse('carousel-loop, fade-in'), registry, 'time').warnings.join()).not.toContain('opacity')
  expect(compile(parse('carousel-loop shape:line, fade-in'), registry, 'time').warnings.join()).toContain('opacity')
})

it.each(['rise:10px', 'depth:10px', 'yaw:10deg', 'perspective:900px'])('diagnoses %s without shape:line', param => {
  expect(compile(parse(`carousel-loop ${param}`), catalogRegistry(), 'time').warnings.join()).toContain('require shape:line')
})

it.each([
  'carousel-loop shape:line rise:-60px depth:120px perspective:1000px yaw:-25deg spin:30s',
  'carousel-loop shape:line rise:-75px depth:150px perspective:1000px yaw:-25deg timeline:scroll distance:200vh speed:true',
])('compiles exact lab markup: %s', effect => {
  expect(compile(parse(effect), catalogRegistry(), 'time').warnings).toEqual([])
})
