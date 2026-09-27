/**
 * Owned by phase 9a — the pre-JS cloak selector strings, pulled out of
 * `scripts/generate-preset-css.mjs` so the generator can grow the comma-form handling 9a needs
 * (`cloak: true`/`cloak:'.a, .b'`-style selector lists, per the owner decision) without hand-editing
 * the bundled generator script directly.
 *
 * STUB (§1): both functions return HEAD's exact current strings
 * (`generate-preset-css.mjs:132-134` and `:162`), so wiring the generator to call through here (S-12)
 * is a byte-for-byte no-op — `npm run generate:css` produces no diff to `presets.generated.css`
 * until 9a actually changes what these return.
 */

/**
 * The pre-JS cloak selector for one preset name — matched while `<html data-kui-cloak>` is still
 * present, so an element carrying that preset stays hidden until the animator's own `data-kui-*`
 * state attribute lands and the ordinary ready-gate rules take over.
 *
 * @param name - The preset name, as written in `data-kui`.
 * @returns One selector line (no trailing comma or newline).
 * STUB: HEAD's exact string.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function cloakSelector(name: string): string {
  return `  html[data-kui-cloak] [data-kui~='${name}']:not([data-kui-state])`
}

/**
 * The gate-release selector for one gate token (e.g. `above:md`) — the selector half of
 * `gateReleaseRules`'s per-token block, without the trailing ` {` a caller appends itself.
 *
 * @param token - The gate token, as written in `data-kui`.
 * @returns One selector line (no trailing ` {` or newline).
 * STUB: HEAD's exact string.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function gateReleaseSelector(token: string): string {
  return `    html[data-kui-cloak] [data-kui~='${token}']:not([data-kui-state])`
}
