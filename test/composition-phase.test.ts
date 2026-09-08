// @vitest-environment node
//
// The third axis of composition safety: *when* two effects hold a channel they both claim.
//
// `channels.ts` used to answer "do these two write `translate`?" and for `fade-up, lift` the answer
// was yes, so the compiler dropped `lift` and told the author their hover had been removed. That is
// the wrong question. An entrance and a hover state are not fighting over the property, they are
// taking turns with it, and the browser composes the pair correctly on its own — but only because
// `kui-in-up` names no closing keyframe, so CSS resolves its endpoint against the underlying value
// and the filling entrance hands `translate` straight back to the `:hover` rule beneath it.
//
// That last clause is the whole reason `Preset.phase` is declared rather than derived from `cloak`,
// and the reason the final suite here reads the shipped stylesheets: an entrance that *does* close
// its block pins the property for good, and composing a hover with one would be a silent clobber in
// place of a loud drop.
//
// The node environment is not optional: `./support/css-sources.js` resolves the stylesheets from
// `import.meta.url` at module scope, and under jsdom that is an `http:` URL `fileURLToPath` throws
// on. `compile`/`parse` are pure and need no DOM, so nothing here loses by it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import type { EffectPhase, Preset } from '../src/core/types.js'
import { readBalancedBlock } from './support/css-scan.js'
import { scannedCss } from './support/css-sources.js'
import { catalogRegistry, extendableRegistry } from './support/registry.js'

const registry = catalogRegistry()

/**
 * Every phase this change specifies for the shipped catalog.
 *
 * The list is the specification, not a fixture: `expectations` below asserts the catalog actually
 * declares each of these, so a row deleted from `src/effects/` fails here instead of quietly
 * reverting a pair to the drop-and-warn path. Only {@link OUTSTANDING} is applied by hand, and only
 * because those four files were held by other agents when this landed.
 *
 * `entrance` deliberately excludes the fifteen `cloak: true` presets whose keyframes close with an
 * explicit `to` (`wipe-*`, `blur-up`, `slat-assemble`, `card-flip-*`, `chart-bar-grow`,
 * `curtain-reveal`, `mask-reveal`, `path-swoop`, `progress-bar`) and the four whose block is not in
 * the scanned stylesheets at all (`text-reveal-*`, `tween-from`). The last suite in this file is
 * what holds that line.
 */
const DECLARATIONS: Record<EffectPhase, string[]> = {
  // From-only keyframes: they release every channel they claim the moment they finish.
  entrance: [
    'back-in-down', 'back-in-up', 'blur-in', 'bounce-in', 'bounce-in-down', 'bounce-in-up',
    'fade-blur-in', 'fade-blur-up', 'fade-down', 'fade-in', 'fade-left', 'fade-right', 'fade-up',
    'flip-in-x', 'flip-in-y', 'fold-panel', 'loading-bar', 'pop-in', 'reveal-once', 'roll-in',
    'rotate-in', 'rotate-in-left', 'rotate-in-right', 'slide-block-end', 'slide-block-start',
    'slide-down', 'slide-inline-end', 'slide-inline-start', 'slide-left', 'slide-right', 'slide-up',
    'swing-in', 'zoom-in', 'zoom-in-down', 'zoom-in-up',
  ],
  // To-only keyframes: the mirror image, resting at the authored state until they run.
  exit: [
    'blur-out', 'fade-out', 'fade-out-down', 'fade-out-left', 'fade-out-right', 'fade-out-up',
    'flip-out-x', 'flip-out-y', 'pop-out', 'roll-out', 'rotate-out', 'slide-out-down',
    'slide-out-left', 'slide-out-right', 'slide-out-up', 'zoom-out',
  ],
  // Every preset whose own CSS sets `--kui-fx-<name>-iterations: infinite`.
  idle: [
    'aurora', 'bob', 'dot-grid-drift', 'float', 'floating-shapes', 'glow-pulse', 'gradient-border',
    'gradient-mesh', 'gradient-rotate-border', 'gradient-shimmer', 'gradient-stroke',
    'line-grid-drift', 'marquee', 'orbit', 'progress-indeterminate', 'scanline', 'skeleton-shimmer',
    'spinner', 'spinner-dots', 'spinner-ring', 'spotlight-follow', 'starfield', 'wave-blob',
  ],
  // Hover- and toggle-driven names that ship a `:hover`/`:focus-visible` rule but no `transitions`,
  // so the derivation cannot see them.
  state: [
    'beam-border', 'flip-card', 'group-dim', 'hamburger-to-x', 'icon-bounce', 'icon-spin',
    'icon-wiggle', 'play-to-pause', 'shine-sweep', 'split-flap', 'underline-center',
    'underline-slide',
  ],
}

/**
 * The declarations that are not in `src/effects/` yet, applied here for the length of the file.
 *
 * `catalog/text.ts`, `catalog/feedback.ts` and `catalog/interaction.ts` were being rewritten by
 * other agents when the rest of the migration landed, so these fifteen rows are still to be
 * written. They are applied rather than dropped so the behaviour they unlock is under test now, and
 * `expectations` deliberately skips them — the day they land, deleting a name from here changes
 * nothing except which of the two lists is doing the work.
 */
const OUTSTANDING: Record<string, EffectPhase> = {
  marquee: 'idle',
  'gradient-shimmer': 'idle',
  'progress-indeterminate': 'idle',
  'skeleton-shimmer': 'idle',
  spinner: 'idle',
  'spinner-dots': 'idle',
  'spinner-ring': 'idle',
  'beam-border': 'state',
  'icon-bounce': 'state',
  'icon-spin': 'state',
  'icon-wiggle': 'state',
  'shine-sweep': 'state',
  'split-flap': 'state',
  'underline-center': 'state',
  'underline-slide': 'state',
}

/**
 * Restore the catalog on the way out.
 *
 * `createRegistry()` stores the module-level preset *objects* by reference, so every registry built
 * in this module graph shares them and a write here would outlive the suite that made it. Vitest
 * isolates modules per file, so the blast radius is this file — but "only breaks its own
 * neighbours" is not a reason to leave a mutation lying around.
 */
const pristine = new Map<string, EffectPhase | undefined>()

beforeAll(() => {
  for (const [name, phase] of Object.entries(OUTSTANDING)) {
    const preset = presetNamed(name)
    pristine.set(name, preset.phase)
    preset.phase = phase
  }
})

describe('the catalog declares the phases this change specified', () => {
  for (const [phase, names] of Object.entries(DECLARATIONS) as [EffectPhase, string[]][]) {
    const shipped = names.filter((name) => !(name in OUTSTANDING))
    it(`declares phase: '${phase}' on all ${shipped.length} of them`, () => {
      const wrong = shipped.filter((name) => presetNamed(name).phase !== phase)
      expect(wrong).toEqual([])
    })
  }

  it('leaves every excluded name unphased', () => {
    // The nineteen `cloak: true` presets that close their keyframe block, or whose block is not in
    // the scanned stylesheets at all. Declaring any of them `entrance` is the silent-clobber bug
    // this whole axis was shaped to avoid, so it is asserted by name rather than left to the
    // stylesheet scan below — that scan can only see the ones with a block to read.
    const excluded = [
      'blur-up', 'card-flip-x', 'card-flip-y', 'chart-bar-grow', 'curtain-reveal', 'mask-reveal',
      'path-swoop', 'progress-bar', 'slat-assemble', 'wipe-circle', 'wipe-diagonal', 'wipe-down',
      'wipe-left', 'wipe-right', 'wipe-up', 'text-reveal-down', 'text-reveal-mask', 'text-reveal-up',
      'tween-from',
    ]
    const declared = excluded.filter((name) => presetNamed(name).phase !== undefined)
    expect(declared).toEqual([])
  })
})

afterAll(() => {
  for (const [name, phase] of pristine) presetNamed(name).phase = phase
})

function presetNamed(name: string): Preset {
  const resolved = registry.resolve(name)
  // Loud rather than skipped: a name that has been renamed or retired out of the catalog would
  // otherwise turn its whole row here into a silent no-assertion.
  if (!resolved) throw new Error(`composition-phase.test.ts: "${name}" is not in the catalog`)
  return resolved.preset
}

/** What an author would end up with for one attribute: the effects that survived, and the CSS. */
function plan(attribute: string, from: Registry = registry) {
  const compiled = compile(parse(attribute), from, 'time')
  return {
    fx: compiled.fxNames,
    composition: compiled.declarations['animation-composition'],
    refused: compiled.warnings.filter((message) => message.includes('cannot compose')),
  }
}

/**
 * Pairs that share a channel and now survive it, with the reason each one is safe.
 *
 * Both orders for every pair, because authoring order decided which effect the old code kept and a
 * table frozen around one spelling would miss a rule that only works left to right.
 */
const COMPOSES: { attribute: string; channel: string; why: string }[] = [
  {
    attribute: 'fade-up, lift',
    channel: 'translate',
    why: 'an entrance beside a hover state — the reported bug',
  },
  {
    attribute: 'fade-up, lift-shadow',
    channel: 'translate',
    why: 'the same pair through the shadow half of the hover family',
  },
  {
    attribute: 'fade-up, pop-open',
    channel: 'opacity',
    why: 'the rule is about when a channel is held, not about which channel it is',
  },
  {
    attribute: 'fade-out, lift',
    channel: 'translate',
    why: 'an exit is the mirror image and layers the same way',
  },
  {
    attribute: 'fade-up, icon-bounce',
    channel: 'translate',
    why: 'a declared state, not one derived from `transitions`',
  },
  {
    attribute: 'fade-up distance:40px 800ms expo-out, lift-shadow 600ms',
    channel: 'translate',
    why: 'the knobs a real page carries do not change the phase of either half',
  },
]

describe('an entrance and a state take turns with a shared channel', () => {
  for (const { attribute, channel, why } of COMPOSES) {
    for (const spelling of [attribute, attribute.split(', ').reverse().join(', ')]) {
      it(`composes "${spelling}" on ${channel} — ${why}`, () => {
        const { fx, refused } = plan(spelling)
        expect(refused, spelling).toEqual([])
        expect(fx, spelling).toHaveLength(2)
      })
    }
  }
})

/**
 * Pairs that still refuse, and the distinct reason each one refuses.
 *
 * This half matters more than the half above. Composition was never uniformly broken — `fade-up,
 * shine-sweep` has always composed — so a change that opened it up is only correct if it opened
 * exactly the cases it meant to. Each row is a different way for the phase rule *not* to apply, and
 * losing any one of them turns a loud drop into a silent clobber.
 */
const REFUSES: { attribute: string; why: string }[] = [
  { attribute: 'fade-up, fade-in', why: 'two entrances genuinely fight — same phase' },
  {
    attribute: 'fade-up, fade-out-up',
    why: 'an entrance and an exit are two filling tracks, both live on the element at once',
  },
  {
    attribute: 'fade-up, float',
    why: 'an ambient loop never yields the channel back, so there is no turn to take',
  },
  {
    attribute: 'blur-up, lift',
    why: 'blur-up closes its keyframe block, so it is not declared an entrance and stays unphased',
  },
  {
    attribute: 'fade-up repeat:infinite, lift',
    why: 'an authored repeat:infinite promotes the entrance to idle at compile time',
  },
  {
    attribute: 'lift, icon-bounce',
    why: 'two states are two normal declarations for one property, resolved by source order',
  },
  {
    attribute: 'parallax-y, parallax-y',
    why: 'a name against itself is a typo, and the additive rescue must not make it quieter',
  },
  {
    attribute: 'tween y:120px, fade-in',
    why: 'a tween compiles one keyframe block per property and records nowhere which is which',
  },
]

describe('a clash the phase rule does not cover is still refused, loudly', () => {
  for (const { attribute, why } of REFUSES) {
    it(`refuses "${attribute}" — ${why}`, () => {
      const { fx, refused } = plan(attribute)
      expect(refused, attribute).toHaveLength(1)
      expect(refused[0], attribute).toContain('Dropped')
      expect(fx, attribute).toHaveLength(1)
    })
  }
})

describe('the additive rescue', () => {
  it('sums two translate-only tracks rather than dropping the second', () => {
    const { fx, composition, refused } = plan('parallax-y, depth-layer')
    expect(refused).toEqual([])
    expect(fx).toEqual(['parallax-y', 'depth-layer'])
    expect(composition).toBe('add, add')
  })

  it('writes no animation-composition at all for an ordinary plan', () => {
    // `replace` is the CSS initial value, so a list of them is a no-op declaration written onto
    // every animated element on every page for the sake of the rare one that needs it — the same
    // reasoning `declarations.ts` already applies to an all-`normal` `animation-direction`.
    expect(plan('fade-up').composition).toBeUndefined()
    expect(plan('fade-up, shine-sweep').composition).toBeUndefined()
    expect(plan('fade-up, lift').composition).toBeUndefined()
  })

  it('refuses a channel that is not on the additive allowlist', () => {
    // `parallax-scale`/`parallax-rotate` are the shape-matched controls for the pair above: same
    // family, same single-channel css-keyframes rendering, same unphased status. Only the channel
    // differs, and `scale`/`rotate` are off the allowlist because nobody has measured what adding
    // two of them looks like in a browser.
    expect(plan('parallax-scale, parallax-scale').refused).toHaveLength(1)
    expect(plan('parallax-rotate, parallax-rotate').refused).toHaveLength(1)
  })
})

describe('a declared phase outranks a derived one', () => {
  /**
   * A private catalog carrying two extra names that declare a phase outright.
   *
   * Registered rather than written onto an existing preset, for the reason `pristine` above exists:
   * the preset objects are shared by every registry in this module graph.
   */
  function declaring(): Registry {
    const local = extendableRegistry()
    // A loop that says so. `ambient-float` is `float`'s own primitive — translate-only and
    // css-keyframes — so the declaration is the only thing separating this name from `float`.
    local.registerPreset({
      name: 'probe-loop',
      primitive: 'ambient-float',
      keyframes: 'kui-float',
      phase: 'idle',
    })
    // And a state that says so, on `parallax-y`'s primitive and carrying none of the `transitions`
    // the derivation would otherwise read — so a pass below is the declaration being honoured
    // rather than the fallback quietly answering the same way.
    //
    // A css-keyframes primitive and not `lift`'s JavaScript one, because the `repeat:` case needs a
    // renderer that can honour a repeat at all: `compile.ts`'s `refusePlayback` strips
    // `repeat:infinite` off a JS-rendered segment before `phaseOf` ever sees it, so a JS probe
    // would pass that assertion for the wrong reason.
    local.registerPreset({
      name: 'probe-state',
      primitive: 'parallax',
      keyframes: 'kui-parallax-y',
      phase: 'state',
    })
    return local
  }

  it('composes a declared state with an entrance', () => {
    expect(plan('fade-up, probe-state', declaring()).refused).toEqual([])
  })

  it('refuses a declared idle loop against an entrance on the same channel', () => {
    expect(plan('fade-up, probe-loop', declaring()).refused).toHaveLength(1)
  })

  it('lets an authored repeat:infinite override the declaration', () => {
    // The declaration describes the *name*; `repeat:` describes *this segment*. An author who
    // turned a state into a permanent loop has changed what will actually run, so the promotion to
    // `idle` has to win over the preset's own word.
    expect(plan('fade-up, probe-state repeat:infinite', declaring()).refused).toHaveLength(1)
  })
})

/**
 * The structural fact underneath the whole `entrance | state` exemption.
 *
 * An entrance may hand its channel back only because its keyframes never say what to end on:
 * `kui-in-up` declares a `from` block and no `to`, and CSS resolves a missing endpoint keyframe
 * against the *underlying* value, re-evaluated every frame. So a filling entrance holds whatever the
 * `:hover` rule beneath it says, which is what makes `fade-up, lift` correct rather than merely
 * un-refused.
 *
 * An entrance that closes its block does the opposite: `animation-fill-mode: both` pins the property
 * at the authored endpoint and the composed hover silently does nothing. Fifteen of the catalog's
 * `cloak: true` presets are in exactly that shape, which is why `cloak` is not a phase signal — see
 * `compile.ts`'s `phaseOf`. This is what holds that line for whatever the catalog declares next,
 * instead of the pair being found broken on a page. Same shape as `css-invariants.test.ts`: derive
 * the true set from the shipped stylesheets rather than trusting a list in a comment.
 */
describe('every entrance-phase preset yields its channels back when it finishes', () => {
  /**
   * Keyframe selectors a block opens its steps with, e.g. `from`, `0%`, `100%`, `from, to`.
   *
   * Split rather than matched. The obvious regex for this pairs a lazy `[^{}]+?` with `\s*` on both
   * sides, which is the classic super-linear-backtracking shape `sonarjs/slow-regex` refuses — and
   * refuses correctly, since this runs over every stylesheet the library ships.
   */
  function selectorsIn(body: string): string[] {
    return body
      .split('{')
      .slice(0, -1)
      .flatMap((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1).split(','))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0)
  }

  function keyframeBody(name: string): string | undefined {
    const opening = new RegExp(String.raw`@keyframes\s+${name}\s*\{`).exec(scannedCss)
    if (!opening) return undefined
    return readBalancedBlock(scannedCss, opening.index + opening[0].length)
  }

  const declaredEntrances = () =>
    registry
      .names()
      .map((name) => registry.resolve(name)!.preset)
      .filter((preset) => preset.phase === 'entrance')

  it('finds the entrance set at all, so a broken filter cannot pass vacuously', () => {
    expect(declaredEntrances().length).toBeGreaterThanOrEqual(DECLARATIONS.entrance.length)
  })

  it('finds a keyframe block for every one of them', () => {
    // Not folded into the loop below as a skip: a name whose block is missing from the scanned
    // stylesheets is exactly the case where "no closing keyframe" would pass for the wrong reason.
    const missing = declaredEntrances()
      .map((preset) => preset.keyframes ?? `kui-${preset.name}`)
      .filter((name) => keyframeBody(name) === undefined)
    expect(missing).toEqual([])
  })

  it('compiles all of them without a closing keyframe', () => {
    const closing = declaredEntrances()
      .map((preset) => ({ preset, body: keyframeBody(preset.keyframes ?? `kui-${preset.name}`) }))
      .filter(({ body }) => {
        const selectors = body === undefined ? [] : selectorsIn(body)
        return selectors.includes('to') || selectors.includes('100%')
      })
      .map(({ preset }) => preset.name)
    expect(closing).toEqual([])
  })
})
