import type { Primitive } from '../../core/types.js'

/**
 * Owned by phase 7b — the icon-toggle family's structural parts: a host with no authored
 * `.kui-bar` children gets `data-kui-part="bar"` stamped on its positional bars, restored on
 * teardown, so `svg.css` can style them without the author having to add classes of their own
 * (mirrors 7a's flip-card parts, one prepare layer up).
 *
 * SKELETON STUB (§1): wraps nothing — `withIconParts(inner)` returns `inner` unchanged, so wiring
 * `ICON_TOGGLE_PRIMITIVE.prepare` through it (S-11) is a no-op until 7b lands. Real body lands with
 * 7b — see `target-phases-2-9.md`.
 */

/**
 * Wrap an icon-toggle-family `prepare` so a host with no `.kui-bar` children gets
 * `data-kui-part="bar"` on its positional bars.
 *
 * @param inner - The primitive's own `prepare`, unwrapped.
 * @returns A `prepare` of the same shape, with the part-stamping layered in.
 * STUB: returns `inner` unchanged.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function withIconParts(inner: NonNullable<Primitive['prepare']>): NonNullable<Primitive['prepare']> {
  return inner
}
