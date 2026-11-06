// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { resolveConfig } from '../src/core/element-config.js'
import { planStyles } from '../src/core/style-plan.js'
import { CAPS } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()
const image = 'curtain-reveal start-size:60vmin timeline:pin ease:linear, parallax-scale from:0.35 scale:1 timeline:pin ease:linear'

function compiled(source: string) {
  const parsed = parse(source)
  const config = resolveConfig({ source, on: null, timeline: null, threshold: null }, parsed)
  const plan = compile(parsed, registry, config.timeline)
  return { plan, config }
}

it('keeps clipping and scale together on the pin timeline in the exact lab markup', () => {
  expect(compiled('pin-section distance:150vh').plan.warnings).toEqual([])
  const { plan, config } = compiled(image)
  expect(plan.warnings).toEqual([])
  expect(plan.fxNames).toEqual(['curtain-reveal', 'parallax-scale'])
  expect(plan.channels).toEqual(['clip', 'scale'])
  const styles = planStyles({ plan, config, capabilities: CAPS, respectReducedMotion: true })
  expect(styles.gate).toBe('scrubbed')
  expect(styles.properties['animation-name']).toBe('kui-curtain-square, kui-parallax-scale')
  expect(styles.properties['animation-play-state']).toBe('paused')
  expect(styles.properties['animation-delay']).toContain('--kui-progress')
  expect(styles.properties['--kui-wipe-start-size']).toBe('60vmin')
  expect(plan.jsEffects).toEqual([])
  expect(plan.reducedMotion).toBe('disable')
})

it('selects a square crop only when requested and keeps the original tracks and defaults', () => {
  const plain = compiled('curtain-reveal timeline:view, parallax-scale timeline:view').plan
  expect(plain.warnings).toEqual([])
  expect(plain.vars).toEqual({})
  expect(plain.keyframeNames).toEqual(['kui-curtain-reveal', 'kui-parallax-scale'])
  expect(compiled('curtain-reveal start-inset:48% timeline:scroll').plan.warnings).toEqual([])
  const square = compiled('curtain-reveal start-size:40px').plan
  expect(square.vars['--kui-wipe-start-size']).toBe('40px')
  expect(compiled('wipe-up start-size:40px').plan.warnings).not.toEqual([])
  expect(compiled('curtain-reveal start-size:bad').plan.warnings).not.toEqual([])
  const css = readFileSync('src/css/media.css', 'utf8')
  expect(css).toContain('inset(0 var(--kui-wipe-start-inset, 50%))')
  expect(css).toContain('@keyframes kui-curtain-square')
  expect(css.match(/max\(0px, calc\(50% - var\(--kui-wipe-start-size, 60vmin\) \/ 2\)\)/g)).toHaveLength(2)
})
