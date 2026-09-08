// @vitest-environment node
//
// The phase decision for the three presets `catalog/materials.ts` and
// `catalog/view-transitions.ts` own: `glass`, `page-morph` (primitive `view-morph`), and
// `view-swap`. Two of the three were left deliberately unphased — an undeclared `Preset.phase` is
// not a permissive default, `compile.ts`'s `phaseOf` treats it as "nothing is known", which
// conflicts with everything including itself, exactly as the library behaved before the field
// existed — and the third (`view-swap`) was given `phase: 'state'`. This file is the compiled
// proof for both halves of that call, not just a record of the values.
//
// The node environment is not optional: `compile`/`parse` are pure and need no DOM, and this
// mirrors `composition-phase.test.ts` and `catalog-gestures-phase.test.ts`'s own choice for the
// same reason.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

function resolvedPreset(name: string, from: Registry = registry) {
  const resolved = from.resolve(name)
  if (!resolved) throw new Error(`catalog-phase-materials.test.ts: "${name}" is not in the catalog`)
  return resolved.preset
}

/** What an author ends up with for one attribute: the effects that survived, and any refusal. */
function plan(attribute: string) {
  const compiled = compile(parse(attribute), registry, 'time')
  return {
    fx: compiled.fxNames,
    refused: compiled.warnings.filter((message) => message.includes('cannot compose')),
  }
}

describe('the three declarations this file is the record of', () => {
  it('glass stays unphased — see materials.ts for the four-values-considered reasoning', () => {
    expect(resolvedPreset('glass').phase).toBeUndefined()
  })

  it('page-morph stays unphased — a static property write has no lifecycle to name', () => {
    expect(resolvedPreset('page-morph').phase).toBeUndefined()
  })

  it('view-swap declares phase: state — a discrete, visitor-driven toggle', () => {
    expect(resolvedPreset('view-swap').phase).toBe('state')
  })

  it('none of the three also declares transitions — phaseOf must never be asked to pick one', () => {
    // `phaseOf` derives `'state'` from `Preset.transitions` when present; declaring both `phase`
    // and `transitions` on one preset would be duplicate data that can only drift from the field
    // it was derived from. None of the three primitives here renders through a CSS transition on
    // its own host box in the first place (`glass` paints an unconditional rule with no
    // transition, `view-morph` writes one property once, `view-swap` flips an attribute on a
    // *different* element), so none has a `transitions` list to derive from either.
    for (const name of ['glass', 'page-morph', 'view-swap']) {
      expect(resolvedPreset(name).transitions, name).toBeUndefined()
    }
  })
})

describe('leaving glass and page-morph unphased is correct, not just silent', () => {
  it('glass still refuses a second effect permanently painting the same host background', () => {
    // `scanline` is one of `ambient-tint`'s six presets — `phase: 'idle'`, `background` channel,
    // an unbounded loop that never yields it. Two unphased/idle claims on the same channel is
    // exactly the genuine, permanent fight this axis exists to keep refusing; `idle` is not a
    // member of either pair `channels.ts`'s `INDEPENDENT_PHASES` exempts, so this holds whichever
    // side of the pair actually carries the declaration.
    const result = plan('glass, scanline')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['glass'])
  })

  it('glass against itself still refuses as a same-name clash, not a phase gap', () => {
    const result = plan('glass, glass')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['glass'])
  })

  it('page-morph against itself still refuses — the one pair its own channel could ever clash on', () => {
    // `view-transition-name` is `view-morph`'s only channel and no other primitive in the catalog
    // claims it, so a repeated `page-morph, page-morph` is the sole case an undeclared phase here
    // has any effect on at all, and it is supposed to still refuse.
    const result = plan('page-morph, page-morph')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['page-morph'])
  })
})

describe('view-swap composes with the pairing its own module doc calls the headline use case', () => {
  it('page-morph, view-swap survives on one element in both authoring orders', () => {
    // Disjoint channels (`view-transition-name` vs `view-transition-run`) already made this
    // compose before either preset had a phase opinion — the point of these two assertions is
    // that declaring `state` on `view-swap` did not regress it.
    for (const attribute of ['page-morph, view-swap', 'view-swap, page-morph']) {
      const result = plan(attribute)
      expect(result.refused, attribute).toEqual([])
      expect(result.fx, attribute).toHaveLength(2)
    }
  })

  it('view-swap against itself still refuses as a same-name clash', () => {
    // `state, state` is not one of `INDEPENDENT_PHASES`'s exempted pairs even before the
    // same-name-typo rule in `additiveResolution` is reached, so this refuses on two independent
    // grounds and either one failing would be a real regression.
    const result = plan('view-swap, view-swap')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['view-swap'])
  })
})
