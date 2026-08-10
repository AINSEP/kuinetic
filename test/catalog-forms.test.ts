// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import {
  FORMS_PRESETS,
  computeStrength,
  nextStep,
  nextSubmitStage,
} from '../src/effects/forms/index.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/forms.css', import.meta.url)), 'utf8')

const CSS_TIER_PRESETS = ['focus-ring-grow', 'validate-shake', 'validate-check']

describe('forms catalog', () => {
  it('registers all 12 section O names', () => {
    const registry = createRegistry()
    expect(FORMS_PRESETS).toHaveLength(12)
    expect(FORMS_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every css-keyframes preset', () => {
    const presets = FORMS_PRESETS.filter((preset) => CSS_TIER_PRESETS.includes(preset.name))
    expect(presets).toHaveLength(3)
    const missing = presets.filter((preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`))
    expect(missing).toEqual([])
  })

  it('gives the five native-state presets an inert instance — the browser drives them, not JS', () => {
    const registry = createRegistry()
    const names = ['label-float', 'input-underline-grow', 'toggle-morph', 'checkbox-draw', 'radio-fill']
    for (const name of names) {
      const resolved = registry.resolve(name)
      expect(resolved?.primitive.id).toBe('native-state')
    }
  })
})

describe('computeStrength', () => {
  it('scores an empty value at zero', () => {
    expect(computeStrength('')).toBe(0)
  })

  it('scores length, case variety, digits, and symbols independently', () => {
    expect(computeStrength('short')).toBe(0)
    expect(computeStrength('longenough')).toBeGreaterThanOrEqual(2)
    expect(computeStrength('Aa1!longenough')).toBe(4)
  })

  it('never exceeds the maximum level', () => {
    expect(computeStrength('Aa1!Aa1!Aa1!Aa1!Aa1!')).toBe(4)
  })
})

describe('nextStep', () => {
  it('advances and wraps back to zero', () => {
    expect(nextStep(0, 4)).toBe(1)
    expect(nextStep(3, 4)).toBe(0)
  })

  it('stays at zero for a degenerate total', () => {
    expect(nextStep(0, 0)).toBe(0)
  })
})

describe('nextSubmitStage', () => {
  it('cycles idle -> loading -> done -> idle', () => {
    expect(nextSubmitStage('idle')).toBe('loading')
    expect(nextSubmitStage('loading')).toBe('done')
    expect(nextSubmitStage('done')).toBe('idle')
  })
})
