// @vitest-environment node
//
// Static analysis of `entrance.css`'s `flip-in-x`/`-y` and `flip-out-x`/`-y` keyframes — no DOM
// required, same reason as `css-invariants.test.ts`.
//
// This is a different bug shape from `three-d.css`'s `card-flip-x`/`-y` family (see
// `three-d-perspective.test.ts`), not the same one recurring: `flip-3d`'s `perspective` parameter
// was never read by anything in `entrance.css` at all — not even the self-perspective mistake the
// other family had. `entrance.css` had no `perspective` property, no `perspective()` transform
// function, no reference to `--kui-perspective` anywhere. The parameter validated and compiled
// (an author writing `flip-in-y perspective:2000px` got no warning), and changed nothing.
//
// The fix converges `flip-3d` onto the same shape as `flip-face`: `transform: perspective(...)
// rotateX/Y(...)` instead of the individual `rotate:` property.
//
// What this proves: the keyframes are now structurally capable of depth, and the primitive's
// declared channel matches what it writes. What it cannot prove: that the render looks
// foreshortened — jsdom does not lay out 3D transforms. That needs a real browser.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'

const CSS = readFileSync(fileURLToPath(new URL('../src/css/entrance.css', import.meta.url)), 'utf8')

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/** The full body text of a named `@keyframes` block. */
function keyframeBody(css: string, name: string): string {
  const open = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(css)
  if (!open) throw new Error(`@keyframes ${name} not found`)
  return readBalancedBlock(css, open.index + open[0].length)
}

/**
 * Every rule body whose selector list mentions `[data-kui-fx~='name']` — on its own or inside a
 * compound like `[data-kui-fx~='flip-in-x'][data-kui-state='ready']`.
 *
 * Both forms count, because what the caller asks is "does *anything* targeting this preset declare
 * the `perspective` property," and a compound selector declares it just as effectively as a
 * standalone one. An earlier version of this helper looked only for standalone entries, which was
 * right for the question it was written for (which rule feeds `--kui-perspective`) and wrong for
 * this one.
 *
 * Comments are stripped first so prose that happens to mention the token — this doc comment, or
 * `entrance.css`'s own long note about why the property is gone — can never be read as a selector.
 */
function rulesMentioning(css: string, name: string): string[] {
  const token = `[data-kui-fx~='${name}']`
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies: string[] = []
  // Scanned brace to brace rather than matched with `/([^{}]+)\{/g`. That regex is in fact linear
  // — `[^{}]` cannot match the brace that follows it — but "variable-length class in front of a
  // literal" is the shape the slow-regex lint rejects, and this repo carries no eslint-disable.
  let from = 0
  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i]
    if (char !== '{' && char !== '}') continue
    if (char === '{') {
      const selectors = stripped.slice(from, i)
      if (selectors.includes(token)) bodies.push(readBalancedBlock(stripped, i + 1))
    }
    from = i + 1
  }
  return bodies
}

const FLIPS: { name: string; rotateFn: 'rotateX' | 'rotateY' }[] = [
  { name: 'kui-flip-in-x', rotateFn: 'rotateX' },
  { name: 'kui-flip-in-y', rotateFn: 'rotateY' },
  { name: 'kui-flip-out-x', rotateFn: 'rotateX' },
  { name: 'kui-flip-out-y', rotateFn: 'rotateY' },
]

describe('flip-in/-out keyframes carry their own perspective', () => {
  it.each(FLIPS)('$name writes perspective() and $rotateFn() in the same transform value', ({ name, rotateFn }) => {
    const body = keyframeBody(CSS, name)
    // No separate `\s*` before the capture: `[^;]` already matches whitespace, so pairing it with
    // an adjacent `\s*` is the overlapping-quantifier shape `slow-regex` flags. `.trim()` below
    // strips what the missing `\s*` would have.
    const transformMatch = /transform:([^;]+);/.exec(body)
    expect(transformMatch, `${name} has no transform: declaration`).not.toBeNull()

    const value = transformMatch![1]!.trim()
    expect(value, `${name}'s transform must apply perspective()`).toMatch(/\bperspective\(/)
    expect(value, `${name}'s transform must apply ${rotateFn}()`).toMatch(new RegExp(`\\b${rotateFn}\\(`))
    // perspective() must come first in source order — transform functions apply right-to-left, so
    // writing them the other way rotates the element and only then projects the already-rotated
    // result, which produces no foreshortening.
    expect(value.indexOf('perspective(')).toBeLessThan(value.indexOf(`${rotateFn}(`))
  })

  it.each(FLIPS)('$name no longer writes the bare rotate: property', ({ name }) => {
    const body = keyframeBody(CSS, name)
    expect(body).not.toMatch(/(?:^|[{;\s])rotate:\s*[xy]\s/)
  })

  it.each(FLIPS)('$name reads --kui-perspective, so the parameter is not inert', ({ name }) => {
    // The regression this guards: the parameter existed and validated, but nothing consumed
    // `--kui-perspective` anywhere in this file, so an author's override was silently inert. It is
    // consumed by the keyframe's own `perspective()` now — there is deliberately no rule setting
    // the `perspective` property to consume it instead (see the next block).
    expect(keyframeBody(CSS, name)).toContain('--kui-perspective')
  })

  it.each(['flip-in-x', 'flip-in-y', 'flip-out-x', 'flip-out-y'])(
    '%s never sets the perspective *property* on the animating element',
    (name) => {
      // Regression: these four used to carry `perspective: var(--kui-perspective, 1200px)` "in case
      // an author nests 3D content". On a card that clips its own content — `overflow` anything but
      // `visible` — that property put the children in a 3D rendering context Chromium
      // intermittently failed to raster, so the card painted its border and background while its
      // `<img>` and caption painted nothing, sometimes permanently. Verified in Chrome on
      // `demo/reveals.html`: `data-kui-state` was `finished`, computed `opacity` `1`, `transform`
      // identity, `playbackRate` `1`, image decoded — and the card was still empty.
      //
      // Nothing was lost: a clipped element's used `transform-style` is `flat` anyway (CSS
      // Transforms 2 grouping), so its children were never in that scene, and a side-by-side at
      // 0/30/60/75deg renders identically with and without the declaration.
      for (const body of rulesMentioning(CSS, name)) {
        expect(body, `${name} must not declare the perspective property`).not.toMatch(
          /(?:^|[;{\s])perspective:/,
        )
      }
    },
  )
})

describe('flip-3d primitive channel matches what it writes', () => {
  const registry = createRegistry()

  it.each(['flip-in-x', 'flip-in-y', 'flip-out-x', 'flip-out-y'])(
    '%s is on the skew channel (claims the transform shorthand), not rotate',
    (name) => {
      const resolved = registry.resolve(name)!
      expect(resolved.primitive.channels).toContain('skew')
      expect(resolved.primitive.channels).not.toContain('rotate')
    },
  )
})
