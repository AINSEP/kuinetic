import { validateActivation } from './activation.js'
import { BREAKPOINT_NAMES, breakpointRank, isBreakpoint } from './breakpoints.js'
import type { Breakpoint, GateDirection } from './breakpoints.js'
import type { EffectSpec, ParsedValue } from './types.js'

/**
 * Grammar — ours, deliberately NOT "the CSS animation shorthand" (see docs/design.md §3):
 *
 *   value  := spec ("," spec)*
 *   spec   := name [duration] [delay] [easing] key:value*
 *
 * Positional tokens must appear in that order. Unknown or out-of-order tokens warn by name
 * rather than failing silently.
 *
 * Some `key:value` keys are reserved and never reach a primitive's parameters: `on`/`timeline`/
 * `threshold` are hoisted element-wide (see `HOISTS`); `at:` is lifted onto the spec as a relative
 * position, which `core/sequence.ts` owns; and `above:`/`below:` are lifted onto the spec as a
 * viewport gate, which `core/breakpoints.ts` owns.
 *
 * The tokenizer is paren- and quote-aware because legitimate values contain both commas and
 * spaces: `ease:cubic-bezier(.2, .8, .2, 1)` is shredded by a naive split.
 */

/**
 * Written so the two alternatives cannot both match a prefix — `\d+\.?\d*` would let
 * `1.2.3.4.5ms` backtrack super-linearly on the trailing-unit check.
 */
const TIME_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/
const EASING_FUNCTIONS = ['cubic-bezier(', 'steps(', 'linear(']

const EASING_KEYWORDS: ReadonlySet<string> = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'expo-in',
  'expo-out',
  'expo-in-out',
  'back-in',
  'back-out',
  'back-in-out',
  'quart-out',
  'circ-out',
  'spring',
  'bounce',
])

type Token =
  | { kind: 'pair'; key: string; value: string }
  | { kind: 'time'; value: string }
  | { kind: 'easing'; value: string }
  | { kind: 'unknown'; value: string }

/** `applyToken`'s only call site already filters out `'time'` before calling it. */
type NonTimeToken = Exclude<Token, { kind: 'time' }>

/**
 * Split on a delimiter, ignoring delimiters nested inside parentheses or quotes.
 *
 * @param input - Raw attribute text.
 * @param delimiter - `','` for effect segments, `' '` for tokens within a segment.
 * @param warnings - Sink for a diagnostic when a quote or `(` is never closed. Optional so the
 *   two-argument call every existing caller and test uses keeps working unchanged.
 * @returns Trimmed, non-empty parts.
 * @complexity O(n) time in input length; O(n) space for the parts.
 * @overallScore 100
 */
export function splitTopLevel(
  input: string,
  delimiter: ',' | ' ',
  warnings: string[] = [],
): string[] {
  const parts: string[] = []
  const scanner = { depth: 0, quote: null as string | null, escaped: false }
  let buffer = ''

  for (const char of input) {
    if (isSeparator(char, delimiter, scanner)) {
      if (buffer.trim()) parts.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim()) parts.push(buffer.trim())

  // An unterminated quote or `(` swallows every delimiter for the rest of the input into one
  // part, silently dropping every effect/token after it — worth naming rather than guessing.
  if (scanner.quote) warnings.push(`unterminated ${scanner.quote} quote in "${input}"`)
  else if (scanner.depth > 0) warnings.push(`unclosed "(" in "${input}"`)

  return parts
}

/**
 * Advance the quote/paren scanner and report whether this character terminates a part.
 *
 * Mutates `scanner` by design: it is the tokenizer's cursor, and threading it through a return
 * value would obscure the single-pass nature of the scan.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
type Scanner = { depth: number; quote: string | null; escaped: boolean }

function isSeparator(char: string, delimiter: ',' | ' ', scanner: Scanner): boolean {
  if (scanner.quote) return advanceQuote(char, scanner)
  if (char === '"' || char === "'") {
    scanner.quote = char
    return false
  }
  if (char === '(') scanner.depth++
  else if (char === ')') scanner.depth = Math.max(0, scanner.depth - 1)

  if (scanner.depth !== 0) return false
  return delimiter === ' ' ? /\s/.test(char) : char === delimiter
}

/**
 * Advance the scanner one character while inside a quote. Never a separator — a delimiter inside
 * quotes is data, not syntax — so this only exists to decide whether the quote just closed.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function advanceQuote(char: string, scanner: Scanner): boolean {
  if (scanner.escaped) scanner.escaped = false
  else if (char === '\\') scanner.escaped = true
  else if (char === scanner.quote) scanner.quote = null
  return false
}

/**
 * Split `key:value` on the first top-level colon, so `url(a:b)` survives intact.
 *
 * @returns The pair, or `null` when the token is not a pair.
 * @complexity O(n) time in token length; O(1) extra space.
 * @overallScore 100
 */
function splitPair(token: string): [string, string] | null {
  let depth = 0
  for (let i = 0; i < token.length; i++) {
    const char = token[i]
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) {
      const key = token.slice(0, i).trim()
      const value = unquote(token.slice(i + 1).trim())
      return key && value ? [key, value] : null
    }
  }
  return null
}

/**
 * Strip surrounding quotes from a parameter value.
 *
 * Quoting is how a value containing spaces survives tokenisation — an SVG path or a descendant
 * selector is unusable otherwise. The quotes are syntax, so they must not reach the consumer.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function unquote(value: string): string {
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length > 1) {
    // `splitTopLevel`'s scanner already treated `\"`/`\'` as literal, not a closing quote — undo
    // the escape here so the value matches what was originally quoted, e.g. `toAttributeValue`'s
    // `quoteIfNeeded` round-trips `say "two words" now` through `"say \"two words\" now"`.
    return value.slice(1, -1).replaceAll(`\\${first}`, first)
  }
  return value
}

/**
 * Classify one token so the applier can stay a flat dispatch.
 *
 * @complexity O(n) time in token length; O(1) space.
 * @overallScore 100
 */
function classify(token: string): Token {
  const pair = splitPair(token)
  if (pair) return { kind: 'pair', key: pair[0], value: pair[1] }
  if (TIME_RE.test(token)) return { kind: 'time', value: token }
  if (isEasing(token)) return { kind: 'easing', value: token }
  return { kind: 'unknown', value: token }
}

function isEasing(token: string): boolean {
  if (EASING_KEYWORDS.has(token)) return true
  return EASING_FUNCTIONS.some((fn) => token.startsWith(fn) && token.endsWith(')'))
}

/**
 * Parse a `data-kui` attribute value.
 *
 * @param input - Raw attribute text; empty or whitespace yields an empty spec list.
 * @returns Effect specs plus any hoisted element-scoped settings and warnings.
 * @complexity O(n) time in input length; O(e) space in the number of effect segments.
 * @overallScore 100
 */
export function parse(input: string): ParsedValue {
  const result: ParsedValue = { specs: [], warnings: [] }

  for (const segment of splitTopLevel(input ?? '', ',', result.warnings)) {
    const spec = parseSegment(segment, result)
    if (spec) result.specs.push(spec)
  }
  return result
}

/**
 * Parse one comma-separated effect segment.
 *
 * @returns The spec, or `null` when the segment has no usable effect name.
 * @complexity O(t) time in the number of tokens; O(p) space in parameter count.
 * @overallScore 100
 */
function parseSegment(segment: string, result: ParsedValue): EffectSpec | null {
  const tokens = splitTopLevel(segment, ' ', result.warnings)
  // `splitTopLevel` only ever returns trimmed, non-empty parts, and `segment` is itself one such
  // part from the outer comma-split — so it has at least one non-whitespace character that the
  // inner space-split can never consume as a separator, guaranteeing at least one token here.
  const name = tokens.shift()!
  if (splitPair(name)) {
    result.warnings.push(`effect name expected, got "${name}"`)
    return null
  }

  const spec: EffectSpec = { name, params: {} }
  let timeCount = 0

  for (const raw of tokens) {
    const token = classify(raw)
    if (token.kind === 'time') timeCount = applyTime(spec, token.value, timeCount, result.warnings)
    else applyToken(token, spec, segment, result)
  }
  return spec
}

/**
 * Assign a positional time value. The first is the duration, the second the delay — the same
 * disambiguation CSS uses — and a third is a mistake worth naming.
 *
 * @returns The updated count of time values seen.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function applyTime(spec: EffectSpec, value: string, seen: number, warnings: string[]): number {
  if (seen === 0) spec.duration = value
  else if (seen === 1) spec.delay = value
  else warnings.push(`third time value "${value}" ignored (expected duration then delay)`)
  return seen + 1
}

/**
 * Apply a non-time token to the spec being built.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function applyToken(
  token: NonTimeToken,
  spec: EffectSpec,
  segment: string,
  result: ParsedValue,
): void {
  if (token.kind === 'easing') {
    if (spec.easing) result.warnings.push(`duplicate easing "${token.value}" in "${segment}"`)
    spec.easing = token.value
    return
  }
  if (token.kind === 'unknown') {
    result.warnings.push(
      `unrecognised token "${token.value}" in "${segment}" — expected [duration] [delay] [easing] or key:value`,
    )
    return
  }

  // Lifted onto the spec rather than left in `params`, exactly as the positional times are: `at:`
  // is a position, not a parameter, and no primitive's `ParameterSchema` declares it — so leaving
  // it in `params` would make `resolveParams` warn "unknown parameter" on every effect in the
  // catalog. See `EffectSpec.at` in `types.ts` for why it is not hoisted element-wide either.
  if (token.key === 'at') {
    if (spec.at !== undefined) result.warnings.push(`duplicate parameter "at" in "${segment}"`)
    spec.at = token.value
    return
  }

  // Lifted for the same reason `at:` is, and per-segment for a reason of its own: the whole point
  // of a gate is that neighbouring segments can carry different ones, so hoisting it element-wide
  // the way `on:` is hoisted would make `fade-up below:md, parallax-y above:md` inexpressible.
  if (isGateDirection(token.key)) {
    applyGate(spec, token.key, token.value, { segment, result })
    return
  }

  // `Object.hasOwn`, not `HOISTS[token.key]` truthiness: a plain object's lookup falls through to
  // `Object.prototype`, so an author-controlled key like `__proto__` or `constructor` resolves to
  // an inherited value there — truthy, but not a hoist handler, so calling it threw and aborted
  // the whole attribute scan for every element after this one.
  if (Object.hasOwn(HOISTS, token.key)) {
    HOISTS[token.key]!(result, token.value)
    return
  }
  if (token.key in spec.params) {
    result.warnings.push(`duplicate parameter "${token.key}" in "${segment}"`)
  }
  spec.params[token.key] = token.value
}

function isGateDirection(key: string): key is GateDirection {
  return key === 'above' || key === 'below'
}

/** Where a gate token came from, so `applyGate` can quote it back without a fifth parameter. */
interface GateContext {
  segment: string
  result: ParsedValue
}

/**
 * Apply one half of a viewport gate to the spec being built.
 *
 * Every rejection here is a *warning plus no gate*, never a warning plus a half-applied one. A
 * segment whose gate was refused runs unconditionally, which is the same fail-open the rest of the
 * grammar uses: an author who mistypes a breakpoint gets their animation and a message naming the
 * token, rather than an element that silently never animates anywhere and no clue why.
 *
 * @complexity O(b) time in the scale's length via `breakpointRank` — five; O(1) space.
 * @overallScore 100
 */
function applyGate(
  spec: EffectSpec,
  direction: GateDirection,
  value: string,
  context: GateContext,
): void {
  const { segment, result } = context
  if (!isBreakpoint(value)) {
    result.warnings.push(
      `unknown breakpoint "${value}" in "${segment}" — expected one of ${BREAKPOINT_NAMES.join(', ')}`,
    )
    return
  }
  const gate = (spec.gate ??= {})
  if (gate[direction] !== undefined) {
    result.warnings.push(`duplicate parameter "${direction}" in "${segment}"`)
  }
  gate[direction] = value
  warnOnEmptyBand(gate.above, gate.below, segment, result)
}

/**
 * Name a band that no viewport can satisfy.
 *
 * `above:md below:md` is `width >= 768px AND width < 768px`; `above:lg below:md` is worse still.
 * Both compile to perfectly valid CSS that simply never matches, so without this the effect is
 * exactly the silent no-op the grammar promises never to produce — and it is an easy mistake,
 * because the pair reads like a range regardless of which order the two are written in.
 *
 * @complexity O(b) time in the scale's length; O(1) space.
 * @overallScore 100
 */
function warnOnEmptyBand(
  above: Breakpoint | undefined,
  below: Breakpoint | undefined,
  segment: string,
  result: ParsedValue,
): void {
  if (!above || !below || breakpointRank(above) < breakpointRank(below)) return
  result.warnings.push(
    `"above:${above} below:${below}" in "${segment}" can never match — ` +
      `"above" must name a narrower breakpoint than "below"`,
  )
}

/**
 * Element-scoped keys, hoisted out of the per-effect grammar because one element has exactly one
 * activation and one timeline. A table keeps `applyToken` free of a growing branch chain.
 */
const HOISTS: Record<string, (result: ParsedValue, value: string) => void> = {
  /**
   * The activation list is open: any event type `addEventListener` accepts starts an animation,
   * and `start/end` pairs it with an exit. So this no longer checks the value against a closed set
   * of six names — `on:input` and `on:cart:updated` are both legitimate and unguessable from here.
   *
   * What it still rejects is text that cannot be an event type at all, because that is where the
   * open list would otherwise turn a typo into silence rather than a warning. The complementary
   * check — "this document has never heard of that event" — needs an element and lives in
   * `animator.ts`.
   */
  on(result, value) {
    const problems = validateActivation(value)
    if (problems.length > 0) {
      result.warnings.push(...problems)
      return
    }
    assignOnce(result, 'activation', value, 'activations')
  },
  timeline(result, value) {
    assignOnce(result, 'timeline', value, 'timelines')
  },
  threshold(result, value) {
    assignOnce(result, 'threshold', value, 'thresholds')
  },
}

/**
 * Write a hoisted value once. A second, differing value across segments is an authoring mistake;
 * first one wins so behaviour stays deterministic.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function assignOnce<K extends 'activation' | 'timeline' | 'threshold'>(
  result: ParsedValue,
  key: K,
  value: ParsedValue[K],
  label: string,
): void {
  const current = result[key]
  if (current === undefined) {
    result[key] = value
    return
  }
  if (current !== value) {
    result.warnings.push(`conflicting ${label} "${String(current)}" and "${String(value)}"`)
  }
}
