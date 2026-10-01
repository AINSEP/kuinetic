import { ATTR } from '../../core/attrs.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { frameScheduler } from '../../core/element-size.js'
import { deferredInstance } from '../../core/instances.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import { queryScoped, resolveTarget } from '../../core/target.js'
import { attributeChannel } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Preset,
  Primitive,
  Renderer,
} from '../../core/types.js'
import {
  ALL_TIMING_TOKENS,
  mirrorTimingToCss,
  stylesheetTimingPrepare,
  withTimingContract,
  type TimingContract,
} from '../shared.js'

/**
 * The two *two-box* effects of catalog section I — `masked-label-swap` and `hover-intent`.
 *
 * Section I's twenty-five earlier names all animate the element the name is written on, or one of
 * its own pseudo-elements. These two are the first that animate a piece of content *beside* the
 * trigger: a second copy of a label, or a hint that was not visible until you meant it. That is a
 * different shape, and it needs a mechanism section I had not used before, described in full at
 * `INHERITED_STATE` below.
 *
 * Their own file rather than more lines in `interaction.ts`, which sits on the 400-line lint
 * ceiling its own `HOVER_TRANSITIONS`/`COLOR_PARAMS` comments already record having hit — the same
 * split `interaction-states.ts` made for `press-depth`/`group-dim`, one family per file.
 *
 * Both are stylesheet effects in the same sense the hover family is: `renderer: 'javascript'` and a
 * near-no-op `prepare`, registered so the name parses, channel-conflicts and picks up authored
 * parameters, with the motion living as ordinary CSS in `interaction.css`. "Near"-no-op for the one
 * reason that file records — `stylesheetTimingPrepare` mirrors the *positional* timing spelling
 * (`hover-intent 160ms 1s`) onto the namespaced custom properties the rules read, because only the
 * `key:value` spelling gets there on its own.
 */

/**
 * ### `INHERITED_STATE` — how a hover state on one element reaches a rule on another
 *
 * The obvious way to write both of these effects is a descendant selector:
 * `[data-kui-fx~='hover-intent']:hover [data-kui-hint] { … }`. Neither one does, and the reason is
 * `target:`.
 *
 * `compile.ts`'s `liftTarget` relocates `data-kui-fx` onto whatever `target:` matches, and
 * `Preset.requiresOwnSubtree` is the flag that refuses relocation for a preset whose CSS reaches
 * past the element carrying it. `test/css-requires-own-subtree.test.ts` re-derives that set from the
 * shipped stylesheets rather than trusting the flags, so *any* rule of the form
 * `[data-kui-fx~='NAME']<combinator>…` forces `requiresOwnSubtree: true` on `NAME` — and that in
 * turn makes `target:` a no-op on it.
 *
 * For `group-dim` that trade is correct: the effect's subject genuinely is the container, and
 * relocating it onto one card would leave its rules hunting for grandchildren nobody wrote. For
 * these two it is exactly backwards. A real button is usually
 * `<button><svg/><span class="label">…</span></button>`, and pointing the swap at the label rather
 * than the whole button — `data-kui="masked-label-swap target:.label"` — is not an edge case, it is
 * the main way anyone will write this. Losing `target:` would lose the feature.
 *
 * So the state travels as an **inherited custom property** instead of through a selector. The host's
 * base rule sets `--kui-<x>-shown: 0` and its `:hover`/`:focus-visible` rules set it to `1`;
 * inheritance carries that down to the marked part, whose own rule — a *standalone*
 * `[data-kui-hint]` / `[data-kui-swap]` selector with no `[data-kui-fx~=…]` prefix at all — reads it
 * and computes its own `opacity`/`translate` from it. No rule in either family carries a combinator
 * after an fx compound, so neither name is in the re-derived reaching set, neither needs
 * `requiresOwnSubtree`, and `target:` relocates `masked-label-swap` cleanly: the inherited property
 * simply flows from wherever the fx attribute landed.
 *
 * `hover-intent` (and `anchored-preview`, further down) read `target:` the other way round: it
 * names the *part*, and the effect stays on the trigger. Moving a tooltip's effect onto its hint
 * would make the hint its own trigger with nothing inside it to reveal — see `claimPart`. The
 * standalone part rule matters there too: it is what lets a marker the library stamped and one the
 * page wrote be styled by the same rule.
 *
 * The library still owns every structural declaration — the grid stacking, the clip, the absolute
 * placement, the transition. The page contributes markup and no CSS, which is the standing contract.
 * The markup contribution is one attribute per part, the same shape `tilt-parallax` has always asked
 * for with `[data-depth]`.
 *
 * The delay rides the same channel, and that is what buys hover *intent* rather than a plain lag.
 * `--kui-<x>-lag` is `0ms` on the base rule and the authored delay on the state rules only, so the
 * part's `transition-delay` is read from the after-change style: entering the state arms a delayed
 * transition, and leaving before it elapses reverts the property, cancels the pending transition,
 * and nothing ever moves. That asymmetry is the whole file's convention (see `interaction.css`'s
 * opening comment) — here it is simply relayed one box further.
 */

/**
 * A CSS-driven two-box primitive: the registry row behind a rule pair in `interaction.css`.
 *
 * The same shape `interaction-states.ts`'s `statePrimitive` builds, and deliberately not a call to
 * it: that helper hardcodes one duration argument and no `distance`, and every member of
 * `interaction.ts`'s `HOVER_PRIMITIVES` is required by `catalog-interaction.test.ts` to ship a
 * matching `:hover` *and* `:focus-visible` rule on the *host*, which neither family here does — both
 * paint a second box. Registering separately is what `beam-border-auto` and both state effects
 * already do for the same reason.
 *
 * `reducedMotion: 'shorten'`, not `'disable'`: both are small, non-vestibular state changes, and
 * shortening a transition still lands it on its end value, so no resting state can be stranded —
 * the reasoning `base.css`'s own reduced-motion block records for the whole transition tier.
 *
 * @param id - Primitive id; also the namespace of the `--kui-<id>-duration/-delay/-ease` slots
 *   `registry.ts`'s `namespaceTiming` writes and `interaction.css` reads.
 * @param channels - CSS property groups this primitive claims, for the composition model.
 * @param parameters - The family's full schema, timing included.
 * @param options.perfClass - Defaults to `'compositor'`, right for every member that only moves
 *   `opacity`/`translate`/`scale` (`label-swap`, `hover-intent`, `anchored-preview`). `search-expand`
 *   passes `'layout'` explicitly: its `inline-size` transition triggers reflow on every frame the
 *   way `opacity`/`translate` never do, and docs/design.md §13 is explicit that this has to be
 *   classified per effect rather than defaulted — an `inline-size` grow held to a compositor budget
 *   would be measuring the wrong cost.
 * @param options.placed - The two families with a `place:` parameter pass how to find their part
 *   and which attribute carries the resolved side; see `PLACEMENT` below. Everything else stays a
 *   pure stylesheet effect.
 * @complexity O(1) time and space.
 */
function revealPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  { perfClass = 'compositor', placed }: { perfClass?: Primitive['perfClass']; placed?: PlacementSpec } = {},
): Primitive {
  const contract: TimingContract = {
    honours: ALL_TIMING_TOKENS,
    because: 'interaction.css pins that value on this effect',
  }
  return {
    id,
    renderer: 'javascript' as Renderer,
    // A placed family publishes the resolved side, and a running tease, on its host.
    channels: placed
      ? [...channels, attributeChannel(placed.attribute), attributeChannel(placed.tease)]
      : channels,
    parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass,
    reducedMotion: 'shorten',
    prepare: placed
      ? withTimingContract(id, contract, (el, params, ctx) =>
          deferredInstance(() => {
            mirrorTimingToCss(id, ALL_TIMING_TOKENS, params, ctx)
            return prepareReveal(el, params, placed, ctx)
          }),
        )
      : stylesheetTimingPrepare(id, contract),
  }
}

/**
 * ### `PLACEMENT` — `place:top|bottom|auto`, and the one piece of JavaScript it costs
 *
 * `label-swap`'s and `anchored-preview`'s doc comments both record why a placement *keyword* was
 * once refused: CSS cannot branch on a custom property's value without `@container style()`, so
 * the word has to be read by script. That is still true, and this is the script — kept to the one
 * job CSS genuinely cannot do, so the geometry itself stays in the stylesheet.
 *
 * The script never writes a length. It stamps the *resolved side* as an attribute on the host
 * (`data-kui-hint-place` / `data-kui-preview-place`), and `interaction.css` keys the geometry on
 * `[data-kui-fx][data-kui-…-place='…']`: a compound on the host itself, no combinator, so the
 * `INHERITED_STATE` contract above holds. The `[data-kui-fx]`
 * half lifts the rule to two attributes of specificity, which is what lets an explicit side beat
 * an `anchored-preview-left` preset rule regardless of source order.
 *
 * A fixed side is stamped once at activation. Measuring happens only when the part is about to be
 * seen: on `pointerenter`/`focusin`, the two events that precede every state the stylesheet reveals
 * on (`:hover`, `:focus-visible`, and the coarse-pointer `:active`, which a touch `pointerenter`
 * also precedes). While shown, a passive capture-phase `scroll` and a `resize` listener re-measure
 * at most once per frame, because the reader can scroll a hovered trigger into the viewport edge;
 * both are removed the moment neither hover nor focus remains. Nothing runs per frame while the
 * part is hidden. `auto` measures which side; every side, fixed or not, measures `SHIFT` below.
 *
 * The flip is along the preferred side's own axis only — top↔bottom, left↔right. Moving a
 * left-anchored preview to the top is a different layout, not a correction of this one.
 */
type Side = 'top' | 'bottom' | 'left' | 'right'

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

function isSide(value: string | null): value is Side {
  return value !== null && Object.hasOwn(OPPOSITE, value)
}

/** How one family finds its part, records its side, and decides which side it prefers. */
interface PlacementSpec {
  /** The primitive's id, for warnings. */
  name: string
  /** The attribute that marks the revealed part — authored, or stamped by `target:`. */
  marker: string
  /** Host attribute `interaction.css` keys the side's geometry on. */
  attribute: string
  /** Host attribute `interaction.css` opens the part on while a `tease:` runs. */
  tease: string
  /** Host custom property the part's cross-axis `translate` adds; see `SHIFT`. */
  shift: string
  /** The side `auto` tries first, before any measuring. */
  preferred(el: Element): Side
}

/**
 * Pick the side a part should sit on, given the room around its trigger.
 *
 * The preferred side wins whenever the part fits there. When it does not, the opposite side is
 * taken only if it has *more* room — not merely if it fits — so a part too big for either side
 * lands where the least of it is clipped rather than flipping to a side that clips more.
 *
 * @param preferred - The side to try first.
 * @param room - Free space, in CSS px, between each edge of the trigger and the viewport.
 * @param extent - How far the part reaches from the trigger along its axis, gap included.
 * @complexity O(1) time and space.
 */
export function chooseSide(preferred: Side, room: Record<Side, number>, extent: number): Side {
  if (room[preferred] >= extent) return preferred
  const opposite = OPPOSITE[preferred]
  return room[opposite] > room[preferred] ? opposite : preferred
}

/**
 * How far `part` reaches out of `host` on the side it currently sits on.
 *
 * From layout offsets, not `getBoundingClientRect`, on purpose: the rect includes the part's
 * `translate` nudge and `anchored-preview`'s sprung-from `scale`, both of which are mid-transition
 * or at their hidden values exactly when this runs. The offsets are the resting layout box, gap
 * included, which is the box that will be on screen. The host is the part's offset parent because
 * both host rules set `position: relative`. The extent is the same on either side of the axis,
 * which is what lets one measurement answer for the side the part is not on yet.
 *
 * @complexity O(1) time and space; reads layout.
 */
function extentOf(part: HTMLElement, host: Element, side: Side): number {
  switch (side) {
    case 'top':
      return -part.offsetTop
    case 'bottom':
      return part.offsetTop + part.offsetHeight - host.clientHeight
    case 'left':
      return -part.offsetLeft
    case 'right':
      return part.offsetLeft + part.offsetWidth - host.clientWidth
  }
}

type AttributeLedger = ReturnType<typeof createAttributeLedger>

/**
 * The script half of both families: mark a `target:`-named part, stamp the resolved side, keep
 * `auto` resolved while the part is on screen, and run a `tease:` once on first entry.
 *
 * @param params - Read for `target`, `place` and `tease`. Empty values (no schema behind the
 *   reader) are a no-op, as is the schema's own `tease` default of `0ms`.
 * @returns Teardown: cancels the tease, removes the listeners and restores every attribute it
 *   wrote, on the host and on the part.
 * @complexity O(1) per event; O(n) once in the host's descendants when `target:` is authored.
 */
function prepareReveal(
  el: Element,
  params: EffectParams,
  spec: PlacementSpec,
  ctx: PrepareContext,
): Cleanup {
  const release = claimPart(el, params, spec, ctx)
  const attrs = createAttributeLedger(el)
  const restore = (): void => {
    attrs.restore()
    release()
  }
  const place = params.text('place')
  const teaseMs = params.ms('tease', 0)
  const auto = place === 'auto'
  if (!auto && isSide(place)) attrs.set(spec.attribute, place)

  // Order is free: `auto` only flips along its own axis, so the shift's axis is the same either way.
  const placeSide = auto ? autoPlacer(el, spec, attrs, ctx.win) : undefined
  const shift = shifter(el, spec, ctx)
  const measure = (): void => {
    placeSide?.()
    shift()
  }
  let endTease = (): void => {}
  const shown = whileShown(el, ctx, measure, () => endTease())
  const tease =
    teaseMs > 0
      ? teaseOnEnter(el, ctx, { ms: teaseMs, attribute: spec.tease, attrs, shown })
      : undefined
  if (tease) endTease = tease.end
  return () => {
    tease?.stop()
    shown.stop()
    restore()
  }
}

/**
 * `target:` — name the part with a selector instead of marking it in the markup.
 *
 * `data-kui="anchored-preview-bottom target:.preview-img"` keeps the effect on the element that
 * carries `data-kui` (the trigger) and stamps the part's marker attribute (`data-kui-preview` /
 * `data-kui-hint`) on the first match inside it. Every rule in `interaction.css` keys the part on
 * that standalone attribute, so a stamped part and an authored one are the same thing to the
 * stylesheet — nothing there needed to change.
 *
 * Both primitives *declare* `target` for this reason. A primitive that does not has the key lifted
 * off by `compile.ts`'s `liftTarget`, which moves the whole effect onto the match — here that would
 * make the part its own trigger, with no part inside it, and nothing would ever show. Declaring the
 * parameter is the per-primitive opt-out `horizontal-track`, `scroll-spy` and `media-scrub` already
 * use for the same "`target:` names my inner participant" meaning.
 *
 * Searched inside the host only, and deliberately with no `scope:`: the part is positioned against
 * the host and reads the host's inherited state, so a match anywhere else could not work. One part
 * per host — a second match is refused out loud, the convention `horizontal-track` set for a
 * plural selector. An authored marker is left untouched, and the ledger restores exactly what was
 * there, so teardown removes only a marker this added.
 *
 * @returns The release that restores the part's marker — a no-op when `target:` is unset or matched
 *   nothing, where the authored marker is the part, as it always was.
 * @complexity O(n) time in the host's descendants, once; O(1) space.
 */
function claimPart(
  el: Element,
  params: EffectParams,
  spec: PlacementSpec,
  ctx: PrepareContext,
): Cleanup {
  const selector = resolveTarget(params.text('target'), ctx, spec.name)
  if (!selector) return () => {}
  const matches = queryScoped(el, ctx, selector, 'self')
  const part = matches[0]
  if (!part) {
    ctx.warn(`${spec.name} target "${selector}" matched nothing inside this element`)
    return () => {}
  }
  if (matches.length > 1) {
    ctx.warn(
      `${spec.name} target "${selector}" matched ${matches.length} elements; only the first is used`,
    )
  }
  const ledger = createAttributeLedger(part)
  if (!part.hasAttribute(spec.marker)) ledger.set(spec.marker, '')
  return () => ledger.restore()
}

/**
 * The `auto` measurement: stamps the preferred side now, and returns the re-check `whileShown`
 * runs each time the part is about to be seen.
 *
 * The part is searched by its marker each time, so a part named by `target:` is found the same way
 * as an authored one — `claimPart` has stamped the marker on it by then.
 *
 * @complexity O(n) time in the host's descendants per call (the marker lookup); reads layout.
 */
function autoPlacer(el: Element, spec: PlacementSpec, attrs: AttributeLedger, win: Window): () => void {
  const preferred = spec.preferred(el)
  let side = preferred
  attrs.set(spec.attribute, side)

  return (): void => {
    const part = el.querySelector<HTMLElement>(`[${spec.marker}]`)
    if (!part) return
    const rect = el.getBoundingClientRect()
    const room = {
      top: rect.top,
      bottom: win.innerHeight - rect.bottom,
      left: rect.left,
      right: win.innerWidth - rect.right,
    }
    const next = chooseSide(preferred, room, extentOf(part, el, side))
    if (next === side) return
    side = next
    attrs.set(spec.attribute, side)
  }
}

/**
 * ### `SHIFT` — keep the part inside the viewport along its cross axis
 *
 * `place:` picks the side; it cannot stop a part centred on a trigger near the viewport's edge from
 * running past that edge — a 234px preview on a word near the right of a 390px phone loses ~33px
 * to the page's `overflow-x: clip`. So whenever the part is about to be seen (the same measure
 * `whileShown` runs for `auto`), it is slid along the axis it is centred on — horizontally for
 * `top`/`bottom`, vertically for `left`/`right` — until it clears the edge by `VIEWPORT_MARGIN`.
 * The standard "shift" of tooltip libraries, on by default with no switch: a clipped tooltip is
 * never the intent.
 *
 * Like the side, the script hands the stylesheet one value and the geometry stays there: the shift
 * is a host custom property (`--kui-hover-intent-shift` / `--kui-anchored-preview-shift`) written
 * through `ctx.style`, the host's ledger, which teardown restores. The host, not the part, because
 * `anchored-preview`'s `-travel` is resolved on the host; and every host rule resets it to `0px`,
 * so a nested trigger never inherits an outer one's shift. It is left in place when the part hides,
 * so the exit transition does not slide sideways.
 *
 * @complexity O(1) time and space.
 */
const VIEWPORT_MARGIN = 8

/**
 * How far to move a span on one axis so it sits inside `[margin, viewport - margin]`.
 *
 * A span longer than that room cannot fit either way, so it is aligned to the start edge — the
 * reading edge, where its first words are.
 *
 * @param start - The span's start coordinate in the viewport, unshifted, in CSS px.
 * @param size - Its length on the same axis.
 * @param viewport - The viewport's length on that axis.
 * @returns The signed offset to add, `0` when it already fits.
 * @complexity O(1) time and space.
 */
export function shiftWithin(start: number, size: number, viewport: number, margin = VIEWPORT_MARGIN): number {
  const low = margin
  const high = viewport - margin
  if (start < low || size > high - low) return low - start
  if (start + size > high) return high - start - size
  return 0
}

/**
 * The `SHIFT` measurement, run on every measure `whileShown` makes.
 *
 * Measure the part's size in viewport coordinates, removing its entrance scale. Project its
 * resting anchor into that same space: the animated translate may still be catching up to a shift.
 * Mixing the host's viewport rect with unscaled layout offsets misses ancestor scales.
 * The result is converted back to local CSS px because the ancestor scales the shift too. The
 * viewport is the root's client box, excluding a classic scrollbar.
 *
 * @complexity O(n) time in the host's descendants per call (the marker lookup); reads layout.
 */
function shifter(el: Element, spec: PlacementSpec, ctx: PrepareContext): () => void {
  let written = 0
  return (): void => {
    const part = el.querySelector<HTMLElement>(`[${spec.marker}]`)
    if (!part) return
    const stamped = el.getAttribute(spec.attribute)
    const side = isSide(stamped) ? stamped : spec.preferred(el)
    const rect = part.getBoundingClientRect()
    const hostRect = el.getBoundingClientRect()
    const [startKey, sizeKey, offsetKey, borderKey, layoutKey, viewportKey, windowKey] =
      side === 'top' || side === 'bottom'
        ? ['left', 'width', 'offsetLeft', 'clientLeft', 'offsetWidth', 'clientWidth', 'innerWidth'] as const
        : ['top', 'height', 'offsetTop', 'clientTop', 'offsetHeight', 'clientHeight', 'innerHeight'] as const
    const hostSize = (el as HTMLElement)[layoutKey]
    const zoom = hostSize > 0 ? hostRect[sizeKey] / hostSize : 1
    if (zoom <= 0) return
    const entranceScale = parseFloat(ctx.win.getComputedStyle(part).scale) || 1
    const size = rect[sizeKey] / entranceScale
    const start = hostRect[startKey] + (el[borderKey] + part[offsetKey]) * zoom - size / 2
    const viewport = ctx.doc.documentElement[viewportKey] || ctx.win[windowKey]
    const next = shiftWithin(start, size, viewport) / zoom
    if (next === written) return
    written = next
    ctx.style.set(spec.shift, `${next}px`)
  }
}

/** What `whileShown` hands back: a third "shown" source for the tease, and teardown. */
interface ShownTracker {
  setTeasing(on: boolean): void
  stop: Cleanup
}

/**
 * Run `measure` when `el` starts being shown, and again (at most once per frame) on any scroll or
 * resize until it stops — the "no per-frame work while hidden" half of `PLACEMENT`.
 *
 * "Shown" is hovered, focused, or teasing. Focus moving between two of the host's own descendants
 * keeps it focused, which is why `focusout` checks `relatedTarget` instead of clearing the flag
 * outright. A tease counts so that `auto` measures *before* the teased part appears and keeps it
 * placed if the reader is still scrolling while it shows.
 *
 * @param onUser - Called when real hover or focus arrives, so a running tease can hand over.
 * @returns The tease switch and a teardown for the viewport listeners and any pending frame; the
 *   host's own listeners ride `ctx.signal`.
 * @complexity O(1) per event; O(1) space.
 */
function whileShown(
  el: Element,
  ctx: PrepareContext,
  measure: () => void,
  onUser: () => void,
): ShownTracker {
  const { win } = ctx
  const frame = frameScheduler(win, measure)
  let hovered = false
  let focused = false
  let teasing = false
  let watching: AbortController | undefined

  const sync = (): void => {
    const shown = hovered || focused || teasing
    if (shown && !watching) {
      measure()
      watching = new AbortController()
      const options = { capture: true, passive: true, signal: watching.signal }
      win.addEventListener('scroll', frame.request, options)
      win.addEventListener('resize', frame.request, options)
    } else if (!shown && watching) {
      watching.abort()
      watching = undefined
      frame.cancel()
    }
  }
  const on = (type: string, update: (event: Event) => void): void =>
    el.addEventListener(type, (event) => {
      update(event)
      sync()
    }, { signal: ctx.signal })

  on('pointerenter', () => {
    hovered = true
    onUser()
  })
  on('pointerleave', () => (hovered = false))
  on('focusin', () => {
    focused = true
    onUser()
  })
  on('focusout', (event) => {
    focused = el.contains((event as FocusEvent).relatedTarget as Node | null)
  })

  return {
    setTeasing(on) {
      teasing = on
      sync()
    },
    stop() {
      watching?.abort()
      frame.cancel()
    },
  }
}

/**
 * `tease:` — show the part once, unasked, the first time the host scrolls into view.
 *
 * Its own `IntersectionObserver`, not the animator's `on:enter` binder, for two reasons the binder's
 * shape decides. It is not reachable from `prepare` (it lives on the animator and is handed to no
 * primitive), and it keeps one observed binding *per element* — a second `bind` on the host would
 * evict the animator's own entry for that element. `background-media`'s `autoplayInView` records
 * the same choice. It is one observer per teasing host, and it disconnects on the first entry.
 *
 * The open state is a host attribute (`data-kui-hint-tease` / `data-kui-preview-tease`) that
 * `interaction.css` treats exactly like `:hover` with a zero lag, so the part arrives through the
 * family's own transition — and under reduced motion through the same 1ms one, so it still shows,
 * just without moving. Real hover or focus during the tease ends it early: the attribute comes off
 * while `:hover`/`:focus-visible` is already holding the part open, so nothing closes under the
 * reader's pointer, and it then closes when *they* leave rather than on the tease's timer.
 *
 * Threshold `0.5` of the host: a trigger is a word or a button, so half of it on screen means the
 * reader can see what the part is attached to. No observer in this realm means no tease — it is a
 * courtesy, and failing closed leaves the effect exactly as it was without one.
 *
 * @returns `end` (finish now, idempotent) and `stop` (teardown: observer and timer).
 * @complexity O(1) time and space.
 */
function teaseOnEnter(
  el: Element,
  ctx: PrepareContext,
  {
    ms,
    attribute,
    attrs,
    shown,
  }: { ms: number; attribute: string; attrs: AttributeLedger; shown: ShownTracker },
): { end(): void; stop: Cleanup } {
  const { win } = ctx
  let timer: number | undefined
  let observer: IntersectionObserver | undefined

  const end = (): void => {
    if (timer === undefined) return
    win.clearTimeout(timer)
    timer = undefined
    attrs.remove(attribute)
    shown.setTeasing(false)
  }
  const start = (): void => {
    // Measure first: `setTeasing` runs `auto`'s placement before the attribute reveals anything.
    shown.setTeasing(true)
    attrs.set(attribute, '')
    timer = win.setTimeout(end, ms)
  }

  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  if (Observer) {
    observer = new Observer(
      (entries) => {
        // The initial callback can intersect below the threshold; wait until half is visible.
        if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) return
        observer!.disconnect()
        start()
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
  }

  return {
    end,
    stop() {
      observer?.disconnect()
      if (timer !== undefined) win.clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * `label-swap`'s knobs.
 *
 * `distance` is `'length|percentage'` rather than plain `length` because the useful default is
 * `100%` — one full label-box of travel, so the outgoing copy clears the clip exactly as the
 * incoming one arrives — and a percentage here resolves against the part's own box, which is the
 * only measurement that keeps that true at any font size. Declaring the union is what says a
 * percentage is a *supported reading* rather than an accident of `length`'s unit list (see
 * `UnionParamType` in `core/types.ts`). A page wanting a subtler tease writes `distance:40%`; one
 * wanting a fixed travel writes `distance:1.2em`.
 *
 * Deliberately no `axis:` keyword. CSS cannot branch on a custom property's *value* without
 * `@container style()`, which is not portable enough to build a shipped effect on, so an axis
 * keyword would have to be read by JavaScript — turning a pure stylesheet effect into a JS one for
 * the sake of one word. The three axes are three preset names on this one primitive instead, which
 * is how the rest of the catalog spells the same thing (`card-flip-x`/`-y`, `flip-in-x`/`-y`,
 * `scroll-progress-bar`/`-y`) and costs the author nothing.
 */
const labelSwapParams: ParameterSchema = {
  duration: { type: 'time', default: '320ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  distance: {
    type: 'length|percentage',
    default: '100%',
    cssProperty: '--kui-label-swap-distance',
  },
}

/**
 * The masked label swap: two stacked copies of a label in a clipped box, one sliding out as the
 * other slides in.
 *
 * ### Markup
 *
 * ```html
 * <button data-kui="masked-label-swap">
 *   <span data-kui-swap="from">Download</span>
 *   <span data-kui-swap="to">Get the file</span>
 * </button>
 * ```
 *
 * Both copies are real elements with real text, not `::before`/`content` — a pseudo-element's
 * generated content cannot be selected, cannot be copied, cannot hold markup, and reaches assistive
 * technology inconsistently. For an effect whose entire subject is a *label*, that is the wrong
 * trade at any price, and it would also have burned one of the two contended pseudo boxes (see
 * `border-draw`'s channel note in `interaction.ts`).
 *
 * `from`/`to` rather than document order, so the pair reads the way a keyframe does and so an icon
 * or a `<span class="sr-only">` sitting between the two copies cannot silently reassign the roles.
 *
 * ### Why one effect covers two patterns
 *
 * The "old number slides out, upgraded number slides in" case is the same mechanism with numerals
 * in the two parts, so it needs no name of its own. What it does need is the `-y` axis, which is
 * why vertical is the unsuffixed default: a price or a count changing reads as a vertical roll,
 * where a call-to-action changing its wording reads better horizontally.
 *
 * ### Channels
 *
 * `discrete` because the host rule pins `display: inline-grid` to stack the two copies in one grid
 * cell — the same reason `split-flap`, `feedback-spin` and six others declare it (`display` is
 * tracked as one physical property regardless of the value written into it).
 *
 * `label-swap` is the box token for the marked parts, exactly parallel to `group-dim`'s `group`:
 * the properties this effect actually animates live on a *child* box, so filing them under
 * `translate` would make the compiler refuse `data-kui="lift, masked-label-swap"` — a button that
 * rises on hover while its label swaps — even though the two never touch the same box. Two
 * `masked-label-swap*` names on one host *are* refused, correctly: they share this primitive, so
 * they collide on every channel it declares, and they would fight over one `--kui-label-swap-dx`.
 */
export const LABEL_SWAP_PRIMITIVES: Primitive[] = [
  revealPrimitive('label-swap', ['discrete', 'label-swap'], labelSwapParams),
]

/**
 * Three axes, three names, one primitive — so all three share the `--kui-label-swap-*` timing
 * namespace, the schema, the reduced-motion policy and the channel claim, and differ only in the
 * two offset custom properties their own selector sets in `interaction.css`.
 *
 * No `transitions` field. `Preset.transitions` describes properties a preset eases *on its own host
 * box*, and the compiler spends them on the one `--kui-transition` property `base.css` applies to
 * the element carrying `data-kui-fx` — which here is the clip box, which does not move. The parts'
 * `translate` transition is authored directly on their own rule, the same way `group-dim`'s
 * children's is, and it is safe there for the same reason: nothing but this primitive can write to
 * `[data-kui-swap]`, because a second effect that did would be on the `label-swap` channel and
 * refused at compile time before it got there.
 *
 * No `requiresOwnSubtree` either, and that is load-bearing rather than an omission — see
 * `INHERITED_STATE` above for why these rules deliberately carry no combinator, and what `target:`
 * buys once they do not.
 */
export const LABEL_SWAP_PRESETS: Preset[] = [
  // `phase: 'state'` on all three, declared rather than inferred.
  //
  // `phaseOf` (`core/compile.ts:700`) resolves a preset to `state` on its own when it declares
  // `transitions` — and these deliberately do not, for the reason written at the top of this
  // file. So without this line they resolve to *undeclared*, and an undeclared phase conflicts
  // with everything: `fade-up, masked-label-swap` would be refused and the swap silently dropped,
  // which is the exact failure `Preset.phase` was added to end. A label swap is a response to a
  // hover or focus, never a thing that plays on arrival, so `state` is the honest claim.
  { name: 'masked-label-swap', phase: 'state', primitive: 'label-swap' },
  { name: 'masked-label-swap-x', phase: 'state', primitive: 'label-swap' },
  { name: 'masked-label-swap-diagonal', phase: 'state', primitive: 'label-swap' },
]

/**
 * `hover-intent`'s knobs.
 *
 * **`delay` defaults to `1000ms`, and that non-zero default is the entire effect.** Every other
 * `delay` in the catalog defaults to `0ms` for a reason `js-effect-timing.test.ts` states plainly:
 * `readEffectParams` fills every declared parameter, so a non-zero default is indistinguishable
 * from an authored value and would silently delay instances nobody asked to delay. That guard
 * covers primitives whose `defaultActivation` is `'enter'` — effects where the delay is a
 * modifier on something that would otherwise happen at once. Here it is not a modifier: an
 * unauthored `hover-intent` with a zero delay is not this effect at all, it is an ordinary
 * instant hover reveal, which is a different thing that should have a different name. A second's
 * rest is also roughly what desktop platforms have used for a tooltip since Windows 95, so the
 * default matches what a reader's hand already expects.
 *
 * `distance` is the small rise the hint makes as it arrives — plain `length`, not the
 * `'length|percentage'` union `label-swap` uses, because there is no box here a percentage would
 * usefully resolve against: the hint's travel is a fixed visual nudge, not a fraction of its own
 * height.
 *
 * **The card is the library's, and it is on by default.** `color`, `bg-color` and `radius` default
 * to a dark tooltip card (`#f4f4f0` on `#111111`, `12px` corners — the showcase page's card, which
 * was page CSS before these existed). That is a change to the unauthored look, made on purpose: a
 * hint with no surface is bare text floating over whatever is behind it, which no page wants, so
 * every page using this effect had to restate the same card. A page that styles its own hint still
 * wins without `!important` — this file's rules sit in `@layer kui.effects`, and an unlayered page
 * rule beats any layered one. `bg-color` is the owner's chosen spelling, not `bg` or `background`.
 *
 * `place` is `top` by default (where the hint has always gone); `bottom` pins it below, and `auto`
 * starts on top and flips below when the top does not fit the viewport — see `PLACEMENT`.
 *
 * `tease` shows the hint once, unasked, for that long the first time the trigger scrolls into view
 * — for a demo or an onboarding hint that would otherwise look like nothing is there. `0ms` (the
 * default) is off. It skips `delay` on purpose: the point is to be seen without a hand on the
 * trigger. See `teaseOnEnter`.
 */
const hoverIntentParams: ParameterSchema = {
  duration: { type: 'time', default: '160ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '1000ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  distance: { type: 'length', default: '4px', cssProperty: '--kui-hover-intent-distance' },
  color: { type: 'color', default: '#f4f4f0', cssProperty: '--kui-hover-intent-color' },
  'bg-color': { type: 'color', default: '#111111', cssProperty: '--kui-hover-intent-bg-color' },
  radius: { type: 'length', default: '12px', cssProperty: '--kui-hover-intent-radius' },
  // `place` and `tease` are read by `prepareReveal`, not by any stylesheet — see
  // `ParamSpecBase.cssProperty`.
  place: {
    type: 'keyword',
    default: 'top',
    keywords: ['top', 'bottom', 'auto'],
    cssProperty: '--kui-hover-intent-place',
  },
  tease: { type: 'time', default: '0ms', cssProperty: '--kui-hover-intent-tease' },
  // Names the hint, in place of a `data-kui-hint` in the markup — see `claimPart`. Declared, so
  // `compile.ts` leaves it here rather than moving the effect onto the hint.
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
}

/**
 * Hover intent: nothing happens until the pointer has *rested* for a second, and leaving early
 * cancels it outright.
 *
 * ```html
 * <button data-kui="hover-intent" aria-describedby="t1">Archive
 *   <span data-kui-hint id="t1" role="tooltip">Moves to Archive; nothing is deleted</span>
 * </button>
 * ```
 *
 * ### Why this is timing syntax and not a JavaScript primitive
 *
 * The question was live, and the answer turns on one fact about CSS transitions that is easy to
 * assume wrongly: **a `transition-delay` is not a timer that fires regardless.** The transition's
 * parameters are read from the element's *after-change* style, so when the pointer leaves before
 * the delay elapses, the property reverts, the pending transition is cancelled before it ever
 * started, and nothing at all was drawn. Cancel-on-early-leave — the half of hover intent that a
 * plain delay supposedly cannot express — is native behaviour, not something a script has to
 * supply. This file's `INHERITED_STATE` note explains the one extra step needed to get that
 * asymmetric delay onto a *second* box.
 *
 * The claim that `delay:` "starts its clock on the trigger and never cancels" is true, but of the
 * other tier: the library's own `on:hover` activation listens for `pointerenter`/`focusin` and has
 * no un-trigger (`core/activation.ts`), so a JS-activated effect really does keep its appointment
 * after the pointer has gone. That is a property of the activation, not of `delay:`, and the fix
 * for it is not a new primitive here.
 *
 * So the only thing genuinely missing was something *to* delay: section I had twenty-five names
 * that decorate the trigger and not one that reveals a companion, so `delay:` had nothing to be
 * hover intent *about*. This preset is that missing subject, and it is thirty lines of stylesheet.
 *
 * A JavaScript primitive would be the right answer for a different feature — **trajectory** intent,
 * the mega-menu heuristic that keeps a panel open while the pointer is moving *toward* it even
 * though it has technically left. That needs pointer history and a predicted path; no amount of
 * `transition-delay` expresses it, and it should be built when someone wants it rather than
 * smuggled in as the implementation of this one.
 *
 * ### Channels
 *
 * `hint`, its own box token, for the reason `group-dim` gives for `group`: the properties animate a
 * child box, so filing them under `opacity` would refuse `data-kui="fade-in, hover-intent"` — a
 * card that fades itself in and reveals a hint on rest — even though the two never touch the same
 * box.
 *
 * The hint is `pointer-events: none` in every state, deliberately. A revealed panel you can move
 * the pointer *into* is a menu, not a hint: it needs the pointer to be able to leave the trigger
 * without closing it, which is the trajectory problem above. Naming this one non-interactive keeps
 * it honest about which of the two it is.
 */
export const HOVER_INTENT_PRIMITIVES: Primitive[] = [
  revealPrimitive('hover-intent', ['hint'], hoverIntentParams, {
    placed: {
      name: 'hover-intent',
      marker: 'data-kui-hint',
      attribute: 'data-kui-hint-place',
      tease: 'data-kui-hint-tease',
      shift: '--kui-hover-intent-shift',
      preferred: () => 'top',
    },
  }),
]

// `phase: 'state'` for the same reason as the label swaps above — a dwell-triggered reveal is a
// response to a pointer state, and leaving it undeclared would make it refuse every entrance.
export const HOVER_INTENT_PRESETS: Preset[] = [
  { name: 'hover-intent', phase: 'state', primitive: 'hover-intent' },
]

/**
 * `anchored-preview`'s knobs. Every literal in `interaction.css`'s four placement rules appears
 * here with the same value as its `var()` fallback, per the owner's standing rule that every value
 * an author might reasonably want to change is a parameter.
 *
 * `distance` and `gap` are deliberately two different lengths rather than one: `distance` is how
 * far the preview *travels* while springing in (the motion), `gap` is how far it *rests* from the
 * trigger once arrived (the layout). Conflating them would mean a bigger spring also pushed the
 * resting position further away, which is not one request.
 *
 * `scale` is the "sprung from" starting size — `0.85` reads as a small pop rather than a fade, the
 * same visual language `masked-label-swap`'s travel and `hover-intent`'s rise use, just on a third
 * channel. Bounded `0..1`: above `1` is not "sprung from small," it is a preview that *overshoots*
 * on the way in, which is a different (and currently unbuilt) request best served by an easing
 * curve rather than this parameter.
 *
 * `color`, `bg-color` and `radius` default to *no change* — `currentcolor`, `transparent`, `0px` —
 * unlike `hover-intent`'s card. The preview is as often an `<img>` as a name tag, and a default
 * surface or rounding would restyle every image anyone has already anchored. They are there for
 * the name-tag case, so it no longer needs page CSS either.
 *
 * `place` takes all four sides plus `auto`, a superset of `hover-intent`'s `top|bottom|auto`,
 * because each placement preset below *is* a `place` value (`anchored-preview-left` carries
 * `params: { place: 'left' }`) — without `left`/`right` in the list those two presets could not
 * say what they are. `auto` keeps the preset's own side as the preferred one and flips along its
 * axis: `anchored-preview-right place:auto` falls back to the left, never to the top.
 */
const anchoredPreviewParams: ParameterSchema = {
  duration: { type: 'time', default: '220ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  distance: { type: 'length', default: '10px', cssProperty: '--kui-anchored-preview-distance' },
  gap: { type: 'length', default: '10px', cssProperty: '--kui-anchored-preview-gap' },
  scale: {
    type: 'number',
    default: '0.85',
    cssProperty: '--kui-anchored-preview-scale',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
  color: { type: 'color', default: 'currentcolor', cssProperty: '--kui-anchored-preview-color' },
  'bg-color': {
    type: 'color',
    default: 'transparent',
    cssProperty: '--kui-anchored-preview-bg-color',
  },
  radius: { type: 'length', default: '0px', cssProperty: '--kui-anchored-preview-radius' },
  // `place` and `tease` are read by `prepareReveal`, not by any stylesheet — see
  // `ParamSpecBase.cssProperty`. `tease` is `hover-intent`'s, unchanged: `0ms` is off.
  place: {
    type: 'keyword',
    default: 'top',
    keywords: ['top', 'bottom', 'left', 'right', 'auto'],
    cssProperty: '--kui-anchored-preview-place',
  },
  tease: { type: 'time', default: '0ms', cssProperty: '--kui-anchored-preview-tease' },
  // Names the preview, in place of a `data-kui-preview` in the markup — see `claimPart`.
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
}

/**
 * The side `anchored-preview place:auto` prefers: the one its preset name spells.
 *
 * Read from `data-kui-fx` because `auto` *replaces* the preset's own `place` value — the preparer
 * merges `{ ...preset.params, ...authored }` — so by the time `prepare` runs the preset's side is
 * gone from the parameters. The fx attribute is stamped before any JS effect prepares
 * (`animator.ts`'s `installMatch`), and two `anchored-preview*` names cannot share one host (they
 * collide on the `preview` channel), so the first match is the only one.
 *
 * @complexity O(t) time in the fx token count; O(t) space.
 */
function previewSideOf(el: Element): Side {
  for (const token of (el.getAttribute(ATTR.normalized) ?? '').split(/\s+/)) {
    const side = /^anchored-preview(?:-(bottom|left|right))?$/.exec(token)
    if (side) return (side[1] as Side | undefined) ?? 'top'
  }
  return 'top'
}

/**
 * A name tag springing out from an avatar on hover, and the same mechanism used to hover a word
 * and pop out an image beside it — one composite, four placements, not two effects.
 *
 * ### Markup
 *
 * ```html
 * <span data-kui="anchored-preview" class="avatar-wrap" tabindex="0">
 *   <img class="avatar" src="jane.jpg" alt="">
 *   <span data-kui-preview class="name-tag">Jane Doe</span>
 * </span>
 *
 * <span data-kui="anchored-preview-right" tabindex="0">a word
 *   <img data-kui-preview src="preview.jpg" alt="">
 * </span>
 * ```
 *
 * The trigger has to be its own focusable, hoverable element — an `<img>` cannot contain the
 * preview, which is why the avatar case wraps both in a `<span tabindex="0">` rather than putting
 * `data-kui` on the `<img>` itself. That is a real markup cost worth naming, and it is the same one
 * `hover-intent`'s own doc comment already pays for a tooltip's trigger.
 *
 * ### Why not CSS anchor positioning
 *
 * This is the textbook use case `anchor()`/`position-anchor` was built for, and it was considered.
 * The project's own planning notes record the owner dropping anchor positioning outright on
 * 2026-08-26, for a reason that is decisive here specifically: it is the only one of the "four
 * modern CSS techniques" listed there with a
 * *harmful* fallback — an unsupported `anchor()` puts the element in the *wrong* place rather than
 * a neutral one — and the two conditions set for reopening it (proof that an anchored position
 * transitions rather than snaps when the anchor moves, and materially better support than the
 * measured 84.12%) are both still open. So this reuses the mechanism `hover-intent` and
 * `masked-label-swap` already ship instead: the trigger's state and geometry travel as *inherited
 * custom properties*, computed once per placement and read by a genuinely generic standalone rule.
 * That mechanism needs no feature detection and no fallback branch, because it already works in
 * every browser the rest of the catalog does.
 *
 * ### Four preset names, and a `place:` parameter behind them
 *
 * The four names came first, for the reasoning `label-swap`'s own doc comment gives for its axis:
 * CSS cannot branch on a custom property's *value*, so a placement keyword has to be read by
 * JavaScript. `place:auto` — flip to whichever side fits the viewport — is a measurement CSS cannot
 * make at all, so that JavaScript now exists (`PLACEMENT`, above), and the names became four
 * spellings of `place:` (each preset carries its side in `params`). They stay because they are how
 * the rest of the catalog spells "one mechanism, several fixed shapes" (`masked-label-swap-x`,
 * `card-flip-y`), and because the stylesheet still places them before any script has run.
 *
 * `anchored-preview` (no suffix) is `top`, matching `hover-intent`'s own default placement for the
 * same reason: a name tag or a tooltip reads naturally above its trigger unless told otherwise.
 *
 * ### How placement reaches a standalone child rule without a combinator
 *
 * Each placement preset's own base rule (no state involved) sets two custom properties on
 * *itself* — `--kui-anchored-preview-inset` (the four-value `inset` shorthand for that side) and
 * `--kui-anchored-preview-travel` (the `translate` value combining the constant centering offset on
 * the cross-axis with the spring distance on the main axis, sign and axis already resolved). Both
 * are precomputed per placement so `[data-kui-preview]` itself stays fully generic: `position:
 * absolute; inset: var(--kui-anchored-preview-inset); translate: var(--kui-anchored-preview-travel)`
 * and nothing placement-specific. No rule anywhere carries a combinator after an fx compound, so
 * `anchored-preview` never enters the reaching-selector set `css-requires-own-subtree.test.ts`
 * derives and needs no `requiresOwnSubtree`.
 *
 * ### `target:` names the preview
 *
 * `data-kui="anchored-preview-bottom target:.preview-img"` needs no `data-kui-preview` in the
 * markup: the effect stays on the trigger and the library stamps the marker on the match, then
 * takes it off again on teardown — see `claimPart`.
 *
 * ### Channels
 *
 * `preview`, its own box token, for the reason `hint` and `label-swap` already state: the
 * properties animate a child box, so filing them under `opacity`/`translate`/`scale` would refuse
 * `data-kui="lift, anchored-preview"` — an avatar that lifts on hover while its name tag pops out —
 * even though the two never touch the same box. No pseudo-element is used at all (the tag/image is
 * real, selectable, copyable markup, the same reasoning `masked-label-swap`'s doc comment gives for
 * its own two copies), so this effect has zero pseudo-element collision cost.
 *
 * The preview is `pointer-events: none` in every state, for the identical reason `hover-intent`'s
 * hint is: a revealed panel the pointer can move *into* is a menu, which needs pointer-history
 * "trajectory intent" rather than this mechanism, and should be built when someone wants it rather
 * than smuggled in here.
 */
export const ANCHORED_PREVIEW_PRIMITIVES: Primitive[] = [
  revealPrimitive('anchored-preview', ['preview'], anchoredPreviewParams, {
    placed: {
      name: 'anchored-preview',
      marker: 'data-kui-preview',
      attribute: 'data-kui-preview-place',
      tease: 'data-kui-preview-tease',
      shift: '--kui-anchored-preview-shift',
      preferred: previewSideOf,
    },
  }),
]

// `phase: 'state'`, the same reasoning as `HOVER_INTENT_PRESETS` above: a hover/focus reveal with
// no `transitions` field resolves to undeclared phase unless said here, and undeclared conflicts
// with everything.
//
// Each suffixed name carries its side as `params.place`, so the schema's `top` default never
// overrides it in `prepare` — the preparer merges preset params under the authored ones.
export const ANCHORED_PREVIEW_PRESETS: Preset[] = [
  { name: 'anchored-preview', phase: 'state', primitive: 'anchored-preview' },
  {
    name: 'anchored-preview-bottom',
    phase: 'state',
    primitive: 'anchored-preview',
    params: { place: 'bottom' },
  },
  {
    name: 'anchored-preview-left',
    phase: 'state',
    primitive: 'anchored-preview',
    params: { place: 'left' },
  },
  {
    name: 'anchored-preview-right',
    phase: 'state',
    primitive: 'anchored-preview',
    params: { place: 'right' },
  },
]

/**
 * `search-expand`'s knobs. `collapsed`/`width` are `'length|percentage'` because a page laying this
 * out inside a flexible header is just as likely to want `width:100%` (fill whatever space is
 * available) as a fixed pixel value, and the union says a percentage is a supported reading rather
 * than an accident of `length`'s own unit list.
 */
const searchExpandParams: ParameterSchema = {
  duration: { type: 'time', default: '260ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  collapsed: {
    type: 'length|percentage',
    default: '2.5em',
    cssProperty: '--kui-search-expand-collapsed',
  },
  width: { type: 'length|percentage', default: '240px', cssProperty: '--kui-search-expand-width' },
}

/**
 * A search icon that grows into a full input field.
 *
 * ### Markup
 *
 * ```html
 * <label data-kui="search-expand">
 *   <svg aria-hidden="true">…</svg>
 *   <input data-kui-search-field type="search" placeholder="Search…">
 * </label>
 * ```
 *
 * The host is a `<label>`, not a `<div>`, and that is load-bearing rather than a styling
 * preference: clicking anywhere in a `<label>` — including the icon — natively focuses the
 * `<input>` it contains, with no JavaScript and no matching `for`/`id` pair, which is what lets a
 * collapsed, icon-only control still be a single click away from typing.
 *
 * ### Why this is not a FLIP job
 *
 * A reviewer ruled on this ahead of time (see this task's brief): a width/clip/intrinsic-size
 * transition is sufficient unless the field genuinely *relocates* between two layouts, and this one
 * does not — it grows in place. So the host's own `inline-size` is an ordinary, explicit-length CSS
 * transition (`Preset.transitions`, never a bare stylesheet `transition:` — seeing one there is
 * itself a failure `css-composition-invariants.test.ts`'s "transition channel" suite asserts
 * against), not a measure-before/measure-after/invert-and-play choreography. Both `collapsed` and
 * `width` are explicit lengths for the same reason `interpolate-size: allow-keywords` is not used
 * here at all: the project's own planning notes record that technique as deliberately deferred
 * pending Safari support, and reaching for it on a brand new effect would be an unsanctioned first
 * use of something the owner has already decided to wait on.
 *
 * ### How the input's fade reaches a standalone child rule without a combinator
 *
 * The same `INHERITED_STATE` mechanism `hover-intent` and `anchored-preview` (above) use, for the
 * identical reason: `[data-kui-fx~='search-expand'] input` would be a combinator after the fx
 * compound, forcing `requiresOwnSubtree` and making `target:` a no-op — and unlike `group-dim`,
 * there is no reason to want that here. So the host's `:focus-visible`/`:has(:focus-visible)`/
 * `:hover`/`:has(input:not(:placeholder-shown))` rules set `--kui-search-expand-shown` (0/1) and
 * `--kui-search-expand-lag` (0ms at rest, the authored delay once expanded — the same enter-only
 * asymmetry every hover-intent-shaped rule in this file uses), and the marked field reads both from
 * a *standalone* `[data-kui-search-field]` selector with no fx
 * prefix at all.
 *
 * ### Channels
 *
 * Three, because this primitive owns three distinct boxes' worth of properties: `expand` for the
 * host's own `inline-size` (a channel of its own, the same reasoning `skew`/`border` document —
 * no existing channel names this physical property, and folding it into `layout` would couple this
 * effect's fate to `header-shrink`'s unrelated `padding-block`/`font-size` claim); `discrete`
 * because the host pins `display: inline-flex` unconditionally, the same reason `split-flap` and
 * `masked-label-swap` declare it; and `search-field` for the inherited signals that feed the child
 * input's `opacity`, the same reasoning `hint`/`label-swap` give for their own child-box channels.
 */
export const SEARCH_EXPAND_PRIMITIVES: Primitive[] = [
  revealPrimitive(
    'search-expand',
    ['expand', 'discrete', 'search-field'],
    searchExpandParams,
    { perfClass: 'layout' },
  ),
]

// No explicit `phase` here, deliberately, unlike `ANCHORED_PREVIEW_PRESETS` above: `compile.ts`'s
// `phaseOf` already resolves a preset that declares `transitions` to `'state'` on its own (a
// transition has no clock and emits no animation track, so `'state'` is sound by construction).
// Declaring both would be a duplicate that can only drift — the day someone edits one and not the
// other, they disagree and the compiler follows whichever it reads first. `transitions` is the one
// to keep: it carries real information the phase alone doesn't (which property eases on the host
// box), and other machinery reads it directly.
export const SEARCH_EXPAND_PRESETS: Preset[] = [
  {
    name: 'search-expand',
    primitive: 'search-expand',
    // Through `Preset.transitions`, never a bare `transition:` in the stylesheet — see the primitive
    // doc comment above for why a raw shorthand here would be the exact bug `lift`/`border-glow` had.
    transitions: [{ property: 'inline-size' }],
  },
]

/** All four reveal-shaped families, for `interaction.ts`'s catalog-wide exports. */
export const REVEAL_PRIMITIVES: Primitive[] = [
  ...LABEL_SWAP_PRIMITIVES,
  ...HOVER_INTENT_PRIMITIVES,
  ...ANCHORED_PREVIEW_PRIMITIVES,
  ...SEARCH_EXPAND_PRIMITIVES,
]
export const REVEAL_PRESETS: Preset[] = [
  ...LABEL_SWAP_PRESETS,
  ...HOVER_INTENT_PRESETS,
  ...ANCHORED_PREVIEW_PRESETS,
  ...SEARCH_EXPAND_PRESETS,
]
