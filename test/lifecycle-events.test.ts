import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { KUI_EVENT } from '../src/core/events.js'
import type { LifecycleDetail } from '../src/core/events.js'
import { Registry } from '../src/core/registry.js'
import { silentReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * Lifecycle events.
 *
 * The library dispatched nothing at all before this — `grep -rn "dispatchEvent" src/` returned
 * zero hits — so every assertion here is guarding a contract with no prior art in the codebase to
 * regress against. The ordering cases matter most: an author chaining a second animation off
 * `kui:finish` is relying on it never arriving for something that was cancelled, and never
 * arriving before the `kui:start` it belongs to.
 */

const CAPS: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: true,
  scrollTimelineName: false,
  viewTransitions: false,
  intersectionObserver: true,
  reducedMotion: false,
}

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

const CSS_PRIMITIVE: Primitive = {
  id: 'fake-css',
  renderer: 'css-keyframes',
  channels: ['opacity'],
  parameters: {},
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  perfClass: 'compositor',
  reducedMotion: 'shorten',
}

/** A JS primitive whose completion, failure, and endlessness are each controllable from a test. */
function jsPrimitive(options: {
  id: string
  reducedMotion?: Primitive['reducedMotion']
  activate?: () => void
  continuous?: boolean
}): Primitive {
  const { id, reducedMotion = 'shorten', activate = () => {}, continuous = false } = options
  return {
    id,
    renderer: 'javascript',
    channels: [id],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    perfClass: 'continuous',
    reducedMotion,
    prepare(): EffectInstance {
      return {
        activate,
        cancel: () => {},
        finish: () => {},
        finished: continuous ? Promise.resolve() : new Promise<void>(() => {}),
        continuous,
        destroy: () => {},
      }
    },
  }
}

function build(html: string, options: { registry?: Registry; capabilities?: Capabilities } = {}) {
  document.body.innerHTML = html
  const registry =
    options.registry ??
    new Registry()
      .registerPrimitive(CSS_PRIMITIVE)
      .registerPresets([{ name: 'fake-fade', primitive: 'fake-css' }])
  return new Animator({
    root: document.body,
    registry,
    capabilities: options.capabilities ?? CAPS,
    reporter: silentReporter(),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
}

interface Seen {
  type: string
  detail: LifecycleDetail
  target: EventTarget | null
}

/** Record every lifecycle event that reaches `document`, which is the delegation case. */
function recordOnDocument(): Seen[] {
  const seen: Seen[] = []
  for (const type of Object.values(KUI_EVENT)) {
    document.addEventListener(type, (event) => {
      seen.push({
        type: event.type,
        detail: (event as CustomEvent<LifecycleDetail>).detail,
        target: event.target,
      })
    })
  }
  return seen
}

/**
 * Drain the microtask queue past the animator's completion handler.
 *
 * A single `await Promise.resolve()` is not enough: the handler hangs off a `Promise.all` over each
 * instance's own `finished`, which is several microtasks deep. A macrotask turn clears all of them
 * without the test having to know how many.
 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('lifecycle events', () => {
  it('dispatches start then finish, bubbling to document with the effect identity', async () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')

    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start])
    expect(seen[0]!.target).toBe(el)
    expect(seen[0]!.detail).toEqual({
      effects: ['fake-fade'],
      activation: 'load',
      timeline: 'time',
      reason: 'activated',
    })

    await tick()
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start, KUI_EVENT.finish])
    expect(seen[1]!.detail.reason).toBe('complete')
    expect(el?.getAttribute(ATTR.state)).toBe('finished')
  })

  it('dispatches on the animated element itself, so a local listener needs no delegation', () => {
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    const el = document.getElementById('a')!
    const onStart = vi.fn()
    el.addEventListener(KUI_EVENT.start, onStart)

    animator.start()
    expect(onStart).toHaveBeenCalledOnce()
    const event = onStart.mock.calls[0]![0] as CustomEvent<LifecycleDetail>
    // Both flags are what make one listener on `document` — or on a shadow host — work at all.
    expect(event.bubbles).toBe(true)
    expect(event.composed).toBe(true)
  })

  it('carries the composed effect list for an element running more than one effect', () => {
    const seen = recordOnDocument()
    const registry = new Registry()
      .registerPrimitive(CSS_PRIMITIVE)
      .registerPrimitive(jsPrimitive({ id: 'fake-js' }))
      .registerPresets([
        { name: 'fake-fade', primitive: 'fake-css' },
        { name: 'fake-drag', primitive: 'fake-js' },
      ])
    build('<div data-kui="fake-fade, fake-drag" data-kui-on="load"></div>', { registry }).start()

    // One element starting once, not one event per composed effect: the animator is the only place
    // that sees all the instances at the same moment, which is why it owns the dispatch.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.detail.effects).toEqual(['fake-fade', 'fake-drag'])
  })

  it('waits for the activation rather than firing at install time', () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
    animator.start()
    expect(seen).toHaveLength(0)

    document.getElementById('a')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start])
    expect(seen[0]!.detail.activation).toBe('click')
  })

  it('never reports a start for an element whose every instance threw', () => {
    const seen = recordOnDocument()
    const registry = new Registry()
      .registerPrimitive(
        jsPrimitive({
          id: 'fake-broken',
          activate: () => {
            throw new Error('bad selector')
          },
        }),
      )
      .registerPresets([{ name: 'fake-broken-fx', primitive: 'fake-broken' }])
    const animator = build('<div id="a" data-kui="fake-broken-fx" data-kui-on="load"></div>', {
      registry,
    })
    animator.start()

    expect(seen).toHaveLength(0)
    expect(document.getElementById('a')?.getAttribute(ATTR.state)).toBe('failed')
  })

  it('never reports a finish for an element whose effects are all continuous', async () => {
    const seen = recordOnDocument()
    const registry = new Registry()
      .registerPrimitive(jsPrimitive({ id: 'fake-pin', continuous: true }))
      .registerPresets([{ name: 'fake-pin-fx', primitive: 'fake-pin' }])
    build('<div data-kui="fake-pin-fx" data-kui-on="load"></div>', { registry }).start()

    await tick()
    // A pin keeps an already-resolved `finished` so composition works; reporting that as a finish
    // would say a section that will still be pinned an hour from now had completed.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start])
  })

  it('reports a cancel on teardown and suppresses the finish that would have followed', async () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')!
    animator.reset(el)

    await tick()
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start, KUI_EVENT.cancel])
    expect(seen[1]!.detail.reason).toBe('reset')
    // Dispatched after both ledgers unwound, so the listener sees the author's own markup — which
    // is also why the effect names have to be carried on the state rather than re-read here.
    expect(seen[1]!.detail.effects).toEqual(['fake-fade'])
    expect(el.hasAttribute(ATTR.normalized)).toBe(false)
  })

  it('stays quiet when a never-activated element is recompiled', () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
    animator.start()
    const el = document.getElementById('a')!

    el.setAttribute(ATTR.source, 'fake-fade 200ms')
    animator.process(el)
    // Nothing was ever running, so nothing was cancelled. Firing here would put a `kui:cancel` on
    // every `data-kui` edit an author's own code makes.
    expect(seen).toHaveLength(0)
  })

  it('reports a cancel from a play() handle, not a finish', async () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a"></div>')
    animator.start()

    const handle = animator.play('#a', 'fake-fade')
    handle.cancel()
    await tick()

    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start, KUI_EVENT.cancel])
    expect(seen[1]!.detail.reason).toBe('cancelled')
  })

  it('reports a finish with the reduced-motion reason for a disabled effect', () => {
    const seen = recordOnDocument()
    const registry = new Registry()
      .registerPrimitive(jsPrimitive({ id: 'fake-parallax', reducedMotion: 'disable' }))
      .registerPresets([{ name: 'fake-parallax-fx', primitive: 'fake-parallax' }])
    build('<div data-kui="fake-parallax-fx" data-kui-on="load"></div>', {
      registry,
      capabilities: { ...CAPS, reducedMotion: true },
    }).start()

    // The one finish with no preceding start, and the reason says so. Silence here would strand
    // every author chaining work off `kui:finish` for exactly the visitors who need the page usable.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.finish])
    expect(seen[0]!.detail.reason).toBe('reduced-motion')
  })

  it('cancelling an element that was never started reports nothing', () => {
    const seen = recordOnDocument()
    const animator = build('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
    animator.start()

    animator.cancel(document.getElementById('a')!)
    animator.cancel(document.createElement('div'))
    expect(seen).toHaveLength(0)
  })
})
