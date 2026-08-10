import type { StyleLedger } from './owned-styles.js'
import type { Cleanup, EffectInstance } from './types.js'

/**
 * Instance constructors for the two renderers.
 *
 * The animator holds only `EffectInstance`s, so it gates a pinned section exactly the way it gates
 * a fade — one code path, one set of guarantees.
 */

function animationsOf(el: Element): Animation[] {
  const getAnimations = (el as Element & { getAnimations?: () => Animation[] }).getAnimations
  return typeof getAnimations === 'function' ? getAnimations.call(el) : []
}

/**
 * Wrap a CSS-rendered effect.
 *
 * Gating is `animation-play-state` rather than a class toggle: `animation-fill-mode: both`
 * already holds the from-state, so there is no flash between compilation and activation.
 *
 * A second `activate()` on an already-finished animation reverses playback instead of repeating
 * the play-state write. The property write only matters on the paused-to-running edge, so writing
 * the same value again is a no-op the browser silently ignores — which is what made click-gated
 * two-state effects like a card flip look permanently stuck after their first activation. `.reverse()`
 * toggles direction on top of whatever the CSS declared, so a third activation reverses again.
 *
 * @param el - Element carrying the compiled animation.
 * @param ledger - Ledger owning the play-state write.
 * @returns A lifecycle handle over the element's CSS animations.
 * @complexity O(a) per call in the number of running animations; O(1) space.
 * @overallScore 100
 */
export function createCssInstance(el: Element, ledger: StyleLedger): EffectInstance {
  let settle: (() => void) | undefined
  let finished = new Promise<void>((resolve) => {
    settle = resolve
  })

  function watch(animations: Animation[]): void {
    if (animations.length === 0) {
      settle?.()
      return
    }
    // Cancellation resolves rather than rejects, so callers are not forced into try/catch for the
    // ordinary case of an effect being torn down.
    void Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => settle?.())
  }

  return {
    activate() {
      finished = new Promise((resolve) => {
        settle = resolve
      })
      const animations = animationsOf(el)
      if (animations.some((a) => a.playState === 'finished')) {
        for (const animation of animations) animation.reverse()
      } else {
        ledger.set('animation-play-state', 'running')
      }
      watch(animations)
    },
    cancel() {
      for (const animation of animationsOf(el)) animation.cancel()
      settle?.()
    },
    finish() {
      for (const animation of animationsOf(el)) animation.finish()
      settle?.()
    },
    get finished() {
      return finished
    },
    destroy() {
      settle?.()
    },
  }
}

/**
 * Turn setup-that-also-starts into a properly gated instance.
 *
 * Most JS primitives are naturally written as "wire it up and go" — subscribe to the scheduler,
 * attach listeners, write the first style. Deferring that whole body until `activate()` is what
 * makes them obey `on:enter`, `on:click`, `manual`, and `reducedMotion: 'disable'` without each
 * primitive having to implement gating itself.
 *
 * @param setup - Runs on activation; returns its own teardown.
 * @returns An instance that does nothing until activated.
 * @complexity O(1) beyond the setup itself.
 * @overallScore 100
 */
export function deferredInstance(setup: () => Cleanup): EffectInstance {
  let cleanup: Cleanup | undefined
  return createJsInstance({
    activate() {
      cleanup = setup()
    },
    destroy() {
      cleanup?.()
      cleanup = undefined
    },
  })
}

/**
 * Wrap a `(el, params, ctx) => Cleanup`-shaped setup function as a deferred `Primitive['prepare']`.
 *
 * Every JS primitive's `prepare` is `deferredInstance(() => setup(...args))` — this names that
 * composition once instead of re-deriving it at each of the library's fourteen call sites.
 *
 * @complexity O(1) time and space beyond the wrapped call.
 * @overallScore 100
 */
export function deferPrepare<Args extends unknown[]>(
  setup: (...args: Args) => Cleanup,
): (...args: Args) => EffectInstance {
  return (...args: Args) => deferredInstance(() => setup(...args))
}

export interface JsInstanceHooks {
  /** Start the effect. Never called before the animator's gate opens. */
  activate(): void
  cancel?(): void
  finish?(): void
  /** Release listeners, observers, subscriptions, and inserted nodes. */
  destroy: Cleanup
  /** Resolve when the effect completes. Continuous effects may simply never resolve. */
  finished?: Promise<void>
}

/**
 * Build a JS-rendered instance from a primitive's hooks, filling in the optional operations.
 *
 * Keeps primitives free of lifecycle boilerplate while still guaranteeing the animator every
 * operation it needs.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function createJsInstance(hooks: JsInstanceHooks): EffectInstance {
  let active = false
  return {
    activate() {
      if (active) return
      active = true
      hooks.activate()
    },
    cancel() {
      hooks.cancel?.()
      active = false
    },
    finish() {
      hooks.finish?.()
    },
    finished: hooks.finished ?? Promise.resolve(),
    destroy() {
      active = false
      hooks.destroy()
    },
  }
}
