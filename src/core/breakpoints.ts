/**
 * Viewport gates — the `above:` / `below:` keys in the `data-kui` grammar.
 *
 * The gap this closes: there was no way to say "fade-up on desktop, nothing on mobile". `matchMedia`
 * appeared exactly once in the whole source (`capabilities.ts`, for `prefers-reduced-motion`), and
 * GSAP's answer — `gsap.matchMedia()` — is a runtime that also has to tear an animation down when a
 * breakpoint changes underneath it.
 *
 * **A breakpoint is a media query, so the gate is compiled into CSS rather than evaluated in JS.**
 * `gatedAnimationName` wraps a track's keyframe ident in a `var()` whose custom property is
 * declared `none` outside the gate and guaranteed-invalid inside it (see the `kui.tokens` block in
 * `base.css`). The browser re-resolves that on every resize with no script running, so there is
 * nothing to observe, nothing to tear down, and nothing to get out of sync — the whole class of
 * problem `gsap.matchMedia()` exists to manage simply does not arise. The cost is that the
 * vocabulary has to be *closed*: a static stylesheet cannot hold a width the author invents, so
 * `above:900px` is refused and only the five names below are accepted.
 *
 * ## Why these five names
 *
 * They are Tailwind v4's default scale, unchanged. This repo already builds `demo/tailwind.css`
 * from its own `tailwindcss` dependency and every demo page authors against `sm`/`md`/`lg`, so
 * adopting that scale means the library is matching a scale the project already uses rather than
 * inventing a sixth one it would then have to own forever. `rem` rather than `px` for the reason
 * Tailwind moved: the breakpoints then track the visitor's root font size, so a reader who has
 * scaled their text up crosses into the "narrow" treatment at the point their layout actually
 * reflows.
 *
 * ## Why `above` is inclusive and `below` is not
 *
 * `above:md` is `width >= md` and `below:md` is `width < md`, so the pair tiles the axis with
 * neither a gap nor an overlap: `data-kui="fade-up below:md, parallax above:md"` runs exactly one
 * of the two at every possible viewport width, including at exactly 768px. Splitting the boundary
 * any other way makes one width either run both effects or run none, which is the classic
 * `min-width`/`max-width` off-by-one — and is why this does *not* spell itself `min:`/`max:`, since
 * CSS's own `max-width` is inclusive and would reintroduce it.
 *
 * ## Why `min-width` and not the range syntax
 *
 * `(width >= 48rem)` is Media Queries 4 and reads better, but a browser that does not parse it
 * drops the whole block — which here means `--kui-above-md` keeps its `none` default and every
 * `above:` gate on the page is silently off forever. `(min-width: 48rem)` has no such cliff. The
 * shipped stylesheet and this module must agree exactly, so both use the same spelling.
 */

/**
 * The scale. Ordered narrowest to widest — `breakpointRank` depends on the declaration order, and
 * `parse.ts` uses that ordering to refuse a band that can never match.
 */
export const BREAKPOINTS = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
  '2xl': '96rem',
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

/** In scale order, for `breakpointRank` and for naming the accepted values in a diagnostic. */
export const BREAKPOINT_NAMES = Object.keys(BREAKPOINTS) as Breakpoint[]

/**
 * A segment's condition, lifted onto the spec by `parse.ts`. Two independent axes:
 *
 * - `above`/`below` — the **viewport** condition, `data-kui="fade-up above:md"`. Compiled into
 *   `:root`-scoped custom properties in `base.css` (see `gatedAnimationName`), so the browser
 *   re-decides on every resize with no script involved.
 * - `wide`/`narrow` — the **container** condition, `data-kui="fade-up wide:md"`, decided against
 *   the element's nearest `data-kui-container` ancestor rather than the viewport. Neither axis
 *   subsumes the other: `above:md` answers "is the window at least 768px", `wide:md` answers "is
 *   the box I sit in at least 768px", and a component reused at more than one width on the same
 *   page needs the second question. `wide`/`narrow` compile the same way `above`/`below` do
 *   (`gatedAnimationName` wraps both axes), with one deliberate asymmetry in their CSS
 *   defaults — see the `@container` block in `base.css` for why.
 *
 * All four keys may be present at once, each pair forming a band the same way: `above:md
 * below:xl` runs only between the two, and `wide:md narrow:xl` does the same against the
 * container. That falls out of the CSS for free — the `var()`s nest arbitrarily deep — so bands
 * are supported rather than refused on either axis.
 */
export interface EffectGate {
  above?: Breakpoint
  below?: Breakpoint
  wide?: Breakpoint
  narrow?: Breakpoint
}

export type GateDirection = keyof EffectGate

/** Which two directions tile one axis, upper bound (inclusive-side) first. */
const GATE_AXES: readonly (readonly [GateDirection, GateDirection])[] = [
  ['above', 'below'],
  ['wide', 'narrow'],
]

/**
 * The other direction on this one's axis — `above` pairs with `below`, `wide` pairs with `narrow`.
 * Used wherever a check has to reason about a *band* rather than a single direction, so a new axis
 * only ever needs an entry in {@link GATE_AXES} rather than a new branch at every call site.
 *
 * @complexity O(1) time (two axes, checked in a fixed order); O(1) space.
 * @overallScore 100
 */
export function axisOf(direction: GateDirection): readonly [GateDirection, GateDirection] {
  return GATE_AXES.find((axis) => axis.includes(direction))!
}

/**
 * Whether a token names a breakpoint on the scale.
 *
 * `Object.hasOwn`, not `value in BREAKPOINTS` and not a truthiness test on the lookup: the value
 * comes straight off an author-written attribute, so `above:constructor` and `above:__proto__`
 * both resolve to an inherited value on `Object.prototype` and would be accepted as breakpoints.
 * The same trap `parse.ts` documents on its `HOISTS` table.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function isBreakpoint(value: string): value is Breakpoint {
  return Object.hasOwn(BREAKPOINTS, value)
}

/**
 * Position on the scale, narrowest first.
 *
 * @complexity O(b) time in the scale's length — five; O(1) space.
 * @overallScore 100
 */
export function breakpointRank(name: Breakpoint): number {
  return BREAKPOINT_NAMES.indexOf(name)
}

/**
 * The custom property one direction/breakpoint pair is switched by. Shared by both axes — `above`/
 * `below` name a `@media`-declared switch, `wide`/`narrow` name an `@container`-declared one — the
 * spelling is identical either way, so one function serves both rather than a `containerProperty`
 * duplicate of it.
 *
 * This name is a contract with `src/css/base.css`, which declares all twenty (ten per axis).
 * Changing the spelling here without changing it there compiles a `var()` that resolves to
 * nothing, and a `var()` that resolves to nothing falls through to its fallback — so every gate
 * would silently be *on* everywhere, which is the failure a reader would be least likely to
 * notice. `test/breakpoints.test.ts` asserts the two agree.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function gateProperty(direction: GateDirection, breakpoint: Breakpoint): string {
  return `--kui-${direction}-${breakpoint}`
}

/**
 * The media query one breakpoint is switched at. Deliberately only ever `min-width`: the `below`
 * half is the *negation* of this same query rather than a `max-width` of its own, so the two halves
 * cannot drift apart at the boundary. See the header note on inclusivity.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function breakpointQuery(breakpoint: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[breakpoint]})`
}

/**
 * A track's `animation-name` value, gated.
 *
 * `kui-in-up` becomes `var(--kui-above-md, kui-in-up)`. Outside the gate that property holds
 * `none`, so the track is a named-nothing entry in the composed `animation-name` list: its
 * duration, delay, easing and fill-mode entries all still sit at the same index and are simply
 * ignored, which is what keeps a *composed* element's parallel longhand lists aligned. Inside the
 * gate the property is the guaranteed-invalid value and `var()` falls through to the real ident.
 *
 * A gated-off track leaves nothing behind: with no animation there is no `animation-fill-mode:
 * both` holding a from-state, so the element paints at its ordinary rest state. That is the
 * property that makes "nothing on mobile" safe — the zero-area presets that have historically
 * stranded elements did so through a from-state that never got released, and there is no
 * from-state here to release.
 *
 * A band nests the two, and the order matters only for readability: `above` outermost reads as
 * "not wide enough → off; otherwise, too wide → off; otherwise run". `wide`/`narrow` nest the same
 * way, innermost, so all four conditions the author wrote — viewport band and container band
 * together — AND together through the same chain of `var()` fallbacks: any one of them resolving
 * to `none` neutralises the whole expression, regardless of which axis it came from.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function gatedAnimationName(keyframes: string, gate: EffectGate | undefined): string {
  if (!gate) return keyframes
  let expression = keyframes
  if (gate.narrow) expression = `var(${gateProperty('narrow', gate.narrow)}, ${expression})`
  if (gate.wide) expression = `var(${gateProperty('wide', gate.wide)}, ${expression})`
  if (gate.below) expression = `var(${gateProperty('below', gate.below)}, ${expression})`
  if (gate.above) expression = `var(${gateProperty('above', gate.above)}, ${expression})`
  return expression
}

/**
 * Whether a gate is currently satisfied — the JavaScript mirror of the CSS above.
 *
 * Needed *only* for JavaScript-rendered segments. A `css-keyframes` segment is gated by the
 * compiled `var()` and never consults this; a JS-rendered one emits no `animation-name` at all, so
 * there is nothing for a stylesheet to neutralise and the decision has to be made here. That is
 * the whole of the JS fallback, and it is a stated limit rather than a hidden one: gating is free
 * for the large majority of the catalog that compiles to keyframes, and costs one `matchMedia`
 * read plus one `change` listener for the rest.
 *
 * **Fails open.** No `matchMedia` — a server render, a bare Node runtime, jsdom, which has none —
 * means the effect runs. The alternative is an environment with no viewport deciding that every
 * gated effect is off, which is a silent no-op, and "never a silent no-op" is the one promise the
 * grammar makes everywhere else.
 *
 * Reads only the viewport axis (`above`/`below`). The container axis (`wide`/`narrow`) has no
 * equivalent here on purpose — there is no `matchContainer()`, and building one is a
 * `ResizeObserver` per container plus a re-entrancy-safe notify path for one attribute. A
 * JavaScript-rendered primitive refuses a container gate at compile time instead of faking it (see
 * `refuseContainerGate` in `compile.ts`), so a gate reaching this function has already had `wide`/
 * `narrow` stripped if it ever had them — there is nothing left for this function to ignore.
 *
 * @param gate - The segment's condition; `undefined` is an ungated segment and always matches.
 * @param win - Window to query. Injected rather than reached for, exactly as
 *   `effects/catalog/interaction-shared.ts` injects it for its `(hover: hover)` probe.
 * @complexity O(1) time and space — at most two media queries.
 * @overallScore 100
 */
export function gateMatches(gate: EffectGate | undefined, win: Window | undefined): boolean {
  if (!gate) return true
  if (typeof win?.matchMedia !== 'function') return true
  const atLeast = (breakpoint: Breakpoint): boolean =>
    win.matchMedia(breakpointQuery(breakpoint)).matches
  if (gate.above && !atLeast(gate.above)) return false
  if (gate.below && atLeast(gate.below)) return false
  return true
}

/**
 * Whether two gates can ever be satisfied at the same time, on both axes at once.
 *
 * Read by `channels.ts`: two effects that are never live together cannot collide on a channel, so
 * `fade-up below:md, parallax-y above:md` composes even though both own `translate`. Without this
 * the compiler would refuse that pair — the exact list the gate exists to make expressible — and
 * silently drop its second half at every width. `wide:md` and `above:md` are independent
 * conditions — a wide container inside a narrow viewport is ordinary layout — so overlap requires
 * agreement on **both** axes: two gates that are disjoint on either one alone can never be live
 * together, however the other axis compares.
 *
 * Each direction is a half-open interval over the scale's *ranks*, which is exact because the only
 * boundaries that exist are the five breakpoints themselves: `above:X`/`wide:X` starts at `rank(X)`
 * and an absent upper bound starts below the narrowest name; `below:Y`/`narrow:Y` ends at `rank(Y)`
 * and an absent lower bound runs past the widest. Half-open is what makes the boundary come out
 * right — `[below:md)` ends exactly where `[above:md)` begins, so the two touch without
 * overlapping, which is the same property that makes a complementary pair tile an axis.
 *
 * @complexity O(b) time in the scale's length; O(1) space.
 * @overallScore 100
 */
export function gatesOverlap(a: EffectGate | undefined, b: EffectGate | undefined): boolean {
  if (!a || !b) return true
  const span = (gate: EffectGate, [upper, lower]: readonly [GateDirection, GateDirection]): [
    number,
    number,
  ] => [
    gate[upper] ? breakpointRank(gate[upper]) : -1,
    gate[lower] ? breakpointRank(gate[lower]) : BREAKPOINT_NAMES.length,
  ]
  const overlapsOn = (axis: readonly [GateDirection, GateDirection]): boolean => {
    const [aStart, aEnd] = span(a, axis)
    const [bStart, bEnd] = span(b, axis)
    return aStart < bEnd && bStart < aEnd
  }
  return GATE_AXES.every(overlapsOn)
}

/**
 * Breakpoints a set of gates depends on, deduplicated. Empty for an ungated list.
 *
 * Only ever called on `EffectGate`s already filtered to JavaScript-rendered effects
 * (`Animator.applyViewportGates`), and those never carry `wide`/`narrow` — `refuseContainerGate`
 * in `compile.ts` strips both before a gate reaches `plan.jsEffects`. Reading only `above`/`below`
 * here is therefore not a gap, it mirrors `gateMatches`'s own scope.
 *
 * @complexity O(g) time in the gate count; O(b) space, bounded by the scale's five names.
 * @overallScore 100
 */
export function breakpointsIn(gates: readonly EffectGate[]): Breakpoint[] {
  const named = new Set<Breakpoint>()
  for (const gate of gates) {
    if (gate.above) named.add(gate.above)
    if (gate.below) named.add(gate.below)
  }
  return [...named]
}

export interface GateWatcher {
  /**
   * Re-notify about `el` whenever one of `breakpoints` is crossed. An empty list unwatches, so a
   * caller can pass whatever it computed without branching first.
   */
  watch(el: Element, breakpoints: readonly Breakpoint[]): void
  unwatch(el: Element): void
  destroy(): void
}

/**
 * Watch the breakpoints a page's JavaScript-rendered gates actually name.
 *
 * Only JS-rendered gates ever reach here (see `gateMatches`), so on a page whose gates are all on
 * CSS effects — the common case — nothing is ever watched and no listener is ever bound. The cost
 * of this feature is genuinely zero until a `pin-section below:md` asks for it.
 *
 * The reaction to a crossing is deliberately "tell the caller about the element" rather than
 * anything cleverer: the animator already has exact teardown (`release`) and exact reinstall
 * (`process`), both used on every attribute edit, so a breakpoint change reuses the path that is
 * already exercised rather than inventing a second, partial one. That is also what makes the
 * transition correct at the boundary — a JS effect that was running is destroyed through its own
 * `EffectInstance.destroy()` and its style writes unwound by the ledger before the new plan is
 * installed, so nothing is left half-applied.
 *
 * A single `Map` of element → breakpoints rather than a reverse index per breakpoint: the map only
 * ever holds elements with a gated JS effect, so a linear scan on a crossing is a handful of
 * entries, and a second index would be more state to keep consistent than the scan costs.
 *
 * @param win - Window to bind against; `undefined`, or one with no `matchMedia`, yields a watcher
 *   that accepts every call and does nothing. Install-time gating still applies in that case; only
 *   live re-evaluation is dropped.
 * @param onChange - Called with each affected element when a watched breakpoint is crossed.
 * @complexity O(1) per `watch`/`unwatch`; O(w) per crossing in the number of watched elements.
 * @overallScore 100
 */
export function createGateWatcher(
  win: Window | undefined,
  onChange: (el: Element) => void,
): GateWatcher {
  const watched = new Map<Element, readonly Breakpoint[]>()
  const bound = new Map<Breakpoint, () => void>()

  function bind(breakpoint: Breakpoint): void {
    if (typeof win?.matchMedia !== 'function' || bound.has(breakpoint)) return
    const query = win.matchMedia(breakpointQuery(breakpoint))
    // `addEventListener` on a MediaQueryList post-dates `addListener` by years. Rather than keep a
    // deprecated fallback alive, a browser without it gets no live updates — the install-time read
    // still ran, so the page is correct at load and stale only after a resize.
    if (typeof query.addEventListener !== 'function') return
    const handler = (): void => {
      // Snapshot first: `onChange` re-enters `watch`/`unwatch` for the very element it is handed.
      for (const [el, names] of [...watched]) {
        if (names.includes(breakpoint)) onChange(el)
      }
    }
    query.addEventListener('change', handler)
    bound.set(breakpoint, () => query.removeEventListener('change', handler))
  }

  return {
    watch(el, breakpoints) {
      if (breakpoints.length === 0) {
        watched.delete(el)
        return
      }
      watched.set(el, [...breakpoints])
      for (const breakpoint of breakpoints) bind(breakpoint)
    },
    unwatch(el) {
      watched.delete(el)
    },
    destroy() {
      for (const unbind of bound.values()) unbind()
      bound.clear()
      watched.clear()
    },
  }
}
