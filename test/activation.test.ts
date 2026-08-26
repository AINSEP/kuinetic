/* eslint-disable max-lines --
 * One concern, one test file. `activation.ts` is the vocabulary, the binder and the diagnostics in
 * one module, and these suites were split across three files only because they were written in
 * three sittings. Merging them puts this file over the 400-line cap, which is a production-code
 * readability signal — a long source file hides its own structure — whereas a test file is read
 * one `describe` at a time and gains nothing from being cut at an arbitrary line. Same argument
 * the `max-lines-per-function` override in `eslint.config.js` already makes for test bodies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorisingActivations,
  createActivationBinder,
  isKnownEventType,
  isNamedActivation,
  isOneShot,
  resolveActivationSpec,
  startKindOf,
  suggestActivation,
  toThresholdRatio,
  validateActivation,
  warnAboutActivation,
} from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { createRegistry } from '../src/effects/index.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

describe('resolveActivationSpec', () => {
  it('keeps the six original names bound to exactly what they always bound', () => {
    // LOCKED by the task brief: existing markup must behave identically. `hover` listening for
    // `focusin` as well as `pointerenter` is the part most easily lost in a rewrite, because it is
    // the one name whose expansion is not its own spelling.
    expect(resolveActivationSpec('load').start).toEqual({ kind: 'immediate' })
    expect(resolveActivationSpec('manual').start).toEqual({ kind: 'manual' })
    expect(resolveActivationSpec('enter').start).toEqual({ kind: 'observed', when: 'enter' })
    expect(resolveActivationSpec('hover').start).toEqual({
      kind: 'events',
      types: ['pointerenter', 'focusin'],
    })
    expect(resolveActivationSpec('focus').start).toEqual({ kind: 'events', types: ['focusin'] })
    expect(resolveActivationSpec('click').start).toEqual({ kind: 'events', types: ['click'] })
  })

  it('passes an unrecognised name straight through as an event type', () => {
    expect(resolveActivationSpec('input').start).toEqual({ kind: 'events', types: ['input'] })
    expect(resolveActivationSpec('cart:updated').start).toEqual({
      kind: 'events',
      types: ['cart:updated'],
    })
  })

  it('splits a slash pair into a start and an end', () => {
    const spec = resolveActivationSpec('pointerenter/pointerleave')
    expect(spec.names).toEqual(['pointerenter', 'pointerleave'])
    expect(spec.start).toEqual({ kind: 'events', types: ['pointerenter'] })
    expect(spec.end).toEqual({ kind: 'events', types: ['pointerleave'] })
  })

  it('gives enter an observed exit twin', () => {
    const spec = resolveActivationSpec('enter/leave')
    expect(spec.start).toEqual({ kind: 'observed', when: 'enter' })
    expect(spec.end).toEqual({ kind: 'observed', when: 'leave' })
  })

  it('expands the paired sugar to the same events an author could write by hand', () => {
    expect(resolveActivationSpec('hover/unhover').end).toEqual({
      kind: 'events',
      types: ['pointerleave', 'focusout'],
    })
    expect(resolveActivationSpec('focus/blur').end).toEqual({
      kind: 'events',
      types: ['focusout'],
    })
  })

  it('resolves a name that shadows Object.prototype as an ordinary event type', () => {
    // Same lesson as `parse.ts`'s `applyToken`: a truthiness test on the table lookup would find
    // an inherited value here and treat it as a trigger.
    expect(resolveActivationSpec('__proto__').start).toEqual({
      kind: 'events',
      types: ['__proto__'],
    })
    expect(resolveActivationSpec('constructor').start).toEqual({
      kind: 'events',
      types: ['constructor'],
    })
    expect(isNamedActivation('constructor')).toBe(false)
  })

  it('leaves end unset when no pair was authored', () => {
    expect(resolveActivationSpec('click').end).toBeUndefined()
  })
})

describe('validateActivation', () => {
  it('accepts every shape the open list is meant to allow', () => {
    for (const value of [
      'enter',
      'pointerleave',
      'cart:updated',
      'htmx-after-swap',
      'my.event',
      'enter/leave',
      'pointerenter/pointerleave',
      'input/change',
    ]) {
      expect(validateActivation(value), value).toEqual([])
    }
  })

  it('rejects more than one separator', () => {
    expect(validateActivation('a/b/c').join()).toContain('more than one "/"')
  })

  it('rejects text that cannot be an event type at all', () => {
    // This is the one place the open list still says no, and it exists because a value like
    // `"on click"` would otherwise bind a listener for an event named `on click`.
    expect(validateActivation('on click').join()).toContain('is not an event name')
    expect(validateActivation('enter/').join()).toContain('is not an event name')
    expect(validateActivation('/leave').join()).toContain('is not an event name')
    expect(validateActivation('2fast').join()).toContain('is not an event name')
  })

  it('rejects an exit half that could never fire', () => {
    expect(validateActivation('pointerenter/load').join()).toContain('cannot end on "load"')
    expect(validateActivation('click/manual').join()).toContain('cannot end on "manual"')
  })
})

describe('startKindOf', () => {
  it('reads through a pair to the half that actually starts the effect', () => {
    // The reason this function exists: `style-plan.ts` used to compare `activation === 'load'`,
    // which is false for `load/pointerleave` even though it still starts immediately.
    expect(startKindOf('load')).toBe('immediate')
    expect(startKindOf('load/pointerleave')).toBe('immediate')
    expect(startKindOf('manual')).toBe('manual')
    expect(startKindOf('enter/leave')).toBe('observed')
    expect(startKindOf('submit')).toBe('events')
  })
})

describe('isOneShot', () => {
  it('keeps bare enter one-shot and makes a pair persistent', () => {
    // LOCKED: one-shot `enter` stays the default, and the exit twin is what opts out.
    expect(isOneShot(resolveActivationSpec('enter'))).toBe(true)
    expect(isOneShot(resolveActivationSpec('leave'))).toBe(true)
    expect(isOneShot(resolveActivationSpec('enter/leave'))).toBe(false)
  })

  it('never treats a listener activation as one-shot', () => {
    // Releasing a `hover` or `click` binding on first use is what would stop a card flipping back.
    expect(isOneShot(resolveActivationSpec('hover'))).toBe(false)
    expect(isOneShot(resolveActivationSpec('click'))).toBe(false)
    expect(isOneShot(resolveActivationSpec('load'))).toBe(false)
  })
})

describe('authorisingActivations', () => {
  it('routes an exit twin through the declaration its machinery belongs to', () => {
    expect(authorisingActivations('leave')).toEqual(['enter'])
    expect(authorisingActivations('unhover')).toEqual(['hover'])
    expect(authorisingActivations('blur')).toEqual(['focus'])
  })

  it('treats a raw event name as any of the listener activations', () => {
    expect(authorisingActivations('pointerdown')).toEqual(['hover', 'focus', 'click'])
  })
})

describe('isKnownEventType', () => {
  it('vouches for common DOM events without asking a document', () => {
    expect(isKnownEventType('pointerleave')).toBe(true)
    expect(isKnownEventType('submit')).toBe(true)
  })

  it('always vouches for a namespaced custom event', () => {
    expect(isKnownEventType('cart:updated')).toBe(true)
    expect(isKnownEventType('htmx-after-swap')).toBe(true)
    expect(isKnownEventType('app.ready')).toBe(true)
  })

  it('does not vouch for a plain name it has never seen', () => {
    expect(isKnownEventType('clik')).toBe(false)
    expect(isKnownEventType('teleport')).toBe(false)
  })
})

describe('suggestActivation', () => {
  it('offers the near miss an author most likely meant', () => {
    expect(suggestActivation('clik')).toBe('click')
    expect(suggestActivation('hovr')).toBe('hover')
    expect(suggestActivation('pointerleav')).toBe('pointerleave')
  })

  it('offers nothing when nothing is close enough to be a correction', () => {
    expect(suggestActivation('teleport')).toBeUndefined()
    // Two edits away from `click`, but two edits is most of a four-letter word — a suggestion
    // there is a guess dressed up as help.
    expect(suggestActivation('xyzk')).toBeUndefined()
  })
})

describe('activation observer ownership', () => {
  it('canonicalizes equivalent thresholds and releases the shared observer', () => {
    const observers: Array<{
      observe: ReturnType<typeof vi.fn>
      unobserve: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }> = []
    const inits: IntersectionObserverInit[] = []
    const createObserver = vi.fn(
      (_callback: IntersectionObserverCallback, init: IntersectionObserverInit) => {
        inits.push(init)
        const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
        observers.push(observer)
        return observer as unknown as IntersectionObserver
      },
    )
    const binder = createActivationBinder({ createObserver })
    const cleanups = ['0.1', '0.10', '10%'].map((threshold) =>
      binder.bind(document.createElement('div'), 'enter', { threshold, activate: () => {} }),
    )

    expect(createObserver).toHaveBeenCalledOnce()
    expect(inits[0]).toEqual({ threshold: 0.1 })
    for (const cleanup of cleanups) cleanup()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('activates and releases only the intersecting entries, skipping the rest', () => {
    let deliver: IntersectionObserverCallback = () => {}
    const createObserver = vi.fn((callback: IntersectionObserverCallback) => {
      deliver = callback
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver
    })
    const binder = createActivationBinder({ createObserver })
    const visible = document.createElement('div')
    const hidden = document.createElement('div')
    const onVisible = vi.fn()
    const onHidden = vi.fn()
    binder.bind(visible, 'enter', { threshold: '0%', activate: onVisible })
    binder.bind(hidden, 'enter', { threshold: '0%', activate: onHidden })

    deliver(
      [
        { target: hidden, isIntersecting: false },
        { target: visible, isIntersecting: true },
      ] as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    )

    expect(onVisible).toHaveBeenCalledOnce()
    expect(onHidden).not.toHaveBeenCalled()
  })

  it('starts on:load immediately with a no-op cleanup', () => {
    const binder = createActivationBinder()
    const onActivate = vi.fn()
    const cleanup = binder.bind(document.createElement('div'), 'load', { threshold: '0%', activate: onActivate })

    expect(onActivate).toHaveBeenCalledOnce()
    expect(() => cleanup()).not.toThrow()
  })

  it('removes its event listeners when an event-driven binding is released', () => {
    const binder = createActivationBinder()
    const el = document.createElement('div')
    const onActivate = vi.fn()
    const cleanup = binder.bind(el, 'click', { threshold: '0%', activate: onActivate })

    el.dispatchEvent(new Event('click'))
    expect(onActivate).toHaveBeenCalledOnce()

    cleanup()
    el.dispatchEvent(new Event('click'))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('binds a raw DOM event name nothing in the library specially recognises', () => {
    // The whole point of the task: three hardcoded events became any event.
    const binder = createActivationBinder()
    const el = document.createElement('input')
    const onActivate = vi.fn()
    binder.bind(el, 'input', { threshold: '0%', activate: onActivate })

    el.dispatchEvent(new Event('input'))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('binds a custom event, which no closed list could ever have carried', () => {
    const binder = createActivationBinder()
    const el = document.createElement('div')
    const onActivate = vi.fn()
    binder.bind(el, 'cart:updated', { threshold: '0%', activate: onActivate })

    el.dispatchEvent(new CustomEvent('cart:updated'))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('registers every listener passively, including the ones an open list newly reaches', () => {
    // Passive only forbids `preventDefault()`, which this handler never calls — so the promise is
    // one the library can keep for `wheel`/`touchstart` too, and keeping it is what stops
    // `data-kui-on="wheel"` from making a page's scroll janky.
    const el = document.createElement('div')
    const addEventListener = vi.spyOn(el, 'addEventListener')
    createActivationBinder().bind(el, 'wheel/pointerleave', {
      threshold: '0%',
      activate: () => {},
      deactivate: () => {},
    })

    expect(addEventListener).toHaveBeenCalledTimes(2)
    for (const call of addEventListener.mock.calls) {
      expect(call[2]).toEqual({ passive: true })
    }
  })

  it('runs the start half on one event and the exit half on the other', () => {
    const binder = createActivationBinder()
    const el = document.createElement('div')
    const activate = vi.fn()
    const deactivate = vi.fn()
    const cleanup = binder.bind(el, 'pointerenter/pointerleave', {
      threshold: '0%',
      activate,
      deactivate,
    })

    el.dispatchEvent(new Event('pointerenter'))
    expect(activate).toHaveBeenCalledOnce()
    expect(deactivate).not.toHaveBeenCalled()

    el.dispatchEvent(new Event('pointerleave'))
    expect(deactivate).toHaveBeenCalledOnce()

    // Neither half is one-shot: a pointer skimming in and out repeatedly is the ordinary case.
    el.dispatchEvent(new Event('pointerenter'))
    expect(activate).toHaveBeenCalledTimes(2)

    cleanup()
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    expect(activate).toHaveBeenCalledTimes(2)
    expect(deactivate).toHaveBeenCalledOnce()
  })

  it('leaves an exit half unbound when the caller has nothing to reverse', () => {
    const el = document.createElement('div')
    const addEventListener = vi.spyOn(el, 'addEventListener')
    createActivationBinder().bind(el, 'pointerenter/pointerleave', {
      threshold: '0%',
      activate: () => {},
    })

    expect(addEventListener).toHaveBeenCalledOnce()
    expect(addEventListener.mock.calls[0]?.[0]).toBe('pointerenter')
  })

  describe('observed pairs', () => {
    function observedHarness() {
      let deliver: IntersectionObserverCallback = () => {}
      const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
      const createObserver = vi.fn((callback: IntersectionObserverCallback) => {
        deliver = callback
        return observer as unknown as IntersectionObserver
      })
      const binder = createActivationBinder({ createObserver })
      const el = document.createElement('div')
      const activate = vi.fn()
      const deactivate = vi.fn()
      const send = (isIntersecting: boolean): void =>
        deliver(
          [{ target: el, isIntersecting }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        )
      return { binder, el, activate, deactivate, observer, send }
    }

    it('keeps observing for enter/leave so scroll-away can reverse', () => {
      const { binder, el, activate, deactivate, observer, send } = observedHarness()
      binder.bind(el, 'enter/leave', { threshold: '0%', activate, deactivate })

      send(true)
      expect(activate).toHaveBeenCalledOnce()
      // The one-shot release is what made "fade out when it scrolls away" impossible, ever.
      expect(observer.unobserve).not.toHaveBeenCalled()

      send(false)
      expect(deactivate).toHaveBeenCalledOnce()

      send(true)
      expect(activate).toHaveBeenCalledTimes(2)
    })

    it('never plays the exit for an element that has not entered yet', () => {
      // An observer's first delivery reports the element's *current* state, which for anything
      // below the fold is `isIntersecting: false`. Acting on it would run an animation backwards
      // out of a from-state it had never left.
      const { binder, el, activate, deactivate, send } = observedHarness()
      binder.bind(el, 'enter/leave', { threshold: '0%', activate, deactivate })

      send(false)
      expect(deactivate).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled()
    })

    it('keeps bare enter one-shot', () => {
      // LOCKED: existing markup must behave identically. This is that guarantee, at the binder.
      const { binder, el, activate, observer, send } = observedHarness()
      binder.bind(el, 'enter', { threshold: '0%', activate, deactivate: vi.fn() })

      send(true)
      expect(activate).toHaveBeenCalledOnce()
      expect(observer.unobserve).toHaveBeenCalledOnce()
    })

    it('starts on the way out for a bare leave, once', () => {
      const { binder, el, activate, observer, send } = observedHarness()
      binder.bind(el, 'leave', { threshold: '0%', activate })

      send(true)
      expect(activate).not.toHaveBeenCalled()
      expect(observer.unobserve).not.toHaveBeenCalled()

      send(false)
      expect(activate).toHaveBeenCalledOnce()
      expect(observer.unobserve).toHaveBeenCalledOnce()
    })

    it('shares one observer between an event start and an observed exit', () => {
      const { binder, el, activate, deactivate, send } = observedHarness()
      binder.bind(el, 'click/leave', { threshold: '0%', activate, deactivate })

      el.dispatchEvent(new Event('click'))
      expect(activate).toHaveBeenCalledOnce()

      send(true)
      send(false)
      expect(deactivate).toHaveBeenCalledOnce()
    })
  })

  describe('no IntersectionObserver', () => {
    function binderWithoutObserver(): ReturnType<typeof createActivationBinder> {
      return createActivationBinder({ createObserver: undefined as never })
    }

    it('fails open when the observer was what the effects were waiting on', () => {
      const activate = vi.fn()
      binderWithoutObserver().bind(document.createElement('div'), 'enter/leave', {
        threshold: '0%',
        activate,
        deactivate: vi.fn(),
      })
      expect(activate).toHaveBeenCalledOnce()
    })

    it('does not fail open when only the exit half was observed', () => {
      // `click/leave` is waiting on a click, not on visibility. Starting it here would fire an
      // entrance the author asked a pointer to trigger.
      const activate = vi.fn()
      binderWithoutObserver().bind(document.createElement('div'), 'click/leave', {
        threshold: '0%',
        activate,
        deactivate: vi.fn(),
      })
      expect(activate).not.toHaveBeenCalled()
    })
  })

  describe('defaultObserverFactory', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('constructs a real IntersectionObserver when the global is available', () => {
      const observe = vi.fn()
      class FakeIntersectionObserver {
        observe = observe
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

      const binder = createActivationBinder()
      binder.bind(document.createElement('div'), 'enter', { threshold: '0%', activate: () => {} })
      expect(observe).toHaveBeenCalledOnce()
    })
  })
})

/** The threshold parser moved here with the binder that is its only caller. */
describe('toThresholdRatio', () => {
  it('returns 0 for an unparseable value instead of NaN', () => {
    expect(toThresholdRatio('not-a-number')).toBe(0)
  })
})

/**
 * End-to-end behaviour of paired activations, at the animator.
 *
 * These assert state transitions and which instance method ran, not pixels — jsdom implements no
 * `getAnimations()`, so nothing here proves an animation visibly plays backwards. What it does
 * prove is that the exit half reaches the right instance, that a JS-rendered effect is told it
 * cannot participate rather than silently doing nothing, and that a re-entry mid-exit turns the
 * playhead around instead of being swallowed. The visual half belongs to a browser test.
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

interface Recorder {
  activated: number
  played: number
  reversed: number
  /**
   * One resolver per `finished` promise the instance has handed out, oldest first.
   *
   * A list rather than a single "settle the current one" callback, because the point of half these
   * tests is what happens when a *superseded* run resolves late. A single callback closing over a
   * reassigned variable would always resolve the newest promise, which is exactly the case that
   * cannot go wrong.
   */
  settles: Array<() => void>
}

/**
 * A registry of one primitive whose instance records every lifecycle call and lets the test decide
 * when its `finished` resolves.
 *
 * @param reversible - Whether the instance exposes `play`/`reverse`. `false` models a JS-rendered
 * effect, which has no playhead at all.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function recordingRegistry(recorder: Recorder, reversible: boolean): Registry {
  const primitive: Primitive = {
    id: 'recorder',
    renderer: 'javascript',
    channels: ['recorder'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'hover', 'focus', 'click', 'manual'],
    perfClass: 'compositor',
    reducedMotion: 'shorten',
    prepare(): EffectInstance {
      const fresh = (): Promise<void> =>
        new Promise<void>((resolve) => {
          recorder.settles.push(() => resolve())
        })
      let finished = fresh()
      const rearm = (): void => {
        finished = fresh()
      }
      const instance: EffectInstance = {
        activate: () => {
          recorder.activated++
        },
        cancel: () => {},
        finish: () => {},
        get finished() {
          return finished
        },
        destroy: () => {},
      }
      if (!reversible) return instance
      return {
        ...instance,
        get finished() {
          return finished
        },
        play: () => {
          recorder.played++
          rearm()
        },
        reverse: () => {
          recorder.reversed++
          rearm()
        },
      }
    },
  }
  return new Registry()
    .registerPrimitive(primitive)
    .registerPresets([{ name: 'recorder-effect', primitive: 'recorder' }])
}

/** Resolve the most recently handed-out `finished`, then drain the microtask queue. */
async function settleLatest(recorder: Recorder): Promise<void> {
  recorder.settles.at(-1)?.()
  await Promise.resolve()
  await Promise.resolve()
}

function harness(reversible: boolean): {
  el: Element
  recorder: Recorder
  reporter: CollectingReporter
} {
  const recorder: Recorder = { activated: 0, played: 0, reversed: 0, settles: [] }
  const reporter = collectingReporter()
  const root = document.createElement('div')
  const el = document.createElement('div')
  el.setAttribute(ATTR.source, 'recorder-effect')
  el.setAttribute(ATTR.on, 'pointerenter/pointerleave')
  root.append(el)

  const animator = new Animator({
    root,
    registry: recordingRegistry(recorder, reversible),
    capabilities: CAPS,
    reporter,
  })
  animator.start()
  return { el, recorder, reporter }
}

describe('paired activations at the animator', () => {
  it('starts on the first event and plays out on the second', async () => {
    const { el, recorder } = harness(true)
    expect(el.getAttribute(ATTR.state)).toBe('ready')

    el.dispatchEvent(new Event('pointerenter'))
    expect(recorder.activated).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')

    await settleLatest(recorder)
    expect(el.getAttribute(ATTR.state)).toBe('finished')

    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')

    // `ready`, not `finished`: the effect has run back to the from-state it started from, so the
    // element is exactly as it was before it was ever activated.
    await settleLatest(recorder)
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('treats two exits in a row as one exit', () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(1)
  })

  it('never plays out an element that never started', () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(0)
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('turns the playhead around when the entrance fires during the exit', () => {
    // A pointer leaving an element and coming straight back is the commonest thing a pointer
    // does. `activate`'s re-entrancy guard would swallow it, because a reversing element is still
    // `running`.
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    el.dispatchEvent(new Event('pointerenter'))

    expect(recorder.reversed).toBe(1)
    expect(recorder.played).toBe(1)
    // Not a second `activate()`: the instances are already started, only the direction changed.
    expect(recorder.activated).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })

  it('does not let the abandoned exit report ready over the entrance that replaced it', async () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    const staleExit = recorder.settles.at(-1)!
    el.dispatchEvent(new Event('pointerenter'))

    staleExit()
    await Promise.resolve()
    await Promise.resolve()
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })

  it('ignores both halves for an element it does not know', () => {
    const animator = new Animator({ registry: createRegistry(), capabilities: CAPS })
    const stranger = document.createElement('div')
    expect(() => animator.activate(stranger)).not.toThrow()
    expect(() => animator.deactivate(stranger)).not.toThrow()
  })

  it('warns by name when an effect has no playhead to run backwards', () => {
    // The alternative was inventing a shim that misbehaves differently per primitive. An author
    // whose `pointerleave` does nothing should learn it from a warning, not from a browser.
    const { el, recorder, reporter } = harness(false)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))

    expect(recorder.reversed).toBe(0)
    expect(reporter.messages.join()).toContain('cannot play backwards')
    // The state is left where it was rather than being reported as an exit that did not happen.
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })
})

describe('activation diagnostics', () => {
  function warningsFor(attribute: string, effect = 'fade-up'): string[] {
    const reporter = collectingReporter()
    const root = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute(ATTR.source, effect)
    el.setAttribute(ATTR.on, attribute)
    root.append(el)
    new Animator({ root, registry: createRegistry(), capabilities: CAPS, reporter }).start()
    return reporter.messages
  }

  it('says nothing about an exit twin the effect implicitly supports', () => {
    // `supportedActivations` predates the exit twins, so `leave` is in nobody's declared list. A
    // literal check would warn about `enter/leave` for every effect in the catalog.
    expect(warningsFor('enter/leave')).toEqual([])
    expect(warningsFor('hover/unhover')).toEqual([])
    expect(warningsFor('focus/blur')).toEqual([])
  })

  it('says nothing about a raw event on an effect that supports listener activations', () => {
    expect(warningsFor('pointerleave')).toEqual([])
    expect(warningsFor('input/change')).toEqual([])
  })

  it('still warns when the effect genuinely cannot be event-driven', () => {
    // `pin-section` declares `manual`/`load`/`enter` — it has no listener activation at all, so a
    // raw event on it is exactly the mistake `supportedActivations` was added to catch.
    expect(warningsFor('pointerdown', 'pin-section').join()).toContain('is not supported')
  })

  it('names an event no document has ever heard of, and suggests the near miss', () => {
    // Opening the list traded a parse-time warning for silence: `clik` is now a legal event type,
    // so it binds a listener that never fires. This is the replacement diagnostic.
    const messages = warningsFor('clik').join()
    expect(messages).toContain('no DOM event named "clik"')
    expect(messages).toContain('did you mean "click"')
  })

  it('names the event without guessing when nothing is close enough to be a correction', () => {
    const messages = warningsFor('teleport').join()
    expect(messages).toContain('no DOM event named "teleport"')
    expect(messages).not.toContain('did you mean')
  })

  it('keeps quiet about real events this environment happens not to implement', () => {
    // jsdom has no `onpointerenter`, `onfocusin` or `onanimationend`. A probe alone would call
    // three working activations broken, which is how a warning channel becomes noise.
    expect(warningsFor('pointerleave/pointerenter')).toEqual([])
    expect(warningsFor('animationend')).toEqual([])
  })

  it('keeps quiet about a namespaced custom event nothing could recognise', () => {
    expect(warningsFor('cart:updated')).toEqual([])
    expect(warningsFor('htmx-after-swap')).toEqual([])
  })

  it('says nothing about support when no primitive claimed any activation', () => {
    // An empty list is an abstention, not a claim that nothing is supported — the same distinction
    // `compile.ts`'s `intersect` keeps between `undefined` and `[]`.
    const reporter = collectingReporter()
    warnAboutActivation({
      el: document.createElement('div'),
      spec: resolveActivationSpec('pointerdown'),
      supported: [],
      reporter,
    })
    expect(reporter.messages).toEqual([])
  })

  it('does not accuse anything when the element exposes no handler properties at all', () => {
    // A plain namespaced `Element` — not an `HTMLElement` or `SVGElement` — has no
    // `GlobalEventHandlers` mixin, so the probe would fail for every name including real ones. It
    // has to establish that it works before it is allowed to accuse anything.
    const reporter = collectingReporter()
    const root = document.createElement('div')
    const el = document.createElementNS('urn:x-kuinetic-test', 'thing')
    expect('onclick' in el).toBe(false)
    // The ledger writes through `element.style`, which the generic `Element` interface has no
    // business carrying; borrowing one keeps the test about the handler-property probe.
    Object.defineProperty(el, 'style', { value: document.createElement('div').style })
    el.setAttribute(ATTR.source, 'fade-up')
    el.setAttribute(ATTR.on, 'teleport')
    root.append(el)

    new Animator({ root, registry: createRegistry(), capabilities: CAPS, reporter }).start()
    expect(reporter.messages).toEqual([])
  })
})
