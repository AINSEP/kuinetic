// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { resolveParams } from '../src/core/params.js'
import { AMBIENT_PRESETS, registerAmbient } from '../src/effects/catalog/ambient.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/ambient.css', import.meta.url)), 'utf8')

/**
 * A standalone registry, not `createRegistry()`: section J's names are the only ones under test, so
 * a failure here names an ambient bug rather than anything the other twenty-odd catalog modules
 * happened to register alongside it. `catalog-docs.test.ts` covers the wired-up aggregate.
 */
function ambientRegistry(): Registry {
  return registerAmbient(new Registry())
}

describe('ambient catalog', () => {
  it('registers all 15 section J names', () => {
    // 16 -> 15: `noise-overlay` was cut 2026-08-26 (human call, the rewritten version wasn't
    // useful) — commented out in ambient.ts/ambient.css, not deleted, so it can be revived.
    const registry = ambientRegistry()
    expect(AMBIENT_PRESETS).toHaveLength(15)
    expect(AMBIENT_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS preset', () => {
    const missing = AMBIENT_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('declares every primitive as continuous ambient motion that disables under reduced motion', () => {
    const registry = ambientRegistry()
    for (const preset of AMBIENT_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.reducedMotion).toBe('disable')
      expect(resolved?.primitive.perfClass).toBe('continuous')
      expect(resolved?.primitive.defaultActivation).toBe('load')
    }
  })

  it('marks every loop as infinite via its own iteration-count var', () => {
    // Not a bare `animation-iteration-count: infinite;` — that would apply to every track sharing
    // an element's `animation-name` list, making a composed one-shot effect loop forever too. See
    // `iterationCountProperty` in src/core/compile.ts and the header comment in ambient.css.
    const occurrences = css.match(/--kui-fx-[\w-]+-iterations: infinite;/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(14)
  })
})

/**
 * `gradient-border` is the author-coloured two-stop sibling of `gradient-rotate-border`. It animates
 * the native `background-position` rather than an angle held in a custom property — a native
 * property interpolates without needing `@property` registration, so the sweep cannot silently
 * degrade to a discrete 0deg/360deg flip (which is visually indistinguishable from not animating at
 * all).
 *
 * The name carries the `-border` suffix because the rule subtracts its own content box
 * (`mask-composite: exclude`) to leave a ring. Under its old name, `gradient`, the same rule read as
 * a background fill and silently masked away any real content it was applied to.
 */
describe('gradient-border from/to params', () => {
  it('is registered as its own name, distinct from the four-stop gradient-rotate-border', () => {
    const registry = ambientRegistry()
    expect(registry.has('gradient-border')).toBe(true)
    expect(registry.resolve('gradient-border')?.preset.keyframes).toBe('kui-gradient-border')
    expect(registry.resolve('gradient-rotate-border')?.preset.keyframes).toBe(
      'kui-gradient-rotate-border',
    )
  })

  it('does not answer to the old fill-sounding name', () => {
    expect(ambientRegistry().has('gradient')).toBe(false)
  })

  it('writes from:/to: to the ambient-prefixed palette slots', () => {
    const registry = ambientRegistry()
    const { primitive } = registry.resolve('gradient-border')!
    const resolved = resolveParams({ from: 'purple', to: 'yellow' }, primitive.parameters, () => {})
    expect(resolved).toEqual({ '--kui-ambient-c1': 'purple', '--kui-ambient-c2': 'yellow' })
  })

  it('accepts four-digit #RGBA hex, the shorthand the owner reached for first', () => {
    const registry = ambientRegistry()
    const { primitive } = registry.resolve('gradient-border')!
    const warn = vi.fn()
    expect(resolveParams({ from: '#0fff', to: '#00FF00' }, primitive.parameters, warn)).toEqual({
      '--kui-ambient-c1': '#0fff',
      '--kui-ambient-c2': '#00FF00',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves both colors out when unauthored, so the rule fallbacks stand', () => {
    const registry = ambientRegistry()
    const { primitive } = registry.resolve('gradient-border')!
    expect(resolveParams({}, primitive.parameters, () => {})).toEqual({})
  })

  it('repeats the from stop at 100% so the sweep loops seamlessly', () => {
    const rule = css.slice(css.indexOf("[data-kui-fx~='gradient-border'] {"))
    const stops = rule.slice(0, rule.indexOf('}'))
    expect(stops).toContain(
      'var(--kui-ambient-c1, var(--kui-c1, #7c3aed)),\n' +
        '      var(--kui-ambient-c2, var(--kui-c2, #fbbf24)),\n' +
        '      var(--kui-ambient-c1, var(--kui-c1, #7c3aed))',
    )
    expect(css).toContain('@keyframes kui-gradient-border {')
  })

  it('animates a native property, not a custom one, so it needs no @property registration', () => {
    const frames = css.slice(css.indexOf('@keyframes kui-gradient-border {'))
    expect(frames.slice(0, frames.indexOf('}\n  }'))).toContain('background-position:')
  })
})

/**
 * The author palette must not escape section J. `shine-sweep` (interaction.css) and
 * `confetti-burst` (feedback.css) read the unprefixed `--kui-c1`..`--kui-c4`, and custom properties
 * inherit, so an ambient effect that wrote those recoloured every descendant carrying either of
 * them. The prefixed names are what keeps the sharing inside the family.
 */
describe('ambient palette namespacing', () => {
  it('never writes an unprefixed palette slot from any ambient parameter', () => {
    const registry = ambientRegistry()
    for (const preset of AMBIENT_PRESETS) {
      const { primitive } = registry.resolve(preset.name)!
      for (const spec of Object.values(primitive.parameters)) {
        expect(spec.cssProperty).not.toMatch(/^--kui-c[1-4]$/)
      }
    }
  })

  it('reads every prefixed slot through its unprefixed twin, so hand-set --kui-cN still works', () => {
    for (const slot of [1, 2, 3, 4]) {
      const bare = css.split(`var(--kui-c${slot}`).length - 1
      const chained = css.split(`var(--kui-ambient-c${slot}, var(--kui-c${slot}`).length - 1
      expect({ slot, bare }).toEqual({ slot, bare: chained })
    }
  })

  it('shares one palette across both colour primitives, so an outer from: tints a nested name', () => {
    const registry = ambientRegistry()
    const aurora = registry.resolve('aurora')!
    const starfield = registry.resolve('starfield')!
    expect(aurora.primitive.id).not.toBe(starfield.primitive.id)
    expect(aurora.primitive.parameters.from?.cssProperty).toBe(
      starfield.primitive.parameters.from?.cssProperty,
    )
  })
})

/**
 * `to:` used to validate cleanly on all fifteen names and then do nothing on the ten whose rule
 * never reads a second stop — the worst kind of parameter, one that accepts input and discards it.
 * Only the four two-stop names take it now; the single-colour set warns instead.
 *
 * `noise-overlay` was one of the eleven one-stop names; it is cut (commented out, not deleted —
 * see ambient.ts/ambient.css) and so is absent from `ONE_STOP` below rather than left in it, which
 * would resolve to nothing and throw.
 */
describe('to: is only offered where a second stop exists', () => {
  const TWO_STOP = ['gradient-mesh', 'aurora', 'gradient-rotate-border', 'gradient-border']
  const ONE_STOP = [
    'scanline',
    'dot-grid-drift',
    'line-grid-drift',
    'starfield',
    'spotlight-follow',
    'wave-blob',
  ]

  it.each(TWO_STOP)('%s accepts to:', (name) => {
    const registry = ambientRegistry()
    const warn = vi.fn()
    const { primitive } = registry.resolve(name)!
    expect(resolveParams({ to: 'yellow' }, primitive.parameters, warn)).toEqual({
      '--kui-ambient-c2': 'yellow',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(ONE_STOP)('%s warns on to: rather than swallowing it', (name) => {
    const registry = ambientRegistry()
    const warn = vi.fn()
    const { primitive } = registry.resolve(name)!
    expect(resolveParams({ to: 'yellow' }, primitive.parameters, warn)).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown parameter "to"'))
  })

  it.each(ONE_STOP)('%s still takes from:', (name) => {
    const registry = ambientRegistry()
    const warn = vi.fn()
    const { primitive } = registry.resolve(name)!
    expect(resolveParams({ from: 'purple' }, primitive.parameters, warn)).toEqual({
      '--kui-ambient-c1': 'purple',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('names every preset that reads a second stop in its rule', () => {
    // The list above is only trustworthy if it matches the stylesheet. Any rule that reads c2/c3/c4
    // must be a two-stop name; anything else silently regains the swallowing `to:`.
    const registry = ambientRegistry()
    for (const preset of AMBIENT_PRESETS) {
      const start = css.indexOf(`[data-kui-fx~='${preset.name}'] {`)
      if (start === -1) continue
      const rule = css.slice(start, css.indexOf('\n  }', start))
      const readsSecondStop = /--kui-ambient-c[2-4],/.test(rule)
      const takesTo = 'to' in registry.resolve(preset.name)!.primitive.parameters
      expect({ name: preset.name, takesTo }).toEqual({ name: preset.name, takesTo: readsSecondStop })
    }
  })
})
