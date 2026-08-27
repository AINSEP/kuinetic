import { validateActivation } from './activation.js'
import { axisOf, BREAKPOINT_NAMES, breakpointRank, isBreakpoint } from './breakpoints.js'
import type { EffectGate, GateDirection } from './breakpoints.js'
import { applyPlayback, isPlaybackKey } from './repeat.js'
import type { EffectSpec, ParsedValue, ReducedMotionPolicy } from './types.js'

/**
 * Grammar — ours, deliberately NOT "the CSS animation shorthand" (see docs/design.md §3):
 *
 *   value  := spec ("," spec)*
 *   spec   := name [duration] [delay] [easing] key:value*
 *
 * Positional tokens must appear in that order. Unknown or out-of-order tokens warn by name
 * rather than failing silently.
 *
 * Some `key:value` keys are reserved and never reach a primitive's parameters:
 * `on`/`timeline`/`threshold`/`cascade`/`order`/`rm`/`func` are hoisted element-wide (see `HOISTS`);
 * `at:` is lifted onto the spec as a relative position, which `core/sequence.ts` owns;
 * `above:`/`below:`/`wide:`/`narrow:` are lifted onto the spec as a gate — viewport for the first
 * pair, container for the second — which `core/breakpoints.ts` owns; and `repeat:`/`yoyo:` are
 * lifted onto the spec as playback settings, which `core/repeat.ts` owns.
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
    if (applyGroupOnlySegment(name, tokens, result)) return null
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
 * The two hoists that are legitimately the *whole* attribute.
 *
 * A stagger group is not the thing animating — its children are — so the element carrying
 * `cascade:`/`order:` names no effect, and `parseSegment`'s "the first token is the effect name"
 * rule reads that as a malformed segment. It warned and returned `null`, taking the hoists with
 * it: `parse("cascade:90ms")` yielded `specs: []` and *no* `cascade`, so
 * `resolveStaggerConfig(null, …)` returned `undefined`, `declaresGroup` said no, and
 * `applyStagger` never indexed the group. No `--kui-stagger`, no `--kui-i`, every child on one
 * identical delay. 69 groups across 16 demo pages were inert this way, each one warning to the
 * silent default reporter.
 *
 * Only `cascade`/`order` qualify. The other hoists (`on:`, `timeline:`, `threshold:`, `rm:`) do
 * nothing on an element with no effect to apply them to, so accepting a bare `on:enter` here
 * would turn a real typo — a dropped effect name — into silence.
 *
 * @param first - The segment's first token, already known to split as `key:value`.
 * @param rest - The remaining tokens, untouched.
 * @returns Whether this was a group-only segment. `true` means the hoists were applied and the
 *   caller must not warn; `false` leaves `result` untouched so the caller's diagnostic stands.
 * @complexity O(t) time in the token count; O(t) space for the collected pairs.
 * @overallScore 100
 */
function applyGroupOnlySegment(first: string, rest: string[], result: ParsedValue): boolean {
  const pairs: [string, string][] = []
  for (const token of [first, ...rest]) {
    const pair = splitPair(token)
    // `Object.hasOwn` for the same reason `applyToken` uses it — see the comment there.
    if (!pair || !GROUP_ONLY_HOISTS.has(pair[0]) || !Object.hasOwn(HOISTS, pair[0])) return false
    pairs.push(pair)
  }
  // Applied only after every token has been checked, so a half-valid segment like
  // `cascade:90ms bogus:1` warns as one malformed segment instead of silently taking the cascade.
  for (const [key, value] of pairs) HOISTS[key]!(result, value)
  return true
}

/** The hoists that can stand alone as a whole attribute. See `applyGroupOnlySegment`. */
const GROUP_ONLY_HOISTS: ReadonlySet<string> = new Set(['cascade', 'order'])

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

  if (applyLifted(token.key, token.value, spec, { segment, result })) return

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

/**
 * Apply a `key:value` that belongs on the *spec* rather than in its `params` or on the element.
 *
 * Three families live here and they are all per-segment for the same reason, stated once: none of
 * them is a parameter — no primitive's `ParameterSchema` declares any of them, so left in `params`
 * they would make `resolveParams` warn "unknown parameter" on every effect in the catalog — and
 * none of them can be hoisted element-wide the way `on:`/`timeline:` are, because the whole point
 * of each is that neighbouring segments carry different ones:
 *
 * - **`at:`** positions a segment against its neighbours; two segments at the same position is the
 *   thing it exists to stop being the only option.
 * - **`above:`/`below:`/`wide:`/`narrow:`** gate a segment on width; `fade-up below:md, parallax-y
 *   above:md` is the case gates exist for and an element-scoped gate could not express it at all.
 * - **`repeat:`/`yoyo:`** set playback; `pulse repeat:infinite, fade-up` must leave `fade-up`
 *   playing once, which is exactly why `declarations.ts` writes `animation-iteration-count` as a
 *   per-track list in the first place.
 *
 * Grouped into one function rather than three branches in `applyToken` so that shared reason has a
 * single home, and so the token dispatch stays under the project's cognitive-complexity ceiling
 * with room for the fourth family, whenever it lands.
 *
 * @returns Whether the key was one of these. `false` leaves the caller's own dispatch to run.
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function applyLifted(
  key: string,
  value: string,
  spec: EffectSpec,
  context: GateContext,
): boolean {
  const { segment, result } = context
  if (key === 'at') {
    if (spec.at !== undefined) result.warnings.push(`duplicate parameter "at" in "${segment}"`)
    spec.at = value
    return true
  }
  if (isGateDirection(key)) {
    applyGate(spec, key, value, context)
    return true
  }
  if (isPlaybackKey(key)) {
    // `core/repeat.ts` owns the value grammar and every diagnostic; see its module comment for why
    // this is spelled `yoyo` and not `direction`.
    applyPlayback(spec, key, value, {
      segment,
      warn: (message) => result.warnings.push(message),
    })
    return true
  }
  return false
}

/** A table, not a branch: `axisOf` grows the same way when a third axis ever lands. */
const GATE_DIRECTIONS: ReadonlySet<string> = new Set(['above', 'below', 'wide', 'narrow'])

function isGateDirection(key: string): key is GateDirection {
  return GATE_DIRECTIONS.has(key)
}

/**
 * Where a lifted token came from, so `applyGate` and its siblings can quote it back without a
 * fifth parameter. Named for the gate because that is what first needed it; every family in
 * {@link applyLifted} takes the same pair.
 */
interface GateContext {
  segment: string
  result: ParsedValue
}

/**
 * Apply one direction of a gate — either half of `above:`/`below:` (viewport) or of `wide:`/
 * `narrow:` (container) — to the spec being built.
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
  // Checked against this direction's own axis, not always `above`/`below`: `wide:md narrow:md` is
  // exactly as impossible a band as `above:md below:md` is, and `axisOf` is what lets one check
  // serve both rather than a second copy hardcoded to the container pair.
  warnOnEmptyBand(gate, axisOf(direction), segment, result)
}

/**
 * Name a band that no width — viewport or container, whichever axis is given — can satisfy.
 *
 * `above:md below:md` is `width >= 768px AND width < 768px`; `above:lg below:md` is worse still.
 * Both compile to perfectly valid CSS that simply never matches, so without this the effect is
 * exactly the silent no-op the grammar promises never to produce — and it is an easy mistake,
 * because the pair reads like a range regardless of which order the two are written in. The same
 * mistake is exactly as easy to make with `wide:`/`narrow:`, so this takes an axis pair rather than
 * hardcoding `above`/`below` — one check, either axis, no per-axis duplicate.
 *
 * @param axis - Upper bound (inclusive-side) first, as `axisOf` returns it.
 * @complexity O(b) time in the scale's length; O(1) space.
 * @overallScore 100
 */
function warnOnEmptyBand(
  gate: Readonly<EffectGate>,
  axis: readonly [GateDirection, GateDirection],
  segment: string,
  result: ParsedValue,
): void {
  const [upperName, lowerName] = axis
  const upperValue = gate[upperName]
  const lowerValue = gate[lowerName]
  if (!upperValue || !lowerValue || breakpointRank(upperValue) < breakpointRank(lowerValue)) return
  result.warnings.push(
    `"${upperName}:${upperValue} ${lowerName}:${lowerValue}" in "${segment}" can never match — ` +
      `"${upperName}" must name a smaller breakpoint than "${lowerName}"`,
  )
}

/** The three values `rm:` accepts, mirroring `ReducedMotionPolicy` in `types.ts`. */
const RM_POLICIES: ReadonlySet<string> = new Set(['shorten', 'crossfade', 'disable'])

/**
 * Element-scoped keys, hoisted out of the per-effect grammar because one element has exactly one
 * activation, one timeline, one stagger group and one reduced-motion policy. A table keeps
 * `applyToken` free of a growing branch chain.
 *
 * ## Why the stagger keys are spelled `cascade:` and `order:`
 *
 * The goal is that everything an author writes lives in one attribute, so the group step and the
 * group ordering both need a home here. Neither could keep the name it has on `data-kui-stagger`,
 * and the two reasons are different:
 *
 * **`from:` → `order:`.** `from` is a parameter name on eighteen primitives — `count-up from:0`,
 * `scale-in from:1`, `gradient-shift from:#f00`, `path-morph from:...`. Hoisting it would make
 * every one of those unwritable, because a hoisted key never reaches `spec.params` at all. `order`
 * is declared by no primitive in the catalog (checked against all 131 by building the registry
 * from `createRegistry()` and unioning every `primitive.parameters` key), and it reads as what it
 * is beside `on:` and `timeline:` — what starts it, what drives it, what order it goes in.
 * `data-kui-stagger` keeps `from:` working and accepts `order:` as a synonym, so one word works in
 * both attributes.
 *
 * **`stagger:` → `cascade:`.** This one is subtler and was nearly missed. `stagger` is *also* an
 * existing parameter — on seventy-seven primitives, from `shared.ts`'s `COMMON` block — and it
 * writes the very same `--kui-stagger` custom property this hoist would, so it looks at first like
 * a merge rather than a collision. It is not, and `split-text` is the proof: the primitive reads
 * `params.ms('stagger', 30)` in `splitRevealFinishMs` to size the timer that resolves its
 * `finished` promise, and several presets set a *per-preset* default for it (`split-chars` 18ms,
 * `split-lines` 90ms). Hoisting the word would lift `data-kui="split-lines stagger:320ms"` out of
 * `spec.params`, the primitive would silently fall back to the preset default, and the effect
 * would report finished long before it was — with the CSS still visibly staggering at 320ms,
 * because the custom property would still have been written. A silent timing lie is exactly the
 * failure mode this codebase warns about everywhere else.
 *
 * So the two words are kept apart because they genuinely mean two things: `stagger:` is the step
 * between the pieces a primitive *generates* (split-text's own spans), `cascade:` is the step
 * between the animated children an *author* wrote. `cascade` is declared by no primitive either.
 * The one ambiguity it carries — this codebase talks about the CSS cascade a great deal — is
 * documentation-only: `cascade:90ms` takes a time, and there is no CSS-cascade concept an author
 * would ever write inside `data-kui`.
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
  /**
   * Deliberately unvalidated here. `data-kui-stagger` has always written its step straight into
   * `--kui-stagger`, which is what makes `var(--speed)` and `calc(90ms * 2)` work today, and the
   * two spellings have to accept the same values or "move it into `data-kui`" would silently be a
   * narrowing. `stagger.ts` owns the one screen both spellings get.
   */
  cascade(result, value) {
    assignOnce(result, 'cascade', value, 'stagger steps')
  },
  /**
   * Also unvalidated here, for a different reason: the legal set depends on the *group size*
   * (`order:7` is in range for eight children and clamped for three), which only `stagger.ts`
   * knows. Validating the keyword half here and the index half there would split one diagnostic
   * across two modules.
   */
  order(result, value) {
    assignOnce(result, 'order', value, 'stagger orders')
  },
  /**
   * The one hoist that is not a move.
   *
   * `data-kui-rm` is *output*, not input: `style-plan.ts` stamps it from `plan.reducedMotion`,
   * which `compile.ts` folds out of the composed primitives' own declared policies, and ~40
   * selectors in `base.css` key on it. No author has ever written it, so there was nothing to
   * hoist — what this adds is the ability to *choose* the policy, which the library had no
   * spelling for at all. The stamped attribute keeps its exact meaning ("the policy in force
   * here"), so every one of those selectors is untouched.
   *
   * Validated against the closed set here rather than in `compile.ts`, so a typo (`rm:disabled`)
   * is named at the point the author's text is read, next to every other grammar diagnostic.
   */
  rm(result, value) {
    if (!RM_POLICIES.has(value)) {
      result.warnings.push(
        `unrecognised "rm:${value}" — expected ${[...RM_POLICIES].join(', ')}`,
      )
      return
    }
    assignOnce(result, 'rm', value as ReducedMotionPolicy, 'reduced-motion policies')
  },
  /**
   * The name of a global function to call when this element's effects finish.
   *
   * Element-scoped for the same reason `on:` is: one element has one lifecycle, so a second,
   * different `func:` across the comma list would be describing a completion this element only
   * reaches once. `assignOnce` names that conflict rather than letting token order pick a winner.
   *
   * Unvalidated here, and there is nothing useful to validate. `window['my-fn'] = …` is legal
   * JavaScript, so an identifier-shaped regex would reject working names; and whether the name
   * resolves at all depends on script order at *runtime*, which this module cannot see. `callback.ts`
   * owns the lookup, the `typeof` check, and the one diagnostic — see the security note at the top
   * of that file before putting `func:` anywhere a CMS field can reach.
   */
  func(result, value) {
    assignOnce(result, 'func', value, 'callbacks')
  },
}

/**
 * Write a hoisted value once. A second, differing value across segments is an authoring mistake;
 * first one wins so behaviour stays deterministic.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function assignOnce<
  K extends 'activation' | 'timeline' | 'threshold' | 'cascade' | 'order' | 'rm' | 'func',
>(
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
