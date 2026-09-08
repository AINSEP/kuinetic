import { CHANNEL } from '../../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { TIMELINE_AGNOSTIC, withTimingContract } from './shared.js'

/**
 * Static transforms (catalog section R).
 *
 * `background-media` (`media.ts`/`background-media.ts`) is this file's whole precedent, and reading
 * that primitive's own module doc first explains most of the choices below: it is the one existing
 * primitive that sets a persistent visual state rather than animating anything, and refuses
 * `duration`/`delay` because there is no motion for either to time. `rotate-static` is the same idea
 * applied to the simplest possible state — one CSS property, written once, on any element at all —
 * so it gets a section of its own rather than a slot in `media.ts` (nothing here touches media) or
 * `core.ts`'s `rotate` primitive (that one is an *entrance*: it animates from an authored angle down
 * to `0deg` and its keyframe is the whole point; this primitive never animates and the keyframe
 * would be empty).
 *
 * **Why this needs JavaScript at all**, when "write one CSS property once" sounds like the textbook
 * case for a bare stylesheet rule. A rule keyed on `[data-kui-fx~='rotate-static']` would have
 * nowhere to read the authored angle *from* — `--kui-static-angle` would have to be threaded onto
 * the element some other way, and the only mechanism this library has for turning an authored
 * `key:value` into an inline custom property on an arbitrary element is the JS-rendered path
 * (`applyStylePlan`). Every other CSS-keyframe primitive in the catalog already pays that cost by
 * animating — the custom property feeds a `@keyframes` block. This one has no keyframe to feed, so
 * writing it as `renderer: 'javascript'` and setting the resolved value straight onto `element.style`
 * (through the ledger, so teardown is free) is the smaller mechanism, not a bigger one.
 *
 * **Why `rotate:`, not `transform: rotate(...)`.** CSS's individual transform properties
 * (`translate`/`scale`/`rotate`) exist precisely so that independent transforms compose without one
 * clobbering another's shorthand — `entrance.css`'s `kui-rotate-in`/`kui-swing-in`/`ambient.css`'s
 * `kui-orbit` all write `rotate: var(--kui-to-angle, ...)`, never `transform:`. Writing `transform`
 * here instead would put this primitive on the `skew` channel (the one channel `transform`-writing
 * primitives share, see `core/types.ts`'s `CHANNEL.skew` doc) and make `rotate-static angle:45deg,
 * fade-up` collide with nothing while `rotate-static angle:45deg, scroll-skew` silently fought over
 * the whole shorthand — exactly the failure this catalog's individual-property convention exists to
 * avoid. `ctx.style.set('rotate', ...)` keeps this on `CHANNEL.rotate`, disjoint from `translate`,
 * `scale`, `opacity`, and every other channel a static tilt has no business colliding with.
 *
 * **Why `continuousSetup`, not a `TimedSetup`.** A tilt is a state the element sits in, not a move
 * it makes — identical reasoning to `background-media`'s own comment on this. Resolving `finished`
 * immediately would report `data-kui-state="finished"` from the first microtask onward for
 * something that has no end, which is the lie `EffectInstance.continuous` exists to prevent an
 * author from being told.
 *
 * **Why `reducedMotion: 'shorten'`, the same as `background-media`'s.** This slot previously read
 * `'disable'`, on the argument that "an element `rotate-static` never touches sits at its own
 * natural, unrotated orientation, which is not broken in any sense". Both halves of that turned out
 * to be false, and the second one is the reason the policy had to change.
 *
 * *It is not the element's own orientation.* `'disable'` is not "skip this primitive" — it is a
 * fact about the **element**, folded across every composed effect by `strictestPolicy`
 * (`core/compile.ts`) and implemented in `animator.ts`'s `openGate` by activating **nothing at
 * all**: the host is stamped `finished` and no effect on it ever runs. So `rotate-static angle:8deg,
 * count-up to:250` left the counter reading `0` forever, and `rotate-static, background-media`
 * produced exactly the no-backdrop page `background-media`'s own module doc rejects `'disable'` for.
 * A primitive that writes one property cannot be allowed to silence its neighbours, and the author
 * has no escape: `rm:` is a one-way ratchet (`core/compile.ts`'s `resolvedPolicy`) that may only
 * make a policy stricter, so `rm:shorten` warns and keeps `'disable'`.
 *
 * *And it is not "not broken".* `base.css`'s `[data-kui-rm='disable']` block writes
 * `rotate: none !important`, so the policy actively flattens an authored tilt from the stylesheet
 * side as well. This primitive is live on kuinetic.com at `angle:90deg` turning vertical credit
 * labels, where the rotation is **layout, not decoration** — removing it laid the label out
 * horizontally, overhanging its clipping container by 33.7px. A fixed 90° turn is not a vestibular
 * trigger. Nothing about it moves; there is no start state, no end state, and no frame in between.
 *
 * `'shorten'` is the honest remaining answer, and it is the right one twice over. It is what the
 * fold is *seeded* with (`mergeHostFacts` starts at `'shorten'`), so it is the identity element of
 * `strictestPolicy` — declaring it is this primitive saying "I impose no reduced-motion constraint
 * of my own", which is precisely true, and it leaves a composed neighbour's own declared policy
 * exactly as that neighbour declared it. And its own implementation is a no-op here by
 * construction: `[data-kui-rm='shorten']` clamps `animation-duration` to `1ms`, and this primitive
 * has no animation to clamp. One millisecond of nothing is nothing.
 *
 * The gap this exposes is real but is not this file's to close: `ReducedMotionPolicy`
 * (`core/types.ts`) is `'shorten' | 'crossfade' | 'disable'`, and all three presuppose there is
 * motion to soften. There is no value meaning "this primitive does not animate, so the question
 * does not arise". `'shorten'` is the closest existing spelling of that, and it is the same one
 * `background-media` — the catalog's other non-animating primitive — already settled on.
 */

/**
 * The `angle` default, meaning *the author wrote no `angle:` at all*.
 *
 * It has to be a sentinel rather than a real angle because nothing downstream can tell the two
 * apart otherwise: `readParams` (`core/js-params.ts`) prefills every declared parameter with its
 * `default` before it looks at what the author wrote, so with a `'0deg'` default
 * `params.text('angle')` reads `'0deg'` identically for a bare `rotate-static` and for an explicit
 * `rotate-static angle:0deg`. Those are different instructions — the second is "flatten this",
 * which must still be honoured — and only the schema default can distinguish them.
 *
 * The empty string is chosen over a word like `none` precisely because it is not a value: `none` is
 * real CSS for the `rotate` property and would invite the reading "write `rotate: none`", which is
 * the clobber this exists to prevent. Nothing validates a default (`validate` is only ever called
 * on authored text) and nothing reads it from a stylesheet (`resolveParams` emits authored
 * parameters only, never defaults), so an unvalidatable sentinel is safe in both directions.
 *
 * It doubles as the fallback for a *rejected* angle: `reject` in `core/params.ts` returns
 * `spec.default`, so `angle:banana` now warns and leaves the element alone instead of warning and
 * flattening it.
 */
const ANGLE_UNSET = ''

const rotateStaticParams: ParameterSchema = {
  /**
   * Same `type: 'angle'` as `rotate-in`'s own `angle:` (`core.ts`), deliberately — an author who
   * already knows `rotate-in angle:180deg` reaches for the identical spelling here, and both go
   * through the one `angle` grammar in `core/params.ts` (`45`, `45d`, and `45deg` all mean the
   * same thing; `rad`/`grad`/`turn` are accepted too).
   *
   * `cssProperty` is declared for schema-shape consistency — `ParamSpec.cssProperty` is a required
   * field — even though no stylesheet ever reads `--kui-static-angle`. `prepareRotateStatic` below
   * reads the validated value straight off `params.text()` and writes it through `ctx.style.set()`,
   * the same indirection `background-media`'s `src`/`focus`/`overlay` already use for a value that
   * is consumed entirely in JavaScript and never substituted into a `var()`.
   *
   * Defaults to *nothing written* rather than some small nonzero nudge (`rotate-in`'s `-8deg`,
   * `orbit`'s `360deg`): those defaults exist because the *bare* name is meant to look like
   * something on its own (an entrance nudge, a full spin). A bare `rotate-static` with no authored
   * angle has no canonical look to default to — any nonzero value would be an arbitrary visual
   * surprise for an author who typed the name to see what it does — so the honest default is a
   * no-op until `angle:` is written.
   *
   * This slot previously read `default: '0deg'` and called that "a documented no-op", which it was
   * not: `prepareRotateStatic` wrote it unconditionally, so `<div class="tilted"
   * data-kui="rotate-static">` on a stylesheet rule of `rotate: 12deg` visibly *un*-rotated the
   * moment the library started. An inline `rotate: 0deg` is not the element's rest state; it is an
   * override of it. See {@link ANGLE_UNSET} for why the fix is a sentinel and not a comparison.
   */
  angle: { type: 'angle', default: ANGLE_UNSET, cssProperty: '--kui-static-angle' },
}

/**
 * Set a fixed, persistent rotation on any element and leave it there.
 *
 * Deliberately the smallest possible JS-rendered primitive: one property, at most one write, no
 * observer, no synthetic DOM. `ctx.style` is the ledger (`core/owned-styles.ts`), so the write is
 * remembered and reversed on `reset()`/`destroy()` without this function's own cleanup having to do
 * anything — the same trust `prepareBackgroundMedia`'s `position`/`isolation` claims already place
 * in it.
 *
 * *At most* one write, because an unauthored `angle:` writes nothing at all. Writing is not free
 * here: an inline `rotate` outranks every stylesheet rule, so a bare `rotate-static` that wrote
 * `rotate: 0deg` would silently flatten a rotation the author had set in their own CSS. The ledger
 * would restore it on teardown, but the whole point of this primitive is that it does not tear
 * down. `angle:0deg` written explicitly is a different thing — a real instruction to flatten — and
 * still goes through. See {@link ANGLE_UNSET}.
 *
 * @param el - Any element. Nothing here assumes text, an image, or any other content shape.
 * @param params - Validated parameters; only `angle` exists.
 * @param ctx - Prepare context; only `ctx.style` is used.
 * @returns A continuous setup — see the module doc for why this never resolves `finished`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function prepareRotateStatic(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const angle = params.text('angle', ANGLE_UNSET)
  if (angle !== ANGLE_UNSET) ctx.style.set('rotate', angle)
  return continuousSetup(() => {})
}

export const TRANSFORMS_PRIMITIVES: Primitive[] = [
  {
    id: 'rotate-static',
    renderer: 'javascript',
    channels: [CHANNEL.rotate],
    parameters: rotateStaticParams,
    // An abstention, not a claim — this primitive never reads `Timeline` at all, the same reason
    // `background-media` spreads the same shared constant rather than naming `['time']` and
    // narrowing what a scrubbed neighbour on the same element may still request. See
    // `TIMELINE_AGNOSTIC`'s own doc (`effects/shared.ts`).
    supportedTimelines: TIMELINE_AGNOSTIC,
    // Same three `background-media` supports, and for the same reason: `'load'` is the default so
    // an element already on screen at load, sitting in a background tab, or still zero-area does
    // not wait on an `IntersectionObserver` that may never fire to be given its tilt. `'enter'` and
    // `'manual'` stay available for an author who deliberately wants the tilt to arrive later.
    supportedActivations: ['load', 'enter', 'manual'],
    defaultActivation: 'load',
    // Writes only the individual `rotate` transform property — compositor-only, no layout or paint
    // implication, the same class `parallax`'s `translate`-only write earns.
    perfClass: 'compositor',
    // Not `'disable'`, which activates nothing on the whole host and so silenced every composed
    // neighbour, and not because a fixed tilt is exempt from reduced motion — see the module doc.
    reducedMotion: 'shorten',
    // No timing tokens at all, and for a different reason than `background-media`'s: that primitive
    // is refused because it paints a backdrop instead of animating; this one is refused because it
    // writes its one property exactly once, synchronously, on activation — there is no later moment
    // a `delay` could push the write to, no span a `duration` could stretch it across, and no curve
    // an `ease` could bend a single write along.
    prepare: withTimingContract(
      'rotate-static',
      { because: 'it sets a fixed rotation once rather than animating, so there is no motion to time' },
      deferPrepare(prepareRotateStatic),
    ),
  },
]

export const TRANSFORMS_PRESETS: Preset[] = [{ name: 'rotate-static', primitive: 'rotate-static' }]

/**
 * Register catalog section R (static transforms) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 * @overallScore 100
 */
export function registerTransforms(registry: Registry): Registry {
  return registry.registerPrimitives(TRANSFORMS_PRIMITIVES).registerPresets(TRANSFORMS_PRESETS)
}
