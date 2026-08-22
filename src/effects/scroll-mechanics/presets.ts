import type { Preset } from '../../core/types.js'

/**
 * Scroll-mechanics names. Eleven names over six primitives — the same alias-table shape the
 * entrance matrix uses, so adding a variant stays a data change.
 */
export const SCROLL_PRESETS: Preset[] = [
  // --- pinning ---------------------------------------------------------------------------
  // The default carries a spacer: a pin longer than its containing block silently does nothing,
  // and that is the single most common way authors get sticky wrong.
  { name: 'pin-section', primitive: 'pin', params: { distance: '100vh', spacer: 'true' } },
  { name: 'pin-until', primitive: 'pin', params: { spacer: 'false' } },
  { name: 'pin-spacer', primitive: 'pin', params: { spacer: 'true' } },
  // Applied per card; each card sticks at its own offset and the stack builds up naturally.
  { name: 'stacking-cards', primitive: 'pin', params: { spacer: 'false' } },

  // --- progress publishing ---------------------------------------------------------------
  { name: 'scroll-progress', primitive: 'scroll-progress' },
  { name: 'scrollytelling-step', primitive: 'scroll-progress', params: { steps: '4' } },

  // --- travel ------------------------------------------------------------------------------
  { name: 'horizontal-scroll', primitive: 'horizontal-track' },

  // --- media -------------------------------------------------------------------------------
  /*
   * `spacer` stays OFF here, deliberately, and it is worth knowing why before turning it on.
   *
   * A scrub is a hold, so making it carry its own spacer the way `pin-section` does looks like the
   * obvious way to delete the `.scrub-stage` wrapper a page otherwise hand-writes. It does delete
   * it — and then the scrub is measured against whatever the surrounding container happens to be,
   * because `geometrySource` escapes a sticky subtree by taking its parent. Measured on
   * `demo/scroll.html`: the parent starts 926px above the scrub against a 1817px distance, so
   * progress reached 51% before the element had even stuck, and half the sequence played off
   * screen. The wrapper was not ceremony; it was the tight box that made the parent honest.
   *
   * The fix is to stop tracking the parent and track the spacer, which is exactly `distance` tall
   * and moves with the content — no wrapper, no ambiguity. Until that lands, shipping the spacer
   * here would trade a wrapper for a silently mistimed scrub, which is the worse of the two.
   */
  { name: 'sequence-scrub', primitive: 'media-scrub' },
  { name: 'video-scrub', primitive: 'media-scrub' },

  // --- navigation --------------------------------------------------------------------------
  { name: 'scroll-spy', primitive: 'scroll-spy' },

  // --- native CSS passthroughs ---------------------------------------------------------------
  { name: 'smooth-scroll-to', primitive: 'smooth-scroll' },
  { name: 'scroll-snap-x', primitive: 'scroll-snap', params: { axis: 'x' } },
  { name: 'scroll-snap-y', primitive: 'scroll-snap', params: { axis: 'y' } },
]
