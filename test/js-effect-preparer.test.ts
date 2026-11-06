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
import { catalogRegistry } from './support/registry.js'

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
