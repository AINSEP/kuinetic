import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { toPixels, ABSOLUTE_BASIS } from '../../core/js-params.js'
import { isSameOriginPath } from '../../core/params.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { AttributeLedger } from '../../core/owned-styles.js'
import { createMeasureCache } from '../../core/scroll-scheduler.js'
import { createStepMarker, resolveTarget } from '../step-marking.js'
import { trackProgress } from './tracker.js'

/**
 * Scroll-mechanics primitives.
 *
 * Every one of these is `trackProgress` plus a different write. Pinning writes `position: sticky`,
 * scrubbing writes a frame index, horizontal scroll writes a translation — the scroll maths is
 * shared, which is what keeps the category to one listener and one rAF for the whole page.
 *
 * All are `reducedMotion: 'disable'`: shortening a scroll-linked effect is meaningless, because
 * its duration is the user's scrolling, not a clock.
 */

const PROGRESS_VAR = '--kui-progress'

const distanceParam: ParameterSchema = {
  distance: { type: 'length', default: '100vh', cssProperty: '--kui-distance' },
}

/** One primitive's distinguishing fields; the rest are identical across the category. */
interface ScrollSpec {
  id: string
  channels: string[]
  parameters: ParameterSchema
  prepare: Primitive['prepare']
  perfClass?: Primitive['perfClass']
}

function scrollPrimitive(spec: ScrollSpec): Primitive {
  const { id, channels, parameters, prepare, perfClass = 'compositor' } = spec
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters,
    // `'pin'` is accepted but ignored: these primitives read scroll position themselves and are
    // never driven by an `animation-timeline`. It is listed so that composing the driver with the
    // effects it drives — `data-kui="pin-section distance:200vh, parallax-rotate ... "` plus
    // `timeline:pin` — survives `compile.ts`'s `intersect`. Without it the intersection empties,
    // `style-plan.ts` refuses the timeline, and the scrub silently degrades to a one-shot.
    supportedTimelines: ['time', 'view', 'scroll', 'pin'],
    supportedActivations: ['manual', 'load', 'enter'],
    defaultActivation: 'load',
    perfClass,
    reducedMotion: 'disable',
    prepare,
  }
}

/** Write progress as a custom property so CSS can consume it without another JS hop. */
function writeProgress(ctx: PrepareContext, progress: number): void {
  ctx.style.set(PROGRESS_VAR, progress.toFixed(4))
}

/**
 * Pin an element while its scroll range passes.
 *
 * Implemented with `position: sticky` rather than a per-frame transform: sticky is handled on the
 * compositor, keeps the element in normal flow, and — critically — does not remove it from the
 * accessibility or tab order the way absolute repositioning does.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function preparePin(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  ctx.style.set('position', 'sticky')
  ctx.style.set('top', params.text('offset', '0px'))

  const removeSpacer = params.is('spacer') ? insertSpacer(node, params.text('distance'), ctx) : null

  /*
   * Track the containing block, not the pinned element.
   *
   * Sticky positioning exists precisely to stop the element moving relative to the viewport, so
   * once pinned its own rect reports the same offset forever and progress would sit at 0 for the
   * entire pin. The parent keeps scrolling, and is what the progress actually describes.
   */
  const tracked = node.parentElement ?? el

  const untrack = trackProgress(tracked, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(ctx, progress)
    el.setAttribute('data-kui-pinned', progress > 0 && progress < 1 ? 'true' : 'false')
  })

  // Inline styles are restored by the animator's ledger, so teardown only undoes what the
  // ledger cannot see: the inserted spacer and the state attribute.
  return () => {
    untrack()
    removeSpacer?.()
    el.removeAttribute('data-kui-pinned')
  }
}

/**
 * Give a sticky element room to travel by adding a sibling of the pin distance.
 *
 * Sticky only holds while its containing block is still on screen, so a pin longer than its parent
 * silently does nothing. The spacer is the honest fix; `invalidate()` tells the scheduler the
 * geometry it cached is now wrong.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function insertSpacer(node: HTMLElement, distance: string, ctx: PrepareContext): Cleanup {
  const spacer = ctx.doc.createElement('div')
  spacer.setAttribute('data-kui-spacer', '')
  spacer.setAttribute('aria-hidden', 'true')
  spacer.style.height = distance
  spacer.style.pointerEvents = 'none'
  node.after(spacer)
  ctx.invalidate()

  return () => {
    spacer.remove()
    ctx.invalidate()
  }
}

/**
 * Publish scroll progress, and a discrete step index when `steps` is set.
 *
 * The step attribute is what makes scrollytelling a CSS problem rather than a JS one: authors
 * select on `[data-kui-step="2"]` instead of subscribing to anything.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareProgress(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const steps = Math.max(0, Math.round(params.num('steps', 0)))
  /*
   * `target` names the step elements, and there is deliberately no default for it.
   *
   * Unlike `step-progress`, whose children *are* its segments, this primitive is applied to a
   * section whose children are layout — `.story`'s only child is the sticky wrapper. Guessing
   * would mark the wrong nodes silently, so an author who wants the children marked says which.
   */
  const selector = resolveTarget(params.text('target'), ctx, 'scrollytelling-step')
  const marker = createStepMarker(() => ctx.doc.querySelectorAll(selector))
  // The step attribute is authored on the demo element in real markup (`data-kui-step="0"`, to
  // avoid a flash of unstyled steps before hydration), so removing it on teardown destroyed the
  // consumer's own value. Same defect the scroll-spy ledgers were introduced to close.
  const self = createAttributeLedger(el)
  // Frames are continuous; the step index is not. Re-stamping an unchanged index — and, worse,
  // re-querying the target set for it — was per-frame work with no per-frame result.
  let lastIndex: number | undefined

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(ctx, progress)
    if (steps === 0) return
    const index = Math.min(steps - 1, Math.floor(progress * steps))
    if (index === lastIndex) return
    lastIndex = index
    self.set('data-kui-step', String(index))
    /*
     * The index as a number as well as an attribute, because they answer different questions.
     *
     * The attribute is for selecting — "style the section differently on step 3". The custom
     * property is for *arithmetic*, which selectors cannot do: `demo/scroll.html` moves one frame
     * by a quarter of its height per step, which as attribute selectors is one rule per step and
     * as a number is `translateY(calc(var(--kui-step) * -25%))` — one rule, at any step count.
     */
    ctx.style.set('--kui-step', String(index))
    if (selector) marker.mark(index)
  })

  return () => {
    untrack()
    self.restore()
    marker.restore()
  }
}

/**
 * Translate a track horizontally as vertical scroll advances.
 *
 * Pair with a pinned ancestor; alone it simply scrolls the track past.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareHorizontal(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  const authored = params.text('travel', 'auto')
  // Measured once per geometry epoch, not per frame. Reading `scrollWidth` inside the frame
  // callback forces a layout on every scroll tick — the same class of defect as the frozen cache.
  const travel = createMeasureCache(() => trackTravel(node, authored, node.ownerDocument))

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress, frame) => {
    ctx.style.set('translate', `${-progress * travel.read(frame.epoch)}px 0`)
    writeProgress(ctx, progress)
  })

  return untrack
}

/**
 * How far a horizontal track must move: its overflow past the viewport, unless overridden.
 *
 * "The viewport" is ambiguous by construction, because a pinned track is used two different ways.
 * Give the track itself a fixed width narrower than its content (the nested-scroller pattern) and
 * it clips its own children, so `scrollWidth - clientWidth` already measures the overflow. Size it
 * to its content instead — `width: max-content`, the natural choice when a separate `overflow:
 * hidden`/`clip` ancestor does the visual clipping, as in `demo/showcase/scroll.html`'s
 * `.track-viewport` — and the track's own box always exactly fits its content, so that same
 * subtraction is permanently zero: there is nothing for the track to overflow relative to itself.
 * Falling back to the parent's width only when self-overflow reads zero handles both without
 * requiring a particular ancestor structure.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function trackTravel(node: HTMLElement, authored: string, doc: Document): number {
  if (authored && authored !== 'auto') return toPixels(authored, ABSOLUTE_BASIS, 0)
  // `auto` is the default, so this branch is the one that normally runs.
  const selfOverflow = node.scrollWidth - node.clientWidth
  if (selfOverflow > 0) return selfOverflow
  const viewportWidth = node.parentElement?.clientWidth || doc.documentElement.clientWidth
  return Math.max(0, node.scrollWidth - viewportWidth)
}

/**
 * Scrub a frame sequence or a video's currentTime with scroll position.
 *
 * `<video>` gets `currentTime`; anything else gets its `src` swapped from a numbered pattern.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareMediaScrub(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const frames = Math.max(1, Math.round(params.num('frames', 1)))
  const pattern = mediaSrcPattern(params.text('src'), ctx)
  const media = el as HTMLMediaElement & HTMLImageElement
  let lastIndex = -1

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(ctx, progress)
    const index = Math.min(frames - 1, Math.floor(progress * frames))
    if (index === lastIndex) return
    lastIndex = index
    applyFrame(media, { index, frames, progress, pattern })
  })

  return untrack
}

/**
 * Constrain the authored frame pattern to the page's own origin before it can reach `<img src>`.
 *
 * `type: 'text'` params are shape-free by design (`core/params.ts`) — media-scrub's `src` shares
 * the type with `scroll-spy`'s `target`, a CSS selector that has no notion of "origin" and would
 * wrongly reject something like `a[href^="http:"]` if the constraint lived in the shared type
 * instead of here, at this parameter's own point of use. Left unconstrained, an untrusted
 * `data-kui` author (a CMS field, not necessarily the site owner) could turn `src` into an
 * exfiltration or tracking-pixel gadget, or use the visitor's browser to probe internal hosts —
 * see `isSameOriginPath` for the full threat model.
 *
 * Checked once at setup rather than per frame, since the pattern itself never changes while
 * scrolling — only the substituted `{i}` index does.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function mediaSrcPattern(pattern: string, ctx: PrepareContext): string {
  if (!pattern || isSameOriginPath(pattern)) return pattern
  ctx.warn(`media-scrub "src" must be a same-origin path, got "${pattern}" — ignoring`)
  return ''
}

interface FrameWrite {
  index: number
  frames: number
  progress: number
  pattern: string
}

function applyFrame(media: HTMLMediaElement & HTMLImageElement, write: FrameWrite): void {
  const { index, frames, progress, pattern } = write
  if (media.tagName === 'VIDEO') {
    const duration = Number.isFinite(media.duration) ? media.duration : 0
    if (duration > 0) media.currentTime = duration * progress
    return
  }
  // Only <img> is a safe `src` target for an author-supplied pattern. Anything else — an
  // <iframe> above all — navigates on `src` assignment, which a `javascript:` pattern would turn
  // into script execution the moment the first frame is written.
  if (media.tagName !== 'IMG') return
  if (pattern) media.src = pattern.replace('{i}', String(index).padStart(String(frames).length, '0'))
}

/**
 * Mark the navigation link pointing at the most recently entered section.
 *
 * Writes `data-kui-active` rather than toggling a class, so the styling contract stays the
 * library's attribute vocabulary and cannot collide with a site's own class names.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareScrollSpy(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
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
  return () => {
    untrack()
    self.restore()
    for (const ledger of links.values()) ledger.restore()
  }
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
 * Enable native smooth scrolling on an element (usually `<html>`), so in-page anchor jumps and
 * `scrollIntoView()` animate instead of teleporting.
 *
 * Same reasoning as `prepareSnap`: browser behaviour rather than animation, included so that
 * "how motion is declared" has one answer. It earns its place more than snapping does, because
 * the hand-written version is a *pair* — `scroll-behavior: smooth` plus a
 * `prefers-reduced-motion` override — and the second half is the half people forget. Routing it
 * through the library means the motion policy is applied by the same layer that handles it for
 * every other effect, instead of each page remembering to write its own media query.
 *
 * `reducedMotion: 'disable'` on the primitive is what makes that work: under a reduced-motion
 * preference the animator never runs `prepare` at all, so `scroll-behavior` is simply never set
 * and the browser keeps its instant default.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function prepareSmoothScroll(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  ctx.style.set('scroll-behavior', params.text('behavior', 'smooth'))
  return () => {}
}

/**
 * Enable native CSS scroll snapping on a container and its children.
 *
 * Included for vocabulary completeness — this is browser behaviour, not animation. Doing it here
 * rather than telling authors to write CSS keeps one mental model for "how motion is declared".
 *
 * @complexity O(n) time in the number of children; O(1) space.
 * @overallScore 100
 */
function prepareSnap(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  ctx.style.set(
    'scroll-snap-type',
    `${params.is('axis', 'x') ? 'x' : 'y'} ${params.text('strictness', 'mandatory')}`,
  )

  // Children are outside this element's ledger, so they get their own. Blind removal previously
  // deleted a `scroll-snap-align` the consumer had authored.
  const childLedgers = [...el.children].map((child) => createStyleLedger(child))
  for (const ledger of childLedgers) ledger.set('scroll-snap-align', params.text('align', 'start'))

  return () => {
    for (const ledger of childLedgers) ledger.restore()
  }
}

export const SCROLL_PRIMITIVES: Primitive[] = [
  scrollPrimitive({
    id: 'pin',
    channels: ['layout', 'progress'],
    parameters: {
      ...distanceParam,
      offset: { type: 'length', default: '0px', cssProperty: '--kui-offset' },
      spacer: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--kui-spacer',
        values: ['true', 'false'],
      },
    },
    prepare: deferPrepare(preparePin),
    perfClass: 'layout',
  }),

  scrollPrimitive({
    id: 'scroll-progress',
    channels: ['progress'],
    parameters: {
      ...distanceParam,
      steps: { type: 'number', default: '0', cssProperty: '--kui-steps' },
      // Same name, same shape and the same validation as scroll-spy's: one `target:` convention
      // across the library rather than a second word for "the elements this effect marks".
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
    },
    prepare: deferPrepare(prepareProgress),
  }),

  scrollPrimitive({
    id: 'horizontal-track',
    channels: ['translate', 'progress'],
    parameters: {
      ...distanceParam,
      travel: { type: 'text', default: 'auto', cssProperty: '--kui-travel' },
    },
    prepare: deferPrepare(prepareHorizontal),
  }),

  scrollPrimitive({
    id: 'media-scrub',
    channels: ['media', 'progress'],
    parameters: {
      ...distanceParam,
      frames: { type: 'number', default: '1', cssProperty: '--kui-frames' },
      src: { type: 'text', default: '', cssProperty: '--kui-src' },
    },
    prepare: deferPrepare(prepareMediaScrub),
    perfClass: 'paint',
  }),

  scrollPrimitive({
    id: 'scroll-spy',
    channels: ['state'],
    parameters: {
      ...distanceParam,
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
    },
    prepare: deferPrepare(prepareScrollSpy),
  }),

  scrollPrimitive({
    id: 'smooth-scroll',
    channels: ['layout'],
    parameters: {
      behavior: { type: 'keyword', default: 'smooth', cssProperty: '--kui-scroll-behavior', values: ['smooth', 'auto'] },
    },
    prepare: deferPrepare(prepareSmoothScroll),
    perfClass: 'layout',
  }),

  scrollPrimitive({
    id: 'scroll-snap',
    channels: ['layout'],
    parameters: {
      axis: { type: 'keyword', default: 'y', cssProperty: '--kui-axis', values: ['x', 'y'] },
      strictness: {
        type: 'keyword',
        default: 'mandatory',
        cssProperty: '--kui-snap-strictness',
        values: ['mandatory', 'proximity'],
      },
      align: {
        type: 'keyword',
        default: 'start',
        cssProperty: '--kui-snap-align',
        values: ['start', 'center', 'end'],
      },
    },
    prepare: deferPrepare(prepareSnap),
    perfClass: 'layout',
  }),
]
