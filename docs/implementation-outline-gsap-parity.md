# Implementation Outline — GSAP parity work (tasks A–E)

**Status:** planning document, written 2026-08-26. Nothing in here is built yet.
**Audience:** the five agents implementing tasks A, B, C, D and E, one task each.

---

## 0. How to use this document

Read §1–§4 in full. They apply to every task. Then read only your own task section
(§5 for A, §6 for D, §7 for E, §8 for B, §9 for C, §11 for F) and ignore the others,
except for the branch-base rules in §3.2 which tell you what to branch from. §10 is the
report format and applies to everyone.

Every file reference below was verified against the repository on 2026-08-26. Line
numbers may have drifted; the symbol names have not. If a reference does not resolve,
search for the symbol rather than assuming the claim is wrong.

Where this document says a decision is **LOCKED**, it has already been made by the
owner and is not yours to revisit. Where it says **YOU DECIDE**, make the call, and
justify it in your PR body.

---

## 1. What this library is

kUInetic is a declarative web animation library. The author writes an HTML attribute
and never writes JavaScript:

```html
<h1 data-kui="fade-up 900ms">Hello.</h1>
```

That is the entire product thesis. Any design that requires the author to write a
`.js` file has failed, no matter how elegant it is otherwise.

Verified catalog size, counted by building a registry from `dist/esm/effects/index.mjs`:

| | count |
|---|---|
| presets (named effects) | 255 |
| ├─ rendered as CSS keyframes | 158 |
| └─ rendered as JavaScript | 97 |
| primitives | 128 (71 CSS / 57 JS) |
| combos | 2 |

Source is ~13,900 lines of TypeScript across `src/`. The test suite is 1,488 tests in
73 files and takes ~19 seconds.

### 1.1 Why these five tasks exist

They close the real gaps against GSAP. GSAP 3.15 is free (including all former paid
plugins) and can build almost this entire catalog, so "we are more capable" is not the
argument. The argument is declarative authoring plus a maintained catalog.

Mapped against GSAP's 25 shipped plugins, the catalog already covers ScrollTrigger,
ScrollTo, Draggable, Inertia, Flip, SplitText, ScrambleText, TextPlugin, MorphSVG,
DrawSVG and the custom-ease family. What is missing is:

- no way to control a running animation, and no callbacks at all → **task A**
- no motion-path equivalent → **task D**
- only three DOM events can start an animation → **task E**
- no generic tween; every effect must pre-exist in the catalog → **task B**
- no sequencing; "start B before A ends" is inexpressible → **task C**

---

## 2. Architecture you must understand before writing code

### 2.1 The attribute grammar

Defined in `src/core/parse.ts`:

```
value := spec ("," spec)*
spec  := name [duration] [delay] [easing] key:value*
```

- Comma separates independent effects that share one trigger and start counting from
  the same instant.
- The three positional tokens must appear in that order, and all are optional.
- The tokenizer is paren-aware and quote-aware, because legitimate values contain both
  commas and spaces — `ease:cubic-bezier(.2, .8, .2, 1)` is destroyed by a naive split.
  Any value containing spaces or commas must be quoted.
- Unknown or out-of-order tokens warn by name rather than failing silently. Preserve
  that behaviour.

`target:` is the established precedent for a parameter whose value is a selector and
therefore needs quoting. Follow it. Note that `target:` is **per-primitive**, not
universal — only primitives that call `resolveTarget()` support it. Adding `target:`
to a preset that does not call it produces a silent no-op.

### 2.2 Activation is not the timeline

Two separate concepts that are easy to conflate:

- **Activation** — what *starts* an animation. The `data-kui-on` attribute.
  `src/core/activation.ts`.
- **Timeline** — what *drives progress* once started. `'time' | 'view' | 'scroll' |
  'pointer' | 'pin'`, in `src/core/types.ts`.

`src/core/types.ts:59` states the rule directly: an activation is "distinct from — and
never a substitute for — a Timeline."

### 2.3 The CSS is not standalone

This surprises people, so it is stated plainly. `src/css/presets.generated.css`
contains 234 rules keyed on `[data-kui-fx~='...']`. `data-kui-fx` is the *normalized*
attribute (`src/core/attrs.ts:6`), stamped onto the element by the compiler at runtime.

Consequences:

- Nothing animates without the JavaScript having run. The CSS alone matches nothing.
- CSS keyed on a **primitive id** matches nothing. `data-kui-fx` holds **effect
  (preset) names**. If you write a rule for a primitive, you must enumerate every
  preset that maps to it.
- The benefit that *is* real: once started, these are genuine CSS animations running
  off the main thread. Do not trade that away casually.

### 2.4 The compile pipeline

1. `src/core/parse.ts` — attribute string → `EffectSpec[]`
2. `src/core/compile.ts` — specs → a style plan. `compile.ts:292` writes the
   `animation-delay` track list. `pushTrack` (~`compile.ts:187`) reads `spec.delay` and
   `spec.duration`, and **runs only for `css-keyframes` primitives**.
3. `src/core/style-plan.ts` — the plan, including the paused-plus-negative-delay scrub
   mechanism described at `style-plan.ts:55`
4. `src/core/animator.ts` — applies it, stamps `data-kui-fx` and `data-kui-state`
5. `src/core/instances.ts` — tracks live animations; `instances.ts:12` wraps
   `element.getAnimations()`

CSS for presets is generated by `scripts/generate-preset-css.mjs` into
`src/css/presets.generated.css`. If you add or change a preset you must re-run
`npm run generate:css` and commit the result.

### 2.5 The two-renderer split

Every primitive declares `renderer: 'css-keyframes' | 'javascript'`. This split is the
single largest source of half-finished features in this codebase. **Whatever you build,
state explicitly what it does for each renderer.** Do not support 158 effects and
quietly ignore the other 97.

Known asymmetries you will hit:

- JS effects have **partial, uneven timing support**. Counted from the built registry on
  2026-08-26, of 57 JS primitives: 12 declare `delay`, 29 declare `duration`, 25 declare
  `ease`. So timing works for some and silently does nothing for others. Task F (§11)
  closes this; if you are not task F, treat it as a known limitation and say which side
  of it your work lands on.
- **Timing reaches a JS primitive by two different routes.** The positional spelling
  (`count-up 320ms 300ms`) arrives as `params.timing`, deliberately kept *outside* the
  parameter record — see the design note in `src/core/js-effect-preparer.ts`. The named
  spelling (`count-up delay:300ms`) reaches a primitive only if its schema declares
  `delay`, and is otherwise dropped by `resolveParams` as an unknown parameter. Primitives
  that handle both read `params.timing.delayMs ?? params.ms('delay', 0)`. See
  `TRIGGER_DELAY_PARAM` in `src/effects/shared.ts` and the regression suite in
  `test/js-effect-timing.test.ts`.
- `getAnimations()` returns `[]` for JS effects. This is documented at
  `src/core/play.ts:194`.

Prefer `css-keyframes` wherever it is achievable — see `docs/design.md`. Arbitrary
values are not a reason to reach for JavaScript: the library already drives static
keyframes from custom properties written by the compiler, so a keyframe that
interpolates `var(--kui-something)` is still static CSS.

---

## 3. Rules that apply to every task

### 3.1 Do not push to `main`

Work on the branch named in your task section. Push it, open a PR with `gh pr create`,
and explain in the PR body what you built and every decision you made.

**If `git push` or `gh` fails for any reason:** do not stop silently. Write the full
diff with `git diff <base>...HEAD > PATCH.diff` and paste it into your final report, so
the work survives. State clearly that push failed and why.

### 3.2 Branch bases — three tasks touch the same files

`src/core/parse.ts` and `src/core/compile.ts` are edited by E, B and C. To keep them
from fighting, chain the branches. Run `git fetch origin && git branch -r` first, then:

| task | branch | base |
|---|---|---|
| A | `feat/control-and-events` | `origin/main` |
| D | `feat/motion-path` | `origin/main` |
| E | `feat/open-activations` | `origin/main` |
| B | `feat/generic-tween` | `origin/feat/open-activations` if it exists, else `origin/main` |
| C | `feat/sequencing` | first that exists of `origin/feat/generic-tween`, `origin/feat/open-activations`, `origin/main` |
| F | `feat/js-effect-timing` | `origin/main` |

State in your PR body which base you actually used, and target it as the PR base.

### 3.3 Verification, in this order

```
npm run generate:css     # only if you touched presets or CSS
npm run typecheck
npm run lint
npm test
```

All must pass before you open the PR.

**Run `npm test` once and only once.** Each run uses roughly 2 GB of memory.

### 3.4 Commands that will damage the working tree

- **Do not run `npm run build`.** It regenerates `demo/tailwind.css`, a tracked file,
  and writes it back incorrectly — it drops ~2,465 lines of daisyUI. `npm run
  build:dist` is safe. Note that `npm run test:browser`, `npm run test:visual` and
  `npm run check:css-coverage` each invoke `npm run build` internally, so they carry the
  same hazard.
- **Always run `git status` before `git add`,** and never `git add -A` blindly. If
  `demo/tailwind.css` shows as modified and you did not intend to change it, restore it
  with `git checkout -- demo/tailwind.css` before committing.
- **`npm run size` already fails.** `.size-limit.json` caps `dist/kuinetic.css` at 8 KB
  brotli; it is currently 11.2 KB. The budget is stale and predates your work. You did
  not break it — do not try to fix it, and do not let it block your PR.

### 3.5 Tests

Add unit tests in `test/` for everything you build.

Be aware of what the suite does **not** prove: it never renders a frame. 100% coverage
here demonstrates that effects register and compile, not that anything animates. So a
passing suite is necessary but not sufficient — reason carefully about runtime
behaviour rather than trusting green checkmarks.

If you touch any file under `demo/`, run `test/demo-markup.test.ts`. Index-based
scripted edits to HTML reliably eat closing tags.

### 3.6 Code style

This codebase writes substantial comments explaining **why** a thing is done, not what
it does — often several sentences recording the bug that motivated the code. Read a
neighbouring file in the directory you are editing before writing anything, and match
that density. Terse code with no rationale will look wrong here.

### 3.7 Scope

If you conclude part of your task is a bad idea, build everything else in full and say
plainly in the PR what you left out and why. Do not silently narrow scope. A complete
half, clearly labelled, is far more useful than a broken whole.

---

## 4. Known traps

Landmines already stepped on in this repo. Read these; they are cheaper than
rediscovering them.

1. **Inherited custom properties leak past their group.** `--kui-i` is a position
   *within one stagger group*, but an inherited custom property does not stop at the
   group boundary. A dropdown nested inside item 11 of a staggered list read
   `--kui-i: 11` from its ancestor and opened 660 ms after the click. It is reset in
   `kui.tokens` for exactly this reason. If you introduce a new index- or
   position-valued custom property, you must reset it the same way.
2. **Zero-area start states deadlock `on:enter`.** An `IntersectionObserver` measures
   geometry, not paint. An element whose start state has zero area never intersects, so
   it never activates, so it never leaves the start state. Six presets have hit this.
   Note that bare `data-kui` is already `on:enter` by default.
3. **`clip-path` may be a seventh case of the above.** Three FILLS effects are dead and
   the existing backstop excludes `clip-path` on an assumption nobody has verified.
4. **Never nest a 3D effect inside an animated frame.** `preserve-3d` children join the
   parent's 3D space. This broke `fold-panel` and `wipe-circle`.
5. **A `MutationObserver` sees the END state.** By the time it runs, the stylesheet has
   already repainted. Reading that as the animation's start state plays it backwards.
6. **A hidden browser tab freezes `requestAnimationFrame` and stalls every
   `on:enter`** — no `IntersectionObserver` callbacks fire at all. If you are verifying
   in a browser, check `document.hidden` before concluding an effect is broken.
7. **The default entry does not tree-shake.** `createRegistry()` registers every
   primitive, so anything you add there ships to every consumer. Measured cost of the
   full registry: 122 KB unminified vs 36 KB minified.

---

## 5. Task A — runtime control API and lifecycle events

**Branch:** `feat/control-and-events` from `origin/main`.

### 5.1 The gap

Two related holes:

1. There is no way to pause, resume, reverse, seek or re-speed a running animation.
2. There are no callbacks or events of any kind. `grep -rn "dispatchEvent\|CustomEvent"
   src/ --include="*.ts"` returns **zero** hits. An author can start an animation but can
   never learn that it finished. GSAP has `onStart`, `onComplete`, `onUpdate`.

### 5.2 Most of this already exists — expose it, do not rebuild it

- `src/core/instances.ts:12` already wraps `element.getAnimations()`, so the library
  already holds real `Animation` handles with native `pause()`, `reverse()`,
  `currentTime` and `playbackRate`.
- `src/core/style-plan.ts:55` already implements a seek — a paused animation plus a
  negative `animation-delay` proportional to `--kui-progress`. That is how every
  scroll-scrub effect works today.

### 5.3 What to build

A new `src/core/control.ts` exposing a per-element control handle, reachable from the
public `kuinetic` instance. See `src/index.ts` and `src/core/index.ts` for how the
public surface is currently assembled.

Minimum surface: `pause()`, `play()`, `reverse()`, `seek(progress)` with progress in
0..1, `timeScale(n)`, and readable current progress and playback state.

Plus lifecycle `CustomEvent`s dispatched **on the animated element itself**, so authors
listen with plain `addEventListener` and still write no library-specific JavaScript.
At minimum: started, finished, cancelled. Events must bubble so delegation works.
Namespace them consistently with the existing `kui` namespace — see `src/core/attrs.ts`
and CLAUDE.md.

### 5.4 Decisions

- **LOCKED:** events dispatch on the animated element and bubble.
- **LOCKED:** progress is normalized 0..1, not milliseconds.
- **YOU DECIDE:** how JS-rendered effects participate. They have no `Animation` object
  (§2.5). Either give them a shim that satisfies the same interface, or make the
  limitation explicit and loud. Explain the choice in a code comment, not just the PR.
- **YOU DECIDE:** whether an `onUpdate`-equivalent is worth the cost. A per-frame event
  for every animated element on a page is a real performance decision, not a free one.

### 5.5 Must not break

- The existing scroll-scrub mechanism, which depends on the paused-plus-negative-delay
  trick you are now also driving.
- Existing `prefers-reduced-motion` handling.

### 5.6 Acceptance

- Control handle works on a CSS-rendered effect and does something defensible on a
  JS-rendered one.
- Events fire in the right order, bubble, and carry enough detail to identify which
  effect fired.
- `npm run typecheck && npm run lint && npm test` all pass.

---

## 6. Task D — motion path

**Branch:** `feat/motion-path` from `origin/main`.

### 6.1 The gap

GSAP ships `MotionPathPlugin`: move an element along an arbitrary SVG path, optionally
rotating it to face the direction of travel. kUInetic has nothing equivalent. The
nearest presets, `orbit` and `float`, are fixed shapes rather than arbitrary paths.

This is the only *hard capability* gap in the whole comparison.

### 6.2 CSS already does this

`offset-path`, `offset-distance`, `offset-rotate` and `offset-anchor` are native CSS.
Verified: `grep -rn "offset-path\|offset-distance" src/` returns **zero** hits today.

So this is a `css-keyframes` primitive animating `offset-distance` from 0% to 100%,
with the path supplied by the author. It stays declarative, runs natively, and costs
almost nothing in bundle size.

### 6.3 What to build

Study `src/effects/catalog/core.ts` (the oldest and most conventional catalog file) and
`src/effects/svg/` before starting. Primitives are registered via `cssPrimitive` from
`src/effects/shared.ts`.

### 6.4 Decisions

- **LOCKED:** this is a CSS-keyframes primitive, not a JavaScript one. If you become
  convinced CSS genuinely cannot work, stop and say exactly why in the PR before
  falling back.
- **LOCKED:** ship at least one ready-made named preset in addition to the raw
  primitive. The library's thesis is a catalog of named effects, not a box of
  primitives — an author should be able to drop something on an element without
  authoring path data.
- **YOU DECIDE:** the parameter spelling for path data. It contains spaces and commas,
  so it must be quoted; follow the `target:` precedent (§2.1).
- **YOU DECIDE:** how to expose auto-rotation (`offset-rotate`; GSAP calls it
  `autoRotate`) and what the default should be.
- **YOU DECIDE:** whether this needs to register with `src/core/capabilities.ts` for
  feature detection, and what degradation looks like where unsupported.

### 6.5 Acceptance

- `npm run generate:css` re-run and the generated CSS committed.
- Named preset(s) work with no author-supplied path data.
- `test/demo-markup.test.ts` still passes.

---

## 7. Task E — open the activation list

**Branch:** `feat/open-activations` from `origin/main`.

### 7.1 The gap — this is the highest-value task of the five

`src/core/activation.ts:12` holds the complete activation table:

```
load    → fires immediately
enter   → IntersectionObserver
manual  → API call
hover   → pointerenter, focusin
focus   → focusin
click   → click
```

That is **three real DOM events**: `pointerenter`, `focusin`, `click`. The set is
closed — `src/core/parse.ts:23` rejects anything not on the list.

Why this matters more than it looks: the promise is that the author writes no
JavaScript, so **the activation list is the product**. Three events means ordinary
things are impossible:

- **No `pointerleave`** — "animate back out when the mouse leaves" cannot be expressed.
  That is half of hover, missing.
- **No `focusout`** — same problem for keyboard users.
- **`enter` is one-shot.** The observer callback calls `release()` and unobserves the
  moment it fires, so "fade out when it scrolls away" is impossible, ever.
- **Nothing else at all** — no `input`, `change`, `submit`, `keydown`, `pointerdown`,
  `pointerup`, `dragstart`, `drop`, `resize`, `toggle`, media events, custom events.

The need is already proven internally: the library's own form effects could not use the
activation system, so they hardcode their own listeners — `src/effects/forms/primitives.ts:151`
and `:230`. The machinery exists; authors cannot reach it.

### 7.2 What to build

1. **Make the list open rather than closed.** Any event name the library does not
   specially recognise passes straight to `addEventListener`.

   ```html
   <div data-kui-on="pointerleave">
   <div data-kui-on="input">
   <div data-kui-on="submit">
   ```

2. **Support enter/exit pairs**, so an animation plays forward on one event and
   reverses or plays its exit on another.

3. **Give `enter` an exit twin**, so scroll-away can reverse.

### 7.3 Decisions

- **LOCKED:** existing named activations keep working exactly as they do now. `hover`
  and `focus` are useful sugar and must not regress.
- **LOCKED:** one-shot `enter` remains the **default**. A great many existing effects
  rely on playing once and staying. The exit twin is opt-in. Existing markup must
  behave identically after your change.
- **LOCKED:** whatever you design is expressible in an attribute. No author JavaScript.
- **YOU DECIDE:** the spelling for pairs. A slash pair — `data-kui-on="pointerenter/pointerleave"`
  — is one candidate. Weigh it against alternatives that fit the grammar better, and
  against the fact that `hover` already implies a pair. Justify the choice.

### 7.4 Constraints

- Honour the existing architecture note at `activation.ts:8`: the events table is
  deliberately "a table rather than a switch so adding an activation is a data change
  and the binder's branch count stays flat." Keep the binder flat.
- `activation.ts` shares **one `IntersectionObserver` per distinct threshold**. Do not
  regress that into one observer per element on long pages.
- Listeners are currently registered `{ passive: true }`. Decide whether every event can
  safely stay passive and handle the ones that cannot.
- **Typos become silent.** `data-kui-on="clik"` currently warns. Once the list is open,
  a typo binds a listener that never fires and the author gets nothing. Think about how
  to keep that debuggable — see `src/core/reporter.ts`.

### 7.5 Explicitly out of scope

Events that fire on a **different element** than the one animating ("when the form
submits, animate the badge"). That needs a selector. If your design leaves a clean place
to add it later, say so in the PR.

---

## 8. Task B — generic tween

**Branch:** `feat/generic-tween`. Base per §3.2.

### 8.1 The gap

Every effect must already exist in the catalog. There is no way to say "just move this
element to x=100". GSAP's most basic operation, `gsap.to(el, {x: 100})`, has no
equivalent.

### 8.2 The syntax — LOCKED

Property names go directly into the existing `key:value` slot. Animate from the
element's current state to the values given:

```html
<div data-kui="tween x:100 opacity:0 rotate:45deg 800ms">
```

And a `from` variant, animating from the given values to the element's natural state:

```html
<div data-kui="tween from y:40 opacity:0 600ms">
```

**Do not introduce `to:` or `from:` as value-carrying keys.** Two reasons. `to:` is
already taken — `count-up 1400ms to:237` uses it for a single end value. And
`x:100 to:...` would be two ways to spell one thing, while multiple properties cannot
fit inside one `to:` anyway.

**YOU DECIDE:** exactly how `from` is expressed given the grammar's positional rules
(§2.1). Justify it.

### 8.3 Build it as CSS if you can

See §2.5. Arbitrary values do not force JavaScript — a keyframe interpolating
`var(--kui-tween-from-x)` to `var(--kui-tween-to-x)` is static CSS with dynamic custom
properties, which is how the rest of the library already works. Investigate that first.
If you conclude CSS cannot work, say exactly why in the PR before falling back.

### 8.4 Decisions

- **YOU DECIDE: which properties are allowed.** Author-supplied names flow into CSS. An
  open-ended passthrough is both a correctness problem and an injection risk. Choose an
  allowlist or a strict validation rule and explain it. Cover at least the common
  transform channels and the usual animatable properties.
- **YOU DECIDE: shorthands.** `x` and `y` are not CSS properties, they are conventional
  shorthands for translation. Decide whether to support them and how they map onto
  whatever the library already uses for translation.
- **YOU DECIDE: units.** What does `x:100` mean with no unit — implied `px`, or an
  error?

### 8.5 Channel collisions — do not skip this

The library has a channel model; read `src/core/channels.ts` and `docs/design.md`. Two
effects that both write `transform` on one element collide. A generic tween can write
*any* channel, so it must declare its channels honestly, derived from the properties the
author actually used — not a fixed guess.

---

## 9. Task C — declarative sequencing

**Branch:** `feat/sequencing`. Base per §3.2. This is the hardest of the five.

### 9.1 The gap, stated precisely

GSAP timelines can say "start B 0.3 s before A finishes." kUInetic cannot.

**Read this next part carefully, because it constrains the design.** A previous
investigation in this repo concluded that serial and parallel animation is *already*
possible with the current grammar: parallel means comma-separated specs with no delay;
serial means giving the later spec a `delay:` that offsets past the earlier one's
duration. That investigation explicitly rejected new syntax that merely respells
existing semantics.

So an absolute `at:200ms` is worthless. It is `delay:200ms` with a new name.

**The genuinely new capability is RELATIVE positioning**, so authors stop hand-computing
delays:

```html
<h1 data-kui="fade-up 600ms, blur-in 400ms at:-200ms">
```

Meaning: start `blur-in` 200 ms *before* `fade-up` ends. The compiler resolves that to a
concrete `animation-delay` of 400 ms.

Support at least relative-before (`at:-200ms`), relative-after (`at:+100ms`), and
starting together with the previous spec. **YOU DECIDE** whether named labels earn their
complexity; say what you concluded.

### 9.2 Computed delays, not a runtime playhead — LOCKED

Do not build a JavaScript playhead driving frames. A declarative sequence resolves to
arithmetic the compiler can do ahead of time, which keeps sequences CSS-native.

The machinery exists:

- `src/core/compile.ts:292` already writes an `animation-delay` track list.
- `src/core/stagger.ts` already indexes children of a group and lets CSS `calc()` do the
  offset arithmetic rather than recomputing per element in JS.

Read `stagger.ts`'s comments in full before designing. Two of its lessons apply directly
to you: the `--kui-i` leak (§4.1), and why `--kui-stagger-count` has to exist at all —
the compiler compiles one element without reference to its siblings.

### 9.3 Two scopes

**Scope 1 — same element, across comma-separated specs.** `at:` positions each spec
relative to the previous one. Needs no new attribute at all.

**Scope 2 — across sibling elements.** "h1, then p, then button." An element cannot see
its siblings from its own attribute, so this needs a marker on the shared parent. Model
it on the existing `data-kui-stagger`, which solves exactly this shape.

```html
<div data-kui-seq>
  <h1 data-kui="fade-up">
  <p  data-kui="fade-up at:-200ms">
</div>
```

**LOCKED:** exactly one new parent attribute. No per-child attribute — `at:` lives
inside the existing `data-kui`. The owner has explicitly asked not to proliferate
attributes.

### 9.4 Hard cases you must address

- **Many JS-rendered effects cannot be positioned in a sequence.** Only 12 of 57 JS
  primitives declare a `delay` parameter (§2.5). Task F (§11) is closing that gap in
  parallel with you, so do **not** fix it yourself — assume `delay` will become widely
  available and design against the interface, but make any effect that still lacks it
  fail **loudly** rather than silently ignoring its `at:`.
- **Resolving `at:` needs the previous spec's duration.** Work out what happens when
  that duration is a default rather than explicit, when the timeline is percentage-based
  scroll rather than a clock, and when the previous effect is JS-rendered with no
  duration at all.
- **Interaction with stagger.** A sequence inside a stagger group, or the reverse, must
  not double-count offsets.
- **Scroll timelines.** `timeline: view | scroll | pin` exist. Decide whether `at:` is
  even meaningful when the driver is scroll position, and be explicit about what you
  support.

### 9.5 If you run out of room

Finish **scope 1 completely and well**, then say plainly in the PR what you left
undone. Do not deliver both scopes half-built.

---

## 10. Final report

End your session with a short summary containing:

- branch name, and what you based it on
- PR URL — or `PUSH FAILED` plus the full diff
- files changed
- test counts before and after
- the exact attribute syntax you settled on, with a worked example
- anything you could not finish, stated plainly

---

## 11. Task F — timing parity for JavaScript-rendered effects

**Branch:** `feat/js-effect-timing` from `origin/main`.

### 11.1 The gap

CSS-rendered effects take `duration`, `delay` and `ease` uniformly. JavaScript-rendered
ones do not. Counted from the built registry on 2026-08-26, of **57 JS primitives**:

| parameter | declared by | missing from |
|---|---|---|
| `delay` | 12 | 45 |
| `duration` | 29 | 28 |
| `ease` | 25 | 32 |

The result is that `data-kui="split-flap 400ms delay:200ms"` looks like it should work,
parses without complaint, and then does nothing with the delay. The author gets silence,
not an error.

This blocks task C (sequencing): an effect that ignores `delay` cannot be positioned in a
sequence.

### 11.2 This is NOT "add delay to all 97"

Read this before you start, because the naive version of this task is wrong.

Many JS primitives legitimately have no use for a delay. `pin`, `scroll-progress`,
`scroll-spy`, `draggable`, `magnetic`, `cursor-follow`, `cursor-lag`, `tilt-3d`,
`header-shrink` and the rest of that family are **continuous or interactive** — driven by
pointer position or scroll offset, not by a clock that starts at a moment. "Delay this by
200 ms" is meaningless for an effect that has no start.

Others plainly *should* support it and do not. Strong candidates, all one-shot or
triggered animations: `split-flap`, `border-draw`, `beam-border`, `underline-slide`,
`underline-center`, `icon-wiggle`, `icon-spin`, `icon-bounce`, `icon-toggle`,
`toggle-morph`, `flip-indicator`, `path-morph`, `card-toggle`, `shine-sweep`, `lift`,
`pop`, `lift-shadow`.

**YOU DECIDE** the exact split. Go through all 45 primitives lacking `delay` and classify
each as one-shot (should have it) or continuous/interactive (should not). Put the
classification in the PR body as a table. That table is a deliverable in its own right —
it is the first time anyone will have written it down.

### 11.3 What to build

1. **Add the missing timing parameters** to the primitives your classification says
   should have them. `TRIGGER_DELAY_PARAM` in `src/effects/shared.ts` exists precisely to
   be spread into a schema; use it rather than retyping the declaration, and read its
   doc comment first — it explains why `0ms` being a true no-op is what makes spreading
   it safe.

2. **Make the primitive actually honour it.** Declaring the parameter is not enough. The
   established pattern is `params.timing.delayMs ?? params.ms('delay', 0)` — see
   `src/effects/catalog/text.ts:310`, `:395` and `:465`. Note there are two routes into a
   primitive (§2.5): the positional spelling arrives via `params.timing`, the named
   spelling only if the schema declares it. Support both.

3. **Make an ignored timing parameter loud instead of silent.** This is the part that
   matters most for authors. If a primitive genuinely cannot honour `duration` or `ease`,
   an author who writes one should get a warning naming the effect and the parameter, not
   silence. See `src/core/reporter.ts`. Note the deliberate precedent at
   `src/effects/catalog/text.ts:172`, where `duration`/`ease` are *intentionally* not
   declared because the stylesheet pins them — that is a case to warn about, not to
   "fix".

4. **YOU DECIDE** whether `duration` and `ease` are worth extending as widely as `delay`,
   or whether the honest answer for some primitives is a documented, warned refusal. A
   knob that exists but does nothing is worse than no knob.

### 11.4 Constraints

- **Do not change any existing default.** Adding a parameter must not alter how existing
  markup behaves. `TRIGGER_DELAY_PARAM` defaults to `0ms` for exactly this reason.
- **Do not touch `src/core/`** unless you genuinely must. This task is schema and
  primitive work in `src/effects/`. Task C is editing the core compile path in parallel.
- `test/js-effect-timing.test.ts` already exists — it is the regression suite that caught
  the last round of this exact defect. Read it first, extend it, and do not break it.

### 11.5 Acceptance

- A written classification of all 45 primitives currently lacking `delay`.
- Every primitive you classified as one-shot honours `delay` via both routes, with tests.
- Any primitive that ignores an authored timing parameter warns by name.
- No existing behaviour changed for existing markup.
