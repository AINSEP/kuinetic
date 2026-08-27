import { beforeEach, describe, expect, it } from 'vitest'
import { compile, compileTargets } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { catalogRegistry } from './support/registry.js'

let registry: Registry

beforeEach(() => {
  registry = catalogRegistry()
})

function run(source: string, timeline: 'time' | 'view' | 'scroll' = 'time') {
  return compile(parse(source), registry, timeline)
}

function runTargets(source: string, timeline: 'time' | 'view' | 'scroll' = 'time') {
  return compileTargets(parse(source), registry, timeline)
}

describe('compile — single effect', () => {
  it('stamps the resolved effect name', () => {
    expect(run('fade-up').fxNames).toEqual(['fade-up'])
  })

  it('emits the preset keyframes, not the preset name', () => {
    // slide-up and fade-up share one keyframe block; only their defaults differ.
    expect(run('slide-up').declarations['animation-name']).toBe('kui-in-up')
    expect(run('fade-up').declarations['animation-name']).toBe('kui-in-up')
  })

  it('does NOT inline preset defaults, so consumer CSS can override them', () => {
    // Preset defaults are emitted as cascade rules by scripts/generate-preset-css.mjs. Writing
    // them to element.style made them beat every consumer stylesheet.
    expect(run('slide-up').vars).toEqual({})
  })

  it('lets an author override a preset default', () => {
    expect(run('slide-up distance:40px').vars['--kui-distance']).toBe('40px')
  })

  it('uses a primitive-scoped var() fallback when no duration is given', () => {
    expect(run('fade-up').declarations['animation-duration']).toBe(
      'var(--kui-reveal-duration, 600ms)',
    )
  })

  it('uses the positional duration when given', () => {
    expect(run('fade-up 800ms').declarations['animation-duration']).toBe('800ms')
  })

  it('folds stagger into the delay so the browser does the arithmetic', () => {
    expect(run('fade-up').declarations['animation-delay']).toBe(
      'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
  })

  it('resolves a named curve to its custom property', () => {
    expect(run('fade-up expo-out').declarations['animation-timing-function']).toBe(
      'var(--kui-ease-expo-out, ease-out)',
    )
  })

  it('scopes timing properties per primitive so composed effects cannot bleed', () => {
    // pop-in sets ease:back-out. Sharing one --kui-ease meant blur-in silently inherited it,
    // even though their channels are disjoint and composition was therefore allowed.
    const plan = run('pop-in ease:back-out, blur-in')
    expect(plan.vars['--kui-scale-ease']).toBe('back-out')
    expect(plan.declarations['animation-timing-function']).toBe(
      'var(--kui-scale-ease, ease-out), var(--kui-blur-ease, ease-out)',
    )
  })

  it('passes a native easing keyword through unchanged', () => {
    expect(run('fade-up ease-in-out').declarations['animation-timing-function']).toBe('ease-in-out')
  })

  it('sets fill-mode both so the from-state holds before activation', () => {
    expect(run('fade-up').declarations['animation-fill-mode']).toBe('both')
  })

  it('defaults iteration-count to a per-preset var() falling back to 1 (one-shot)', () => {
    expect(run('fade-up').declarations['animation-iteration-count']).toBe(
      'var(--kui-fx-fade-up-iterations, 1)',
    )
  })
})

describe('compile — parallax-scale/parallax-rotate "from"', () => {
  // `from` lets a scroll-driven scale/rotate sweep in from an authored starting point instead of
  // the hardcoded resting value (scale 1 / rotate 0deg) — same --kui-from-* custom property the
  // entrance primitives already use. Unlike the entrance params, no test resolved these to their
  // custom property, so nothing would have failed if the cssProperty mapping broke.
  it('does not inline parallax-scale defaults, so an unauthored "from" leaves --kui-from-scale unset', () => {
    expect(run('parallax-scale').vars).toEqual({})
  })

  it('resolves parallax-scale "from" and "scale" to their own custom properties', () => {
    const plan = run('parallax-scale from:0.5 scale:1.8')
    expect(plan.vars['--kui-from-scale']).toBe('0.5')
    expect(plan.vars['--kui-to-scale']).toBe('1.8')
  })

  it('resolves parallax-rotate "from" and "angle" to their own custom properties', () => {
    const plan = run('parallax-rotate from:45deg angle:-30deg')
    expect(plan.vars['--kui-from-angle']).toBe('45deg')
    expect(plan.vars['--kui-to-angle']).toBe('-30deg')
  })
})

describe('compile — unknown effects', () => {
  it('reports the name as unknown and stamps nothing', () => {
    const plan = run('flibbertigibbet')
    expect(plan.fxNames).toEqual([])
    expect(plan.unknown).toEqual(['flibbertigibbet'])
  })

  it('suggests a near match', () => {
    expect(run('fade-upp').warnings.join()).toContain('did you mean "fade-up"')
  })

  it('keeps the known effects when only one name is bad', () => {
    const plan = run('fade-up, notreal')
    expect(plan.fxNames).toEqual(['fade-up'])
    expect(plan.unknown).toEqual(['notreal'])
  })
})

describe('compile — composition', () => {
  it('composes effects whose channels are disjoint', () => {
    const plan = run('slide-up, blur-in')
    expect(plan.fxNames).toEqual(['slide-up', 'blur-in'])
    expect(plan.declarations['animation-name']).toBe('kui-in-up, kui-blur-in')
  })

  it('emits parallel value lists so per-effect timing survives composition', () => {
    const plan = run('slide-up 800ms, blur-in 400ms')
    expect(plan.declarations['animation-duration']).toBe('800ms, 400ms')
    expect(plan.declarations['animation-fill-mode']).toBe('both, both')
  })

  it('gives a looping effect its own iteration-count var, not a shared scalar', () => {
    // Regression: a bare `animation-iteration-count: infinite` on gradient-mesh's own CSS rule
    // would apply to every track sharing this element's `animation-name` list (CSS repeats a
    // shorter value list to match the longest one), making the composed one-shot fade-up loop
    // forever too. Each track must resolve independently.
    const plan = run('gradient-mesh, fade-up')
    expect(plan.declarations['animation-iteration-count']).toBe(
      'var(--kui-fx-gradient-mesh-iterations, 1), var(--kui-fx-fade-up-iterations, 1)',
    )
  })

  it('composes three disjoint channels', () => {
    const plan = run('slide-up, blur-in, zoom-in')
    expect(plan.fxNames).toEqual(['slide-up', 'blur-in', 'zoom-in'])
  })

  it('no longer substitutes a combo, so neither effect is silently dropped', () => {
    // `fade-up` claims opacity+translate and `blur-in` claims filter, so these were always
    // composable. Automatic substitution replaced them with `fade-blur-up` using only the FIRST
    // spec — discarding the other's timing and parameters, and producing different output
    // depending on authored order. Both effects now survive with their own timing.
    const plan = run('fade-up, blur-in')
    expect(plan.fxNames).toEqual(['fade-up', 'blur-in'])
  })

  it('preserves each effect\'s timing regardless of authored order', () => {
    const a = run('blur-in 200ms, fade-up 1s')
    const b = run('fade-up 1s, blur-in 200ms')
    expect(a.declarations['animation-duration']).toBe('200ms, 1s')
    expect(b.declarations['animation-duration']).toBe('1s, 200ms')
    expect(a.vars).toEqual(b.vars)
  })

  it('names the purpose-built combo when a real collision has one', () => {
    // fade-blur-up claims all three channels, so composing it with anything overlapping is a
    // genuine conflict — and the warning should point at the tested single-keyframe effect.
    expect(run('fade-up, fade-blur-in').warnings.join()).toContain('cannot compose')
  })

  it('rejects a channel collision, keeps the first effect, and names both sides', () => {
    const plan = run('fade-up, fade-left')
    expect(plan.fxNames).toEqual(['fade-up'])
    expect(plan.warnings.join()).toContain('both animate opacity')
  })

  it('treats the same effect listed twice as a collision', () => {
    expect(run('fade-up, fade-up').warnings.join()).toContain('cannot compose')
  })

  it('catches a background collision confetti-burst previously hid from detection', () => {
    // Regression: feedback-burst (confetti-burst's primitive) used to declare only
    // scale+opacity, even though confetti-burst's own CSS paints `background-image`. That let it
    // pass composition with another background-writing effect and get silently overwritten.
    const plan = run('gradient-mesh, confetti-burst')
    expect(plan.fxNames).toEqual(['gradient-mesh'])
    expect(plan.warnings.join()).toContain('background')
  })

  it('names the registered combo preset in the remedy when a real conflict has one', () => {
    // The real catalog's registered combos (fade-up+blur-in, fade-in+blur-in) no longer conflict
    // with each other — see the "no longer substitutes a combo" test above — so this builds a
    // minimal registry where the conflict and the combo registration are both genuinely present,
    // to exercise the branch that names the combo rather than the generic remedy text.
    const custom = new Registry()
    custom.registerPrimitives([
      {
        id: 'p-a',
        renderer: 'css-keyframes',
        channels: ['opacity'],
        parameters: {},
        supportedTimelines: ['time'],
        supportedActivations: ['load'],
        perfClass: 'compositor',
        reducedMotion: 'shorten',
      },
      {
        id: 'p-b',
        renderer: 'css-keyframes',
        channels: ['opacity'],
        parameters: {},
        supportedTimelines: ['time'],
        supportedActivations: ['load'],
        perfClass: 'compositor',
        reducedMotion: 'shorten',
      },
      {
        id: 'p-combo',
        renderer: 'css-keyframes',
        channels: ['opacity'],
        parameters: {},
        supportedTimelines: ['time'],
        supportedActivations: ['load'],
        perfClass: 'compositor',
        reducedMotion: 'shorten',
      },
    ])
    custom.registerPresets([
      { name: 'combo-a', primitive: 'p-a' },
      { name: 'combo-b', primitive: 'p-b' },
      { name: 'combo-fused', primitive: 'p-combo' },
    ])
    custom.registerCombo(['combo-a', 'combo-b'], 'combo-fused')

    const plan = compile(parse('combo-a, combo-b'), custom, 'time')
    expect(plan.fxNames).toEqual(['combo-a'])
    expect(plan.warnings.join()).toContain('Use the "combo-fused" effect instead.')
  })

  it('derives the default kui-{name} keyframe when a preset declares none', () => {
    const custom = new Registry()
    custom.registerPrimitive({
      id: 'p-default-kf',
      renderer: 'css-keyframes',
      channels: ['opacity'],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: ['load'],
      perfClass: 'compositor',
      reducedMotion: 'shorten',
    })
    custom.registerPreset({ name: 'default-kf-preset', primitive: 'p-default-kf' })

    const plan = compile(parse('default-kf-preset'), custom, 'time')
    expect(plan.declarations['animation-name']).toBe('kui-default-kf-preset')
  })

  it('passes a function-shaped easing through unchanged rather than treating it as a keyword', () => {
    expect(run('fade-up cubic-bezier(.2,.8,.2,1)').declarations['animation-timing-function']).toBe(
      'cubic-bezier(.2,.8,.2,1)',
    )
  })
})

describe('compile — reduced motion policy', () => {
  it('defaults to shorten for entrance effects', () => {
    expect(run('fade-up').reducedMotion).toBe('shorten')
  })

  it('uses disable for continuous scroll-linked effects', () => {
    expect(run('parallax-y', 'view').reducedMotion).toBe('disable')
  })

  it('takes the strictest policy across composed effects', () => {
    const plan = compile(parse('slide-up, parallax-scale'), registry, 'view')
    expect(plan.reducedMotion).toBe('disable')
  })

  it('lets an authored rm: strengthen the policy the primitives declared', () => {
    // The capability the library had no spelling for at all: `fade-up` claims `shorten`, but an
    // author who knows this particular reveal is a full-screen wipe can ask for it not to run.
    expect(run('fade-up rm:disable').reducedMotion).toBe('disable')
  })

  /*
   * A one-way ratchet, on `strictestPolicy`'s own rule rather than a new one. `parallax` declares
   * `disable` because parallax is a documented vestibular trigger, not because the library is
   * being cautious on the author's behalf — so `rm:shorten` there would hand a visitor who asked
   * their OS for less motion exactly the motion they asked not to receive.
   */
  it('refuses to let rm: weaken a policy, and says so by name', () => {
    const plan = compile(parse('parallax-y rm:shorten'), registry, 'view')
    expect(plan.reducedMotion).toBe('disable')
    expect(plan.warnings.join()).toContain('rm:shorten')
    expect(plan.warnings.join()).toContain('may only strengthen')
  })

  it('leaves the policy alone when no rm: was written', () => {
    expect(run('fade-up').warnings.join()).not.toContain('rm:')
  })
})

describe('compile — timeline support', () => {
  it('warns when a time-only effect is put on a view timeline', () => {
    // `typewriter`, not `fade-up`: entrances now declare ['time', 'view', 'scroll'], so this
    // needs an effect that is time-only by nature. A JS-tier text effect types on a clock and
    // has no meaningful scroll-progress reading, so it is a stable fixture for "time-only".
    expect(run('typewriter', 'view').warnings.join()).toContain('does not support timeline "view"')
  })

  it('does not warn for an entrance on a view timeline', () => {
    // The entrance primitives used to omit `timelines` entirely and so inherited the ['time']
    // default, which made the single most common scroll pattern — an entrance that scrubs with
    // scroll and reverses on the way back up — unexpressible, and made it fail by warning
    // rather than by working.
    expect(run('fade-up', 'view').warnings).toEqual([])
  })

  it('does not warn for a scroll-linked effect on a view timeline', () => {
    expect(run('parallax-y', 'view').warnings).toEqual([])
  })

  it('warns when a scroll-linked effect is left on the default time timeline', () => {
    expect(run('parallax-y').warnings.join()).toContain('does not support timeline "time"')
  })
})

describe('compile — capability intersection across composed effects', () => {
  it('intersects timelines down to the ones every composed effect supports', () => {
    // parallax-y and scroll-progress-ring both declare view+scroll, so both survive.
    const plan = run('parallax-y, scroll-progress-ring', 'view')
    expect(plan.fxNames).toEqual(['parallax-y', 'scroll-progress-ring'])
    expect([...plan.supportedTimelines].sort((a, b) => a.localeCompare(b))).toEqual([
      'scroll',
      'view',
    ])
  })

  it('keeps a timeline intersection empty once it legitimately empties out', () => {
    // Regression: the accumulator was `length ? filter : copy`, so an empty intersection was
    // indistinguishable from "no effect has contributed yet". typewriter (time) and
    // parallax-scale (view/scroll) share nothing, but scroll-progress-ring then REPOPULATED the
    // list with ['scroll', 'view'] — and style-plan.ts duly applied view() to the time-only
    // effect, which is exactly the mismatch supportedTimelines exists to stop.
    // Originally written with fade-up; entrances legitimately support view timelines now, so the
    // case needs an effect that still empties the intersection for the assertion to mean anything.
    const plan = run('typewriter, parallax-scale, scroll-progress-ring', 'view')
    expect(plan.fxNames).toEqual(['typewriter', 'parallax-scale', 'scroll-progress-ring'])
    expect(plan.supportedTimelines).toEqual([])
  })

  it('intersects activations down to the ones every composed effect supports', () => {
    // fade-up supports all six; parallax-scale only `manual`.
    const plan = run('fade-up, parallax-scale', 'view')
    expect(plan.fxNames).toEqual(['fade-up', 'parallax-scale'])
    expect(plan.supportedActivations).toEqual(['manual'])
  })

  it('keeps an activation intersection empty once it legitimately empties out', () => {
    // Same defect on the activation axis: lift supports only `load`, parallax-scale only
    // `manual`, so nothing is left — but blur-in supports all six and used to restore them,
    // handing the animator a contract every composed effect had already ruled out.
    const plan = run('lift, parallax-scale, blur-in', 'view')
    expect(plan.fxNames).toEqual(['lift', 'parallax-scale', 'blur-in'])
    expect(plan.supportedActivations).toEqual([])
  })
})

describe('compile — viewport gates', () => {
  it('wraps a gated track in its switch property, keeping the ident as the fallback', () => {
    // The whole implementation, and the reason this feature needs no runtime: outside the gate the
    // property holds `none`; inside it, it is the guaranteed-invalid value and `var()` falls
    // through to the real ident. `src/css/base.css` declares both states in a media query, so the
    // browser re-decides on every resize with no script running.
    expect(run('fade-up above:md').declarations['animation-name']).toBe(
      'var(--kui-above-md, kui-in-up)',
    )
  })

  it('leaves an ungated track exactly as it was', () => {
    expect(run('fade-up').declarations['animation-name']).toBe('kui-in-up')
  })

  it('gates each composed segment independently, keeping the parallel lists aligned', () => {
    // A gated-off track is a `none` entry that still occupies its index, so every other longhand
    // list still lines up with it. CSS repeats a shorter value list to fill the longest one, so a
    // track that were simply *omitted* would shift its neighbours' durations onto the wrong effect.
    const plan = run('fade-up 600ms below:md, blur-in 400ms above:md')
    expect(plan.declarations['animation-name']).toBe(
      'var(--kui-below-md, kui-in-up), var(--kui-above-md, kui-blur-in)',
    )
    expect(plan.declarations['animation-duration']).toBe('600ms, 400ms')
    expect(plan.declarations['animation-fill-mode']).toBe('both, both')
  })

  it('nests both halves of a band', () => {
    expect(run('fade-up above:md below:xl').declarations['animation-name']).toBe(
      'var(--kui-above-md, var(--kui-below-xl, kui-in-up))',
    )
  })

  it('carries one gate across every track a variant compiles', () => {
    // A `tween` writing two property groups is still ONE effect the author gave one condition;
    // that it becomes two keyframe blocks is a fact about CSS, not something the gate may leak.
    expect(run('tween x:100 opacity:0 800ms above:lg').declarations['animation-name']).toBe(
      'var(--kui-above-lg, kui-tween-to-translate), var(--kui-above-lg, kui-tween-to-opacity)',
    )
  })

  it('reports the bare keyframe idents separately from the declaration', () => {
    // `animation-name` is no longer a list of idents that survives a `split(',')` — that would
    // shred `var(--kui-above-md, kui-in-up)` into two fragments, neither of which is a keyframe
    // name. `animator.ts` matches this list against `getAnimations()` to decide which handles the
    // element owns, and owning nothing would settle its completion promise immediately and strand
    // `data-kui-state` on `finished` while the animation was still visibly running.
    expect(run('fade-up below:md, blur-in above:md').keyframeNames).toEqual([
      'kui-in-up',
      'kui-blur-in',
    ])
  })

  it('reports no keyframe names for an element with no CSS-rendered effect', () => {
    expect(run('count-up').keyframeNames).toEqual([])
  })

  it('composes two effects that share a channel but can never share a width', () => {
    // `fade-up` and `parallax-y` both own `translate`, so before the gate reached the conflict
    // detector this pair was refused and its second half dropped — at every width, including the
    // ones where the first half was gated off and nothing animated at all.
    const plan = run('fade-up below:md, parallax-y above:md', 'view')
    expect(plan.fxNames).toEqual(['fade-up', 'parallax-y'])
    expect(plan.warnings.join()).not.toContain('cannot compose')
  })

  it('still refuses two effects that share a channel at some width they can both run', () => {
    // The gate narrows the question, it does not retire it: overlapping conditions collide exactly
    // as unconditional ones do.
    const plan = run('fade-up above:md, parallax-y above:lg', 'view')
    expect(plan.fxNames).toEqual(['fade-up'])
    expect(plan.warnings.join()).toContain('cannot compose')
  })

  it('still stamps a gated effect, because the gate is not decided here', () => {
    // `data-kui-fx` has to name every composed effect at every width: the element must already be
    // fully installed for BOTH sides of the breakpoint, since crossing one is a repaint rather than
    // a rescan. The consequence worth knowing is that a preset's static, non-keyframe rules still
    // apply to a gated-off segment — a gate turns off the animation, not the effect's styling.
    expect(run('fade-up above:md').fxNames).toEqual(['fade-up'])
  })
})

/**
 * `compileTargets` — the `scope:page` feature, docs/plan-scope-page.md step 5.
 *
 * `fade-up`/`blur-in`/`fade-left`/`flip-reorder` here own no `target` parameter of their own, so
 * `target:`/`scope:` on any of them go through the universal lift in `resolveEntries`. The six
 * scroll-mechanics/forms primitives that *do* declare `target` (`scroll-progress`, and friends) are
 * exercised in `scroll-mechanics.test.ts`/`catalog-forms.test.ts` instead — this file's job is the
 * partitioning machinery, not any one primitive's own resolution.
 */
describe('compileTargets — lifting target:/scope:', () => {
  it('leaves an untargeted attribute as a single host group, unchanged', () => {
    const document = runTargets('fade-up')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
  })

  it('lifts target: into its own group when nothing untargeted remains', () => {
    const document = runTargets('fade-up target:h1')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('h1')
    expect(document.targets[0]!.scope).toBe('self')
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
  })

  it('defaults scope to "self" — target: always means "search inside myself"', () => {
    expect(runTargets('fade-up target:h1').targets[0]!.scope).toBe('self')
  })

  it('honours an authored scope:page', () => {
    expect(runTargets('fade-up target:h1 scope:page').targets[0]!.scope).toBe('page')
  })

  it('does not lift target: for a primitive that declares the parameter itself', () => {
    // scroll-progress is one of the six — it reads target:/scope: from its own params, unchanged.
    const document = runTargets('scroll-progress target:.step')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
  })

  it('strips target:/scope: from the compiled params so they never warn "unknown parameter"', () => {
    const document = runTargets('fade-up target:h1 scope:page')
    expect(document.targets[0]!.plan.warnings).toEqual([])
  })

  it('puts the host group first, whichever segment was authored first', () => {
    const authoredHostSecond = runTargets('blur-in target:h1, fade-up')
    expect(authoredHostSecond.targets.map((t) => t.selector)).toEqual(['', 'h1'])
    const authoredHostFirst = runTargets('fade-up, blur-in target:h1')
    expect(authoredHostFirst.targets.map((t) => t.selector)).toEqual(['', 'h1'])
  })

  it('groups by scope AND selector — the same selector under self/page is two groups', () => {
    const document = runTargets('fade-up target:.x, blur-in target:.x scope:page')
    expect(document.targets).toHaveLength(2)
    const selves = document.targets.filter((t) => t.scope === 'self')
    const pages = document.targets.filter((t) => t.scope === 'page')
    expect(selves).toHaveLength(1)
    expect(pages).toHaveLength(1)
  })
})

describe('compileTargets — conflicts are per-group', () => {
  it('composes the same effect twice when they land on different targets', () => {
    // fade-up and fade-left both own `translate` and collide inside one group (see the
    // "rejects a channel collision" test above) — but here they never share a group at all.
    const document = runTargets('fade-up target:h1, fade-left target:.other')
    const byTarget = new Map(document.targets.map((t) => [t.selector, t.plan]))
    expect(byTarget.get('h1')!.fxNames).toEqual(['fade-up'])
    expect(byTarget.get('.other')!.fxNames).toEqual(['fade-left'])
    for (const target of document.targets) expect(target.plan.warnings.join()).not.toContain('cannot compose')
  })

  it('still refuses a real collision within one group', () => {
    const document = runTargets('fade-up target:h1, fade-left target:h1')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
    expect(document.targets[0]!.plan.warnings.join()).toContain('cannot compose')
  })
})

describe('compileTargets — element-scoped facts are merged across every group', () => {
  it('folds the strictest reduced-motion policy onto every group, not just the one that declared it', () => {
    // flip-reorder declares reducedMotion: 'disable'; fade-up declares 'shorten'. Both groups must
    // see 'disable' — there is one activation binding for the whole element (D1), so a `disable`
    // anywhere disables the gate everywhere.
    const document = runTargets('flip-reorder target:.list, fade-up')
    for (const target of document.targets) expect(target.plan.reducedMotion).toBe('disable')
  })

  it('unions channels across every group', () => {
    const document = runTargets('fade-up target:h1, count-up target:.n')
    for (const target of document.targets) {
      expect(target.plan.channels).toEqual(expect.arrayContaining(['opacity', 'translate', 'content']))
    }
  })

  it('is the identity for a single, untargeted group — compile() stays byte-identical', () => {
    // The invariant steps 1-4 protect, extended: a document with exactly one group must merge to
    // exactly what that group already computed, character for character.
    const solo = run('fade-up')
    const merged = runTargets('fade-up').targets[0]!.plan
    expect(merged.reducedMotion).toBe(solo.reducedMotion)
    expect(merged.supportedActivations).toEqual(solo.supportedActivations)
    expect(merged.supportedTimelines).toEqual(solo.supportedTimelines)
    expect(merged.channels).toEqual(solo.channels)
  })
})

describe('compileTargets — at: sequences across the whole authored list, before partitioning', () => {
  it('positions a segment in a different target group against its authored neighbour', () => {
    // Same worked example sequence.test.ts asserts for the untargeted case — "start blur-in 200ms
    // before fade-up ends" — except blur-in now lands in a different group entirely.
    const document = runTargets('fade-up 600ms, blur-in target:h1 400ms at:-200ms')
    const targeted = document.targets.find((t) => t.selector === 'h1')!
    const delay = targeted.plan.declarations['animation-delay']!.replace(/^calc\(/, '').replace(/\)$/, '')
    expect(delay).toBe(
      'var(--kui-reveal-delay, 0ms) + 600ms - 200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('leaves the untargeted first segment exactly as it compiled before target: existed', () => {
    const document = runTargets('fade-up 600ms, blur-in target:h1 400ms at:-200ms')
    const host = document.targets.find((t) => t.selector === '')!
    expect(host.plan.declarations['animation-delay']).toBe(
      'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
  })
})

describe('compileTargets — requiresOwnSubtree refuses relocation', () => {
  it('drops target: on a preset whose CSS reaches past itself, and keeps the effect on the host', () => {
    const document = runTargets('card-flip-x target:.face')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
    expect(document.targets[0]!.plan.fxNames).toEqual(['card-flip-x'])
  })

  it('warns by name when it drops the target', () => {
    const document = runTargets('card-flip-x target:.face')
    expect(document.warnings.join()).toContain('card-flip-x')
    expect(document.warnings.join()).toContain('cannot be retargeted')
  })

  it('does not warn for a preset that may be retargeted', () => {
    expect(runTargets('fade-up target:h1').warnings.join()).not.toContain('cannot be retargeted')
  })
})

describe('compile() — legacy single-plan contract', () => {
  it('returns the host group’s plan when a host group exists', () => {
    const plan = run('fade-up, blur-in target:h1')
    expect(plan.fxNames).toEqual(['fade-up'])
  })

  it('returns the sole group’s plan when everything was retargeted', () => {
    const plan = run('fade-up target:h1')
    expect(plan.fxNames).toEqual(['fade-up'])
  })
})
