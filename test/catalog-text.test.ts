// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createRegistry } from '../src/effects/index.js'
import { readEffectParams } from '../src/core/js-params.js'
import { TEXT_CSS_PRESETS, TEXT_JS_PRESETS, TEXT_PRESETS } from '../src/effects/catalog/text.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/text.css', import.meta.url)), 'utf8')

describe('text catalog', () => {
  it('registers all 26 section D names', () => {
    const registry = createRegistry()
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
    const registry = createRegistry()
    for (const preset of TEXT_JS_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.reducedMotion).toBe('disable')
    }
  })

  it('gives duotone/hover-style CSS-tier effects a css-keyframes renderer', () => {
    const registry = createRegistry()
    for (const preset of TEXT_CSS_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.renderer).toBe('css-keyframes')
    }
  })

  it('points marquee and marquee-scroll-linked at the same keyframe and primitive', () => {
    const registry = createRegistry()
    const marquee = registry.resolve('marquee')!
    const scrollLinked = registry.resolve('marquee-scroll-linked')!
    expect(scrollLinked.primitive.id).toBe(marquee.primitive.id)
    expect(scrollLinked.preset.keyframes).toBe(marquee.preset.keyframes)
    expect(marquee.primitive.supportedTimelines).toContain('scroll')
  })

  it('resolves each split-text preset to its documented unit/direction defaults', () => {
    const registry = createRegistry()
    const cases: Array<[string, string, string]> = [
      ['split-chars', 'chars', 'fade'],
      ['split-words', 'words', 'fade'],
      ['split-lines', 'lines', 'fade'],
      ['text-reveal-up', 'words', 'up'],
      ['text-reveal-down', 'words', 'down'],
      ['text-reveal-mask', 'lines', 'mask'],
    ]
    for (const [name, unit, direction] of cases) {
      const resolved = registry.resolve(name)!
      const params = readEffectParams(resolved.preset.params ?? {}, resolved.primitive.parameters, () => {})
      expect(params.text('unit')).toBe(unit)
      expect(params.text('direction')).toBe(direction)
    }
  })

  it('resolves scramble/decode/glitch to distinct charsets', () => {
    const registry = createRegistry()
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
    const registry = createRegistry()
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
    const registry = createRegistry()
    expect(compile(parse('gradient-sweep, text-outline-fill'), registry, 'time').fxNames).toEqual([
      'gradient-sweep',
    ])
  })
})
