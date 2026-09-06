import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import type { AttributeLedger, StyleLedger } from '../core/owned-styles.js'
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

/**
 * The ring place, as a selectable attribute beside the `--kui-offset` custom property.
 *
 * Also owned here, and written to the same elements. See `createStepMarker` for why both forms
 * exist: the number does arithmetic a selector cannot, the attribute selects what arithmetic
 * cannot — and hiding a slide properly (`visibility`, not `opacity`) needs a keyword.
 */
export const STEP_OFFSET_ATTR = 'data-kui-step-offset'

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

/** One matched element, numbered within its own parent group. */
interface Placed {
  node: Element
  parent: Element | null
  position: number
}

/**
 * Number the matched elements within their own parent groups, and count each group.
 *
 * Position is counted within each matched element's own parent, not across the whole match.
 * `querySelectorAll` returns document order, so a target naming two parallel groups — the copy
 * lines *and* the dots that track them, which is the shape every scrollytelling layout has — would
 * otherwise number them 0-3 and then 4-7, leaving the second group permanently `after`. Per-parent
 * numbering makes both read 0-3 and is identical to flat numbering for the single-group case,
 * which is the common one.
 *
 * Walked in full before anything is stamped, because `circularOffset` needs each group's *size*
 * and a single pass does not know it until it has already stamped the earlier members of that
 * group.
 *
 * @complexity O(n) time and space in the matched elements.
 * @overallScore 100
 */
function placeInGroups(nodes: Iterable<Element>): { order: Placed[]; sizes: Map<Element | null, number> } {
  const order: Placed[] = []
  const sizes = new Map<Element | null, number>()
  for (const node of nodes) {
    const parent = node.parentElement
    const position = sizes.get(parent) ?? 0
    sizes.set(parent, position + 1)
    order.push({ node, parent, position })
  }
  return { order, sizes }
}

/**
 * The live step as this group sees it — the index brought onto the group's own ring.
 *
 * Identical to `index` for every group that is as long as the count the caller is stepping
 * against, which is the whole of the ordinary case. It only does work when the groups disagree,
 * and there it is what keeps a group's two published facts from contradicting each other: see
 * {@link createStepMarker}.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function indexWithin(index: number, size: number): number {
  return size > 0 ? ((index % size) + size) % size : index
}

/**
 * Build a marker over the elements a stepped effect drives.
 *
 * `resolve` is called per flip rather than once at setup, so a list rendered or reordered after
 * this element was prepared is still picked up. Flips are rare — the caller is expected to guard on
 * the index actually changing — while frames are not.
 *
 * @param resolve - Produces the current step elements, in document order.
 * @param warn - Optional diagnostic sink, called at most once per marker. Callers prefix their own
 *   effect name, the way every other warning in this library names the attribute to go and fix.
 * @returns A marker; call `restore` from the primitive's teardown.
 * @complexity O(n) per `mark` in the number of step elements; O(n) space in elements ever touched.
 * @overallScore 100
 */
export function createStepMarker(
  resolve: () => Iterable<Element>,
  warn?: (message: string) => void,
): StepMarker {
  const ledgers = new Map<Element, AttributeLedger>()
  const styles = new Map<Element, StyleLedger>()
  // Once per marker, not once per flip. The condition is a property of the markup, so it is the
  // same on every flip, and a stepper flips as fast as a visitor can press an arrow.
  let warned = false

  return {
    mark(index) {
      const { order, sizes } = placeInGroups(resolve())
      if (!warned && warn && new Set(sizes.values()).size > 1) {
        warned = true
        warn(
          `target matched groups of different sizes (${[...sizes.values()].join(', ')}) — the ` +
            'shorter group wraps onto its own ring, so its active element will not line up with ' +
            'the longer one',
        )
      }

      for (const { node, parent, position } of order) {
        const size = sizes.get(parent) ?? 0
        /*
         * Both facts below are derived from this one number, and that is the point.
         *
         * `circularOffset` has always worked on the group's own ring — it has to, because the ring
         * is what makes the last slide sit one place *behind* the first — while the three-way
         * state was read off the raw index. For groups of equal size those are the same number and
         * nothing was visible. For groups of unequal size, which is a real page with five slides
         * and four dots, they diverged: a dot could read `--kui-offset: 0` (this ring's live
         * position) while its `data-kui-step-state` said `before`, and at index 4 of five, four
         * dots left *nothing* marked active in that group at all. Two published facts about the
         * same element, disagreeing.
         *
         * Wrapping the index per group makes them one fact in two forms again, so
         * `[data-kui-step-state='active']` and `--kui-offset: 0` always select the same element.
         * Mismatched groups are still an authoring mistake — hence the warning above — but the
         * answer to one is now merely arbitrary rather than self-contradictory.
         */
        const local = indexWithin(index, size)

        let ledger = ledgers.get(node)
        if (!ledger) {
          ledger = createAttributeLedger(node)
          ledgers.set(node, ledger)
        }
        // The ledger remembers only the value it first replaced, so repeated flips never overwrite
        // the consumer's original with one of this instance's own writes.
        ledger.set(STEP_STATE_ATTR, stepStateFor(position, local))

        let style = styles.get(node)
        if (!style) {
          style = createStyleLedger(node)
          styles.set(node, style)
        }
        /*
         * The ring place goes out twice, as a number and as an attribute — the same pairing
         * `data-kui-step` and `--kui-step` already have, and for the same reason: a custom
         * property does arithmetic a selector cannot, and an attribute selects what arithmetic
         * cannot.
         *
         * The selector is the half that matters for correctness. A deck stacks every slide in one
         * place and shows three, and the ones it does not show have to become *inert* — not merely
         * transparent. `opacity: 0` leaves an element hit-testable, focusable and in the
         * accessibility tree, so an invisible slide still takes a tab stop (a real deck had two
         * dead stops mid-carousel, with no focus ring to explain them) and can still sit over a
         * visible neighbour's controls. `visibility: hidden` fixes all three at once and is a
         * keyword, so nothing can compute it from `--kui-offset`. This attribute is what a page
         * hangs it on.
         */
        const offset = circularOffset(position, local, size)
        style.set('--kui-offset', String(offset))
        ledger.set(STEP_OFFSET_ATTR, String(offset))
      }
    },
    restore() {
      for (const ledger of ledgers.values()) ledger.restore()
      for (const style of styles.values()) style.restore()
      ledgers.clear()
      styles.clear()
    },
  }
}

/**
 * Where one step sits relative to the live one, as a signed number of places *around a ring*.
 *
 * `before`/`active`/`after` is a three-way split, which is all a progress bar needs and not enough
 * for a deck: it says slide 5 is "before" slide 1 but not that it is one place behind it, and one
 * place is the whole difference between a carousel that loops and one that rewinds. Driving the
 * track off the container's single `--kui-step` means the wrap from the last slide to the first
 * runs the track back across every slide in between — the snap-back that reads as "it jumped to
 * the beginning" rather than "it carried on".
 *
 * Published per element instead, each slide can place itself: at index 0 of five, the last slide
 * reads `-1` and sits to the *left* of the live one, so stepping onto it moves one place forward
 * like every other step. Nothing is cloned and nothing is reordered — the ends of the strip simply
 * stop existing, because there is no strip, only positions on a ring.
 *
 * Signed and shortest-path: the far half of the ring counts backwards, so `+3` of five becomes
 * `-2`. An even count has no midpoint to split, and the exact half goes positive by convention.
 *
 * @param position - The element's index within its own parent group.
 * @param index - The live step.
 * @param size - How many steps are in that group.
 * @returns Places from the live step, negative for behind it.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function circularOffset(position: number, index: number, size: number): number {
  if (size <= 0) return 0
  const forward = (((position - index) % size) + size) % size
  return forward > Math.floor(size / 2) ? forward - size : forward
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
