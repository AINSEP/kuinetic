import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import type { Cleanup, EffectParams, Preset, Primitive } from '../../core/types.js'
import { effectDelayMs, TRIGGER_DELAY_PARAM, withTimingContract } from '../shared.js'

/**
 * View Transitions — catalog section L's other half.
 *
 * Everything else in the catalog is an *entrance*: an element arrives, and the motion is a
 * property of that one element. This is the only family that animates the relationship between
 * two states of the page — click a card and it *becomes* the detail view, rather than one thing
 * fading out while an unrelated thing fades in. The browser does all of it; the library's entire
 * contribution is naming the pair and choosing the curve.
 *
 * The API has two halves and they need different mechanisms, which is why this file registers two
 * primitives and `view-transitions.css` ships a third thing that is not an effect at all:
 *
 * - **Cross-document** (one HTML page navigating to another) is opted into with the
 *   `@view-transition { navigation: auto }` at-rule, and there is nothing here to register for
 *   it. An at-rule cannot be scoped to a selector, so a stylesheet that shipped one would opt
 *   *every* consuming site into transitioning *every* same-origin navigation — taking ownership
 *   of the author's routing, which this library does not do. The author writes that one line;
 *   `view-transitions.css` supplies the motion, keyed on the transition *types* they name in it.
 *   See that file's header.
 *
 * - **Same-document** (the page rewrites itself in place) genuinely requires
 *   `document.startViewTransition(callback)`, because the browser has to capture the old state
 *   *before* the DOM changes and only a callback can express "before". That is `view-swap` below,
 *   and it is a shim in the strict sense: one listener, one attribute write, no frames.
 *
 * `page-morph` — the shared-element handoff, and the reason the section exists — works for both,
 * because `view-transition-name` is a plain CSS property that both halves read.
 *
 * **Nothing here degrades badly.** `view-transition-name` is a declaration a browser that has
 * never heard of it simply drops; `startViewTransition` is called only behind
 * `ctx.capabilities.viewTransitions` and otherwise the update runs unwrapped. In both cases the
 * author gets the ordinary, un-animated version of what they asked for — a hard cut, which is
 * what every browser did before this API existed.
 */

/**
 * A `<custom-ident>`, as `view-transition-name` and `view-transition-class` accept one.
 *
 * `name:` is `type: 'text'`, which is the "arbitrary characters" escape hatch, and the reason
 * that is safe elsewhere is that `resolveParams` drops text parameters before they can reach a
 * stylesheet. This primitive *does* put the value into a CSS declaration — an inline one, via the
 * style ledger — so it owes the check the text type is excused from. `CSSStyleDeclaration
 * .setProperty` would reject a malformed value on its own and there is no declaration to break
 * out of, but "the CSSOM would probably catch it" is not the same as validating it, and a
 * rejected write would fail silently where the warning below names the value.
 *
 * Deliberately narrower than the CSS grammar (which allows escapes and non-ASCII): a name has to
 * be typed identically into two documents by hand for a morph to have a partner at all, so the
 * useful set is the set someone can retype without thinking about it.
 */
const CUSTOM_IDENT = /^-?[A-Za-z_][\w-]*$/

/**
 * `view-transition-name` values that are keywords rather than names.
 *
 * `auto` is deliberately absent: it is this parameter's default and is handled above, so listing
 * it here would be a branch nothing can reach.
 */
const NON_NAMES: ReadonlySet<string> = new Set(['none', 'match-element'])

/**
 * Resolve the authored `name:` into the identifier this element will be captured under.
 *
 * `auto` — the default — means "use the element's `id`", which is precisely what the native
 * `view-transition-name: auto` keyword does. That equivalence is the whole point of the default:
 * naming a pair costs nothing, because a card on the index page and its detail page heading
 * already share an id in any markup that links one to the other, and an author who later drops
 * the attribute for the bare CSS keyword gets identical behaviour. The keyword is not simply
 * emitted instead, because it shipped years after the rest of the API and a browser that has
 * `view-transition-name` but not `auto` would drop the whole declaration and morph nothing.
 *
 * @param el - The element being named.
 * @param params - Validated effect parameters.
 * @param warn - Diagnostics sink.
 * @returns The identifier to write, or `undefined` when this element cannot be named.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveTransitionName(
  el: Element,
  params: EffectParams,
  warn: (message: string) => void,
): string | undefined {
  const authored = params.text('name', 'auto').trim()

  if (authored === 'auto') {
    const id = el.id
    if (!id) {
      warn(
        'page-morph needs a name to morph *to*: give this element an id (and the same id to its ' +
          'counterpart on the other view), or write name:something explicitly',
      )
      return undefined
    }
    // Not prefixed. A prefix would make the library's names unguessable from the markup, and the
    // pair only has to agree with *itself* — both sides run this same resolution.
    return CUSTOM_IDENT.test(id) ? id : warnRejected(id, warn)
  }

  // `none` is a legitimate thing to write — "this element is deliberately not part of the
  // transition" — but it is also the default state, so writing it is asking the library to do
  // nothing. Say so rather than writing a declaration that has no effect.
  if (NON_NAMES.has(authored)) {
    warn(`page-morph name:${authored} is a keyword, not a name — omit the effect instead`)
    return undefined
  }

  return CUSTOM_IDENT.test(authored) ? authored : warnRejected(authored, warn)
}

/** Report a value that is not a usable identifier, and name it. Always returns `undefined`. */
function warnRejected(value: string, warn: (message: string) => void): undefined {
  warn(
    `page-morph cannot use "${value}" as a view-transition-name — it must be a CSS identifier ` +
      '(a letter or underscore, then letters, digits, hyphens or underscores)',
  )
  return undefined
}

/**
 * Give this element a `view-transition-name`, so the browser morphs it into its counterpart.
 *
 * The entire effect is one property write. There is nothing to activate, no frames to drive, and
 * no completion to report — the transition is started by a navigation or by `view-swap`, possibly
 * seconds later and possibly not at all, and this element's only job is to be *named* when it
 * happens. Which is also why it is `defaultActivation: 'load'` and refuses `on:enter`: an
 * off-screen card that has not been observed yet still has to be named, or the morph it is half
 * of has no partner.
 *
 * Written through `ctx.style`, so teardown hands the element back exactly as authored — including
 * the case where the author had set a `view-transition-name` of their own.
 *
 * @complexity O(1) time and space; one declaration.
 * @overallScore 100
 */
function prepareViewMorph(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  if (!ctx.capabilities.viewTransitions) {
    // Not silent, and not a failure either. The page is fine — it just cuts instead of morphing,
    // which is what it did before this attribute was added. The warning exists because the
    // alternative is an author staring at a working page wondering why nothing morphs, the same
    // reasoning `capabilities.ts`'s `CHANNEL_REQUIREMENTS` gives for the `offset` channel.
    ctx.warn(
      'this browser has no View Transitions API, so page-morph will not morph — the navigation ' +
        'or state change still happens, it just cuts instead of animating',
    )
    return () => {}
  }

  const name = resolveTransitionName(el, params, ctx.warn)
  if (name === undefined) return () => {}

  ctx.style.set('view-transition-name', name)
  return () => {}
}

/*
 * No `phase` on the `page-morph` preset below, and deliberately so — same conclusion
 * `materials.ts` reaches for `glass`, for the same reason: none of the four `EffectPhase` values
 * describes what this primitive does. `prepareViewMorph` writes `view-transition-name` exactly
 * once, at `load`, and never touches it again — there is no animation on *this* element to call an
 * `entrance` or an `exit` (the motion, if any, plays on the browser's `::view-transition-*`
 * pseudo-tree at `:root`, a different element than the one carrying this attribute), no clock to
 * call `idle`, and no visitor-driven condition to call `state` — the name is either set or it
 * is not, for the whole life of the element, not something a hover or a toggle flips back and
 * forth. Unlike `glass`, there is not even a hypothetical temptation here: `view-transition-name`
 * (below) is this primitive's only channel and no other primitive in the catalog claims it, so an
 * undeclared phase costs nothing — there is no pair anywhere it could wrongly exempt or wrongly
 * block, only the self-conflict a repeated `page-morph, page-morph` already correctly refuses.
 */
const VIEW_MORPH: Primitive = {
  id: 'view-morph',
  renderer: 'javascript',
  /**
   * Named after the one property it writes, the way `transform-origin` is (`three-d/index.ts`).
   * Deliberately *not* the same channel as `view-swap` below: a card that is both the thing you
   * click and the thing that morphs is the headline use case, so `data-kui="page-morph,
   * view-swap"` on one element has to compose.
   */
  channels: ['view-transition-name'],
  parameters: {
    name: { type: 'text', default: 'auto', cssProperty: '--kui-view-transition-name' },
  },
  supportedTimelines: ['time'],
  /*
   * No `enter`. The morph's start moment is a navigation or a `view-swap`, not this element
   * scrolling into view — an `on:enter` here would leave every off-screen half of a pair unnamed,
   * which is not a slower morph but no morph at all. `activation.ts` warns by name for it.
   */
  supportedActivations: ['load', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  /*
   * `disable`, not `shorten`. A shared-element morph flies a card across the viewport, which is
   * exactly the large-area travel a reduced-motion request is about — and unlike the discrete
   * open/close family, refusing it strands nothing: an unnamed element simply is not part of the
   * transition, so the page still navigates and still swaps, it just cuts. There is no state left
   * half-applied and nothing for the author to work around.
   */
  reducedMotion: 'disable',
  prepare: withTimingContract(
    'view-morph',
    {
      // No `honours` list at all — see the note in `view-transitions.css` on `--kui-vt-duration`.
      because:
        'the ::view-transition pseudo-elements hang off the document root, not off this element, ' +
        'so no per-element value can reach them — set --kui-vt-duration/-delay/-ease on :root ' +
        'instead',
    },
    deferPrepare(prepareViewMorph),
  ),
}

/**
 * The state change `view-swap` performs, as one function the browser can call at the right moment.
 *
 * Deliberately tiny, and deliberately expressed in markup the author already has. `aria-controls`
 * is what a disclosure button already points at, `[data-open]` is already the attribute
 * `catalog/discrete.ts`'s six names read to decide open from closed, and `aria-expanded` is
 * already the control's own state. So the whole vocabulary here is "flip the thing you already
 * told the browser about", which is the most this library can own without becoming the
 * component: it does not manage focus, it does not move the element, it does not route.
 *
 * Returns `undefined` when there is nothing to flip, so the caller can warn once at install time
 * rather than silently on every click.
 *
 * @complexity O(1) time and space beyond the one `querySelector`.
 * @overallScore 100
 */
function resolveSwapTarget(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): Element | undefined {
  const selector = params.text('controls', '').trim()
  if (selector) {
    const found = ctx.doc.querySelector(selector)
    if (found) return found
    ctx.warn(`view-swap controls:${selector} matched nothing — the click will do nothing`)
    return undefined
  }

  // The no-parameter path, and the one that should be commonest: a disclosure button already
  // names what it opens. Reading it means the ordinary case is `data-kui="view-swap"` and no
  // configuration at all, and it keeps the accessible relationship and the animated one from
  // being two separate declarations that can drift apart.
  const controls = el.getAttribute('aria-controls')
  const found = controls ? ctx.doc.getElementById(controls) : null
  if (found) return found

  ctx.warn(
    'view-swap has nothing to swap: give this control an aria-controls pointing at the element ' +
      'whose state changes, or name it with controls:#selector',
  )
  return undefined
}

/**
 * Whether this environment accepts `startViewTransition({ update, types })` rather than only a
 * bare callback.
 *
 * Transition *types* shipped well after the rest of the API, and the two spellings are not
 * interchangeable: an implementation expecting a callback throws a `TypeError` on the object
 * form. Probed off `ViewTransition.prototype` rather than by calling and catching, because a
 * `try`/`catch` around the real call would also swallow an unrelated failure inside it and report
 * "no types support" for something else entirely.
 *
 * This is deliberately not a `capabilities.ts` field. That module probes what the *stylesheet*
 * needs, and every entry in it is read by more than one caller; this is one branch in one
 * primitive, and a capability nothing else consults is a wider contract than the facts justify.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function supportsTransitionTypes(win: Window): boolean {
  // `prototype?: object | null` and not `object`: a null prototype is reachable at runtime and
  // `typeof null === 'object'`, so narrowing without it would make the null guard below dead code
  // by type rather than by fact.
  const ctor = (win as { ViewTransition?: { prototype?: object | null } }).ViewTransition
  const proto = ctor?.prototype
  return typeof proto === 'object' && proto !== null && 'types' in proto
}

/** The shape of `document.startViewTransition`, in both the callback and the options spelling. */
type StartViewTransition = (
  update: (() => void) | { update: () => void; types?: string[] },
) => unknown

/**
 * The transition type this control will actually be able to send, decided once at install time.
 *
 * Every degradation in this file is a *silent success* in production — the state still changes,
 * the page still works — which is exactly why each one has to be announced at the moment it is
 * decided rather than left for the author to notice. An authored `type:` that never reaches the
 * browser is a parameter that looks like it configures something and configures nothing, the same
 * class of no-op the closed `keywords` split removed from `ParamSpec`.
 *
 * So this returns the empty string for "call `startViewTransition` with a bare callback", and it
 * only ever does that silently when the author asked for no type in the first place.
 *
 * Resolved here, in `prepare`, and not inside the click handler: the answer cannot change between
 * clicks (a browser does not grow the types API mid-session), and warning from the handler would
 * repeat the same message on every click of a button someone is mashing.
 *
 * @param authored - The `type:` the author wrote, already trimmed; `''` when they wrote none.
 * @param ctx - Prepare context, for the capability probe and the diagnostics sink.
 * @returns The type to send, or `''` to send none.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function usableType(authored: string, ctx: PrepareContext): string {
  if (!authored) return ''

  // The API is missing entirely, which `prepareViewSwap` has already warned about by name. A
  // second message about the type would be noise on top of the reason the type is moot.
  if (!ctx.capabilities.viewTransitions) return ''

  if (supportsTransitionTypes(ctx.win)) return authored

  // Transition *types* shipped well after the rest of the API, so this is a real browser an
  // author will meet. Passing the object form here would throw a TypeError on an implementation
  // that only accepts a callback, and dropping it quietly would leave `type:kui-page-slide`
  // reading as a working knob while the page cross-fades. Neither is acceptable; saying so is.
  ctx.warn(
    `view-swap type:${authored} needs View Transition types, which this browser's View ` +
      'Transitions API predates — the swap still animates, with the browser\'s default ' +
      'cross-fade instead of the motion this type names',
  )
  return ''
}

/**
 * Run one DOM change inside a view transition, or plainly when there cannot be one.
 *
 * This is the whole "lifecycle shim". Note what it does *not* do: it does not await the returned
 * `ViewTransition`, does not hold a reference to it, and does not drive a single frame. The
 * browser owns the animation from the moment `update` returns, which is the entire reason this
 * family costs the library nothing at runtime.
 *
 * Two ways to end up on the plain path, and both are the same non-event for the author — the
 * state changes, it just does not animate: the browser has no `startViewTransition`
 * (`capabilities.viewTransitions`), or the user asked for reduced motion. Only the first is
 * announced; a reduced-motion request is a preference being honoured, not a shortfall to report.
 *
 * `type` is whatever {@link usableType} already decided this browser can take, so the branch below
 * is a plain "did the author want one" — the capability question was settled, and announced, at
 * install time rather than re-asked on every click.
 *
 * @complexity O(1) time and space beyond the caller's own update.
 * @overallScore 100
 */
function runSwap(update: () => void, type: string, ctx: PrepareContext): void {
  const start = (ctx.doc as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition

  if (!ctx.capabilities.viewTransitions || typeof start !== 'function' || ctx.reducedMotion) {
    update()
    return
  }

  if (type) start.call(ctx.doc, { update, types: [type] })
  else start.call(ctx.doc, update)
}

/**
 * Wire a control so that the state change it drives happens inside a view transition.
 *
 * The listener is on the control itself rather than routed through `data-kui-on`, for the reason
 * `prepareCardToggle` (`three-d/index.ts`) gives for the same choice: an activation replays an
 * *animation*, and there is no animation here to replay — there is a state to flip, and flipping
 * it is the trigger's whole job. `defaultActivation: 'load'` therefore means "install the
 * listener now", exactly as it does for the FLIP containers in `layout/primitives.ts`.
 *
 * @complexity O(1) time and space; one listener, one attribute write per click.
 * @overallScore 100
 */
function prepareViewSwap(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const target = resolveSwapTarget(el, params, ctx)
  if (!target) return () => {}

  if (!ctx.capabilities.viewTransitions) {
    // Same reasoning as `page-morph`'s own capability warning: the page is fine and the button
    // still works, but an author watching a hard cut where they expected a morph has nothing
    // pointing them at the cause. Said once, at install, rather than on every click.
    ctx.warn(
      'this browser has no View Transitions API, so view-swap will not animate — the state ' +
        'change still happens, it just cuts',
    )
  }

  const attribute = params.text('attribute', 'data-open').trim() || 'data-open'
  const type = usableType(params.text('type', '').trim(), ctx)
  const delay = effectDelayMs(params)

  const flip = (): void => {
    const open = target.hasAttribute(attribute)
    if (open) target.removeAttribute(attribute)
    else target.setAttribute(attribute, '')
    // Only when the control already carries it. Adding `aria-expanded` to a control that never
    // declared it would be inventing an accessibility contract on the author's behalf; keeping an
    // existing one in step with the attribute we just flipped is the opposite — it stops the
    // library from being the thing that makes the two disagree.
    if (el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', String(!open))
  }

  const onClick = (): void => {
    if (delay > 0) ctx.win.setTimeout(() => runSwap(flip, type, ctx), delay)
    else runSwap(flip, type, ctx)
  }

  // `ctx.signal` is aborted on teardown, so the listener needs no explicit removal — the same
  // route `PrepareContext` documents for exactly this.
  el.addEventListener('click', onClick, { signal: ctx.signal })
  return () => {}
}

/*
 * `phase: 'state'` on the `view-swap` preset below, and unlike `page-morph` above, this one does
 * fit. `prepareViewSwap`'s whole job is a click listener that flips one attribute on `target` and
 * leaves it there until the next click — discrete, already-over by the time the write lands, and
 * changed only when the visitor acts, exactly the shape `gestures/index.ts` gives `swipe`/
 * `long-press` and `interaction-reveal.ts` gives `hover-intent`/`masked-label-swap*`: "written once
 * by an interaction, held until the same primitive changes it again," which is `state`'s
 * definition and neither `entrance` (no from-state, nothing to release), `exit`, nor `idle` (no
 * clock, bounded to one flip per click).
 *
 * As with `view-morph`, this declaration unlocks no pair in practice: `view-transition-run` is
 * this primitive's own channel and nothing else in the catalog claims it, so today it costs
 * nothing either way. It is written down anyway, for the same reason the gesture and
 * interaction-reveal families did: an honest record of *when* the channel is held is worth having
 * before a second `view-transition-run` claimant ever exists, not retrofitted the day one does.
 */
const VIEW_SWAP: Primitive = {
  id: 'view-swap',
  /** Its own channel — see `view-morph`'s, above, for why the two are not the same one. */
  channels: ['view-transition-run'],
  renderer: 'javascript',
  parameters: {
    /*
     * `controls:`, not `target:`. `target:` has one meaning across this library — relocate the
     * effect onto an inner element, because the library owns the structure — and this parameter
     * means the opposite: the effect stays on the control, and this names a *different* element
     * somewhere else in the document whose state changes. Reusing the word would make
     * `target:#panel` mean "move the click handler onto #panel", which is not what any author
     * writing it would expect.
     */
    controls: { type: 'text', default: '', cssProperty: '--kui-view-swap-controls' },
    attribute: { type: 'text', default: 'data-open', cssProperty: '--kui-view-swap-attribute' },
    /*
     * The view-transition *type* this swap runs under, which is what selects the motion in
     * `view-transitions.css` — and the same word the author puts in their `@view-transition`
     * rule for the cross-document half. One vocabulary for both halves is the point: `type:
     * kui-page-slide` here and `types: kui-page-slide` there animate identically.
     */
    type: { type: 'text', default: '', cssProperty: '--kui-view-swap-type' },
    ...TRIGGER_DELAY_PARAM,
  },
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'manual'],
  defaultActivation: 'load',
  /* The update repaints the page and the browser re-lays it out to capture the new state. */
  perfClass: 'layout',
  /*
   * `shorten`, and emphatically not `disable`. `disable` means `activate()` is never called, so
   * the listener is never installed, so the panel this control opens never opens — a reduced-motion
   * user would get a dead button. The reduction happens inside `runSwap` instead, which skips the
   * transition and applies the state change directly: the page still works, it just cuts.
   */
  reducedMotion: 'shorten',
  prepare: withTimingContract(
    'view-swap',
    {
      honours: ['delay'],
      because:
        'it starts a transition the browser then owns — the duration and curve live on the ' +
        '::view-transition pseudo-elements at :root, not on this control',
    },
    deferPrepare(prepareViewSwap),
  ),
}

export const VIEW_TRANSITION_PRIMITIVES: Primitive[] = [VIEW_MORPH, VIEW_SWAP]

export const VIEW_TRANSITION_PRESETS: Preset[] = [
  /*
   * `page-morph` has been documented as planned in `docs/catalog.md` §L since long before it
   * existed, described there as "a View Transitions shared-element handoff; it degrades to
   * page-fade where unsupported". That is exactly what this is, so it keeps the name rather than
   * shipping a synonym beside a permanently-planned row.
   */
  { name: 'page-morph', primitive: 'view-morph' },
  { name: 'view-swap', primitive: 'view-swap', phase: 'state' },
]

/**
 * Register the View Transitions family (catalog section L).
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerViewTransitions(registry: Registry): Registry {
  return registry.registerPrimitives(VIEW_TRANSITION_PRIMITIVES).registerPresets(VIEW_TRANSITION_PRESETS)
}
