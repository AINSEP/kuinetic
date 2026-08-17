import { describe, expect, it } from 'vitest'
import {
  ABSOLUTE_BASIS,
  createParams,
  readEffectParams,
  readEffectTiming,
  readParams,
  toMilliseconds,
  toNumber,
  toPixels,
} from '../src/core/js-params.js'
import type { LengthBasis } from '../src/core/js-params.js'
import type { ParameterSchema } from '../src/core/types.js'

const schema: ParameterSchema = {
  distance: { type: 'length', default: '24px', cssProperty: '--kui-distance' },
  duration: { type: 'time', default: '400ms', cssProperty: '--kui-duration' },
  spacer: {
    type: 'keyword',
    default: 'false',
    cssProperty: '--kui-spacer',
    values: ['true', 'false'],
  },
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
}

const basis: LengthBasis = {
  viewportWidth: 1000,
  viewportHeight: 800,
  percentBasis: 200,
  fontSize: 20,
  rootFontSize: 16,
}

describe('readParams', () => {
  it('fills in every declared default', () => {
    // The CSS path deliberately omits defaults; the JS path must not, because a primitive
    // branches on values it has to always have.
    expect(readParams({}, schema, () => {})).toEqual({
      distance: '24px',
      duration: '400ms',
      spacer: 'false',
      target: '',
    })
  })

  it('applies authored overrides', () => {
    expect(readParams({ distance: '80px' }, schema, () => {}).distance).toBe('80px')
  })

  it('falls back to the default and warns on an invalid value', () => {
    const warnings: string[] = []
    const result = readParams({ distance: 'sideways' }, schema, (m) => warnings.push(m))
    expect(result.distance).toBe('24px')
    expect(warnings.join()).toContain('not a valid length')
  })

  it('never lets an unvalidated string through', () => {
    const result = readParams({ distance: 'url(http://evil.test)' }, schema, () => {})
    expect(result.distance).toBe('24px')
  })

  it('warns about unknown parameters and omits them', () => {
    const warnings: string[] = []
    const result = readParams({ nope: '1' }, schema, (m) => warnings.push(m))
    expect(result.nope).toBeUndefined()
    expect(warnings.join()).toContain('unknown parameter "nope"')
  })

  it('keeps text parameters, which the CSS path drops', () => {
    expect(readParams({ target: 'nav a' }, schema, () => {}).target).toBe('nav a')
  })
})

describe('toMilliseconds', () => {
  it.each([
    ['400ms', 400],
    ['1.5s', 1500],
    ['0s', 0],
    ['-200ms', -200],
  ])('converts %s', (input, expected) => {
    expect(toMilliseconds(input)).toBe(expected)
  })

  it('returns the fallback for a non-time value', () => {
    expect(toMilliseconds('calc(1s * 2)', 99)).toBe(99)
  })
})

describe('toPixels', () => {
  it.each([
    ['24px', 24],
    ['0', 0],
    ['2rem', 32],
    ['2em', 40],
    ['10vw', 100],
    ['10vh', 80],
    ['50%', 100],
  ])('converts %s against the basis', (input, expected) => {
    expect(toPixels(input, basis)).toBeCloseTo(expected)
  })

  it('resolves vmin and vmax from the smaller and larger axis', () => {
    expect(toPixels('10vmin', basis)).toBeCloseTo(80)
    expect(toPixels('10vmax', basis)).toBeCloseTo(100)
  })

  it('does not evaluate calc, returning the fallback instead of guessing', () => {
    // A second CSS expression engine is not worth owning; a visible fallback beats a wrong number.
    expect(toPixels('calc(100% - 20px)', basis, 7)).toBe(7)
  })

  it('returns the fallback for a bare non-zero number', () => {
    expect(toPixels('24', basis, 5)).toBe(5)
  })

  it('resolves absolute units without any viewport context', () => {
    expect(toPixels('1in', ABSOLUTE_BASIS)).toBeCloseTo(96)
  })
})

describe('toNumber', () => {
  it('reads a bare number', () => {
    expect(toNumber('4')).toBe(4)
  })

  it('reads a percentage as a ratio', () => {
    expect(toNumber('30%')).toBeCloseTo(0.3)
  })

  it('returns the fallback for a value with any other unit', () => {
    expect(toNumber('4px', -1)).toBe(-1)
  })
})

describe('createParams', () => {
  const params = createParams({ distance: '80px', duration: '250ms', spacer: 'true', steps: '3' })

  it('reads text with a fallback for absent names', () => {
    expect(params.text('distance')).toBe('80px')
    expect(params.text('missing', 'fallback')).toBe('fallback')
  })

  it('reads milliseconds', () => {
    expect(params.ms('duration', 400)).toBe(250)
    expect(params.ms('missing', 400)).toBe(400)
  })

  it('reads numbers', () => {
    expect(params.num('steps')).toBe(3)
    expect(params.num('missing', 9)).toBe(9)
  })

  it('tests keyword parameters', () => {
    expect(params.is('spacer')).toBe(true)
    expect(params.is('missing')).toBe(false)
  })
})

describe('readEffectParams', () => {
  it('validates and wraps in one step', () => {
    const params = readEffectParams({ distance: 'url(http://evil.test)' }, schema, () => {})
    expect(params.text('distance')).toBe('24px')
    expect(params.ms('duration')).toBe(400)
  })

  it('carries the segment timing through untouched', () => {
    const params = readEffectParams({}, schema, () => {}, { durationMs: 2000, easing: 'linear' })
    expect(params.timing).toEqual({ durationMs: 2000, easing: 'linear' })
  })

  it('reports no timing at all when the author wrote none', () => {
    expect(readEffectParams({}, schema, () => {}).timing).toEqual({})
  })
})

describe('readEffectTiming', () => {
  it('converts positional duration and delay to milliseconds and keeps the easing', () => {
    const timing = readEffectTiming({ duration: '2s', delay: '250ms', easing: 'linear' }, () => {})
    expect(timing).toEqual({ durationMs: 2000, delayMs: 250, easing: 'linear' })
  })

  it('leaves each field undefined when the author named none', () => {
    // `undefined` has to stay distinguishable from `0ms`, or a primitive can never tell "no delay
    // was written" from "the author asked for zero" and its own default is unreachable.
    expect(readEffectTiming({}, () => {})).toEqual({
      durationMs: undefined,
      delayMs: undefined,
      easing: undefined,
    })
  })

  it('drops a non-time duration with a warning rather than passing it on', () => {
    const warnings: string[] = []
    const timing = readEffectTiming({ duration: 'calc(1s * 2)' }, (m) => warnings.push(m))
    expect(timing.durationMs).toBeUndefined()
    expect(warnings[0]).toContain('duration')
  })

  it('drops a non-time delay with a warning', () => {
    const warnings: string[] = []
    expect(readEffectTiming({ delay: '10' }, (m) => warnings.push(m)).delayMs).toBeUndefined()
    expect(warnings[0]).toContain('delay')
  })

  it('screens the easing through the same validator as a parameter', () => {
    // It reaches a stylesheet via `--kui-ease`, so it gets the identical escape screen every
    // authored `easing` parameter already gets.
    const warnings: string[] = []
    const timing = readEffectTiming({ easing: 'url(http://evil.test)' }, (m) => warnings.push(m))
    expect(timing.easing).toBeUndefined()
    expect(warnings[0]).toContain('easing')
  })
})
