// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { resolveConfig, resolveGroupConfig } from '../src/core/element-config.js'
import { planStyles } from '../src/core/style-plan.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { CAPS } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()
const markup = [
  "scroll-progress-ring timeline:'scroll inline --lab-row'",
  "mask-reveal edges:24px timeline:'scroll inline --lab-row' ease:linear",
  "curtain-reveal start-inset:48% timeline:'view block entry 0% entry 100%' ease:linear",
]
const attrs = { source: '', on: null, timeline: null, threshold: null }

function styles(source: string, caps: Partial<Capabilities> = {}) {
  const parsed = parse(source)
  const config = resolveConfig(attrs, parsed)
  const plan = compile(parsed, registry, config.timeline)
  expect(plan.warnings).toEqual([])
  return planStyles({ plan, config, capabilities: { ...CAPS, ...caps }, respectReducedMotion: true })
}

it('compiles the exact lab markup and keeps both bare timeline declarations byte-identical', () => {
  for (const source of markup) styles(source)
  const scroll = styles('scroll-progress-ring timeline:scroll')
  const view = styles('fade-up timeline:view')
  expect(scroll.properties['animation-timeline']).toBe('scroll()')
  expect(scroll.properties['animation-range']).toBe('0% 100%')
  expect(view.properties['animation-timeline']).toBe('view()')
  expect(view.properties['animation-range']).toBe('entry 0% cover 60%')
  expect(styles("fade-up timeline:'view block'").properties).toEqual({ ...view.properties, 'animation-timeline': 'view(block)' })
  expect(styles(markup[0]!).properties['animation-timeline']).toBe('--lab-row')
  expect(styles("curtain-reveal timeline:'scroll x'").properties['animation-timeline']).toBe('scroll(x)')
})

it('keeps timeline axis, source and range together through longhand and scoped overrides', () => {
  const base = resolveConfig({ ...attrs, timeline: 'scroll inline --row 10% 90%' }, parse(''))
  expect(base).toMatchObject({ timeline: 'scroll', timelineAxis: 'inline', timelineName: '--row', range: '10% 90%' })
  const scoped = resolveGroupConfig(base, { timeline: 'view y entry 0% entry 100%' })
  expect(scoped).toMatchObject({ timeline: 'view', timelineAxis: 'y', range: 'entry 0% entry 100%' })
  expect(scoped.timelineName).toBeUndefined()
  const reset = resolveGroupConfig(base, { timeline: 'scroll' })
  expect(reset.timelineAxis).toBeUndefined()
  expect(reset.timelineName).toBeUndefined()
  expect(styles("curtain-reveal timeline:'view --picture'").properties['animation-timeline']).toBe('--picture')
  const rejectedName = resolveConfig({ ...attrs, timeline: 'scroll --bad;name' }, parse(''))
  expect(rejectedName.timelineName).toBeUndefined()
})

it.each(['scrollTimeline', 'scrollTimelineName'] as const)('falls back without a native timeline when %s is missing', capability => {
  const ring = styles(markup[0]!, { [capability]: false })
  expect(ring.properties['animation-timeline']).toBeUndefined()
  expect(ring.gate).toBe('deferred')
  expect(ring.activation).toBe('enter')
  const wipe = styles(markup[2]!, { viewTimeline: false })
  expect(wipe.properties['animation-timeline']).toBeUndefined()
  expect(wipe.activation).toBe('enter')
  expect(styles(markup[2]!, { animationRange: false }).properties['animation-range']).toBeUndefined()
})

it('changes only opted-in mask tracks and preserves ordinary direction variants', () => {
  const edges = styles(markup[1]!)
  expect(edges.properties['animation-name']).toBe('kui-scroll-edges')
  expect(edges.properties['--kui-edge-width']).toBe('24px')
  expect(edges.properties['--kui-edge-size']).toBe('100% 100%')
  const plain = styles('mask-reveal')
  expect(plain.properties['animation-name']).toBe('kui-mask-reveal')
  expect(plain.properties['--kui-edge-image']).toBeUndefined()
  expect(styles('mask-reveal direction:left').properties['--kui-mask-angle']).toBe('270deg')
})

it('preserves the plain curtain clip while retaining start-inset and edge interpolation', () => {
  const css = readFileSync('src/css/media.css', 'utf8')
  expect(css).not.toContain("[data-kui-fx~='curtain-reveal'][data-kui-state='ready']")
  expect(css).toContain('inset(0 var(--kui-wipe-start-inset, 50%))')
  expect(css).toContain("syntax: '<length>'")
  expect(css).toMatch(/from\s*\{\s*--kui-edge-start: 0px;/)
  expect(css).toMatch(/to\s*\{\s*--kui-edge-start:[^;]+;\s*--kui-edge-end: 0px;/)
})
