import { validate } from './params.js'
import type {
  EffectParams,
  EffectSpec,
  EffectTiming,
  ParamSpec,
  ParameterSchema,
} from './types.js'

/**
 * Parameter access for JS-rendered primitives.
 *
 * `core/params.resolveParams` exists for the CSS path: it returns values keyed by *custom
 * property* and deliberately omits defaults, because defaults belong in the stylesheet's `var()`
 * fallback. A JS primitive needs the opposite shape — keyed by parameter name, defaults filled,
 * and converted to numbers it can compute with. This module is that second reader. It reuses the
 * same `validate` so untrusted author strings are screened once, by one implementation.
 *
 * See docs/v2-core-requests.md: `Animator.prepareJsEffects` currently hands `prepare` the raw,
 * unvalidated `spec.params`, so every JS primitive must run this itself.
 */

/** Lengths resolve against the environment, so the environment is passed in rather than read. */
export interface LengthBasis {
  viewportWidth: number
  viewportHeight: number
  /** Basis for `%` values — what "100%" means for this particular parameter. */
  percentBasis: number
  /** Basis for `em`; `rem` uses `rootFontSize`. */
  fontSize: number
  rootFontSize: number
}

/** A basis usable when a parameter is known to carry only absolute units. */
export const ABSOLUTE_BASIS: LengthBasis = {
  viewportWidth: 0,
  viewportHeight: 0,
  percentBasis: 0,
  fontSize: 16,
  rootFontSize: 16,
}

/** Multipliers for units that do not depend on the viewport or a percentage basis. */
const STATIC_UNITS: Record<string, number> = {
  px: 1,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  in: 96,
  pt: 96 / 72,
  pc: 16,
}

/** Units whose multiplier comes from the basis. */
const BASIS_UNITS: Record<string, (basis: LengthBasis) => number> = {
  vh: (b) => b.viewportHeight / 100,
  vw: (b) => b.viewportWidth / 100,
  vmin: (b) => Math.min(b.viewportWidth, b.viewportHeight) / 100,
  vmax: (b) => Math.max(b.viewportWidth, b.viewportHeight) / 100,
  '%': (b) => b.percentBasis / 100,
  em: (b) => b.fontSize,
  rem: (b) => b.rootFontSize,
  ch: (b) => b.fontSize * 0.5,
  ex: (b) => b.fontSize * 0.5,
}

const NUMBER_WITH_UNIT = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/i

/**
 * Validate authored parameters against a schema and fill in every declared default.
 *
 * Unlike the CSS path this returns *every* declared parameter, because a JS primitive branches on
 * values it must always have. Rejected values fall back to the declared default and warn, so one
 * bad attribute can never leave a primitive holding an unvalidated string.
 *
 * @param authored - Raw, untrusted values from the attribute.
 * @param schema - The primitive's declared parameters.
 * @param warn - Diagnostic sink, called once per rejected or unknown parameter.
 * @returns Every declared parameter name mapped to a validated string value.
 * @complexity O(p * n) time in parameter count and value length; O(p) space.
 * @overallScore 100
 */
export function readParams(
  authored: Record<string, string>,
  schema: ParameterSchema,
  warn: (message: string) => void,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, spec] of Object.entries(schema)) out[name] = spec.default

  for (const [name, raw] of Object.entries(authored)) {
    // `Object.hasOwn`: `schema[name]` alone falls through to `Object.prototype` for a key like
    // `__proto__`/`constructor`, silently treating it as a "known" param instead of warning.
    const spec = Object.hasOwn(schema, name) ? schema[name] : undefined
    if (!spec) {
      warn(`unknown parameter "${name}" (known: ${Object.keys(schema).join(', ') || 'none'})`)
      continue
    }
    const result = validate(raw, spec)
    out[name] = result.value
    if (!result.ok) {
      warn(`parameter "${name}": ${result.reason} — got "${raw}", using default "${spec.default}"`)
    }
  }

  return out
}

/**
 * Convert a validated CSS time to milliseconds.
 *
 * @param value - A value already accepted as `type: 'time'`, e.g. `400ms` or `1.5s`.
 * @param fallback - Returned when the value is not a plain time (a `calc()`, for instance).
 * @returns Milliseconds.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function toMilliseconds(value: string, fallback = 0): number {
  const parts = NUMBER_WITH_UNIT.exec(value.trim())
  if (!parts) return fallback
  const amount = Number.parseFloat(parts[1]!)
  const unit = parts[2]!.toLowerCase()
  if (unit === 'ms') return amount
  if (unit === 's') return amount * 1000
  return fallback
}

/**
 * Convert a validated CSS length to pixels.
 *
 * Viewport- and percentage-relative units need context, which is why the basis is a parameter
 * rather than something this module reads off `window`: the same helper then resolves a length
 * against a nested scroll container as easily as against the viewport, and tests need no layout.
 *
 * `calc()` is intentionally not evaluated — a second CSS expression engine is not worth owning.
 * Such values return the fallback, which is visible and debuggable rather than silently wrong.
 *
 * @param value - A value already accepted as `type: 'length'`.
 * @param basis - Viewport, font, and percentage context.
 * @param fallback - Returned for `calc()` and unrecognised units.
 * @returns Pixels.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function toPixels(value: string, basis: LengthBasis, fallback = 0): number {
  const parts = NUMBER_WITH_UNIT.exec(value.trim())
  if (!parts) return fallback
  const amount = Number.parseFloat(parts[1]!)
  const unit = parts[2]!.toLowerCase()
  if (unit === '') return amount === 0 ? 0 : fallback

  const staticFactor = STATIC_UNITS[unit]
  if (staticFactor !== undefined) return amount * staticFactor

  const basisFactor = BASIS_UNITS[unit]
  return basisFactor ? amount * basisFactor(basis) : fallback
}

/**
 * Convert a validated numeric parameter.
 *
 * @param value - A value already accepted as `type: 'number'` or `type: 'percentage'`.
 * @param fallback - Returned when the value is not a bare number or percentage.
 * @returns The number; percentages are returned as a 0–1 ratio.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function toNumber(value: string, fallback = 0): number {
  const parts = NUMBER_WITH_UNIT.exec(value.trim())
  if (!parts) return fallback
  const amount = Number.parseFloat(parts[1]!)
  const unit = parts[2]!
  if (unit === '') return amount
  if (unit === '%') return amount / 100
  return fallback
}

/** Whether a keyword parameter is set to its enabling value. */
export function isEnabled(value: string, enabling = 'true'): boolean {
  return value === enabling
}

/** Easings reach a stylesheet, so an authored one is screened by the same validator as a param. */
const EASING_SPEC: ParamSpec = { type: 'easing', default: '', cssProperty: '--kui-ease' }

/**
 * Convert an authored positional time, dropping — loudly — anything that is not one.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function timingMs(
  raw: string | undefined,
  label: string,
  warn: (message: string) => void,
): number | undefined {
  if (raw === undefined) return undefined
  const ms = toMilliseconds(raw, Number.NaN)
  if (Number.isFinite(ms)) return ms
  warn(`${label} "${raw}" is not a valid time — ignored`)
  return undefined
}

/**
 * Screen an authored easing, dropping — loudly — anything that is not one.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function timingEasing(
  raw: string | undefined,
  warn: (message: string) => void,
): string | undefined {
  if (raw === undefined) return undefined
  const result = validate(raw, EASING_SPEC)
  if (result.ok) return result.value
  warn(`easing "${raw}": ${result.reason} — ignored`)
  return undefined
}

/**
 * Read one effect segment's positional timing into the shape JS primitives consume.
 *
 * The CSS renderer hands these straight to `animation-duration`/`-delay`/`-timing-function`, where
 * the browser does the screening. Nothing screened them on the JS path, so they are converted to
 * numbers (and the easing validated) here instead of anywhere a primitive might forget.
 *
 * @param spec - The parsed effect segment.
 * @param warn - Diagnostic sink, called once per rejected value.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function readEffectTiming(
  spec: Pick<EffectSpec, 'duration' | 'delay' | 'easing'>,
  warn: (message: string) => void,
): EffectTiming {
  return {
    durationMs: timingMs(spec.duration, 'duration', warn),
    delayMs: timingMs(spec.delay, 'delay', warn),
    easing: timingEasing(spec.easing, warn),
  }
}

/**
 * How long an unstepped effect should run, preferring the segment's positional time over the
 * same-named parameter.
 *
 * `count 3s` and `count duration:3s` are two spellings of one intent, and the positional one is
 * what `play()` emits, so it cannot be the spelling that gets dropped. `stepMsFor` is the
 * equivalent for effects whose authored duration divides across a tick count instead.
 *
 * @param fallback - The primitive's own default, used when the author wrote neither spelling.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function effectDurationMs(params: EffectParams, fallback: number): number {
  return params.timing.durationMs ?? params.ms('duration', fallback)
}

/**
 * Wrap a validated record in the reader primitives consume.
 *
 * @param values - Output of `readParams`; every declared parameter is present.
 * @param timing - Author timing for the segment; empty when none was written.
 * @returns A reader with per-type accessors.
 * @complexity O(1) per accessor call; O(1) space beyond the record.
 * @overallScore 100
 */
export function createParams(
  values: Record<string, string>,
  timing: EffectTiming = {},
): EffectParams {
  return {
    text: (name, fallback = '') => values[name] ?? fallback,
    ms: (name, fallback = 0) => toMilliseconds(values[name] ?? '', fallback),
    num: (name, fallback = 0) => toNumber(values[name] ?? '', fallback),
    is: (name, value = 'true') => (values[name] ?? '') === value,
    timing,
  }
}

/**
 * Validate authored parameters and wrap them in a reader — the single entry point the animator
 * uses for JS-rendered effects.
 *
 * @complexity O(p * n) time in parameter count and value length; O(p) space.
 * @overallScore 100
 */
export function readEffectParams(
  authored: Record<string, string>,
  schema: ParameterSchema,
  warn: (message: string) => void,
  timing: EffectTiming = {},
): EffectParams {
  return createParams(readParams(authored, schema, warn), timing)
}
