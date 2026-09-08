import type { PrepareContext } from '../../core/effect-context.js'
import { recognise } from '../../core/gesture.js'
import type { Cleanup } from '../../core/types.js'

/**
 * Spinning a ring by hand.
 *
 * The naive binding — put a drag on the container and step the index when it passes a threshold —
 * jumps a whole card at a time, because `--kui-step` is an integer and there is nothing between two
 * of its values. What makes a ring feel grabbed is that it is *between* two places while your
 * finger is down, which is the entire reason `--kui-step-position` exists as a second published
 * number rather than a rounding of the first.
 *
 * ## What this reuses, and what it does not
 *
 * `core/gesture.ts`'s `recognise` already owns the hard half of the pointer stream: pointer
 * capture, the tap-versus-drag threshold, a windowed velocity estimate (a single trailing sample is
 * far too noisy to throw with), `pointercancel` recovery, and an injected clock so the whole thing
 * is drivable from a test. All of that is identical for a ring and it is used as-is.
 *
 * What it deliberately does *not* reuse is `effects/gestures`' `drag-inertia`, which is a different
 * problem wearing the same word. That family moves an element to wherever you let go of it, in
 * pixels, on two independent springs, and its whole contract is that it *stays* there. A ring has
 * no free position: every release must land on one of N discrete places, the pixels are only a
 * proxy for an angle, and the value being driven has to end up back in sync with the integer index
 * the arrows and the marked slots share. Reaching for the existing family would have meant a spring
 * whose target had to be recomputed into an index anyway, plus two axes to suppress.
 *
 * ## What is here that is not in `recognise`
 *
 * - **Pixels to places.** One `travel:` distance, so the mapping is in the same unit as the index.
 * - **Velocity projection.** Where the ring *would* coast to, so a flick crosses more than one
 *   place and a nudge crosses none.
 * - **Snap selection.** The projected position rounded to the nearest place, which is what makes a
 *   release land on a card rather than between two.
 * - **Click suppression.** A drag that starts on a link must not also follow it.
 * - **Keyboard.** Arrows, Home and End, because a control that can only be operated by dragging is
 *   not operable at all for a large number of people.
 */

/** Seconds of coasting a release is projected forward. Longer overshoots; shorter feels braked. */
const MOMENTUM_SECONDS = 0.28

/** Places a single flick may carry, however hard it is thrown. */
const MAX_FLICK_PLACES = 4

/** Movement, in pixels, below which a pointer sequence is a press rather than a drag. */
const DRAG_THRESHOLD_PX = 6

export interface RingDragRequest {
  el: Element
  ctx: PrepareContext
  /** `grab:false` still installs the keyboard half — that is accessibility, not decoration. */
  enabled: boolean
  /** Pointer pixels per place on the ring. */
  travelPx: number
  /** How many places the ring has *now*; asked per gesture, never captured. */
  total(): number
  /** The ring's current continuous position, in places. */
  positionOf(): number
  /** Move the ring to a continuous position and re-render. */
  moveTo(position: number): void
  /** Publish or clear the dragging state the stylesheet suspends its transition on. */
  setDragging(dragging: boolean): void
}

/**
 * Where a release coasts to, before snapping.
 *
 * Velocity is in pixels per second and the ring is measured in places, so the projection is
 * `velocity / travel * seconds` — one conversion, in one place, in the unit the index uses.
 *
 * Capped, and the cap is not politeness. Uncapped, a hard flick on a phone (velocities of several
 * thousand pixels per second are ordinary) projects a dozen places, and a ring that spins a dozen
 * cards from one flick has stopped being a control and become a slot machine: the visitor cannot
 * predict where it lands, so they cannot aim, so they flick again. Four places is far enough that a
 * deliberate throw clearly differs from a nudge and close enough that the destination stays
 * legible.
 *
 * Pure and exported so both halves — the conversion and the cap — are assertable without a pointer.
 *
 * @param position - Where the ring is at release, in places.
 * @param velocityPxPerSec - Signed pointer velocity along the drag axis.
 * @param travelPx - Pixels per place.
 * @returns The un-snapped position the ring is heading for.
 * @complexity O(1) time and space.
 */
export function projectRelease(
  position: number,
  velocityPxPerSec: number,
  travelPx: number,
): number {
  if (travelPx <= 0) return position
  const places = (velocityPxPerSec / travelPx) * MOMENTUM_SECONDS
  const capped = Math.max(-MAX_FLICK_PLACES, Math.min(MAX_FLICK_PLACES, places))
  return position - capped
}

/**
 * Which place a released ring settles on.
 *
 * Separate from {@link projectRelease} because they answer different questions and only one of them
 * has an opinion: projection is physics, snapping is the contract that a ring always comes to rest
 * facing a card. Splitting them is also what makes "a flick of exactly half a place still commits"
 * testable without synthesising a gesture.
 *
 * `+ 0` is not decoration. `Math.round(-0.4)` is `-0`, and a ring settled at "minus place zero" is
 * not a place — it is the same place spelled in a way that half of JavaScript disagrees with
 * itself about. `-0 === 0` is true, so most arithmetic hides it; `Object.is(-0, 0)` is false, which
 * is what `toBe` compares with, and `[-0].toString()` and `JSON.stringify(-0)` disagree with each
 * other too. Adding zero normalises the sign at the one place a negative zero can be produced,
 * rather than leaving every caller and every serialisation to find out for itself.
 *
 * @param projected - The coasting destination, in places.
 * @returns The nearest whole place, never negative zero.
 * @complexity O(1) time and space.
 */
export function snapTo(projected: number): number {
  return Math.round(projected) + 0
}

/**
 * Bring a settled position onto `[0, total)`.
 *
 * A ring has no ends, so nothing about the geometry needs this — `--kui-offset` is computed modulo
 * the count and `render` rebases the published position on the live step every time. What needs it
 * is arithmetic hygiene over a long session: `position` accumulates every drag ever made, and a
 * number in the millions loses the fractional precision the sub-step rotation is carried in. Doing
 * it at rest rather than mid-drag keeps the drag itself monotonic, so a gesture never jumps because
 * it happened to cross the seam.
 *
 * @complexity O(1) time and space.
 */
export function wrapPlace(place: number, total: number): number {
  return total > 0 ? ((place % total) + total) % total : 0
}

/**
 * How far one arrow press moves the ring, per key.
 *
 * A table rather than a switch for the reason `activation.ts` gives for its own: a new key should
 * be a data change. `null` means "this key names an absolute place, not a delta" and is resolved
 * against the count at press time — `End` on a six-slide ring is place five, and the table cannot
 * know that.
 *
 * Both axes are bound. Which axis a ring reads as "forwards" depends on its tilt and its arc, and
 * a visitor pressing Down on a ring that happens to be tipped is not making a mistake.
 */
const KEY_DELTAS: Record<string, number | null> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageDown: 1,
  PageUp: -1,
  Home: null,
  End: null,
}

/**
 * Install the grab and the keyboard on a ring.
 *
 * @returns Teardown for every listener and attribute this installs.
 * @complexity O(1) per pointer event and per key; O(1) space.
 */
export function createRingDrag(request: RingDragRequest): Cleanup {
  const { el, ctx, enabled, travelPx, total, positionOf, moveTo, setDragging } = request

  /*
   * Whether the gesture just ended actually moved the ring.
   *
   * A press that crosses the threshold is a drag, and the browser still fires a `click` at the end
   * of it — at whatever was under the pointer when it went down, which on a deck of cards is a
   * link. Without this, spinning the ring by grabbing a card navigates away from the page. The flag
   * is consumed by exactly one `click`, in the capture phase, before it can reach the card.
   */
  let suppressClick = false

  const onClickCapture = (event: Event): void => {
    if (!suppressClick) return
    suppressClick = false
    event.stopPropagation()
    event.preventDefault()
  }

  /*
   * The pointer moves the ring in the opposite direction to the index.
   *
   * Dragging left pulls the cards left, which brings the *next* card to the front — so leftward
   * pixels (negative dx) are a positive step. Getting this backwards is not a subtle bug: the ring
   * follows the finger the wrong way and reads as broken rather than as inverted.
   */
  const stopRecognising = enabled
    ? recognise(
        el,
        {
          onStart() {
            setDragging(true)
          },
          onMove(vector) {
            moveTo(positionOf() - vector.dx / travelPx)
          },
          onEnd(vector) {
            setDragging(false)
            suppressClick = true
            const settled = snapTo(projectRelease(positionOf(), vector.vx, travelPx))
            moveTo(wrapPlace(settled, total()))
          },
        },
        // Locked to one axis: a ring spins about one pole, so vertical pointer movement is the
        // visitor scrolling the page *through* the deck, which must keep working. The higher
        // threshold than `recognise`'s own default of 4px is what buys that — a ring occupies a
        // large slab of a phone screen, and a scroll that begins with a two-pixel horizontal wobble
        // should not capture the pointer away from the page.
        { axis: 'x', threshold: DRAG_THRESHOLD_PX },
      )
    : () => {}

  /*
   * `pan-y`, not `none`. `none` would hand this element every touch, including the vertical ones
   * that are the visitor scrolling past a full-width deck — the single most common way a carousel
   * traps a phone. `pan-y` gives the browser the vertical axis and keeps the horizontal one, which
   * is exactly the split `axis: 'x'` above already made.
   */
  if (enabled) ctx.style.set('touch-action', 'pan-y')

  const onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent
    const key = keyboard.key
    // Absent means unbound; `null` means bound to an absolute place. Read as one lookup rather than
    // an `in` check followed by a second one, so the two can never disagree about which keys exist.
    const delta = KEY_DELTAS[key]
    if (delta === undefined) return
    // Modified presses belong to the browser and the OS — Home with a modifier is "top of
    // document", and stealing it would be worse than not binding the key at all.
    if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey) return

    const count = total()
    // `null` is the "names an absolute place" marker the table cannot resolve on its own, because
    // only the live count knows where the last place is.
    const absolute = key === 'Home' ? 0 : count - 1
    const next = delta === null ? absolute : snapTo(positionOf()) + delta
    event.preventDefault()
    moveTo(wrapPlace(next, count))
  }

  /*
   * Bound on the host, and the host is made focusable only if the author left it alone.
   *
   * `tabindex="0"` on a container that already carries one — or a `-1` the author set deliberately
   * to keep it out of the tab order — would be this library overruling a decision it cannot see the
   * reason for. Writing it only when the attribute is absent leaves that decision where it belongs,
   * and the ledger puts the element back either way.
   *
   * No ARIA role is invented here. `step-progress` makes the same call and says why: an index is
   * not a widget, and guessing at `role="listbox"`/`aria-live` on markup the library did not author
   * produces confidently wrong announcements rather than none. Labelling the ring is the page's, and
   * `docs/catalog.md` says so.
   */
  const grantedFocus = el.getAttribute('tabindex') === null
  if (grantedFocus) el.setAttribute('tabindex', '0')
  el.addEventListener('keydown', onKeyDown)
  el.addEventListener('click', onClickCapture, true)

  return () => {
    stopRecognising()
    el.removeEventListener('keydown', onKeyDown)
    el.removeEventListener('click', onClickCapture, true)
    // Only ever removed when this instance added it, which is the same rule the attribute ledgers
    // elsewhere in this module enforce by remembering the prior value: a `tabindex` the author
    // wrote must survive teardown untouched.
    if (grantedFocus) el.removeAttribute('tabindex')
  }
}
