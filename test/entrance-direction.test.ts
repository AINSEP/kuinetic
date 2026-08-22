// @vitest-environment node
//
// Static analysis of `entrance.css`'s directional slide/fade keyframes — no DOM required, for the
// same reason `css-invariants.test.ts` runs in `node`: `import.meta.url` needs to be a `file:` URL.
//
// RTL had zero coverage anywhere in this repo (`grep -ri "rtl\|dir=" test/` turned up nothing
// meaningful) when `kui-in-inline-start`/`kui-in-inline-end` shipped with their `--kui-dir`
// multiplier's sign swapped: in LTR, `slide-inline-start` resolved to the exact same `translate`
// as `slide-right`, and `slide-inline-end` matched `slide-left` — both logical directions entering
// from the side their name promised they would not. Confirmed in a real browser (computed
// `translate` read off paused, from-state animations under `dir="ltr"` and `dir="rtl"`) before
// fixing `src/css/entrance.css`; this test is the regression guard so it never needs re-deriving.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ENTRANCE_CSS = readFileSync(
  fileURLToPath(new URL('../src/css/entrance.css', import.meta.url)),
  'utf8',
)

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/**
 * The `translate:` declaration's value inside a named `@keyframes ... { from { ... } }` block.
 *
 * Brace-balanced rather than a single lazy-`[\s\S]*?` regex spanning to the declaration: besides
 * being flagged as superlinear-backtracking-prone at this file's size, a span that wide could in
 * principle cross into a later block if an earlier one had no `translate` at all.
 */
function translateValue(css: string, keyframeName: string): string {
  const open = new RegExp(`@keyframes\\s+${keyframeName}\\s*\\{`).exec(css)
  if (!open) throw new Error(`no @keyframes block found for ${keyframeName}`)
  const body = readBalancedBlock(css, open.index + open[0].length)
  // No separate `\s*` before the capture: `[^;]` already matches whitespace, so pairing it with
  // an adjacent `\s*` is the overlapping-quantifier shape `slow-regex` flags. `.trim()` below
  // strips what the missing `\s*` would have.
  const match = /translate:([^;]+);/.exec(body)
  if (!match) throw new Error(`no "translate" declaration found in @keyframes ${keyframeName}`)
  return match[1]!.trim()
}

/**
 * The X component of a `translate: <x> 0` value, with any wrapping `calc(...)` stripped.
 *
 * Every directional entrance keyframe in this family only ever moves along X — the Y component is
 * always the literal `0` this strips — so a plain trailing-`0` trim is exact here, not a heuristic.
 */
function xComponent(value: string): string {
  // A plain suffix check rather than a `/\s+0$/` regex: unbounded `\s+` anchored at the end is
  // another shape `slow-regex` objects to, and every value here has exactly one space before the
  // trailing `0` anyway.
  const withoutY = value.endsWith(' 0') ? value.slice(0, -2) : value
  const calc = /^calc\((.*)\)$/.exec(withoutY)
  return calc ? calc[1]! : withoutY
}

/**
 * Evaluates a `*`-chained expression built only from `var(--kui-distance, 24px)` (normalized to
 * `1`, since only its sign matters here) and `var(--kui-dir, 1)` (substituted with `dir`).
 *
 * A plain multiply-the-factors reducer rather than a general expression evaluator: every formula
 * in this file is a product of those two terms and literal `-1`s, nothing more.
 */
function signAt(expr: string, dir: 1 | -1): number {
  const factors = expr
    .replace(/var\(--kui-distance,\s*24px\)/g, '1')
    .replace(/var\(--kui-dir,\s*1\)/g, String(dir))
    .split('*')
    .map((factor) => Number(factor.trim()))
  if (factors.some((factor) => Number.isNaN(factor))) {
    throw new Error(`could not fully resolve expression to numbers: "${expr}" -> [${factors}]`)
  }
  return factors.reduce((product, factor) => product * factor, 1)
}

describe('entrance direction sign (LTR/RTL)', () => {
  // `--kui-dir` is 1 under LTR and -1 under `:dir(rtl)` (base.css). Physical `slide-left`/
  // `slide-right` never reference it — see entrance.css's "physical `slide-left` deliberately does
  // not [honour writing mode]" comment — so their sign is the fixed baseline the logical pair is
  // checked against.
  const left = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-left')), 1)
  const right = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-right')), 1)

  it('kui-in-left and kui-in-right start on opposite sides', () => {
    expect(left).toBeGreaterThan(0)
    expect(right).toBeLessThan(0)
  })

  it.each([
    [1, 'left'] as const,
    [-1, 'right'] as const,
  ])('kui-in-inline-start matches physical %s at --kui-dir %d', (dir, physicalSide) => {
    const value = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-inline-start')), dir)
    expect(value).toBe(physicalSide === 'left' ? left : right)
  })

  it.each([
    [1, 'right'] as const,
    [-1, 'left'] as const,
  ])('kui-in-inline-end matches physical %s at --kui-dir %d', (dir, physicalSide) => {
    const value = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-inline-end')), dir)
    expect(value).toBe(physicalSide === 'left' ? left : right)
  })

  it('inline-start and inline-end are mirror images of each other in both directions', () => {
    for (const dir of [1, -1] as const) {
      const start = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-inline-start')), dir)
      const end = signAt(xComponent(translateValue(ENTRANCE_CSS, 'kui-in-inline-end')), dir)
      expect(start).toBe(-end)
    }
  })
})
