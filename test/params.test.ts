import { describe, expect, it } from 'vitest'
import { isSameOriginPath, resolveParams, validate } from '../src/core/params.js'
import type { ParamSpec, ParameterSchema } from '../src/core/types.js'

const length: ParamSpec = { type: 'length', default: '24px', cssProperty: '--kui-distance' }
const time: ParamSpec = { type: 'time', default: '600ms', cssProperty: '--kui-duration' }
const keyword: ParamSpec = {
  type: 'keyword',
  default: 'chars',
  cssProperty: '--kui-split',
  values: ['chars', 'words', 'lines'],
}
const text: ParamSpec = { type: 'text', default: '', cssProperty: '--kui-src' }
const color: ParamSpec = { type: 'color', default: '#000', cssProperty: '--kui-color' }

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

  it('enforces finite numeric schema bounds', () => {
    const constrained: ParamSpec = {
      type: 'number',
      default: '180',
      cssProperty: '--spring',
      finite: true,
      minimum: 1,
      maximum: 10_000,
    }
    expect(validate('0', constrained).ok).toBe(false)
    expect(validate('9'.repeat(200), constrained).ok).toBe(false)
    expect(validate('10001', constrained).ok).toBe(false)
    expect(validate('180', constrained).ok).toBe(true)
  })

  it('rejects empty values', () => {
    expect(validate('   ', length).ok).toBe(false)
  })

  it('reports no declared keywords when a keyword spec carries no values list', () => {
    const bare: ParamSpec = { type: 'keyword', default: 'x', cssProperty: '--kui-bare' }
    const result = validate('anything', bare)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('(none declared)')
  })

  it('rejects a param type with no known pattern, e.g. a mistyped third-party schema', () => {
    // `Registry.registerPrimitive` is public, and a plain-JS caller has no compile-time guard
    // against a mistyped `type` — the runtime check this exercises is what stops a malformed
    // schema from crashing validation instead of just failing it.
    const mistyped = { type: 'colour', default: '#000', cssProperty: '--kui-x' } as unknown as ParamSpec
    const result = validate('123', mistyped)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not a valid colour')
  })

  it('enforces an integer constraint independently of finite/min/max', () => {
    const integerOnly: ParamSpec = {
      type: 'number',
      default: '1',
      cssProperty: '--kui-steps',
      integer: true,
    }
    expect(validate('3.5', integerOnly).ok).toBe(false)
    expect(validate('3.5', integerOnly).reason).toContain('integer')
    expect(validate('4', integerOnly)).toEqual({ value: '4', ok: true })
  })

  it('rejects a calc() whose var() reference is missing its own closing paren', () => {
    // "calc(var(--x)" has exactly one closing paren total, which the tokenizer consumes as
    // var(--x)'s own close — leaving calc() itself with none, which must be rejected.
    expect(validate('calc(var(--x)', length).ok).toBe(false)
  })

  it('rejects a var() reference whose name is not a legal custom property', () => {
    expect(validate('calc(var(notaproperty) * 2)', length).ok).toBe(false)
  })

  describe('color values', () => {
    it.each(['#fff', '#ffffff', '#ffffffff', 'rgba(0, 0, 0, 0.5)', 'hsl(200 50% 50%)', 'red'])(
      'accepts %s',
      (value) => {
        expect(validate(value, color)).toEqual({ value, ok: true })
      },
    )

    it('rejects a value shaped like none of hex, color-function, or keyword', () => {
      const result = validate('123', color)
      expect(result.ok).toBe(false)
      expect(result.value).toBe('#000')
    })
  })

  describe('text values (never reach a stylesheet)', () => {
    it('accepts braces, needed for media-scrub frame patterns like "frame-{i}.jpg"', () => {
      expect(validate('frame-{i}.jpg', text)).toEqual({ value: 'frame-{i}.jpg', ok: true })
    })

    it('accepts a CSS selector with descendant combinators', () => {
      expect(validate('nav a.active', text)).toEqual({ value: 'nav a.active', ok: true })
    })

    it('still rejects the declaration-escape characters that are not brace-shaped', () => {
      expect(validate('a; background: red', text).ok).toBe(false)
      expect(validate('url(http://evil.test)', text).ok).toBe(false)
    })
  })

  it('still rejects brace-containing garbage for typed (non-text) parameters', () => {
    // Braces are no longer screened directly, but a shape check for `length` still catches it.
    const result = validate('10px} body {display:none', length)
    expect(result.ok).toBe(false)
    expect(result.value).toBe('24px')
  })
})

describe('isSameOriginPath', () => {
  describe('accepts values that can only ever request the page\'s own origin', () => {
    it.each([
      ['bare relative filename', 'frame-{i}.jpg'],
      ['{i} substitution mid-path', 'frames/frame-{i}.jpg'],
      ['current-directory relative', './frame-{i}.jpg'],
      ['parent-directory relative', '../assets/frame-{i}.jpg'],
      ['root-relative absolute path', '/images/frame-{i}.jpg'],
      ['colon after the first path segment (query, not scheme)', 'frame.jpg?t=12:30'],
      ['colon after the first path segment (path, not scheme)', 'frames/frame:1.jpg'],
      ['disambiguated leading dot-segment', './frame:1.jpg'],
    ])('%s: %s', (_label, value) => {
      expect(isSameOriginPath(value)).toBe(true)
    })

    // Real usage from demo/scroll.html's sequence-scrub, plus the adjacent spellings an author
    // could reasonably reach for instead — must keep working exactly as written.
    it.each([
      './assets/scenic_scrub_{i}.jpg',
      'assets/frame-{i}.jpg',
      '/assets/frame-{i}.jpg',
      '../frames/{i}.png',
    ])('showcase-derived shape: %s', (value) => {
      expect(isSameOriginPath(value)).toBe(true)
    })
  })

  describe('rejects values that can escape the page\'s own origin', () => {
    it.each([
      ['protocol-relative', '//evil.test/beacon.gif'],
      ['backslash protocol-relative', '\\\\evil.test\\beacon.gif'],
      ['mixed-slash protocol-relative', '/\\evil.test/beacon.gif'],
      ['http to another origin', 'http://evil.test/beacon.gif'],
      ['https to another origin', 'https://evil.test/beacon.gif'],
      ['https uppercase scheme', 'HTTPS://evil.test/beacon.gif'],
      ['data URI', 'data:text/plain,exfiltrated'],
      ['blob URI', 'blob:https://evil.test/uuid'],
      ['file URI', 'file:///etc/passwd'],
      // Built rather than a literal so the string doesn't read as an eval sink to static
      // analysis; already closed elsewhere (the `<img>`-only write guard), checked here too as
      // defense in depth. Mixed-case, since scheme names are case-insensitive.
      ['javascript URI, mixed case', `${'Java'}${'Script:window.pwned=true'}`],
      ['bare leading scheme-shaped segment', 'frame:1.jpg'],
    ])('%s: %s', (_label, value) => {
      expect(isSameOriginPath(value)).toBe(false)
    })
  })
})

describe('resolveParams', () => {
  const schema: ParameterSchema = { distance: length, duration: time }

  it('maps authored params onto their custom properties', () => {
    const warnings: string[] = []
    const result = resolveParams({ distance: '40px' }, schema, (m) => warnings.push(m))
    expect(result).toEqual({ '--kui-distance': '40px' })
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

  it('reports no known parameters against an empty schema', () => {
    const warnings: string[] = []
    resolveParams({ nope: '1px' }, {}, (m) => warnings.push(m))
    expect(warnings.join()).toContain('(known: none)')
  })

  it('warns and skips invalid values rather than writing them', () => {
    const warnings: string[] = []
    const result = resolveParams({ distance: 'url(http://evil.test)' }, schema, (m) =>
      warnings.push(m),
    )
    expect(result).toEqual({})
    expect(warnings.join()).toContain('disallowed CSS syntax')
  })

  it('treats a prototype-chain key as unknown rather than an inherited value', () => {
    // `schema['__proto__']` alone falls through to Object.prototype (truthy), which would have
    // skipped the "unknown parameter" warning and used it as if it were a real ParamSpec.
    // `{ __proto__: ... }` object-literal syntax is special-cased by the language and would
    // silently produce an empty object instead of an own key, so this uses defineProperty to
    // construct a genuine own-enumerable `__proto__` entry the way an unusual caller might.
    const authored: Record<string, string> = Object.defineProperty({}, '__proto__', {
      value: '40px',
      enumerable: true,
      configurable: true,
      writable: true,
    })
    const warnings: string[] = []
    const result = resolveParams(authored, schema, (m) => warnings.push(m))
    expect(result).toEqual({})
    expect(warnings.join()).toContain('unknown parameter "__proto__"')
  })
})
