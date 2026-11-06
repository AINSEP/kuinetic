# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## GSAP showcase study — owner's ask, 2026-11-05

- [ ] **Be able to do what the sites on https://gsap.com/showcase/ do.** Owner: "The animations, the
      videos, they're just so beautiful." **Later, and owner-led: do not start until asked.** The
      owner will point at the videos when ready. For each one: break it down, understand the
      animations, then abstract them into kUInetic. Take the mechanism, not the look: the result
      should be a library effect or param, in kUInetic's own design, not a copy of that site.
- [ ] **Check https://www.ripplix.com too.** Owner's ask, 2026-11-05. Same deal: later, owner-led,
      take the mechanism and not the look.
- [ ] **Go through https://motion.dev/examples and be able to do its animations.** Owner's ask, 2026-11-05.
      List done 2026-11-05: `ADS-memory/.local-artifacts/motion-examples/final.md` (284 effects, from video
      frames and code, nothing rendered: HAVE 77, SMALL 117, NEW 15, WEBGL 15, SKIP 50, UNCLEAR 10). Build order is `batches.md` there: 31 batches,
      library then 3D. Ignore the batches in `plan.md`, which came from names only. Names mislead, so trust the frames. Rebuild from what the preview
      shows. Do not use Motion's source code: the page sells source for its Plus examples.
      Owner, 2026-11-05: animations only, not components, so UI parts come from DaisyUI. Order: library additions, then
      three.js and 3D effects, then look at it, then edit pages. New demos go on `showcase.html` or one holding page for
      now and get split up later (rough idea: carousels and galleries, page transitions, 3D).
- [ ] **Images and words that follow a line, including a carousel of images on a 3D line.** Owner's ask,
      2026-11-05. Reference: https://www.pinterest.com/pin/1107181889668067699 (a strip of images sweeps along a
      curve in perspective, and the pictures bend with it) and https://www.pinterest.com/pin/1010917447609301375/.
      Three parts, on scroll and on a timer: (A) one element rides a curve: `motion-path ... timeline:scroll`
      moved correctly in Chrome at desktop width on 2026-11-05, but curves are fixed pixels, so phones are still open,
      and it is a flat 2D path; (B) letters curve along a line: not built; (C) many images spaced along one line in
      3D, as a carousel, bending like a ribbon: not built. Bending needs a decision: WebGL add-on (recommended) or
      CSS slices. See the Canvas / WebGL entry below: opt-in only, never the main bundle.
- [ ] **A misspelt easing name fails silently.** `EASING_KEYWORD` in `src/core/params.ts` accepts any name ending in -in, -out or
      -in-out, so `ease:bounce-out` passes with no warning and falls back to `ease-out`. Found 2026-11-06. Make unknown names warn.
- [ ] **Motion effects the owner wants later, not now.** Owner, 2026-11-05: "I do want to build that, but not now."
      Codex's plan (`ADS-memory/.local-artifacts/motion-examples/build/newjs-plan.md`, batches 23-25 and 30) advised against building
      these yet, because they cost extra JS drivers for few effects: `magnetic-filings`, `split-text-scatter`,
      `collision-hover-grid`, `apple-watch-home-screen`, `multifollow-pointer-with-spring`, `reorder-grid`, `apple-intelligence`.
      Frames are in `sheets/<effect>.jpg` in that folder.
- [ ] **Motion back burner: heavy GPU work.** Owner, 2026-11-06: wait until round 16's three.js works, then decide.
      Watch them: `open ADS-memory/.local-artifacts/motion-examples/later.html`. Costs are in `ADS-memory/.local-artifacts/motion-examples/build/REST-PLAN.md`. Estimates, nothing built.
      Flat shaders (shared 80-120 lines): `three-shader-topography` (70-110), `three-uniforms` and `vgpu-vectors` (100-150),
      `threejs-ocarina-watercolour` and `vgpu-majora-watercolour` (170-250). three.js scenes, all needing the foundation below:
      `three-materials` (25-45), `three-motion-values` and `vgpu-motion-values` (60-90), `three-orbit` and `vgpu-orbit` (190-280),
      `vgpu-uniforms` (55-85). `three-tsl`, `vgpu-effect` and `particle-orb` moved into the build (round 16), which also pays for the foundation.
- [ ] **Effects from the owner's pins, not in any plan yet.** Owner sent these as animations they like; the planning brief left them out by mistake.
      Frames: `ADS-memory/.local-artifacts/motion-examples/sheets/pin2-reference.jpg`, video `videos/pin2-reference.mp4` there.
      (a) A small image grows to fill the screen, on scroll (`parallax-scale` plus a pin gets part of it, no preset). (b) A row of cards where the hovered one widens and the others narrow (missing).
      Pin 1's cards settling into a grid is covered by `bend land:grid`, see `build/BEND-SPEC.md` there.
- [ ] **More Pinterest assets.** Owner: "We're also going to need some more assets from Pinterest. I want new images."
- [ ] **Named animations added from separate scripts.** Idea: `data-kui="fadeup 200ms, name:carrot-div"`, so other scripts can add animations by name. Owner said not now.
- [ ] **3D card shapes: helix and sphere.** Owner's ask, 2026-11-05, from the helix/barrel/ring/sphere
      demo on motion.dev. Plain CSS 3D, no WebGL. Barrel (`carousel-3d`, `carousel-3d-inside`) and ring
      (`carousel-3d plane:screen facing:radial`) should already exist: compare them in a browser first,
      including the dark card backs. New: a per-card height step for helix, and per-card latitude for
      sphere, on the shared deck in `src/effects/carousel/`. Watch for: helix's jump when the last card
      wraps to the first; sphere dragging on more than one axis is extra work (the deck tracks one
      position); `fit.ts` assumes a flat circle, so both shapes need their own fit, especially on phones.
      Code was read, nothing was built or run.

---

## 2026-09-08 audit fixes — UNVERIFIED IN A BROWSER, check these

Four commits landed from a four-auditor review (Codex `gpt-5.6-sol` xhigh, Sonnet 5, Gemini 3.1
Pro + 3.8 Flash via `agy`). Report: `ADS-memory/.local-artifacts/external-audit/runs/20260908-external-audit-report.md`.
Agent logs: `.../offloads/20260908/opus-fixer-log.md`, `opus-delivery-log.md`.

| commit | what |
|---|---|
| `47edbd8` | phase exemption unsound for keyframe-delivered states; forced-colors focus ring; `view-swap` timer leak; CSS system colours |
| `fa72983` | `transforms.ts` was imported by committed code and never committed |
| `44be19c` | an entrance names the trigger; `Preset.delivery` axis |
| `8f1182b` | `capturePointer` — main now builds from a clean clone |

**Every one of these was verified at the compiler and by unit tests only. Not one frame was
rendered.** 3312 tests pass, which proves registration and compiler output, not that anything
animates. Until the boxes below are ticked, treat "fixed" as "compiles as intended".

- [ ] **Browser-verify all four commits, desktop AND 390px.** Non-negotiable per the standing rule
      — the audience is mostly phones. Use Claude in Chrome against the dev server on 8934, never a
      hand-rolled Playwright script.
- [ ] **Sweep every demo page for `data-kui` pairs that now REFUSE.** 556 pairs stopped composing
      (548 real clobbers + 8 `icon-*`/`split-flap` × `tween`). Those were silently dead before, so a
      demo may have shipped one and looked fine. Now it warns and drops. Grep the demo `data-kui`
      attributes, compile each through the registry, and list any that warn.
- [ ] **`focus-ring-grow` in real forced-colors.** The fix scopes the outline to `:focus`. Confirm
      in actual Windows High Contrast / `forced-colors: active` emulation that the ring appears on
      focus and is GONE when unfocused — that was the bug.
- [ ] **`view-swap delay:` teardown, for real.** Unit test asserts the timer is cleared. Confirm in
      a page: click, destroy the animator inside the delay window, nothing flips afterwards.
- [ ] **Sign off the no-warning decision on activation merge.** `44be19c` makes an entrance's
      activation win silently. A warning was measured and rejected: it would fire on 4,882–6,098
      pairs including `fade-up, lift`. Census is in the doc comment. Owner call — keep silent, or
      warn only when both halves explicitly declare and differ?

### Audit findings deliberately NOT fixed — decide on each

- [ ] **`::after` ownership gap.** `underline-slide`, `underline-center`, `typewriter`,
      `redaction-reveal` paint a pseudo-element without claiming the ownership channel.
      `test/css-composition-invariants.test.ts:80-132` calls the 7 resulting pairs "genuine, live"
      and then asserts them as an accepted baseline. Sonnet 5 read that as a deliberate argued
      decision; Codex and Gemini Pro both called it ship-blocking. **Genuine disagreement — needs
      the owner.**

**Rejected finding, recorded so it is not re-raised:** Gemini 3.1 Pro claimed the `ParamSpec`
migration broke `motion-path anchor:50%`. False — `git show f75d5cf^` shows `anchor` was
`type: 'keyword'` before and after; only `values:` was renamed to `keywords:`. Also: Gemini 3.8
Flash presents paraphrased code as literal quotes. Its conclusions were sound; its evidence is not
citable.

---

## 2026-09-08 catalog review — the roll-up

One session, three outside reviews (Codex 5.6 Sol, Gemini 3.8 Flash via `agy`, a Sonnet subagent),
all with repo read access except where noted. Full transcripts, both briefs included, are archived
in **`ADS-memory/2026-09-08-catalog-review/`** (gitignored):

| File | What it is |
|---|---|
| `00-brief-round1.md` | first brief — **contains three factual errors**, see below |
| `01-brief-round2.md` | corrected brief, the one to reuse |
| `10-codex-5.6-sol.md` | best of the three; caught the errors in brief 1 |
| `11-gemini-3.8-flash-NO-CODE-ACCESS.md` | answered from the brief alone — **treat as unreliable**, it recommended building two things that already ship |
| `12-gemini-3.8-flash-round2.md` | same model with code access; found the composition trap |
| `13-sonnet-round2.md` | found the collective-hover gap |

**Three claims in the round-1 brief were wrong and propagated into every reviewer's answer.** Kept
here so nobody repeats them: the CSS budget is **not** blown (14 kB limit, ~12.2 kB actual — **these
two numbers moved again later the same day, see the add-on-bundle entry below: cap is now 20 KB,
measured size is 15.17 KB**); variable-font motion **already ships** (`var-weight`/`var-width`/
`var-slant`); `:active` **already
appears** in coarse-pointer fallbacks (`src/css/media.css:53`). Verify a brief's own claims before
dispatching it.

### FIX — bugs and traps in what already ships

1. **Composition follow-ups from 2026-09-08.** Still only two registered combos; the
   "register the obvious combos" ask remains for same-channel, same-phase pairs. A fifth
   `EffectPhase` value for JS-rendered or closed-keyframe effects still needs an owner decision.
2. **`gradient-rotate-border` still defaces its host.** Remaining from the 2026-09-08 review:
   it masks out the content box and carries only a warning comment. See the dedicated
   host-masking entry below; `requiresOwnSubtree` is the wrong tool for this contract.
4. **Finish the `forced-colors` / `prefers-contrast` catalog audit.** Remaining from the
   2026-09-08 review: check coverage across the catalog and decide a house rule, including
   `prefers-contrast`, which still has no rules.


- [ ] **No mechanism declares "this effect masks or replaces its host box" — `requiresOwnSubtree` is
      the wrong tool and does not fit.** Established 2026-09-08 when a fix attempt was stopped and
      checked rather than shipped. `requiresOwnSubtree` is evaluated at `src/core/compile.ts:591`,
      **inside `liftTarget`**, which early-returns at line 579 when no `target:` was authored. It
      exists solely to stop `target:` relocating a preset whose CSS reaches past its own element via
      a combinator — and `test/css-requires-own-subtree.test.ts` re-derives that set by scanning for
      `[data-kui-fx~='NAME']` followed by a combinator. So for `gradient-rotate-border`, whose rule
      (`src/css/ambient.css:121`) is a single compound selector with no combinator, the flag would be
      **a no-op for the real bug** (a plain `data-kui="gradient-rotate-border"` with no `target:` at
      all still erases the card's contents) **and** would fail two assertions in that test — "never
      flags a name whose CSS never reaches past itself" and the exact hand-list match.
      **The real gap is a family, not one preset.** `gradient-rotate-border` and `gradient-border`
      both subtract their own content box with `mask-composite: exclude`, which is correct for a
      border wrapper and catastrophic on a content card. `gradient-border` carries only a comment
      saying so; there is no code anywhere that enforces it. This is the same class as `ripple`,
      `confetti-burst` and `border-draw` — effects that mutate or replace the box they are put on —
      except those three were fixable by restructuring, and this one's masking *is* the effect.
      Proposed: a declared flag (`masksOwnContent` / `replacesHostBox`) that documents the contract
      and lets the compiler emit a dev-mode warning when such an effect lands on an element with
      element children. **Lives in `compile.ts`, so it is downstream of the composition work.**
      Interim state: `gradient-rotate-border` now carries the same explicit warning comment
      `gradient-border` already had, so both siblings document the hazard identically. Comment-only
      is knowingly weak — it is a holding position, not the fix.

### ADD — features and categories that have no home today

15. **Second tier — still unbuilt.** From the 2026-09-08 review: `dock-magnify`,
    `scroll-state` affordances and `coverflow-scroll` remain. The coverflow owner decision below
    must be resolved before treating that name as authorised work.

### LABS — a GPU tier, if we want one


24. **A 3D tier via three.js behind `kuinetic/3d` — HIGH PRIORITY, parked 2026-09-10 by owner.**
    Deliberately not started now; `src/advanced/` had to be repaired first. Everything below is
    measured or verified, not estimated — do not re-litigate it from memory.
    **The gap:** the library cannot render geometry at all. `shaders.ts`'s `SharedShaderRenderer`
    owns **one static fullscreen quad, and that is the only geometry in the entire system** — all
    five fragment shaders draw that same quad per element via `drawElementQuad` + scissor.
    `camera-3d.ts` is pure CSS (`translate3d`/`rotateX`/`rotateY` under `perspective` +
    `preserve-3d`), zero WebGL.
    **Architecture, owner's call:** a separate `kuinetic/3d` subpath export — the pattern already
    exists (`./core`, `./effects`, `./css` ship today). three.js as an **optional peer dependency**,
    so the package keeps its current zero-dependency posture and only an author who opts into 3D
    installs or downloads it. Owner, 2026-11-05, script-tag files: `kuinetic.min.js` has no 3D;
    `kuinetic.3d.min.js` is the separate add-on; `kuinetic.all.min.js` has everything, three.js included. Known
    cost: `.all` roughly doubles (about 520 KB + 535 KB minified, before compression), so pages using it for
    anything else should move to `kuinetic.min.js`. Owner's call: `kuinetic.min.js` injects `kuinetic.css` itself, the way
    `.all` does today (`scripts/build-standalone.mjs`), so one script tag works. That adds about 200 KB minified before
    compression. Decide then whether a no-CSS build stays for people who link the CSS themselves.
    **three.js over OGL, decided once size stops mattering.** Measured 2026-09-10 with esbuild,
    tree-shaking verified: OGL minimum mesh surface 15.1 KB gzip, 22.2 KB with glTF; three.js at
    feature parity 133.2 KB gzip. Behind an opt-in entry point that 10x is acceptable — nobody
    shipping a 3D hero blinks at it — and three.js then wins on everything else: OGL's last commit
    was 2025-04-13 and last publish 2025-01-27 (dormant ~17 months, not archived), while three.js is
    actively maintained with first-party glTF/DRACO/KTX2 loaders. It is also, practically, the path
    AI assistants write correctly — raw GL plumbing is where every review round of `src/advanced/`
    found its serious defects. **Retire the "OGL is ~29 KB minzipped" figure**; it came from a chat
    transcript, was never measured, and is wrong.
    **This is differentiation, not catch-up.** motionsites.ai was re-checked 2026-09-10 with a
    genuinely foregrounded tab: zero `<canvas>`, no WebGL, no three/spline/model-viewer, no JS
    animation library at all. Its "3D Website" category is baked AI-rendered video. Competitors fake
    3D; nobody in view is rendering geometry.
    **The real work is the grammar, not the renderer.** "Put an attribute on a div, get a 3D scene"
    needs design: what is a model, a camera, a light, a material, in `data-kui` terms? Answer that
    before writing renderer code. The composition questions in item 23 above apply here unchanged and
    are still unanswered.

### PARAMETERISE — knobs and API shape

17. **Reword "total parameter control"** into something testable. **Not verified done or not** —
    the literal phrase does not appear anywhere in the repo today (checked `docs/design.md` and
    every `.md` file), so either it was already reworded before this phrase was ever written down
    verbatim, or it never shipped. Check `docs/design.md`'s current parameter-control language
    directly before assuming either way.
21. **Publish `--kui-item-count`; `--kui-progress` for ring geometry was rejected, correctly —
    scope narrower than planned.** `--kui-item-count` shipped on `step-marking.ts` exactly as
    asked. **`--kui-progress` did not ship as the carousel's continuous position token — a real
    collision was found and documented in `carousel/index.ts`:** it is already the scroll-mechanics
    progress fraction (`scroll-mechanics/primitives.ts:28`), consumed by `pinnedDelays()` to seek
    every `timeline:pin` descendant's delay — a carousel writing a fractional ring position into
    the same name would send nested pinned animations to a nonsense negative delay. Shipped
    `--kui-step-position` instead (unambiguous, no collision). `--kui-offset` for ring geometry
    (never `--kui-i`) shipped exactly as asked.
22. **Composites need a shared documented parts-contract format.** No cross-family contract
    documentation format exists yet — each composite still writes its own.

### RULED OUT — do not build, decided 2026-09-08

- **`glass-refract`** (SVG `feDisplacementMap` over live DOM) — both reviewers, unprompted. If real
  refraction ever matters, it is one shared WebGL renderer in a labs package, not "CSS glass".
- **A shared spotlight grid as a new effect** — per-element already works; put `cursor-spotlight` on
  each card. Only the cross-card *proximity* falloff (item 9) is missing.
- **`interpolate-size` / `calc-size()`** — already deferred, owner's call 2026-08-26. Zero Safari,
  zero Firefox, so `prepareAutoHeight` cannot be retired and it adds a second mechanism for one
  preset. See the entry lower in this file.
- **Real `<kbd>` keydown animation in core** — global listeners, keyboard-layout and stuck-key edge
  cases. Demo/docs tooling at most.
- **Normalized scalar ranges anywhere** — use real CSS units.

---

## Open

- [ ] **showcase.html: `carousel-stack` autoplay 3s → 0.5s, and find the slow first start.**
      Owner's request, 2026-10-06: not now, later. `#stack-demo` (demo/showcase.html:613, and the
      contract line at :610) says `autoplay:3s`; make it `autoplay:500ms`. Separately, the stack
      takes a long time to start playing at first, longer than the autoplay interval. Find out
      why (cloak release? on:enter? image load? the first tick waiting a full interval?) before
      just shortening the number, which may only hide it.
- [ ] **showcase.html: better visual assets.** Owner's request, 2026-10-06: not now, later. The
      page needs stronger images across its sections. Note: showcase.html is untracked on purpose
      and stays off GitHub.

- [ ] **Demo page for the showcase components.** Owner's request, 2026-09-27: not now, later.
      One page (`demo/showcase.html` or similar) that shows all ten showcase presets working:
      `device-frame`, `lightbox`, `video-lightbox`, `compare` (both axes), `hotspots`,
      `carousel-fade`, `carousel-slide`, `video-hero-slideshow`, `scroll-story`, `slow-mo`. Use
      real images/videos, add a Show-code chip for each (the standing solid dark pill), and check
      at 1280 and 390px. This is owner design work: load the web-design agent bundle first
      (CLAUDE.md). Copy-paste examples to start from: the "Presentation components (showcase)"
      section of `docs/getting-started.md`. Several review findings could only be judged visually
      (compare axis:y, compare touch scrolling on phones, scroll-story sticky centring, lightbox
      controls over a tall image); this page is where they get a real-browser pass.


- [ ] **Lifecycle phasing — remaining work from 2026-09-08.**
      1. **Still only 2 registered combos.** The "register the obvious combos" ask remains for
         genuinely same-channel, same-phase pairs.
      2. **A real 5th `EffectPhase` value is missing.** JS-rendered effects with no `@keyframes`
         and CSS effects that close to a meaningful, must-persist value still need an honest
         phase. A fifth value such as `'reveal'` still needs an owner decision, including the
         corresponding `composition-phase.test.ts` contract.
      3. **Still silent.** Composition warnings go to a reporter that is silent by default;
         the original "make this warning loud" ask remains.


- [ ] **`gradient-rotate-border` still defaces the element it is put on.** Remaining from the
      2026-09-08 review: `mask-composite: exclude` still erases the content box. See the dedicated
      host-masking entry higher in this file for why `requiresOwnSubtree` is the wrong tool —
      a `masksOwnContent`/`replacesHostBox`-shaped contract does not exist yet. A warning comment
      is a holding position, not the fix.


- [ ] **Reject "total parameter control" as currently worded; replace it with a testable rule.**
      Outside review, 2026-09-08. "No hard-coded literal an author might want to change" is unbounded
      and untestable, turns every implementation detail into permanent public API, and makes future
      rendering improvements breaking changes. Workable version, which still satisfies the owner's
      actual requirement: *every externally meaningful design token gets a documented parameter or a
      custom-property escape hatch; geometry invariants, safety clamps and numerical tolerances stay
      private.* **This wording question is still open** — the literal phrase "total parameter
      control" does not appear anywhere in the repo, so it's unclear whether it was ever written
      down where this entry implies, or already reworded elsewhere; check `docs/design.md` directly.
      **The validator half — SHIPPED 2026-09-08, narrow this entry to the wording only.**
      `ParamSpec` is now a discriminated union (`KeywordParamSpec | ValueParamSpec`); `values` is
      gone entirely; union types shipped exactly as asked (`number|percentage`, `length|percentage`,
      `angle|keyword`), each normalising equivalent spellings (`80%` → `0.8`) to one internal form.
      `target:`'s inability to remove structural requirements is still true and still means
      composites need a documented parts contract — see the PARAMETERISE section, where the
      carousel build's own contract landed at 3 levels, not the 4 (camera, ring, slot, face) named
      here.

- [ ] **Finish the accessibility audit for `forced-colors` and `prefers-contrast`.** Raised
      2026-09-08. Audit coverage across the catalog and decide a house rule; `prefers-contrast`
      still has no rules.

- [ ] **Decide the add-on bundle: a second file that requires the base.** Owner's ask, 2026-09-08.
      The idea is a plug-in layer for compound effects too heavy or too opinionated for the core
      catalog — the first three candidates are the entries directly below.
      **The size justification needs correcting AGAIN — this entry's own numbers went stale the
      same day it was written.** `.size-limit.json` was corrected once already (14 kB → this
      entry's ~12.2 kB), then corrected a second time later on 2026-09-08: the cap is now **20 KB**
      brotli (raised deliberately) and the measured stylesheet is **15.17 KB**. `npm run size` is
      still not failing. The reasoning changed too: a later measurement (stripping 20 rule blocks
      and re-measuring) found a preset name costs only **~9 bytes brotli** — `presets.generated.css`
      compresses hard because its rows are repetitive — so "growth is names" is false; the actual
      weight is in the hand-written stylesheets (`interaction.css` 14.94 KB brotli, `base.css` 7.27,
      `carousel.css` 5.70 — carousel alone is over a third of `interaction.css`'s weight). Owner's
      position is unchanged in substance: size is not a concern unless something becomes unusually
      large, prefer parameters over names for *API* reasons, not bytes.
      **Bigger problem: the decision below appears to have been bypassed by what actually shipped
      today.** `spatial-carousel` (as `carousel-3d`/`-high`/`-low`/`-inside`) and `anchored-preview`
      — the two composites this entry's own classification exercise names as the load-bearing
      *reason* the bundle earns its place — were both registered **directly into the core registry**
      (`registerCarousel`/interaction-reveal wiring inside `createRegistry()`), not into a separate
      `./composites` or `./scenes` export. So did `glass`, `proximity-field`/`-glow`, and
      `search-expand`. None of this "Decide the add-on bundle" work — the shape, the exports block,
      the separate `.size-limit.json` row — was built; the effects it was meant to gate went to core
      anyway. Either the classification below needs to be re-litigated against what already shipped,
      or the bundle idea itself needs an explicit owner call on whether it's still wanted at all,
      since four of its own named candidates are now core catalog names with no opt-in required.
      **The bundle's argument for existing at all, restated:** `spatial-carousel`
      and `anchored-preview` impose a specific markup anatomy on the page — worth separating
      from effects you can drop on any single element. API shape, not bytes. That argument is
      unaffected by where the code actually landed; only the *execution* of the decision is.
      Shape to confirm: `src/presets/` with its own `registerPresets(registry)` entry, a `"./presets"`
      block in `package.json` `exports` (which already does `.`, `./core`, `./effects`, `./css`), its
      own `.size-limit.json` row, and its CSS emitted as `dist/kuinetic-presets.css`. **Decided
      2026-09-08: one bundle, one folder.** Not three themed entry points — that is three of
      everything (exports, size rows, docs sections, test files) for about thirty names.

      **What goes in it — split rule revised 2026-09-08.** The first rule ("compound vs platform
      feature") classified by implementation trivia and was called arbitrary by both reviewers, with
      a fair counter-example: anchor positioning is a *platform* feature, but an anchored avatar
      label is still a composite needing trigger, popup, placement, collision fallback and markup
      anatomy. Classify by adoption cost instead:
      - **Core** — broadly reusable, small, stable, imposes no component anatomy, no expensive
        rendering, degrades gracefully.
      - **Add-on** — assumes multiple named parts, coordinates children, or embodies a distinct
        visual style.
      - **Labs** — per-frame JS, canvas/WebGL, SVG displacement, unstable platform support, or
        substantial accessibility responsibility. Keep these out of the CSS-first bundle entirely;
        mixing them in weakens the library's clearest differentiator.

      **Name it something other than `presets`.** "Preset" already means a registry preset and names
      `presets.generated.css`. `./composites` or `./scenes` is unambiguous.

      **What deliberately does not, and why — three of four confirmed by what actually shipped.**
      Three of the six ideas raised on 2026-09-08 are platform CSS features or gaps in an existing
      family, not compound presets. Putting them behind an opt-in import would leave the core
      library missing something it should simply have:
      - **View Transitions** → core, section L. **SHIPPED to core exactly as predicted here** —
        `page-morph`/`view-swap`, registered in `createRegistry()`, not a bundle.
      - **CSS anchor positioning** → core. Still not built (stays dropped — see RULED OUT).
      - **Variable-font motion** (`font-variation-settings`) → core, section D. **SHIPPED to core as
        predicted** — `var-axis`, registered alongside the existing three fixed-axis names.
      - **A press (`:active`) state** → core, section I. **SHIPPED to core as predicted** —
        `press-depth` (primitive `press`), registered alongside the hover family, not the bundle.
        The doc comment on `press` even names `glass-press` as the natural next composition, in
        those words — so this prediction was specifically validated, not just generally correct.

      **Parameter control is non-negotiable — owner's words, 2026-09-08.** Every name in the bundle
      exposes every value it paints: `data-kui="glass opacity:0.8 blur:20px rim:silver"`. The
      existing grammar already carries this — `ParamSpec` (`core/types.ts:165`) has `type`,
      `default`, `cssProperty`, plus `values` / `minimum` / `maximum` / `integer` / `finite`, and a
      parameter that maps to a `cssProperty` costs one `var()` and no JavaScript. Three rules:
      1. **No hard-coded value an author might reasonably want to change.** If a keyframe or rule
         carries a literal colour, length, angle or duration, it needs a parameter with that literal
         as the `var()` fallback.
      2. **Accept both spellings wherever CSS does.** The owner's example writes `opacity:0.8|80%`,
         read here as "a unit-less number and a percentage must both parse". Careful: `ParamSpec.values`
         is *additive* for every type except `keyword`, so `{ type: 'number', values: ['0%'] }` does
         not close the set and validates nothing. The answer is a `type` whose grammar covers the
         range, or a `text` param normalised inside the primitive. Settle this before writing the
         first parameter — it applies to all of them.
      3. **`target:` names inner elements; the library owns the structure.** Every composite here has
         inner parts (a ring and its items, a glass panel and its rim). The page must not have to
         write structural CSS for them.

- [ ] **Browser-verify the 3D carousel's ancestor-flattening risk.** Remaining from the
      2026-09-08 carousel work: check the shipped carousel under `overflow: hidden`, `clip-path`,
      `opacity<1`, `filter` and `backdrop-filter` ancestors. The `preserve-3d` concern was not
      re-tested in a browser.

- [ ] **`liquid-glass.css` — keep `glass-refract` ruled out.** Owner's glass-surface ask,
      2026-09-08: SVG `feDisplacementMap` over live DOM was correctly not built. Both outside
      reviewers flagged it unprompted; real refraction belongs in a separate WebGL tier,
      not "CSS glass." No change from the original call.

- [ ] **Micro-interactions from a reference video — 6 of 7 "genuinely missing" items turned out to
      already exist or shipped 2026-09-08; only 1 remains.** Owner's ask, 2026-09-08 (transcript
      supplied; the video itself was not watched). Mapped against the catalog:
      **2026-10-10 — re-check against the real video before calling anything done** (owner's ask, not
      now, later). The mapping below came from transcript words only. Video:
      "11 Micro Animations That Will Instantly Level Up Your UI",
      https://www.youtube.com/watch?v=ld1zhQMXxXU. The timed transcript is saved, gitignored and
      kept off GitHub because it's someone else's words, at
      `ADS-memory/knowledge/micro-animations-video/transcript-timed.txt`.
      Section start times: 1 button 0:14 · 2 shortcuts 0:59 · 3 toasts 1:38 · 4 name tag 2:11 ·
      5 shimmer 3:19 · 6 tooltip 4:17 · 7 text pop-out 5:04 · 8 progress 5:38 · 9 card swipe 6:12 ·
      10 search 7:00 · 11 upgrade hover 7:40 · end 8:10.
      Method: `yt-dlp` the video into a fresh scratch dir. `yt-dlp` and `ffmpeg` are both in
      `~/.local/bin`. For each range, use `ffmpeg` to cut 6–8 frames into one image with the `tile`
      filter, and read the motion from that. Then compare each frame strip to our effect and
      fix what doesn't match.
      **Also research beyond this one video** (owner's ask, 2026-10-10, not now). The goal is a map
      of the kinds of micro-interactions and the sites known for them:
      - Group them by type: hover, press, toggle, feedback/toast, loading, form/validation, input,
        navigation, drag/swipe, reveal-on-hover, cursor, empty and success states.
      - For each type, list 2–3 sites that do it well. The video names Linear, Vercel, dub.co,
        Rainbow Wallet, Huddle, Obsidian, Apple, Figma community, Ace Studio, microinteraction.co,
        and a Webflow micro-interaction library.
      - Check each type against the catalog, the way this entry already does.
      - The result feeds the nav's "Micro-Intxns (Soon)" placeholder under Basic, added
        2026-10-10 in `demo/nav.js`.
      - Reference to look at, saved by the owner on 2026-10-10: "Micro Inspire" on Made in Webflow,
        https://webflow.com/made-in-webflow/website/wladek-micro-inspire
      These are not in the mapping below and need checking:
      - #4: the spring feel (stiffness 636, damping 24, 500ms).
      - #6: the tooltip's bounce.
      - #11: hover for upgrade details (dub.co), where the new limit slides in and the old number
        leaves.
      **Already covered — do not rebuild.** The shimmer/gradient stroke is `beam-border` +
      `beam-border-auto`. The progress bar drawing along a stroke is `border-draw` / `draw-stroke` /
      `loading-bar`. The toast sequence is `toast-slide-in` → `spinner` → `confetti-burst` composed
      with the existing comma grammar. The card-swipe stack is `stacking-cards` + the `swipe-x`
      gesture.
      **The "genuinely missing" list itself was wrong when written, independent of today's other
      work — items 1 and 3 were already shipped before this entry was drafted:**
      1. ~~**Masked text swap on hover**~~ — **was already shipped, not missing.** `masked-label-swap`
         (plus `-x`/`-diagonal`) is a pre-existing primitive in `interaction-reveal.ts`, confirmed
         registered and documented in `docs/catalog.md`, and was used today as the design precedent
         for `anchored-preview`'s own mechanism.
      3. ~~**Hover intent — a delay that cancels**~~ — **was already shipped, not missing.**
         `hover-intent` is a pre-existing primitive in the same file, `delay:` default `1000ms`,
         also confirmed registered and documented.
      **SHIPPED 2026-09-08:**
      2. **A press state — SHIPPED as `press-depth`.** Channels `[scale, shadow]`, deliberately not
         `translate`, so it composes with `lift`.
      4. **Anchored label pop-out — SHIPPED as `anchored-preview`** (all 4 placements). Built on the
         inherited-custom-property mechanism, not CSS anchor positioning (which stays dropped).
      5. **Text hover pop-out — SHIPPED, same primitive as #4.** `docs/catalog.md`'s own worked
         example for `anchored-preview` explicitly covers this case ("a preview image popping out
         beside a linked word").
      6. **Search-bar expansion — SHIPPED as `search-expand`.** Explicit `inline-size` transition via
         `Preset.transitions`, not FLIP and not `interpolate-size` (which stays deferred pending
         Safari support).
      **Still genuinely missing:**
      7. **Keyboard-shortcut key press** — `<kbd>` keys depress on the real keydown, then a success
         state. Needs a JS primitive, so it needs sign-off per the ground rule at the top of this file.


- [x] **3D image carousel / coverflow — NOT DOING THIS, owner's call 2026-08-28.** Came up as an
      idea (images in a row, one up front in 3D, others receding — like the old iTunes coverflow).
      Two directions were scoped (a quick CSS-only fan reveal reusing the stagger `--kui-i`
      machinery vs. a real interactive coverflow needing a new JS primitive to track "which image
      is active") but the owner decided not to pursue either. Recorded so it does not get
      re-litigated, same as the Canvas/WebGL entry below.


- [ ] **`scripts/generate-nav-header.mjs` is a landmine — fix it or delete it.** Flagged by the
      peer session 2026-09-07 as explicitly unowned work, and it already cost that session a
      12-page revert the same day. The script predates the migration to runtime mount points, so
      running it re-inflates pre-migration markup into 13 demo pages and **kills the theme toggle
      site-wide**: `nav.js` only wires a toggle when it finds `<span data-theme-toggle-mount>`, and
      deliberately skips any page carrying a hardcoded `#theme-toggle` button — which is exactly
      what the generator emits. Confirmed still true 2026-09-07: the script references
      `theme-toggle` and does not emit `data-nav-panel`/`data-theme-toggle-mount` in the shape
      `nav.js` expects. **Do not run it** until it is fixed.

      Second-order: `demo/system.css`'s hiding-header comment states that "every page generates
      this header from `scripts/generate-nav-header.mjs`", which is now a claim about a script
      nobody is allowed to run. Whichever way this goes — update the generator to emit the mounts,
      or delete it and make the 14 headers hand-maintained — that comment needs to match.

- [ ] **The mobile nav scrim collapses to a 213x54 pill instead of covering the viewport.**
      Measured 2026-09-07 in a real browser on `scroll.html` at 390x740 with the hamburger menu
      open: the backdrop rects at `213x54 @88,17`; it should be `390x740 @0,0`. **Pre-existing —
      present in git HEAD, not from the hiding-header work.** Cause isolated by toggling one
      property live: `.site-header { backdrop-filter: blur(14px) }` (`demo/system.css:146`) makes
      the header a containing block for its `position: fixed` descendants, and the scrim is one.
      ```
      as-shipped              213x54 @88,17
      backdrop-filter removed 390x740 @0,0   <- restored
      backdrop-filter back    213x54 @88,17
      ```
      Note the `:has([data-nav-hamburger][aria-expanded='true'])` escape added the same day DOES
      fire correctly (`hamExp=true hdrHidden=true hdrTranslate=none`) — it is not the problem, and
      the comment at `demo/system.css:152` naming `translate` as the reason a scrim would collapse
      is wrong or at least incomplete: `backdrop-filter` had already done it. Fix is probably to
      move the scrim out of the header's subtree rather than to drop the blur.

- [ ] **Hero dot hit targets are 10x10px, under the 24x24 accessibility minimum.** Measured
      2026-09-07 at 390px on `demo/index.html`. `.video-hero-dot` has `padding: 0` and no
      `::before` expansion, so the tappable area is the painted dot. WCAG 2.2 target size (minimum)
      wants 24x24 CSS px. These are the primary control for the hero carousel on a phone, which is
      the audience. Fix without changing the look: an `::before` inset by negative margins, or
      padding plus `background-clip: content-box` — the dot stays 10px, the target grows. Check the
      expanded targets do not overlap each other at the current gap.

- [ ] **Astra's 8 library-absorption proposals are unbuilt.** Carried over from the peer session's
      2026-09-07 handoff, which named `target:@children` and the drag `touch-action` CSS as the two
      cheap ones and did not enumerate the rest. **The full list was not handed over** — recover it
      from the peer session (`kuinetic-20`) or from `ADS-memory/` before starting, rather than
      guessing at eight items from two names.


- [ ] **`path-morph`'s tokeniser silently drops what it cannot match, so two classes of `d` string
      produce a wrong shape with no `reason`.** Found 2026-09-07 while adversarially auditing that
      day's two path-morph fixes. Those fixes are sound and are not what this is about — this is one
      layer below them, in `COMMAND` (`src/core/path-morph.ts:54`) and the `matchAll` that feeds it.
      `[...d.matchAll(COMMAND)]` keeps only what matches and discards every other character without
      a word, which is the same "plausible-looking wrong shape" the module's own header doc
      (`:9-11`) says the whole file exists to prevent. Two reachable symptoms, both measured by
      bundling the module with esbuild and running it in node:

      (a) **Scientific notation is mangled into two numbers.** The number branch is
      `-?(?:\d+(?:\.\d+)?|\.\d+)` — no exponent. So `e` matches nothing, is dropped, and the
      digits either side become separate tokens:
      `parsePath('M0,0 L1e3,1e3')` → `reason: undefined`, **2** segments, both to **(1,3)**. The
      author asked for one line to (1000,1000). SVG 1.1/2 both allow exponents in path data, and
      several icon/optimiser toolchains emit them (SVGO will happily produce `1e3`), so this is not
      a theoretical input. Related: `5e-3` is *rejected*, but with the misleading
      `'L' expects 2 numbers, found 1`, because the `-3` survives as its own number token.

      (b) **An unrecognised command letter vanishes and its arguments get absorbed.**
      `UNSUPPORTED` (`:55`) only screens `A S Q T`. Any *other* letter — a typo, a future SVG
      command, junk — matches neither branch and is simply dropped:
      `parsePath('M0,0 X10,10 L5,5')` → `reason: undefined`, 2 segments, with `10,10` silently
      eaten as a lineto continuation of the preceding `M`. A single mistyped letter turns into a
      different shape rather than an error.

      Both are **pre-existing** — `COMMAND` is unchanged by anything in the 2026-09-07 work — and
      neither is a regression from the `Number.isNaN` guard or `takeCommand`. Verified in the same
      run that the new guards break no valid path: implicit repetition (`M 10 20 30 40`),
      `M...Z M...Z`, `Z Z`, relative implicit (`m0,0 l10,10 20,20`), and the empty/whitespace/bare-`Z`
      cases all still parse or reject correctly.

      Owner's call 2026-09-07: **not worth fixing right now.** When it is picked up, the shape is
      probably: add an exponent to the number branch, and screen *any* letter outside `mlhvcz`
      rather than only `ASQT` — a third alternation group that matches a stray letter and lets the
      walk reject it by name, so the failure says which letter it choked on. Both want the same
      kind of test as the `takeCommand` ones: assert the exact `reason` string, not just that one
      exists. Low user impact today (the site's own icons are hand-authored and clean), which is
      why it is parked rather than urgent.


- [ ] **`draggable` has no hard, viewport-aware bound — so `show-code.js` hand-rolls its drag.**
      Investigated 2026-08-26, and this is a real capability gap, not a lazy demo. All four drag
      effects (`drag`, `drag-inertia`, `drag-x`, `drag-y`) route through one `draggable` primitive
      whose only relevant parameter is `bounds` — a scalar *elastic resistance radius* around the
      drag's rest position, explicitly "never a hard clamp" per its own comment, with no awareness
      of viewport size or the dragged element's rect. `show-code.js`'s `KEEP_VISIBLE` is a hard
      clamp that keeps ~140px of the panel on screen so it can never be dragged out of reach —
      a different mechanism, not a tuning of the same one. Needs owner sign-off on adding a hard
      bound (viewport-relative, element-size-aware) to `draggable`; until then `show-code.js:266-284`
      stays hand-rolled and that is the correct call.
      Related: the `docs.html` TOC half of this pair is closed (`33b12e2`).


- [ ] **`interpolate-size` — deferred until Safari ships it, owner's call 2026-08-26.** Not a risk
      call, a payoff one: 70.47% support with **zero Safari and zero Firefox**, so the ~70 lines plus
      MutationObserver in `src/effects/layout/primitives.ts` (`prepareAutoHeight`/`heightEndpoints`/
      `animateHeight` — the accordion fake) **cannot actually be deleted**. Shipping today adds a
      second mechanism for one preset and retires nothing. Estimated a two-hour change the day
      Safari ships. 6 B brotli. Revisit on Safari support.

- [x] **Anchor positioning — dropped, owner's call 2026-08-26.** Three reasons, and the first is the
      decisive one: it is the only one of the four with a **harmful** fallback — an unsupported
      `anchor()` puts the element in the *wrong* place rather than a neutral one, at 84.12% support.
      Second, its only concrete win (retiring `flip-indicator`'s JS) rests on an unverified question
      nobody has tested: does an anchored position *transition* when the anchor moves, or snap? If it
      snaps it buys nothing. Third, it is positioning, not motion, and the library states that
      boundary in its own words in two source files. Reopen only if the transition question is
      answered yes AND support materially improves.

- [ ] **A viewport gate can't veto a pin's hold while leaving its progress publish running.** Found
      2026-08-26 verifying whether `above:`/`below:` (merged in `4f18816`) closed the "only pin
      where there is room" gap. It half does. `.pin-until-aside` on `scroll.html` now gates cleanly
      on `above:lg` and its `position: static !important` hack is gone (`9039224`). `.showcase-media`
      cannot: `applyViewportGates` (`src/core/animator.ts:315`) treats a JS-rendered primitive as
      **one atomic unit**, and `preparePin` does `installSticky` *and* the `trackProgress` call that
      publishes `--kui-progress` inside a single `prepare()`. Gating it off killed
      `parallax-scale timeline:pin` on the nested video — scale froze at 1.0000 instead of 1→1.06,
      caught live at 238/239. So that file still carries the `ce7a87a` CSS override, documented in
      place. `above:md` is not an alternative — it asks for sticky inside the still-one-column
      768–900px band, reintroducing the overlap `ce7a87a` fixed. Needs either a sub-effect gate
      granularity or splitting `preparePin`'s hold from its progress publish.
      Owner: `src/core/animator.ts` + `src/effects/scroll-mechanics/primitives.ts`.


- [ ] **Resolve the remaining shared pseudo-element ownership gaps.** `shine-sweep` and
      `underline-slide` still compose while both paint `::after` on the same host. The collision
      audit now records the remaining pairs as an accepted baseline; ownership is still unresolved.



- [ ] **14 of the entrance/exit matrix's original 48 names still have no demo coverage.**
      Remaining from the 2026-08-26 check: `fade-out`, `fade-out-up`, `fade-out-down`,
      `fade-out-left`, `fade-out-right`, `slide-out-up`, `slide-out-left`, `slide-out-right`,
      `zoom-out`, `pop-out`, `flip-out-x`, `flip-out-y`, `rotate-out`, `roll-out`.
      This is a demo gap, not a registry bug.

- [ ] **Two modern CSS techniques remain deferred or dropped.** Owner's ask, 2026-08-26.
      2. **`interpolate-size: allow-keywords`** — deferred until Safari ships it, per the
         owner's decision recorded above.
      3. **CSS anchor positioning (`anchor()`/`position-anchor`)** — dropped per the owner's
         decision recorded above; do not build without reopening that decision.

- [ ] **Build dedicated test pages that run through every effect — not `demo/` pages.** Owner's
      ask, 2026-08-23, prompted by finding `cube-rotate`/`book-page-turn` broken by hand while
      adding demo chips (see the entry above). "There's no way we should have bugs at this point"
      — the gap is that nothing lets a human visually walk every registered preset and see it run.
      What exists today is `test/browser/effect-sweep.test.mjs` (all effects sampled headlessly,
      asserted programmatically — see `kuinetic_effect-sweep-browser-tier.md` in memory) and the
      `demo/*.html` pages (curated, marketing-facing, most effects shown once each at most, many
      not shown at all). Neither is "open a page, look at every effect, catch the one that's
      visually wrong." Build pages whose only job is coverage and inspection: one row per
      registered preset (name, its `data-kui`, a replay control), grouped by catalog section,
      living outside `demo/` (a `test-pages/` or `qa/` directory, not linked from the nav). Cross-
      check against `createRegistry().names()` so a new preset can't ship without a row. Worth
      doing before trusting any more hand-added demo effects.


- [ ] **Give `stacking-cards` a browser-tier behavioural test.** Still needed after the
      2026-08-22 foreground-browser verification: scroll the deck and assert each card pins
      and its progress advances. Unit-tier coverage does not replace that rendered check.

- [ ] **A browser suite for replay (D5).** `src/core/instances.ts` has the forward-restart path and
      the unit tests are at 100%, but that is exactly the evidence that failed to catch D5 the first
      time — the JS looked right and the browser disagreed. Nothing in `test/browser/` exercises
      the replay FAB. Until it does, D5 is "believed fixed", not "verified fixed".


- [ ] **Index page: a short "get the video off a page and onto your site" note.** Queued behind
      finishing `scroll.html`, and to be written as part of the index-page overhaul rather than
      bolted on before it. Plain-language, for a reader who has never opened a terminal: install
      ffmpeg, point it at a video URL, get back an `.mp4`/`.webm` you can actually ship. Worth
      writing because it is the exact thing this repo's own demo assets are made with, and the
      pages are full of them with no explanation of where they came from.

- [ ] **Finish visual regression captures with a committed baseline.** The remaining work is
      a shared set of screenshots per demo page, per theme, diffed against a committed baseline.
      Drive it through Claude in Chrome against the dev server on 8934 — not a hand-rolled
      playwright script, which the owner has objected to before.


- [ ] **`demo/text.html:146-152` carries a stale workaround** claiming `marquee` never loops.
      `src/css/text.css:331` sets `--kui-fx-marquee-iterations: infinite` and `compile.ts` does emit
      the longhand. Verify in a browser, then delete the page patch.
- [ ] **Only 7 of section B's 12 effects are demoed** in the matrix section.
      `scroll-progress-bar`, `scroll-progress-bar-y`, `scroll-progress-ring`, and
      `scroll-desaturate` have no card there.


- [ ] **Switch out svg `draw-stroke`** — owner's ask, 2026-08-23. **Get one line of clarification
      first; the intent is genuinely ambiguous.** `draw-stroke` is a real library effect
      (`src/css/svg.css:59`) whose only demo is `data-kui="draw-stroke 1600ms on:enter"` on
      `demo/icons-transitions.html`. Either (a) swap the SVG artwork that card draws, or (b) swap
      the effect on that card for a different one. Note that page was hidden from the nav in the
      same conversation.

- [ ] **`cube-rotate` and `book-page-turn` end edge-on/turned-away on a single element — do not
      use standalone without a fix.** Found 2026-08-23 trying to add them as `data-fx` chips in
      `index.html`'s "Try it" playground. Both are `to`-only keyframes on the shared `flip-face`
      primitive (`src/effects/three-d/index.ts`) with off-axis end angles — `cube-rotate` to
      `90deg`, `book-page-turn` to `-160deg` — and `animation-fill-mode: both` sticks the element
      there permanently. `card-flip-x`/`card-flip-y` hit the exact same shape of problem (a half
      turn lands the element's own front face pointing away, mirrored) and it was fixed with a
      `:not(:has(> :nth-child(2)))` override in `src/css/three-d.css:106-109` that forces a full
      `360deg` turn for a childless (single-image) use. `three-d.css:103` says outright that
      `cube-rotate` was "deliberately left alone" because a 90deg end reads as a different,
      unresolved question — `book-page-turn` was never addressed at all. Either give both their
      own single-child override (what angle actually reads as "turned a page/face and settled"
      instead of edge-on?) or document them as two-element-only presets in the catalog docs so a
      demo page doesn't reach for them standalone again. `card-flip-y` does work standalone and
      is safe to use.

- [ ] **Redo "A slice of every category" on `index.html` — owner is not happy with it.** Owner's
      ask, 2026-08-23. The 12-tile grid (`<section id="catalog">`, `index.html:1413-1586`, class
      `.slices`) is boring and doesn't let you try anything. Two specific problems, in the owner's
      words: it needs to **"pop more,"** and there's **no way to try out a bunch of animations** —
      each tile is locked to one fixed effect on one fixed asset, no chips, no replay, nothing like
      the "Try it" playground earlier on the same page. Concretely, several tiles aren't even real
      pictures — Text & typography is a single scrambling word, SVG & icons is a bare line drawing,
      Numbers & data is a counting number, Navigation is a dropdown, Layout & FLIP is an accordion,
      Ambient is a blob, Feedback & status is a spinner + badge — only Entrance & exit
      (`akira-pantsuit.jpg`), Scroll mechanics (3 rotating product shots), Media & images
      (`modeling_05.jpg`) and Hover & pointer (`goldface.jpg`) use real photography. Owner wants
      pictures pulled in from the other demo pages, **especially `reveals.html` and `scroll.html`**,
      and each tile to let you actually cycle through more than one animation rather than showing a
      single static example. Not started — logged only, owner does not want this done right now.


- [ ] **Make it immediately obvious kUInetic is a CSS animation library driven by HTML
      attributes.** Owner's ask, 2026-08-23: the above-the-fold copy still needs the CSS qualifier.
      Needs a design pass on the kicker, h1, subhead, or a one-liner so "CSS animation library,
      authored via HTML attributes" is unambiguous on first look.


## Demo coverage for the six GSAP-parity features

Deferred deliberately 2026-08-26 — owner wants the library work closed out first. Measured against
`integration/gsap-parity`: `tween` has 15 hits across `demo/*.html`, the other four have **zero**.

- [ ] **`motion-path` / `follow-path` has no demo card anywhere.** Task D shipped the primitive plus
      named presets and nothing to look at. CSS-native (`offset-path`), so a card is cheap.

Note `check:css-coverage` will flag any new class that has no CSS rule, and `test/demo-markup.test.ts`
must pass after edits — index-based scripted HTML edits eat closing tags in this repo.

---

## GSAP parity — what's left after the overnight run

> **Re-verified against the source 2026-08-27.** Three entries were stale — breakpoint variants
> (which this list called "the biggest remaining gap"), stagger ordering, and the lifecycle events
> the `func:` decision was waiting on had all shipped. A fourth, arbitrary scroll ranges, was
> half-built and overstated. Corrected in place rather than deleted, so the ranking below can be
> trusted again. If you are reading this list cold: check each claim against the code before
> acting on it, the way this pass did.

Written 2026-08-26, after measuring kUInetic against GSAP 3.15 plugin by plugin. Six tasks (A–F)
were queued as overnight cloud agents and are specified in
`docs/implementation-outline-gsap-parity.md`; these are what remains once those land, ranked by how
often an author would actually hit them.


- [ ] **Arbitrary scroll ranges — add an inline spelling.** The remaining design work is a
      `range:` parameter so expressing a range does not need a second attribute. Check what
      task C concluded about `at:` under a scroll timeline (§9.4) first. Re-scoped 2026-08-27.


- [ ] **Canvas / WebGL — deliberately NOT doing this.** Recorded so it stops getting re-litigated.
      The entire model is attributes on elements, and canvas has no elements to carry them. If it
      is ever wanted it belongs in a separate opt-in plugin, the way GSAP keeps `PixiPlugin`
      (2.9KB gz) and `EaselPlugin` (2.2KB gz) out of core — never in the main bundle.

---

## Needs JavaScript — do not start without asking

Four documented names cannot be done in CSS. The stated position is *"the whole point of this
library is to not have JavaScript."* Noted for accuracy: the library **does** already ship JS
primitives (drag, cursor, tilt, all of scroll-mechanics), so the principle is CSS-**first**, not
CSS-only — but a new JS primitive is a decision, not a default.

- [ ] `reveal-direction-aware` — must know scroll direction.
- [ ] `page-morph` — needs the View Transitions API.
- [ ] `depth-layers-pointer` — pointer-driven.
- [ ] `perspective-grid` — pointer-driven.

## Carried over from the original audit list

- [ ] **Audit CSS animations** — mistakes where labelling is wrong or the animation does not run.
      Partly addressed by the catalog-honesty pass, the preset-defaults fix, and the catalog/registry
      drift test, but not finished.
- [ ] **Improve the tags under the named effects in `index.html`** — replace with better, more
      engaging animations.
- [ ] **Adjust card layouts** — wider cards, "Show code" directly beneath the `data-kui=*` line.

## Tier 3 — parked, low priority

Owner parked these on 2026-08-23: "not interested in spending time on it right now."
Do not start any of them without asking first. Each entry carries everything needed to pick it
up cold, so nobody has to re-derive the diagnosis.


- [ ] **PARKED 2026-08-23 — do not start without asking.** **`tilt-3d` has no depth coverage in any
      test tier.** The browser sweep names this as a real gap, not an equivalent-coverage exclusion:
      nothing anywhere verifies the Z-axis behaviour actually happens. Carried debt since the
      2026-08-22 handoff. A unit test alone will not close it — unit tests never render a frame, so
      100% coverage proves registration, not animation. Note while working here: **never nest a 3D
      effect inside an element another effect animates.** `card-flip-x/-y`, `cube-rotate`,
      `book-page-turn` and `fold-panel` all carry `transform-style: preserve-3d`, and a preserve-3d
      child inside a 3D-transformed parent composites into the parent's space — this broke
      `fold-panel` and made `wipe-circle` look reversed on `index.html` (reverted in `82ffe08`).

- [ ] **Owner asked to hide `icons-transitions.html` and `three-d.html` from the CSS-animations
      nav** (2026-08-23), then softened it — not done, needs confirmation. The nav is generated; see
      commit `e6c132b`. Note that hiding the pages does not fix the two entries above.
