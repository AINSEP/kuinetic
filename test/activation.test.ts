import { describe, expect, it, vi } from 'vitest'
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
})
