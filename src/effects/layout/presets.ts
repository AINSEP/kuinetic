import type { Preset } from '../../core/types.js'

/**
 * Layout-transition names. Nine names over three primitives.
 *
 * The four `flip-*` names are the same primitive: what differs is why the children moved, and the
 * engine neither knows nor needs to. They exist as separate names because authors think in terms
 * of "I filtered a list", not "I mutated a child list".
 *
 * Phase (see `EffectPhase`, `core/channels.ts`): eight of these nine are deliberately left
 * unphased, and that was checked against the actual mechanism rather than assumed from "FLIP looks
 * like an entrance."
 *
 * `flip-container` (the seven `flip-*`/`grid-to-list`/`masonry-reflow`/`expand-to-modal` names) and
 * `auto-height` genuinely *do* release the channels they animate: `flip.ts`'s `runDeltas` and
 * `primitives.ts`'s `animateHeight` both compile `fill: delay > 0 ? 'backwards' : 'none'` — never
 * `'forwards'`/`'both'` — so once a reorder or a height tween finishes, the Web Animation's
 * contribution is gone and the element's `translate`/`scale`/`height` reads whatever the DOM's own
 * layout or the page's own stylesheet says next. Nothing here holds a rest value the way
 * `gestures.ts`'s `draggable` does. That is exactly the `entrance` shape ("plays once from a
 * displaced from-state, then yields the channel") — but it cannot be declared `entrance`, because
 * that value's contract in this catalog is narrower than the English word: `test
 * /composition-phase.test.ts` asserts, catalog-wide, that every `phase: 'entrance'` preset backs
 * onto a real `@keyframes` block with no closing `to`/`100%` step, to prove the release is real.
 * These primitives are `renderer: 'javascript'` and animate through ad hoc `Element.animate()`
 * calls built at runtime — there is no `@keyframes kui-flip-reorder` (or `-accordion-height`) in
 * any shipped stylesheet for that test to find, so declaring `entrance` here would fail an
 * off-limits invariant rather than extend it. None of the other three values fit either: not
 * `idle` (every run is bounded — `deltas.length === 0` even short-circuits to a no-op), not `state`
 * (nothing is held between calls to persist), not `exit` (nothing departs; a reorder settles back
 * into a normal, still-visible layout position). Left unphased, these eight keep conflicting with
 * a same-channel neighbour exactly as they did before this change — a real gap, but the one the
 * mechanism actually supports today rather than a value chosen to make the enum feel complete.
 *
 * `tab-indicator-slide` (`flip-indicator`) is the one exception, and the reason is a real
 * difference in the primitive, not a different reading of the same one. `prepareIndicator` writes
 * the indicator's landing spot with `ctx.style.set('translate', ...)` — a **persistent** inline
 * style — before it ever calls `engine.play()`; the FLIP animation only smooths the visible trip
 * between the old inline value and the new one, and hands back to that same persisted inline style
 * on finish (fill: none resolves to identity, which is "no offset from the inline value already
 * written"). So the rest state genuinely is held, between moves, by an inline write the same way
 * `draggable`'s drop position is — the exact `state` shape `gestures/index.ts` established, just
 * driven by "the followed target changed" instead of a pointer.
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
  {
    name: 'tab-indicator-slide',
    primitive: 'flip-indicator',
    params: { duration: '300ms' },
    phase: 'state',
  },
]
