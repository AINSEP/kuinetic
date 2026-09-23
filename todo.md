# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

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
- [ ] **Rebuild `demo/kuinetic.css`.** Stale against the `forms.css` change — the dev server still
      serves the old forced-colors rule. `npm run generate:css`. **Never `npm run build`**, it
      corrupts tracked `demo/tailwind.css`.
- [ ] **Sign off the no-warning decision on activation merge.** `44be19c` makes an entrance's
      activation win silently. A warning was measured and rejected: it would fire on 4,882–6,098
      pairs including `fade-up, lift`. Census is in the doc comment. Owner call — keep silent, or
      warn only when both halves explicitly declare and differ?
- [ ] **Confirm the delivery invariant actually bites.** `css-composition-invariants.test.ts`
      claims bidirectional set equality against `src/css/*.css`. Add a fifth host-level hover
      `animation:` rule without declaring `delivery` and confirm tests go red.

### Audit findings deliberately NOT fixed — decide on each

- [ ] **`::after` ownership gap.** `underline-slide`, `underline-center`, `typewriter`,
      `redaction-reveal` paint a pseudo-element without claiming the ownership channel.
      `test/css-composition-invariants.test.ts:80-132` calls the 7 resulting pairs "genuine, live"
      and then asserts them as an accepted baseline. Sonnet 5 read that as a deliberate argued
      decision; Codex and Gemini Pro both called it ship-blocking. **Genuine disagreement — needs
      the owner.**
- [ ] **`additiveResolution()` over-includes.** Pulls in claims excluded by gate or phase, so one
      non-additive bystander sinks a valid rescue. Codex's case:
      `fade-up below:md, parallax-y above:md, depth-layer above:md`. Not reproduced yet.
- [ ] **Carousel back faces stay keyboard-focusable.** `pointer-events: none` without
      `visibility: hidden`, so tab order reaches invisible cards. (Codex 7)
- [ ] **`masked-label-swap` exposes both labels to AT.** The documented markup gives an accessible
      name of "Download Get the file". (Codex 8)
- [ ] **`view-swap` `controls:` bypasses `selectorBreadth()`**, and `attribute:` is unvalidated —
      both throw instead of warning. (Codex 11)
- [ ] **`[data-kui-step-offset]`'s 620ms transition** is not in `base.css`'s reduced-motion
      whitelist. (Gemini Flash 3, unverified)
- [ ] **`demo/index.html` at `19f5eec` references 12 uncommitted files** (`video-hero.js`,
      `video-hero-sources.js`, 10 assets). Clean checkout 404s on the homepage. Owner's WIP —
      commit or de-reference.
- [ ] **`npm run lint` is red on `main`** — `test/params.test.ts` is 413 lines vs a 400 cap.
      Pre-existing, predates this audit.

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

1. **Composition silently drops same-channel effects.** Largely closed 2026-09-08 —
   **CORRECTION: item 1's own "zero combos registered" was itself a wrong claim**, propagating
   the same round-1 brief error the box below already flags for other numbers. `COMBOS` in
   `src/effects/catalog/core.ts:415` has always had **two** entries (`fade-up+blur-in`,
   `fade-in+blur-in`), verified on disk. What actually shipped 2026-09-08: `Preset.phase`
   (`EffectPhase = 'entrance' | 'exit' | 'idle' | 'state'`, `core/types.ts:694`) plus phase-aware
   `findConflicts`, so an entrance can now hand its channel to a `:hover`/`:active` state effect
   instead of being refused outright. A full sweep (`ADS-memory/2026-09-08-catalog-review/
   phase-gain-sweep.ts`) measured **+1,244 pairs now compose with 0 regressions**. See the
   narrower remaining gap in the entry below (still only 2 registered combos; a real 5th
   `EffectPhase` value is still missing for JS-rendered/closed-keyframe effects).
2. **Four effects deface their host, none flagged `requiresOwnSubtree`** — **3 of 4 fixed
   2026-09-08.** `ripple` and `confetti-burst` (`feedback.css`) now paint their disc/particles on
   `::after`, off the host box entirely — verified on disk. `border-draw` (`interaction.css:192`)
   now paints its ring on a masked `::before` instead of `border-image`, which fixes the
   square-corners-on-rounded-cards defect too. `gradient-rotate-border` (`ambient.css:130`)
   is the one still live — see the dedicated entry above (established 2026-09-08) for why
   `requiresOwnSubtree` is the wrong tool for it; it currently carries only a warning comment,
   which is a holding position, not a fix.
3. **`confetti-burst` does not burst — FIXED 2026-09-08.** Real outward travel per particle
   (angle/distance/settle), gated to zero size when idle instead of the old always-on dots.
   `demo/ambient-feedback.html`'s hand-rolled workaround for the old always-visible dots is now
   unnecessary dead weight — not removed yet, flagged in its own entry below.
4. **`forced-colors` / `prefers-contrast` unaddressed** across the whole catalog. Still true,
   checked against source 2026-09-08: `forced-colors` appears in exactly one file
   (`src/css/glass.css`, pre-existing before today's `glass` build), `prefers-contrast` appears in
   zero. An audit agent (`build-forced-colors.md`) started this pass today but its checkpoint was
   left at "STARTING" with every section still `TBD` — do not assume it finished; check
   `src/css/*.css` again before relying on this being closed.
5. **Close the stale size entry** — done 2026-09-08; it had misled a planning session. **The
   numbers it was closed with are themselves now stale, corrected again 2026-09-08 in
   `.size-limit.json` directly: the cap was raised to 20 KB brotli (was 14 KB) and the measured
   size is 15.17 KB (was ~12.2 KB).** Also corrected: the reasoning "names are expensive,
   parameters are free" no longer holds — a later measurement (stripping 20 rule blocks and
   re-measuring) found a preset name costs only ~9 bytes brotli, because `presets.generated.css`'s
   repetitive rows compress hard; the actual weight is in the hand-written stylesheets
   (`interaction.css` 14.94 KB brotli, `base.css` 7.27 KB, `carousel.css` 5.70 KB). See the full
   entry lower in this file, which needs the same correction.

- [ ] **A parameter whose name matches a reserved attribute key is silently swallowed — and nothing
      guards against it.** Found 2026-09-08 by an implementation agent probing empirically rather
      than reading the parser; **verified**. There are **18 reserved attribute-level keys** that are
      hoisted out before params are resolved and therefore never reach `spec.params`. `HOISTS` holds
      11 — `on`, `actions`, `timeline`, `threshold`, `cascade`, `spread`, `order`, `cols`, `along`,
      `rm`, `func` — and `applyLifted()` swallows 7 more *before* `HOISTS` is consulted: `at`, the
      gate directions `above`/`below`/`wide`/`narrow`, and the playback keys `repeat`/`yoyo`.
      (An earlier version of this entry said 14; `wide`, `narrow`, `repeat` and `yoyo` were missed by
      a hand-written list — which is itself the argument for the behavioural guard in fix 2 below
      rather than a mirrored constant.)
      Across the **119 distinct parameter names** in the registry, exactly one collides today:
      **`spread` on `feedback-ripple`/`ripple`**. The repro is silent in both directions:
      ```
      parse('ripple spread:6')
        warnings      : []
        params        : {}      <- the parameter vanished
        parsed.spread : "6"     <- redirected into the stagger budget
      compile(...).warnings: []
      ```
      So `data-kui="ripple spread:6"` leaves the ripple at its default of 4 AND silently applies a
      stagger budget the author never asked for. Nothing warns.
      **Two things to fix. The first shipped 2026-09-08; the second, which matters more, did not.**
      1. **FIXED.** `ripple`'s `spread` param was renamed to `extent` (`feedback.ts:70`) — verified
         on disk, with the old name and the bug both documented in the new param's own doc comment.
      2. **The missing guard — still open.** Those 18 names are a de-facto reserved word list and
         *nothing enforces it*, so the next person to add a `spread`, `order`, `at` or `along`
         parameter walks into the same wall with no signal. Grepped every test file 2026-09-08 —
         no registry-wide test asserts "no declared parameter name collides with a hoisted key"
         exists anywhere. Add one. Cheap, permanent, and it is the same class of silent-no-op as the
         compiler dropping effects without saying so and `ParamSpec.values` validating nothing (both
         since addressed) — this codebase has a pattern of them, and a guard test is how the pattern
         stops.

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

**Eight of these ten shipped 2026-09-08 (plus one, #10, already shipped before today and mislabeled
here) — verified against the registry, not against agent claims.** #15 is mixed (2 of its 5 names
shipped), and #8 is the one genuinely unbuilt item left in the whole list.

6. **View Transitions — SHIPPED.** `page-morph` (shared-element, primitive `view-morph`) and
   `view-swap` (same-document, click-driven) both registered; catalog section L now 7 shipped, 0
   planned. See the dedicated GSAP-parity entry for detail.
7. **Collective hover — SHIPPED as `group-dim`.** Goes on the container, `requiresOwnSubtree`,
   dims every child except the hovered/focused one via `:has()`. Verified in `interaction.css`.
8. **Cross-element choreography** — badge → headline → subhead → CTA across *different* elements.
   Still nothing covers this; `stagger.ts` does uniform siblings, `sequence.ts` is single-element.
   **The one item in this list that is still genuinely missing** — grepped 2026-09-08, no `scene`
   concept anywhere in `src/core` or `src/effects`.
9. **Pointer proximity — SHIPPED as `proximity-field` + `proximity-glow`.** Container tracks the
   pointer into two custom properties; each card's ring reads them via
   `background-attachment: fixed`, zero per-card JS. Verified registered and documented.
10. **`masked-label-swap` — was already shipped before today**, not new: `masked-label-swap`/`-x`/
    `-diagonal` are a pre-existing primitive in `interaction-reveal.ts`, used today as the design
    precedent for `anchored-preview`'s inherited-custom-property mechanism. This list item was
    already stale when written.
11. **A generic press (`:active`) state — SHIPPED as `press-depth`.** Primitive `press`, channels
    `[scale, shadow]` (deliberately not `translate`, so it composes with `lift`). Verified in
    `interaction-states.ts`.
12. **`anchored-preview` — SHIPPED, all 4 placements** (`anchored-preview`, `-bottom`, `-left`,
    `-right`). One primitive, four placement presets rather than a `placement:` param (CSS cannot
    branch on a custom property's *value*). Does **not** use CSS anchor positioning — that stayed
    dropped (see RULED OUT) — built on the same inherited-custom-property mechanism as
    `masked-label-swap`/`hover-intent` instead, which needs no fallback branch in any browser.
    `docs/catalog.md` confirms its own worked example covers both halves of this list item ("a name
    tag beside an avatar, a preview image popping out beside a linked word").
13. **`glass` + `backdrop-filter` — SHIPPED.** New `src/css/glass.css` + `materials.ts`, primitive
    `glass`, channels `[background, backdrop]` (new `backdrop` channel added to
    `test/support/channel-properties.ts`). Composes with `press-depth`, `beam-border`,
    `shine-sweep`; refuses `gradient-mesh`. Ships its own hairline `rim`/`rim-width` params.
14. **`spatial-carousel` — SHIPPED as `carousel-3d` / `-high` / `-low` / `-inside`.** See the
    dedicated entry below for the full build — it landed with real deviations from this list's
    spec (`--kui-step-position` instead of `--kui-progress`, a 3-level anatomy instead of 4) that
    are worth reading before treating this as "done exactly as scoped."
15. **Second tier — mixed.** `search-expand` and `hover-intent` were **already shipped** before
    today (same false-staleness as #10 — `hover-intent` is a pre-existing primitive, not new).
    `dock-magnify`, `scroll-state` affordances and `coverflow-scroll` are still unbuilt — grepped
    2026-09-08, zero hits in `src/`.

### LABS — a GPU tier, if we want one

23. **Shaders / WebGL as a third delivery tier.** Owner's ask, 2026-09-08; Codex raised the same
    thing unprompted as `shader-displace` (item 15 of its list). One shared WebGL/WebGPU renderer
    would unlock the class of effects CSS provably cannot do: true refraction (the thing that killed
    `glass-refract`), fluid pointer distortion, image-to-image transitions with real displacement,
    liquid/metaball surfaces, and particle fields with actual physics.
    **The case for it:** every one of those is currently either impossible or a bad fake. The catalog
    tops out exactly where the expensive/premium tier begins.
    **The case against, and it is the strong one:** "CSS-first, ~63% of the catalog never touches JS
    per frame" is this library's entire differentiator. A WebGL tier is per-frame JS, a canvas that
    does not compose with any CSS channel, a real payload, and a whole new accessibility and
    reduced-motion surface. It must not dilute the core claim.
    **Therefore: a genuinely separate `labs` package**, not a section of the add-on bundle — this is
    the third tier already named in the split rule above. Separate entry point, separate size budget,
    separate docs, loudly labelled. One renderer shared by every shader effect, never one per effect.
    **Open questions before any of this:** does a shader effect participate in the channel model at
    all, or is it opaque? What is the no-WebGL fallback for each name? Does `prefers-reduced-motion`
    disable it or swap it for a static frame? **Decide the composition model first** — that answer
    determines whether a non-CSS renderer can even be expressed in this grammar.

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
    installs or downloads it.
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

**Five of these seven shipped 2026-09-08.**

16. **Fix `ParamSpec` before shipping parameter-heavy families — SHIPPED.** `ParamSpec` is now a
    discriminated union (`KeywordParamSpec | ValueParamSpec`); `values` is gone entirely, replaced
    by required `keywords` on keyword-shaped types and `keywords?: never` elsewhere. Union types
    landed exactly as scoped: `'number|percentage'`, `'length|percentage'`, `'angle|keyword'`, each
    normalising to one internal form (e.g. `80%` → `0.8`). This gated — and unblocked — items 13,
    14, 18, 19 below, all of which shipped the same day.
17. **Reword "total parameter control"** into something testable. **Not verified done or not** —
    the literal phrase does not appear anywhere in the repo today (checked `docs/design.md` and
    every `.md` file), so either it was already reworded before this phrase was ever written down
    verbatim, or it never shipped. Check `docs/design.md`'s current parameter-control language
    directly before assuming either way.
18. **`tilt:` takes an angle — SHIPPED**, as part of the carousel build: `type: 'angle', default:
    '0deg'`, with named presets (`carousel-3d-high` at `30deg`, `-low` at `-18deg`) exactly as
    scoped, not a normalized `-1..1` scalar.
19. **Arbitrary variable-font axes — SHIPPED as `var-axis`.** New generic primitive (`text.ts`,
    `text.css:358`) takes an `axis:` parameter for `GRAD`/`opsz`/`SOFT`/`MONO`/etc., alongside the
    three existing fixed ones (`var-weight`/`var-width`/`var-slant`, which stay separate — the doc
    comment explains they animate different high-level properties, not `font-variation-settings`
    directly, so folding them into `var-axis` would be a behaviour change, not a tidy-up).
20. **`glass-rim` / `glass-sweep` become parameters on `beam-border` / `shine-sweep` — SHIPPED,
    exactly as scoped, no new preset names.** `beam-border` gained `arc:`/`softness:` (the
    travelling specular arc); `shine-sweep` gained `color:`/`angle:`/`width:` (the diagonal sweep).
    `glass` itself also ships its own built-in hairline `rim:`/`rim-width:`.
21. **Publish `--kui-item-count`; `--kui-progress` for ring geometry was rejected, correctly —
    scope narrower than planned.** `--kui-item-count` shipped on `step-marking.ts` exactly as
    asked. **`--kui-progress` did not ship as the carousel's continuous position token — a real
    collision was found and documented in `carousel/index.ts`:** it is already the scroll-mechanics
    progress fraction (`scroll-mechanics/primitives.ts:28`), consumed by `pinnedDelays()` to seek
    every `timeline:pin` descendant's delay — a carousel writing a fractional ring position into
    the same name would send nested pinned animations to a nonsense negative delay. Shipped
    `--kui-step-position` instead (unambiguous, no collision). `--kui-offset` for ring geometry
    (never `--kui-i`) shipped exactly as asked.
22. **Composites need a documented parts contract — partially shipped, anatomy deviated.** The
    carousel build documents its parts contract in `carousel/index.ts`'s module comment, but
    landed as **3 levels, not the 4 originally proposed** (camera, ring, slot, face): camera and
    scene collapsed into one element (the fx host itself), with tilt multiplied into every slot's
    own transform rather than held at a separate camera level. `anchored-preview` documents its own
    two-part contract (trigger + `[data-kui-preview]`) independently. No cross-family contract
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

- [ ] **Swap the Fitim Bozar Short on `scroll.html` for `IwCxNOOB_qE`.** Owner's request,
      2026-09-21. New video: <https://www.youtube.com/shorts/IwCxNOOB_qE>. It replaces the
      **front face** of the opening showcase flip card, `demo/scroll.html:1537-1538`, currently
      `4tGD1JWPqvA` — "How to Build Smooth Scrolling Animations With Claude Code and Kling — Fitim
      Bozar". The back face (Zaid, `jOjnRf88Eic`, line 1548) stays.
      Three edits, all on those two lines:
      1. `data-yt-id="4tGD1JWPqvA"` → `data-yt-id="IwCxNOOB_qE"`.
      2. The `<img src>` → `https://img.youtube.com/vi/IwCxNOOB_qE/maxresdefault.jpg`.
      3. The `alt` → the new video's **real** title and creator, in the same `Title — Creator` shape.
         Not known yet — look it up, do not invent it.
      Keep `data-kui="parallax-scale from:1 scale:1.06 timeline:pin"` on the `<img>`; only the front
      face carries it.
      **Check before shipping:** that `maxresdefault.jpg` actually exists for this ID (some videos
      only publish `hqdefault`, and a missing one 404s into a broken image). And do not assume the
      thumbnail is vertical — a Short's `maxresdefault` is 1280x720 with the real frame centred and a
      blurred copy smeared across both sides. The card's 9:16 box + `object-fit: cover` already crops
      that correctly, so no layout change should be needed; verify in a browser, including at 390px.
      The `videos-before-shorts` git tag is the restore point for the older *landscape* videos and is
      unaffected by this swap.

- [x] **Lifecycle phasing (fix candidate 2) — SHIPPED 2026-09-08, and it is the big one.** This
      entry originally offered two candidate fixes and asked for an owner call; phasing is the one
      that landed. `EffectPhase = 'entrance' | 'exit' | 'idle' | 'state'` (`core/types.ts:694`),
      declared per-preset as `Preset.phase`, consulted by phase-aware `findConflicts` so two effects
      in complementary phases on the same channel compose instead of refusing — an entrance can now
      hand its channel to a `:hover`/`:active` state effect once it finishes, the same way it always
      could hand off to an *unrelated*-channel effect. ~34 presets across gestures, forms, layout,
      materials, media, navigation, scroll-mechanics and carousel were phased today; a catalog-wide
      sweep (`ADS-memory/2026-09-08-catalog-review/phase-gain-sweep.ts`) measured **+1,244 composing
      pairs, 0 regressions**. `animation-composition: add` (fix candidate 1) was not built — phasing
      solved the practical problem without it.
      **What is still open, narrower than the original bug:**
      1. **Still only 2 registered combos.** `COMBOS` (`core/catalog/core.ts:415`) is unchanged —
         `fade-up+blur-in` and `fade-in+blur-in` only. The "register the obvious combos" ask from
         this entry's original text was not done; genuinely-same-channel, same-phase pairs
         (`fade-up, lift`, both `translate`, both `entrance`-vs-`state`... no, both plain entrances)
         still drop silently with a remedy message pointing at a nearly-empty feature.
      2. **A real 5th `EffectPhase` value is missing.** `test/composition-phase.test.ts` requires
         every `entrance`-phase preset to resolve a real `@keyframes` block with no closing step —
         which is correct for CSS entrances but wrongly forecloses `entrance` for two shapes that
         otherwise fit it: JS-rendered effects with no `@keyframes` at all (FLIP layout, counters),
         and CSS effects that close their keyframe to a *meaningful, must-persist* value (a drawn
         meter, a grown ring) rather than an arbitrary one. Multiple agents hit this independently
         today (`build-phase-forms-layout.md`, `build-phase-mechanics.md`) and left ~25+ presets per
         family deliberately unphased rather than mis-declare them. A fifth value — something like
         `'reveal'`: closes to a persisted value, never releases, not re-derived from a live
         condition — was proposed but not built; still needs an owner decision, and it means editing
         the currently off-limits `composition-phase.test.ts`.
      3. **Still silent.** The warning still goes to a reporter that is silent by default — "make
         this warning loud" from the original entry was not addressed either.

- [ ] **Four `media.ts` presets are the same closed-keyframe shape as the presets
      `composition-phase.test.ts` already excludes from `phase: 'entrance'`, but are missing from
      that exclusion list.** Found and verified 2026-09-08 by two different phasing agents working
      the same file independently (`build-phase-materials.md`, `build-phase-media-nav.md`), and
      re-verified directly against the test file today: `ken-burns`, `ken-burns-out`,
      `before-after-wipe` and `lightbox-open` all close their keyframe block with an explicit
      `to`/`100%` step (checked against `src/css/media.css`), the identical shape as the 19 names
      currently in `composition-phase.test.ts`'s `excluded` array (that array itself grew from an
      original 10 to 19 sometime today, but never picked up these four). They are correctly
      unphased *today* — nobody has mis-declared them `entrance` — but the missing exclusion means
      nothing stops a future edit from doing so by pattern-matching the file, and the invariant that
      exists specifically to catch that would not catch it here. Cheap, mechanical fix: add the four
      names to the array. Both agents that found this flagged it rather than fixing it because
      `composition-phase.test.ts` was off-limits to them at the time.

- [ ] **All five CSS presets in `src/effects/navigation/index.ts` lack `cloak`, so they flash their
      rest state before JS installs the from-state.** Found and verified 2026-09-08
      (`build-phase-media-nav.md`, `build-phase-materials.md`), re-confirmed today: `cloak` does not
      appear anywhere in that file. `menu-stagger-open`, `dropdown-open`, `mega-menu-drop` and
      `drawer-slide` are all from-only keyframes with no closing step (correctly phased `entrance`
      today) but ship with no `cloak: true`, unlike `pIn()`-built entrances elsewhere in the catalog
      which set it automatically. `menu-fullscreen`'s from-state (`opacity:0`,
      `clip-path: circle(0%)`) has the same gap. Not a phase bug — a visible-flash bug on every one
      of this family's five names. Nobody has fixed it; both agents that found it said so explicitly
      rather than touching the off-limits/not-theirs file.

- [ ] **`docs/design.md`'s framing of `idle` as a phase worth declaring deserves scrutiny — flagged
      2026-09-08, not independently confirmed in `docs/design.md` itself.** The technical claim
      behind this is verified: `INDEPENDENT_PHASES` (`core/channels.ts:77`) is `new Set(['entrance|
      state', 'exit|state'])` — `idle` is not a member of either pair, so declaring a preset `idle`
      changes zero composition outcomes today; an unphased claim and an `idle` claim behave
      identically against every other claim on the same channel. **Could not locate the literal
      claim in `docs/design.md`** — grepped the file for "idle" and "phase" and found neither the
      word nor an equivalent paraphrase, so either the claim lives somewhere else, was already
      corrected, or was mis-attributed. Whoever picks this up should re-locate the actual claim
      before writing a fix, not assume this description of it is accurate. Separately worth
      recording: today's phase work still declared `idle` on ~17 scroll-mechanics/carousel presets
      anyway (see the GSAP-parity/phase entries), reasoning that "runs unbounded, never yields" is
      worth being honest about even though it changes no compiler behavior yet — that reasoning
      itself might be exactly what this entry should end up pointing at instead of `design.md`.

- [ ] **Four shipped effects deface the element they are put on — 3 of 4 FIXED 2026-09-08,
      `gradient-rotate-border` remains.** Found by two independent outside reviews; all four
      verified in the CSS then, re-verified against today's fixes:
      - `ripple` (`src/css/feedback.css:247`) — **FIXED.** Now paints on `::after`, off the host
        entirely; the host rule is `position: relative` only.
      - `confetti-burst` (`src/css/feedback.css:407`) — **FIXED.** Also moved to `::after`.
      - `border-draw` (`src/css/interaction.css:192`) — **FIXED**, and via a different mechanism
        than flagging: a masked `::before` ring instead of `border-image`, which also fixes the
        separate square-corners-on-rounded-cards defect `border-image` caused.
      - `gradient-rotate-border` (`src/css/ambient.css:130`) — **still live.** `mask-composite:
        exclude` still erases the content box. See the dedicated entry higher in this file
        (established 2026-09-08) for why `requiresOwnSubtree` is the wrong tool here — it needs a
        new `masksOwnContent`/`replacesHostBox`-shaped flag that does not exist yet. Currently
        carries only a warning comment (a holding position, explicitly not a fix).
      None of the three fixes used `requiresOwnSubtree` — all three moved to a pseudo-element
      instead, which sidesteps the flag question entirely for a preset that can be restructured.

- [x] **`confetti-burst` does not burst — FIXED 2026-09-08.** `src/css/feedback.css:485` now gives
      each particle real per-particle outward travel (angle, distance, a constant downward settle),
      gated to zero size when idle via `@property --kui-confetti-fade` instead of the old
      always-visible dots. New params: `distance:`, `fan:` (angular spread — named `fan`, not
      `spread`, because `spread:` is a hoisted stagger-budget key and unreachable as a param name),
      `size:`, `spill:`, `color1..5`. `demo/ambient-feedback.html:211-229`'s hand-rolled workaround
      for the old always-invisible-until-clicked dots is now dead weight — not removed, see its own
      entry below.

- [x] **No collective-hover category exists — hovering one card cannot dim its siblings — SHIPPED
      2026-09-08 as `group-dim`.** New primitive/preset in `interaction-states.ts`, goes on the
      container (`requiresOwnSubtree: true`), dims every child except the hovered/focused one via
      `:has()` — exactly the mechanism this entry proposed. Verified registered and documented in
      `docs/catalog.md` section I.

- [ ] **No cross-element choreography — a timed sequence across *different* elements.** Still
      genuinely open — nothing shipped 2026-09-08 despite the surrounding session's heavy output.
      Found 2026-09-08. `core/stagger.ts` handles uniform siblings; `core/sequence.ts` (`at:-200ms`) is
      single-element. A hero that plays badge → headline → subhead → CTA, four unrelated elements in
      order, is today hand-counted `delay:` values scattered across four tags, and adding a fifth
      element means editing all of them. Nothing in A–R covers it. Candidate shape: a named scene on
      a container, with members declaring their place in it, so the timing lives in one place.
      **Check first** whether the existing comma + `key:value` grammar already reaches this — a
      previous session concluded it covers grouped/serial cases; this is the case it may not.

- [x] **`backdrop-filter` appears nowhere in `src/` — SHIPPED 2026-09-08 as `glass`.** New
      `src/css/glass.css` + `src/effects/catalog/materials.ts`, primitive `glass`, channels
      `[background, backdrop]` (new `backdrop` channel). Given a `perfClass: 'paint'` classification
      as this entry anticipated. Composes with `press-depth`/`beam-border`/`shine-sweep`; correctly
      refuses `gradient-mesh` (same `background` channel). `glass-rim`/`glass-sweep` did **not**
      ship as new names under it — see the PARAMETERISE section, they became parameters on
      `beam-border`/`shine-sweep` instead, plus `glass`'s own built-in `rim:`/`rim-width:`.

- [x] **Variable fonts: only three fixed axes, no arbitrary one — SHIPPED 2026-09-08 as `var-axis`.**
      New generic primitive (`text.ts`, keyframes `kui-var-axis` in `text.css:358`) takes a generic
      `axis:` parameter for `GRAD`/`opsz`/`SOFT`/`MONO`/etc. `var-weight`/`var-width`/`var-slant`
      were deliberately **not** collapsed into it — the doc comment explains they animate
      high-level properties (`font-weight`, `font-stretch`, `font-style: oblique <angle>`), not
      `font-variation-settings` directly, and `slnt`'s sign convention is inverted relative to CSS
      `oblique <angle>`, so re-expressing them would be a behaviour change, not a tidy-up.

- [x] **Pointer proximity: nothing in `src/` tracks the pointer as a reusable coordinate — SHIPPED
      2026-09-08 as `proximity-field` + `proximity-glow`.** Two primitives in the new
      `interaction-proximity.ts`: `proximity-field` goes on the shared container, tracks the
      pointer via one listener, writes two custom properties, paints nothing itself; `proximity-glow`
      goes on each card and is pure CSS — a masked-ring `::before` reading the container's
      properties via `background-attachment: fixed`, exactly the mechanism this entry proposed, with
      zero per-card JS. Verified registered and documented in `docs/catalog.md` section I.

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

- [ ] **Accessibility surface nobody has looked at: `forced-colors` and `prefers-contrast`.** Raised
      2026-09-08. `prefers-reduced-motion` is handled everywhere; these two are unaddressed across
      the catalog. Effects that paint their own colour (`beam-border`, the ambient gradients, the
      glass family which landed today) are exactly the ones Windows High Contrast will strip or
      invert. **Still true as of the end of 2026-09-08** — re-checked directly against source:
      `forced-colors` appears in exactly one file (`src/css/glass.css`, and that coverage predates
      today's `glass` build, not new), `prefers-contrast` appears in zero. An audit agent started
      this today (`build-forced-colors.md`) but its checkpoint stopped at "STARTING" with every
      section marked `TBD` — do not assume finished without re-checking `src/css/*.css`. Audit and
      decide a house rule.

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

- [x] **3D carousel, with a camera: `tilt` and `curve` — SHIPPED 2026-09-08, as `carousel-3d` /
      `-high` / `-low` / `-inside`.** New `src/effects/carousel/index.ts` (primitive `spatial-ring`)
      + `src/css/carousel.css`, registered directly into the core registry (see the add-on-bundle
      entry above for why that's a live tension with this list's own classification exercise). All
      four presets declare `requiresOwnSubtree: true` and `phase: 'idle'`.
      **Shipped as specified:**
      - **`tilt:` is an angle**, not a normalized scalar — `type: 'angle', default: '0deg'`, with
        `carousel-3d-high`/`-low` presets at `30deg`/`-18deg` exactly as asked.
      - **`--kui-offset`/`--kui-item-count`** used for ring geometry, never `--kui-i` — confirmed in
        `step-marking.ts`.
      - **`facing: radial | camera`** shipped as specified, spelled with that exact name.
      - **Convex/concave shipped as two separate effects** (`carousel-3d*` vs `carousel-3d-inside`),
        exactly the alternative this entry itself proposed over a `curve:` parameter — the module
        doc even titles the section "Convex and concave are two names, not one parameter." `arc:`
        (default `360deg`, `120deg` on `-inside`) and `radius: auto`-by-default both shipped.
      - **Grabbable shipped** — `grab:` keyword param (`true`/`false`) plus a dedicated
        `carousel/drag.ts` controller (pointer + keyboard, snap-to-nearest-step), not a reuse of
        `drag-inertia` — the "treat it as a new controller, not a parameter" instinct was right, and
        that's what got built.
      **Deviated from spec, both documented in-file with reasoning:**
      1. **`--kui-progress` was rejected for the continuous index — real collision, not a style
         choice.** It's already the scroll-mechanics progress fraction consumed by `pinnedDelays()`
         to seek every `timeline:pin` descendant; a ring publishing a fractional position into the
         same name would send nested pinned animations to nonsense negative delays. Shipped
         `--kui-step-position` instead. See the PARAMETERISE section for the full writeup.
      2. **Anatomy is 3 levels, not 4.** Camera and ring/scene collapsed into one element (the fx
         host); tilt is multiplied into every slot's own transform instead of held at a separate
         camera level. Face level was kept as specified.
      **Not verified:** the `preserve-3d`-flattens-under-an-ancestor risk this entry flagged
      (`overflow: hidden`/`clip-path`/`opacity<1`/`filter`/`backdrop-filter` on any ancestor) was
      not re-tested against the shipped carousel in a browser — the concern and its cause are
      unchanged from when this entry was written, only the effect it applies to now exists for real.

- [ ] **`liquid-glass.css` — a glass surface family. 3 of 5 pieces SHIPPED 2026-09-08, 1 remains, 1
      correctly stays ruled out.** Owner's ask, with a reference image (dark glassmorphism kit:
      panels and pills with a bright specular rim, a diagonal sheen band, blurred content behind).
      - `glass` — **SHIPPED.** New `src/css/glass.css` + `materials.ts`, primitive `glass`,
        `backdrop-filter: blur() saturate()`, a hairline inset border, a sheen gradient, given
        `perfClass: 'paint'` per this entry's own instruction. Also ships its own built-in
        `rim:`/`rim-width:` params, so the base already carries a hairline light edge on its own.
      - `glass-rim` — **SHIPPED, exactly as the "check first" note here predicted**: it became
        `arc:`/`softness:` parameters on `beam-border`, not a second primitive.
      - `glass-sweep` — **SHIPPED, same pattern**: became `color:`/`angle:`/`width:` parameters on
        `shine-sweep`, not a second primitive.
      - `glass-press` — **still not built**, but the blocking piece it needed now exists: `press`
        (preset `press-depth`) shipped today as the catalog's first `:active` state, and its own doc
        comment names `glass-press` by name as the natural next composition. What's left is
        composing `glass` + `press-depth` (or a dedicated variant), not building `:active` handling
        from scratch.
      - `glass-refract` — **correctly not built.** Already covered by RULED OUT below: SVG
        `feDisplacementMap` over live DOM, both outside reviewers flagged it unprompted, real
        refraction belongs in a future WebGL labs tier, not "CSS glass." No change from the original
        call.

- [ ] **Micro-interactions from a reference video — 6 of 7 "genuinely missing" items turned out to
      already exist or shipped 2026-09-08; only 1 remains.** Owner's ask, 2026-09-08 (transcript
      supplied; the video itself was not watched). Mapped against the catalog:
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

- [x] **Install section rebuilt with a CDN option and a GitHub link — SHIPPED 2026-08-28**
      (`8ee89d2`). The homepage's install card only ever showed local relative paths
      (`./kuinetic.all.js`), with no CDN option and no link to the repo, despite the package
      being on npm and both jsDelivr/unpkg serving it correctly. Reviewed 5 structurally
      different candidates (segmented toggle, always-visible split columns, accordion, chip
      picker, inline-code toggle) as throwaway sections appended to the page, then picked the
      chip picker and deleted the other four along with their CSS/JS — nothing review-only is
      left. Final shape: three chips (CDN default / npm / Download) feed one shared panel that
      never changes height on switch, plus a GitHub link. CDN uses jsDelivr, unversioned
      (`@latest` resolves correctly, confirmed live). Title is "Pick your way in.", centered; the
      old "Ship it in two lines." heading was dropped because it was only true for one of the
      three tabs, and the descriptive subtitle went with it as redundant. Browser-verified: all
      three chips switch by click and keyboard, both themes, no console errors.

- [x] **Two `.kui-contract` code-chip bars now stay visible for the whole pin, not just the
      approach — SHIPPED 2026-08-28** (`43567e3`). `#pin-flip-demo` (pin-section demo) and
      `#horizontal-track-demo` (Horizontal Travel) both had their contract bar sitting outside the
      pinned element, so it scrolled away the instant the pin engaged and a reader watching the
      effect never saw the attribute that caused it. Moved both inside their pinned container.
      **Two broken iterations before this landed, worth remembering:** a fixed-offset
      `position: absolute` drifted from the video by an amount that depended on how much slack
      `align-content: center` left at a given window height; a `max-height` fallback back to
      `position: static` re-entered CSS Grid flow and inherited `justify-self: stretch` — measured
      stretching to 682px on one and **4548px** (the full eleven-card scroll width) on the other.
      Final shape: `position: absolute`, pinned ~22px under the header, an explicit `max-width`
      cap (the cap is what stops the stretch, not the positioning), no fallback at all. Verified
      across 8+ real viewport sizes (373–1300px tall, 900–2560px wide) with computed-style
      measurements. **Known accepted tradeoff:** below ~550px window height, the horizontal-scroll
      chip can sit close to or slightly touch the row beneath it — cosmetic, extreme window
      heights only, disclosed rather than hidden.

- [x] **Cross-element triggering — SHIPPED 2026-08-28, deployed to production the same day**
      (`8d2fec3`, merged `4c4393a`). See the dedicated entry further down (GSAP parity section)
      for the technical writeup. Pushed to `origin/main` and live on both `kuinetic.com` (Vercel)
      and `kuinetic.pages.dev` (Cloudflare Pages).

- [x] **3D image carousel / coverflow — NOT DOING THIS, owner's call 2026-08-28.** Came up as an
      idea (images in a row, one up front in 3D, others receding — like the old iTunes coverflow).
      Two directions were scoped (a quick CSS-only fan reveal reusing the stagger `--kui-i`
      machinery vs. a real interactive coverflow needing a new JS primitive to track "which image
      is active") but the owner decided not to pursue either. Recorded so it does not get
      re-litigated, same as the Canvas/WebGL entry below.

- [x] **Three browser checks owed on the 2026-08-27 audit fixes — ALL THREE PASS, verified 2026-08-27.** All ten fixes are unit-green
      (2510 tests) but three change what a reader actually sees, and no browser rendered a frame
      for any of them. (a) `threshold:50%` should now start an element halfway in rather than at
      its first visible pixel, and an `on:enter/leave` pair should reverse when it drops back below
      half. (b) A `timeline:pin` element with a sequenced second effect should reach its final frame
      at the bottom of the pin range — worth eyeballing on `scroll.html`, since the same fix also
      repairs a plain `delay:` under pin that used to stop at 50%. (c) `cursor-lag`/`magnetic`
      should track the pointer instead of crawling. Drive it through Claude in Chrome against the
      dev server on 8934 — never a hand-rolled Playwright script.
      **Result — measured live against the dev server, not reasoned about:**
      (a) `threshold:50%` on a 200px element holds `data-kui-state=ready` at 15%, 35% and **48.1%**
      visible, and flips to `finished` with opacity 1 at **65.1%**. Sharp, correct boundary; before
      the fix it fired at the first visible pixel.
      (b) A `pin-section distance:200vh` host with an inner `fade-up 1s timeline:pin, zoom-in 1s
      at:after`: at `--kui-progress: 1` the compiled delays are `-2s, -1s`, so the *second* track
      sits at exactly its end (`scale: 1`), scrubbing `0.9238 -> 0.9772 -> 1.0` on the way. The bug
      parked it at its beginning.
      (c) `magnetic` settles at **-17.29px** for a pointer 49px from centre at `strength:0.35`
      (expected `49 x 0.35 = 17.15`), over 28 smooth frames. `cursor-lag` ramps over 95 distinct
      values at a steady 16-18ms cadence, holds its target exactly, and — the actual regression
      case — **retargets cleanly mid-flight** with no near-zero-delta crawl and no dropped frame.
      The unreachable-`threshold:` warning added in `b441d83` was **not** observable on a demo page,
      and that is correct rather than a miss: the library's default reporter is `silentReporter()`
      by design and the demo bundle exposes no module exports to build a `consoleReporter()` from.
      The behaviour is verified (a 3-viewport-tall element with `threshold:50%` stays `ready`
      forever instead of firing); the warning string itself is covered by unit tests.

- [x] **`threshold:` now warns when it cannot fire — SHIPPED 2026-08-27 (`b441d83`).**
      Found 2026-08-27 while fixing the threshold bug. `threshold:50%` on a 3-viewport-tall element
      never triggers: its intersection ratio tops out around 0.33. This is **not fixable from the
      binder** — the browser only delivers entries at crossings of the threshold it was handed, so
      the peak ratio is never reported. Documented in `meetsThreshold` in `src/core/activation.ts`.
      The decision to make is whether the library should warn when an element's measured height
      makes its authored threshold unreachable, rather than silently never firing.
      **Fixed:** new `src/core/threshold-reachability.ts`, warning once per element. It measures
      only on a genuine *leave* — after a real prior entry — never on first delivery, so a lazy
      image, a collapsed accordion, or a pre-font-load layout cannot produce a false warning. The
      underlying browser limit is unchanged and still documented in `meetsThreshold`; the library
      now says so instead of failing silently.

- [x] **`distance:50%` resolved against the wrong box — FIXED 2026-08-27 (`b0aea0a`).** Found
      2026-08-27 while fixing the `calc()` case, not fixed. `resolveDistance` resolves the
      percentage against the *element's* height, while the spacer's CSS `height: 50%` resolves
      against its own containing block — so the reserved scroll distance and the tracked progress
      range are two different numbers. Same class as the `calc()` bug fixed in `c99df4c`, which is
      worth reading first: it fixed it by reading the distance back off the spacer, so the two
      agree by construction.
      **Fixed:** and `c99df4c` did *not* already cover it, which was the surprise —
      `resolvesToPixels('50%')` returns `true`, so percentages never entered the warn/measure branch
      at all. New `usesPercentBasis()` probes `toPixels` with two bases differing only in
      `percentBasis` and compares. It gates only the span computation; the warn gate stays on the
      narrower opaque-value check, so `50%` with no spacer still resolves silently and correctly.

- [x] **`preparePin` now wires its own spacer as `contentAnchor` — FIXED 2026-08-27 (`d8fc14b`).** Follow-up from the same fix.
      It tracks the parent instead, so `pin-section distance:calc(...)` takes the *warn* path rather
      than the measure path — only managed `horizontal-scroll` and `sequence-scrub`/managed
      `media-scrub` get the spacer measurement. Pin could reasonably pass its own spacer; that is a
      real improvement but wider than the defect that surfaced it, so it was deliberately left.
      **Fixed:** `installSticky` already returned `{ spacer, dispose }` and `preparePin` was
      destructuring only `dispose`. The parent *is* load-bearing, but only in the no-spacer branch
      (the default-distance fallback and `geometrySource`'s sticky-escape) — that branch is
      untouched. With a spacer it now tracks the node itself and passes the spacer as
      `contentAnchor`, so a leading sibling no longer biases progress.

- [x] **A childList removal now re-ranks the survivors — FIXED 2026-08-27 (`389df49`).** Found
      2026-08-27 adjacent to the stagger-ledger fix, not fixed — `releaseTree` doesn't restage the
      parent, so remove one item from a staggered group and every later sibling keeps its old
      `--kui-i`. Same class as the stale-after-edit half that *was* fixed in `3d57ff7`.
      **Fixed:** by the time the deferred MutationObserver flush runs, the removed node's
      `parentElement` is already `null`, and the only thing that still knows is
      `MutationRecord.target`. So the fix sidesteps the DOM parent entirely: a `GROUP_OF_CHILD`
      WeakMap populated by `indexStaggerGroup` lets `restageAfterRemoval()` find and re-index each
      surviving group from the child's own bookkeeping. Composes with `3d57ff7`'s `LedgerSet`.

- [x] **`test/animator-observe.test.ts` teardown hoisted to `afterEach` — FIXED 2026-08-27 (`4f2b2e3`).** Each test destroys its
      animator at the end of the test *body* rather than in `afterEach`, so a failing assertion
      leaves one observing `document.body` that then scans the **next** test's markup. Caught
      2026-08-27 when a new test passed in a group run and failed in isolation. The block added
      that day tears down in `afterEach`; the older tests in the file still carry the hazard, and
      until they are moved over, a failure in this file can cascade into unrelated red.
      **Fixed:** the six outer-scope tests now push their animator onto a shared `running[]` unwound
      in `afterEach`, matching what the two inner describes already did. Two tests call `destroy()`
      mid-body as the behaviour under test and keep that call. Zero assertions changed, and all 11
      tests were verified to pass individually via `-t` filters as well as grouped — no test turned
      out to be depending on the leak.

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

- [ ] **The 2026-09-07 `settleArmed` fix has a hole: `cancel()` re-entered from a `kui:start`
      listener still locks an all-continuous element out forever.** Found 2026-09-07 by an
      adversarial audit of that same day's fixes, then **reproduced** on a real
      `<div data-kui="pin-section">`. The original bug (one `cancel()` leaves a pin stuck at
      `running`, and `activate()`'s guard then refuses every restart) was fixed and shipped, and
      the fix is correct for every path that goes through `settleWhen` first. This is the one that
      does not.

      The ordering in `activate()` (`src/core/animator.ts`) is the whole bug:
      ```
      946: state.status = 'running'
      968: this.emit(el, state, KUI_EVENT.start, 'activated')   <- synchronous; listeners run HERE
      970: this.settleWhen({ el, state, run }, started, 'finished')
      ```
      `cancel()` (`:1268`) decides whether to write the terminal state with
      `if (wasRunning && this.settleArmed.get(state) === false)`. A listener that calls
      `cancel(el)` inside `kui:start` runs at line 968 — *before* `settleWhen` has recorded
      anything — so the lookup returns `undefined`, `=== false` is false, and no status is
      written. Control returns to line 970, `settleWhen` sets `settleArmed` to `false` and returns
      early without arming a gate, and nothing will ever write the status again.

      Measured (probe against the real catalog, jsdom, `pin-section` with a `kui:start` listener
      that calls `animator.cancel(node)`):
      ```
      PROBE-REENTRANT state=running restarted=false
      ```
      `data-kui-state` stays `running` and the next `activate()` is silently dropped — the exact
      lockout the fix was written to remove, reached through a narrower door. `kui:start` is a
      public documented lifecycle event, so this is reachable by consumer code; nothing in this
      repo does it today, which is why it is tomorrow's work and not a hotfix.

      **Do not take the obvious fix without thinking.** Defaulting `settleArmed` to `false` at
      `beginRun()` makes the re-entrant case correct, but `cancel()` would then write `'finished'`
      for a cancelled *reverse* as well, and a reverse settles on `'ready'` — see the reasoning in
      `cancel()`'s own comment and `control.test.ts:950`. Check what `reverseFrom` does about
      emit-vs-`settleWhen` ordering before choosing. Arming the bookkeeping earlier (where
      `started` is already known, before the emit) is probably the shape, but verify the reverse
      path. Regression test must fail before the fix, and must use a real continuous catalog
      primitive at its DEFAULT activation — an `on:manual`/`on:enter` gate adds a non-continuous
      CSS companion instance and silently makes the whole scenario unreachable, which is how the
      original bug survived one earlier review.

- [ ] **Two `gesture.ts` cleanup paths can strand the recogniser mid-drag.** Both found
      2026-09-07 by the same audit. Verified against the source; **neither reproduced by running
      it**, so confirm before fixing.

      (a) **`pointercancel` can throw before cleanup, under `capturePointer: true`.**
      `pointercancel` is routed to `onUp` (`src/core/gesture.ts:247`) with a comment saying it is
      there so that "a gesture interrupted by the browser (scroll takeover, alt-tab) leaves the
      recogniser permanently mid-drag" — which is precisely what it fails to prevent. By the time
      `pointercancel` fires the pointer is no longer active, so
      `el.releasePointerCapture?.(event.pointerId)` throws `NotFoundError`; `?.` guards the
      method's existence, not the throw. The exception aborts `onUp` before `handlers.onEnd` and
      before the `origin = null; active = false; samples = []` reset at the bottom. This affects
      every gesture that keeps capture — `drag`, `drag-x`, `drag-y`, `throwable`, `pressable`,
      `elastic-pull` — and is **pre-existing**: the 2026-09-07 guard only covered the
      `capturePointer: false` path (`swipe-x`). The fix is probably a `try`/`catch` (or the
      `runQuietly` pattern `animator.ts` already uses) rather than a wider flag, because cleanup
      must never be able to abort the payload — that principle is already written into the
      comment above that line.

      (b) **With `capturePointer: false`, a pointer released outside the element never reaches
      `onUp`.** `pointerdown`/`move`/`up`/`cancel` are all bound to `el` itself
      (`src/core/gesture.ts:243-247`), never to `window`/`document`. Capture used to paper over
      this: it routed the whole sequence back to the capturing element regardless of where the
      finger went. `swipe-x` now opts out of capture, so a swipe that lifts outside the element's
      box never fires `onUp`, never computes a direction, and leaves `active` stuck `true`.
      Low practical impact for the one live consumer (`.video-hero` is a full-bleed `100svh` box,
      so leaving it means leaving the viewport) and the next `pointerdown` resets `origin` — but
      it is a real semantic change that came in with `capturePointer: false` and it will bite the
      first non-full-bleed `swipe-x`. Options: bind `pointerup`/`pointercancel` to `window` when
      `capturePointer` is false, or keep capture and drop it on the first `pointermove` that is
      not a drag. Whichever, prove it with a pointer sequence that ends outside the element.

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

- [ ] **`demo/docs.html`'s new `scroll-spy` TOC is not browser-verified.** Landed in `33b12e2` with
      lint/typecheck/`demo-markup` green, but the browser slot was held so nothing rendered a frame.
      100% unit coverage proves registration, not that an effect animates. Still to assert: the
      right heading highlights while scrolling each of the three docs; switching doc tabs mid-scroll
      tears down and rebuilds with no console warning and no stuck highlight; and `offset-top:104px`
      visually matches the old `STRIP=104` so no heading is marked active while still behind the
      sticky header.

- [ ] **`word-cycler` and `header-shrink` each transition a property outside their own declared
      channel.** Found 2026-08-26 while building the pseudo-element and transition scanners. This is
      a *different shape* from the clobber bug above and the skipped invariant does not catch it:
      that one asks a cross-preset question (two disjoint-channel presets both owning a
      `transition`, so composing them discards one), whereas this is per-preset self-consistency —
      a single preset transitioning something it never declared. Both presets are also among the
      ten clobber writers, so they will surface in that pair list once the invariant is enabled,
      but for the wrong reason. Needs its own assertion.
      Owner: `src/effects/catalog/text.ts` + `src/effects/catalog/navigation.ts`.

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

- [ ] **Ship `@starting-style` — blocked on the `transition` channel fix.** Scoped 2026-08-26, plan at
      `ADS-memory/.local-artifacts/plan-2026-08-26-modern-css.md`. Adds a capability the library
      does not have: animating elements entering/leaving the DOM or `display:none`. Makes
      `dropdown-open`/`drawer-slide`/`mega-menu-drop` work the way real dropdowns are built, and
      makes the 16 exit presets that ship-but-are-never-demoed finally usable. New preset family, no
      new grammar or renderer — precedent is `lift`/`pop`, transition rules keyed on `data-kui-fx`
      behind `stylesheetTimingPrepare`. Channels: opacity/scale/translate + `transition` + a new
      `discrete` for display/overlay. 90.65% support (Safari 17.5, FF 129), graceful fallback, no
      `@supports` guard needed, ~285 B brotli measured.
      **Hard prerequisite:** `@starting-style` is a *transition* feature and adds ~6 transition-writing
      presets, so it widens the untracked-`transition` bug. Do that repair first.
      Two settled details: `on:enter` cannot be deferred (there is no `transition-play-state`), so
      declare `supportedActivations:['manual']` and warn rather than accept-and-ignore.
      It does **not** retire the JS-stamped attribute generally, and does **not** fix the zero-area
      `on:enter` deadlock — IntersectionObserver still measures geometry, not paint.

- [ ] **Ship `@container` as `wide:`/`narrow:` gates.** Same plan. Answers a *different* question from
      the `above:`/`below:` viewport gates — neither subsumes the other, both stay. Reuses
      `gatedAnimationName`/`applyGate` wholesale; `compile.ts` untouched. Writes **no channel at all**
      — a gate switches `animation-name` to none. 94.05% support, the highest of the four; 101 B
      brotli measured. Two hard details from the plan: the fallback defaults must be **inverted**
      relative to the media-query version, or every gate is silently off in a non-supporting
      browser; and container gates should be refused on JS-rendered primitives in v1, because there
      is no `matchContainer()`. `container-type` changes layout, so it is exposed as a
      `data-kui-container` attribute rather than requiring author CSS — structural CSS in the page
      is what the library exists to own.

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

- [ ] **`transition` is untracked by the channel invariant, and there is a live reachable bug behind
      it.** Found 2026-08-26 while closing two other blind spots in `css-invariants.test.ts`. Ten
      presets write `transition` unconditionally: `lift`, `pop`, `lift-shadow`, `border-draw`,
      `border-glow`, `header-shrink`, `header-hide-on-scroll`, `back-to-top-fade`, `word-cycler`,
      `plus-to-minus`. Two equal-specificity rules both setting `transition` means source order wins
      and the loser's is discarded outright. `data-kui="lift, border-glow"` declares `['translate']`
      vs `['shadow']` — disjoint, so the compiler happily composes it — and then `border-glow`'s
      `transition: box-shadow` replaces `lift`'s `transition: translate`, so **lift snaps instead of
      easing**. This is exactly the class the invariant exists to catch, sailing through it.
      **It cannot be fixed by adding `transition` to a channel** — that puts all ten on one channel
      and forbids every hover combination. Needs either a dedicated invariant (assert each preset
      only transitions properties inside its own declared channels, then flag co-writers) or a
      compile-time transition merge. Owner: `src/css/interaction.css` + `base.css`.

- [ ] **Two effects can own the same pseudo-element, wholly unaudited.** Same session, same sweep.
      Both CSS extractors skip pseudo-element rules by design — correct for same-box clobbering —
      but nothing checks the `::before`/`::after` box itself. Concrete reachable pair: `shine-sweep`
      (`['sweep']`) and `underline-slide` (`['scale']`) are disjoint so they compose, and **both
      paint `::after` on the same host**. One box, two effects. `underline-slide`/`underline-center`
      are the safe case — both `['scale']`, already blocked. Third structural hole of this family.

- [ ] **Four more channel-map gaps, all verified against the CSS, none closed.** (a)
      `transform-origin` untracked — 8 unconditional writers (`scroll-progress-bar`,
      `progress-indeterminate`, `ripple`, `progress-bar`, `fold-panel`, `book-page-turn`,
      `loading-bar`, `chart-bar-grow`); it does not clobber a transform but redefines what every
      transform on that element *means*, so two composed effects wanting different origins disagree
      silently. (b) `background` channel is missing longhands — `background-repeat` (7 writers) and
      `background-clip`/`-webkit-background-clip` (2); all already declare `background`, so adding
      them is a safe widening and a one-line follow-up. (c) `border` and `sweep` have **no**
      `CHANNEL_PROPERTIES` entry at all, so `allowedProperties()` returns the empty set — strict and
      safe for their own primitives, but `border-image-*` and `border-top-color` stay untracked for
      anything else. (d) `fill` untracked while `stroke` is a channel (`sparkline-draw`,
      `chart-line-draw`) — static today, silent the day an SVG effect animates fill.

- [ ] **`pin` has no way to express "only pin where there is room".** Found 2026-08-26 fixing the
      mobile pin regression. The primitive's params are `distance`, `offset-top`, `spacer` only
      (`src/effects/scroll-mechanics/primitives.ts`), so every author of a sticky sidebar hits the
      same wall and reaches for `position: static !important` on the demo page — which is exactly
      how `ce7a87a` silently disabled `pin-until` below 900px. A responsive gate on the effect is
      the shaped fix. **Check first whether the `above:`/`below:` viewport gates merged in
      `4f18816` already provide the mechanism** — that work landed the same day and may only need
      wiring, not new syntax.

- [ ] **`data-kui-pinned` lies.** `scroll-mechanics/primitives.ts:163` stamps it from progress
      alone, not from whether sticky actually engaged. At 390px `.showcase-media` on `scroll.html`
      reports `pinned="true"` while computing `position: static`. Small, but it is a state contract
      other things read.

- [ ] **`src/core/registry.ts:11-13` docstring is wrong.** Says "~237 names come from 29 primitives".
      Measured off the live Registry maps on 2026-08-26: **262 preset names from 131 primitives**,
      zero orphan primitives. Left unfixed only because another agent held the file at the time.
      Do **not** reuse `docs/catalog.md`'s "33 primitive families" here — that doc defines families
      as a coarser architectural grouping and says outright the registry holds more entries.

- [ ] **`scope:page` — steps 5 through 11 of `docs/plan-scope-page.md`.** Steps 1-4 landed in
      `7184ee6` (plumbing, zero behaviour change). Remaining: `data-kui-fx` placement onto matched
      elements (91 hand-written selectors across 5 files assume the fx element is the animated one —
      an assertable allowlist, only 16 preset names), `--kui-i` indexing over a targeted set,
      JS-rendered effects looping per match, the rescan trigger, diagnostics, and tests. Five owner
      decisions still open in the plan (D2 scroll-spy's two-form default, D3, D4 cloak under
      `scope:page`, D5 rescan, D7 stagger numbering); each was sized to land inside one step so none
      blocks starting.

- [x] **~~`npm run size` fails — CSS is 4.53 kB over an 8 kB cap.~~ STALE, CLOSED 2026-09-08.**
      This entry was itself the stale number it complained about, and it misled a later planning
      session into justifying an architectural split on a size crisis that does not exist.
      **UPDATED AGAIN, same day: the numbers this entry was closed with are themselves now stale.**
      The state as of the end of 2026-09-08, read straight from `.size-limit.json`: the cap was
      raised to **20 KB** brotli (was 14 KB) and the measured stylesheet is **15.17 KB** (was
      ~12.2 KB) — real behavioural growth from today's session (glass, carousel, proximity,
      confetti's pseudo-element move, etc.), not drift in the measurement. **The "presets are the
      weight" theory is also now corrected, not just the numbers**: a follow-up measurement
      (stripping 20 rule blocks and re-measuring) found a preset name costs only **~9 bytes
      brotli**, because `presets.generated.css`'s repetitive rows compress hard — the actual weight
      sits in the hand-written stylesheets (`interaction.css` 14.94 KB brotli, `base.css` 7.27 KB,
      `carousel.css` 5.70 KB). Owner's position is consistent across both corrections: size is not a
      concern unless something becomes unusually large, and prefer parameters over names for *API*
      reasons, not bytes. **Do not use size as a justification without re-reading `.size-limit.json`
      first — it will very likely have moved again.** The per-category CSS export idea from this
      entry's original text is superseded by the corrected reasoning: splitting by category would
      mostly split the cheap, repetitive `presets.generated.css` rows, not the actual weight, which
      lives in a handful of whole hand-written files.

- [ ] **Remove `demo/nav-forms.html`.** Owner's ask, 2026-08-26: "this is just not even stuff we
      should be doing" — the page isn't earning its place in the showcase. Not started; check the
      nav generator (`e6c132b`, see the hide-pages entry below) and `docs.html`'s page list for
      references before deleting so nothing links to a 404.

- [ ] **`noise-overlay` looks like it doesn't animate.** Owner's report, 2026-08-26: "there's no
      animation there." Not reproduced live this session — logged from source only.
      `src/css/ambient.css:182-196` does wire a real `@keyframes kui-noise-overlay` (confirmed
      registered, confirmed bound via `--kui-fx-noise-overlay-iterations: infinite`), so this is
      likely NOT a wiring bug like the FILLS effects below — more likely the motion itself is too
      subtle to read: the keyframe only shifts `background-position` by 1-3px across a 5px tile
      (`ambient.css:198-206`), on a pattern already faded to `30%` opacity. Same shape of problem
      already logged for `starfield`'s dots being "too small to read." Verify by pausing the
      animation at a few keyframe percentages and diffing screenshots pixel-by-pixel before
      assuming it's dead — a rendered eyeball check at normal viewing distance may simply not
      resolve a 3px drift. If it truly never moves, check whether something upstream (a shared
      ambient primitive schema, per today's `gradient-border` split) is silently not applying the
      animation-name to this specific preset.

- [ ] **16 of the entrance/exit matrix's 48 names have zero demo coverage anywhere.** Checked
      2026-08-26 by grepping every demo page's `data-kui` attributes against every name in
      `docs/catalog.md` section A. Every entrance-direction effect is demoed somewhere; **every
      exit-direction effect is not, without exception**: `fade-out`, `fade-out-up`, `fade-out-down`,
      `fade-out-left`, `fade-out-right`, `slide-out-up`, `slide-out-down`, `slide-out-left`,
      `slide-out-right`, `zoom-out`, `pop-out`, `flip-out-x`, `flip-out-y`, `rotate-out`,
      `roll-out`, `blur-out`. All 16 register in the source (not a registry gap — checked
      `src/effects/catalog/*.ts`), just never shown. Same class of problem as "Section E has no
      demo page" below, one tier down in severity since the entrance halves of these same
      primitives are demoed. Not started — logging the gap, not claiming a bug.

- [ ] **Four modern CSS techniques the library doesn't use anywhere yet.** Owner's ask, 2026-08-26.
      Checked against `docs/catalog.md` and every `src/css/*.css` file — none of these appear, not
      even as an implementation detail (only `@property` is already in use, for `beam-border`'s
      angle and `redaction-sweep`'s x-offset, but not as its own documented category). Not started.
      1. **`@starting-style` open/close transitions** — lets a `<dialog>`/popover animate in on
         show AND animate out before removal, without JS delaying the unmount. Good fit for
         modals/toasts/dropdowns.
      2. **`interpolate-size: allow-keywords`** — animates `height: auto` directly, no more
         JS-measures-the-content tricks for accordions/collapsibles.
      3. **CSS anchor positioning (`anchor()`/`position-anchor`)** — a tooltip/popover stays
         attached to its trigger and repositions/flips sides on its own, no JS math.
      4. **`@container` query-driven animation** — trigger off an element's own box size instead of
         the viewport; useful for a card that should only animate once its own container is wide
         enough, independent of scroll position.

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



- [x] **`path-morph` loses every subpath — a real correctness bug the unit suite cannot see.**
      Fixed 2026-08-21. Parse now carries subpath boundaries, segment balancing happens per contour
      instead of globally, and serialisation re-emits `M` per contour plus `Z` for each closed one.
      Unequal contour counts pair in document order, with the shorter shape gaining degenerate
      contours collapsed to their partner's centroid. `npm run test:browser` is **59/59**; 11 unit
      tests added; coverage still 100/100/100/100. Write-up: `docs/live-testing-backlog.md` D7.

- [x] **The `gestures` browser flake was already fixed — this entry was four days stale.** Logged
      2026-08-21 as "1 in ~6, always the `elastic-pull spring-return` check". Root-caused and fixed
      the *next day* by `c572ae7` (2026-08-22, verified an ancestor of HEAD): `burstSample` advanced
      its notion of elapsed time by the wait it *asked for* rather than the real clock, so the
      `read()`/`snap()` round-trip cost pushed every sample later than its label claimed — worse
      under load, which is exactly the 1-in-6 shape. It now anchors to `performance.now()`/`startedAt`
      and reports `maxDriftMs`, and the check compares against `released.tx` (the deterministic
      resisted-drag position) instead of a drifted first sample. Re-measured 2026-08-26: **0 failures
      in 63 runs** — 42 isolated, 15 under deliberate CPU saturation (6 of 8 cores pegged), 5 run
      immediately after `gesture-sweep` to reproduce the tier's alphabetical adjacency — plus a full
      18-suite tier run at 235/235. `gesture-sweep` never shared it: it does not burst-sample, it
      reads final rest position after a fixed settle.
      **Lesson, again: an open todo entry is a claim, not a fact. Check `git log` before dispatching.**

- [ ] **Put the browser suite in the gate — nothing blocks this any more.** The flake above is
      dead and re-measured. Current real numbers (2026-08-26): `npm test` is **1908 tests / 79 files**
      green, and the browser tier is **235/235 across 18 suites** (this entry's "901 tests" and
      "59/59" are both badly stale). The tier takes ~23 seconds, so per-commit is realistic. A gate
      that could not go red on D7 for weeks is not a gate. There is no CI and no husky here — "the
      gate" is a habit — so this means adding a `gate` script, a pre-push hook, or a workflow
      (remote is `github.com/AINSEP/kuinetic`). **Caution:** the `test:browser` npm script is
      `npm run build && …`, and `build` rewrites tracked `demo/tailwind.css`, dropping ~2465 daisyUI
      lines. Any gate must invoke `node scripts/run-browser-tests.mjs` directly, or fix `build` first.

- [ ] **Answer the `horizontal-scroll` nesting question.** The owner asked whether
      `<div class="track-stage"><div class="track-viewport"><div class="track" data-kui="…">` can
      collapse to just the attribute. **Why three is needed today:** `prepareHorizontal` writes
      `translate` and nothing else — no pinning, no clipping, no wrappers. So `.track-stage` is the
      scroll distance, `.track-viewport` is the sticky+clipping window (without the clip a
      `max-content` track gives the document a horizontal scrollbar, which this repo has shipped
      once already), and `.track` is the row that moves. **One is impossible** — sticky needs a
      taller ancestor. **Two may work:** `trackTravel` has a documented branch for a track that
      clips its own children (`scrollWidth - clientWidth > 0`). Untested; needs a browser check.

- [ ] **Give `stacking-cards` a behavioural test.** This entry used to claim the cards never publish
      `--kui-progress` or `data-kui-pinned`. **That was a false alarm** — scrolled in a foreground
      browser on 2026-08-22, cards 1-3 all pin and all publish real progress. The original
      measurement was taken in a *frozen background tab*, which reports exactly `pinned:false,
      progress:0` for everything, which is precisely what the entry described. Nothing was ever
      broken. What is missing is the test that would have said so: a browser-tier check that scrolls
      the deck and asserts each card pins and its progress advances.

- [ ] **A browser suite for replay (D5).** `src/core/instances.ts` has the forward-restart path and
      the unit tests are at 100%, but that is exactly the evidence that failed to catch D5 the first
      time — the JS looked right and the browser disagreed. Nothing in `test/browser/` exercises
      the replay FAB. Until it does, D5 is "believed fixed", not "verified fixed".

- [ ] **Decide what to do about 44 dead exports and 17 dead exported types** (`npm run lint:dead`).
      These are not dead *code* — the code runs — they are `export` keywords on bindings that no
      other module imports and that no published entry point re-exports. `package.json` exposes only
      `.`, `./core`, `./effects` and `./css`, so `SCROLL_PRESETS`, `THREE_D_PRIMITIVES`,
      `LAYOUT_PRESETS`, `NAV_JS_PRESETS` and the rest are unreachable from outside the package.
      Either re-export them deliberately (if consumers should be able to introspect the catalog) or
      drop the keyword. Right now `lint:dead` exits 1 as a matter of course, which trains everyone
      to ignore it.

- [ ] **Index page: a short "get the video off a page and onto your site" note.** Queued behind
      finishing `scroll.html`, and to be written as part of the index-page overhaul rather than
      bolted on before it. Plain-language, for a reader who has never opened a terminal: install
      ffmpeg, point it at a video URL, get back an `.mp4`/`.webm` you can actually ship. Worth
      writing because it is the exact thing this repo's own demo assets are made with, and the
      pages are full of them with no explanation of where they came from.

- [ ] **Visual regression captures — the next session's first job.** Today a single stray `</div>`
      ran two thirds of `scroll.html` full-bleed and gave the document a horizontal scrollbar, and
      nothing in the repo noticed. The owner caught it from a screenshot, two sessions later.
      `test/demo-markup.test.ts` now catches that specific class, but a *rendered* baseline is what
      catches the rest: a set of screenshots per demo page, per theme, diffed against a committed
      baseline. Drive it through Claude in Chrome against the dev server on 8934 — not a
      hand-rolled playwright script, which the owner has objected to before.

- [x] **`horizontal-scroll` is broken and it is a core bug.** Fixed 2026-08-21 — two causes, both
      in shared code: `trackProgress` measuring geometry off an element frozen by an ancestor's
      `position: sticky`, and `windowScrollRoot` never noticing that lazy-loaded media had moved
      the whole page under its cached offsets. Full write-up, numbers and browser verification in
      `docs/live-testing-backlog.md` under D4.

- [ ] **`demo/docs.html` still hand-rolls its TOC tracker** (~line 320 and 556-599): builds nav
      links from `h2`s, runs a scroll+rAF loop on `getBoundingClientRect()`, toggles `.is-active`.
      That is `scroll-spy`'s job. Wrinkle: the headings are parsed from markdown at runtime, so it
      has to go through the JS API after render, not a static attribute.
- [ ] **`demo/text.html:146-152` carries a stale workaround** claiming `marquee` never loops.
      `src/css/text.css:331` sets `--kui-fx-marquee-iterations: infinite` and `compile.ts` does emit
      the longhand. Verify in a browser, then delete the page patch.
- [ ] **Section E has no demo page.** All 17 SVG/icon effects ship and are documented, but nothing
      on any demo page shows them. The three icon toggles especially — they need markup, so seeing
      one working is worth more than the docs table.
- [ ] **Only 7 of section B's 12 effects are demoed** in the matrix section.
      `scroll-progress-bar`, `scroll-progress-bar-y`, `scroll-progress-ring`, and
      `scroll-desaturate` have no card there.


- [ ] **Codex audit 2026-08-23 — two confirmed-live findings, small.** Full write-up in
      `ADS-memory/.local-artifacts/handoff/2026-08-23-session-five.md`; transcript at the
      scratchpad's `audit-out.txt` (findings from line 29,854).
      **(a)** `text-sweep` now falsely rejects valid compositions — `src/effects/catalog/text.ts:68`
      declares the shared primitive as `[background, color]`, but it backs three presets and only
      `gradient-sweep` writes `-webkit-text-fill-color`. `underline-draw, text-outline-fill` is now
      reported as a conflict despite touching disjoint properties. A regression from `b50c16d`.
      **(b)** `demo/interactive.html:91` still paints the show-code chip, so under the new dark pill
      all seven Layout/FLIP chips render permanently *hovered*. `d9d38d5` claimed to have killed
      every competing chip design; it missed this one.

- [ ] **Codex audit — five more, unverified.** (3) `test/entrance-zero-area.test.ts` codifies a
      false layout mechanism: transforms change painted geometry without removing the box from
      flow, so the invariant should be "zero transformed visual/**intersection** area" — which
      would cover `clip-path` and may settle the parked FILLS bug. (4) the two-sided card's
      nested-3D trap is untested and `82ffe08`'s "covered by the suites" claim is false. (5)
      `scripts/check-css-coverage.mjs` has a concrete false pass on `demo/landing-studio.html:155`.
      (6) two of the seven new coverage tests are underasserted. (7) `text-3d-extrude` writes
      `text-shadow` while declaring only rotate/translate — latent, no second writer today.

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

- [ ] **`split-flap` spins out of control on hover, `demo/data-hover.html`.** Owner's report,
      2026-08-23: "spinning like crazy," not one clean flap. Diagnosed from source (could not
      reproduce live this session — the automation tab would not come to real OS focus, so
      `document.hidden` stayed true and animations never ran for capture; needs a fresh session to
      confirm on video). `src/css/interaction.css:264-266` — `[data-kui-fx~='split-flap']:hover {
      animation: kui-split-flap 600ms ease-in-out; }`, and the keyframe (`interaction.css:90-93`)
      is a single-axis `rotateX(0deg → 360deg)` on an `inline-block` with `perspective: 600px` and
      `backface-visibility: hidden`. That combination is a known CSS footgun: partway through the
      rotation the element's rendered face foreshortens toward edge-on, which can move it out of
      the cursor's actual hit-test area — `:hover` drops, the animation has no fill-mode so it
      un-applies, the cursor is now sitting over the (again flat-on) element so `:hover` re-fires,
      and the 600ms keyframe restarts from 0. Net effect: a jittery repeating spin instead of one
      flap-and-settle, for as long as the cursor sits still near the button. Likely fix shape:
      cap it to one iteration regardless of continued hover — `animation-iteration-count: 1` plus
      either gating re-trigger off the element's own animation-end event (JS) or accepting a CSS-
      only compromise (e.g. `animation-fill-mode: forwards` so a re-trigger lands on a no-op
      transform instead of restarting the visible spin). Verify by hovering and holding still for
      several seconds, not just a single mouse-in.

- [ ] **`starfield`'s dots are too small to read, `data-kui="starfield"`.** Owner's ask,
      2026-08-23: "needs to be bigger... bigger dots." `src/css/ambient.css:236-241` — five
      `radial-gradient` dots, sized `1px`/`1.5px` each, tiled on a `220px 220px` repeat
      (`ambient.css:242`). At that size they read as noise rather than stars on anything but a
      very close look. Bump the dot radii (and probably the tile size and/or dot count/spread to
      match) — not started, needs an actual visual pass to pick numbers that read well rather than
      guessing one value in isolation.

- [ ] **Make it immediately obvious kUInetic is a CSS animation library driven by HTML
      attributes.** Owner's ask, 2026-08-23: this is one of the standard questions any visitor to
      a new site asks in the first few seconds — what is this, how do I use it — and right now
      it's not answered fast enough. The hero `<h1>` ("Animate anything with one HTML attribute")
      names "HTML attribute" but never says CSS, animation library, or how little code is
      involved; the meta description does say it ("Declarative web animation compiled from HTML
      attributes into real CSS keyframes...") but that's invisible to an actual visitor, only to
      search engines and link previews. Needs a design pass on the above-the-fold copy/hero (kicker,
      h1, subhead, or a new one-liner) so "CSS animation library, authored via HTML attributes" is
      unambiguous on first look, not something you piece together from the playground below it.

- [x] **`.size-limit.json`'s CSS budget is stale — real size is over the stated cap. SUPERSEDED,
      closed 2026-09-08.** This is the "stale entry lower in this file" the 2026-09-08 corrections
      elsewhere point at. Its numbers (8 KB cap era, ~11.2 KB measured) describe a state from
      2026-08-24 that no longer exists at all: the cap has since been raised twice (to 14 KB, then
      to 20 KB as of 2026-09-08) and the measured size has moved with it (to ~12.2 KB, then to
      15.17 KB). `.size-limit.json` itself now carries its own current-as-of measurement inline —
      read it directly rather than trusting any number written down in this file, including the
      ones in the 2026-09-08 entries above, which will themselves go stale the same way this one
      did.

- [ ] **Find better hero videos.** The owner does not think the current ones make sense — they
      should be **about UI and animation**, which the present clips are not. Sourcing job before
      it is a code job. Prior art worth reading first: static ffmpeg lives in `~/.local/bin`
      (never `brew install ffmpeg` on Ventura), the repo's encode settings, and the finding that a
      100vh pin with a true-aspect video in a side column cannot avoid dead space — use full-bleed
      cover with overlay text.


## Demo coverage for the six GSAP-parity features

Deferred deliberately 2026-08-26 — owner wants the library work closed out first. Measured against
`integration/gsap-parity`: `tween` has 15 hits across `demo/*.html`, the other four have **zero**.

- [ ] **`motion-path` / `follow-path` has no demo card anywhere.** Task D shipped the primitive plus
      named presets and nothing to look at. CSS-native (`offset-path`), so a card is cheap.
- [ ] **The open activation list has no demo.** `data-kui-on="pointerleave"` and the enter/exit pair
      syntax are the highest-value thing task E shipped and are invisible. A hover card that animates
      out on leave is the obvious one.
- [ ] **Sequencing `at:` has no demo.** `data-kui="fade-up 600ms, blur-in 400ms at:-200ms"` is the
      headline of task C and appears on no page.
- [ ] **Lifecycle events have no demo.** `kui:finish` / `kui:reverse-finish` from task A. Harder to
      show visually — maybe a card that chains a second animation off the first's completion, which
      is the actual use case.

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

- [x] **Responsive / breakpoint variants — SHIPPED, and this entry called it "the biggest
      remaining gap" for a day after it landed.** Went the parameter route, as predicted.
      `above:`/`below:` merged in `4f18816`; `wide:`/`narrow:` (container queries) landed
      2026-08-27. All four are one table now — `GATE_DIRECTIONS` in `src/core/parse.ts:358` —
      with `gatesOverlap` requiring agreement on both axes. Verified in source 2026-08-27.

- [x] **Cross-element triggering — SHIPPED 2026-08-28** (`8d2fec3`, merged `4c4393a`). "When the
      form submits, animate the badge." `data-kui-on` gets an optional `from:` refinement that
      binds the listener to a foreign element instead of the animating one:
      `data-kui-on="submit from:#signup"`. Lives only in the longhand grammar (not hoisted via
      `HOISTS`, since `from:` already means something different as a per-effect stagger param —
      same collision `parse.ts` documents for `order:`). One native listener is shared per
      `(source element, event type)` regardless of how many animated elements watch it. A missing
      source warns once at install time rather than silently binding nothing or waiting forever
      for a late-arriving node. New `src/core/event-sources.ts`; changes to `parse.ts`,
      `element-config.ts`, `activation.ts`, `animator.ts`. Browser-verified live (happy path and
      the missing-source warning both confirmed with real before/after state and opacity reads).
      Built by Codex (xhigh reasoning) acting as the AI-Dev-Shop Programmer persona.

- [x] **Stagger ordering — SHIPPED.** `StaggerFrom` is `'start' | 'end' | 'center' | 'edges' |
      'random' | number` (`src/core/stagger.ts:27`), spelled `order:` on the attribute and
      `from:` on the `data-kui-stagger` longhand. As predicted, it computes a different index and
      the CSS `calc()` was left alone. Verified in source 2026-08-27.

- [x] **Universal `repeat:` / yoyo — SHIPPED 2026-08-27.** Spelled `repeat:<count|infinite>` and
      `yoyo:<true|false>`, both **per-segment** (lifted onto `EffectSpec` beside `at:` and the
      gate, in the new `src/core/repeat.ts`), not hoisted element-wide: `animation-iteration-count`
      is written as a per-*track* value list precisely so a composed one-shot effect cannot inherit
      its neighbour's loop, and an element-scoped key would have undone that in the grammar.
      `direction:` was **not** reusable after all — it is a live parameter on the split-text
      primitive (`values: fade|up|down|mask`, `effects/catalog/text.ts`) and a lifted key never
      reaches `spec.params`, so `split-chars direction:up` would have become unwritable. Same
      collision `parse.ts` documents for `from:` → `order:`.
      `repeat:N` is N *total* plays (1:1 with CSS, not GSAP's "N extra"); `repeat:0` warns.
      Refused with a named warning, modifier dropped and effect kept: JS-rendered primitives
      (no iteration count exists to set), and `repeat:infinite` under `view`/`scroll` (the active
      duration collapses to zero and the element freezes at its end state) or `pin` (the scrub head
      spans one playthrough). A *finite* repeat under `pin` widens that head to `N x duration` so
      every play is reachable. `at:after` measures the whole playback; `at:after` an infinite
      repeat is refused the way an unreadable duration already was.
      Task F's classification turned out not to be the right axis — it answers "does this effect
      have a start moment" (delay), where repeat asks "does it compile an
      `animation-iteration-count"`, which is exactly `renderer === 'css-keyframes'`.
      **Not verified in a browser:** the exact native behaviour of `animation-iteration-count:
      infinite` under `view()`/`scroll()` is reasoned from the spec, not measured.

- [x] **Author-tunable `spring(bounce:0.5)` — SHIPPED 2026-08-27** (`70f7567`, merged `d4b3449`).
      `src/core/spring.ts`'s physics solver is now reachable from the declarative `ease:` grammar;
      before this, CSS effects got one hardcoded curve while JS effects had real physics. One
      resolver now serves both spellings. Deliberately **no** tunable `bounce()` — reasoning
      recorded in `ec74b7c`.

- [x] **Four GSAP capability gaps — SHIPPED 2026-08-27** (merged `85b8884`). Sourced from
      `docs/motion-research-gsap-motiondev.md`'s capability map, which is a map of *mechanisms*, not
      a style guide — the owner does not want motion.dev/GSAP animations visually copied.
      (a) `spread:600ms` (`c42bda4`) budgets a stagger by total duration instead of per-item gap, so
      the group takes the same time however many children it has.
      (b) `cols:`/`along:`/`order:0.5/0.5` (`a347b3c`) rank a group by distance through its grid —
      2D stagger, not just document order.
      (c) `actions:play/pause/resume/none` (`ffc02cb`, warning fix `1dfd984`) exposes all four
      scroll crossings, not just two.
      (d) Multi-waypoint `tween x:'0,100,40'` (`1371bc8`) keyframes a property through N states in
      pure CSS, no JS.

- [x] **Two real library bugs found and fixed after that merge, both browser-verified.**
      `e8fff2a` — three JS-driven layout primitives handed a kUInetic easing *name* straight to
      native `Element.animate()`, which has no cascade to resolve `var(--kui-ease-back-out, …)`.
      Every named curve was a hard `TypeError`, so the effect silently did not run. `waapiEasingValue()`
      now reads `--kui-ease-*` off the element at animate time (open vocabulary — a lookup table
      would go stale).
      `c9bc1e0` + `18e2f58` + `265b378` — `actions:`'s crossing detection used one scalar
      IntersectionObserver threshold plus a "which side was I last on" flag. A single-frame scroll
      jump (anchor click, `scrollTo({behavior:'instant'})`, scroll restoration) can deliver **zero**
      observer callbacks, and the next real crossing was then classified from stale memory — a
      reader scrolling backward got `enter` where `enter-back` was authored. New shared direction
      tracker `src/core/travel.ts` (one listener for the whole binder) classifies by actual
      direction of travel. Two other approaches were measured and rejected first; log in
      `ADS-memory/.local-artifacts/fix-crossing-misclassification-notes.md`.

- [ ] **Arbitrary scroll ranges — HALF BUILT, and this entry overstated the gap.** A free-form
      range does ship, on the longhand: `data-kui-timeline="view entry 0% cover 35%"` works today
      and is used on `demo/scroll.html`, parsed at `src/core/element-config.ts:67` and written to
      `animation-range` by `style-plan.ts:159`. What's missing is an **inline** spelling — there
      is no `range:` key in `src/core/parse.ts`, so expressing a range needs the second attribute,
      which cuts against the owner's standing preference for fewer attributes. The design work
      left is a `range:` parameter, not the mapping. Check what task C concluded about `at:` under
      a scroll timeline (§9.4) first. Re-scoped 2026-08-27.

- [ ] **`data-kui="func:nameOfFunc"` — task A has landed, so this is now decidable.** Owner asked
      for it 2026-08-26. Lifecycle `CustomEvent`s shipped — `KUI_EVENT` and `emitLifecycle` in
      `src/core/control.ts`, emitted from `animator.ts:588/674/861` (verified 2026-08-27). They
      cover the same need better:
      `addEventListener('kui:complete', fn)` works with bundlers and ES modules, allows several
      listeners, and needs no global. `func:` requires a `window[name]` lookup — the `onclick=""`
      pattern the platform spent fifteen years walking away from — and becomes "call any function
      by name" if that value ever originates in a CMS field. Not a refusal: look at A's actual
      event names first, then decide whether `func:` still earns its place as sugar for no-build
      sites, which are a real part of this library's audience.

- [ ] **Canvas / WebGL — deliberately NOT doing this.** Recorded so it stops getting re-litigated.
      The entire model is attributes on elements, and canvas has no elements to carry them. If it
      is ever wanted it belongs in a separate opt-in plugin, the way GSAP keeps `PixiPlugin`
      (2.9KB gz) and `EaselPlugin` (2.2KB gz) out of core — never in the main bundle.

---

## Tier 3 — parked, low priority

Owner parked these on 2026-08-23: "not interested in spending time on it right now."
Do not start any of them without asking first. Each entry carries everything needed to pick it
up cold, so nobody has to re-derive the diagnosis.

- [x] **Three FILLS effects were permanently dead — fixed 2026-08-26.** `heart-fill`,
      `bookmark-fill` and `chart-area-fill` never animated on scroll-in and never recovered. The
      mechanism was finally measured in a browser 2x2 rather than reasoned about, and **the standing
      theory was wrong in both directions**: it is not `clip-path`, and it is not SVG. It is the two
      together, and only when the clip leaves **zero painted area**.

      | target | zero-area clip | IntersectionObserver |
      |---|---|---|
      | HTML `<div>` | yes | fires, ratio 0 |
      | SVG path filling its own `<svg>` | yes | fires, ratio 0 |
      | **SVG path inset within its `<svg>`** | **yes** | **never fires at all** |

      So `on:enter` never triggered and the effect waited forever. A *partial* clip that still
      paints something intersects normally in every cell, and `circle(0)` behaves the same as
      `inset(100% 0 0 0)` — this is not specific to `inset()`.

      **`star-rating-fill` was never affected.** This entry used to list it as sharing the
      mechanism. It clips a `<span>`, so it is the HTML row of that table — do not "fix" it.

      **The near-miss worth remembering:** the first 2x2 drew its SVG probes as paths filling their
      `<svg>` viewport and came back completely clean. A full-bleed synthetic path does not
      reproduce this. Every real FILLS target on the demo pages is an inset path, and one wrong
      fixture would have shipped a third confident-wrong mechanism.

      Fixed by extending the `dd1f770` ready-gate to the clip channel (`src/css/svg.css:113-149`):
      `clip-path: none !important` to beat the paused keyframe from the author origin, plus a
      deliberately non-important `opacity: 0`, without which un-clipping parks the finished shape in
      view for the whole wait. `test/entrance-zero-area.test.ts` is widened to the clip channel **for
      SVG targets only** — a blanket widening false-positives on `star-rating-fill` and on every
      partial clip. Permanent browser gate: `test/browser/fills-clip-path-io.test.mjs`, 36/36.

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
- [ ] **Update the docs colour scheme** — grey background out, white/black + black/yellow in.
- [ ] **Adjust card layouts** — wider cards, "Show code" directly beneath the `data-kui=*` line.
- [x] **Add a "Show Code" feature** — `demo/show-code.js`, mounted across the demo pages.

---

## Done — 2026-08-21

- [x] **All 15 missing SVG & icon presets (catalog section E).** `draw-stroke`, `draw-signature`,
      `draw-underline`, `checkmark-draw`, `cross-draw`, `chart-line-draw`, `gradient-stroke`,
      `heart-fill`, `bookmark-fill`, `chart-area-fill`, `chart-bar-grow`, `logo-build`,
      `hamburger-to-x`, `play-to-pause`, `plus-to-minus`. All CSS. Verified rendering in Chrome,
      not from source comments.
- [x] **`scroll-skew`** (section B), plus a demo card for it on `scroll.html`.
- [x] **`flip-card`** (section N) — a genuinely two-sided card that stays on the face you turned it
      to, which `card-flip-y` is not: that one is a one-shot entrance with nothing on the back. CSS
      transition keyed off `aria-pressed` on the control inside the card, read with `:has()`. The
      hero on `scroll.html` uses it to hold two YouTube talks in one slot.
- [x] **`reveal-repeat` deleted from the docs.** It was removed from the library on purpose.
- [x] **`test/catalog-docs.test.ts`** — diffs `docs/catalog.md` against `createRegistry().names()`
      in both directions, checks the planned names still carry their dagger and are still genuinely
      unregistered, and checks the totals table. The catalog cannot drift again without a red test.
- [x] **Three shipped-but-undocumented effects written down** — `beam-border-auto`,
      `scroll-progress`, `scroll-progress-bar-y`.
- [x] **`glass-ui-concepts.jpg` is no longer orphaned** — it is the `scroll-skew` demo.
- [x] **Everything committed.** Four sessions of work had been sitting uncommitted.
- [x] **`coders-project-dashboard.jpg` presentation canvas cropped** (736x553 -> 662x416).
- [x] **The Crextio/"Nixtio" dashboard replaced** with the MODERA spatial storefront shot, in both
      places it appeared.
- [x] **The hero showcase section trimmed** — four paragraphs cut to four numbered claims, with
      `text-reveal-up` on the heading, `fade-up timeline:view` per claim, and the pinned image
      breathing on `parallax-scale timeline:pin`.
