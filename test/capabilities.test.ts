import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultCapabilities,
  detect,
  resetCapabilities,
  unsupportedChannelWarnings,
} from '../src/core/capabilities.js'
import type { Capabilities } from '../src/core/capabilities.js'

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
    expect(caps.motionPath).toBe(false)
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

/**
 * The factory exists so that adding a capability field costs one edit rather than one per
 * construction site — `motionPath` cost eleven, and broke three harnesses that had no interest in
 * motion paths at all. Its guarantee is only worth anything if the fill value stays "absent", so
 * that is asserted here rather than left to the doc comment: a future field added to the defaults
 * as `true` would hand every existing harness a capability it was never checked against, silently.
 */
describe('defaultCapabilities', () => {
  it('fills every unstated field with false, so an unstated capability reads as absent', () => {
    const caps = defaultCapabilities()
    expect(Object.values(caps).every((value) => value === false)).toBe(true)
    // Not vacuous: a field added to the interface but forgotten in the defaults would not compile,
    // and one dropped from the defaults would leave this record short.
    expect(Object.keys(caps).length).toBeGreaterThan(0)
  })

  it('takes only the fields the caller has an opinion about and leaves the rest absent', () => {
    const caps = defaultCapabilities({ individualTransforms: true, motionPath: true })
    expect(caps.individualTransforms).toBe(true)
    expect(caps.motionPath).toBe(true)
    expect(caps.viewTimeline).toBe(false)
    expect(caps.reducedMotion).toBe(false)
  })

  it('returns a fresh object each call, so no caller can mutate the shared defaults', () => {
    const first = defaultCapabilities()
    first.viewTimeline = true
    expect(defaultCapabilities().viewTimeline).toBe(false)
  })
})

/**
 * `unsupportedChannelWarnings` is the whole of the degradation story for CSS Motion Path, so it is
 * worth stating what that story is. An `offset-*` effect in a browser with no `offset-path` does
 * not fail, stall, or hide anything: the compiled keyframe still runs, `finished` still resolves,
 * and the element sits exactly where layout put it. There is nothing for `style-plan.ts` to gate
 * differently — which is precisely why a warning is the entire treatment, and why it has to exist.
 * Without it an author gets a motionless element and no explanation anywhere.
 */
describe('unsupportedChannelWarnings', () => {
  const caps = (motionPath: boolean): Capabilities =>
    defaultCapabilities({
      viewTimeline: true,
      scrollTimeline: true,
      animationRange: true,
      individualTransforms: true,
      scrollTimelineName: true,
      viewTransitions: true,
      intersectionObserver: true,
      motionPath,
    })

  it('names the offset channel when the browser cannot render a motion path', () => {
    const warnings = unsupportedChannelWarnings(['offset'], caps(false))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('offset-path')
  })

  it('says nothing when the capability is present', () => {
    expect(unsupportedChannelWarnings(['offset'], caps(false)).length).toBe(1)
    expect(unsupportedChannelWarnings(['offset'], caps(true))).toEqual([])
  })

  it('says nothing about channels with no capability requirement', () => {
    // `translate`/`rotate`/`scale` have a capability of their own but deliberately no entry here:
    // `style-plan.ts` changes the gate for those rather than merely mentioning them.
    expect(unsupportedChannelWarnings(['opacity', 'translate', 'filter'], caps(false))).toEqual([])
  })

  it('is unbothered by an empty channel list', () => {
    expect(unsupportedChannelWarnings([], caps(false))).toEqual([])
  })
})
