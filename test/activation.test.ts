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
      binder.bind(document.createElement('div'), 'enter', threshold, () => {}),
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
    binder.bind(visible, 'enter', '0%', onVisible)
    binder.bind(hidden, 'enter', '0%', onHidden)

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
    const cleanup = binder.bind(document.createElement('div'), 'load', '0%', onActivate)

    expect(onActivate).toHaveBeenCalledOnce()
    expect(() => cleanup()).not.toThrow()
  })

  it('removes its event listeners when an event-driven binding is released', () => {
    const binder = createActivationBinder()
    const el = document.createElement('div')
    const onActivate = vi.fn()
    const cleanup = binder.bind(el, 'click', '0%', onActivate)

    el.dispatchEvent(new Event('click'))
    expect(onActivate).toHaveBeenCalledOnce()

    cleanup()
    el.dispatchEvent(new Event('click'))
    expect(onActivate).toHaveBeenCalledOnce()
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
      binder.bind(document.createElement('div'), 'enter', '0%', () => {})
      expect(observe).toHaveBeenCalledOnce()
    })
  })
})
