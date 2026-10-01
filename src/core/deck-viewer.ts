import type { Cleanup, ParamSpec } from './types.js'

/**
 * How a deck opens its own cards in the lightbox gallery: `carousel-3d lightbox:true`.
 *
 * The decks (`spatial-ring`, `spatial-stack`, `step-progress`) live in `src/effects/`; the gallery
 * lives in `src/showcase/`, and only the effects barrel may import showcase (see
 * `only-effects-barrel-imports-showcase` in `.dependency-cruiser.cjs` — it is what keeps the later
 * split into a standalone `kuinetic.showcase.js` a build change). So the deck cannot call the
 * gallery, and the gallery cannot find the decks.
 *
 * ## Why a provided function, and not an event like `kui:swipe`
 *
 * `kui:swipe` works because its listener — a deck — is an effect that prepares on an element and
 * can put a listener on its document. The gallery has no such moment: with `lightbox:true` there is
 * no `lightbox` effect on the page at all, so nothing would be listening for a "card opened" event.
 * The one moment the showcase module reliably runs is its registration (`registerShowcase`), and
 * that is where it provides {@link DeckViewer}. A deck with `lightbox:true` asks for it at prepare;
 * a page that never loaded the showcase gets a warning naming why, not a silent dead click.
 *
 * The seam is deliberately this narrow: the deck says which element it is, how to read its cards,
 * and the two context facts the viewer needs. Which card was clicked, what counts as a click rather
 * than a drag, and what a card's media is are all decided on the showcase side, by the same code the
 * `lightbox` effect uses.
 */

/** What a deck hands the viewer. */
export interface DeckViewerRequest {
  /** The deck's own element. Clicks on its cards open the gallery. */
  host: Element
  /** The deck's cards in order, read at each click so a card added later is included. */
  cards: () => Iterable<Element>
  doc: Document
  reducedMotion: boolean
}

/** Installs click-to-view on a deck. Returns its teardown, which also releases the shared modal. */
export type DeckViewer = (request: DeckViewerRequest) => Cleanup

let provided: DeckViewer | null = null

/**
 * Make the gallery available to decks. Called by `registerShowcase`; registering twice (several
 * registries in one realm) provides the same function again.
 *
 * @complexity O(1) time and space.
 */
export function provideDeckViewer(viewer: DeckViewer): void {
  provided = viewer
}

/**
 * Attach the provided viewer to a deck, or return `null` when the showcase module is not loaded.
 *
 * @complexity O(1) here; the viewer's own install cost otherwise.
 */
export function attachDeckViewer(request: DeckViewerRequest): Cleanup | null {
  return provided ? provided(request) : null
}

/**
 * The `lightbox:` parameter every deck takes. One declaration, so the name, the keywords and the
 * default cannot drift between the three decks.
 */
export const DECK_LIGHTBOX_PARAM: ParamSpec = {
  type: 'keyword',
  default: 'false',
  cssProperty: '--kui-deck-lightbox',
  keywords: ['true', 'false'],
}

/**
 * Prepare-time half shared by every deck: attach the viewer when `lightbox:true`, or warn when the
 * showcase module that provides it is missing.
 *
 * @complexity O(1) plus the viewer's install.
 */
export function deckLightbox(
  enabled: boolean,
  request: DeckViewerRequest,
  warn: (message: string) => void,
): Cleanup {
  if (!enabled) return () => {}
  const release = attachDeckViewer(request)
  if (release) return release
  warn('lightbox:true needs the showcase module (the lightbox gallery), which is not loaded; cards will not open')
  return () => {}
}
