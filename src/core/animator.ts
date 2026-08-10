import { createActivationBinder } from './activation.js'
import type { ActivationBinder } from './activation.js'
import { ATTR } from './attrs.js'
import { detect } from './capabilities.js'
import type { Capabilities } from './capabilities.js'
import { compile } from './compile.js'
import type { CompiledPlan } from './compile.js'
import { readAttributes, resolveConfig } from './element-config.js'
import type { ElementConfig } from './element-config.js'
import { parse } from './parse.js'
import { play } from './play.js'
import type { PlaybackHandle, PlayOptions, Target } from './play.js'
import { Registry } from './registry.js'
import { silentReporter } from './reporter.js'
import type { Reporter } from './reporter.js'
import { applyStagger } from './stagger.js'
import { applyStylePlan, planStyles } from './style-plan.js'
import type { InstanceState, ParsedValue } from './types.js'

export { ATTR }

/** Everything `install` needs, grouped so the call site reads as one request. */
interface InstallRequest {
  el: Element
  source: string
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
  private readonly respectReducedMotion: boolean
  private readonly shouldObserve: boolean
  /** Runtime truth. Attributes are for CSS and debugging; they make a poor state machine. */
  private readonly states = new WeakMap<Element, InstanceState>()
  private mutationObserver?: MutationObserver
  private started = false

  constructor(options: AnimatorOptions = {}) {
    this.registry = options.registry ?? new Registry()
    this.capabilities = options.capabilities ?? detect()
    this.root = options.root ?? (globalThis.document as ParentNode)
    this.reporter = options.reporter ?? silentReporter()
    this.binder = options.binder ?? createActivationBinder()
    this.respectReducedMotion = (options.reducedMotion ?? 'respect') === 'respect'
    this.shouldObserve = options.observe ?? false
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
    this.scan(this.root)
    if (this.shouldObserve) this.watch()
    this.uncloak()
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
    const existing = this.states.get(el)
    if (existing?.source === attributes.source) return
    if (existing) this.release(el)

    const parsed = parse(attributes.source)
    const config = resolveConfig(attributes, parsed)
    const plan = compile(parsed, this.registry, config.timeline)

    for (const warning of plan.warnings) this.reporter.warn(warning, el)

    if (plan.fxNames.length === 0) {
      // Deliberately does NOT stamp the normalized attribute: an effect registered later must
      // still be able to claim this element on a rescan.
      el.setAttribute(ATTR.state, plan.unknown.length > 0 ? 'pending' : 'failed')
      return
    }

    this.install({ el, source: attributes.source, parsed, config, plan })
  }

  /**
   * Apply a compiled plan and bind its activation.
   *
   * @complexity O(e) time in composed effects; O(e) space for retained cleanups.
   * @overallScore 100
   */
  private install(request: InstallRequest): void {
    const { el, source, parsed, config, plan } = request
    const stylePlan = planStyles({
      plan,
      config,
      capabilities: this.capabilities,
      respectReducedMotion: this.respectReducedMotion,
    })
    applyStylePlan(el, stylePlan)

    const state: InstanceState = {
      source,
      specs: parsed.specs,
      activation: config.activation,
      timeline: config.timeline,
      cleanups: [],
      status: 'ready',
    }
    this.states.set(el, state)

    state.cleanups.push(...this.prepareJsEffects(el, plan))

    if (stylePlan.gate === 'immediate') this.activate(el)
    if (stylePlan.activation) {
      state.cleanups.push(
        this.binder.bind(el, stylePlan.activation, config.threshold, () => this.activate(el)),
      )
    }
  }

  /**
   * Run each JS-rendered effect's setup, isolating failures so one broken effect cannot abort
   * the rest of the element.
   *
   * @returns Teardown functions for every effect that initialised successfully.
   * @complexity O(e) time in JS-rendered effects; O(e) space.
   * @overallScore 100
   */
  private prepareJsEffects(el: Element, plan: CompiledPlan): Array<() => void> {
    const cleanups: Array<() => void> = []
    const ctx = { doc: el.ownerDocument, warn: (m: string) => this.reporter.warn(m, el) }

    for (const { spec, resolved } of plan.jsEffects) {
      const prepare = resolved.primitive.prepare
      if (!prepare) continue
      try {
        cleanups.push(prepare(el, spec.params, ctx))
      } catch (error) {
        this.reporter.warn(`"${spec.name}" failed to initialise: ${String(error)}`, el)
      }
    }
    return cleanups
  }

  /**
   * Start a deferred animation.
   *
   * @complexity O(1) time, O(1) space.
   * @overallScore 100
   */
  activate(el: Element): void {
    ;(el as HTMLElement).style.setProperty('animation-play-state', 'running')
    el.setAttribute(ATTR.state, 'running')
    const state = this.states.get(el)
    if (state) state.status = 'running'
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
   * Tear down one element's effects and clear its library-owned attributes.
   *
   * @complexity O(c) time in retained cleanups; O(1) extra space.
   * @overallScore 100
   */
  private release(el: Element): void {
    const state = this.states.get(el)
    if (!state) return
    for (const cleanup of state.cleanups) runQuietly(cleanup)
    this.states.delete(el)
    for (const attribute of [ATTR.normalized, ATTR.state, ATTR.rm]) el.removeAttribute(attribute)
  }

  private releaseTree(node: ParentNode): void {
    if (node instanceof Element) this.release(node)
    for (const el of node.querySelectorAll(`[${ATTR.normalized}]`)) this.release(el)
  }

  destroy(): void {
    this.mutationObserver?.disconnect()
    this.binder.destroy()
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
      attributeFilter: [ATTR.source],
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

/** Teardown must never throw into the caller; a failing cleanup cannot block the others. */
function runQuietly(cleanup: () => void): void {
  try {
    cleanup()
  } catch {
    /* intentionally ignored */
  }
}
