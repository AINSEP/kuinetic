# kUInetic — task list

Add anything you want here. Format is just checkboxes; an agent picks up whatever is unchecked.

**Ground rule for this repo:** if a demo page hand-writes an animation, that is a bug — the
library should own it. Never call something "not the library's job" without grepping
`src/effects` for an equivalent first. CSS-first: new JS primitives need sign-off.

---

## A. The 15 missing SVG & icon presets (catalog section E)

These names are documented in `docs/catalog.md` and resolve to nothing. Someone writes
`data-kui="checkmark-draw"` and gets silence. All 15 are CSS-only.

**Stroke draws** — `stroke-dashoffset` from the path's own length to zero. The library already
does exactly this for `underline-draw`, `sparkline-draw`, and `progress-ring`, so this is
copy-the-pattern work. Author sets `--kui-path-length` to their real geometry; the library never
measures SVG.

- [ ] `draw-stroke`
- [ ] `draw-signature`
- [ ] `draw-underline`
- [ ] `checkmark-draw`
- [ ] `cross-draw`
- [ ] `chart-line-draw`
- [ ] `gradient-stroke`

**Fills** — a clip-path wipe. Same shape as the shipped `star-rating-fill`.

- [ ] `heart-fill`
- [ ] `bookmark-fill`
- [ ] `chart-area-fill`
- [ ] `chart-bar-grow` (a `scaleY` off `transform-origin: bottom`)

**Icon toggles** — these are *state*, not one-shot animations, so they follow the native-state
group in `src/css/forms.css`: a CSS transition scoped under `[data-kui-fx~='name']`, driven by an
attribute the author already has to set for accessibility (`aria-expanded` / `aria-pressed`). No
JS. Each needs a documented markup shape (three bars, two spans…).

- [ ] `hamburger-to-x`
- [ ] `play-to-pause`
- [ ] `plus-to-minus`

**Decide or drop**

- [ ] `logo-build` — vague. Either define it (staggered part-by-part assembly) or delete the name.

## B. The 1 missing scroll preset (catalog section B)

- [ ] `scroll-skew` — a skew on a scroll timeline. CSS-easy.
- [ ] Delete `reveal-repeat` from `docs/catalog.md`. **Do not implement it.** `core.ts` says it was
      removed on purpose: byte-identical to `reveal-once` once the binder stopped re-observing
      after first entry.

## C. Highest-leverage test in the repo

- [ ] Add a test that diffs the name lists in `docs/catalog.md` against `createRegistry().names()`.
      The 22-phantom-preset problem was only findable with a throwaway script. This makes it
      impossible to drift again.

## D. Library-ownership leftovers

- [ ] `demo/docs.html` still hand-rolls a TOC "which heading am I reading" tracker (~line 320 and
      556-599): builds nav links from `h2`s, runs a scroll+rAF loop on `getBoundingClientRect()`,
      toggles `.is-active`. That is `scroll-spy`'s job. Wrinkle: headings are parsed from markdown
      at runtime, so it must go through the JS API after render, not a static attribute.
- [ ] `demo/text.html:146-152` carries a workaround comment claiming `marquee` never loops. That is
      stale — `src/css/text.css:331` sets `--kui-fx-marquee-iterations: infinite` and `compile.ts`
      does emit the longhand. Verify in a browser, then delete the page patch.

## E. Housekeeping

- [ ] `demo/assets/webdesign/glass-ui-concepts.jpg` is orphaned — zero references in any demo page.
      Delete or wire it in.

## F. Needs JavaScript — do not start without asking

Four documented names cannot be done in CSS. The stated position is *"the whole point of this
library is to not have JavaScript."* Noted for accuracy: the library **does** already ship JS
primitives (drag, cursor, tilt, all of scroll-mechanics), so the principle is CSS-**first**, not
CSS-only — but a new JS primitive is a decision, not a default.

- [ ] `reveal-direction-aware` — must know scroll direction.
- [ ] `page-morph` — needs the View Transitions API.
- [ ] `depth-layers-pointer` — pointer-driven.
- [ ] `perspective-grid` — pointer-driven.

---

## Carried over from the original audit list (status unverified)

- [ ] **Audit CSS animations** — mistakes where labelling is wrong or the animation does not run.
      Partly addressed by the catalog-honesty pass and the preset-defaults fix, not finished.
- [x] **Add a "Show Code" feature** — `demo/show-code.js`, mounted across the demo pages.
- [ ] **Improve the tags under the named effects in `index.html`** — replace with better, more
      engaging animations.
- [ ] **Update the docs colour scheme** — grey background out, white/black + black/yellow in.
- [ ] **Adjust card layouts** — wider cards, "Show code" directly beneath the `data-kui=*` line.
