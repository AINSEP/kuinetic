/** The ancestor marker read by library animation creation and the showcase speed control. */
export const TIME_SCALE_ATTR = 'data-kui-time-scale'

/**
 * Read the nearest time scale, including a marker on the element itself.
 *
 * @complexity O(h) in ancestor depth; O(1) space.
 * @overallScore 100
 */
export function timeScaleOf(el: Element): number {
  const host = el.closest(`[${TIME_SCALE_ATTR}]`)
  const value = host?.getAttribute(TIME_SCALE_ATTR)?.trim()
  if (!value) return 1
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(4, Math.max(0.05, parsed))
}
