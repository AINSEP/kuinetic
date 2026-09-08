// @vitest-environment node
//
// The phase decisions for the three families `src/effects/forms/index.ts`,
// `src/effects/layout/presets.ts`, and `src/effects/catalog/numbers.ts` own: 13 + 9 + 13 = 35
// presets that shipped with no `Preset.phase` at all — the same gap `interaction-reveal.ts` and
// `gestures/index.ts` had, fixed the same way earlier the same day (see
// `catalog-gestures-phase.test.ts`'s own header for the mechanism: an undeclared phase is not a
// permissive default, `compile.ts`'s `phaseOf` treats it as "nothing is known", and an unknown
// phase conflicts with everything, itself included).
//
// Unlike the gesture family, this is not a blanket `phase: 'state'`. Ten names across the three
// files got `state`; the other twenty-five were checked against their actual mechanism and left
// unphased on purpose — see the reasoning comments beside `FORMS_PRESETS`, `LAYOUT_PRESETS`, and
// the module doc above `numbers.ts`'s preset arrays for the per-name case. This file is the
// compiled proof for both halves of that call, the same shape `catalog-phase-materials.test.ts`
// uses for its own mixed state/unphased split.
//
// The node environment is not optional: `compile`/`parse` are pure and need no DOM, and this
// mirrors every sibling phase-audit file's own choice for the same reason.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { EffectPhase } from '../src/core/types.js'
import type { Registry } from '../src/core/registry.js'
import { FORMS_PRESETS } from '../src/effects/forms/index.js'
import { LAYOUT_PRESETS } from '../src/effects/layout/presets.js'
import { COUNT_PRESETS, METER_PRESETS } from '../src/effects/catalog/numbers.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

function resolvedPreset(name: string, from: Registry = registry) {
  const resolved = from.resolve(name)
  if (!resolved) throw new Error(`catalog-phase-forms-layout.test.ts: "${name}" is not in the catalog`)
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

/** Assert every named preset's declared phase, and that none also carries `transitions`. */
function assertPhases(expected: Record<string, EffectPhase | undefined>): void {
  for (const [name, phase] of Object.entries(expected)) {
    const preset = resolvedPreset(name)
    expect(preset.phase, name).toBe(phase)
    // `phaseOf` derives `'state'` from `Preset.transitions` when present; declaring both fields on
    // one preset is duplicate data that can only drift from the field it was derived from. None of
    // these 35 presets renders through that mechanism (forms.css/numbers.css write their
    // transitions/keyframes directly, not through the compiled `--kui-transition` merge), so none
    // should carry it.
    expect(preset.transitions, name).toBeUndefined()
  }
}

describe('forms: nine native-state-shaped names declare phase: state', () => {
  it('covers all thirteen names — a name added here without a phase silently reopens the bug', () => {
    expect(FORMS_PRESETS.map((preset) => preset.name)).toEqual([
      'label-float', 'input-underline-grow', 'focus-ring-grow', 'validate-shake', 'validate-check',
      'strength-meter', 'toggle-morph', 'checkbox-draw', 'radio-fill', 'range-fill',
      'submit-to-spinner-to-check', 'step-progress', 'carousel',
    ])
  })

  it('declares the expected phase for every name', () => {
    assertPhases({
      'label-float': 'state',
      'input-underline-grow': 'state',
      'focus-ring-grow': undefined,
      'validate-shake': undefined,
      'validate-check': undefined,
      'strength-meter': 'state',
      'toggle-morph': 'state',
      'checkbox-draw': 'state',
      'radio-fill': 'state',
      'range-fill': 'state',
      'submit-to-spinner-to-check': 'state',
      'step-progress': 'state',
      carousel: 'state',
    })
  })
})

describe('layout: only tab-indicator-slide declares a phase', () => {
  it('covers all nine names', () => {
    expect(LAYOUT_PRESETS.map((preset) => preset.name)).toEqual([
      'flip-reorder', 'flip-filter', 'flip-sort', 'flip-shuffle', 'grid-to-list', 'masonry-reflow',
      'expand-to-modal', 'accordion-height', 'tab-indicator-slide',
    ])
  })

  it('declares the expected phase for every name', () => {
    assertPhases({
      'flip-reorder': undefined,
      'flip-filter': undefined,
      'flip-sort': undefined,
      'flip-shuffle': undefined,
      'grid-to-list': undefined,
      'masonry-reflow': undefined,
      'expand-to-modal': undefined,
      'accordion-height': undefined,
      'tab-indicator-slide': 'state',
    })
  })
})

describe('numbers: all thirteen presets stay unphased', () => {
  it('covers all six counters and seven meters', () => {
    expect(COUNT_PRESETS.map((preset) => preset.name)).toEqual([
      'count-up', 'count-down', 'count-currency', 'count-percent', 'count-compact', 'odometer-roll',
    ])
    expect(METER_PRESETS.map((preset) => preset.name)).toEqual([
      'progress-ring', 'gauge-sweep', 'donut-sweep', 'sparkline-draw', 'progress-bar',
      'progress-segments', 'star-rating-fill',
    ])
  })

  it('declares no phase for any of the thirteen', () => {
    assertPhases({
      'count-up': undefined,
      'count-down': undefined,
      'count-currency': undefined,
      'count-percent': undefined,
      'count-compact': undefined,
      'odometer-roll': undefined,
      'progress-ring': undefined,
      'gauge-sweep': undefined,
      'donut-sweep': undefined,
      'sparkline-draw': undefined,
      'progress-bar': undefined,
      'progress-segments': undefined,
      'star-rating-fill': undefined,
    })
  })
})

describe('the newly declared states now take turns with an entrance on a shared channel', () => {
  // Both authoring orders, for the reason `composition-phase.test.ts`'s own `COMPOSES` table checks
  // both: authoring order decided which effect the old undeclared-phase code kept.
  it.each([
    ['fade-up, label-float', ['fade-up', 'label-float']],
    ['label-float, fade-up', ['label-float', 'fade-up']],
    ['fade-up, tab-indicator-slide', ['fade-up', 'tab-indicator-slide']],
    ['tab-indicator-slide, fade-up', ['tab-indicator-slide', 'fade-up']],
  ])('%s composes both effects with no "cannot compose" warning', (attribute, expectedFx) => {
    const result = plan(attribute)
    expect(result.refused, attribute).toEqual([])
    expect(result.fx, attribute).toEqual(expectedFx)
  })

  it('two declared states on one channel still refuse — state|state is not an exempted pair', () => {
    // `label-float` and `input-underline-grow` are both `native-state`, both `phase: 'state'`, and
    // both claim `translate`/`scale`/`opacity`/`stroke`/`color` — a genuine clash `channels.ts`'s
    // `INDEPENDENT_PHASES` does not exempt (only `entrance|state` and `exit|state` are).
    const result = plan('label-float, input-underline-grow')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['label-float'])
  })
})

describe('leaving the other twenty-five unphased is correct, not just silent', () => {
  it('validate-shake still refuses beside an entrance on translate, instead of a silent clobber', () => {
    // `validate-shake`'s keyframe (forms.css) holds `translate` at identity via
    // `animation-fill-mode: both` once it finishes — declaring it `entrance` would have let this
    // pair through as though the shake genuinely released the channel, which it does not.
    const result = plan('fade-up, validate-shake')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['fade-up'])
  })

  it('focus-ring-grow still refuses beside a declared state sharing its shadow channel', () => {
    // `lift-shadow` derives `phase: 'state'` from its own `transitions`. If `focus-ring-grow` had
    // been declared `entrance` despite its keyframe closing to a fixed ring width, this pair would
    // have composed and one of the two box-shadows would have silently lost — the exact
    // silent-clobber failure mode the phase axis exists to prevent stays prevented here because
    // `focus-ring-grow` is left unphased instead.
    const result = plan('focus-ring-grow, lift-shadow')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['focus-ring-grow'])
  })

  it('two unphased FLIP names sharing translate/scale still refuse, exactly as before this change', () => {
    const result = plan('flip-reorder, flip-filter')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['flip-reorder'])
  })

  it('an unphased FLIP name does not accidentally compose with its now-phased sibling', () => {
    // `flip-reorder` and `tab-indicator-slide` share `translate` (`flip-container` vs
    // `flip-indicator`). `tab-indicator-slide` declaring `state` must not, by itself, let an
    // unrelated unphased claim through — `independentPhases` requires *both* sides to declare a
    // phase, so this still refuses.
    const result = plan('flip-reorder, tab-indicator-slide')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['flip-reorder'])
  })

  it('two counters sharing the content channel still refuse — a real collision, not a false one', () => {
    // Two JS effects racing to own one element's text content is genuinely unsafe regardless of
    // phase; leaving both unphased keeps refusing it rather than inventing an exemption.
    const result = plan('count-up, count-down')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['count-up'])
  })

  it('two meters sharing the stroke channel still refuse — both close to a real drawn value', () => {
    const result = plan('progress-ring, gauge-sweep')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['progress-ring'])
  })
})
