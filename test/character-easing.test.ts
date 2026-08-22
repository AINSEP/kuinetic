// @vitest-environment node
//
// Static analysis of `bounce-in` vs `pop-in` and of the `--kui-ease-bounce` token they now tell
// apart — no DOM required, same reason as `css-invariants.test.ts`.
//
// The bug: `bounce-in` and `pop-in` were the same preset in every way that shows up on screen —
// same primitive (`scale`), same keyframes (`kui-zoom-in`), same easing (`back-out`) — differing
// only in how far they scaled down first (0.3 vs 0.6). `back-out` is a `cubic-bezier`: it
// overshoots once and settles. That is a pop, not a bounce, whatever the starting scale is.
//
// `--kui-ease-spring` (already in base.css, unused by any preset) was the first thing tried as
// the fix. It turned out to also be a single overshoot — a slower, eased approach into it, but
// still only one peak — so it would not have actually differentiated `bounce-in` from `pop-in` in
// the one way "bounce" implies. `--kui-ease-bounce` is a new token built for this: it crosses back
// over 1 twice with shrinking amplitude, which is what a dropped ball actually looks like.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PRESETS } from '../src/effects/catalog/core.js'

const BASE_CSS = readFileSync(fileURLToPath(new URL('../src/css/base.css', import.meta.url)), 'utf8')

function preset(name: string) {
  const found = PRESETS.find((p) => p.name === name)
  if (!found) throw new Error(`preset ${name} not found`)
  return found
}

/**
 * Local extrema of a sampled curve — the value at every point where it stops rising and starts
 * falling, or vice versa. A monotonic ease-out has none. A single overshoot (`back-out`,
 * `--kui-ease-spring`) has exactly one: the peak. A bounce has several, alternating above and
 * below rest, each one closer to rest than the last.
 */
function localExtrema(values: number[]): number[] {
  const extrema: number[] = []
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1]!
    const curr = values[i]!
    const next = values[i + 1]!
    if ((curr - prev) * (next - curr) < 0) extrema.push(curr)
  }
  return extrema
}

describe('bounce-in is no longer pop-in with a smaller number', () => {
  it('shares the scale primitive and keyframes with pop-in, but not the easing', () => {
    const bounceIn = preset('bounce-in')
    const popIn = preset('pop-in')

    expect(bounceIn.primitive).toBe(popIn.primitive)
    expect(bounceIn.keyframes).toBe(popIn.keyframes)
    expect(bounceIn.params?.ease).not.toBe(popIn.params?.ease)
  })

  it("uses the 'bounce' easing keyword", () => {
    expect(preset('bounce-in').params?.ease).toBe('bounce')
  })
})

describe("'bounce' is accepted wherever an easing keyword is validated", () => {
  it('validates as a param of type easing', async () => {
    // `bounce-in`'s `ease: 'bounce'` has to survive `resolveParams`, which runs every authored
    // value through this exact check. If `bounce` were missing from `EASING_KEYWORD` in
    // `params.ts`, the preset's own default would silently win over the value it declares.
    const { validate } = await import('../src/core/params.js')
    const result = validate('bounce', { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' })
    expect(result.ok).toBe(true)
    expect(result.value).toBe('bounce')
  })
})

describe('--kui-ease-bounce actually traces a bounce, not a single overshoot', () => {
  // `linear(0, 0.5 10%, 1.2 30%, 0.9 50%, 1.08 68%, 0.97 82%, 1.02 92%, 1)` — pull out just the
  // output values, in order, ignoring the percentage stops.
  const match = /--kui-ease-bounce:\s*linear\(([^)]+)\)/.exec(BASE_CSS)
  if (!match) throw new Error('--kui-ease-bounce not found in base.css')
  const values = match[1]!.split(',').map((stop) => Number.parseFloat(stop.trim()))

  it('parsed a plausible number of control points', () => {
    // Guards the regex/split above against silently matching nothing.
    expect(values.length).toBeGreaterThanOrEqual(6)
  })

  it('has more than one local extremum, each swing smaller than the last', () => {
    const extrema = localExtrema(values)
    // One extremum is just an overshoot (`back-out`'s shape). A bounce needs at least a peak, a
    // trough, and a second peak — three swings past the settle point in alternating directions.
    expect(extrema.length).toBeGreaterThanOrEqual(3)

    const deviations = extrema.map((v) => Math.abs(v - 1))
    for (let i = 1; i < deviations.length; i++) {
      expect(deviations[i]!, `swing ${i} should be smaller than swing ${i - 1}`).toBeLessThan(
        deviations[i - 1]!,
      )
    }
  })

  it('starts at 0 and settles exactly at 1', () => {
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
  })
})

describe('--kui-ease-spring is a single overshoot, not a bounce', () => {
  // The token this repo already had before this fix. Documented here so the distinction from
  // `--kui-ease-bounce` above — and the reason `bounce-in` did not just reuse it — has a
  // regression guard instead of living only in a commit message.
  const match = /--kui-ease-spring:\s*linear\(([^)]+)\)/.exec(BASE_CSS)
  if (!match) throw new Error('--kui-ease-spring not found in base.css')
  const values = match[1]!.split(',').map((stop) => Number.parseFloat(stop.trim()))

  it('has at most one local extremum — the single overshoot, no second swing', () => {
    expect(localExtrema(values).length).toBeLessThanOrEqual(1)
  })
})
