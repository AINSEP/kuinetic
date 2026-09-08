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
  // The literal is a deliberate speed bump, not a value to be re-derived from `TEXT_PRESETS` —
  // a self-referential count would assert nothing. Bumping it means an effect was added or
  // removed on purpose; `docs/catalog.md`'s section D heading and its row in the totals table
  // state the same number and have to move with it. Rename the test too, or the next reader
  // trusts a title that no longer matches what it checks.
  it('registers all 27 section D names', () => {
    const registry = catalogRegistry()
    expect(TEXT_PRESETS).toHaveLength(27)
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

/**
 * `var-axis` — the generic variable-font axis.
 *
 * The three older `var-*` names animate high-level CSS properties and need no grammar of their
 * own. This one carries an authored OpenType tag all the way into a stylesheet, which is the only
 * place in the catalog where a value's *quoting* is load-bearing: `font-variation-settings` takes
 * a `<string>`, so `--kui-axis: wght` invalidates the whole declaration and `--kui-axis: "wght"`
 * works. Nothing else in the library has that shape, so nothing else would have caught it.
 *
 * Every assertion here reads the compiled custom property rather than the primitive's schema.
 * `varAxisVariant` synthesises the accepted spelling per spec — a schema read would show the
 * declared, deliberately-empty `keywords` list and prove nothing about what an author can write.
 */
describe('var-axis', () => {
  const registry = catalogRegistry()
  const varsFor = (attribute: string): Record<string, string> =>
    compile(parse(attribute), registry, 'time').vars

  it('quotes the authored tag, because font-variation-settings takes a string', () => {
    expect(varsFor('var-axis axis:GRAD from:0 to:150')).toEqual({
      '--kui-axis': '"GRAD"',
      '--kui-from-axis': '0',
      '--kui-to-axis': '150',
    })
  })

  it('preserves case in both directions, which is how a font tells the two apart', () => {
    // Registered axes are lowercase, vendor axes uppercase, and a font carries the exact spelling.
    // A helpful `.toLowerCase()` here would turn every vendor axis into a tag no font has — and
    // `font-variation-settings` ignores an unknown axis silently, so the text would simply not move.
    expect(varsFor('var-axis axis:wght')['--kui-axis']).toBe('"wght"')
    expect(varsFor('var-axis axis:CASL')['--kui-axis']).toBe('"CASL"')
    expect(varsFor('var-axis axis:GR4D')['--kui-axis']).toBe('"GR4D"')
  })

  it('takes negative and out-of-range endpoints, because an axis range belongs to the font', () => {
    // `GRAD` runs -200 to 150 and `opsz` 8 to 144, so any bound this schema could state would be
    // wrong for most axes. CSS Fonts clamps a value to what the font declares, which is the right
    // behaviour for "past the end" and is not something a validator should pre-empt.
    expect(varsFor('var-axis axis:GRAD from:-200 to:150')).toMatchObject({
      '--kui-from-axis': '-200',
      '--kui-to-axis': '150',
    })
  })

  it('writes nothing at all when the author writes nothing', () => {
    // The stylesheet's own `var(--kui-axis, "wght")` fallbacks are then in force, which is the
    // contract every keyframe block in text.css keeps: an unauthored element renders identically
    // whether or not the compiler ever wrote a custom property.
    expect(varsFor('var-axis')).toEqual({})
  })

  it('refuses a tag that is not four characters, and drops it rather than substituting one', () => {
    const parsed = parse('var-axis axis:TOOLONG')
    const plan = compile(parsed, registry, 'time')
    expect(plan.vars['--kui-axis']).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('is not an OpenType axis tag')
  })

  it('refuses a tag carrying a declaration escape', () => {
    // The reason the tag is validated at all. It is the one authored value in the catalog that
    // reaches a stylesheet inside quotes this code adds itself, so an unchecked `";color:red` would
    // be the library writing an author's CSS for them.
    const plan = compile(parse('var-axis axis:"BAD;color:red"'), registry, 'time')
    expect(plan.vars['--kui-axis']).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('is not an OpenType axis tag')
  })

  it('refuses to compose with var-weight, which writes the same glyph shape', () => {
    // `font-variation-settings` overrides `font-weight` for any axis it names, so this pair is a
    // real collision even though the two properties have different names. Both primitives declare
    // channel `font`, and `test/support/channel-properties.ts` files the property there to match.
    expect(compile(parse('var-weight, var-axis'), registry, 'time').fxNames).toEqual(['var-weight'])
    expect(compile(parse('var-axis, var-axis'), registry, 'time').fxNames).toEqual(['var-axis'])
  })

  it('composes with an effect on a disjoint channel', () => {
    expect(compile(parse('var-axis, fade-up'), registry, 'time').fxNames).toEqual([
      'var-axis',
      'fade-up',
    ])
  })
})
