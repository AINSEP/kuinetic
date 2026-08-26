# Handoff — 2026-08-26 session

`main` is at `ce7a87a`. Everything below was found or built this session.

---

## What landed on `main`

| commit | what |
|---|---|
| `87df65d` | build emits `kuinetic.min.js` / `.min.css`; CDN fields point at them |
| `a5de939` | two dead demo CSS classes removed — CI had been red since `51c4564` |
| `bd446b1` | the six-feature GSAP-parity merge, verified against the browser tier |
| `5bdd482` | outline for the six remaining GSAP gaps |
| `ce7a87a` | mobile overflow/overlap fix on `scroll.html` and `text.html` |

Six features shipped: runtime control + lifecycle events, motion-path, open activation list, generic tween, declarative sequencing (`at:`), JS-effect timing parity. **262 effects, 1797 unit tests, 147/147 browser.** PRs #1–#6 closed.

---

## Branches ready, not merged

| branch | SHA | notes |
|---|---|---|
| `feat/stagger-ordering` | `d931ac3` | `data-kui-stagger="90ms from:center"` |
| `feat/responsive-variants` | `167c65c` | `data-kui="fade-up above:md"`; also fixes a real `animator.ts` bug |
| `feat/one-attribute` | in flight | folds `stagger`/`rm` into `data-kui`; specs universal `target:` |

**Neither has had its test suite executed.** The owner asked agents to skip tests this session and verify in one pass afterwards. Tests are written, not run.

`feat/responsive-variants` modifies `channels.ts` — the compile-time channel-conflict check, which the three-way comparison identified as a genuine differentiator neither GSAP nor Motion has. It claims conflict pairs for ungated lists are byte-identical to before. **Verify that specifically.**

---

## Open problems

### Blocking / correctness

1. **The mobile fix disabled the pin.** `ce7a87a` sets `.showcase-media { position: static !important }` below 900px. `.showcase-media` is the `data-kui="pin-until offset-top:6rem"` element, so **`pin-until` no longer runs on mobile at all.** It stopped the overlap by removing the animation. Desktop unaffected. Needs a real mobile pin behaviour, or a deliberate decision that pinning is desktop-only.
2. **The FLIP control is mispositioned** on `scroll.html`'s flip-card — owner reports it sits too high; should be bottom-left. Not investigated.
3. **The full suite has not run since `bd446b1`.** `npm test` + `npm run test:browser` across `main` and both feature branches before merging anything.

### Documentation that is wrong, not just stale

4. **`docs/design.md` §1a** claims "zero JS runtime dependency". False — 234 generated CSS rules key on `data-kui-fx`, which the compiler stamps at runtime. Nothing animates without the JS. The true claim is *CSS-native execution*. Same section says 251 effects (it's 262), cites GSAP 3.13 (it's 3.15), and says Draggable and Flip were once Club-only (they were never).
5. **`docs/review-packet.md`** says "all 250 ≈ 55KB gz" — coincidentally close to today's 54.9KB, but arrived at differently and for a different catalog.
6. **`src/core/registry.ts:11-13`** docstring says "~237 names come from 29 primitives". Measured: **262 names, 131 primitives.**

### Known-failing gates, all pre-existing

7. **`npm run size`** — `.size-limit.json` caps `dist/kuinetic.css` at 8KB brotli; actual is 13.0KB gz / ~12.1KB brotli. Budget predates the work.
8. **`npm run lint:dead`** (knip) exits 1 — unused devDependencies and unlisted binaries in `package.json`.
9. **`npm run test:coverage`** fails at 99.91% branches — `animator.ts` `reverseFrom`'s `if (!state) return`, and `interaction.ts:127`'s `?? []`.
10. **`npm ci` reports 2 critical vulnerabilities** in the lockfile.

### Honest limits worth documenting rather than fixing

11. **`control()` cannot reach 97 of 262 presets.** `ControlHandle.uncontrolled` names them: JS-rendered effects have no playhead, scroll-driven ones belong to the scroller. Motion and GSAP control everything they animate.
12. **No scroll-scrub fallback.** Without `animation-timeline`, `style-plan.ts` degrades a scrub to a one-shot `on:enter` — silently changing *what the effect is*. Motion falls back to a rAF scrub and keeps the behaviour.
13. **The generic tween is a 14-property whitelist**, not arbitrary properties. Deliberate — each compiles to static `@keyframes` interpolating a `var()`.

### Demo coverage

14. **Six features have no demo presence at all**: motion-path, `on:pointerleave`, sequencing `at:`, lifecycle events, stagger ordering, responsive gates. Only the generic tween shipped demo cards (15 pages). Detailed entries are in `todo.md`.
15. **Demos still use `data-kui-stagger`** on ~71 groups. Once `feat/one-attribute` lands, migrate them to `stagger:` inside `data-kui` — the owner asked for this explicitly, and nothing external depends on the old spelling yet.

---

## Opportunities, ranked

Measured against Motion 13.1.1 and GSAP 3.15.0 by installing and reading both.

1. **`@starting-style` + `transition-behavior: allow-discrete`.** The native exit-on-removal primitive. Greps to **zero hits in all three libraries.** For a CSS-native library this is a stylesheet feature, not an engine feature — the cheapest real win available.
2. **View Transitions.** The one confirmed Motion capability neither competitor has. `capabilities.ts:109` already detects `startViewTransition` and **nothing reads the flag.** The browser does the animation; the library's job is naming, which maps onto attributes almost exactly.
3. **Declarative named-state variants.** Motion's variants are React-only — no vanilla library has this. kUInetic already ships the mechanism twice in miniature (`data-kui-step-state`, `data-kui-state`); generalising to an author-defined vocabulary is a naming decision, not an engine.
4. **A spring compiled to `linear()`.** Motion inverts the spring ODE to solve stiffness from `duration` + `bounce`, then samples it into a `linear()` CSS easing — a real spring on the compositor. Doing this at compile time would give `ease:spring(0.3, 8)`. GSAP has no spring at all.
5. **Universal `target:`** — see below.

---

## Universal `target:` — surveyed, do not start casually

The grammar already expresses per-subcomponent grouping, since each comma-separated spec carries its own keys:

```html
<article data-kui="fade-up target:h1 600ms, slide-left target:p 400ms at:-200ms">
```

It does not work because only **6 of 131 primitives** declare `target`. Making it universal is a project, not a parameter. A blast-radius survey found:

- **Cloak breaks silently.** The `kui.cloak` layer is 108 selectors, **all `[data-kui~=…]`, zero `data-kui-fx`** — it keys on the authored element. A retargeted descendant gets no pre-JS flash protection, which is the entire point of cloak.
- **The existing convention is two conventions.** `horizontal-track`, `scroll-snap` and container-form `scroll-spy` scope to `el`'s descendants; `scroll-progress`, `media-scrub` and per-section `scroll-spy` resolve **document-wide** — the last has to, since the nav link it marks lives in another subtree. "Generalising" would break three of its six current users.
- **Ledgers are singular per element.** `InstanceState.ledger`, `.attributes`, `PrepareContext.style` and `release()`'s restore are all one-element-scoped. Retargeting to N descendants is a structural change.
- **Late-inserted targets are invisible.** `animator.ts:224` — `scan()`'s selector is `[data-kui]`. An `<h1>` added later under `<article data-kui="fade-up target:h1">` is never noticed; no rescan path exists.
- **Stagger cannot reach them.** `animatedChildren()` is direct-children-only *and* requires each child carry `data-kui`.
- New footgun: `card-flip-x target:.foo` would relocate the flip onto an element lacking the `.kui-face-front`/`.kui-face-back` children its CSS needs.

---

## Positioning — the argument the docs are not making

Measured, not marketing:

- **Motion's compositor claim covers five properties** — `opacity, clipPath, filter, transform, backgroundColor` — and two of those aren't compositor-eligible in Chrome, so it's really three. Everything else runs rAF main-thread, same as GSAP. Any `onUpdate` forces JS.
- **GSAP is 100% rAF.** Zero WAAPI in the entire package.
- **kUInetic is 63% CSS-native** — 165 of 262 presets, off the main thread once started.

Sizes (gz): kUInetic core 15.4, default entry 41.9, shipped JS+CSS **54.9** for 262 effects. Realistic vanilla Motion 25.9. GSAP core + ScrollTrigger 44.0, all plugins 101.8. Motion's marketed "2.6 KB" is real but buys a different library — no springs, no scroll, no `x`/`y`.

kUInetic also has a **compile-time channel-conflict check** (`src/core/channels.ts`) that makes composing two effect names safe rather than last-write-wins. Neither competitor has an equivalent.

**kUInetic grew ~6.6 KB gz in the parity merge** (35.3 → 41.9 JS). Real growth. Any figure below 41.9 came from a pre-merge `dist/`.

---

## Process notes

- **Never run `npm run build`.** It rewrites the tracked `demo/tailwind.css` incorrectly, dropping ~2,465 lines of daisyUI. `build:dist` is safe. `test:browser`, `test:visual` and `check:css-coverage` invoke it internally. The dev server on **port 8934** also watches `demo/` and does the same on any edit — that server is the owner's, never kill it.
- **`resize_window` in Claude-in-Chrome silently floors at ~500px CSS width.** Mobile audits that resize the window test at 500px and come back clean. Use a same-origin `<iframe>` sized to the real target instead.
- **Agents must be told what to do when blocked.** Six overnight cloud agents were dispatched at a base branch whose CI was already red for unrelated reasons. Each finished its work, correctly diagnosed the blocker as not its own, and — having no way to satisfy "deliver a clean PR" — **rescheduled itself**. 20 scheduled sessions, 14 executed, zero progress, ~8% of a weekly credit budget. The missing sentence is *"if you are blocked by something outside your task, report it and stop."* Full writeup: `agent-poll-loop-postmortem.md`.
- Verify the base branch is green before dispatching anything at it: `gh run list --branch main --limit 5`.
