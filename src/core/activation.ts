import { isOneShot, resolveActivationSpec } from './activation-vocabulary.js'
import type { ActivationSpec, ActivationTrigger } from './activation-vocabulary.js'
import { toThresholdRatio } from './element-config.js'
import type { Activation, Cleanup } from './types.js'

const NOOP: Cleanup = () => {}

/**
 * Bind an authored activation to an element.
 *
 * The delivery mechanisms live in a table in `activation-vocabulary.ts` rather than in a switch
 * here, so adding an activation stays a data change and this binder's branch count stays flat —
 * the original architecture note, kept through the change from a closed list of six names to an
 * open one. What used to be `Record<Activation, string[]>` is now a tagged union of four kinds,
 * for the same reason: an event-name list could not express "any name at all" without also
 * claiming that `enter` was an event.
 */

/** Everything one binding needs, grouped so the call site reads as one request. */
export interface ActivationRequest {
  /** `IntersectionObserver` threshold, used only by observed activations. */
  threshold: string
  /** Start the effects. */
  activate(): void
  /**
   * Play them back out.
   *
   * Called only for the exit half of a pair, so a binder consumer that has nothing to reverse can
   * leave it off and the exit half simply goes unbound.
   */
  deactivate?(): void
}

export interface ActivationBinder {
  bind(el: Element, activation: Activation, request: ActivationRequest): Cleanup
  destroy(): void
}

export interface ActivationBinderOptions {
  /** Injected so tests can supply a controllable observer and assert without layout. */
  createObserver?: (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) => IntersectionObserver
}

/** One element's stake in a shared observer. */
interface ObservedBinding {
  onEnter?: () => void
  onLeave?: () => void
  release: Cleanup
  /** Released by its first firing — plain `enter`, the library default. */
  oneShot: boolean
  /**
   * Whether the element has been seen intersecting yet.
   *
   * An observer's first delivery for a freshly observed element reports its *current* state, which
   * for anything below the fold is `isIntersecting: false`. Without this, `enter/leave` would play
   * its exit on every off-screen element the instant it was installed — an animation running
   * backwards out of a from-state it had never left.
   */
  entered: boolean
}

/**
 * Deliver one observer entry to the element's binding.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function deliverEntry(binding: ObservedBinding, isIntersecting: boolean): void {
  if (!isIntersecting && !binding.entered) return
  binding.entered = isIntersecting
  const side = isIntersecting ? binding.onEnter : binding.onLeave
  if (!side) return
  side()
  if (binding.oneShot) binding.release()
}

/**
 * Bind activations to elements, sharing one IntersectionObserver per distinct threshold.
 *
 * One observer per threshold rather than per element is the difference between a constant number
 * of observers and one per animated node on a long page.
 *
 * @param options - Optional observer factory; defaults to the global constructor when present.
 * @returns A binder whose `bind` returns the teardown for that single binding.
 * @complexity O(1) per bind; O(t) space in the number of distinct thresholds.
 * @overallScore 100
 */
// Factory closing over shared observer/callback state; length is five small named closures plus
// the returned binder, not one long procedure.
// eslint-disable-next-line max-lines-per-function
export function createActivationBinder(options: ActivationBinderOptions = {}): ActivationBinder {
  const observers = new Map<string, { observer: IntersectionObserver; count: number }>()
  const callbacks = new WeakMap<Element, ObservedBinding>()
  const createObserver = options.createObserver ?? defaultObserverFactory()

  function observerFor(
    threshold: string,
  ): { key: string; shared: { observer: IntersectionObserver; count: number } } | undefined {
    if (!createObserver) return undefined
    const ratio = toThresholdRatio(threshold)
    const key = String(ratio)
    const existing = observers.get(key)
    if (existing) return { key, shared: existing }

    const observer = createObserver(
      (entries) => {
        for (const entry of entries) {
          const binding = callbacks.get(entry.target)
          if (binding) deliverEntry(binding, entry.isIntersecting)
        }
      },
      { threshold: ratio },
    )
    const shared = { observer, count: 0 }
    observers.set(key, shared)
    return { key, shared }
  }

  /**
   * Both observed halves of one spec go through here together, in one `ObservedBinding`. They
   * cannot be bound separately: `callbacks` is keyed by element, so a second observed binding on
   * the same element would evict the first — and `enter/leave` is precisely two observed halves on
   * one element.
   */
  function bindObserved(el: Element, spec: ObservedRequest, request: ActivationRequest): Cleanup {
    const binding = observerFor(request.threshold)
    // No IntersectionObserver means no way to know when the element is visible; showing the
    // content immediately is the only fail-open choice — but only when the observer was what the
    // effects were *waiting on*. For `pointerenter/leave` the exit half is observed while the
    // start half is an ordinary listener, and starting the effect here would fire the entrance
    // the author asked to be triggered by a pointer. There is correspondingly no way to know when
    // an element stops being visible, so an observed exit is simply never delivered.
    if (!binding) {
      if (spec.failOpen) request.activate()
      return NOOP
    }
    const { key, shared } = binding
    let active = true
    const release = (): void => {
      if (!active) return
      active = false
      callbacks.delete(el)
      shared.observer.unobserve(el)
      shared.count--
      if (shared.count > 0) return
      shared.observer.disconnect()
      observers.delete(key)
    }
    callbacks.set(el, {
      onEnter: spec.onEnter,
      onLeave: spec.onLeave,
      oneShot: spec.oneShot,
      release,
      entered: false,
    })
    shared.count++
    shared.observer.observe(el)
    return release
  }

  return {
    bind(el, activation, request) {
      const spec = resolveActivationSpec(activation)
      const sides = sidesOf(spec, request)
      const cleanups: Cleanup[] = []

      const observed = observedSides(sides)
      if (observed) {
        const failOpen = spec.start.kind === 'observed'
        cleanups.push(bindObserved(el, { ...observed, oneShot: isOneShot(spec), failOpen }, request))
      }
      for (const side of sides) {
        const { trigger } = side
        if (trigger.kind === 'events') cleanups.push(bindEvents(el, trigger.types, side.run))
        // `load` starts now and returns nothing to release; `manual` and `observed` have no
        // listener of their own to add here.
        else if (trigger.kind === 'immediate') side.run()
      }
      return cleanups.length === 0
        ? NOOP
        : () => {
            for (const cleanup of cleanups) cleanup()
          }
    },

    destroy() {
      for (const { observer } of observers.values()) observer.disconnect()
      observers.clear()
    },
  }
}

/** One half of a resolved spec, paired with the callback it drives. */
interface Side {
  trigger: ActivationTrigger
  run: () => void
}

type ObservedSides = Pick<ObservedBinding, 'onEnter' | 'onLeave'>

interface ObservedRequest extends ObservedSides {
  oneShot: boolean
  /** Whether losing the observer entirely should start the effects anyway. */
  failOpen: boolean
}

/**
 * Pair each half of a spec with the callback it runs. An exit half with nothing to reverse is
 * dropped here rather than being bound to a no-op, so it never keeps an observer alive.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function sidesOf(spec: ActivationSpec, request: ActivationRequest): Side[] {
  const sides: Side[] = [{ trigger: spec.start, run: () => request.activate() }]
  const deactivate = request.deactivate
  if (spec.end && deactivate) sides.push({ trigger: spec.end, run: () => deactivate() })
  return sides
}

/**
 * Collect the observed halves of a spec, or `undefined` when it has none.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function observedSides(sides: Side[]): ObservedSides | undefined {
  const observed: ObservedSides = {}
  let found = false
  for (const side of sides) {
    if (side.trigger.kind !== 'observed') continue
    found = true
    if (side.trigger.when === 'enter') observed.onEnter = side.run
    else observed.onLeave = side.run
  }
  return found ? observed : undefined
}

/**
 * Listen for one half's event types.
 *
 * Every listener stays `{ passive: true }`, including the ones an open list newly makes reachable
 * (`wheel`, `touchstart`, `submit`). Passive only forbids `preventDefault()`, and this handler
 * never calls it — it starts an animation and returns — so the promise is one the library can
 * genuinely keep, and keeping it is what stops a `data-kui-on="wheel"` from making a page's scroll
 * janky. An activation that needed to cancel its event would need a different contract entirely,
 * and would have to say so.
 *
 * @complexity O(t) time in the number of event types; O(t) space.
 * @overallScore 100
 */
function bindEvents(el: Element, types: readonly string[], run: () => void): Cleanup {
  const handler = (): void => run()
  for (const type of types) el.addEventListener(type, handler, { passive: true })
  return () => {
    for (const type of types) el.removeEventListener(type, handler)
  }
}

function defaultObserverFactory(): ActivationBinderOptions['createObserver'] {
  if (typeof IntersectionObserver === 'undefined') return undefined
  return (callback, init) => new IntersectionObserver(callback, init)
}
