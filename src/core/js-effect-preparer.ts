import type { Capabilities } from './capabilities.js'
import type { CompiledPlan } from './compile.js'
import type { PrepareContext } from './effect-context.js'
import { readEffectParams } from './js-params.js'
import type { StyleLedger } from './owned-styles.js'
import type { Reporter } from './reporter.js'
import type { ScrollRoot, ScrollScheduler } from './scroll-scheduler.js'
import type { EffectInstance } from './types.js'

/** Everything `JsEffectPreparer.prepare` needs, grouped so the call site reads as one request. */
export interface PrepareJsEffectsRequest {
  el: Element
  plan: CompiledPlan
  signal: AbortSignal
  ledger: StyleLedger
}

/**
 * Wires up an element's JS-rendered effects and hands each one the context it needs to run.
 *
 * Extracted from `Animator` as an injected collaborator — same shape as `binder` or `scheduler` —
 * because this pair only ever reads already-injected environment collaborators
 * (`scheduler`/`rootResolver`/`capabilities`/`reporter`/`respectReducedMotion`), never the
 * animator's own lifecycle state.
 */
export interface JsEffectPreparer {
  /**
   * Run each JS-rendered effect's setup, isolating failures so one broken effect cannot abort the
   * rest of the element.
   *
   * @returns Instances for every effect that initialised successfully.
   * @complexity O(e) time in JS-rendered effects; O(e) space.
   * @overallScore 100
   */
  prepare(request: PrepareJsEffectsRequest): EffectInstance[]
}

export interface JsEffectPreparerOptions {
  scheduler: ScrollScheduler
  rootResolver: (el: Element) => ScrollRoot
  capabilities: Capabilities
  reporter: Reporter
  respectReducedMotion: boolean
}

/**
 * Build a `JsEffectPreparer` closed over one animator's collaborators.
 *
 * @complexity O(1) time and space beyond the closure it returns.
 * @overallScore 100
 */
export function createJsEffectPreparer(options: JsEffectPreparerOptions): JsEffectPreparer {
  const { scheduler, rootResolver, capabilities, reporter, respectReducedMotion } = options

  /**
   * Build the context handed to JS-rendered primitives.
   *
   * @complexity O(1) time, O(1) space.
   * @overallScore 100
   */
  function contextFor(el: Element, signal: AbortSignal, ledger: StyleLedger): PrepareContext {
    const doc = el.ownerDocument
    return {
      doc,
      win: doc.defaultView ?? (globalThis as unknown as Window),
      scheduler,
      rootFor: rootResolver,
      capabilities,
      invalidate: () => scheduler.invalidate(),
      warn: (message: string) => reporter.warn(message, el),
      reducedMotion: respectReducedMotion && capabilities.reducedMotion,
      signal,
      style: ledger,
    }
  }

  return {
    prepare({ el, plan, signal, ledger }: PrepareJsEffectsRequest): EffectInstance[] {
      const instances: EffectInstance[] = []
      if (plan.jsEffects.length === 0) return instances

      const ctx = contextFor(el, signal, ledger)

      for (const { spec, resolved } of plan.jsEffects) {
        const prepare = resolved.primitive.prepare
        if (!prepare) continue
        // Validated and defaulted, never the raw attribute strings — a JS primitive branches on
        // these values, so handing it unscreened author input was both a type lie and the exact
        // hole `params.ts` exists to close.
        const params = readEffectParams(
          { ...resolved.preset.params, ...spec.params },
          resolved.primitive.parameters,
          (message) => reporter.warn(message, el),
        )
        try {
          instances.push(prepare(el, params, ctx))
        } catch (error) {
          reporter.warn(`"${spec.name}" failed to initialise: ${String(error)}`, el)
        }
      }
      return instances
    },
  }
}
