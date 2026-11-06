// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { build } from './support/js-effect-harness.js'
import { atRuleBlocks, ruleBodies } from './support/css-scan.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()
const css = readFileSync('src/css/interaction.css', 'utf8')
const host = "[data-kui-fx~='group-expand']"
const card = `${host} > *`
const content = `${card} [data-kui-expand-content]`
const query = '@media (min-width: 48rem) and (hover: hover) and (pointer: fine)'

afterEach(() => vi.restoreAllMocks())

it('compiles exact lab markup and changes only the new group layout', () => {
  for (const source of ['group-expand grow:4 400ms', 'group-expand', 'fade-in, group-expand']) {
    const plan = compile(parse(source), registry, 'time')
    expect(plan.warnings).toEqual([])
  }
  expect(compile(parse('group-expand'), registry, 'time').declarations).toEqual({})
  expect(compile(parse('group-expand grow:0'), registry, 'time').warnings).not.toEqual([])
  expect(compile(parse('group-dim, group-expand'), registry, 'time').warnings).not.toEqual([])
  const target = compile(parse('group-expand target:a'), registry, 'time')
  expect(target.warnings.join(' ')).toContain('cannot be retargeted')
  expect(registry.resolve('group-expand')!.primitive.perfClass).toBe('layout')
})

it('uses the existing timing preparation without event listeners or geometry reads', () => {
  const animator = build('<div data-kui="group-expand grow:4 400ms 25ms linear"><a href="#one">One<span data-kui-expand-content>Detail</span></a><a href="#two">Two</a></div>')
  const node = document.querySelector<HTMLElement>('[data-kui]')!
  const listen = vi.spyOn(node, 'addEventListener')
  const measure = vi.spyOn(node, 'getBoundingClientRect')
  animator.start()
  expect(node.style.getPropertyValue('--kui-group-expand-duration')).toBe('400ms')
  expect(node.style.getPropertyValue('--kui-group-expand-delay')).toBe('25ms')
  expect(node.style.getPropertyValue('--kui-group-expand-ease')).toBe('linear')
  expect(node.style.getPropertyValue('--kui-group-expand-grow')).toBe('4')
  expect(listen).not.toHaveBeenCalled()
  expect(measure).not.toHaveBeenCalled()
  expect(node.querySelector('a')!.getAttribute('href')).toBe('#one')
  animator.destroy()
  expect(node.style.getPropertyValue('--kui-group-expand-duration')).toBe('')
  expect(node.style.getPropertyValue('--kui-group-expand-grow')).toBe('')
})

it('stacks visible content by default and bounds long content before enabling desktop hover', () => {
  expect(ruleBodies(css, host)[0]).toContain('flex-direction: column;')
  expect(ruleBodies(css, card)[0]).toContain('min-inline-size: 0;')
  expect(ruleBodies(css, card)[0]).toContain('overflow: clip;')
  expect(ruleBodies(css, card)[0]).toContain('overflow-wrap: anywhere;')
  const desktop = atRuleBlocks(css, query)
  expect(desktop).toHaveLength(1)
  expect(ruleBodies(css.replace(desktop[0]!, ''), content).join()).not.toContain('hidden')
  expect(ruleBodies(desktop[0]!, host)[0]).toContain('flex-direction: row;')
  expect(ruleBodies(desktop[0]!, card)[0]).toContain('flex: 1 1 0;')
  expect(ruleBodies(desktop[0]!, card)[0]).toContain('transition: flex-grow')
  expect(ruleBodies(desktop[0]!, card)[0]).not.toContain('--kui-group-expand-delay')
  expect(ruleBodies(desktop[0]!, content)[0]).toContain('transition: opacity')
  expect(ruleBodies(desktop[0]!, content)[0]).toContain('visibility var(--kui-group-expand-duration')
  expect(ruleBodies(desktop[0]!, content)[0]).not.toContain('--kui-group-expand-delay')
  expect(ruleBodies(desktop[0]!, content)[0]).toContain('opacity: 0;')
  expect(ruleBodies(desktop[0]!, content)[0]).toContain('visibility: hidden;')
  const supported = atRuleBlocks(css, '@supports selector(:has(*))')
  expect(supported).toHaveLength(1)
  expect(supported[0]).toContain(query)
  const fallback = css.replace(supported[0]!, '')
  expect(ruleBodies(fallback, content).join()).not.toContain('visibility:')
  expect(ruleBodies(fallback, host).join()).not.toContain('flex-direction: row;')
})

it('gives focus priority over a different hovered card and removes reduced-motion delay', () => {
  const desktop = atRuleBlocks(css, query)[0]!
  const focused = `${host} > :is(:focus-visible, :has(:focus-visible))`
  const hovered = `${host}:not(:has(:focus-visible)) > :hover`
  expect(desktop).not.toContain(':focus-within')
  expect(ruleBodies(desktop, focused)[0]).toContain('flex-grow: var(--kui-group-expand-grow, 4);')
  expect(ruleBodies(desktop, hovered)[0]).toContain('flex-grow: var(--kui-group-expand-grow, 4);')
  expect(ruleBodies(desktop, `${focused} [data-kui-expand-content]`)[0]).toContain('visibility: visible;')
  expect(ruleBodies(desktop, `${hovered} [data-kui-expand-content]`)[0]).toContain('visibility: visible;')
  for (const selector of [focused, hovered, `${focused} [data-kui-expand-content]`, `${hovered} [data-kui-expand-content]`]) {
    expect(ruleBodies(desktop, selector)[0]).toContain('transition-delay: var(--kui-group-expand-delay, 0ms);')
  }
  const reduced = atRuleBlocks(css, '@media (prefers-reduced-motion: reduce)').join('\n')
  for (const selector of [card, content]) {
    expect(ruleBodies(reduced, selector).join('\n')).toContain('transition-duration: 0s;')
    expect(ruleBodies(reduced, selector).join('\n')).toContain('--kui-group-expand-delay: 0ms;')
  }
})
