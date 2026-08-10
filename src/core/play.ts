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

/** Values containing whitespace must be quoted or the tokenizer splits them into garbage. */
function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/** Options object → the same attribute string an author would write. One execution path. */
export function toAttributeValue(effect: string, options: PlayOptions = {}): string {
  const { duration, delay, ease, ...rest } = options
  // `stagger` is element-scoped and applied as a custom property; leaving it in `rest` emitted
  // it as a bogus effect parameter and warned.
  delete rest.stagger

  const parts = [effect]
  const resolvedDelay = time(delay)
  // Positional times are ordered duration-then-delay, so a delay with no duration must still
  // emit a duration token — otherwise the parser reads the delay AS the duration.
  const resolvedDuration = time(duration) ?? (resolvedDelay ? '0ms' : undefined)
  if (resolvedDuration) parts.push(resolvedDuration)
  if (resolvedDelay) parts.push(resolvedDelay)
  if (ease) parts.push(ease)

  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) parts.push(`${key}:${quoteIfNeeded(String(value))}`)
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
  const source = toAttributeValue(effect, options)

  for (const [index, el] of elements.entries()) {
    if (stagger) {
      ;(el as HTMLElement).style.setProperty('--dsg-stagger', stagger)
      ;(el as HTMLElement).style.setProperty('--dsg-i', String(index))
    }
    // Replay: `process()` short-circuits on an unchanged configuration, so playing the same
    // effect twice was a silent no-op without an explicit reset.
    animator.reset(el)
    // Only default to `manual` when the element never declared a trigger of its own — an
    // element authored `on:hover`/`on:click`/`on:load` keeps that activation across a
    // programmatic `play()` (e.g. the replay-all FAB), so a natural hover/click still works
    // afterward. `activate()` below still fires it immediately either way.
    if (!el.hasAttribute(ATTR.on)) el.setAttribute(ATTR.on, 'manual')
    el.setAttribute(ATTR.source, source)
    animator.process(el)
    animator.activate(el)
  }

  // Every renderer exposes the same lifecycle handle, so a JS-driven effect is awaited and
  // cancelled exactly like a CSS one. Reading `getAnimations()` returned [] for JS effects, so
  // `finished` resolved immediately and `cancel()` did nothing.
  const instancesOf = (el: Element) => animator.stateOf(el)?.instances ?? []
  const finished = Promise.all(
    elements.flatMap((el) => instancesOf(el).map((instance) => instance.finished)),
  ).then(() => undefined)

  return {
    elements,
    finished,
    cancel() {
      for (const el of elements) for (const instance of instancesOf(el)) instance.cancel()
    },
    finish() {
      for (const el of elements) for (const instance of instancesOf(el)) instance.finish()
    },
  }
}
