import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detect, resetCapabilities } from '../src/core/capabilities.js'

describe('detect caching', () => {
  beforeEach(() => {
    resetCapabilities()
  })

  it('returns the same cached object on repeated calls', () => {
    expect(detect()).toBe(detect())
  })

  it('recomputes when forced, even with a cache present', () => {
    const first = detect()
    const second = detect(true)
    expect(second).not.toBe(first)
  })

  it('resetCapabilities clears the cache so the next detect() recomputes', () => {
    const first = detect()
    resetCapabilities()
    const second = detect()
    expect(second).not.toBe(first)
  })
})

describe('supports() — probed through detect()', () => {
  beforeEach(() => {
    resetCapabilities()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetCapabilities()
  })

  it('reports every CSS.supports-backed capability as false when CSS is unavailable in this realm', () => {
    vi.stubGlobal('CSS', undefined)
    const caps = detect(true)
    expect(caps.viewTimeline).toBe(false)
    expect(caps.scrollTimeline).toBe(false)
    expect(caps.animationRange).toBe(false)
    expect(caps.individualTransforms).toBe(false)
    expect(caps.scrollTimelineName).toBe(false)
  })

  it('reports false when CSS exists but CSS.supports is not a function', () => {
    vi.stubGlobal('CSS', {})
    const caps = detect(true)
    expect(caps.viewTimeline).toBe(false)
    expect(caps.individualTransforms).toBe(false)
  })

  it('reports false without throwing when CSS.supports itself throws', () => {
    vi.stubGlobal('CSS', {
      supports: () => {
        throw new Error('boom')
      },
    })
    expect(() => detect(true)).not.toThrow()
    const caps = detect(true)
    expect(caps.viewTimeline).toBe(false)
    expect(caps.individualTransforms).toBe(false)
  })

  it('reflects CSS.supports results, including individualTransforms needing both translate and scale', () => {
    vi.stubGlobal('CSS', {
      supports: (property: string) => property === 'animation-timeline' || property === 'translate',
    })
    const caps = detect(true)
    expect(caps.viewTimeline).toBe(true) // animation-timeline: view()
    expect(caps.scrollTimeline).toBe(true) // animation-timeline: scroll()
    expect(caps.animationRange).toBe(false) // animation-range unsupported
    // translate supported but scale is not — the `&&` must short-circuit to false.
    expect(caps.individualTransforms).toBe(false)
  })

  it('detects viewTransitions from document.startViewTransition', () => {
    expect(detect(true).viewTransitions).toBe(false)
    ;(document as unknown as { startViewTransition: () => void }).startViewTransition = () => {}
    try {
      expect(detect(true).viewTransitions).toBe(true)
    } finally {
      delete (document as unknown as { startViewTransition?: () => void }).startViewTransition
    }
  })

  it('reads reducedMotion from matchMedia when available, and fails closed otherwise', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(detect(true).reducedMotion).toBe(false)

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }))
    expect(detect(true).reducedMotion).toBe(true)

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
    expect(detect(true).reducedMotion).toBe(false)
  })
})
