// @vitest-environment node
//
// Static analysis of `three-d.css`'s 3D-flip keyframes — no DOM required, same reason as
// `css-invariants.test.ts`: `import.meta.url` needs to stay a `file:` URL.
//
// The bug: `card-flip-x`, `card-flip-y`, `cube-rotate`, `book-page-turn`, and `fold-panel` all
// rendered flat — they rotated, but with no depth/foreshortening. The keyframes wrote the
// individual `rotate:` property, and a separate unconditional rule set `perspective:` on that
// *same* element. The CSS `perspective` property only ever creates depth for an element's
// children, never for the element it is set on, so that `perspective` declaration did nothing —
// confirmed against the CSS Transforms spec, not assumed from the handoff that reported the bug.
//
// The fix moves the angle from `rotate:` into `transform: perspective(...) rotateX/Y(...)`, since
// `perspective()` — the transform *function* — is the one form of perspective that does apply to
// the element carrying it, and it only exists inside the `transform` shorthand.
//
// What this file proves: the keyframes are now structurally capable of depth (perspective and
// rotation combined in one `transform` value on the animated element, in the right composition
// order) and the primitive's declared channel matches what it actually writes, so the
// channel-invariant tests elsewhere catch a regression instead of silently passing. What it
// cannot prove: that the render actually looks foreshortened. jsdom does not lay out 3D transforms
// at all — this needs a real browser (`npm run verify:browser` / a Chrome screenshot), which is
// the main loop's call to make, not this test's.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogRegistry } from './support/registry.js'

const CSS = readFileSync(fileURLToPath(new URL('../src/css/three-d.css', import.meta.url)), 'utf8')

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

const FLIPS: { name: string; rotateFn: 'rotateX' | 'rotateY' }[] = [
  { name: 'kui-card-flip-y', rotateFn: 'rotateY' },
  { name: 'kui-card-flip-x', rotateFn: 'rotateX' },
  { name: 'kui-cube-rotate', rotateFn: 'rotateY' },
  { name: 'kui-book-page-turn', rotateFn: 'rotateY' },
  { name: 'kui-fold-panel', rotateFn: 'rotateX' },
]

describe('3D flip keyframes carry their own perspective', () => {
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

    // perspective() must come before the rotate function in source order: transform functions
    // apply right-to-left (innermost/last-written first), so writing them the other way around
    // would rotate the element and only *then* apply the perspective projection to the already-
    // rotated result — the exact "perspective ends up on the wrong side of the matrix" failure
    // mode individual-property `rotate:` plus a sibling `transform: perspective()` would have hit.
    expect(value.indexOf('perspective(')).toBeLessThan(value.indexOf(`${rotateFn}(`))
  })

  it.each(FLIPS)('$name no longer writes the bare rotate: property', ({ name }) => {
    // The old bug shape. A regression back to this is exactly "perspective on self does nothing"
    // again, even though nothing else about the block would look wrong on inspection.
    const body = keyframeBody(CSS, name)
    expect(body).not.toMatch(/(?:^|[{;\s])rotate:\s*[xy]\s/)
  })
})

describe('flip-face primitive channel matches what it writes', () => {
  const registry = catalogRegistry()

  it.each(['card-flip-x', 'card-flip-y', 'cube-rotate', 'book-page-turn', 'fold-panel'])(
    '%s is on the skew channel (claims the transform shorthand), not rotate',
    (name) => {
      const resolved = registry.resolve(name)!
      expect(resolved.primitive.channels).toContain('skew')
      expect(resolved.primitive.channels).not.toContain('rotate')
    },
  )
})
