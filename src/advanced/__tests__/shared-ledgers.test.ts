import { describe, expect, it } from 'vitest'
import { createAdvancedLedgers, styleOf } from '../base.js'
import type { ElementLedgers } from '../base.js'
import { createStyleLedger } from '../../core/owned-styles.js'

/**
 * `base.ts`'s ledger registry, asked directly.
 *
 * `ownership.test.ts` and `nested-ownership.test.ts` both lean on this machinery, but they ask it
 * the *controllers'* questions — did a camera and a scene writing to one element share a capture,
 * did an outer scene reach into an inner one's steps. Those reach `createAdvancedLedgers` only
 * through a controller that is behaving, so three of its contracts have never been asked about at
 * all: what `styleOf` does with an object that is element-shaped but cannot carry inline style,
 * what `elements()` reports, and what a `restore()` does when an earlier one threw partway.
 *
 * The third is the reason this file exists rather than three cases bolted onto `ownership.test.ts`.
 * `releaseSharedLedger` deletes an element's shared entry one line *before* it restores it, so a
 * ledger that throws on the way out leaves the registry holding a claim on an element whose entry
 * is already gone. That is a state no controller can produce on purpose and every controller can
 * land in by accident, and it is the single case the `if (!entry) return` guard exists for.
 */

/** A registry that records what it was asked for, so "was a ledger opened at all" is observable. */
function recordingLedgers(): { ledgers: ElementLedgers; asked: Element[] } {
  const asked: Element[] = []
  return {
    asked,
    ledgers: {
      style(el) {
        asked.push(el)
        // Over a throwaway node, not `el` — the point is to record the *ask*, and `el` in the
        // case under test is exactly the object that cannot carry a ledger.
        return createStyleLedger(document.createElement('div'))
      },
    },
  }
}

describe('styleOf — the one guard both ledger sources share', () => {
  it('refuses an element-shaped object with no inline style, without opening a ledger for it', () => {
    const { ledgers, asked } = recordingLedgers()
    // Answers `hasAttribute`, so it is past the first clause, but has no CSSOM behind it.
    // `createStyleLedger` reads `.style` at construction and writes through it on every `set`, so
    // opening one here would not degrade — it would throw, on a page that is otherwise fine.
    const styleless = { hasAttribute: () => false, getAttribute: () => null } as unknown as Element

    expect(styleOf(ledgers, styleless)).toBeNull()
    expect(asked).toEqual([])

    // The guard's other two answers, so the `null` above reads as a decision rather than as this
    // helper never returning anything.
    expect(styleOf(ledgers, null)).toBeNull()
    expect(styleOf(ledgers, undefined)).toBeNull()
    const real = document.createElement('div')
    expect(styleOf(ledgers, real)).not.toBeNull()
    expect(asked).toEqual([real])
  })
})

describe('the shared per-element registry', () => {
  it('reports exactly the elements it asked for, once each, and nothing once it has let go', () => {
    const host = document.createElement('div')
    const a = document.createElement('div')
    const b = document.createElement('div')
    document.body.append(host, a, b)
    const ledgers = createAdvancedLedgers(host)

    expect(ledgers.elements()).toEqual([])
    ledgers.style(a)
    ledgers.style(b)
    // Asked twice, claimed once: the registry memoises, and a leak assertion counting this element
    // twice would be reading the number of writes rather than the number of elements held.
    ledgers.style(a)
    expect(ledgers.elements()).toEqual([a, b])

    // A second controller's claim on the same element is not this one's. The *entry* is shared —
    // that is the whole point of the registry — but the claim is per controller.
    const other = createAdvancedLedgers(host)
    other.style(b)
    expect(ledgers.elements()).toEqual([a, b])
    expect(other.elements()).toEqual([b])

    // A snapshot, not the live set: a caller holding the answer must not see it change underneath.
    const snapshot = ledgers.elements()
    const c = document.createElement('div')
    ledgers.style(c)
    expect(snapshot).toEqual([a, b])
    expect(ledgers.elements()).toEqual([a, b, c])

    ledgers.restore()
    expect(ledgers.elements()).toEqual([])
    other.restore()
    expect(other.elements()).toEqual([])
    host.remove()
    a.remove()
    b.remove()
  })

  it('finishes a restore that threw partway, instead of tripping over the element it already gave back', () => {
    const host = document.createElement('div')
    const hostile = document.createElement('div')
    const ordinary = document.createElement('div')
    document.body.append(host, hostile, ordinary)

    const ledgers = createAdvancedLedgers(host)
    ledgers.style(hostile).set('opacity', '0.5')
    ledgers.style(ordinary).set('opacity', '0.25')

    // `createStyleLedger.restore()` ends by removing the `style` attribute it never found there.
    // Anything on the element can make that throw — a stubbed-out attribute API, an extension's
    // patched prototype, a `MutationObserver` callback that throws in the same task. What matters
    // is only that it throws *after* the entry has been deleted, which is where the guard lives.
    hostile.removeAttribute = (): never => {
      throw new Error('teardown blew up')
    }

    expect(() => ledgers.restore()).toThrow('teardown blew up')
    // The hostile element got its markup back before the throw...
    expect(hostile.style.opacity).toBe('')
    // ...and its neighbour, later in the claim set, was never reached at all.
    expect(ordinary.style.opacity).toBe('0.25')

    // The retry is the case under test. It must skip the element whose entry the failed attempt
    // already consumed — restoring that one twice would put this library's own value back as the
    // author's — and it must still finish the ones the failure cost.
    expect(() => ledgers.restore()).not.toThrow()
    expect(ordinary.style.opacity).toBe('')
    expect(ordinary.hasAttribute('style')).toBe(false)

    host.remove()
    hostile.remove()
    ordinary.remove()
  })
})
