import type { Cleanup, EffectParams, PrepareContext } from '../../core/types.js'

/**
 * Owned by phase 7a — the flip card's structural parts (E's owner decision): an injected control
 * when the author wrote none (`<button type="button" class="kui-flip-control"
 * data-kui-part="control" aria-pressed="false">Flip card</button>`, label "Flip card"), and
 * `data-kui-part="front"`/`"back"` on its two faces so `three-d.css` can style them without the
 * author having to add classes of their own.
 *
 * SKELETON STUB (§1): resolves the control exactly the way HEAD's `prepareCardToggle` already did
 * (`el.querySelector(':scope > .kui-flip-control')`, the direct-child lookup `FLIP_CONTROL_SELECTOR`
 * names today), injects nothing, and its `cleanup` restores nothing. Real body lands with 7a — see
 * `target-phases-2-9.md`.
 */

/** What {@link prepareFlipParts} resolved for one flip card. */
export interface FlipParts {
  /** The card's toggle control, whether authored or injected. `null` when trigger:click found
   *  none — the misconfiguration `prepareCardToggle` already warns about. */
  control: Element | null
  /** Undo every attribute stamp and remove every injected node. */
  cleanup: Cleanup
}

/**
 * Resolve (and, once 7a lands, stamp/inject) a flip card's structural parts.
 *
 * @param el - The flip card element.
 * @param params - The effect's authored parameters.
 * @param ctx - The prepare-time context (warnings, window).
 * @returns The card's control and a cleanup that undoes everything this function did.
 * STUB: the same direct-child lookup HEAD's `prepareCardToggle` already performs; nothing is
 * stamped or injected, and `cleanup` is a no-op — so wiring `prepareCardToggle` through this
 * function (S-11) changes nothing observable until 7a lands.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: `params`/`ctx` unused until 7a fills this in
export function prepareFlipParts(el: Element, params: EffectParams, ctx: PrepareContext): FlipParts {
  return { control: el.querySelector(':scope > .kui-flip-control'), cleanup: () => {} }
}
