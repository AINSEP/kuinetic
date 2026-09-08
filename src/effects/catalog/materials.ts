import type { ParameterSchema, Preset, Primitive } from '../../core/types.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { TIMELINE_AGNOSTIC, withTimingContract } from './shared.js'

/**
 * Materials (catalog section S).
 *
 * A *material* is a resting surface treatment: what an element is made of, not what it does. The
 * catalog had no such section — every other one animates a change of state — and the gap showed
 * up as pages hand-writing glassmorphism in their own stylesheets beside a library that could not
 * name it. `rotate-static` (section R) and `background-media` (section G) are the two existing
 * primitives that also set a persistent state rather than animating, and most of the metadata
 * choices below are theirs; read `catalog/transforms.ts`'s module doc first if any of them look
 * surprising, because it argues the same points at length and this file does not repeat them.
 *
 * The rules themselves live in `src/css/glass.css`, which carries the visual reasoning — why the
 * rim is three border longhands rather than the `border` shorthand, why `saturate()` follows
 * `blur()`, why there is no pseudo-element. This file is the registry row and the parameter
 * grammar.
 *
 * ### What is deliberately *not* here
 *
 * **The rim light** — the travelling specular arc along the edge — is not a new effect. It is
 * `beam-border` / `beam-border-auto` (`catalog/interaction.ts`), which already spins a conic
 * gradient around a masked ring, given two new parameters (`arc:` and `softness:`) that turn its
 * hard four-stop ring into a soft partial arc. **The sheen sweep** is likewise `shine-sweep`,
 * given `angle:`, `width:` and `color:`. Both defaults are chosen so that every existing page
 * renders byte-identically; see `BEAM_PARAMS` and `SHINE_PARAMS` in `interaction-shared.ts`.
 *
 * **The press response** is `press-depth` (`catalog/interaction-states.ts`), composed rather than
 * reimplemented. It claims `scale` and `shadow`; this primitive claims `background` and
 * `backdrop`; the four are disjoint, so `data-kui="glass, press-depth"` compiles and both
 * run. That is checked in `test/catalog-materials.test.ts` rather than asserted here.
 *
 * **`glass-refract`** — warping the content behind at the panel's edges — was considered and cut.
 * It needs an SVG `feDisplacementMap` over live DOM, which no engine composites predictably, or a
 * WebGL renderer, which this library declares out of scope (see `docs/catalog.md`'s "Out of
 * scope" note). It is not a missing feature; it is a different product.
 *
 * ### Channels: `background` and `backdrop`
 *
 * `background` because the rules paint `background-color` and `background-image` on the host's own
 * unconditional rule, which is exactly what a channel claim is for — `ambient-tint` and
 * `text-shimmer` are on it for the same reason, and composing either with this one genuinely does
 * fight over the same declaration.
 *
 * `backdrop` is a new channel, holding `backdrop-filter` and its `-webkit-` twin. Folding those
 * into `filter` would have been the lazy answer and is wrong twice: they are different properties
 * that never overwrite each other (an element can carry both), so a shared channel would make the
 * compiler refuse `glass, blur` — blur your own content *and* the backdrop, which is a
 * coherent request — and it would let a future second `backdrop-filter` writer collide with this
 * one unflagged while `filter`'s existing members took the blame. Same reasoning `text-shadow`
 * records for staying out of `shadow`. See `test/support/channel-properties.ts`.
 *
 * Deliberately **not** `border`: the hairline rim is real `border-width`/`-style`/`-color`, but
 * claiming the channel would make the compiler refuse `glass, beam-border`, which is the
 * single pairing this family exists for. `glass.css`'s file comment explains why that is safe —
 * the three longhands leave `border-image` (the only channel-tracked border property, and
 * `border-draw`'s) untouched, which the `border` shorthand would not have.
 */

/**
 * The unset sentinel, meaning *the author wrote no value at all*.
 *
 * Identical in purpose to `COLOR_PARAMS`' empty defaults in `interaction-shared.ts` and to
 * `ANGLE_UNSET` in `transforms.ts`, and load-bearing for the same reason: `resolveParams` emits
 * only authored parameters, so an empty default guarantees *no declaration is written*, and
 * `glass.css`'s own `var(--kui-glass-rim, rgb(255 255 255 / 0.22))` fallback chain decides. A real
 * default here would seize the value from every author who never asked for one, and — worse for
 * `radius:` — would put an inline custom property in front of a page's own `border-radius`.
 */
const UNSET = ''

/**
 * `glass`'s knobs. Every literal in `glass.css` appears here with the same value as its
 * `var()` fallback, so the rules keep working untouched when nothing is authored.
 *
 * The design requirement this schema answers is total parameter control from the attribute —
 * `data-kui="glass opacity:0.8 blur:20px rim:silver"` has to work, and `0.8` and `80%`
 * have to mean the same thing. That is what `'number|percentage'` is for: it normalises the
 * percentage spelling to the number *before* validation, so `minimum`/`maximum` still bound the
 * parameter whichever way it was written (see `BOUNDED_TYPES` in `core/params.ts`).
 */
const glassParams: ParameterSchema = {
  /**
   * Backdrop blur radius.
   *
   * `length`, not `'length|percentage'`: a percentage in `blur()` is not valid CSS at all, so
   * declaring the union would advertise a spelling the browser drops on the floor.
   *
   * **Unbounded, knowingly.** `blur:400px` is accepted, and on a large panel it is genuinely
   * expensive — see this primitive's `perfClass` note. There is no way to bound it in the schema:
   * `maximum` applies only to `BOUNDED_TYPES` (`number` and `number|percentage`), because a length
   * has no single scale to compare against, and re-typing this as a unitless number to gain the
   * bound would break the one spelling every author already knows. Documented in
   * `docs/catalog.md` instead, which is where the cost belongs anyway.
   */
  blur: { type: 'length', default: '16px', cssProperty: '--kui-glass-blur' },
  /**
   * Backdrop saturation multiplier. `1` leaves the backdrop's colour alone; the `1.6` default
   * pushes it back up because the blur above has just averaged it toward grey.
   *
   * `minimum: 0` and no maximum: `saturate()` is defined for any non-negative value and the
   * over-driven look (`saturate:3`) is a legitimate one. Negative is not — CSS clamps it silently,
   * which is exactly the kind of accepted-then-ignored value the schema exists to name out loud.
   */
  saturate: {
    type: 'number|percentage',
    default: '1.6',
    cssProperty: '--kui-glass-saturate',
    finite: true,
    minimum: 0,
  },
  /**
   * How opaque the tint is. Bounded to 0..1 because it is an alpha, and `glass.css` spends it as
   * the mix percentage in a `color-mix()` — a value outside the range would clamp there anyway,
   * silently, which is worse than a warning naming the parameter.
   */
  opacity: {
    type: 'number|percentage',
    default: '0.12',
    cssProperty: '--kui-glass-opacity',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
  /**
   * The colour the tint is mixed from — the glass itself, before {@link glassParams.opacity}
   * decides how much of it shows. White on a dark page, near-black on a light one.
   */
  tint: { type: 'color', default: UNSET, cssProperty: '--kui-glass-tint' },
  /**
   * The hairline rim colour, which is also the sheen's colour by fallback — one light source lights
   * both, so `rim:silver` recolours the edge and the highlight together. `glass.css`'s
   * `--kui-glass-sheen-color` is the hand-set property for anyone who wants them to disagree.
   *
   * Its own `var()` fallback carries an alpha (`rgb(255 255 255 / 0.22)`), so an author writing a
   * bare keyword — `rim:silver` — gets a fully opaque hairline. That is the literal request and is
   * left alone rather than second-guessed with a `color-mix`; an author who wants it faint writes
   * the alpha themselves, which the `color` type accepts in every CSS spelling.
   */
  rim: { type: 'color', default: UNSET, cssProperty: '--kui-glass-rim' },
  /** Hairline thickness. Its own parameter rather than folded into `rim:`, because there is no
   *  colour type that carries a width and inventing one would mean parsing the `border` grammar. */
  'rim-width': { type: 'length', default: '1px', cssProperty: '--kui-glass-rim-width' },
  /**
   * Strength of the top-weighted sheen gradient, as an alpha on the rim colour. `0` removes it and
   * leaves a flat tinted panel, which is the right base for a surface that composes `shine-sweep`
   * for its highlight instead.
   */
  sheen: {
    type: 'number|percentage',
    default: '0.16',
    cssProperty: '--kui-glass-sheen',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
  /**
   * Corner radius. `'length|percentage'` because both are real readings here and neither can be
   * normalised into the other — `radius:50%` resolves against a box this code has not measured.
   *
   * This is what makes one primitive cover both halves of the reference: `glass` is a
   * panel, and `glass radius:999px` is a pill. A second preset for the pill would be a
   * near-duplicate name for a one-value difference, which is the thing this catalog's
   * one-primitive-many-names shape exists to avoid.
   *
   * {@link UNSET} rather than `'16px'` for the reason that constant documents: an authored value
   * becomes an *inline* custom property, and defaulting it would put the library's opinion in
   * front of a page that already set its own `border-radius`. Unauthored, `glass.css`'s own 16px
   * fallback applies from inside `@layer kui.effects`, which any unlayered page rule beats.
   */
  radius: { type: 'length|percentage', default: UNSET, cssProperty: '--kui-glass-radius' },
}

/**
 * The primitive's `prepare`: nothing at all, deferred.
 *
 * Every parameter above reaches `glass.css` on its own — `resolveParams` (`core/compile.ts`)
 * writes each authored `key:value` to its `cssProperty` as an inline custom property for every
 * renderer, not just `css-keyframes` — so there is no value for JavaScript to thread anywhere and
 * no element to touch. This exists purely so the name parses, stamps `data-kui-fx`, takes part in
 * channel-conflict detection, and honours an author's `on:` activation.
 *
 * Deliberately *not* `stylesheetTimingPrepare`, which the hover family uses: that helper exists to
 * mirror the *positional* timing spelling (`lift 400ms`) onto namespaced properties, and there is
 * no timing here to mirror. {@link MATERIALS_PRIMITIVES} wraps this in `withTimingContract` with
 * an empty `honours` list instead, so `glass 400ms` is refused by name rather than parsed
 * and silently dropped.
 *
 * `continuousSetup`, not a resolved completion: a material is a state the element sits in, not a
 * move it makes, so reporting `data-kui-state="finished"` from the first microtask would be a lie
 * about something that has no end. Same choice, same reason, as `rotate-static`.
 *
 * @returns A continuous setup whose cleanup is a no-op — nothing was allocated to release.
 * @complexity O(1) time and space.
 */
function prepareGlass(): SetupResult {
  return continuousSetup(() => {})
}

export const MATERIALS_PRIMITIVES: Primitive[] = [
  {
    id: 'glass',
    // `javascript`, like the whole of section I and section Q, and for the same reason: there is no
    // keyframe to compile. A `css-keyframes` renderer would push an empty `animation-*` track and
    // then have `pushTrack` write declarations for a track with nothing in it.
    renderer: 'javascript',
    channels: ['background', 'backdrop'],
    parameters: glassParams,
    // An abstention rather than a claim — this primitive never reads `Timeline` at all, so naming
    // `['time']` would needlessly narrow what a scrubbed neighbour on the same element may request.
    // Same constant, same reasoning, as `rotate-static` and `background-media`.
    supportedTimelines: TIMELINE_AGNOSTIC,
    // `'load'` as the default so a panel already on screen at page load, sitting in a background
    // tab, or still zero-area is not waiting on an `IntersectionObserver` that may never fire to be
    // given the surface it is supposed to be *made of*. `'enter'` and `'manual'` stay available for
    // an author who deliberately wants the glass to arrive later.
    supportedActivations: ['load', 'enter', 'manual'],
    defaultActivation: 'load',
    /*
     * `perfClass: 'paint'` — chosen, not defaulted, and the honest upper bound of a vocabulary that
     * has no exact word for what `backdrop-filter` costs.
     *
     * What the five classes mean here. `'compositor'` is a lie outright: a backdrop filter is not
     * GPU-cheap layer work, it forces the browser to snapshot everything painted behind the element
     * into a texture, run a separable blur over it, and composite the result — extra render passes
     * per frame, which is the exact opposite of the "transform and opacity only" budget that class
     * stands for. `'layout'` is wrong in the other direction: nothing here reads or writes geometry.
     * `'continuous'` was the closest fit on one axis and was rejected: in this catalog it means
     * "runs a clock forever" (ambient loops, pointer tracking), and a reader checking whether an
     * effect needs a reduced-motion story or a `finished` promise would be misled by it. `'paint'`
     * says "this element repaints rather than merely re-composites", which is true.
     *
     * What `'paint'` under-states, and why it is written down rather than left to be discovered:
     * an ordinary repaint costs when *this element* changes. A backdrop filter costs when *anything
     * behind it* changes — scrolling a page under a fixed glass header re-runs the blur every frame
     * while the header itself is perfectly static. And the cost scales with the panel's **area**,
     * not its complexity, which is why the dangerous case is a full-bleed glass hero on a phone and
     * not a glass button anywhere. Two or more overlapping glass surfaces multiply it, because each
     * one's backdrop includes the one below.
     *
     * The mitigations are real and are documented on the effect rather than hidden here: keep the
     * blurred area small, do not stack glass on glass, and `blur:0px` turns the pass off entirely
     * while leaving the tint, rim and sheen — a legible non-glass fallback an author can gate on a
     * media query themselves. If a perf-budget harness ever lands, this primitive wants a bound of
     * its own rather than the generic `'paint'` one; that is the note this comment exists to leave.
     */
    perfClass: 'paint',
    /*
     * `'shorten'`, for the reason `transforms.ts` argues at length rather than because a glass
     * panel is exempt from anything. Nothing in `glass.css` moves, so there is no motion to reduce;
     * `'shorten'` is what `mergeHostFacts` seeds the fold with, which makes it the identity element
     * of `strictestPolicy` and therefore this primitive's way of saying "I impose no reduced-motion
     * constraint of my own". `'disable'` would be actively wrong: it is a fact about the *element*,
     * so `glass, count-up` would leave the counter reading zero forever.
     *
     * The user preference a translucent blurred surface actually engages is
     * `prefers-reduced-transparency`, which is a different query and is unhandled catalog-wide —
     * see `glass.css`'s own note.
     */
    reducedMotion: 'shorten',
    /*
     * No timing tokens, refused out loud. A material has no start moment for a `delay` to push, no
     * span for a `duration` to stretch, and no curve for an `ease` to bend — so `glass
     * 400ms` warns by name instead of parsing cleanly and doing nothing, which is
     * indistinguishable from a broken effect. This is what puts `glass` on
     * `js-effect-timing-parity.test.ts`'s `TIMING_REFUSALS` side of the ledger.
     */
    prepare: withTimingContract(
      'glass',
      { because: 'it paints a resting surface rather than animating, so there is no motion to time' },
      deferPrepare(prepareGlass),
    ),
  },
]

/**
 * The preset name and the primitive id are both `glass` — the same string in two different
 * namespaces, which `registry.ts` keeps as separate maps (`resolve()` looks the authored name up
 * in `presets`, then follows `preset.primitive` into `primitives`), so there is no collision to
 * worry about. Plenty of the catalog already does this (`fade-open`, `cursor-follow`,
 * `rotate-static`, and more) — a preset sharing its primitive's id is the common case, not the
 * exception.
 *
 * Keeping them as two rows rather than one still buys composability: a distinctly-named preset —
 * someone's own house style, say — is a second `Preset` row here plus its own selector in
 * `glass.css`, inheriting the parameter schema, the channel claim, the reduced-motion policy and
 * the perf class rather than restating them. `blur:` and `tint:` already cover the
 * heavier-blur / different-tint variations that used to motivate that point, so those are
 * `glass blur:32px` or `glass tint:navy`, not a second name — but the mechanism is still here for
 * a preset that genuinely needs one. Same one-primitive-many-names shape the rest of the catalog
 * uses, and the reason `press` — not `press-depth` — is the primitive next door.
 *
 * No `transitions` field. `Preset.transitions` describes properties this preset eases on its own
 * host box, and nothing here eases: the surface is painted once and does not change. A composed
 * `press-depth` brings its own `scale`/`box-shadow` segments, which is exactly the division of
 * labour this family is built around.
 *
 * ### No `phase` field either, and this one took real thought
 *
 * None of the four {@link EffectPhase} values (`core/types.ts`) is honest about what `glass` does,
 * and forcing one on would be worse than the unphased default it falls back to:
 *
 * - **Not `entrance`/`exit`.** Both describe a one-shot animation that starts from a hidden or
 *   displaced state and *releases* the channel the moment it finishes — that release is what makes
 *   `fade-up, lift` safe (see `channels.ts`'s `INDEPENDENT_PHASES`). `glass` never plays anything
 *   and never releases `background`/`backdrop`: `prepareGlass` above is a no-op, and the CSS rule
 *   in `glass.css` is an unconditional declaration with no keyframe at all. There is no from-state
 *   to hide and nothing to hand back to the cascade.
 * - **Not `idle`.** `idle` is specifically an *unbounded animation loop* — a running clock that
 *   never yields, tracked in CSS as `--kui-fx-<name>-iterations: infinite` (see `ambient-tint`'s
 *   presets in `ambient.ts`, which also claim `background` and are exactly this). `glass` has no
 *   clock and no iteration count; it is not looping, it simply is.
 * - **Not `state`.** `state` means the channel is held by a condition the *visitor* changes
 *   (`:hover`, `[aria-expanded]`) and released once that condition goes away. `glass`'s hold is
 *   unconditional from the moment it activates (`defaultActivation: 'load'`) and never releases —
 *   there is no visitor action that ends it.
 *
 * So `glass` holds `background`/`backdrop` exactly the way `idle` does — forever, with no turn to
 * hand off — without being an animation, which is the one fact every {@link EffectPhase} value
 * assumes. Declaring `idle` anyway was the tempting shortcut, since it happens to be inert against
 * today's `INDEPENDENT_PHASES` table (`idle` is not a member of either exempted pair, so it would
 * conflict with everything exactly as unphased does) — but "inert today" is not the same as
 * "true", and a false claim sitting on the record is exactly what costs someone a real bug the day
 * that table grows a third exemption. Leaving `phase` undeclared is the honest answer *and* the
 * correct one operationally: an unphased claim conflicts with any other claimant on
 * `background`/`backdrop`, which is exactly right, because anything else painting on that channel
 * *forever* — another material, an `idle` ambient loop like `scanline` — is a genuine, permanent
 * fight over the same property, not two effects taking turns. See
 * `test/catalog-phase-materials.test.ts` for the compiled proof.
 */
export const MATERIALS_PRESETS: Preset[] = [{ name: 'glass', primitive: 'glass' }]

/**
 * Register catalog section S (materials) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 */
export function registerMaterials(registry: Registry): Registry {
  return registry.registerPrimitives(MATERIALS_PRIMITIVES).registerPresets(MATERIALS_PRESETS)
}
