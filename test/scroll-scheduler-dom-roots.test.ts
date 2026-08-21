import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRootResolver, elementScrollRoot, windowScrollRoot } from '../src/core/scroll-scheduler.js'

/**
 * Real-DOM-root coverage split out of scroll-scheduler.test.ts (which stays focused on the
 * scheduler itself, asserted through injected fakes) to keep both files under the line cap.
 * These exercise `windowScrollRoot`/`elementScrollRoot`/`createRootResolver`'s default
 * scrollability test against actual DOM elements and listeners rather than fakes.
 */

describe('windowScrollRoot', () => {
  it('reads scroll and viewport metrics off the given window', () => {
    const win = {
      scrollX: 10,
      scrollY: 20,
      innerWidth: 800,
      innerHeight: 600,
    } as unknown as Window
    const root = windowScrollRoot(win)
    expect(root.key).toBe('window')
    expect(root.metrics()).toEqual({
      scrollTop: 20,
      scrollLeft: 10,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportTop: 0,
      viewportLeft: 0,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** The page root reads the document off the window it was handed, so the fake has to carry one. */
  const fakeWindow = (
    addEventListener = vi.fn(),
    removeEventListener = vi.fn(),
  ): Window =>
    ({
      addEventListener,
      removeEventListener,
      document: { documentElement: document.documentElement },
    }) as unknown as Window

  it('attaches and detaches real scroll and resize listeners', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const root = windowScrollRoot(fakeWindow(addEventListener, removeEventListener))

    const stopScroll = root.onScroll(() => {})
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    stopScroll()
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))

    const stopResize = root.onResize(() => {})
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true })
    stopResize()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  // A window `resize` event is not the only thing that moves page content. Lazy images loading and
  // fonts swapping change the document's height with no resize event at all, and every content
  // offset `trackProgress` caches is measured against that height — so without this the page root
  // was the one scroller whose cached geometry could silently go stale and never be corrected.
  // `elementScrollRoot` has observed its element's box for exactly this reason since it was written.
  it('observes the document element, so lazy content growth invalidates cached geometry', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    class FakeResizeObserver {
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const stop = windowScrollRoot(fakeWindow()).onResize(() => {})
    expect(observe).toHaveBeenCalledWith(document.documentElement)

    stop()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('falls back to window-resize only when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const root = windowScrollRoot(fakeWindow(addEventListener, removeEventListener))

    const stop = root.onResize(() => {})
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true })
    expect(() => stop()).not.toThrow()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})

describe('elementScrollRoot', () => {
  it('reads element-relative scroll and viewport metrics', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollTop', { value: 15, configurable: true })
    Object.defineProperty(el, 'scrollLeft', { value: 5, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true })
    el.getBoundingClientRect = () =>
      ({ top: 40, left: 10, width: 300, height: 200, bottom: 240, right: 310 }) as DOMRect

    const root = elementScrollRoot(el, window)
    expect(root.key).toMatch(/^el:/)
    expect(root.metrics()).toEqual({
      scrollTop: 15,
      scrollLeft: 5,
      viewportWidth: 300,
      viewportHeight: 200,
      viewportTop: 40,
      viewportLeft: 10,
    })
  })

  it('attaches a real scroll listener directly on the element', () => {
    const el = document.createElement('div')
    const addEventListener = vi.spyOn(el, 'addEventListener')
    const removeEventListener = vi.spyOn(el, 'removeEventListener')
    const root = elementScrollRoot(el, window)

    const stop = root.onScroll(() => {})
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    stop()
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  describe('onResize (observeSize)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('observes the element with a real ResizeObserver and also tracks window resize', () => {
      const observe = vi.fn()
      const disconnect = vi.fn()
      class FakeResizeObserver {
        observe = observe
        disconnect = disconnect
        unobserve = vi.fn()
      }
      vi.stubGlobal('ResizeObserver', FakeResizeObserver)

      const el = document.createElement('div')
      const winAddEventListener = vi.fn()
      const winRemoveEventListener = vi.fn()
      const win = {
        addEventListener: winAddEventListener,
        removeEventListener: winRemoveEventListener,
      } as unknown as Window
      const root = elementScrollRoot(el, win)

      const stop = root.onResize(() => {})
      expect(winAddEventListener).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true })
      expect(observe).toHaveBeenCalledWith(el)

      stop()
      expect(winRemoveEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
      expect(disconnect).toHaveBeenCalledOnce()
    })

    it('falls back to window-resize only when ResizeObserver is unavailable', () => {
      vi.stubGlobal('ResizeObserver', undefined)
      const el = document.createElement('div')
      const winAddEventListener = vi.fn()
      const winRemoveEventListener = vi.fn()
      const win = {
        addEventListener: winAddEventListener,
        removeEventListener: winRemoveEventListener,
      } as unknown as Window
      const root = elementScrollRoot(el, win)

      const stop = root.onResize(() => {})
      expect(winAddEventListener).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true })
      expect(() => stop()).not.toThrow()
      expect(winRemoveEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    })
  })
})

describe('createRootResolver — default scrollability test', () => {
  it('treats an auto-overflow element whose content actually overflows as scrollable', () => {
    document.body.innerHTML = '<div id="scroller"><p id="target"></p></div>'
    const scroller = document.getElementById('scroller')!
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })

    const resolve = createRootResolver({ win: window })
    expect(resolve(document.getElementById('target')!).key).toMatch(/^el:/)
  })

  it('does not treat an overflow:auto element as scrollable when its content actually fits', () => {
    document.body.innerHTML = '<div id="scroller"><p id="target"></p></div>'
    const scroller = document.getElementById('scroller')!
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 100, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true })

    const resolve = createRootResolver({ win: window })
    expect(resolve(document.getElementById('target')!).key).toBe('window')
  })

  it('treats horizontal overflow the same way as vertical', () => {
    document.body.innerHTML = '<div id="scroller"><p id="target"></p></div>'
    const scroller = document.getElementById('scroller')!
    scroller.style.overflowX = 'scroll'
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true })

    const resolve = createRootResolver({ win: window })
    expect(resolve(document.getElementById('target')!).key).toMatch(/^el:/)
  })
})
