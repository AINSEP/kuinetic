import type { ActivationBinder } from '../activation.js'
import type { Capabilities } from '../capabilities.js'
import type { CompiledDocument, CompiledPlan, CompiledTarget } from '../compile.js'
import type { LifecycleEventType, LifecycleReason } from '../control.js'
import type { ElementConfig } from '../element-config.js'
import type { Registry } from '../registry.js'
import type { Reporter } from '../reporter.js'
import type { Activation, InstanceState, ParsedValue, Timeline } from '../types.js'
export type { StaggerGroupKeys } from '../stagger-config.js'

/** Everything `Animator.install` needs. Moved here verbatim from `animator.ts`'s own
 *  `InstallRequest`, plus three optional fields that are absent for every HEAD code path. */
export interface InstallRequest {
  el: Element
  fingerprint: string
  parsed: ParsedValue
  /** The element's config with its activation already resolved against its own group. */
  config: ElementConfig
  document: CompiledDocument
  /** `resolveConfig`'s output BEFORE `resolveActivation` mutated `activation` — what each derived
   *  group's config is built from (`resolveGroupConfig(baseConfig, target.hoists)`). Set by
   *  `process()`; absent on a derived install. */
  baseConfig?: ElementConfig
  /** Set only on a derived install: the authored element whose `target:` group installed `el`.
   *  `install` copies it to `InstanceState.host`. */
  host?: Element
  /** Set only on a derived install of a *grouped* target (`cascade:`/`spread:`/`order:`): the
   *  element that owns the activation binding for it (always the host). `install` copies it to
   *  `InstanceState.gateOwner`; `openGate` then skips binding `el` itself. */
  gateOwner?: Element
}

/** One `CompiledTarget` and the live elements its selector resolved to. Moved from `animator.ts`'s
 *  own `ResolvedGroup`. */
export interface ResolvedGroup {
  target: CompiledTarget
  matches: Element[]
}

/** Everything needed to install (more) derived matches for one host later — recorded by 2a at
 *  install, read by 2b (`compileUnion`), 3b (`bindGroups`), 6 (`adoptLateMatches`). */
export interface DerivedInstallContext {
  host: Element
  /** The host's own fingerprint; a derived match's is `${fingerprint}\u0000${scope} ${selector}`. */
  fingerprint: string
  /** The host's parsed value (after `scopeHoists`): element-wide `rm`, stagger keys. */
  parsed: ParsedValue
  /** The host's un-resolved config (see `InstallRequest.baseConfig`). */
  baseConfig: ElementConfig
  /** `baseConfig.timeline` — what `compileUnion` recompiles against. */
  timeline: Timeline
}

/** One `target:` group as installed on one host. */
export interface LiveTargetGroup {
  /** As the host compiled it (non-empty `selector`, its `scope`, `hoists`, `specs`, `plan`). */
  target: CompiledTarget
  /** `resolveGroupConfig(baseConfig, target.hoists)` with `activation` resolved for this group. */
  config: ElementConfig
  /** The host when this group is grouped (Phase 3b), else undefined. */
  gateOwner?: Element
  /** Derived matches currently installed from this group, in document order. Mutated by 2a on
   *  release and by 6 on adoption. */
  members: Element[]
}

/** The animator's derived-host bookkeeping. One instance per Animator; all WeakMaps so a removed
 *  element takes its entries with it. Written ONLY through the 2a/2b/3b/6 module functions. */
export interface DerivedBook {
  /** host → its derived matches (insertion order = document order at install). */
  readonly derived: WeakMap<Element, Set<Element>>
  /** derived match → its host. Presence means "claimed" (collision rule D-D). */
  readonly hosts: WeakMap<Element, Element>
  /** host → its live target groups. */
  readonly groups: WeakMap<Element, LiveTargetGroup[]>
  /** host → what `installWithTargets` installed it with. */
  readonly contexts: WeakMap<Element, DerivedInstallContext>
  /** host → union-compile cache keyed by sorted `${scope} ${selector}` list joined with `\u0001`. */
  readonly unions: WeakMap<Element, Map<string, CompiledTarget>>
  /** host → cleanups to run when the host is released (group bindings, target-group-host claim). */
  readonly cleanups: WeakMap<Element, Array<() => void>>
}

/**
 * The narrow window a derived-host module gets onto one Animator. Built once in the Animator
 * constructor; every member delegates to the existing private method of the same name. Modules take
 * this, never `Animator`, so each is unit-testable with a hand-built fake.
 */
export interface AnimatorPort {
  readonly registry: Registry
  readonly reporter: Reporter
  readonly binder: ActivationBinder
  readonly capabilities: Capabilities
  readonly respectReducedMotion: boolean
  readonly book: DerivedBook
  stateOf(el: Element): InstanceState | undefined
  /** `Animator.install` — installs `request.el` from a document. Re-enters `installWithTargets` only
   *  when the document has a non-empty selector; a derived install's document never does. */
  install(request: InstallRequest): void
  /** `Animator.installAggregate` — a zero-instance host state (no own group). */
  installAggregate(request: InstallRequest): void
  /** `Animator.resolveGroupMatches` — validate + query + warn "matched nothing"/too broad. */
  resolveGroupMatches(host: Element, target: CompiledTarget): Element[]
  /** `Animator.resolveActivation`. */
  resolveActivation(el: Element, config: ElementConfig, plan: CompiledPlan): Activation
  release(el: Element): void
  /** Start ONE element (no fan-out). */
  activateOne(el: Element): void
  /** The per-element exit half (`Animator.deactivate`). */
  deactivateOne(el: Element): void
  /** `state.status = next` + `data-kui-state` through the state's own ledger. No aggregate sync. */
  writeStatus(el: Element, state: InstanceState, next: InstanceState['status']): void
  emit(el: Element, state: InstanceState, type: LifecycleEventType, reason: LifecycleReason): void
}
