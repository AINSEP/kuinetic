import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { createJsEffectPreparer } from '../src/core/js-effect-preparer.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { parse, splitTopLevel } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { Registry } from '../src/core/registry.js'
import { createScrollScheduler, createRootResolver } from '../src/core/scroll-scheduler.js'
import { detect } from '../src/core/capabilities.js'
import { inertInstance } from '../src/core/types.js'
import type { EffectParams, Timeline } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'

/**
 * `at:` through the real catalog — the same feature `test/sequence.test.ts` exercises structurally,
 * asserted here on the declarations an element actually receives. The suite never renders a frame
 * (see the parity outline §3.5), so these check the compiled arithmetic rather than the motion; the
 * arithmetic is the whole deliverable, because a declarative sequence is resolved ahead of time and
 * there is no runtime playhead to observe.
 */

let registry: Registry

beforeEach(() => {
  registry = createRegistry()
})

function run(source: string, timeline: Timeline = 'time') {
  return compile(parse(source), registry, timeline)
}

/**
 * One segment's compiled delay, unwrapped from its `calc()`.
 *
 * Split with `splitTopLevel` rather than `String.split(', ')`: every track contains
 * `var(--kui-i, 0)`, whose fallback comma a naive split shreds — the same footgun the tokenizer in
 * `parse.ts` exists for.
 */
function delayOf(source: string, index: number, timeline: Timeline = 'time'): string {
  const tracks = splitTopLevel(run(source, timeline).declarations['animation-delay']!, ',')
  return tracks[index]!.replace(/^calc\(/, '').replace(/\)$/, '')
}

describe('at: — the worked example from the parity brief', () => {
  it('resolves "start blur-in 200ms before fade-up ends" to a delay of 400ms', () => {
    // `fade-up 600ms, blur-in 400ms at:-200ms` — the arithmetic an author used to do by hand,
    // and had to redo whenever either of the other two numbers moved.
    const delay = delayOf('fade-up 600ms, blur-in 400ms at:-200ms', 1)
    expect(delay).toBe(
      'var(--kui-reveal-delay, 0ms) + 600ms - 200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('leaves the first segment exactly as it compiled before sequencing existed', () => {
    expect(delayOf('fade-up 600ms, blur-in 400ms at:-200ms', 0)).toBe(
      'var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('changes nothing at all about an attribute with no at:', () => {
    // The whole existing catalog and every page already written depends on this: a segment with
    // no position compiles to the delay it always did, character for character.
    expect(run('slide-up').declarations['animation-delay']).toBe(
      'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
    expect(run('fade-up 600ms, blur-in 400ms 200ms').declarations['animation-delay']).toBe(
      'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms)), ' +
        'calc(200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
  })
})

describe('at: — anchors', () => {
  it('carries an unwritten duration through symbolically', () => {
    // Not resolved to `600ms` here: restyling `--kui-reveal-duration` in a consumer stylesheet has
    // to move the effect positioned after it, with no recompile.
    expect(delayOf('fade-up, blur-in at:+100ms', 1)).toContain(
      'var(--kui-reveal-delay, 0ms) + var(--kui-reveal-duration, 600ms) + 100ms',
    )
  })

  it('starts alongside the previous effect on at:with', () => {
    expect(delayOf('fade-up 600ms, blur-in at:with', 1)).toBe(
      'var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('offsets from the previous effect’s START on at:with+', () => {
    expect(delayOf('fade-up 600ms, blur-in at:with+150ms', 1)).toContain(
      'var(--kui-reveal-delay, 0ms) + 150ms',
    )
  })

  it('chains a three-effect list, each relative to the one before it', () => {
    const source = 'fade-up 600ms, blur-in 400ms at:-200ms, zoom-in 300ms at:+50ms'
    expect(delayOf(source, 2)).toContain(
      'var(--kui-reveal-delay, 0ms) + 600ms - 200ms + 400ms + 50ms',
    )
  })
})

describe('at: — the generic tween', () => {
  it('is not mistaken for a property to tween', () => {
    // The tween reads author `key:value` pairs as CSS properties, so an `at:` left in `spec.params`
    // would have been compiled as a tween of a property called `at`. It is lifted onto the spec in
    // `parse.ts` precisely so no primitive ever sees it.
    const plan = run('tween x:100 800ms, blur-in 400ms at:-200ms')
    expect(plan.declarations['animation-name']).toBe('kui-tween-to-translate, kui-blur-in')
    expect(plan.warnings).toEqual([])
    expect(delayOf('tween x:100 800ms, blur-in 400ms at:-200ms', 1)).toContain(
      'var(--kui-tween-delay, 0ms) + 800ms - 200ms',
    )
  })

  it('gives every keyframe block of one positioned segment the same start', () => {
    // A tween touching two property groups compiles to two tracks, but it is still *one* segment
    // the author positioned once — the two must not drift apart.
    const source = 'blur-in 400ms, tween x:100 rotate:45deg 300ms at:-100ms'
    const plan = run(source)
    expect(plan.declarations['animation-name']!.split(', ')).toHaveLength(3)
    expect(delayOf(source, 1)).toBe(delayOf(source, 2))
    expect(delayOf(source, 1)).toContain('var(--kui-blur-delay, 0ms) + 400ms - 100ms')
  })
})

describe('at: — composition with stagger', () => {
  it('keeps the stagger term outside the sequence, so the two cannot double-count', () => {
    // `at:` positions segments against each other *on one element*; stagger shifts the whole
    // element against its siblings. Every track takes the same stagger term, so the spacing `at:`
    // established inside the list survives the shift intact.
    const source = 'fade-up 600ms, blur-in 400ms at:-200ms'
    const [first, second] = [delayOf(source, 0), delayOf(source, 1)]
    const staggerTerm = 'var(--kui-i, 0) * var(--kui-stagger, 0ms)'
    expect(first).toContain(staggerTerm)
    expect(second).toContain(staggerTerm)
    expect(second!.split(staggerTerm)).toHaveLength(2)
  })

  it('survives the pin scrub, where the delay doubles as the scrub head', () => {
    const delay = delayOf('fade-up 600ms, blur-in 400ms at:-200ms', 1, 'pin')
    expect(delay).toContain('var(--kui-reveal-delay, 0ms) + 600ms - 200ms')
    expect(delay).toContain('var(--kui-progress, 0)')
  })
})

describe('at: — JavaScript-rendered effects', () => {
  it('resolves to a concrete delay a JS primitive can act on', () => {
    const plan = run('fade-up 600ms, count-up 400ms at:-200ms')
    expect(plan.jsEffects).toHaveLength(1)
    expect(plan.jsEffects[0]!.sequencedDelayMs).toBe(400)
    expect(plan.warnings).toEqual([])
  })

  it('reads an unwritten duration from the same defaults the stylesheet was generated from', () => {
    // `scripts/generate-preset-css.mjs` emits `--kui-reveal-duration: 600ms` for `fade-up` from
    // this very schema, so the numeric mirror and the symbolic half agree.
    expect(run('fade-up, count-up at:+100ms').jsEffects[0]!.sequencedDelayMs).toBe(700)
  })

  it('falls through a rejected duration to the same default CSS lands on', () => {
    // `resolveParams` drops `duration:banana`, so `--kui-reveal-duration` keeps the preset's 600ms
    // and the symbolic half positions off that. The numeric mirror has to make the same choice, or
    // the two halves of one sequence would be built from different durations.
    const plan = run('fade-up duration:banana, count-up at:+100ms')
    expect(plan.jsEffects[0]!.sequencedDelayMs).toBe(700)
    expect(plan.warnings.join()).toContain('parameter "duration"')
  })

  it('refuses loudly when the primitive declares no delay it could honour', () => {
    // Asserted against a primitive registered here rather than a catalog name, deliberately.
    // Task F (outline §11) is spreading `TRIGGER_DELAY_PARAM` across the JS primitives that should
    // have one, so any effect picked out of the catalog as "the one that cannot be positioned" is a
    // fixture with an expiry date — `split-flap`, the obvious candidate today, gains a `delay` on
    // `feat/js-effect-timing` and starts passing this test for the wrong reason. What is permanent
    // is the *rule*: a JS renderer with no `delay` in its schema cannot be positioned and must say
    // so by name. §9.4 asks for exactly that, and a locally-registered primitive is the only way to
    // keep asserting it once the catalog no longer contains an example.
    const registry = createRegistry()
    registry.registerPrimitive({
      id: 'undelayable',
      renderer: 'javascript',
      channels: ['text'],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: ['enter'],
      perfClass: 'paint',
      reducedMotion: 'shorten',
      prepare: () => inertInstance(),
    })
    registry.registerPreset({ name: 'undelayable', primitive: 'undelayable' })

    const plan = compile(parse('fade-up 600ms, undelayable at:+100ms'), registry, 'time')
    expect(plan.jsEffects[0]!.sequencedDelayMs).toBeUndefined()
    expect(plan.warnings.join()).toContain(
      '"undelayable" is rendered in JavaScript and declares no "delay"',
    )
  })

  it('hands the resolved delay to the primitive through params.timing', () => {
    // The route that works whether or not the schema declares a look-alike `delay` — see the
    // two-routes design note in `js-effect-preparer.ts`.
    const seen: EffectParams[] = []
    const registryWithProbe = createRegistry()
    registryWithProbe.registerPrimitive({
      id: 'probe',
      renderer: 'javascript',
      channels: ['text'],
      parameters: { delay: { type: 'time', default: '0ms', cssProperty: '--kui-probe-delay' } },
      supportedTimelines: ['time'],
      supportedActivations: ['enter'],
      perfClass: 'paint',
      reducedMotion: 'shorten',
      prepare(_el, params) {
        seen.push(params)
        return {
          activate() {},
          cancel() {},
          finish() {},
          finished: Promise.resolve(),
          destroy() {},
        }
      },
    })
    registryWithProbe.registerPreset({ name: 'probe', primitive: 'probe' })

    const plan = compile(parse('fade-up 600ms, probe at:-200ms'), registryWithProbe, 'time')
    const el = document.createElement('div')
    const scheduler = createScrollScheduler()
    createJsEffectPreparer({
      scheduler,
      rootResolver: createRootResolver({ win: window }),
      capabilities: detect(),
      reporter: collectingReporter(),
      respectReducedMotion: false,
    }).prepare({
      el,
      plan,
      signal: new AbortController().signal,
      ledger: createStyleLedger(el),
    })
    scheduler.destroy()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.timing.delayMs).toBe(400)
  })
})

describe('at: — refusals name the effect and leave it where it was', () => {
  it('refuses an absolute position, pointing at delay: instead', () => {
    const plan = run('fade-up, blur-in at:200ms')
    expect(plan.warnings.join()).toContain('another spelling of delay:200ms')
    expect(delayOf('fade-up, blur-in at:200ms', 1)).toBe(
      'var(--kui-blur-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('refuses at: on the only effect in the list', () => {
    expect(run('fade-up at:-200ms').warnings.join()).toContain('first effect in the list')
  })

  it('refuses to measure from an effect with no end, and offers at:with', () => {
    const warnings = run('pin-section, fade-up at:+100ms').warnings.join()
    expect(warnings).toContain('cannot start "fade-up" relative to the end of "pin-section"')
    expect(warnings).toContain('at:with')
  })

  it('positions relative to a durationless effect’s START without complaint', () => {
    const plan = run('pin-section, fade-up at:with+100ms')
    expect(plan.warnings).toEqual([])
    expect(delayOf('pin-section, fade-up at:with+100ms', 0)).toContain(
      'var(--kui-pin-delay, 0ms) + 100ms',
    )
  })

  it('warns that a scroll-driven timeline ignores the compiled delay', () => {
    expect(run('fade-up 600ms, blur-in at:-200ms', 'view').warnings.join()).toContain(
      'a "view" timeline is driven by scroll position',
    )
  })

  it('measures at: against the effects actually compiled, not the ones merely written', () => {
    // `resolveComposition` drops a conflicting neighbour before this runs, and an unknown name
    // never becomes an entry at all — either way `at:` must not be anchored to something that is
    // not on the element.
    expect(run('not-an-effect, fade-up at:-200ms').warnings.join()).toContain(
      'first effect in the list',
    )
  })
})
