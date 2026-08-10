import type { Preset } from '../../core/types.js'

/**
 * Layout-transition names. Nine names over three primitives.
 *
 * The four `flip-*` names are the same primitive: what differs is why the children moved, and the
 * engine neither knows nor needs to. They exist as separate names because authors think in terms
 * of "I filtered a list", not "I mutated a child list".
 */
export const LAYOUT_PRESETS: Preset[] = [
  { name: 'flip-reorder', primitive: 'flip-container' },
  { name: 'flip-filter', primitive: 'flip-container' },
  { name: 'flip-sort', primitive: 'flip-container' },
  { name: 'flip-shuffle', primitive: 'flip-container' },
  // Cards changing aspect between layouts need their size interpolated, not just their position.
  { name: 'grid-to-list', primitive: 'flip-container', params: { scale: 'true' } },
  { name: 'masonry-reflow', primitive: 'flip-container' },
  { name: 'expand-to-modal', primitive: 'flip-container', params: { scale: 'true', duration: '500ms' } },

  { name: 'accordion-height', primitive: 'auto-height' },
  { name: 'tab-indicator-slide', primitive: 'flip-indicator', params: { duration: '300ms' } },
]
