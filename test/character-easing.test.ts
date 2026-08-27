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
//
// The second half of this file asks the same question of the *tunable* spring —
// `spring(bounce:0.5)`, sampled out of `core/spring.ts`'s integrator at compile time. Same subject,
// same `localExtrema` helper, same test of whether a curve has the character its name claims: a
// generated spring is only worth having if `bounce:` actually changes how many times it crosses.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { cssEasingValue, springTokenProblems } from '../src/core/easing.js'
import { parse } from '../src/core/parse.js'
import { PRESETS } from '../src/effects/catalog/core.js'
import { catalogRegistry } from './support/registry.js'

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

  it('peaks where a bare spring() does, so the keyword and the function agree', () => {
    // `spring()` is the tunable spelling of this exact token. If the two drifted apart, adding
    // parentheses to an existing `ease:spring` would silently change the animation — which is the
    // whole reason `DEFAULT_RATIO` is 2/3 and not `spring.ts`'s own `DEFAULT_SPRING` ratio.
    expect(peakOf(stopsOf(cssEasingValue('spring()')))).toBeCloseTo(Math.max(...values), 1)
  })
})

/** The output values of a generated `linear(...)`, in order. */
function stopsOf(curve: string): number[] {
  const match = /^linear\((.+)\)$/.exec(curve)
  if (!match) throw new Error(`not a linear() curve: ${curve}`)
  return match[1]!.split(',').map((stop) => Number.parseFloat(stop.trim()))
}

const peakOf = (values: number[]): number => Math.max(...values)

/** Every `linear()` this suite generates, so the shared invariants below run over all of them. */
const CURVES = [
  'spring()',
  'spring(bounce:0)',
  'spring(bounce:0.33)',
  'spring(bounce:0.5)',
  'spring(bounce:0.85)',
  'spring(stiffness:400 damping:20 mass:1)',
  'spring(stiffness:180 damping:60)',
  // Every way of asking for a spring that cannot settle. Each is clamped, and the clamp is what
  // these invariants are really guarding: an uncapped one produces a curve that never reaches 1.
  'spring(damping:0)',
  'spring(bounce:1)',
  'spring(stiffness:0)',
  'spring(mass:0)',
]

describe('spring() compiles the real integrator into a linear() curve', () => {
  it.each(CURVES)('%s starts at 0, ends at 1, and every stop is a number', (token) => {
    const stops = stopsOf(cssEasingValue(token))
    expect(stops[0]).toBe(0)
    expect(stops.at(-1)).toBe(1)
    expect(stops.every(Number.isFinite)).toBe(true)
  })

  it.each(CURVES)('%s stays inside the sample-count budget', (token) => {
    // `linear()` is emitted inline, once per element, so the stop count is the whole size story.
    // The floor matters as much as the ceiling: too few stops and a critically damped spring
    // leaves 0 on a straight ramp, which reads as the ease-in having been dropped.
    const stops = stopsOf(cssEasingValue(token))
    expect(stops.length).toBeGreaterThanOrEqual(17)
    expect(stops.length).toBeLessThanOrEqual(65)
  })

  it.each(CURVES)('%s carries no authored text into the declaration', (token) => {
    // The generated path is the one place a `data-kui` value does *not* reach CSS: what is emitted
    // is digits produced from clamped numbers. Anything else here would be an injection surface
    // `params.ts` had already closed for every other authored value.
    expect(cssEasingValue(token)).toMatch(/^linear\([\d., ]+\)$/)
  })

  it('is deterministic — the same token always yields the same curve', () => {
    // The curve is cached per damping ratio. A cache that returned a different string on a second
    // read would desynchronise two elements written the same way.
    expect(cssEasingValue('spring(bounce:0.4)')).toBe(cssEasingValue('spring(bounce:0.4)'))
  })
})

describe('bounce: is the one knob that survives normalising the time axis', () => {
  it('collapses stiffness/damping/mass to their damping ratio', () => {
    // A CSS timing function is normalised to the author's duration, so a spring's own time scale
    // cannot survive. Two springs with the same `damping / (2 * sqrt(stiffness * mass))` are the
    // same spring played at two speeds, and the speed is the part CSS discards. This is not a
    // rounding coincidence — the sampler integrates at `stiffness: 1, mass: 1` by construction.
    expect(cssEasingValue('spring(stiffness:400 damping:20 mass:1)')).toBe(
      cssEasingValue('spring(stiffness:100 damping:10 mass:1)'),
    )
    // Same ratio again, reached through `mass` instead: 20 / (2 * sqrt(100 * 4)) = 0.5.
    expect(cssEasingValue('spring(stiffness:100 damping:20 mass:4)')).toBe(
      cssEasingValue('spring(bounce:0.5)'),
    )
  })

  it('leaves the default physics equal to a bare spring()', () => {
    // `spring(stiffness:180)` must not quietly become a different curve from `spring()` just by
    // restating the default. A knob that changes the answer when set to its own default is worse
    // than no knob.
    expect(cssEasingValue('spring(stiffness:180)')).toBe(cssEasingValue('spring()'))
  })

  it('turns overshoot on and off across its range', () => {
    // bounce:0 is critical damping — monotone, never past the target. Anything above it overshoots,
    // and more of it means more crossings. This is the whole author-facing contract of the knob.
    const flat = stopsOf(cssEasingValue('spring(bounce:0)'))
    expect(peakOf(flat)).toBe(1)
    expect(localExtrema(flat)).toEqual([])

    expect(peakOf(stopsOf(cssEasingValue('spring(bounce:0.5)')))).toBeGreaterThan(1.1)
    expect(localExtrema(stopsOf(cssEasingValue('spring(bounce:0.5)'))).length).toBeGreaterThan(0)

    const bouncy = localExtrema(stopsOf(cssEasingValue('spring(bounce:0.85)')))
    expect(bouncy.length).toBeGreaterThanOrEqual(3)
  })

  it('is monotonic in bounce — more asked for, further past the target', () => {
    const peak = (bounce: number): number =>
      peakOf(stopsOf(cssEasingValue(`spring(bounce:${bounce})`)))
    expect(peak(0.2)).toBeLessThan(peak(0.4))
    expect(peak(0.4)).toBeLessThan(peak(0.6))
    expect(peak(0.6)).toBeLessThan(peak(0.8))
  })
})

describe('a spring that never settles is capped, and said out loud', () => {
  // Motion's own docs warn that `damping: 0` runs forever. Sampling one into a fixed-length
  // `linear()` is worse than slow: the curve simply never reaches 1, and an entrance held by
  // `animation-fill-mode: both` would rest wherever the last stop happened to fall.
  it.each([
    ['spring(damping:0)', 'damping ratio'],
    ['spring(bounce:1)', 'never settles'],
    ['spring(bounce:2)', 'never settles'],
    // `stiffness:0` divides by zero rather than producing a small ratio, so it lands on the
    // not-a-spring branch instead of the clamp. Both are the same authoring mistake.
    ['spring(stiffness:0)', 'do not describe a spring'],
    ['spring(mass:0)', 'do not describe a spring'],
  ])('%s warns naming the value', (token, fragment) => {
    const problems = springTokenProblems(token)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain(fragment)
  })

  it('still produces a usable curve rather than refusing', () => {
    // Fail-open, like `applyGate`: a named warning plus motion beats silence plus a stuck element.
    expect(stopsOf(cssEasingValue('spring(damping:0)')).at(-1)).toBe(1)
  })

  it('says nothing about a spring that is fine', () => {
    expect(springTokenProblems('spring(bounce:0.5)')).toEqual([])
    expect(springTokenProblems('spring(stiffness:400 damping:20 mass:1)')).toEqual([])
    expect(springTokenProblems('spring()')).toEqual([])
    // Not a spring at all — callers pass every easing token through, so this must be quiet.
    expect(springTokenProblems('back-out')).toEqual([])
    expect(springTokenProblems('cubic-bezier(0.2, 0, 0, 1)')).toEqual([])
  })
})

describe('malformed spring arguments warn by name', () => {
  it.each([
    ['spring(bogus:1)', 'unknown spring parameter "bogus:1"'],
    // A known key with no value at all: refused for its value, not as an unknown key, so the
    // message points at what is missing rather than at the word the author got right.
    ['spring(bounce)', 'spring "bounce" expects a non-negative number — got ""'],
    ['spring(bounce:abc)', 'spring "bounce" expects a non-negative number'],
    ['spring(bounce:-1)', 'spring "bounce" expects a non-negative number'],
    ['spring(mass:1 mass:2)', 'duplicate spring parameter "mass"'],
    ['spring(bounce:0.4 stiffness:400)', 'describe the same curve two ways'],
  ])('%s → %s', (token, expected) => {
    expect(springTokenProblems(token).join(' | ')).toContain(expected)
  })

  it('never leaves a malformed spring without a curve', () => {
    // The failure this guards is the one the library treats as worst: an author mistypes, nothing
    // animates, and there is no clue why. Every rejected argument falls back to a default.
    for (const token of ['spring(bogus:1)', 'spring(bounce:abc)', 'spring(bounce)']) {
      expect(cssEasingValue(token)).toBe(cssEasingValue('spring()'))
    }
  })
})

describe('both easing spellings reach CSS through one resolver', () => {
  const registry = catalogRegistry()
  const run = (source: string) => compile(parse(source), registry, 'time')

  it('accepts spring() unquoted in the positional slot, spaces and colons included', () => {
    // The tokenizer is paren-aware and `splitPair` only splits on a *top-level* colon, so neither
    // the inner spaces nor the inner colons need quoting — the same reason
    // `cubic-bezier(.2, .8, .2, 1)` survives. Worth asserting: if either scanner regressed, the
    // segment would shred into unknown tokens and the effect would still animate, on the wrong
    // curve, with warnings pointing at fragments rather than at what the author wrote.
    const parsed = parse('fade-up 700ms spring(stiffness:400 damping:20 mass:1)')
    expect(parsed.warnings).toEqual([])
    expect(parsed.specs).toHaveLength(1)
    expect(parsed.specs[0]!.easing).toBe('spring(stiffness:400 damping:20 mass:1)')
    expect(parsed.specs[0]!.duration).toBe('700ms')
  })

  it('compiles the positional spelling straight into animation-timing-function', () => {
    // Inline, not a generated custom property: `--kui-*` is a flat inherited namespace, so a
    // generated `--kui-ease-spring-<hash>` would be visible to every descendant of the element
    // that declared it.
    const easing = run('fade-up 700ms spring(bounce:0.5)').declarations['animation-timing-function']
    expect(easing).toBe(cssEasingValue('spring(bounce:0.5)'))
  })

  it('compiles the ease: spelling to the same curve', () => {
    // `ease:` is read by `splitPair` as an ordinary `key:value` and never reaches `spec.easing`, so
    // it resolves through `resolveParams` instead. The two paths used to give different answers.
    const plan = run('fade-up 700ms ease:spring(bounce:0.5)')
    expect(plan.vars['--kui-reveal-ease']).toBe(cssEasingValue('spring(bounce:0.5)'))
    expect(plan.warnings).toEqual([])
  })

  it('resolves a kUInetic keyword written as ease: to its token, not to the bare word', () => {
    // The bug this suite's sibling assertion in `compile.test.ts` used to lock in:
    // `--kui-reveal-ease: back-out` is not a CSS timing function, so `animation-timing-function:
    // var(--kui-reveal-ease, ease-out)` was invalid at computed-value time and the browser used
    // `ease`. Every named curve in the library was dead in this spelling.
    expect(run('fade-up ease:back-out').vars['--kui-reveal-ease']).toBe(
      'var(--kui-ease-back-out, ease-out)',
    )
    expect(run('fade-up ease:spring').vars['--kui-reveal-ease']).toBe(
      'var(--kui-ease-spring, ease-out)',
    )
  })

  it('leaves native keywords and CSS functions exactly as written', () => {
    expect(run('fade-up ease:ease-in-out').vars['--kui-reveal-ease']).toBe('ease-in-out')
    expect(run('fade-up ease:cubic-bezier(0.2, 0, 0, 1)').vars['--kui-reveal-ease']).toBe(
      'cubic-bezier(0.2, 0, 0, 1)',
    )
  })

  it('names a malformed spring against the segment it was written in', () => {
    const parsed = parse('fade-up spring(bounce:9)')
    expect(parsed.warnings.join(' | ')).toContain('in "fade-up spring(bounce:9)"')
    // Warned, not dropped — the spec still carries the easing and still compiles.
    expect(parsed.specs[0]!.easing).toBe('spring(bounce:9)')
  })

  it('names a malformed spring in the ease: spelling too', () => {
    const plan = run('fade-up ease:spring(bounce:9)')
    expect(plan.warnings.join(' | ')).toContain('parameter "ease"')
    expect(plan.vars['--kui-reveal-ease']).toBe(cssEasingValue('spring(bounce:0.85)'))
  })
})
