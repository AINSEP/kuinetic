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
 * The body of whichever rule's selector list contains `[data-kui-fx~='name']`, wherever that
 * selector sits in a comma list. Finds the token, then the next `{`, then reads the balanced
 * block from there — works regardless of how many other selectors share the rule.
 */
function ruleBodyFor(css: string, name: string): string {
  const token = `[data-kui-fx~='${name}']`
  const at = css.indexOf(token)
  if (at === -1) throw new Error(`selector ${token} not found`)
  const open = css.indexOf('{', at)
  if (open === -1) throw new Error(`no rule body follows ${token}`)
  return readBalancedBlock(css, open + 1)
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

  it.each(['flip-in-x', 'flip-in-y', 'flip-out-x', 'flip-out-y'])(
    '%s has an unconditional rule feeding it --kui-perspective',
    (name) => {
      // The regression this guards: the parameter existed and validated, but nothing consumed
      // `--kui-perspective` anywhere in this file, so an author's override was silently inert.
      expect(ruleBodyFor(CSS, name)).toMatch(/--kui-perspective/)
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
