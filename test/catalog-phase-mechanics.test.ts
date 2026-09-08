// @vitest-environment node
//
// Three families the phase census found with zero `phase:`/`transitions:` tokens at all, the same
// shape `gestures/index.ts` and `interaction-reveal.ts` had before they were fixed: an undeclared
// `Preset.phase` is not a permissive default, it is a fifth state `channels.ts`'s `independentPhases`
// treats as conflicting with everything, including itself. `compile.ts`'s `phaseOf` derives `state`
// from a preset's `transitions`, `'idle'` from an authored `repeat:infinite`, and otherwise leaves a
// claim exactly as unknown as it always was.
//
// Two of these families ship `phase: 'idle'` (`scroll-mechanics/presets.ts`,
// `carousel/index.ts`) — every primitive in both claims its channels unconditionally from the moment
// it activates and never releases them, which is `EffectPhase`'s own definition of `idle` and, for
// the scroll family, exactly what `EffectInstance.continuous`'s doc already names as the library's
// canonical unbounded effects. The third (`tween/index.ts`) ships *no* phase on either preset,
// checked against the actual compiled stylesheet rather than assumed: `tween`'s `to` blocks always
// close with an explicit endpoint (never releases, so not `entrance`), and `tween-from`'s release
// depends on whether the author wrote a plain value or a waypoint list for at least one key — a fact
// about the authored spec, not about the preset, so no single static value would be honest for every
// instance of the name.
//
// `idle` does not, on its own, open any new composition — `INDEPENDENT_PHASES` in `core/channels.ts`
// exempts only `entrance|state` and `exit|state`, so an `idle` claim still collides with everything,
// itself included, exactly as an undeclared one did. What changes is that the collision is now a
// checked fact rather than an unknown, and this file's compiled cases exist to prove the fact is the
// right one — that these families really would fight over a shared channel, not that they merely
// look unresolved.
//
// Node environment and the shape (not the file) mirrored from `catalog-gestures-phase.test.ts`:
// `compile`/`parse` are pure, and `composition-phase.test.ts` is scoped to the pre-existing catalog
// and is not extended for these three families — see its own header.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { CAROUSEL_PRESETS } from '../src/effects/carousel/index.js'
import { SCROLL_PRESETS } from '../src/effects/scroll-mechanics/presets.js'
import { TWEEN_PRESETS } from '../src/effects/tween/index.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

const SCROLL_NAMES = SCROLL_PRESETS.map((preset) => preset.name)
const CAROUSEL_NAMES = CAROUSEL_PRESETS.map((preset) => preset.name)
const TWEEN_NAMES = TWEEN_PRESETS.map((preset) => preset.name)

function resolvedPreset(name: string, from: Registry = registry) {
  const resolved = from.resolve(name)
  if (!resolved) throw new Error(`catalog-phase-mechanics.test.ts: "${name}" is not in the catalog`)
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

describe('scroll-mechanics: every preset declares phase: idle', () => {
  it('covers all thirteen names — a name added here without a phase silently reopens the bug', () => {
    expect(SCROLL_NAMES).toEqual([
      'pin-section', 'pin-until', 'pin-spacer', 'stacking-cards',
      'scroll-progress', 'scrollytelling-step',
      'horizontal-scroll',
      'sequence-scrub', 'video-scrub',
      'scroll-spy',
      'smooth-scroll-to', 'scroll-snap-x', 'scroll-snap-y',
    ])
  })

  it.each(SCROLL_NAMES)('declares phase: idle on %s', (name) => {
    expect(resolvedPreset(name).phase).toBe('idle')
  })

  it('declares phase directly rather than through Preset.transitions — nothing here renders a CSS transition', () => {
    // `phaseOf` already derives `'state'` from a preset's `transitions` field, so a preset carrying
    // both would be duplicate data that can only drift from the field it was derived from. Every
    // primitive in this file is `renderer: 'javascript'`, so none of the thirteen has a `transitions`
    // list to derive from in the first place.
    for (const name of SCROLL_NAMES) expect(resolvedPreset(name).transitions, name).toBeUndefined()
  })
})

describe('scroll-mechanics phase does not paper over a real collision', () => {
  it('two scroll primitives sharing "layout" still refuse — idle exempts nothing', () => {
    // `pin` and `scroll-snap` both claim the `layout` channel and both hold it unconditionally for
    // the instance's whole life. `idle|idle` is not in `INDEPENDENT_PHASES`, so this must still warn
    // and keep only the first effect — exactly as it did before either preset had a phase.
    const result = plan('pin-section, scroll-snap-y')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['pin-section'])
  })

  it('an entrance sharing "translate" with a continuous scroll effect still refuses', () => {
    // `fade-up` is `phase: 'entrance'` and releases `translate` once it finishes — but only into
    // whatever is *quiescent* underneath it. `horizontal-scroll` is never quiescent: it writes
    // `translate` on the very first scroll frame, before `fade-up` would have anything to hand off
    // to. `entrance|idle` is not an exempted pair, and it should not be: the two genuinely fight over
    // the same physical property for the whole time both are live.
    const result = plan('fade-up on:enter, horizontal-scroll')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['fade-up'])
  })

  it('a disjoint channel still composes cleanly, unaffected by the phase declaration', () => {
    // `pin-section` claims `layout`/`progress`; `fade-up` claims `opacity`/`translate`. No shared
    // channel, so this always composed — the phase declaration must not have broken it.
    const result = plan('fade-up on:enter, pin-section')
    expect(result.refused).toEqual([])
    expect(result.fx).toEqual(['fade-up', 'pin-section'])
  })
})

describe('carousel: every spatial-ring preset declares phase: idle', () => {
  it('covers all four names', () => {
    expect(CAROUSEL_NAMES).toEqual([
      'carousel-3d', 'carousel-3d-high', 'carousel-3d-low', 'carousel-3d-inside',
    ])
  })

  it.each(CAROUSEL_NAMES)('declares phase: idle on %s', (name) => {
    expect(resolvedPreset(name).phase).toBe('idle')
  })

  it('declares phase directly rather than through Preset.transitions', () => {
    for (const name of CAROUSEL_NAMES) expect(resolvedPreset(name).transitions, name).toBeUndefined()
  })

  it('a ring genuinely conflicts with an entrance sharing the transform shorthand', () => {
    // `flip-in-x` claims `CHANNEL.skew` (the whole `transform` shorthand) and is `phase: 'entrance'`.
    // `spatial-ring` claims the same channel and is `phase: 'idle'` — active from `render()` at
    // `prepare`, before any drag. `entrance|idle` is not exempted, and correctly so: the ring holds
    // `transform` for its whole lifetime, so there is no quiescent moment for the flip to release
    // into.
    const result = plan('carousel-3d, flip-in-x')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['carousel-3d'])
  })
})

describe('tween: deliberately unphased, checked rather than assumed', () => {
  it.each(TWEEN_NAMES)('declares no phase on %s', (name) => {
    // `tween`'s `to` blocks always close with an explicit endpoint (never releases — not
    // `entrance`), and `tween-from`'s release depends on whether the author wrote a plain value or a
    // waypoint list for at least one key in the group, which the preset cannot see. Declaring a
    // fixed value would be right for some instances of the name and silently wrong for others; see
    // `tween/index.ts`'s `TWEEN_PRESETS` comment for the full reasoning.
    expect(resolvedPreset(name).phase).toBeUndefined()
  })

  it.each(TWEEN_NAMES)('declares no transitions on %s', (name) => {
    expect(resolvedPreset(name).transitions).toBeUndefined()
  })

  it('an unphased tween still refuses to compose on a shared channel, exactly as before', () => {
    // `tween x:100` resolves its channel from the authored attribute via `variantFor`, not from a
    // static declaration — but whichever channel it lands on, an unphased claim collides with
    // everything, so this pairing's outcome must be unchanged by this task.
    const result = plan('tween x:100, fade-up on:enter')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['tween'])
  })
})
