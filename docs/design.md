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
in this catalog.** As of GSAP 3.13 (April 2025, following Webflow's acquisition of GreenSock),
every plugin that used to require a paid Club GreenSock membership — `SplitText`, `MorphSVGPlugin`,
`DrawSVGPlugin`, `ScrambleTextPlugin`, `Draggable`/`InertiaPlugin`, `Flip` — is free, including for
commercial use. Combined with `ScrollTrigger` and GSAP's core tween/timeline engine, that covers
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

1. **Zero JS runtime dependency.** These are real CSS `@keyframes` / `animation-timeline`
   animations. They keep running if a script is slow, blocked, or fails to load, and there is no
   library payload to download and execute first. GSAP is a JS engine you ship and run — core
   plus `ScrollTrigger` plus `SplitText` plus `MorphSVGPlugin` adds up fast, and every animation on
   the page depends on that JS having successfully loaded and executed.
2. **Declarative HTML authoring, not an imperative API.** `<h1 data-dsg="fade-up 900ms">` is the
   whole configuration. No JS file to write, own, or debug. GSAP is fundamentally a JavaScript API
   — even the simplest GSAP animation is a `.js` file someone writes and maintains.
3. **A catalog, not an engine.** GSAP gives you the primitives to build any of these effects; it
   does not ship ~237 ready-made, ready-to-drop-onto-an-element named animations. Even on a GSAP
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
so the project uses one short namespace, `dsg`, consistently across all four surfaces:

- attributes (`data-dsg`, `data-dsg-on`)
- custom properties (`--dsg-reveal-distance`)
- keyframe names (`@keyframes dsg-fade-up`)
- cascade layers (`@layer dsg.effects`)

---

## 3. Attribute grammar — one tag

**Owned grammar, fixed order. Do not claim CSS-shorthand equivalence** — CSS permits multiple
orders and allows commas inside `steps()`/`linear()`, which imports ambiguity for no gain.

```
dsg-value    := effect-spec ("," effect-spec)*
effect-spec  := <effect-name> [<duration>] [<delay>] [<easing>] <key:value>*
```

```html
<h1 data-dsg="fade-up">
<h1 data-dsg="fade-up 800ms">
<h1 data-dsg="fade-up 800ms 200ms ease-out">
<h1 data-dsg="fade-up 800ms distance:40px">
<h1 data-dsg="slide-up 800ms, blur-in 400ms">
```

Rules:
- Positional args must appear in the order above. Unknown or out-of-order tokens produce a
  **dev-mode console warning naming the element and the token** — never a silent no-op.
- Parser must be paren-aware (`ease:cubic-bezier(.2,.8,.2,1)` contains commas). ~30 lines.
- Attribute values may contain newlines; whitespace normalizes.
- Longhand `data-dsg-duration` etc. remains as an optional alias for server-side templating.
  Both parse into the identical internal spec.

---

## 4. Composition — the channel model

**Why simple concatenation doesn't work:** two CSS rules each declaring `animation` don't
concatenate; the cascade discards one. And two animations writing the same property replace
rather than blend.

**Fix:** every primitive declares the CSS properties it owns. Modern CSS made `translate`,
`rotate`, and `scale` independent properties, which yields five disjoint channels:

| Channel | Property | Example primitives |
|---|---|---|
| opacity | `opacity` | fade |
| position | `translate` | slide, parallax, float |
| scale | `scale` | zoom, pop, ken-burns |
| rotation | `rotate` | spin, tilt-2d, wiggle |
| filter | `filter` | blur, brightness, saturate |

Compiler resolution order for a comma list:

1. **Registered combo preset** for that exact set → use it (single tested keyframe, no conflict).
2. **Channels disjoint** → emit one compiled declaration:
   ```css
   animation-name:     dsg-slide-up, dsg-blur-in;
   animation-duration: 800ms,        400ms;
   ```
3. **Channel collision** → dev warning naming both effects; opt-in WAAPI `composite:'add'`
   path (drops to JS renderer) for genuine blending.

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
<div data-dsg="fade-up"  data-dsg-on="enter" data-dsg-threshold="30%">
<div data-dsg="parallax" data-dsg-timeline="view 10% 90%">
<div data-dsg="progress" data-dsg-timeline="scroll">
```

Contract:
- `on:` always uses event/observer activation (`load`, `enter`, `hover`, `focus`, `click`, `manual`).
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
  supportedTimelines: Array<'time' | 'view' | 'scroll' | 'pointer'>
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
  distance: { type: 'length', default: '24px', cssProperty: '--dsg-reveal-distance' }
}
```

Buys TypeScript options, editor autocomplete, generated docs, validation, unit normalization,
semver guarantees, and **safe handling of untrusted markup** — author strings are substituted
into CSS values, so URLs, pathological `calc()`, and huge filters are a real attack surface.

Namespace custom properties **per primitive** (`--dsg-reveal-distance`, `--dsg-tilt-perspective`),
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

**Do not create 237 runtime chunks.** ~237 names come from 29 primitives — ship a compressed
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
  via a `:not([data-dsg-fx])` guard would permanently lose them.
- Changing `data-dsg` after processing must recompile.
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
const anim = designimation({ observe: true }).start()
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

Instance-scoped: `designimation({ observe, reporter, ...AnimatorOptions })` returns an `Animator`
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
That's why the catalog can carry ~237 names from only 29 primitives.

Deliberately out of scope:
- **Accessible UI components.** Accordion, carousel, and menu components own their own state,
  focus, and ARIA. They deliberately never share the `Effect` interface used by animation
  primitives — this library animates elements, it does not manage component behavior.
- **WebGL/canvas rendering.** Supported only through an adapter that drives a user-supplied
  canvas, never as a built-in renderer.
- **Arbitrary composition beyond the channel model** described in section 4 above.
