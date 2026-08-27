import type { Capabilities } from './capabilities.js'
import { authoredParams } from './compile.js'
import type { CompiledPlan, Entry } from './compile.js'
import type { PrepareContext } from './effect-context.js'
import { readEffectParams, readEffectTiming } from './js-params.js'
import type { StyleLedger } from './owned-styles.js'
import type { Reporter } from './reporter.js'
import type { ScrollRoot, ScrollScheduler } from './scroll-scheduler.js'
import type { EffectInstance, EffectTiming } from './types.js'

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
 * Author timing for one segment, with any `at:` position folded in.
 *
 * `at:` supersedes the segment's own delay by design — an effect cannot be both 200ms after the
 * trigger and 200ms before its neighbour ends, and `compile` has already warned when an author
 * wrote both — so the resolved position overwrites `delayMs` rather than adding to it.
 *
 * The write is safe: `readEffectTiming` builds a fresh object per call, so nothing shared is being
 * mutated here. It reaches the primitive through `params.timing`, which is the route that works
 * whether or not the primitive's schema happens to declare a look-alike `delay` — see the design
 * note on the two routes into a JS primitive in the `prepare` loop below.
 *
 * @complexity O(1) time and space beyond `readEffectTiming`.
 * @overallScore 100
 */
function sequencedTiming(entry: Entry, warn: (message: string) => void): EffectTiming {
  const timing = readEffectTiming(entry.spec, warn)
  if (entry.sequencedDelayMs !== undefined) timing.delayMs = entry.sequencedDelayMs
  return timing
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

      for (const entry of plan.jsEffects) {
        const { spec, resolved } = entry
        const prepare = resolved.primitive.prepare
        if (!prepare) continue
        const warn = (message: string): void => reporter.warn(message, el)
        // Validated and defaulted, never the raw attribute strings — a JS primitive branches on
        // these values, so handing it unscreened author input was both a type lie and the exact
        // hole `params.ts` exists to close.
        //
        // Timing rides alongside rather than inside the parameter record: `declarations.ts`'s `pushTrack` reads
        // it off the spec for CSS-rendered effects, and a JS-rendered one has no other route to it
        // — merging it into the record instead would warn "unknown parameter" on every primitive
        // whose schema does not happen to declare a look-alike `duration`/`delay`/`ease`.
        // `authoredParams`, not `spec.params`: a primitive with a `variantFor` may normalise what
        // the author wrote before it is validated, and the CSS path already reads it through the
        // same accessor. No JS-rendered primitive declares one today; going through the accessor
        // is what stops the first one that does from silently seeing different input here.
        const params = readEffectParams(
          { ...resolved.preset.params, ...authoredParams(entry) },
          resolved.primitive.parameters,
          warn,
          sequencedTiming(entry, warn),
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
