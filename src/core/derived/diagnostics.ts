import { ATTR } from '../attrs.js'
import type { AnimatorPort } from './types.js'
import type { CompiledTarget } from '../compile.js'
import type { AttributeLedger } from '../owned-styles.js'
import type { Registry } from '../registry.js'

/**
 * Owned by phase 5b — the diagnostics `target:` needs beyond an ordinary compile warning, because
 * they depend on the *live* DOM a group resolved against (D(a)'s `data-kui-unmatched`) or on
 * another live element's state (3D nesting, page-scope cloaking) rather than on the attribute text
 * alone.
 */

/**
 * How far up from a derived match this module walks looking for a live 3D-establishing ancestor
 * (`warnNested3d`), and from a late-inserted node looking for a `target:` host (phase 6's
 * `adoptLateMatches`). Shared here as a constant rather than re-chosen per module so both walks
 * agree on what "too deep to be a real ancestor chain" means; a page is rarely nested this deep, so
 * the bound only ever bites a pathological tree, not a real one.
 */
const ANCESTOR_WALK_BOUND = 64

/**
 * A short, stable label for an element in a warning message — its tag name plus `#id` when it has
 * one. Not a CSS selector (no class list, no uniqueness guarantee): just enough for an author
 * reading a console warning to find the element that was meant.
 */
function describe(el: Element): string {
  return el.id ? `${el.tagName.toLowerCase()}#${el.id}` : el.tagName.toLowerCase()
}

/**
 * Whether any of `names` resolves (via `registry`) to a preset that establishes a 3D rendering
 * context. An unregistered name resolves to `undefined` and is treated as "no" rather than thrown —
 * a bad name is already warned elsewhere (`compile.ts`); this module only reacts to real presets.
 */
function anyEstablishes3d(registry: Registry, names: string[]): boolean {
  return names.some((name) => registry.resolve(name)?.preset.establishes3d === true)
}

/**
 * Whether `el` currently has *its own* running/ready effects that establish a 3D context.
 *
 * Skips a host with `state.aggregate` set: an aggregate host's `fxNames` is the union of every
 * group it aggregates (`Animator.installAggregate`), which always includes its own derived match's
 * effect names — so checking it here would report a match as nested inside itself. See
 * "no-nested-3d" in the project memory and the 2a record-order note this was written against.
 */
function liveEstablishes3d(port: AnimatorPort, el: Element): boolean {
  const state = port.stateOf(el)
  if (!state || state.aggregate) return false
  return anyEstablishes3d(port.registry, state.fxNames)
}

/**
 * Find the nearest element already running a live 3D-establishing effect that `match` would nest
 * inside: `host` itself, else a DOM ancestor of `match` (bounded — see `ANCESTOR_WALK_BOUND`).
 * `host` is checked separately from the ancestor walk because a `scope:page` match need not be a
 * DOM descendant of its host at all, so the walk from `match` upward would never reach it.
 */
function find3dNeighbor(port: AnimatorPort, host: Element, match: Element): Element | undefined {
  if (liveEstablishes3d(port, host)) return host
  let ancestor = match.parentElement
  let depth = 0
  while (ancestor && depth < ANCESTOR_WALK_BOUND) {
    if (ancestor !== host && liveEstablishes3d(port, ancestor)) return ancestor
    ancestor = ancestor.parentElement
    depth++
  }
  return undefined
}

/**
 * D(a): write `data-kui-unmatched="<sel>, <sel>"` on `host`, listing every `target:` group selector
 * that matched nothing (plus 9b's suspect segments) — the one host-visible signal that a `target:`
 * declaration silently found nothing to animate. Through `attributes` when given, so the write is
 * unwound on release like every other library-owned attribute; a plain `setAttribute`/
 * `removeAttribute` when the host has no ledger at all (it failed outright and was never given
 * one).
 *
 * An empty `selectors` removes the attribute rather than writing an empty string. `AttributeLedger`
 * has no `remove`, so that branch always goes straight through `host.removeAttribute` even when a
 * ledger is given — safe, because a ledger only ever records an attribute's original value on its
 * first `set`; if this call never calls `set`, `restore()` has nothing of ours to unwind here.
 *
 * @param host - The element to stamp.
 * @param selectors - Every selector that matched nothing, in authored order. `[]` removes the
 *   attribute rather than writing an empty one.
 * @param attributes - The host's own attribute ledger, when it has one.
 * @complexity O(n) time in `selectors.length` (the join); O(1) space beyond the joined string.
 * @overallScore 100
 */
export function markUnmatched(host: Element, selectors: string[], attributes?: AttributeLedger): void {
  if (selectors.length === 0) {
    host.removeAttribute(ATTR.unmatched)
    return
  }
  const value = selectors.join(', ')
  if (attributes) attributes.set(ATTR.unmatched, value)
  else host.setAttribute(ATTR.unmatched, value)
}

/**
 * Warn when a derived match whose effects establish a 3D rendering context (`Preset.establishes3d`)
 * sits inside an element — the host, or a live-state ancestor — that is also running one
 * (memory: no-nested-3d). `preserve-3d`/`perspective` contexts do not compose when nested, so this
 * is surfaced as early as possible rather than left to look like a broken effect.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host installing `match`.
 * @param match - The derived match being installed.
 * @param target - The compiled group `match` was claimed by (its own group, or 2b's union).
 * @complexity O(d) time in DOM depth, bounded by `ANCESTOR_WALK_BOUND`; O(1) space.
 * @overallScore 100
 */
export function warnNested3d(port: AnimatorPort, host: Element, match: Element, target: CompiledTarget): void {
  if (!anyEstablishes3d(port.registry, target.plan.fxNames)) return
  const neighbor = find3dNeighbor(port, host, match)
  if (!neighbor) return
  const where = neighbor === host ? 'its target: host' : 'an ancestor'
  port.reporter.warn(
    `<${describe(match)}> establishes a 3D rendering context nested inside ${where} <${describe(neighbor)}>, ` +
      `which also runs a 3D-establishing effect — preserve-3d/perspective contexts do not compose when ` +
      `nested, so move one of the two 3D effects off its descendant`,
    match,
  )
}

/**
 * Warn when a `cloak: true` preset is retargeted with `scope:page` while `<html data-kui-cloak>`
 * is present — a page-scope match can sit anywhere in the document, including outside the host's
 * own subtree, so the pre-JS cloak selector (9a) cannot reach it and it will flash unstyled before
 * the animator ever runs.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host.
 * @param target - The compiled `scope:page` group carrying a `cloak: true` preset.
 * @complexity O(n) time in the group's effect count; O(1) space.
 * @overallScore 100
 */
export function warnPageScopeCloak(port: AnimatorPort, host: Element, target: CompiledTarget): void {
  if (target.scope !== 'page') return
  if (!target.plan.fxNames.some((name) => port.registry.resolve(name)?.preset.cloak === true)) return
  if (!host.ownerDocument.documentElement.hasAttribute(ATTR.cloak)) return
  port.reporter.warn(
    `target "${target.selector}" (scope:page) on <${describe(host)}> carries a cloaked entrance — the ` +
      `pre-JS cloak selector only hides descendants of the element it is authored on, so a scope:page ` +
      `match outside <${describe(host)}>'s own subtree will flash unstyled before this library runs; use ` +
      `scope:self, or drop the cloaked preset from this group`,
    host,
  )
}
