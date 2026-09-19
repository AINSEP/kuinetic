// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
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
 * `createStyleClaim`'s `release` drops the element from this owner's claim one line *before* the
 * restore that may throw, so a ledger that blows up on the way out is one-shot: its entry is gone
 * and no later owner can be the last one out of it. That makes it the sweep's job to reach every
 * *other* element anyway, in the same call, because there is no second chance for any of them
 * either — `createEffectInstance.destroy()` latches `isDestroyed` before it calls `opts.destroy()`,
 * so a controller cannot be destroyed twice. A state no controller can produce on purpose and every
 * controller can land in by accident.
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

  /**
   * The split-bundle contract, which is the only reason this wrapper exists separately from
   * `core/owned-styles.ts`'s registry at all.
   *
   * `scripts/build-tiers.mjs` builds `kuinetic.advanced.js` from its own entry point, so it
   * inlines its own copy of `owned-styles.ts`. Two copies of the *code* is fine; two registries is
   * not, and a module-level `WeakMap` would give exactly that. What makes the copies agree is that
   * the registry is not in either of them — it is on the element, under a key both copies compute
   * from the runtime's own global symbol registry. That is the property asserted here, because it
   * is the one thing a single-bundle test run cannot otherwise observe.
   */
  it('keeps its capture on the element, where a separately bundled core finds the same one', () => {
    const host = document.createElement('div')
    document.body.append(host)
    host.style.setProperty('opacity', '0.2', 'important')

    const ledgers = createAdvancedLedgers(host)
    ledgers.style(host).set('opacity', '0.7')

    // The key a second bundle's copy of `owned-styles.ts` computes — `Symbol.for` reads through
    // the runtime's registry, so it is the same symbol object there as here, whatever order the
    // script tags loaded in. If this capture ever moves back into module scope this goes
    // undefined, and the two bundles are silently back to one capture each.
    const onElement = (host as unknown as Record<symbol, Map<string, unknown> | undefined>)[
      Symbol.for('kuinetic.owned-styles.1')
    ]
    expect(onElement?.get('style')).toBeDefined()
    // Invisible to the author: not enumerable, not serialized, not in the markup.
    expect(Object.keys(host)).toEqual([])
    expect(host.outerHTML).toBe('<div style="opacity: 0.7;"></div>')

    ledgers.restore()
    expect(host.style.opacity).toBe('0.2')
    expect(host.style.getPropertyPriority('opacity')).toBe('important')
    // Gone with the last owner, rather than left behind as a stale entry the next effect adopts.
    expect(onElement?.get('style')).toBeUndefined()
    host.remove()
  })

  /**
   * Release order, asserted as *what the subtree looked like at the instant the host was let go*
   * rather than as a call order — the same claim `createLedgerSet` makes and for the same reason.
   * Controllers ask for the host first and their found elements afterwards, so a `restore()` that
   * simply replays the order it was asked in passes every other case in this file.
   */
  it('gives the host back last, after every element it reached through it', () => {
    const host = document.createElement('div')
    const layer = document.createElement('div')
    host.append(layer)
    document.body.append(host)

    const ledgers = createAdvancedLedgers(host)
    ledgers.style(host).set('perspective', '800px')
    ledgers.style(layer).set('transform', 'translateZ(5px)')

    let layerAtHostRelease: string | null = 'never observed'
    const realRemove = host.removeAttribute.bind(host)
    vi.spyOn(host, 'removeAttribute').mockImplementation((name: string) => {
      if (name === 'style') layerAtHostRelease = layer.getAttribute('style')
      realRemove(name)
    })

    ledgers.restore()

    expect(layerAtHostRelease).toBe(null)
    expect(host.outerHTML).toBe('<div><div></div></div>')
    host.remove()
  })

  it('finishes the sweep past an element that threw, and reports every failure together', () => {
    const host = document.createElement('div')
    const firstHostile = document.createElement('div')
    const ordinary = document.createElement('div')
    const secondHostile = document.createElement('div')
    document.body.append(host, firstHostile, ordinary, secondHostile)

    const ledgers = createAdvancedLedgers(host)
    // Written host-first, so the claim set is walked in exactly the order a controller produces:
    // `applyStage` asks for the container before it touches anything it found.
    ledgers.style(host).set('perspective', '900px')
    ledgers.style(firstHostile).set('opacity', '0.5')
    ledgers.style(ordinary).set('opacity', '0.25')
    ledgers.style(secondHostile).set('opacity', '0.75')

    // `createStyleLedger.restore()` ends by removing the `style` attribute it never found there.
    // Anything on the element can make that throw — a stubbed-out attribute API, an extension's
    // patched prototype, a `MutationObserver` callback that throws in the same task. What matters
    // is only that it throws *after* the entry has been deleted, so the element is unrecoverable
    // and every other element in the sweep must not be made unrecoverable with it.
    const blowUp = (name: string) => (): never => {
      throw new Error(`teardown blew up on ${name}`)
    }
    firstHostile.removeAttribute = blowUp('first')
    secondHostile.removeAttribute = blowUp('second')

    let thrown: unknown
    try {
      ledgers.restore()
    } catch (error) {
      thrown = error
    }

    // Reported, not swallowed: an element this library could not hand back is worth saying so
    // about. Aggregated, so the first failure does not hide the second.
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).message).toBe('kuinetic: 2 element(s) could not be given back')
    expect((thrown as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'teardown blew up on first',
      'teardown blew up on second',
    ])

    // The finding, in one call rather than two. Each hostile element got its properties back before
    // its own throw, the ordinary element *between* them was reached anyway, and so was the host —
    // released last, after everything reached through it, exactly as when nothing throws.
    expect(firstHostile.style.opacity).toBe('')
    expect(secondHostile.style.opacity).toBe('')
    expect(ordinary.style.opacity).toBe('')
    expect(ordinary.hasAttribute('style')).toBe(false)
    expect(host.style.perspective).toBe('')
    expect(host.hasAttribute('style')).toBe(false)

    // Nothing is left holding a claim, so a second `restore()` is a no-op rather than a second
    // unwind — writing this library's own values back as if they were the author's. The author
    // value below is written *after* teardown and must survive it untouched.
    ordinary.style.opacity = '0.9'
    expect(() => ledgers.restore()).not.toThrow()
    expect(ledgers.elements()).toEqual([])
    expect(ordinary.style.opacity).toBe('0.9')

    host.remove()
    firstHostile.remove()
    ordinary.remove()
    secondHostile.remove()
  })
})
