// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ATTR } from '../src/core/attrs.js'
import { createLedgerSet } from '../src/core/owned-styles.js'
import { collectingReporter } from '../src/core/reporter.js'
import { indexTargetGroup } from '../src/core/stagger.js'

/**
 * `indexTargetGroup` — ranking the elements a `target:` resolved to.
 *
 * The retargeted half of `indexStaggerGroup`, and it cannot borrow that function's suite: a matched
 * set has no group element of its own. The ranks go on the matches, bucketed by their own parents,
 * while the step and the count go on the authored *host* — and all of it through the host's
 * `LedgerSet` rather than onto `element.style`, because under `scope:page` a match need not be a
 * descendant of the host at all and there is no ambient ledger it would otherwise fall under.
 *
 * Driven directly rather than through the animator, which is where the coverage gap came from:
 * `animator.ts` reaches this function on every `target:` element, but every suite that does asserts
 * what the matches *animate*, never how they are numbered or what the host publishes about them.
 */

function host(declaration: { stagger?: string; source?: string }): HTMLElement {
  const el = document.createElement('div')
  if (declaration.stagger !== undefined) el.setAttribute(ATTR.stagger, declaration.stagger)
  if (declaration.source !== undefined) el.setAttribute(ATTR.source, declaration.source)
  return el
}

/** `count` siblings under one parent, as `target:` would have handed them over: document order. */
function matches(count: number): HTMLElement[] {
  const parent = document.createElement('ul')
  return Array.from({ length: count }, () => {
    const li = document.createElement('li')
    parent.append(li)
    return li
  })
}

const ranksOf = (found: Element[]): string[] =>
  found.map((match) => (match as HTMLElement).style.getPropertyValue('--kui-i'))

const published = (el: HTMLElement): { step: string; count: string } => ({
  step: el.style.getPropertyValue('--kui-stagger'),
  count: el.style.getPropertyValue('--kui-stagger-count'),
})

describe('indexTargetGroup', () => {
  it('reads a longhand declaration from a host that carries no data-kui of its own', () => {
    // `target:` is authored inside `data-kui`, so through the animator the host always has one.
    // The function does not require it: `data-kui-stagger` is a declaration in its own right and
    // predates the hoist, and reading the second attribute as "absent" rather than as a parse of
    // `null` is what keeps a host that has only the first one working.
    const el = host({ stagger: '90ms' })
    const found = matches(3)

    indexTargetGroup(el, found, createLedgerSet(el))

    expect(ranksOf(found)).toEqual(['0', '1', '2'])
    expect(published(el)).toEqual({ step: '90ms', count: '3' })
  })

  it('numbers a matched set that declared no stagger at all', () => {
    // The ordinary `target:` element: a `data-kui` with no group key in it and no
    // `data-kui-stagger` beside it, so there is no config to resolve. `--kui-i` is still what the
    // stylesheet keys on, so the matches have to be numbered anyway — falling through to no ranks
    // would leave every match on `--kui-i: 0` and silently un-stagger the one shape `target:`
    // exists to reach.
    const el = host({ source: 'fade-up target:.card' })
    const found = matches(3)

    indexTargetGroup(el, found, createLedgerSet(el))

    expect(ranksOf(found)).toEqual(['0', '1', '2'])
    expect(published(el)).toEqual({ step: '', count: '3' })
  })

  it('takes the same declaration hoisted into data-kui', () => {
    const el = host({ source: 'fade-up cascade:90ms' })
    const found = matches(3)

    indexTargetGroup(el, found, createLedgerSet(el))

    expect(ranksOf(found)).toEqual(['0', '1', '2'])
    expect(published(el).step).toBe('90ms')
  })

  it('publishes no step for an ordering-only group, but still publishes the count', () => {
    // The discriminator for the two above: `--kui-stagger` is written only when a step was
    // resolved, so an author who asked for an order and nothing else does not get a `0s` — or
    // worse, an empty custom property — standing where their own stylesheet's value should show
    // through.
    const el = host({ stagger: 'order:end' })
    const found = matches(3)

    indexTargetGroup(el, found, createLedgerSet(el))

    expect(ranksOf(found)).toEqual(['2', '1', '0'])
    expect(published(el)).toEqual({ step: '', count: '3' })
  })

  it('numbers each parent bucket from zero rather than across the whole match set', () => {
    // D7 in docs/plan-scope-page.md, and the reason the matches are bucketed before they are
    // ranked: a selector naming two parallel groups — copy lines and the dots that track them —
    // reads 0..n-1 in each, not 0..2n-1 across both.
    const el = host({ stagger: '90ms' })
    const left = matches(3)
    const right = matches(2)

    indexTargetGroup(el, [...left, ...right], createLedgerSet(el))

    expect(ranksOf(left)).toEqual(['0', '1', '2'])
    expect(ranksOf(right)).toEqual(['0', '1'])
    // The count is the largest rank anywhere plus one — the biggest bucket's span, since that is
    // the one the last-starting match belongs to.
    expect(published(el).count).toBe('3')
  })

  it('reports a malformed declaration against the host that carried it', () => {
    // Silent clamping was the alternative and it is the worse one: `order:9` on three matches is
    // an author looking at markup that used to have ten, and the animation still plays — from the
    // last match, which is nowhere near what they wrote.
    const el = host({ stagger: '90ms order:9' })
    const reporter = collectingReporter()

    indexTargetGroup(el, matches(3), createLedgerSet(el), reporter)

    expect(reporter.messages.join()).toContain('is outside the group (0 to 2)')
  })

  it('does not throw when there is no reporter to tell about it', () => {
    const el = host({ stagger: '90ms order:9' })
    expect(() => {
      indexTargetGroup(el, matches(3), createLedgerSet(el))
    }).not.toThrow()
  })

  it('gives every element it wrote to back when the host’s ledgers are unwound', () => {
    // The whole reason this writes through `ledgers` instead of `element.style`: the matches are
    // outside the host's subtree under `scope:page`, so `release()` on the host is the only thing
    // that will ever come back for them.
    const el = host({ stagger: '90ms' })
    const found = matches(3)
    found[0]!.style.setProperty('--kui-i', '7')
    const ledgers = createLedgerSet(el)

    indexTargetGroup(el, found, ledgers)
    expect(ranksOf(found)).toEqual(['0', '1', '2'])

    ledgers.restore()
    expect(ranksOf(found)).toEqual(['7', '', ''])
    expect(published(el)).toEqual({ step: '', count: '' })
  })
})
