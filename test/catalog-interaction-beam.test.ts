import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { resolveParams } from '../src/core/params.js'
import { registerInteraction } from '../src/effects/catalog/interaction.js'

// Split out of catalog-interaction.test.ts, which the beam-border parameter cases pushed past
// ESLint's per-file line cap. These read the stylesheet and `resolveParams` output only — none of
// the pointer/DOM rig the parent file needs, so nothing is shared but the two lines below.

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'), 'utf8')

function registry(): Registry {
  return registerInteraction(new Registry())
}

describe('beam-border color param', () => {
  it('writes an authored color to --kui-beam-border-c1 on both beam-border and beam-border-auto', () => {
    const reg = registry()
    for (const name of ['beam-border', 'beam-border-auto']) {
      const { primitive } = reg.resolve(name)!
      const resolved = resolveParams({ color: 'gold' }, primitive.parameters, () => {})
      expect(resolved).toEqual({ '--kui-beam-border-c1': 'gold' })
    }
  })

  it('leaves color out of the resolved output when unauthored, so the default rainbow is untouched', () => {
    const reg = registry()
    const { primitive } = reg.resolve('beam-border-auto')!
    const resolved = resolveParams({}, primitive.parameters, () => {})
    expect(resolved).toEqual({})
  })

  it('chains c2-c4 through c1 in the stylesheet, so one authored color recolors the whole beam', () => {
    expect(css).toContain('var(--kui-beam-border-c2, var(--kui-beam-border-c1, #ffc371))')
    expect(css).toContain('var(--kui-beam-border-c3, var(--kui-beam-border-c1, #4facfe))')
    expect(css).toContain('var(--kui-beam-border-c4, var(--kui-beam-border-c1, #a855f7))')
  })
})

describe('beam-border-auto duration param', () => {
  it('writes an authored duration to its own namespaced property, not the hover variant\'s', () => {
    const reg = registry()
    const { primitive } = reg.resolve('beam-border-auto')!
    const resolved = resolveParams({ duration: '12s' }, primitive.parameters, () => {})
    expect(resolved).toEqual({ '--kui-beam-border-auto-duration': '12s' })
  })

  it('reads --kui-beam-border-auto-duration in the rotation keyframe, not the plain --kui-beam-border-duration', () => {
    // Regression: the rule used to read the hover variant's property name, so an authored
    // `duration:` on `beam-border-auto` silently wrote to a property nothing read.
    const rule = css.slice(css.indexOf("[data-kui-fx~='beam-border-auto']::before {"))
    expect(rule).toContain('var(--kui-beam-border-auto-duration, 4260ms)')
  })
})

/**
 * `inset: 0` on the ring pseudo-element resolves against the host's *padding* box, so a host with
 * its own border renders the beam that far inside its edge. `outset:` is the compensation, and it
 * has to be authored: no CSS length can read `border-width`, and anchor positioning — the one
 * feature that names an anchor's border box — does not apply to a pseudo-element anchored to its
 * own originating element.
 */
describe('beam-border outset param', () => {
  it('writes an authored length to --kui-beam-border-outset on both beam-border and beam-border-auto', () => {
    const reg = registry()
    for (const name of ['beam-border', 'beam-border-auto']) {
      const { primitive } = reg.resolve(name)!
      const resolved = resolveParams({ outset: '1px' }, primitive.parameters, () => {})
      expect(resolved).toEqual({ '--kui-beam-border-outset': '1px' })
    }
  })

  it('defaults to a zero outset, keeping every borderless host pixel-identical', () => {
    expect(css).toContain('inset: calc(-1 * var(--kui-beam-border-outset, 0px));')
  })

  it('rejects a non-length outset rather than writing it into the inset calc', () => {
    const reg = registry()
    const { primitive } = reg.resolve('beam-border-auto')!
    const warn = vi.fn()
    expect(resolveParams({ outset: 'gold' }, primitive.parameters, warn)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })
})
