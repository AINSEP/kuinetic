import { describe, expect, it } from 'vitest'
import { resolveParams, validate } from '../src/core/params.js'
import type { ParamSpec, ParameterSchema } from '../src/core/types.js'

const length: ParamSpec = { type: 'length', default: '24px', cssProperty: '--dsg-distance' }
const time: ParamSpec = { type: 'time', default: '600ms', cssProperty: '--dsg-duration' }
const keyword: ParamSpec = {
  type: 'keyword',
  default: 'chars',
  cssProperty: '--dsg-split',
  values: ['chars', 'words', 'lines'],
}

describe('validate', () => {
  it.each(['24px', '2rem', '50%', '1.5em', '0', '100vh'])('accepts length %s', (value) => {
    expect(validate(value, length)).toEqual({ value, ok: true })
  })

  it.each(['24', 'red', '24 px', 'calc(100% -)'])('rejects non-length %s', (value) => {
    expect(validate(value, length).ok).toBe(false)
  })

  it('accepts a well-formed calc for lengths', () => {
    expect(validate('calc(100% - 20px)', length).ok).toBe(true)
  })

  it('accepts var() references inside calc', () => {
    expect(validate('calc(var(--gap) * 2)', length).ok).toBe(true)
  })

  it('rejects adversarial calc input in bounded time', () => {
    const value = `calc(${'var(--a)'.repeat(24)}!)`
    expect(value).toHaveLength(199)

    const started = performance.now()
    expect(validate(value, length).ok).toBe(false)
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('falls back to the default when invalid', () => {
    expect(validate('nonsense', length).value).toBe('24px')
  })

  it.each(['600ms', '0.8s', '-200ms'])('accepts time %s', (value) => {
    expect(validate(value, time).ok).toBe(true)
  })

  it('accepts only declared keywords', () => {
    expect(validate('words', keyword).ok).toBe(true)
    expect(validate('sentences', keyword).ok).toBe(false)
  })

  describe('rejects CSS-escaping values (author strings reach a stylesheet)', () => {
    it.each([
      ['declaration escape', 'red; background: url(http://evil.test)'],
      ['block escape', '10px} body {display:none'],
      ['network fetch', 'url(http://evil.test/beacon)'],
      ['image-set fetch', 'image-set(url(http://evil.test) 1x)'],
      ['legacy expression', 'expression(alert(1))'],
      ['comment escape', '10px/* '],
      ['markup', '<script>'],
      ['import', '@import "http://evil.test"'],
    ])('rejects %s', (_label, value) => {
      const result = validate(value, length)
      expect(result.ok).toBe(false)
      expect(result.value).toBe('24px')
    })
  })

  it('rejects absurdly long values before pattern matching', () => {
    expect(validate(`${'1'.repeat(300)}px`, length).reason).toContain('200 characters')
  })

  it('rejects empty values', () => {
    expect(validate('   ', length).ok).toBe(false)
  })
})

describe('resolveParams', () => {
  const schema: ParameterSchema = { distance: length, duration: time }

  it('maps authored params onto their custom properties', () => {
    const warnings: string[] = []
    const result = resolveParams({ distance: '40px' }, schema, (m) => warnings.push(m))
    expect(result).toEqual({ '--dsg-distance': '40px' })
    expect(warnings).toEqual([])
  })

  it('omits defaults so consumer stylesheets keep precedence over inline custom properties', () => {
    // Writing defaults to element.style would make them beat any site stylesheet, breaking the
    // promise that consumer CSS wins without !important. Defaults live in CSS var() fallbacks.
    expect(resolveParams({}, schema, () => {})).toEqual({})
  })

  it('warns and skips unknown parameters', () => {
    const warnings: string[] = []
    const result = resolveParams({ nope: '1px' }, schema, (m) => warnings.push(m))
    expect(result).toEqual({})
    expect(warnings.join()).toContain('unknown parameter "nope"')
  })

  it('warns and skips invalid values rather than writing them', () => {
    const warnings: string[] = []
    const result = resolveParams({ distance: 'url(http://evil.test)' }, schema, (m) =>
      warnings.push(m),
    )
    expect(result).toEqual({})
    expect(warnings.join()).toContain('disallowed CSS syntax')
  })
})
