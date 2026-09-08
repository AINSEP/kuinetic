// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { FEEDBACK_PRESETS, FEEDBACK_PRIMITIVES, registerFeedback } from '../src/effects/catalog/feedback.js'
import { readBalancedBlock, stripComments } from './support/css-scan.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(fileURLToPath(new URL('../src/css/feedback.css', import.meta.url)), 'utf8')

/**
 * A standalone registry (feedback primitives/presets only) is enough for tests that only ever
 * resolve feedback names. The channel-collision regression below needs `gradient-mesh` too —
 * that's an ambient preset — so it uses the full `catalogRegistry()` instead.
 */
function feedbackRegistry(): Registry {
  return registerFeedback(new Registry())
}

const CONTINUOUS_NAMES = ['skeleton-shimmer', 'spinner', 'spinner-dots', 'spinner-ring', 'progress-indeterminate']

describe('feedback catalog', () => {
  it('registers all 17 section K names', () => {
    const registry = feedbackRegistry()
    expect(FEEDBACK_PRESETS).toHaveLength(17)
    expect(FEEDBACK_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS preset', () => {
    const missing = FEEDBACK_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('disables the continuous loaders under reduced motion instead of shortening them', () => {
    const registry = feedbackRegistry()
    for (const name of CONTINUOUS_NAMES) {
      const resolved = registry.resolve(name)
      expect(resolved?.primitive.reducedMotion).toBe('disable')
      expect(resolved?.primitive.perfClass).toBe('continuous')
    }
  })

  it('leaves one-shot reactions on the default shorten policy', () => {
    const registry = feedbackRegistry()
    const oneShot = FEEDBACK_PRESETS.filter((preset) => !CONTINUOUS_NAMES.includes(preset.name))
    for (const preset of oneShot) {
      expect(registry.resolve(preset.name)?.primitive.reducedMotion).toBe('shorten')
    }
  })

  it('marks every continuous loop as infinite via its own iteration-count var', () => {
    // Not a bare `animation-iteration-count: infinite;` — that would apply to every track sharing
    // an element's `animation-name` list, making a composed one-shot effect loop forever too. See
    // `iterationCountProperty` in src/core/declarations.ts and the header comment in feedback.css.
    const occurrences = css.match(/--kui-fx-[\w-]+-iterations: infinite;/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(5)
  })
})

/**
 * Regression coverage for the under-declared-channel bug: `spinner-dots` and
 * `progress-indeterminate` each write `background` (and `spinner-dots` also `box-shadow`) from
 * their unconditional `[data-kui-fx~=NAME]` rule in feedback.css, entirely outside `@keyframes`.
 * Declaring only their animated channels (scale/opacity or
 * translate/scale) let a composed `background`-writing effect like `gradient-mesh` pass channel
 * collision detection and then have its gradient silently overwritten. `findConflicts` (via
 * `compile`) is the actual mechanism `data-kui="a, b"` runs through, so these go through the full
 * parse → compile pipeline with the real registry rather than asserting on primitive metadata
 * alone — a wiring mistake between the two would otherwise slip past a metadata-only check.
 */
describe('feedback catalog — channel collisions with an ambient background effect', () => {
  const registry = catalogRegistry()

  function run(source: string) {
    return compile(parse(source), registry, 'time')
  }

  it('rejects gradient-mesh, spinner-dots', () => {
    const plan = run('gradient-mesh, spinner-dots')
    expect(plan.warnings.join()).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
  })

  it('rejects gradient-mesh, progress-indeterminate', () => {
    const plan = run('gradient-mesh, progress-indeterminate')
    expect(plan.warnings.join()).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
  })

  it('now composes gradient-mesh, ripple — the ripple stopped painting the host background', () => {
    // This asserted the opposite while `[data-kui-fx~='ripple']` set `background: currentColor` on
    // the authored element. The disc lives on `::after` now, so a mesh on the element and a ripple
    // over it is exactly what asking for both means, and refusing it would be the bug.
    const plan = run('gradient-mesh, ripple')
    expect(plan.warnings.join()).not.toContain('cannot compose')
    expect(plan.fxNames).toEqual(['gradient-mesh', 'ripple'])
  })

  it('still composes effects with genuinely disjoint channels (the fix is not overbroad)', () => {
    // shake-error (translate only) shares nothing with spinner-dots' corrected
    // [scale, opacity, background, shadow] set.
    const plan = run('shake-error, spinner-dots')
    expect(plan.warnings.join()).not.toContain('cannot compose')
    expect(plan.fxNames).toEqual(['shake-error', 'spinner-dots'])
  })
})

describe('feedback catalog — corrected channel declarations', () => {
  function channelsFor(id: string): string[] {
    return FEEDBACK_PRIMITIVES.find((primitive) => primitive.id === id)?.channels ?? []
  }

  it('feedback-dot-pulse (spinner-dots) declares background and shadow alongside scale/opacity', () => {
    expect(channelsFor('feedback-dot-pulse')).toEqual(
      expect.arrayContaining(['scale', 'opacity', 'background', 'shadow']),
    )
  })

  it('feedback-progress-track (progress-indeterminate) declares background alongside translate/scale', () => {
    expect(channelsFor('feedback-progress-track')).toEqual(
      expect.arrayContaining(['translate', 'scale', 'background']),
    )
  })

  /**
   * The two `::after` painters claim that box through the `sweep` channel.
   *
   * `sweep` covers no host property at all — `channel-properties.ts` declares it as an explicitly
   * empty array and calls it "a home to grow into if the pseudo-element audit ever gets extended
   * to check that box directly". It is an ownership token, and these two presets now share it with
   * `shine-sweep` because `::after` is one physical box per element: two presets that both paint it
   * genuinely cannot compose, and this is how the compiler is told rather than the pair landing in
   * `css-composition-invariants.test.ts`'s list of collisions it can only report after the fact.
   */
  it('feedback-ripple claims its ::after box and no longer claims the host background', () => {
    expect(channelsFor('feedback-ripple')).toEqual(expect.arrayContaining(['scale', 'opacity', 'sweep']))
    expect(channelsFor('feedback-ripple')).not.toContain('background')
    // `transform-origin` went with it: the host rule pinned `center` only because the host *was*
    // the disc. A pseudo-element already scales from its own centre.
    expect(channelsFor('feedback-ripple')).not.toContain('transform-origin')
  })

  it('feedback-burst (confetti-burst only, now) claims its ::after box and nothing else', () => {
    expect(channelsFor('feedback-burst')).toEqual(
      expect.arrayContaining(['scale', 'opacity', 'background', 'sweep']),
    )
    // `color` left with `heart-burst` when it got its own primitive — see the split below.
    expect(channelsFor('feedback-burst')).not.toContain('color')
  })

  /**
   * `heart-burst` used to share `feedback-burst` with `confetti-burst` and inherited that
   * primitive's `sweep` claim even though it paints no pseudo-element — see the false-positive
   * regression asserted below. It has its own primitive now, declaring only what its CSS actually
   * touches: `color` on the host (`[data-kui-fx~='heart-burst']` in `feedback.css`) and `scale`
   * (`@keyframes kui-heart-burst`).
   */
  it('feedback-heart-burst declares only scale and color — no sweep, no background, no opacity', () => {
    expect(channelsFor('feedback-heart-burst')).toEqual(expect.arrayContaining(['scale', 'color']))
    for (const absent of ['sweep', 'background', 'opacity']) {
      expect(channelsFor('feedback-heart-burst')).not.toContain(absent)
    }
  })
})

/**
 * The pseudo-element move, asserted where it is actually decided: composition.
 *
 * Two presets painting the same `::after` on one element is the hazard the whole `sweep` channel
 * exists to name, and the only way to see it from a test is to run the pair through `compile` the
 * way `data-kui="a, b"` does. The refusals below are the point of the move; the compositions below
 * are the proof that it did not just forbid everything.
 */
describe('feedback catalog — the ::after box has one owner', () => {
  const registry = catalogRegistry()
  const run = (source: string) => compile(parse(source), registry, 'time')
  const refused = (source: string): boolean => run(source).warnings.join().includes('cannot compose')

  it('refuses to compose either mover with the ::after painter they would clobber', () => {
    expect(refused('shine-sweep, ripple')).toBe(true)
    expect(refused('shine-sweep, confetti-burst')).toBe(true)
    expect(refused('underline-slide, ripple')).toBe(true)
  })

  it('refuses to compose the two movers with each other', () => {
    expect(refused('ripple, confetti-burst')).toBe(true)
  })

  it('still composes each mover with an effect that touches neither the host nor ::after', () => {
    expect(refused('shake-error, ripple')).toBe(false)
    expect(refused('shake-error, confetti-burst')).toBe(false)
  })

  /**
   * `heart-burst` used to share `feedback-burst` with `confetti-burst`, and a channel is declared
   * per primitive rather than per preset, so it inherited the `sweep` claim and wrongly refused to
   * compose with `shine-sweep` even though it paints no pseudo-element at all. It now has its own
   * primitive (`feedback-heart-burst`) that never declares `sweep`, so the pair composes — this is
   * the regression test the false-positive's own comment asked for once that split landed.
   */
  it('now composes shine-sweep, heart-burst — heart-burst never painted a pseudo-element', () => {
    const plan = run('shine-sweep, heart-burst')
    expect(plan.warnings.join()).not.toContain('cannot compose')
    expect(plan.fxNames).toEqual(['shine-sweep', 'heart-burst'])
  })

  it('still refuses shine-sweep with the effects that genuinely paint ::after', () => {
    // The split only had to stop refusing heart-burst. Every effect that actually claims the
    // ::after box — confetti-burst above, plus the two underline presets sharing `scale` with
    // ripple — must still refuse, or the split quietly broke the real safety check along the way.
    expect(refused('shine-sweep, confetti-burst')).toBe(true)
    expect(refused('underline-slide, ripple')).toBe(true)
    expect(refused('underline-center, ripple')).toBe(true)
  })
})

/**
 * The `::after` rule both movers now paint on.
 *
 * Comments stripped first, so a documented alternative spelling in prose cannot be read as a live
 * declaration — and read off the real stylesheet rather than a fixture, for the same reason the
 * collision tests above run through `compile`: the file is the artefact that ships.
 */
function pseudoRuleFor(name: string): string {
  const scanned = stripComments(css)
  const at = scanned.indexOf(`[data-kui-fx~='${name}']::after`)
  if (at === -1) return ''
  return readBalancedBlock(scanned, scanned.indexOf('{', at) + 1)
}

/** The body of a `@keyframes` block, by name. */
function keyframeFor(name: string): string {
  const scanned = stripComments(css)
  const at = scanned.indexOf(`@keyframes ${name}`)
  if (at === -1) return ''
  return readBalancedBlock(scanned, scanned.indexOf('{', at) + 1)
}

/**
 * Split one CSS value on its top-level commas.
 *
 * Not `.split(',')`: every `background-position` entry here is a pair of `calc()` expressions whose
 * own `var()` fallbacks carry commas, and a naive split turns each fallback into a bogus extra
 * layer. Same depth-tracking `splitTopLevel` does in `css-scan.ts` for `transition:` values.
 */
function splitLayers(value: string): string[] {
  const entries: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) {
      entries.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  entries.push(value.slice(start).trim())
  return entries
}

/**
 * confetti-burst: the particles have to actually travel, and they have to travel *somewhere*.
 *
 * The preset spent a long time named for something it did not do — five radial-gradient dots
 * pinned at fixed percentages inside full-bleed background layers, with `scale`/`opacity` the only
 * animated properties, which is `heart-burst` wearing a different name. Nothing here can prove the
 * burst *looks* right, but a static read of the stylesheet can prove the things whose absence made
 * it wrong: five layers, five different directions, every one of them scaled by the same travel
 * variable so that they are all at the centre when it is 0.
 */
describe('confetti-burst — the particles travel', () => {
  const rule = pseudoRuleFor('confetti-burst')
  const layers = splitLayers(/background-position:([^;]+);/.exec(rule)?.[1] ?? '')

  it('has a rule to read, so this suite cannot pass vacuously', () => {
    expect(rule).toContain('background-position')
  })

  it('positions exactly five particles', () => {
    expect(layers).toHaveLength(5)
    expect(splitLayers(/background-image:([^;]+);/.exec(rule)?.[1] ?? '')).toHaveLength(5)
  })

  it('sends each particle somewhere different', () => {
    // Five identical vectors would be one particle drawn five times — the burst would read as a
    // single dot sliding out. Distinctness is the property that makes it a burst.
    expect(new Set(layers).size).toBe(5)
  })

  it('scales every particle by the same travel variable, so 0 stacks them at the centre', () => {
    // Both halves of every pair: an x that travels and a y that does not is a bug that would
    // otherwise look like a burst in a screenshot taken at the right moment.
    for (const layer of layers) {
      const [x, y] = [layer.slice(0, layer.lastIndexOf('calc(')), layer.slice(layer.lastIndexOf('calc('))]
      expect(x).toContain('--kui-confetti-travel')
      expect(y).toContain('--kui-confetti-travel')
      expect(x).toContain('--kui-confetti-distance')
      expect(y).toContain('--kui-confetti-distance')
    }
  })

  it('fans only the horizontal component, so distance survives a fan: change', () => {
    for (const layer of layers) {
      const split = layer.lastIndexOf('calc(')
      expect(layer.slice(0, split)).toContain('--kui-confetti-fan')
      expect(layer.slice(split)).not.toContain('--kui-confetti-fan')
    }
  })

  it('gives every particle the same squared fall term, so the burst settles', () => {
    // `travel * travel` — displacement under gravity is quadratic, so a particle barely drops over
    // the first half of its flight and falls away at the end. A linear term would read as a
    // starburst drifting sideways.
    for (const layer of layers) {
      const y = layer.slice(layer.lastIndexOf('calc('))
      expect(y).toContain('var(--kui-confetti-travel) * var(--kui-confetti-travel)')
    }
  })

  it('drives travel from 0 to 1 across the keyframe', () => {
    const stops = [...keyframeFor('kui-confetti-burst').matchAll(/--kui-confetti-travel:([^;]+);/g)].map((m) =>
      m[1]!.trim(),
    )
    expect(stops.at(0)).toBe('0')
    expect(stops.at(-1)).toBe('1')
  })
})

/**
 * Both movers: the element underneath is left alone.
 *
 * This is the whole point of the move. `ripple` used to turn the host into the expanding disc —
 * round, filled with its own text colour, scaled 4x and faded to nothing — and `confetti-burst`
 * used to paint five gradients onto the host's own `background-image`. Neither writes anything
 * visible on the authored element now.
 *
 * "Undecorated at rest" is a separate claim from "painted on a pseudo-element", and it needs the
 * keyframe: playback is gated with `animation-play-state: paused` against `animation-fill-mode:
 * both`, so an element that has never been clicked paints the 0% keyframe. Whatever 0% says is
 * what every idle element on the page looks like.
 */
describe('feedback movers — the host element is left alone', () => {
  const scanned = stripComments(css)
  const hostRuleFor = (name: string): string => {
    const marker = `[data-kui-fx~='${name}'] {`
    const at = scanned.indexOf(marker)
    return at === -1 ? '' : readBalancedBlock(scanned, at + marker.length)
  }

  it('paints both effects on ::after, not on the element', () => {
    expect(pseudoRuleFor('ripple')).toContain('content')
    expect(pseudoRuleFor('confetti-burst')).toContain('content')
  })

  it('leaves nothing but a containing block on either host rule', () => {
    // `position: relative` is all that is left, and only so the pseudo-element has something to
    // position against. Anything else here would be paint the author did not ask for.
    for (const name of ['ripple', 'confetti-burst']) {
      const host = hostRuleFor(name)
      expect(host, name).toContain('position: relative')
      for (const property of ['background', 'border-radius', 'transform-origin', 'opacity', 'color']) {
        expect(host, `${name} / ${property}`).not.toMatch(new RegExp(`(?:^|[{;])\\s*${property}\\s*:`))
      }
    }
  })

  it('never lets either pseudo-element swallow a click on the button underneath', () => {
    // Both hosts are usually the thing being clicked, and an `inset: 0` (or larger) overlay with
    // default `pointer-events` would eat the second click and every one after it.
    expect(pseudoRuleFor('ripple')).toContain('pointer-events: none')
    expect(pseudoRuleFor('confetti-burst')).toContain('pointer-events: none')
  })

  it('opens and closes both keyframes at nothing-painted', () => {
    const confetti = [...keyframeFor('kui-confetti-burst').matchAll(/--kui-confetti-fade:([^;]+);/g)].map((m) =>
      m[1]!.trim(),
    )
    expect(confetti.at(0)).toBe('0%')
    expect(confetti.at(-1)).toBe('0%')
    expect(confetti).toContain('100%')

    const ripple = [...keyframeFor('kui-ripple').matchAll(/--kui-ripple-alpha:([^;]+);/g)].map((m) => m[1]!.trim())
    expect(ripple.at(0)).toBe('0')
    expect(ripple.at(-1)).toBe('0')
    // The disc has to be visible in between, or "invisible at both ends" is satisfied by an effect
    // that never paints at all.
    expect(ripple.some((value) => value.includes('--kui-ripple-opacity'))).toBe(true)
  })

  it('never fades the host itself', () => {
    // `opacity` on the host would take the element's own content with it — which is exactly what
    // the old confetti keyframe did, leaving every idle element invisible until clicked.
    for (const name of ['kui-confetti-burst', 'kui-ripple']) {
      expect(keyframeFor(name), name).not.toMatch(/(?:^|[{;])\s*opacity\s*:/)
    }
  })

  it('registers every bridged property so it interpolates instead of flipping at the midpoint', () => {
    // The compiler writes `animation-*` on the authored element and cannot target a pseudo-element,
    // so motion crosses over as inherited custom properties. An *unregistered* one is not
    // animatable: without `@property` each would jump discretely halfway through every interval.
    for (const [property, syntax] of [
      ['--kui-confetti-travel', '<number>'],
      ['--kui-confetti-fade', '<percentage>'],
      ['--kui-ripple-progress', '<number>'],
      ['--kui-ripple-alpha', '<number>'],
    ]) {
      const at = scanned.indexOf(`@property ${property}`)
      expect(at, property).toBeGreaterThan(-1)
      const block = readBalancedBlock(scanned, scanned.indexOf('{', at) + 1)
      expect(block, property).toContain(`syntax: '${syntax}'`)
      // `inherits: true` is the load-bearing half: a property that does not inherit never reaches
      // the pseudo-element that reads it, and the effect renders frozen at its initial value.
      expect(block, property).toContain('inherits: true')
    }
  })

  it('clamps the confetti fade before it reaches color-mix', () => {
    // The default easing is `back-out`. An overshoot past 100% substituted as a literal token makes
    // `color-mix()` a parse error rather than a clamp, and the whole `background-image` drops out —
    // every particle blinking off at the exact moment the burst starts.
    const rule = pseudoRuleFor('confetti-burst')
    expect(rule).toContain('--kui-confetti-alpha: clamp(0%, var(--kui-confetti-fade), 100%)')
    expect(rule).not.toContain('var(--kui-confetti-fade), transparent)')
  })

  it('claims ::after and never ::before, where four presets already collide', () => {
    // `::before` would have put both movers against `beam-border`, `beam-border-auto`,
    // `cursor-spotlight` and `redaction-reveal` at once, and no single channel covers all four —
    // see the enumerated set in `css-composition-invariants.test.ts`.
    for (const name of ['ripple', 'confetti-burst']) {
      expect(scanned, name).not.toContain(`[data-kui-fx~='${name}']::before`)
    }
  })
})

/**
 * confetti-burst: every authorable value has its literal as the stylesheet's `var()` fallback.
 *
 * The two halves of a parameter live in different files — the `ParamSpec` default in
 * `catalog/feedback.ts`, the fallback in `feedback.css` — and only the CSS one is consulted when
 * nobody authored the parameter, because non-timing defaults are never emitted into
 * `presets.generated.css` (see `scripts/generate-preset-css.mjs`). A drift between the two is
 * therefore invisible until someone writes the parameter and watches the element change size for
 * no reason they asked for.
 */
describe('feedback movers — parameter defaults match their CSS fallbacks', () => {
  const parametersOf = (id: string): Record<string, unknown> =>
    (FEEDBACK_PRIMITIVES.find((primitive) => primitive.id === id)?.parameters ?? {}) as Record<string, unknown>
  const burst = parametersOf('feedback-burst')

  it('exposes every value the burst can be retuned by', () => {
    expect(Object.keys(burst)).toEqual(
      expect.arrayContaining(['distance', 'fan', 'size', 'spill', 'color1', 'color5']),
    )
  })

  it('exposes every value the ripple disc can be retuned by', () => {
    expect(Object.keys(parametersOf('feedback-ripple'))).toEqual(
      expect.arrayContaining(['color', 'strength', 'startScale', 'extent']),
    )
  })

  it('avoids the reserved "spread" key that would never reach the effect', () => {
    // `parse.ts`'s `applyToken` consults `HOISTS` before `spec.params`, and `spread` is a hoist
    // (the stagger budget). A parameter by that name is unreachable from `data-kui` — which is why
    // the burst's is called `fan`, and the bug `ripple`'s own `spread` had until it became
    // `extent`. `test/reserved-parameter-keys.test.ts` now guards the whole registry against it.
    expect(burst).not.toHaveProperty('spread')
    expect(parametersOf('feedback-ripple')).not.toHaveProperty('spread')
  })

  it('repeats each non-empty default as the fallback in feedback.css', () => {
    const scanned = stripComments(css)
    const specs = [...Object.entries(burst), ...Object.entries(parametersOf('feedback-ripple'))]
    for (const [name, spec] of specs) {
      const property = (spec as { cssProperty?: string }).cssProperty ?? ''
      const value = (spec as { default?: string }).default ?? ''
      // Timing params (`--kui-duration`/`--kui-ease`) are resolved by the compiler and emitted into
      // `presets.generated.css`, so the stylesheet carries no literal for them to drift from.
      // Empty defaults are the "unauthored means absent" convention — the colours — so there the
      // stylesheet's own literal is the only value and there is nothing to compare it against.
      const owned = property.startsWith('--kui-confetti-') || property.startsWith('--kui-ripple-')
      if (!owned || value === '') continue
      expect(scanned, name).toContain(`var(${property}, ${value})`)
    }
  })
})
