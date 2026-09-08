import type { ParameterSchema, Preset, Primitive, Renderer } from '../../core/types.js'
import { ALL_TIMING_TOKENS, stylesheetTimingPrepare, TRIGGER_DELAY_PARAM } from '../shared.js'

/**
 * The two *state* effects of catalog section I — `press-depth` and `group-dim`.
 *
 * Section I shipped 22 names before these and every one of them animated exactly one element in
 * exactly one of two states: the pointer is over me, or focus has landed on me. Two whole
 * categories of everyday micro-interaction had no name at all as a result, and both are here
 * because the *state* they key on is the thing that was missing, not because the motion is novel:
 *
 *  - **`press-depth`** keys on `:active`. Before it, the only `:active` in the entire library was
 *    a coarse-pointer fallback in `media.css`, so "the button gets smaller while you hold it" —
 *    which is on more or less every shipping button on the web — could only be written as page
 *    CSS. Every hover name here has a `:focus-visible` twin; none had an `:active` one.
 *  - **`group-dim`** keys on `:has()`. Before it, every hover rule in the catalog painted the one
 *    element under the pointer, and the extremely common "hover one card, the rest of the grid
 *    recedes" pattern had nowhere to live: the effect is a property of the *container*, and no
 *    primitive in section I had ever looked at an element's children.
 *
 * Both are stylesheet effects in the same sense the hover family is (`interaction.ts`'s file
 * comment has the long version): `renderer: 'javascript'` and a near-no-op `prepare`, registered
 * so the name parses, channel-conflicts, and picks up authored parameters, with the actual motion
 * living as ordinary CSS in `interaction.css`. "Near"-no-op for the one reason that file records —
 * `stylesheetTimingPrepare` mirrors the *positional* timing spelling (`press-depth 90ms`) onto the
 * namespaced custom properties the rules read, because only the `key:value` spelling
 * (`press-depth duration:90ms`) gets there on its own.
 *
 * Their own file rather than more lines in `interaction.ts`, which sits on the 400-line lint
 * ceiling its own `HOVER_TRANSITIONS`/`COLOR_PARAMS` comments already record having hit — the same
 * split, one level up: those moved a table out, this moves a family out.
 */

/**
 * The timing schema for a state effect, with a per-family default duration.
 *
 * A parameterised builder rather than `interaction.ts`'s single shared `hoverTiming` constant,
 * because these two families genuinely want different numbers and the default is the value an
 * author sees when they write the bare name. A press has to feel like contact — anything past
 * about 120ms and the button reads as sluggish rather than pressed — while a group dim is a mood
 * change across a whole grid and wants the slower, softer curve the underline family already uses.
 *
 * All three tokens are honoured, so neither primitive appears in
 * `js-effect-timing-parity.test.ts`'s `TIMING_REFUSALS` table. `delay` in particular is a real
 * request on both: `interaction.css` spends it on the state rule and never on the base rule those
 * rules transition *from*, which makes it hover/press *intent* — don't dim the grid until I have
 * meant it for 150ms — and never a lag on the way back out. See that file's opening comment for
 * why the asymmetry is the whole point.
 *
 * @param duration - Default transition duration for the family, as a CSS time.
 * @returns A `duration`/`delay`/`ease` schema, ready to spread beside the family's own parameters.
 * @complexity O(1) time and space — three entries, fixed.
 */
function stateTiming(duration: string): ParameterSchema {
  return {
    duration: { type: 'time', default: duration, cssProperty: '--kui-duration' },
    ...TRIGGER_DELAY_PARAM,
    ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  }
}

/**
 * A CSS-driven state primitive: the registry row behind a rule that lives in `interaction.css`.
 *
 * The same shape `interaction.ts`'s `hoverPrimitive` builds, and deliberately not a call to that
 * one: every member of `HOVER_PRIMITIVES` is required by `catalog-interaction.test.ts` to ship a
 * matching `:hover` *and* `:focus-visible` rule, and neither family here does — `press-depth` has
 * no hover state at all, and `group-dim` reaches its children rather than itself. Registering
 * separately is what `beam-border-auto` already does for the same reason.
 *
 * `reducedMotion: 'shorten'`, not `'disable'`: both are small, non-vestibular state changes, and
 * shortening a transition still lands it on its end value, so no resting state can be stranded —
 * the reasoning `base.css`'s own reduced-motion block records for the whole transition tier.
 *
 * @param id - Primitive id; also the namespace of the `--kui-<id>-duration/-delay/-ease` slots
 *   `registry.ts`'s `namespaceTiming` writes and `interaction.css` reads.
 * @param channels - CSS property groups this primitive claims, for the composition model.
 * @param duration - Default transition duration for the family.
 * @param extraParams - The family's own non-timing parameters.
 * @complexity O(1) time and space.
 */
function statePrimitive(
  id: string,
  channels: string[],
  duration: string,
  extraParams: ParameterSchema,
): Primitive {
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters: { ...stateTiming(duration), ...extraParams },
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    reducedMotion: 'shorten',
    prepare: stylesheetTimingPrepare(id, {
      honours: ALL_TIMING_TOKENS,
      because: 'interaction.css pins that value on this effect',
    }),
  }
}

/**
 * `press-depth`'s knobs. Every literal in `interaction.css`'s `:active` rule appears here with the
 * same value as its `var()` fallback, so the rule keeps working untouched when nothing is authored.
 *
 * `depth` is a length rather than a whole `box-shadow` string on purpose. There is no shadow
 * parameter *type* — `text` is the catalog's arbitrary-characters escape hatch and is explicitly
 * never written to a stylesheet (see `ScalarParamType` in `core/types.ts`) — and inventing one
 * would mean validating the `box-shadow` grammar, which is a second CSS parser to own. One length
 * driving offset, blur, and spread through `calc()` covers what a press shadow actually varies:
 * how close to the surface the element has been pushed.
 *
 * `color` carries the empty default the `COLOR_PARAMS` records next door document at length: an
 * unset colour must emit *no declaration at all*, so the rule falls through its own
 * `var(--kui-press-shadow-color, …)` fallback rather than having a default seized from an author
 * who never asked for one.
 *
 * Named `--kui-press-shadow-depth`, not `--kui-press-depth`, even though the parameter is `depth:`.
 * The preset is called `press-depth`, so the shorter spelling sits one character away from the
 * `--kui-tx-delay-press-depth` slot `declarations.ts` builds for the same effect — two unrelated
 * properties that would read as a matched pair. They are not, and the longer name says so.
 */
const pressParams: ParameterSchema = {
  scale: {
    type: 'number',
    default: '0.96',
    cssProperty: '--kui-press-scale',
    finite: true,
    minimum: 0,
  },
  depth: { type: 'length', default: '2px', cssProperty: '--kui-press-shadow-depth' },
  color: { type: 'color', default: '', cssProperty: '--kui-press-shadow-color' },
}

/**
 * `group-dim`'s one knob: how far the un-hovered members recede.
 *
 * `'number|percentage'` because `opacity` is a CSS `<alpha-value>` and `0.4` and `40%` are the same
 * request written two ways — the union normalises to the number, so the bounds below still hold
 * whichever spelling an author reaches for.
 *
 * Deliberately one parameter. A blur or a desaturate would each be a second physical property on
 * the children's box and therefore a second thing for a future `group-*` sibling to collide with;
 * the family shares one channel (see `GROUP_PRIMITIVES` below), so those belong in their own names
 * rather than as knobs here.
 */
const groupParams: ParameterSchema = {
  opacity: {
    type: 'number|percentage',
    default: '0.4',
    cssProperty: '--kui-group-dim-opacity',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
}

/**
 * The press state. One primitive, one preset today — the split is the composability the name
 * promises.
 *
 * A future `glass-press`, `press-tilt`, or a brand's own pressed treatment is a second `Preset`
 * row on this same primitive plus its own selector in `interaction.css`: it inherits the
 * `--kui-press-duration/-delay/-ease` namespace (those are keyed on the *primitive* id by
 * `registry.ts`'s `namespaceTiming`), the parameter schema, the reduced-motion policy, and the
 * channel claim, and adds only the declarations that differ. That is the same
 * one-primitive-many-names shape the rest of the catalog uses — 130 of the catalog's names are
 * aliases of this kind — and it is why `press` is the primitive rather than `press-depth`.
 *
 * ### Channels: `scale` and `shadow`, and specifically not `translate`
 *
 * A channel claim is not documentation, it is a veto: `compile.ts`'s `resolveComposition` *drops*
 * every effect after the first when two claims overlap, so an over-broad claim silently deletes
 * an effect an author wrote. `translate` is the claim this primitive could plausibly have made and
 * must not: `lift` owns `translate` and `data-kui="lift, press-depth"` — raise on hover, sink on
 * press — is the single most useful pairing this effect has. Claiming `translate` would make the
 * compiler refuse it and drop the press entirely.
 *
 * That is not a loophole; the sink genuinely does not need `translate`. A press reads as depth
 * through the scale and through the shadow collapsing toward the surface, which is how the two
 * dominant design systems build the same state. What it costs is real and worth naming:
 * `lift-shadow` and `border-glow` both own `shadow`, so composing either with `press-depth` is
 * refused. That refusal is correct rather than incidental — all three write `box-shadow` on the
 * same box in overlapping states, and whichever rule came later in `interaction.css` would win the
 * whole property.
 */
export const PRESS_PRIMITIVES: Primitive[] = [
  statePrimitive('press', ['scale', 'shadow'], '120ms', pressParams),
]

export const PRESS_PRESETS: Preset[] = [
  {
    name: 'press-depth',
    primitive: 'press',
    /*
     * Through `Preset.transitions`, never a bare `transition:` in the stylesheet. A `transition`
     * shorthand resets every longhand it covers, so two composed presets each carrying their own
     * would fight over one declaration and the earlier one would vanish outright — the exact bug
     * `data-kui="lift, border-glow"` had. The compiler merges these segments into the single
     * `--kui-transition` custom property `base.css`'s `:where([data-kui-fx])` rule consumes;
     * `css-composition-invariants.test.ts` asserts no preset has gone back to the old spelling.
     */
    transitions: [{ property: 'scale' }, { property: 'box-shadow' }],
  },
]

/**
 * Collective hover: the container recedes, except for the member you are pointing at.
 *
 * ### Why the name is `group-dim`
 *
 * The effect goes on the *container* — `data-kui="group-dim"` on the `<ul>`, the grid, the row —
 * and reads whatever children are already there, so a page using it writes no structural CSS of
 * its own. A name has to be true on the element it is written on, and that rules out the obvious
 * `siblings-dim`/`dim-siblings` spelling: written on a `<ul>`, "siblings" names the `<ul>`'s own
 * siblings, which are the one set of elements this effect never touches. `group-dim` names the
 * container's contents, which is what actually dims.
 *
 * `group-` is also a prefix with room in it. This is the first collective effect in the catalog,
 * and a `group-blur` or `group-desaturate` is the same mechanism with a different property; they
 * would share this primitive's channel and read as one family in the catalog's group column.
 *
 * ### Channels: `group`, a channel of its own
 *
 * Every other channel in the model names properties on the element `data-kui-fx` sits on. This one
 * paints its *children's* `opacity`, which is a different box, and filing it under `opacity` would
 * make the compiler refuse `data-kui="fade-in, group-dim"` — a container that fades itself in and
 * dims its children on hover — even though the two never touch the same box. Declaring the box set
 * the effect actually owns is what keeps the veto pointed at the real collision: a second
 * `group-*` effect on the same container.
 *
 * `requiresOwnSubtree` follows directly and is not optional. `target:` relocates `data-kui-fx` onto
 * whatever a selector matches, and a rule that reaches `> *` compiles to silence when it lands on
 * an element with a different shape beneath it. `compile.ts`'s `liftTarget` refuses to relocate a
 * preset that declares this, and `css-requires-own-subtree.test.ts` re-derives the true set from
 * the shipped stylesheets rather than trusting the flag.
 */
export const GROUP_PRIMITIVES: Primitive[] = [
  statePrimitive('group-dim', ['group'], '260ms', groupParams),
]

export const GROUP_PRESETS: Preset[] = [
  /*
   * No `transitions` field, unlike `press-depth` above. `Preset.transitions` describes properties
   * this preset eases *on its own host box*, and the compiler spends them on the one
   * `--kui-transition` property `base.css` applies to the element carrying `data-kui-fx` — which
   * here is the container, which does not move. The children's `opacity` transition is authored
   * directly on their own rule in `interaction.css`, the same way the form family's satellite
   * rules carry their own, and it is safe there for a reason the host box's is not: nothing else
   * can ever write a transition on `[data-kui-fx~='group-dim'] > *`, because a second effect that
   * did would have to be on this channel and would be refused before it got there.
   */
  { name: 'group-dim', phase: 'state', primitive: 'group-dim', requiresOwnSubtree: true },
]

/** Both state families, for `interaction.ts`'s catalog-wide exports. */
export const STATE_PRIMITIVES: Primitive[] = [...PRESS_PRIMITIVES, ...GROUP_PRIMITIVES]
export const STATE_PRESETS: Preset[] = [...PRESS_PRESETS, ...GROUP_PRESETS]
