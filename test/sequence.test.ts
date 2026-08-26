import { describe, expect, it } from 'vitest'
import { parsePosition, resolveSequence } from '../src/core/sequence.js'
import type { SequenceMember } from '../src/core/sequence.js'

/**
 * `core/sequence.ts` takes a flat description of each segment rather than an `Entry`, precisely so
 * its arithmetic and its grammar can be exercised without building a registry. These are those
 * tests; `test/sequencing.test.ts` covers the same feature through the real catalog.
 */
function member(overrides: Partial<SequenceMember> = {}): SequenceMember {
  return { name: 'fade-up', primitiveId: 'reveal', positionable: true, ...overrides }
}

function resolve(members: SequenceMember[]) {
  const warnings: string[] = []
  const steps = resolveSequence(members, 'time', (m) => warnings.push(m))
  return { steps, warnings }
}

describe('parsePosition — the at: grammar', () => {
  it('reads a bare signed offset as relative to the previous effect ENDING', () => {
    const parsed = parsePosition('-200ms')
    expect(parsed).toEqual({
      ok: true,
      position: { anchor: 'end', offsetMs: -200, term: ' - 200ms' },
    })
  })

  it('signs a positive offset correctly', () => {
    // Regression: `toMilliseconds` accepts a leading `-` and not a `+`, because a CSS time is
    // never written with an explicit plus. Handing it `+100ms` fell off the pattern and returned
    // the zero fallback, which turned every `at:+100ms` into `at:after` on the JS path only.
    expect(parsePosition('+100ms')).toEqual({
      ok: true,
      position: { anchor: 'end', offsetMs: 100, term: ' + 100ms' },
    })
  })

  it('reads `with` as relative to the previous effect STARTING', () => {
    expect(parsePosition('with')).toEqual({
      ok: true,
      position: { anchor: 'start', offsetMs: 0, term: '' },
    })
  })

  it('accepts an offset after a named anchor', () => {
    expect(parsePosition('with+150ms')).toEqual({
      ok: true,
      position: { anchor: 'start', offsetMs: 150, term: ' + 150ms' },
    })
  })

  it('treats a bare `after` as exactly the previous effect’s end', () => {
    expect(parsePosition('after')).toEqual({
      ok: true,
      position: { anchor: 'end', offsetMs: 0, term: '' },
    })
  })

  it('keeps the author’s own unit rather than normalising to milliseconds', () => {
    // The CSS half is built from the text, so `0.2s` stays `0.2s` in the compiled `calc()` and
    // reads in devtools as what was written.
    expect(parsePosition('-0.2s')).toEqual({
      ok: true,
      position: { anchor: 'end', offsetMs: -200, term: ' - 0.2s' },
    })
  })

  it('is case-insensitive about the anchor keyword', () => {
    expect(parsePosition('WITH')).toEqual({
      ok: true,
      position: { anchor: 'start', offsetMs: 0, term: '' },
    })
  })

  it('refuses an absolute position and says why it is refused', () => {
    // The whole reason this parameter exists: an absolute `at:` is `delay:` renamed, and a
    // previous investigation in this repo rejected respelling existing semantics.
    const parsed = parsePosition('200ms')
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.reason).toContain('delay:200ms')
    expect(parsed.ok === false && parsed.reason).toContain('at:+200ms')
  })

  it('refuses an unsigned offset after an anchor for the same reason', () => {
    expect(parsePosition('with200ms').ok).toBe(false)
  })

  it('refuses text that is not a position at all', () => {
    for (const value of ['', 'soon', 'with+', '+200', '+200px', 'before-200ms']) {
      expect(parsePosition(value).ok, value).toBe(false)
    }
  })
})

describe('resolveSequence — a segment with no at: is untouched', () => {
  it('compiles to the primitive’s own delay property, exactly as before sequencing existed', () => {
    const { steps, warnings } = resolve([member()])
    expect(steps[0]).toEqual({
      delayExpr: 'var(--kui-reveal-delay, 0ms)',
      delayMs: 0,
      sequenced: false,
    })
    expect(warnings).toEqual([])
  })

  it('uses an authored positional delay verbatim', () => {
    expect(resolve([member({ delay: '300ms' })]).steps[0]).toEqual({
      delayExpr: '300ms',
      delayMs: 300,
      sequenced: false,
    })
  })

  it('reads a cascade delay for the numeric mirror without putting it in the expression', () => {
    // The expression stays symbolic on purpose — a consumer stylesheet may still move it.
    expect(resolve([member({ cascadeDelay: '80ms' })]).steps[0]).toEqual({
      delayExpr: 'var(--kui-reveal-delay, 0ms)',
      delayMs: 80,
      sequenced: false,
    })
  })

  it('reads an unreadable cascade delay as the same 0ms the compiled var() falls back to', () => {
    // `compile` screens its candidates before they get here, so this is the module holding up its
    // own end of a structural contract rather than a path the compiler can reach — but the contract
    // is real: `delayMs` is documented as always a number, and a caller can hand in anything.
    expect(resolve([member({ cascadeDelay: 'banana' })]).steps[0]).toMatchObject({ delayMs: 0 })
  })
})

describe('resolveSequence — relative positioning', () => {
  const first = member({ name: 'fade-up', duration: '600ms' })

  it('starts an effect before the previous one ends', () => {
    const second = member({ name: 'blur-in', primitiveId: 'blur', at: '-200ms' })
    const { steps } = resolve([first, second])
    expect(steps[1]).toEqual({
      delayExpr: 'var(--kui-reveal-delay, 0ms) + 600ms - 200ms',
      delayMs: 400,
      sequenced: true,
    })
  })

  it('starts an effect after the previous one ends', () => {
    const second = member({ name: 'blur-in', primitiveId: 'blur', at: '+100ms' })
    expect(resolve([first, second]).steps[1]).toMatchObject({
      delayExpr: 'var(--kui-reveal-delay, 0ms) + 600ms + 100ms',
      delayMs: 700,
    })
  })

  it('starts an effect alongside the previous one, ignoring its duration entirely', () => {
    const second = member({ name: 'blur-in', primitiveId: 'blur', at: 'with' })
    expect(resolve([first, second]).steps[1]).toMatchObject({
      delayExpr: 'var(--kui-reveal-delay, 0ms)',
      delayMs: 0,
    })
  })

  it('leaves an unwritten duration symbolic so the browser re-derives the sequence', () => {
    // The point of not resolving to numbers: restyling `--kui-reveal-duration` moves the second
    // effect too, with no recompile. The numeric mirror still answers from the schema default.
    const anchor = member({ name: 'fade-up', cascadeDuration: '600ms' })
    const second = member({ name: 'blur-in', primitiveId: 'blur', at: '+100ms' })
    expect(resolve([anchor, second]).steps[1]).toEqual({
      delayExpr: 'var(--kui-reveal-delay, 0ms) + var(--kui-reveal-duration, 600ms) + 100ms',
      delayMs: 700,
      sequenced: true,
    })
  })

  it('chains through a whole list, each segment relative to the one before it', () => {
    const members = [
      member({ name: 'a', primitiveId: 'a', duration: '600ms' }),
      member({ name: 'b', primitiveId: 'b', duration: '400ms', at: '-200ms' }),
      member({ name: 'c', primitiveId: 'c', duration: '300ms', at: '+50ms' }),
    ]
    const { steps, warnings } = resolve(members)
    expect(steps.map((s) => s.delayMs)).toEqual([0, 400, 850])
    expect(steps[2]!.delayExpr).toBe('var(--kui-a-delay, 0ms) + 600ms - 200ms + 400ms + 50ms')
    expect(warnings).toEqual([])
  })

  it('anchors to the previous segment even when that one was not itself sequenced', () => {
    // "Previous" means the segment before it in the list, full stop — not "the previous one that
    // used at:". A list can mix positioned and unpositioned segments freely.
    const members = [
      member({ name: 'a', primitiveId: 'a', duration: '600ms' }),
      member({ name: 'b', primitiveId: 'b', duration: '400ms', delay: '1000ms' }),
      member({ name: 'c', primitiveId: 'c', at: 'after' }),
    ]
    expect(resolve(members).steps[2]).toMatchObject({ delayMs: 1400 })
  })
})

describe('resolveSequence — refusals leave the effect where it would have been', () => {
  it('refuses at: on the first segment, which has nothing to follow', () => {
    const { steps, warnings } = resolve([member({ at: '-200ms', delay: '50ms' })])
    expect(steps[0]).toMatchObject({ delayExpr: '50ms', delayMs: 50, sequenced: false })
    expect(warnings[0]).toContain('first effect in the list')
  })

  it('refuses to measure from an effect that has no duration, and names both', () => {
    const members = [
      member({ name: 'pin-section', primitiveId: 'pin', positionable: false }),
      member({ name: 'fade-up', at: '+100ms' }),
    ]
    const { steps, warnings } = resolve(members)
    expect(steps[1]!.sequenced).toBe(false)
    expect(warnings[0]).toContain('cannot start "fade-up" relative to the end of "pin-section"')
    expect(warnings[0]).toContain('at:with')
  })

  it('still allows `with` after a durationless effect, since no end is needed', () => {
    const members = [
      member({ name: 'pin-section', primitiveId: 'pin', positionable: false }),
      member({ name: 'fade-up', at: 'with+100ms' }),
    ]
    const { steps, warnings } = resolve(members)
    expect(steps[1]).toMatchObject({
      delayExpr: 'var(--kui-pin-delay, 0ms) + 100ms',
      delayMs: 100,
      sequenced: true,
    })
    expect(warnings).toEqual([])
  })

  it('refuses loudly for a renderer that cannot act on a delay at all', () => {
    // §9.4 of the parity outline: an effect that still lacks `delay` must fail loudly rather than
    // silently ignoring its at:. Silence here looks identical to a working sequence.
    const members = [
      member({ name: 'fade-up', duration: '600ms' }),
      member({ name: 'split-flap', primitiveId: 'split-flap', at: '+100ms', positionable: false }),
    ]
    const { steps, warnings } = resolve(members)
    expect(steps[1]!.sequenced).toBe(false)
    expect(warnings[0]).toContain('"split-flap" is rendered in JavaScript and declares no "delay"')
  })

  it('warns when at: and a positional delay both position one segment', () => {
    const members = [
      member({ name: 'fade-up', duration: '600ms' }),
      member({ name: 'blur-in', primitiveId: 'blur', at: '-200ms', delay: '100ms' }),
    ]
    const { steps, warnings } = resolve(members)
    // at: wins — it is the more specific request, and the two cannot both be honoured.
    expect(steps[1]).toMatchObject({ delayMs: 400, sequenced: true })
    expect(warnings[0]).toContain('has both a positional delay (100ms)')
  })

  it('refuses an unreadable duration rather than reading it as zero', () => {
    // Defaulting it to 0 would stack `b` straight on top of `a` — a plausible-looking wrong answer
    // rather than a missing one. Refusing here is what lets `delayMs` be a plain number everywhere
    // downstream instead of an "unknown" threaded through the chain.
    const members = [
      member({ name: 'a', primitiveId: 'a', cascadeDuration: 'calc(1s / 2)' }),
      member({ name: 'b', primitiveId: 'b', at: '+100ms' }),
    ]
    const { steps, warnings } = resolve(members)
    expect(steps[1]).toMatchObject({ sequenced: false, delayMs: 0 })
    expect(warnings[0]).toContain('"a" has no readable duration')
  })
})

describe('resolveSequence — scroll-driven timelines', () => {
  it('warns once that a progress timeline ignores the compiled delay', () => {
    const warnings: string[] = []
    const members = [
      member({ name: 'a', primitiveId: 'a', duration: '600ms' }),
      member({ name: 'b', primitiveId: 'b', duration: '400ms', at: '-200ms' }),
      member({ name: 'c', primitiveId: 'c', duration: '300ms', at: '-100ms' }),
    ]
    const steps = resolveSequence(members, 'view', (m) => warnings.push(m))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('data-kui-timeline')
    // Warned, not dropped: a browser without scroll-driven animations degrades the element to a
    // clock, where this delay is once again exactly right.
    expect(steps[1]!.sequenced).toBe(true)
  })

  it('says nothing about a scroll timeline when no segment uses at:', () => {
    const warnings: string[] = []
    resolveSequence([member(), member({ name: 'b', primitiveId: 'b' })], 'scroll', (m) =>
      warnings.push(m),
    )
    expect(warnings).toEqual([])
  })

  it('positions normally on `pin`, where the delay is the scrub head', () => {
    const warnings: string[] = []
    const members = [
      member({ name: 'a', primitiveId: 'a', duration: '600ms' }),
      member({ name: 'b', primitiveId: 'b', at: '-200ms' }),
    ]
    const steps = resolveSequence(members, 'pin', (m) => warnings.push(m))
    expect(warnings).toEqual([])
    expect(steps[1]).toMatchObject({ delayMs: 400, sequenced: true })
  })
})
