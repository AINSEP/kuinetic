import type { Preset } from '../../core/types.js'

/**
 * Scroll-mechanics names. Eleven names over six primitives — the same alias-table shape the
 * entrance matrix uses, so adding a variant stays a data change.
 *
 * **Every name here declares `phase: 'idle'`.** This is the family the phase census flagged as
 * hardest, because "when does this hold the channel" does not obviously map onto a visitor
 * condition or a one-shot arrival the way an entrance or a gesture does — a scrub is driven by
 * scroll position, which is continuous, not a boolean the way `:hover` or `[aria-expanded]` is.
 * The question worth separating is *whether it changes* (yes, every frame) from *whether it ever
 * hands the channel back* (no, never, for as long as the instance lives), and it is the second one
 * `EffectPhase` actually asks.
 *
 * Every primitive in this file writes its claimed channel(s) **unconditionally from the moment it
 * activates** — `preparePin`'s `installSticky` sets `position: sticky` inline the instant `prepare`
 * runs, not the instant the element is actually in range; `prepareHorizontal`/`prepareMediaScrub`/
 * `prepareProgress`/`prepareScrollSpy` all start writing on the very first scroll frame, which for a
 * `load`-activated effect (their shared `defaultActivation`) is essentially immediately — and never
 * releases it until `destroy()` tears the instance down. That is a structurally different shape from
 * `state`: a `:hover`/drag/press effect writes *nothing at all* until the visitor's own action
 * starts it, which is what lets an entrance's one-shot fill resolve first and hand the channel to a
 * quiescent neighbour that has not spoken yet (`gestures/index.ts`'s `draggable` family is exactly
 * this — silent until `pointerdown`). A scroll effect never has that silent stretch: it is live from
 * the same instant an entrance would be trying to release into it, so treating them as taking turns
 * (`state`'s exemption) would be describing a truce that doesn't exist. "Runs unbounded, so it never
 * yields the channel at all" is `EffectPhase`'s own definition of `idle`, and `EffectInstance
 * .continuous`'s doc (`core/types.ts`) already names this exact set — "a pin, a scroll progress
 * track, a media scrub" — as the library's canonical unbounded, no-end effects. `idle` is that fact
 * restated as a composition phase, not a new claim.
 *
 * `scroll-spy` earns the same label by the same test even though it writes an *attribute* rather
 * than a style: `data-kui-active` moves between links continuously as sections cross the threshold,
 * with no moment where nothing is marked active and the channel is free.
 *
 * `smooth-scroll-to` and `scroll-snap-x`/`-y` are not wrapped in `continuousSetup` — they set one
 * declaration at `prepare` and are done, so the animator considers the *instance* finished
 * immediately. That is orthogonal to the question here: the declaration they wrote
 * (`scroll-behavior`, `scroll-snap-type`) stays applied inline for the instance's whole life exactly
 * like the continuous ones, never conditionally, never released early. A permanently-held static
 * write and a per-frame recomputed one both fail `state`'s test the same way.
 *
 * Declaring `idle` does not, in itself, open any new composition today — `INDEPENDENT_PHASES` in
 * `core/channels.ts` only exempts `entrance|state` and `exit|state`, and `idle` pairs with nothing,
 * itself included, which is the same outcome an undeclared phase already produced. What it changes
 * is the meaning of that outcome: these thirteen collide with a channel-sharing neighbour because
 * two effects are provably fighting over the same property at the same time (checked directly —
 * `horizontal-scroll` and any `translate`-writing entrance both actively write `translate` from the
 * moment the entrance would want to release, so there is no daylight to compose into), not because
 * nothing was known about them. `test/catalog-phase-mechanics.test.ts` asserts both halves of that:
 * the declaration is present, and a same-channel pair inside this family still correctly refuses.
 *
 * None of the eleven declares `transitions` — `phaseOf` (`core/compile.ts`) only ever *derives*
 * `state` from that field, so a preset carrying both would be duplicate, driftable data, and every
 * primitive here is `renderer: 'javascript'` with nothing rendered through a CSS `transition:` to
 * begin with.
 */
export const SCROLL_PRESETS: Preset[] = [
  // --- pinning ---------------------------------------------------------------------------
  // The default carries a spacer: a pin longer than its containing block silently does nothing,
  // and that is the single most common way authors get sticky wrong.
  { name: 'pin-section', primitive: 'pin', params: { distance: '100vh', spacer: 'true' }, phase: 'idle' },
  { name: 'pin-until', primitive: 'pin', params: { spacer: 'false' }, phase: 'idle' },
  { name: 'pin-spacer', primitive: 'pin', params: { spacer: 'true' }, phase: 'idle' },
  // Applied per card; each card sticks at its own offset and the stack builds up naturally.
  { name: 'stacking-cards', primitive: 'pin', params: { spacer: 'false' }, phase: 'idle' },

  // --- progress publishing ---------------------------------------------------------------
  { name: 'scroll-progress', primitive: 'scroll-progress', phase: 'idle' },
  { name: 'scrollytelling-step', primitive: 'scroll-progress', params: { steps: '4' }, phase: 'idle' },

  // --- travel ------------------------------------------------------------------------------
  { name: 'horizontal-scroll', primitive: 'horizontal-track', phase: 'idle' },

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
  {
    name: 'sequence-scrub',
    primitive: 'media-scrub',
    params: { spacer: 'true' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
  { name: 'video-scrub', primitive: 'media-scrub', requiresOwnSubtree: true, phase: 'idle' },

  // --- navigation --------------------------------------------------------------------------
  { name: 'scroll-spy', primitive: 'scroll-spy', phase: 'idle' },

  // --- native CSS passthroughs ---------------------------------------------------------------
  { name: 'smooth-scroll-to', primitive: 'smooth-scroll', phase: 'idle' },
  { name: 'scroll-snap-x', primitive: 'scroll-snap', params: { axis: 'x' }, phase: 'idle' },
  { name: 'scroll-snap-y', primitive: 'scroll-snap', params: { axis: 'y' }, phase: 'idle' },
]
