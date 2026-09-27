/**
 * Owned by phase 9a — the pre-JS cloak selector strings, pulled out of
 * `scripts/generate-preset-css.mjs` so the generator can grow the comma-form handling 9a needs
 * (`cloak: true`/`cloak:'.a, .b'`-style selector lists, per the owner decision) without hand-editing
 * the bundled generator script directly.
 *
 * `~=` matches a whole whitespace-separated token, but a `data-kui` value's segments are
 * comma-separated, not space-separated — `data-kui="text-reveal-mask,\nfade-up"` puts the comma
 * straight up against the previous word, so the actual whitespace token is `text-reveal-mask,`, not
 * `text-reveal-mask`. An author can glue that comma to either side (or both, mid-list), so each name
 * or gate token needs one `[data-kui~=…]` per comma form, grouped in a single `:is()` so the cloak
 * still matches whichever form the author wrote. `:is()` takes the specificity of its most specific
 * argument; every form here has identical specificity, so the grouped selector keeps HEAD's
 * specificity exactly. A browser old enough to reject `:is()` drops the whole rule and fails open —
 * not cloaking is exactly today's (pre-9a) behaviour, same fail-open the bare-comma case already had.
 */

/**
 * The four ways one `data-kui` token can sit relative to its neighbours' commas: alone, followed by
 * a glued comma, preceded by one, or both (mid-list with no surrounding spaces).
 *
 * @param token - The preset name or gate token, as written in `data-kui`.
 * @returns The four literal token forms, in `[data-kui~=…]` match order.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function cloakTokenForms(token: string): string[] {
  return [token, `${token},`, `,${token}`, `,${token},`]
}

/**
 * Builds the `:is(...)` body matching every comma form of `token`, shared by both selector
 * builders below so their only difference stays the surrounding indentation.
 */
function cloakFormsIs(token: string): string {
  return `:is(${cloakTokenForms(token)
    .map((form) => `[data-kui~='${form}']`)
    .join(', ')})`
}

/**
 * The pre-JS cloak selector for one preset name — matched while `<html data-kui-cloak>` is still
 * present, so an element carrying that preset stays hidden until the animator's own `data-kui-*`
 * state attribute lands and the ordinary ready-gate rules take over.
 *
 * @param name - The preset name, as written in `data-kui`.
 * @returns One selector line (no trailing comma or newline).
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function cloakSelector(name: string): string {
  return `  html[data-kui-cloak] ${cloakFormsIs(name)}:not([data-kui-state])`
}

/**
 * The gate-release selector for one gate token (e.g. `above:md`) — the selector half of
 * `gateReleaseRules`'s per-token block, without the trailing ` {` a caller appends itself.
 *
 * @param token - The gate token, as written in `data-kui`.
 * @returns One selector line (no trailing ` {` or newline).
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function gateReleaseSelector(token: string): string {
  return `    html[data-kui-cloak] ${cloakFormsIs(token)}:not([data-kui-state])`
}
