# Declarative Web Animation Library — Architecture

---

## 1. Positioning

**The promise:** the common 80% of web motion, straight from HTML, executed natively by the
browser, with strong progressive enhancement.

**Explicitly NOT the promise:** a declarative replacement for GSAP's general choreography, or
a UI component library. That framing forces a large orchestration runtime, breaks semantic
consistency across fallbacks, and makes the catalog a permanent compatibility burden.

Standalone, MIT, npm + CDN `<script>`, framework-agnostic. No product or CMS coupling.

---

## 1a. Why not just GSAP?

Worth asking directly, because the honest answer is nuanced: **GSAP can build almost everything
in this catalog.** GSAP is free end to end today (current release: 3.15, April 2026). `Draggable`
was always free — it never required a Club GreenSock membership. `Flip` has been free since GSAP
3.9 (December 2021), well before any of this. What Webflow's April 2025 acquisition of GreenSock
added was making the remaining Club-only plugins — `SplitText`, `MorphSVGPlugin`, `DrawSVGPlugin`,
`ScrambleTextPlugin`, `InertiaPlugin` — free too, including for commercial use. Combined with
`ScrollTrigger` and GSAP's core tween/timeline engine, that covers
nearly this entire catalog either as a named, dedicated feature or as a well-documented recipe:
scroll reveals, staggering, parallax, pinned sections, horizontal-scroll-inside-vertical-scroll
(`ScrollTrigger`'s `containerAnimation`), scroll-snap, text splitting, scramble text, SVG stroke
draws and shape morphing, FLIP layout transitions, draggable/inertia physics.

More pointedly: two of the hardest scroll bugs this project ran into during development — a
parallax effect freezing mid-scroll, and a horizontal-scroll track that never visually moved — are
exactly the problem class `ScrollTrigger`'s `pin` and `containerAnimation` already solved, in
production, for years. Section C of this catalog (scroll mechanics) is its own hardest tier to
build and maintain. A meaningful share of that difficulty is this project re-solving, and
re-debugging, something GSAP ships working today, for free.

So why does this project still exist? Three reasons, and none of them is "GSAP is less capable":

1. **CSS-native execution.** The generated stylesheet keys its rules on `data-kui-fx`, and the
   library's JS is what stamps that attribute — so this is not a zero-JS-dependency claim, the
   library needs its JS to classify an element at least once. What that JS does *not* do is drive
   the animation: once `data-kui-fx` is stamped, the actual motion is a real CSS `@keyframes` /
   `animation-timeline` rule running on the compositor, off the main thread, for its whole
   duration. A later script that's slow, blocked, or throws does not stall or corrupt an
   animation already running. GSAP's animations are JS the whole way through — core plus
   `ScrollTrigger` plus `SplitText` plus `MorphSVGPlugin` adds up fast, and every animation on the
   page depends on that JS continuing to execute correctly for as long as the animation runs, not
   just at its start.
2. **Declarative HTML authoring, not an imperative API.** `<h1 data-kui="fade-up 900ms">` is the
   whole configuration. No JS file to write, own, or debug. GSAP is fundamentally a JavaScript API
   — even the simplest GSAP animation is a `.js` file someone writes and maintains.
3. **A catalog, not an engine.** GSAP gives you the primitives to build any of these effects; it
   does not ship 262 ready-made, ready-to-drop-onto-an-element named animations. Even on a GSAP
   project, someone still designs and hand-writes the equivalent of this catalog, in JS, per
   project. This project's bet is that a maintained, pre-built catalog behind a stable attribute
   grammar is worth more than direct access to a more general engine — for the specific slice of
   "the common 80% of web motion" this project targets, not for bespoke, hand-choreographed
   sequences, which is GSAP's actual strength and explicitly out of scope here (see above).

If a project needs hand-choreographed, JS-driven sequences, or already ships a JS-heavy stack where
an extra dependency is free, GSAP is very likely the better tool. This project is for the common
case where the animation should be inert without JS, authored without writing JS, and picked from a
catalog rather than composed by hand.

---

## 2. Namespacing

Generic names like `data-anim` and `--anim-*` risk collisions with site code and other libraries,
so the project uses one short namespace, `kui`, consistently across all four surfaces:

- attributes (`data-kui`, `data-kui-on`)
- custom properties (`--kui-reveal-distance`)
- keyframe names (`@keyframes kui-fade-up`)
- cascade layers (`@layer kui.effects`)

---

## 3. Attribute grammar — one tag

**Owned grammar, fixed order. Do not claim CSS-shorthand equivalence** — CSS permits multiple
orders and allows commas inside `steps()`/`linear()`, which imports ambiguity for no gain.

```
kui-value    := effect-spec ("," effect-spec)*
effect-spec  := <effect-name> [<duration>] [<delay>] [<easing>] <key:value>*
```

```html
<h1 data-kui="fade-up">
<h1 data-kui="fade-up 800ms">
<h1 data-kui="fade-up 800ms 200ms ease-out">
<h1 data-kui="fade-up 800ms distance:40px">
<h1 data-kui="slide-up 800ms, blur-in 400ms">
<h1 data-kui="slide-up 800ms, blur-in 400ms at:-200ms">
<h1 data-kui="fade-up below:md, fade-left above:md">
```

Rules:
- Positional args must appear in the order above. Unknown or out-of-order tokens produce a
  **dev-mode console warning naming the element and the token** — never a silent no-op.
- Some `key:value` keys are reserved and never reach a primitive's parameter schema. `on:`,
  `timeline:`, `threshold:`, `cascade:`, `order:`, `rm:` and `func:` are hoisted element-wide
  (below), because one element has one activation, one timeline, one stagger group, one
  reduced-motion policy and one completion. `at:` is per-segment and positions that segment relative
  to the one before it in the comma list — see §3.1. `above:`/`below:` are per-segment too and gate
  it to a range of viewport widths — see §3.2.
- Parser must be paren-aware (`ease:cubic-bezier(.2,.8,.2,1)` contains commas). ~30 lines.
- Attribute values may contain newlines; whitespace normalizes.
- Element-scoped settings (`on`, `timeline`, `threshold`) also have longhand attribute forms
  (`data-kui-on` etc.) for server-side templating; the inline key wins when both are present.
  Timing is grammar-only — there is no `data-kui-duration`.
- The three timing tokens also have a `key:value` spelling (`fade-up duration:800ms delay:200ms`).
  The two are one intent, not two features; where both appear on one spec the **positional token
  wins**, because that is the spelling `play()` emits.

### 3.1 The timing contract

"Never a silent no-op" is the hard part of that promise, and it is hardest on the JavaScript
renderer, where an effect may have no clock at all. Each primitive therefore declares which of
`duration`/`delay`/`ease` it can act on, and an authored token it cannot act on **warns by name
and says why** rather than evaporating. `TimingContract` in `src/effects/shared.ts` is that
declaration; `test/js-effect-timing-parity.test.ts` holds the table of which primitives refuse
what.

The classifying question is *does this effect have a start moment?*

| kind | example | `delay` |
|---|---|---|
| one-shot, played from a trigger | `fade-up`, `count-up`, `split-flap` | yes |
| a state transition with a discrete flip | `lift`, `hamburger-to-x`, `flip-card`, `flip-reorder` | yes |
| driven by pointer position | `tilt-3d`, `magnetic`, `drag` | **no** — nothing to be relative to |
| driven by scroll position | `pin-section`, `header-shrink`, `video-scrub` | **no** — same |
| pinned by the shipped stylesheet | `label-float`, `radio-fill` | **no** — the rule owns the timing |

A state transition's delay is one-directional: it delays *entering* the effect's active state and
never leaving it, so `lift delay:200ms` is hover-intent rather than a button that hangs in the air
after the pointer has gone.

### 3.1 Sequencing — `at:`

Comma-separated effects start together. `at:` moves one **relative to the previous segment**:

| Spelling | Anchor |
|---|---|
| `at:-200ms` | 200ms before the previous segment ends |
| `at:+100ms` | 100ms after the previous segment ends |
| `at:after` | the previous segment's end |
| `at:with` | the previous segment's start |
| `at:with+150ms` | 150ms after the previous segment's start |

**Only relative.** Serial and parallel playback were already expressible — parallel is a comma list
with no delay, serial is a `delay:` offset past the earlier duration — so an *absolute* `at:200ms`
would be `delay:200ms` renamed, and is refused by name. The capability that was genuinely missing is
GSAP's `"-=0.2"`: start B before A ends, without the author recomputing
`previousDelay + previousDuration - 200ms` every time either of the other numbers moves.

**Compiled, not driven.** `at:` produces a longer `animation-delay` expression and nothing else —
no timer, no playhead, no runtime state, so a sequence stays a real CSS animation off the main
thread. Most of the expression stays symbolic (`var(--kui-reveal-duration, 600ms)`, not `600ms`), so
restyling a duration in a consumer stylesheet re-derives every position after it with no recompile.

Scope and boundaries, all warned by name rather than left silent:

- **Within one element only.** Sequencing across sibling elements is not implemented; `at:` on the
  first segment has nothing to follow and is refused.
- **JavaScript-rendered effects** need a concrete number rather than an expression, so they are
  positioned only when the primitive declares a `delay`. One that does not is named in a warning.
- **`view`/`scroll` timelines** are driven by scroll position and ignore `animation-delay`; use an
  `animation-range` instead. `pin` positions normally — there the delay *is* the scrub head.
- **Stagger composes without double-counting**: `at:` spaces segments within one element, stagger
  shifts the whole element against its siblings.

Implementation: `src/core/sequence.ts`.

### 3.2 Viewport gates — `above:` / `below:`

"Fade up on desktop, nothing on mobile", as one token on the segment it applies to:

```html
<h1 data-kui="fade-up above:md">
<h2 data-kui="fade-up below:md, fade-left above:md">
<p  data-kui="blur-in above:md below:xl">
```

**A breakpoint is a media query, so this compiles to CSS and has no runtime.** A gated segment's
`animation-name` is emitted as `var(--kui-above-md, kui-in-up)`; `base.css` declares that property
`none` by default and the guaranteed-invalid `initial` inside `@media (min-width: 48rem)`. The
browser re-resolves it on every resize with no script running, which is why there is no
`kuinetic.matchMedia()` and nothing to tear down when a breakpoint changes — the problem GSAP's
`gsap.matchMedia()` exists to manage does not arise. It also means a gated page behaves correctly
before, and without, the library's JavaScript.

Turning a track *off* means naming no keyframes, not shortening it to zero: the track keeps its
index so a composed element's parallel longhand lists stay aligned, and with no animation there is
no `animation-fill-mode: both` holding a from-state, so the element paints at its ordinary rest
state. "Nothing on mobile" therefore leaves the element visible and in place, which is the one
outcome that has to be guaranteed — an element stranded at a from-state that never releases is a
failure mode this library has hit before (see the zero-area notes in `src/css/base.css`).

**At the boundary**, a CSS-gated effect behaves the way any media-query-driven declaration does. A
running animation whose track is switched off is removed mid-flight and the element snaps to its
rest state — visible and correctly positioned, never stranded, because the from-state only ever
existed inside the animation. Crossing the other way starts the animation from its first frame; on
an element whose entrance has already been triggered that reads as a replay, which is the honest
consequence of the treatment genuinely changing. The runtime is not involved and does not restamp
`data-kui-state`, so an element that replays this way can be reported as `finished` while it runs.

Decisions worth stating, all four of them consequences of compiling ahead of time:

- **A closed vocabulary.** `sm`/`md`/`lg`/`xl`/`2xl`, Tailwind v4's scale in `rem`, adopted rather
  than invented because `demo/` already authors against it. A stylesheet compiled ahead of time
  cannot hold a width the author makes up, so `above:900px` is refused by name.
- **`above` is inclusive, `below` is exclusive**, and both flip inside the same `min-width` block,
  so a complementary pair tiles the width axis with no gap and no double-run at the boundary.
- **Gates narrow the channel model rather than bypassing it.** Two effects that can never be live
  at the same width cannot collide, so `fade-up below:md, fade-left above:md` composes despite
  sharing two channels. Overlapping conditions conflict exactly as unconditional ones do (§4).
- **JavaScript-rendered effects are the one case that needs JS**, because they emit no
  `animation-name` for a stylesheet to neutralise. Those are gated at install and re-decided on a
  `MediaQueryList` change, which releases and reinstalls the element through the same path an
  attribute edit takes. Nothing is bound unless such an effect actually carries a gate.

Implementation: `src/core/breakpoints.ts`.

---

## 4. Composition — the channel model

**Why simple concatenation doesn't work:** two CSS rules each declaring `animation` don't
concatenate; the cascade discards one. And two animations writing the same property replace
rather than blend.

**Fix:** every primitive declares the CSS properties it owns. Modern CSS made `translate`,
`rotate`, and `scale` independent properties, which yields five disjoint channels. A sixth, `skew`,
has no independent property to lean on — CSS never gave skew one the way it did
translate/rotate/scale — so it claims the `transform` shorthand outright instead. Anything that
writes `transform` has to be on this channel, not another one: `scroll-skew` for its literal skew,
and `flip-face`/`flip-3d` because giving an element depth on *itself* needs the `perspective()`
transform function, which only exists inside `transform`.

| Channel | Property | Example primitives |
|---|---|---|
| opacity | `opacity` | fade |
| translate | `translate` | slide, parallax, float |
| scale | `scale` | zoom, pop, ken-burns |
| rotate | `rotate` | spin, tilt-2d, wiggle |
| filter | `filter` | blur, brightness, saturate |
| skew | `transform` | scroll-skew, flip-face, flip-3d |
| clip | `clip-path` | wipes, curtains, heart-fill |
| background | `background-*` | gradient mesh, aurora, range-fill |
| color | `color` | text colour transitions |
| stroke | `stroke`, `stroke-dasharray`, `stroke-dashoffset` | SVG draws, progress ring, gradient-stroke |
| text | `letter-spacing`, `word-spacing`, `font-variation-settings` | tracking, variable-font axes |

Third-party primitives register their own channel names, so `Channel` keeps an open `string` arm —
the union above documents the built-ins without closing the set. The one rule a new channel has to
respect is the one `skew` illustrates: two channel names must never map onto the same physical
property, or the compiler will wave through a pair it believes is disjoint and the browser will
silently drop one of them.

Compiler resolution order for a comma list:

1. **Channels disjoint** → emit one compiled declaration:
   ```css
   animation-name:     kui-slide-up, kui-blur-in;
   animation-duration: 800ms,        400ms;
   ```
2. **Channel collision** → dev warning naming both effects and the channel they share, and only
   the **first** effect in the list compiles. Falling back to one effect is deliberate: the
   alternative is emitting a visibly wrong animation.

Two segments whose viewport gates (§3.2) cannot both be satisfied are never compared at all: they
are never live together, so they cannot collide. `fade-up below:md, fade-left above:md` therefore
composes despite sharing `opacity` and `translate`, and the pair remains a real conflict at any
width both can run.

A registered combo preset (`fade-up, blur-in` → `fade-blur-up`) is *not* substituted
automatically. It is looked up on the collision path only, so the warning can name a concrete
remedy — "Use the `fade-blur-up` effect instead." With no combo registered, the warning suggests
applying the effects to nested elements or registering a combined one.

Illegal collisions must be documented, not merely warned about.

---

## 5. Activation and timeline are separate axes

`on:enter` and `animation-timeline: view()` are **different animation models**, not two tiers of
one thing:

- A view timeline maps progress continuously to scroll position → **reverses on scroll-up**.
- An observer-triggered reveal runs a clock once and **stays completed**.
- `800ms` is meaningful on a time timeline, ~meaningless on a progress timeline.
- Time-based stagger does not map onto scroll progress.
- Deep links and above-viewport elements start in different states.
- `animationend`, fill, cancellation, and replay all differ.

```html
<div data-kui="fade-up"  data-kui-on="enter" data-kui-threshold="30%">
<div data-kui="parallax" data-kui-timeline="view 10% 90%">
<div data-kui="progress" data-kui-timeline="scroll">
```

Contract:
- `on:` always uses event/observer activation. The list is **open**: the library's own names are
  `load`, `enter`, `leave`, `hover`, `unhover`, `focus`, `blur`, `click` and `manual`, and any
  other value is passed straight to `addEventListener` — `on:input`, `on:submit`,
  `on:pointerleave`, `on:cart:updated`. A `start/end` pair (`on:pointerenter/pointerleave`) plays
  the effect forward on the first and backwards on the second. See `core/activation.ts`.
- `timeline:` uses native CSS timelines when available.
- Non-native fallback for `timeline:` either samples via the shared scheduler, or degrades to a
  **documented non-scrub reveal**. Same *degradation*, never "same behavior".

---

## 6. Effect model — orthogonal, not tiered

A single `Tier` enum collapses four independent questions into one. This design treats them as
orthogonal instead:

```ts
interface Effect {
  name: string
  renderer: 'css-keyframes' | 'waapi' | 'javascript'
  channels: Channel[]                                    // for conflict detection
  supportedTimelines: Array<'time' | 'view' | 'scroll' | 'pointer' | 'pin'>
  parameters: ParameterSchema
  perfClass: 'compositor' | 'paint' | 'layout' | 'continuous' | 'dom-transform'
  reducedMotion: 'shorten' | 'crossfade' | 'disable'     // per-effect, not global
  prepare?(el: Element, args: Args, ctx: Ctx): Cleanup
}

type Activation = 'load' | 'enter' | 'hover' | 'focus' | 'click' | 'manual'
```

A CSS-rendered effect can still need observer activation. A JS-*prepared* effect (split-text)
can render through CSS afterward. These are independent.

Capability detection must be **per-feature, not one global check**: `animation-range`, named
timelines / `timeline-scope`, nested scroll containers, individual transform properties,
additive composition, `clip-path` and SVG interpolation. `CSS.supports('animation-timeline','view()')`
alone is not an abstraction boundary.

---

## 7. Parameter schema (not schema-free)

Execution stays mechanically generic; metadata is declared:

```ts
parameters: {
  distance: { type: 'length', default: '24px', cssProperty: '--kui-reveal-distance' }
}
```

Buys TypeScript options, editor autocomplete, generated docs, validation, unit normalization,
semver guarantees, and **safe handling of untrusted markup** — author strings are substituted
into CSS values, so URLs, pathological `calc()`, and huge filters are a real attack surface.

Namespace custom properties **per primitive** (`--kui-reveal-distance`, `--kui-tilt-perspective`),
not generically.

**Defaults live in CSS `var()` fallbacks, never written to `element.style`** — inline custom
properties beat consumer stylesheets, which would break the "consumer CSS wins" guarantee.
Only explicit author overrides get inline precedence.

---

## 8. Cloaking / fail-open

A naive cloaking guard is the opposite of fail-open: an inline script sets a flag, CSS hides
everything, and if the CDN script fails to load, the flag never clears — **the page stays hidden
forever**.

Policy:
- **Default: no global cloaking.** Fail-open is the default behavior.
- Zero-FOUC cloaking is **opt-in**, and only marks elements known to carry reveal effects.
- Required reveal CSS loads **eagerly**, never lazily.
- Cloak installed by a nonce/hash-compatible or external bootstrap (CSP).
- **Watchdog timer uncloaks** if init doesn't complete.
- Print and reduced-motion layers unconditionally force final readable state.

Never rely on `animationend` for correctness — it may not fire after cancellation, removal,
replacement, or some reduced-motion paths. State machines need cancellation + timeout.

Reduced motion is **per-effect** (`shorten` / `crossfade` / `disable`). Blanket `1ms` does not
meaningfully reduce parallax, pinning, flashing, or continuous ambient motion.

---

## 9. Packaging — three explicit products

| Product | Audience | Contents |
|---|---|---|
| **CDN starter** | drop-in, no build | core + common reveal/hover primitives + their CSS. Deterministic, no lazy flash. |
| **CDN loader** | flexible, not "smallest" | small manifest + lazy JS packs for expensive features |
| **ESM core** | app developers | `createAnimator({ effects: [fadeUp, tilt] })` — effect **objects**, statically visible to bundlers, effect-specific TS options |

The build-time template scanner becomes an **optional optimizer, not a correctness dependency**.
It breaks on dynamic names, CMS markup, JSX abstractions, `.play()` aliases, A/B tests, custom
template languages, and out-of-graph monorepo templates. Ship a safelist + extraction callback.

**Do not create one runtime chunk per name.** 267 named effects come from 33 primitive families — ship a compressed
alias table (names → primitive + defaults), CSS per primitive/category, and lazy chunks only
for expensive JS. Fifteen small requests can lose to one 10KB stylesheet. **Generate the full
catalog CSS and measure gzip/Brotli before designing any splitting.**

Lazy-load requirements: fixed manifest (never `import("./effects/" + userValue)`), promise
dedup, pending/ready/failed/cancelled states, resumption of the parsed spec, CSS-load completion
before activation, explicit `assetBase`, CSP + cross-origin failure handling, and a cap against
user markup requesting hundreds of expensive effects.

---

## 10. Lifecycle

`WeakMap<Element, InstanceState>` is the source of runtime truth. Attributes are for CSS and
debugging — they make a poor state machine.

Edge cases that must have defined behavior:
- `querySelectorAll` excludes `root` itself when an inserted root carries the attribute.
- An unknown effect must **not** stamp the normalized attribute — silently dropping such elements
  via a `:not([data-kui-fx])` guard would permanently lose them.
- Changing `data-kui` after processing must recompile.
- Removed elements must clean up.
- Applying shared vars inside the effect loop makes the last effect win.
- CSS animation replay needs a defined restart mechanism.
- MutationObserver work needs batching + subtree limits.
- Stagger needs a group selector, dynamic-child behavior, and reindex policy.
- Duplicate/malformed names need documented behavior.

**Importing the library must not mutate the document.** Auto-observing build and explicit core
are separate entry points (SSR, hydration, tests, multiple versions).

---

## 11. Programmatic API

```js
const anim = kuinetic({ observe: true }).start()
const run = anim.play('.card', 'fade-up', { duration: 800, stagger: 60 })
await run.finished
run.cancel()
run.finish()
```

`play()` accepts a selector, an `Element`, or any iterable of elements — always `Element`, not
`HTMLElement`, since SVG is in scope. Options compile into the same attribute string an author
would write by hand, so the declarative and programmatic surfaces share one execution path
instead of drifting apart.

The returned `PlaybackHandle` is a handle, not a bare promise, because "every element finished"
and "the run is cancellable" are different concerns: `elements` (the resolved target list),
`finished` (a promise resolving once every selected element's animation finishes — resolves,
never rejects, if `cancel()` is called instead), `cancel()`, and `finish()`.

Calling `play()` again on an element that's still mid-run works as a genuine replay, not a
silent no-op: it resets the element's compiled state before reapplying the new configuration
(a compiled effect that hasn't changed would otherwise be treated as already-satisfied and
skipped). An element authored with its own `on:hover`/`on:click`/`on:load` trigger keeps that
trigger after a programmatic `play()` — e.g. the showcase's replay-all button — rather than being
permanently pinned to manual activation; `play()` still fires the effect immediately regardless.

Instance-scoped: `kuinetic({ observe, reporter, ...AnimatorOptions })` returns an `Animator`
bound to its own root, not a process-wide registry — the same shape works for a `ShadowRoot`,
an iframe, a test harness, or an SSR-hydrated subtree.

---

## 12. Platform considerations

- **Shadow DOM** — document CSS and MutationObservers don't cross the boundary.
  `animator.attach(shadowRoot)` + a stylesheet install strategy. Closed roots initialize by owner.
- **SSR/hydration** — no import side effects; explicit `start()`/`hydrate()`.
- **CSP** — not yet verified against real headers in Chromium, Firefox, or WebKit. Needs a
  strict mode with external CSS and a finite set of class/data tokens.
- **Accessibility** — split by grapheme via `Intl.Segmenter` (not code units); one accessible
  reading representation; no `aria-live` spam from counters; hidden reveal targets must not be
  focusable; hover needs focus + coarse-pointer equivalents; policies for flashing, continuous
  motion, zoom, forced colors, reduced transparency.
- **Directionality** — `slide-left` stays physically left; add logical `slide-inline-start` etc.
  Silently flipping "left" in RTL is surprising.
- **Print** — unconditional final-state layer.
- **Versioning** — preset visuals ARE the API. Changing a default distance or easing breaks
  branded sites even with compatible types.

---

## 13. Performance: budgets, not absolutes

"Zero scroll listeners" is not a product benefit if the alternative is an always-running rAF
loop. One passive listener per scroll root marking a shared scheduler dirty is fine.

`filter` is not reliably compositor-cheap. `clip-path`, SVG morph, gauges, and background
effects can force paint. Accordion auto-height and FLIP require layout. Scramble and counters
mutate text.

Classify every effect by `perfClass` and attach automated layout/paint/long-task budgets.
`will-change` sparingly — persistent `will-change` across long scroll ranges costs real memory.

---

## 14. Scope

Names are additive: adding a new named effect is a row in an alias table (name → primitive +
defaults), not new code, provided the underlying primitive and parameter schema already exist.
That's why the catalog can carry 267 named effects from only 33 primitive families.

Deliberately out of scope:
- **Accessible UI components.** Accordion, carousel, and menu components own their own state,
  focus, and ARIA. They deliberately never share the `Effect` interface used by animation
  primitives — this library animates elements, it does not manage component behavior.
- **WebGL/canvas rendering.** Supported only through an adapter that drives a user-supplied
  canvas, never as a built-in renderer.
- **Arbitrary composition beyond the channel model** described in section 4 above.
