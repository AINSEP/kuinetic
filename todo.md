# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## Open

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

- [ ] **`npm run size` fails — CSS is 4.53 kB over an 8 kB cap.** Confirmed 2026-08-26. Decide
      whether to raise the budget or trim; the number has been stale for long enough that the gate
      trains people to ignore it, which is the disease the gate is meant to cure.

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

- [ ] **`.size-limit.json`'s CSS budget is stale — real size is over the stated cap.** Found
      2026-08-24 by a design subagent sourcing real numbers, confirmed independently the same
      session. `.size-limit.json` claims `dist/kuinetic.css` is "current: ~7.6 KB" against an
      `"limit": "8 KB"`. Direct brotli measurement of `demo/kuinetic.css` (byte-identical build
      output to `dist/kuinetic.css`) is **11,233 bytes** — 40% over the stated number, and over the
      8 KB cap outright. `npm run size` will very likely fail if run right now. Either the CSS
      genuinely grew past budget (in which case decide whether to raise the cap or trim), or the
      comment is just stale and never got updated after a past growth — check `git log -p --
      .size-limit.json` to see when "~7.6 KB" was last true, then fix the number or the budget.

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

- [ ] **Cross-element triggering — STILL OPEN, confirmed.** "When the form submits, animate the
      badge." The element that fires the event is not the element that animates, so an attribute
      on the animating element cannot express it on its own. There is no `trigger:` key in
      `src/core/parse.ts` (checked 2026-08-27). Explicitly ruled out of scope for task E (§7.5 of
      the outline), which was asked to leave a clean seam for it. Needs a selector-valued
      parameter — follow the `target:` convention, and note `target:` is **per-primitive** (only 6
      of 128 declare it) while an activation concern like this probably wants to be hoisted
      element-wide like `on:`. Decide that deliberately. Read E's PR for where it left the seam.
      Owner ranked this #2, 2026-08-27.

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
