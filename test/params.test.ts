import { describe, expect, it } from 'vitest'
import { decimalNumber, isSameOriginPath, resolveParams, validate } from '../src/core/params.js'
import type { ParamSpec, ParameterSchema } from '../src/core/types.js'

const length: ParamSpec = { type: 'length', default: '24px', cssProperty: '--kui-distance' }
const time: ParamSpec = { type: 'time', default: '600ms', cssProperty: '--kui-duration' }
const keyword: ParamSpec = {
  type: 'keyword',
  default: 'chars',
  cssProperty: '--kui-split',
  keywords: ['chars', 'words', 'lines'],
}
const text: ParamSpec = { type: 'text', default: '', cssProperty: '--kui-src' }
const angle: ParamSpec = { type: 'angle', default: '180deg', cssProperty: '--kui-from-angle' }
/** `motion-path`'s `rotate:`, the one parameter that is an angle *or* a word. */
const angleWithLiterals: ParamSpec = {
  type: 'angle|keyword',
  keywords: ['auto', 'reverse'],
  default: '0deg',
  cssProperty: '--kui-motion-rotate',
}
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

  it('rejects a calc() expression against a finite numeric constraint', () => {
    // `Number('calc(2 + 2)')` is `NaN` unconditionally — this module never evaluates calc
    // arithmetic — so any `number`-type param with `finite: true` (e.g. `spread` in
    // src/effects/catalog/feedback.ts) rejects every authored calc() value at this check.
    const constrained: ParamSpec = {
      type: 'number',
      default: '4',
      cssProperty: '--kui-x',
      finite: true,
      minimum: 1,
    }
    const result = validate('calc(2 + 2)', constrained)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('expected a finite number')
  })

  it('rejects empty values', () => {
    expect(validate('   ', length).ok).toBe(false)
  })

  it('reports no declared keywords when a keyword spec carries no list', () => {
    // Unrepresentable in TypeScript since `keywords` became required, and deliberately still
    // exercised: `Registry.registerPrimitive` is public, so a plain-JS caller can build exactly
    // this. It must name the gap, not throw on `undefined.join`.
    const bare = { type: 'keyword', default: 'x', cssProperty: '--kui-bare' } as unknown as ParamSpec
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

  describe('angle values', () => {
    it.each(['180deg', '-8deg', '0.5turn', '1.2rad', '100grad'])('accepts %s unchanged', (value) => {
      expect(validate(value, angle)).toEqual({ value, ok: true })
    })

    it.each([
      ['180', '180deg'],
      ['180d', '180deg'],
      ['-90', '-90deg'],
      ['-90d', '-90deg'],
      ['0', '0deg'],
      ['.5', '.5deg'],
      ['12.5d', '12.5deg'],
    ])('normalises %s to %s', (raw, expected) => {
      expect(validate(raw, angle)).toEqual({ value: expected, ok: true })
    })

    it('is case-insensitive about the shorthand', () => {
      expect(validate('180D', angle)).toEqual({ value: '180deg', ok: true })
    })

    // `rad` and `grad` end in `d` too. Anchored and three characters, so the shorthand
    // cannot eat them and turn a radian into a degree.
    it.each([
      ['1rad', '1rad'],
      ['100grad', '100grad'],
    ])('leaves %s alone rather than reading its trailing d', (value, expected) => {
      expect(validate(value, angle)).toEqual({ value: expected, ok: true })
    })

    it.each(['deg', '180degrees', '180 deg', '180dd', 'red'])('still rejects %s', (value) => {
      expect(validate(value, angle).ok).toBe(false)
    })
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

/**
 * The keyword/value split, and the union types that replaced the additive reading of `values`.
 *
 * `ParamSpec.values` used to mean a closed set on `type: 'keyword'` and *extra literals accepted
 * alongside the grammar* on every other type. The second reading validated nothing while looking
 * exactly like validation, so `{ type: 'number', values: ['80%'] }` accepted every number in
 * existence and said nothing about it. `keywords` is the closed set and nothing else; a parameter
 * that wants "a value or a word" declares a union type instead.
 */
describe('keywords is closed, and inert without a keyword half', () => {
  it('accepts only the declared words on a keyword parameter', () => {
    expect(validate('words', keyword)).toEqual({ value: 'words', ok: true })
    expect(validate('sentences', keyword).ok).toBe(false)
  })

  it('names every accepted word in the rejection, so a typo is actionable', () => {
    expect(validate('sentences', keyword).reason).toBe('expected one of chars, words, lines')
  })

  it('ignores a keywords list on a type that has no keyword half', () => {
    // Unrepresentable in TypeScript — `ValueParamSpec` declares `keywords?: never` — and checked
    // here because `Registry.registerPrimitive` is public, so a plain-JS caller can still build
    // it. This is the exact shape the old additive `values` accepted in silence: the parameter is
    // a number, so `80%` is not a number, and the stray list must not smuggle it through.
    const smuggled = {
      type: 'number',
      default: '1',
      cssProperty: '--kui-x',
      keywords: ['80%'],
    } as unknown as ParamSpec
    expect(validate('80%', smuggled).ok).toBe(false)
    expect(validate('0.8', smuggled)).toEqual({ value: '0.8', ok: true })
  })
})

describe('union parameter types', () => {
  /** `catalog/core.ts`'s `opacity:` — CSS spells `opacity` as a number *or* a percentage. */
  const alpha: ParamSpec = { type: 'number|percentage', default: '0', cssProperty: '--kui-from-opacity' }
  const boundedAlpha: ParamSpec = { ...alpha, finite: true, minimum: 0, maximum: 1 }
  const lengthOrPercent: ParamSpec = {
    type: 'length|percentage',
    default: '24px',
    cssProperty: '--kui-distance',
  }

  describe('number|percentage', () => {
    it.each(['0', '1', '0.8', '-0.5', '.5'])('accepts the number spelling %s unchanged', (value) => {
      expect(validate(value, alpha)).toEqual({ value, ok: true })
    })

    it.each([
      ['80%', '0.8'],
      ['0%', '0'],
      ['100%', '1'],
      ['50%', '0.5'],
      ['-50%', '-0.5'],
      ['12.5%', '0.125'],
    ])('normalises %s to %s', (raw, expected) => {
      expect(validate(raw, alpha)).toEqual({ value: expected, ok: true })
    })

    it('divides lexically, so no binary floating-point artefact reaches the stylesheet', () => {
      // `Number('1.1') / 100` is `0.011000000000000001`. Writing that into a custom property
      // makes a correct value look broken to anybody reading it in devtools.
      expect(validate('1.1%', alpha)).toEqual({ value: '0.011', ok: true })
    })

    it('bounds the normalised number, so both spellings are held to the same limit', () => {
      // This is what normalising buys beyond tidiness: `maximum: 1` could not see `150%` at all
      // if the percentage spelling were passed through as written.
      expect(validate('150%', boundedAlpha).ok).toBe(false)
      expect(validate('150%', boundedAlpha).reason).toBe('expected at most 1')
      expect(validate('80%', boundedAlpha)).toEqual({ value: '0.8', ok: true })
    })

    it('still accepts calc(), which it cannot fold and must not reject', () => {
      expect(validate('calc(var(--a) * 2)', alpha).ok).toBe(true)
    })

    it.each(['80px', 'red', '80 %', '+50%', '80%%'])('rejects %s', (value) => {
      expect(validate(value, alpha).ok).toBe(false)
    })

    it('names both halves of the union in the rejection', () => {
      expect(validate('red', alpha).reason).toBe('not a valid number or percentage')
    })

    it('keeps a percentage the lexical shift refuses to expand, rather than dropping it', () => {
      // `decimalNumber` gives up when the padded form would run past its 190-digit ceiling, and a
      // hundred-digit percentage is over it. The conversion is a *tidying* step, not a validation
      // step — the value is still a legal `number|percentage`, so the only honest answer is to pass
      // it through as written and let CSS hold it. Returning `undefined` here instead would hand
      // `isAcceptable` an empty string and reject a value the grammar accepts.
      const huge = `1${'0'.repeat(99)}%`
      expect(decimalNumber(huge.slice(0, -1), -2)).toBeUndefined()
      expect(validate(huge, alpha)).toEqual({ value: huge, ok: true })
    })
  })

  describe('length|percentage', () => {
    it.each(['24px', '2rem', '50%', '0', 'calc(100% - 20px)'])('accepts %s unchanged', (value) => {
      expect(validate(value, lengthOrPercent)).toEqual({ value, ok: true })
    })

    it('does not convert the percentage, which resolves against a box this code never measured', () => {
      expect(validate('50%', lengthOrPercent).value).toBe('50%')
    })

    it.each(['24', 'red'])('rejects %s', (value) => {
      expect(validate(value, lengthOrPercent).ok).toBe(false)
    })
  })

  describe('angle|keyword', () => {
    it.each(['auto', 'reverse'])('accepts the declared word %s untouched', (value) => {
      expect(validate(value, angleWithLiterals)).toEqual({ value, ok: true })
    })

    it.each([
      ['45deg', '45deg'],
      ['45', '45deg'],
      ['45d', '45deg'],
      ['-90', '-90deg'],
      ['0.5turn', '0.5turn'],
    ])('accepts the angle %s as %s', (raw, expected) => {
      expect(validate(raw, angleWithLiterals)).toEqual({ value: expected, ok: true })
    })

    it('keeps the keyword half closed — an undeclared word is not an angle either', () => {
      expect(validate('spin', angleWithLiterals).ok).toBe(false)
    })

    it('names the angle half and every declared word in the rejection', () => {
      expect(validate('spin', angleWithLiterals).reason).toBe(
        'not a valid angle or one of auto, reverse',
      )
    })

    it('reports the gap rather than throwing when a plain-JS caller declares no words', () => {
      const bare = { type: 'angle|keyword', default: '0deg', cssProperty: '--kui-r' } as unknown as ParamSpec
      expect(validate('spin', bare).reason).toBe('not a valid angle or one of (none declared)')
      expect(validate('45', bare)).toEqual({ value: '45deg', ok: true })
    })
  })

  it('resolves a normalised union value onto its custom property', () => {
    // The end-to-end shape: what the author wrote is not what reaches element.style.
    const warnings: string[] = []
    const result = resolveParams({ opacity: '80%' }, { opacity: alpha }, (m) => warnings.push(m))
    expect(result).toEqual({ '--kui-from-opacity': '0.8' })
    expect(warnings).toEqual([])
  })
})

describe('decimalNumber', () => {
  it.each([
    ['80', -2, '0.8'],
    ['1.1', -2, '0.011'],
    ['100', -2, '1'],
    ['0', -2, '0'],
    ['-50', -2, '-0.5'],
    ['1e3', 0, '1000'],
    ['1e-3', 0, '0.001'],
    ['+5', 0, '5'],
    ['2.50', 0, '2.5'],
  ])('expands %s shifted by %i to %s', (raw, shift, expected) => {
    expect(decimalNumber(raw, shift)).toBe(expected)
  })

  it.each(['red', '2rem', '', '1.2.3'])('returns undefined for the non-number %s', (raw) => {
    expect(decimalNumber(raw)).toBeUndefined()
  })

  it('refuses an exponent whose expansion would blow the value budget', () => {
    // Without the cap this asks for a gigabyte of zeroes rather than returning.
    expect(decimalNumber('1e999999999')).toBeUndefined()
  })

  it('refuses input longer than the value budget', () => {
    expect(decimalNumber('9'.repeat(300))).toBeUndefined()
  })
})

describe('colour keywords are a closed set, not any run of letters', () => {
  const tint = { type: 'color', default: '', cssProperty: '--kui-tint' } as const

  it('accepts the CSS named colours, transparent and currentcolor', () => {
    for (const value of ['red', 'rebeccapurple', 'Transparent', 'currentcolor', 'LightGoldenrodYellow'])
      expect(validate(value, tint), value).toMatchObject({ ok: true })
  })

  it('rejects a word CSS has never defined', () => {
    // `/^[a-z]+$/i` accepted these. Harmless while a custom property was the only consumer — CSS
    // drops the bad declaration and the var() fallback covers it — and not harmless at all once a
    // value is read back through getComputedStyle, where a bogus keyword returns a wrong colour
    // rather than being dropped.
    for (const value of ['banana', 'nonsense', 'notacolour'])
      expect(validate(value, tint), value).toMatchObject({ ok: false })
  })

  it('still accepts hex and colour functions', () => {
    for (const value of ['#e4f222', '#fff', 'rgb(1 2 3)', 'oklch(0.7 0.1 200)', 'color(srgb 1 0 0)'])
      expect(validate(value, tint), value).toMatchObject({ ok: true })
  })

  // The CSS system colours (`Canvas`, `Highlight`, …) are the third group in that set, and they
  // have their own file — `params-system-colors.test.ts`, because this one is over its line cap.
})
