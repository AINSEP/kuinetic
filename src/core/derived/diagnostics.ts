import type { AnimatorPort } from './types.js'
import type { CompiledTarget } from '../compile.js'
import type { AttributeLedger } from '../owned-styles.js'

/**
 * Owned by phase 5b — the diagnostics `target:` needs beyond an ordinary compile warning, because
 * they depend on the *live* DOM a group resolved against (D(a)'s `data-kui-unmatched`) or on
 * another live element's state (3D nesting, page-scope cloaking) rather than on the attribute text
 * alone.
 *
 * SKELETON STUB (§1): every body is a no-op, so no host is ever stamped `data-kui-unmatched` and
 * neither warning is ever reported — inert until every group genuinely resolves matches for real,
 * which does not happen before 2a lands anyway. Real bodies land with 5b — see
 * `target-phases-2-9.md`.
 */

/**
 * D(a): write `data-kui-unmatched="<sel>, <sel>"` on `host`, listing every `target:` group selector
 * that matched nothing (plus 9b's suspect segments) — the one host-visible signal that a `target:`
 * declaration silently found nothing to animate. Through `attributes` when given, so the write is
 * unwound on release like every other library-owned attribute; a plain `setAttribute`/
 * `removeAttribute` when the host has no ledger at all (it failed outright and was never given
 * one).
 *
 * @param host - The element to stamp.
 * @param selectors - Every selector that matched nothing, in authored order. `[]` removes the
 *   attribute rather than writing an empty one.
 * @param attributes - The host's own attribute ledger, when it has one.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 5b fills this in
export function markUnmatched(host: Element, selectors: string[], attributes?: AttributeLedger): void {}

/**
 * Warn when a derived match whose effects establish a 3D rendering context (`Preset.establishes3d`)
 * sits inside an element — the host, or a live-state ancestor — that is also running one
 * (memory: no-nested-3d). `preserve-3d`/`perspective` contexts do not compose when nested, so this
 * is surfaced as early as possible rather than left to look like a broken effect.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host installing `match`.
 * @param match - The derived match being installed.
 * @param target - The compiled group `match` was claimed by.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 5b fills this in
export function warnNested3d(port: AnimatorPort, host: Element, match: Element, target: CompiledTarget): void {}

/**
 * Warn when a `cloak: true` preset is retargeted with `scope:page` while `<html data-kui-cloak>`
 * is present — a page-scope match can sit anywhere in the document, including outside the host's
 * own subtree, so the pre-JS cloak selector (9a) cannot reach it and it will flash unstyled before
 * the animator ever runs.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host.
 * @param target - The compiled `scope:page` group carrying a `cloak: true` preset.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 5b fills this in
export function warnPageScopeCloak(port: AnimatorPort, host: Element, target: CompiledTarget): void {}
