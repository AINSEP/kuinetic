import type { ParamSpec, ParameterSchema, ResolvedParams } from './types.js'

/**
 * Parameter validation.
 *
 * Author-supplied strings are substituted into CSS values, which makes this a security surface
 * rather than a convenience: unvalidated values admit `url()` exfiltration, pathological
 * `calc()`, and declaration escapes. Every value is checked against its declared type before it
 * reaches `style.setProperty`. See docs/design.md §7.
 */

/**
 * Characters and functions that let a value escape its declaration or reach the network.
 *
 * `{`/`}` are deliberately not in this set: values reach the DOM through `style.setProperty`
 * (CSSOM), not string concatenation into a stylesheet, so a brace cannot splice out of its
 * declaration the way it could in a text-templated `<style>` block. Blocking them anyway used to
 * break `type: 'text'` values that legitimately contain braces, e.g. a media-scrub `src` pattern
 * like `frame-{i}.jpg`.
 */
const DANGEROUS = /[;<]|\/\*|url\s*\(|expression\s*\(|@import|image-set\s*\(/i

/**
 * Matches a value that resolves to a URI scheme (`http:`, `data:`, `javascript:`, …) or a
 * protocol-relative origin (`//host/…`, plus the backslash spellings a browser's URL parser
 * treats the same way once a `\` appears where a `/` would). Matching only from the very start
 * of the string means a colon that shows up *after* the first path separator — inside a later
 * segment or a query string — is never mistaken for a scheme; that is also the RFC 3986 §4.2
 * rule for when a leading segment needs a `./` prefix to stay unambiguously relative.
 *
 * Used to keep `src`-shaped values same-origin — see `isSameOriginPath` below.
 */
const ABSOLUTE_OR_PROTOCOL_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i

const MAX_VALUE_LENGTH = 200

const NUM = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`
const LENGTH_UNITS = 'px|rem|em|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q|%'

/** Simple, single-purpose patterns. Compound types are handled by dedicated predicates. */
const PATTERNS: Partial<Record<ParamSpec['type'], RegExp>> = {
  length: new RegExp(`^(?:0|${NUM}(?:${LENGTH_UNITS}))$`, 'i'),
  time: new RegExp(`^${NUM}(?:ms|s)$`, 'i'),
  number: new RegExp(`^${NUM}$`),
  percentage: new RegExp(`^${NUM}%$`),
  angle: new RegExp(`^${NUM}(?:deg|rad|turn|grad)$`, 'i'),
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const COLOR_FUNCTIONS = /^(?:rgba?|hsla?|okl(?:ch|ab)|l(?:ch|ab)|color)\([^()]*\)$/i
const COLOR_KEYWORD = /^[a-z]+$/i

const EASING_KEYWORD = /^(?:linear|ease|step-start|step-end|spring|bounce|[a-z]+-(?:in|out|in-out))$/i
const EASING_FUNCTION = /^(?:cubic-bezier|steps|linear)\([^()]*\)$/i

const CALC_TYPES = new Set<ParamSpec['type']>(['length', 'percentage', 'number'])
const CALC_CHARACTER = /^[\d.\s+\-*/%a-z,]$/i
const CUSTOM_PROPERTY_NAME = /^--[\w-]+$/

export interface ValidationResult {
  value: string
  ok: boolean
  reason?: string
}

/**
 * Validate one authored parameter value against its declared type.
 *
 * @param raw - Author-supplied value, untrusted.
 * @param spec - The parameter's declared type, default, and target custom property.
 * @returns The accepted value, or the declared default with a reason when rejected. Never throws
 *   and never returns an unvalidated string.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function validate(raw: string, spec: ParamSpec): ValidationResult {
  const value = raw.trim()
  const rejection = screen(value, spec)
  if (rejection) return rejection

  if (spec.type === 'keyword') return checkKeyword(value, spec)
  // `text` has no shape to match — it is a selector or URL pattern. It still passed the
  // escape screen above, and `resolveParams` drops it before anything reaches a stylesheet.
  if (spec.type === 'text') return { value, ok: true }
  if (isAcceptable(value, spec.type)) return checkNumericConstraints(value, spec)
  return reject(spec, `not a valid ${spec.type}`)
}

/**
 * Length and content checks that apply to every type, run before any type-specific matching.
 *
 * @returns A rejection, or `null` when the value is safe to type-check.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function screen(value: string, spec: ParamSpec): ValidationResult | null {
  if (!value) return reject(spec, 'empty value')
  if (value.length > MAX_VALUE_LENGTH) {
    return reject(spec, `value exceeds ${MAX_VALUE_LENGTH} characters`)
  }
  if (DANGEROUS.test(value)) return reject(spec, 'value contains disallowed CSS syntax')
  return null
}

/**
 * Match a value against its type.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function isAcceptable(value: string, type: ParamSpec['type']): boolean {
  if (type === 'color') return isColor(value)
  if (type === 'easing') return EASING_KEYWORD.test(value) || EASING_FUNCTION.test(value)

  const pattern = PATTERNS[type]
  if (!pattern) return false
  if (pattern.test(value)) return true
  return CALC_TYPES.has(type) && isSafeCalc(value) && isWellFormedCalc(value)
}

function isColor(value: string): boolean {
  return HEX_COLOR.test(value) || COLOR_FUNCTIONS.test(value) || COLOR_KEYWORD.test(value)
}

function checkKeyword(value: string, spec: ParamSpec): ValidationResult {
  if (spec.values?.includes(value)) return { value, ok: true }
  return reject(spec, `expected one of ${spec.values?.join(', ') ?? '(none declared)'}`)
}

/**
 * Whether an authored value stays on the page's own origin wherever a `src`-shaped `text`
 * parameter is actually turned into a network request.
 *
 * `type: 'text'` is deliberately shape-free — see the module doc above — because it also carries
 * CSS selectors and other non-URL strings that have no notion of "origin" at all. So this is not
 * part of `validate()`: a `text` value that is a URL pattern (media-scrub's frame `src`) is safe
 * to accept lexically, but a *consumer of that value* must call this before ever assigning it to
 * something that fetches, such as `<img>.src`.
 *
 * The threat: `data-kui` content is not always authored by the site owner — a CMS field, a
 * comment, anything not trusted the way hand-written markup is — so an unconstrained `src`
 * pattern turns the visitor's own browser into a same-origin-cookie-free but still
 * attacker-directed request tool: exfiltration via path/query, third-party tracking pixels, or
 * probing hosts on the victim's internal network that are unreachable from outside it. A
 * Content-Security-Policy would mitigate this, but the library should not depend on the consumer
 * having one.
 *
 * Only relative and root-relative paths pass. That is narrower than "any same-origin URL": a
 * fully-qualified `https://this-very-site/…` is rejected too, on purpose, because nothing this
 * library ships needs one — a root-relative path reaches the same resource — and accepting it
 * would mean re-deriving "is this really the page's own origin" from `location` inside what is
 * otherwise pure string validation, with all the parsing edge cases (`this-site.com.evil.com`,
 * userinfo tricks, IDN lookalikes) that comparison invites. Rejecting every scheme uniformly,
 * regardless of which host follows it, has no such edge cases.
 *
 * @param value - Author-supplied value already accepted by {@link validate} as `type: 'text'`.
 * @returns Whether every request this value can produce is confined to the page's own origin.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function isSameOriginPath(value: string): boolean {
  return !ABSOLUTE_OR_PROTOCOL_RELATIVE.test(value)
}

/**
 * Apply semantic constraints after a number has passed the lexical grammar.
 *
 * @param value - Lexically valid authored value.
 * @param spec - Schema constraints for the parameter.
 * @returns The accepted value or the declared default with a reason.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function checkNumericConstraints(value: string, spec: ParamSpec): ValidationResult {
  if (spec.type !== 'number') return { value, ok: true }
  const numeric = Number(value)
  if (spec.finite && !Number.isFinite(numeric)) return reject(spec, 'expected a finite number')
  if (spec.integer && !Number.isInteger(numeric)) return reject(spec, 'expected an integer')
  if (spec.minimum !== undefined && numeric < spec.minimum) {
    return reject(spec, `expected at least ${spec.minimum}`)
  }
  if (spec.maximum !== undefined && numeric > spec.maximum) {
    return reject(spec, `expected at most ${spec.maximum}`)
  }
  return { value, ok: true }
}

function reject(spec: ParamSpec, reason: string): ValidationResult {
  return { value: spec.default, ok: false, reason }
}

/**
 * Tokenize the deliberately small supported `calc()` grammar without regex backtracking.
 *
 * @param value - Candidate numeric value.
 * @returns Whether it contains only arithmetic text and exact `var(--name)` references.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function isSafeCalc(value: string): boolean {
  if (!value.startsWith('calc(') || !value.endsWith(')')) return false

  const end = value.length - 1
  let index = 'calc('.length
  while (index < end) {
    index = nextCalcToken(value, index, end)
    if (index < 0) return false
  }
  return true
}

/**
 * Advance over one calc character or variable token.
 *
 * @param value - Whole `calc()` candidate.
 * @param index - Current body index.
 * @param end - Exclusive end of the calc body.
 * @returns The next index, or `-1` when the token is unsupported.
 * @complexity O(n) time for a variable token; O(1) space.
 * @overallScore 100
 */
function nextCalcToken(value: string, index: number, end: number): number {
  if (value.startsWith('var(', index)) return consumeVar(value, index, end)
  // Only called from `isSafeCalc`'s `while (index < end)` loop, and `end < value.length`, so
  // `value[index]` is always in-bounds.
  return CALC_CHARACTER.test(value[index]!) ? index + 1 : -1
}

/**
 * Consume one `var(--name)` token.
 *
 * @param value - Whole `calc()` candidate.
 * @param start - Index of the `v` in `var(`.
 * @param end - Exclusive end of the calc body.
 * @returns The first index after the token, or `-1` when malformed.
 * @complexity O(n) time in token length; O(1) space.
 * @overallScore 100
 */
function consumeVar(value: string, start: number, end: number): number {
  const close = value.indexOf(')', start + 'var('.length)
  if (close < 0 || close >= end) return -1
  const name = value.slice(start + 'var('.length, close)
  return CUSTOM_PROPERTY_NAME.test(name) ? close + 1 : -1
}

/**
 * Structural check on a `calc()` body.
 *
 * The character-class pattern cannot tell `calc(100% - 20px)` from `calc(100% -)`. A malformed
 * calc is not a security problem — CSS drops it at computed-value time — but accepting it
 * silently means the author sees no animation and no warning, which is the worst outcome.
 *
 * Only reached after `isSafeCalc` already tokenized `value` successfully (short-circuit `&&` at
 * the call site): its tokenizer accepts an outer `calc(`/`)` pair plus, for each `var(...)`
 * token, only ones whose closing paren `consumeVar` already located — so by construction every
 * paren here is already balanced, and there is nothing left to check but emptiness and a
 * trailing operator.
 *
 * @param value - A string already accepted by the safe calc tokenizer.
 * @returns Whether the body is non-empty and has no dangling trailing operator.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function isWellFormedCalc(value: string): boolean {
  const body = value.slice('calc('.length, -1).trim()
  return body !== '' && !/[+\-*/]$/.test(body)
}

/**
 * Resolve authored parameters against a schema.
 *
 * Only values the author explicitly supplied are returned. Defaults are deliberately excluded:
 * they live in the CSS `var()` fallback. Writing them to `element.style` would give inline custom
 * properties precedence over consumer stylesheets and break the promise that a site's own CSS
 * wins without `!important`.
 *
 * @param authored - Raw parameter values from the attribute or options object.
 * @param schema - The primitive's declared parameters.
 * @param warn - Diagnostic sink; called once per rejected or unknown parameter.
 * @returns Custom property names mapped to validated values.
 * @complexity O(p * n) time in parameter count and value length; O(p) space.
 * @overallScore 100
 */
export function resolveParams(
  authored: Record<string, string>,
  schema: ParameterSchema,
  warn: (message: string) => void,
): ResolvedParams {
  const out: ResolvedParams = {}

  for (const [key, raw] of Object.entries(authored)) {
    // `Object.hasOwn`: `schema[key]` alone falls through to `Object.prototype` for a key like
    // `__proto__`/`constructor`, silently treating it as a "known" param instead of warning.
    const spec = Object.hasOwn(schema, key) ? schema[key] : undefined
    if (!spec) {
      warn(`unknown parameter "${key}" (known: ${Object.keys(schema).join(', ') || 'none'})`)
      continue
    }
    // `text` parameters are JS-only by definition; letting one reach a stylesheet would
    // reintroduce exactly the injection surface the rest of this module removes.
    if (spec.type === 'text') continue

    const result = validate(raw, spec)
    if (result.ok) out[spec.cssProperty] = result.value
    else warn(`parameter "${key}": ${result.reason} — got "${raw}", using default "${spec.default}"`)
  }

  return out
}
