import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { createRegistry } from '../src/effects/index.js'

let registry: Registry

beforeEach(() => {
  registry = createRegistry()
})

function run(source: string, timeline: 'time' | 'view' | 'scroll' = 'time') {
  return compile(parse(source), registry, timeline)
}

describe('compile — single effect', () => {
  it('stamps the resolved effect name', () => {
    expect(run('fade-up').fxNames).toEqual(['fade-up'])
  })

  it('emits the preset keyframes, not the preset name', () => {
    // slide-up and fade-up share one keyframe block; only their defaults differ.
    expect(run('slide-up').declarations['animation-name']).toBe('dsg-in-up')
    expect(run('fade-up').declarations['animation-name']).toBe('dsg-in-up')
  })

  it('carries preset defaults into custom properties', () => {
    expect(run('slide-up').vars).toMatchObject({ '--dsg-distance': '100px' })
  })

  it('lets an author override a preset default', () => {
    expect(run('slide-up distance:40px').vars['--dsg-distance']).toBe('40px')
  })

  it('uses a var() fallback when no duration is given, so CSS can supply it', () => {
    expect(run('fade-up').declarations['animation-duration']).toBe('var(--dsg-duration, 600ms)')
  })

  it('uses the positional duration when given', () => {
    expect(run('fade-up 800ms').declarations['animation-duration']).toBe('800ms')
  })

  it('folds stagger into the delay so the browser does the arithmetic', () => {
    expect(run('fade-up').declarations['animation-delay']).toBe(
      'calc(var(--dsg-delay, 0ms) + var(--dsg-i, 0) * var(--dsg-stagger, 0ms))',
    )
  })

  it('resolves a named curve to its custom property', () => {
    expect(run('fade-up expo-out').declarations['animation-timing-function']).toBe(
      'var(--dsg-ease-expo-out, ease-out)',
    )
  })

  it('passes a native easing keyword through unchanged', () => {
    expect(run('fade-up ease-in-out').declarations['animation-timing-function']).toBe('ease-in-out')
  })

  it('sets fill-mode both so the from-state holds before activation', () => {
    expect(run('fade-up').declarations['animation-fill-mode']).toBe('both')
  })
})

describe('compile — unknown effects', () => {
  it('reports the name as unknown and stamps nothing', () => {
    const plan = run('flibbertigibbet')
    expect(plan.fxNames).toEqual([])
    expect(plan.unknown).toEqual(['flibbertigibbet'])
  })

  it('suggests a near match', () => {
    expect(run('fade-upp').warnings.join()).toContain('did you mean "fade-up"')
  })

  it('keeps the known effects when only one name is bad', () => {
    const plan = run('fade-up, notreal')
    expect(plan.fxNames).toEqual(['fade-up'])
    expect(plan.unknown).toEqual(['notreal'])
  })
})

describe('compile — composition', () => {
  it('composes effects whose channels are disjoint', () => {
    const plan = run('slide-up, blur-in')
    expect(plan.fxNames).toEqual(['slide-up', 'blur-in'])
    expect(plan.declarations['animation-name']).toBe('dsg-in-up, dsg-blur-in')
  })

  it('emits parallel value lists so per-effect timing survives composition', () => {
    const plan = run('slide-up 800ms, blur-in 400ms')
    expect(plan.declarations['animation-duration']).toBe('800ms, 400ms')
    expect(plan.declarations['animation-fill-mode']).toBe('both, both')
  })

  it('composes three disjoint channels', () => {
    const plan = run('slide-up, blur-in, zoom-in')
    expect(plan.fxNames).toEqual(['slide-up', 'blur-in', 'zoom-in'])
  })

  it('prefers a registered combo preset over channel analysis', () => {
    // fade-up and blur-in both write opacity, so this would otherwise be rejected.
    const plan = run('fade-up, blur-in')
    expect(plan.fxNames).toEqual(['fade-blur-up'])
    expect(plan.warnings).toEqual([])
  })

  it('matches a combo regardless of authored order', () => {
    expect(run('blur-in, fade-up').fxNames).toEqual(['fade-blur-up'])
  })

  it('rejects a channel collision, keeps the first effect, and names both sides', () => {
    const plan = run('fade-up, fade-left')
    expect(plan.fxNames).toEqual(['fade-up'])
    expect(plan.warnings.join()).toContain('both animate opacity')
  })

  it('treats the same effect listed twice as a collision', () => {
    expect(run('fade-up, fade-up').warnings.join()).toContain('cannot compose')
  })
})

describe('compile — reduced motion policy', () => {
  it('defaults to shorten for entrance effects', () => {
    expect(run('fade-up').reducedMotion).toBe('shorten')
  })

  it('uses disable for continuous scroll-linked effects', () => {
    expect(run('parallax-y', 'view').reducedMotion).toBe('disable')
  })

  it('takes the strictest policy across composed effects', () => {
    const plan = compile(parse('slide-up, parallax-scale'), registry, 'view')
    expect(plan.reducedMotion).toBe('disable')
  })
})

describe('compile — timeline support', () => {
  it('warns when a time-only effect is put on a view timeline', () => {
    expect(run('fade-up', 'view').warnings.join()).toContain('does not support timeline "view"')
  })

  it('does not warn for a scroll-linked effect on a view timeline', () => {
    expect(run('parallax-y', 'view').warnings).toEqual([])
  })

  it('warns when a scroll-linked effect is left on the default time timeline', () => {
    expect(run('parallax-y').warnings.join()).toContain('does not support timeline "time"')
  })
})
