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
  it('runs immediately for a plan with no CSS declarations and no JS effects', () => {
    // Reachable only by calling planStyles directly (not through Animator, which never installs an
    // unresolved plan) — an unknown effect name compiles to an entirely empty plan.
    const result = plan('not-a-real-effect')
    expect(result.gate).toBe('immediate')
    expect(result.activation).toBeNull()
  })


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
    // The default previously lived in a CSS rule keyed on [data-kui-timeline], so an inline
    // `timeline:view` silently got a different animation than the longhand form.
    expect(plan('parallax-y timeline:view').properties['animation-range']).toBe(
      'entry 0% cover 60%',
    )
  })

  it('defaults an unauthored scroll-timeline range to 0%-100%, not the view() named range', () => {
    // `entry`/`cover` are view() progress timeline concepts — a scroll() timeline has no
    // element-relative "entry" phase, only the scroller's own offset. Applying the view()
    // default here made the range resolve as already fully elapsed, so the animation always
    // rendered at its end state regardless of scroll position.
    expect(plan('parallax-y', { timeline: 'scroll' }).properties['animation-range']).toBe(
      '0% 100%',
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

  it('keeps a non-manual authored activation as-is on a degraded timeline', () => {
    // The `manual` -> `enter` fallback only applies when the configured activation is actually
    // `manual`; an explicitly authored non-manual activation is not second-guessed.
    const result = plan('parallax-y on:hover', { timeline: 'view' }, { viewTimeline: false })
    expect(result.gate).toBe('deferred')
    expect(result.activation).toBe('hover')
  })

  it('falls back from an explicitly authored manual activation on a degraded timeline', () => {
    // `resolveConfig` (used directly by this test's `plan()` helper) only ever produces `manual`
    // from explicit authoring — it has no knowledge of a primitive's own default activation, which
    // is applied later, only inside Animator.resolveActivation. `on:manual` is what actually
    // reaches the `config.activation === 'manual'` check this function exists to handle.
    const result = plan('parallax-y on:manual', { timeline: 'view' }, { viewTimeline: false })
    expect(result.gate).toBe('deferred')
    expect(result.activation).toBe('enter')
  })
})

describe('planStyles — timeline unsupported by the effect itself', () => {
  it('does not force a native timeline onto a time-only effect, even when the browser supports one', () => {
    // Regression: compile.ts's warnUnsupportedTimeline only warns, it doesn't change what's
    // compiled — style-plan.ts used to gate solely on browser capability (CAPS here has
    // viewTimeline: true), so a time-only effect asked for `timeline:view` silently got turned
    // into a reversing view-timeline animation despite declaring `supportedTimelines: ['time']`.
    // Fixture is `typewriter` rather than the original `fade-up`, which supports view now.
    const result = plan('typewriter', { timeline: 'view' })
    expect(result.gate).not.toBe('native-timeline')
    expect(result.properties['animation-timeline']).toBeUndefined()
  })

  it('gives an entrance a native timeline when one is asked for', () => {
    // The other half of the same rule: `supportedTimelines` must let an effect through, not just
    // keep it out. Entrances inherited the ['time'] default by omission, so `fade-up
    // timeline:view` left animation-timeline at `auto` and quietly degraded to a one-shot
    // observer — visible to the author only as "it never reverses".
    const result = plan('fade-up', { timeline: 'view' })
    expect(result.gate).toBe('native-timeline')
    expect(result.properties['animation-timeline']).toBe('view()')
  })

  it('still uses the native timeline when the composed effect does support it', () => {
    expect(plan('parallax-y', { timeline: 'view' }).gate).toBe('native-timeline')
  })

  it('applies no native timeline when the composition supports none', () => {
    // Regression: compile.ts could not tell an empty timeline intersection from an
    // uninitialized one, so the third effect here repopulated it with ['scroll', 'view'] after
    // typewriter + parallax-scale had already reduced it to nothing — and view() landed on the
    // time-only effect. Originally written with fade-up, which supports view timelines now.
    const result = plan('typewriter, parallax-scale, scroll-progress-ring', { timeline: 'view' })
    expect(result.attributes['data-kui-fx']).toBe('typewriter parallax-scale scroll-progress-ring')
    expect(result.gate).not.toBe('native-timeline')
    expect(result.properties['animation-timeline']).toBeUndefined()
  })
})

describe('planStyles — individual transform support', () => {
  it('runs immediately, not deferred, when the browser lacks translate/rotate/scale support', () => {
    // Regression: capabilities.ts detects `individualTransforms` but nothing consulted it. A
    // browser without it silently ignores any @keyframes step written in those properties, so a
    // deferred entrance effect built on them (fade-up uses translate) would sit paused — invisible
    // at its from-state — forever, since the animation it's waiting on can never visibly run.
    const result = plan('fade-up', {}, { individualTransforms: false })
    expect(result.gate).toBe('immediate')
  })

  it('still defers effects that do not depend on translate/rotate/scale', () => {
    // blur-in's only channel is filter — fade-up and fade-in share the `reveal` primitive, whose
    // channels include translate even when a particular preset's own distance renders it moot.
    expect(plan('blur-in', {}, { individualTransforms: false }).gate).toBe('deferred')
  })

  it('is unaffected when the browser does support individual transforms', () => {
    expect(plan('fade-up', {}, { individualTransforms: true }).gate).toBe('deferred')
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
    expect(plan('fade-up').attributes['data-kui-rm']).toBe('shorten')
    expect(plan('parallax-y', { timeline: 'view' }).attributes['data-kui-rm']).toBe('disable')
  })
})

describe('planStyles — attributes', () => {
  it('stamps the normalized effect names and ready state', () => {
    const result = plan('slide-up, blur-in')
    expect(result.attributes['data-kui-fx']).toBe('slide-up blur-in')
    expect(result.attributes['data-kui-state']).toBe('ready')
  })
})

describe('planStyles — timeline:pin (scrub)', () => {
  it('holds a pinned scrub paused and binds no activation', () => {
    const result = plan('parallax-rotate from:-180deg angle:0deg timeline:pin')
    expect(result.gate).toBe('scrubbed')
    expect(result.activation).toBeNull()
    expect(result.properties['animation-play-state']).toBe('paused')
  })

  it('applies no native animation-timeline — the seek is the delay, not a timeline', () => {
    const result = plan('parallax-rotate timeline:pin')
    expect(result.properties['animation-timeline']).toBeUndefined()
    expect(result.properties['animation-range']).toBeUndefined()
  })

  it('seeks the animation by progress through a negative delay', () => {
    const result = plan('parallax-rotate timeline:pin')
    expect(result.properties['animation-delay']).toContain('var(--kui-progress, 0)')
    // Negative: progress 1 must land on the animation's final frame, not one duration past it.
    expect(result.properties['animation-delay']).toContain('- var(--kui-progress, 0)')
  })

  it('widens the scrub head by the group stagger span so the last child still completes', () => {
    // Without the `--kui-stagger-count` term a staggered child sits `i * stagger` beyond the head
    // and the last one can never reach 100% — see stagger.ts.
    const result = plan('fade-up timeline:pin')
    expect(result.properties['animation-delay']).toContain('var(--kui-stagger-count, 1)')
  })

  it('leaves a non-pin timeline free of any progress term', () => {
    for (const source of ['fade-up', 'fade-up timeline:view', 'parallax-rotate timeline:scroll']) {
      expect(plan(source).properties['animation-delay']).not.toContain('--kui-progress')
    }
  })

  it('scrubs the driver and the effect it drives when both sit on one element', () => {
    // The composition this whole timeline exists for: the pin publishes progress, the CSS effect
    // consumes it. `pin` must survive compile.ts's supportedTimelines intersection for this.
    const result = plan('pin-section distance:200vh, parallax-rotate from:-180deg timeline:pin')
    expect(result.gate).toBe('scrubbed')
    expect(result.properties['animation-delay']).toContain('var(--kui-progress, 0)')
  })

  it('needs no browser capability — it outlives view() and scroll() support', () => {
    const result = plan('parallax-rotate timeline:pin', {}, {
      viewTimeline: false,
      scrollTimeline: false,
      animationRange: false,
    })
    expect(result.gate).toBe('scrubbed')
    expect(result.properties['animation-play-state']).toBe('paused')
  })
})
