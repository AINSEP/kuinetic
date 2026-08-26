import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { createCssControl } from '../src/core/control.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
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

/** A JavaScript-rendered effect, which by construction has no playhead to expose. */
const JS_PRIMITIVE: Primitive = {
  id: 'fake-js',
  renderer: 'javascript',
  channels: ['fake-js'],
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

function testRegistry(): Registry {
  return new Registry()
    .registerPrimitive(CSS_PRIMITIVE)
    .registerPrimitive(JS_PRIMITIVE)
    .registerPresets([
      { name: 'fake-fade', primitive: 'fake-css' },
      { name: 'fake-drag', primitive: 'fake-js' },
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
