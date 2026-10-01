import { CHANNEL } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Preset,
  Primitive,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { DECK_PARAMETERS, prepareSpatialDeck } from './deck.js'
import { createRingFit } from './fit.js'
import type { Face } from './deck.js'
import { SPATIAL_STACK_PRIMITIVE, STACK_PRESETS } from './stack.js'

export { snapPosition } from './deck.js'

/**
 * A ring of children arranged in 3D space — the one shape nothing in the catalog could express.
 *
 * Every 3D name shipped before this (`card-flip-x`, `cube-rotate`, `book-page-turn`, `fold-panel`,
 * `flip-card`) rotates *one* element about its own centre. None of them arranges N elements
 * relative to each other, which is what a carousel, a cover-flow, a coverwheel, and a panorama all
 * are. That is a placement problem, not an animation problem, and it needs three facts CSS cannot
 * derive on its own: where each child sits on the ring, how many places the ring has, and where
 * between two places the ring currently is.
 *
 * All three already had names, or nearly did:
 *
 * - `--kui-offset` — "where one step sits relative to the live one, as a signed number of places
 *   *around a ring*" (`effects/step-marking.ts`). Written for this. Deliberately **not** `--kui-i`,
 *   which is stagger *rank* (`core/stagger.ts`): reverse or randomise a stagger and every card
 *   would teleport to a different place on the ring, because the timing order and the spatial order
 *   are not the same fact and only one of them is geometry.
 * - `--kui-item-count` — added to `createStepMarker` for this, beside the offset it makes usable.
 *   An offset is a place; a place needs a spacing; the spacing is `arc / count`.
 * - `--kui-step-position` — the continuous, fractional index a drag moves through, published beside
 *   the integer `--kui-step` the discrete controls move through. Both on the host, from one writer,
 *   so they can never disagree about where the ring is.
 *
 * With those, the geometry is a stylesheet (`src/css/carousel.css`) and this file is the index, the
 * marking, the controls, and the grab. Same division as `step-progress`, whose machinery it reuses
 * rather than restates.
 *
 * ## Why `--kui-step-position` and not `--kui-progress`
 *
 * `--kui-progress` was the name originally specified for the continuous position, and it is already
 * taken by something incompatible. `effects/scroll-mechanics/primitives.ts` writes it as a 0–1
 * scroll fraction, and `core/declarations.ts`'s `pinnedDelays` reads it as the *seek position of
 * every pinned animation on the element*:
 *
 *   animation-delay: calc(<delay> - var(--kui-progress, 0) * (<head>))
 *
 * Custom properties inherit. A ring publishing `2.4` into that name would hand every scrubbed
 * descendant a negative delay 2.4 heads long and hold it permanently past its own end — and a
 * carousel inside a pinned scroll section is the ordinary case, not a corner. So the continuous
 * position gets a name of its own. `--kui-step-position` says which of the two readings it is
 * (an absolute place, `2.4`, not a delta from somewhere, `0.4`), which was the objection to
 * `--kui-step-fraction`, without colliding with a live contract.
 *
 * ## The flattening trap
 *
 * `transform-style: preserve-3d` is silently defeated by a *grouping property* on the element that
 * carries it: CSS Transforms 2 §7.1 lists `overflow` other than `visible`/`clip`, `opacity` below 1,
 * a `filter`, a `clip-path`, `isolation: isolate`, a `mask`, a `mix-blend-mode`, and paint
 * containment. Any of those forces the used value to `flat`, the slots are painted in DOM order
 * into one plane, and the ring collapses into a row of overlapping cards with no depth at all.
 * Nothing errors and nothing warns natively. {@link warnFlattenedHost} names the property.
 *
 * It is the ring's own host that matters, never an ancestor. The host carries both `perspective`
 * and `preserve-3d` (see `carousel.css`), so it establishes its own 3D rendering context whatever
 * sits above it; an ancestor with `overflow: hidden`, `opacity` or a `filter` flattens only
 * itself, and the finished 3D ring is composited into it intact. An earlier version of this check
 * walked the ancestors and so warned on every ring inside a clipped band — the arrangement the
 * catalog recommends for a ring that bleeds off the page — while the rows plainly rendered in 3D.
 */

/** Half a turn away from the camera: past this the slot's own plane points backwards. */
const QUARTER_TURN_DEG = 90

/**
 * The grouping properties that flatten the host, each with the test for a flattening value.
 *
 * Checked against Chrome 153 by painting two overlapping cards 200px apart in depth, the far one
 * last in DOM order, and seeing which one shows. The list differs from the specification's in both
 * directions, and the browser is what the author is looking at:
 *
 * - `overflow: clip` flattens in Chrome although §7.1 exempts it, on either axis alone
 *   (`overflow-x: clip` too) — so `overflow` is "anything but visible", as for `hidden`/`auto`.
 * - `backdrop-filter` is not in §7.1 and flattens in Chrome.
 * - `contain: paint` (and `strict`) is in §7.1 and does *not* flatten in Chrome, so it is left out:
 *   a warning that the ring is flat, next to a ring that is visibly not, is worse than none.
 *
 * `clip` (the deprecated `rect()` one) and `mask-border-source` are left out as vanishingly rare.
 * The empty-string arm is the "this realm has no layout" answer (jsdom reports nothing for several
 * of these), not a value.
 */
const FLATTENING: readonly [string, (value: string) => boolean][] = [
  ['overflow', (value) => value !== '' && value !== 'visible'],
  ['clip-path', (value) => value !== '' && value !== 'none'],
  ['opacity', (value) => value !== '' && Number(value) < 1],
  ['filter', (value) => value !== '' && value !== 'none'],
  ['backdrop-filter', (value) => value !== '' && value !== 'none'],
  ['isolation', (value) => value === 'isolate'],
  ['mix-blend-mode', (value) => value !== '' && value !== 'normal'],
  ['mask-image', (value) => value !== '' && value !== 'none'],
]

/**
 * Warn when the ring's own host carries a property that flattens it.
 *
 * A dev-mode diagnostic, not a fix: the host is the author's element, and removing an
 * `overflow: hidden` they rely on to clip something else would trade a flat carousel for a broken
 * layout. Naming the property is the whole value, because the symptom ("the 3D does nothing")
 * gives no hint that a one-line rule on the same element is the cause.
 *
 * Read once, at prepare: an entrance that fades the host in flattens it only while it runs.
 *
 * @param el - The ring host.
 * @param ctx - Effect context, for the window (`getComputedStyle`) and the warning sink.
 * @complexity O(1) time — eight fixed properties; one forced style resolution.
 */
function warnFlattenedHost(el: Element, ctx: PrepareContext): void {
  const found = flatteningDeclaration(el, ctx)
  if (!found) return
  ctx.warn(
    `carousel: the ring's own <${el.localName}> has ${found.property}: ${found.value}, which ` +
      'flattens transform-style: preserve-3d — the ring will render as flat overlapping cards. ' +
      'Move that property to a wrapper around the ring: an ancestor does not flatten it.',
  )
}

/**
 * The first flattening declaration on one element, or `null`.
 *
 * `getComputedStyle` is reached through the injected window and optional-chained: a primitive can
 * be prepared against a document whose realm has no layout at all (`test/three-d.test.ts` calls
 * `prepare` with no element), and a diagnostic must never be the thing that throws.
 *
 * @complexity O(1) time — eight fixed properties; one forced style resolution.
 */
function flatteningDeclaration(
  node: Element,
  ctx: PrepareContext,
): { property: string; value: string } | null {
  const style = ctx.win.getComputedStyle?.(node)
  if (!style) return null
  for (const [property, flattens] of FLATTENING) {
    const value = style.getPropertyValue(property)
    if (flattens(value)) return { property, value }
  }
  return null
}

/**
 * Whether a slot at this ring angle has its own plane turned away from the camera.
 *
 * Pure and exported so the rule is assertable without a DOM or a layout. The angle is the slot's
 * signed place on the ring in degrees, already including the live-step drift.
 *
 * `>=` rather than `>` at exactly a quarter turn: a slot edge-on to the camera has zero projected
 * width, so it can only ever swallow a click that was aimed at something else. Calling it "back" is
 * the answer that costs nothing and removes the boundary case from the hit-testing question.
 *
 * @param angleDeg - Signed degrees from the camera-facing position.
 * @returns `'back'` when the slot's face points away, `'front'` otherwise.
 * @complexity O(1) time and space.
 */
export function faceAt(angleDeg: number): 'front' | 'back' {
  return Math.abs(normaliseDegrees(angleDeg)) >= QUARTER_TURN_DEG ? 'back' : 'front'
}

/**
 * Bring an angle onto `(-180, 180]`, the range where "how far from facing me" is a magnitude.
 *
 * Without it a slot at `+350deg` — which is 10 degrees from front — reads as further from the
 * camera than one at `+100deg`, and the whole back half of a large ring is mislabelled.
 *
 * @complexity O(1) time and space.
 */
export function normaliseDegrees(angleDeg: number): number {
  const wrapped = ((angleDeg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

const RING_PARAMETERS: ParameterSchema = {
  ...DECK_PARAMETERS,
  /*
   * A real CSS `<angle>`, not a normalised scalar.
   *
   * A designer specifies fifteen degrees; nobody specifies 0.375 of an unstated maximum. A
   * normalised knob also bakes taste into a coordinate — the maximum *is* an opinion about how much
   * tilt is too much, expressed as a unit — and it cannot be typed in the spelling the rest of the
   * attribute grammar uses (`0.05turn` is a legal angle and means something exact). Legibility is
   * still bounded, but the bound is applied to the angle, in `carousel.css`, where it is one
   * `clamp()` an author can see in devtools rather than a hidden rescale.
   *
   * Sign convention: **positive tilts the camera up and over the ring**, looking down at it. That
   * is the opposite sign from the `rotateX()` it compiles to — see `carousel.css` for the
   * derivation — and the inversion is deliberate: "18 degrees above" is the sentence a designer
   * says, and it should not be spelled `-18deg` because of which way a matrix happens to turn.
   */
  tilt: { type: 'angle', default: '0deg', cssProperty: '--kui-tilt' },
  /*
   * How far the ring spreads. `360deg` is a full ring; anything less is a slice.
   *
   * This is the parameter the concave name exists around. From the centre of a *full* ring most of
   * it is behind your head, so a 360-degree spread there is not a design choice but a way of hiding
   * two thirds of the content — the inside name defaults to a slice for that reason.
   */
  arc: { type: 'angle', default: '360deg', cssProperty: '--kui-arc' },
  /*
   * The ring's radius, or unset for one derived from the content.
   *
   * Empty default, not a number, and for the same reason `step-progress`'s `steps` is empty:
   * `readParams` fills every declared default in unconditionally, so an empty one is the only way
   * to tell "the author said nothing" from "the author said 320px". Unset, `carousel.css` computes
   * the circumradius of a regular polygon with this many sides and this much side length —
   * `(width + gap) / (2 * tan(step / 2))` — which is the arrangement where neighbours just touch.
   * Every consumer solving that by hand was the alternative, and they would all have solved it
   * differently.
   *
   * The width half of that has to come from JavaScript: CSS can compute with a measurement but
   * cannot take one. See `measureItem` in `deck.ts`.
   *
   * Authored or derived, a depth ring's radius is a ceiling: a ring that would push its page
   * sideways is pulled in exactly as far as it has to be (`fit.ts`, `--kui-ring-fit`), and one that
   * already fits — or sits inside an ancestor that clips it — keeps this radius to the pixel.
   */
  radius: { type: 'length', default: '', cssProperty: '--kui-radius' },
  /** Breathing room between neighbours, spent by the derived radius above. */
  gap: { type: 'length', default: '24px', cssProperty: '--kui-gap' },
  /** Camera distance. Shorter is a wider lens: more foreshortening, more drama, more distortion. */
  perspective: { type: 'length', default: '1600px', cssProperty: '--kui-perspective' },
  /*
   * Whether a slot keeps its own outward orientation, or turns to keep facing the viewer.
   *
   * `radial` is the ring's natural state and needs nothing: a slot placed by
   * `rotateY(θ) translateZ(R)` already faces outward along its own radius, which is why the live
   * one faces you. It is what you want for a cover-flow, and it is what makes the far side of the
   * ring read as the far side.
   *
   * `camera` counter-rotates each slot's *child* — never the slot itself; the placement transform
   * and the billboard have to stay on separate boxes or every later change to one silently
   * multiplies into the other — so text stays readable at every position, which is what a raised
   * camera needs. Costs one element of markup per slide; see `docs/catalog.md`.
   */
  facing: {
    type: 'keyword',
    default: 'radial',
    cssProperty: '--kui-facing',
    keywords: ['radial', 'camera'],
  },
  /*
   * Which plane the ring lies in: `depth` (the default — a carousel you look *at*, turning about a
   * vertical pole) or `screen` (a clock face, turning about the axis that points at you).
   *
   * ## Why a parameter of this primitive, and not a new one
   *
   * A flat ring of cards around a centred word is the same object as the 3D ring seen from its
   * pole: N slots, evenly spaced by `arc / count`, placed from `--kui-offset` and the shared drift,
   * advanced by the same drag, keys, controls and `spin:`. Every number this primitive publishes
   * means the same thing in both planes; only the three transform functions that turn a place into
   * a position differ, and those live in `carousel.css` anyway. A second primitive would have
   * duplicated the whole index to change one stylesheet rule and one face test.
   *
   * It is a parameter rather than only a name (unlike convex/concave, which differ in every
   * default and so earned two names) because the runtime has to know it: a flat slot is never
   * turned away from the viewer, so the quarter-turn face test that stops the back of a 3D ring
   * swallowing clicks would, on a clock face, disable every card in the bottom half. The name that
   * ships it, `carousel-orbit`, sets it; the stylesheet gates on the published attribute rather
   * than the name, so `carousel-3d plane:screen` is equally honoured — same rule as `facing:`.
   *
   * `facing:` keeps its meaning here. `radial` turns each card with the ring, top edge outward like
   * the numerals on a watch bezel; `camera` keeps every card upright. In the screen plane upright
   * needs no child counter-rotation at all — the slot is *translated* to its place on the circle
   * instead of rotated there — so it costs no extra markup, unlike the 3D billboard.
   */
  plane: {
    type: 'keyword',
    default: 'depth',
    cssProperty: '--kui-ring-plane',
    keywords: ['depth', 'screen'],
  },
}

/**
 * Drive a ring of children from one index.
 *
 * Everything shape-independent — the continuous position, the marking, the controls, the grab, the
 * motion — is `deck.ts`'s. What is the ring's is the face test and the two host attributes its
 * selectors branch on.
 *
 * @complexity O(n) per flip and per drag frame in the slot count; O(n) space in slots ever touched.
 */
function prepareSpatialRing(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const plane = params.text('plane', 'depth')
  // The flattening trap only exists for the 3D plane; a flat ring has no `preserve-3d` to defeat.
  if (plane === 'depth') warnFlattenedHost(el, ctx)
  const arcDeg = degreesOf(params.text('arc', '360deg'), 360)
  const faceOf = (place: number, _offset: number, count: number): Face =>
    plane === 'screen' ? 'front' : faceAt(place * (arcDeg / count))

  return prepareSpatialDeck(el, params, ctx, {
    id: 'spatial-ring',
    label: 'carousel',
    faceOf,
    /*
     * A derived radius needs a card width; a flat ring also needs a card's size to reserve its own
     * circle (the host is sized to it, since transformed slots take no layout space), so it measures
     * even when the author named a radius.
     */
    measure: params.text('radius') === '' || plane === 'screen',
    hostAttributes: {
      /*
       * `facing:` and `plane:` reach CSS as attributes, not only as the custom properties their
       * specs declare. A stylesheet cannot select on the *value* of a custom property — `@container
       * style(--kui-facing: camera)` can, and is not supported widely enough to hang a documented
       * parameter on — so the one thing a selector needs is published in the one form a selector
       * can read. Same pairing, for the same reason, as the number/attribute pair `step-marking.ts`
       * publishes for the ring place.
       */
      'data-kui-ring-facing': params.text('facing', 'radial'),
      'data-kui-ring-plane': plane,
    },
    /*
     * The fit to the page (`fit.ts`). Depth plane only: a flat ring already reserves and clamps to
     * its own square (`carousel.css`, `[data-kui-ring-plane='screen']`), and its cards never leave
     * the plane that square is measured in.
     */
    attach:
      plane === 'depth'
        ? (styles) =>
            createRingFit({
              el,
              ctx,
              styles,
              arcDeg,
              tiltParamDeg: degreesOf(params.text('tilt', '0deg'), 0),
              facing: params.text('facing', 'radial') === 'camera' ? 'camera' : 'radial',
            })
        : undefined,
  })
}

/**
 * An authored `<angle>` as a number of degrees.
 *
 * `params.ts` accepts every CSS angle unit and normalises only the bare/`d` spellings to `deg`, so
 * a value reaching here can legitimately be `0.05turn` or `1.2rad`. The stylesheet does not care —
 * it hands the token straight to `rotateY()` — but this file computes with it (to decide which
 * slots face away), and a `Number('0.05turn')` is `NaN`.
 *
 * Falls back rather than throwing on an unrecognised unit for the reason every reader in this
 * library does: the value has already been validated, so an unfamiliar spelling here means this
 * function is behind `params.ts`, and a ring that spreads over the default arc is a better answer
 * than one that throws during `prepare`.
 *
 * @param value - A validated CSS angle.
 * @param fallbackDeg - Used when the unit is not one this function converts.
 * @returns Degrees.
 * @complexity O(n) time in value length; O(1) space.
 */
export function degreesOf(value: string, fallbackDeg: number): number {
  const match = /^(-?[\d.]+)(deg|rad|turn|grad)?$/i.exec(value.trim())
  if (!match) return fallbackDeg
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return fallbackDeg
  switch ((match[2] ?? 'deg').toLowerCase()) {
    case 'rad':
      return (amount * 180) / Math.PI
    case 'turn':
      return amount * 360
    case 'grad':
      return amount * 0.9
    default:
      return amount
  }
}

/**
 * The ring primitive.
 *
 * `renderer: 'javascript'` and two channels together are the honest declaration: this file paints
 * nothing itself — it publishes numbers — but `carousel.css` does, and both of the things it writes
 * have to be declared or the conflict detector waves through a composition that silently loses one
 * effect's output.
 *
 * `skew` is this catalog's name for "claims the whole `transform` shorthand" (see `CHANNEL.skew` in
 * `core/types.ts`), which `carousel.css` writes on the elements this effect drives. The shorthand is
 * unavoidable here: three-dimensional placement needs `rotateX`/`rotateY`/`translateZ` composed in a
 * fixed order, and `rotate:`/`translate:` as individual properties are applied in the order the spec
 * fixes, which is the reverse of the one this geometry needs.
 *
 * `discrete` is `display`, and it is here for exactly the reason `card-toggle` declares it
 * (`effects/three-d/index.ts`): the unconditional host rule pins `display: grid` so every slot
 * starts from the same cell instead of flowing down the page as block siblings. That has nothing to
 * do with `catalog/discrete.ts`'s show/hide use of the same property, but `display` is tracked as
 * one channel whatever value is written into it — the point of the channel model is the physical
 * property, not the intent — so a ring composed with an `@starting-style` open/close effect is now
 * correctly reported as a collision rather than quietly letting one of the two win.
 *
 * `reducedMotion: 'shorten'`, not `'disable'`, for exactly the reason `step-progress` carries the
 * same note: under `disable` the animator never activates the instance, so no index is published,
 * no slot is marked, and the arrows do nothing. A visitor who asked for less motion would get a
 * dead widget rather than a calm one. Reduced motion suppresses the *travel* between places — which
 * `base.css`'s policy layer already does to the transition `carousel.css` declares — never the
 * function.
 */
export const SPATIAL_RING_PRIMITIVE: Primitive = {
  id: 'spatial-ring',
  renderer: 'javascript',
  channels: [CHANNEL.skew, 'discrete'],
  parameters: RING_PARAMETERS,
  supportedTimelines: ['time'],
  // `load`, not `enter`: a carousel that only wires its arrows once scrolled into view is broken,
  // not lazy — the same distinction `Primitive.defaultActivation` documents.
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareSpatialRing),
}

export const CAROUSEL_PRIMITIVES: Primitive[] = [SPATIAL_RING_PRIMITIVE, SPATIAL_STACK_PRIMITIVE]

/**
 * Convex and concave are two names, not one parameter with two values.
 *
 * They are one sign in the maths — `translateZ(+r)` puts the camera outside the ring,
 * `translateZ(-r)` puts it at the centre — and everything else about them differs. Outside, the far
 * half of the ring is content: smaller, dimmer, and part of the composition, and a full 360-degree
 * spread is right. Inside, the far half is *behind your head*, so a full spread hides most of the
 * deck and the sensible default is a slice; the cards nearest the edges of that slice are the ones
 * that need culling; and "next" moves the world past a fixed viewer rather than turning an object
 * in front of one.
 *
 * A `curve:` keyword would have made all of that one name's problem to explain, with half its
 * documentation prefixed by "unless". Two names each get their own defaults, their own rules in
 * `carousel.css`, and their own paragraph.
 *
 * `requiresOwnSubtree` on all of them: every rule in `carousel.css` past the host rule reaches the
 * slots, so a `target:` that relocated `data-kui-fx` onto one slot would leave those selectors
 * looking for grandchildren nobody authored. (The primitive declares a `target` parameter of its
 * own, so `compile.ts` never consults the flag — but `test/css-requires-own-subtree.test.ts`
 * re-derives the reaching set from the stylesheet and does, and the fact it records is true.)
 *
 * `phase: 'idle'` on all of them too, and for the same reason `target` does not change the answer:
 * `channelsFor`/`findConflicts` (`core/channels.ts`) reason about the channels *this preset
 * declares* on the host it is authored on (`CHANNEL.skew` and `'discrete'`, from
 * `SPATIAL_RING_PRIMITIVE`), not about which element in the subtree physically paints them — the
 * compiler has no notion of "the primitive's own target moved the real work three nodes down," and
 * does not need one here, because `requiresOwnSubtree` already keeps this preset off of anything
 * `target:` could relocate.
 *
 * The phase question itself is the same one `scroll-mechanics/presets.ts` answers at length:
 * `prepareSpatialRing` calls `render()` unconditionally during `prepare` — before any drag, before
 * any control click — which stamps `data-kui-step`/`--kui-step-position`/the per-slot face
 * attributes immediately, and the primitive's `defaultActivation` is `'load'`. So, like the scroll
 * primitives and unlike `gestures/index.ts`'s `draggable` (silent until `pointerdown`), a ring never
 * has a quiescent stretch for an entrance to release into — it claims `skew`/`discrete` from the
 * first frame and holds them, drag or no drag, until `destroy()`. That is `EffectPhase`'s `idle`:
 * "runs unbounded, so it never yields the channel at all." It buys nothing new by itself —
 * `INDEPENDENT_PHASES` exempts only `entrance|state` and `exit|state`, so `idle` still collides with
 * everything including another `idle`, which is correct: `carousel-3d, flip-in-x` really would fight
 * over the `transform` shorthand (`CHANNEL.skew`) for the ring's whole lifetime, and there is no
 * turn-taking to model. It replaces "nothing is known" with the actual, checked fact.
 *
 * None of them declares `transitions`: nothing here renders through a CSS `transition:` on the
 * host box for `phaseOf` to derive `state` from — the ring is `renderer: 'javascript'` throughout.
 */
export const CAROUSEL_PRESETS: Preset[] = [
  {
    name: 'carousel-3d',
    primitive: 'spatial-ring',
    params: { tilt: '12deg' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
  {
    name: 'carousel-3d-high',
    primitive: 'spatial-ring',
    params: { tilt: '30deg', perspective: '1200px' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
  {
    name: 'carousel-3d-low',
    primitive: 'spatial-ring',
    params: { tilt: '-18deg', perspective: '1800px' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
  /*
   * The concave name. `arc:120deg` is the default the outside names cannot want and this one cannot
   * do without: from the centre of a full ring, two thirds of the deck is behind the viewer.
   *
   * `facing:camera` too, because the reason to stand inside a ring is to read what is on it. A
   * radial slot at the edge of a 120-degree slice is turned 60 degrees away from the camera, which
   * is legible as a shape and not as text.
   */
  {
    name: 'carousel-3d-inside',
    primitive: 'spatial-ring',
    params: { arc: '120deg', facing: 'camera', perspective: '900px' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
  /*
   * The flat ring: cards on a clock face around whatever sits in the middle of the host (a word, a
   * logo — anything the `target:` does not name stays centred and off the ring). `plane:screen` is
   * the whole difference; see the parameter's note for why that is a parameter of this primitive and
   * not a new one.
   *
   * Named for what it does rather than which way it goes — `orbit` is the motion, and it has no
   * direction to name (the directional-naming rule, "named by travel", is about entrances that
   * *have* one; a ring's direction is the sign of `spin:`). Not `carousel-3d-*`, because it is not
   * three-dimensional, and a name that promised depth would send people looking for a `tilt:`.
   *
   * `facing:camera` by default: upright cards read as a set of things; radially turned ones read as
   * a dial, which is the less common ask and one keyword away.
   */
  {
    name: 'carousel-orbit',
    primitive: 'spatial-ring',
    params: { plane: 'screen', facing: 'camera' },
    requiresOwnSubtree: true,
    phase: 'idle',
  },
]

/**
 * Register the spatial carousel.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 */
export function registerCarousel(registry: Registry): Registry {
  return registry
    .registerPrimitives(CAROUSEL_PRIMITIVES)
    .registerPresets(CAROUSEL_PRESETS)
    .registerPresets(STACK_PRESETS)
}
