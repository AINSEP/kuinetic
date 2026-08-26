// @vitest-environment node
//
// Static backstop for the defect `fix(effects): six presets waited out their entrance with no box
// at all` fixed (commit dd1f770): `fold-panel`, `flip-in-x`, `flip-in-y`, `loading-bar`,
// `progress-bar` and `chart-bar-grow` all shipped with a `from`-only (or `0%`-only) `@keyframes`
// block whose literal start state collapses the element to zero width or height —
// `rotateX`/`rotateY` at exactly ±90deg (edge-on to the viewport), a zero factor on `scale`, or an
// outright `height`/`width: 0`. Because that start state is exactly what paints while a deferred
// `on:enter` activation sits paused waiting for its `IntersectionObserver` to fire, the element
// held no space in layout — and no visible area — for the entire wait.
//
// The fix was never to stop collapsing the box in the keyframe (every one of the six still does,
// including the parameterized `var(--kui-bar-from, 0)`/`var(--kui-from-angle, 90deg)` forms below —
// resolving the `var()` fallback is deliberate, see `resolveVarFallbacks`). The fix was a
// `[data-kui-fx~='<name>'][data-kui-state='ready']` rule, scoped to each preset, that neutralizes
// the collapsing custom property back to a real value (with `!important`, since a paused CSS
// animation's own value can only be beaten by `!important`, not specificity or layer order) for
// exactly as long as `data-kui-state='ready'` holds — paired with an explicit `opacity: 0`, since
// none of the six own an opacity channel of their own and flattening the geometry alone would trade
// the invisible-forever bug for a visible-wrong-shape one. That opacity carries no `!important`, and
// the asymmetry with the token beside it is load-bearing: `!important` in an author layer outranks
// the Animations origin, so it would beat the opacity keyframes of a *composed* effect that
// genuinely declares the channel — interference the conflict detector was never told to look for,
// since no primitive here claims `opacity`. Left normal it applies whenever nothing else writes
// opacity (an unclaimed channel has no owner to fight) and yields when something does.
//
// `cloak: true` is deliberately not the signal this file scans for: three of the six shipped with
// `cloak: true` *and* the bug (`cloak` only ever hid the pre-JS flash, never the post-JS collapsed
// wait), so a scan keyed on it would have waved all three through.
//
// This is the unit-tier backstop the browser tier (`test/browser/on-enter-trigger.test.mjs`) has no
// equivalent of at build time: it scans every preset in the catalog whose primitive can be
// activated on `enter`, not just the six known ones, so a *seventh* preset shipping the same
// collapsed-and-ungated start state fails here before it ever needs a browser to notice.
//
// ## The clip channel, added after this file missed three
//
// `heart-fill`, `bookmark-fill` and `chart-area-fill` are the same defect reached through
// `clip-path` instead of geometry, and this file waved all three through for weeks: it excluded
// `clip-path` outright, reasoning that a clipped element still occupies its layout rect and is
// therefore still a valid `IntersectionObserver` target. The premise is true and the conclusion is
// false. `test/browser/fills-clip-path-io.test.mjs` measures the whole matrix; the short version is
// that `IntersectionObserver` does not simply read that rect, and for an SVG child whose bbox is
// inset within its own `<svg>` viewport, a clip that leaves zero painted area makes Chromium stop
// reporting the element as intersecting *at all* — no callback, ever, so `on:enter` never fires.
//
// The boundary is narrow and the widening below is scoped to match it exactly, because a blanket
// clip-path check would be wrong in both directions of usefulness:
//
//   - On an **HTML** element the same collapsed clip still reports `isIntersecting: true` (at
//     `intersectionRatio: 0`) and activates normally. `star-rating-fill` is literally
//     `chart-area-fill`'s start state on a `<span>` and has always worked. So has every
//     `media.css` wipe. Flagging them would demand gates that fix nothing.
//   - A clip that still paints *something* fires normally everywhere, so the trigger is zero
//     painted area — `circle(0)` and `inset(100% 0 0 0)` alike — not `clip-path` as such.
//
// Hence `clipsAwayEverything` below runs only against the SVG family. That scoping, not the clip
// arithmetic, is what keeps this suite off `star-rating-fill`, and the two guard tests below hold
// it in place from both sides.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Preset } from '../src/core/types.js'
import { PRESETS } from '../src/effects/catalog/core.js'
import { AMBIENT_PRESETS } from '../src/effects/catalog/ambient.js'
import { FEEDBACK_PRESETS } from '../src/effects/catalog/feedback.js'
import { INTERACTION_PRESETS } from '../src/effects/catalog/interaction.js'
import { MEDIA_PRESETS } from '../src/effects/catalog/media.js'
import { NUMBERS_PRESETS } from '../src/effects/catalog/numbers.js'
import { TEXT_PRESETS } from '../src/effects/catalog/text.js'
import { FORMS_PRESETS } from '../src/effects/forms/index.js'
import { NAVIGATION_PRESETS } from '../src/effects/navigation/index.js'
import { MOTION_PATH_PRESETS } from '../src/effects/motion-path/index.js'
import { SVG_PRESETS } from '../src/effects/svg/index.js'
import { THREE_D_PRESETS } from '../src/effects/three-d/index.js'
import { catalogRegistry } from './support/registry.js'

/**
 * Same file list `css-invariants.test.ts` scans, minus `base.css` (no preset keyframes live
 * there). Scroll-orchestration presets (`SCROLL_PRESETS`) are intentionally not part of
 * `ALL_PRESETS` below, mirroring `css-invariants.test.ts`'s "pre-JS cloak" suite: a pinned/scroll
 * preset is not the "waits below the fold for on:enter" shape this file is about.
 */
const EFFECT_FILES = [
  'entrance.css',
  'scroll.css',
  'feedback.css',
  'ambient.css',
  'interaction.css',
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

const CSS = EFFECT_FILES.map((file) =>
  readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8'),
).join('\n')

const ALL_PRESETS = [
  ...PRESETS,
  ...AMBIENT_PRESETS,
  ...FEEDBACK_PRESETS,
  ...INTERACTION_PRESETS,
  ...MEDIA_PRESETS,
  ...NUMBERS_PRESETS,
  ...TEXT_PRESETS,
  ...FORMS_PRESETS,
  ...NAVIGATION_PRESETS,
  ...SVG_PRESETS,
  ...MOTION_PATH_PRESETS,
  ...THREE_D_PRESETS,
]

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/** The full body text of a named `@keyframes` block, or null if no such block exists. */
function keyframeBody(css: string, name: string): string | null {
  const open = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(css)
  if (!open) return null
  return readBalancedBlock(css, open.index + open[0].length)
}

/**
 * A keyframe body's steps (`from`, `50%`, `to`, ...), as {selector, declarations} pairs.
 *
 * Scanned brace by brace rather than matched with `/([^{}]+)\{/g`. The regex reads better and is in
 * fact linear — `[^{}]` cannot match the `{` that follows it, so there is nothing to backtrack over
 * — but "variable-length class in front of a literal" is the shape the slow-regex lint flags, and
 * arguing a regex safe in a comment is worse than writing the scan that is safe by construction.
 */
function keyframeSteps(body: string): { selector: string; declarations: string }[] {
  const steps: { selector: string; declarations: string }[] = []
  let from = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '}') {
      from = i + 1
      continue
    }
    if (body[i] !== '{') continue
    const declarations = readBalancedBlock(body, i + 1)
    steps.push({ selector: body.slice(from, i).trim(), declarations })
    // Skip the block just consumed and its closing brace, so nothing inside is read as a selector.
    i += declarations.length + 1
    from = i + 1
  }
  return steps
}

/**
 * The literal `from`/`0%` step's declaration text, or null if the keyframe has none.
 *
 * A `to`-only keyframe (`flip-out-x`, `card-flip-x`/`-y`, `cube-rotate`, `book-page-turn`) has no
 * `from` step at all — the box that paints while it is paused waiting for its trigger is the
 * element's own, ordinary rest state, not a collapsed one, so there is nothing to check.
 */
function startDeclarations(body: string): string | null {
  const step = keyframeSteps(body).find((entry) =>
    entry.selector
      .split(',')
      .map((selector) => selector.trim())
      .some((selector) => selector === 'from' || selector === '0%'),
  )
  return step ? step.declarations : null
}

/**
 * `var(--custom-prop, fallback)` resolved to its literal fallback text, so a parameterized collapse
 * (`scale: var(--kui-bar-from, 0) 1`) is scanned exactly the same as a hardcoded one
 * (`scale: 0 1`) — both paint a zero-area box for as long as nothing overrides the custom property,
 * which is the shape every one of the six known cases has today: the parameter did not fix the
 * bug, the `[data-kui-state='ready']` gate that overrides it did.
 */
function resolveVarFallbacks(declarations: string): string {
  let out = ''
  let i = 0
  while (i < declarations.length) {
    const open = declarations.indexOf('var(', i)
    if (open === -1) return out + declarations.slice(i)
    out += declarations.slice(i, open)
    const close = declarations.indexOf(')', open)
    if (close === -1) return out + declarations.slice(open)
    const inner = declarations.slice(open + 'var('.length, close)
    const comma = inner.indexOf(',')
    // No comma means no fallback to resolve — leave the reference exactly as authored, so a
    // `var(--kui-from-angle)` with nothing to fall back on is never read as an empty value.
    out += comma === -1 ? declarations.slice(open, close + 1) : inner.slice(comma + 1).trim()
    i = close + 1
  }
  return out
}

/**
 * Whether a `from`/`0%` declaration block paints a box with no width or no height.
 *
 * Deliberately does not look at `opacity` or `visibility`: neither affects the box's own geometry
 * or its observability, so flagging them would not describe this defect and would only add noise
 * against every ordinary fade in the catalog.
 *
 * `clip-path` is not checked *here* either, but for a different and much narrower reason than the
 * one this comment used to give. A clipped element does keep its layout rect — the browser suite
 * asserts that explicitly in every cell — but that does not make it a valid observation target, and
 * the old text drew exactly that inference. It is handled separately by `clipsAwayEverything`,
 * scoped to the SVG family, because the deadlock it causes is scoped to the SVG family; see this
 * file's header.
 */
function collapsesToZeroArea(declarations: string): string | null {
  // Split on `;` first so each property can be matched with an anchored pattern. The alternative —
  // one regex per property with `([^;]+);` to grab the value — is the slow-regex shape the lint
  // rejects, and splitting is what it was approximating anyway.
  const declared = resolveVarFallbacks(declarations)
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)

  // Zero-factor scale: `scale: 0`, `scale: 0 1`, `scale: 1 0`, `scale: 0 0` — any zero factor
  // collapses that axis to nothing, same as the three bar presets' `var(--kui-bar-from, 0)`.
  const scale = declared.find((entry) => /^scale\s*:/.test(entry))
  if (scale) {
    const value = scale.slice(scale.indexOf(':') + 1).trim()
    if (value.split(/\s+/).some((factor) => /^0(?:\.0+)?$/.test(factor))) return `scale: ${value}`
  }

  // `rotateX`/`rotateY` at exactly ±90deg is edge-on to the viewport — zero rendered width or
  // height, the same shape `fold-panel`/`flip-in-x`/`flip-in-y` have.
  const rotate = /rotate[XY]\(\s*-?90deg\s*\)/.exec(declared.join(';'))
  if (rotate) return rotate[0]

  // An outright zero box-model dimension.
  const dimension = declared.find((entry) => /^(?:height|width)\s*:\s*0\b/.test(entry))
  if (dimension) return dimension

  return null
}

/**
 * One `<length-percentage>` as a percentage, or null when it is not one this scan can compare.
 *
 * Any zero is zero whatever its unit (`0`, `0%`, `0px`). Anything else that is not a plain positive
 * percentage — a real length, a `calc()`, an unresolved `var()`, a negative — returns null, and
 * every caller treats null as "cannot prove a collapse" rather than guessing. A backstop that
 * guesses in the flagging direction demands gates for effects that do not need them, which is how
 * a gate stops meaning anything.
 */
function asPercentage(token: string): number | null {
  if (/^0(?:\.0+)?(?:%|[a-z]+)?$/.test(token)) return 0
  const percent = /^\d+(?:\.\d+)?%$/.test(token) ? Number.parseFloat(token) : null
  return percent
}

/** The argument text of `name(...)` when `value` is exactly that function call, else null. */
function functionArgs(value: string, name: string): string | null {
  const prefix = `${name}(`
  if (!value.startsWith(prefix) || !value.endsWith(')')) return null
  return value.slice(prefix.length, -1).trim()
}

/** An `inset()` whose opposing edges meet clips its element away entirely. */
function insetClipsAway(args: string): string | null {
  // `round <radius>` rounds the corners; it never changes how far an edge comes in.
  const sides = (args.split(' round ')[0] ?? '').split(' ').map(asPercentage)
  if (sides.length > 4 || sides.some((side) => side === null)) return null
  // The `inset()` shorthand fills in the CSS way: one value is all four, two are vertical then
  // horizontal, three leave `left` to mirror `right`.
  const [top = 0, right = top, bottom = top, left = right] = sides as number[]
  if (top + bottom >= 100) return 'inset: top and bottom edges meet'
  if (left + right >= 100) return 'inset: left and right edges meet'
  return null
}

/**
 * A zero radius on `circle()`/`ellipse()` encloses nothing.
 *
 * Both take their radii before the optional `at <position>`, so the position is dropped first —
 * `circle(0 at 50% 50%)` is as collapsed as a bare `circle(0)`.
 */
function radiiClipAway(args: string, shape: string): string | null {
  const radii = (args.split(' at ')[0] ?? '').split(' ').map(asPercentage)
  return radii.some((radius) => radius === 0) ? `${shape}: zero radius` : null
}

/** A `polygon()` with every vertex at the same spot encloses nothing — `media.css`'s `polygon(0 0, 0 0, 0 0)`. */
function polygonClipsAway(args: string): string | null {
  // A leading `<fill-rule>` reads as a first "point" the others cannot match, so it falls through.
  const points = args.split(',').map((point) => point.trim())
  const [first] = points
  return points.length > 2 && points.every((point) => point === first) ? 'polygon: no distinct vertices' : null
}

/** Whichever basic shape `value` is, why it paints nothing — or null if it paints something. */
function clipShapeReason(value: string): string | null {
  const inset = functionArgs(value, 'inset')
  if (inset !== null) return insetClipsAway(inset)
  const circle = functionArgs(value, 'circle')
  if (circle !== null) return radiiClipAway(circle, 'circle')
  const ellipse = functionArgs(value, 'ellipse')
  if (ellipse !== null) return radiiClipAway(ellipse, 'ellipse')
  const polygon = functionArgs(value, 'polygon')
  if (polygon !== null) return polygonClipsAway(polygon)
  return null
}

/**
 * Whether a `from`/`0%` declaration block's `clip-path` leaves **zero painted area**.
 *
 * Zero painted area is the trigger, not `clip-path` — a partial clip that still paints something
 * intersects normally in every cell the browser suite measures, including the SVG one. So
 * `inset(0 30% 0 0)` (`star-rating-fill` at a 70% rating) is not flagged and must never be, while
 * `inset(100% 0 0 0)`, `inset(50%)`, `circle(0)` and a degenerate `polygon()` all are.
 *
 * Callers must scope this to the SVG family themselves — the same value on an HTML element is
 * harmless, so this function answers "does it paint nothing", not "is it a bug".
 */
function clipsAwayEverything(declarations: string): string | null {
  const clip = resolveVarFallbacks(declarations)
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => /^clip-path\s*:/.test(entry))
  if (!clip) return null

  // Whitespace collapsed once, so every split below can be a plain string split: `\s+<literal>\s+`
  // is the shape the slow-regex lint rejects, and normalising is what it was approximating anyway.
  const value = clip.slice(clip.indexOf(':') + 1).trim().replace(/\s+/g, ' ')
  const reason = clipShapeReason(value)
  return reason === null ? null : `${reason} (${clip})`
}

/**
 * The presets whose targets are SVG shapes — the only family the clip deadlock reaches.
 *
 * This is a proxy, and worth naming as one: nothing in the catalog declares "my target is an SVG
 * child", and this file cannot add such a field without reaching into `src/effects`. Module
 * membership is the closest thing that exists, and it over-includes — the icon toggles
 * (`hamburger-to-x` and friends) live here and mount on a `<button>`. Over-inclusion is the safe
 * direction: the worst it can do is ask for a `ready` gate that was not strictly needed, and a gate
 * is inert once the effect activates. Under-inclusion is what shipped the bug.
 *
 * If a `media.css` or `numbers.css` preset ever starts being authored onto `<path>` elements, this
 * set is the thing to widen — not `clipsAwayEverything`, which is already right.
 */
const SVG_TARGETED = new Set(SVG_PRESETS.map((preset) => preset.name))

/**
 * Whether some rule anywhere in `css` gates `name` behind `[data-kui-state='ready']` — the shape
 * every one of the six known fixes takes: `[data-kui-fx~='<name>'][data-kui-state='ready']`,
 * either alone or comma-grouped with siblings (`flip-in-x`/`flip-in-y` share one rule). Comments
 * are stripped first so prose *describing* the selector (this file's own module doc comment, or
 * `entrance.css`'s neighbouring comments) can never be mistaken for the rule itself.
 */
function hasReadyGate(css: string, name: string): boolean {
  const token = `[data-kui-fx~='${name}'][data-kui-state='ready']`
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Every run of text that ends at a `{`, nested rules included — so a selector inside `@layer`
  // is found as readily as one at the top level. Scanned rather than matched with
  // `/([^{}]+)\{/g`, for the reason given on `keyframeSteps` above.
  let from = 0
  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i]
    if (char !== '{' && char !== '}') continue
    if (char === '{') {
      const selectors = stripped
        .slice(from, i)
        .split(',')
        .map((selector) => selector.trim())
      if (selectors.includes(token)) return true
    }
    from = i + 1
  }
  return false
}

const registry = catalogRegistry()

/**
 * Presets that declare a `keyframes` name on a primitive that can be activated on `enter` — the
 * only shape that can paint a paused, collapsed from-state for an unbounded wait. A primitive that
 * cannot be entered on scroll (a hover/focus-only interaction primitive, an always-`load` ambient
 * loop) never sits waiting for `IntersectionObserver` the way these six did.
 */
const enterCapablePresets = ALL_PRESETS.filter((preset) => {
  if (!preset.keyframes) return false
  const resolved = registry.resolve(preset.name)
  return !!resolved && resolved.primitive.supportedActivations.includes('enter')
})

/**
 * Why `preset` paints nothing at all while it sits waiting for its trigger, or null if it paints
 * something.
 *
 * The two channels are asymmetric on purpose, and the asymmetry is the whole finding: a collapsed
 * *box* is unobservable and invisible wherever it is mounted, so `collapsesToZeroArea` runs against
 * the entire catalog, while a collapsed *clip* only deadlocks the observer on an SVG target, so
 * `clipsAwayEverything` runs only against `SVG_TARGETED`.
 */
function paintsNothingWhileWaiting(preset: Preset): string | null {
  // Not one of the files this suite scans (a namesake keyframe, or none at all) — nothing to check.
  const body = preset.keyframes ? keyframeBody(CSS, preset.keyframes) : null
  if (body === null) return null

  // A `to`-only keyframe: the paused box is the element's ordinary rest state, not this animation's
  // collapsed one.
  const start = startDeclarations(body)
  if (start === null) return null

  return collapsesToZeroArea(start) ?? (SVG_TARGETED.has(preset.name) ? clipsAwayEverything(start) : null)
}

/** One catalog preset by name, for the guard tests that name specific presets deliberately. */
function byName(name: string): Preset {
  const preset = ALL_PRESETS.find((entry) => entry.name === name)
  if (!preset) throw new Error(`no preset named '${name}' — the guard naming it is now stale`)
  return preset
}

describe('no on:enter preset waits out its trigger with a collapsed, ungated box', () => {
  it('has presets to guard, so this suite cannot pass vacuously', () => {
    expect(enterCapablePresets.length).toBeGreaterThan(0)
  })

  /**
   * Proves the collapse-detection branch itself actually runs against real presets, not just the
   * "nothing to see here" early-outs below. Without this, a change that broke `collapsesToZeroArea`
   * into never matching anything would make every `it.each` case below pass by skipping, and the
   * suite would report green while checking nothing at all.
   */
  it('finds at least one preset whose from-state collapses geometry, so the gate check below is exercised', () => {
    const collapsing = enterCapablePresets.filter((preset) => {
      const body = keyframeBody(CSS, preset.keyframes!)
      const start = body === null ? null : startDeclarations(body)
      return start !== null && collapsesToZeroArea(start) !== null
    })
    expect(collapsing.map((preset) => preset.name)).toEqual(
      expect.arrayContaining(['fold-panel', 'flip-in-x', 'flip-in-y', 'loading-bar', 'progress-bar', 'chart-bar-grow']),
    )
  })

  /**
   * The same non-vacuity proof for the clip branch, which is the one this file was missing. Without
   * it, scoping `clipsAwayEverything` to a set that had drifted empty — or narrowing its arithmetic
   * until nothing matched — would silently restore the hole the three fills fell through, and every
   * case below would pass by skipping again.
   */
  it('finds the SVG fills whose from-state clips away everything, so the clip branch below is exercised', () => {
    const clipped = enterCapablePresets.filter((preset) => {
      const body = keyframeBody(CSS, preset.keyframes!)
      const start = body === null ? null : startDeclarations(body)
      return start !== null && SVG_TARGETED.has(preset.name) && clipsAwayEverything(start) !== null
    })
    expect(clipped.map((preset) => preset.name)).toEqual(
      expect.arrayContaining(['heart-fill', 'bookmark-fill', 'chart-area-fill']),
    )
  })

  /**
   * The other side of that boundary, held from both directions at once.
   *
   * `star-rating-fill` is the case that makes this necessary: its from-state is byte-for-byte
   * `chart-area-fill`'s, so the *detector* sees it, and only the SVG scoping keeps this suite off
   * it. It ships on an ordinary `<span>` on `demo/data-hover.html`, activates, and has no `ready`
   * gate — asserted here, so that if someone ever adds one this guard stops silently passing for
   * the wrong reason. A widening that flagged it would demand a gate that fixes nothing and hides
   * the star row for the duration of its own wait.
   */
  it('does not flag a collapsed clip on an HTML target, nor any partial clip anywhere', () => {
    // The detector does see the value — it is the scoping, not the arithmetic, that excludes it.
    expect(clipsAwayEverything('clip-path: inset(0 100% 0 0);')).not.toBeNull()
    expect(SVG_TARGETED.has('star-rating-fill')).toBe(false)
    expect(paintsNothingWhileWaiting(byName('star-rating-fill'))).toBeNull()
    expect(hasReadyGate(CSS, 'star-rating-fill')).toBe(false)

    // media.css's wipes are the same shape in bulk: collapsed clips — inset, circle, polygon and
    // opposing-edge alike — on HTML targets, all working.
    for (const name of ['wipe-up', 'wipe-left', 'wipe-circle', 'wipe-diagonal', 'curtain-reveal']) {
      expect(paintsNothingWhileWaiting(byName(name)), `${name} should not be flagged`).toBeNull()
    }

    // A clip that still paints something intersects normally in every cell, SVG included, so the
    // trigger is zero painted area rather than `clip-path` as such.
    expect(clipsAwayEverything('clip-path: inset(0 30% 0 0);')).toBeNull()
    expect(clipsAwayEverything('clip-path: inset(0 0 0 0);')).toBeNull()
    expect(clipsAwayEverything('clip-path: circle(75% at 50% 50%);')).toBeNull()

    // ...and the forms that do paint nothing, whichever way they say it.
    expect(clipsAwayEverything('clip-path: inset(50%);')).not.toBeNull()
    expect(clipsAwayEverything('clip-path: circle(0 at 50% 50%);')).not.toBeNull()
    expect(clipsAwayEverything('clip-path: polygon(0 0, 0 0, 0 0);')).not.toBeNull()
  })

  it.each(enterCapablePresets.map((preset) => [preset.name, preset] as const))(
    '%s either paints something at rest, or gates its collapse behind [data-kui-state="ready"]',
    (_name, preset) => {
      const collapse = paintsNothingWhileWaiting(preset)
      // Paints something at rest — nothing to gate.
      if (collapse === null) return

      expect(
        hasReadyGate(CSS, preset.name),
        `${preset.name}'s from-state paints nothing (${collapse}) but no ` +
          `[data-kui-fx~='${preset.name}'][data-kui-state='ready'] rule neutralizes it, so for as ` +
          `long as it waits for its on:enter trigger it is invisible — and, for a clipped SVG ` +
          `target, invisible to the IntersectionObserver it is waiting on, which never fires`,
      ).toBe(true)
    },
  )
})
