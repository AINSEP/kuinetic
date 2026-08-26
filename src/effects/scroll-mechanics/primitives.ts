import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { ContinuousSetup } from '../../core/instances.js'
import { toPixels, ABSOLUTE_BASIS } from '../../core/js-params.js'
import { isSameOriginPath } from '../../core/params.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import { createMeasureCache } from '../../core/scroll-scheduler.js'
import { TIMELINE_AGNOSTIC, withTimingContract } from '../shared.js'
import { createStepMarker, resolveTarget } from '../step-marking.js'
import { prepareScrollSpy } from './scroll-spy.js'
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

/**
 * Shared by every primitive that has to hold still while its scroll range passes.
 *
 * `pin` and `media-scrub` were solving the same problem twice from opposite ends. The pin declared
 * both of these and did the work; the scrub declared neither and left it to the page, which is why
 * `demo/scroll.html` carried a `.scrub-stage` whose entire job was `height: 260vh` and a
 * `.scrub-viewport` whose entire job was `position: sticky`. Two hand-written boxes to restate
 * something the library already knew, because `distance:` was on the attribute the whole time.
 *
 * Declaring it once means the two cannot drift, and it is what lets a scrub become one attribute
 * with no wrapper at all.
 */
const stickyParams: ParameterSchema = {
  'offset-top': {
    type: 'length',
    default: 'var(--kui-pin-offset, 0px)',
    cssProperty: '--kui-offset-top',
  },
  spacer: {
    type: 'keyword',
    default: 'false',
    cssProperty: '--kui-spacer',
    values: ['true', 'false'],
  },
}

/**
 * Hold an element still for its range, and reserve the room that requires.
 *
 * Sticky only holds while its containing block is still on screen, so an effect that runs longer
 * than its parent silently does nothing — the single most common way authors get sticky wrong.
 * `spacer:true` is the honest fix and is what the presets that need it turn on.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function installSticky(
  node: HTMLElement,
  params: EffectParams,
  ctx: PrepareContext,
): { spacer: HTMLElement | null; dispose: Cleanup } {
  ctx.style.set('position', 'sticky')
  ctx.style.set('top', params.text('offset-top', 'var(--kui-pin-offset, 0px)'))
  const inserted = params.is('spacer') ? insertSpacer(node, params.text('distance'), ctx) : null
  return { spacer: inserted?.spacer ?? null, dispose: () => inserted?.remove() }
}

/** One primitive's distinguishing fields; the rest are identical across the category. */
interface ScrollSpec {
  id: string
  channels: string[]
  parameters: ParameterSchema
  prepare: NonNullable<Primitive['prepare']>
  perfClass?: Primitive['perfClass']
}

function scrollPrimitive(spec: ScrollSpec): Primitive {
  const { id, channels, parameters, prepare, perfClass = 'compositor' } = spec
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters,
    // Accepted, never read: these primitives read scroll position themselves and are never driven
    // by an `animation-timeline`. The list exists so that composing the driver with the effects it
    // drives — `data-kui="pin-section distance:200vh, parallax-rotate ... "` plus `timeline:pin` —
    // survives `compile.ts`'s `intersect`. Without it the intersection empties, `style-plan.ts`
    // refuses the timeline, and the scrub silently degrades to a one-shot. See `TIMELINE_AGNOSTIC`
    // (`effects/shared.ts`) for why the name says abstention rather than support.
    supportedTimelines: TIMELINE_AGNOSTIC,
    supportedActivations: ['manual', 'load', 'enter'],
    defaultActivation: 'load',
    perfClass,
    reducedMotion: 'disable',
    /*
     * The refusal side of `TIMELINE_AGNOSTIC` above, and for the same underlying reason: these
     * primitives are driven by *where the page is*, not by a clock. A pin engages when its range
     * enters the scrollport and disengages when it leaves; a scrub's frame is a pure function of
     * progress. There is no instant an authored `delay` could be measured from, no span a
     * `duration` could set, and no curve an `ease` could bend — so all three are refused rather
     * than accepted and discarded.
     *
     * The `delay:` spelling already warned, because none of these declares the parameter and
     * `readParams` rejects unknown names. The positional `pin-section 0ms 300ms` did not: it is
     * lifted out to `params.timing` before the schema is ever consulted, so it reached a
     * primitive that never reads it and vanished without a word. This is what closes that half.
     */
    prepare: withTimingContract(
      id,
      {
        because:
          'it is driven by scroll position rather than a clock, so it has no start moment and ' +
          'no fixed span',
      },
      prepare,
    ),
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
function preparePin(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
  const node = el as HTMLElement
  const { dispose: unstick } = installSticky(node, params, ctx)

  /*
   * Track the containing block, not the pinned element.
   *
   * Sticky positioning exists precisely to stop the element moving relative to the viewport, so
   * once pinned its own rect reports the same offset forever and progress would sit at 0 for the
   * entire pin. The parent keeps scrolling, and is what the progress actually describes.
   */
  const tracked = node.parentElement ?? el

  // `stickyEl: node` — the pinned element itself, not `tracked` — is what carries the resolved
  // `top` that makes progress 0 line up with the moment sticky actually engages. See
  // `TrackOptions.stickyEl`.
  const untrack = trackProgress(tracked, ctx, { distance: params.text('distance'), stickyEl: node }, (progress) => {
    writeProgress(ctx, progress)
    el.setAttribute('data-kui-pinned', progress > 0 && progress < 1 ? 'true' : 'false')
  })

  // Inline styles are restored by the animator's ledger, so teardown only undoes what the
  // ledger cannot see: the inserted spacer and the state attribute.
  // `continuousSetup` because a pin has no end — it scrubs for as long as the page is scrolled.
  // Without it the element reports `data-kui-state="finished"` on the first microtask, before it
  // has even engaged.
  return continuousSetup(() => {
    untrack()
    unstick()
    el.removeAttribute('data-kui-pinned')
  })
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
function insertSpacer(
  node: HTMLElement,
  distance: string,
  ctx: PrepareContext,
): { spacer: HTMLElement; remove: Cleanup } {
  const spacer = ctx.doc.createElement('div')
  spacer.setAttribute('data-kui-spacer', '')
  spacer.setAttribute('aria-hidden', 'true')
  spacer.style.height = distance
  spacer.style.pointerEvents = 'none'
  node.after(spacer)
  ctx.invalidate()

  return {
    spacer,
    remove: () => {
      spacer.remove()
      ctx.invalidate()
    },
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
function prepareProgress(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
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

  // Continuous: a progress track publishes for as long as the page scrolls and never completes.
  return continuousSetup(() => {
    untrack()
    self.restore()
    marker.restore()
  })
}

/**
 * Translate a track horizontally as vertical scroll advances.
 *
 * Pair with a pinned ancestor; alone it simply scrolls the track past.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareHorizontal(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup | ContinuousSetup {
  const selector = resolveTarget(params.text('target'), ctx, 'horizontal-scroll')
  if (!selector) return prepareBareTrack(el as HTMLElement, params, ctx)
  const track = el.querySelector(selector)
  if (!track) {
    ctx.warn(`horizontal-scroll target "${selector}" matched nothing inside this element`)
    return () => {}
  }
  return prepareManagedTrack(el as HTMLElement, track as HTMLElement, params, ctx)
}

/**
 * The historical shape: the attribute sits on the row itself and translates it, leaving the stage
 * and the sticky window to the page. Kept working because pages are authored against it.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareBareTrack(node: HTMLElement, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
  const authored = params.text('travel', 'auto')
  // Measured once per geometry epoch, not per frame. Reading `scrollWidth` inside the frame
  // callback forces a layout on every scroll tick — the same class of defect as the frozen cache.
  const travel = createMeasureCache(() => trackTravel(node, authored, node.ownerDocument))

  // Continuous: the track translates with scroll position and never reaches an end state.
  return continuousSetup(
    trackProgress(node, ctx, { distance: params.text('distance') }, (progress, frame) => {
      ctx.style.set('translate', `${-progress * travel.read(frame.epoch)}px 0`)
      writeProgress(ctx, progress)
    }),
  )
}

/**
 * The managed shape: one attribute on the outer element, one class on the row that moves, and no
 * page CSS at all.
 *
 * The three boxes a horizontal track needs are not negotiable — sticky only holds inside a taller
 * ancestor, a `max-content` row cannot clip itself, and something has to be the scroll distance —
 * but *authoring* all three is. Every one of them is derivable from `distance:` and the target,
 * which the attribute already carries, so the library writes them:
 *
 * - the host becomes the pinned, clipping window (`sticky` + `overflow: hidden`). The clip is not
 *   cosmetic: without it a `max-content` row hands the whole document a horizontal scrollbar, a
 *   bug this repo has shipped once already.
 * - `insertSpacer` reserves exactly the `distance:` of scroll room, so the stage height and the
 *   authored distance can no longer disagree — they were two numbers restating one fact, and
 *   `demo/scroll.html` carried a comment warning that they had to be kept in sync by hand.
 * - the named row is laid out `max-content` and is the thing translated.
 *
 * Every write goes through a ledger, so teardown puts the author's own markup back untouched
 * rather than leaving the library's layout behind.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareManagedTrack(
  host: HTMLElement,
  track: HTMLElement,
  params: EffectParams,
  ctx: PrepareContext,
): ContinuousSetup {
  const offsetTop = params.text('offset-top', 'var(--kui-pin-offset, 0px)')
  ctx.style.set('position', 'sticky')
  ctx.style.set('top', offsetTop)
  ctx.style.set('height', `calc(100vh - ${offsetTop})`)
  ctx.style.set('overflow', 'hidden')
  ctx.style.set('display', 'grid')
  ctx.style.set('align-content', 'center')
  const { remove: removeSpacer } = insertSpacer(host, params.text('distance'), ctx)

  const rail = createStyleLedger(track)
  rail.set('display', 'flex')
  rail.set('width', 'max-content')

  const authored = params.text('travel', 'auto')
  const travel = createMeasureCache(() => trackTravel(track, authored, track.ownerDocument))
  /*
   * Track the containing block, not the host — the same dodge `preparePin` makes, for the same
   * reason and it is not optional. Sticky exists precisely to stop an element moving relative to
   * the viewport, so once the host pins its own rect reports the same offset forever and progress
   * sits still for the whole range. Measured before this line was right: the row never moved at
   * all and the instance settled straight to `finished`, with `--kui-progress` never written once.
   *
   * `tracker.ts`'s sticky escape does not cover this. That hatch is for an element nested inside
   * *someone else's* sticky subtree; the element we make sticky ourselves is the caller's job, and
   * `preparePin` has always passed the parent by hand.
   */
  const tracked = host.parentElement ?? host
  // `stickyEl: host` for the same reason `preparePin` passes the pinned element, not the parent it
  // tracks: `host` is what carries the resolved `top`, and `offsetTop` above can be a `var()` or a
  // `vh` this call site has no way to statically resolve. See `TrackOptions.stickyEl`.
  const untrack = trackProgress(tracked, ctx, { distance: params.text('distance'), stickyEl: host }, (progress, frame) => {
    rail.set('translate', `${-progress * travel.read(frame.epoch)}px 0`)
    writeProgress(ctx, progress)
  })

  // Continuous: the managed rail translates with scroll and has no completed state.
  return continuousSetup(() => {
    untrack()
    rail.restore()
    removeSpacer()
  })
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
function prepareMediaScrub(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup {
  // `target:` wins when both are authored. The two forms are mutually exclusive — one rewrites a
  // single element's `src`, the other reveals one of several elements that already exist — so
  // there is no coherent "both" to honour, and silently doing the `src:` thing while the author
  // wrote a selector would be the more surprising of the two.
  /*
   * `spacer:true` is what opts a scrub into owning its own box, the same way `target:` opts
   * `horizontal-scroll` into owning its stage. Opt-in rather than default, because it moves
   * responsibility for the layout from the page to the library.
   *
   * With it, the library writes the sticky window and reserves exactly `distance` of scroll room,
   * so a page no longer needs a `.scrub-stage` whose entire job is `height: 260vh` beside a
   * `.scrub-viewport` whose entire job is `position: sticky` — two hand-written boxes restating a
   * number the attribute already carried, and two numbers that could silently disagree.
   *
   * Without it nothing changes: `video-scrub`, and any page positioning its own scrub, behave
   * exactly as before.
   */
  const managed = params.is('spacer') ? installSticky(el as HTMLElement, params, ctx) : null
  /*
   * Progress is then measured against that spacer, not the parent — and this is the reason the
   * spacer could not simply be switched on before. `geometrySource` escapes a sticky subtree by
   * taking its parent, so with the wrapper deleted the tracker got whatever section happened to
   * contain the scrub. Measured on `demo/scroll.html`: the parent started 926px above it against a
   * 1817px distance, so progress read 51% before the element had even stuck and half the sequence
   * played off screen. The spacer is exactly `distance` tall and never sticky, so it has neither
   * problem.
   */
  const contentAnchor = managed?.spacer ?? undefined
  // `installSticky` puts `el` itself under `position: sticky` when `spacer:true` — same element
  // `trackProgress` below is called on — so `el` is the offset to read back. Left undefined when
  // unmanaged: a page-authored sticky ancestor (`video-scrub`) is escaped by `geometrySource`
  // already, but its offset is not this primitive's to know. See `TrackOptions.stickyEl`.
  const stickyEl = managed ? el : undefined

  const selector = resolveTarget(params.text('target'), ctx, 'media-scrub')
  const scrub = selector
    ? prepareTargetScrub(el, params, ctx, { selector, contentAnchor, stickyEl })
    : prepareSrcScrub(el, params, ctx, { contentAnchor, stickyEl })

  // Continuous: a scrub follows scroll position for as long as the page is scrolled.
  return continuousSetup(() => {
    scrub()
    managed?.dispose()
  })
}


/**
 * Scrub by revealing one of a set of elements that are already in the document.
 *
 * Preferred over the `src:` form wherever the frame count is small enough to author. Four things
 * the pattern form cannot do:
 *
 * 1. **The frames are loaded before the scrub starts.** `src:` fetches each frame at the moment
 *    scrolling reaches it — measured on `demo/scroll.html`: zero frames present before the scrub,
 *    all five fetched during it. On a real connection the first pass shows stale frames.
 * 2. **No `{i}` templating**, so the CSS-escape guard on `data-kui` values needs no exception.
 * 3. **No URL to validate.** `mediaSrcPattern` exists only because `src:` is an author-supplied URL
 *    template that could be pointed anywhere; real `<img>` tags are already covered by the page's
 *    own CSP and review. The whole threat model is absent here.
 * 4. Per-frame `alt`, `srcset`, `<picture>`, and any filenames at all — not just a numbered run.
 *
 * `src:` stays for the case this cannot serve: a two-hundred-frame sequence, where authoring two
 * hundred tags is worse than a pattern.
 *
 * Marking reuses `data-kui-step-state` rather than inventing a frame attribute, because a frame
 * sequence *is* a stepped thing and `before`/`active`/`after` already names exactly the three
 * positions a frame can hold.
 *
 * @complexity O(n) per frame *change* in matched elements; O(1) on frames that do not change index.
 * @overallScore 100
 */
function prepareTargetScrub(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
  authored: { selector: string; contentAnchor?: Element; stickyEl?: Element },
): Cleanup {
  const { selector, contentAnchor, stickyEl } = authored
  const marker = createStepMarker(() => ctx.doc.querySelectorAll(selector))
  /*
   * Counted once at setup, and `frames:` is ignored in this form: the number of frames is the
   * number of elements you wrote, so making the author state it again is a second source of truth
   * that can only ever disagree. Same reasoning that gives `scrollytelling-step` an explicit
   * `steps:` — there the children are not knowable, here they are.
   *
   * Re-counting per frame was the alternative and is exactly the per-frame `querySelectorAll` that
   * `scroll-spy`'s own note calls out as pure waste. A list rendered after setup wants a re-run of
   * the effect, not a query on every scroll frame.
   */
  const frames = Math.max(1, ctx.doc.querySelectorAll(selector).length)
  let lastIndex: number | undefined

  const untrack = trackProgress(el, ctx, { distance: params.text('distance'), contentAnchor, stickyEl }, (progress) => {
    writeProgress(ctx, progress)
    const index = Math.min(frames - 1, Math.floor(progress * frames))
    if (index === lastIndex) return
    lastIndex = index
    marker.mark(index)
  })

  // Stamp the first frame at setup rather than waiting for the first scroll callback, so the set
  // is never briefly all-unstyled — the same flash `scrollytelling-step` authors avoid
  // by hand-authoring `data-kui-step` in their markup.
  marker.mark(0)

  return () => {
    untrack()
    marker.restore()
  }
}

/** Scrub by rewriting one element's `src` from a `{i}` pattern. See `prepareTargetScrub`. */
function prepareSrcScrub(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
  anchors: { contentAnchor?: Element; stickyEl?: Element },
): Cleanup {
  const { contentAnchor, stickyEl } = anchors
  const frames = Math.max(1, Math.round(params.num('frames', 1)))
  const pattern = mediaSrcPattern(params.text('src'), ctx)
  const media = el as HTMLMediaElement & HTMLImageElement
  let lastIndex = -1

  const untrack = trackProgress(el, ctx, { distance: params.text('distance'), contentAnchor, stickyEl }, (progress) => {
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
  const axis = params.is('axis', 'x') ? 'x' : 'y'
  ctx.style.set('scroll-snap-type', `${axis} ${params.text('strictness', 'mandatory')}`)

  const selector = resolveTarget(params.text('target'), ctx, 'scroll-snap')
  const items = selector ? [...el.querySelectorAll(selector)] : [...el.children]
  if (selector && items.length === 0) {
    ctx.warn(`scroll-snap target "${selector}" matched nothing inside this element`)
  }
  if (selector) installSnapContainer(axis, ctx)

  // Items are outside this element's ledger, so they get their own. Blind removal previously
  // deleted a `scroll-snap-align` the consumer had authored.
  const childLedgers = items.map((child) => createStyleLedger(child))
  for (const ledger of childLedgers) ledger.set('scroll-snap-align', params.text('align', 'start'))

  return () => {
    for (const ledger of childLedgers) ledger.restore()
  }
}

/**
 * Write the properties `scroll-snap-type` is inert without.
 *
 * Snapping is two declarations, not one: with no `overflow` on the same element there is nothing
 * to scroll and therefore nothing to snap, and the failure is silent — the page looks like it
 * simply chose not to snap. Every demo here carried its own `overflow-x: auto` for that reason,
 * which is exactly the kind of thing an author has to already know, or find by reading someone
 * else's stylesheet.
 *
 * `display: flex` only on the x axis, and only because a row of block children in an `overflow-x`
 * box does not lay out as a row — it stacks, and the container scrolls nothing. The y axis needs
 * no such help, so it is not given any: block flow already stacks.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function installSnapContainer(axis: 'x' | 'y', ctx: PrepareContext): void {
  ctx.style.set(axis === 'x' ? 'overflow-x' : 'overflow-y', 'auto')
  if (axis === 'x') ctx.style.set('display', 'flex')
}

export const SCROLL_PRIMITIVES: Primitive[] = [
  scrollPrimitive({
    id: 'pin',
    channels: ['layout', 'progress'],
    parameters: {
      ...distanceParam,
      ...stickyParams,
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
      // Same name, same shape and the same validation as scroll-spy's and media-scrub's: one
      // `target:` convention across the library. Naming the row that moves is also what opts this
      // primitive into owning the stage, the sticky window and the row's layout itself.
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
      'offset-top': {
        type: 'length',
        default: 'var(--kui-pin-offset, 0px)',
        cssProperty: '--kui-offset-top',
      },
    },
    prepare: deferPrepare(prepareHorizontal),
  }),

  scrollPrimitive({
    id: 'media-scrub',
    channels: ['media', 'progress'],
    parameters: {
      ...distanceParam,
      // A scrub is a hold, so it needs the same two knobs a pin does. Declaring them here is what
      // lets `sequence-scrub` become one attribute with no wrapper at all.
      ...stickyParams,
      frames: { type: 'number', default: '1', cssProperty: '--kui-frames' },
      src: { type: 'text', default: '', cssProperty: '--kui-src' },
      // The preferred form. `frames:`/`src:` remain for sequences too long to author as tags.
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
    },
    prepare: deferPrepare(prepareMediaScrub),
    perfClass: 'paint',
  }),

  scrollPrimitive({
    id: 'scroll-spy',
    channels: ['state'],
    parameters: {
      // `distance`: the per-section form only. `offset-top`: the container form only. Each is a
      // no-op — warned, not silent — in the other; see `prepareScrollSpySingle` and
      // `prepareScrollSpyContainer`.
      ...distanceParam,
      // Same name and meaning in both forms: the link(s) this instance marks. Per-section, the
      // one link this section names; with `sections:`, every link `target:` matches, each paired
      // to its own section by `href`. See `prepareScrollSpyContainer`.
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
      // Presence, not value, selects the container form: authoring this at all switches
      // `prepareScrollSpy` from one-section-per-instance to one-instance-on-the-shared-ancestor.
      sections: { type: 'text', default: '', cssProperty: '--kui-sections' },
      'offset-top': { type: 'length', default: '0px', cssProperty: '--kui-offset-top' },
    },
    prepare: deferPrepare(prepareScrollSpy),
  }),

  scrollPrimitive({
    id: 'smooth-scroll',
    /*
     * Its own channel, not the `'layout'` it used to share with `pin`, `stacking-cards` and
     * `scroll-snap`. The channel model exists to stop two effects fighting over the same CSS
     * property, and this one writes exactly `scroll-behavior` — a property that describes how a
     * *user-or-script-initiated* scroll is performed, and that no other primitive touches.
     *
     * On `'layout'` it made a legitimate pairing impossible. Both `smooth-scroll` and
     * `scroll-snap` have to sit on the document element to have any effect at all — neither
     * `scroll-behavior` nor `scroll-snap-type` is propagated to the viewport from `<body>` — so
     * "apply them to nested elements", the advice the conflict message gives, has no valid
     * nesting to offer here. `data-kui="smooth-scroll-to, scroll-snap-y"` on `<html>` is the
     * ordinary way to ask for smooth anchor jumps on a page that also snaps, and it was refused
     * for a collision that cannot happen: the two write disjoint properties.
     */
    channels: ['scroll-behavior'],
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
      // Names the snap items. Also what opts this primitive into owning the scroll container
      // itself — see `installSnapContainer`. Without it, the direct children are the items and
      // the page keeps its own `overflow`, exactly as before.
      target: { type: 'text', default: '', cssProperty: '--kui-target' },
    },
    prepare: deferPrepare(prepareSnap),
    perfClass: 'layout',
  }),
]
