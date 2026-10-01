import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { DECK_PARAMETERS, prepareSpatialDeck, SPATIAL_DECK_CHANNELS } from './deck.js'
import type { Face } from './deck.js'
import { wrapPlace } from './drag.js'

/**
 * A deck of cards receding diagonally into depth — the front card large and sharp, each one behind
 * it stepped up and to the side, smaller, softer and fainter — that cycles forward: the front card
 * leaves toward the viewer and the next one comes up to take its place.
 *
 * ## Why a primitive of its own, sharing the ring's deck
 *
 * The *index* is the ring's exactly: N slots, a live one, a signed place for every other, a real-
 * valued position a drag moves between two places, `next:`/`prev:`/`jump:`, the keyboard, `spin:`
 * and `autoplay:`. All of that is `deck.ts`, shared, so the two can never disagree about where a
 * deck is. What differs is not a parameter of the ring's shape but a different shape:
 *
 * - **It is linear, not circular.** A ring spaces its slots by `arc / count` and has no front or
 *   back in the index; a stack has a front, and the slots behind it are *further*, not *around*.
 *   Not one of the ring's seven geometry parameters (`tilt`, `arc`, `radius`, `gap`, `perspective`,
 *   `facing`, `plane`) means anything for it, and none of its six means anything for a ring.
 * - **It paints more channels.** Receding cards blur and fade, so a stack writes `filter` and
 *   `opacity` on its slots as well as `transform`. Declaring those on the ring primitive would have
 *   made every existing `carousel-3d` start colliding with any opacity or filter effect composed
 *   beside it — a behaviour change to four shipped names in order to add a fifth.
 *
 * So: one deck, two primitives, each declaring only its own geometry and its own channels.
 *
 * ## Which cards are showing
 *
 * The marker publishes circular offsets (`-N/2 … N/2`), which suits a ring. A stack reads them
 * shifted — `mod(offset + 1, N) - 1`, in `carousel.css` — onto `-1 … N-2`: the live card at 0,
 * `depth` cards visible behind it, and exactly one place *in front*, for the card that has just
 * left. The wrap from the front to the back therefore happens between `-1` (faded out in front)
 * and `N-2` (faded out behind), so a card being recycled never crosses the visible stack. With
 * fewer than `depth + 3` cards the back slot is still visible when it arrives, and the recycled card
 * fades in there as it lands, which is the honest limit of a short deck.
 */

/**
 * Whether a slot at this stack place is showing: in front of the fade-out behind the last visible
 * card, and not yet gone out past the viewer.
 *
 * Pure and exported so the boundaries are assertable without a DOM. Mirrors the opacity ramp in
 * `carousel.css`: a card that has left is gone by half a place in front, and the back of the stack
 * fades out over the one place past `depth`.
 *
 * @param offset - The slot's circular offset, as the marker published it.
 * @param drift - The deck's sub-step position past the live place.
 * @param count - The deck's size.
 * @param depth - How many cards show behind the front one.
 * @returns `'front'` while any of the card shows, `'back'` once none of it does.
 * @complexity O(1) time and space.
 */
export function stackFace(offset: number, drift: number, count: number, depth: number): Face {
  const ahead = stackPlace(offset, count) - drift
  return ahead > -0.5 && ahead < depth + 1 ? 'front' : 'back'
}

/**
 * A circular offset re-read as a place in the stack: `0` in front, `1…N-2` behind, `-1` just left.
 *
 * The JavaScript twin of `carousel.css`'s `mod(offset + 1, N) - 1`; the two must agree, and this is
 * the one the tests pin.
 *
 * @complexity O(1) time and space.
 */
export function stackPlace(offset: number, count: number): number {
  return wrapPlace(offset + 1, count) - 1
}

const STACK_PARAMETERS: ParameterSchema = {
  ...DECK_PARAMETERS,
  /*
   * How far each card behind the front one steps sideways. Positive is to the right, negative to
   * the left. A length rather than a percentage because the host reserves `depth × shift` of room
   * on that side (cards moved by a transform take no layout space) and a padding percentage would
   * resolve against a different box than a translate percentage does.
   */
  shift: { type: 'length', default: '48px', cssProperty: '--kui-stack-shift' },
  /** How far each card behind steps upward. Negative recedes downward instead. */
  rise: { type: 'length', default: '36px', cssProperty: '--kui-stack-rise' },
  /** Scale lost per place behind the front: `0.08` makes the third card back 76% size. */
  shrink: { type: 'number', default: '0.08', cssProperty: '--kui-stack-shrink', finite: true, minimum: 0, maximum: 0.3 },
  /** Blur added per place behind the front. The front card is always sharp. */
  blur: { type: 'length', default: '2px', cssProperty: '--kui-stack-blur' },
  /** Opacity lost per place behind the front. */
  fade: { type: 'number', default: '0.2', cssProperty: '--kui-stack-fade', finite: true, minimum: 0, maximum: 1 },
  /*
   * How many cards show behind the front one. The rest wait, hidden, at the back — `visibility`,
   * not only `opacity`, so a card nobody can see is also not a tab stop or a click target.
   */
  depth: { type: 'number', default: '3', cssProperty: '--kui-stack-depth', integer: true, minimum: 1, maximum: 8 },
}

/**
 * Drive a depth stack. All of the index is `deck.ts`'s; the stack contributes its face test.
 *
 * @complexity O(n) per flip and per frame in the slot count; O(n) space in slots ever touched.
 */
function prepareSpatialStack(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const depth = params.num('depth', 3)
  return prepareSpatialDeck(el, params, ctx, {
    id: 'spatial-stack',
    label: 'carousel-stack',
    faceOf: (place, offset, count) => stackFace(offset, offset - place, count, depth),
    placeOf: stackPlace,
    measure: false,
  })
}

/**
 * The stack primitive.
 *
 * `skew` for the `transform` shorthand (the scale and the diagonal step compose in one function
 * list), `opacity` and `filter` for the recession, `discrete` for the host's `display: grid` — the
 * same reasoning `SPATIAL_RING_PRIMITIVE` gives for its own pair, widened by what a stack paints.
 * `reducedMotion: 'shorten'` for the same reason as the ring: the deck must keep working, and the
 * policy layer already shortens the transition, while `deck.ts` starts any auto-motion paused.
 */
export const SPATIAL_STACK_PRIMITIVE: Primitive = {
  id: 'spatial-stack',
  renderer: 'javascript',
  // What `deck.ts` writes on the host: the cards (the subtree), the step index, the drag.
  channels: [CHANNEL.skew, 'discrete', CHANNEL.opacity, CHANNEL.filter, ...SPATIAL_DECK_CHANNELS],
  parameters: STACK_PARAMETERS,
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareSpatialStack),
}

/**
 * `carousel-stack` — the family name first, the shape second, as `carousel-fade`/`carousel-slide`/
 * `carousel-3d` already read. One name: the diagonal's direction is two signed lengths (`shift:`,
 * `rise:`), so a left-hand or downward stack is a parameter, not a catalogue entry. `requiresOwnSubtree`,
 * `phase: 'idle'` and `cloak: true` for the reasons `CAROUSEL_PRESETS` gives for the ring.
 */
export const STACK_PRESETS: Preset[] = [
  {
    name: 'carousel-stack',
    primitive: 'spatial-stack',
    requiresOwnSubtree: true,
    phase: 'idle',
    cloak: true,
  },
]
