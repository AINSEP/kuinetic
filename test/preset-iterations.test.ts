// @vitest-environment node
//
// Static analysis of the shipped stylesheets — no DOM required. The node environment is not
// optional here: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath` throws. Same
// reasoning, and largely the same scanning idiom, as `css-invariants.test.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { AMBIENT_PRESETS } from '../src/effects/catalog/ambient.js'
import { FEEDBACK_PRESETS } from '../src/effects/catalog/feedback.js'
import { TEXT_CSS_PRESETS } from '../src/effects/catalog/text.js'
import { MEDIA_PRESETS } from '../src/effects/catalog/media.js'
import type { Preset } from '../src/core/types.js'

/**
 * Regression coverage for the bug fixed alongside this file: `compile.ts`'s `pushTrack` composes
 * every effect's `animation-iteration-count` as a parallel value list, one entry per track,
 * defaulting each to `1` (one-shot). A preset that is supposed to loop forever has to opt back in
 * itself by declaring its own `--kui-fx-<name>-iterations: infinite` custom property (see
 * `iterationCountProperty` in `compile.ts`, and `ambient.css`/`feedback.css`'s file headers for
 * the mechanism). `marquee` and `gradient-shimmer` in `text.css` never declared theirs, so
 * composing either with any other effect silently made it run once and stop.
 *
 * A hand-written test asserting exactly `marquee` and `gradient-shimmer` declare the property
 * would only ever re-check the two names someone already knew were broken — precisely the shape
 * of check that let this bug ship. Instead, "is this preset supposed to loop forever" is derived
 * from a signal the registry already carries for an unrelated reason: `ambient.ts`/`feedback.ts`
 * both document, in their own file headers, that `reducedMotion: 'disable'` on a `css-keyframes`
 * primitive means "no finite duration would make sense, because the animation never ends" — the
 * exact fact `--kui-fx-*-iterations` exists to encode in CSS. Every `css-keyframes` primitive with
 * that policy, across every catalog scanned below, is a candidate.
 *
 * Two complications, both about `supportedTimelines`, both surfaced while widening this test to
 * `media.css`:
 *
 * - `text-marquee` (backing both `marquee` and `marquee-scroll-linked`) supports `['time',
 *   'scroll']`. `marquee-scroll-linked` — authored with `data-kui-timeline="scroll"` — is driven
 *   by scroll offset, not a clock, so it has no iteration count to declare. Only one preset
 *   sharing that primitive is guaranteed to actually iterate on a clock, so these are checked as a
 *   group: at least one of them must declare the property.
 * - `media-parallax-frame` (backing `image-parallax-frame`) supports `['view', 'scroll']` —
 *   *no* `time` option at all. Nothing built on it can ever be clock-driven, so it needs no
 *   iteration-count property under any authoring, and is exempt entirely rather than grouped.
 *
 * Presets whose primitive supports only `time` are checked individually, the strict case.
 *
 * `media-ken-burns` (backing `ken-burns`/`ken-burns-out`) doesn't appear here at all: it looked
 * like the same bug — `reducedMotion: 'disable'`, `renderer: 'css-keyframes'`, `['time']`-only,
 * no `--kui-fx-*-iterations` in `media.css` — but its keyframe (`scale: 1` to `1.12`, no
 * loop-safe midpoint) and its demo usage (`ken-burns 9000ms`, `ken-burns 3000ms on:hover`, plus a
 * separate one-shot `ken-burns-out` rather than a `-loop` variant) show it's a one-shot cinematic
 * pan/zoom with a perfectly meaningful shortened duration. The real defect was the metadata, fixed
 * in `media.ts` by dropping the `'disable'` override so it falls back to the default `'shorten'` —
 * so it's no longer a "perpetual" candidate at all, correctly.
 */
const EFFECT_FILES = ['ambient.css', 'feedback.css', 'text.css', 'media.css']

const scannedCss = EFFECT_FILES.map((file) =>
  readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8'),
).join('\n')

const registry = createRegistry()

/** Every preset from the catalogs whose primitives are known to use `reducedMotion: 'disable'`. */
const CANDIDATE_PRESETS: Preset[] = [
  ...AMBIENT_PRESETS,
  ...FEEDBACK_PRESETS,
  ...TEXT_CSS_PRESETS,
  ...MEDIA_PRESETS,
]

/** Whether this preset's own stylesheet declares `--kui-fx-<name>-iterations` anywhere. */
function declaresIterationsProperty(name: string): boolean {
  return new RegExp(`--kui-fx-${name}-iterations\\s*:`).test(scannedCss)
}

/**
 * Presets whose primitive marks them as looping forever: `renderer: 'css-keyframes'` (the only
 * renderer `pushTrack`/`iterationCountProperty` ever runs for — JS-rendered effects compose no
 * `animation-iteration-count` list at all) and `reducedMotion: 'disable'` (see file header).
 */
const perpetual = CANDIDATE_PRESETS.filter((preset) => {
  const resolved = registry.resolve(preset.name)
  return (
    resolved !== undefined &&
    resolved.primitive.renderer === 'css-keyframes' &&
    resolved.primitive.reducedMotion === 'disable'
  )
})

/**
 * How strictly a perpetual preset's own primitive requires the iterations property, based on
 * which timelines the primitive supports:
 * - `strict` — only `time` is supported, so this preset's own iteration count is its only clock.
 * - `group` — `time` is one option among others, so a sibling preset sharing this primitive may
 *   legitimately carry the loop instead (see `text-marquee` in the file header).
 * - `exempt` — `time` isn't supported at all, so nothing built on this primitive is ever
 *   clock-driven (see `media-parallax-frame` in the file header).
 */
function timelineStrictness(primitiveTimelines: readonly string[]): 'strict' | 'group' | 'exempt' {
  if (!primitiveTimelines.includes('time')) return 'exempt'
  return primitiveTimelines.length === 1 ? 'strict' : 'group'
}

describe('perpetual preset looping', () => {
  it('finds a plausible number of presets that declare perpetual intent', () => {
    // Backstop against the derivation above silently matching nothing, the same role
    // `css-invariants.test.ts`'s keyframe-count assertion plays for its own scan.
    expect(perpetual.length).toBeGreaterThanOrEqual(20)
  })

  it('every perpetual preset backed by a time-only primitive declares its own iterations property', () => {
    const violations: string[] = []

    for (const preset of perpetual) {
      const primitive = registry.resolve(preset.name)!.primitive
      if (timelineStrictness(primitive.supportedTimelines) !== 'strict') continue
      if (!declaresIterationsProperty(preset.name)) {
        violations.push(`${preset.name} (primitive ${primitive.id})`)
      }
    }

    expect(violations).toEqual([])
  })

  it('every perpetual primitive with a mixed timeline has at least one preset declaring the iterations property', () => {
    const byPrimitive = new Map<string, Preset[]>()
    for (const preset of perpetual) {
      const primitive = registry.resolve(preset.name)!.primitive
      if (timelineStrictness(primitive.supportedTimelines) !== 'group') continue
      const bucket = byPrimitive.get(primitive.id) ?? []
      bucket.push(preset)
      byPrimitive.set(primitive.id, bucket)
    }

    // A non-empty bucket set proves the group-checked branch is actually exercised, not vacuous —
    // without this, a future refactor that removed `text-marquee`'s `scroll` timeline would let
    // the loop below silently stop checking anything.
    expect(byPrimitive.size).toBeGreaterThan(0)

    const violations: string[] = []
    for (const [primitiveId, presets] of byPrimitive) {
      if (!presets.some((preset) => declaresIterationsProperty(preset.name))) {
        violations.push(`${primitiveId} (${presets.map((preset) => preset.name).join(', ')})`)
      }
    }

    expect(violations).toEqual([])
  })

  it('exempts perpetual primitives that support no time timeline at all', () => {
    const exempt = perpetual.filter((preset) => {
      const primitive = registry.resolve(preset.name)!.primitive
      return timelineStrictness(primitive.supportedTimelines) === 'exempt'
    })

    // Proves the exempt branch is reached at all, so a future change can't silently collapse it
    // into the strict/group branches without this test noticing — the same reasoning as the
    // group-branch backstop above.
    expect(exempt.length).toBeGreaterThan(0)
  })
})
