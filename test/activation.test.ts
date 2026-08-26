import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'

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
