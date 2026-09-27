import { describe, expect, it } from 'vitest'
import { parse } from '../src/core/parse.js'
import { elementStaggerKeys, isGroupedKeys, staggerKeysFor } from '../src/core/stagger-keys.js'

/**
 * The pure half of `stagger-keys.ts`: which keys an element or a `target:` group effectively
 * carries, and whether that set counts as "grouped" (B-a). No DOM involved — `elementStaggerKeys`
 * reads off a parsed `data-kui` and `staggerKeysFor`/`isGroupedKeys` are plain merges. The claim/
 * `declaresGroup` half lives in `stagger-keys-dom.test.ts`, since it only shows up through a real
 * element and `applyStagger`.
 */

describe('elementStaggerKeys', () => {
  it('is undefined when the element declares no group key at all', () => {
    expect(elementStaggerKeys(parse('fade-up'))).toBeUndefined()
  })

  it('carries only the keys actually authored, not the other three as undefined', () => {
    const keys = elementStaggerKeys(parse('fade-up cascade:90ms'))
    expect(keys).toEqual({ cascade: '90ms' })
    expect(Object.keys(keys ?? {})).toEqual(['cascade'])
  })

  it('carries every hoisted key the element authored', () => {
    expect(elementStaggerKeys(parse('fade-up cascade:90ms order:center cols:3'))).toEqual({
      cascade: '90ms',
      order: 'center',
      cols: '3',
    })
  })

  it('does not see a key hoisted onto a targeted segment instead of element-wide', () => {
    // The 3a landmine: after P1, a `target:` segment's `cascade:`/`order:` lands on
    // `spec.hoists`, not on the element-wide `ParsedValue` fields this function reads.
    expect(elementStaggerKeys(parse('fade-up target:li cascade:90ms'))).toBeUndefined()
  })
})

describe('staggerKeysFor', () => {
  it('is undefined when neither scope declares a key', () => {
    expect(staggerKeysFor(undefined, undefined)).toBeUndefined()
  })

  it('falls back to the element-wide keys when the group scoped none of its own', () => {
    const elementWide = elementStaggerKeys(parse('fade-up cascade:90ms'))
    expect(staggerKeysFor(undefined, elementWide)).toEqual({ cascade: '90ms' })
  })

  it('takes the scoped value over the element-wide one for the same key', () => {
    const elementWide = elementStaggerKeys(parse('fade-up cascade:90ms'))
    expect(staggerKeysFor({ cascade: '50ms' }, elementWide)).toEqual({ cascade: '50ms' })
  })

  it('decides each key on its own rather than picking one scope for the whole group', () => {
    // elementWide has spread:, scoped has a different key (cascade:) — both survive the merge.
    const elementWide = elementStaggerKeys(parse('fade-up spread:500ms'))
    expect(staggerKeysFor({ cascade: '50ms' }, elementWide)).toEqual({
      cascade: '50ms',
      spread: '500ms',
    })
  })

  it('reads a target: segment’s own hoists off CompiledTarget.hoists, the landmine case', () => {
    // `fade-up target:li cascade:90ms` hoists cascade onto spec.hoists, not element-wide — the
    // raw re-parse `stagger-config.ts`'s `inlineGroupKeys` does can never see it. This is the path
    // that has to reach it instead: the segment's own `spec.hoists`, exactly as `compile.ts`
    // exposes it on `CompiledTarget.hoists`.
    const parsed = parse('fade-up target:li cascade:90ms')
    const scoped = parsed.specs[0]?.hoists
    const elementWide = elementStaggerKeys(parsed)

    expect(elementWide).toBeUndefined()
    expect(staggerKeysFor(scoped, elementWide)).toEqual({ cascade: '90ms' })
  })
})

describe('isGroupedKeys', () => {
  it('is false when there are no keys at all', () => {
    expect(isGroupedKeys(undefined)).toBe(false)
  })

  it.each(['cascade', 'spread', 'order'] as const)('is true when %s is authored', (key) => {
    expect(isGroupedKeys({ [key]: 'x' })).toBe(true)
  })

  it.each(['cols', 'along'] as const)('is false when only %s is authored', (key) => {
    expect(isGroupedKeys({ [key]: 'x' })).toBe(false)
  })
})
