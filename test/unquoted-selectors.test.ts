// Four shapes for the classic `target:` typo: a comma inside an unquoted `target:` selector
// splits into a stray extra segment (`parse.ts` cannot know the comma was meant to stay inside
// the selector) that looks exactly like a selector and is not a registered effect name. This file
// only checks `findUnquotedSelectors`/`unquotedSelectorWarning` in isolation, against `parse()`
// output — `compile.ts:316-318` is the call site that turns a finding into a document warning,
// covered elsewhere.
import { describe, expect, it } from 'vitest'
import { parse } from '../src/core/parse.js'
import { findUnquotedSelectors, unquotedSelectorWarning } from '../src/core/unquoted-selectors.js'
import { catalogRegistry } from './support/registry.js'

describe('findUnquotedSelectors', () => {
  it('flags an unquoted, comma-containing target: selector as a stray segment', () => {
    const { specs } = parse('pop target:.a, .b')
    const found = findUnquotedSelectors(specs, catalogRegistry())
    expect(found).toEqual([{ previous: '.a', segment: '.b' }])
  })

  it('does not flag a quoted target: selector — it never splits into a second segment', () => {
    const { specs } = parse("pop target:'.a, .b'")
    expect(specs).toHaveLength(1)
    expect(findUnquotedSelectors(specs, catalogRegistry())).toEqual([])
  })

  it('does not flag two ordinary, unrelated effect segments', () => {
    const { specs } = parse('fade-up, blur-in')
    expect(findUnquotedSelectors(specs, catalogRegistry())).toEqual([])
  })

  // `looksLikeSelectorFragment`'s two tests are independent: a stray segment can look like a
  // selector fragment by opening with a class/id/attribute/universal/pseudo marker (`.b` above) OR
  // by containing a combinator without one, e.g. a descendant/child selector's second half once
  // the comma has already split it off. This exercises the second shape on its own.
  it('flags a stray segment that contains a combinator but no leading selector marker', () => {
    const { specs } = parse('pop target:.a, a>b')
    expect(findUnquotedSelectors(specs, catalogRegistry())).toEqual([{ previous: '.a', segment: 'a>b' }])
  })

  it('does not flag a selector-shaped segment whose previous segment carries no target:', () => {
    const { specs } = parse('pop, .b')
    expect(findUnquotedSelectors(specs, catalogRegistry())).toEqual([])
  })

  // Exercises the `registry.has()` guard: a registered effect name right after a `target:`
  // segment must never be flagged, even though it satisfies the "previous segment has a target:"
  // half of the shape on its own. No name in the catalog also matches the selector-fragment regex
  // (checked by listing `catalogRegistry().names()` against it — nothing starts with
  // `. # [ * :` or contains `> ~ +`), so this can't be tightened into a case that would trip the
  // selector-shape check too; the two guards are independent by construction, not by this test.
  it('does not flag a registered effect name following a target: segment', () => {
    const { specs } = parse('pop target:.a, fade-up')
    expect(findUnquotedSelectors(specs, catalogRegistry())).toEqual([])
  })
})

describe('unquotedSelectorWarning', () => {
  it('names both halves of the fix: the selector and how to quote it', () => {
    const message = unquotedSelectorWarning({ previous: '.a', segment: '.b' })
    expect(message).toContain('.a')
    expect(message).toContain('.b')
    expect(message).toContain("target:'.a, .b'")
  })
})
