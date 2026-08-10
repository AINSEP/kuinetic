# Declarative Web Animation Library — Design v2

Revised after the `gpt-5.6-sol` design review (2026-08-09). Supersedes v1.
Codename `kin` throughout — **placeholder only**, the real namespace must be chosen before publish.

---

## 1. Positioning

**The promise:** the common 80% of web motion, straight from HTML, executed natively by the
browser, with strong progressive enhancement.

**Explicitly NOT the promise:** a declarative replacement for GSAP's general choreography, or
a UI component library. That framing forces a large orchestration runtime, breaks semantic
consistency across fallbacks, and makes the catalog a permanent compatibility burden.

Standalone, MIT, npm + CDN `<script>`, framework-agnostic. No product or CMS coupling.

---

## 2. Naming (decide before any code)

`data-anim` and `--anim-*` are too generic for a public library — guaranteed collisions with
site code and other libraries. One short project namespace must cover **all five** of:

- attributes (`data-kin`, `data-kin-on`)
- custom properties (`--kin-reveal-distance`)
- keyframe names (`@keyframes kin-fade-up`)
- cascade layers (`@layer kin.effects`)
- emitted events (`kin:start`, `kin:finish`)

---

## 3. Attribute grammar — one tag

**Owned grammar, fixed order. Do not claim CSS-shorthand equivalence** — CSS permits multiple
orders and allows commas inside `steps()`/`linear()`, which imports ambiguity for no gain.

```
kin-value    := effect-spec ("," effect-spec)*
effect-spec  := <effect-name> [<duration>] [<delay>] [<easing>] <key:value>*
```

```html
<h1 data-kin="fade-up">
<h1 data-kin="fade-up 800ms">
<h1 data-kin="fade-up 800ms 200ms ease-out">
<h1 data-kin="fade-up 800ms distance:40px">
<h1 data-kin="slide-up 800ms, blur-in 400ms">
```

Rules:
- Positional args must appear in the order above. Unknown or out-of-order tokens produce a
  **dev-mode console warning naming the element and the token** — never a silent no-op.
- Parser must be paren-aware (`ease:cubic-bezier(.2,.8,.2,1)` contains commas). ~30 lines.
- Attribute values may contain newlines; whitespace normalizes.
- Longhand `data-kin-duration` etc. remains as an optional alias for server-side templating.
  Both parse into the identical internal spec.

---

## 4. Composition — the channel model

**Why the naive design failed:** two CSS rules each declaring `animation` don't concatenate;
the cascade discards one. And two animations writing the same property replace rather than
blend.

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
   animation-name:     kin-slide-up, kin-blur-in;
   animation-duration: 800ms,        400ms;
   ```
3. **Channel collision** → dev warning naming both effects; opt-in WAAPI `composite:'add'`
   path (drops to JS renderer) for genuine blending.

Illegal collisions must be documented, not merely warned about.

---

## 5. Activation and timeline are separate axes

The single most important correction from review. `on:enter` and `animation-timeline: view()`
are **different animation models**, not two tiers of one thing:

- A view timeline maps progress continuously to scroll position → **reverses on scroll-up**.
- An observer-triggered reveal runs a clock once and **stays completed**.
- `800ms` is meaningful on a time timeline, ~meaningless on a progress timeline.
- Time-based stagger does not map onto scroll progress.
- Deep links and above-viewport elements start in different states.
- `animationend`, fill, cancellation, and replay all differ.

```html
<div data-kin="fade-up"  data-kin-on="enter" data-kin-threshold="30%">
<div data-kin="parallax" data-kin-timeline="view 10% 90%">
<div data-kin="progress" data-kin-timeline="scroll">
```

Contract:
- `on:` always uses event/observer activation (`load`, `enter`, `hover`, `focus`, `click`, `manual`).
- `timeline:` uses native CSS timelines when available.
- Non-native fallback for `timeline:` either samples via the shared scheduler, or degrades to a
  **documented non-scrub reveal**. Same *degradation*, never "same behavior".

---

## 6. Effect model — orthogonal, not tiered

The v1 `Tier` enum collapsed four independent questions. Replace with:

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
  distance: { type: 'length', default: '24px', cssProperty: '--kin-reveal-distance' }
}
```

Buys TypeScript options, editor autocomplete, generated docs, validation, unit normalization,
semver guarantees, and **safe handling of untrusted markup** — author strings are substituted
into CSS values, so URLs, pathological `calc()`, and huge filters are a real attack surface.

Namespace custom properties **per primitive** (`--kin-reveal-distance`, `--kin-tilt-perspective`),
not generically.

**Defaults live in CSS `var()` fallbacks, never written to `element.style`** — inline custom
properties beat consumer stylesheets, which would break the "consumer CSS wins" guarantee.
Only explicit author overrides get inline precedence.

---

## 8. Cloaking / fail-open

The v1 guard was the opposite of fail-open: inline script sets flag → CSS hides everything →
CDN fails → **page hidden forever**.

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

**Do not create 250 runtime chunks.** ~250 names come from ~33 primitives — ship a compressed
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

Known holes from review, all must have defined behavior:
- `querySelectorAll` excludes `root` itself when an inserted root carries the attribute.
- An unknown effect must **not** stamp the normalized attribute — v1's scanner permanently lost
  such elements to the `:not([data-kin-fx])` guard.
- Changing `data-kin` after processing must recompile.
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
const run = animator.play('.card', fadeUp, { duration: 800, stagger: 60 })
await run.finished
run.cancel(); run.finish(); run.reverse()
```

Must define: whether `finished` waits for all elements; cancel = resolve or reject; behavior for
infinite/hover/scroll-linked; second `play()` = replace/queue/concurrent; whether `stop()`
restores inline styles and DOM; empty-selector behavior; live vs snapshotted collections.

Use `Element`, not `HTMLElement` — SVG is in scope.

Instance-scoped (`createAnimator({ root, effects, reducedMotion, assetBase })`), not a
process-wide registry — makes ShadowRoots, iframes, testing, and SSR tractable.

---

## 12. Platform work that needs first-class design

- **Shadow DOM** — document CSS and MutationObservers don't cross the boundary.
  `animator.attach(shadowRoot)` + a stylesheet install strategy. Closed roots initialize by owner.
- **SSR/hydration** — no import side effects; explicit `start()`/`hydrate()`.
- **CSP** — untested until verified against real headers in Chromium, Firefox, WebKit. Needs a
  strict mode with external CSS and finite class/data tokens.
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

## 14. Roadmap

| | Primitives | Names | Adds |
|---|---|---|---|
| **v1** | ~22 | 60–80 | reveals, entrance matrix, hover, text (split/typewriter/scramble/decode), counters, SVG stroke draw, clip-path wipes, ambient backgrounds, 3D card flip, native parallax + progress |
| **v2** | +6 | +~90 | scroll orchestrator (pin, scrollytelling, stacking, sequence scrub), FLIP layout transitions, arbitrary SVG path morph |
| **v3** | +5 | +~80 | gestures, physics/springs, page transitions, 3D depth |
| **Total** | **~33** | **~250** | |

Adding a name in v2/v3 is a row in the alias table, not new code — provided the primitives and
the parameter schema are right in v1.

**Deliberately excluded from v1:** pinning, general FLIP, physics, gestures, accessible UI
components (accordion/carousel/menu own state, focus, and ARIA — they must never share the
`Effect` interface), and arbitrary composition beyond the channel model.

### Coverage of the original 33-item wishlist

30 of 33 ship in v1. Deferred: **sticky pin** (v2), **horizontal-scroll section** (v2).
Excluded: **WebGL/canvas backgrounds** — ships as an adapter driving a user-supplied canvas,
never as a renderer. Caveat: icon *wiggle* is v1; arbitrary SVG *shape morph* is v2.

---

## 15. Open questions

1. Namespace/codename — blocks everything downstream.
2. Measure full-catalog CSS under Brotli before committing to any splitting strategy.
3. Is the channel model sufficient, or is a `composite:'add'` WAAPI path needed in v1?
4. Non-native fallback for `timeline:` — sample via scheduler, or degrade to non-scrub? (Sampling
   contradicts the zero-scroll-listener goal; degrading is visibly different.)
5. Does the optional build scanner earn its maintenance cost at v1, or wait for v2?
