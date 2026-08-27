// @vitest-environment node
//
// Two composition-safety audits that share one shape: a box or mechanism the `channels` model
// does not describe, shared by two presets the compiler treats as freely composable because their
// declared channels are disjoint. Split out of `css-invariants.test.ts` once that file hit its own
// 400-line lint ceiling — see `css-scan.ts`'s file comment for the first time this exact split
// happened, for the same reason.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extractKeyframes,
  extractPseudoElementProperties,
  extractTransitionedProperties,
  pseudoElementCollisions,
  stripComments,
} from './support/css-scan.js'
import { transitionsOutsideChannels } from './support/channel-properties.js'
import { catalogRegistry } from './support/registry.js'
import type { Registry } from '../src/core/registry.js'

/** Same file list `css-invariants.test.ts` scans — a collision can span two files (`beam-border` in
 * `interaction.css`, `redaction-reveal` in `text.css`), so narrowing this to "just the files this
 * cluster owns" would silently under-audit rather than over-audit. */
const EFFECT_FILES = [
  'entrance.css',
  'scroll.css',
  'feedback.css',
  'ambient.css',
  'interaction.css',
  'discrete.css',
  'layout.css',
  'numbers.css',
  'forms.css',
  'navigation.css',
  'three-d.css',
  'media.css',
  'text.css',
  'svg.css',
  'motion-path.css',
]

// Comment-stripped for the same reason `css-invariants.test.ts` strips its own `scannedCss`: a
// retired preset's CSS kept commented-out for reference (`ambient.css`'s `noise-overlay` cut) would
// otherwise read as live to every regex below.
const scannedCss = stripComments(
  EFFECT_FILES.map(
    (file) => readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8'),
  ).join('\n'),
)

const registry = catalogRegistry()

/** A preset name's declared channels, or `undefined` if it isn't a registered preset. */
const channelsOf = (name: string): readonly string[] | undefined =>
  registry.resolve(name)?.primitive.channels

/** Every registered preset that declares its own `transitions` — the compile-time merge's source
 * of truth, replacing the bare host-rule `transition:` the stylesheets used to carry. */
function presetsWithTransitions(effectRegistry: Registry): string[] {
  return effectRegistry.names().filter((name) => effectRegistry.resolve(name)?.preset.transitions)
}

/**
 * Pseudo-element ownership.
 *
 * `extractBaseRuleProperties`/`extractHostAnimationBindings` (in `css-invariants.test.ts`) correctly
 * skip `::before`/`::after` — a pseudo-element paints a different box than the one `data-kui-fx`
 * sits on, so it cannot clobber a composed effect's *host* channel. But that same reasoning cuts the
 * other way for two presets that both reach for the *same* pseudo-element: `::after` is one physical
 * box per host element, shared by every rule that targets it, so two disjoint-channel presets that
 * both paint their own `::after` (or both their own `::before`) can still clobber each other there —
 * the channel model, keyed on the host, has no way to see it either direction.
 */
describe('pseudo-element ownership', () => {
  it('has presets with a pseudo-element rule, so this suite cannot pass vacuously', () => {
    expect(extractPseudoElementProperties(scannedCss).size).toBeGreaterThan(0)
  })

  /**
   * Confirmed reachable collisions today, named exactly rather than asserted empty: every pair
   * below is a genuine, live gap (composing either pair silently corrupts one effect), but closing
   * it needs a real design — giving each pseudo-element painter its own tracked "box channel", or
   * moving one member of a colliding pair off the box the other already owns — not a channel-property
   * widening. That is bigger than this audit's remit, so this documents the exact discovered set
   * rather than claiming the gap is closed. It still earns its keep as regression coverage: a *new*
   * pseudo-element collision — an eleventh pair — fails this test immediately instead of shipping
   * silently, which is the entire problem this file exists to catch.
   *
   * `shine-sweep`/`underline-slide` is the pair named in the original audit request. Enumerating the
   * check generally (every disjoint pair sharing a pseudo-element, not just that one) turned up five
   * more of the same shape: `underline-center` shares `shine-sweep`'s `::after` for the same reason
   * `underline-slide` does, and `beam-border`/`beam-border-auto`/`cursor-spotlight`/`redaction-reveal`
   * (`text.css`, outside this cluster's owned files) all paint `::before`.
   */
  it('names every disjoint-channel pair that paints a colliding property on the same pseudo-element', () => {
    expect(pseudoElementCollisions(scannedCss, channelsOf)).toEqual([
      "beam-border + cursor-spotlight (::before): background, border-radius, content, inset, opacity, pointer-events, position, transition",
      "beam-border + redaction-reveal (::before): background, content, inset, position",
      "beam-border-auto + cursor-spotlight (::before): background, border-radius, content, inset, opacity, pointer-events, position, transition",
      "beam-border-auto + redaction-reveal (::before): background, content, inset, position",
      "cursor-spotlight + redaction-reveal (::before): background, content, inset, position",
      "shine-sweep + underline-center (::after): background, content, position",
      "shine-sweep + underline-slide (::after): background, content, position",
    ])
  })
})

/**
 * Transition channel — compile-time merge.
 *
 * `transition:` is a shorthand: writing it resets `transition-property`/`-duration`/`-delay`/
 * `-timing-function` together, the same way `background:`/`mask:` reset every longhand they cover
 * (see the top-of-file note on `CHANNEL_PROPERTIES` in `channel-properties.ts`). Two presets that
 * each owned a bare `transition:` on their host rule and composed because their `channels` were
 * disjoint used to fight over that one shorthand instead of merging into "transition both
 * properties" the way two `@keyframes`-driven animations do: `compile.ts` has always concatenated
 * composed keyframe names into one combined `animation:` list, but nothing did the equivalent for a
 * hand-authored CSS `transition:`, because these were static stylesheet rules, not per-instance
 * compiled output. Whichever preset's rule was later in source/cascade order won the *entire*
 * shorthand for that element, and the earlier one's transition vanished outright.
 *
 * The concrete case this closes: `data-kui="lift, border-glow"` declares `['translate']` vs
 * `['shadow']` — disjoint, so the compiler composes them — and `border-glow`'s rule used to replace
 * `lift`'s by source order in `interaction.css`, so `lift` snapped to its hovered position instead
 * of easing into it. The fix moves each preset's transition timing out of a bare stylesheet
 * `transition:` and into `Preset.transitions`, merged at compile time (`compile.ts`'s
 * `pushTransitions`) into one `--kui-transition` custom property that `base.css`'s single
 * `:where([data-kui-fx])` rule reads — see that rule's own comment for the full mechanism.
 *
 * Not a `CHANNEL_PROPERTIES` entry: adding `transition` as a tracked channel would put all ten
 * migrated presets on one channel and forbid every legal hover combination among them, which is the
 * opposite of what composing `lift` with `border-glow` is supposed to mean.
 */
describe('transition channel (compile-time merge)', () => {
  // Non-vacuity, on the new source of truth. `extractTransitionedProperties` below now asserts an
  // *empty* scan, which would otherwise pass just as trivially by scanning nothing — this is what
  // makes that emptiness meaningful.
  it('has presets declaring transitions, so this suite cannot pass vacuously', () => {
    expect(presetsWithTransitions(registry).length).toBeGreaterThanOrEqual(10)
  })

  // Strictly stronger than the clobber-pair assertion this replaced: the merge is now the only
  // legal spelling, so a host-rule `transition:` is a violation whether or not it happens to pair
  // with a disjoint sibling today. Fails the moment a future preset #11 reaches for the old
  // spelling instead of `Preset.transitions`.
  it('no preset writes a host-rule transition in the stylesheet', () => {
    expect([...extractTransitionedProperties(scannedCss).keys()]).toEqual([])
  })

  // Self-consistency: what keeps the duplicate-transition-property case (two composed presets
  // easing the same physical property, allowed and warned rather than refused — see
  // `compile.ts`'s `pushTransitions`) visible to `findConflicts` at all. A preset that transitions
  // a property outside its own declared channels is invisible to conflict detection for exactly
  // that property, which is the bug `word-cycler`/`header-shrink`/`border-draw` had before their
  // channels were widened to cover what they actually transition.
  it("every declared transition property falls inside that preset's own channels", () => {
    expect(transitionsOutsideChannels(registry)).toEqual([])
  })
})

/**
 * `stripComments` on synthetic CSS, isolated from the real stylesheets so both failure directions
 * can be proven on demand rather than waiting for the catalog to happen to contain one of each.
 *
 * `kui-noise-overlay` is exactly this bug: `ambient.css` keeps a retired preset's whole rule and
 * `@keyframes` block commented out for reference (its own header names the convention: "cut
 * 2026-08-26 ... commented out, not deleted, so it can be revived"), and `extractKeyframes` used to
 * run its `@keyframes\s+([\w-]+)\s*\{` regex over the raw file text with no idea a `/* *\/` block
 * was even there, so it read the retired keyframe as live and reported it as an orphan that had
 * never been running. `scannedCss` in both invariant files is comment-stripped before any scanner
 * sees it now (see `stripComments`'s own doc comment) — these three cases are the fix's proof.
 */
describe('comment-stripped keyframe scanning', () => {
  // Shaped exactly like the real `noise-overlay` cut: a live keyframe on either side, and between
  // them a commented-out rule plus `@keyframes` block, complete with its own `{`/`}` pairs.
  const SYNTHETIC = `
    @keyframes kui-live-referenced {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    /* retired: kept for reference, matching ambient.css's own convention.
    [data-kui-fx~='retired-preset'] {
      background-image: repeating-radial-gradient(circle at 0 0, red 0, transparent 4px);
    }
    @keyframes kui-retired-in-comment {
      from { background-position: 0 0; }
      to { background-position: 9px 9px; }
    }
    */
    @keyframes kui-live-unreferenced {
      from { translate: 0 0; }
      to { translate: 10px 0; }
    }
  `
  const scanned = extractKeyframes(stripComments(SYNTHETIC))

  it('drops a keyframe block that exists only inside a comment', () => {
    expect(scanned.has('kui-retired-in-comment')).toBe(false)
  })

  it('still extracts a live keyframe with no preset referencing it — a real orphan is still visible', () => {
    // This is the direction a blind "strip everything that looks risky" fix could break: proving
    // the block is still *found* is what proves `css-invariants.test.ts`'s orphan-detection test
    // would still flag it, the same way it would flag `kui-retired-in-comment` if that one weren't
    // gone from `keyframes` entirely.
    expect(scanned.has('kui-live-unreferenced')).toBe(true)
  })

  it('does not let the comment swallow the real declaration that follows it', () => {
    // The greedy-match trap: a comment containing its own `{`/`}` pairs must not get read as open
    // braces that consume the next real rule. If it did, `kui-live-unreferenced`'s body would come
    // back empty (or the block would vanish entirely) instead of holding exactly `translate`.
    expect(scanned.get('kui-live-unreferenced')).toEqual(new Set(['translate']))
    expect(scanned.get('kui-live-referenced')).toEqual(new Set(['opacity']))
  })
})
