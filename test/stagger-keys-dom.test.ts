// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ATTR } from '../src/core/attrs.js'
import { applyStagger } from '../src/core/stagger.js'
import { claimTargetGroupHost, isTargetGroupHost } from '../src/core/stagger-keys.js'

/**
 * `claimTargetGroupHost`/`isTargetGroupHost`, exercised through the thing they exist to change:
 * `applyStagger`'s ordinary group scan (via `declaresGroup`, in `stagger.ts`). A `target:` host
 * left unclaimed looks exactly like any other `data-kui-stagger` element with animated children —
 * that HEAD behaviour is the baseline these tests start from before ever calling `claim`.
 */

/** A host with `count` direct children, each carrying `data-kui` so `applyStagger` counts them. */
function group(count = 3): { host: HTMLElement; children: HTMLElement[] } {
  const host = document.createElement('ul')
  host.setAttribute(ATTR.stagger, '90ms')
  const children = Array.from({ length: count }, () => {
    const li = document.createElement('li')
    li.setAttribute(ATTR.source, 'fade-up')
    host.append(li)
    return li
  })
  return { host, children }
}

const ranksOf = (children: HTMLElement[]): string[] =>
  children.map((child) => child.style.getPropertyValue('--kui-i'))

describe('isTargetGroupHost', () => {
  it('is false for an element nothing has claimed', () => {
    const { host } = group()
    expect(isTargetGroupHost(host)).toBe(false)
  })
})

describe('claimTargetGroupHost — suppresses the ordinary stagger scan', () => {
  it('an unclaimed host is indexed as an ordinary group by applyStagger (baseline)', () => {
    const { host, children } = group()

    applyStagger(host)

    expect(ranksOf(children)).toEqual(['0', '1', '2'])
    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('3')
  })

  it('a claimed host is skipped by applyStagger — bug 3', () => {
    const { host, children } = group()
    const unmark = claimTargetGroupHost(host)
    expect(isTargetGroupHost(host)).toBe(true)

    applyStagger(host)

    // Never indexed: no `--kui-i` on the children and no `--kui-stagger-count` on the host, since
    // `declaresGroup` now reads it as a `target:` host, not an ordinary group.
    expect(ranksOf(children)).toEqual(['', '', ''])
    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('')

    unmark()
  })

  it('unmarking releases the host back to ordinary indexing', () => {
    const { host, children } = group()
    const unmark = claimTargetGroupHost(host)

    unmark()

    expect(isTargetGroupHost(host)).toBe(false)
    applyStagger(host)
    expect(ranksOf(children)).toEqual(['0', '1', '2'])
  })

  it('refcounts two claims on the same host — both must release before it un-claims', () => {
    const { host, children } = group()
    const unmarkA = claimTargetGroupHost(host)
    const unmarkB = claimTargetGroupHost(host)

    unmarkA()
    expect(isTargetGroupHost(host)).toBe(true)
    applyStagger(host)
    expect(ranksOf(children)).toEqual(['', '', ''])

    unmarkB()
    expect(isTargetGroupHost(host)).toBe(false)
    applyStagger(host)
    expect(ranksOf(children)).toEqual(['0', '1', '2'])
  })

  it('an unmark is idempotent — calling it twice cannot release a sibling claim early', () => {
    const { host } = group()
    const unmarkA = claimTargetGroupHost(host)
    claimTargetGroupHost(host) // second claim, unmark intentionally unused

    unmarkA()
    unmarkA() // a second call must not decrement again

    // Only A's single claim was released; B's claim is still outstanding.
    expect(isTargetGroupHost(host)).toBe(true)
  })
})
