// Split out of `compile.test.ts` when that file crossed the 400-line budget. The seam is the
// feature: everything here exercises `compileTargets` — how one authored `data-kui` value is
// partitioned into one plan per `target:`/`scope:` group — while `compile.test.ts` keeps the
// single-plan compiler it always tested. `compile()` itself is asserted at the bottom of this
// file rather than that one, because what it now guarantees is a fact about the partition: it
// returns `targets[0]`, and `targets[0]` is always the host group.
import { beforeEach, describe, expect, it } from 'vitest'
import { compile, compileTargets } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { catalogRegistry } from './support/registry.js'

let registry: Registry

beforeEach(() => {
  registry = catalogRegistry()
})

function run(source: string) {
  return compile(parse(source), registry, 'time')
}

function runTargets(source: string) {
  return compileTargets(parse(source), registry, 'time')
}

/**
 * `compileTargets` — the `scope:page` feature, docs/plan-scope-page.md step 5.
 *
 * `fade-up`/`blur-in`/`fade-left`/`flip-reorder` here own no `target` parameter of their own, so
 * `target:`/`scope:` on any of them go through the universal lift in `resolveEntries`. The six
 * scroll-mechanics/forms primitives that *do* declare `target` (`scroll-progress`, and friends) are
 * exercised in `scroll-mechanics.test.ts`/`catalog-forms.test.ts` instead — this file's job is the
 * partitioning machinery, not any one primitive's own resolution.
 */
describe('compileTargets — lifting target:/scope:', () => {
  it('leaves an untargeted attribute as a single host group, unchanged', () => {
    const document = runTargets('fade-up')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
  })

  it('lifts target: into its own group when nothing untargeted remains', () => {
    const document = runTargets('fade-up target:h1')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('h1')
    expect(document.targets[0]!.scope).toBe('self')
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
  })

  it('defaults scope to "self" — target: always means "search inside myself"', () => {
    expect(runTargets('fade-up target:h1').targets[0]!.scope).toBe('self')
  })

  it('honours an authored scope:page', () => {
    expect(runTargets('fade-up target:h1 scope:page').targets[0]!.scope).toBe('page')
  })

  it('does not lift target: for a primitive that declares the parameter itself', () => {
    // scroll-progress is one of the six — it reads target:/scope: from its own params, unchanged.
    const document = runTargets('scroll-progress target:.step')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
  })

  it('strips target:/scope: from the compiled params so they never warn "unknown parameter"', () => {
    const document = runTargets('fade-up target:h1 scope:page')
    expect(document.targets[0]!.plan.warnings).toEqual([])
  })

  it('puts the host group first, whichever segment was authored first', () => {
    const authoredHostSecond = runTargets('blur-in target:h1, fade-up')
    expect(authoredHostSecond.targets.map((t) => t.selector)).toEqual(['', 'h1'])
    const authoredHostFirst = runTargets('fade-up, blur-in target:h1')
    expect(authoredHostFirst.targets.map((t) => t.selector)).toEqual(['', 'h1'])
  })

  it('groups by scope AND selector — the same selector under self/page is two groups', () => {
    const document = runTargets('fade-up target:.x, blur-in target:.x scope:page')
    expect(document.targets).toHaveLength(2)
    const selves = document.targets.filter((t) => t.scope === 'self')
    const pages = document.targets.filter((t) => t.scope === 'page')
    expect(selves).toHaveLength(1)
    expect(pages).toHaveLength(1)
  })
})

describe('compileTargets — conflicts are per-group', () => {
  it('composes the same effect twice when they land on different targets', () => {
    // fade-up and fade-left both own `translate` and collide inside one group (see the
    // "rejects a channel collision" test above) — but here they never share a group at all.
    const document = runTargets('fade-up target:h1, fade-left target:.other')
    const byTarget = new Map(document.targets.map((t) => [t.selector, t.plan]))
    expect(byTarget.get('h1')!.fxNames).toEqual(['fade-up'])
    expect(byTarget.get('.other')!.fxNames).toEqual(['fade-left'])
    for (const target of document.targets) expect(target.plan.warnings.join()).not.toContain('cannot compose')
  })

  it('still refuses a real collision within one group', () => {
    const document = runTargets('fade-up target:h1, fade-left target:h1')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.plan.fxNames).toEqual(['fade-up'])
    expect(document.targets[0]!.plan.warnings.join()).toContain('cannot compose')
  })
})

describe('compileTargets — element-scoped facts are merged across every group', () => {
  it('folds the strictest reduced-motion policy onto every group, not just the one that declared it', () => {
    // flip-reorder declares reducedMotion: 'disable'; fade-up declares 'shorten'. Both groups must
    // see 'disable' — there is one activation binding for the whole element (D1), so a `disable`
    // anywhere disables the gate everywhere.
    const document = runTargets('flip-reorder target:.list, fade-up')
    for (const target of document.targets) expect(target.plan.reducedMotion).toBe('disable')
  })

  it('unions channels across every group', () => {
    const document = runTargets('fade-up target:h1, count-up target:.n')
    for (const target of document.targets) {
      expect(target.plan.channels).toEqual(expect.arrayContaining(['opacity', 'translate', 'content']))
    }
  })

  it('is the identity for a single, untargeted group — compile() stays byte-identical', () => {
    // The invariant steps 1-4 protect, extended: a document with exactly one group must merge to
    // exactly what that group already computed, character for character.
    const solo = run('fade-up')
    const merged = runTargets('fade-up').targets[0]!.plan
    expect(merged.reducedMotion).toBe(solo.reducedMotion)
    expect(merged.supportedActivations).toEqual(solo.supportedActivations)
    expect(merged.supportedTimelines).toEqual(solo.supportedTimelines)
    expect(merged.channels).toEqual(solo.channels)
  })
})

describe('compileTargets — at: sequences across the whole authored list, before partitioning', () => {
  it('positions a segment in a different target group against its authored neighbour', () => {
    // Same worked example sequence.test.ts asserts for the untargeted case — "start blur-in 200ms
    // before fade-up ends" — except blur-in now lands in a different group entirely.
    const document = runTargets('fade-up 600ms, blur-in target:h1 400ms at:-200ms')
    const targeted = document.targets.find((t) => t.selector === 'h1')!
    const delay = targeted.plan.declarations['animation-delay']!.replace(/^calc\(/, '').replace(/\)$/, '')
    expect(delay).toBe(
      'var(--kui-reveal-delay, 0ms) + 600ms - 200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms)',
    )
  })

  it('leaves the untargeted first segment exactly as it compiled before target: existed', () => {
    const document = runTargets('fade-up 600ms, blur-in target:h1 400ms at:-200ms')
    const host = document.targets.find((t) => t.selector === '')!
    expect(host.plan.declarations['animation-delay']).toBe(
      'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
  })
})

describe('compileTargets — requiresOwnSubtree refuses relocation', () => {
  it('drops target: on a preset whose CSS reaches past itself, and keeps the effect on the host', () => {
    const document = runTargets('card-flip-x target:.face')
    expect(document.targets).toHaveLength(1)
    expect(document.targets[0]!.selector).toBe('')
    expect(document.targets[0]!.plan.fxNames).toEqual(['card-flip-x'])
  })

  it('warns by name when it drops the target', () => {
    const document = runTargets('card-flip-x target:.face')
    expect(document.warnings.join()).toContain('card-flip-x')
    expect(document.warnings.join()).toContain('cannot be retargeted')
  })

  it('does not warn for a preset that may be retargeted', () => {
    expect(runTargets('fade-up target:h1').warnings.join()).not.toContain('cannot be retargeted')
  })
})

describe('compile() — legacy single-plan contract', () => {
  it('returns the host group’s plan when a host group exists', () => {
    const plan = run('fade-up, blur-in target:h1')
    expect(plan.fxNames).toEqual(['fade-up'])
  })

  it('returns the sole group’s plan when everything was retargeted', () => {
    const plan = run('fade-up target:h1')
    expect(plan.fxNames).toEqual(['fade-up'])
  })
})
