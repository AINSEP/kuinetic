# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## Open

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

- [ ] **Log the `stacking-cards` progress gap.** The cards never publish `--kui-progress` or
      `data-kui-pinned`. Confirmed **pre-existing** by `git stash`-ing the working tree and
      re-measuring against HEAD, so it is not from this session's offset change. The sticky stack
      itself works; only the flag is missing, and nothing on the page consumes it. Deserves a
      D-entry in `docs/live-testing-backlog.md` rather than living only in a handoff.

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
