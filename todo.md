# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## Open

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

- [ ] **Fix the `gestures` browser flake — it blocks the gate below.** `test/browser/gestures.test.mjs`
      failed 1 run in ~6 and passed the other 5, always the same 2 checks
      (`elastic-pull spring-return moves smoothly and meaningfully back to the origin`). Wiring a
      flaky suite into the gate teaches everyone to ignore the gate, which is the exact disease the
      gate is meant to cure, so this comes first.

- [ ] **Put the browser suite in the gate.** `npm test` is 901 tests at 100% coverage and green;
      `npm run test:browser` is 59/59. Measured: the browser suite takes **23 seconds**, not the
      minute this entry used to assume, so per-commit is realistic. A gate that could not go red on
      D7 for weeks is not a gate. There is no CI and no husky here — "the gate" is a habit — so
      this means adding a `gate` script, a pre-push hook, or a workflow (remote is
      `github.com/AINSEP/kuinetic`). Do the flake above first.

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

Written 2026-08-26, after measuring kUInetic against GSAP 3.15 plugin by plugin. Six tasks (A–F)
were queued as overnight cloud agents and are specified in
`docs/implementation-outline-gsap-parity.md`; these are what remains once those land, ranked by how
often an author would actually hit them.

- [ ] **Responsive / breakpoint variants — the biggest remaining gap.** There is no way to say
      "fade-up on desktop, nothing on mobile." `matchMedia` appears exactly once in the whole
      source (`src/core/capabilities.ts:44`) and only for `prefers-reduced-motion`. GSAP's
      equivalent is `gsap.matchMedia()`, which also handles teardown when a breakpoint changes.
      Settle the design question first: an attribute (`data-kui-md=`, i.e. more attributes, which
      the owner has asked to avoid) or a parameter inside the existing `data-kui` — probably the
      latter, given the `target:`/`at:` precedent. Best done after E and C land so it can borrow
      whatever syntax they settled on.

- [ ] **Cross-element triggering.** "When the form submits, animate the badge." The element that
      fires the event is not the element that animates, so an attribute on the animating element
      cannot express it on its own. Explicitly ruled out of scope for task E (§7.5 of the
      outline), which was asked to leave a clean seam for it. Needs a selector-valued parameter —
      follow the `target:` convention. Read E's PR for where it left the seam.

- [ ] **Stagger ordering.** `src/core/stagger.ts` assigns a linear index and nothing else. GSAP's
      stagger takes `from: "center" | "edges" | "random" | <index>`. Cheap: the arithmetic already
      lives in CSS `calc()` off `--kui-i` and `--kui-stagger-count`, so this is mostly a matter of
      computing a different index. Read the `--kui-i` leak comment in that file before starting.

- [ ] **Universal `repeat:` / yoyo.** `loop` and `direction` exist as parameters on *some*
      primitives; there is no universal repeat. `compile.ts:294` already writes
      `animation-iteration-count` per track off `--kui-fx-<preset>-iterations`, so the plumbing
      exists — what's missing is an author-facing knob plus a decision on whether it belongs on
      every primitive or only where looping is meaningful. That overlaps task F's one-shot vs
      continuous classification; read F's PR table first.

- [ ] **Arbitrary scroll ranges.** ScrollTrigger takes `start: "top 80%"`, `end: "bottom 20%"`.
      kUInetic ships named scroll effects instead, with no free-form range. Needs a spelling for a
      range pair and a mapping onto `animation-range`. Check what task C concluded about `at:`
      under a scroll timeline (§9.4) before designing.

- [ ] **`data-kui="func:nameOfFunc"` — decide after task A lands, not before.** Owner asked for it
      2026-08-26. Task A ships lifecycle `CustomEvent`s, which cover the same need better:
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

- [ ] **PARKED 2026-08-23 — do not start without asking.** **Three FILLS effects are permanently
      dead: `heart-fill`, `bookmark-fill`, `chart-area-fill`.** They never animate on scroll-in on
      `demo/icons-transitions.html` and never recover, not even via the replay FAB. This is a
      **library** bug, not a page bug — the three ship in the public catalog, so hiding the demo
      page hides the symptom, not the defect. Established against source: all three rest at a
      collapsed `clip-path` (`src/css/svg.css:98-111`) and **none has a `[data-kui-state='ready']`
      gate**, unlike the six fixed in `dd1f770` — `git show dd1f770` is the reference pattern.
      `chart-bar-grow`, the fourth in the same row, works; it uses `scale` and was one of the six.
      **The mechanism is NOT settled — measure before explaining.** A prior agent saw a bare
      IntersectionObserver on `heart-fill`'s path return `intersectionRect {0,0,0,0}` with a correct
      `boundingClientRect` and blamed `clip-path`, but the three broken targets are SVG `<path>`
      elements and the working one is a `<div>`, and that confound was never controlled for. This
      repo has shipped a confident-wrong mechanism twice. Run the 2x2 first: collapsed `clip-path`
      on a plain `<div>`, and an uncollapsed `clip-path` on an SVG `<path>`. Then fix, then
      `npm run build` (`generate:css` alone is not enough — `demo/kuinetic.js` is a build artifact).
      Also check `star-rating-fill` on `data-hover.html`, documented as sharing the mechanism and
      never checked. If `clip-path` **is** the cause, `test/entrance-zero-area.test.ts:175` wrongly
      excludes it and would have caught all three — widen it.

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
