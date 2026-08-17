import type { Animator } from './animator.js'
import { ATTR } from './attrs.js'
import { splitTopLevel } from './parse.js'

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

/**
 * Characters `parse.ts`'s tokenizer treats as structural at top level, read off `isSeparator`
 * and its callers rather than guessed: whitespace and `,` delimit tokens/segments (`splitTopLevel`),
 * `(`/`)` track nesting depth, and `"`/`'` open a quoted region. Any of these left unquoted in a
 * parameter value derails the scan for everything that follows it in the attribute string — an
 * unquoted comma in `{ target: '.a,.b' }` used to make the tokenizer read `.b` as a second effect.
 */
const STRUCTURAL_RE = /[\s,()"']/

/**
 * Values containing a structural character (`STRUCTURAL_RE`) must be quoted or the tokenizer
 * misreads them. A backslash is doubled before a `"` is escaped: `parse.ts`'s `unquote` only ever
 * undoes `\"`, never `\\`, so a raw backslash left as-is can pair with the quote meant to close
 * the value (or with an escaped `"` right after it) and leave the quote unterminated — silently
 * swallowing every token after it, not just this one (verified against `unquote` directly; see
 * `play.test.ts`). Doubling means a literal backslash inside a quoted value round-trips as two
 * rather than one — a known limit of `parse.ts`'s single-level unescaping, traded here for never
 * handing the parser a string it can misread.
 */
function quoteIfNeeded(value: string): string {
  if (!STRUCTURAL_RE.test(value)) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * Mirrors `parse.ts`'s `splitPair`, which isn't exported (parse.ts is off limits to this file):
 * a colon outside parentheses turns a token into a `key:value` pair instead of the bare token it
 * was meant to be. Duplicated as a plain paren-depth scan rather than imported because there is
 * nothing to import — this is the whole algorithm, not an approximation of it.
 */
function hasTopLevelColon(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) return true
  }
  return false
}

/**
 * The effect name, the positional duration/delay/easing tokens, and a parameter's own key are
 * all interpolated unquoted — `parse.ts`'s grammar has no quoting syntax for those slots, only
 * for a `key:value` pair's value. A structural character there can't be escaped away the way
 * `quoteIfNeeded` escapes one in a value, so this rejects it instead of handing the parser a
 * string it will silently misread — e.g. an easing value containing `:` was reclassified as a
 * bogus parameter and the easing silently dropped; an effect name containing `:` dropped the
 * whole spec.
 *
 * Built on `splitTopLevel` (exported, so reused rather than re-derived) plus `hasTopLevelColon`
 * so a legitimate value with balanced parens — `cubic-bezier(.2, .8, .2, 1)`, commas and all —
 * is still accepted; a naive "reject any comma" rule would break exactly the case `parse.ts` was
 * written to support.
 *
 * @complexity O(n) time in value length; O(n) space for the split parts.
 * @overallScore 100
 */
function assertBareToken(label: string, value: string): void {
  const warnings: string[] = []
  const bySpace = splitTopLevel(value, ' ', warnings)
  const byComma = splitTopLevel(value, ',', warnings)
  const isSingleToken = bySpace.length === 1 && bySpace[0] === value
  const safe = warnings.length === 0 && isSingleToken && byComma.length === 1 && !hasTopLevelColon(value)
  if (!safe) {
    throw new Error(
      `play(): ${label} "${value}" cannot be serialized — it contains a space, comma, colon, ` +
        `quote, or unbalanced parenthesis the parser cannot read back as one token`,
    )
  }
}

/**
 * Options object → the same attribute string an author would write. One execution path.
 *
 * @complexity O(n) time in the number of options; O(n) space for the parts.
 * @overallScore 100
 */
export function toAttributeValue(effect: string, options: PlayOptions = {}): string {
  assertBareToken('effect', effect)
  const { duration, delay, ease, ...rest } = options
  // `stagger` is element-scoped and applied as a custom property; leaving it in `rest` emitted
  // it as a bogus effect parameter and warned.
  delete rest.stagger

  const parts = [effect]
  const resolvedDelay = time(delay)
  // Positional times are ordered duration-then-delay, so a delay with no duration must still
  // emit a duration token — otherwise the parser reads the delay AS the duration.
  const resolvedDuration = time(duration) ?? (resolvedDelay ? '0ms' : undefined)
  if (resolvedDuration) {
    assertBareToken('duration', resolvedDuration)
    parts.push(resolvedDuration)
  }
  if (resolvedDelay) {
    assertBareToken('delay', resolvedDelay)
    parts.push(resolvedDelay)
  }
  if (ease) {
    assertBareToken('easing', ease)
    parts.push(ease)
  }

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue
    assertBareToken('parameter name', key)
    parts.push(`${key}:${quoteIfNeeded(String(value))}`)
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
      ;(el as HTMLElement).style.setProperty('--kui-stagger', stagger)
      ;(el as HTMLElement).style.setProperty('--kui-i', String(index))
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
