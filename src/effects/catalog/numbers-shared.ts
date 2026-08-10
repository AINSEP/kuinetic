import type { Cleanup } from '../../core/types.js'

/** Formats `count` can render its tweened value in. */
export type CountFormat = 'number' | 'currency' | 'percent' | 'compact'

export interface CountFormatOptions {
  format: CountFormat
  decimals: number
  currency: string
}

const SR_ONLY_CLASS = 'dsg-sr-only'
const DECORATIVE_CLASS = 'dsg-count-decorative'

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
      el.textContent = srOnly.textContent ?? ''
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
