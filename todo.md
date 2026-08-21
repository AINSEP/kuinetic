# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## Open

- [ ] **`path-morph` loses every subpath — a real correctness bug the unit suite cannot see.**
      A square with a square hole morphs into one open outline: two `M` become one, two `Z` become
      none. Any `blob-morph`/`icon-morph` on a shape with a hole or a counter renders wrong.
      `test/browser/svg-morph-subpath.test.mjs` has been failing this whole time and nobody knew,
      because `npm run test:browser` is not part of the gate. Write-up: `docs/live-testing-backlog.md`
      D7.

- [ ] **Put the browser suite in the gate.** `npm test` is 877 tests at 100% coverage and green;
      `npm run test:browser` is 57/59 and has been red on D7. A gate that cannot go red on a real
      bug is not a gate. Decide whether it runs on every commit or on a pre-push/CI hook — it needs
      a Chromium and takes about a minute, so per-commit may be the wrong cadence.

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
