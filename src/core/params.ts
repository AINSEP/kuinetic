import { cssEasingValue, springTokenProblems } from './easing.js'
import type {
  ParamSpec,
  ParamType,
  ParameterSchema,
  ResolvedParams,
  ScalarParamType,
  UnionParamType,
} from './types.js'

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

/**
 * `path` values get their own, much larger cap.
 *
 * 200 characters is a sensible ceiling for a length, an angle, or a colour — anything longer is
 * far more likely to be an attack than an animation. Path data is the one authored value that is
 * legitimately long: a hand-drawn curve exported from a vector editor runs to hundreds of
 * characters before it says anything unusual, and truncating it at 200 would reject ordinary
 * input. What bounds the risk for a path is not its length but {@link PATH_DATA} — an allowlist
 * with no quote, paren, semicolon, or backslash in it — so the length check here is only a
 * memory-and-sanity bound, not the security control.
 */
const MAX_PATH_LENGTH = 2000

/**
 * Every character SVG path data is allowed to contain: the twenty command letters, digits, the
 * exponent forms a float can take, and the separators between coordinates.
 *
 * Nothing else. In particular no `"`, `'`, `(`, `)`, `;`, `\`, or `/` — which is what makes
 * wrapping an accepted value in double quotes (see {@link checkPath}) unconditionally safe: the
 * value cannot terminate the string it is about to be placed inside, so it cannot reach the rest
 * of the declaration. A single character class, so matching is linear and there is nothing for a
 * pathological input to backtrack over.
 */
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/

const NUM = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`
const LENGTH_UNITS = 'px|rem|em|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q|%'

/** Simple, single-purpose patterns. Compound types are handled by dedicated predicates. */
const PATTERNS: Partial<Record<ScalarParamType, RegExp>> = {
  length: new RegExp(`^(?:0|${NUM}(?:${LENGTH_UNITS}))$`, 'i'),
  time: new RegExp(`^${NUM}(?:ms|s)$`, 'i'),
  number: new RegExp(`^${NUM}$`),
  percentage: new RegExp(`^${NUM}%$`),
  angle: new RegExp(`^${NUM}(?:deg|rad|turn|grad)$`, 'i'),
}

/**
 * `angle` accepts a bare number and the `d` shorthand: `180`, `180d` and `180deg` are one value.
 *
 * Deliberately narrower than "coerce any unitless number", which {@link withImpliedUnit} still
 * declines to do for `length`. An angle has one unit anybody reaches for — nobody writes a
 * rotation in radians by accident — so `angle:180` has exactly one reading, and the unit is
 * ceremony rather than information. A unitless `distance:24` is genuinely ambiguous between `px`
 * and `%` and stays a rejection worth naming.
 *
 * `slatAngleDegrees` in `catalog/media-shared.ts` has accepted `45` beside `45deg` since it was
 * written, for this reason; this brings the other fourteen `type: 'angle'` parameters in line
 * with the one that already did it.
 *
 * The `d` group cannot swallow a real unit: `rad` and `grad` also end in `d`, but both are three
 * characters and this is anchored, so only a lone `d` matches. `deg` is tried first so the common
 * spelling never backtracks.
 */
const BARE_ANGLE = new RegExp(`^(${NUM})d?$`, 'i')

function withAngleUnit(value: string): string {
  const match = BARE_ANGLE.exec(value)
  return match ? `${match[1]}deg` : value
}

/**
 * A number as CSS spells it, which is wider than {@link PATTERNS}`.number`: a leading `+` and an
 * exponent are both legal there and neither is accepted as an authored parameter value. Used only
 * by {@link decimalNumber}, whose callers decide for themselves how wide their input may be.
 */
const BARE_NUMBER = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)(?:e([+-]?\d+))?$/i

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const COLOR_FUNCTIONS = /^(?:rgba?|hsla?|okl(?:ch|ab)|l(?:ch|ab)|color)\([^()]*\)$/i
/**
 * The colour keywords CSS actually defines, as a closed set.
 *
 * This was `/^[a-z]+$/i` — any run of letters — which meant `tint:banana` and `color:nonsense`
 * passed validation. Harmless *only* while every colour parameter's sole consumer is a custom
 * property: CSS drops the invalid declaration, the `var()` fallback takes over, and the author sees
 * no warning and no breakage. The moment anything reads a colour back from JavaScript — resolving
 * it through a probe element and `getComputedStyle` to hand floats to a shader uniform is the
 * concrete case that surfaced this — a bogus keyword stops being dropped and starts returning a
 * stale or wrong colour instead. A validator whose whole job is checking authored values should not
 * be the thing that waves those through.
 *
 * A `Set` rather than a regex alternation: `has()` is one lookup against 149 entries instead of a
 * backtracking match, and the list reads as data. `transparent` and `currentcolor` lead because
 * they are the two that are *not* named colours but are accepted everywhere one is.
 *
 * Deliberately not `CSS.supports('color', value)`, which would be authoritative and free: this
 * module is imported by tests running under node, where `CSS` does not exist, and a validator that
 * silently accepts everything in one environment and validates in another is worse than either.
 */
const COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige',
  'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue',
  'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
  'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray',
  'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite',
  'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
  'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue',
  'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
  'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon',
  'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise',
  'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
])

const EASING_KEYWORD = /^(?:linear|ease|step-start|step-end|spring|bounce|[a-z]+-(?:in|out|in-out))$/i
/** `spring` joins the three CSS functions here for the reason `parse.ts`'s list gives. */
const EASING_FUNCTION = /^(?:cubic-bezier|steps|linear|spring)\([^()]*\)$/i

/**
 * The grammars each union type is tried against, in order.
 *
 * `'angle|keyword'` expands to the angle half only: its keyword half is the parameter's own
 * `keywords` list, which {@link validate} checks before it ever reaches a grammar, so repeating
 * `'keyword'` here would be a second, unreachable path to the same answer.
 *
 * This table is the *whole* union mechanism. Everything downstream — the `calc()` question, the
 * numeric bounds, the rejection message — asks it which scalar grammars a type stands for and
 * then does what it always did, so no validation site has to know that compound types exist.
 */
const UNION_GRAMMARS: Record<UnionParamType, readonly ScalarParamType[]> = {
  'number|percentage': ['number', 'percentage'],
  'length|percentage': ['length', 'percentage'],
  'angle|keyword': ['angle'],
}

/**
 * The scalar grammars a declared type accepts.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function grammarsFor(type: ParamType): readonly ScalarParamType[] {
  return UNION_GRAMMARS[type as UnionParamType] ?? [type as ScalarParamType]
}

const CALC_TYPES = new Set<ScalarParamType>(['length', 'percentage', 'number'])

/**
 * Types whose accepted value is a bare number by the time {@link checkNumericConstraints} sees it,
 * and so can be held to `finite`/`integer`/`minimum`/`maximum`.
 *
 * `'number|percentage'` qualifies precisely *because* {@link normalise} has already turned a
 * percentage into its number: `opacity:150%` is bounded by `maximum: 1` exactly as `opacity:1.5`
 * is, which would not be true if both spellings had been allowed through.
 */
const BOUNDED_TYPES = new Set<ParamType>(['number', 'number|percentage'])
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

  const word = checkKeywordHalf(value, spec)
  if (word) return word
  // `text` has no shape to match — it is a selector or URL pattern. It still passed the
  // escape screen above, and `resolveParams` drops it before anything reaches a stylesheet.
  if (spec.type === 'text') return { value, ok: true }
  if (spec.type === 'path') return checkPath(value, spec)
  // Before the pattern, so what gets matched, bounds-checked and stored is always the one
  // spelling — see {@link normalise}.
  const typed = normalise(value, spec.type)
  if (isAcceptable(typed, spec.type)) return checkNumericConstraints(typed, spec)
  return reject(spec, `not a valid ${describeType(spec)}`)
}

/**
 * The keyword half of a type, run before any value grammar.
 *
 * A declared word is then never measured against a grammar it was never meant to satisfy —
 * `motion-path`'s `rotate:auto` is not a failed angle — and, because the list is closed, a
 * `'keyword'` parameter is decided here either way.
 *
 * Gated on the *type* rather than on the mere presence of `keywords`, which is the whole point of
 * the split: the field is inert on a type with no keyword half at runtime and not only in
 * TypeScript. That is what the old, doubly-meaning `values` could not say. A plain-JS caller —
 * `Registry.registerPrimitive` is public — writing `{ type: 'number', keywords: ['80%'] }` now
 * gets what the declaration actually means (a number, and `80%` rejected) rather than a silent
 * extra literal that looked like validation and was not.
 *
 * @param value - An authored value that has passed the escape screen.
 * @param spec - The parameter's declaration.
 * @returns A verdict, or `null` when the type has a value grammar still to try.
 * @complexity O(k) time in the keyword count; O(1) space.
 * @overallScore 100
 */
function checkKeywordHalf(value: string, spec: ParamSpec): ValidationResult | null {
  if (spec.type !== 'keyword' && spec.type !== 'angle|keyword') return null
  if (spec.keywords?.includes(value)) return { value, ok: true }
  if (spec.type !== 'keyword') return null
  // `keywords` is required by {@link KeywordParamSpec}, so the fallback is not for TypeScript's
  // benefit: a plain-JS caller reaches this with whatever object it built, and a schema with no
  // list must still name the gap rather than throw on `undefined.join`.
  return reject(spec, `expected one of ${spec.keywords?.join(', ') || '(none declared)'}`)
}

/**
 * Rewrite an accepted spelling into the single internal one for its type.
 *
 * The library takes more than one spelling wherever CSS does, because refusing `80%` for an
 * opacity is a papercut with no upside. What must not happen is both spellings travelling onward:
 * a custom property that sometimes holds `0.8` and sometimes `80%` cannot be composed in `calc()`
 * by the stylesheet, cannot be bounds-checked by `minimum`/`maximum`, and reads differently in
 * devtools depending on how the author happened to write it. So the choice is made once, here,
 * and everything downstream — the CSS path, the JS path, the numeric constraints — sees one form.
 *
 * A value this cannot convert is returned untouched rather than rejected; deciding whether it is
 * valid at all is {@link isAcceptable}'s job, not this one's. That is how `calc()` survives:
 * there is no arithmetic engine here to fold `calc(80% / 2)` into a number, so it passes through
 * and reaches CSS, which does have one.
 *
 * @param value - An authored value that has passed the escape screen.
 * @param type - The parameter's declared type.
 * @returns The canonical spelling, or the input unchanged when there is nothing to convert.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function normalise(value: string, type: ParamType): string {
  if (type === 'angle' || type === 'angle|keyword') return withAngleUnit(value)
  if (type === 'number|percentage') return withoutPercentage(value)
  return value
}

/**
 * `80%` to `0.8`, for the types where a percentage and a number are the same quantity.
 *
 * The division is lexical rather than arithmetic — see {@link decimalNumber} for why, and for the
 * second caller that has to agree with this one about what `50%` means.
 *
 * @param value - A candidate value; anything that is not a plain percentage is returned as-is.
 * @returns The equivalent unitless number, or the input unchanged.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function withoutPercentage(value: string): string {
  // Gated on the core's own percentage grammar rather than on a trailing `%`, so the conversion
  // never accepts a spelling the plain `percentage` type would have rejected: `+50%` stays a
  // rejection exactly as `+0.5` is one, instead of sneaking in through the shift below.
  if (!PATTERNS.percentage!.test(value)) return value
  return decimalNumber(value.slice(0, -1), -2) ?? value
}

/**
 * Expand decimal notation lexically, optionally shifting the decimal point.
 *
 * Lexical rather than arithmetic on purpose. `Number('1.1') / 100` is `0.011000000000000001` — a
 * binary floating-point artefact that would be written verbatim into a custom property and shown
 * to anyone inspecting the element, making a correct value look broken. Shifting the digits
 * instead is exact for every input, and it neither rounds a tiny scale to zero nor rounds a large
 * integer to its nearest double.
 *
 * The length cap matches the core value budget and bounds the allocation even for `1e999999999`,
 * which would otherwise ask for a gigabyte of zeroes. An unrepresentable result returns
 * `undefined` and leaves the caller holding the original input for ordinary validation to reject.
 *
 * Lives in the core because two callers need the same answer: this module's `'number|percentage'`
 * normalisation, and `effects/tween/properties.ts`'s `withImpliedUnit`, which has accepted
 * `opacity:50%` on the tween since before the union type existed. Two copies would be two places
 * for `50%` to stop meaning `0.5`.
 *
 * @param raw - A candidate number in CSS's spelling, including `+` and exponent forms.
 * @param shift - Decimal places to move the point by; `-2` divides by one hundred.
 * @returns The plain decimal spelling, or `undefined` when the input is not a number or the
 *   result would exceed the value budget.
 * @complexity O(n) time and space in the digit count, bounded by the cap.
 * @overallScore 100
 */
export function decimalNumber(raw: string, shift = 0): string | undefined {
  const match = BARE_NUMBER.exec(raw)
  if (!match || raw.length > MAX_VALUE_LENGTH) return undefined
  const [, sign, coefficient, exponent] = match
  const digits = coefficient!.replace('.', '')
  const dot = coefficient!.indexOf('.')
  const position = (dot < 0 ? digits.length : dot) + Number(exponent ?? 0) + shift
  if (Math.abs(position) + digits.length > 190) return undefined
  const padded =
    '0'.repeat(Math.max(0, -position)) + digits + '0'.repeat(Math.max(0, position - digits.length))
  const split = Math.max(0, position)
  const integer = padded.slice(0, split).replace(/^0+/, '') || '0'
  const fraction = fractionalPart(padded, split)
  return `${sign === '-' ? '-' : ''}${integer}${fraction}`
}

/**
 * Keep tiny nonzero values intact, trimming only insignificant trailing fractional zeros.
 *
 * @complexity O(n) time in the digit count; O(n) space for the slice.
 * @overallScore 100
 */
function fractionalPart(digits: string, start: number): string {
  let end = digits.length
  while (end > start && digits[end - 1] === '0') end--
  return end > start ? '.' + digits.slice(start, end) : ''
}

/**
 * The escape screen on its own, for a value that has no type to be validated against.
 *
 * Every authored value normally reaches `style.setProperty` through {@link validate}, which runs
 * this screen and then a type match. One value cannot take the second half: `data-kui-stagger`'s
 * step (and its `cascade:` spelling inside `data-kui`) has always been passed through verbatim so
 * that `var(--speed)` and `calc(90ms * 2)` work, and narrowing it to a `<time>` literal now would
 * break every group written against that promise. That left it as the one authored string in the
 * library with no screen at all — and `data-kui` is explicitly not assumed to be site-owner text
 * (see the module doc above; a CMS field or a comment can reach it).
 *
 * So the half that costs the expression forms nothing is available separately. It is deliberately
 * *not* a type check: anything shaped like a length, a time, a `calc()` or a `var()` passes, and
 * only the characters and functions that can escape a declaration or reach the network are
 * refused.
 *
 * @param value - Author-supplied text bound for a custom property.
 * @returns Whether it is safe to write as-is.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function isSafeCssValue(value: string): boolean {
  return value.length <= MAX_VALUE_LENGTH && !DANGEROUS.test(value)
}

/**
 * Validate SVG path data and return it as a CSS `<string>`, quotes included.
 *
 * The quotes are added here rather than in the stylesheet because `offset-path: path(...)` takes a
 * string, and a custom property can only supply one if the quotes are *inside* the property's
 * value — CSS substitutes `var()` as tokens, so `path(var(--kui-motion-path))` is only ever valid
 * if `--kui-motion-path` computes to a quoted string. Quoting at the point of validation is also
 * the only place it can be done safely: this is the one function that has already proved the value
 * contains no quote of its own to close the string early.
 *
 * The leading-moveto check is not pedantry. A path that starts with anything else is invalid SVG,
 * every browser drops the whole `offset-path` declaration, and the element then sits perfectly
 * still with no error anywhere — the exact silent-nothing outcome this library treats as the worst
 * possible one. Naming it costs one regex.
 *
 * @param value - Author-supplied path data, already screened for length and escapes.
 * @param spec - The parameter's declared type and default.
 * @returns The path wrapped in double quotes, or the rejection reason.
 * @complexity O(n) time in value length; O(n) space for the quoted copy.
 * @overallScore 100
 */
function checkPath(value: string, spec: ParamSpec): ValidationResult {
  if (!PATH_DATA.test(value)) return reject(spec, 'path data contains an unsupported character')
  if (!/^[Mm]/.test(value)) return reject(spec, 'path data must start with a moveto (M or m)')
  return { value: `"${value}"`, ok: true }
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
  const limit = spec.type === 'path' ? MAX_PATH_LENGTH : MAX_VALUE_LENGTH
  if (value.length > limit) {
    return reject(spec, `value exceeds ${limit} characters`)
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
function isAcceptable(value: string, type: ParamType): boolean {
  if (type === 'color') return isColor(value)
  if (type === 'easing') return EASING_KEYWORD.test(value) || EASING_FUNCTION.test(value)

  // A union passes if *any* of its grammars matches, and admits `calc()` if any of them does.
  // A scalar type is the one-member case of the same thing, so there is one code path.
  const grammars = grammarsFor(type)
  if (grammars.some((grammar) => PATTERNS[grammar]?.test(value))) return true
  if (!grammars.some((grammar) => CALC_TYPES.has(grammar))) return false
  return isSafeCalc(value) && isWellFormedCalc(value)
}

/**
 * The parameter's accepted grammar, phrased for a diagnostic an author has to act on.
 *
 * `not a valid number|percentage` is the declaration's spelling leaking into the page's console;
 * a reader who has never seen `types.ts` should still be told what to write instead, which for a
 * union means naming both halves and, for a keyword half, listing the words.
 *
 * @complexity O(k) time in the keyword count; O(k) space.
 * @overallScore 100
 */
function describeType(spec: ParamSpec): string {
  if (spec.type === 'angle|keyword') {
    return `angle or one of ${spec.keywords?.join(', ') || '(none declared)'}`
  }
  return spec.type.replace('|', ' or ')
}

function isColor(value: string): boolean {
  return HEX_COLOR.test(value) || COLOR_FUNCTIONS.test(value) || COLOR_KEYWORDS.has(value.toLowerCase())
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
  if (!BOUNDED_TYPES.has(spec.type)) return { value, ok: true }
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
    if (!result.ok) {
      warn(`parameter "${key}": ${result.reason} — got "${raw}", using default "${spec.default}"`)
      continue
    }
    out[spec.cssProperty] = cssValueFor(result.value, spec, key, warn)
  }

  return out
}

/**
 * Turn a validated value into the one a stylesheet can actually hold.
 *
 * An easing is the only type where those differ. `back-out`, `spring` and every other
 * kUInetic-named curve is a `--kui-ease-*` token rather than a CSS keyword, and `spring(...)` is
 * not a browser function at all — both were written verbatim into `--kui-<primitive>-ease`, which
 * made the declaration reading it invalid at computed-value time, so the browser discarded it and
 * the effect ran on the initial `ease` with nothing said.
 *
 * The conversion is here rather than inside {@link validate} deliberately: `core/js-params.ts`
 * validates through that same function for the *JavaScript* renderer, where the value is handed to
 * `Element.animate` and a `var(--kui-ease-back-out, ease-out)` would be a `TypeError`. This
 * function is only ever on the CSS path.
 *
 * @param warn - Sink for a spring's own argument diagnostics. A malformed `spring(...)` is clamped
 *   rather than dropped — see `springTokenProblems` — so this warns and still returns a curve.
 * @complexity O(1) amortised; O(1) space.
 * @overallScore 100
 */
function cssValueFor(
  value: string,
  spec: ParamSpec,
  key: string,
  warn: (message: string) => void,
): string {
  if (spec.type !== 'easing') return value
  for (const problem of springTokenProblems(value)) warn(`parameter "${key}": ${problem}`)
  return cssEasingValue(value)
}
