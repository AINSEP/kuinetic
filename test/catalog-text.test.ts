// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { readEffectParams } from '../src/core/js-params.js'
import { TEXT_CSS_PRESETS, TEXT_JS_PRESETS, TEXT_PRESETS } from '../src/effects/catalog/text.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/text.css', import.meta.url)), 'utf8')

describe('text catalog', () => {
  it('registers all 26 section D names', () => {
    const registry = catalogRegistry()
    expect(TEXT_PRESETS).toHaveLength(26)
    expect(TEXT_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = TEXT_CSS_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('keeps every JS-tier primitive at reducedMotion "disable"', () => {
    const registry = catalogRegistry()
    for (const preset of TEXT_JS_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.reducedMotion).toBe('disable')
    }
  })

  it('gives duotone/hover-style CSS-tier effects a css-keyframes renderer', () => {
    const registry = catalogRegistry()
    for (const preset of TEXT_CSS_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.renderer).toBe('css-keyframes')
    }
  })

  it('points marquee and marquee-scroll-linked at the same keyframe and primitive', () => {
    const registry = catalogRegistry()
    const marquee = registry.resolve('marquee')!
    const scrollLinked = registry.resolve('marquee-scroll-linked')!
    expect(scrollLinked.primitive.id).toBe(marquee.primitive.id)
    expect(scrollLinked.preset.keyframes).toBe(marquee.preset.keyframes)
    expect(marquee.primitive.supportedTimelines).toContain('scroll')
  })

  it('resolves each split-text preset to its documented unit/direction/stagger defaults', () => {
    const registry = catalogRegistry()
    const cases: Array<[string, string, string, number]> = [
      ['split-chars', 'chars', 'fade', 30],
      ['split-words', 'words', 'fade', 90],
      ['split-lines', 'lines', 'fade', 160],
      ['text-reveal-up', 'words', 'up', 90],
      ['text-reveal-down', 'words', 'down', 90],
      ['text-reveal-mask', 'lines', 'mask', 160],
    ]
    for (const [name, unit, direction, staggerMs] of cases) {
      const resolved = registry.resolve(name)!
      const params = readEffectParams(resolved.preset.params ?? {}, resolved.primitive.parameters, () => {})
      expect(params.text('unit')).toBe(unit)
      expect(params.text('direction')).toBe(direction)
      expect(params.ms('stagger', 0)).toBe(staggerMs)
    }
  })

  it('scales each split-text preset stagger with its unit size', () => {
    // The bug this pins: one 30ms stagger for every unit. It reads on 40 characters (1170ms of
    // spread) and vanishes on 6 words (150ms) or 3 lines (60ms) — both were reported as "not
    // animating" when they were animating, just with nothing to see. Fewer, bigger units need a
    // proportionally bigger gap, so the ordering below is the invariant, not the exact numbers.
    const registry = catalogRegistry()
    const staggerOf = (name: string): number => {
      const resolved = registry.resolve(name)!
      return readEffectParams(
        resolved.preset.params ?? {},
        resolved.primitive.parameters,
        () => {},
      ).ms('stagger', 0)
    }
    expect(staggerOf('split-chars')).toBeLessThan(staggerOf('split-words'))
    expect(staggerOf('split-words')).toBeLessThan(staggerOf('split-lines'))
  })

  it('lets an authored stagger override the preset default', () => {
    // `js-effect-preparer` spreads authored `spec.params` over the preset's, so the per-unit
    // defaults above stay defaults — `split-words stagger:200ms` has to still win.
    const registry = catalogRegistry()
    const resolved = registry.resolve('split-words')!
    const params = readEffectParams(
      { ...resolved.preset.params, stagger: '200ms' },
      resolved.primitive.parameters,
      () => {},
    )
    expect(params.ms('stagger', 0)).toBe(200)
  })

  it('resolves scramble/decode/glitch to distinct charsets', () => {
    const registry = catalogRegistry()
    const cases: Array<[string, string]> = [
      ['scramble', 'upper'],
      ['decode', 'binary'],
      ['glitch', 'symbols'],
    ]
    for (const [name, charset] of cases) {
      const resolved = registry.resolve(name)!
      const params = readEffectParams(resolved.preset.params ?? {}, resolved.primitive.parameters, () => {})
      expect(params.text('charset')).toBe(charset)
    }
  })

  it('composes underline-draw or highlight-sweep with text-outline-fill — they touch disjoint channels', () => {
    const registry = catalogRegistry()
    for (const bg of ['underline-draw', 'highlight-sweep']) {
      expect(compile(parse(`${bg}, text-outline-fill`), registry, 'time').fxNames).toEqual([
        bg,
        'text-outline-fill',
      ])
      expect(compile(parse(`text-outline-fill, ${bg}`), registry, 'time').fxNames).toEqual([
        'text-outline-fill',
        bg,
      ])
    }
  })

  it('still flags gradient-sweep against text-outline-fill as a real glyph-fill conflict', () => {
    const registry = catalogRegistry()
    expect(compile(parse('gradient-sweep, text-outline-fill'), registry, 'time').fxNames).toEqual([
      'gradient-sweep',
    ])
  })
})
