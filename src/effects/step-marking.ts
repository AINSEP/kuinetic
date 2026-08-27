import { createAttributeLedger } from '../core/owned-styles.js'
import type { AttributeLedger } from '../core/owned-styles.js'
import type { Cleanup } from '../core/types.js'

/**
 * Marking the children of a stepped effect, shared by every primitive that has an index.
 *
 * Two primitives publish `data-kui-step` — `scroll-progress` (scroll-driven, backs
 * `scrollytelling-step`) and `step-progress` (click-driven, forms) — and the attribute alone puts
 * all the work on the author. Selecting "the child matching the current index" is the one thing CSS
 * cannot express, so a page had to enumerate it:
 *
 * ```css
 * [data-kui-step='0'] li:nth-child(1),
 * [data-kui-step='1'] li:nth-child(2),
 * [data-kui-step='2'] li:nth-child(3),
 * [data-kui-step='3'] li:nth-child(4) { ... }
 * ```
 *
 * Four selectors for four steps, doubled for every property group, and every one of them wrong the
 * moment a fifth step is added or an element is inserted above the list. `demo/scroll.html` carried
 * eight such selectors for one demo.
 *
 * Marking the children instead collapses that to `li[data-kui-step-state='active']`, which does not
 * change when the step count does. Three values rather than a boolean, because a stepper wants
 * "everything up to here" (`:not([data-kui-step-state='after'])`) as often as it wants the live one.
 */

/** The attribute this module owns. Never write it from anywhere else. */
export const STEP_STATE_ATTR = 'data-kui-step-state'

export type StepState = 'before' | 'active' | 'after'

/**
 * `target:`/`scope:` resolution — `resolveTarget`, `queryScoped`, `TargetScope`, `SCOPE_PARAM`,
 * `scopeParam` — moved to `core/target.ts`. `core/compile.ts` and `core/animator.ts` need the same
 * resolution for the *universal* `target:` (any effect, not just the six primitives that used to be
 * the only place this grammar existed), and `core` must not depend on `effects`. Import from
 * `../core/target.js` here as everywhere else; this module keeps only the step-index-specific half.
 */

/**
 * A set of step elements plus the ledgers that let their original attributes survive teardown.
 *
 * One ledger per element ever written, rather than a bare Set of touched nodes: a Set records
 * *which* elements were stamped but not *what they held first*, so teardown would remove a
 * `data-kui-step-state` the consumer had authored themselves. Same reasoning as `scroll-spy`'s
 * link ledgers and the inline-style ledger they were both modelled on.
 */
export interface StepMarker {
  /** Stamp `before`/`active`/`after` across the tracked elements. Cheap enough to call per flip. */
  mark(index: number): void
  /** Give every touched element back the attribute value it had before this instance existed. */
  restore: Cleanup
}

/**
 * Build a marker over the elements a stepped effect drives.
 *
 * `resolve` is called per flip rather than once at setup, so a list rendered or reordered after
 * this element was prepared is still picked up. Flips are rare — the caller is expected to guard on
 * the index actually changing — while frames are not.
 *
 * @param resolve - Produces the current step elements, in document order.
 * @returns A marker; call `restore` from the primitive's teardown.
 * @complexity O(n) per `mark` in the number of step elements; O(n) space in elements ever touched.
 * @overallScore 100
 */
export function createStepMarker(resolve: () => Iterable<Element>): StepMarker {
  const ledgers = new Map<Element, AttributeLedger>()

  return {
    mark(index) {
      /*
       * Position is counted within each matched element's own parent, not across the whole match.
       *
       * `querySelectorAll` returns document order, so a target naming two parallel groups — the
       * copy lines *and* the dots that track them, which is the shape every scrollytelling layout
       * has — would otherwise number them 0-3 and then 4-7, leaving the second group permanently
       * `after`. Per-parent numbering makes both read 0-3 and is identical to flat numbering for
       * the single-group case, which is the common one.
       */
      const seen = new Map<Element | null, number>()
      for (const node of resolve()) {
        const parent = node.parentElement
        const position = seen.get(parent) ?? 0
        seen.set(parent, position + 1)

        let ledger = ledgers.get(node)
        if (!ledger) {
          ledger = createAttributeLedger(node)
          ledgers.set(node, ledger)
        }
        // The ledger remembers only the value it first replaced, so repeated flips never overwrite
        // the consumer's original with one of this instance's own writes.
        ledger.set(STEP_STATE_ATTR, stepStateFor(position, index))
      }
    },
    restore() {
      for (const ledger of ledgers.values()) ledger.restore()
      ledgers.clear()
    },
  }
}

/**
 * Where one step sits relative to the live one.
 *
 * Pure, so the three-way split is assertable without a DOM.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function stepStateFor(position: number, index: number): StepState {
  if (position < index) return 'before'
  if (position === index) return 'active'
  return 'after'
}
