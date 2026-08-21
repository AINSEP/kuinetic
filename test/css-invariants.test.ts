// @vitest-environment node
//
// Static analysis of the shipped stylesheets — no DOM required. The node environment is not
// optional here: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath` throws.
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
import { SCROLL_PRESETS } from '../src/effects/scroll-mechanics/presets.js'
import { SVG_PRESETS } from '../src/effects/svg/index.js'
import { THREE_D_PRESETS } from '../src/effects/three-d/index.js'
import { CHANNEL_PROPERTIES } from './support/channel-properties.js'

/**
 * Structural guard on the channel model.
 *
 * Composition safety is decided from each primitive's declared `channels`. If a keyframe — or an
 * unconditional `[data-kui-fx~=X]` rule — writes a property outside those channels, two effects
 * can collide on it while the compiler believes they are disjoint: the conflict detector then
 * reports a clean compose and the browser silently discards (or overwrites) one effect's output.
 * Nothing at runtime catches that, so it is asserted here against the real stylesheets.
 *
 * `gradient-mesh, spinner-dots` was exactly this: spinner-dots' `background: currentColor`
 * static rule lived outside `@keyframes`, so a scanner that only read keyframe bodies never saw
 * it and the collision detector waved the pair through. `feedback-dot-pulse` under-declared
 * `background`/`shadow` because nothing checked its static rule against its channels — see
 * `catalog-feedback.test.ts` for the regression coverage.
 */

/**
 * Stylesheets scanned for both the keyframe-channel and static-rule-channel invariants below.
 *
 * `media.css` and `text.css` were once excluded because the properties their `mask`/`font`
 * channels write (`mask-image`/`mask-position`/`mask-size`, `font-weight`/`font-stretch`/
 * `font-style`) had no entry in `CHANNEL_PROPERTIES`. Both channels are mapped now — see
 * `./support/channel-properties.js` — so every catalog stylesheet is audited here.
 */
const EFFECT_FILES = [
  'entrance.css',
  'scroll.css',
  'feedback.css',
  'ambient.css',
  'interaction.css',
  'numbers.css',
  'forms.css',
  'navigation.css',
  'three-d.css',
  'media.css',
  'text.css',
  'svg.css',
]

/**
 * All stylesheets are read once at module scope. Reading them lazily inside a test fails under
 * the jsdom environment, where `import.meta.url` is no longer a `file:` URL.
 */
const SOURCES = new Map<string, string>(
  ['base.css', ...EFFECT_FILES].map((file) => [
    file,
    readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8'),
  ]),
)

/**
 * Every preset across the catalogs scanned by `EFFECT_FILES`, so the widened checks below
 * validate real presets instead of silently skipping everything outside the original
 * entrance/scroll matrix. Skip guards (`if (!resolved) continue`) make it safe to include a
 * preset here whose stylesheet isn't in `EFFECT_FILES` — it just never matches a rule.
 */
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

/** The union of every property any channel tracks — used to keep the static-rule scan below from
 * flagging box-model/layout declarations (`display`, `width`, `border`) or custom properties
 * (`--kui-fx-*-iterations`) that the channel model was never meant to police. */
const TRACKED_PROPERTIES = new Set(Object.values(CHANNEL_PROPERTIES).flat())

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
 * Declared CSS property names inside a block body, however the declarations are laid out.
 *
 * Anchored to "right after the block's own opening brace, or after `{`/`;`" rather than to
 * start-of-line: a line-anchored regex silently extracts nothing from a compact
 * `from { prop: val; }` single-line keyframe — media.css writes several this way — which is
 * worse than a hard failure, since every assertion below would then pass vacuously instead of
 * checking anything. Requires the name to start with a lowercase letter so custom properties
 * (`--kui-border-angle`, `--kui-fx-spinner-iterations`) are never mistaken for a rendered,
 * channel-relevant property — the channel model polices painted CSS properties, not the custom
 * properties that sometimes drive them.
 */
function extractDeclaredProperties(body: string): Set<string> {
  const properties = new Set<string>()
  for (const [, property] of body.matchAll(/(?:^|[{;])\s*([a-z][a-z-]*)\s*:/g)) {
    if (property) properties.add(property)
  }
  return properties
}

/**
 * name → the CSS properties its `@keyframes` blocks write.
 *
 * Brace-balanced rather than indentation-matched: an indentation-sensitive regex would quietly
 * extract nothing if a formatter reflowed the file, and every assertion below would then pass
 * vacuously. The size assertion is the backstop for that.
 */
function extractKeyframes(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()

  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    found.set(match[1]!, extractDeclaredProperties(body))
  }
  return found
}

/**
 * preset name → the CSS properties its *unconditional* `[data-kui-fx~='name']` rule writes.
 *
 * Deliberately excludes anything with a combinator, pseudo-class, or pseudo-element in the
 * selector (`:hover`, `:focus-visible`, `::before`, `~ .foo`) — those rules paint a conditional
 * state or a different box (a sibling, a pseudo-element) than the element `data-kui-fx` lives on,
 * so they cannot silently clobber another composed effect's property on the *same* box the way an
 * always-on base-selector declaration can. That is exactly the shape of the spinner-dots bug:
 * `[data-kui-fx~='spinner-dots'] { background: currentColor; ... }` is unconditional and lands on
 * the same element `gradient-mesh` paints its background on.
 */
function extractBaseRuleProperties(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const match of css.matchAll(/^[ \t]*\[data-kui-fx~=(['"])([\w-]+)\1\][ \t]*\{/gm)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    const name = match[2]!
    const existing = found.get(name) ?? new Set<string>()
    for (const property of extractDeclaredProperties(body)) existing.add(property)
    found.set(name, existing)
  }
  return found
}

const scannedCss = EFFECT_FILES.map((file) => SOURCES.get(file)).join('\n')
const keyframes = extractKeyframes(scannedCss)
const baseRules = extractBaseRuleProperties(scannedCss)
const registry = createRegistry()

/** `channels` a resolved preset's primitive is allowed to write, as concrete CSS property names. */
function allowedProperties(primitiveChannels: readonly string[]): Set<string> {
  return new Set(primitiveChannels.flatMap((channel) => CHANNEL_PROPERTIES[channel] ?? []))
}

/**
 * Keyframe names referenced by a literal `animation:`/`animation-name:` declaration somewhere in
 * the scanned CSS — the hover family in interaction.css (`shine-sweep`, `split-flap`,
 * `beam-border`, the icon-* trio) and forms.css's inline spinner drive their animation this way
 * instead of through a preset's `keyframes` field, per interaction.ts's own doc comment: their
 * "actual, fully reversible motion is native `:hover`/`:focus-visible` CSS ... rather than this
 * primitive's compiled `animation-*` path". Without this, every one of them reads as an orphan.
 */
const inlineAnimationRefs = new Set(
  [...scannedCss.matchAll(/\banimation(?:-name)?\s*:\s*([\w-]+)/g)].map((match) => match[1]!),
)

describe('CSS keyframes', () => {
  it('parses a plausible number of keyframe blocks', () => {
    expect(keyframes.size).toBeGreaterThanOrEqual(90)
  })

  it('every preset that declares a keyframes name references a block that exists', () => {
    // Presets with no `keyframes` field (interaction.ts's hover family) never claim one — see
    // `inlineAnimationRefs` above for how they actually animate. Nothing to check for those.
    const missing = ALL_PRESETS.filter(
      (preset) => preset.keyframes && !keyframes.has(preset.keyframes),
    ).map((preset) => `${preset.name} -> ${preset.keyframes}`)
    expect(missing).toEqual([])
  })

  it('every keyframe block is referenced by a preset or an inline animation', () => {
    const referenced = new Set(ALL_PRESETS.map((preset) => preset.keyframes))
    const orphans = [...keyframes.keys()].filter(
      (name) => !referenced.has(name) && !inlineAnimationRefs.has(name),
    )
    expect(orphans).toEqual([])
  })

  it('no keyframe writes a property outside its primitive declared channels', () => {
    const violations: string[] = []

    for (const preset of ALL_PRESETS) {
      const resolved = registry.resolve(preset.name)
      const properties = keyframes.get(preset.keyframes ?? '')
      if (!resolved || !properties) continue

      const allowed = allowedProperties(resolved.primitive.channels)
      for (const property of properties) {
        if (allowed.has(property)) continue
        violations.push(
          `${preset.keyframes} (via ${preset.name}/${resolved.primitive.id}) writes "${property}", ` +
            `not covered by channels [${resolved.primitive.channels.join(', ')}]`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})

describe('CSS static rules', () => {
  /**
   * The keyframe check above would not have caught the `gradient-mesh, spinner-dots` bug:
   * `feedback-dot-pulse`'s keyframe only ever animated `scale`/`opacity`, which already matched
   * its declared channels — the `background`/`box-shadow` it also writes live in the always-on
   * `[data-kui-fx~='spinner-dots']` rule, entirely outside any `@keyframes` block. This asserts
   * the same "declared channels cover what's actually painted" invariant against that other
   * source of unconditional style.
   */
  it("no unconditional [data-kui-fx~=X] rule writes a channel-tracked property outside its primitive's declared channels", () => {
    const violations: string[] = []

    for (const preset of ALL_PRESETS) {
      const properties = baseRules.get(preset.name)
      if (!properties) continue
      const resolved = registry.resolve(preset.name)
      if (!resolved) continue

      const allowed = allowedProperties(resolved.primitive.channels)
      for (const property of properties) {
        if (!TRACKED_PROPERTIES.has(property) || allowed.has(property)) continue
        violations.push(
          `${preset.name}/${resolved.primitive.id} writes "${property}" in its unconditional rule, ` +
            `not covered by channels [${resolved.primitive.channels.join(', ')}]`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})

/**
 * Rules inside base.css's `prefers-reduced-motion` block, as selector list plus declaration body.
 *
 * Comments are stripped first — prose mentioning a property name would otherwise be indexed as a
 * declaration, and the state-reset containment assertion below would pass or fail on a comment.
 *
 * @complexity O(n) time and space in the length of the block.
 * @overallScore 100
 */
function reducedMotionRules(css: string): { selector: string; body: string }[] {
  const source = css
    .split('/*')
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('*/') + 2)))
    .join('')
  const at = source.indexOf('@media (prefers-reduced-motion: reduce)')
  const block = readBalancedBlock(source, source.indexOf('{', at) + 1)
  return block
    .split('}')
    .filter((chunk) => chunk.includes('{'))
    .map((chunk) => {
      const [selector, body] = chunk.split('{')
      return { selector: selector!.trim(), body: body! }
    })
}

const rmRules = reducedMotionRules(SOURCES.get('base.css')!)

describe('reduced-motion policy', () => {
  /**
   * `lift` and the native-form-state family move via `transition`, never `animation`. An
   * `animation-*`-only policy left them at full speed while their primitive declared
   * `shorten`/`disable`, so the policy has to be value-agnostic here, not per-policy.
   */
  it('shortens transitions for every policy, not just animations', () => {
    const rule = rmRules.find((entry) => entry.body.includes('transition-duration'))
    expect(rule).toBeDefined()
    expect(rule!.selector).toMatch(/\[data-kui-rm\](?!=)/)
  })

  it('reaches the pseudo-elements and siblings that carry the motion', () => {
    const rule = rmRules.find((entry) => entry.body.includes('transition-duration'))!
    expect(rule.selector).toContain('::after')
    expect(rule.selector).toContain('~')
  })

  /**
   * `opacity: 1`/`scale: none` encode "an entrance's final state is visible and untransformed",
   * which is only true of the marked element. On a pseudo-element or sibling the resting state is
   * state-driven, so propagating them would paint a permanent `cursor-spotlight` glow and fill
   * every unselected `radio-fill` dot.
   */
  it('confines the disable state resets to the marked element', () => {
    const leaked = rmRules.filter(
      (entry) =>
        /\bopacity|\btranslate|\bscale|\brotate|\bfilter/.test(entry.body) &&
        /::|[~>+]/.test(entry.selector),
    )
    expect(leaked).toEqual([])
  })

  /**
   * The form contract animates a sibling of the control that carries `data-kui-rm`, so the policy
   * enumerates the sibling shapes it reaches. A new shape here would be silently uncovered.
   */
  it('every sibling the form contract animates is a shape the policy enumerates', () => {
    // ` ~ ` only — an unspaced `~` is the `[data-kui-fx~=]` attribute operator, not a combinator.
    const targets = [...SOURCES.get('forms.css')!.matchAll(/~ +([^\s,{]+)/g)].map((m) => m[1]!)
    const unreachable = targets.filter(
      (target) => target !== 'label' && target !== 'svg' && !target.startsWith('.kui-'),
    )
    expect(targets.length).toBeGreaterThan(0)
    expect(unreachable).toEqual([])
  })
})

describe('CSS layering', () => {
  it('declares the cascade layers so consumer CSS wins without !important', () => {
    expect(SOURCES.get('base.css')).toContain(
      '@layer kui.tokens, kui.presets, kui.effects, kui.policy;',
    )
  })

  it.each(EFFECT_FILES)('keeps every rule in %s inside the effects layer', (file) => {
    expect(SOURCES.get(file)).toContain('@layer kui.effects {')
  })
})

describe('media-scrub frame stacking', () => {
  /*
   * `data-kui-fx` carries the *effect* name the author wrote, never the primitive it resolves to.
   * The first version of the frame-stack rules keyed on `[data-kui-fx~='media-scrub']`, which is a
   * primitive id and therefore matches nothing — the frames rendered unstacked and unhidden, and
   * the demo showed a wrongly-sized still. Nothing in the suite caught it; a browser did.
   *
   * Easy mistake to repeat, because the one existing precedent (`forms.css`, keyed on
   * `step-progress`) happens to have a preset and a primitive of the same name, so it reads as if
   * primitive ids are what belong in these selectors.
   */
  // Comments stripped before scanning: the note above these rules in `scroll.css` quotes the
  // wrong selector in order to warn about it, and a raw substring search cannot tell the warning
  // from the mistake.
  const scrollCss = (SOURCES.get('scroll.css') ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
  const scrubEffects = SCROLL_PRESETS.filter((preset) => preset.primitive === 'media-scrub').map(
    (preset) => preset.name,
  )

  it('has at least one preset to guard, so this suite cannot pass vacuously', () => {
    expect(scrubEffects.length).toBeGreaterThan(0)
  })

  it.each(scrubEffects)('stacks frames for the %s effect name', (name) => {
    expect(scrollCss).toContain(`[data-kui-fx~='${name}'] > [data-kui-step-state]`)
  })

  it('never keys those rules on the primitive id, which cannot match', () => {
    expect(scrollCss).not.toContain(`[data-kui-fx~='media-scrub']`)
  })
})
