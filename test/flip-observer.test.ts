import { describe, expect, it, vi } from 'vitest'
import { createFlipEngine, mutationWatcher, observeLayout } from '../src/core/flip.js'

/**
 * Every test in flip.test.ts drives `observeLayout` through an injected fake `observe` callback,
 * called synchronously by the test itself. That is legitimate for exercising the FLIP math, but it
 * never proves anything about the real `MutationObserver` — whose callback runs as a MICROTASK,
 * after the mutation has already been applied and layout has resolved.
 *
 * FLIP needs the pre-mutation ("first") box. `observeLayout` captures `before` via closure, once at
 * setup and once again at the end of each callback (src/core/flip.ts:211-215) — never by reading
 * geometry fresh inside the callback. So the real observer's post-mutation timing should not be
 * able to corrupt "first": by the time the callback fires, `before` already holds whatever was
 * measured before this mutation happened, and only the `measure` call for "last" runs late.
 *
 * This test uses jsdom's real `MutationObserver` (via the real `mutationWatcher`, not a fake) to
 * check that holds. jsdom reports zero rects, so `getBoundingClientRect` is stubbed to move with a
 * plain variable — exactly the way `test/support/scroll-mechanics-harness.ts`'s `stubRect` stubs a
 * single fixed value, except here it changes at the moment of mutation, the way a real browser's
 * layout would already have changed by the time anything reads it afterward.
 */

describe('observeLayout against a real MutationObserver', () => {
  it('keeps "first" as the pre-mutation box, even though the callback fires after the DOM has changed', async () => {
    const container = document.createElement('ul')
    const child = document.createElement('li')
    container.append(child)
    document.body.append(container)

    let top = 0
    child.getBoundingClientRect = () =>
      ({ top, left: 0, width: 100, height: 50, bottom: top + 50, right: 100 }) as DOMRect

    const captured: Keyframe[][] = []
    const engine = createFlipEngine({
      animate: (_el, keyframes) => {
        captured.push(keyframes)
        return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation
      },
    })

    // Real observer, not the fake `(callback) => cleanup` most flip.test.ts cases inject.
    const cleanup = observeLayout(container, engine, {}, mutationWatcher(container))

    // A real reorder and its layout consequence happen together, synchronously, well before the
    // observer's microtask runs — this mirrors that: the mutation and the position change land in
    // the same synchronous turn.
    top = 100
    container.append(document.createComment('reorder'))

    expect(captured).toHaveLength(0) // nothing has run yet; the callback is still queued

    // MutationObserver callbacks are microtasks; flushing the microtask queue is enough, no timer
    // needed.
    await Promise.resolve()
    await Promise.resolve()

    expect(captured).toHaveLength(1)
    // If "first" had been read inside the callback (after the mutation), it would already be 100
    // and this delta would be 0 — no motion, nothing captured. Getting -100 here proves "first" was
    // still the pre-mutation 0.
    expect(captured[0]?.[0]).toMatchObject({ translate: '0px -100px' })
    expect(captured[0]?.[1]).toMatchObject({ translate: '0px 0px' })

    cleanup()
  })
})
