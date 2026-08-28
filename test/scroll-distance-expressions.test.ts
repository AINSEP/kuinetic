import { beforeEach, describe, expect, it } from 'vitest'
import { trackProgress } from '../src/effects/scroll-mechanics/tracker.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { fakeRoot, fakeScheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * `distance:` values the browser understands and `toPixels` does not.
 *
 * `calc(100vh - 4rem)` is a valid `type: 'length'`, reaches the spacer's `height` intact, and the
 * browser resolves it exactly. `core/js-params.ts`'s `toPixels` deliberately owns no CSS
 * expression engine, so it returned its fallback — the element's own height — and progress
 * scrubbed over a range with no relationship to the scroll room the spacer had reserved. One
 * authored distance, two different numbers, and nothing said so.
 *
 * These live in their own file: `scroll-mechanics.test.ts` is at the line cap its own comment
 * already describes, and the split is the move `scroll-mechanics-readers.test.ts` and the two spy
 * files made before it.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

function trackerCtx(scheduler: ReturnType<typeof fakeScheduler>, warnings: string[]) {
  return {
    scheduler,
    rootFor: () => fakeRoot,
    warn: (message: string) => warnings.push(message),
  } as unknown as PrepareContext
}

/** The tracked element, plus the spacer the library inserts immediately after it. */
function trackedWithSpacer(elementHeight: number, spacerHeight: number) {
  const target = document.createElement('div')
  const spacer = document.createElement('div')
  document.body.append(target, spacer)
  const place = (scrollTop: number): void => {
    stubRect(target, -scrollTop, elementHeight)
    // The spacer sits after the element, so its top is the element's bottom.
    stubRect(spacer, elementHeight - scrollTop, spacerHeight)
  }
  return { target, spacer, place }
}

describe('distance: expressions with a spacer to measure', () => {
  // Both knobs vary: the expression's shape (which is what `toPixels` chokes on) and the pixel
  // height the browser resolves it to (which is the number that has to come back). Freezing either
  // would let a fix that only special-cased one of them look correct.
  it.each([
    { distance: 'calc(100vh - 4rem)', spacerHeight: 800 },
    { distance: 'calc(200vh + 10px)', spacerHeight: 1600 },
    { distance: 'calc(50vh)', spacerHeight: 500 },
  ])(
    'reads $distance back off the spacer the browser already resolved it on',
    ({ distance, spacerHeight }) => {
      const elementHeight = 300
      const { target, spacer, place } = trackedWithSpacer(elementHeight, spacerHeight)
      const scheduler = fakeScheduler()
      const warnings: string[] = []
      const seen: number[] = []

      place(0)
      trackProgress(
        target,
        trackerCtx(scheduler, warnings),
        { distance, contentAnchor: spacer },
        (progress) => seen.push(progress),
      )
      scheduler.emit(0)
      expect(seen.at(-1)).toBeCloseTo(0)

      // Halfway through the reserved scroll room must read as halfway. Falling back to the
      // element's own 300px height instead answers 1 for the first two rows and 0.83 for the
      // third — a different range in every case, and never the authored one.
      const half = spacerHeight / 2
      place(half)
      scheduler.emit(half, 1)
      expect(seen.at(-1)).toBeCloseTo(0.5)

      expect(warnings).toEqual([])
    },
  )

  it('still measures the spacer after a resize changes what the expression resolves to', () => {
    // The whole point of authoring an expression is that it moves with the viewport. Reading it
    // off the spacer keeps that: a new epoch re-measures, exactly as a `vh` distance does.
    const { target, spacer, place } = trackedWithSpacer(300, 800)
    const scheduler = fakeScheduler()
    const seen: number[] = []
    place(0)
    trackProgress(
      target,
      trackerCtx(scheduler, []),
      { distance: 'calc(100vh - 4rem)', contentAnchor: spacer },
      (progress) => seen.push(progress),
    )
    scheduler.emit(0)

    // The viewport grew; the spacer is now 1200px tall and 600px of scroll is half of it.
    stubRect(target, -600, 300)
    stubRect(spacer, 300 - 600, 1200)
    scheduler.emit(600, 1)
    expect(seen.at(-1)).toBeCloseTo(0.5)
  })
})

describe('distance: percentages with a spacer to measure', () => {
  // `50%` is not a `calc()` — `toPixels` converts it without complaint — so it never took the
  // `opaqueDistance` warn-or-measure path `c99df4c` added. But the number it returns depends on
  // `percentBasis`, which here is the *tracked element's* height, while the spacer's own
  // `height: 50%` resolves against its own containing block. Nothing keeps those the same box, so a
  // percentage is exactly as untrustworthy as a `calc()` the moment a spacer exists — it just never
  // said so. Two different percentages, so a fix special-cased to one number can't look correct by
  // accident.
  it.each([
    { distance: '50%', spacerHeight: 800 },
    { distance: '33%', spacerHeight: 500 },
  ])(
    'reads $distance back off the spacer rather than computing it against the tracked element',
    ({ distance, spacerHeight }) => {
      const elementHeight = 300
      const { target, spacer, place } = trackedWithSpacer(elementHeight, spacerHeight)
      const scheduler = fakeScheduler()
      const warnings: string[] = []
      const seen: number[] = []

      place(0)
      trackProgress(
        target,
        trackerCtx(scheduler, warnings),
        { distance, contentAnchor: spacer },
        (progress) => seen.push(progress),
      )
      scheduler.emit(0)
      expect(seen.at(-1)).toBeCloseTo(0)

      // Halfway through the reserved scroll room must read as halfway. Computing the percentage
      // against the 300px tracked element instead answers a span with no relationship to
      // `spacerHeight` — 150px for the first row, 99px for the second — never the authored range.
      const half = spacerHeight / 2
      place(half)
      scheduler.emit(half, 1)
      expect(seen.at(-1)).toBeCloseTo(0.5)

      // A percentage is not "unmeasurable" the way calc() is — resolveDistance can always compute
      // *a* number for it — so there is nothing to warn about, only a silently wrong basis to
      // prefer the spacer over. Fixed quietly, not reported.
      expect(warnings).toEqual([])
    },
  )
})

describe('distance: expressions with no spacer to measure', () => {
  function trackBare(distance: string | undefined) {
    const target = document.createElement('div')
    document.body.append(target)
    stubRect(target, 0, 300)
    const scheduler = fakeScheduler()
    const warnings: string[] = []
    const seen: number[] = []
    trackProgress(target, trackerCtx(scheduler, warnings), distance === undefined ? {} : { distance }, (progress) =>
      seen.push(progress),
    )
    return { target, scheduler, warnings, seen }
  }

  it.each(['calc(100vh - 4rem)', 'calc(200vh + 10px)'])(
    'names %s in a warning instead of silently substituting the element height',
    (distance) => {
      const { warnings } = trackBare(distance)

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(distance)
      // The warning has to carry the way out, not just the complaint.
      expect(warnings[0]).toContain('spacer:true')
    },
  )

  it('warns once at setup rather than on every scroll frame', () => {
    const { scheduler, warnings, target } = trackBare('calc(100vh - 4rem)')

    scheduler.emit(0)
    stubRect(target, -100, 300)
    scheduler.emit(100, 1)
    stubRect(target, -200, 300)
    scheduler.emit(200, 2)

    expect(warnings).toHaveLength(1)
  })

  it('keeps the element-height fallback, so the effect still scrubs while it complains', () => {
    const { scheduler, seen, target } = trackBare('calc(100vh - 4rem)')

    scheduler.emit(0)
    stubRect(target, -150, 300)
    scheduler.emit(150, 1)
    expect(seen.at(-1)).toBeCloseTo(0.5)
  })

  it.each(['400px', '100vh', '50%', '0', undefined])(
    'says nothing about %s, which it can resolve perfectly well',
    (distance) => {
      expect(trackBare(distance).warnings).toEqual([])
    },
  )

  it('still computes % directly against the tracked element when there is no spacer to disagree with', () => {
    // Confirms `usesPercentBasis` only redirects the *span computation* to a spacer when one
    // exists — a percentage with no spacer has nothing to disagree with, so it must keep resolving
    // through the ordinary `resolveDistance` path, unchanged.
    const { scheduler, seen, target } = trackBare('50%')

    // `trackBare` stubs a 300px tracked height, so 50% is a 150px span; half of that is 75px.
    scheduler.emit(0)
    stubRect(target, -75, 300)
    scheduler.emit(75, 1)
    expect(seen.at(-1)).toBeCloseTo(0.5)
  })
})
