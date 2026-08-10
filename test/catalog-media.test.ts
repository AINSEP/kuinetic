// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { MEDIA_PRESETS } from '../src/effects/catalog/media.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/media.css', import.meta.url)), 'utf8')

describe('media catalog', () => {
  it('registers all 17 section G names', () => {
    const registry = createRegistry()
    expect(MEDIA_PRESETS).toHaveLength(17)
    expect(MEDIA_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS preset', () => {
    const missing = MEDIA_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('keeps hover effects keyboard and coarse-pointer reachable', () => {
    expect(css).toContain('@media (pointer: coarse)')
    for (const name of ['duotone-hover', 'grayscale-hover', 'saturate-hover']) {
      expect(createRegistry().resolve(name)?.primitive.defaultActivation).toBe('hover')
    }
  })
})
