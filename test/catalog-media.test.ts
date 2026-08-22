// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { MEDIA_CSS_PRESETS, MEDIA_JS_PRESETS, MEDIA_PRESETS } from '../src/effects/catalog/media.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/media.css', import.meta.url)), 'utf8')

describe('media catalog', () => {
  it('registers all 18 section G names', () => {
    const registry = createRegistry()
    expect(MEDIA_PRESETS).toHaveLength(18)
    expect(MEDIA_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = MEDIA_CSS_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('gives every CSS-tier preset a css-keyframes renderer', () => {
    const registry = createRegistry()
    for (const preset of MEDIA_CSS_PRESETS) {
      expect(registry.resolve(preset.name)?.primitive.renderer).toBe('css-keyframes')
    }
  })

  it('keeps every JS-tier primitive at reducedMotion "disable"', () => {
    const registry = createRegistry()
    for (const preset of MEDIA_JS_PRESETS) {
      const resolved = registry.resolve(preset.name)
      expect(resolved?.primitive.renderer).toBe('javascript')
      expect(resolved?.primitive.reducedMotion).toBe('disable')
    }
  })

  it('keeps hover effects keyboard and coarse-pointer reachable', () => {
    expect(css).toContain('@media (pointer: coarse)')
    for (const name of ['duotone-hover', 'grayscale-hover', 'saturate-hover']) {
      expect(createRegistry().resolve(name)?.primitive.defaultActivation).toBe('hover')
    }
  })
})
