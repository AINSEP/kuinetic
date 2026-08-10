# Handoff: catalog build-out surged from 106/237 to 214/237, session restarting — pick up here

Generated: 2026-08-10T19:40:00Z
Source: Claude Sonnet 5 (Claude Code), coordinating 3-4 concurrent subagents across this session
Target: a fresh Claude Code session (this one is restarting due to context size)

## Next-Agent Prompt

> Read `AI-Dev-Shop/AGENTS.md` first, then this file in full.
> The project is `/Users/la/Programming/designimation` — **one folder, branch `main`, no worktrees.**
> Before anything else, run the four gates and confirm green: `npm test`, `npx eslint src test`, `npx tsc --noEmit`, `npm run verify:browser`. All were green as of HEAD `30b6883` (see Current State).
> Then read the **Owner's Next-Session Requests** section below — two concrete, owner-requested changes are queued and have NOT been started yet. Do those first, before resuming catalog breadth work.

---

## Owner's Next-Session Requests (do these first, not done yet)

### 1. Sweep `data-dsg-on` → inline `on:` syntax across every showcase page

The owner wants every `data-dsg="effect 500ms" data-dsg-on="hover"` pair simplified to the single-attribute form `data-dsg="effect 500ms on:hover"`. **This already works today, confirmed live** — `src/core/parse.ts` has a dedicated hoist table (`on`, `timeline`, `threshold` are element-scoped keys pulled out of the per-effect grammar) and `src/core/element-config.ts`'s `resolveConfig()` doc comment says outright: *"values written inline (`on:enter`) are a convenience that takes precedence over the longhand attribute."* Verified side-by-side in a throwaway test page: both forms produce identical `paused → running` behavior on hover, zero console warnings.

**What to do:** grep every `demo/showcase/*.html` for `data-dsg-on=` and `data-dsg-timeline=`/`data-dsg-threshold=` if present, and fold each into the adjacent `data-dsg="..."` string as an inline `on:`/`timeline:`/`threshold:` token instead. The **caption `<p class="tag">` text** on each demo (which usually echoes the attribute back, e.g. `data-dsg="zoom-in 400ms" data-dsg-on="hover"`) needs the same edit so the displayed code matches the real markup. The **"Show code" modal** (`demo/showcase/show-code.js`) will automatically show whatever's actually in the DOM, so no changes needed there. One cosmetic note: after this sweep, `data-dsg-on` will no longer appear in the DOM at all for these elements (nothing writes it back) — that's expected and fine, not a regression.

Do this as its own commit (or a few, split by page), verify a couple of pages live afterward (hover still fires, click still fires) before moving on.

### 2. Rewrite `docs/catalog.md` and `docs/design.md` for a general audience — human AND LLM readers, not the owner, not this session

The owner's exact words: *"we're not writing docs for me, for the rest of the world... don't assume the person who's reading the docs knows anything"* and separately: *"we also want the LLMs and AIs to be able to read the docs and know how this works... You wrote it for me with stuff like [gpt-]5.6-sol, which is ridiculous. Take all that stuff out."*

Concretely, remove:
- `docs/catalog.md` lines 277–293: the `## Coverage of the original 33-item wishlist` and `## Build-order recommendation` sections. Both are internal build-planning artifacts (what order to build things in, coverage against an owner-specific wishlist) — irrelevant to someone trying to understand what the library does or how to use it.
- `docs/design.md` line 351's near-duplicate `### Coverage of the original 33-item wishlist` section (worded slightly differently — "30 of 33 ship in v1" — from an earlier v1-only framing). Same reasoning; evaluate whether anything in it is worth folding into legitimate scope-boundary documentation (the WebGL/canvas exclusion, for instance, **is** genuinely useful for a reader to know) versus just deleted as planning noise.
- `docs/design.md` line 3's `Revised after the \`gpt-5.6-sol\` design review (2026-08-09). Supersedes v1.` — an internal reviewer/session reference, exactly the kind of thing the owner called out by name. Search both `docs/catalog.md` and `docs/design.md` for any other mentions of `gpt-5.6-sol`, specific session dates, or "Codename `kin`"-style internal-decision framing, and rewrite in neutral, timeless, third-person documentation voice — the kind a stranger (or another LLM agent with zero session context) could land on cold and understand.
- More broadly: read both files fully with fresh eyes and ask "does a first-time reader need this sentence to understand the library, or does it only make sense to someone who was in the room for a planning conversation?" Cut or rewrite anything in the second category. This is a genuine editing pass, not just a find-and-delete of the specific strings named above.

**Do not** touch `docs/build-phase2-packet.md`, `docs/live-testing-backlog.md`, `docs/review-3-gpt-5.6-sol.md`, or this handoff file itself for this pass — those are explicitly internal/process documents and are supposed to read that way. Only `catalog.md` and `design.md` are meant to be public-facing (they're what the live site's "Docs" nav dropdown links to — see `demo/showcase/docs-nav.js` and `demo/showcase/docs.html`).

---

## Current State

- Repo `/Users/la/Programming/designimation`, branch `main`, HEAD **`30b6883`**, exactly one worktree, working tree clean (only pre-existing `.gitignore`/`ADS-memory`/`.claude` scaffolding untracked, nothing else).
- **25 commits landed this session** (full list in Completed Work below), taking the catalog from 106/237 built names to **214/237**.
- **Three concurrent subagents were running catalog build-out work and were just stopped** (by explicit owner instruction, to restart this main session) with a clean working tree — nothing uncommitted, nothing lost. Their state:
  - `catalog-section-fi` (sections F + I): **fully done and committed.** Section F (Numbers & data-viz, 13/13 names) and section I (Hover & pointer, 19/20 names — one short of the full 20, not otherwise explained in its report) both built, tested, wired into the shared registry, showcase page `demo/showcase/data-hover.html` built and verified with real screenshots. Nothing left in flight.
  - `catalog-section-jk` (sections J + K, then reassigned to E + L + N): sections J (Ambient, 14/14) and K (Feedback, 17/17) **fully done, committed, and wired** — this agent's screenshot-based verification was the most rigorous of the session, caught and fixed 6 real visual bugs (see Completed Work). It had **just been reassigned** to finish the remaining partial sections — E (SVG & icons, currently 2/17 built), L (Page transitions, 4/6), N (3D & perspective, 5/7) — when the stop happened. **No files existed yet for that reassignment** (git status was clean for E/L/N-related paths at stop time) — this work has not been started, not partially done. Pick it up fresh.
  - `catalog-verify-mo` (verifying sections M + O, which a since-restarted earlier agent had already fully built): was mid-verification when stopped. M (Navigation, 8/8) and O (Forms, 12/12) were **already fully built, tested, and wired** before this verify pass started (confirmed independently: `npx tsc --noEmit` clean, `npx eslint src test` clean, all 13 unit tests passing, a live screenshot of `demo/showcase/nav-forms.html` through the real bundle showed 0 console/page errors). The verify agent's job was to do the deeper interactive-state screenshot pass (hover/focus/error states on form fields) and fix anything found — **that deeper pass had not reported back yet when stopped.** Treat M/O as built-and-basically-verified but not given the same interactive-screenshot scrutiny as J/K got; worth a spot-check before fully trusting it.

**Gates at HEAD `30b6883` (verified directly, not assumed):**

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm test` | 411/411 |
| Complexity | `npx eslint src test` | clean; zero `eslint-disable` comments anywhere in the repo |
| Types | `npx tsc --noEmit` | clean; `strict` + `noUncheckedIndexedAccess` |
| Real browser | `npm run verify:browser` | 28/28 (unchanged from prior session — nothing in this session's work touched what it covers) |

## Catalog completeness — 214/237 (was 106/237 at session start)

| Sec | Name | Built | Status |
|---|---|---|---|
| A | Entrance & exit matrix | 48/48 | done (pre-session) |
| B | Scroll reveal & parallax | 9/12 | `reveal-repeat` explicitly not implementable yet (see code comment in `src/effects/presets.ts`), `scroll-skew`/`reveal-direction-aware` unbuilt |
| C | Scroll mechanics | 11/11 | done (pre-session) |
| **D** | **Text & typography** | **26/26** | **built this session** — see below, several real bugs found+fixed |
| E | SVG & icons | 2/17 | only `icon-morph`/`blob-morph` — **next assignment for catalog-section-jk, not started** |
| **F** | **Numbers & data-viz** | **13/13** | **built this session** |
| **G** | **Media & images** | **17/17** | **built this session** (first section built, was already-uncommitted from a prior session at start of this one) |
| H | Layout & FLIP | 9/9 | done (pre-session) |
| **I** | **Hover & pointer** | **19/20** | **built this session** — one name short, not documented which one |
| **J** | **Ambient backgrounds** | **14/14** | **built this session** |
| **K** | **Feedback & status** | **17/17** | **built this session** |
| L | Page transitions | 4/6 | missing `page-morph`, `smooth-scroll-to` — **next assignment for catalog-section-jk, not started** |
| **M** | **Navigation** | **8/8** | **built this session** |
| N | 3D & perspective | 5/7 | missing `depth-layers-pointer`, `perspective-grid` — **next assignment for catalog-section-jk, not started** |
| **O** | **Forms & inputs** | **12/12** | **built this session** |

Remaining: **23 names** across B (3), E (15), I (1), L (2), N (2).

## Showcase pages

| Page | Covers | Nav-linked from the other pages? |
|---|---|---|
| `reveals.html`, `scroll.html`, `interactive.html` | Pre-existing (A/B/C/H + gestures) | — (original 3, cross-linked with each other) |
| `text.html` | Section D | Yes — added this session |
| `data-hover.html` | Sections F + I | **No — not yet cross-linked** |
| `ambient-feedback.html` | Sections J + K | **No — not yet cross-linked** |
| `nav-forms.html` | Sections M + O | **No — not yet cross-linked** |

All showcase pages share `theme.js` (dark/light toggle), `docs-nav.js` (Docs dropdown), `replay.js` (replay-all FAB). `show-code.js` (per-element "Show code" modal, added this session) is wired into `reveals.html`, `scroll.html`, `interactive.html`, `text.html`, and `data-hover.html` — **but NOT yet into `ambient-feedback.html` or `nav-forms.html`** (those two were built before `show-code.js` existed).

**Next Step 1, before anything else:** add nav cross-links so all 7 pages link to each other (same pattern as the `text.html` nav-link fix this session — see commit `e2831c5`), and add the `show-code.js` script tag to the two pages missing it.

## Completed Work (this session, chronological)

Full commit list, oldest to newest:

1. `723fd85` — committed section G (media-*, 17 names) — was sitting uncommitted from a prior session, verified and landed as-is.
2. `b37ecb6`, `28d5f93`, `cb41647`, `3fed032`, `2ff200c` — theme/nav polish: fixed a flash-of-dark-theme bug (FOUC), made first-visit theme default to OS `prefers-color-scheme`, sun/moon icon toggle, true-white light background, "Docs" nav dropdown (added `demo/showcase/docs-nav.js`), switched the local dev server from serving `demo/` to serving the repo root (`npm run showcase`, was `cd demo && python3 -m http.server`) so `/docs/*.md` is reachable, added real-browser test coverage for the toggle, made the replay-FAB theme-aware.
3. `85ee46b`, `5ff0a0f` — section D (text & typography, 26 names) built + showcase page.
4. `f2d262b` — added a "Why not just GSAP?" section to `docs/design.md`, answering the owner's own comparison question (GSAP is 100% free since April 2025 including former paid plugins; it could build almost this entire catalog; the real differentiators are zero-JS-dependency, declarative HTML authoring, and a maintained catalog vs. a general engine — not raw capability). **This section should very likely survive the "rewrite docs for a general audience" pass above** — it's genuinely useful reader-facing content, just written in first-person "I researched this" voice in places that may need smoothing to match the rest of the doc's voice.
5. `ad57178` — rewrote the Docs viewer: originally linked straight to raw `.md` files (unstyled plain-text dump in a browser). Built `demo/showcase/docs.html` + `demo/showcase/markdown.js` (small dependency-free markdown→HTML renderer) so `docs/catalog.md`/`docs/design.md` render themed and readable.
6. `e2831c5` — fixed a real gap: `text.html` linked to the other 3 pages but nothing linked back to it.
7. `597508d` — bumped a demo's duration per owner request.
8. `338dc85`, `8bced90`, `c4d1ab5` — **three real bugs found via live screenshot testing, not assumed from gate numbers**:
   - Missing spaces in char-split text effects (whitespace graphemes were wrapped in `display: inline-block` spans, which collapses a lone-space box to zero width).
   - A CSS grid column with no explicit `grid-template-columns` let an intentionally-overwide marquee track blow the whole page out past the viewport, bypassing its own `overflow: hidden` wrapper.
   - A stray floating dot artifact traced to `overflow: hidden` shifting an inline-block's baseline per spec — removing the (unnecessary) `overflow: hidden` fixed it.
   - **`src/core/play.ts` (core library, not showcase chrome):** the programmatic `play()` function (used by the replay-all FAB and the public API) unconditionally stamped `data-dsg-on` to `"manual"` on every call — correct for elements with no declared trigger, but for an element authored `on:hover`/`on:click`/`on:load` it permanently destroyed the real trigger, so after one Replay click, hovering or clicking that element again did nothing. Fixed: only default to `manual` when the element never declared a trigger of its own.
9. `b33c175`, `9d39175`, `c9e3351` — built the "Show code" feature (per-element modal showing pristine authored HTML, not the runtime-mutated live DOM — fetches the page's own raw source and matches elements by document order). Two real bugs in it, both found and fixed same-session: the modal was permanently visible on page load (a CSS class set `display: grid` at equal specificity to the UA `[hidden]` rule and won by source order — same trap already documented in `docs-nav.js`, just not applied to this new code); and two adjacent buttons sharing a parent (the hero `<h1>`/`<p>` on `reveals.html`) stacked vertically instead of sitting side by side (`display: block` — switched to `inline-block`).
10. `d3b0223`, `4f8b354`, `52b38ce`, `5ee00d9`, `b080a76` — sections I, F, M+O, J, K built (see Catalog completeness table).
11. `6de171c`, `30b6883` — wired J/K and F/I into the shared registry (`src/effects/catalog/index.ts`, `src/css/index.css`) and confirmed no name collisions across all now-active sections (full suite 411/411).
12. `ddf52b7` — `ambient-feedback.html` + **6 real bugs found by catalog-section-jk's screenshot verification**, worth reading in full if touching ambient/feedback effects again: (1) `background:` shorthand in showcase CSS resets `background-image` to `none` and beats the library's layered CSS regardless of specificity — hit 3 separate times (gradient tiles, heart-burst color, confetti dots) before being generalized to "use longhand `background-color` in integrating pages"; (2) a keyframe with only a `to` block relied on an implicit `from` that resolved to the element's own resting `opacity:0` instead of `1` (toast never became visible) — fixed by making both `from` and `to` explicit; (3) a hardcoded-white default speckle/line color was invisible on light-theme panels — switched to `currentColor`.

## Decisions And Constraints

**Honour these — several were established or re-confirmed this session.**

1. **One folder, no worktrees** — unchanged.
2. **Complexity ≤ 10 on both metrics, as errors, zero disable comments** — unchanged, still zero in the repo across 411 tests and ~13k more lines than session start.
3. **The Playwright MCP is fine to use** — this got re-litigated AGAIN this session (an agent's own stale memory note said to avoid it; that note is itself stale, corrected twice now). It launches its own isolated browser, never touches a real user Chrome session. Either it or a small script using `loadChromium()` from `scripts/browser-harness.mjs` (see `scripts/verify-browser.mjs` for the pattern) are both fine — the second is more reliable for scripted, repeatable checks since it's not a shared session other concurrent agents might also be driving (see point 7 below).
4. **`npm run showcase` must be run from the repo root**, not `cd demo &&` — changed this session specifically so `/docs/*.md` (now `/demo/showcase/docs.html?doc=...`) resolves. **URL scheme changed**: pages are now at `http://localhost:8934/demo/showcase/*.html`, not `http://localhost:8934/showcase/*.html`.
5. **Two coexisting, both-legitimate registration patterns** in `src/effects/`: (a) "catalog family" — `media`/`text`/`ambient`/`feedback` each export `PRESETS`/`PRIMITIVES` constants extended into `src/effects/catalog/index.ts`'s single `registerCatalog()` chain; (b) "standalone top-level modules" — `gestures`/`layout`/`scroll-mechanics`/`three-d`/`svg`/`navigation`/`forms`, each with its own `registerX()` called directly in the root `src/effects/index.ts`'s `createRegistry()`. Sections M/O followed pattern (b); J/K followed pattern (a). Both work, don't "fix" one to match the other without a reason.
6. **`data-dsg-on` gets rewritten by the library itself** (see `src/core/play.ts` fix above) — this is exactly why it's a separate attribute from `data-dsg` rather than folded in by default, even though the inline `on:` convenience syntax also works (see Owner's Next-Session Requests #1). Both facts are true at once; not a contradiction.
7. **Concurrent-edit discipline remains real, not theoretical** — this session avoided collisions by having every dispatched agent build into entirely new files and explicitly defer shared-file wiring (`src/effects/index.ts`, `src/css/index.css`, nav `<a>` tags) back to the coordinating session, applied serially, one agent's diff confirmed clean before the next. One agent (M/O) deviated from the assigned file-naming convention (used new top-level dirs instead of extending `catalog/index.ts`) and wired the root `src/effects/index.ts` directly without asking first — caught before it caused a real collision only because nothing else had touched that file yet at the time. Keep enforcing "report the exact lines, don't touch the shared file yourself" — it worked every other time.
8. **Verify with real screenshots, not gate numbers or DOM/computed-style assertions alone** — this is the single most repeated lesson of the session. At least 9 distinct real bugs this session (listed above, sections D and J/K) were invisible to `getAnimations()`/attribute/gate checks and were only caught by actually rendering the page and reading a screenshot back. Every dispatch brief this session ended up needing to say this explicitly and non-negotiably; do the same for any new dispatch.
9. **A dev server this many concurrent agents share will get killed and restarted repeatedly** — not a bug, just what happens when multiple agents each want to control/restart it for their own verification runs. Don't be alarmed by a background server task failing with exit 143; just restart it (`npm run showcase` from repo root, `run_in_background: true`) when you actually need it for something.

## Risks And Open Questions

- **Section I is 19/20, not 20/20** — no report explained which name was skipped or why. Worth a quick audit against `docs/catalog.md`'s section I list before assuming it's a deliberate, reasoned omission.
- **M/O (`nav-forms.html`) didn't get the same interactive-state screenshot scrutiny** J/K did (hover/focus/error states specifically) before the verify agent was stopped mid-pass. Basic verification (tsc/eslint/tests/one full-page screenshot) all passed clean, but the deeper pass — the one that's caught real bugs every other time it's been done this session — didn't finish.
- **Section E is the largest remaining gap** (15 of 17 names unbuilt) and hasn't been started at all despite being queued.
- **The docs-rewrite request (Owner's Next-Session Requests #2) has real scope ambiguity**: some content that reads as "internal" (the v1/v2/v3 tier breakdown, the channel/primitive model) might actually be legitimate, valuable architecture documentation for an external reader, not planning noise. Use judgment past the specifically-named strings/sections — don't strip content just because it was written during a planning conversation, only because it doesn't serve a reader who wasn't in that conversation.
- **`data-dsg-on` sweep (Request #1) touches every showcase page's demo captions too**, not just the live attribute — easy to fix the functional markup and miss that the `<p class="tag">` text now shows a form of the attribute nobody actually uses on the page anymore.

## Suggested Skills

- `AI-Dev-Shop/agents/programmer/skills.md` — for both owner requests and any remaining catalog build-out (E/L/N, B's 3 missing names).
- `AI-Dev-Shop/agents/docs/skills.md` (if it exists — check `AI-Dev-Shop/framework/routing/agent-index.md`) — may be a better-fit persona for the docs rewrite specifically than Programmer.

## Next Steps

Ordered by what's actually queued vs. what's a natural continuation:

1. **Owner request #1**: sweep `data-dsg-on`/`data-dsg-timeline`/`data-dsg-threshold` into inline `on:`/`timeline:`/`threshold:` syntax across every showcase page, including caption text. Not started.
2. **Owner request #2**: rewrite `docs/catalog.md` and `docs/design.md` for a general (human + LLM) audience, removing session/planning/reviewer-specific content. Not started.
3. **Nav cross-linking** for `data-hover.html`, `ambient-feedback.html`, `nav-forms.html` (add links to/from the other 4 pages) + add `show-code.js` to the two pages missing it.
4. **Resume catalog-section-jk's reassignment**: sections E (15 names), L (2 names), N (2 names). Not started at all — pick up fresh, use the same dispatch brief pattern (new isolated files, defer shared-file wiring, mandatory real-screenshot verification) that worked for every other section this session.
5. **Finish M/O's deeper interactive-state verification pass** (hover/focus/error screenshots specifically) — cheap insurance given how many real bugs that exact kind of check has caught this session.
6. **B's 3 remaining names** (`scroll-skew`, `reveal-direction-aware`; `reveal-repeat` is flagged as not-currently-implementable, see code comment) — smallest remaining chunk, could be folded into whichever agent picks up E/L/N.
7. Once B/E/I/L/N are all full, the catalog hits 237/237 — worth flagging to the owner as a real milestone when it happens.

## Handoff Contract

- **Inputs used**: this session's full conversation and git history from HEAD `64c006b` (prior handoff) to `30b6883`; live `git log`/`git status`/`git diff` throughout; direct `npx tsc --noEmit`/`npx eslint src test`/`npx vitest run`/`npm run verify:browser` runs against current HEAD; grep-based name counts against every `src/effects/catalog/*.ts`, `src/effects/navigation/`, `src/effects/forms/` file; the three subagents' own final reports before being stopped.
- **Output summary**: catalog build-out went from 106/237 to 214/237 in one session via concurrent subagent dispatch, plus a real core-library bug fix (`play.ts`'s trigger-clobbering), a Docs-viewer rewrite, a new "Show code" feature, and theme/nav polish — all verified against real gates and, for the parts that mattered visually, real screenshots. Two owner-requested changes are queued and explicitly NOT started (see top of file). Three subagents were mid-task when stopped for this restart; none lost uncommitted work.
- **Risks**: section I short by one unexplained name; M/O's deeper interactive verification incomplete; the docs rewrite has real judgment-call scope beyond the specifically-named strings.
- **Suggested next assignee**: fresh Coordinator session → owner-requested changes first (both are small, well-specified, no ambiguity blocking a start) → resume catalog breadth (E/L/N, then B) → nav cross-linking cleanup.
