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
  { name: 'sequence-scrub', primitive: 'media-scrub' },
  { name: 'video-scrub', primitive: 'media-scrub' },

  // --- navigation --------------------------------------------------------------------------
  { name: 'scroll-spy', primitive: 'scroll-spy' },

  // --- native CSS passthroughs ---------------------------------------------------------------
  { name: 'smooth-scroll-to', primitive: 'smooth-scroll' },
  { name: 'scroll-snap-x', primitive: 'scroll-snap', params: { axis: 'x' } },
  { name: 'scroll-snap-y', primitive: 'scroll-snap', params: { axis: 'y' } },
]
