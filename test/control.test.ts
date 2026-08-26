/* eslint-disable max-lines --
 * One concern, one test file. `control.ts` owns both the runtime control surface and the lifecycle
 * events it dispatches; these suites lived in two files only because they were written by two
 * hands. Merging them puts this file over the 400-line cap, which is a production-code readability
 * signal — a long source file hides its own structure — whereas a test file is read one `describe`
 * at a time and gains nothing from being cut in half at an arbitrary line. Same argument the
 * `max-lines-per-function` override in `eslint.config.js` already makes for test bodies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { createCssControl, emitLifecycle, KUI_EVENT } from '../src/core/control.js'
import type { LifecycleDetail } from '../src/core/control.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter, silentReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * Runtime control.
 *
 * Two halves, tested separately because they fail differently. `createCssControl` is arithmetic
 * over `Animation` handles — seek clamping, span, progress — and is asserted directly against fake
 * handles, since jsdom implements no Web Animations API at all and would otherwise reduce every
 * one of these to "returns 0". The `control()` handle is policy — which effects it refuses to
 * touch and what it says about them — and is asserted through a real `Animator`.
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

interface FakeAnimation extends Animation {
  animationName: string
}

/**
 * Build the slice of `Animation` this module actually reads.
 *
 * `endTime` is deliberately allowed to be `undefined` — that is what an infinite `@keyframes` loop
 * and a not-yet-resolved effect both look like here, and both must read as "no measurable span".
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function fakeAnimation(options: {
  name?: string
  endTime?: number
  currentTime?: number
  playState?: AnimationPlayState
  reverse?: () => void
}): FakeAnimation {
  const {
    name = 'kui-fake-fade',
    endTime = 600,
    currentTime = 0,
    playState = 'running',
    reverse = vi.fn(),
  } = options
  return {
    animationName: name,
    playState,
    playbackRate: 1,
    currentTime,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ endTime }) },
    cancel: vi.fn(),
    finish: vi.fn(),
    // Real `Animation`s have had this since the API shipped; the fake did without it only because
    // nothing in this file used to reach a code path that plays. `EffectInstance.reverse` does —
    // it sets the rate absolutely and then plays, which is what makes an exit idempotent — and
    // `control().reverse()` now goes that way rather than through `Animation.reverse()`.
    play: vi.fn(),
    reverse,
  } as unknown as FakeAnimation
}

describe('createCssControl playhead arithmetic', () => {
  it('drives pause and resume through the ledger so teardown unwinds them', () => {
    const el = document.createElement('div')
    const ledger = createStyleLedger(el)
    const control = createCssControl(() => [fakeAnimation({})], ledger)

    control.pause()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('paused')
    control.resume()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('running')

    // The whole reason play state is written through the ledger rather than through
    // `Animation.pause()`: a control call must leave nothing behind when the element is released.
    ledger.restore()
    expect(el.hasAttribute('style')).toBe(false)
  })

  it('reverses every owned animation and marks the element running again', () => {
    const el = document.createElement('div')
    const ledger = createStyleLedger(el)
    const reverse = vi.fn()
    const control = createCssControl(() => [fakeAnimation({ reverse })], ledger)

    control.pause()
    control.reverse()
    expect(reverse).toHaveBeenCalledOnce()
    // `reverse()` also plays. Leaving the inline value at `paused` would make the ledger's copy
    // disagree with the browser, and the next `resume()` would then be a no-op write.
    expect(el.style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('survives a reverse() that throws on an unresolved end time', () => {
    // WAAPI raises InvalidStateError reversing an animation with an infinite duration, of which
    // this catalog has many (every ambient loop). One throwing handle must not strand the rest.
    const el = document.createElement('div')
    const second = vi.fn()
    const animations = [
      fakeAnimation({
        reverse: () => {
          throw new Error('InvalidStateError')
        },
      }),
      fakeAnimation({ reverse: second }),
    ]
    const control = createCssControl(() => animations, createStyleLedger(el))

    expect(() => control.reverse()).not.toThrow()
    expect(second).toHaveBeenCalledOnce()
  })

  it('seeks each animation to its own share of the element-wide span', () => {
    const long = fakeAnimation({ endTime: 1000 })
    const short = fakeAnimation({ endTime: 200 })
    const control = createCssControl(
      () => [long, short],
      createStyleLedger(document.createElement('div')),
    )

    control.seek(0.5)
    expect(long.currentTime).toBe(500)
    // Clamped to its own end rather than pushed to 500: a finished 200 ms effect renders the same
    // either way under `fill: both`, but past its end time `playState` reads `finished` early.
    expect(short.currentTime).toBe(200)
  })

  it('clamps progress outside 0..1 instead of refusing it', () => {
    const animation = fakeAnimation({ endTime: 800 })
    const control = createCssControl(
      () => [animation],
      createStyleLedger(document.createElement('div')),
    )

    control.seek(1.4)
    expect(animation.currentTime).toBe(800)
    control.seek(-3)
    expect(animation.currentTime).toBe(0)
  })

  it('ignores a seek when nothing has a measurable span', () => {
    const infinite = fakeAnimation({ endTime: Number.POSITIVE_INFINITY, currentTime: 42 })
    const control = createCssControl(
      () => [infinite],
      createStyleLedger(document.createElement('div')),
    )

    control.seek(0.5)
    expect(infinite.currentTime).toBe(42)
    expect(control.progress).toBe(0)
  })

  it('treats an effect-less animation as unmeasurable rather than throwing', () => {
    const detached = { animationName: 'kui-fake-fade', playState: 'idle', effect: null } as unknown as Animation
    const control = createCssControl(
      () => [detached],
      createStyleLedger(document.createElement('div')),
    )

    expect(control.progress).toBe(0)
    expect(() => control.seek(0.5)).not.toThrow()
  })

  it('swallows a currentTime write the browser refuses', () => {
    const animation = fakeAnimation({ endTime: 600 })
    Object.defineProperty(animation, 'currentTime', {
      get: () => 0,
      set: () => {
        throw new Error('InvalidStateError')
      },
    })
    const control = createCssControl(
      () => [animation],
      createStyleLedger(document.createElement('div')),
    )

    expect(() => control.seek(0.5)).not.toThrow()
  })

  it('reports progress from the furthest-advanced animation over the whole span', () => {
    const long = fakeAnimation({ endTime: 1000, currentTime: 250 })
    const short = fakeAnimation({ endTime: 200, currentTime: 200 })
    const control = createCssControl(
      () => [long, short],
      createStyleLedger(document.createElement('div')),
    )

    expect(control.progress).toBe(0.25)
  })

  it('clamps a reported progress that overruns its span', () => {
    const overrun = fakeAnimation({ endTime: 400, currentTime: 900 })
    const control = createCssControl(
      () => [overrun],
      createStyleLedger(document.createElement('div')),
    )

    expect(control.progress).toBe(1)
  })

  it('sets playbackRate on every owned animation', () => {
    const animations = [fakeAnimation({}), fakeAnimation({})]
    const control = createCssControl(
      () => animations,
      createStyleLedger(document.createElement('div')),
    )

    control.rate(0.25)
    expect(animations.map((a) => a.playbackRate)).toEqual([0.25, 0.25])
  })

  it('merges playback states with the most alive one winning', () => {
    const ledger = createStyleLedger(document.createElement('div'))
    const of = (...states: AnimationPlayState[]) =>
      createCssControl(
        () => states.map((playState) => fakeAnimation({ playState })),
        ledger,
      ).playState

    expect(of()).toBe('idle')
    expect(of('finished', 'running')).toBe('running')
    expect(of('finished', 'paused')).toBe('paused')
    expect(of('finished', 'finished')).toBe('finished')
    // A composed effect where one track has not started yet is not "finished" — an author gating
    // cleanup on that reading would tear down an element still about to move.
    expect(of('finished', 'idle')).toBe('idle')
  })
})

/** A `css-keyframes` preset with no CSS behind it — the compiler only needs the declaration. */
const CSS_PRIMITIVE: Primitive = {
  id: 'fake-css',
  renderer: 'css-keyframes',
  channels: ['opacity'],
  parameters: {},
  supportedTimelines: ['time', 'view'],
  supportedActivations: ['load', 'enter', 'manual'],
  perfClass: 'compositor',
  reducedMotion: 'shorten',
}

/**
 * A JavaScript-rendered effect, which by construction has no playhead to expose.
 *
 * Two of them exist, on separate channels so they compose on one element, because the warning
 * `control()` produces is written in singular or plural depending on how many effects it could not
 * reach — and a message that says "are rendered" about one effect is the kind of wrong that makes
 * an author distrust the rest of the sentence.
 */
function jsPrimitive(id: string): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels: [id],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'manual'],
    perfClass: 'continuous',
    reducedMotion: 'shorten',
    prepare(): EffectInstance {
      return {
        activate: () => {},
        cancel: () => {},
        finish: () => {},
        finished: new Promise<void>(() => {}),
        destroy: () => {},
      }
    },
  }
}

function testRegistry(): Registry {
  return new Registry()
    .registerPrimitive(CSS_PRIMITIVE)
    .registerPrimitive(jsPrimitive('fake-js'))
    .registerPrimitive(jsPrimitive('fake-js-2'))
    .registerPresets([
      { name: 'fake-fade', primitive: 'fake-css' },
      { name: 'fake-drag', primitive: 'fake-js' },
      { name: 'fake-spin', primitive: 'fake-js-2' },
    ])
}

function build(html: string, capabilities: Capabilities = CAPS) {
  document.body.innerHTML = html
  const reporter = collectingReporter()
  const animator = new Animator({
    root: document.body,
    registry: testRegistry(),
    capabilities,
    reporter,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
  animator.start()
  return { animator, reporter }
}

/** Install deterministic animation handles on an element the animator has already compiled. */
function withAnimations(el: Element, animations: Animation[]): void {
  Object.defineProperty(el, 'getAnimations', { value: () => animations, configurable: true })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('control() over a live animator', () => {
  it('pauses, resumes and seeks a CSS-rendered effect', () => {
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    const el = document.getElementById('a')!
    const animation = fakeAnimation({ name: 'kui-fake-fade', endTime: 900 })
    withAnimations(el, [animation])

    const handle = animator.control('#a')
    expect(handle.elements).toEqual([el])
    expect(handle.uncontrolled).toEqual([])

    handle.pause()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('paused')
    handle.seek(1 / 3)
    expect(animation.currentTime).toBe(300)
    expect(handle.progress).toBeCloseTo(1 / 3)
    expect(handle.state).toBe('running')
    handle.timeScale(2)
    expect(animation.playbackRate).toBe(2)
    handle.play()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('can pause a paused element again after it has been reversed', () => {
    // The sequence an author actually hits: pause an element, then let it play out — a
    // `pointerleave` through `deactivate()`, or `control().reverse()`, both of which land on
    // `EffectInstance.reverse` and therefore on `drive()` in `instances.ts`. `drive()` plays, so a
    // ledger left saying `paused` disagrees with the browser, and the *next* `pause()` writes
    // `paused` over `paused` — a value the browser treats as unchanged and therefore ignores. The
    // element stops being pausable at all. Pre-dates the reversal work: the exit half of a paired
    // activation has gone through this call since paired activations shipped.
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    const el = document.getElementById('a')!
    withAnimations(el, [fakeAnimation({ name: 'kui-fake-fade' })])
    const handle = animator.control('#a')

    handle.pause()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('paused')

    handle.reverse()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('running')

    handle.pause()
    expect(el.style.getPropertyValue('animation-play-state')).toBe('paused')
  })

  it('chains every mutator', () => {
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    withAnimations(document.getElementById('a')!, [fakeAnimation({})])
    const handle = animator.control('#a')

    expect(handle.pause().play().reverse().seek(0.5).timeScale(0.5)).toBe(handle)
  })

  it('reports the least advanced element of a selection, so progress 1 means all done', () => {
    const { animator } = build(
      '<div class="x" data-kui="fake-fade" data-kui-on="load"></div>' +
        '<div class="x" data-kui="fake-fade" data-kui-on="load"></div>',
    )
    const [first, second] = [...document.querySelectorAll('.x')]
    withAnimations(first!, [fakeAnimation({ endTime: 1000, currentTime: 1000 })])
    withAnimations(second!, [fakeAnimation({ endTime: 1000, currentTime: 400 })])

    expect(animator.control('.x').progress).toBe(0.4)
  })

  it('names JavaScript-rendered effects it cannot reach instead of silently doing nothing', () => {
    const { animator, reporter } = build('<div id="a" data-kui="fake-drag" data-kui-on="load"></div>')
    const handle = animator.control('#a')

    expect(handle.uncontrolled).toEqual(['fake-drag'])
    expect(reporter.messages.join('\n')).toContain('"fake-drag" is rendered in JavaScript')
    // The calls are still safe to make — an author who ignores the warning gets a no-op, not a
    // crash, and reading progress off something with no playhead honestly reports nothing.
    expect(() => handle.pause().seek(0.5)).not.toThrow()
    expect(handle.progress).toBe(0)
    expect(handle.state).toBe('idle')
  })

  it('names several unreachable effects in the plural', () => {
    const { animator, reporter } = build(
      '<div id="a" data-kui="fake-drag, fake-spin" data-kui-on="load"></div>',
    )
    const handle = animator.control('#a')

    expect(handle.uncontrolled).toEqual(['fake-drag', 'fake-spin'])
    expect(reporter.messages.join('\n')).toContain(
      '"fake-drag fake-spin" are rendered in JavaScript and expose no playhead',
    )
  })

  it('reports a mixed element as partially controllable', () => {
    const { animator, reporter } = build(
      '<div id="a" data-kui="fake-fade, fake-drag" data-kui-on="load"></div>',
    )
    const el = document.getElementById('a')!
    withAnimations(el, [fakeAnimation({ endTime: 400, currentTime: 200 })])
    const handle = animator.control('#a')

    expect(handle.uncontrolled).toEqual(['fake-drag'])
    expect(reporter.messages.join('\n')).toContain('fake-drag')
    // The CSS half is still driven — refusing the whole element because one composed effect has no
    // playhead would be a worse answer than controlling what can be controlled and saying so.
    expect(handle.progress).toBe(0.5)
  })

  it('refuses to touch a scroll-driven element and says why', () => {
    const { animator, reporter } = build(
      '<div id="a" data-kui="fake-fade" data-kui-timeline="view"></div>',
      { ...CAPS, viewTimeline: true },
    )
    const el = document.getElementById('a')!
    const animation = fakeAnimation({})
    withAnimations(el, [animation])
    const handle = animator.control('#a')

    expect(handle.uncontrolled).toEqual(['fake-fade'])
    expect(reporter.messages.join('\n')).toContain('driven by scroll position')
    handle.pause()
    // Untouched — the value is whatever activation left, not the `paused` a control call would
    // have written. This is the case §5.5 says must not break: the paused-plus-negative-delay
    // scrub is driven by `--kui-progress`, and a play-state write from here would hand the
    // animation back to the document timeline to run forward on top of the seek.
    expect(el.style.getPropertyValue('animation-play-state')).not.toBe('paused')
    expect(animation.playbackRate).toBe(1)
  })

  it('warns when asked to control an element with no installed effect', () => {
    const { animator, reporter } = build('<div></div>')
    const orphan = document.createElement('div')

    const handle = animator.control(orphan)
    expect(handle.uncontrolled).toEqual([])
    expect(reporter.messages.join('\n')).toContain('no kUInetic effect is installed')
    expect(handle.progress).toBe(0)
  })

  it('rejects a non-finite seek or timeScale by name rather than writing NaN into the playhead', () => {
    const { animator, reporter } = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    const animation = fakeAnimation({ endTime: 600, currentTime: 120 })
    withAnimations(document.getElementById('a')!, [animation])
    const handle = animator.control('#a')

    handle.seek(Number.NaN)
    handle.timeScale(Number.POSITIVE_INFINITY)
    expect(animation.currentTime).toBe(120)
    expect(animation.playbackRate).toBe(1)
    expect(reporter.messages.join('\n')).toContain('seek() ignored')
    expect(reporter.messages.join('\n')).toContain('timeScale() ignored')
  })
})

/**
 * Lifecycle events.
 *
 * The library dispatched nothing at all before this — `grep -rn "dispatchEvent" src/` returned
 * zero hits — so every assertion here is guarding a contract with no prior art in the codebase to
 * regress against. The ordering cases matter most: an author chaining a second animation off
 * `kui:finish` is relying on it never arriving for something that was cancelled, and never
 * arriving before the `kui:start` it belongs to.
 */

const LIFECYCLE_CSS_PRIMITIVE: Primitive = {
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
function lifecycleJsPrimitive(options: {
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

function buildLifecycle(html: string, options: { registry?: Registry; capabilities?: Capabilities } = {}) {
  document.body.innerHTML = html
  const registry =
    options.registry ??
    new Registry()
      .registerPrimitive(LIFECYCLE_CSS_PRIMITIVE)
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

/** Any well-formed detail; these three cases assert dispatch mechanics, not payload. */
const DETAIL: LifecycleDetail = {
  effects: ['fake-fade'],
  activation: 'load',
  timeline: 'time',
  reason: 'activated',
}

describe('lifecycle events', () => {
  it('dispatches start then finish, bubbling to document with the effect identity', async () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
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
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
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
      .registerPrimitive(LIFECYCLE_CSS_PRIMITIVE)
      .registerPrimitive(lifecycleJsPrimitive({ id: 'fake-js' }))
      .registerPresets([
        { name: 'fake-fade', primitive: 'fake-css' },
        { name: 'fake-drag', primitive: 'fake-js' },
      ])
    buildLifecycle('<div data-kui="fake-fade, fake-drag" data-kui-on="load"></div>', { registry }).start()

    // One element starting once, not one event per composed effect: the animator is the only place
    // that sees all the instances at the same moment, which is why it owns the dispatch.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.detail.effects).toEqual(['fake-fade', 'fake-drag'])
  })

  it('waits for the activation rather than firing at install time', () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
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
        lifecycleJsPrimitive({
          id: 'fake-broken',
          activate: () => {
            throw new Error('bad selector')
          },
        }),
      )
      .registerPresets([{ name: 'fake-broken-fx', primitive: 'fake-broken' }])
    const animator = buildLifecycle('<div id="a" data-kui="fake-broken-fx" data-kui-on="load"></div>', {
      registry,
    })
    animator.start()

    expect(seen).toHaveLength(0)
    expect(document.getElementById('a')?.getAttribute(ATTR.state)).toBe('failed')
  })

  it('never reports a finish for an element whose effects are all continuous', async () => {
    const seen = recordOnDocument()
    const registry = new Registry()
      .registerPrimitive(lifecycleJsPrimitive({ id: 'fake-pin', continuous: true }))
      .registerPresets([{ name: 'fake-pin-fx', primitive: 'fake-pin' }])
    buildLifecycle('<div data-kui="fake-pin-fx" data-kui-on="load"></div>', { registry }).start()

    await tick()
    // A pin keeps an already-resolved `finished` so composition works; reporting that as a finish
    // would say a section that will still be pinned an hour from now had completed.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start])
  })

  it('reports a cancel on teardown and suppresses the finish that would have followed', async () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
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
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
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
    const animator = buildLifecycle('<div id="a"></div>')
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
      .registerPrimitive(lifecycleJsPrimitive({ id: 'fake-parallax', reducedMotion: 'disable' }))
      .registerPresets([{ name: 'fake-parallax-fx', primitive: 'fake-parallax' }])
    buildLifecycle('<div data-kui="fake-parallax-fx" data-kui-on="load"></div>', {
      registry,
      capabilities: { ...CAPS, reducedMotion: true },
    }).start()

    // The one finish with no preceding start, and the reason says so. Silence here would strand
    // every author chaining work off `kui:finish` for exactly the visitors who need the page usable.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.finish])
    expect(seen[0]!.detail.reason).toBe('reduced-motion')
  })

  it('falls back to the global constructor when the element has no owning window', () => {
    // A document parsed without a browsing context (`DOMParser`, an inert template document) has a
    // null `defaultView`, so the per-window constructor this normally prefers — the one that makes
    // `instanceof CustomEvent` hold for listeners inside an iframe — simply is not there.
    const dispatched: Event[] = []
    const orphan = {
      ownerDocument: null,
      dispatchEvent: (event: Event) => dispatched.push(event) > 0,
    }
    emitLifecycle(orphan as unknown as Element, KUI_EVENT.start, DETAIL)
    expect(dispatched[0]?.type).toBe(KUI_EVENT.start)

    const viewless = {
      ownerDocument: { defaultView: null },
      dispatchEvent: (event: Event) => dispatched.push(event) > 0,
    }
    emitLifecycle(viewless as unknown as Element, KUI_EVENT.finish, DETAIL)
    expect(dispatched[1]?.type).toBe(KUI_EVENT.finish)
  })

  it('stays silent rather than throwing where no CustomEvent constructor exists', () => {
    // The SSR and worker case `src/index.ts` promises to survive, and the same `typeof` guard style
    // `capabilities.ts` and `animator.ts` already use: in a DOM-less process the identifier is
    // undeclared, so anything that touches it has to check first.
    vi.stubGlobal('CustomEvent', undefined)
    try {
      const dispatchEvent = vi.fn()
      emitLifecycle({ ownerDocument: null, dispatchEvent } as unknown as Element, KUI_EVENT.cancel, DETAIL)
      expect(dispatchEvent).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('cancelling an element that was never started reports nothing', () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="click"></div>')
    animator.start()

    animator.cancel(document.getElementById('a')!)
    animator.cancel(document.createElement('div'))
    expect(seen).toHaveLength(0)
  })
})

/**
 * The seam between the two features that each modelled "reversal".
 *
 * `control().reverse()` and the exit half of a paired activation move the same `Animation` objects,
 * and for a while only the second of them told the state machine. Nothing on either feature's own
 * branch covered the pair, which is precisely why the gap survived — every test asked one owner
 * about its own behaviour. These ask what the *other* owner believes afterwards, which is the only
 * question that fails when two owners disagree.
 */
describe('control().reverse() and the direction the animator owns', () => {
  /**
   * The `css-keyframes` instance an element installs first — the only directional one this catalog
   * produces, and the object the animator reaches through to reverse anything.
   */
  function directionalInstance(animator: Animator, el: Element): EffectInstance & {
    reverse: () => void
  } {
    return animator.stateOf(el)!.instances[0] as EffectInstance & { reverse: () => void }
  }

  function loadElement(): { animator: Animator; el: Element } {
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    return { animator, el: document.getElementById('a')! }
  }

  it('records the reverse on the animator, not only on the playheads', () => {
    const { animator, el } = loadElement()
    expect(animator.stateOf(el)!.direction).toBe('forward')

    animator.control('#a').reverse()
    expect(animator.stateOf(el)!.direction).toBe('reverse')
  })

  it('does not let a following deactivate start a second reverse', () => {
    const { animator, el } = loadElement()
    const reverse = vi.spyOn(directionalInstance(animator, el), 'reverse')

    animator.control('#a').reverse()
    expect(reverse).toHaveBeenCalledTimes(1)
    animator.deactivate(el)
    expect(reverse).toHaveBeenCalledTimes(1)
  })

  it('treats two programmatic reverses as one exit', () => {
    // The same rule that makes two `pointerleave`s in a row one exit. The old route reached
    // `Animation.reverse()`, which flips whatever the current rate happens to be — so the second
    // call played the element back *in*, which is not what "reverse it again" can plausibly mean.
    const { animator, el } = loadElement()
    const reverse = vi.spyOn(directionalInstance(animator, el), 'reverse')

    expect(animator.control('#a').reverse().reverse()).toBeDefined()
    expect(reverse).toHaveBeenCalledTimes(1)
  })

  it('settles a programmatic reverse at ready rather than finished', async () => {
    const { animator, el } = loadElement()
    await tick()
    expect(el.getAttribute(ATTR.state)).toBe('finished')

    animator.control('#a').reverse()
    expect(el.getAttribute(ATTR.state)).toBe('running')
    await tick()
    // `ready`, because the element really is back where it started. This is also where the stale
    // forward settle used to land, stamping `finished` onto an element sitting at its from-state.
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('refuses an element whose playhead belongs to the scroller', () => {
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-timeline="view"></div>', {
      ...CAPS,
      viewTimeline: true,
    })
    const el = document.getElementById('a')!

    animator.control('#a').reverse()
    // Recording a direction here would be a promise the scrubber breaks on the very next frame:
    // it rewrites the element from `--kui-progress` regardless of which way the animator thinks it
    // is going. `control()` refused this element for `pause` and `seek` already; `reverse` is not
    // the exception that quietly reaches past that refusal into the state machine.
    expect(animator.stateOf(el)!.direction).toBe('forward')
  })

  it('leaves an effect with no playhead alone instead of recording a reverse that cannot happen', () => {
    const { animator } = build('<div id="a" data-kui="fake-drag" data-kui-on="load"></div>')
    const el = document.getElementById('a')!

    animator.control('#a').reverse()
    // Recording `reverse` for a JS-rendered effect would leave the element permanently un-exitable
    // — `deactivate` returns on `direction === 'reverse'` forever — and would route its next
    // activation through `turnAround`, which calls `play()` on an instance that has none.
    expect(animator.stateOf(el)!.direction).toBe('forward')
  })

  it('refuses an element that never started, leaving its first activation intact', () => {
    const { animator } = build('<div id="a" data-kui="fake-fade" data-kui-on="manual"></div>')
    const el = document.getElementById('a')!
    expect(el.getAttribute(ATTR.state)).toBe('ready')

    animator.control('#a').reverse()
    expect(animator.stateOf(el)!.direction).toBeUndefined()
    expect(el.getAttribute(ATTR.state)).toBe('ready')

    // Why refusing matters rather than being merely tidy: had the reverse been recorded, this
    // activation would have gone to `turnAround` and called `play()` on an instance that had never
    // been activated at all — no `kui:start`, and a one-shot binding never spent.
    const activate = vi.spyOn(directionalInstance(animator, el), 'activate')
    animator.activate(el)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(animator.stateOf(el)!.direction).toBe('forward')
  })

  it('dispatches kui:reverse-finish for a settled reverse, and never kui:finish', async () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')!
    await tick()
    seen.length = 0

    animator.control('#a').reverse()
    await tick()

    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.reverseFinish])
    expect(seen[0]!.detail.reason).toBe('reversed')
    expect(seen[0]!.target).toBe(el)
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('still reports a forward run as kui:finish and nothing else', async () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    animator.start()
    await tick()

    // The half of the split that must not regress: an author chaining the next reveal off
    // `kui:finish` is relying on it arriving for an entrance and only for an entrance.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.start, KUI_EVENT.finish])
  })

  it('suppresses kui:reverse-finish for an exit that was cancelled', async () => {
    const seen = recordOnDocument()
    const animator = buildLifecycle('<div id="a" data-kui="fake-fade" data-kui-on="load"></div>')
    animator.start()
    const el = document.getElementById('a')!
    await tick()
    seen.length = 0

    animator.control('#a').reverse()
    animator.cancel(el)
    await tick()

    // The same rule `kui:finish` already follows: an author who stopped an animation must not be
    // told it ran to its end, whichever end it was travelling towards.
    expect(seen.map((event) => event.type)).toEqual([KUI_EVENT.cancel])
  })
})
