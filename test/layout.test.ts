import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'

/**
 * Regression coverage for the layout primitives' resource-teardown discipline.
 *
 * `prepareIndicator` previously subscribed its attribute watcher *before* calling `move()`, which
 * can throw (a malformed `follow` selector reaches `querySelector` directly). A throw from `move()`
 * meant the primitive's setup never reached its `return stop` line, so the caller — `deferredInstance`
 * in `core/instances.ts` — never received a cleanup to run. The subscription was live and nothing
 * could ever disconnect it. See `flip-indicator` below.
 */

/** Only `doc` and `style.set` are read by these primitives; a partial fake is enough. */
function fakeCtx(): PrepareContext {
  return {
    doc: document,
    win: window,
    style: { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] },
  } as unknown as PrepareContext
}

const flipIndicator = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'flip-indicator')!

describe('flip-indicator', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves no live MutationObserver subscription when the first move() throws', () => {
    // A fake standing in for the global constructor, so the test can count subscribe/teardown
    // calls instead of only asserting "it didn't crash" — the crash is already handled by
    // `Animator.activate()`'s per-instance isolation. What matters here is the resource.
    let observeCalls = 0
    let disconnectCalls = 0
    class FakeMutationObserver {
      observe(): void {
        observeCalls++
      }
      disconnect(): void {
        disconnectCalls++
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const el = document.createElement('div')
    // `]` is not a parseable selector; `ctx.doc.querySelector(selector)` throws synchronously,
    // so `move()` throws on its very first, unconditional call inside `prepareIndicator`.
    const params = createParams({
      follow: ']',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const instance = flipIndicator.prepare!(el, params, fakeCtx())

    expect(() => instance.activate()).toThrow()

    // Whatever the primitive did internally, it must not end up with a subscription that nothing
    // can reach: every `observe()` must be matched by a `disconnect()` by the time activation has
    // finished unwinding.
    expect(observeCalls).toBe(disconnectCalls)
  })

  it('still follows its target on a working selector', () => {
    const el = document.createElement('div')
    const target = document.createElement('button')
    target.id = 'active-tab'
    document.body.append(el, target)

    const params = createParams({
      follow: '#active-tab',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const setSpy = vi.fn()
    const ctx = {
      ...fakeCtx(),
      style: { set: setSpy, claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    } as unknown as PrepareContext

    const instance = flipIndicator.prepare!(el, params, ctx)
    expect(() => instance.activate()).not.toThrow()
    expect(setSpy).toHaveBeenCalledWith('translate', expect.any(String))

    instance.destroy()
    target.remove()
    el.remove()
  })
})
