import { describe, expect, it } from 'vitest'
import { parse, splitTopLevel } from '../src/core/parse.js'

describe('splitTopLevel', () => {
  it('splits on top-level commas', () => {
    expect(splitTopLevel('a, b, c', ',')).toEqual(['a', 'b', 'c'])
  })

  it('ignores commas inside parentheses', () => {
    // The canonical footgun: `.split(',')` shreds this into four useless fragments.
    expect(splitTopLevel('fade-up ease:cubic-bezier(.2, .8, .2, 1), blur-in', ',')).toEqual([
      'fade-up ease:cubic-bezier(.2, .8, .2, 1)',
      'blur-in',
    ])
  })

  it('ignores spaces inside parentheses when tokenising', () => {
    expect(splitTopLevel('fade-up ease:steps(4, end)', ' ')).toEqual([
      'fade-up',
      'ease:steps(4, end)',
    ])
  })

  it('ignores delimiters inside quotes', () => {
    expect(splitTopLevel(`type content:"a, b"`, ',')).toEqual([`type content:"a, b"`])
  })

  it('tolerates unbalanced closing parens without going negative', () => {
    expect(splitTopLevel('a), b', ',')).toEqual(['a)', 'b'])
  })

  it('treats a backslash-escaped quote as literal, not a closer', () => {
    // Round-trips play.ts's toAttributeValue: quoteIfNeeded escapes `"` as `\"` so a value
    // containing a literal double quote survives tokenising as one piece.
    expect(splitTopLevel(String.raw`words:"say \"two words\" now"`, ' ')).toEqual([
      String.raw`words:"say \"two words\" now"`,
    ])
  })

  it('warns on an unterminated quote instead of silently swallowing the rest of the input', () => {
    const warnings: string[] = []
    const parts = splitTopLevel('fade-up, blur-in key:"unterminated, oops', ',', warnings)
    expect(parts).toEqual(['fade-up', 'blur-in key:"unterminated, oops'])
    expect(warnings.join()).toContain('unterminated " quote')
  })

  it('warns on an unclosed paren instead of silently swallowing the rest of the input', () => {
    const warnings: string[] = []
    splitTopLevel('fade-up ease:cubic-bezier(.2, .8, blur-in', ',', warnings)
    expect(warnings.join()).toContain('unclosed "("')
  })

  it('defaults to no warnings collection so every existing two-argument call keeps working', () => {
    expect(() => splitTopLevel('a "unterminated', ' ')).not.toThrow()
  })
})

describe('parse', () => {
  it('parses a bare effect name', () => {
    expect(parse('fade-up').specs).toEqual([{ name: 'fade-up', params: {} }])
  })

  it('assigns positional times as duration then delay', () => {
    const [spec] = parse('fade-up 800ms 200ms').specs
    expect(spec).toMatchObject({ name: 'fade-up', duration: '800ms', delay: '200ms' })
  })

  it('accepts seconds as well as milliseconds', () => {
    expect(parse('fade-up 0.8s').specs[0]?.duration).toBe('0.8s')
  })

  it('parses positional easing keywords', () => {
    expect(parse('fade-up 800ms ease-out').specs[0]?.easing).toBe('ease-out')
  })

  it('parses easing functions containing commas', () => {
    expect(parse('fade-up cubic-bezier(.2,.8,.2,1)').specs[0]?.easing).toBe(
      'cubic-bezier(.2,.8,.2,1)',
    )
  })

  it('parses key:value parameters', () => {
    expect(parse('fade-up distance:40px blur:12px').specs[0]?.params).toEqual({
      distance: '40px',
      blur: '12px',
    })
  })

  it('parses multiple comma-separated effects with independent args', () => {
    const { specs } = parse('fade-up 800ms, blur-in 400ms')
    expect(specs).toHaveLength(2)
    expect(specs[0]).toMatchObject({ name: 'fade-up', duration: '800ms' })
    expect(specs[1]).toMatchObject({ name: 'blur-in', duration: '400ms' })
  })

  it('tolerates newlines in the attribute value', () => {
    const { specs } = parse('slide-left 900ms,\n                blur-in 400ms')
    expect(specs.map((s) => s.name)).toEqual(['slide-left', 'blur-in'])
  })

  it('returns no specs for empty input', () => {
    expect(parse('').specs).toEqual([])
    expect(parse('   ').specs).toEqual([])
  })

  it('unescapes a backslash-escaped quote inside a quoted value', () => {
    // Full round-trip of play.ts's toAttributeValue output, not just the tokenizer boundary.
    const { specs } = parse(String.raw`word-cycler words:"say \"two words\" now"`)
    expect(specs[0]?.params.words).toBe('say "two words" now')
  })

  it('does not crash on a prototype-chain key and does not treat it as a hoist', () => {
    // HOISTS is a plain object; `HOISTS['__proto__']` used to resolve to the inherited
    // Object.prototype (truthy but not a function shaped like a hoist handler), and calling it
    // threw — aborting the scan of every element after this one.
    expect(() => parse('fade-up __proto__:x')).not.toThrow()
    const result = parse('fade-up __proto__:x')
    expect(result.activation).toBeUndefined()
    expect(result.timeline).toBeUndefined()
  })

  describe('hoisted element-scoped keys', () => {
    it('hoists on:', () => {
      expect(parse('fade-up on:hover').activation).toBe('hover')
    })

    it('hoists timeline: and threshold:', () => {
      const result = parse('parallax-y timeline:view threshold:30%')
      expect(result.timeline).toBe('view')
      expect(result.threshold).toBe('30%')
    })

    it('does not leak hoisted keys into effect params', () => {
      expect(parse('fade-up on:hover').specs[0]?.params).toEqual({})
    })

    it('warns on an unknown activation and leaves it unset', () => {
      const result = parse('fade-up on:teleport')
      expect(result.activation).toBeUndefined()
      expect(result.warnings.join()).toContain('unknown activation "teleport"')
    })

    it('keeps the first value and warns when two segments disagree', () => {
      const result = parse('fade-up on:hover, blur-in on:click')
      expect(result.activation).toBe('hover')
      expect(result.warnings.join()).toContain('conflicting activations')
    })

    it('does not warn when two segments agree', () => {
      expect(parse('fade-up on:hover, blur-in on:hover').warnings).toEqual([])
    })
  })

  describe('warnings', () => {
    it('names an unrecognised token', () => {
      const { warnings } = parse('fade-up sideways')
      expect(warnings.join()).toContain('unrecognised token "sideways"')
    })

    it('warns on a third time value and ignores it', () => {
      const result = parse('fade-up 100ms 200ms 300ms')
      expect(result.specs[0]).toMatchObject({ duration: '100ms', delay: '200ms' })
      expect(result.warnings.join()).toContain('third time value "300ms"')
    })

    it('warns on duplicate easing', () => {
      expect(parse('fade-up ease-in ease-out').warnings.join()).toContain('duplicate easing')
    })

    it('warns on duplicate parameters', () => {
      expect(parse('fade-up distance:1px distance:2px').warnings.join()).toContain(
        'duplicate parameter "distance"',
      )
    })

    it('rejects a segment whose first token is a pair', () => {
      const result = parse('distance:40px')
      expect(result.specs).toEqual([])
      expect(result.warnings.join()).toContain('effect name expected')
    })
  })
})
