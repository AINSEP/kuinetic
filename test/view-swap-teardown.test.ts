// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCapabilities } from '../src/core/capabilities.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `view-swap` with a `delay:` runs its attribute flip on a `setTimeout`, and that timer is a
 * separate, independently cancellable thing from the click listener that scheduled it.
 *
 * The handle used to be discarded — `ctx.win.setTimeout(...)` with the returned `Cleanup` being
 * `() => {}`. `ctx.signal` removes the listener on teardown but cannot reach a timer already in
 * flight, so a control torn down inside its own delay window still fired: the swap wrote `data-open`
 * onto a target the effect no longer owned, and started a view transition on a page that had moved
 * on. Every other `ctx.win.setTimeout` in `src/` captures and clears its handle; this one now does
 * too, using the same set-of-pending-handles shape `word-cycler` (`catalog/text.ts`) settled on.
 *
 * Found by two independent auditors in the 2026-09-08 catalog review. These live in their own file
 * rather than in `catalog-view-transitions.test.ts`, which is already at its line cap — the same
 * split, for the same reason, as `word-cycler-teardown.test.ts`.
 */

const registry = catalogRegistry()

/** Records every transition the swap starts, and runs the update immediately. */
let started: unknown[] = []

/** Only `win`, `doc`, `capabilities`, `signal`, `style` and `warn` are read here. */
function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: document,
    capabilities: defaultCapabilities({ viewTransitions: true }),
    reducedMotion: false,
    signal: new AbortController().signal,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

/** A control wired to a panel, with `view-swap` prepared and activated on it. */
function swapControl(delay: string) {
  document.body.innerHTML =
    '<button id="go" aria-controls="detail">Details</button><section id="detail"></section>'
  const control = document.getElementById('go')!
  const panel = document.getElementById('detail')!
  const resolved = registry.resolve('view-swap')!
  const instance = resolved.primitive.prepare!(control, createParams({ delay }), fakeCtx(control))
  instance.activate()
  return { control, panel, instance }
}

describe('view-swap teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    started = []
    ;(document as { startViewTransition?: unknown }).startViewTransition = (
      arg: (() => void) | { update: () => void },
    ) => {
      started.push(arg)
      if (typeof arg === 'function') arg()
      else arg.update()
      return {}
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (document as { startViewTransition?: unknown }).startViewTransition
    document.body.innerHTML = ''
  })

  // The delay is varied because it is the author's knob and a regression test pinned to one value
  // says nothing about the rest of the range — the same reason `word-cycler-teardown.test.ts`
  // sweeps its `interval:`.
  it.each(['80ms', '200ms', '1200ms'])(
    'does not let a swap queued at delay:%s fire after destroy',
    (delay) => {
      const { control, panel, instance } = swapControl(delay)

      control.click()
      expect(started, 'queued, not yet run').toHaveLength(0)

      instance.destroy()
      vi.advanceTimersByTime(5000)

      expect(started, 'the queued swap must not outlive teardown').toHaveLength(0)
      expect(panel.hasAttribute('data-open'), 'and nothing was written to the target').toBe(false)
    },
  )

  it('cancels every queued swap, not just the newest', () => {
    // Three clicks inside one delay window leave three timers genuinely pending at once — the case
    // a single "latest handle" would still leak, and the reason this is a set rather than a `let`.
    const { control, panel, instance } = swapControl('500ms')

    control.click()
    vi.advanceTimersByTime(100)
    control.click()
    vi.advanceTimersByTime(100)
    control.click()

    instance.destroy()
    vi.advanceTimersByTime(5000)

    expect(started).toHaveLength(0)
    expect(panel.hasAttribute('data-open')).toBe(false)
  })

  it('still runs a delayed swap that is left alone', () => {
    // The paired assertion, and not optional: clearing on teardown is only correct if the timer
    // fires otherwise. A `delay:` that never ran at all would pass every test above for entirely
    // the wrong reason.
    const { control, panel } = swapControl('200ms')

    control.click()
    expect(started, 'not yet — the delay has not elapsed').toHaveLength(0)

    vi.advanceTimersByTime(200)

    expect(started, 'an untouched delayed swap still fires').toHaveLength(1)
    expect(panel.hasAttribute('data-open')).toBe(true)
  })

  it('runs an undelayed swap synchronously, so the fix did not put every swap on a timer', () => {
    const { control, panel } = swapControl('0ms')

    control.click()

    expect(started, 'no delay means no timer at all').toHaveLength(1)
    expect(panel.hasAttribute('data-open')).toBe(true)
  })
})
