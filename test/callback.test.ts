import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { KUI_EVENT } from '../src/core/control.js'
import type { LifecycleDetail } from '../src/core/control.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * `func:` — the no-build spelling of `addEventListener('kui:finish', fn)`.
 *
 * The contract these guard is narrow on purpose: `func:` is *the finish listener*, registered as an
 * ordinary DOM listener rather than called from a dispatch site, so the cases that matter are the
 * ones where "an ordinary listener" and "what an author expected" come apart — a bubbling child's
 * completion, a name that resolves to something inherited rather than something the page declared,
 * and a function defined by a script that runs after the library has already scanned.
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

/** A JS primitive that never settles, so `kui:finish` can be ruled out rather than merely awaited. */
function disabledPrimitive(): Primitive {
  return {
    id: 'fake-parallax',
    renderer: 'javascript',
    channels: ['fake-parallax'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare(): EffectInstance {
      return {
        activate: () => {},
        cancel: () => {},
        finish: () => {},
        finished: new Promise<void>(() => {}),
        continuous: false,
        destroy: () => {},
      }
    },
  }
}

function build(
  html: string,
  options: { registry?: Registry; capabilities?: Capabilities } = {},
): { animator: Animator; reporter: ReturnType<typeof collectingReporter> } {
  document.body.innerHTML = html
  const reporter = collectingReporter()
  const registry =
    options.registry ??
    new Registry()
      .registerPrimitive(CSS_PRIMITIVE)
      .registerPresets([{ name: 'fake-fade', primitive: 'fake-css' }])
  const animator = new Animator({
    root: document.body,
    registry,
    capabilities: options.capabilities ?? CAPS,
    reporter,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
  return { animator, reporter }
}

/** Drain past the animator's completion handler, which hangs several microtasks off a `Promise.all`. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('func: — a named global as the finish callback', () => {
  it('calls the named global once the element finishes, with the element as `this`', async () => {
    const calls: { self: unknown; event: Event }[] = []
    vi.stubGlobal('onReveal', function (this: unknown, event: Event) {
      calls.push({ self: this, event })
    })
    const { animator } = build('<div id="a" data-kui="fake-fade func:onReveal" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')!

    // Nothing on start — `func:` is sugar for `kui:finish`, not for "any lifecycle moment". An
    // author who wanted the start has `addEventListener`, which the docs point at first.
    expect(calls).toHaveLength(0)

    await tick()
    expect(calls).toHaveLength(1)
    // The same two things a hand-written listener gets, so moving the function between the two
    // spellings is a copy-paste rather than a rewrite.
    expect(calls[0]!.self).toBe(el)
    expect(calls[0]!.event.type).toBe(KUI_EVENT.finish)
    expect((calls[0]!.event as CustomEvent<LifecycleDetail>).detail.effects).toEqual(['fake-fade'])
  })

  it('resolves the name at fire time, so a script that runs after the scan still works', async () => {
    const onReveal = vi.fn()
    const { animator } = build('<div data-kui="fake-fade func:onReveal" data-kui-on="load"></div>')
    animator.start()
    // The no-build case this timing exists for: the library scanned on load, and the page's own
    // `<script>` block defines its functions afterwards. Resolving eagerly would have rejected this
    // with a warning that was wrong by the time it printed.
    vi.stubGlobal('onReveal', onReveal)

    await tick()
    expect(onReveal).toHaveBeenCalledOnce()
  })

  it('warns naming the value, and does not throw, when the name resolves to nothing', async () => {
    const { animator, reporter } = build(
      '<div data-kui="fake-fade func:typoed" data-kui-on="load"></div>',
    )
    animator.start()
    await tick()

    const messages = reporter.messages.join('\n')
    expect(messages).toContain('func:typoed')
    // The warning has to say *why* a function the author can see in their own file was not found:
    // `const`/`let` and module scripts never put anything on `window`, which is the commonest way
    // this fails for exactly the no-build audience the key exists for.
    expect(messages).toContain('window.typoed')
  })

  it('refuses a name that only resolves through Object.prototype', async () => {
    const { animator, reporter } = build(
      '<div data-kui="fake-fade func:valueOf" data-kui-on="load"></div>',
    )
    animator.start()
    await tick()

    // A plain `window[name]` read answers `valueOf`, `constructor` and `toString` with inherited
    // functions that no page ever put there — `typeof` says 'function' and calling one would run
    // something nobody declared. The own-property check is what makes this a miss instead.
    expect(reporter.messages.join('\n')).toContain('func:valueOf')
  })

  it('refuses a global that is not callable rather than throwing on it', async () => {
    vi.stubGlobal('notAFunction', { nope: true })
    const { animator, reporter } = build(
      '<div data-kui="fake-fade func:notAFunction" data-kui-on="load"></div>',
    )
    animator.start()
    await tick()

    expect(reporter.messages.join('\n')).toContain('func:notAFunction')
  })

  it('ignores a descendant\'s completion bubbling up to a parent that declared func:', async () => {
    const onReveal = vi.fn()
    vi.stubGlobal('onReveal', onReveal)
    const { animator } = build(
      '<div id="group" data-kui="fake-fade func:onReveal" data-kui-on="load">' +
        '<div class="child" data-kui="fake-fade" data-kui-on="load"></div>' +
        '<div class="child" data-kui="fake-fade" data-kui-on="load"></div>' +
        '</div>',
    )
    animator.start()
    await tick()

    // Lifecycle events bubble by design, so the parent's listener sees all three finishes. Without
    // the target check the author's function would run once per child and never once for the group —
    // neither what they wrote nor anything they could debug from the outside.
    expect(onReveal).toHaveBeenCalledOnce()
    expect((onReveal.mock.calls[0]![0] as Event).target).toBe(document.getElementById('group'))
  })

  it('still runs for a visitor who asked for reduced motion', () => {
    const onReveal = vi.fn()
    vi.stubGlobal('onReveal', onReveal)
    const registry = new Registry()
      .registerPrimitive(disabledPrimitive())
      .registerPresets([{ name: 'fake-parallax-fx', primitive: 'fake-parallax' }])
    const { animator } = build(
      '<div data-kui="fake-parallax-fx func:onReveal" data-kui-on="load"></div>',
      { registry, capabilities: { ...CAPS, reducedMotion: true } },
    )
    animator.start()

    // The one `kui:finish` that arrives during install, synchronously, with no preceding start.
    // The listener is registered before the gate opens precisely so this is not the case that
    // silently drops the author's chained step for the visitors who most need the page usable.
    expect(onReveal).toHaveBeenCalledOnce()
    expect((onReveal.mock.calls[0]![0] as CustomEvent<LifecycleDetail>).detail.reason).toBe(
      'reduced-motion',
    )
  })

  it('does not run on cancel, and detaches with the rest of the instance on teardown', async () => {
    const onReveal = vi.fn()
    vi.stubGlobal('onReveal', onReveal)
    const { animator } = build('<div id="a" data-kui="fake-fade func:onReveal" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')!
    animator.reset(el)
    await tick()

    expect(onReveal).not.toHaveBeenCalled()
    // The listener is removed by `controller.abort()` along with every other binding, so a stray
    // `kui:finish` dispatched at the element afterwards reaches nothing.
    el.dispatchEvent(new CustomEvent(KUI_EVENT.finish, { detail: {}, bubbles: true }))
    expect(onReveal).not.toHaveBeenCalled()
  })
})
