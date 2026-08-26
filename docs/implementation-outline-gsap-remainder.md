# Implementation Outline — the remaining GSAP gaps (items 1–6)

**Status:** planning document, written 2026-08-26, after the A–F parity set landed on `main` at
`bd446b1`. Items 1 and 3 are in flight; 2, 4, 5, 6 are not started.
**Audience:** the agents implementing one item each.

---

## 0. How to use this

Read §1 and §2 in full — they apply to every item. Then read only your own item section and ignore
the others. Where this says **LOCKED**, the owner has decided it; do not relitigate. Where it says
**YOU DECIDE**, make the call and justify it in your report.

File references were verified against `bd446b1`. Line numbers drift; symbol names do not.

---

## 1. What is already done

The A–F set landed and closed most of the GSAP gap. Do not rebuild any of it:

| | |
|---|---|
| generic tween (`gsap.to` equivalent) | `data-kui="tween x:100 opacity:0 800ms"` |
| sequencing / timelines | `data-kui="fade-up 600ms, blur-in 400ms at:-200ms"` |
| runtime control | `pause` `play` `reverse` `seek` `timeScale` |
| lifecycle callbacks | `kui:start` `kui:finish` `kui:reverse-finish` `kui:cancel` |
| any DOM event as trigger | `data-kui-on="pointerleave"`, enter/exit pairs |
| motion path | `offset-path`-backed, CSS-native |
| JS-effect timing parity | delay honoured across the JS renderer |

262 named effects. 1797 unit tests, 147/147 in the real-browser tier.

---

## 2. Rules for every item

### 2.1 The grammar

`src/core/parse.ts`:

```
value := spec ("," spec)*
spec  := name [duration] [delay] [easing] key:value*
```

Comma separates independent effects sharing one trigger. Positional tokens keep that order. The
tokenizer is paren- and quote-aware, so any value containing spaces or commas must be quoted.

Two precedents you will likely need:

- **`target:`** — the convention for a selector-valued parameter. It is **per-primitive**: only
  primitives that call `resolveTarget()` support it. Adding it to a preset that does not is a silent
  no-op.
- **`at:`** — *lifted onto the spec* rather than left in per-primitive params, via the `HOISTS`
  mechanism. See `parse.ts:14` and `parse.ts:280-285`. If your parameter is element-wide rather than
  per-primitive, this is the pattern to copy.

### 2.2 No new attributes — LOCKED

The owner has asked repeatedly not to proliferate `data-kui-*` attributes. New capability goes
*inside* `data-kui` as a `key:value`, or onto an attribute that already exists. The only existing
parent-level attributes are `data-kui-on`, `data-kui-stagger`, `data-kui-seq` and `data-kui-cloak`.
Adding a seventh needs a real argument, made explicitly.

### 2.3 CSS first — and further than you think

`docs/design.md` explains why CSS-rendered effects are preferred. Of 262 effects, 165 are
`css-keyframes`.

Arbitrary author-supplied values are **not** a reason to reach for JavaScript. The compiler already
drives static keyframes from custom properties, so a keyframe interpolating `var(--kui-something)`
is still static CSS. The generic tween was built this way and it works. If you conclude CSS cannot
carry your feature, state exactly why before falling back.

### 2.4 Do NOT run tests

Do **not** run `npm test`, `npm run test:browser`, `npm run test:coverage`, or `npm run test:visual`.
The owner is verifying separately in one pass.

**Do** run these — compile checks, cheap, and they must pass:

```
npm run build:dist
npm run typecheck
npm run lint
npm run lint:deps
```

Plus `npm run generate:css` if you touched presets or CSS, committing its output.

**Still write tests** in `test/` for what you build. Just don't execute the suite. Add to an existing
file where one fits — this repo recently spent an agent un-splitting over-split test files.

### 2.5 Commands that damage the tree

- **Never `npm run build`.** It rewrites the tracked `demo/tailwind.css` incorrectly, dropping ~2,465
  lines of daisyUI. `build:dist` is safe. `test:browser`, `test:visual` and `check:css-coverage` all
  invoke it internally.
- `git status` before every `git add`. Never `git add -A`. If `demo/tailwind.css` shows modified,
  `git checkout -- demo/tailwind.css` first.
- `npm run size` (stale 8KB CSS budget) and `npm run lint:dead` (unused devDependencies) already
  fail. Both pre-existing. Ignore them.

### 2.6 Branch and land

Branch off `origin/main` (`bd446b1`), push, no PR. Never touch `main`. Ordinary commits — no rebase,
amend, squash, or force-push.

### 2.7 If you get blocked

Write it up in your final report and **STOP**. Do not retry in a loop, do not wait, do not schedule
any follow-up work or create any scheduled task. Finishing blocked with a precise account of where
you stopped is a successful outcome. Push whatever is coherent.

### 2.8 Known traps

1. **`--kui-i` leaks past its stagger group.** An inherited custom property does not stop at the
   group boundary — a dropdown inside item 11 read `--kui-i: 11` and opened 660ms late. Reset in
   `kui.tokens`. Any new index-valued custom property needs the same. **Never reset `--kui-stagger`.**
2. **Zero-area start states deadlock `on:enter`.** IntersectionObserver measures geometry, not paint,
   so a zero-area start state never intersects, never activates, never leaves that state. Six presets
   have hit this; `clip-path` may be a seventh, unverified.
3. **A hidden tab freezes `rAF`** and stalls every `on:enter` — no observer callbacks at all. Working
   effects look dead. Check `document.hidden` before believing a browser result.
4. **A `MutationObserver` sees the END state** — the stylesheet has already repainted by the time it
   runs. Reading that as the start plays the animation backwards.
5. **Never nest a 3D effect inside an animated frame** — `preserve-3d` children join the parent's 3D
   space.

---

## 3. Item 1 — responsive / breakpoint variants  *(in flight)*

**Branch:** `feat/responsive-variants`. **The biggest remaining gap.**

No way to say "fade-up on desktop, nothing on mobile." `matchMedia` appears once in the whole source
(`src/core/capabilities.ts:44`) and only for `prefers-reduced-motion`. GSAP's `gsap.matchMedia()` is
the equivalent, and it exists largely to handle teardown when a breakpoint changes.

**A compiled `@media` block sidesteps that problem entirely** — no runtime, no teardown. Study
`scripts/generate-preset-css.mjs` and `src/core/compile.ts` before assuming JS is needed.

**YOU DECIDE:** the spelling; named breakpoints vs raw widths (check `demo/` and `src/css/` for an
existing scale before inventing one); whether the condition means "only at" or "from this width up";
whether to reach beyond width to pointer coarseness or orientation.

**Watch:** what a suppressed animation leaves behind. The element must end visible and correct, never
stuck in a from-state — see trap 2 and the cloak notes in `src/css/base.css`.

---

## 4. Item 2 — universal `repeat` / `yoyo`

**Branch:** `feat/repeat-yoyo`.

`loop` and `direction` exist as parameters on *some* primitives. There is no universal repeat, so an
author cannot say "play this three times" on an arbitrary effect.

**Most of the plumbing exists.** `compile.ts:294` already writes `animation-iteration-count` per
track, read from `--kui-fx-<preset>-iterations` (see `compile.ts:258`). Reading it per-track rather
than as a bare property is deliberate — the shorthand repeats a shorter value list to match the
longest longhand in the group. Do not flatten that.

`animation-direction` is the CSS mechanism for yoyo (`alternate`), and `direction` already exists as
a param name on some primitives — check for a collision before choosing yours.

**YOU DECIDE:** whether repeat belongs on every primitive or only where looping is meaningful. Task F
produced a one-shot-vs-continuous classification of the JS primitives — find it in the git history of
`src/effects/` and reuse it rather than redoing the analysis. A knob that exists and does nothing is
worse than a missing knob.

**Watch:** infinite repeat plus a scroll timeline, and repeat interacting with `at:` sequencing —
what does "start 200ms before the previous ends" mean when the previous repeats forever? Be explicit.

---

## 5. Item 3 — stagger ordering  *(in flight)*

**Branch:** `feat/stagger-ordering`.

`src/core/stagger.ts` assigns a linear index only. GSAP takes `from: "center" | "edges" | "random" |
<index>`.

Should be cheap: `indexStaggerGroup()` writes only `--kui-i` and `--kui-stagger-count`, leaving the
offset arithmetic to CSS `calc()`. Ordering is probably just a different index, with the delay maths
untouched.

**Watch:** trap 1 above; whether `--kui-stagger-count` still means what downstream CSS assumes once
ordering changes the maximum offset; and making `random` **stable** for a group so it does not
reshuffle on re-activation.

---

## 6. Item 4 — arbitrary scroll ranges

**Branch:** `feat/scroll-ranges`.

ScrollTrigger takes `start: "top 80%"`, `end: "bottom 20%"`. kUInetic ships named scroll effects
instead — `scroll-fade`, `parallax-y`, `pin-until` — with no free-form range. An author who wants a
scrub over a specific window has to find a preset that happens to match.

The CSS mechanism is **`animation-range`**, alongside the `animation-timeline` this library already
uses. `src/core/style-plan.ts` and `src/core/capabilities.ts` (`animationRange`) are where timeline
support already lives — read both first, the capability flag already exists.

**YOU DECIDE:** the spelling for a range pair inside one `key:value` slot. GSAP's `"top 80%"` is two
tokens with a space, so it must be quoted. Decide whether one parameter carries both ends or two
parameters carry one each, and which reads better in an attribute.

**Watch:** how this composes with `timeline: view | scroll | pin` — a range is meaningless without
knowing which timeline it measures against. And what happens when a range is malformed or inverted;
warn by name rather than silently doing nothing (see `src/core/reporter.ts`).

---

## 7. Item 5 — cross-element triggering

**Branch:** `feat/cross-element-triggers`.

"When the form submits, animate the badge." The element that fires the event is not the element that
animates, so an attribute on the animating element cannot express it alone.

This was explicitly ruled out of scope when the open activation list was built (task E), and that
agent was asked to leave a clean seam for it. **Read its PR and the current `src/core/activation.ts`
first** — the seam may already be there.

The existing precedent is `target:`, a selector-valued parameter (§2.1). This is the inverse: a
*source* selector rather than a target. Something in the shape of `data-kui-on="submit from:#signup"`.

**Watch:**
- `activation.ts` shares one `IntersectionObserver` per distinct threshold. Do not regress that into
  one listener per element for the event case.
- A source element that does not exist yet — the library supports `observe: true` with a
  `MutationObserver` for late-arriving DOM. Decide whether a missing source binds later or warns now.
- Teardown. A listener on a *foreign* element must be removed when the animated element is destroyed,
  or you have leaked a reference to a removed node.
- Selector quoting, per §2.1.

---

## 8. Item 6 — a devtools scrubber

**Branch:** `feat/devtools`.

GSAP ships `GSDevTools`: a timeline scrubber overlay that lets you scrub, pause and re-speed any
animation while developing. kUInetic has nothing.

**The owner has been told this is the item of the six least obviously worth building** — it is a
genuine UI build for a development-only convenience. If, having read the code, you conclude the cost
is not worth it, say so plainly in your report rather than building it anyway. That is a legitimate
outcome.

If you do build it:

- **The control API already exists and is public** — `src/core/control.ts` exposes `pause`, `play`,
  `reverse`, `seek(0..1)` and `timeScale`. The scrubber should be a *consumer* of it, adding no new
  animation logic whatsoever. If you find yourself touching `animator.ts`, you have gone wrong.
- It must be **opt-in and fully excludable from production builds** — dev tooling that ships to every
  consumer is a bug. `package.json` already has subpath exports (`./core`, `./effects`); a separate
  entry is the obvious shape. Note the default entry does **not** tree-shake.
- `control.ts` already reports by name which effects cannot be reached (JS-rendered effects expose no
  playhead; scroll-driven ones belong to the scroller). Surface that honestly in the UI rather than
  showing dead controls.
- No new runtime dependency. This library has zero and that is a selling point.

**YOU DECIDE:** everything about the UI. There is no locked design.
