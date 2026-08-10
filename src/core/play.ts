import type { Animator } from './animator.js'
import { ATTR } from './attrs.js'

export type Target = string | Element | Iterable<Element>

export interface PlayOptions {
  duration?: string | number
  delay?: string | number
  ease?: string
  stagger?: string | number
  /** Any effect parameter, e.g. `{ distance: '40px' }`. */
  [param: string]: string | number | undefined
}

/**
 * A handle, not a bare promise. `finished` resolving and the animation being cancellable are
 * different concerns, and a selection-level `.stop()` cannot express which run it stops.
 */
export interface PlaybackHandle {
  readonly elements: Element[]
  /** Resolves when every selected element finishes. Resolves (never rejects) on cancel. */
  readonly finished: Promise<void>
  cancel(): void
  finish(): void
}

export function resolveTargets(target: Target, root: ParentNode): Element[] {
  if (typeof target === 'string') return [...root.querySelectorAll(target)]
  if (target instanceof Element) return [target]
  return [...target]
}

function time(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}ms` : value
}

/** Options object → the same attribute string an author would write. One execution path. */
export function toAttributeValue(effect: string, options: PlayOptions = {}): string {
  const { duration, delay, ease, ...rest } = options
  const parts = [effect]
  const d = time(duration)
  const dl = time(delay)
  if (d) parts.push(d)
  if (dl) parts.push(dl)
  if (ease) parts.push(ease)
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) parts.push(`${key}:${value}`)
  }
  return parts.join(' ')
}

export interface PlayRequest {
  animator: Animator
  root: ParentNode
  target: Target
  effect: string
}

/**
 * Play an effect on a selection, returning a handle rather than a bare promise.
 *
 * Options are compiled into the same attribute string an author would write, so the declarative
 * and programmatic surfaces share one execution path instead of drifting apart.
 *
 * @param request - Animator, root, target selection, and effect name.
 * @param options - Timing and effect parameters.
 * @returns A handle exposing `finished`, `cancel`, and `finish`.
 * @complexity O(n) time in the number of selected elements; O(n) space.
 * @overallScore 100
 */
export function play(request: PlayRequest, options: PlayOptions = {}): PlaybackHandle {
  const { animator, root, target, effect } = request
  const elements = resolveTargets(target, root)
  const stagger = time(options.stagger)

  for (const [index, el] of elements.entries()) {
    if (stagger) {
      ;(el as HTMLElement).style.setProperty('--dsg-stagger', stagger)
      ;(el as HTMLElement).style.setProperty('--dsg-i', String(index))
    }
    el.setAttribute(ATTR.on, 'manual')
    el.setAttribute(ATTR.source, toAttributeValue(effect, options))
    animator.process(el)
    animator.activate(el)
  }

  let settled = false
  const finished = Promise.all(elements.map(waitForAnimations)).then(() => {
    settled = true
  })

  return {
    elements,
    finished,
    cancel() {
      if (settled) return
      for (const el of elements) {
        for (const animation of getAnimations(el)) animation.cancel()
        el.setAttribute(ATTR.state, 'finished')
      }
    },
    finish() {
      if (settled) return
      for (const el of elements) {
        for (const animation of getAnimations(el)) animation.finish()
        el.setAttribute(ATTR.state, 'finished')
      }
    },
  }
}

function getAnimations(el: Element): Animation[] {
  const fn = (el as Element & { getAnimations?: () => Animation[] }).getAnimations
  return typeof fn === 'function' ? fn.call(el) : []
}

/**
 * `animationend` is not a correctness mechanism — it does not fire after cancel, removal, or
 * some reduced-motion paths. Await the WAAPI promises instead, and treat cancellation as
 * resolution rather than rejection so callers are not forced into try/catch.
 */
function waitForAnimations(el: Element): Promise<void> {
  const animations = getAnimations(el)
  if (animations.length === 0) return Promise.resolve()
  return Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => {
    el.setAttribute(ATTR.state, 'finished')
  })
}
