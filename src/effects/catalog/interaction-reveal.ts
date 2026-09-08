import type { ParameterSchema, Preset, Primitive, Renderer } from '../../core/types.js'
import { ALL_TIMING_TOKENS, stylesheetTimingPrepare } from '../shared.js'

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
 * `requiresOwnSubtree`, and `target:` relocates both cleanly: the inherited property simply flows
 * from wherever the fx attribute landed.
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
 * @param perfClass - Defaults to `'compositor'`, right for every member that only moves
 *   `opacity`/`translate`/`scale` (`label-swap`, `hover-intent`, `anchored-preview`). `search-expand`
 *   passes `'layout'` explicitly: its `inline-size` transition triggers reflow on every frame the
 *   way `opacity`/`translate` never do, and docs/design.md §13 is explicit that this has to be
 *   classified per effect rather than defaulted — an `inline-size` grow held to a compositor budget
 *   would be measuring the wrong cost.
 * @complexity O(1) time and space.
 */
function revealPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  perfClass: Primitive['perfClass'] = 'compositor',
): Primitive {
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass,
    reducedMotion: 'shorten',
    prepare: stylesheetTimingPrepare(id, {
      honours: ALL_TIMING_TOKENS,
      because: 'interaction.css pins that value on this effect',
    }),
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
 */
const hoverIntentParams: ParameterSchema = {
  duration: { type: 'time', default: '160ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '1000ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  distance: { type: 'length', default: '4px', cssProperty: '--kui-hover-intent-distance' },
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
  revealPrimitive('hover-intent', ['hint'], hoverIntentParams),
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
 * ### Why four preset names and not a `placement:` parameter
 *
 * The same reasoning `label-swap`'s own doc comment gives for its axis: CSS cannot branch on a
 * custom property's *value* without `@container style()`, which is not portable enough to build a
 * shipped effect on. A `placement:` keyword would have to be read by JavaScript, turning a pure
 * stylesheet effect into a JS one for the sake of one word. Four preset names cost nothing extra —
 * they share this one primitive's schema, timing namespace, reduced-motion policy and channel
 * claim — and it is how the rest of the catalog already spells "one mechanism, several fixed
 * shapes" (`masked-label-swap-x`/`-diagonal`, `card-flip-x`/`-y`, `flip-in-x`/`-y`).
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
 * derives, needs no `requiresOwnSubtree`, and `target:` relocates all four cleanly.
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
  revealPrimitive('anchored-preview', ['preview'], anchoredPreviewParams),
]

// `phase: 'state'`, the same reasoning as `HOVER_INTENT_PRESETS` above: a hover/focus reveal with
// no `transitions` field resolves to undeclared phase unless said here, and undeclared conflicts
// with everything.
export const ANCHORED_PREVIEW_PRESETS: Preset[] = [
  { name: 'anchored-preview', phase: 'state', primitive: 'anchored-preview' },
  { name: 'anchored-preview-bottom', phase: 'state', primitive: 'anchored-preview' },
  { name: 'anchored-preview-left', phase: 'state', primitive: 'anchored-preview' },
  { name: 'anchored-preview-right', phase: 'state', primitive: 'anchored-preview' },
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
    'layout',
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
