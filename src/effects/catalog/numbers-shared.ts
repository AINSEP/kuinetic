import type { Cleanup } from '../../core/types.js'

/** Formats `count` can render its tweened value in. */
export type CountFormat = 'number' | 'currency' | 'percent' | 'compact'

export interface CountFormatOptions {
  format: CountFormat
  decimals: number
  currency: string
}

const SR_ONLY_CLASS = 'kui-sr-only'
const DECORATIVE_CLASS = 'kui-count-decorative'

export interface CountLayers {
  /** `aria-hidden` node the ticking display writes to on every frame. */
  decorative: HTMLElement
  /**
   * Visually-hidden twin. The caller must write this exactly once, on completion — never
   * mid-tick — so a screen reader is told the final value and nothing in between.
   */
  srOnly: HTMLElement
  /** Remove both layers, restoring the element to plain text of whatever the SR layer last held. */
  restore: Cleanup
}

/**
 * Replace an element's content with an `aria-hidden` ticking display plus a visually-hidden twin,
 * both empty until the caller populates them, so a counter's mid-flight text is never read aloud
 * and its `aria-live` region changes exactly once.
 *
 * @param el - Element whose content is being taken over. Assumed to hold no meaningful children.
 * @param doc - Document to create nodes in, rather than the ambient global.
 * @returns The decorative node to tick, the SR-only node to finalize once, and a cleanup.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function installCountLayers(el: Element, doc: Document): CountLayers {
  const decorative = doc.createElement('span')
  decorative.setAttribute('aria-hidden', 'true')
  decorative.className = DECORATIVE_CLASS

  const srOnly = doc.createElement('span')
  srOnly.className = SR_ONLY_CLASS
  srOnly.setAttribute('aria-live', 'polite')

  el.textContent = ''
  el.append(decorative, srOnly)

  return {
    decorative,
    srOnly,
    restore: () => {
      // `Node.textContent` is only ever `null` for a `Document`/`DocumentType` node per the DOM
      // spec; `srOnly` is a `<span>` created just above, so this is always a string.
      el.textContent = srOnly.textContent!
    },
  }
}

/**
 * Ease a linear 0–1 ratio for a count tween. Counters read as mechanical on a linear ramp; cubic
 * ease-out gives the settle a physical "spinning down" character without a spring's overshoot,
 * which would put a currency counter briefly past its final total.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1)
  return 1 - (1 - clamped) ** 3
}

/**
 * Interpolate between `from` and `to` at an already-eased ratio.
 *
 * @param t - Eased progress, 0–1. Not clamped here — `easeOutCubic` already clamps its input.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function tweenValue(t: number, from: number, to: number): number {
  return from + (to - from) * t
}

/**
 * Build a JS evaluator for a CSS `cubic-bezier(x1, y1, x2, y2)` curve.
 *
 * Newton-Raphson converges in a handful of iterations for any well-formed curve; the bisection
 * fallback only matters near a flat tangent (a `back-*` curve's overshoot, for instance), where
 * Newton's derivative division would otherwise overshoot forever. Mirrors the algorithm browsers
 * themselves use for `animation-timing-function: cubic-bezier(...)` (WebKit's `UnitBezier`).
 *
 * @complexity O(1) time per call (bounded iteration count); O(1) space.
 * @overallScore 100
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx

  function solveT(x: number): number {
    let t = x
    for (let i = 0; i < 8; i++) {
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      const next = t - (sampleX(t) - x) / slope
      if (Math.abs(sampleX(next) - x) < 1e-6) return next
      t = next
    }
    let lo = 0
    let hi = 1
    t = x
    while (hi - lo > 1e-6) {
      if (sampleX(t) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }

  return (t: number) => sampleY(solveT(Math.min(Math.max(t, 0), 1)))
}

/**
 * Control points for keyword easings a counter tween can resolve without a CSS engine. The
 * `ease*` values are the CSS spec's own bezier equivalents; the rest mirror the curves
 * `base.css` writes into `--kui-ease-*`, so a JS-tweened counter given `back-out` settles along
 * the exact same curve a CSS-rendered effect given `back-out` would.
 */
const EASING_KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'expo-in': [0.7, 0, 0.84, 0],
  'expo-out': [0.16, 1, 0.3, 1],
  'expo-in-out': [0.87, 0, 0.13, 1],
  'back-in': [0.36, 0, 0.66, -0.56],
  'back-out': [0.34, 1.56, 0.64, 1],
  'back-in-out': [0.68, -0.6, 0.32, 1.6],
  'quart-out': [0.25, 1, 0.5, 1],
  'circ-out': [0, 0.55, 0.45, 1],
}

const CUBIC_BEZIER_FN =
  /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i

/**
 * Resolve an author's validated `EffectTiming.easing` to a JS evaluator a tween can call per tick.
 *
 * `easeOutCubic` is both the historical no-easing-authored default and the fallback for a value
 * this cannot map: `steps()`/`linear()` functions, `step-start`/`step-end`, `spring` (a keyframed
 * `linear()` easing, not a bezier), or any keyword outside the table above. Falling back silently
 * would leave an author's explicit easing quietly ignored a second time — the exact bug this
 * function exists to close — so every unmapped-but-authored value warns once instead.
 *
 * @param warn - Diagnostic sink, called once for an easing this cannot map.
 * @complexity O(1) time and space beyond the returned evaluator's own bounded solve.
 * @overallScore 100
 */
export function resolveEasing(
  easing: string | undefined,
  warn: (message: string) => void,
): (t: number) => number {
  if (easing === undefined) return easeOutCubic
  if (easing === 'linear') return (t) => Math.min(Math.max(t, 0), 1)
  const keyword = EASING_KEYWORDS[easing]
  if (keyword) return cubicBezier(...keyword)
  const fn = CUBIC_BEZIER_FN.exec(easing)
  if (fn) return cubicBezier(Number(fn[1]), Number(fn[2]), Number(fn[3]), Number(fn[4]))
  warn(`easing "${easing}" has no JS equivalent for a counter tween — using the default ease-out`)
  return easeOutCubic
}

const COMPACT_OPTIONS: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 }

/**
 * Format a tweened numeric value for display, sharing one formatter shape across the four
 * text-rendered count presets rather than each hand-rolling its own string building.
 *
 * @param value - Current tweened value.
 * @param options - Which display family to use, decimal precision, and currency code.
 * @returns The formatted string for this frame.
 * @complexity O(1) time and space (bounded by `Intl.NumberFormat`'s own cost).
 * @overallScore 100
 */
export function formatCount(value: number, options: CountFormatOptions): string {
  const { format, decimals, currency } = options
  if (format === 'currency') {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }
  if (format === 'percent') {
    return new Intl.NumberFormat(undefined, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }
  if (format === 'compact') {
    return new Intl.NumberFormat(undefined, COMPACT_OPTIONS).format(value)
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * Render a non-negative integer as a fixed-width digit string, so an odometer's column count
 * never changes mid-count — only the digits inside each column do.
 *
 * @param value - Non-negative integer to render.
 * @param width - Minimum digit count; shorter values are left-padded with zeros.
 * @complexity O(w) time and space in the output width.
 * @overallScore 100
 */
export function paddedDigits(value: number, width: number): string {
  return Math.round(Math.max(0, value)).toString().padStart(width, '0')
}

/**
 * Insert thousands separators into a fixed-width digit string, grouping from the right.
 *
 * @complexity O(n) time and space in digit count.
 * @overallScore 100
 */
export function groupDigits(digits: string): string {
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(',')
}

/**
 * Split a grouped digit string into its digit characters and the separators between them, so the
 * odometer can roll digits in place while leaving separators static.
 *
 * @param grouped - A grouped digit string, e.g. "12,480".
 * @returns One token per character, tagged as a rolling digit or a static separator.
 * @complexity O(n) time and space in string length.
 * @overallScore 100
 */
export function odometerTokens(grouped: string): { char: string; digit: boolean }[] {
  return [...grouped].map((char) => ({ char, digit: char >= '0' && char <= '9' }))
}
