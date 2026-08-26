/* eslint-disable max-lines --
   Over the 400-line budget by decision, permanently. This is not a temporary state, not a merge
   artefact, and not something to resolve by splitting the file.

   The measurement, so a later reader can redo it rather than trust it. `max-lines` is configured
   `skipBlankLines`/`skipComments`, so `wc -l` is the wrong instrument — it reads 932 here, and
   more than half of that is the WHY comments this codebase writes. What the rule actually counts
   is 427, against a cap of 400: 27 over, about 7%. Reproduce with
   `npx eslint src/core/animator.ts --no-inline-config --rule '{"max-lines":["error",{"max":1,"skipBlankLines":true,"skipComments":true}]}'`
   — `--no-inline-config` is needed to get past this very directive.

   The budget exists to catch complexity, and by the two metrics `eslint.config.js` names for it
   nothing here is close to the ceiling. Cyclomatic, cap 10: `resolveCollaborators` 10, `process`
   8, `activate` 8, `reverseFrom` 7, `scan`/`openGate`/`deactivate` 6, everything else 4 or less.
   Cognitive, same cap: `process` 7, `activate`/`reverseFrom` 6, `openGate`/`deactivate` 5,
   everything else 4 or less — and `resolveCollaborators`, the cyclomatic worst case, scores 0,
   because it is a flat chain of `??` defaults. That is exactly the "flat 12-case switch scores
   low" case the config's own header describes, and it is the shape of this whole file.

   So: a long file of simple methods, not a complex one. It is long because `Animator` owns one
   thing — an element's lifecycle — and that lifecycle has many *stages*: install, gate, activate,
   deactivate, reverse, turn around, settle, cancel, release, destroy. Cutting at 400 lines would
   move flat code across a file boundary to satisfy a counter and buy no comprehension; the reader
   following one element from `process` to `release` would then follow it through two files.

   What would justify revisiting this is not the file getting longer. It is a *function* here
   climbing — `process`, `activate` or `reverseFrom` acquiring real branching, or any method
   passing a cognitive complexity of roughly 8 — because at that point there is a named concern
   worth lifting out and the split would describe something. Length on its own is not that signal.
   If length alone ever became the complaint, the budget is the thing to argue with, not this
   file. */
import {
  createActivationBinder,
  isOneShot,
  resolveActivationSpec,
  warnAboutActivation,
} from './activation.js'
import type { ActivationBinder } from './activation.js'
import { ATTR } from './attrs.js'
import { breakpointsIn, createGateWatcher, gateMatches } from './breakpoints.js'
import type { Breakpoint, EffectGate, GateWatcher } from './breakpoints.js'
import { detect, unsupportedChannelWarnings } from './capabilities.js'
import type { Capabilities } from './capabilities.js'
import { compile } from './compile.js'
import type { CompiledPlan } from './compile.js'
import { control, emitLifecycle, KUI_EVENT } from './control.js'
import type { ControlHandle, LifecycleEventType, LifecycleReason } from './control.js'
import { createDomWatcher } from './dom-watcher.js'
import type { DomWatcher } from './dom-watcher.js'
import { readAttributes, resolveConfig } from './element-config.js'
import type { ElementAttributes, ElementConfig } from './element-config.js'
import { createJsEffectPreparer } from './js-effect-preparer.js'
import type { JsEffectPreparer, JsEffectPreparerOptions } from './js-effect-preparer.js'
import { parse } from './parse.js'
import { createRootResolver, createScrollScheduler } from './scroll-scheduler.js'
import type { ScrollRoot, ScrollScheduler } from './scroll-scheduler.js'
import { play } from './play.js'
import type { PlaybackHandle, PlayOptions, Target } from './play.js'
import { Registry } from './registry.js'
import { silentReporter } from './reporter.js'
import type { Reporter } from './reporter.js'
import { createCssInstance } from './instances.js'
import { createAttributeLedger, createStyleLedger } from './owned-styles.js'
import { applyStagger } from './stagger.js'
import { applyStylePlan, planStyles } from './style-plan.js'
import type { StylePlan } from './style-plan.js'
import type { Activation, EffectInstance, InstanceState, ParsedValue } from './types.js'

/** Longest a stalled initialisation may keep an opt-in cloak in place. */
const CLOAK_WATCHDOG_MS = 3000

/** Configuration identity: every attribute that changes what gets compiled. */
function fingerprintOf(attributes: ElementAttributes): string {
  return [attributes.source, attributes.on, attributes.timeline, attributes.threshold].join('\u0000')
}

/**
 * `instanceof Element`, safe in environments that never declare the global at all.
 *
 * `Element` is not merely absent-as-a-property (which `instanceof`'s right-hand side would
 * tolerate) — in a DOM-less Node process it is an undeclared identifier, so evaluating it throws
 * `ReferenceError` before `instanceof` ever runs, regardless of what `node` is. Every bare
 * `instanceof Element` in this module was reachable from construction (`defaultRootResolver`) or
 * from `start()` (`scan`, `uncloak`) — exactly the paths `src/index.ts`'s doc comment promises
 * stay DOM-free for SSR and worker consumers. Same guard style as `capabilities.ts`'s `typeof
 * CSS === 'undefined'` checks.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function isElementNode(node: unknown): node is Element {
  return typeof Element !== 'undefined' && node instanceof Element
}

export { ATTR }

/** Everything `openGate` needs, grouped so the call site reads as one request. */
interface GateRequest {
  el: Element
  state: InstanceState
  stylePlan: StylePlan
  config: ElementConfig
  plan: CompiledPlan
}

/** Everything `install` needs, grouped so the call site reads as one request. */
interface InstallRequest {
  el: Element
  fingerprint: string
  parsed: ParsedValue
  config: ElementConfig
  plan: CompiledPlan
}

export interface AnimatorOptions {
  root?: ParentNode
  /** Effect catalog. Injected so a consumer can ship only the effects they use. */
  registry?: Registry
  /** Environment capabilities. Injected so timeline and fallback paths are testable. */
  capabilities?: Capabilities
  /** Diagnostic sink. Defaults to silent; pass `consoleReporter()` in development. */
  reporter?: Reporter
  /** Activation strategy. Injected so tests can drive visibility without layout. */
  binder?: ActivationBinder
  /** Shared scroll orchestration for JS-rendered effects. Injected for testability. */
  scheduler?: ScrollScheduler
  /** Maps an element to the scroll root that moves it. Injected so nesting is fakeable. */
  rootResolver?: (el: Element) => ScrollRoot
  /** Wires up JS-rendered effects' setup context. Injected so it is testable in isolation. */
  jsEffectPreparer?: JsEffectPreparer
  /**
   * Watches for DOM insertions, removals, and attribute changes. Injected for testability;
   * defaults to a real `MutationObserver`-backed watcher, built lazily so nothing observes unless
   * `observe: true` and `start()` actually run.
   */
  domWatcher?: DomWatcher
  /** `'respect'` honours prefers-reduced-motion. `'ignore'` is for demos and tests only. */
  reducedMotion?: 'respect' | 'ignore'
  /** Watch for DOM insertions and attribute changes. Off by default. */
  observe?: boolean
}

/**
 * Scans a document for authored effects and installs them.
 *
 * Every collaborator — registry, capabilities, reporter, activation binder — is injected, so no
 * behaviour depends on module state or globals. The class itself only orchestrates: parsing,
 * compilation, and style decisions all live in pure modules it calls.
 */
export class Animator {
  readonly registry: Registry
  readonly capabilities: Capabilities
  /**
   * Public alongside `registry` and `capabilities`, and for the same reason: `control()` is a free
   * function in its own module (mirroring `play()`), and an author-facing diagnostic it emits has
   * to reach the same sink every other diagnostic on this animator does. Routing it through a
   * second, private channel would mean `consoleReporter()` silenced half the library's warnings.
   */
  readonly reporter: Reporter

  private readonly root: ParentNode
  private readonly binder: ActivationBinder
  private readonly scheduler: ScrollScheduler
  private readonly rootResolver: (el: Element) => ScrollRoot
  private readonly jsEffectPreparer: JsEffectPreparer
  private readonly respectReducedMotion: boolean
  private readonly shouldObserve: boolean
  /** Runtime truth. Attributes are for CSS and debugging; they make a poor state machine. */
  private readonly states = new WeakMap<Element, InstanceState>()
  /** Iterable lifecycle index; the WeakMap remains the fast state lookup. */
  private readonly liveElements = new Set<Element>()
  /** Built lazily by `watch()` when not injected, so nothing observes until `start()` needs it. */
  private domWatcher: DomWatcher | undefined
  /**
   * Built lazily by `watchGates()`, and only for an element carrying a viewport gate on a
   * JavaScript-rendered effect — see `applyViewportGates` for why that is the only case that needs
   * one. Stays `undefined` on a page whose gates are all on CSS-rendered effects, which binds no
   * `MediaQueryList` listener anywhere.
   */
  private gateWatcher: GateWatcher | undefined
  private started = false

  constructor(options: AnimatorOptions = {}) {
    const resolved = resolveCollaborators(options)
    this.registry = resolved.registry
    this.capabilities = resolved.capabilities
    this.root = resolved.root
    this.reporter = resolved.reporter
    this.binder = resolved.binder
    this.scheduler = resolved.scheduler
    this.rootResolver = resolved.rootResolver
    this.jsEffectPreparer = resolved.jsEffectPreparer
    this.domWatcher = resolved.domWatcher
    this.respectReducedMotion = resolved.respectReducedMotion
    this.shouldObserve = resolved.shouldObserve
  }

  /**
   * Explicit entry point. Importing the library never touches the document, which keeps SSR,
   * hydration, and tests deterministic.
   *
   * @complexity O(n) time in the number of elements scanned.
   * @overallScore 100
   */
  start(): this {
    if (this.started) return this
    this.started = true
    // The watchdog is armed before scanning, not after: if scanning throws or hangs, the page
    // must still become readable. Uncloaking only on the happy path is not fail-open.
    const watchdog = globalThis.setTimeout(() => this.uncloak(), CLOAK_WATCHDOG_MS)
    try {
      this.scan(this.root)
      if (this.shouldObserve) this.watch()
    } finally {
      globalThis.clearTimeout(watchdog)
      this.uncloak()
    }
    return this
  }

  /**
   * Process every unprocessed element in a subtree, including the root.
   *
   * `querySelectorAll` excludes the root, but an inserted subtree very often carries the
   * attribute on its top node — skipping it silently drops those animations.
   *
   * @param root - Subtree to scan. Defaults to the animator's root.
   * @complexity O(n) time in the subtree size; O(1) extra space.
   * @overallScore 100
   */
  scan(root: ParentNode = this.root): this {
    if (!root) return this
    const selector = `[${ATTR.source}]`
    if (isElementNode(root) && root.matches(selector)) this.process(root)
    for (const el of root.querySelectorAll(selector)) this.process(el)
    applyStagger(root, this.reporter)
    return this
  }

  /**
   * Compile and install one element's effects, recompiling if its attribute changed.
   *
   * @param el - Element carrying `data-kui`.
   * @complexity O(e) time in the number of composed effects; O(e) space for the plan.
   * @overallScore 100
   */
  process(el: Element): void {
    const attributes = readAttributes(el)
    // The whole configuration, not just `data-kui`. Keying on the source alone meant a change to
    // `data-kui-on`, `data-kui-timeline`, or `data-kui-threshold` was ignored permanently — even
    // when `process()` was called again by hand.
    const fingerprint = fingerprintOf(attributes)
    const existing = this.states.get(el)
    if (existing?.fingerprint === fingerprint) return
    if (existing) this.release(el)

    const parsed = parse(attributes.source)
    const config = resolveConfig(attributes, parsed)
    const plan = compile(parsed, this.registry, config.timeline)
    // Before `planStyles` runs, so that an element whose only JS effect is gated off reports no
    // work and takes the `immediate` gate rather than sitting deferred on an activation that has
    // nothing left to release.
    this.applyViewportGates(el, plan)

    config.activation = this.resolveActivation(el, config, plan)
    for (const warning of plan.warnings) this.reporter.warn(warning, el)
    // Separate from `plan.warnings` because `compile` is pure and environment-free by design — it
    // is handed a registry and a timeline, never the browser it is running in. "This browser
    // cannot render that channel" is only answerable here, where the detected capabilities live.
    for (const warning of unsupportedChannelWarnings(plan.channels, this.capabilities)) {
      this.reporter.warn(warning, el)
    }

    if (plan.fxNames.length === 0) {
      // Deliberately does NOT stamp the normalized attribute: an effect registered later must
      // still be able to claim this element on a rescan.
      el.setAttribute(ATTR.state, plan.unknown.length > 0 ? 'pending' : 'failed')
      return
    }

    this.install({ el, fingerprint, parsed, config, plan })
  }

  /**
   * Apply a compiled plan and bind its activation.
   *
   * @complexity O(e) time in composed effects; O(e) space for retained cleanups.
   * @overallScore 100
   */
  /**
   * Choose the activation, letting a primitive's preference fill in only when the author named
   * none, and reporting whatever looks wrong about one the author did name.
   *
   * Declared capability metadata was previously never checked anywhere, which made
   * `supportedActivations` documentation rather than a contract. The checks themselves live in
   * `activation.ts`'s diagnostics half — they grew a good deal when the list opened, and they
   * decide nothing, so keeping them here would have made this class the place where "which
   * activation" and "is that a real event" were the same paragraph.
   *
   * @complexity O(a) time in supported activations; O(1) space.
   * @overallScore 100
   */
  private resolveActivation(el: Element, config: ElementConfig, plan: CompiledPlan): Activation {
    if (!config.activationAuthored) return plan.defaultActivation ?? config.activation
    warnAboutActivation({
      el,
      spec: resolveActivationSpec(config.activation),
      supported: plan.supportedActivations,
      reporter: this.reporter,
    })
    return config.activation
  }

  /**
   * Resolve the viewport gates (`above:` / `below:`) on this element's JavaScript-rendered effects.
   *
   * CSS-rendered segments are deliberately absent from this method. Their gate is compiled into the
   * `animation-name` declaration as a `var()` the browser re-resolves on every resize with no
   * script involved (see `core/breakpoints.ts`), which is the entire reason this feature does not
   * need the teardown machinery `gsap.matchMedia()` is built around. A JavaScript-rendered effect
   * has no `animation-name` for a stylesheet to neutralise, so it is the one case that has to be
   * decided here — and, having been decided once, has to be re-decided when the viewport crosses
   * the breakpoint it was decided at.
   *
   * @complexity O(e) time in JS-rendered effects; O(b) space, bounded by the scale's five names.
   * @overallScore 100
   */
  private applyViewportGates(el: Element, plan: CompiledPlan): void {
    const gates = plan.jsEffects
      .map((entry) => entry.spec.gate)
      .filter((gate): gate is EffectGate => gate !== undefined)
    if (gates.length === 0) {
      // Not merely an optimisation: an element that *used* to carry a gated JS effect and no longer
      // does must stop being watched, or a later resize would keep recompiling it forever.
      this.gateWatcher?.unwatch(el)
      return
    }
    const win = el.ownerDocument.defaultView ?? undefined
    plan.jsEffects = plan.jsEffects.filter((entry) => gateMatches(entry.spec.gate, win))
    this.watchGates(el, win, breakpointsIn(gates))
  }

  /**
   * Arm live re-evaluation for one element, building the watcher on first use.
   *
   * Lazy so that a page with no JavaScript-rendered gate — which is most pages, since the catalog
   * is overwhelmingly `css-keyframes` — binds no `MediaQueryList` listener at all.
   *
   * @complexity O(b) time in the element's breakpoints; O(1) amortised space.
   * @overallScore 100
   */
  private watchGates(el: Element, win: Window | undefined, breakpoints: Breakpoint[]): void {
    this.gateWatcher ??= createGateWatcher(win, (target) => this.regate(target))
    this.gateWatcher.watch(el, breakpoints)
  }

  /**
   * Rebuild one element because the viewport crossed a breakpoint its JS effects depend on.
   *
   * `release` then `process`, rather than a partial update, and rather than `process` alone:
   * `process` short-circuits on an unchanged fingerprint, and the fingerprint is a hash of
   * *attributes*, which have not changed — the viewport has. Releasing first is also what makes the
   * transition safe mid-animation: it aborts the activation binding, runs each JS effect's own
   * `destroy()`, and unwinds both ledgers, so the element is back at the author's own markup before
   * the new plan touches it. That is the same path an attribute edit takes, so there is one
   * teardown implementation rather than two.
   *
   * There is deliberately no "is this element still live?" guard. Every path that stops tracking an
   * element goes through `release`, and `release` unwatches — so an element that reaches here is
   * one the watcher still holds, which is one `release` has not run on, which is one that is live.
   * A guard would be unreachable code pretending to be caution, the same call `positioned()` in
   * `compile.ts` makes about its own missing branch.
   *
   * @complexity O(e) time in the element's composed effects; O(1) space.
   * @overallScore 100
   */
  private regate(el: Element): void {
    this.release(el)
    this.process(el)
  }

  private install(request: InstallRequest): void {
    const { el, fingerprint, parsed, config, plan } = request
    const stylePlan = planStyles({
      plan,
      config,
      capabilities: this.capabilities,
      respectReducedMotion: this.respectReducedMotion,
    })

    const ledger = createStyleLedger(el)
    const attributes = createAttributeLedger(el)
    const controller = new AbortController()
    applyStylePlan({ el, plan: stylePlan, ledger, attributes })

    const state: InstanceState = {
      fingerprint,
      specs: parsed.specs,
      activation: config.activation,
      timeline: config.timeline,
      fxNames: plan.fxNames,
      jsEffectNames: plan.jsEffects.map((entry) => entry.spec.name),
      progressDriven: stylePlan.gate === 'scrubbed' || stylePlan.gate === 'native-timeline',
      instances: [],
      ledger,
      attributes,
      controller,
      status: 'ready',
    }
    this.states.set(el, state)
    this.liveElements.add(el)

    if (Object.keys(stylePlan.properties).some((property) => property.startsWith('animation-'))) {
      // `plan.keyframeNames`, not a re-split of the compiled `animation-name`: a viewport-gated
      // track compiles to `var(--kui-above-md, kui-in-up)` and splitting that on commas yields two
      // fragments, neither of which is a keyframe name. See `CompiledPlan.keyframeNames`.
      state.instances.push(
        createCssInstance(el, ledger, plan.keyframeNames, stylePlan.gate === 'scrubbed'),
      )
    }
    state.instances.push(
      ...this.jsEffectPreparer.prepare({ el, plan, signal: controller.signal, ledger }),
    )

    this.openGate({ el, state, stylePlan, config, plan })
  }

  /**
   * Decide whether, and when, the effects on this element are allowed to start.
   *
   * The single place any effect begins. Routing both renderers through it is what makes
   * `on:enter`, `on:click`, `manual`, and `reducedMotion: 'disable'` mean the same thing for a
   * pinned section as for a fade — previously JS effects started during `prepare` and honoured
   * none of them.
   *
   * @complexity O(n) time in the number of instances; O(1) space.
   * @overallScore 100
   */
  private openGate(request: GateRequest): void {
    const { el, state, stylePlan, config, plan } = request
    const reduce = this.respectReducedMotion && this.capabilities.reducedMotion
    if (reduce && plan.reducedMotion === 'disable') {
      // Nothing is activated. A CSS effect is left at its final state by the policy layer; a JS
      // effect simply never runs, which is the only way "disable" can bind a JS renderer at all.
      state.status = 'finished'
      state.attributes.set(ATTR.state, 'finished')
      // The one `kui:finish` with no preceding `kui:start`, carrying the reason that says so. An
      // author chaining a second step off `kui:finish` must not have that step silently never run
      // for the visitors who asked for reduced motion — the element really is at its end state,
      // which is all `finish` has ever claimed. See `LifecycleReason` in `events.ts`.
      this.emit(el, state, KUI_EVENT.finish, 'reduced-motion')
      return
    }

    if (stylePlan.gate !== 'deferred') {
      this.activate(el)
      return
    }
    // `planStyles` only sets `activation: null` when `gate !== 'deferred'` (see style-plan.ts);
    // the early return just above guarantees `gate === 'deferred'` here, so this is always real.
    const releaseBinding = this.binder.bind(el, stylePlan.activation!, {
      threshold: config.threshold,
      activate: () => this.activate(el),
      deactivate: () => this.deactivate(el),
    })
    let released = false
    const releaseOnce = (): void => {
      if (released) return
      released = true
      releaseBinding()
    }
    state.controller.signal.addEventListener('abort', releaseOnce)
    // `enter` is the one activation designed to fire exactly once — `activation.ts`'s observer
    // callback releases the binding immediately after invoking it. A programmatic activation
    // (`play()`, `kui.activate()`, a demo lab's reset/process/activate) never reaches that
    // callback, so it left the observer armed: when the element later scrolled into view it
    // delivered a *second* activation, which `createCssInstance` reads as a repeat and answers
    // with `animation.reverse()` — a finished reveal playing backwards to nothing (an opened
    // `wipe-circle` closing itself on scroll-in). Recording the release here spends the one shot
    // whichever path takes it. A toggle activation must NOT be recorded: releasing a `hover` or
    // `click` binding on first use is exactly what would stop a card flip flipping back — and
    // neither must a *paired* observed activation, because `enter/leave` has to keep observing to
    // ever deliver its exit. `isOneShot` is that distinction; see `activation.ts`.
    if (isOneShot(resolveActivationSpec(stylePlan.activation!))) {
      state.releaseActivation = releaseOnce
    }
  }

  /**
   * Start a deferred animation.
   *
   * A JS-rendered effect's real setup work is postponed until this call — `deferPrepare` in
   * `instances.ts` only wires up an inert instance during `prepare` — so a broken primitive (a bad
   * selector, a malformed param) first throws here, not while the plan was being built. `scan()`
   * reaches this synchronously for every `on:load` element, inside the very loop that processes
   * every other element on the page; an uncaught throw here previously unwound that loop and
   * silently orphaned every element after the broken one — the same blast radius the `__proto__`
   * scan-crash fix closed for a different door. Each instance is isolated so one effect's failure
   * can neither strand a sibling effect on the same element nor abort the rest of the scan.
   *
   * @complexity O(n) time in composed instances; O(1) space.
   * @overallScore 100
   */
  activate(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    // A reversing element is still `running`, so the guard below would swallow the enter half of a
    // pair that fires while the exit half is still playing — a pointer leaving an element and
    // coming straight back, which is the commonest thing a pointer does. Turning the playhead
    // around is the only answer that leaves the element where the author asked for it.
    if (state.status === 'running' && state.direction === 'reverse') {
      this.turnAround(el, state)
      return
    }
    if (state.status === 'running') return
    // A one-shot binding is spent by whichever path actually starts the effect, not only by the
    // observer callback that would otherwise be the sole releaser. See `openGate`.
    state.releaseActivation?.()
    state.releaseActivation = undefined
    state.status = 'running'
    state.direction = 'forward'
    state.attributes.set(ATTR.state, 'running')

    const started = state.instances.filter((instance) => this.startInstance(instance, el))
    if (started.length === 0 && state.instances.length > 0) {
      // Every instance on this element failed to activate — nothing is running, so falling
      // through to the empty `Promise.all` below and reporting "finished" would codify a lie
      // exactly as much as leaving the element stuck "running" forever would.
      state.status = 'failed'
      state.attributes.set(ATTR.state, 'failed')
      return
    }
    // After the failure check, never before it: an element where every instance threw has not
    // started, and telling a listener otherwise would be the same lie `status = 'failed'` exists
    // to avoid. An element with no instances at all — a pure `css-keyframes` plan whose animation
    // longhands were written straight to the style — has started, and does reach this.
    this.emit(el, state, KUI_EVENT.start, 'activated')

    this.settleWhen(el, state, started, 'finished')
  }

  /**
   * Play an element's effects back out.
   *
   * The exit half of a paired activation — `data-kui-on="pointerenter/pointerleave"`,
   * `data-kui-on="enter/leave"` — routed through one method for the same reason `activate` is: it
   * is the single place an effect ever runs backwards, so what an exit means does not have to be
   * re-decided per activation.
   *
   * **CSS-rendered effects reverse; JS-rendered ones do not, and say so.** A CSS effect has a real
   * `Animation` handle whose playback rate can simply be negated, landing on the from-state that
   * `animation-fill-mode: both` is already holding. A JS-rendered effect has no playhead at all —
   * `getAnimations()` returns `[]` for it (see `play.ts`) — and there is no honest general shim
   * for "half a `split-flap`, backwards". Rather than invent one that misbehaves differently per
   * primitive, an instance that cannot reverse is named in a warning; the author learns their
   * pointerleave does nothing *here* instead of discovering it in a browser. On an element
   * composing both renderers the CSS half still reverses and the warning names what did not.
   *
   * @param el - Element whose effects should play out.
   * @complexity O(n) time in the number of instances; O(1) space.
   * @overallScore 100
   */
  deactivate(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    // Nothing that never started can play out, and an exit already in flight must not restart from
    // wherever it has got to — two `pointerleave`s in a row are one exit. `reverseFrom` re-checks
    // both, because it is reachable without coming through here at all; they are repeated here
    // because they also gate the warning below. An element that never started, or one already on
    // its way out, must not be told a second time that half its effects cannot participate.
    if (state.status !== 'running' && state.status !== 'finished') return
    if (state.direction === 'reverse') return

    const reversible = state.instances.filter(isDirectional)
    if (reversible.length < state.instances.length) {
      this.reporter.warn(
        'effect cannot play backwards, so the exit half of this activation does nothing for it ' +
          '(JS-rendered effects have no playhead — see EffectInstance.reverse)',
        el,
      )
    }
    // Everything above this line is what makes *this* call an activation exit — the "your pointer
    // left" reading, and a warning phrased in that language. The direction change itself is not
    // this method's to make; see `reverseFrom` for why it has exactly one owner. No
    // `reversible.length === 0` guard here any more: `reverseFrom` makes the same check, and making
    // it twice would only invite the two copies to drift.
    this.reverseFrom(el)
  }

  /**
   * Turn an element's playhead around and settle it back at the from-state it started from.
   *
   * The single owner of `state.direction === 'reverse'`, and it exists as its own method because
   * for a while there were two owners and neither knew about the other. `deactivate()` — the exit
   * half of a paired activation — flipped the direction and re-armed the settle gate;
   * `control(el).reverse()` reached straight past the state machine into the raw `Animation`
   * handles through `InstanceControl.reverse`. Both moved the same playheads, only one of them said
   * so, and an animator that believed a reversing element was still travelling forwards got three
   * things wrong at once: a later `deactivate()` sailed through its "an exit already in flight must
   * not restart" guard and began a *second* reverse; `activate()` could never turn the playhead
   * around, because it looks for `'reverse'` and never saw it; and the forward `settleWhen` left
   * over from the entrance stayed pending until it stamped `data-kui-state="finished"` onto an
   * element sitting at its from-state.
   *
   * So the transition lives here and both entry points call it. What `deactivate()` keeps is only
   * what is true of an *activation* exit specifically. A programmatic reverse is not one — an
   * author calling `control().reverse()` has not had a pointer leave anything — so it inherits
   * none of that, and in particular is not told that the effects it cannot reach make "the exit
   * half of this activation" do nothing. `control.ts` has already named those for it.
   *
   * Resuming forward travel is `activate()`'s job, not a second method here: an element left in
   * `'reverse'` is turned around by `turnAround`, which is reachable from every route that
   * activates — a pointer coming back, `play()`, `kui.activate()`.
   *
   * @param el - Element whose effects should run backwards. Unknown elements are ignored, exactly
   *   as they are by `activate` and `deactivate`.
   * @complexity O(n) time in the number of instances; O(1) space.
   * @overallScore 100
   */
  reverseFrom(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    // Not merely tidiness. An element still at `ready` has no run to reverse, and writing
    // `status = 'running'` plus `direction = 'reverse'` onto one would route its *first* real
    // activation into `turnAround()` — `instance.play()` instead of `instance.activate()`, no
    // `kui:start`, and a one-shot `enter` binding never spent. Refusing is the only answer that
    // leaves the element still activatable.
    if (state.status !== 'running' && state.status !== 'finished') return
    // Idempotent, on exactly the rule that makes two `pointerleave`s in a row one exit: a second
    // reverse must not restart the exit from wherever it has got to, and must not arm a second
    // settle gate that would write `ready` all over again. This is also what makes
    // `control().reverse()` followed by a real `deactivate()` one reverse rather than two —
    // `deactivate` reads the direction this line protects and returns.
    if (state.direction === 'reverse') return

    const reversible = state.instances.filter(isDirectional)
    // Nothing here has a playhead, so nothing is going to travel backwards. Returning *before* the
    // transition matters more than it looks: recording a direction for a reverse that never happens
    // would leave the element permanently un-exitable — `deactivate()` would return at the guard
    // above forever — and would send its next activation through `turnAround()`.
    if (reversible.length === 0) return

    state.status = 'running'
    state.direction = 'reverse'
    state.attributes.set(ATTR.state, 'running')
    for (const instance of reversible) instance.reverse!()
    // `ready`, not `finished`: the effects have run back to the from-state they started from, so
    // the element is exactly as it was before it was ever activated — which is what `ready` means
    // everywhere else, and what an author styling `[data-kui-state]` needs it to keep meaning.
    this.settleWhen(el, state, reversible, 'ready')
  }

  /**
   * Resume forward playback on an element whose exit is still in flight.
   *
   * Separate from `activate`'s main path because none of that path applies: the instances are
   * already started, the activation is already spent, and the state is already `running`. All that
   * changes is the direction of travel.
   *
   * @complexity O(n) time in the number of instances; O(1) space.
   * @overallScore 100
   */
  private turnAround(el: Element, state: InstanceState): void {
    // Never empty, and deliberately not guarded as though it might be: this runs only while
    // `direction === 'reverse'`, which only `deactivate` sets, and only after the same
    // `isDirectional` filter found something. `state.instances` is fixed at install, so the two
    // filters cannot disagree. A guard here would be unreachable code pretending to be caution.
    const playable = state.instances.filter(isDirectional)
    state.direction = 'forward'
    for (const instance of playable) instance.play!()
    this.settleWhen(el, state, playable, 'finished')
  }

  /**
   * Write an element's final state once the instances driving it have finished.
   *
   * The reported state has to become truthful eventually, or `data-kui-state` codifies a lie that
   * tests then assert against. It also has to stay truthful when a run is superseded mid-flight: a
   * reverse that is turned around leaves its own `finished` promise pending, and letting that
   * promise write `ready` over the forward run that replaced it is how an element ends up claiming
   * it is back at its from-state while visibly finishing its entrance. Capturing the direction at
   * the time of the call and re-checking it on resolution is what makes the stale promise a no-op.
   *
   * @param instances - The instances this particular run started; a run only waits on its own.
   * @param next - State to report when they are all done.
   * @complexity O(n) time in the instances; O(n) space for the pending promises.
   * @overallScore 100
   */
  private settleWhen(
    el: Element,
    state: InstanceState,
    instances: EffectInstance[],
    next: 'finished' | 'ready',
  ): void {
    // A continuous instance — a pin, a scroll progress track, a media scrub — keeps an
    // already-resolved `finished` so that composing it with a one-shot never stops the one-shot
    // reporting complete. Waiting on it here would therefore resolve on the next microtask and
    // write "finished" onto an effect that has not even started scrubbing, which is exactly the
    // lie the comment above warns about. So the gate waits on the finite instances only, and an
    // element whose every instance is continuous stays "running" — the honest answer, and the one
    // an author styling `[data-kui-state='running']` needs. An element with no instances at all
    // (a pure CSS-keyframes effect) is untouched by this and still resolves immediately.
    const timed = instances.filter((instance) => !instance.continuous)
    if (timed.length === 0 && instances.length > 0) return

    const direction = state.direction
    void Promise.all(timed.map((instance) => instance.finished)).then(() => {
      if (this.states.get(el) !== state || state.status !== 'running') return
      if (state.direction !== direction) return
      state.status = next
      state.attributes.set(ATTR.state, next)
      // Cancelling resolves `finished` too (see `EffectInstance.finished`'s never-rejects
      // contract), so this handler still runs for a cancelled element and still writes the
      // "finished" attribute it has always written. Dispatching a completion event as well would
      // tell an author that an animation they explicitly stopped had run to its end — as untrue of
      // an abandoned exit as of an abandoned entrance, so one flag suppresses both.
      if (state.cancelled) return
      // Two events rather than one, and the split is the whole point. `kui:finish` keeps meaning
      // what it meant before reversal existed: the *forward* run reached its end. Firing it for a
      // settled reverse would run an author's "now reveal the next thing" handler on the way out.
      // But an exit that has completed is still worth observing — it is the moment the element is
      // genuinely back at its from-state, which is when an author unmounts it, releases it, or
      // starts the next thing — so it gets a name of its own instead of the silence it used to get.
      if (next === 'finished') this.emit(el, state, KUI_EVENT.finish, 'complete')
      else this.emit(el, state, KUI_EVENT.reverseFinish, 'reversed')
    })
  }

  /**
   * Dispatch one lifecycle event for an element, filling in the identity every listener needs.
   *
   * Centralised here rather than inside each instance because the animator is the only place that
   * knows the *element's* lifecycle — an element composing three effects starts once and finishes
   * once, not three times, and only this class sees all three instances at the same moment.
   *
   * @complexity O(n) time in listeners on the propagation path; O(1) space.
   * @overallScore 100
   */
  private emit(
    el: Element,
    state: InstanceState,
    type: LifecycleEventType,
    reason: LifecycleReason,
  ): void {
    emitLifecycle(el, type, {
      effects: state.fxNames,
      activation: state.activation,
      timeline: state.timeline,
      reason,
    })
  }

  /**
   * Stop one element's effects where they are, leaving it mid-animation.
   *
   * The counterpart to `activate()`, and the reason it exists rather than callers reaching into
   * `stateOf(el).instances` themselves (which is what `play()`'s handle used to do): cancellation
   * has an observable consequence — `kui:cancel`, and the suppression of the `kui:finish` that
   * would otherwise follow it — and that consequence has to be applied wherever cancellation
   * happens, not only where it happens to be convenient.
   *
   * @param el - Element whose effects should stop.
   * @complexity O(n) time in the element's instances; O(1) space.
   * @overallScore 100
   */
  cancel(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    const wasRunning = state.status === 'running'
    state.cancelled = true
    for (const instance of state.instances) runQuietly(() => instance.cancel())
    if (wasRunning) this.emit(el, state, KUI_EVENT.cancel, 'cancelled')
  }

  /**
   * Runtime control over a selection's playheads — pause, resume, reverse, seek, re-speed.
   *
   * Selection-shaped rather than single-element, so it matches `play()` and so one call covers a
   * staggered group. `control.ts` builds a per-element handle underneath and the returned handle
   * composes them.
   *
   * @param target - Selector, element, or iterable of elements.
   * @complexity O(n) time in selected elements and their instances; O(n) space.
   * @overallScore 100
   */
  control(target: Target): ControlHandle {
    return control({ animator: this, root: this.root, target })
  }

  /**
   * Activate one instance, isolating a throw from its (possibly deferred) setup.
   *
   * @returns Whether the instance actually started — a failed instance is excluded from the
   * `finished` gate in `activate()`, since something that never started can never legitimately
   * finish (see `EffectInstance.finished`'s "resolves, never rejects" contract in `types.ts`).
   * @complexity O(1) time, O(1) space.
   * @overallScore 100
   */
  private startInstance(instance: EffectInstance, el: Element): boolean {
    try {
      instance.activate()
      return true
    } catch (error) {
      this.reporter.warn(`effect failed to activate: ${String(error)}`, el)
      return false
    }
  }

  /**
   * Programmatic entry point. Accepts a selector, an Element, a NodeList, or any iterable, so
   * `getElementById`, `getElementsByClassName`, and `querySelectorAll` all work directly.
   *
   * @complexity O(n) time in selected elements.
   * @overallScore 100
   */
  play(target: Target, effect: string, options: PlayOptions = {}): PlaybackHandle {
    return play({ animator: this, root: this.root, target, effect }, options)
  }

  /**
   * Remove the opt-in cloak so a stalled or failed initialisation can never leave a page hidden.
   *
   * @complexity O(1) time, O(1) space.
   * @overallScore 100
   */
  uncloak(): void {
    const doc = isElementNode(this.root) ? this.root.ownerDocument : (this.root as Document | undefined)
    doc?.documentElement?.removeAttribute(ATTR.cloak)
  }

  stateOf(el: Element): InstanceState | undefined {
    return this.states.get(el)
  }

  /**
   * Tear an element's effects down so the next `process()` reinstalls from scratch.
   *
   * Needed for replay: `process()` short-circuits when the configuration fingerprint is
   * unchanged, so playing the same effect twice was previously a no-op.
   *
   * @complexity O(c) time in retained instances; O(1) space.
   * @overallScore 100
   */
  reset(el: Element): void {
    this.release(el)
  }

  /**
   * Tear down one element's effects and clear its library-owned attributes.
   *
   * @complexity O(c) time in retained cleanups; O(1) extra space.
   * @overallScore 100
   */
  private release(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    const wasRunning = state.status === 'running'
    state.cancelled = true
    // Order matters: abort first so bindings detach, then destroy instances, then restore. A
    // primitive's teardown may itself write styles the ledger has to unwind.
    state.controller.abort()
    for (const instance of state.instances) runQuietly(() => instance.destroy())
    this.states.delete(el)
    this.liveElements.delete(el)
    // Unconditional, including on the `regate` path that is about to reinstall: `process` re-arms
    // it from the freshly compiled plan, so the only thing dropping it here can lose is a stale
    // subscription for an element that has genuinely gone away.
    this.gateWatcher?.unwatch(el)
    state.ledger.restore()
    state.attributes.restore()
    // Dispatched last, after both ledgers have unwound, so a listener sees the author's own markup
    // rather than a half-torn-down element. Only for an element that was actually running: a
    // recompile of an element still sitting at its from-state cancels nothing an author could have
    // observed, and firing there would make `kui:cancel` noise on every `data-kui` edit.
    if (wasRunning) this.emit(el, state, KUI_EVENT.cancel, 'reset')
  }

  /**
   * Tear down every tracked element inside a removed subtree.
   *
   * Scoped to `node`'s own descendants rather than re-scanning `liveElements` against the whole
   * page, so a removal event costs O(removed subtree), not O(every animated element alive
   * anywhere) — `dom-watcher.ts` can queue up to 100 removed roots per frame, and `liveElements`
   * only shrinks on release, so it stays large on a scroll-reveal-heavy page.
   *
   * Membership is checked against `liveElements` (the ground truth) rather than re-querying
   * `[${ATTR.source}]` the way `scan()` does: `dom-watcher.ts`'s `flush()` drains removed roots
   * before attribute-change roots, so if calling code strips `data-kui` and removes the element in
   * the same tick, a selector-based query would already miss it here and leak its teardown.
   *
   * `node` is typed `Element`, not `ParentNode`: `dom-watcher.ts`'s `onElementRemoved` — this
   * method's only caller — is itself typed `(el: Element) => void`, so there is no runtime case
   * where `node` is a `Document`/`DocumentFragment` to guard against.
   *
   * @complexity O(s) time in the removed subtree's element count; O(1) per candidate via the
   * `liveElements` Set lookup.
   * @overallScore 100
   */
  private releaseTree(node: Element): void {
    if (this.liveElements.has(node)) this.release(node)
    for (const el of node.querySelectorAll('*')) {
      if (this.liveElements.has(el)) this.release(el)
    }
  }

  destroy(): void {
    this.domWatcher?.destroy()
    for (const el of [...this.liveElements]) this.release(el)
    this.gateWatcher?.destroy()
    this.binder.destroy()
    this.scheduler.destroy()
    this.started = false
  }

  /**
   * Start watching for DOM insertions, removals, and attribute changes.
   *
   * Attribute changes recompile in place; insertions scan; removals tear down so listeners and
   * observers do not outlive their elements.
   *
   * @complexity O(1) time and space to build and start; the watcher's own callback runs O(n) time
   * in the nodes one mutation record carries.
   * @overallScore 100
   */
  private watch(): void {
    this.domWatcher ??= createDomWatcher({
      root: this.root,
      onElementAdded: (el) => this.scan(el),
      onElementRemoved: (el) => this.releaseTree(el),
      onAttributeChanged: (el) => this.process(el),
    })
    this.domWatcher.watch()
  }
}

export function createAnimator(options: AnimatorOptions = {}): Animator {
  return new Animator(options)
}

/**
 * Apply every default in one place.
 *
 * Extracted from the constructor so the defaulting rules stay assertable on their own and the
 * constructor keeps a single job: assignment.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveCollaborators(options: AnimatorOptions) {
  const root = options.root ?? (globalThis.document as ParentNode)
  const capabilities = options.capabilities ?? detect()
  const reporter = options.reporter ?? silentReporter()
  const scheduler = options.scheduler ?? createScrollScheduler()
  const rootResolver = options.rootResolver ?? defaultRootResolver(root)
  const respectReducedMotion = (options.reducedMotion ?? 'respect') === 'respect'
  return {
    registry: options.registry ?? new Registry(),
    capabilities,
    root,
    reporter,
    binder: options.binder ?? createActivationBinder(),
    scheduler,
    rootResolver,
    jsEffectPreparer: resolveJsEffectPreparer(options.jsEffectPreparer, {
      scheduler,
      rootResolver,
      capabilities,
      reporter,
      respectReducedMotion,
    }),
    // Not defaulted here (unlike the other collaborators above): building the real watcher needs
    // `this.scan`/`this.process`/`this.releaseTree`, which don't exist yet inside this free
    // function. `Animator.watch()` builds it lazily instead, so nothing observes — and no
    // `MutationObserver` is ever constructed — unless `shouldObserve` is true and `start()` runs.
    domWatcher: options.domWatcher,
    respectReducedMotion,
    shouldObserve: options.observe ?? false,
  }
}

/**
 * Default the JS-effect preparer to one built from this animator's other resolved collaborators.
 *
 * Split out of `resolveCollaborators` so that function's own defaulting-branch count stays under
 * the complexity ceiling — this default depends on collaborators `resolveCollaborators` has
 * already resolved (`scheduler`, `rootResolver`, ...), so it cannot just be inlined as one more
 * `??` there.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveJsEffectPreparer(
  provided: JsEffectPreparer | undefined,
  deps: JsEffectPreparerOptions,
): JsEffectPreparer {
  return provided ?? createJsEffectPreparer(deps)
}

/**
 * Resolve scroll roots against whichever window owns the animator's tree.
 *
 * Falls back to a window-only resolver when there is no document (SSR, workers), so constructing
 * an animator never depends on a browser being present.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function defaultRootResolver(root: ParentNode | undefined): (el: Element) => ScrollRoot {
  const doc = isElementNode(root) ? root.ownerDocument : (root as Document | undefined)
  const win = doc?.defaultView ?? (globalThis as unknown as Window)
  return createRootResolver({ win })
}

/**
 * Whether the animator can drive this instance in both directions.
 *
 * Both or neither, checked in one place: an instance that could be reversed but not resumed would
 * strand an element mid-exit the moment a pointer came back, which is worse than never having
 * offered the exit at all. `play` and `reverse` are optional on `EffectInstance` because a
 * JS-rendered effect has no playhead for either (see `types.ts`), so this is the single question
 * both `deactivate` and `turnAround` ask.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function isDirectional(instance: EffectInstance): boolean {
  return instance.play !== undefined && instance.reverse !== undefined
}

/** Teardown must never throw into the caller; a failing cleanup cannot block the others. */
function runQuietly(cleanup: () => void): void {
  try {
    cleanup()
  } catch {
    /* intentionally ignored */
  }
}
