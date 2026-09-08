import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Preset,
  Primitive,
  Renderer,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import type { Registry } from '../../core/registry.js'
import { deferPrepare } from '../../core/instances.js'
import { stylesheetTimingPrepare, withTimingContract } from '../shared.js'
import { supportsFineHover } from './interaction-shared.js'

/**
 * Cross-element pointer proximity — the Linear/Vercel/Raycast bento-grid glow: one light source,
 * with distance falloff, so cards *near* the cursor illuminate at their nearest edge without being
 * hovered themselves.
 *
 * The per-element case already exists (`cursor-spotlight`, `catalog/interaction.ts`): one card
 * tracks its own pointer position and glows while hovered. What is missing, and what this file
 * adds, is the *cross-element* case — a whole grid sharing one light — which needs a genuinely new
 * pattern: no pointer-tracked custom property exists anywhere in `src/` above the single-element
 * scope before this file.
 *
 * ### Two primitives, not one
 *
 * `group-dim`'s shape — one primitive on the container, its CSS reaching straight into `> *` — does
 * not fit here for a reason worth stating: `group-dim`'s children are plain, unregistered elements,
 * which is fine because nothing on them ever needs auditing (their `opacity` transition is the only
 * thing written there, and it is a physical property no other effect can reach). A ring painted on
 * a `::before` is different — `::before` is a *contended* box tracked across the whole catalog by
 * `pseudo-before`/`sweep` and audited by `test/css-composition-invariants.test.ts`'s pseudo-element
 * scan, and both of those mechanisms are keyed on `[data-kui-fx~='NAME']` compounds specifically.
 * Making the cards plain, unregistered `[data-kui-glow]`-style markers (the `group-dim`/
 * `hover-intent` shape) would put a pseudo-element-painting rule *outside* every invariant that
 * exists to catch a pseudo-element collision — an unaudited hazard with a real, findable bug behind
 * it (a card that also authors `border-draw` would silently fight over its own `::before`, with no
 * warning and no test that could ever see it, because the scanners require an `fx~=` compound to
 * find a rule at all).
 *
 * So each card stays a genuine, registered fx element — `data-kui="proximity-glow"` — fully visible
 * to every existing invariant, exactly like `cursor-spotlight` already is. The container gets a
 * second, distinct primitive, `proximity-field`, whose only job is tracking the pointer and
 * publishing two custom properties for `proximity-glow` to inherit. Splitting the tracker from the
 * paint is what keeps `proximity-glow` a "near no-op" registration — no listener of its own, pure
 * CSS reading inherited state, the same shape `hover-intent`/`masked-label-swap` use for their own
 * child boxes (`interaction-reveal.ts`), just inherited from an ancestor instead of set on the same
 * element.
 *
 * ### The cheap shape: two custom properties, zero per-frame JS, zero per-card math
 *
 * `proximity-field`'s `prepare` attaches exactly one `pointermove`/`pointerleave` listener to the
 * container and writes `--kui-proximity-x`/`-y` as the raw viewport coordinates
 * (`event.clientX`/`clientY`) — no rect subtraction, no spring, no `requestAnimationFrame`. Direct
 * 1:1 writes, the same choice `cursor-spotlight`'s own `prepareSpotlight` makes for the identical
 * reason: a light source lagging behind the cursor reads as broken, not smooth.
 *
 * Distance falloff *and* the cross-card illusion of one shared light both come from a single CSS
 * trick, not from any per-card computation: each card's `::before` ring reads those two properties
 * with `background-attachment: fixed`. A fixed-attachment background is positioned against the
 * *viewport*, not the element's own box — so painting the exact same `radial-gradient(... at var(
 * --kui-proximity-x) var(--kui-proximity-y) ...)` on every card, with no per-card offset math at
 * all, makes every card sample the identical viewport-space light. A card whose edge is near the
 * cursor shows the gradient's bright centre at that edge; a card whose whole box lies past the
 * gradient's finite radius shows only its transparent tail — falloff for free, from one shared
 * declaration, not from JavaScript measuring every card's `getBoundingClientRect()` on every move.
 *
 * Caveat worth recording rather than discovering later: `background-attachment: fixed` is measured
 * against the viewport only when nothing between the pseudo-element and the viewport establishes a
 * new containing block for fixed-position layout — a `transform`, `filter`, `perspective`, or
 * `will-change: transform` on an ancestor (a card also running `tilt-3d`, say) breaks the illusion
 * for that card specifically. Composing `proximity-glow` with a transform-heavy effect on the same
 * card or an ancestor of the grid is a case an author would have to notice visually; nothing here
 * can detect it.
 *
 * ### Ring, not wash — reusing `ambient.css`'s mask technique
 *
 * "Illuminate at their nearest edge" is an edge/rim treatment, not a full-surface tint, so this
 * reuses the exact `mask-composite: exclude` ring `ambient.css`'s `gradient-rotate-border`/
 * `gradient-border` and `interaction.css`'s `beam-border`/`border-draw` already ship: two full-size
 * mask layers, one inset by the ring's own thickness, composited `exclude` to leave only the
 * perimeter. Nothing new invented; the only new part is what paints *inside* the ring.
 *
 * ### Pseudo-element collision cost — computed before choosing `::before`
 *
 * `pseudo-before` (interaction.ts's `border-draw` comment carries the original cost comparison) is
 * shared today by `border-draw`, `beam-border`, `beam-border-auto`, `cursor-spotlight`. Joining that
 * token on `proximity-glow` costs exactly two things, both accounted for deliberately:
 *
 * - It newly **refuses** `proximity-glow` from composing with all four of those at compile time.
 *   That is the correct answer, not a loss: two ring/glow treatments occupying one card's `::before`
 *   is a genuine conflict, and refusing it with a named warning is strictly better than the two
 *   rules silently fighting over one box.
 * - It adds exactly **one** new line to `test/css-composition-invariants.test.ts`'s hand-maintained
 *   `pseudoElementCollisions` baseline: `redaction-reveal` (`catalog/text.ts`, a different cluster)
 *   is the one `::before` painter not yet on `pseudo-before`, so `proximity-glow + redaction-reveal`
 *   becomes a seventh *reachable* (compiler-permitted, unaudited-in-the-channel-model) collision —
 *   the same status `border-draw + redaction-reveal` already holds for the identical reason. Minting
 *   a brand-new token instead of joining `pseudo-before` would avoid that one line but would leave
 *   `proximity-glow` freely composable with `border-draw`/`beam-border`/`beam-border-auto`/
 *   `cursor-spotlight` — silently overlapping rings on one card, with no warning anywhere. Joining
 *   the existing token and adding the one honest line is the better trade.
 *
 * `proximity-field` itself paints nothing, so it costs nothing here; it carries its own channel
 * (`proximity`, declared empty in `test/support/channel-properties.ts`) purely so two of them can
 * never be composed on one element.
 */

/**
 * Track the pointer across a container and publish its position for every descendant
 * `proximity-glow` card to read.
 *
 * No-ops on a coarse pointer, the same guard every continuous pointer-tracking primitive in
 * `catalog/interaction.ts` uses — there is no "hover near" on a touchscreen.
 *
 * Deliberately no `focus`/`blur` handling, unlike `cursor-spotlight`'s per-element version. A
 * shared light source has no single natural "centre" to jump to for a keyboard user the way one
 * element's own midpoint is — this is decorative, pointer-only chrome, and a keyboard user simply
 * never sees the glow. Recorded here as a considered gap, not a silent one.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function prepareProximityField(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  if (!supportsFineHover(ctx.win)) return () => {}
  const node = el as HTMLElement

  function onMove(event: PointerEvent): void {
    ctx.style.set('--kui-proximity-x', `${event.clientX}px`)
    ctx.style.set('--kui-proximity-y', `${event.clientY}px`)
    ctx.style.set('--kui-proximity-opacity', '1')
  }
  function hide(): void {
    ctx.style.set('--kui-proximity-opacity', '0')
  }

  node.addEventListener('pointermove', onMove, { passive: true })
  node.addEventListener('pointerleave', hide, { passive: true })

  return () => {
    node.removeEventListener('pointermove', onMove)
    node.removeEventListener('pointerleave', hide)
  }
}

export const PROXIMITY_FIELD_PRIMITIVES: Primitive[] = [
  {
    id: 'proximity-field',
    renderer: 'javascript' as Renderer,
    // Paints nothing of its own; see the file comment for why this channel exists anyway.
    channels: ['proximity'],
    parameters: {},
    supportedTimelines: ['time', 'pointer'],
    supportedActivations: ['load', 'manual'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    // Continuous pointer tracking with no meaningful "shortened" form, the same policy
    // `catalog/interaction.ts`'s `pointerPrimitive` gives `tilt-3d`/`cursor-spotlight`/etc.
    reducedMotion: 'disable',
    prepare: withTimingContract(
      'proximity-field',
      {
        because:
          'it tracks pointer position continuously across a container, so it has no start moment ' +
          'and no fixed span',
      },
      deferPrepare(prepareProximityField),
    ),
  },
]

// `phase: 'state'`, declared rather than derived: this preset carries no `transitions` (it paints
// nothing itself), so an undeclared phase would resolve to *undeclared* — a real fifth state that
// conflicts with everything, not a permissive default (`compile.ts`'s `phaseOf`). Correct here on
// its own terms regardless: the container only publishes its two custom properties while the
// pointer is actually present, which is a response to a pointer state, not a clock that starts on
// arrival.
export const PROXIMITY_FIELD_PRESETS: Preset[] = [
  { name: 'proximity-field', phase: 'state', primitive: 'proximity-field' },
]

/**
 * `proximity-glow`'s knobs — every literal in its `interaction.css` ring rule, parametrised.
 *
 * `radius` and `width` are lengths rather than the `arc`/`softness` angle pair `beam-border` and
 * `border-draw` expose: those two describe *how much of a rotating ring* carries colour, which has
 * no meaning here — this ring is a static perimeter lit by a fixed-position gradient, not a
 * traveling arc. `outset` is the identical compensation `beam-border`/`border-draw` document at
 * length: an absolutely positioned pseudo-element resolves `inset` against its host's *padding*
 * box, so a bordered host would otherwise render the ring floating inside its own edge.
 */
const proximityGlowParams: ParameterSchema = {
  duration: { type: 'time', default: '200ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  color: { type: 'color', default: '', cssProperty: '--kui-proximity-glow-color' },
  radius: { type: 'length', default: '220px', cssProperty: '--kui-proximity-glow-radius' },
  width: { type: 'length', default: '1px', cssProperty: '--kui-proximity-glow-width' },
  outset: { type: 'length', default: '0px', cssProperty: '--kui-proximity-glow-outset' },
}

export const PROXIMITY_GLOW_PRIMITIVES: Primitive[] = [
  {
    id: 'proximity-glow',
    renderer: 'javascript' as Renderer,
    // `pseudo-before`: joins the existing `::before` ownership token rather than minting a new one
    // — see the file comment's cost analysis for exactly what that refuses and what it still leaves
    // reachable.
    channels: ['pseudo-before'],
    parameters: proximityGlowParams,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'paint',
    reducedMotion: 'shorten',
    prepare: stylesheetTimingPrepare('proximity-glow', {
      // `delay` refused by name: this ring is ambient chrome fed by an ancestor `proximity-field`,
      // not a response to its own trigger, so there is no start moment on *this* element to delay.
      honours: ['duration', 'ease'],
      because:
        'the ring is ambient chrome fed by an ancestor proximity-field and has no discrete start ' +
        'moment of its own to delay',
    }),
  },
]

// `phase: 'state'`, declared rather than derived, for the same reason `proximity-field` above
// declares it — and not via `transitions` instead: that field describes properties eased *on the
// preset's own host box*, and this ring's opacity lives on `::before`, the same shape
// `shine-sweep`/`underline-slide` already use (they also declare `phase: 'state'` explicitly in
// `HOVER_PRESETS` rather than through `transitions`, for the identical reason).
export const PROXIMITY_GLOW_PRESETS: Preset[] = [
  { name: 'proximity-glow', phase: 'state', primitive: 'proximity-glow' },
]

/** Both halves of the family, for `registerInteractionProximity` below. */
export const INTERACTION_PROXIMITY_PRIMITIVES: Primitive[] = [
  ...PROXIMITY_FIELD_PRIMITIVES,
  ...PROXIMITY_GLOW_PRIMITIVES,
]
export const INTERACTION_PROXIMITY_PRESETS: Preset[] = [
  ...PROXIMITY_FIELD_PRESETS,
  ...PROXIMITY_GLOW_PRESETS,
]

/**
 * Register the cross-element pointer-proximity family.
 *
 * A standalone top-level registration called directly from `catalog/index.ts`, the same shape
 * `registerInteraction`'s own doc comment describes for `registerGestures`/`registerThreeD` —
 * deliberately not folded into `interaction.ts`'s `INTERACTION_PRIMITIVES`/`_PRESETS`, which sits on
 * that file's own 400-line lint ceiling and is being edited by another session concurrently with
 * this one.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerInteractionProximity(registry: Registry): Registry {
  return registry
    .registerPrimitives(INTERACTION_PROXIMITY_PRIMITIVES)
    .registerPresets(INTERACTION_PROXIMITY_PRESETS)
}
