import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Timeline } from '../src/core/types.js'
import { catalogRegistry } from './support/registry.js'

/**
 * An infinite loop is ambient motion. `shorten` compiles to a 1ms duration under reduced motion,
 * which with an infinite iteration count is a strobe, so `repeat:infinite` must fold to `disable`.
 */
const registry = catalogRegistry()

function policy(source: string, timeline: Timeline = 'time'): string {
  return compile(parse(source), registry, timeline).reducedMotion
}

describe('repeat:infinite and the reduced-motion policy', () => {
  it('escalates a shorten primitive with an infinite repeat to disable', () => {
    expect(policy('draw-stroke 1600ms repeat:infinite yoyo:true')).toBe('disable')
    expect(policy('ken-burns repeat:infinite')).toBe('disable')
  })

  it('keeps shorten for a finite repeat and for no repeat', () => {
    expect(policy('draw-stroke repeat:3')).toBe('shorten')
    expect(policy('draw-stroke')).toBe('shorten')
  })

  it('does not escalate when the compiler refused the repeat', () => {
    // A pin timeline refuses repeat:infinite, so the effect plays once and shortening is safe.
    expect(policy('fade-up repeat:infinite', 'pin')).toBe('shorten')
  })

  it('never lowers a policy that was already disable', () => {
    expect(policy('slat-assemble repeat:infinite')).toBe('disable')
  })

  it('escalates an infinite repeat on a repeatable JS effect too', () => {
    expect(policy('count-up repeat:infinite')).toBe('disable')
    expect(policy('count-up repeat:3')).toBe('shorten')
  })
})
