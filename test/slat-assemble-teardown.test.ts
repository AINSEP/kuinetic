import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/**
 * A pending `land()` timer must never outlive `destroy()`.
 *
 * `prepareSlatAssemble`'s `cleanup` already calls `ctx.win.clearTimeout(timer)` before restoring —
 * this file exists to pin that down as a contract, not to introduce it. The browser teardown sweep
 * (`test/browser/teardown-sweep.test.mjs`) reported `slat-assemble` leaving `style=""` on its
 * source `<img>`, and the first hypothesis was that the sweep's reused `#stage` let a stale timer
 * from an earlier iteration write into a later one's markup. That hypothesis does not survive
 * contact with a browser: the leak reproduces with a single `slat-assemble` application, on its
 * own `land()` timer, with no `destroy()` and no second iteration anywhere — see
 * `src/core/owned-styles.ts`'s `restore()` for the real cause, a lazily-synced `style` attribute
 * that a bare `style.length` check can race. That fix lives in the shared ledger, not here.
 *
 * This file still earns its place: "does a torn-down instance's timer ever write again" is a real
 * question independent of that bug, and `fakeCtx`'s `PrepareContext` shape matches
 * `catalog-media-js.test.ts`'s, the file that already owns every other `slat-assemble` behaviour.
 */
function fakeCtx(el: Element, win: Window & typeof globalThis = window): PrepareContext {
  return { win, doc: win.document, style: createStyleLedger(el) } as unknown as PrepareContext
}

const registry = createRegistry()

describe('slat-assemble teardown', () => {
  it('destroy() before land() cancels the pending timer — it must never write after teardown', async () => {
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '4', duration: '100ms', stagger: '50ms' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.querySelector('.kui-slat-stage')).not.toBeNull()
    expect(img.style.visibility).toBe('hidden')

    // The `landed` guard inside `land()` already makes a second write harmless once `destroy()`
    // has run — so asserting DOM state alone here would pass even if the timer were left running.
    // What actually needs pinning down is that the timer itself stops existing: a scheduled
    // callback that never fires is the difference between "torn down" and "torn down, but the
    // event loop still has to wake up and no-op for it" on a page with hundreds of these.
    const pendingBefore = vi.getTimerCount()
    instance.destroy()
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    expect(img.style.visibility).toBe('')
    expect(img.hasAttribute('style')).toBe(false)
    expect(vi.getTimerCount()).toBeLessThan(pendingBefore)

    // Let the original delay elapse and then some. With the timer actually cancelled, nothing
    // should be scheduled to run at all.
    await vi.advanceTimersByTimeAsync(3 * 50 + 100 + 10_000)
    expect(vi.getTimerCount()).toBe(0)

    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    expect(img.style.visibility).toBe('')
    expect(img.hasAttribute('style')).toBe(false)
    vi.useRealTimers()
  })
})
