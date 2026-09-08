// Static transforms (catalog section R) — `effects/catalog/transforms.ts`. Same three questions
// `catalog-background-media.test.ts` asks of its own closest-precedent primitive: does `prepare`
// write what it claims and nothing else, does it refuse timing by name instead of silently
// discarding it, and does it compose cleanly with effects on channels it does not touch.
import { describe, expect, it } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { KUI_EVENT } from '../src/core/control.js'
import { createParams, readEffectParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { CAPS, build, el, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

/** Same shape `catalog-background-media.test.ts` and `catalog-discrete.test.ts` both build. */
function fakeCtx(
  el: Element,
  overrides: { reducedMotion?: boolean; warn?: (message: string) => void } = {},
): PrepareContext {
  return {
    win: window,
    doc: document,
    style: createStyleLedger(el),
    warn: overrides.warn ?? (() => {}),
    reducedMotion: overrides.reducedMotion ?? false,
  } as unknown as PrepareContext
}

/**
 * The harness's `build`, but over a browser that reports `prefers-reduced-motion: reduce`.
 *
 * `js-effect-harness.ts`'s own `CAPS` deliberately sets `reducedMotion: false` so the suites it was
 * written for can observe primitives at all; the whole subject here is what happens when it is
 * true, so the animator is constructed locally with everything else the harness exports.
 */
function buildReduced(html: string): Animator {
  document.body.innerHTML = html
  return new Animator({
    root: document.body,
    registry,
    capabilities: { ...CAPS, reducedMotion: true },
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
}

function install(
  el: Element,
  params: Record<string, string>,
  ctx: PrepareContext = fakeCtx(el),
): EffectInstance {
  const instance = registry.resolve('rotate-static')!.primitive.prepare!(el, createParams(params), ctx)
  instance.activate()
  return instance
}

describe('rotate-static registration', () => {
  it('claims only the rotate channel', () => {
    const { primitive } = registry.resolve('rotate-static')!
    expect(primitive.channels).toEqual(['rotate'])
  })

  it('is a JS-rendered primitive with no timing parameters at all', () => {
    const { primitive } = registry.resolve('rotate-static')!
    expect(primitive.renderer).toBe('javascript')
    expect(primitive.parameters).not.toHaveProperty('delay')
    expect(primitive.parameters).not.toHaveProperty('duration')
    expect(primitive.parameters).not.toHaveProperty('ease')
  })

  it('defaults to load, like background-media, so an above-the-fold tilt is not stranded behind on:enter', () => {
    const { primitive } = registry.resolve('rotate-static')!
    expect(primitive.defaultActivation).toBe('load')
    expect(primitive.supportedActivations).toEqual(['load', 'enter', 'manual'])
  })

  /**
   * Never `'disable'`. That value is a fact about the *host*, folded across every composed effect
   * by `strictestPolicy` and implemented by activating nothing at all, so declaring it here
   * silenced whatever `rotate-static` was written beside. `'shorten'` is what `mergeHostFacts`
   * seeds its fold with, i.e. the identity element — the spelling of "I impose no constraint of my
   * own". `count` (`catalog/numbers.ts`) already refuses `'disable'` in its own comment for the
   * mirror-image reason, and was one of this primitive's victims.
   */
  it("declares the neutral 'shorten', so it constrains no neighbour it is composed with", () => {
    const { primitive } = registry.resolve('rotate-static')!
    expect(primitive.reducedMotion).toBe('shorten')
  })

  it('is compositor-class — it writes only the individual rotate transform property', () => {
    const { primitive } = registry.resolve('rotate-static')!
    expect(primitive.perfClass).toBe('compositor')
  })

  it('reuses rotate-in\'s own "angle" param type, so the two spellings agree', () => {
    const rotateStatic = registry.resolve('rotate-static')!.primitive.parameters.angle!
    const rotateIn = registry.resolve('rotate-in')!.primitive.parameters.angle!
    expect(rotateStatic.type).toBe('angle')
    expect(rotateStatic.type).toBe(rotateIn.type)
  })
})

describe('rotate-static — prepare', () => {
  it('writes the authored angle to the individual "rotate" property, not "transform"', () => {
    const target = document.createElement('div')
    const instance = install(target, { angle: '45deg' })
    expect(target.style.getPropertyValue('rotate')).toBe('45deg')
    expect(target.style.getPropertyValue('transform')).toBe('')
    instance.destroy()
  })

  /**
   * The regression this file previously asserted backwards. It used to expect `rotate: 0deg` here
   * and call that "a documented no-op", but an inline `rotate: 0deg` is not a no-op — it is an
   * override that outranks every stylesheet rule. Writing nothing is the no-op.
   */
  it('writes nothing at all when no angle was authored — a no-op is an absent declaration', () => {
    const target = document.createElement('div')
    const instance = install(target, {})
    expect(target.style.getPropertyValue('rotate')).toBe('')
    instance.destroy()
  })

  it('reads the same "unset" sentinel back through the real schema, not just the inline fallback', () => {
    const { parameters } = registry.resolve('rotate-static')!.primitive
    // `readParams` prefills every declared parameter with its default before it looks at what the
    // author wrote, which is exactly why the default has to be a sentinel: this is the value
    // `prepareRotateStatic` sees for a bare `rotate-static`.
    expect(readEffectParams({}, parameters, () => {}).text('angle')).toBe('')
  })

  /**
   * Bug 2, in the shape it was reported: an author's own `rotate` visibly disappearing the moment
   * the library starts. The inline spelling is used because it is the strictest version of the
   * claim — an inline write is precisely what an inline write clobbers.
   */
  it('leaves a rotation the author set themselves completely alone', () => {
    const target = document.createElement('div')
    target.style.rotate = '12deg'
    const instance = install(target, {})
    expect(target.style.getPropertyValue('rotate')).toBe('12deg')
    instance.destroy()
  })

  /**
   * The other half of the same fix, and the one it would be easy to break while making the first
   * half pass: `angle:0deg` written out is a real instruction to flatten, not an absent one.
   */
  it('still honours an explicit angle:0deg — that is a flatten, not an absence', () => {
    const target = document.createElement('div')
    target.style.rotate = '12deg'
    const instance = install(target, { angle: '0deg' })
    expect(target.style.getPropertyValue('rotate')).toBe('0deg')
    instance.destroy()
  })

  /**
   * `reject` in `core/params.ts` returns `spec.default` for a value it refuses, so the sentinel is
   * the fallback here too: a typo warns and leaves the element as it found it, rather than warning
   * *and* flattening it.
   */
  it('warns and leaves the element alone when the authored angle is not an angle', () => {
    const { parameters } = registry.resolve('rotate-static')!.primitive
    const messages: string[] = []
    const params = readEffectParams({ angle: 'banana' }, parameters, (m) => messages.push(m))
    expect(messages.join(' ')).toContain('parameter "angle"')

    const target = document.createElement('div')
    target.style.rotate = '12deg'
    const instance = registry.resolve('rotate-static')!.primitive.prepare!(target, params, fakeCtx(target))
    instance.activate()
    expect(target.style.getPropertyValue('rotate')).toBe('12deg')
    instance.destroy()
  })

  it('accepts the same bare-number and "d" shorthand rotate-in\'s own angle grammar accepts', () => {
    const { parameters } = registry.resolve('rotate-static')!.primitive
    const warn = (): void => {}
    expect(readEffectParams({ angle: '45' }, parameters, warn).text('angle')).toBe('45deg')
    expect(readEffectParams({ angle: '45d' }, parameters, warn).text('angle')).toBe('45deg')
    expect(readEffectParams({ angle: '-0.5turn' }, parameters, warn).text('angle')).toBe('-0.5turn')
  })

  it('does not care what kind of element it is asked to tilt', () => {
    for (const el of [
      document.createElement('span'),
      document.createElement('img'),
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    ]) {
      const instance = install(el, { angle: '12deg' })
      expect((el as HTMLElement).style.getPropertyValue('rotate'), el.tagName).toBe('12deg')
      instance.destroy()
    }
  })

  /**
   * Nothing in `prepareRotateStatic` restores the property itself — it trusts the ledger, the same
   * way `prepareBackgroundMedia`'s `position`/`isolation` writes do. This is the assertion that
   * trust is actually honoured.
   */
  it('restores a previously authored rotate on ledger restore(), same trust background-media places in it', () => {
    const target = document.createElement('div')
    target.style.rotate = '3deg'
    const ledger = createStyleLedger(target)
    const instance = install(target, { angle: '45deg' }, { ...fakeCtx(target), style: ledger } as PrepareContext)
    expect(target.style.getPropertyValue('rotate')).toBe('45deg')

    instance.destroy()
    ledger.restore()
    expect(target.style.getPropertyValue('rotate')).toBe('3deg')
  })

  /**
   * A tilt is a state the element sits in, not a move it makes — identical reasoning to
   * `background-media`'s own test of the same name. Resolving `finished` immediately would report
   * `data-kui-state="finished"` from the first microtask onward for something with no end.
   */
  it('reports itself as continuous', () => {
    const target = document.createElement('div')
    const instance = install(target, { angle: '10deg' })
    expect(instance.continuous).toBe(true)
    instance.destroy()
  })

  it('installs nothing before activate(), so on:enter and manual still gate it', () => {
    const target = document.createElement('div')
    const instance = registry.resolve('rotate-static')!.primitive.prepare!(
      target,
      createParams({ angle: '45deg' }),
      fakeCtx(target),
    )
    expect(target.style.getPropertyValue('rotate')).toBe('')
    instance.activate()
    expect(target.style.getPropertyValue('rotate')).toBe('45deg')
    instance.destroy()
  })
})

describe('rotate-static — timing refusal', () => {
  const refused = (messages: string[], token: string): boolean =>
    messages.some((m) => m.includes(`"rotate-static" cannot honour ${token}`))

  it('refuses a positional duration/delay/ease, all three, by name', () => {
    const reporter = collectingReporter()
    build('<div data-kui="rotate-static 400ms 200ms linear angle:45deg">x</div>', reporter).start()

    expect(refused(reporter.messages, 'duration')).toBe(true)
    expect(refused(reporter.messages, 'delay')).toBe(true)
    expect(refused(reporter.messages, 'ease')).toBe(true)
    expect(reporter.messages.join(' ')).toContain('there is no motion to time')
  })

  it('refuses the key:value spelling of delay too, as an unknown parameter', () => {
    const reporter = collectingReporter()
    build('<div data-kui="rotate-static angle:45deg delay:300ms">x</div>', reporter).start()

    expect(reporter.messages.some((m) => m.includes('unknown parameter "delay"'))).toBe(true)
  })

  it('stays quiet when no timing token was authored at all', () => {
    const reporter = collectingReporter()
    build('<div data-kui="rotate-static angle:45deg">x</div>', reporter).start()

    expect(reporter.messages.filter((m) => m.includes('cannot honour'))).toEqual([])
  })
})

/**
 * The composability requirement this primitive was explicitly built to satisfy: an author writing
 * `data-kui="angle:45deg, fade-up"`-shaped markup (here, the real spelling this catalog settled
 * on) must get both effects, not one silently dropped for a channel collision that isn't real.
 * `rotate-static` claims only `CHANNEL.rotate`; `fade-up` (primitive `reveal`) claims
 * `opacity`+`translate` and `split-chars` (primitive `split-text`) claims
 * `opacity`+`translate`+`clip` — disjoint from `rotate` either way.
 */
describe('composes with effects on other channels', () => {
  it('composes with fade-up: both effects apply, no conflict warning', () => {
    const reporter = collectingReporter()
    build(
      '<h1 data-kui="rotate-static angle:8deg, fade-up" data-kui-on="load">Tilted headline</h1>',
      reporter,
    ).start()

    const host = el()
    expect(host.getAttribute('data-kui-fx')).toContain('rotate-static')
    expect(host.getAttribute('data-kui-fx')).toContain('fade-up')
    // rotate-static's own write.
    expect(host.style.getPropertyValue('rotate')).toBe('8deg')
    // fade-up's compiled keyframe, still present alongside it.
    expect(host.style.getPropertyValue('animation-name')).toContain('kui-in-up')
    expect(reporter.messages.join(' ')).not.toContain('cannot compose')
    expect(reporter.messages.join(' ')).not.toContain('both animate')
  })

  it('composes with split-chars: the host tilts and its text still segments into spans', () => {
    const reporter = collectingReporter()
    build(
      '<h1 data-kui="rotate-static angle:-12deg, split-chars" data-kui-on="load">Hi</h1>',
      reporter,
    ).start()

    const host = el()
    expect(host.getAttribute('data-kui-fx')).toContain('rotate-static')
    expect(host.getAttribute('data-kui-fx')).toContain('split-chars')
    expect(host.style.getPropertyValue('rotate')).toBe('-12deg')
    expect(host.querySelectorAll('.kui-split-item').length).toBeGreaterThan(0)
    expect(reporter.messages.join(' ')).not.toContain('cannot compose')
  })

  it('is confirmed disjoint at the compile level too — no warnings, both names survive', () => {
    const plan = compile(parse('rotate-static angle:45deg, fade-up'), registry, 'time')
    expect(plan.fxNames).toEqual(['rotate-static', 'fade-up'])
    expect(plan.warnings).toEqual([])
    expect(plan.jsEffects.map((entry) => entry.resolved.preset.name)).toContain('rotate-static')
  })

  /**
   * The negative case, so the two "no conflict" tests above are not passing merely because
   * `rotate-static` declares no channel at all. `rotate-in` (primitive `rotate`, section A) claims
   * the same `rotate` channel this primitive does, so composing the two must warn exactly the way
   * `fade-up, fade-left` already does in `compile.test.ts`.
   */
  it('does collide with an effect that also claims rotate — the channel declaration is doing real work', () => {
    const plan = compile(parse('rotate-static angle:45deg, rotate-in'), registry, 'time')
    expect(plan.warnings.join(' ')).toContain('cannot compose')
    expect(plan.fxNames).toEqual(['rotate-static'])
  })
})

/**
 * The regression this primitive's original `reducedMotion: 'disable'` caused, and the reason the
 * policy is now `'shorten'`.
 *
 * `'disable'` is not "skip me". `mergeHostFacts` (`core/compile.ts`) folds every composed effect's
 * policy with `strictestPolicy` and writes the one strictest answer back onto the whole host, and
 * `animator.ts`'s `openGate` implements that answer by activating *nothing at all* — the element is
 * stamped `finished` and emits the library's one `kui:finish` with no preceding `kui:start`. So a
 * primitive that writes a single CSS property was switching off every effect written beside it, for
 * every visitor who had asked their operating system for less motion. An audit put the blast radius
 * at 146 of 269 presets, 27 of them JS-rendered and therefore not running at all.
 *
 * `kui:start` is the assertion rather than the counter's rendered text because it is the exact
 * distinction the animator itself documents: under `'disable'` that event is the one thing that
 * never fires. It needs no clock, so nothing here depends on jsdom's rAF.
 */
describe('reduced motion: rotate-static must not silence what it is composed with', () => {
  const startsUnderReducedMotion = (html: string): { started: boolean; host: HTMLElement } => {
    const animator = buildReduced(html)
    let started = false
    document.body.addEventListener(KUI_EVENT.start, () => {
      started = true
    })
    animator.start()
    return { started, host: el() }
  }

  it('lets a JS-rendered neighbour run: count-up still starts when a static tilt sits beside it', () => {
    const { started, host } = startsUnderReducedMotion(
      '<span data-kui="rotate-static angle:8deg, count-up to:250" data-kui-on="load">0</span>',
    )
    expect(started).toBe(true)
    expect(host.getAttribute(ATTR.state)).not.toBe('finished')
  })

  it('keeps the tilt itself under reduced motion — a fixed 90deg turn is layout, not motion', () => {
    // The live case on kuinetic.com: `angle:90deg` turns a vertical credit label. Dropping the
    // rotation laid the label out horizontally and overhung its clipping container by 33.7px, so
    // "no rotation" is a broken page here, not a calmer one.
    const { host } = startsUnderReducedMotion(
      '<span data-kui="rotate-static angle:90deg" data-kui-on="load">credit</span>',
    )
    expect(host.style.getPropertyValue('rotate')).toBe('90deg')
  })

  it('stamps the host shorten, not disable, so base.css never applies its rotate:none reset', () => {
    const { host } = startsUnderReducedMotion(
      '<span data-kui="rotate-static angle:8deg, count-up to:250" data-kui-on="load">0</span>',
    )
    expect(host.getAttribute(ATTR.rm)).toBe('shorten')
  })

  /**
   * The merge, asserted directly, in both directions — this is what makes `'shorten'` the *right*
   * neutral value rather than merely a weaker one. It must not constrain a neighbour, and it must
   * not weaken one either: an effect that genuinely needs `'disable'` still gets it.
   */
  it('contributes nothing to the fold, and cannot weaken a neighbour that needs disable', () => {
    const composed = compile(parse('rotate-static angle:8deg, count-up to:250'), registry, 'time')
    expect(composed.warnings).toEqual([])
    expect(composed.reducedMotion).toBe('shorten')
    expect(compile(parse('count-up to:250'), registry, 'time').reducedMotion).toBe('shorten')

    // `float` (catalog/ambient.ts) declares `'disable'` because ambient motion has no meaningful
    // shortened form — a loop clamped to 1ms strobes rather than stopping. That has to survive the
    // fold untouched: `'shorten'` is the identity element, not a bypass.
    const withFloat = compile(parse('rotate-static angle:8deg, float'), registry, 'time')
    expect(withFloat.fxNames).toEqual(['rotate-static', 'float'])
    expect(withFloat.reducedMotion).toBe('disable')
  })

  /**
   * `rm:` is a one-way ratchet (`resolvedPolicy` in `core/compile.ts`): it may only make a policy
   * stricter. That is why the author had no escape from the old `'disable'` — `rm:shorten` warned
   * and kept it — and it is also why the useful direction must still work now.
   */
  it('leaves rm:disable available to an author who does want the tilt dropped', () => {
    const plan = compile(parse('rotate-static angle:8deg rm:disable'), registry, 'time')
    expect(plan.reducedMotion).toBe('disable')
    expect(plan.warnings).toEqual([])
  })
})
