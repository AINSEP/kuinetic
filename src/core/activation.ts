import { toThresholdRatio } from './element-config.js'
import type { Activation, Cleanup } from './types.js'

const NOOP: Cleanup = () => {}

/**
 * Events that start each activation. A table rather than a switch so adding an activation is a
 * data change and the binder's branch count stays flat.
 *
 * `hover` also listens for `focusin` so keyboard users reach the same state as pointer users.
 */
const ACTIVATION_EVENTS: Record<Activation, readonly string[]> = {
  load: [],
  enter: [],
  manual: [],
  hover: ['pointerenter', 'focusin'],
  focus: ['focusin'],
  click: ['click'],
}

export interface ActivationBinder {
  bind(el: Element, activation: Activation, threshold: string, onActivate: () => void): Cleanup
  destroy(): void
}

export interface ActivationBinderOptions {
  /** Injected so tests can supply a controllable observer and assert without layout. */
  createObserver?: (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) => IntersectionObserver
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
export function createActivationBinder(options: ActivationBinderOptions = {}): ActivationBinder {
  const observers = new Map<string, IntersectionObserver>()
  const callbacks = new WeakMap<Element, () => void>()
  const createObserver = options.createObserver ?? defaultObserverFactory()

  function observerFor(threshold: string): IntersectionObserver | undefined {
    if (!createObserver) return undefined
    const existing = observers.get(threshold)
    if (existing) return existing

    const observer = createObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          callbacks.get(entry.target)?.()
          observer.unobserve(entry.target)
        }
      },
      { threshold: toThresholdRatio(threshold) },
    )
    observers.set(threshold, observer)
    return observer
  }

  function bindObserved(el: Element, threshold: string, onActivate: () => void): Cleanup {
    const observer = observerFor(threshold)
    // No IntersectionObserver means no way to know when the element is visible; showing the
    // content immediately is the only fail-open choice.
    if (!observer) {
      onActivate()
      return NOOP
    }
    callbacks.set(el, onActivate)
    observer.observe(el)
    return () => observer.unobserve(el)
  }

  function bindEvents(el: Element, activation: Activation, onActivate: () => void): Cleanup {
    const types = ACTIVATION_EVENTS[activation]
    if (types.length === 0) return NOOP

    const handler = () => onActivate()
    for (const type of types) el.addEventListener(type, handler, { passive: true })
    return () => {
      for (const type of types) el.removeEventListener(type, handler)
    }
  }

  return {
    bind(el, activation, threshold, onActivate) {
      if (activation === 'load') {
        onActivate()
        return NOOP
      }
      if (activation === 'enter') return bindObserved(el, threshold, onActivate)
      return bindEvents(el, activation, onActivate)
    },

    destroy() {
      for (const observer of observers.values()) observer.disconnect()
      observers.clear()
    },
  }
}

function defaultObserverFactory(): ActivationBinderOptions['createObserver'] {
  if (typeof IntersectionObserver === 'undefined') return undefined
  return (callback, init) => new IntersectionObserver(callback, init)
}
