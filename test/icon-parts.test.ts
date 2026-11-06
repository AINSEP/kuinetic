// Node env (the default): this file reads CSS through `test/support/css-sources.ts`, which reads
// stylesheets at module scope via `fileURLToPath` — that throws under jsdom, where
// `import.meta.url` is an http: URL, not a file: one. DOM-level stamping/restore behaviour lives
// in `test/icon-parts-dom.test.ts` instead, which needs jsdom.
import { describe, expect, it } from 'vitest'
import { SOURCES } from './support/css-sources.js'
import { ruleBodies } from './support/css-scan.js'

const svgCss = SOURCES.get('svg.css')!
const iconPartsCss = SOURCES.get('icon-parts.css')!

/** Collapse incidental whitespace so reformatting alone never fails the drift guard. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Every `.kui-bar` selector svg.css declares a rule for, as bare selector text (no trailing `{`).
 *
 * Every one of svg.css's `.kui-bar` rules is a single selector on its own line ending in ` {` —
 * none of them share a comma-separated list — so a per-line match is enough; a rule split across
 * lines or folded into a bigger list would silently vanish from this list, which is exactly the
 * failure the "found every rule" sanity check below guards against.
 */
function svgBarSelectors(css: string): string[] {
  // Plain string slicing, not a regex: the per-line regex shape is the overlapping-quantifier one
  // `sonarjs/slow-regex` rejects, and this repo carries no eslint-disable.
  return css
    .split('\n')
    .filter((line) => line.includes('{'))
    .map((line) => line.slice(0, line.indexOf('{')))
    .filter((head) => head.includes('.kui-bar'))
    .map(normalize)
}

/**
 * Rewrite an svg.css `.kui-bar` selector the way `icon-parts.css` must: the class becomes the
 * part attribute, and `:nth-child(N)` becomes the `of` form scoped to that attribute — a class
 * selector already counts position among just the classed siblings, so the attribute form needs
 * `of [data-kui-part='bar']` to mean the same thing (see icon-parts.css's header comment).
 */
function toPartSelector(selector: string): string {
  return normalize(
    selector
      .replace(/\.kui-bar:nth-child\((\d+)\)/g, "[data-kui-part='bar']:nth-child($1 of [data-kui-part='bar'])")
      .replace(/\.kui-bar(?!:nth-child)/g, "[data-kui-part='bar']"),
  )
}

describe('icon-parts.css — drift guard against svg.css', () => {
  it('scopes dot geometry and crossing endpoints to the opted-in host for both part spellings', () => {
    const dots = iconPartsCss.slice(iconPartsCss.indexOf('/* Both authored'), iconPartsCss.indexOf('/* Reduced motion twin'))
    const selectors = dots.split('\n').filter(line => line.includes('{') && !line.includes('@layer'))
    expect(selectors).toHaveLength(7)
    expect(selectors.every(line => line.includes("[data-kui-icon-parts='dots']"))).toBe(true)
    expect(dots).toContain(":is(.kui-bar, [data-kui-part='bar'])")
    expect(dots).toContain('scale var(--kui-icon-toggle-duration, 260ms)')
    expect(dots).toContain('scale: 4 .5;')
    expect(dots).toContain('opacity: 1;')
    expect(dots).toContain('--kui-dot-angle: 45deg;')
    expect(dots).toContain('--kui-dot-angle: -45deg;')
    expect(dots).toContain("[aria-expanded='true']")
    expect(dots).toContain('transition-delay: var(--kui-icon-toggle-delay, 0ms)')
    expect(dots).toContain("[aria-expanded='true'] :is(.kui-bar, [data-kui-part='bar']):nth-child(n)")
    const angles = [1, 2, 3, 4].map(index => {
      const selector = `[data-kui-fx~='hamburger-to-x'][data-kui-icon-parts='dots'] :nth-child(${index} of :is(.kui-bar, [data-kui-part='bar']))`
      const body = ruleBodies(dots, selector).join(' ')
      return body.split('--kui-dot-angle:')[1]?.split(';')[0]?.trim()
    })
    expect(angles).toEqual(['45deg', '-45deg', '-45deg', '45deg'])
  })

  const selectors = svgBarSelectors(svgCss)
  const normalizedIconParts = normalize(iconPartsCss)

  // Pinned to today's real count (verified against svg.css directly) so a change to the
  // extractor regex itself — not just to the stylesheets — fails loudly instead of the suite
  // quietly asserting nothing.
  it('found all 13 documented .kui-bar rules', () => {
    expect(selectors.length).toBe(13)
  })

  it.each(selectors)('has a [data-kui-part] twin for: %s', (selector) => {
    expect(normalizedIconParts).toContain(toPartSelector(selector))
  })

  it('duplicates the reduced-motion shortening for all three icon-toggle presets', () => {
    for (const name of ['hamburger-to-x', 'play-to-pause', 'plus-to-minus']) {
      expect(iconPartsCss).toContain(`[data-kui-rm][data-kui-fx~='${name}'] [data-kui-part='bar']`)
    }
    expect(iconPartsCss).toContain('prefers-reduced-motion: reduce')
    expect(iconPartsCss).toContain('transition-duration: 1ms !important')
  })
})
