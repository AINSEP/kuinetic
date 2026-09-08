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
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { AttributeLedger, StyleLedger } from '../../core/owned-styles.js'
import type { Registry } from '../../core/registry.js'
import { queryScoped, resolveTarget, SCOPE_PARAM, scopeParam } from '../../core/target.js'
import { createStepMarker } from '../step-marking.js'
import { countSteps, delegateControls, nextStep, prevStep } from '../forms/primitives.js'
import type { ControlGroup } from '../forms/primitives.js'
import { ALL_TIMING_TOKENS, mirrorTimingToCss, TRIGGER_DELAY_PARAM } from '../shared.js'
import { createRingDrag } from './drag.js'

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
 * ## The ancestor trap
 *
 * `transform-style: preserve-3d` is silently defeated by an ancestor with `overflow` other than
 * `visible`, a `clip-path`, `opacity` below 1, a `filter`, or a `backdrop-filter`: any of those
 * forces the subtree to be rendered into a flat plane first, and the ring collapses into a row of
 * overlapping cards with no depth at all. Nothing errors and nothing warns natively, which makes it
 * the single most likely bug report this effect will generate — a ring is exactly the thing people
 * put inside a modal, a drawer, or a clipped grid card. {@link warnFlatteningAncestor} walks up and
 * names the offender.
 */

/** Attribute this module owns on the host while a pointer is dragging the ring. */
const DRAGGING_ATTR = 'data-kui-ring-dragging'

/**
 * Attribute this module owns on each slot: whether it currently faces the camera.
 *
 * A published fact rather than a CSS derivation, because the question is "is this element's plane
 * turned more than a quarter turn away", and CSS has no way to branch on the sign or magnitude of a
 * `calc()`. `carousel.css` hangs `pointer-events` (and, for the concave name, `visibility`) on it.
 *
 * That matters for more than tidiness. A card turned away from the viewer still occupies its
 * projected screen rectangle for hit-testing purposes — `backface-visibility: hidden` stops it
 * *painting* but is not reliably a hit-testing rule, WebKit in particular — so the back of the ring
 * swallows clicks meant for the front of it. Publishing the fact is what lets one stylesheet rule
 * fix that at any ring size.
 */
const FACE_ATTR = 'data-kui-ring-face'

/** Half a turn away from the camera: past this the slot's own plane points backwards. */
const QUARTER_TURN_DEG = 90

/**
 * Properties on an ancestor that flatten a 3D subtree, and the value that is safe.
 *
 * Each entry is `[property, isFlattening]`. Written as a predicate per property rather than a set
 * of bad values because the three questions genuinely differ: `overflow` is "anything but visible",
 * `opacity` is a number comparison, and the two filters are "anything but none".
 */
const FLATTENING: readonly [string, (value: string) => boolean][] = [
  ['overflow', (value) => value !== '' && value !== 'visible'],
  ['clip-path', (value) => value !== '' && value !== 'none'],
  ['opacity', (value) => value !== '' && Number(value) < 1],
  ['filter', (value) => value !== '' && value !== 'none'],
  ['backdrop-filter', (value) => value !== '' && value !== 'none'],
]

/**
 * Walk the ancestors and warn about the first one that flattens the ring.
 *
 * A dev-mode diagnostic, not a fix: there is nothing this library can safely do about an ancestor
 * it does not own — removing a `overflow: hidden` a page relies on to clip something else would
 * trade a flat carousel for a broken layout. Naming the element is the whole value, because the
 * symptom ("the 3D does nothing") points at this effect and the cause is three levels up.
 *
 * Stops at the first offender rather than listing all of them: the first one already flattens
 * everything below it, so the rest are consequences of a page the author has yet to change.
 * Stops at `<body>` because the flattening properties are meaningless above it for this purpose and
 * a page-level `overflow-x: hidden` on `<html>`/`<body>` — which is on a large fraction of all
 * sites — would otherwise fire on every ring ever authored and train people to ignore the warning.
 *
 * @param el - The ring host.
 * @param ctx - Effect context, for the window (`getComputedStyle`) and the warning sink.
 * @complexity O(d) time in tree depth, once per instance; O(1) space.
 */
function warnFlatteningAncestor(el: Element, ctx: PrepareContext): void {
  const body = el.ownerDocument?.body ?? null
  let node = el.parentElement
  while (node && node !== body) {
    const found = flatteningDeclaration(node, ctx)
    if (found) {
      ctx.warn(
        `carousel: an ancestor <${node.localName}> has ${found.property}: ${found.value}, which ` +
          'flattens transform-style: preserve-3d — the ring will render as flat overlapping ' +
          'cards. Move the ring out of it, or drop that property on the ancestor.',
      )
      return
    }
    node = node.parentElement
  }
}

/**
 * The first flattening declaration on one element, or `null`.
 *
 * Split out from the walk above so each has one job — "which ancestor" and "is this one guilty" —
 * and so the guilt test is a pure-ish lookup that a fake `getComputedStyle` can drive directly.
 *
 * `getComputedStyle` is reached through the injected window and optional-chained: a primitive can
 * be prepared against a document whose realm has no layout at all (`test/three-d.test.ts` calls
 * `prepare` with no element), and a diagnostic must never be the thing that throws.
 *
 * @complexity O(1) time — five fixed properties; one forced style resolution.
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

/** Every per-slot ledger this instance has ever written, so teardown gives each element back. */
interface SlotLedgers {
  attributes: Map<Element, AttributeLedger>
  styles: Map<Element, StyleLedger>
}

/**
 * The ledger pair for one slot, created on first write.
 *
 * Memoised per element for the reason `LedgerSet` is (`core/owned-styles.ts`): a second ledger over
 * an element the first has already written to would snapshot *this instance's* values as the
 * author's own and "restore" to them.
 *
 * @complexity O(1) amortised time; O(n) space in slots ever touched.
 */
function ledgersFor(store: SlotLedgers, node: Element): { attributes: AttributeLedger; styles: StyleLedger } {
  let attributes = store.attributes.get(node)
  if (!attributes) {
    attributes = createAttributeLedger(node)
    store.attributes.set(node, attributes)
  }
  let styles = store.styles.get(node)
  if (!styles) {
    styles = createStyleLedger(node)
    store.styles.set(node, styles)
  }
  return { attributes, styles }
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

/**
 * Where the ring's continuous position rounds to, and how far past it the ring currently sits.
 *
 * The pair the stylesheet needs and the reason both tokens are published rather than one: the
 * integer decides which slot is *live* (and therefore what `--kui-offset` means for every other
 * slot), and the remainder is the sub-step rotation on top of it. Re-snapping the integer whenever
 * the remainder passes a half step is what keeps the remainder inside ±0.5, so the ring never has
 * to travel back across the whole strip to wrap from the last slide to the first — the same
 * property `circularOffset` gives the discrete case.
 *
 * @param position - Continuous ring position, in places. May be negative or beyond the count.
 * @param total - How many places the ring has.
 * @returns The live integer step, wrapped into range, and the signed remainder in `[-0.5, 0.5)`.
 * @complexity O(1) time and space.
 */
export function snapPosition(position: number, total: number): { step: number; drift: number } {
  if (total <= 0) return { step: 0, drift: 0 }
  const nearest = Math.round(position)
  return { step: ((nearest % total) + total) % total, drift: position - nearest }
}

const RING_PARAMETERS: ParameterSchema = {
  duration: { type: 'time', default: '620ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'cubic-bezier(0.22, 1, 0.36, 1)', cssProperty: '--kui-ease' },
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
   * cannot take one. See `measureItemWidth`.
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
  /** Whether a pointer can spin the ring by hand. */
  grab: { type: 'keyword', default: 'true', cssProperty: '--kui-grab', keywords: ['true', 'false'] },
  /*
   * How far the pointer travels, in pixels, to move the ring one place.
   *
   * A pixels-per-step mapping rather than pixels-per-degree, because a step is the unit everything
   * else here is in — the index, the offset, the snap — and a degree is not: the same drag would
   * move a six-item ring one place and a sixty-item ring ten, purely because the spacing changed.
   */
  travel: { type: 'number', default: '220', cssProperty: '--kui-travel', finite: true, minimum: 1 },
  /** Which elements sit on the ring. Unset means this element's own children. */
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  /** Optional controls, resolved exactly as `step-progress` resolves its own. */
  next: { type: 'text', default: '', cssProperty: '--kui-next' },
  prev: { type: 'text', default: '', cssProperty: '--kui-prev' },
  jump: { type: 'text', default: '', cssProperty: '--kui-jump' },
  scope: SCOPE_PARAM,
}

/**
 * Publish a measured slot width so the derived radius has a side length to work from.
 *
 * The one thing in the geometry that cannot be a stylesheet. `auto` radius needs the width of a
 * card, and CSS can spend a measurement (`var(--kui-item-width)`) but cannot take one.
 *
 * Measured on the first slot rather than the widest, and re-measured on every re-render rather than
 * watched: a ring of differently-sized cards has no single side length anyway, and the number is
 * only ever an input to a default that an explicit `radius:` overrides. Watching every slot with a
 * `ResizeObserver` to keep a default honest would be a per-frame cost for a value nobody looks at
 * once they have set their own.
 *
 * Skipped entirely when the author set `radius:` — nothing reads the property then, and measuring
 * forces a layout flush.
 *
 * @complexity O(1) time; one forced layout read per call.
 */
function measureItemWidth(styles: StyleLedger, slots: Iterable<Element>): void {
  for (const slot of slots) {
    const width = (slot as HTMLElement).offsetWidth
    if (width > 0) styles.set('--kui-item-width', `${width}px`)
    return
  }
}

/**
 * Drive a ring of children from one index.
 *
 * Reuses `step-progress`'s marking, counting and control delegation wholesale — the index half of a
 * carousel is the same problem whether the slides sit in a row or on a ring, and `createStepMarker`
 * was extracted precisely so a second consumer would not re-derive it. What is new here is the
 * continuous position, the measurement, the face marking, and the grab.
 *
 * @complexity O(n) per flip and per drag frame in the slot count; O(n) space in slots ever touched.
 */
// Factory closing over one ring's index state: several small named closures plus wiring, in the
// same shape (and for the same reason) as `core/gesture.ts`'s `recognise`.
// eslint-disable-next-line max-lines-per-function
function prepareSpatialRing(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  warnFlatteningAncestor(el, ctx)
  // Only the `key:value` spelling of a timing token reaches CSS on its own — `pushTrack` writes the
  // positional tokens for `css-keyframes` primitives and no others, and this one renders through
  // JavaScript. Without this, `carousel-3d 900ms` would travel at the 620ms default while
  // `carousel-3d duration:900ms` worked, which is the failure `mirrorTimingToCss` exists for.
  mirrorTimingToCss('spatial-ring', ALL_TIMING_TOKENS, params, ctx)

  const selector = resolveTarget(params.text('target'), ctx, 'carousel')
  const scope = scopeParam(params, 'self')
  const resolveSlots = (): Iterable<Element> =>
    selector ? queryScoped(el, ctx, selector, scope) : el.children
  const marker = createStepMarker(resolveSlots, (message) => ctx.warn(`carousel ${message}`))
  const total = (): number => countSteps(params, resolveSlots)

  const hostAttributes = createAttributeLedger(el)
  const hostStyles = createStyleLedger(el)
  /*
   * `facing:` reaches CSS as an attribute, not only as the `--kui-facing` custom property its spec
   * declares. A stylesheet cannot select on the *value* of a custom property — `@container
   * style(--kui-facing: camera)` can, and is not supported widely enough to hang a documented
   * parameter on — so the one thing a selector needs is published in the one form a selector can
   * read. Same pairing, for the same reason, as the number/attribute pair `step-marking.ts`
   * publishes for the ring place.
   */
  hostAttributes.set('data-kui-ring-facing', params.text('facing', 'radial'))
  const slots: SlotLedgers = { attributes: new Map(), styles: new Map() }
  const derivesRadius = params.text('radius') === ''

  /*
   * The ring's position, in places, as a real number. The integer index everything else keys off is
   * derived from it rather than stored beside it — two numbers that must agree is a bug waiting for
   * a drag to interrupt a click, and `snapPosition` is the one place that relationship lives.
   */
  let position = 0

  const arcDeg = degreesOf(params.text('arc', '360deg'), 360)

  const render = (): void => {
    const count = total()
    const { step, drift } = snapPosition(position, count)
    hostAttributes.set('data-kui-step', String(step))
    hostStyles.set('--kui-step', String(step))
    /*
     * The continuous position is published *relative to the live step*, not as the raw running
     * total: `position` grows without bound across a long drag, and a ring at place 41.4 of six
     * slides is at the same place as one at 5.4. Rebasing here is what keeps the number a fact
     * about the ring rather than about how long someone has been spinning it, and it keeps the
     * value CSS subtracts (`--kui-step-position - --kui-step`) inside half a place either way.
     */
    hostStyles.set('--kui-step-position', (step + drift).toFixed(4))
    marker.mark(step)

    const slotNodes = [...resolveSlots()]
    if (derivesRadius) measureItemWidth(hostStyles, slotNodes)
    // Read back off the marker's own output rather than recomputed from each node's position: the
    // marker numbers per parent group and wraps per group, and a second numbering here would be a
    // second answer to "which place is this" that could disagree with the one CSS is placing from.
    const spacing = count > 0 ? arcDeg / count : arcDeg
    for (const node of slotNodes) {
      const offset = Number(node.getAttribute('data-kui-step-offset') ?? '0')
      const angle = (offset - drift) * spacing
      ledgersFor(slots, node).attributes.set(FACE_ATTR, faceAt(angle))
    }
  }

  const goTo = (next: number): void => {
    position = next
    render()
  }

  const groups: ControlGroup[] = []
  const bindControl = (param: string, run: ControlGroup['run']): boolean => {
    const control = resolveTarget(params.text(param), ctx, `carousel ${param}`)
    if (!control) return false
    if (queryScoped(el, ctx, control, scope).length === 0) {
      ctx.warn(`carousel ${param} "${control}" matched nothing`)
    }
    groups.push({ selector: control, run })
    return true
  }

  /*
    * Unlike `step-progress` there is no click-the-container fallback for naming a control to
    * retire, so nothing here needs to know whether any were named. This container is *grabbable*: a
    * press on it is the opening of a possible drag, and advancing the ring on that press as well
    * would mean every abandoned drag also stepped it.
    */
  bindControl('next', () => goTo(nextStep(snapPosition(position, total()).step, total())))
  bindControl('prev', () => goTo(prevStep(snapPosition(position, total()).step, total())))
  bindControl('jump', (_node, at) => { if (at >= 0) goTo(at) })
  const releaseControls = delegateControls({ el, ctx, scope, groups })

  const releaseDrag = createRingDrag({
    el,
    ctx,
    enabled: params.is('grab'),
    travelPx: params.num('travel', 220),
    total,
    positionOf: () => position,
    moveTo: goTo,
    setDragging: (dragging) => hostAttributes.set(DRAGGING_ATTR, String(dragging)),
  })

  render()

  return () => {
    releaseDrag()
    releaseControls()
    marker.restore()
    for (const ledger of slots.attributes.values()) ledger.restore()
    for (const ledger of slots.styles.values()) ledger.restore()
    slots.attributes.clear()
    slots.styles.clear()
    hostAttributes.restore()
    hostStyles.restore()
  }
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

export const CAROUSEL_PRIMITIVES: Primitive[] = [SPATIAL_RING_PRIMITIVE]

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
 * None of the four declares `transitions`: nothing here renders through a CSS `transition:` on the
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
]

/**
 * Register the spatial carousel.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 */
export function registerCarousel(registry: Registry): Registry {
  return registry.registerPrimitives(CAROUSEL_PRIMITIVES).registerPresets(CAROUSEL_PRESETS)
}
