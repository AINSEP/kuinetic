// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { FEEDBACK_PRESETS, registerFeedback } from '../src/effects/catalog/feedback.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/feedback.css', import.meta.url)), 'utf8')

/**
 * Same standalone-registry rationale as `catalog-ambient.test.ts`: `registerFeedback` is not yet
 * wired into `createRegistry()` because `src/effects/catalog/index.ts` is a shared aggregation
 * point another concurrently-built catalog section also needs.
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

  it('marks every continuous loop as infinite in the stylesheet', () => {
    const occurrences = css.match(/animation-iteration-count: infinite;/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(5)
  })
})
