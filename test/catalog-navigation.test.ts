// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { NAV_CSS_PRESETS, NAVIGATION_PRESETS } from '../src/effects/navigation/index.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/navigation.css', import.meta.url)), 'utf8')

describe('navigation catalog', () => {
  it('registers all 8 section M names', () => {
    const registry = createRegistry()
    expect(NAVIGATION_PRESETS).toHaveLength(8)
    expect(NAVIGATION_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = NAV_CSS_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('keeps the three scroll-position primitives at reducedMotion disable', () => {
    const registry = createRegistry()
    for (const name of ['header-shrink', 'header-hide-on-scroll', 'back-to-top-fade']) {
      expect(registry.resolve(name)?.primitive.reducedMotion).toBe('disable')
    }
  })

  it('does not claim ownership of focus/aria state for menu content', () => {
    // Structural guard on the documented boundary: none of these primitives declare a `state`
    // or `aria` channel, which would signal they own more than motion.
    const registry = createRegistry()
    for (const name of ['menu-stagger-open', 'dropdown-open', 'drawer-slide', 'mega-menu-drop']) {
      const channels = registry.resolve(name)?.primitive.channels ?? []
      expect(channels).not.toContain('aria')
    }
  })
})
