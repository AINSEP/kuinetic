# Handoff — 2026-08-26 session

`main` is at `e2f7ab3`. Read §2 (problems) and §3 (test checklist) first; everything else is context.

---

## 1. State

### On `main`

| commit | what |
|---|---|
| `87df65d` | build emits `kuinetic.min.js` / `.min.css`; CDN fields point at them |
| `a5de939` | two dead demo CSS classes removed — CI had been red since `51c4564` |
| `bd446b1` | the six-feature GSAP-parity merge, verified against the browser tier |
| `5bdd482` | outline for the six remaining GSAP gaps |
| `ce7a87a` | mobile overflow/overlap fix on `scroll.html` and `text.html` |
| `e2f7ab3` | this handoff |

Six features shipped: runtime control + lifecycle events, motion-path, open activation list, generic tween, declarative sequencing (`at:`), JS-effect timing parity. **262 effects, 131 primitives, 1797 unit tests, 147/147 browser.** PRs #1–#6 closed.

### Branches ready, not merged, not tested

| branch | SHA | based on | what |
|---|---|---|---|
| `feat/stagger-ordering` | `d931ac3` | `main` | `data-kui-stagger="90ms from:center"` — start/end/center/edges/random/index |
| `feat/responsive-variants` | `167c65c` | `main` | `data-kui="fade-up above:md"` / `below:md`; also fixes a real `animator.ts` bug |
| `feat/one-attribute` | `0ea5ad8` | `feat/stagger-ordering` | folds the stagger step + `rm` policy into `data-kui` |

**Merge order matters:** `one-attribute` is built on `stagger-ordering`, so merging it brings both. `responsive-variants` is independent of the chain but touches `parse.ts`, `compile.ts` and `channels.ts`, which the chain also touches — expect a real merge, not a fast-forward.

---

## 2. Problems to fix

### 2.1 Regressions from this session — highest priority

**a. The mobile fix disabled `pin-until`.** `ce7a87a` added to `demo/scroll.html`:

```css
@media (max-width: 899.98px) { .showcase-media { position: static !important; min-width: 0; } }
```

`.showcase-media` is the element carrying `data-kui="pin-until offset-top:6rem"`. So below 900px **the pin does not run at all** — the overlap was fixed by removing the animation. Desktop is unaffected.

Owner confirmed by eye that scroll pins are not working. Needs either a real mobile pin behaviour (constrain the sticky to its own grid area rather than killing it) or an explicit decision that pinning is desktop-only. The underlying cause is worth knowing: **Chrome clamps a sticky grid item to the grid container, not to its own grid area**, so when the two-column grid collapsed the aside rode down over the content for the whole section.

**b. The FLIP control is mispositioned** on `scroll.html`'s flip-card — owner reports it sits too high and should be bottom-left. Not investigated at all.

### 2.2 Documentation that is wrong, not merely stale

**c. `docs/design.md` §1a** — four errors in one section:
- Claims **"zero JS runtime dependency."** False. 234 generated CSS rules key on `data-kui-fx`, which the compiler stamps at runtime; nothing animates without the JS. The true and still-strong claim is *CSS-native execution*.
- Says **251 effects**. It is 262.
- Cites **GSAP 3.13**. It is 3.15 (April 2026).
- Says **Draggable and Flip were once Club-only.** They never were — Draggable was always free, Flip since GSAP 3.9 (2021).

**d. `src/core/registry.ts:11-13`** docstring says "~237 names come from 29 primitives." Measured: **262 names, 131 primitives.**

**e. `docs/review-packet.md`** says "all 250 ≈ 55KB gz." Coincidentally near today's 54.9KB but arrived at differently, for a smaller catalog.

### 2.3 Gates already failing before this session

**f. `npm run size`** — `.size-limit.json` caps `dist/kuinetic.css` at 8KB brotli; actual is ~12.1KB brotli / 13.0KB gz. Stale budget.

**g. `npm run lint:dead`** (knip) exits 1 — unused devDependencies and unlisted binaries in `package.json`.

**h. `npm run test:coverage`** fails at 99.91% branches — `animator.ts` `reverseFrom`'s `if (!state) return`, and `interaction.ts:127`'s `?? []`.

**i. `npm ci` reports 2 critical vulnerabilities** in the lockfile.

### 2.4 Demo coverage

**j. Seven features have no demo presence at all.** Only the generic tween shipped demo cards (15 pages). Missing entirely: motion-path, `on:pointerleave` and the enter/exit pairs, sequencing `at:`, lifecycle events, stagger `order:`, responsive `above:`/`below:`, and `cascade:`. Detailed entries with gotchas are in `todo.md`.

**k. All 77 demo stagger groups still use `data-kui-stagger`.** The owner asked to migrate them to the inline spelling now, while nothing external depends on the old one. **Migrate to `cascade:`, not `stagger:`** — see §4.

### 2.5 Honest limits — document rather than fix

**l. `control()` cannot reach 97 of 262 presets.** `ControlHandle.uncontrolled` names them: JS-rendered effects have no playhead, scroll-driven ones belong to the scroller. Motion and GSAP control everything they animate. Any comparison that omits this is selling the same story as Motion's "2.6 KB".

**m. No scroll-scrub fallback.** When `animation-timeline` is unsupported, `style-plan.ts` degrades a scrub to a one-shot `on:enter` — silently changing *what the effect is*. Motion falls back to a rAF scrub and keeps the behaviour.

**n. The generic tween is a 14-property whitelist**, not arbitrary properties: `x y z rotate scale scale-x scale-y opacity blur brightness saturate grayscale color background-color`. Deliberate — each compiles to static `@keyframes` interpolating a `var()`.

---

## 3. Test checklist

**Nothing has been executed since `bd446b1`.** The owner asked agents to skip tests this session and verify in one pass. All three branches ship written-but-unrun tests.

Before merging anything:

- [ ] `npm run build:dist` first — `test/public-api.test.ts` imports `kuinetic/core`, which resolves into `dist/`. Without it you get 1789 passing and one file failing to resolve, which is a harness gap, not a regression.
- [ ] `npm test` on `main` — baseline should be **1797 / 78 files**
- [ ] `npm test` on each of the three branches, **one at a time** (~2GB per run, never concurrent)
- [ ] `npm run typecheck`, `npm run lint`, `npm run lint:deps` on each
- [ ] `npm run test:browser` — **147/147** is the baseline. This is the only tier that proves an effect actually animates.
- [ ] After `test:browser`, `git status` and `git checkout -- demo/tailwind.css` if it shows modified

Targeted checks, each because something specific was changed:

- [ ] **`channels.ts` conflict pairs.** `feat/responsive-variants` added `gatesOverlap()` at `channels.ts:57` so gated clauses that can never be live together stop conflicting. It claims conflict pairs for *ungated* lists are byte-identical to before. Verify — this is the compile-time channel-conflict check that no competitor has.
- [ ] **`animator.ts` keyframe-name recovery.** The same branch fixed a real pre-existing bug: `animator.ts:334` on `main` recovers keyframe idents with `split(',')` on the compiled `animation-name`, which **shreds a `var()` into two fragments** — the CSS instance then owns no animation, settles instantly, and strands `data-kui-state` on `finished` while the animation is visibly running. Replaced with `CompiledPlan.keyframeNames`. Confirm the fix and that nothing else depended on the old shape.
- [ ] **`--kui-stagger-count` still publishes `maxRank + 1`**, not the child count. `compile.ts`'s `staggerDelay` reads it to size a `timeline: pin` scrub head; publishing the child count would stretch the head past the real span.
- [ ] **`applyStagger`'s selector widening.** `feat/one-attribute` widened it to `[data-kui]` and re-narrows via `declaresGroup`. That re-narrowing is a **correctness requirement, not an optimisation**: `--kui-stagger-count` is deliberately not reset in `kui.tokens`, so writing `1` onto an ordinary animated child shadows its group's count and collapses every pinned staggered group's scrub head to one duration.
- [ ] **`split-lines stagger:320ms` still staggers over 320ms** and its `finished` promise resolves at the right time. Five live demo sites depend on this; see §4.
- [ ] **Mobile at a real 390px.** `resize_window` silently floors at ~500px — use a same-origin `<iframe>`. Check `scroll.html` and `text.html` no longer overflow *and* that the pin still does something.

---

## 4. What `feat/one-attribute` found — read before touching stagger

The obvious spelling was wrong, and the reason is subtle.

**`stagger:` cannot be hoisted. `cascade:` is the author-level key.** Verified against the built registry:

| word | primitives declaring it | verdict |
|---|---|---|
| `stagger` | **77** | taken |
| `from` | **18** | taken |
| `target` | 6 | taken |
| `order` | 0 | free ✓ |
| `cascade` | 0 | free ✓ |
| `rm` | 0 | free ✓ |

`stagger` looks like a *merge* rather than a collision — all 77 declare it with `cssProperty: '--kui-stagger'`, the same property a hoist would write. It is not. **`split-text` reads `params.ms('stagger', 30)`** at `src/effects/catalog/text-shared.ts:162` to size the timer that resolves its `finished` promise, and three presets set per-preset defaults. A hoist lifts the key out of `spec.params`, so `data-kui="split-lines stagger:320ms"` — live in `demo/index.html` and `demo/text.html`, **5 sites** — would fall back to 90ms and **report finished while still visibly staggering**, with the CSS correct. A silent timing lie.

So two words, two meanings:
- **`stagger:`** — the gap between pieces a primitive *generates* (chars, words, lines, slats)
- **`cascade:`** — the gap between children an *author* wrote

Final syntax: `data-kui="fade-up cascade:90ms order:center"`.

**`data-kui-rm` was never author input.** It is library *output*, stamped by `style-plan.ts:92` from `plan.reducedMotion`, with ~40 `base.css` selectors keyed on it. Zero authored uses anywhere (the one apparent hit in `demo/motif-blueprint.html` is documentation text listing stamped attributes). There was nothing to hoist. What was added instead is a way to *choose* the policy, which the library had no spelling for: `rm:` folds into `strictestPolicy` as a **one-way ratchet** — `rm:disable` on an effect claiming `shorten` is honoured; `rm:shorten` on `parallax` is refused and warned by name, because that primitive claims `disable` for a documented vestibular reason.

**Backward compatibility:** `data-kui-stagger="90ms"` and `from:` both still work. The two attributes merge **per key**, not per attribute, so a half-finished migration (step on the longhand, ordering inline) is valid. On a genuine same-key disagreement, **`data-kui` wins and the displaced value is named** — matching `element-config.ts`'s existing rule.

**Side finding:** the stagger step was the one authored string in the library reaching `style.setProperty` with **no validation at all**. Narrowing it to `<time>` would break `var(--speed)` and `calc(90ms * 2)`, so both spellings now get `params.ts`'s escape screen only, exported as `isSafeCssValue`.

---

## 5. Universal `target:` — surveyed twice, do not start casually

The grammar already expresses per-subcomponent grouping, since each comma-separated spec carries its own keys:

```html
<article data-kui="fade-up target:h1 600ms, slide-left target:p 400ms at:-200ms">
```

This is the "one attribute describes what happens to each sub-element" paradigm the owner asked for. It does not work because only **6 of 131 primitives** declare `target`, and making it universal is a change to *who owns an element's lifecycle*, not a parsing change.

### Blockers, in the order they must be decided

1. **The existing convention is two conventions.** `scrollytelling-step` (`scroll-mechanics/primitives.ts:229`), `media-scrub`, and `scroll-spy`'s section form resolve with `ctx.doc.querySelectorAll` — **document-wide**. `horizontal-scroll` (`:275`) and `scroll-snap` (`:629`) use `el.querySelector(All)` — descendant-scoped. Per-section `scroll-spy` *has* to reach the document, since the nav link it marks lives in another subtree. "Keep their meaning exactly" and "never leak to the whole document" are contradictory requirements today. **Owner decision needed before any code.**
2. **Cloak breaks silently.** The `kui.cloak` layer is **108 selectors, all `[data-kui~=…]`, zero `data-kui-fx`** — it keys on the authored element. With `target:h1` on an `<article>`, the whole article is cloaked and the `h1` that actually animates gets no pre-JS flash protection. The manual override at `base.css:106` compounds it: `html[data-kui-cloak] [data-kui][data-kui-reveal]:not([data-kui-state])` requires both attributes on the same element.
3. **Nothing would rescan.** `dom-watcher.ts` filters on `[data-kui, data-kui-on, data-kui-timeline, data-kui-threshold]`, and `scan()`'s selector is `[data-kui]` (`animator.ts:224`). An `<h1>` inserted later under an installed `target:h1` host is invisible to both paths.

### What it concretely requires, in order

- **parse/compile.** Keep `target` in `spec.params` (`parse.ts` has no registry access). In `compile.ts`'s `resolveEntries`, check `Object.hasOwn(primitive.parameters, 'target')`: if declared, leave untouched so the six keep working; if not, lift it onto the entry. Then **partition entries by target and run `findConflicts` per partition** — two clauses hitting different descendants may both animate `opacity`, so `channels.ts`'s global analysis becomes wrong once targets exist. `CompiledPlan` becomes a map of `target → plan`, still pure.
- **`animator.install`.** One `StyleLedger` + one `AttributeLedger` + one `createCssInstance` **per matched element**, not per host. `InstanceState.ledger`/`.attributes` are singular (`types.ts:600-602`) and `release()` does exactly one `restore()` each (`animator.ts:785-786`), so retargeted descendants' styles would leak on teardown. **This is the largest piece.**
- **`data-kui-fx` placement.** Stamp it on the descendants — but **94 generated rules** combine `[data-kui-fx~='name']` with a child or sibling combinator and assume the fx element is the animated one. Then decide what happens when an author writes `card-flip-x target:.foo` and relocates a flip onto an element with none of the `.kui-face-front`/`.kui-face-back` children its CSS requires. Probably a per-primitive opt-out flag.
- **`--kui-i` over a targeted set.** `animatedChildren()` walks direct children gated on `hasAttribute('data-kui')`; a retargeted set has neither property. Needs its own indexing pass keyed on the target match.
- **JS-rendered effects.** `PrepareContext` has no `el`; `js-effect-preparer.ts:130` calls `prepare(el, params, ctx)` once with the host. Retargeting means looping per match with its own ledger. The primitives themselves would not change.
- **DOM watching.** A new rescan trigger for descendants matching a live `target:` selector.
- **Diagnostics.** Zero matches warn by name (reuse `resolveTarget`'s rejection in `step-marking.ts:81`); multiple matches all animate.
- **Test churn.** ~20 assertions across 5 files pin `data-kui-fx` to the authored element (12 in `animator.test.ts`); ~136 inline-style assertions across ~25 files do the same. None need rewriting for the six existing primitives, but the retargeted case needs net-new coverage — and the only proof an effect *animates* is the browser tier.

---

## 6. Opportunities, ranked

Measured by installing Motion 13.1.1 and GSAP 3.15.0 and reading their source and `.d.ts` files.

1. **`@starting-style` + `transition-behavior: allow-discrete`.** The native exit-on-removal primitive. Greps to **zero hits in all three libraries.** For a CSS-native library this is a stylesheet feature, not an engine feature — the cheapest real win available.
2. **View Transitions.** The one confirmed Motion capability neither competitor has (`animateView()`, ~1,200 lines, 6.3KB gz). `capabilities.ts:109` already detects `startViewTransition` and **nothing reads the flag.** The browser does the animation; the library's job is naming, which maps onto attributes almost exactly — `data-kui="morph name:hero"` compiles to `view-transition-name: hero`. Motion needs a whole JS API because Motion is imperative; the native API is already declarative.
3. **Declarative named-state variants.** Motion's variants are React-only — **no vanilla library has this.** kUInetic already ships the mechanism twice in miniature (`data-kui-step-state`, `data-kui-state`); generalising to an author-defined vocabulary is a naming decision, not an engine.
4. **A spring compiled to `linear()`.** Motion inverts the spring ODE via Newton iteration to solve stiffness from `duration` + `bounce`, then samples it into a `linear()` CSS easing — a real spring on the compositor. Doing this at compile time gives `ease:spring(0.3, 8)`. GSAP has no spring at all.
5. **Universal `target:`** — see §5.

---

## 7. Positioning — the argument the docs are not making

Measured, not marketing:

- **Motion's compositor claim covers five properties.** `acceleratedValues` in `motion-dom/.../waapi/supports/waapi.mjs` is `opacity, clipPath, filter, transform, backgroundColor` — and `clipPath`/`backgroundColor` are WAAPI but not compositor-eligible in Chrome, so it is really **three**. Everything else runs rAF main-thread, same as GSAP. Any `onUpdate`, `repeatDelay`, `repeatType: mirror` or `type: inertia` also forces JS.
- **GSAP is 100% rAF.** Zero WAAPI anywhere in the package.
- **kUInetic is 63% CSS-native** — 165 of 262 presets, off the main thread once started. And `at:` sequencing compiles to `animation-delay` arithmetic in custom properties rather than a playhead, which extends the compositor guarantee across a whole sequence. Nothing else here does that.

**Sizes, gzipped, all measured with `esbuild --bundle --minify` + gzip level 9:**

| | gz |
|---|---|
| kUInetic `kuinetic/core` | 15.4 KB |
| kUInetic default entry | 41.9 KB |
| **kUInetic shipped (JS + CSS), 262 effects** | **54.9 KB** |
| Motion `mini` `animate` only | 3.0 KB |
| Motion realistic vanilla | 25.9 KB |
| Motion full entry | 46.4 KB |
| GSAP core | 27.0 KB |
| GSAP core + ScrollTrigger | 44.0 KB |
| GSAP, all 23 shippable plugins | 101.8 KB |

Motion's marketed "2.6 KB" is real but buys a different library — no springs, no scroll, no `x`/`y` transforms; `NativeAnimation.mjs` literally asserts `Mini animate() doesn't support "type" as a string`.

**kUInetic grew ~6.6 KB gz in the parity merge** (35.3 → 41.9 JS). Real growth, not measurement drift. Any figure below 41.9 came from a pre-merge `dist/`.

kUInetic also has a **compile-time channel-conflict check** (`src/core/channels.ts`): every primitive declares which CSS channels it writes, and composing two effect names is only allowed when their channel sets are disjoint. Named combos resolve `fade-up + blur-in` to a hand-tuned `fade-blur-up` rather than two independent animations. **Neither competitor has an equivalent** — both let you stack conflicting tweens and find out at runtime.

---

## 8. Process notes and traps

- **Never run `npm run build`.** It rewrites the tracked `demo/tailwind.css` incorrectly, dropping ~2,465 lines of daisyUI. `build:dist` is safe. `test:browser`, `test:visual` and `check:css-coverage` invoke it internally. The **dev server on port 8934 also watches `demo/`** and does the same on any edit — that server is the owner's, never kill it, and check `git status` before every commit.
- **`resize_window` in Claude-in-Chrome silently floors at ~500px CSS width.** Mobile audits that resize the window test at 500px and come back clean. Use a same-origin `<iframe>` sized to the real target. Also: the automation tab reports `document.hidden = true`, which stalls every `on:enter` — working effects look dead.
- **Agents must be told what to do when blocked.** Six overnight cloud agents were dispatched at a base branch whose CI was already red for unrelated reasons. Each finished its work, correctly diagnosed the blocker as not its own, and — having no way to satisfy "deliver a clean PR" — **rescheduled itself**. 20 scheduled sessions, 14 executed, zero progress, ~8% of a weekly credit budget. The missing sentence is *"if you are blocked by something outside your task, report it and stop."* Full writeup in `agent-poll-loop-postmortem.md`.
- **Verify the base is green before dispatching at it:** `gh run list --branch main --limit 5`. Thirty seconds; would have prevented the above entirely.
- **Cloud routines silently drop `reasoning_effort`.** The API returns 200 and omits the field. Read the echoed `session_context` to see which fields survived; `model` is honoured.
- **Cloud routines get `Claude_Code_Remote` (the meta-MCP) auto-attached**, which is what lets an agent schedule more agents. Pass `clear_mcp_connections: true` if that is not wanted, and audit for agent-created routines afterwards.
