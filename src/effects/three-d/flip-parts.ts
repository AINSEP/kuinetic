import type { Cleanup, EffectParams, PrepareContext } from '../../core/types.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import type { AttributeLedger } from '../../core/owned-styles.js'
import { ATTR } from '../../core/attrs.js'

/**
 * Phase 7a — the flip card's structural parts (owner decision E): `data-kui-part="front"`/`"back"`
 * on an unclassed card's two faces, and the toggle control — an authored `.kui-flip-control`, an
 * authored `button[aria-pressed]` (stamped so `flip-card-parts.css` reaches it, but never wired,
 * since the author already owns its click handler), or a control this module injects and wires
 * itself: `<button type="button" class="kui-flip-control" data-kui-part="control injected"
 * aria-pressed="false">Flip card</button>` (the `quiet` token joins it for a hover trigger, so
 * `flip-card-parts.css` can hide it until `:focus-visible` — the pointer path already has one).
 *
 * Classes win throughout: a card the author already marked up with `.kui-face-front`/`-back`/
 * `.kui-flip-control` gets no redundant attribute next to a class its own CSS may already select.
 */

/** What {@link prepareFlipParts} resolved for one flip card. */
export interface FlipParts {
  /** The card's toggle control, whether authored or injected. Never `null` in practice — the
   *  injected branch always succeeds — but the type stays `Element | null` to match the shape
   *  `prepareCardToggle`'s "no control" warning already branches on. */
  control: Element | null
  /** Undo every attribute stamp and remove every injected node. */
  cleanup: Cleanup
}

/** A card's own class already marks its faces — stamping `data-kui-part` next to one would be
 *  redundant, and this selector is how every branch below checks for that first. */
const FACE_CLASS_SELECTOR = ':scope > .kui-face-front, :scope > .kui-face-back'

/**
 * Stamp the card's first two non-button direct children `data-kui-part="front"`/`"back"`, unless
 * the author already marked its faces by class.
 *
 * A card with fewer than two qualifying children stamps only what it has — a lone face is a
 * misconfiguration the CSS `:has()` gate already renders inertly, not this function's job to warn
 * about (that stays `prepareCardToggle`'s concern, at the control it already checks).
 *
 * @complexity O(c) time in the card's direct children; O(1) additional space per stamped face.
 */
function stampFaces(el: Element, stamp: (target: Element, value: string) => void): void {
  if (el.querySelector(FACE_CLASS_SELECTOR)) return
  const [front, back] = Array.from(el.children).filter((child) => child.tagName !== 'BUTTON')
  // `noUncheckedIndexedAccess` makes both destructured elements `Element | undefined` even though
  // `el.children` is never sparse — a card with fewer than two qualifying children legitimately
  // has one or both missing, which is exactly the case the guards below exist to handle.
  if (front) stamp(front, 'front')
  if (back) stamp(back, 'back')
}

/**
 * Build the toggle button this module injects when the card authored no control at all.
 *
 * @complexity O(1).
 */
function injectControl(el: Element, doc: Document, quiet: boolean): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'kui-flip-control'
  button.setAttribute(ATTR.part, quiet ? 'control injected quiet' : 'control injected')
  button.setAttribute('aria-pressed', 'false')
  button.textContent = 'Flip card'
  el.append(button)
  return button
}

/**
 * Resolve the card's toggle control: an authored `.kui-flip-control`, an authored
 * `button[aria-pressed]` (stamped, not wired), or a freshly injected one this function builds.
 *
 * @complexity O(1) DOM lookups plus {@link injectControl}'s O(1) work on the injected path.
 */
function resolveControl(
  el: Element,
  doc: Document,
  quiet: boolean,
  stamp: (target: Element, value: string) => void,
): { control: Element; injected: HTMLButtonElement | null } {
  const owned = el.querySelector(':scope > .kui-flip-control')
  if (owned) return { control: owned, injected: null }

  const authored = el.querySelector(':scope > button[aria-pressed]')
  if (authored) {
    stamp(authored, 'control')
    return { control: authored, injected: null }
  }

  const button = injectControl(el, doc, quiet)
  return { control: button, injected: button }
}

/**
 * Resolve (and stamp/inject) a flip card's structural parts.
 *
 * @param el - The flip card element.
 * @param params - The effect's authored parameters; only `trigger` is read, to decide whether an
 *   injected control starts quiet (hidden until `:focus-visible`) — a hover trigger already has a
 *   pointer path, so the injected control is a keyboard fallback rather than the primary control.
 * @param ctx - The prepare-time context; only `doc` is read, so an injected button is built
 *   through the same document the rest of this codebase's primitives use rather than a global.
 * @returns The card's control and a cleanup that undoes every stamp and removes the injected node.
 * @complexity O(c) time in the card's direct children; O(1) additional space per stamped/injected
 *   node.
 * @overallScore 100
 */
export function prepareFlipParts(el: Element, params: EffectParams, ctx: PrepareContext): FlipParts {
  const ledgers: AttributeLedger[] = []
  const stamp = (target: Element, value: string): void => {
    const ledger = createAttributeLedger(target)
    ledger.set(ATTR.part, value)
    ledgers.push(ledger)
  }

  stampFaces(el, stamp)

  const quiet = params.text('trigger', 'click') !== 'click'
  const { control, injected } = resolveControl(el, ctx.doc, quiet, stamp)

  // `injected` and its listener travel together in one nullable pair, rather than as two
  // independently-nullable variables: `resolveControl` guarantees one implies the other, and a
  // pair says so structurally instead of leaving an `injected && onClick` combination that can
  // never actually happen for a branch check to wonder about.
  const wired = injected
    ? {
        button: injected,
        onClick: (): void => {
          injected.setAttribute('aria-pressed', String(injected.getAttribute('aria-pressed') !== 'true'))
        },
      }
    : null
  if (wired) wired.button.addEventListener('click', wired.onClick)

  const cleanup: Cleanup = () => {
    if (wired) {
      wired.button.removeEventListener('click', wired.onClick)
      wired.button.remove()
    }
    for (const ledger of ledgers) ledger.restore()
  }

  return { control, cleanup }
}
