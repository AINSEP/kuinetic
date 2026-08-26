import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import type { ActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { Registry } from '../src/core/registry.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { Activation, EffectInstance, Primitive } from '../src/core/types.js'
import { catalogRegistry } from './support/registry.js'

/**
 * Regression tests for the lifecycle defects found in the second external review.
 *
 * Each of these previously passed silently: JS effects started during `prepare`, so no declared
 * activation or reduced-motion policy applied to them, and teardown removed three attributes
 * while leaving every inline property it had written.
 */

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
  metrics: () => ({ scrollTop: 0, scrollLeft: 0, viewportWidth: 800, viewportHeight: 600, viewportTop: 0, viewportLeft: 0 }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

interface Spy {
  activated: number
  destroyed: number
}

/** A JS primitive that records exactly when the animator starts and stops it. */
function spyRegistry(spy: Spy, reducedMotion: Primitive['reducedMotion'] = 'shorten'): Registry {
  const primitive: Primitive = {
    id: 'spy',
    renderer: 'javascript',
    channels: ['spy'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    perfClass: 'continuous',
    reducedMotion,
    prepare(): EffectInstance {
      return {
        activate: () => {
          spy.activated++
        },
        cancel: () => {},
        finish: () => {},
        finished: new Promise<void>(() => {}),
        destroy: () => {
          spy.destroyed++
        },
      }
    },
  }
  return new Registry().registerPrimitive(primitive).registerPresets([
    { name: 'spy-effect', primitive: 'spy' },
  ])
}

interface CapturingBinder extends ActivationBinder {
  bound: Array<{ activation: Activation }>
  fire(): void
}

function capturingBinder(): CapturingBinder {
  const bound: Array<{ activation: Activation }> = []
  let trigger: (() => void) | undefined
  return {
    bound,
    bind(_el, activation, request) {
      bound.push({ activation })
      trigger = () => request.activate()
      return () => {
        trigger = undefined
      }
    },
    fire: () => trigger?.(),
    destroy: () => {},
  }
}

function build(html: string, options: Partial<ConstructorParameters<typeof Animator>[0]> = {}) {
  document.body.innerHTML = html
  return new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    ...options,
  })
}

const el = (): HTMLElement => document.body.querySelector('[data-kui]') as HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('JS effects obey their activation', () => {
  it('does not start a JS effect until its activation fires', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const binder = capturingBinder()
    const animator = build('<div data-kui="spy-effect" data-kui-on="click"></div>', {
      registry: spyRegistry(spy),
      binder,
    })
    animator.start()

    // Previously `prepare()` both wired up AND started, so this was 1 before any interaction.
    expect(spy.activated).toBe(0)
    expect(binder.bound[0]?.activation).toBe('click')

    binder.fire()
    expect(spy.activated).toBe(1)
  })

  it('starts a JS effect immediately for on:load', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="load"></div>', {
      registry: spyRegistry(spy),
    })
    animator.start()
    expect(spy.activated).toBe(1)
  })

  it('never starts a JS effect declared manual', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="manual"></div>', {
      registry: spyRegistry(spy),
      binder: capturingBinder(),
    })
    animator.start()
    expect(spy.activated).toBe(0)
  })

  it('activates only once even if the binding fires repeatedly', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const binder = capturingBinder()
    const animator = build('<div data-kui="spy-effect" data-kui-on="click"></div>', {
      registry: spyRegistry(spy),
      binder,
    })
    animator.start()
    binder.fire()
    binder.fire()
    expect(spy.activated).toBe(1)
  })
})

describe('reduced motion reaches JS effects', () => {
  it("never activates an effect whose policy is 'disable'", () => {
    // A CSS media rule cannot stop JavaScript. Before the instance protocol, `disable` was inert
    // for pinning, FLIP, scrubbing, morphing, and every gesture.
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="load"></div>', {
      registry: spyRegistry(spy, 'disable'),
      capabilities: { ...CAPS, reducedMotion: true },
    })
    animator.start()

    expect(spy.activated).toBe(0)
    expect(el().getAttribute(ATTR.state)).toBe('finished')
  })

  it("still activates an effect whose policy is 'shorten'", () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="load"></div>', {
      registry: spyRegistry(spy, 'shorten'),
      capabilities: { ...CAPS, reducedMotion: true },
    })
    animator.start()
    expect(spy.activated).toBe(1)
  })

  it('honours reducedMotion: ignore', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="load"></div>', {
      registry: spyRegistry(spy, 'disable'),
      capabilities: { ...CAPS, reducedMotion: true },
      reducedMotion: 'ignore',
    })
    animator.start()
    expect(spy.activated).toBe(1)
  })
})

describe('teardown restores what it wrote', () => {
  it('removes custom properties written for the previous effect on recompile', () => {
    const animator = build('<div data-kui="fade-up distance:80px"></div>')
    animator.start()
    expect(el().style.getPropertyValue('--kui-distance')).toBe('80px')

    el().setAttribute(ATTR.source, 'zoom-in')
    animator.process(el())
    expect(el().style.getPropertyValue('--kui-distance')).toBe('')
  })

  it('removes animation declarations on destroy', () => {
    const animator = build('<div data-kui="fade-up"></div>')
    animator.start()
    expect(el().style.getPropertyValue('animation-name')).toBe('kui-in-up')

    animator.destroy()
    expect(el().style.getPropertyValue('animation-name')).toBe('')
    expect(el().style.getPropertyValue('animation-play-state')).toBe('')
  })

  it("restores a consumer's own inline value instead of deleting it", () => {
    document.body.innerHTML = '<div data-kui="fade-up" style="animation-name: mine"></div>'
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
    })
    animator.start()
    animator.destroy()
    expect(el().style.getPropertyValue('animation-name')).toBe('mine')
  })

  it("gives back the author's inline height after the accordion measures its natural size", async () => {
    const animator = build('<div data-kui="accordion-height" style="height: 0px"></div>')
    animator.start()

    el().setAttribute('data-open', 'true')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(el().style.getPropertyValue('height')).toBe('')

    animator.destroy()
    // The measurement clears `height`; untracked, that deleted an authored collapsed state for good.
    expect(el().style.getPropertyValue('height')).toBe('0px')
  })

  it('destroys every JS instance on release', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect"></div>', { registry: spyRegistry(spy) })
    animator.start()
    animator.destroy()
    expect(spy.destroyed).toBe(1)
  })

  it('destroys a live instance even after its diagnostic attribute is removed', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect"></div>', { registry: spyRegistry(spy) })
    animator.start()
    el().removeAttribute(ATTR.normalized)

    animator.destroy()
    expect(spy.destroyed).toBe(1)
  })

  it('runs primitive cleanup before destroying its shared scheduler', () => {
    const events: string[] = []
    const scheduler: ScrollScheduler = {
      ...idleScheduler,
      invalidate: () => events.push('cleanup invalidate'),
      destroy: () => events.push('scheduler destroy'),
    }
    const primitive: Primitive = {
      id: 'cleanup-order',
      renderer: 'javascript',
      channels: ['state'],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: ['load'],
      defaultActivation: 'load',
      perfClass: 'continuous',
      reducedMotion: 'shorten',
      prepare(_el, _params, ctx) {
        return {
          activate: () => {},
          cancel: () => {},
          finish: () => {},
          finished: Promise.resolve(),
          destroy: () => ctx.invalidate(),
        }
      },
    }
    const registry = new Registry().registerPrimitive(primitive).registerPresets([
      { name: 'cleanup-order', primitive: 'cleanup-order' },
    ])
    const animator = build('<div data-kui="cleanup-order"></div>', { registry, scheduler })
    animator.start()

    animator.destroy()
    expect(events).toEqual(['cleanup invalidate', 'scheduler destroy'])
  })
})

describe('configuration identity', () => {
  it('recompiles when only data-kui-on changes', () => {
    // Keying on `data-kui` alone meant a change to activation, timeline, or threshold was
    // ignored permanently — even when process() was called again by hand.
    const spy: Spy = { activated: 0, destroyed: 0 }
    const binder = capturingBinder()
    const animator = build('<div data-kui="spy-effect" data-kui-on="click"></div>', {
      registry: spyRegistry(spy),
      binder,
    })
    animator.start()
    expect(binder.bound.at(-1)?.activation).toBe('click')

    el().setAttribute(ATTR.on, 'focus')
    animator.process(el())
    expect(binder.bound.at(-1)?.activation).toBe('focus')
  })

  it('skips work when nothing in the configuration changed', () => {
    const spy: Spy = { activated: 0, destroyed: 0 }
    const animator = build('<div data-kui="spy-effect" data-kui-on="manual"></div>', {
      registry: spyRegistry(spy),
    })
    animator.start()
    animator.process(el())
    expect(spy.destroyed).toBe(0)
  })
})

describe('createStyleLedger', () => {
  it('removes properties that were not previously set', () => {
    const node = document.createElement('div')
    const ledger = createStyleLedger(node)
    ledger.set('--x', '1px')
    ledger.restore()
    expect(node.style.getPropertyValue('--x')).toBe('')
  })

  it('restores the prior value rather than removing it', () => {
    const node = document.createElement('div')
    node.style.setProperty('--x', 'original')
    const ledger = createStyleLedger(node)
    ledger.set('--x', 'library')
    ledger.restore()
    expect(node.style.getPropertyValue('--x')).toBe('original')
  })

  it('remembers only the first value it replaced, across repeated writes', () => {
    const node = document.createElement('div')
    node.style.setProperty('--x', 'original')
    const ledger = createStyleLedger(node)
    for (const value of ['a', 'b']) ledger.set('--x', value)
    expect(node.style.getPropertyValue('--x')).toBe('b')
    ledger.restore()
    expect(node.style.getPropertyValue('--x')).toBe('original')
  })

  it('can claim a property it has not written yet', () => {
    const node = document.createElement('div')
    const ledger = createStyleLedger(node)
    ledger.claim('--x')
    node.style.setProperty('--x', 'later')
    ledger.restore()
    expect(node.style.getPropertyValue('--x')).toBe('')
  })

  it('reports what it owns', () => {
    const node = document.createElement('div')
    const ledger = createStyleLedger(node)
    ledger.set('--a', '1')
    ledger.set('--b', '2')
    expect(ledger.owned().sort((a, b) => a.localeCompare(b))).toEqual(['--a', '--b'])
  })
})

describe('fail-open cloaking', () => {
  it('uncloaks even when scanning throws', () => {
    document.documentElement.setAttribute(ATTR.cloak, '')
    const animator = build('<div data-kui="fade-up"></div>')
    vi.spyOn(animator, 'process').mockImplementation(() => {
      throw new Error('boom')
    })

    expect(() => animator.start()).toThrow('boom')
    // Uncloaking only on the happy path is not fail-open: a thrown scan would hide the page.
    expect(document.documentElement.hasAttribute(ATTR.cloak)).toBe(false)
  })
})
