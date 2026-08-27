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
   * `spacer:true` is what deletes the `.scrub-stage` wrapper a page used to hand-write.
   *
   * It could not be switched on until the tracker stopped measuring against the parent. A scrub
   * makes itself sticky, and `geometrySource` escapes a sticky subtree by taking its parent — so
   * with the wrapper gone the scrub was measured against whatever section contained it. Measured
   * on `demo/scroll.html`: the parent started 926px above the scrub against a 1817px distance, so
   * progress reached 51% before the element had even stuck and half the sequence played off
   * screen. The wrapper was not ceremony; it was the tight box that made the parent honest.
   *
   * `trackProgress`'s `contentAnchor` is the fix. Progress is read from the spacer, which the
   * library inserts, is exactly `distance` tall, is never sticky, and moves with the content — so
   * there is no wrapper to write and nothing to disagree with.
   *
   * `video-scrub` stays off: a video positioned by the page is not asking the library for a box.
   */
  // `requiresOwnSubtree: true` on both — moot for `compile.ts`'s lift, since `media-scrub` already
  // declares its own `target` parameter and is never lifted at all (see `liftTarget`), but still
  // correct for `test/css-invariants.test.ts`'s generated scan, which derives the 16-name list from
  // `src/css/*.css` alone and does not know which primitives self-manage `target:`.
  { name: 'sequence-scrub', primitive: 'media-scrub', params: { spacer: 'true' }, requiresOwnSubtree: true },
  { name: 'video-scrub', primitive: 'media-scrub', requiresOwnSubtree: true },

  // --- navigation --------------------------------------------------------------------------
  { name: 'scroll-spy', primitive: 'scroll-spy' },

  // --- native CSS passthroughs ---------------------------------------------------------------
  { name: 'smooth-scroll-to', primitive: 'smooth-scroll' },
  { name: 'scroll-snap-x', primitive: 'scroll-snap', params: { axis: 'x' } },
  { name: 'scroll-snap-y', primitive: 'scroll-snap', params: { axis: 'y' } },
]
