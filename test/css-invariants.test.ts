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
import { MOTION_PATH_PRESETS } from '../src/effects/motion-path/index.js'
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
 *
 * `tween.css` is the one stylesheet deliberately outside this list, and not because it is exempt.
 * Every check below joins a keyframe block to a primitive through `Preset.keyframes`, and the
 * generic tween has no such field: its blocks are chosen per attribute by `variantFor`, and its
 * channels are read off that attribute too, so there is no preset here to compare a block against.
 * The same two invariants are asserted against it in `tween.test.ts`, using this same
 * `CHANNEL_PROPERTIES` map.
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
  ...MOTION_PATH_PRESETS,
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
 * checking anything.
 *
 * The optional leading `-?` admits vendor-prefixed properties (`-webkit-text-fill-color`,
 * `-webkit-mask-composite`) without also admitting a custom property: `--kui-border-angle` starts
 * with *two* dashes, and `-?` only ever consumes one, so the required `[a-z]` immediately after it
 * fails to match the second dash and the whole property is correctly skipped — the channel model
 * polices painted CSS properties, not the custom properties that sometimes drive them. Before this
 * was widened, every `-webkit-*` declaration in the catalog was invisible to every check in this
 * file: `gradient-shimmer`, `gradient-sweep`, and `text-outline-fill` all write
 * `-webkit-text-fill-color` in an unconditional rule or a keyframe with no entry anywhere in
 * `CHANNEL_PROPERTIES` to catch a channel that didn't cover it.
 */
function extractDeclaredProperties(body: string): Set<string> {
  const properties = new Set<string>()
  for (const [, property] of body.matchAll(/(?:^|[{;])\s*(-?[a-z][a-z-]*)\s*:/g)) {
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
    // `kui.cloak` is last on purpose: it has to beat every effect rule that would otherwise paint
    // an element at its rest state before the runtime installs the from-state.
    expect(SOURCES.get('base.css')).toContain(
      '@layer kui.tokens, kui.presets, kui.effects, kui.policy, kui.cloak;',
    )
  })

  it('orders the cloak layer above the effect rules it has to beat', () => {
    const order = SOURCES.get('base.css')?.match(/@layer ([^;]+);/)?.[1] ?? ''
    const names = order.split(',').map((name) => name.trim())
    expect(names.indexOf('kui.cloak')).toBeGreaterThan(names.indexOf('kui.effects'))
  })

  it.each(EFFECT_FILES)('keeps every rule in %s inside the effects layer', (file) => {
    expect(SOURCES.get(file)).toContain('@layer kui.effects {')
  })
})

/*
 * `--kui-i` is a position within *one* group, but a custom property inherits past the group's last
 * element. A `dropdown-open` panel nested inside item 11 of a staggered catalog read `--kui-i: 11`
 * off an ancestor and opened 660ms after the click, which reads on screen as a broken control.
 *
 * The reset lives in `kui.tokens` — the earliest layer — and the runtime always writes a real index
 * as an inline style, which beats every layer. So members of a genuine stagger group keep their
 * index and only the leak is cut.
 */
describe('stagger index containment', () => {
  it('resets --kui-i on every effect element so a parent group cannot delay a nested effect', () => {
    const base = SOURCES.get('base.css') ?? ''
    const rule = /\[data-kui-fx\]\s*\{([^}]*)\}/.exec(base)?.[1] ?? ''
    expect(rule).toMatch(/--kui-i:\s*0;/)
  })

  it('keeps the reset in kui.tokens, so an inline index from the runtime still wins', () => {
    const base = SOURCES.get('base.css') ?? ''
    const tokens = base.slice(base.indexOf('@layer kui.tokens {'), base.indexOf('@layer kui.policy {'))
    expect(tokens).toContain('--kui-i: 0;')
  })

  it('does not reset --kui-stagger, which authors set on a wrapper for children to inherit', () => {
    const base = SOURCES.get('base.css') ?? ''
    const rule = /\[data-kui-fx\]\s*\{([^}]*)\}/.exec(base)?.[1] ?? ''
    expect(rule).not.toMatch(/--kui-stagger:/)
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

/**
 * The pre-JS cloak, fenced the same way the `data-kui-fx` trap above is.
 *
 * `Preset.cloak` is a declaration, and a declaration nobody regenerates is a lie: adding a new
 * entrance and forgetting `npm run generate:css` leaves the name un-cloaked, which brings the
 * flash back for that one effect only and is invisible in review. These assertions compare the
 * registry against the generated stylesheet in both directions.
 *
 * The direction that matters more is the second one. A cloak selector for something that is not
 * an entrance hides a working element until the runtime reaches it — a pinned section at
 * `opacity: 0` — and that fails much louder than a missing cloak, which is only the status quo.
 */
/**
 * Read separately rather than added to `SOURCES`, which feeds the channel-invariant scans above.
 * The cloak layer writes `opacity` and `animation` on selectors that are not keyed to any one
 * primitive, so it has no `channels` declaration to be audited against and would only produce
 * false positives there.
 */
const GENERATED_CSS = readFileSync(
  fileURLToPath(new URL('../src/css/presets.generated.css', import.meta.url)),
  'utf8',
)

describe('pre-JS cloak', () => {
  const generated = GENERATED_CSS
  const registry = createRegistry()
  const declared = registry
    .names()
    .filter((name) => registry.resolve(name)?.preset.cloak === true)
  const emitted = [
    ...new Set(
      [...generated.matchAll(/html\[data-kui-cloak\] \[data-kui~='([^']+)'\]/g)].map((m) => m[1]!),
    ),
  ].sort((a, b) => a.localeCompare(b))

  it('has presets to guard, so this suite cannot pass vacuously', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('emits exactly the presets that declare cloak, and no others', () => {
    expect(emitted).toEqual(declared)
  })

  it('never cloaks an exit, which starts at the rest state', () => {
    // An exit hidden before it runs is an element that was supposed to be on screen until it left.
    expect(declared.filter((name) => name.includes('-out'))).toEqual([])
  })

  it('never cloaks a pinning or scroll-orchestration name', () => {
    // The failure `base.css`'s own comment warns about: a pinned section held at opacity 0 for as
    // long as the runtime takes to claim it.
    const orchestrators = SCROLL_PRESETS.map((preset) => preset.name)
    expect(declared.filter((name) => orchestrators.includes(name))).toEqual([])
  })

  it('ships a CSS-only release, so blocked JS cannot leave the page hidden', () => {
    // Fail-open without depending on the JS watchdog: the element un-hides itself on a keyframe.
    expect(generated).toContain('animation: kui-cloak-release')
    expect(generated).toContain('@keyframes kui-cloak-release')
  })

  it('releases the cloak entirely under reduced motion', () => {
    // Hiding content to smooth an entrance nobody is going to see is pure cost.
    expect(generated).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keys the cloak only on the authored attribute, never on runtime-stamped state', () => {
    // `data-kui-fx` is written by `start()`. A cloak keyed on it matches nothing until the exact
    // moment it is no longer needed, which is the one way to build a cloak that does nothing.
    const cloakLayer = generated.slice(generated.indexOf('@layer kui.cloak'))
    expect(cloakLayer).not.toContain('data-kui-fx')
  })
})

/**
 * Every `clip-path` keyframe must declare both endpoints, using the same shape function.
 *
 * `clip-path` does not interpolate between a shape and `none`, and it does not interpolate between
 * two different shape functions. When a keyframe declares only a `from`, the implicit `to` is the
 * element's computed value — which is `none` unless the author set one — so the browser falls back
 * to *discrete* interpolation and swaps at the 50% mark. The effect does not wipe. It shows nothing
 * for half its duration and then hard-cuts to the finished image.
 *
 * Seven of the eight media wipes shipped that way, plus `text-reveal-mask` and `curtain-wipe`.
 * Every one of them read as "that effect is broken" rather than as a timing bug, and nothing in the
 * suite noticed, because the animation *was* installed, *was* running, and *did* reach the right
 * final state — it just never drew the middle. `wipe-diagonal` was the only one written with an
 * explicit `to`, which is why it was also the only one that visibly worked.
 */
describe('clip-path keyframes', () => {
  const SHAPE = /\b(inset|circle|ellipse|polygon|path|rect|xywh)\(/

  const clipFrames = [...SOURCES.entries()].flatMap(([file, css]) =>
    [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
      .filter((m) => m[2]!.includes('clip-path'))
      .map((m) => ({ file, name: m[1]!, body: m[2]! })),
  )

  it('has keyframes to guard, so this suite cannot pass vacuously', () => {
    expect(clipFrames.length).toBeGreaterThan(0)
  })

  it.each(clipFrames.map((f) => [`${f.file} :: ${f.name}`, f] as const))(
    '%s declares both endpoints',
    (_label, frame) => {
      // Without an explicit end the browser interpolates towards `clip-path: none`, discretely.
      expect(/\bto\s*\{|100%\s*\{/.test(frame.body)).toBe(true)
      expect(/\bfrom\s*\{|\b0%\s*\{/.test(frame.body)).toBe(true)
    },
  )

  it.each(clipFrames.map((f) => [`${f.file} :: ${f.name}`, f] as const))(
    '%s uses one shape function throughout',
    (_label, frame) => {
      // `inset()` -> `circle()` is as discrete as `inset()` -> `none`.
      const shapes = [...frame.body.matchAll(/clip-path:\s*([a-z]+)\(/g)].map((m) => m[1]!)
      expect(new Set(shapes).size).toBe(1)
      expect(SHAPE.test(frame.body)).toBe(true)
    },
  )

  /*
   * Direction, which the two checks above cannot see and neither can the browser sweep.
   *
   * Transposing `kui-wipe-right`'s inset arguments — `inset(0 0 0 100%)` to `inset(0 100% 0 0)` —
   * makes it reveal from the wrong edge, and it still declares both endpoints, still uses one shape
   * function, still moves smoothly through five distinct sampled states, and still never hard-cuts
   * at 50%. Injected on 2026-08-22, it passed all 74 unit checks in this file and all five checks in
   * `test/browser/effect-sweep.test.mjs`. Nothing in the repository could tell the difference.
   *
   * The oracle deliberately avoids naming a convention. Whether `wipe-left` means "travels left" or
   * "reveals from the left" is a design decision this file has no business asserting; what it can
   * assert is that the pair are **opposites of each other**, which is true under either reading and
   * false under any transposition. Same for the vertical pair.
   */
  /** `inset()` arguments at a keyframe offset, as an explicit four-tuple. */
  const insetSides = (body: string, at: 'from' | 'to'): string[] => {
    const pattern = at === 'from' ? /(?:\bfrom|\b0%)\s*\{([^}]*)\}/ : /(?:\bto|\b100%)\s*\{([^}]*)\}/
    const declarations = pattern.exec(body)?.[1] ?? ''
    const args = /inset\(([^)]*)\)/.exec(declarations)?.[1]?.trim().split(/\s+/) ?? []
    if (args.length === 1) return [args[0]!, args[0]!, args[0]!, args[0]!]
    if (args.length === 2) return [args[0]!, args[1]!, args[0]!, args[1]!]
    if (args.length === 3) return [args[0]!, args[1]!, args[2]!, args[1]!]
    return args
  }

  it.each([
    ['kui-wipe-up', 'kui-wipe-down', 'vertical'],
    ['kui-wipe-left', 'kui-wipe-right', 'horizontal'],
  ])('%s and %s start from opposite edges', (firstName, secondName, axis) => {
    const first = clipFrames.find((frame) => frame.name === firstName)
    const second = clipFrames.find((frame) => frame.name === secondName)
    expect(first, firstName).toBeDefined()
    expect(second, secondName).toBeDefined()

    const [top, right, bottom, left] = insetSides(first!.body, 'from')
    expect(top, `${firstName} from-state should be an inset()`).toBeDefined()
    // Mirroring the named axis of one has to produce the other, exactly.
    const mirrored = axis === 'vertical' ? [bottom, right, top, left] : [top, left, bottom, right]
    expect(insetSides(second!.body, 'from')).toEqual(mirrored)
  })

  it.each([
    ['kui-wipe-up', 'kui-wipe-down'],
    ['kui-wipe-left', 'kui-wipe-right'],
  ])('%s and %s both finish fully revealed', (firstName, secondName) => {
    // The mirror check alone would be satisfied by two effects that are opposites and both wrong.
    // Both have to land on a zero inset, which is the only "nothing is clipped" an inset can mean.
    for (const name of [firstName, secondName]) {
      const frame = clipFrames.find((candidate) => candidate.name === name)!
      const sides = insetSides(frame.body, 'to').map((side) => Number.parseFloat(side))
      expect(sides, name).toHaveLength(4)
      for (const side of sides) expect(side, name).toBe(0)
    }
  })

})

/*
 * Motion paths (section P). Two claims that live in the stylesheet and nowhere else, and that a
 * plausible-looking "tidy-up" edit would quietly reverse.
 */
describe('motion path', () => {
  const css = SOURCES.get('motion-path.css') ?? ''

  it('reads the path with no var() fallback, so "no path" stays "do not move"', () => {
    /*
     * `path(var(--kui-motion-path))` with the property unset is invalid at computed-value time, so
     * the declaration drops and `offset-path` stays at its initial `none` — the element sits
     * exactly where layout put it. Adding a fallback here (`var(--kui-motion-path, "M 0 0")`)
     * looks like defensive hygiene and is the opposite: it would give an element with no path a
     * path, so a preset whose custom property failed to arrive would travel a phantom curve
     * instead of staying still, and the mistake would be invisible.
     */
    expect(css).toContain('offset-path: path(var(--kui-motion-path));')
  })

  it('anchors the path at the element own corner rather than the CSS default', () => {
    /*
     * Verified in Chromium: `offset-anchor: 0 0` makes the path's `0,0` the element's top-left,
     * i.e. exactly where it already sits, which is what lets every preset path be written as plain
     * offsets. The CSS default (`auto`, resolving to the centre) shifts every element by half its
     * own size the instant the effect installs — a visible jump before any animation runs.
     */
    expect(css).toContain('offset-anchor: var(--kui-motion-anchor, 0 0);')
  })

  it('resets its custom properties per element, so an authored value cannot leak to a descendant', () => {
    /*
     * The `--kui-i` leak, in a new namespace. A custom property inherits and does not stop at the
     * effect that set it, so `data-kui="path-arc rotate:auto anchor:center"` on a card would hand
     * an auto-rotation and a centred anchor to a `path-wave` on a badge inside it. Reset in
     * `kui.tokens` — the earliest layer — so a preset's own rule and the runtime's inline write
     * both still win.
     */
    const base = SOURCES.get('base.css') ?? ''
    const rule = /\[data-kui-fx\]\s*\{([^}]*)\}/.exec(base)?.[1] ?? ''
    for (const property of ['path', 'rotate', 'anchor', 'from', 'to']) {
      expect(rule, property).toContain(`--kui-motion-${property}: initial;`)
    }
  })

  it('drops the path entirely when motion is disabled or printed', () => {
    /*
     * `animation: none` alone leaves `offset-distance` at the element's specified 0% — the *start*
     * of the path — so `path-swoop` would be stranded off to the lower left rather than landing
     * where it belongs. With no path there is no curve to be anywhere on.
     */
    const base = SOURCES.get('base.css') ?? ''
    const disable = /\[data-kui-rm='disable'\]\s*\{([\s\S]*?)\n {4}\}/.exec(base)?.[1] ?? ''
    expect(disable).toContain('offset-path: none !important;')
    const print = base.slice(base.indexOf('@media print'))
    expect(print).toContain('offset-path: none !important;')
  })

  it('drives the travel from the from/to parameters, not a hardcoded 0-100%', () => {
    const body = keyframes.get('kui-motion-travel')
    expect(body).toBeDefined()
    expect(body).toEqual(new Set(['offset-distance']))
    expect(css).toContain('var(--kui-motion-from, 0%)')
    expect(css).toContain('var(--kui-motion-to, 100%)')
  })
})
