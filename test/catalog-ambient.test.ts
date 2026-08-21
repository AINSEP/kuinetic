// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { AMBIENT_PRESETS, registerAmbient } from '../src/effects/catalog/ambient.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/ambient.css', import.meta.url)), 'utf8')

/**
 * `registerAmbient` is not yet wired into `createRegistry()` — the aggregate registration hub
 * (`src/effects/catalog/index.ts`) is a shared file another concurrently-built catalog section
 * also needs, so it is wired in separately once every section lands. Building a standalone
 * registry here still proves the module registers correctly on its own.
 */
function ambientRegistry(): Registry {
  return registerAmbient(new Registry())
}

describe('ambient catalog', () => {
  it('registers all 15 section J names', () => {
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
