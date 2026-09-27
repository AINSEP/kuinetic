import { ATTR } from '../attrs.js'
import type { CompiledTarget } from '../compile.js'
import { resolveGroupConfig } from '../element-config.js'
import type { ElementConfig } from '../element-config.js'
import type { StyleLedger } from '../owned-styles.js'
import { claimTargetGroupHost, elementStaggerKeys, staggerKeysFor } from '../stagger-keys.js'
import { indexTargetGroup } from '../stagger.js'
import { compileUnion, syncAggregate } from './aggregate.js'
import { markUnmatched, warnNested3d, warnPageScopeCloak } from './diagnostics.js'
import { bindGroups, groupGateOwner } from './group-gate.js'
import type {
  AnimatorPort,
  DerivedBook,
  DerivedInstallContext,
  InstallRequest,
  LiveTargetGroup,
  ResolvedGroup,
} from './types.js'

/**
 * Owned by phase 2a — the derived-host install path, entered from `Animator.install` whenever a
 * host's compiled document carries at least one non-empty-selector `target:` group. Everything a
 * `target:` host needs beyond an ordinary install: resolving each group's matches, applying the
 * collision rules (D-D), installing every claimed match as its own derived state, and stamping the
 * host itself last (either its own group, via `port.install`, or — with no own group — as a
 * zero-instance aggregate, via `port.installAggregate`).
 *
 * A derived match installs through `port.install` exactly as an ordinary top-level element would —
 * its own `InstanceState`, its own `data-kui-state`, its own ledgers — with a synthetic
 * single-group, empty-selector `CompiledDocument` so `Animator.install`'s own derived-host guard
 * never recurses back into this module. The host's own bookkeeping (`DerivedBook`) is what tells
 * the two apart afterwards: `book.hosts` maps a match back to the host that installed it, and
 * `book.groups` keeps each original `target:` group's live membership for restaging and release.
 */

/**
 * A derived match's host, recorded at the moment its own `releaseDerived` (match branch) unlinks it
 * from `book.hosts` — which happens *before* `restageAfterTreeRelease` runs, once per removed
 * candidate, at the end of `Animator.releaseTree`'s whole batch. Without this, the batch-level pass
 * would have nothing left to look up: `book.hosts` no longer knows. Keyed by `DerivedBook` first so
 * two independent `Animator`s (two books) never see each other's matches; both maps are weak, so a
 * removed match takes its own entry with it once nothing else references it.
 */
const FORMER_HOST = new WeakMap<DerivedBook, WeakMap<Element, Element>>()

/** Record `match`'s host before {@link releaseMatch} unlinks it — see {@link FORMER_HOST}. */
function rememberFormerHost(book: DerivedBook, match: Element, host: Element): void {
  let table = FORMER_HOST.get(book)
  if (!table) {
    table = new WeakMap()
    FORMER_HOST.set(book, table)
  }
  table.set(match, host)
}

/** The host {@link rememberFormerHost} recorded for a just-released match, if any. */
function formerHostOf(book: DerivedBook, match: Element): Element | undefined {
  return FORMER_HOST.get(book)?.get(match)
}

/** One group's identity for a derived fingerprint or a union cache key — see `DerivedInstallContext`
 *  and `LiveTargetGroup`'s own doc comments for the exact format this mirrors. */
function targetKey(target: CompiledTarget): string {
  return `${target.scope} ${target.selector}`
}

/** A claimed match's key: one group's own key, or — claimed by several — every claiming group's
 *  key, order-independent, so the same combination claimed in either authored order agrees. */
function matchKey(targets: CompiledTarget[]): string {
  return targets.length === 1 ? targetKey(targets[0]!) : targets.map(targetKey).sort((a, b) => a.localeCompare(b)).join('\u0001')
}

/**
 * A group's own `ElementConfig` — `resolveGroupConfig` plus its activation resolved once, against
 * the *host* element (`el = host`; see the plan's own verified-facts note on `resolveActivation`).
 *
 * Memoized in `cache`, keyed by the `CompiledTarget` object identity: a group claimed by twenty
 * matches (twenty `li`s under `target:li`) must warn about a misauthored activation once, not
 * twenty times, and a union shared by several of those matches must warn once per union, not once
 * per match either. `cache` is threaded through from `installWithTargets` for exactly this reason —
 * one cache, covering every group and every union this one host install touches.
 *
 * @complexity O(1) time and space on a cache hit; O(1) beyond `resolveActivation`'s own cost on a
 *   miss.
 * @overallScore 100
 */
function groupConfigFor(
  port: AnimatorPort,
  context: DerivedInstallContext,
  target: CompiledTarget,
  cache: Map<CompiledTarget, ElementConfig>,
): ElementConfig {
  const cached = cache.get(target)
  if (cached) return cached
  const config: ElementConfig = { ...resolveGroupConfig(context.baseConfig, target.hoists) }
  config.activation = port.resolveActivation(context.host, config, target.plan)
  cache.set(target, config)
  return config
}

/** {@link resolveGroups}'s three answers, kept together because every caller needs all three. */
interface GroupResolution {
  live: LiveTargetGroup[]
  resolved: ResolvedGroup[]
  /** Selectors that matched nothing, in authored order — `resolveGroupMatches` has already warned
   *  each by name; this is only what `markUnmatched` still needs to stamp the host. */
  unmatched: string[]
}

/**
 * Resolve every non-empty-selector group's matches against the live document, and build the
 * `LiveTargetGroup` shell each one will be tracked under — empty `members`, filled in as matches
 * are actually claimed and installed.
 *
 * The host's own (empty-selector) group is skipped here entirely: it is never a `ResolvedGroup` or
 * a `LiveTargetGroup`, only ever `request.document.targets`' own `''` entry, installed separately by
 * {@link installHostGroup}.
 *
 * @complexity O(g) time in the document's group count, plus each group's own `resolveGroupMatches`
 *   query; O(g + m) space in groups and total matches.
 * @overallScore 100
 */
function resolveGroups(
  port: AnimatorPort,
  context: DerivedInstallContext,
  targets: CompiledTarget[],
  cache: Map<CompiledTarget, ElementConfig>,
): GroupResolution {
  const live: LiveTargetGroup[] = []
  const resolved: ResolvedGroup[] = []
  const unmatched: string[] = []
  for (const target of targets) {
    if (target.selector === '') continue
    const matches = port.resolveGroupMatches(context.host, target)
    if (matches.length === 0) unmatched.push(target.selector)
    resolved.push({ target, matches })
    live.push({
      target,
      config: groupConfigFor(port, context, target, cache),
      gateOwner: groupGateOwner(port, context, target),
      members: [],
    })
  }
  return { live, resolved, unmatched }
}

/** `InstallRequest` → `DerivedInstallContext` — the host's own install identity, kept for every
 *  later call this host's `target:` groups need (union compiles, late adoption, restaging). */
function buildContext(request: InstallRequest): DerivedInstallContext {
  // Always present here: `installWithTargets` is only ever reached from `Animator.install`'s own
  // non-empty-selector guard, and that guard only ever sees a HEAD (non-derived) request — a
  // derived install's own document never carries a non-empty selector, so it can never recurse back
  // through this path. See `InstallRequest.baseConfig`'s own doc comment.
  const baseConfig = request.baseConfig!
  return {
    host: request.el,
    fingerprint: request.fingerprint,
    parsed: request.parsed,
    baseConfig,
    timeline: baseConfig.timeline,
  }
}

/**
 * Install the host's own effects — its untargeted segment, when it has one, exactly as an ordinary
 * (non-derived) install would; a zero-instance aggregate otherwise, whose status mirrors its derived
 * matches' instead (D-A). Called after every claimed match is already installed (D-E): the host's
 * own `data-kui-state` must never appear before the matches it is coordinating.
 *
 * @complexity O(1) time and space beyond the delegated install.
 * @overallScore 100
 */
function installHostGroup(port: AnimatorPort, request: InstallRequest, own: CompiledTarget | undefined): void {
  if (own) {
    // Warnings for `own` were already reported by `reportCompiled` before `install()` was ever
    // called — `install()` itself never reads `document.warnings`, so an empty list here changes
    // nothing observable and avoids constructing an object nobody uses `warnings` from.
    port.install({ ...request, document: { targets: [own], warnings: [] } })
  } else {
    port.installAggregate(request)
  }
}

/** Append one cleanup to a host's list, creating it on first use. */
function registerCleanup(port: AnimatorPort, host: Element, cleanup: () => void): void {
  const cleanups = port.book.cleanups.get(host) ?? []
  cleanups.push(cleanup)
  port.book.cleanups.set(host, cleanups)
}

/** The single `CompiledTarget` a match actually installed under — its one claiming group, or the
 *  union of several. Cheap to call repeatedly: a union hit is `compileUnion`'s own cache. */
function installedTargetFor(port: AnimatorPort, context: DerivedInstallContext, targets: CompiledTarget[]): CompiledTarget {
  return targets.length === 1 ? targets[0]! : compileUnion(port, context, targets)
}

/** Everything {@link finalizeInstall} needs beyond `port`/`context` — bundled so that function stays
 *  within the project's parameter budget. */
interface FinalizeInput {
  claims: Map<Element, CompiledTarget[]>
  resolved: ResolvedGroup[]
  unmatched: string[]
  suspects: string[] | undefined
}

/**
 * Everything that happens once, after both the derived matches and the host's own group have been
 * installed — see "2a record order" in the plan for why each of these has to wait until here:
 * `markUnmatched` and `warnNested3d` both need the host's own live state (its attribute ledger, and
 * its own `fxNames` for the nesting check) to exist first, and `syncAggregate` has to run last so it
 * catches any status an `on:load` match wrote while the host had no state to sync yet.
 *
 * @complexity O(g + m) time in the group and claimed-match counts; O(1) space.
 * @overallScore 100
 */
function finalizeInstall(port: AnimatorPort, context: DerivedInstallContext, input: FinalizeInput): void {
  const host = context.host
  // Always present: `installHostGroup` has just run, and both of its branches (`install`,
  // `installAggregate`) set the host's state synchronously before returning.
  const hostState = port.stateOf(host)!
  markUnmatched(host, [...input.unmatched, ...(input.suspects ?? [])], hostState.attributes)
  registerCleanup(port, host, claimTargetGroupHost(host))
  restageTargets(port, host)
  bindGroups(port, host)
  for (const [match, targets] of input.claims) {
    warnNested3d(port, host, match, installedTargetFor(port, context, targets))
  }
  for (const group of input.resolved) warnPageScopeCloak(port, host, group.target)
  syncAggregate(port, host)
}

/**
 * Install `request.el` the derived-host way: resolve every `target:` group's matches, apply the
 * collision rules (D-D) to decide what this host may actually claim, install every claimed match as
 * its own derived state, then the host's own group (or a zero-instance aggregate).
 *
 * A host with no own (untargeted) segment and nothing claimed has real compiled effects — `process`
 * already ruled out zero effects entirely — but nowhere for any of them to run, so this is the
 * `'failed'` outcome below.
 *
 * @param port - The animator's narrow window (see `AnimatorPort`).
 * @param request - The would-be host's install request.
 * Returns nothing: every non-empty-selector document is fully handled here, whether that means a
 * real install or the `'failed'` outcome above, so `Animator.install` never falls through to its own
 * body for a request it routed here.
 * @complexity O(g * m) time in group count and matches per group (the resolve + claim passes); O(g +
 *   m) space.
 * @overallScore 100
 */
export function installWithTargets(port: AnimatorPort, request: InstallRequest): void {
  const context = buildContext(request)
  const cache = new Map<CompiledTarget, ElementConfig>()
  const { live, resolved, unmatched } = resolveGroups(port, context, request.document.targets, cache)
  port.book.contexts.set(context.host, context)
  port.book.groups.set(context.host, live)

  const claims = claimMatches(port, context.host, resolved)
  const own = request.document.targets.find((target) => target.selector === '')
  if (!own && claims.size === 0) {
    context.host.setAttribute(ATTR.state, 'failed')
    markUnmatched(context.host, [...unmatched, ...(request.document.suspectSelectors ?? [])])
    return
  }

  installDerivedMatches(port, context, claims, cache)
  installHostGroup(port, request, own)
  finalizeInstall(port, context, { claims, resolved, unmatched, suspects: request.document.suspectSelectors })
}

/** Unlink a derived match from its host's bookkeeping, recording the host it came from first (see
 *  {@link FORMER_HOST}) so a later, batch-wide `restageAfterTreeRelease` can still find it. */
function releaseMatch(port: AnimatorPort, host: Element, match: Element): void {
  const { book } = port
  rememberFormerHost(book, match, host)
  book.hosts.delete(match)
  book.derived.get(host)?.delete(match)
  for (const group of book.groups.get(host) ?? []) {
    const index = group.members.indexOf(match)
    if (index !== -1) group.members.splice(index, 1)
  }
}

/** Release a host's own derived-host bookkeeping: every derived match first (each a full,
 *  independent `Animator.release`), then this host's own cleanups, then its book entries. */
function releaseHost(port: AnimatorPort, host: Element): void {
  const { book } = port
  // Snapshotted before iterating: releasing a match re-enters `releaseDerived` on it, which mutates
  // this very Set (`releaseMatch` above) — iterating the live Set while it shrinks under us would
  // skip whichever match happened to be next.
  for (const match of [...(book.derived.get(host) ?? [])]) port.release(match)
  for (const cleanup of book.cleanups.get(host) ?? []) cleanup()
  book.derived.delete(host)
  book.groups.delete(host)
  book.contexts.delete(host)
  book.unions.delete(host)
  book.cleanups.delete(host)
}

/**
 * Release a derived-host's bookkeeping, called at the very start of `Animator.release(el)`, before
 * `el`'s own teardown runs. A host and a match are mutually exclusive — a match is never itself
 * claimable as a `target:` host, because `claimMatches` refuses any candidate that already carries
 * its own `data-kui` — so at most one of the two branches below ever does anything.
 *
 * @param port - The animator's narrow window.
 * @param el - The element being released — a host, a derived match, or neither.
 * @complexity O(1) time and space for a match; O(c) for a host, in its claimed-match and cleanup
 *   counts.
 * @overallScore 100
 */
export function releaseDerived(port: AnimatorPort, el: Element): void {
  const host = port.book.hosts.get(el)
  if (host) {
    releaseMatch(port, host, el)
    return
  }
  if (port.book.derived.has(el)) releaseHost(port, el)
}

/**
 * Called once at the end of `Animator.releaseTree`, after every removed candidate in the batch has
 * had its own teardown run (and so its own `releaseDerived` match-branch, recording its former host
 * via {@link rememberFormerHost}). Re-indexes every surviving host that lost one or more derived
 * matches in this removal — the derived-host analogue of `restageAfterRemoval` for ordinary stagger
 * groups — and lets it re-derive its aggregate status now that its membership has changed.
 *
 * @param port - The animator's narrow window.
 * @param removed - Every element `releaseTree` visited while tearing down one removal batch.
 * @complexity O(r) time in the removed-candidate count, plus each surviving host's own restage;
 *   O(h) space in the distinct former-host count.
 * @overallScore 100
 */
export function restageAfterTreeRelease(port: AnimatorPort, removed: Element[]): void {
  const formerHosts = new Set<Element>()
  for (const el of removed) {
    const host = formerHostOf(port.book, el)
    if (host) formerHosts.add(host)
  }
  for (const host of formerHosts) {
    // A host removed in the same batch has no state left to restage — its own release already
    // dropped its book entries (`releaseHost`) and its `InstanceState` (`Animator.release`).
    if (!port.stateOf(host)) continue
    restageTargets(port, host)
    syncAggregate(port, host)
  }
}

/** Why one candidate match was not claimed — named so {@link reportSkips} can aggregate a count per
 *  reason instead of warning once per rejected element. */
type SkipReason = 'host' | 'authored' | 'claimed'

const SKIP_LABEL: Record<SkipReason, string> = {
  host: 'is the target: host itself',
  authored: 'already carries its own data-kui and animates itself',
  claimed: 'is already claimed by another target: host',
}

/** The collision rules (D-D), for one candidate against one host — `undefined` means the match may
 *  be claimed. A match this same host already claimed under an earlier group is never rejected here
 *  at all; see {@link claimMatch}, the ordinary "one element, several groups" case. */
function rejectionReason(port: AnimatorPort, host: Element, match: Element): SkipReason | undefined {
  if (match === host) return 'host'
  if (match.hasAttribute(ATTR.source)) return 'authored'
  const claimedBy = port.book.hosts.get(match)
  if (claimedBy !== undefined && claimedBy !== host) return 'claimed'
  return undefined
}

/** Record a claim, joining an existing one (several groups, one match — `compileUnion`'s case)
 *  rather than overwriting it. */
function claimMatch(claims: Map<Element, CompiledTarget[]>, target: CompiledTarget, match: Element): void {
  const existing = claims.get(match)
  if (existing) existing.push(target)
  else claims.set(match, [target])
}

/** One aggregated warning per (group, reason), naming the group's selector and effects and how many
 *  matches it cost — never one warning per rejected element, which is unreadable for `target:li`
 *  against a real page. */
function reportSkips(port: AnimatorPort, host: Element, target: CompiledTarget, skipped: Map<SkipReason, number>): void {
  const names = target.plan.fxNames.join(', ')
  for (const [reason, count] of skipped) {
    const plural = count === 1 ? 'match' : 'matches'
    port.reporter.warn(
      `target "${target.selector}" (${names}) skipped ${count} ${plural} that ${SKIP_LABEL[reason]}`,
      host,
    )
  }
}

/**
 * Apply the collision rules (D-D) over one host's resolved `target:` groups, deciding which matched
 * elements this host is actually allowed to claim.
 *
 * A match is skipped, with an aggregated warning naming the selector and the group's effects, when
 * it is the host itself, when it already carries its own `data-kui` (an authored element animates
 * itself, never a host's group), or when another host has already claimed it (first wins — whichever
 * host's `scan()` reached it first). A match this same host has already claimed under an earlier
 * group in the same resolution is joined into that claim silently — that is the ordinary "one
 * element, several groups" case `compileUnion` exists for, not a collision.
 *
 * @param port - The animator's narrow window.
 * @param host - The element whose `target:` groups are being resolved.
 * @param groups - Every non-empty-selector group's `CompiledTarget` and its resolved matches.
 * @returns Each claimed match mapped to every group of *this* host that claims it, in authored
 *   group order; the map's own iteration order is document order.
 * @complexity O(g * m) time in groups and matches per group; O(m) space.
 * @overallScore 100
 */
export function claimMatches(port: AnimatorPort, host: Element, groups: ResolvedGroup[]): Map<Element, CompiledTarget[]> {
  const claims = new Map<Element, CompiledTarget[]>()
  for (const group of groups) {
    const skipped = new Map<SkipReason, number>()
    for (const match of group.matches) {
      const reason = rejectionReason(port, host, match)
      if (reason) skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
      else claimMatch(claims, group.target, match)
    }
    reportSkips(port, host, group.target, skipped)
  }
  return claims
}

/** One match's install target, config, and the full group list claiming it — everything
 *  {@link installClaim}/{@link recordClaim} need, bundled to stay within the parameter budget. */
interface ClaimedMatch {
  match: Element
  targets: CompiledTarget[]
  target: CompiledTarget
  config: ElementConfig
}

/** Resolve one claim's install target (its one group, or the union of several) and that target's
 *  group config — both memoized in `cache`, see {@link groupConfigFor}. */
function resolveClaim(
  port: AnimatorPort,
  context: DerivedInstallContext,
  entry: { match: Element; targets: CompiledTarget[] },
  cache: Map<CompiledTarget, ElementConfig>,
): ClaimedMatch {
  const { match, targets } = entry
  const target = installedTargetFor(port, context, targets)
  return { match, targets, target, config: groupConfigFor(port, context, target, cache) }
}

/** The host, when any of a match's claiming groups is grouped (B-a) — `openGate` then skips binding
 *  the match's own gate, because the host's one group binding activates it instead. */
function matchGateOwner(port: AnimatorPort, context: DerivedInstallContext, targets: CompiledTarget[]): Element | undefined {
  const grouped = targets.some((target) => groupGateOwner(port, context, target) !== undefined)
  return grouped ? context.host : undefined
}

/** Record one installed match in the host's book: claimed (`hosts`), a member of the host
 *  (`derived`), and a member of every original group that claims it (`groups[*].members`) — a union
 *  match joins more than one group's `members` at once, per `LiveTargetGroup`'s own doc comment. */
function recordClaim(port: AnimatorPort, context: DerivedInstallContext, claim: ClaimedMatch): void {
  const { book } = port
  book.hosts.set(claim.match, context.host)
  const derived = book.derived.get(context.host) ?? new Set<Element>()
  derived.add(claim.match)
  book.derived.set(context.host, derived)
  const live = book.groups.get(context.host) ?? []
  for (const target of claim.targets) {
    live.find((group) => group.target === target)?.members.push(claim.match)
  }
}

/** Install one claimed match exactly as an ordinary top-level element would install — its own
 *  `InstanceState`, ledgers, and `data-kui-state` — via a synthetic, empty-selector single-group
 *  document (see this module's own top comment for why that reuse is safe). */
function installClaim(port: AnimatorPort, context: DerivedInstallContext, claim: ClaimedMatch): void {
  port.install({
    el: claim.match,
    fingerprint: `${context.fingerprint}\u0000${matchKey(claim.targets)}`,
    parsed: { specs: claim.target.specs, warnings: [] },
    config: claim.config,
    document: { targets: [{ ...claim.target, selector: '', scope: 'self' }], warnings: [] },
    host: context.host,
    gateOwner: matchGateOwner(port, context, claim.targets),
  })
  recordClaim(port, context, claim)
}

/**
 * Install every claimed match as its own derived host — a single group installs directly, two or
 * more recompile through `compileUnion` first — and record the result in `port.book` (the host's
 * `derived` set, each match's `hosts` entry, and the owning group's `members`).
 *
 * Used both by `installWithTargets` (the initial install) and by phase 6's `adoptLateMatches` (a
 * late-inserted match joining an already-live group).
 *
 * @param port - The animator's narrow window.
 * @param context - The host's derived-install context (fingerprint, parsed value, base config).
 * @param claims - `claimMatches`'s output: each match to install, and which of the host's groups
 *   claim it.
 * @param cache - Group-config memoization, shared with `installWithTargets`'s own group resolution
 *   pass when one is available; a caller with no group-level pass of its own (a late adoption
 *   joining an already-live group) may omit it and get a fresh one, since there is nothing else in
 *   that case to share it with.
 * @returns The matches actually installed, in claim order.
 * @complexity O(m) time in the claimed-match count, plus each union's own compile on a cache miss;
 *   O(m) space.
 * @overallScore 100
 */
export function installDerivedMatches(
  port: AnimatorPort,
  context: DerivedInstallContext,
  claims: Map<Element, CompiledTarget[]>,
  cache: Map<CompiledTarget, ElementConfig> = new Map(),
): Element[] {
  const installed: Element[] = []
  for (const [match, targets] of claims) {
    const claim = resolveClaim(port, context, { match, targets }, cache)
    installClaim(port, context, claim)
    installed.push(claim.match)
  }
  return installed
}

/**
 * Re-run `indexTargetGroup` for every one of a host's live `target:` groups, over its *current*
 * members — each match's own `--kui-i` through its own ledger, the host's `--kui-stagger`/`-count`
 * through the host's. Called whenever a group's membership changes after its initial install: a late
 * adoption (phase 6) or a removal (`restageAfterTreeRelease`), as well as once at the end of the
 * initial install itself.
 *
 * A group with no members is skipped outright — nothing to number, and nothing for `indexTargetGroup`
 * to derive a step from. Two live groups on one host both write the host's `--kui-stagger`/`-count`;
 * the second's write wins, matching HEAD's own single-group behaviour (there was never more than one
 * write to race against before `target:` existed).
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host to re-index.
 * @complexity O(g * m) time in the host's live groups and their member counts; O(1) space beyond
 *   `indexTargetGroup`'s own.
 * @overallScore 100
 */
export function restageTargets(port: AnimatorPort, host: Element): void {
  const context = port.book.contexts.get(host)
  const live = port.book.groups.get(host)
  const hostState = port.stateOf(host)
  if (!context || !live || !hostState) return
  const elementWide = elementStaggerKeys(context.parsed)
  const styleOf = (el: Element): StyleLedger =>
    el === host ? hostState.ledgers.style(host) : port.stateOf(el)!.ledgers.style(el)
  for (const group of live) {
    if (group.members.length === 0) continue
    indexTargetGroup({
      host,
      matches: group.members,
      styleOf,
      keys: staggerKeysFor(group.target.hoists, elementWide),
      reporter: port.reporter,
    })
  }
}
