import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `word-cycler` swaps a word 150ms *after* each tick, and that second timeout is a separate,
 * independently cancellable thing from the interval `createStepRunner` owns.
 *
 * Teardown restores the author's own children, so a swap left queued fired afterwards and replaced
 * them with a cycling word — for up to 150ms the element looked torn down, and then silently
 * wasn't. These live in their own file rather than in `catalog-text-js.test.ts`, which is already
 * at its line cap.
 */

/** Only `win`, `doc`, and `style` are read by this primitive; a partial fake is enough. */
function fakeCtx(el: Element): PrepareContext {
  return { win: window, doc: document, style: createStyleLedger(el) } as unknown as PrepareContext
}

const registry = catalogRegistry()

describe('word-cycler teardown', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /**
   * Build a cycler over authored *element* children, so an overwrite after teardown shows up as
   * markup rather than as text that happens to match.
   */
  function startCycler(interval: string) {
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.innerHTML = '<em>placeholder</em>'
    const authored = el.innerHTML
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ words: 'alpha|beta|gamma', interval }),
      fakeCtx(el),
    )
    return { el, authored, instance }
  }

  // The interval is varied because the swap window is a fixed 150ms while `interval:` is the
  // author's: a regression test pinned to one interval says nothing about the rest of the range,
  // and the sub-150ms end behaves differently again (see the overlap case below).
  it.each([200, 600, 2500])(
    'does not let a swap queued at interval:%dms overwrite content restored by destroy',
    (interval) => {
      const { el, authored, instance } = startCycler(`${interval}ms`)

      instance.activate()
      // Land inside the 150ms swap window: the fade-out class is on, the word swap is still queued.
      vi.advanceTimersByTime(interval + 50)
      expect(el.classList.contains('kui-word-cycler-swap')).toBe(true)

      instance.destroy()
      expect(el.innerHTML).toBe(authored)

      // The queued swap's due time now passes with the effect already torn down.
      vi.advanceTimersByTime(500)
      expect(el.innerHTML).toBe(authored)
    },
  )

  it('cancels every queued swap, not just the newest, when the interval is shorter than the fade', () => {
    // At 50ms three ticks fire before the first swap (due at 200ms) comes round, so three are
    // genuinely pending at once — the case a single "latest handle" would still leak.
    const { el, authored, instance } = startCycler('50ms')

    instance.activate()
    vi.advanceTimersByTime(175)

    instance.destroy()
    expect(el.innerHTML).toBe(authored)

    vi.advanceTimersByTime(500)
    expect(el.innerHTML).toBe(authored)
  })

  it('finish() during a swap settles on a readable word instead of a queued one', () => {
    const { el, instance } = startCycler('1000ms')

    instance.activate()
    vi.advanceTimersByTime(1050)
    expect(el.classList.contains('kui-word-cycler-swap')).toBe(true)

    instance.finish()
    // The pending swap would have removed the fade class; finishing has to do it instead, or the
    // element is left permanently mid-fade.
    expect(el.classList.contains('kui-word-cycler-swap')).toBe(false)
    expect(el.textContent).toBe('alpha')

    vi.advanceTimersByTime(500)
    expect(el.textContent).toBe('alpha')

    instance.destroy()
  })
})
