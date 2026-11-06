// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createJsEffectPreparer } from '../src/core/js-effect-preparer.js'
import { collectingReporter } from '../src/core/reporter.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { CompiledPlan } from '../src/core/compile.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry, extendableRegistry } from './support/registry.js'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'

const CAPS = defaultCapabilities({
  individualTransforms: true,
  intersectionObserver: true,
  motionPath: true,
})

const idleScheduler: ScrollScheduler = {
  subscribe: () => () => {},
  invalidate: () => {},
  rootCount: () => 0,
  destroy: () => {},
}

const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({
    scrollTop: 0,
    scrollLeft: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    viewportTop: 0,
    viewportLeft: 0,
  }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

/** A minimal, already-composed plan carrying one JS effect whose `prepare` throws synchronously. */
function planWithThrowingEffect(): CompiledPlan {
  return {
    fxNames: ['broken'],
    vars: {},
    declarations: {},
    keyframeNames: [],
    jsEffects: [
      {
        spec: { name: 'broken', params: {} },
        resolved: {
          preset: { name: 'broken', primitive: 'broken' },
          primitive: {
            id: 'broken',
            renderer: 'javascript',
            channels: [],
            parameters: {},
            supportedTimelines: ['time'],
            supportedActivations: ['load'],
            perfClass: 'compositor',
            reducedMotion: 'disable',
            prepare: () => {
              throw new Error('setup exploded')
            },
          },
        },
      },
    ],
    unknown: [],
    reducedMotion: 'shorten',
    supportedActivations: [],
    activationClaims: [],
    supportedTimelines: [],
    channels: [],
    warnings: [],
  }
}

describe('createJsEffectPreparer', () => {
  it('prepares a CSS tween only for its opted-in toggle variant', () => {
    const reporter = collectingReporter()
    const preparer = createJsEffectPreparer({ scheduler: idleScheduler, rootResolver: () => fakeRoot,
      capabilities: CAPS, reporter, respectReducedMotion: true })
    const el = document.createElement('div')
    const registry = catalogRegistry()
    const plan = compile(parse('tween border-radius:50% toggle:true on:load'), registry, 'time')
    const instances = preparer.prepare({ el, plan, signal: new AbortController().signal, ledger: createStyleLedger(el) })
    expect(instances).toHaveLength(1)
    instances[0]!.activate()
    el.click()
    expect(el.style.borderRadius).toBe('var(--kui-tween-border-radius, 0px)')
    instances[0]!.destroy()
    expect(compile(parse('tween border-radius:50%'), registry, 'time').jsEffects).toEqual([])
  })
  it('isolates a primitive whose prepare() throws, warning instead of propagating', () => {
    const reporter = collectingReporter()
    const preparer = createJsEffectPreparer({
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
      capabilities: CAPS,
      reporter,
      respectReducedMotion: true,
    })
    const el = document.createElement('div')
    const controller = new AbortController()

    const instances = preparer.prepare({
      el,
      plan: planWithThrowingEffect(),
      signal: controller.signal,
      ledger: createStyleLedger(el),
    })

    expect(instances).toEqual([])
    expect(reporter.messages.join()).toContain('"broken" failed to initialise')
    expect(reporter.messages.join()).toContain('setup exploded')
  })
})

describe('resolved timeline reaches JavaScript effects', () => {
  it.each(['timeline-probe timeline:scroll', 'timeline-probe timeline:scroll, fade-up'])('preserves the element-wide scroll gate: %s', source => {
    const reporter = collectingReporter()
    const registry = extendableRegistry()
    let seen: unknown
    registry.registerPrimitive({
      id: 'timeline-probe', renderer: 'javascript', channels: [], parameters: {},
      supportedTimelines: ['time', 'scroll'], supportedActivations: ['load'],
      perfClass: 'compositor', reducedMotion: 'shorten',
      prepare(_el, _params, ctx) {
        seen = ctx.timeline
        return { activate() {}, cancel() {}, finish() {}, destroy() {}, finished: Promise.resolve() }
      },
    }).registerPreset({ name: 'timeline-probe', primitive: 'timeline-probe' })
    document.body.innerHTML = `<div data-kui="${source}"></div>`
    const el = document.body.firstElementChild as HTMLElement
    const animator = new Animator({ root: document.body, registry, reporter,
      capabilities: { ...CAPS, scrollTimeline: true }, scheduler: idleScheduler,
      rootResolver: () => fakeRoot, binder: createActivationBinder({ createObserver: undefined }) })
    animator.start()
    expect(seen).toBe('scroll')
    expect(animator.stateOf(el)!.progressDriven).toBe(true)
    expect(reporter.messages).toEqual([])
    if (source.includes('fade-up')) expect(el.style.getPropertyValue('animation-timeline')).toContain('scroll')
    const handle = animator.control(el)
    handle.play().pause()
    expect(reporter.messages.join()).toContain('driven by scroll position')
    expect(el.style.getPropertyValue('animation-play-state')).not.toBe('paused')
    animator.destroy()
    document.body.replaceChildren()
  })
  it.each(['time', 'scroll', 'view', 'pin'] as const)('passes %s without mixing it into effect parameters', timeline => {
    const reporter = collectingReporter()
    const registry = extendableRegistry()
    let seen: unknown
    let hasTimelineParam = true
    registry.registerPrimitive({
      id: 'timeline-probe', renderer: 'javascript', channels: [], parameters: {},
      supportedTimelines: ['time', 'scroll', 'view', 'pin'], supportedActivations: ['load'],
      perfClass: 'compositor', reducedMotion: 'shorten',
      prepare(_el, params, ctx) {
        seen = ctx.timeline
        hasTimelineParam = params.text('timeline') !== ''
        return { activate() {}, cancel() {}, finish() {}, destroy() {}, finished: Promise.resolve() }
      },
    }).registerPreset({ name: 'timeline-probe', primitive: 'timeline-probe' })
    const plan = compile(parse(`timeline-probe timeline:${timeline}`), registry, timeline)
    const el = document.createElement('div')
    const preparer = createJsEffectPreparer({ scheduler: idleScheduler, rootResolver: () => fakeRoot,
      capabilities: CAPS, reporter, respectReducedMotion: true })
    const instances = preparer.prepare({ el, plan, timeline, signal: new AbortController().signal, ledger: createStyleLedger(el) })
    expect(seen).toBe(timeline)
    expect(hasTimelineParam).toBe(false)
    expect(reporter.messages).toEqual([])
    instances.forEach(instance => instance.destroy())
  })
})
