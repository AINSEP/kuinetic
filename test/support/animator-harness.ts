import type { ActivationBinder } from '../../src/core/activation.js'
import { defaultCapabilities } from '../../src/core/capabilities.js'
import type { Activation } from '../../src/core/types.js'

/**
 * The two fixtures every `Animator` suite builds an animator out of.
 *
 * Shared rather than restated per file so `animator.test.ts` and `animator-observe.test.ts` cannot
 * drift into testing two differently-capable browsers — a capability flipped in one file and not
 * the other would change which gate `planStyles` resolves, silently, in whichever suite was not
 * updated.
 */

/**
 * Everything on, so a suite asserts the library's own decisions rather than a fallback path. The
 * fallback paths have their own tests (`style-plan.test.ts`, `capabilities.test.ts`), which is
 * where a capability is meant to be turned off.
 */
export const CAPS = defaultCapabilities({
  viewTimeline: true,
  scrollTimeline: true,
  animationRange: true,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: true,
  intersectionObserver: true,
  motionPath: true,
})

export interface FakeBinder extends ActivationBinder {
  bindings: Array<{ el: Element; activation: Activation; threshold: string }>
  fire(el: Element): void
  unbound: number
}

/**
 * Stand-in for the real binder. Injecting it is what lets visibility-driven behaviour be tested
 * without layout, an IntersectionObserver polyfill, or timers.
 */
export function fakeBinder(): FakeBinder {
  const bindings: FakeBinder['bindings'] = []
  const callbacks = new Map<Element, () => void>()
  const binder: FakeBinder = {
    bindings,
    unbound: 0,
    bind(el, activation, request) {
      bindings.push({ el, activation, threshold: request.threshold })
      callbacks.set(el, () => request.activate())
      return () => {
        binder.unbound++
        callbacks.delete(el)
      }
    },
    fire(el) {
      callbacks.get(el)?.()
    },
    destroy() {},
  }
  return binder
}
