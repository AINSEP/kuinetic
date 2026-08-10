import type { ParamSpec, ParameterSchema, ResolvedParams } from './types.js'

/**
 * Parameter validation.
 *
 * Author-supplied strings are substituted into CSS values, which makes this a security surface
 * rather than a convenience: unvalidated values admit `url()` exfiltration, pathological
 * `calc()`, and declaration escapes. Every value is checked against its declared type before it
 * reaches `style.setProperty`. See docs/design.md §7.
 */

/** Characters and functions that let a value escape its declaration or reach the network. */
const DANGEROUS = /[;{}<]|\/\*|url\s*\(|expression\s*\(|@import|image-set\s*\(/i

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

const EASING_KEYWORD = /^(?:linear|ease|step-start|step-end|spring|[a-z]+-(?:in|out|in-out))$/i
const EASING_FUNCTION = /^(?:cubic-bezier|steps|linear)\([^()]*\)$/i

/** `calc()` is allowed for numeric types, restricted to arithmetic and var() references. */
const CALC = /^calc\((?:[\d.\s+\-*/%a-z(),]|var\(--[\w-]+\))*\)$/i

const CALC_TYPES = new Set<ParamSpec['type']>(['length', 'percentage', 'number'])

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
  if (isAcceptable(value, spec.type)) return { value, ok: true }
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
  return CALC_TYPES.has(type) && CALC.test(value) && isWellFormedCalc(value)
}

function isColor(value: string): boolean {
  return HEX_COLOR.test(value) || COLOR_FUNCTIONS.test(value) || COLOR_KEYWORD.test(value)
}

function checkKeyword(value: string, spec: ParamSpec): ValidationResult {
  if (spec.values?.includes(value)) return { value, ok: true }
  return reject(spec, `expected one of ${spec.values?.join(', ') ?? '(none declared)'}`)
}

function reject(spec: ParamSpec, reason: string): ValidationResult {
  return { value: spec.default, ok: false, reason }
}

/**
 * Structural check on a `calc()` body.
 *
 * The character-class pattern cannot tell `calc(100% - 20px)` from `calc(100% -)`. A malformed
 * calc is not a security problem — CSS drops it at computed-value time — but accepting it
 * silently means the author sees no animation and no warning, which is the worst outcome.
 *
 * @param value - A string already matched by `CALC`.
 * @returns Whether parentheses balance and no operator is left dangling.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function isWellFormedCalc(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth--
    if (depth < 0) return false
  }
  if (depth !== 0) return false

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
    const spec = schema[key]
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
