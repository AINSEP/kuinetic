# Design review request: a public, standalone web animation library

You are reviewing a **design**, not code. Nothing has been built yet. Give me concrete
improvements, holes, and things I have wrong.

**Do NOT read `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` anywhere on disk. Do not explore
the filesystem. Everything you need is in this document.** The working directory is an
empty scratchpad and is irrelevant to the task.

---

## 0. What this is (important framing)

An **independent, standalone, open-source JavaScript/TypeScript animation library**.

- Published to **npm**, MIT licensed, and usable **via a plain `<script>` tag from a CDN**
  (unpkg/jsdelivr) with zero build step, *as well as* via bundlers (Vite/Rollup/webpack/esbuild).
- **No framework.** Not React, not Vue, not Svelte. Vanilla HTML/CSS/JS. It must work in a
  hand-written HTML file, a Jekyll site, a WordPress theme, a Rails app, a Next.js app, anywhere.
- It is **not** tied to any CMS, product, or company. Assume a general public audience:
  hobbyists dropping in a script tag, agencies building marketing sites, and app developers
  importing modules.
- Goal: **~250 named animation effects** covering essentially the entire "web design animation"
  surface — the thing you'd otherwise assemble from GSAP + ScrollTrigger + SplitText + AOS +
  Animate.css + Lottie + a dozen CodePens.
- Two hard constraints that pull against each other:
  1. **Ease of use** — the primary authoring API is HTML `data-*` attributes, no JS required.
  2. **Small payload** — a site using 15 effects must not download all 250.

Competitive context: GSAP (excellent, free since Webflow bought it, but a custom non-OSI
license and an imperative JS-only API), Motion/motion.dev (MIT core, but splitText,
ScrambleText, AnimateNumber, Cursor, Ticker and Carousel are paid Motion+ exclusives),
AOS (MIT, attribute-driven, but unmaintained-ish, ships everything, and predates CSS
scroll-driven animations), Animate.css (CSS only, no triggers).

---

## 1. Core architectural bet

**The JS is a compiler, not an animator.** It reads attributes, resolves arguments, stamps
CSS custom properties + a normalized attribute onto the element, and then gets out of the way.
The browser's own engine runs the animation.

Specifically: on browsers supporting `animation-timeline: view()` / `scroll()`, the entire
scroll-triggered category ships **zero runtime JS** after the initial scan. JS only reappears
for effects that genuinely need per-frame math (magnetic cursor, scramble text, counters,
tilt, pinning).

---

## 2. Authoring API — HTML attributes

The attribute value grammar deliberately **mirrors the CSS `animation` shorthand**, so authors
reuse knowledge they already have:

```html
<h1 data-anim="fade-up">Hello</h1>
<h1 data-anim="fade-up 800ms 200ms ease-out">Hello</h1>
<!--            effect  duration delay  easing -->

<!-- multiple effects, comma-separated, exactly like CSS animation -->
<h1 data-anim="fade-up 800ms, blur-in 400ms">Hello</h1>

<!-- triggers -->
<div data-anim="fade-up"  data-anim-on="enter 30%">
<div data-anim="parallax" data-anim-on="scroll">
<div data-anim="tilt"     data-anim-on="hover">
<div data-anim="fade-in"  data-anim-on="load">
```

Two time values disambiguate the same way CSS does (first = duration, second = delay).

### Arguments → CSS custom properties (generic, no per-effect arg registry)

Any longhand attribute maps mechanically to a custom property:

```html
<div data-anim="fade-up" data-anim-distance="40px" data-anim-blur="12px">
```

`data-anim-distance="40px"` → `el.style.setProperty('--anim-distance', '40px')`.

The JS never knows what `distance` means; the CSS does:

```css
@layer anim.effects {
  [data-anim-fx~="fade-up"] {
    animation: anim-fade-up var(--anim-duration, 600ms)
                            var(--anim-ease, ease-out)
                            var(--anim-delay, 0ms) both;
  }
  @keyframes anim-fade-up {
    from { opacity: 0; translate: 0 var(--anim-distance, 24px); }
  }
}
```

Adding a new tunable knob = one line of CSS, zero JS.

### Source vs normalized attribute

Author writes `data-anim` (rich grammar). JS writes `data-anim-fx` (space-separated effect
names only). CSS selectors key off `data-anim-fx` with `~=`, keeping selectors trivial while
the authoring grammar can evolve. Cascade layers (`@layer`) so consumer CSS wins without
`!important`.

Known unresolved wrinkle: with multiple comma-separated effects on one element, timing args
are currently **shared** across them; per-effect args would need namespacing
(`--anim-fade-up-duration`) which seems like too much complexity. Is shared-timing the right
call?

---

## 3. Programmatic API

```js
import { anim } from 'the-lib'

anim('#hero h1').play('fade-up', { duration: 800 })
anim(document.getElementById('hero')).play('fade-up')
anim(document.getElementsByClassName('card')).play('tilt')
await anim('.card').play('fade-up', { stagger: 60 })   // awaitable
anim('.hero').stop()
```

Accepts selector string | Element | NodeList | array. **Same registry** as the attributes —
the options object writes the same custom properties, so there is one execution path.

---

## 4. Three execution tiers

```ts
type Tier =
  | 'css'          // pure CSS; JS stamps props once, never runs again
  | 'css-observed' // CSS keyframes, JS supplies only the trigger (IntersectionObserver/events)
  | 'js'           // per-frame math; WAAPI where possible

interface Effect {
  name: string
  tier: Tier
  vars?: Record<string, string>                     // default custom properties
  setup?(el: HTMLElement, args: ResolvedArgs, ctx: Ctx): () => void   // tier 'js' only
}
```

Feature-detect once at boot: `CSS.supports('animation-timeline', 'view()')`. If true,
`fade-up` resolves to `css` (nothing installed). If false it degrades to `css-observed` with
one shared IntersectionObserver. **The author writes the same attribute either way.**

---

## 5. Core scanner (essentially the whole runtime)

```ts
const EFFECTS = new Map<string, Effect>()

export function scan(root: ParentNode = document) {
  for (const el of root.querySelectorAll('[data-anim]:not([data-anim-fx])')) {
    const specs = parse(el.dataset.anim)          // "fade-up 800ms, blur-in" → Spec[]
    const names = []
    for (const spec of specs) {
      const fx = EFFECTS.get(spec.name)
      if (!fx) { lazyLoad(spec.name); continue }
      applyVars(el, { ...fx.vars, ...spec.vars, ...longhandVars(el) })
      names.push(spec.name)
      if (fx.tier === 'js' || (fx.tier === 'css' && !NATIVE_SCROLL)) fx.setup(el, spec.args, ctx)
    }
    el.dataset.animFx = names.join(' ')
  }
}
export function registerEffect(fx: Effect) { EFFECTS.set(fx.name, fx) }
```

Wrapped in a `MutationObserver` so dynamically inserted DOM animates automatically.

Stagger is parent-level: set `--anim-i` on children, then
`animation-delay: calc(var(--anim-delay,0ms) + var(--anim-i,0) * var(--anim-stagger,60ms))`.

---

## 6. FOUC / fail-open guard

Reveal effects need elements to start invisible. If the JS fails to load (CDN blocked, error,
slow network) a naive implementation leaves the whole page blank. Plan:

```html
<script>document.documentElement.dataset.anim='ready'</script>  <!-- inline in <head> -->
```
```css
:root[data-anim="ready"] [data-anim]:not([data-anim-done]) { opacity: 0; }
```

No JS → no flag → nothing hidden → content fully readable, just unanimated.
(`@media (scripting: enabled)` was rejected: it's true even when *our* script is what failed.)

Reduced motion lives in the CSS layer so it works without JS, and *reduces* rather than kills
(`animation-duration: 1ms !important`) so `animationend` still fires and state machines
don't hang.

---

## 7. Packaging & the size/ease tension — the part I most want challenged

`data-anim="fade-up"` is a **string in HTML**, invisible to bundlers. So a naive
attribute-driven library must ship all 250 effects (this is exactly why AOS ships everything).

Proposed three-mode answer:

| Mode | Audience | Payload |
|---|---|---|
| **Build-time scan** — a Vite/Rollup/webpack/PostCSS plugin greps templates for `data-anim` values and `.play('…')` calls, emits a virtual module with only those effects' JS *and* CSS (the Tailwind JIT approach) | bundler users | pay-per-effect, ~5KB typical |
| **Manual imports** + `registerEffect()` | app developers | pay-per-effect |
| **CDN `<script>` auto build** — auto-scans on DOMContentLoaded | no-build drop-in | ~8KB core, effect packs `import()`ed lazily on demand |

Runtime safety net: an unknown effect name encountered at scan time triggers a dynamic
`import()` of just that effect's chunk — correct by default when the build step couldn't
predict the markup (e.g. user-generated content).

Module granularity: **one module per primitive**, packs are re-exporting barrels only
(otherwise importing `scramble` drags in `split-text` and `typewriter`).

Rough size model: core ~3KB gz; a `css`-tier effect ~200 bytes of `@keyframes` and zero JS;
a `js`-tier primitive ~200–600 bytes. That rough model is superseded now that there's a build to
measure: the shipped catalog carries 262 named effects, and all of it loaded — `esbuild --bundle
--minify` for both bundles, `gzip -9` — comes to ~58KB gz today (~44.2KB JS + ~13.6KB CSS), vs GSAP
core + ScrollTrigger ≈ 70KB. (An earlier ~55KB figure here was this same rough per-effect model
extrapolated for a smaller, pre-implementation catalog; it landed near today's real number by
coincidence, not because the model was validated against a build.)

---

## 8. Performance invariants (enforced by architecture, not later optimization)

- One shared `IntersectionObserver`, one shared `rAF` loop, one shared `ResizeObserver` for the
  whole page — never per element.
- **Zero `scroll` event listeners.** Native scroll-driven CSS, or IntersectionObserver.
- Only compositor-safe properties (`transform`/`translate`/`scale`/`rotate`/`opacity`/`filter`).
  Never `top`/`left`/`width`/`margin`.
- `will-change` applied on activation, stripped on completion.
- Elements unobserved after they play.
- Batched DOM reads/writes to avoid layout thrash.

---

## 9. Catalog scale

~250 named effects from ~30 primitives, because most names are parameter variants
(`fade-up` and `slide-left` are one primitive with different axis/distance args; the
entrance/exit matrix alone is ~48 names from one primitive). Categories: entrance/exit matrix,
scroll reveal & parallax, scroll mechanics (pin, scrollytelling, stacking cards, sequence
scrub), text & typography (split, glitch, decode, variable-font weight morph, text-on-path),
SVG & icons (path draw, morph, hamburger→X), numbers & data viz (odometer, progress ring,
gauge), media & images (clip-path wipes, before/after, blur-up), FLIP layout transitions
(filter/sort reflow, card→modal shared element, accordion auto-height), navigation & menus,
forms & inputs, feedback & status (ripple, confetti, skeleton→content), cursor & pointer,
hover micro-interactions, 3D & perspective, ambient backgrounds, physics & gestures,
page transitions.

WebGL/particle backgrounds are explicitly **out of scope** as a renderer; shipped instead as an
adapter that drives a user-supplied canvas.

Acknowledged expensive parts: the scroll orchestrator (pin / scrollytelling / sequence scrub)
is ~40% of total effort; physics/gestures needs a real spring solver.

---

## 10. What I want from you

Be blunt and specific. Prioritize by impact. In particular:

1. **The tree-shaking story.** Is build-time template scanning + runtime lazy `import()` the
   right answer for a *public* library where most consumers will never install a plugin?
   What breaks? Is there a better mechanism I'm missing?
2. **The attribute grammar.** Is mirroring the CSS `animation` shorthand smart or a trap?
   Positional args, comma-separated composition, shared timing across composed effects,
   `data-anim` vs normalized `data-anim-fx`. Where does this grammar fall apart at 250 effects?
3. **The CSS-first / three-tier bet.** Is "JS as compiler" sound given real-world browser
   support in 2026? Where does the tier abstraction leak — i.e. where will `css` and
   `css-observed` produce *visibly different* results from the same attribute, and how bad is
   that?
4. **FOUC / fail-open.** Is the `:root[data-anim="ready"]` guard sound? Better options?
5. **Things I haven't considered at all.** Candidates I suspect matter: Shadow DOM / web
   components, SSR & hydration, CSP (`style-src` without `'unsafe-inline'` and whether
   `style.setProperty` / constructed stylesheets survive it), iframe and cross-document
   contexts, `@scope`, View Transitions API integration, accessibility beyond
   `prefers-reduced-motion` (split-text and screen readers, focus management during pinned
   scroll, `aria-live` for counters), print styles, versioning/semver for a 250-effect
   registry, effect naming collisions, i18n/RTL (direction-aware `slide-left`), long-term
   maintenance of a 250-effect catalog by a small team, and testing strategy for animations.
6. **Is there actually a gap in the market here**, or is this a worse GSAP? If you think the
   positioning is wrong, say so plainly and say what the defensible wedge would be instead.
7. **API ergonomics** — naming (`data-anim`? something else?), the `.play()` shape, anything
   that will feel wrong to a working developer.

Where you disagree with a decision, name the decision, say why it's wrong, and give the
alternative. Concrete beats comprehensive.
