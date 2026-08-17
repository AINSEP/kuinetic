# Handoff: kUInetic showcase redesign (Open Design session)

Generated: 2026-08-13
Source: Claude (Open Design agent), working in this OD project, mirrored live into the real repo
Target: whichever agent (Open Design or otherwise) picks this work up next

This is a **separate thread from `docs/HANDOFF.md`** in the kUInetic repo — that one covers the
core library/catalog engineering work (TypeScript, tests, `docs/catalog.md` and `docs/design.md`
rewrites). This file covers the **demo/showcase site visual redesign**, done through Open Design
across one long session. Don't merge them; they're different workstreams.

## Post-migration fix round (same session, after the 6-page migration below)

Owner reported bugs after reviewing the 6 migrated pages live. Fixes applied:

- **Nav: "Coming soon" under Designs.** All 11 pages' Designs dropdown replaced the
  `landing-minimal.html`/`landing-studio.html` links with a single `Coming soon` span (those two
  pages are still on the old system and weren't in scope for this pass) — `data-nav-pages` trimmed
  to `index.html` only. Mechanical find/replace across every page's own header copy.
- **Grey card backgrounds (real design complaint, not a bug, but recorded here since it touched
  4 files).** Non-photo demo cards were filling with `var(--surface)` (`#f6f6f4` light mode), which
  reads as unwanted grey once nothing else covers it. Fixed on `text.html`, `data-hover.html`,
  `ambient-feedback.html`, `nav-forms.html` with an alternating two-tone convention: odd cards
  `background: var(--accent); color: var(--accent-ink)` (lime/near-black, theme-invariant), even
  cards `background: var(--bg); color: var(--fg); border-color: var(--border)` (auto-adapts
  light/dark). Sections whose primitives already use `--accent` as their own signal color (form
  inputs, rings/gauges/bars in data-hover.html) were deliberately left uniform "paper" instead of
  alternating, to avoid washing out the signal color against an accent card fill. Photo-covered
  cards were left alone everywhere.
- **`text.html`: caption-eating bug (real root cause of "no code to show" + "animations aren't
  working").** 14 cards (split-text/motion, reveals, continuous motion, typing, resolve,
  word-cycler primitives) had `data-kui="..."` on the `<figure>` instead of the inner `.stage`
  element. Those primitives' JS does DOM surgery (`installSplitLayers()`, `prepareWordCycler()`)
  directly on the element `data-kui` is attached to — since that was the whole `<figure>`, firing
  the effect wiped the sibling `<figcaption>` (and for word-cycler, the whole `.stage-wrap`).
  Fixed by moving `data-kui` down onto `.stage` for those 14 cards; the 12 pure-CSS primitives
  don't do DOM surgery and were left on the figure. All 26 catalog-D primitives reverified live.
- **`scroll.html`: hero image swap.** `scenic_norway_fjord.jpg` (flat, hazy, low-drama) replaced
  with `scenic_volcano_eruption.jpg` (Volcán de Fuego erupting at night, lava + star field) —
  Pexels/Clive Kim, free license. Old file left on disk, just unreferenced from the hero.
- **`ambient-feedback.html`: real kuinetic.js library bug found, NOT yet fixed upstream.**
  `AMBIENT_PRESETS`' per-preset `params.duration`/`params.ease` (e.g. `noise-overlay`'s
  `650ms steps(6)`, `scanline`'s `3.5s linear`) never get threaded into the generated
  `animation-duration`/`animation-timing-function` — every ambient preset silently falls back to a
  generic `600ms ease-out` instead. Visually: noise-overlay's grain smoothed into a barely-visible
  wash, scanline ran ~6x too fast. **Worked around at the page level only** (inline
  `--kui-ambient-gradient-duration`/`--kui-ambient-gradient-ease` custom properties re-asserting
  each preset's documented values on `noise-overlay`/`scanline`'s elements in `ambient-feedback.html`)
  — did not touch `kuinetic.js`/`kuinetic.css`, since that's shared library source. **Any other page
  or future use of an `AMBIENT_PRESETS` entry with a non-default `duration`/`ease` will hit the same
  silent bug** until it's fixed in the engine itself — worth a real fix in `kuinetic.js`'s plan-building
  step (search `AMBIENT_PRESETS` and how `params` is/isn't read when building the inline animation
  style), not another page-level patch.

## Where things live

- **Source of truth I edit**: this OD project — `index.html`, `reveals.html`, `system.css`,
  `docs.html`, `style.css`, `assets/*` at the project root.
- **Sync target (the real repo)**: `/Users/la/Programming/kUInetic/`. The owner's standing
  instruction (confirmed explicitly, saved to memory) is: **after any edit to a project file,
  copy it into the kUInetic repo automatically, without being asked.** Do this every turn that
  touches a file, not just at checkpoints.
- **Owner's live dev server**: `http://localhost:8934` (`npm run dev` in the kUInetic repo, via
  `scripts/dev-server.mjs`). Playwright MCP tools (`browser_navigate`, `browser_evaluate`,
  `browser_take_screenshot`, `browser_console_messages`) can reach this directly — this was the
  single most useful diagnostic tool all session. When the owner reports something that "looks
  fine in Open Design's preview but broken on my localhost" (or vice versa), go straight to
  localhost with Playwright rather than guessing from source.

## Two non-obvious path gotchas in the kUInetic repo (cost real debugging time — don't relearn)

1. **There are TWO `assets/` folders that look interchangeable but aren't.**
   `kUInetic/demo/assets/` is what `demo/*.html` actually references at runtime. `kUInetic/assets/`
   (repo root, no `demo/`) is a separate folder the owner sometimes drops files into directly —
   several premium product photos (`gucci_nail_polish.jpg`, `pink-mc.jpg`, `tech-helmet.jpg`,
   `yellow-mc.png`, `earpods.jpg`) were found there mid-session, not in `demo/assets/`. Some use
   hyphens there vs. underscores in `demo/assets/` (`pink-mc.jpg` → copied in as `pink_mc.jpg`).
   **Always check both locations** before assuming an asset is missing or before adding a new one
   — and when you copy a new asset in, it needs to land in `demo/assets/` (with underscore naming
   to match what HTML there expects) even if the owner said it's "in the assets folder" without
   specifying which one.

2. **`scripts/dev-server.mjs` routes `/docs/*` requests to the REPO-ROOT `docs/` folder, not
   `demo/docs/`.** `demo/docs.html` fetches `./docs/getting-started.md` etc. at runtime, and the
   server rewrites any `/docs/` path to `kUInetic/docs/`, bypassing `kUInetic/demo/docs/` entirely.
   This caused a real 404 on `getting-started.md` for a while — I'd been faithfully syncing to
   `demo/docs/getting-started.md`, which the server never actually serves. If a docs page 404s on
   localhost, check `kUInetic/docs/` (repo root) first.

## What the visual system is

Linear-style "paper-white / near-black / acid-lime" system, extracted from an earlier full rebuild
of `index.html`:
- `--bg`/`--surface`/`--fg`/`--muted`/`--border`/`--accent` (`#e4f222` acid-lime)/`--accent-ink`
  (near-black) tokens, light + dark via `:root[data-theme]`.
- Pill-shaped floating sticky header (`.site-header`), `.kui-nav-dropdown` groups, mobile hamburger
  + backdrop, theme toggle with inline SVG sun/moon swap.
- `system.css` is this system extracted into a **shared, reusable stylesheet** so other pages don't
  need to duplicate the ~250-line inline `<style>` block `index.html` and `docs.html` still each
  carry independently (they were built before `system.css` existed and haven't been refactored
  onto it — that's optional cleanup, not a bug).

## Page migration status — this is the main unfinished thread

All 7 "CSS Animations" pages are now on the new system as of this session. Only the two "Designs" pages (`landing-minimal.html`, `landing-studio.html`) remain old — the owner didn't ask for those in this pass, only the CSS Animations set.

| Page | System | Notes |
|---|---|---|
| `index.html` | New (own inline copy) | Original full rebuild. Not yet refactored to link `system.css` instead of duplicating it — works fine as-is, just not DRY. |
| `docs.html` | New (own inline copy) | Same as above. Has its own doc-viewer-specific CSS (`.doc-layout`, `.doc-body`, etc.) on top. |
| `reveals.html` | New (links `system.css`) | Fully rebuilt an earlier session — see "reveals.html" section below. |
| `scroll.html` | New (links `system.css`) | Rebuilt this session. Catalog B (scroll reveal/parallax): 9/9 *implemented* primitives covered — 3 catalog names (`reveal-repeat`, `scroll-skew`, `reveal-direction-aware`) don't actually exist in `kuinetic.js`, documented on-page rather than faked. Catalog C (scroll mechanics): 10/11 — `video-scrub` verified real but left unwired (out of scope for a photo pass). 20 real scenic-location photos sourced from Pexels, reused across ~45 placements. Verified live via Playwright, zero console errors. Note: `sequence-scrub`'s `src:` param can't contain `{i}` — kuinetic.js's injection-guard regex blanket-rejects `{`/`}` in any `data-kui` param — worked around with a progress-driven grayscale→color wipe instead of frame-swapping; not a bug in the new page, a real kuinetic.js constraint worth fixing upstream someday. |
| `interactive.html` | New (links `system.css`) | Rebuilt this session ("Gestures and layout"). All 13 gestures/physics + all 9 layout/FLIP catalog primitives covered. 14 real candid B&W documentary photos sourced from Pexels (asian-white.jpg mood). New components: `.gesture-arena`/`.gesture-stage`/`.gesture-chip` for open pointer-tracking space (drag/throw demos don't fit a fixed-aspect card). Note: `flip-container` primitives use a `MutationObserver` on `childList`/`subtree`/`hidden` — class-only layout swaps need an explicit child re-append to trigger it. |
| `text.html` | New (links `system.css`) | Rebuilt this session. Full 26/26 catalog D coverage (was already fully demoed pre-migration, straight reskin). No new imagery — hero uses a live typographic specimen instead of a photo. New components: `.demo-card-text` (text-in-surface, no image) and `.demo-card-wide` (full-bleed for marquee effects). |
| `data-hover.html` | New (links `system.css`) | Rebuilt this session. Catalog F: 13/13. Catalog I: 20/20 — old page was missing `magnetic` (19/20), added it. Card-tilt demos reuse existing unused assets (`azzaro_cologne.jpg`, `white_snow_model.jpg`) rather than sourcing new ones. New shared convention: `.demo-card .demo-card-caption` extends the black/lime caption-fill rule to non-photo cards (counters, meters, buttons) without forcing them into `<figure>`/`<figcaption>`. |
| `ambient-feedback.html` | New (links `system.css`) | Rebuilt this session (728 lines, largest page in the batch). Catalog J: 14/14 + 1 bonus (`beam-border`). Catalog K: 17/17. 4 new futuristic/hyperrealistic tech photos sourced from Pexels (tech-helmet.jpg mood: visor HUD, VR headset, neon earbuds, glowing controller) plus reused `tech_helmet.jpg`. Real bug found + fixed: `gradient-rotate-border`'s `mask-composite: exclude` was masking away real DOM children when applied directly to their parent (unlike `beam-border`, which isolates its mask into a `::before`) — fixed by making the masked ring and the photo siblings instead of parent/child. Caught via live Playwright verification, not static reading. |
| `nav-forms.html` | New (links `system.css` + `tailwind.css`) | Rebuilt this session with daisyUI v5 + Tailwind v4 (already built in the repo — `demo/tailwind-entry.css` → `demo/tailwind.css`, rebuilt via `npx @tailwindcss/cli -i demo/tailwind-entry.css -o demo/tailwind.css`, NOT the full `npm run build` which also touches `kuinetic.js`/`kuinetic.css`). Catalog M: 8/8. Catalog O: 12/12. Deliberately avoided daisyUI's `.toggle`/`.checkbox`/`.radio`/`.range`/`.dropdown`/`.drawer`/`.modal`/`.steps`/`.select`/`.textarea` — each collides with a kUInetic-owned CSS channel on the same element (traced through compiled CSS) or has no viewport contract matching an M/O primitive; used plain Tailwind utilities alongside required kUInetic markup instead. daisyUI's default indigo/violet tokens overridden to the site's paper-white/near-black/acid-lime palette. Real bugs found + fixed in the port: old page's `drawer-slide`/`menu-fullscreen` click handlers used an exact-match attribute selector against a value that actually had a trailing ` on:click`, so it never matched (fixed with `^=`); `kuinetic.css` falls back to old `style.css` var names (`--dim`, `--line`) for three off-state colors, now aliased to `system.css`'s `--muted`/`--border`. |
| `landing-minimal.html` | Old | Not started — "Designs" page, not "CSS Animations"; out of scope for this session's pass. |
| `landing-studio.html` | Old | Not started — same as above. |

The pattern for migrating a page (established doing `reveals.html`) is: read the old page fully,
copy `index.html`'s header markup verbatim (`site-header`, logo, nav groups, theme-toggle button +
inline script, hamburger), link `kuinetic.css` + `system.css` instead of `style.css`, rebuild the
page's own content sections in `.demo-hero` / `.section-head` / `.demo-grid` / `.demo-card`
vocabulary (all defined in `reveals.html`'s own `<style>` block — copy those class definitions
into the new page's `<style>` block too, they're page-specific, not in `system.css`), replace any
`picsum.photos` or other placeholder images with real sourced/owned photography, and sync.

## `reveals.html` specifics (fully rebuilt this session)

- Hero is two-column: copy left, image right with `data-kui="blur-in 2000ms on:load"` (currently
  `model_1.jpg`).
- "The entrance matrix" section demonstrates **all 32 entrance-only effect names** (not the 16
  matching exit names — an exit effect's resting state is invisible, so there's nothing honest to
  show on a scroll-triggered card; this is explained in the page copy itself), grouped into 9
  `.matrix-group` blocks matching `docs/catalog.md`'s own grouping (Fade, Slide, Logical/RTL,
  Zoom, Flip, Rotate, Blur, Combo presets, Character easing).
- Every `.demo-card figcaption` (the caption strip under each photo) is a **solid fill, not the
  original muted-grey-on-surface style**: light mode = black background / white text, dark mode =
  acid-lime background / black text. This was an explicit, iterated owner request — don't revert
  it to the muted style.
- `.demo-card` is `display:flex; flex-direction:column`, image `flex:none`, figcaption
  `flex:1 0 auto`. This is load-bearing, not decorative — without it, a caption that wraps to two
  lines (e.g. `"slide-right"`) makes its card taller via CSS Grid's default `align-items:stretch`,
  and neighboring cards' `--surface` background shows through as a grey sliver below their
  (shorter, unstretched) figcaption. If you add new cards with long captions, this still holds.
- Includes `replay.js` (the "replay all effects" FAB) — deliberately, since this page has the
  highest density of `data-kui` elements of any showcase page.

## Bugs found and fixed this session (all shipped, verified live via Playwright against localhost)

1. **Mobile nav permanently visible, uncloseable.** `.nav-links { display: flex; ... }` (and old-
   header equivalent `header.site nav`) is an *author* rule, and author rules always beat the
   *user-agent* `[hidden]{display:none}` rule at equal specificity, regardless of source order.
   nav.js's `hidden = true/false` toggling was therefore a no-op for `display`. Fixed by adding an
   explicit `.nav-links[hidden] { display: none; }` (and `header.site nav[hidden]`) in `system.css`,
   `index.html`, `docs.html`, `style.css`.
2. **Desktop nav could render with zero links if `nav.js` ever failed to execute** (this is what
   caused "reveals.html nav is empty in Open Design's preview but fine on my localhost" — different
   JS execution environments). The old desktop-safety rule used `opacity: 1 !important`, which
   never overrides `display:none`. Replaced with `@media (min-width: 721px) { .nav-links[hidden] {
   display: flex; } }` so the desktop nav is correct on first paint independent of JS. Same fix in
   all 4 files above.
3. **`getting-started.md` 404 on localhost** — see path gotcha #2 above.
4. **`docs.html` mobile padding was literally `0px` on the sides.** `.doc-main { padding: Xrem 0
   8rem; }` is a shorthand that zeroes ALL FOUR sides, silently overwriting the separate `.wrap`
   class's side padding on the same element (equal specificity, later in source). Fixed by
   switching `.doc-main` to `padding-top`/`padding-bottom` longhand only.
5. **`docs.html` grid blowout on narrow viewports** — `.doc-body { max-width: 72ch; }` is a CSS
   Grid item with no `min-width` override, so its automatic minimum size was its full 72ch
   max-content width (~727px), forcing the whole page into horizontal scroll on a 390px phone.
   Fixed with `min-width: 0` on `.doc-body`. (Classic CSS Grid gotcha — worth grepping for the same
   pattern — `max-width` + no `min-width:0` on a direct grid child — if new grid layouts get added
   elsewhere.)
6. **`.doc-switch` tab row (Getting Started / Catalog / Architecture) had no `flex-wrap`**, and the
   three labels combined were just wide enough to overflow a 360px phone. Added `flex-wrap: wrap`.
7. **`reveals.html` demo-card caption-fill height bug** — see "reveals.html specifics" above.
8. **`orange_visor.jpg` was referenced by `reveals.html` but had never actually been copied into
   `kUInetic/demo/assets/`** (404 on localhost, confirmed via Playwright console messages). Fixed;
   see the full-asset-parity check at the top of this session's final turn for the verification
   method (`diff` the two `assets/` directory listings, then `diff -q` every same-named file pair).

## Asset library — current state

27 files in `assets/` (OD project and `kUInetic/demo/assets/` are byte-identical, verified). Mix of:
- Original library product photos (`red_headphones`, `kuinetic_spray`, `nike_shoe`, `model_1`,
  `luxury_watch`, `designer_audio`, `autumn_model_finished`, `green_monochrome`, `orange_visor`).
- Real premium product/editorial photos pulled in from the owner's own `kUInetic/assets/` (repo
  root) folder mid-session: `gucci_nail_polish`, `white_snow_model`, `pink_mc`, `yellow_mc`,
  `tech_helmet`, `azzaro_cologne`, `aesop_shampoo`, `leather_airpods_case` /
  `earpods.jpg` (**these two are byte-identical duplicates of the same photo** — harmless but could
  be consolidated to one filename + fix references if anyone wants to tidy it up).
- Real stock photos I sourced from Pexels (free license) when asked to find real images instead of
  generating them: `perfume_bottle`, `light_art`, `jewelry_black`, `water_splash`,
  `architectural_shadow`, `motion_blur_model`. The owner has been steadily replacing these with
  their own premium assets as they surface more of them — treat Pexels images as the fallback tier,
  not the preferred one, and ask before adding more of them if the owner's own library might have
  something better.
- Two AI-generated images (`cyberpunk_1.jpg`, `cyberpunk_2.jpg`, `crimson_rose_model.jpg`) exist in
  the asset folder but are **deliberately unused** in any page — sci-fi/fantasy tone clashes with
  the site's calm editorial-product-photography language. Leave them out unless the owner asks for
  them specifically.

## Owner preferences worth knowing (established through explicit correction this session)

- **Sync every file change to kUInetic automatically** — don't wait to be asked (standing
  instruction, saved to memory).
- **Prefer real, owned, or properly-sourced photography over generated images.** When generation
  was tried once, the owner explicitly said no ("that just eats tokens") and asked for web-sourced
  real photos instead. When more of the owner's own premium assets turned out to already exist in
  the repo, the direction became "use what I already have before reaching for stock."
- **Demo-card caption styling is now a fixed system convention** (black-on-white / lime-on-black by
  theme, solid fill, not muted-grey) — apply it to any new card-style component on future pages,
  don't reintroduce the old muted style.
- Verify visually via Playwright against the owner's real localhost when a report doesn't match
  what static code reading suggests — several of the bugs above were only findable that way (the
  desktop-nav-with-no-JS case in particular would have been very hard to find from source alone).
