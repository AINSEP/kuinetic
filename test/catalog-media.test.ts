// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEDIA_CSS_PRESETS, MEDIA_JS_PRESETS, MEDIA_PRESETS } from '../src/effects/catalog/media.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/media.css', import.meta.url)), 'utf8')

describe('media catalog', () => {
  it('registers all 20 section G names', () => {
    const registry = catalogRegistry()
    expect(MEDIA_PRESETS).toHaveLength(20)
    expect(MEDIA_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = MEDIA_CSS_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('gives every CSS-tier preset a css-keyframes renderer', () => {
    const registry = catalogRegistry()
    for (const preset of MEDIA_CSS_PRESETS) {
      expect(registry.resolve(preset.name)?.primitive.renderer).toBe('css-keyframes')
    }
  })

  it('renders every JS-tier preset through the javascript renderer', () => {
    const registry = catalogRegistry()
    for (const preset of MEDIA_JS_PRESETS) {
      expect(registry.resolve(preset.name)?.primitive.renderer).toBe('javascript')
    }
  })

  /*
   * The policy was asserted across every JS-tier name in this section when `slat-assemble` was the
   * only one. It is not a property of the tier — it is a property of an effect whose *entire*
   * output is motion, where `'disable'` means "the animator never calls activate(), so the DOM
   * surgery never runs and the author's markup is left exactly as written".
   *
   * `bg`/`background` is the counterexample, so the two are named individually rather than
   * swept: it paints content as well as moving it, and refusing to activate it would leave the
   * element with no backdrop at all — a broken page, not a calmer one. It reads `ctx.reducedMotion`
   * itself instead, and suppresses only the clip's autoplay. Keeping the blanket assertion would
   * have made the correct policy here fail the suite.
   */
  it('disables slat-assemble under reduced motion and installs the backdrop anyway', () => {
    const registry = catalogRegistry()
    expect(registry.resolve('slat-assemble')?.primitive.reducedMotion).toBe('disable')
    expect(registry.resolve('bg')?.primitive.reducedMotion).toBe('shorten')
  })

  it('keeps hover effects keyboard and coarse-pointer reachable', () => {
    expect(css).toContain('@media (pointer: coarse)')
    for (const name of ['duotone-hover', 'grayscale-hover', 'saturate-hover']) {
      expect(catalogRegistry().resolve(name)?.primitive.defaultActivation).toBe('hover')
    }
  })
})
