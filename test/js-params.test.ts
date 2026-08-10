import { describe, expect, it } from 'vitest'
import {
  ABSOLUTE_BASIS,
  createParams,
  readEffectParams,
  readParams,
  toMilliseconds,
  toNumber,
  toPixels,
} from '../src/core/js-params.js'
import type { LengthBasis } from '../src/core/js-params.js'
import type { ParameterSchema } from '../src/core/types.js'

const schema: ParameterSchema = {
  distance: { type: 'length', default: '24px', cssProperty: '--dsg-distance' },
  duration: { type: 'time', default: '400ms', cssProperty: '--dsg-duration' },
  spacer: {
    type: 'keyword',
    default: 'false',
    cssProperty: '--dsg-spacer',
    values: ['true', 'false'],
  },
  target: { type: 'text', default: '', cssProperty: '--dsg-target' },
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
})
