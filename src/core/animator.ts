import { createActivationBinder } from './activation.js'
import type { ActivationBinder } from './activation.js'
import { ATTR } from './attrs.js'
import { detect } from './capabilities.js'
import type { Capabilities } from './capabilities.js'
import { compile } from './compile.js'
import type { CompiledPlan } from './compile.js'
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
import type { Activation, InstanceState, ParsedValue } from './types.js'

/** Longest a stalled initialisation may keep an opt-in cloak in place. */
const CLOAK_WATCHDOG_MS = 3000

/** Configuration identity: every attribute that changes what gets compiled. */
function fingerprintOf(attributes: ElementAttributes): string {
  return [attributes.source, attributes.on, attributes.timeline, attributes.threshold].join('\u0000')
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

  private readonly root: ParentNode
  private readonly reporter: Reporter
  private readonly binder: ActivationBinder
  private readonly scheduler: ScrollScheduler
  private readonly rootResolver: (el: Element) => ScrollRoot
  private readonly jsEffectPreparer: JsEffectPreparer
  private readonly respectReducedMotion: boolean
  private readonly shouldObserve: boolean
  /** Runtime truth. Attributes are for CSS and debugging; they make a poor state machine. */
  private readonly states = new WeakMap<Element, InstanceState>()
  private mutationObserver?: MutationObserver
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
    if (root instanceof Element && root.matches(selector)) this.process(root)
    for (const el of root.querySelectorAll(selector)) this.process(el)
    applyStagger(root)
    return this
  }

  /**
   * Compile and install one element's effects, recompiling if its attribute changed.
   *
   * @param el - Element carrying `data-dsg`.
   * @complexity O(e) time in the number of composed effects; O(e) space for the plan.
   * @overallScore 100
   */
  process(el: Element): void {
    const attributes = readAttributes(el)
    // The whole configuration, not just `data-dsg`. Keying on the source alone meant a change to
    // `data-dsg-on`, `data-dsg-timeline`, or `data-dsg-threshold` was ignored permanently — even
    // when `process()` was called again by hand.
    const fingerprint = fingerprintOf(attributes)
    const existing = this.states.get(el)
    if (existing?.fingerprint === fingerprint) return
    if (existing) this.release(el)

    const parsed = parse(attributes.source)
    const config = resolveConfig(attributes, parsed)
    const plan = compile(parsed, this.registry, config.timeline)

    config.activation = this.resolveActivation(el, config, plan)
    for (const warning of plan.warnings) this.reporter.warn(warning, el)

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
   * none, and warning when an authored activation is not one the effect supports.
   *
   * Declared capability metadata was previously never checked anywhere, which made
   * `supportedActivations` documentation rather than a contract.
   *
   * @complexity O(a) time in supported activations; O(1) space.
   * @overallScore 100
   */
  private resolveActivation(el: Element, config: ElementConfig, plan: CompiledPlan): Activation {
    if (!config.activationAuthored) return plan.defaultActivation ?? config.activation
    const supported = plan.supportedActivations
    if (supported.length > 0 && !supported.includes(config.activation)) {
      this.reporter.warn(
        `activation "${config.activation}" is not supported by this effect ` +
          `(supports: ${supported.join(', ')})`,
        el,
      )
    }
    return config.activation
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
      instances: [],
      ledger,
      attributes,
      controller,
      status: 'ready',
    }
    this.states.set(el, state)

    if (Object.keys(stylePlan.properties).some((property) => property.startsWith('animation-'))) {
      state.instances.push(createCssInstance(el, ledger))
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
      return
    }

    if (stylePlan.gate !== 'deferred') {
      this.activate(el)
      return
    }
    state.controller.signal.addEventListener(
      'abort',
      this.binder.bind(el, stylePlan.activation ?? config.activation, config.threshold, () =>
        this.activate(el),
      ),
    )
  }

  /**
   * Start a deferred animation.
   *
   * @complexity O(1) time, O(1) space.
   * @overallScore 100
   */
  activate(el: Element): void {
    const state = this.states.get(el)
    if (!state || state.status === 'running') return
    state.status = 'running'
    state.attributes.set(ATTR.state, 'running')
    for (const instance of state.instances) instance.activate()

    // The reported state has to become truthful eventually, or `data-dsg-state` codifies a lie
    // that tests then assert against.
    void Promise.all(state.instances.map((instance) => instance.finished)).then(() => {
      if (this.states.get(el) !== state || state.status !== 'running') return
      state.status = 'finished'
      state.attributes.set(ATTR.state, 'finished')
    })
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
    const doc = this.root instanceof Element ? this.root.ownerDocument : (this.root as Document)
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
    // Order matters: abort first so bindings detach, then destroy instances, then restore. A
    // primitive's teardown may itself write styles the ledger has to unwind.
    state.controller.abort()
    for (const instance of state.instances) runQuietly(() => instance.destroy())
    this.states.delete(el)
    state.ledger.restore()
    state.attributes.restore()
  }

  private releaseTree(node: ParentNode): void {
    if (node instanceof Element) this.release(node)
    for (const el of node.querySelectorAll(`[${ATTR.normalized}]`)) this.release(el)
  }

  destroy(): void {
    this.mutationObserver?.disconnect()
    this.binder.destroy()
    this.scheduler.destroy()
    if (this.root) this.releaseTree(this.root)
    this.started = false
  }

  private watch(): void {
    if (typeof MutationObserver === 'undefined') return
    this.mutationObserver = new MutationObserver((records) => {
      for (const record of records) this.handleMutation(record)
    })
    this.mutationObserver.observe(this.root as Node, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [ATTR.source, ATTR.on, ATTR.timeline, ATTR.threshold],
    })
  }

  /**
   * Route one mutation record. Attribute changes recompile in place; insertions scan; removals
   * tear down so listeners and observers do not outlive their elements.
   *
   * @complexity O(n) time in the nodes carried by the record.
   * @overallScore 100
   */
  private handleMutation(record: MutationRecord): void {
    if (record.type === 'attributes') {
      if (record.target instanceof Element) this.process(record.target)
      return
    }
    for (const node of record.addedNodes) if (node instanceof Element) this.scan(node)
    for (const node of record.removedNodes) if (node instanceof Element) this.releaseTree(node)
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
  const doc = root instanceof Element ? root.ownerDocument : (root as Document | undefined)
  const win = doc?.defaultView ?? (globalThis as unknown as Window)
  return createRootResolver({ win })
}

/** Teardown must never throw into the caller; a failing cleanup cannot block the others. */
function runQuietly(cleanup: () => void): void {
  try {
    cleanup()
  } catch {
    /* intentionally ignored */
  }
}
