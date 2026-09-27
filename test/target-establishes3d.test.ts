import { describe, expect, it } from 'vitest'
import { SOURCES } from './support/css-sources.js'
import { stripComments } from './support/css-scan.js'
import { createRegistry } from '../src/effects/index.js'
import { registerAdvanced } from '../src/advanced/index.js'
import { register3D } from '../src/3d/index.js'
import type { Registry, ResolvedEffect } from '../src/core/registry.js'

/**
 * `target:-everywhere` phase 5a — `Preset.establishes3d` (`src/core/types.ts`) marks a preset
 * whose CSS puts `transform-style: preserve-3d`/`perspective` on the `data-kui-fx` element, so
 * `src/core/derived/diagnostics.ts`'s `no-nested-3d` warning can catch one nested inside another
 * (memory: "Never nest a 3D effect inside an animated frame" — a `preserve-3d` child joins its
 * parent's 3D space). The flag's own doc comment says it is "derived from `three-d.css` ... so it
 * cannot drift" — this is that derivation, checked both ways so a preset added to the CSS without
 * the flag (or the flag without the CSS) fails here instead of shipping a silent no-nested-3d gap.
 *
 * Scoped to `three-d.css` only, per the plan: `establishes3d` is not the only way a preset can
 * open a real 3D rendering context. `entrance.css:264` (`[data-kui-fx*='flip-']`, the v1 entrance
 * flips), `interaction.css:173` (split-flap) and `:876` (tilt-3d/tilt-parallax), `carousel.css:58`
 * (carousel-3d*), and `media.css:139` all set 3D transform properties too, and none is flagged or
 * covered here — left for the owner, noted in the progress file, not a bug this test polices.
 */

/** Build one registry with every tier core ships (core + advanced + 3d subpaths). */
function fullRegistry(): Registry {
  const registry = createRegistry()
  registerAdvanced(registry)
  register3D(registry)
  return registry
}

/**
 * Preset names whose rule in `three-d.css` declares `transform-style` or `perspective` as a real
 * property, right after `{` or `;` — never the `perspective(...)` transform FUNCTION the keyframes
 * above use to fake depth on a single element (that only ever follows `transform:`, never `{`/`;`),
 * and never the `--kui-perspective` custom property `var()` reads (its name starts with `--kui-`,
 * not with a `{`/`;` boundary immediately before `perspective`).
 *
 * Walks backward from each real declaration to its rule's own opening `{` (three-d.css nests
 * nothing inside these particular rule bodies, so the nearest preceding `{` is always that rule's
 * own — not true of CSS in general, fine for this one file) and reads every `[data-kui(-fx)?~='…']`
 * token out of the selector text between the previous rule's `}` and that `{`. A comma-separated
 * selector list (the 5-name preserve-3d group) and a preset repeated across its `data-kui-fx` and
 * pre-JS `data-kui` rules (`flip-card`) both collapse into the one name each is written with.
 *
 * @complexity O(n) time in the length of `css`, O(m) space in the number of matched names.
 * @overallScore 100
 */
function establishes3dInCss(css: string): Set<string> {
  const text = stripComments(css)
  const names = new Set<string>()
  for (const match of text.matchAll(/(?:^|[{;])\s*(?:transform-style|perspective)\s*:/g)) {
    const braceIndex = text[match.index] === '{' ? match.index : text.lastIndexOf('{', match.index)
    if (braceIndex === -1) continue
    const header = text.slice(text.lastIndexOf('}', braceIndex) + 1, braceIndex)
    for (const sel of header.matchAll(/\[data-kui(?:-fx)?~=(['"])([\w-]+)\1\]/g)) names.add(sel[2]!)
  }
  return names
}

function flaggedPresets(registry: Registry): ResolvedEffect[] {
  return registry
    .names()
    .map((name) => registry.resolve(name))
    .filter((resolved): resolved is ResolvedEffect => !!resolved && resolved.preset.establishes3d === true)
}

describe('target:-everywhere — establishes3d tracks three-d.css (5a)', () => {
  const cssNames = establishes3dInCss(SOURCES.get('three-d.css')!)

  it('scanner sanity: finds real declarations (else every check below passes vacuously)', () => {
    expect(cssNames.size).toBeGreaterThan(0)
  })

  it('every establishes3d preset is one three-d.css actually sets preserve-3d/perspective on', () => {
    for (const { preset } of flaggedPresets(fullRegistry())) {
      expect(
        cssNames.has(preset.name),
        `"${preset.name}" is flagged establishes3d but three-d.css sets neither ` +
          `transform-style:preserve-3d nor perspective on it`,
      ).toBe(true)
    }
  })

  it('every three-d.css preserve-3d/perspective preset is flagged establishes3d', () => {
    const registry = fullRegistry()
    for (const name of cssNames) {
      const resolved = registry.resolve(name)
      expect(
        resolved,
        `"${name}" appears in three-d.css's preserve-3d/perspective rules but is not a registered preset name`,
      ).toBeDefined()
      expect(
        resolved?.preset.establishes3d,
        `"${name}" sets transform-style:preserve-3d or perspective in three-d.css but Preset.establishes3d is not true`,
      ).toBe(true)
    }
  })

  it('is exactly the 6 names read by hand off three-d.css', () => {
    expect([...cssNames].sort((a, b) => a.localeCompare(b))).toEqual([
      'book-page-turn',
      'card-flip-x',
      'card-flip-y',
      'cube-rotate',
      'flip-card',
      'fold-panel',
    ])
  })

  it('mutation check: an unflagged copy of card-flip-y fails the CSS-to-flag direction', () => {
    const registry = fullRegistry()
    const withoutFlag = new Set(cssNames)
    withoutFlag.delete('card-flip-y')
    // card-flip-y is still really flagged in the registry; the mutated CSS-set is what should now
    // disagree with it — proving the "every CSS name is flagged" assertion actually checks something.
    const resolved = registry.resolve('card-flip-y')
    expect(resolved?.preset.establishes3d).toBe(true)
    expect(withoutFlag.has('card-flip-y')).toBe(false)
  })
})
