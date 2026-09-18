/**
 * An authored `<angle>` as a number of degrees.
 *
 * Copied from `degreesOf` in `src/effects/carousel/index.ts:523` rather than imported: that file is
 * part of the default catalog, and a value import from it would pull the catalog into this tier's
 * bundle to save nine lines. See `src/3d/register.ts` for the same argument at length.
 *
 * It has to exist at all because `core/js-params.ts`'s `toNumber` (js-params.ts:165) returns its
 * *fallback* for any unit other than `''` and `%` — `params.num('spin')` on a validated `"360deg"`
 * reads back as `0`. `core/params.ts` accepts every CSS angle unit and normalises only the bare and
 * `d`-suffixed spellings to `deg`, so a value reaching here can legitimately be `0.05turn` or
 * `1.2rad`, and `Number('0.05turn')` is `NaN`.
 *
 * Falls back rather than throwing on an unrecognised unit, for the reason every reader in this
 * library does: the value has already been validated, so an unfamiliar spelling here means this
 * function is behind `params.ts`, and a model that does not spin is a better answer than one that
 * throws during `prepare`.
 *
 * @param value - A validated CSS angle.
 * @param fallbackDeg - Used when the value is not an angle this function converts.
 * @returns Degrees.
 * @complexity O(n) time in value length; O(1) space.
 */
export function degreesOf(value: string, fallbackDeg: number): number {
  const match = /^(-?[\d.]+)(deg|rad|turn|grad)?$/i.exec(value.trim())
  if (!match) return fallbackDeg
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return fallbackDeg
  switch ((match[2] ?? 'deg').toLowerCase()) {
    case 'rad':
      return (amount * 180) / Math.PI
    case 'turn':
      return amount * 360
    case 'grad':
      return amount * 0.9
    default:
      return amount
  }
}

/**
 * Clamp to an inclusive range.
 *
 * @complexity O(1).
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}
