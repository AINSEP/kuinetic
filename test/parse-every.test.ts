import { describe, expect, it } from 'vitest'
import { describeKeys } from '../src/core/describe.js'
import { ELEMENT_HOIST_KEYS, parse, tokenKind } from '../src/core/parse.js'

describe('every: replay cadence', () => {
  it('hoists the time token and keeps it out of spec.params', () => {
    const parsed = parse('flip-shuffle every:2.6s')
    expect(parsed.every).toBe('2.6s')
    expect(parsed.warnings).toEqual([])
    expect(parsed.specs).toHaveLength(1)
    expect(parsed.specs[0]!.params).not.toHaveProperty('every')
  })

  it('accepts milliseconds', () => {
    expect(parse('fade-up every:900ms').every).toBe('900ms')
  })

  it.each(['abc', '3', '-2s', ''])('rejects %j with a warning and no cadence', (bad) => {
    const parsed = parse(`fade-up every:${bad}`)
    expect(parsed.every).toBeUndefined()
    expect(parsed.warnings.some((w) => w.includes('every:'))).toBe(true)
  })

  it('warns on a conflicting duplicate and keeps the first', () => {
    const parsed = parse('fade-up every:2s, glow-pulse every:3s')
    expect(parsed.every).toBe('2s')
    expect(parsed.warnings.some((w) => w.includes('replay cadences'))).toBe(true)
  })

  it('is silent for an identical duplicate', () => {
    const parsed = parse('fade-up every:2s, glow-pulse every:2s')
    expect(parsed.every).toBe('2s')
    expect(parsed.warnings).toEqual([])
  })

  it('is never segment-scoped: a target: segment still writes it element-wide', () => {
    const parsed = parse('menu-stagger-open target:li cascade:80ms every:3.9s')
    expect(parsed.every).toBe('3.9s')
    expect(parsed.specs[0]!.hoists).toEqual({ cascade: '80ms' })
    expect(parsed.specs[0]!.params).not.toHaveProperty('every')
  })

  it('is listed among the element hoist keys', () => {
    expect(ELEMENT_HOIST_KEYS).toContain('every')
    expect(ELEMENT_HOIST_KEYS).toEqual(
      expect.arrayContaining(['on', 'timeline', 'actions', 'threshold', 'cascade', 'spread', 'order', 'cols', 'along', 'rm', 'func']),
    )
  })

  it('is described as an element key', () => {
    const row = describeKeys().find((k) => k.name === 'every')
    expect(row?.scope).toBe('element')
  })
})

describe('tokenKind', () => {
  it.each([
    ['fade-up:x', 'pair'],
    ['600ms', 'time'],
    ['.5s', 'time'],
    ['ease-in', 'easing'],
    ['cubic-bezier(.2,.8,.2,1)', 'easing'],
    ['fade-up', 'unknown'],
  ])('classifies %s as %s', (token, kind) => {
    expect(tokenKind(token)).toBe(kind)
  })
})
