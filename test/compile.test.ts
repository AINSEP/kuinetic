import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
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
