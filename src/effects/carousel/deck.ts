import type { Cleanup, EffectParams, ParameterSchema } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { AttributeLedger, StyleLedger } from '../../core/owned-styles.js'
import { queryScoped, resolveTarget, SCOPE_PARAM, scopeParam } from '../../core/target.js'
import { createStepMarker } from '../step-marking.js'
import { countSteps, delegateControls, nextStep, prevStep } from '../forms/primitives.js'
import type { ControlGroup } from '../forms/primitives.js'
import { ALL_TIMING_TOKENS, mirrorTimingToCss, TRIGGER_DELAY_PARAM } from '../shared.js'
import { createRingDrag, wrapPlace } from './drag.js'
import { clampPeriod, createAutoMotion } from './motion.js'

/**
 * The spatial deck: the index, the continuous position, the controls, the grab and the auto-motion
 * that every carousel in this folder shares, whatever shape it lays its slides out in.
 *
 * Extracted from what was `prepareSpatialRing` when a second shape arrived. The ring (`index.ts`)
 * and the depth stack (`stack.ts`) differ in exactly two things — the stylesheet that turns
 * `--kui-offset` and `--kui-step-position` into places, and which slots count as presented to the
 * viewer — and agree on everything else: one real-valued position both a drag and a click move,
 * the integer step derived from it, the marking, `next:`/`prev:`/`jump:`/`pause:`, the keyboard,
 * `spin:` and `autoplay:`. Two primitives each owning a copy of that would be two answers to "where
 * is the deck" that could drift apart, which is the bug this file's single `position` exists to
 * make impossible. So the shape is a {@link DeckLayout} handed in, and the rest lives here once.
 */

/** Attribute this module owns on the host while a pointer is dragging the deck. */
export const DRAGGING_ATTR = 'data-kui-ring-dragging'

/**
 * Attribute this module owns on the host while frames — not the stylesheet — are moving the deck.
 *
 * The CSS transition that eases a click from one place to the next is exactly wrong under a spin:
 * each frame retargets it, so the deck trails its own position by the transition's length and
 * visibly accelerates out of every pause. Same reason, same fix, as {@link DRAGGING_ATTR}: while it
 * is `true` the stylesheet suspends the transition, and the moment a person takes over it comes
 * back, so their click still travels.
 */
export const SPINNING_ATTR = 'data-kui-ring-spinning'

/**
 * Attribute this module owns on each slot: whether the layout currently presents it to the viewer.
 *
 * A published fact rather than a CSS derivation, because it is a branch on the sign or magnitude of
 * a `calc()`, which CSS cannot take. The ring answers it with "is this slot's plane turned more
 * than a quarter turn away" (`faceAt`); the stack with "has it left the visible depth". The
 * stylesheet hangs `pointer-events` on it for every shape, and `visibility` where a hidden slot
 * must also leave the tab order.
 *
 * That matters for more than tidiness. A card turned away from the viewer still occupies its
 * projected screen rectangle for hit-testing purposes — `backface-visibility: hidden` stops it
 * *painting* but is not reliably a hit-testing rule, WebKit in particular — so the back of a ring
 * swallows clicks meant for the front of it. Publishing the fact is what lets one stylesheet rule
 * fix that at any deck size.
 */
export const FACE_ATTR = 'data-kui-ring-face'

export type Face = 'front' | 'back'

/**
 * Attribute this module sets on a slot for exactly one style resolution, when its offset wrapped.
 *
 * `--kui-offset` is circular, so on every step one slot is re-numbered from one end of the deck to
 * the other: on a full ring its angle jumps by a whole turn (`-180deg` to `+180deg`) while its place
 * on screen does not move at all. A transition interpolates the number, not the place, so that card
 * would sweep the long way round, across the front of every other card, on every click. The flag
 * suspends its transition (`carousel.css`), the style is resolved once with it present so the jump
 * is committed without a transition, and the flag is removed in the same task — nothing ever sees
 * it, and the next change to that slot transitions normally.
 */
export const WRAP_ATTR = 'data-kui-ring-wrap'

/**
 * Force a style resolution of `node` and return what it resolved to.
 *
 * Returned rather than discarded so the read is a value the caller could use, not a statement with
 * no effect — the same shape as `showcase/modal-shell.ts`'s `forceReflow`. Optional-chained for a
 * realm with no layout, where it returns `undefined` and commits nothing.
 *
 * @complexity O(1) calls; the style recalculation it triggers is the browser's.
 */
function commitStyle(win: Window, node: Element): string | undefined {
  return win.getComputedStyle?.(node).transform
}

/**
 * Whether a slot's offset moved further than any real step can: it wrapped round the deck.
 *
 * A step moves every offset by one place (a jump by at most half the deck, because offsets are
 * circular); only a re-numbering from one end to the other moves one by more than half. Pure and
 * exported so the threshold is assertable without a DOM.
 *
 * @complexity O(1) time and space.
 */
export function offsetWrapped(previous: number, next: number, count: number): boolean {
  return Math.abs(next - previous) > count / 2
}

/**
 * Where the deck's continuous position rounds to, and how far past it the deck currently sits.
 *
 * The pair the stylesheet needs and the reason both tokens are published rather than one: the
 * integer decides which slot is *live* (and therefore what `--kui-offset` means for every other
 * slot), and the remainder is the sub-step motion on top of it. Re-snapping the integer whenever
 * the remainder passes a half step is what keeps the remainder inside ±0.5, so the deck never has
 * to travel back across the whole strip to wrap from the last slide to the first — the same
 * property `circularOffset` gives the discrete case.
 *
 * @param position - Continuous position, in places. May be negative or beyond the count.
 * @param total - How many places the deck has.
 * @returns The live integer step, wrapped into range, and the signed remainder in `[-0.5, 0.5)`.
 * @complexity O(1) time and space.
 */
export function snapPosition(position: number, total: number): { step: number; drift: number } {
  if (total <= 0) return { step: 0, drift: 0 }
  const nearest = Math.round(position)
  return { step: ((nearest % total) + total) % total, drift: position - nearest }
}

/**
 * The parameters every spatial deck takes, whatever its shape.
 *
 * Spread into each primitive's schema so the controls, the grab and the motion are spelled — and
 * documented — once.
 */
export const DECK_PARAMETERS: ParameterSchema = {
  duration: { type: 'time', default: '620ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'cubic-bezier(0.22, 1, 0.36, 1)', cssProperty: '--kui-ease' },
  /** Whether a pointer can move the deck by hand. */
  grab: { type: 'keyword', default: 'true', cssProperty: '--kui-grab', keywords: ['true', 'false'] },
  /*
   * How far the pointer travels, in pixels, to move the deck one place.
   *
   * A pixels-per-step mapping rather than pixels-per-degree, because a step is the unit everything
   * else here is in — the index, the offset, the snap — and a degree is not: the same drag would
   * move a six-item ring one place and a sixty-item ring ten, purely because the spacing changed.
   */
  travel: { type: 'number', default: '220', cssProperty: '--kui-travel', finite: true, minimum: 1 },
  /** Which elements are the slides. Unset means this element's own children. */
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  /** Optional controls, resolved exactly as `step-progress` resolves its own. */
  next: { type: 'text', default: '', cssProperty: '--kui-next' },
  prev: { type: 'text', default: '', cssProperty: '--kui-prev' },
  jump: { type: 'text', default: '', cssProperty: '--kui-jump' },
  /*
   * A control that pauses and resumes `spin:`/`autoplay:`, resolved like the three above.
   *
   * The library does not invent the button, unlike `slideshow`, which builds its own chrome: every
   * other control on this deck is the author's markup, and a pause button that appeared from
   * nowhere beside arrows the page styled itself would be the one control that did not match. It
   * gets `aria-pressed` (true while paused) so it announces as the toggle it is. Moving content that
   * starts on its own and runs past five seconds needs a way to stop it (WCAG 2.2.2); hover and
   * keyboard focus already pause, and this is the control for everyone else.
   */
  pause: { type: 'text', default: '', cssProperty: '--kui-pause' },
  /*
   * Continuous rotation: how long one full cycle of the deck takes. `0s` is off.
   *
   * A period rather than a speed because a period is what a designer can picture ("one turn every
   * forty seconds") and it is a `time`, which the attribute grammar already reads, clamps and
   * documents. A full cycle is every slide passing once — one revolution of a full ring — so adding a
   * card does not change how fast the ring turns. **Negative runs the other way**: `spin:-40s`. A
   * signed value rather than a `direction:` keyword so one row can say everything about its motion
   * in one token, which is what three rows at three speeds on one page want.
   */
  spin: { type: 'time', default: '0s', cssProperty: '--kui-spin' },
  /*
   * Stepped motion: how long the deck rests on each slide before moving to the next. `0s` is off.
   *
   * The `slideshow` model — a timer pressing "next", with the stylesheet's own transition doing the
   * travel — and its two-second floor. Negative steps backwards. When both are set `spin:` wins,
   * because a deck cannot be both gliding and resting.
   */
  autoplay: { type: 'time', default: '0s', cssProperty: '--kui-autoplay' },
  scope: SCOPE_PARAM,
}

/** What a deck's shape contributes; everything else is shared. */
export interface DeckLayout {
  /** The primitive's id: names the mirrored timing properties (`--kui-<id>-duration`). */
  id: string
  /** Prefix for warnings, the word an author would recognise. */
  label: string
  /** Whether a slot at this place is presented to the viewer. `place` is `offset - drift`. */
  faceOf(place: number, offset: number, count: number): Face
  /**
   * The shape's own reading of a circular offset, when it is not the offset itself.
   *
   * Only used to spot a wrap ({@link WRAP_ATTR}): a slot wraps where *its shape's* numbering jumps,
   * which for a ring is at the circular seam and for a stack is between "just left" and "at the
   * back". Omitted means the circular offset is the shape's numbering.
   */
  placeOf?(offset: number, count: number): number
  /** Whether to publish the first slot's measured size for a stylesheet that derives from it. */
  measure: boolean
  /** Attributes the shape publishes on the host, so its selectors can branch on parameters. */
  hostAttributes?: Record<string, string>
  /**
   * Anything else the shape keeps current on the host, handed the deck's own host style ledger.
   *
   * The ledger rather than a second one of the shape's own: a second ledger over the host would
   * snapshot the deck's writes as the author's and "restore" to them (`LedgerSet` in
   * `core/owned-styles.ts`). `render` runs after every full render — never per spin frame — with
   * the slides it rendered; `release` runs before the host's styles are given back.
   */
  attach?(styles: StyleLedger): DeckAttachment
}

/** What {@link DeckLayout.attach} returns. */
export interface DeckAttachment {
  render(nodes: readonly Element[], count: number): void
  release: Cleanup
}

/** Every per-slot ledger this instance has ever written, so teardown gives each element back. */
interface SlotLedgers {
  attributes: Map<Element, AttributeLedger>
}

/**
 * The attribute ledger for one slot, created on first write.
 *
 * Memoised per element for the reason `LedgerSet` is (`core/owned-styles.ts`): a second ledger over
 * an element the first has already written to would snapshot *this instance's* values as the
 * author's own and "restore" to them.
 *
 * @complexity O(1) amortised time; O(n) space in slots ever touched.
 */
function ledgerFor(store: SlotLedgers, node: Element): AttributeLedger {
  let ledger = store.attributes.get(node)
  if (!ledger) {
    ledger = createAttributeLedger(node)
    store.attributes.set(node, ledger)
  }
  return ledger
}

/**
 * Publish the first slot's laid-out size for a stylesheet that derives geometry from it.
 *
 * The one thing in the geometry that cannot be a stylesheet: CSS can spend a measurement
 * (`var(--kui-item-width)`) but cannot take one. Measured on the first slot rather than the widest,
 * because a deck of differently-sized cards has no single size anyway and the number is only ever
 * an input to a default an explicit parameter overrides. A zero (not laid out yet, `display:none`)
 * is not published: `0px` would collapse a derived radius and stack every card on one point.
 *
 * Called on a full render only — never per spin frame. Reading `offsetWidth` right after a style
 * write forces a synchronous layout, and doing that sixty times a second for a value that has not
 * changed would be the single most expensive line in the deck.
 *
 * @complexity O(1) time; one forced layout read per call.
 */
function measureItem(styles: StyleLedger, slots: readonly Element[]): void {
  const first = slots[0] as HTMLElement | undefined
  if (!first) return
  if (first.offsetWidth > 0) styles.set('--kui-item-width', `${first.offsetWidth}px`)
  if (first.offsetHeight > 0) styles.set('--kui-item-height', `${first.offsetHeight}px`)
}

/** The configured motion, after the floor, with the both-set conflict resolved. */
function motionPeriods(params: EffectParams, ctx: PrepareContext, label: string): { spin: number; autoplay: number } {
  const spinRaw = params.ms('spin', 0)
  const autoplayRaw = params.ms('autoplay', 0)
  const spin = clampPeriod(spinRaw)
  const autoplay = clampPeriod(autoplayRaw)
  if (spin !== spinRaw) ctx.warn(`${label} spin: minimum is 2s; clamped to ${Math.abs(spin) / 1000}s`)
  if (autoplay !== autoplayRaw) {
    ctx.warn(`${label} autoplay: minimum is 2s; clamped to ${Math.abs(autoplay) / 1000}s`)
  }
  if (spin !== 0 && autoplay !== 0) {
    ctx.warn(`${label}: spin: and autoplay: are both set; spin: wins`)
    return { spin, autoplay: 0 }
  }
  return { spin, autoplay }
}

/**
 * Drive a deck of slides from one continuous position.
 *
 * Reuses `step-progress`'s marking, counting and control delegation wholesale — the index half of a
 * carousel is the same problem whether the slides sit in a row, on a ring or in a stack, and
 * `createStepMarker` was extracted precisely so a second consumer would not re-derive it. What is
 * new here is the continuous position, the measurement, the face marking, the grab and the motion.
 *
 * @complexity O(n) per flip and per drag frame in the slot count; O(n) per spin frame for the face
 *   marks only; O(n) space in slots ever touched.
 */
// Factory closing over one deck's index state: several small named closures plus wiring, in the
// same shape (and for the same reason) as `core/gesture.ts`'s `recognise`.
// eslint-disable-next-line max-lines-per-function
export function prepareSpatialDeck(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
  layout: DeckLayout,
): Cleanup {
  const { label } = layout
  // Only the `key:value` spelling of a timing token reaches CSS on its own — `pushTrack` writes the
  // positional tokens for `css-keyframes` primitives and no others, and these render through
  // JavaScript. Without this, `carousel-3d 900ms` would travel at the 620ms default while
  // `carousel-3d duration:900ms` worked, which is the failure `mirrorTimingToCss` exists for.
  mirrorTimingToCss(layout.id, ALL_TIMING_TOKENS, params, ctx)

  const selector = resolveTarget(params.text('target'), ctx, label)
  const scope = scopeParam(params, 'self')
  const resolveSlots = (): Iterable<Element> =>
    selector ? queryScoped(el, ctx, selector, scope) : el.children
  const marker = createStepMarker(resolveSlots, (message) => ctx.warn(`${label} ${message}`))
  const total = (): number => countSteps(params, resolveSlots)

  const hostAttributes = createAttributeLedger(el)
  const hostStyles = createStyleLedger(el)
  for (const [name, value] of Object.entries(layout.hostAttributes ?? {})) hostAttributes.set(name, value)
  const slots: SlotLedgers = { attributes: new Map() }
  const attachment = layout.attach?.(hostStyles)

  /*
   * The deck's position, in places, as a real number. The integer index everything else keys off is
   * derived from it rather than stored beside it — two numbers that must agree is a bug waiting for
   * a drag to interrupt a click, and `snapPosition` is the one place that relationship lives. The
   * spin writes this same number, which is why a drag hands back to it with no snap.
   */
  let position = 0
  /** What the last full render saw, so a spin frame can skip re-resolving and re-marking. */
  let rendered = { step: -1, count: 1, nodes: [] as Element[] }
  /** Each slot's place (in the shape's own numbering) at the last full render, to spot a wrap. */
  const lastOffsets = new WeakMap<Element, number>()

  /** Commit a wrapped slot's jump without a transition. See {@link WRAP_ATTR}. */
  const settleWrapped = (nodes: readonly Element[], count: number): void => {
    for (const node of nodes) {
      const raw = Number(node.getAttribute('data-kui-step-offset'))
      const offset = layout.placeOf ? layout.placeOf(raw, count) : raw
      const previous = lastOffsets.get(node)
      lastOffsets.set(node, offset)
      if (previous === undefined || !offsetWrapped(previous, offset, count)) continue
      const flag = createAttributeLedger(node)
      flag.set(WRAP_ATTR, 'true')
      // A forced style resolution is the whole point: it is the "before" state of the next style
      // change, so the jump is committed here, untransitioned, and removing the flag afterwards
      // changes nothing that could start one.
      commitStyle(ctx.win, node)
      flag.restore()
    }
  }

  const markFaces = (nodes: readonly Element[], count: number, drift: number): void => {
    for (const node of nodes) {
      // Read back off the marker's own output rather than recomputed from each node's position:
      // the marker numbers per parent group and wraps per group, and a second numbering here would
      // be a second answer to "which place is this" that could disagree with the one CSS is placing
      // from. `Number(null)` is `0`, so a slide appended between the mark and this read (a custom
      // element reacting to `data-kui-step-state`) is treated as the live place rather than NaN.
      const offset = Number(node.getAttribute('data-kui-step-offset'))
      const face = layout.faceOf(offset - drift, offset, count)
      // Skipped when unchanged: this runs every spin frame, and re-setting an attribute to the value
      // it already holds still invalidates style for every selector that mentions it.
      if (node.getAttribute(FACE_ATTR) !== face) ledgerFor(slots, node).set(FACE_ATTR, face)
    }
  }

  const publishPosition = (step: number, drift: number): void => {
    /*
     * The continuous position is published *relative to the live step*, not as the raw running
     * total: `position` grows without bound across a long drag, and a deck at place 41.4 of six
     * slides is at the same place as one at 5.4. Rebasing here is what keeps the number a fact
     * about the deck rather than about how long someone has been spinning it, and it keeps the
     * value CSS subtracts (`--kui-step-position - --kui-step`) inside half a place either way.
     */
    hostStyles.set('--kui-step-position', (step + drift).toFixed(4))
  }

  const render = (): void => {
    // No `count > 0` guard anywhere below: `countSteps` floors its answer at 1, so a deck with no
    // slots at all still counts one place and nothing divides by zero.
    const count = total()
    const { step, drift } = snapPosition(position, count)
    hostAttributes.set('data-kui-step', String(step))
    hostStyles.set('--kui-step', String(step))
    // On the host as well as each slot (where the marker writes its own group's size), for a layout
    // whose *host* has to size itself from how many slides there are — a flat ring reserves a box
    // as wide as its own circle, and the slots cannot tell their parent that.
    hostStyles.set('--kui-item-count', String(count))
    publishPosition(step, drift)
    marker.mark(step)
    const nodes = [...resolveSlots()]
    if (layout.measure) measureItem(hostStyles, nodes)
    markFaces(nodes, count, drift)
    settleWrapped(nodes, count)
    attachment?.render(nodes, count)
    rendered = { step, count, nodes }
  }

  /**
   * One spin frame. Only the sub-step position and the face marks change between two frames that
   * share a live step, so that is all this writes; the moment the step itself changes it defers to
   * the full render, which re-marks every slot's offset.
   */
  const renderFrame = (): void => {
    const { step, drift } = snapPosition(position, rendered.count)
    if (step !== rendered.step) {
      render()
      return
    }
    publishPosition(step, drift)
    markFaces(rendered.nodes, rendered.count, drift)
  }

  const { spin, autoplay } = motionPeriods(params, ctx, label)
  const pauseControls = new Map<Element, AttributeLedger>()
  const pauseSelector = resolveTarget(params.text('pause'), ctx, `${label} pause`)
  const reflectPaused = (paused: boolean): void => {
    if (!pauseSelector) return
    for (const node of queryScoped(el, ctx, pauseSelector, scope)) {
      let ledger = pauseControls.get(node)
      if (!ledger) {
        ledger = createAttributeLedger(node)
        pauseControls.set(node, ledger)
      }
      ledger.set('aria-pressed', String(paused))
    }
  }

  const motion = createAutoMotion({
    el,
    ctx,
    spinMs: spin,
    autoplayMs: autoplay,
    settleMs: effectDurationMs(params, 620),
    advance(cycles) {
      position = wrapPlace(position + cycles * rendered.count, rendered.count)
      renderFrame()
    },
    step(direction) {
      const count = total()
      const { step } = snapPosition(position, count)
      position = direction > 0 ? nextStep(step, count) : prevStep(step, count)
      render()
    },
    setSpinning: (spinning) => hostAttributes.set(SPINNING_ATTR, String(spinning)),
    onPausedChange: reflectPaused,
  })

  /** A person moved the deck. The motion yields first, so the stylesheet's transition is back. */
  const goTo = (next: number): void => {
    motion.interrupt()
    position = next
    render()
  }

  const groups: ControlGroup[] = []
  const bindControl = (param: string, run: ControlGroup['run']): void => {
    const control = resolveTarget(params.text(param), ctx, `${label} ${param}`)
    if (!control) return
    if (queryScoped(el, ctx, control, scope).length === 0) {
      ctx.warn(`${label} ${param} "${control}" matched nothing`)
    }
    groups.push({ selector: control, run })
  }

  /*
   * Unlike `step-progress` there is no click-the-container fallback for naming a control to retire.
   * This container is *grabbable*: a press on it is the opening of a possible drag, and advancing
   * the deck on that press as well would mean every abandoned drag also stepped it.
   */
  bindControl('next', () => goTo(nextStep(snapPosition(position, total()).step, total())))
  bindControl('prev', () => goTo(prevStep(snapPosition(position, total()).step, total())))
  bindControl('jump', (_node, at) => { if (at >= 0) goTo(at) })
  if (pauseSelector && !motion.enabled) {
    ctx.warn(`${label} pause: has nothing to pause without spin: or autoplay:`)
  } else {
    bindControl('pause', () => motion.toggle())
  }
  const releaseControls = delegateControls({ el, ctx, scope, groups })

  const releaseDrag = createRingDrag({
    el,
    ctx,
    enabled: params.is('grab'),
    travelPx: params.num('travel', 220),
    total,
    positionOf: () => position,
    moveTo: goTo,
    setDragging: (dragging) => {
      hostAttributes.set(DRAGGING_ATTR, String(dragging))
      motion.hold(dragging)
    },
  })

  render()

  return () => {
    motion.release()
    releaseDrag()
    releaseControls()
    marker.restore()
    for (const ledger of pauseControls.values()) ledger.restore()
    for (const ledger of slots.attributes.values()) ledger.restore()
    pauseControls.clear()
    slots.attributes.clear()
    attachment?.release()
    hostAttributes.restore()
    hostStyles.restore()
  }
}
