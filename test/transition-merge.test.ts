// The compile-time transition merge — `Preset.transitions`, `declarations.ts`'s `pushTransitions`, and
// the one `--kui-transition` custom property `base.css`'s `:where([data-kui-fx])` rule consumes.
//
// Before this merge, two presets that both own a bare host-rule `transition:` in the stylesheet
// could not compose even when their declared channels were disjoint: a `transition:` shorthand
// resets every longhand it covers, so whichever rule was later in source order won the entire
// property list. `data-kui="lift, border-glow"` is the motivating case — `['translate']` vs
// `['shadow']`, genuinely disjoint — and compiled `transition-property: box-shadow` only, so `lift`
// snapped to its hovered position instead of easing into it. These tests assert the merge directly
// against `compile()`'s pure output, which is what lets the fix be proven without a browser.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { inertInstance } from '../src/core/types.js'
import type { Primitive } from '../src/core/types.js'
import { catalogRegistry, extendableRegistry } from './support/registry.js'

const registry = catalogRegistry()

function run(source: string) {
  return compile(parse(source), registry, 'time')
}

describe('transition merge — real catalog presets', () => {
  it('merges two disjoint-channel presets into one --kui-transition list instead of one clobbering the other', () => {
    const plan = run('lift, border-glow')
    expect(plan.warnings).toEqual([])
    expect(plan.transition).toBe(
      'translate var(--kui-lift-duration, 600ms) var(--kui-lift-ease, ease-out) ' +
        'var(--kui-tx-delay-lift, 0ms), ' +
        'box-shadow var(--kui-border-glow-duration, 600ms) var(--kui-border-glow-ease, ease-out) ' +
        'var(--kui-tx-delay-border-glow, 0ms)',
    )
  })

  it('is absent for a preset that declares no transitions, so base.css\'s var() fails closed', () => {
    expect(run('fade-up').transition).toBeUndefined()
  })

  it('carries a preset with more than one transitioned property in declaration order', () => {
    expect(run('lift-shadow').transition).toBe(
      'translate var(--kui-lift-shadow-duration, 600ms) var(--kui-lift-shadow-ease, ease-out) ' +
        'var(--kui-tx-delay-lift-shadow, 0ms), ' +
        'box-shadow var(--kui-lift-shadow-duration, 600ms) var(--kui-lift-shadow-ease, ease-out) ' +
        'var(--kui-tx-delay-lift-shadow, 0ms)',
    )
  })

  it('carries a custom property segment (border-draw), not just physical CSS properties', () => {
    expect(run('border-draw').transition).toBe(
      '--kui-border-pct var(--kui-border-draw-duration, 600ms) var(--kui-border-draw-ease, ease-out) ' +
        'var(--kui-tx-delay-border-draw, 0ms)',
    )
  })

  it('honours an authored positional duration, the same var-or-literal precedence pushTrack gives a compiled animation', () => {
    expect(run('lift 400ms').transition).toBe(
      'translate 400ms var(--kui-lift-ease, ease-out) var(--kui-tx-delay-lift, 0ms)',
    )
  })

  it('pins header-shrink at its literal 200ms/ease-out regardless of an authored duration, matching the static CSS it replaces', () => {
    expect(run('header-shrink 999ms').transition).toBe(
      'padding-block 200ms ease-out var(--kui-tx-delay-header-shrink, 0ms), ' +
        'font-size 200ms ease-out var(--kui-tx-delay-header-shrink, 0ms), ' +
        'box-shadow 200ms ease-out var(--kui-tx-delay-header-shrink, 0ms)',
    )
  })

  it('is per-preset, not per-primitive: plus-to-minus transitions its host box, hamburger-to-x (same icon-toggle primitive) does not', () => {
    expect(run('plus-to-minus').transition).toBe(
      'rotate var(--kui-icon-toggle-duration, 600ms) var(--kui-icon-toggle-ease, ease-out) ' +
        'var(--kui-tx-delay-plus-to-minus, 0ms)',
    )
    expect(run('hamburger-to-x').transition).toBeUndefined()
  })
})

describe('transition merge — duplicate-property composition', () => {
  /** A minimal `javascript` primitive good enough to register and compose, with no real motion. */
  function synthetic(id: string, channel: string): Primitive {
    return {
      id,
      renderer: 'javascript',
      channels: [channel],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: ['load'],
      perfClass: 'paint',
      reducedMotion: 'shorten',
      prepare: () => inertInstance(),
    }
  }

  it('lets two disjoint-channel presets each transition the same property — CSS resolves it, so the compiler warns rather than refuses', () => {
    const local = extendableRegistry()
    local.registerPrimitive(synthetic('synthetic-a', 'synthetic-channel-a'))
    local.registerPreset({
      name: 'synthetic-a',
      primitive: 'synthetic-a',
      transitions: [{ property: 'opacity', duration: '100ms', easing: 'linear' }],
    })
    local.registerPrimitive(synthetic('synthetic-b', 'synthetic-channel-b'))
    local.registerPreset({
      name: 'synthetic-b',
      primitive: 'synthetic-b',
      transitions: [{ property: 'opacity', duration: '200ms', easing: 'ease' }],
    })

    const plan = compile(parse('synthetic-a, synthetic-b'), local, 'time')

    // Disjoint channels — the pair composes, it is not refused as a conflict.
    expect(plan.warnings.some((message) => message.includes('cannot compose'))).toBe(false)
    // Neither segment is dropped: the emitted value names both, in authored order, which is what
    // lets CSS's own last-wins rule over the merged shorthand decide the outcome.
    expect(plan.transition).toBe(
      'opacity 100ms linear var(--kui-tx-delay-synthetic-a, 0ms), ' +
        'opacity 200ms ease var(--kui-tx-delay-synthetic-b, 0ms)',
    )
    expect(plan.warnings).toContain(
      '"synthetic-a" and "synthetic-b" both transition opacity — "synthetic-b" wins (last in the list)',
    )
  })

  it('does not warn about itself when one preset declares the same property only once', () => {
    const local = extendableRegistry()
    local.registerPrimitive(synthetic('synthetic-solo', 'synthetic-channel-solo'))
    local.registerPreset({
      name: 'synthetic-solo',
      primitive: 'synthetic-solo',
      transitions: [{ property: 'opacity' }],
    })

    const plan = compile(parse('synthetic-solo'), local, 'time')
    expect(plan.warnings).toEqual([])
  })
})

describe('registerPreset refuses a transition that would swallow the merged list', () => {
  function registerGreedy(property: string) {
    const local = extendableRegistry()
    local.registerPrimitive({
      id: 'greedy',
      renderer: 'javascript',
      channels: ['synthetic-greedy'],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: ['load'],
      perfClass: 'paint',
      reducedMotion: 'shorten',
      prepare: () => inertInstance(),
    })
    return () =>
      local.registerPreset({
        name: 'greedy',
        primitive: 'greedy',
        transitions: [{ property }],
      })
  }

  it('throws for "all"', () => {
    expect(registerGreedy('all')).toThrow(/would swallow every other preset's segment/)
  })

  it('throws for "none"', () => {
    expect(registerGreedy('none')).toThrow(/would swallow every other preset's segment/)
  })
})
