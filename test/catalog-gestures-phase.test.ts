//
// `src/effects/gestures/index.ts`'s thirteen presets shipped with no `Preset.phase` at all, which
// is not a permissive default — `compile.ts`'s `phaseOf` treats an undeclared phase as a fact
// nothing is known about, and an unknown phase conflicts with everything, including another
// unknown. So `data-kui="fade-up on:enter, drag"` used to hit `findConflicts` (both segments claim
// `translate`), fail the additive rescue (`draggable` is `renderer: 'javascript'`, and only
// `css-keyframes` tracks qualify — see `channels.ts`'s `additivelyComposable`), find no registered
// combo for the pair, and silently keep only `fade-up`: an entrance plus a drag on one element did
// nothing, with no warning to the author. `interaction-reveal.ts`'s four presets
// (`masked-label-swap*`, `hover-intent`) shipped the identical gap and were fixed the same way
// hours earlier — this file is the second family, not a new kind of bug.
//
// The node environment is not optional here either: `compile`/`parse` are pure, but this file
// otherwise mirrors `composition-phase.test.ts`'s shape rather than sharing it — that file is
// scoped to the pre-existing catalog and is not to be extended for this family (see its own
// header). Node keeps this suite independent of whichever environment vitest's default happens to
// be for the rest of the run.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { GESTURE_PRESETS } from '../src/effects/gestures/index.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

const GESTURE_NAMES = GESTURE_PRESETS.map((preset) => preset.name)

function resolvedPreset(name: string, from: Registry = registry) {
  const resolved = from.resolve(name)
  if (!resolved) throw new Error(`catalog-gestures-phase.test.ts: "${name}" is not in the catalog`)
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

describe('every gesture preset declares phase: state', () => {
  it('covers all thirteen names — a name added here without a phase silently reopens the bug', () => {
    expect(GESTURE_NAMES).toEqual([
      'drag', 'drag-x', 'drag-y', 'drag-inertia', 'throwable', 'elastic-pull', 'rubber-band',
      'snap-back', 'swipe', 'swipe-x', 'long-press', 'magnetic', 'magnetic-snap',
    ])
  })

  it.each(GESTURE_NAMES)('declares phase: state on %s', (name) => {
    expect(resolvedPreset(name).phase).toBe('state')
  })

  it('declares phase directly rather than through Preset.transitions — nothing here is CSS-rendered', () => {
    // `phaseOf` already derives `'state'` from a preset's `transitions` field, so a preset
    // carrying both would be duplicate data that can only drift from the field it was derived
    // from. Every primitive in this file is `renderer: 'javascript'` (drags, swipes, presses,
    // magnetic pull are all pointer-driven, not a CSS transition on the host box), so none of the
    // thirteen has a `transitions` list to derive from in the first place.
    for (const name of GESTURE_NAMES) expect(resolvedPreset(name).transitions, name).toBeUndefined()
  })
})

describe('an entrance now composes with a drag on the same channel', () => {
  // Both orders, for the same reason `composition-phase.test.ts`'s own `COMPOSES` table checks
  // both orders of `fade-up, lift`: authoring order decided which effect the old undeclared-phase
  // code kept, and a table frozen around one spelling would miss a rule that only works
  // left-to-right.
  it.each([
    ['fade-up on:enter, drag', ['fade-up', 'drag']],
    ['drag, fade-up on:enter', ['drag', 'fade-up']],
    ['fade-up on:enter, throwable', ['fade-up', 'throwable']],
    ['fade-up on:enter, rubber-band', ['fade-up', 'rubber-band']],
  ])('%s composes both effects with no "cannot compose" warning', (attribute, expectedFx) => {
    const result = plan(attribute)
    expect(result.refused).toEqual([])
    expect(result.fx).toEqual(expectedFx)
  })

  it('drag alone beside drag alone still refuses — a real same-name clash, not a phase gap', () => {
    // `additiveResolution` in `channels.ts` refuses to rescue a name clashing with itself even
    // when it would otherwise qualify, on the theory that repeating a name is far more likely a
    // typo than a request to sum the effect with itself. Two same-phase claims on one channel are
    // a genuine clash regardless — `state, state` is exactly the pair `INDEPENDENT_PHASES` in
    // `channels.ts` does *not* exempt — so this attribute should still warn and keep only the
    // first.
    const result = plan('drag, drag-y')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['drag'])
  })
})
