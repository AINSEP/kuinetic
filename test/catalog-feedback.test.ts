// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { FEEDBACK_PRESETS, FEEDBACK_PRIMITIVES, registerFeedback } from '../src/effects/catalog/feedback.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/feedback.css', import.meta.url)), 'utf8')

/**
 * A standalone registry (feedback primitives/presets only) is enough for tests that only ever
 * resolve feedback names. The channel-collision regression below needs `gradient-mesh` too —
 * that's an ambient preset — so it uses the full `catalogRegistry()` instead.
 */
function feedbackRegistry(): Registry {
  return registerFeedback(new Registry())
}

const CONTINUOUS_NAMES = ['skeleton-shimmer', 'spinner', 'spinner-dots', 'spinner-ring', 'progress-indeterminate']

describe('feedback catalog', () => {
  it('registers all 17 section K names', () => {
    const registry = feedbackRegistry()
    expect(FEEDBACK_PRESETS).toHaveLength(17)
    expect(FEEDBACK_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS preset', () => {
    const missing = FEEDBACK_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('disables the continuous loaders under reduced motion instead of shortening them', () => {
    const registry = feedbackRegistry()
    for (const name of CONTINUOUS_NAMES) {
      const resolved = registry.resolve(name)
      expect(resolved?.primitive.reducedMotion).toBe('disable')
      expect(resolved?.primitive.perfClass).toBe('continuous')
    }
  })

  it('leaves one-shot reactions on the default shorten policy', () => {
    const registry = feedbackRegistry()
    const oneShot = FEEDBACK_PRESETS.filter((preset) => !CONTINUOUS_NAMES.includes(preset.name))
    for (const preset of oneShot) {
      expect(registry.resolve(preset.name)?.primitive.reducedMotion).toBe('shorten')
    }
  })

  it('marks every continuous loop as infinite via its own iteration-count var', () => {
    // Not a bare `animation-iteration-count: infinite;` — that would apply to every track sharing
    // an element's `animation-name` list, making a composed one-shot effect loop forever too. See
    // `iterationCountProperty` in src/core/declarations.ts and the header comment in feedback.css.
    const occurrences = css.match(/--kui-fx-[\w-]+-iterations: infinite;/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(5)
  })
})

/**
 * Regression coverage for the under-declared-channel bug: `spinner-dots`, `progress-indeterminate`,
 * and `ripple` each write `background` (and `spinner-dots` also `box-shadow`) from their
 * unconditional `[data-kui-fx~=NAME]` rule in feedback.css, entirely outside `@keyframes` — see
 * that file's ~line 73, ~97, ~200. Declaring only their animated channels (scale/opacity or
 * translate/scale) let a composed `background`-writing effect like `gradient-mesh` pass channel
 * collision detection and then have its gradient silently overwritten. `findConflicts` (via
 * `compile`) is the actual mechanism `data-kui="a, b"` runs through, so these go through the full
 * parse → compile pipeline with the real registry rather than asserting on primitive metadata
 * alone — a wiring mistake between the two would otherwise slip past a metadata-only check.
 */
describe('feedback catalog — channel collisions with an ambient background effect', () => {
  const registry = catalogRegistry()

  function run(source: string) {
    return compile(parse(source), registry, 'time')
  }

  it('rejects gradient-mesh, spinner-dots', () => {
    const plan = run('gradient-mesh, spinner-dots')
    expect(plan.warnings.join()).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
  })

  it('rejects gradient-mesh, progress-indeterminate', () => {
    const plan = run('gradient-mesh, progress-indeterminate')
    expect(plan.warnings.join()).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
  })

  it('rejects gradient-mesh, ripple', () => {
    const plan = run('gradient-mesh, ripple')
    expect(plan.warnings.join()).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
  })

  it('still composes effects with genuinely disjoint channels (the fix is not overbroad)', () => {
    // shake-error (translate only) shares nothing with spinner-dots' corrected
    // [scale, opacity, background, shadow] set.
    const plan = run('shake-error, spinner-dots')
    expect(plan.warnings.join()).not.toContain('cannot compose')
    expect(plan.fxNames).toEqual(['shake-error', 'spinner-dots'])
  })
})

describe('feedback catalog — corrected channel declarations', () => {
  function channelsFor(id: string): string[] {
    return FEEDBACK_PRIMITIVES.find((primitive) => primitive.id === id)?.channels ?? []
  }

  it('feedback-dot-pulse (spinner-dots) declares background and shadow alongside scale/opacity', () => {
    expect(channelsFor('feedback-dot-pulse')).toEqual(
      expect.arrayContaining(['scale', 'opacity', 'background', 'shadow']),
    )
  })

  it('feedback-progress-track (progress-indeterminate) declares background alongside translate/scale', () => {
    expect(channelsFor('feedback-progress-track')).toEqual(
      expect.arrayContaining(['translate', 'scale', 'background']),
    )
  })

  it('feedback-ripple declares background alongside scale/opacity', () => {
    expect(channelsFor('feedback-ripple')).toEqual(expect.arrayContaining(['scale', 'opacity', 'background']))
  })
})
