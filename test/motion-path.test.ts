import { describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { compile } from '../src/core/compile.js'
import { validate } from '../src/core/params.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { ParamSpec } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'
import {
  MOTION_PATH_PRESETS,
  MOTION_PATH_PRIMITIVES,
  registerMotionPath,
} from '../src/effects/motion-path/index.js'

/**
 * Motion paths — catalog section P.
 *
 * The suite never renders a frame (nothing in this repo's unit tier does), so the assertions here
 * are about the two things that decide whether a frame *would* be right: what reaches the
 * stylesheet, and what is refused before it can. The geometry itself — that `offset-anchor: 0 0`
 * puts the path's origin on the element's own top-left, that a missing `--kui-motion-path` leaves
 * `offset-path: none` rather than an error, that `path(var(...))` resolves at all — was verified
 * against Chromium while building this, and is recorded in `src/css/motion-path.css` where the
 * decisions it drove actually live.
 */

const CAPS: Capabilities = {
  viewTimeline: true,
  scrollTimeline: true,
  animationRange: true,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: true,
  intersectionObserver: true,
  reducedMotion: false,
  motionPath: true,
}

const registry = createRegistry()

function run(source: string) {
  return compile(parse(source), registry, 'time')
}

/** The `path` parameter's declared spec, read from the registry so the test cannot drift from it. */
function pathSpec(): ParamSpec {
  const primitive = registry.getPrimitive('motion-path')!
  return primitive.parameters.path!
}

describe('motion-path registration', () => {
  it('registers one primitive and every section P name resolves', () => {
    expect(MOTION_PATH_PRIMITIVES.map((primitive) => primitive.id)).toEqual(['motion-path'])
    const reg = registerMotionPath(new Registry())
    for (const preset of MOTION_PATH_PRESETS) expect(reg.resolve(preset.name)).toBeDefined()
    expect(reg.names()).toEqual([
      'motion-path',
      'path-arc',
      'path-loop',
      'path-swoop',
      'path-wave',
    ])
  })

  it('renders as CSS keyframes, not JavaScript', () => {
    // The whole argument for this feature is that CSS already does it. A `javascript` renderer
    // here would mean the library drives an element along a curve frame by frame, on the main
    // thread, to reproduce something the compositor does for free.
    expect(MOTION_PATH_PRIMITIVES[0]!.renderer).toBe('css-keyframes')
    expect(MOTION_PATH_PRIMITIVES[0]!.prepare).toBeUndefined()
  })

  it('claims the offset channel alone, so a path composes with a transform', () => {
    // The motion-path transform is applied *before* translate/rotate/scale rather than merged with
    // them, so both genuinely apply. Declaring `translate` would make the conflict detector reject
    // pairs that do not collide — `path-arc, fade-up` among them.
    expect(MOTION_PATH_PRIMITIVES[0]!.channels).toEqual(['offset'])
    expect(run('path-arc, fade-up').fxNames).toEqual(['path-arc', 'fade-up'])
    expect(run('path-arc, fade-up').warnings).toEqual([])
  })

  it('accepts the scroll timelines as well as the clock', () => {
    expect(MOTION_PATH_PRIMITIVES[0]!.supportedTimelines).toEqual(['time', 'view', 'scroll', 'pin'])
    expect(compile(parse('path-arc'), registry, 'scroll').warnings).toEqual([])
  })

  it('gives every name its own path, so no name needs author-supplied geometry', () => {
    // §6.4 of the parity outline, and the reason this is a catalog entry rather than an API: an
    // author should be able to drop a name on an element and see motion.
    for (const preset of MOTION_PATH_PRESETS) {
      expect(preset.params?.path, `${preset.name} ships no path`).toMatch(/^M/)
    }
  })

  it('shares one keyframe block across the family', () => {
    // The names differ only in a custom property; a block per name would be five copies of two
    // lines that can never legitimately diverge. Same call `fade-up`/`slide-up` already make.
    const blocks = new Set(MOTION_PATH_PRESETS.map((preset) => preset.keyframes))
    expect([...blocks]).toEqual(['kui-motion-travel'])
    expect(run('path-wave').declarations['animation-name']).toBe('kui-motion-travel')
  })

  it('cloaks the entrance and nothing else', () => {
    // `path-swoop` is the only name that starts displaced from the element's resting position, so
    // it is the only one with a from-state flash to hide. Cloaking `path-arc` would blank an
    // element that is already exactly where it belongs.
    const cloaked = MOTION_PATH_PRESETS.filter((preset) => preset.cloak).map((p) => p.name)
    expect(cloaked).toEqual(['path-swoop'])
  })

  it('lands path-swoop on the element resting position, not away from it', () => {
    // The one entrance in the set is written backwards from where it has to finish. If this path
    // ever stops ending at `0 0`, every element using it ends up permanently off its mark.
    const swoop = MOTION_PATH_PRESETS.find((preset) => preset.name === 'path-swoop')!
    expect(swoop.params!.path!.trimEnd()).toMatch(/0 0$/)
  })
})

describe('path parameter', () => {
  it('reaches the stylesheet as a quoted CSS string', () => {
    // `offset-path: path(...)` takes a `<string>` and `var()` substitutes tokens, so the quotes
    // have to be part of the custom property's value or the declaration never parses.
    expect(run('motion-path path:"M 0 0 L 40 40"').vars['--kui-motion-path']).toBe(
      '"M 0 0 L 40 40"',
    )
  })

  it('survives the tokenizer despite its spaces and commas', () => {
    // The reason quoting is required in the attribute at all: unquoted, every coordinate becomes
    // its own unrecognised token and the comma splits the effect list.
    const parsed = parse('motion-path path:"M 0,0 C 10,20 30,40 50,0" 900ms')
    expect(parsed.specs).toHaveLength(1)
    expect(parsed.specs[0]!.params.path).toBe('M 0,0 C 10,20 30,40 50,0')
    expect(parsed.warnings).toEqual([])
  })

  it('rejects a path containing anything outside path-data syntax', () => {
    const result = validate('M 0 0 L 10 10 url(evil.svg)', pathSpec())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/unsupported character|disallowed/)
  })

  it('rejects a path that does not start with a moveto', () => {
    // Invalid SVG that every browser drops silently, taking the whole `offset-path` declaration
    // with it — the element then sits perfectly still with no error anywhere.
    const result = validate('L 10 10', pathSpec())
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('moveto')
  })

  it('accepts a relative moveto, an arc, and exponent notation', () => {
    expect(validate('m 0 0 a 5 5 0 0 1 10 10', pathSpec()).ok).toBe(true)
    expect(validate('M 0 0 L 1e2 -1.5e-1 Z', pathSpec()).ok).toBe(true)
  })

  it('allows a path far longer than any other parameter type may be', () => {
    // A curve exported from a vector editor runs to hundreds of characters before it says anything
    // unusual. The character allowlist is what bounds the risk here, not the length.
    const long = `M 0 0${' L 10 10'.repeat(60)}`
    expect(long.length).toBeGreaterThan(200)
    expect(validate(long, pathSpec()).ok).toBe(true)
  })

  it('still has a ceiling', () => {
    const absurd = `M 0 0${' L 10 10'.repeat(400)}`
    const result = validate(absurd, pathSpec())
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('2000')
  })

  it('warns by name and writes nothing when a path is refused', () => {
    // The custom property must stay unset rather than fall back to the preset's path: a silently
    // substituted curve is a wrong animation, and this codebase would rather have none.
    const plan = run('motion-path path:"L nope"')
    expect(plan.vars['--kui-motion-path']).toBeUndefined()
    expect(plan.warnings.join('\n')).toContain('parameter "path"')
  })
})

describe('rotate parameter', () => {
  it('defaults to no rotation, unlike the CSS property it drives', () => {
    // `offset-rotate`'s initial value is `auto`. Shipping that would tip every card, badge and
    // headline handed a path. GSAP's `autoRotate` is off by default for the same reason.
    const primitive = registry.getPrimitive('motion-path')!
    expect(primitive.parameters.rotate!.default).toBe('0deg')
    expect(run('path-arc').vars['--kui-motion-rotate']).toBeUndefined()
  })

  it('accepts the two tangent keywords', () => {
    expect(run('path-arc rotate:auto').vars['--kui-motion-rotate']).toBe('auto')
    expect(run('path-arc rotate:reverse').vars['--kui-motion-rotate']).toBe('reverse')
  })

  it('accepts a fixed angle, which is how rotation is turned off again', () => {
    expect(run('path-arc rotate:45deg').vars['--kui-motion-rotate']).toBe('45deg')
    expect(run('path-arc rotate:0deg').vars['--kui-motion-rotate']).toBe('0deg')
  })

  it('refuses a keyword it never declared', () => {
    const plan = run('path-arc rotate:sideways')
    expect(plan.vars['--kui-motion-rotate']).toBeUndefined()
    expect(plan.warnings.join('\n')).toContain('parameter "rotate"')
  })
})

describe('anchor, from and to', () => {
  it('takes a quoted two-word position', () => {
    expect(run('path-arc anchor:"top right"').vars['--kui-motion-anchor']).toBe('top right')
  })

  it('takes the centre, which is what rotate:auto wants', () => {
    expect(run('path-arc rotate:auto anchor:center').vars).toEqual({
      '--kui-motion-rotate': 'auto',
      '--kui-motion-anchor': 'center',
    })
  })

  it('refuses a position it never declared', () => {
    expect(run('path-arc anchor:middle').warnings.join('\n')).toContain('parameter "anchor"')
  })

  it('travels a sub-span of the path, in either direction', () => {
    expect(run('path-arc from:20% to:80%').vars).toEqual({
      '--kui-motion-from': '20%',
      '--kui-motion-to': '80%',
    })
    // Reversal without rewriting the curve backwards by hand, which is error-prone and stops the
    // data matching the drawing it came from.
    expect(run('path-arc from:100% to:0%').vars).toEqual({
      '--kui-motion-from': '100%',
      '--kui-motion-to': '0%',
    })
  })
})

describe('motion-path through the animator', () => {
  function build(html: string, capabilities: Capabilities = CAPS) {
    document.body.innerHTML = html
    const reporter = collectingReporter()
    const animator = new Animator({ registry: createRegistry(), capabilities, reporter })
    animator.start()
    return { animator, reporter, el: document.body.firstElementChild! }
  }

  it('installs a named path with no author parameters at all', () => {
    const { el, reporter } = build('<div data-kui="path-arc"></div>')
    expect(el.getAttribute(ATTR.normalized)).toBe('path-arc')
    // Not asserted as exactly `ready`: jsdom has no IntersectionObserver, so the `on:enter`
    // fallback releases the gate immediately and the element is already `running` by the time this
    // reads it. What matters here is that it installed at all — `pending` (name unregistered) and
    // `failed` (nothing compiled) are the two outcomes this is guarding against.
    expect(['ready', 'running', 'finished']).toContain(el.getAttribute(ATTR.state))
    expect(reporter.messages).toEqual([])
  })

  it('writes an authored path as an inline custom property', () => {
    const { el } = build(`<div data-kui="motion-path path:'M 0 0 L 60 0'"></div>`)
    expect((el as HTMLElement).style.getPropertyValue('--kui-motion-path')).toBe('"M 0 0 L 60 0"')
  })

  it('explains itself where the browser has no motion path, instead of just not moving', () => {
    // The failure this warning exists for: everything compiles, the animation runs and finishes,
    // and the element never moves. Nothing else anywhere would tell the author why.
    const { reporter } = build('<div data-kui="path-arc"></div>', { ...CAPS, motionPath: false })
    expect(reporter.messages.join('\n')).toContain('offset-path')
  })

  it('stays quiet about a browser that has it', () => {
    const { reporter } = build('<div data-kui="path-arc"></div>')
    expect(reporter.messages).toEqual([])
  })

  it('says nothing about motion paths for an effect that has none', () => {
    const { reporter } = build('<div data-kui="fade-up"></div>', { ...CAPS, motionPath: false })
    expect(reporter.messages).toEqual([])
  })
})
