import { describe, expect, it } from 'vitest'
import type { Capabilities } from '../src/core/capabilities.js'
import { compile } from '../src/core/compile.js'
import { resolveConfig } from '../src/core/element-config.js'
import type { ElementAttributes } from '../src/core/element-config.js'
import { parse } from '../src/core/parse.js'
import { planStyles } from '../src/core/style-plan.js'
import { createRegistry } from '../src/effects/index.js'

const registry = createRegistry()

const CAPS: Capabilities = {
  viewTimeline: true,
  scrollTimeline: true,
  animationRange: true,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: true,
  intersectionObserver: true,
  reducedMotion: false,
}

function attributes(overrides: Partial<ElementAttributes> = {}): ElementAttributes {
  return { source: '', on: null, timeline: null, threshold: null, ...overrides }
}

function plan(
  source: string,
  attrs: Partial<ElementAttributes> = {},
  caps: Partial<Capabilities> = {},
  respectReducedMotion = true,
) {
  const parsed = parse(source)
  const config = resolveConfig(attributes({ source, ...attrs }), parsed)
  return planStyles({
    plan: compile(parsed, registry, config.timeline),
    config,
    capabilities: { ...CAPS, ...caps },
    respectReducedMotion,
  })
}

describe('planStyles — gates', () => {
  it('defers a time-based reveal and binds its activation', () => {
    const result = plan('fade-up')
    expect(result.gate).toBe('deferred')
    expect(result.activation).toBe('enter')
    expect(result.properties['animation-play-state']).toBe('paused')
  })

  it('runs immediately for on:load and binds nothing', () => {
    const result = plan('fade-up on:load')
    expect(result.gate).toBe('immediate')
    expect(result.activation).toBeNull()
    expect(result.properties['animation-play-state']).toBeUndefined()
  })

  it('uses a native timeline when supported and never pauses', () => {
    const result = plan('parallax-y', { timeline: 'view' })
    expect(result.gate).toBe('native-timeline')
    expect(result.properties['animation-timeline']).toBe('view()')
    expect(result.properties['animation-play-state']).toBeUndefined()
  })

  it('emits scroll() for a scroll timeline', () => {
    expect(plan('parallax-y', { timeline: 'scroll' }).properties['animation-timeline']).toBe(
      'scroll()',
    )
  })

  it('writes the authored animation-range directly', () => {
    expect(plan('parallax-y', { timeline: 'view 10% 90%' }).properties['animation-range']).toBe(
      '10% 90%',
    )
  })

  it('writes a default range even for an inline timeline, which sets no attribute', () => {
    // The default previously lived in a CSS rule keyed on [data-dsg-timeline], so an inline
    // `timeline:view` silently got a different animation than the longhand form.
    expect(plan('parallax-y timeline:view').properties['animation-range']).toBe(
      'entry 0% cover 60%',
    )
  })

  it('omits animation-range when the browser lacks support', () => {
    const result = plan('parallax-y', { timeline: 'view 10% 90%' }, { animationRange: false })
    expect(result.properties['animation-range']).toBeUndefined()
    expect(result.properties['animation-timeline']).toBe('view()')
  })

  it('gates scroll timelines on scroll support, not view support', () => {
    // These ship separately. Gating both on viewTimeline degraded working browsers and emitted
    // view() for a scroll request on browsers that had both.
    const degraded = plan('parallax-y', { timeline: 'scroll' }, { scrollTimeline: false })
    expect(degraded.gate).toBe('deferred')
    const native = plan('parallax-y', { timeline: 'scroll' }, { viewTimeline: false })
    expect(native.properties['animation-timeline']).toBe('scroll()')
  })
})

describe('planStyles — degraded timeline path', () => {
  it('falls back to an observer rather than leaving the element paused forever', () => {
    // parallax declares `manual` activation because a native timeline would drive it. Without
    // that timeline there is nothing to start the animation, so it must degrade to `enter`.
    const result = plan('parallax-y', { timeline: 'view' }, { viewTimeline: false })
    expect(result.gate).toBe('deferred')
    expect(result.activation).toBe('enter')
    expect(result.properties['animation-timeline']).toBeUndefined()
  })
})

describe('planStyles — reduced motion', () => {
  it('never defers when the user prefers reduced motion', () => {
    // A paused animation with fill-mode:both sits at its from-state, i.e. invisible.
    const result = plan('fade-up', {}, { reducedMotion: true })
    expect(result.gate).toBe('immediate')
    expect(result.properties['animation-play-state']).toBeUndefined()
  })

  it('still defers when the preference is explicitly ignored', () => {
    expect(plan('fade-up', {}, { reducedMotion: true }, false).gate).toBe('deferred')
  })

  it('stamps the per-effect policy for the CSS layer', () => {
    expect(plan('fade-up').attributes['data-dsg-rm']).toBe('shorten')
    expect(plan('parallax-y', { timeline: 'view' }).attributes['data-dsg-rm']).toBe('disable')
  })
})

describe('planStyles — attributes', () => {
  it('stamps the normalized effect names and ready state', () => {
    const result = plan('slide-up, blur-in')
    expect(result.attributes['data-dsg-fx']).toBe('slide-up blur-in')
    expect(result.attributes['data-dsg-state']).toBe('ready')
  })
})
