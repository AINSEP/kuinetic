import type { PrepareContext } from '../../core/effect-context.js'
import type { ScrollFrame } from '../../core/scroll-scheduler.js'
import { createMeasureCache } from '../../core/scroll-scheduler.js'
import { toPixels } from '../../core/js-params.js'
import type { EffectParams } from '../../core/types.js'
import { continuousSetup } from '../../core/instances.js'
import type { ContinuousSetup } from '../../core/instances.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import type { AttributeLedger } from '../../core/owned-styles.js'
import { resolveTarget } from '../step-marking.js'
import { domGeometry, trackProgress } from './tracker.js'

/**
 * `scroll-spy`'s two authoring shapes.
 *
 * Split out of `primitives.ts` once the container form pushed that file over its own line cap —
 * same reason `stacking-cards` and `scroll-snap` got their own *test* files in commit 69253cf, one
 * level up: a category that outgrows one file gets a file of its own rather than a bigger one.
 *
 * `prepareScrollSpy` is the only export `primitives.ts` needs; everything else here is either mode
 * is private to how it marks `data-kui-active`.
 */

/**
 * Mark the navigation link pointing at the most recently entered section.
 *
 * Two authoring shapes share this primitive. `sections:` selects the container form — one
 * instance on the element that has both the nav and the sections as descendants, which measures
 * every section itself instead of taking an authored `distance:` per section. Its absence keeps
 * the original per-section form running exactly as shipped, `distance:` and all: that form is
 * public API and this dispatch is the whole of what changes for it, nothing inside it does.
 *
 * @complexity Dispatch only; see whichever form runs.
 * @overallScore 100
 */
export function prepareScrollSpy(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
  const sectionsAuthored = params.text('sections')
  if (sectionsAuthored) {
    const sectionsSelector = resolveTarget(sectionsAuthored, ctx, 'scroll-spy sections')
    return prepareScrollSpyContainer(el, params, ctx, sectionsSelector)
  }
  return prepareScrollSpySingle(el, params, ctx)
}

/**
 * The original one-section-per-instance form: `data-kui="scroll-spy target:#link-id"` repeated on
 * every section. See `prepareScrollSpy` for the container alternative and `prepareScrollSpyContainer`
 * for why it exists.
 *
 * Writes `data-kui-active` rather than toggling a class, so the styling contract stays the
 * library's attribute vocabulary and cannot collide with a site's own class names.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareScrollSpySingle(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
  // `offset-top` only has a mechanism to act on in the container form below, where there is no
  // single sticky element whose resolved `top` this could read back through instead (see
  // `prepareScrollSpyContainer`'s own note on that). Warning here is the difference between this
  // and `flip-3d`'s `perspective` parameter, which validated and did nothing for the same reason
  // with no one telling the author.
  if (params.text('offset-top', '0px') !== '0px') {
    ctx.warn('scroll-spy "offset-top" has no effect without sections: and is ignored here')
  }
  const selector = resolveTarget(params.text('target'), ctx, 'scroll-spy')
  /*
   * One ledger per element ever written, rather than a bare Set of touched elements.
   *
   * The Set recorded *which* links this instance stamped but not *what they held first*, so
   * teardown removed a `data-kui-active` the consumer had authored themselves. That is the same
   * defect `createStyleLedger` was introduced to close for inline styles, so this uses the
   * attribute half of that ledger rather than inventing a second restore mechanism. The tracked
   * element gets one too: `removeAttribute` on teardown destroyed an authored value there as well.
   */
  const links = new Map<Element, AttributeLedger>()
  const self = createAttributeLedger(el)
  /*
   * scroll-spy's entire output is one boolean, so a frame that does not flip it has nothing to do.
   * Re-running `querySelectorAll` and re-stamping every match on every scroll frame was pure
   * waste — the same per-frame-work defect `prepareMediaScrub` avoids with its `lastIndex` guard,
   * and the reason a broad selector was a performance problem and not only a correctness one.
   */
  let last: boolean | undefined

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    const active = progress > 0 && progress < 1
    if (active === last) return
    last = active
    self.set('data-kui-active', String(active))
    // Re-queried per flip rather than resolved once at setup, so a nav rendered or reordered
    // after this element was prepared is still picked up. Flips are rare; frames are not.
    if (selector) markLinks(ctx.doc, selector, active, links)
  })

  // External link state is written outside this element, so it must be undone explicitly.
  // Continuous: a spy follows scroll position indefinitely and never reaches a finished state.
  return continuousSetup(() => {
    untrack()
    self.restore()
    for (const ledger of links.values()) ledger.restore()
  })
}

/*
 * `spyTarget` and its `selectorBreadth` helper used to live here. They now live in
 * `effects/step-marking.ts` as `resolveTarget`/`selectorBreadth`, because `scroll-progress` and
 * forms' `step-progress` need exactly the same guard for exactly the same `target:` param, and one
 * validated selector convention across the library is the whole point of the parameter.
 */

function markLinks(
  doc: Document,
  selector: string,
  active: boolean,
  links: Map<Element, AttributeLedger>,
): void {
  for (const link of doc.querySelectorAll(selector)) {
    let ledger = links.get(link)
    if (!ledger) {
      ledger = createAttributeLedger(link)
      links.set(link, ledger)
    }
    // The ledger remembers only the value it first replaced, so repeated flips never overwrite
    // the consumer's original with one of this instance's own writes.
    ledger.set('data-kui-active', String(active))
  }
}

/**
 * The `#id` fragment of an `href` attribute, or `''` for a link with none.
 *
 * Reads the raw attribute rather than `HTMLAnchorElement.hash`, so this works for anything
 * `target:` matches — not only `<a>` — and never resolves the path half against the document's
 * base URL, which a plain fragment like `#spy-bottle` does not need and a relative one like
 * `page.html#spy-bottle` would otherwise route through URL parsing to get the same substring.
 *
 * @complexity O(n) time in the attribute's length; O(1) space.
 * @overallScore 100
 */
function hrefHash(link: Element): string {
  const href = link.getAttribute('href') ?? ''
  const at = href.indexOf('#')
  return at === -1 ? '' : href.slice(at)
}

interface SpyPair {
  section: Element
  /** `null` when no link in `target:` points at this section's `id`. */
  link: Element | null
}

/**
 * Pair each section with the link whose `href` points at its `id`.
 *
 * `href="#spy-bottle"` -> `id="spy-bottle"` is already the relationship the markup states — every
 * nav link that jumps to a section already names it by id, so pairing needs no attribute this
 * primitive invents on top of what an author writes for `<a href>` anyway.
 *
 * Warns once for each side of a mismatch rather than staying quiet: a section with no `id` can
 * never be pointed at and is very likely a markup oversight, and a link whose hash matches no
 * section is very likely a typo in one or the other — both are the kind of mistake that is silent
 * and permanent until someone thinks to check the nav by hand.
 *
 * @complexity O(s + l) time in sections and links; O(s + l) space.
 * @overallScore 100
 */
function pairSectionsWithLinks(
  sections: Element[],
  links: Element[],
  ctx: PrepareContext,
  sectionsSelector: string,
): SpyPair[] {
  const linksByHash = new Map<string, Element>()
  for (const link of links) {
    const hash = hrefHash(link)
    if (hash) linksByHash.set(hash, link)
  }

  const claimed = new Set<string>()
  const pairs = sections.map((section) => {
    if (!section.id) {
      ctx.warn(
        `scroll-spy: a section matched by sections:"${sectionsSelector}" has no id and cannot be paired with a link`,
      )
      return { section, link: null }
    }
    const hash = `#${section.id}`
    const link = linksByHash.get(hash) ?? null
    if (link) claimed.add(hash)
    return { section, link }
  })

  for (const [hash, link] of linksByHash) {
    if (!claimed.has(hash)) {
      ctx.warn(`scroll-spy: link "${link.getAttribute('href')}" matches no section id in sections:"${sectionsSelector}"`)
    }
  }
  return pairs
}

/**
 * `offset-top` resolved to pixels for one frame.
 *
 * Not a resolved computed style: there is no single sticky element here whose real `top` a
 * browser has already resolved through `var()`/`calc()` to read back, the way `stickyEl`/
 * `offsetOf` do for `pin`/`media-scrub` in `tracker.ts`. `toPixels` is the same static parser
 * `distance` already goes through in `tracker.ts`'s `resolveDistance`, with the same pre-existing
 * limitation: a literal length (`96px`, `6vh`, `2rem`) resolves; a `var()` reference silently
 * falls back to 0 — not a new gap, the one `distance` already has.
 *
 * @complexity O(n) time in the authored value's length; O(1) space.
 * @overallScore 100
 */
function offsetTopPixels(authored: string, frame: ScrollFrame): number {
  return toPixels(
    authored,
    {
      viewportWidth: frame.metrics.viewportWidth,
      viewportHeight: frame.metrics.viewportHeight,
      percentBasis: 0,
      fontSize: 16,
      rootFontSize: 16,
    },
    0,
  )
}

/**
 * The highest index whose content-relative top has reached the reference line.
 *
 * `-1` when none has — before the first section, or with no sections at all. Callers rely on this
 * being the *only* thing that decides "active": one number, or none, never more than one.
 *
 * @complexity O(n) time in section count; O(1) space.
 * @overallScore 100
 */
function highestReachedIndex(tops: number[], scrollTop: number, line: number): number {
  let index = -1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! - scrollTop - line <= 0) index = i
  }
  return index
}

/**
 * One instance on the shared ancestor of the nav and the sections, measuring its own sections
 * instead of taking an authored `distance:`.
 *
 * The per-section form makes every section restate three things: the attribute itself, which link
 * it names, and a `distance:` hand-matched to that section's own CSS height. The third one is the
 * same defect `TrackOptions.contentAnchor` closed for `pin`/`media-scrub` in commit 69253cf — two
 * numbers stating one fact, with nothing stopping them drifting apart. `demo/scroll.html`'s own
 * history is the proof: `distance:68vh` had to be hand-kept equal to `min-height: 68vh` on every
 * section, and the comment beside it documents the exact overlap that shipped when they briefly
 * disagreed. This form never authors a distance at all — each section's own measured height is
 * what a browser lays out regardless of what any attribute says, so there is no second number to
 * keep in sync, and no way for it to drift.
 *
 * "Active" is redefined too, not reused from the per-section rule (`0 < progress < 1`). That rule
 * only ever names exactly one section when sections tile with no gap between them — a fact about
 * the *page's* CSS, not something a single section's own primitive instance can see or enforce.
 * `demo/scroll.html`'s own documented history is again the evidence: a 1.25rem gap between tiles
 * left scroll windows belonging to no section at all, and the nav went blank mid-group.
 *
 * Tracking every section together removes the assumption instead of relying on it. The active
 * section is the *last* one (in document order) whose top has reached the reference line — the
 * viewport's top edge, shifted down by `offset-top` — among all of them, recomputed every frame
 * (`highestReachedIndex`). That can only ever name at most one index, by construction: never two,
 * because it is one number, the highest index that qualifies; and never "none" once the first
 * section has been reached, gap or no gap, because reaching one and only later leaving it behind
 * still leaves it the highest qualifying index until the next one also qualifies. Before the first
 * section is reached, or if there are no sections at all, the honest state actually is "none
 * active" — `-1`, not a case this rule needs to paper over.
 *
 * Sections and links are queried from `el`, the container, not `ctx.doc` — unlike the per-section
 * form's `target:`, which has to reach document-wide because the section carrying the attribute
 * and the nav it names are typically not in the same subtree at all. Here they are, by
 * construction: this primitive requires one shared ancestor. Scoping to it is strictly safer on a
 * page the size of `docs.html`, where a document-wide `<a>`/heading selector would reach content
 * this instance was never meant to touch.
 *
 * @complexity O(n) time and space in section count, recomputed every frame — cheap arithmetic
 *   against a rect cache, never a fresh layout read once per resize epoch has passed.
 * @overallScore 100
 */
function prepareScrollSpyContainer(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
  sectionsSelector: string,
): ContinuousSetup {
  // Same reasoning as `offset-top` in `prepareScrollSpySingle`: a validated parameter that quietly
  // does nothing is the bug this warning exists to not repeat.
  if (params.text('distance', '100vh') !== '100vh') {
    ctx.warn('scroll-spy "distance" has no effect with sections: — each section measures its own height')
  }

  const linksSelector = resolveTarget(params.text('target'), ctx, 'scroll-spy target')
  const sections = sectionsSelector ? [...el.querySelectorAll(sectionsSelector)] : []
  if (sectionsSelector && sections.length === 0) {
    ctx.warn(`scroll-spy sections:"${sectionsSelector}" matched nothing inside this element`)
  }
  const links = linksSelector ? [...el.querySelectorAll(linksSelector)] : []
  const pairs = pairSectionsWithLinks(sections, links, ctx, sectionsSelector)

  const sectionLedgers = pairs.map((pair) => createAttributeLedger(pair.section))
  const linkLedgers = new Map<Element, AttributeLedger>()
  for (const { link } of pairs) {
    if (link && !linkLedgers.has(link)) linkLedgers.set(link, createAttributeLedger(link))
  }

  const offsetAuthored = params.text('offset-top', '0px')

  /*
   * Content-relative tops, cached per resize epoch exactly the way `tracker.ts`'s own `geometry`
   * cache is: `rect.top` is viewport-relative and changes on every scroll tick, but adding back
   * the scroll position it was measured under gives a number that only moves when the element
   * itself moves in the document, which a resize is the only thing this scheduler treats as a
   * reason to re-measure. Every frame in between is a subtraction, not a layout read — the same
   * "one measurement per resize, not per frame" property every other primitive in this file holds,
   * even though there is no exported cache-per-element helper for N sections at once to reuse.
   */
  let scrollTop = 0
  let scrollportTop = 0
  const contentTops = createMeasureCache(() =>
    pairs.map(({ section }) => domGeometry(section).top - scrollportTop + scrollTop),
  )

  let active = -1
  function setActive(index: number, value: boolean): void {
    const pair = pairs[index]!
    sectionLedgers[index]!.set('data-kui-active', String(value))
    if (pair.link) linkLedgers.get(pair.link)!.set('data-kui-active', String(value))
  }

  const untrack = ctx.scheduler.subscribe(ctx.rootFor(el), (frame) => {
    scrollTop = frame.metrics.scrollTop
    scrollportTop = frame.metrics.viewportTop
    const tops = contentTops.read(frame.epoch)
    const line = offsetTopPixels(offsetAuthored, frame)
    const next = highestReachedIndex(tops, scrollTop, line)

    if (next === active) return
    if (active !== -1) setActive(active, false)
    if (next !== -1) setActive(next, true)
    active = next
  })

  // Continuous, for the same reason as the single form above.
  return continuousSetup(() => {
    untrack()
    for (const ledger of sectionLedgers) ledger.restore()
    for (const ledger of linkLedgers.values()) ledger.restore()
  })
}
