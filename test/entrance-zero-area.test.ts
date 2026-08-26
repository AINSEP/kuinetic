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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { PRESETS } from '../src/effects/catalog/core.js'
import { AMBIENT_PRESETS } from '../src/effects/catalog/ambient.js'
import { FEEDBACK_PRESETS } from '../src/effects/catalog/feedback.js'
import { INTERACTION_PRESETS } from '../src/effects/catalog/interaction.js'
import { MEDIA_PRESETS } from '../src/effects/catalog/media.js'
import { NUMBERS_PRESETS } from '../src/effects/catalog/numbers.js'
import { TEXT_PRESETS } from '../src/effects/catalog/text.js'
import { FORMS_PRESETS } from '../src/effects/forms/index.js'
import { NAVIGATION_PRESETS } from '../src/effects/navigation/index.js'
import { SVG_PRESETS } from '../src/effects/svg/index.js'
import { THREE_D_PRESETS } from '../src/effects/three-d/index.js'

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
 * Deliberately does not look at `opacity`, `visibility`, or `clip-path` — none of the three affect
 * the box's own geometry (a `clip-path`-hidden element still occupies its layout rect and is still
 * a valid `IntersectionObserver` target), so flagging them would not describe this defect and would
 * only add noise against every ordinary fade/reveal in the catalog.
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

const registry = createRegistry()

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

  it.each(enterCapablePresets.map((preset) => [preset.name, preset] as const))(
    '%s either keeps real geometry at rest, or gates its collapse behind [data-kui-state="ready"]',
    (_name, preset) => {
      const body = keyframeBody(CSS, preset.keyframes!)
      // Not one of the files this suite scans (a namesake keyframe, or none at all) — nothing to check.
      if (body === null) return

      const start = startDeclarations(body)
      // A `to`-only keyframe: the paused box is the element's ordinary rest state, not this
      // animation's collapsed one.
      if (start === null) return

      const collapse = collapsesToZeroArea(start)
      // Real geometry at rest — nothing to gate.
      if (collapse === null) return

      expect(
        hasReadyGate(CSS, preset.name),
        `${preset.name}'s from-state collapses the box (${collapse}) but no ` +
          `[data-kui-fx~='${preset.name}'][data-kui-state='ready'] rule neutralizes it, so the ` +
          `element occupies no space in layout for as long as it waits for its on:enter trigger`,
      ).toBe(true)
    },
  )
})
