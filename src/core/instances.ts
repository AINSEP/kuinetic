import { createCssControl } from './control.js'
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
 * Select only CSS animation handles emitted by the compiled kUInetic plan.
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
 * Settle an instance's completion once every animation it just started has ended.
 *
 * A module-level helper rather than a closure inside `createCssInstance` only so that function
 * stays under the 60-line ceiling `eslint.config.js` enforces; `settle` is passed as a thunk
 * because the instance replaces its own resolver on every activation, and capturing the current
 * one here would settle a promise two replays out of date.
 *
 * @param animations - Owned handles started by this activation. An empty list settles at once —
 *   there is nothing to wait for, and leaving it open strands `data-kui-state` on "running".
 * @param settle - Reads the instance's *current* resolver each time it is called.
 * @complexity O(a) time in animations; O(a) space for the composed promise.
 * @overallScore 100
 */
function watchCompletion(animations: Animation[], settle: () => void): void {
  if (animations.length === 0) {
    settle()
    return
  }
  // Cancellation resolves rather than rejects, so callers are not forced into try/catch for the
  // ordinary case of an effect being torn down.
  void Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => settle())
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
// Closure over one element's playback state (`finished`, `settle`, `activatedBefore`); the body is
// a handful of small named operations sharing that state, not one long procedure. Splitting them
// into free functions would mean threading a mutable state object through every one of them, which
// is more code and less readable, not less.
// eslint-disable-next-line max-lines-per-function
export function createCssInstance(
  el: Element,
  ledger: StyleLedger,
  animationNames: readonly string[],
  scrubbed = false,
): EffectInstance {
  const ownedNames = new Set(animationNames)
  let settle: (() => void) | undefined
  let finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  let activatedBefore = false
  const watch = (animations: Animation[]): void => watchCompletion(animations, () => settle?.())

  /**
   * Drive the owned animations in one direction from wherever they currently sit.
   *
   * This is what an exit half of a paired activation (`on="pointerenter/pointerleave"`) is built
   * on, and it is deliberately *not* `Animation.reverse()`. `reverse()` flips whatever the current
   * playback rate happens to be, so it means "turn around" — correct for the click-toggle in
   * `activate()` below, and wrong here, where two `pointerleave`s in a row must both mean "play
   * out" rather than the second one playing back in. Setting the rate absolutely makes an exit
   * idempotent, which is what an author gets when a pointer skims the edge of an element.
   *
   * `animation-fill-mode: both` is already on the compiled declaration, so a run that reaches time
   * 0 holds the from-state rather than snapping to the element's rest state — the exit lands
   * exactly where the entrance began.
   *
   * @complexity O(a) time in the element's owned animations; O(1) space.
   * @overallScore 100
   */
  function drive(rate: number): void {
    // A scrubbed effect (`timeline: pin`) has no playhead to drive: its frame is a pure function
    // of `--kui-progress` through the compiled negative `animation-delay`. Playing it in either
    // direction would hand it to the document timeline on top of the seek — the same trap
    // `activate()` guards against below. Re-arming `finished` for a run that will never happen
    // would also strand `data-kui-state`, so bail before touching either.
    if (scrubbed) return
    const animations = ownedAnimationsOf(el, ownedNames)
    finished = new Promise((resolve) => {
      settle = resolve
    })
    for (const animation of animations) {
      animation.playbackRate = rate
      animation.play()
    }
    watch(animations)
  }

  return {
    // Attached unconditionally, including for a scrubbed instance. Whether control is *allowed*
    // here is a policy question about the element's timeline, not a capability question about this
    // instance — a scrubbed animation has a perfectly real playhead, it just belongs to the
    // scroller. Keeping that decision in one place (`InstanceState.progressDriven`, read by
    // `control.ts`) beats splitting it across both files and letting them drift.
    control: createCssControl(() => ownedAnimationsOf(el, ownedNames), ledger),
    activate() {
      finished = new Promise((resolve) => {
        settle = resolve
      })
      // A scrubbed effect (`timeline: pin`) has no notion of starting. Its frame is a pure
      // function of `--kui-progress` via the compiled negative `animation-delay`, so writing
      // `running` here would not "begin" it — it would hand it to the document timeline and let
      // it play forward in wall-clock time on top of the seek. It is also already at its correct
      // first frame the moment the declaration lands, so there is nothing to restart. Settle
      // `finished` immediately: a scrub never completes in the time sense, and leaving the
      // promise open would strand `data-kui-state` on "running" for the life of the page.
      if (scrubbed) {
        settle?.()
        return
      }
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
    play() {
      drive(1)
    },
    reverse() {
      drive(-1)
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
 * What a *finite* JS primitive's setup returns instead of a bare teardown.
 *
 * A continuous primitive — a drag handler, a pin, an ambient loop — has no end, so it returns a
 * plain `Cleanup` and keeps the immediately-resolved `finished` every caller composing
 * `Promise.all` over an element's instances already relies on. Only an effect that genuinely
 * completes needs to say so, and only that effect pays for it.
 */
export interface TimedSetup {
  cleanup: Cleanup
  /**
   * Resolves when the effect's own work is done. A setup that loops forever should hand over a
   * promise that never resolves — the same contract an `animation-iteration-count: infinite` CSS
   * effect already has, since its `Animation.finished` never resolves either.
   */
  finished: Promise<void>
  /** Jump to the end state, for `EffectInstance.finish()`. */
  finish?: () => void
}

/**
 * What a setup returns when its effect genuinely never ends — a pin, a scroll progress track, a
 * media scrub, a drag handler.
 *
 * This exists because a bare `Cleanup` is ambiguous, and the ambiguity matters. Ten setups in the
 * catalog return one meaning *"there was nothing to do"* — no words to cycle, no fine pointer to
 * follow, a stage that could not be built — and for those, "no completion pending" is the honest
 * report. A pin returns the same shape meaning *"this will still be running an hour from now"*.
 * Reading the two as one thing is what made the fix for D9 regress the other ten; saying which you
 * are is cheap and the only thing that actually distinguishes them.
 */
export interface ContinuousSetup {
  cleanup: Cleanup
  continuous: true
}

/**
 * Mark a teardown as belonging to an effect that never ends.
 *
 * Wrap only the return that means the effect actually started something perpetual — leave an early
 * "nothing to do" bail-out as a bare `Cleanup`, which is what keeps the two distinguishable.
 *
 * @param cleanup - The effect's own teardown.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function continuousSetup(cleanup: Cleanup): ContinuousSetup {
  return { cleanup, continuous: true }
}

/** A deferred setup's return: a teardown, optionally with a completion or a never-ends marker. */
export type SetupResult = Cleanup | TimedSetup | ContinuousSetup

function cleanupOf(result: SetupResult | undefined): Cleanup | undefined {
  if (result === undefined) return undefined
  return typeof result === 'function' ? result : result.cleanup
}

/**
 * Turn setup-that-also-starts into a properly gated instance.
 *
 * Most JS primitives are naturally written as "wire it up and go" — subscribe to the scheduler,
 * attach listeners, write the first style. Deferring that whole body until `activate()` is what
 * makes them obey `on:enter`, `on:click`, `manual`, and `reducedMotion: 'disable'` without each
 * primitive having to implement gating itself.
 *
 * @param setup - Runs on activation; returns its own teardown, optionally with its completion.
 * @returns An instance that does nothing until activated.
 * @complexity O(1) beyond the setup itself.
 * @overallScore 100
 */
export function deferredInstance(setup: () => SetupResult): EffectInstance {
  let running: SetupResult | undefined
  let settle: (() => void) | undefined
  let finished = Promise.resolve()

  const teardown = (): void => {
    cleanupOf(running)?.()
    running = undefined
    settle?.()
  }

  return createJsInstance({
    activate() {
      running = setup()
      if (typeof running === 'function' || 'continuous' in running) return
      // Installed here rather than at construction because whether this effect finishes at all is
      // only knowable once its setup has actually started it.
      const work = running.finished
      finished = new Promise((resolve) => {
        settle = resolve
      })
      void work.then(() => settle?.())
    },
    cancel: teardown,
    finish() {
      // Only a `TimedSetup` can jump to an end state; a continuous effect has none to jump to.
      if (typeof running === 'object' && 'finish' in running) running.finish?.()
      settle?.()
    },
    destroy: teardown,
    finished: () => finished,
    // Only an explicit marker counts. A bare `Cleanup` deliberately does not — see
    // `ContinuousSetup` above for why the two cannot be told apart by shape.
    continuous: () => typeof running === 'object' && 'continuous' in running,
  })
}

/**
 * Wrap a `(el, params, ctx) => SetupResult`-shaped setup function as a deferred
 * `Primitive['prepare']`.
 *
 * Every JS primitive's `prepare` is `deferredInstance(() => setup(...args))` — this names that
 * composition once instead of re-deriving it at each of the library's fourteen call sites.
 *
 * @complexity O(1) time and space beyond the wrapped call.
 * @overallScore 100
 */
export function deferPrepare<Args extends unknown[]>(
  setup: (...args: Args) => SetupResult,
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
  /**
   * Resolve when the effect completes. Continuous effects may simply never resolve.
   *
   * Read on every access rather than captured once, so a setup that only learns its own completion
   * at activation time can swap in a real promise — the animator and `play()` both read
   * `finished` after `activate()`, never before.
   */
  finished?(): Promise<void>
  /**
   * Whether this effect never ends. Read on every access, for the same reason as `finished`: a
   * deferred setup only learns which kind it is once it has run. See `EffectInstance.continuous`.
   */
  continuous?(): boolean
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
      // Flipped only once `hooks.activate()` returns, not before it runs: `Animator.activate()`
      // now catches a throw from here (see animator.ts) and may retry a later explicit
      // `activate()` call on the same instance. Marking `active` first meant a throwing setup
      // left this instance permanently stuck "active" with nothing actually running — every
      // future `activate()` call became a silent no-op via the guard above, with no way back in.
      hooks.activate()
      active = true
    },
    cancel() {
      hooks.cancel?.()
      active = false
    },
    finish() {
      hooks.finish?.()
    },
    get finished() {
      return hooks.finished?.() ?? Promise.resolve()
    },
    get continuous() {
      return hooks.continuous?.() ?? false
    },
    destroy() {
      active = false
      hooks.destroy()
    },
  }
}
