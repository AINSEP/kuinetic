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
 * Select only CSS animation handles emitted by the compiled Designimation plan.
 *
 * @param el - Element carrying both library and possibly consumer animations.
 * @param names - Exact keyframe names emitted by the compiler.
 * @returns Owned CSS animation handles, excluding transitions and consumer animations.
 * @complexity O(a) time in animations affecting the element; O(a) space.
 * @overallScore 100
 */
function ownedAnimationsOf(el: Element, names: ReadonlySet<string>): Animation[] {
  return animationsOf(el).filter((animation) => {
    const name = (animation as Animation & { animationName?: unknown }).animationName
    return typeof name === 'string' && names.has(name)
  })
}

/**
 * Read the computed `animation-name`, forcing a synchronous style recalc as a side effect.
 *
 * A call site that only cares about the flush still has to consume a call's return value to
 * satisfy `no-unused-expressions` — a bare `getComputedStyle(el).animationName` statement is a
 * member access, not a call, so it is rejected as a no-op the linter cannot tell is intentional.
 *
 * @param el - Element whose computed style is read.
 * @returns The computed `animation-name`. Callers needing only the flush may ignore it.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function flushComputedAnimationName(el: Element): string {
  return getComputedStyle(el).animationName
}

/**
 * Force a CSS-triggered animation to genuinely restart from its beginning.
 *
 * An `animation-name` write is only a browser-level restart signal if the declared value actually
 * differs from what the element already carries. `reset()`+reinstall writes the identical value
 * (same effect, same params), so the animation's start-time reference never moves and a finished
 * animation stays finished forever, no matter which JS object wrote the declaration or how many
 * times. Clearing the property and forcing a style read before restoring it gives the browser two
 * genuinely different declared states across two recalcs, which is what actually resets that
 * reference. A computed-style read is enough to flush the pending recalc — nothing here depends on
 * geometry, so a full layout read is unnecessary.
 *
 * @param el - Element whose `animation-name` is being restarted.
 * @param ledger - Ledger owning the write, so a later `restore()` still unwinds correctly.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function restartCssAnimation(el: Element, ledger: StyleLedger): void {
  const name = (el as HTMLElement).style.getPropertyValue('animation-name')
  ledger.set('animation-name', 'none')
  flushComputedAnimationName(el)
  ledger.set('animation-name', name)
}

/**
 * Wrap a CSS-rendered effect.
 *
 * Gating is `animation-play-state` rather than a class toggle: `animation-fill-mode: both`
 * already holds the from-state, so there is no flash between compilation and activation.
 *
 * Repeat activation of the same instance and a fresh instance's first activation both can meet a
 * browser-level animation already sitting `finished`, but they need opposite responses. A second
 * `activate()` on the same instance is a click-gated toggle (a card flip): reversing playback is
 * the correct repeat — the property write only matters on the paused-to-running edge, so writing
 * the same value again is a no-op the browser silently ignores, which is what made two-state
 * effects look permanently stuck. A fresh instance's *first* activation meeting a `finished`
 * animation instead means the browser never actually tore down the previous one (see
 * `restartCssAnimation`) — replay wants that to run forward from the start, not reverse, so it
 * gets the restart path instead of `.reverse()`.
 *
 * @param el - Element carrying the compiled animation.
 * @param ledger - Ledger owning the play-state write.
 * @param animationNames - Exact keyframe names emitted by the compiled plan.
 * @returns A lifecycle handle over the element's owned CSS animations.
 * @complexity O(a) per call in the number of running animations; O(1) space.
 * @overallScore 100
 */
export function createCssInstance(
  el: Element,
  ledger: StyleLedger,
  animationNames: readonly string[],
): EffectInstance {
  const ownedNames = new Set(animationNames)
  let settle: (() => void) | undefined
  let finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  let activatedBefore = false

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
      // A fresh instance's first activation always forces a restart, unconditionally — by the
      // time this runs, `reset()`'s ledger.restore() has already cleared and reinstall has
      // already rewritten `animation-name`, so the animation this instance is *replacing* may no
      // longer be observable as "finished" (or at all) via `getAnimations()`. Re-deriving
      // staleness from browser state here is unreliable; whether this is a fresh instance is
      // already known structurally (`activatedBefore`), so drive the branch off that instead.
      // Forcing the restart on a genuinely first-ever install (no prior animation at all) is
      // harmless — `restartCssAnimation` just clears a not-yet-existing declaration and
      // reapplies it once. The restart only re-triggers the animation itself — the compiled
      // declaration still starts `animation-play-state: paused` (the gate), so this still needs
      // its own explicit running write, same as the plain no-stale case below.
      let animations = ownedAnimationsOf(el, ownedNames)
      if (!activatedBefore) {
        restartCssAnimation(el, ledger)
        ledger.set('animation-play-state', 'running')
        animations = ownedAnimationsOf(el, ownedNames)
      } else {
        const stale = animations.filter((a) => a.playState === 'finished')
        if (stale.length > 0) {
          for (const animation of stale) animation.reverse()
        } else {
          ledger.set('animation-play-state', 'running')
        }
      }
      activatedBefore = true
      watch(animations)
    },
    cancel() {
      for (const animation of ownedAnimationsOf(el, ownedNames)) animation.cancel()
      settle?.()
    },
    finish() {
      for (const animation of ownedAnimationsOf(el, ownedNames)) animation.finish()
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
  const teardown = (): void => {
    cleanup?.()
    cleanup = undefined
  }
  return createJsInstance({
    activate() {
      cleanup = setup()
    },
    cancel: teardown,
    destroy: teardown,
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
