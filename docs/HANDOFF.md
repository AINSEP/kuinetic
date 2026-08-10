# Handoff: designimation — built through v3 and review-fixed; next is audit → external review → browser testing

Generated: 2026-08-10T14:48:54Z
Source agent/session: Claude Opus 5 (1M context), Claude Code, AI Dev Shop framework active (Coordinator → Programmer(Direct))
Target: Claude Code, fresh session

## Next-Agent Prompt

> Read `AI-Dev-Shop/AGENTS.md` first, then `/Users/la/Programming/designimation/docs/HANDOFF.md`.
> The project is `/Users/la/Programming/designimation` — **one folder, branch `main`, no worktrees, never create a second folder.**
> Before anything else, run the four gates and confirm they are green: `npm test`, `npx eslint src test`, `npx tsc --noEmit`, `npm run verify:browser`.
> Then check whether `docs/refactor-proposal.md` exists (a Sonnet 5 Refactor agent was mid-flight when the last session ended) and continue from the Next Steps section of the handoff.

---

## Current State

**A standalone, MIT, framework-independent web animation library.** Authors write `data-dsg="fade-up 800ms"` on HTML; a compiler validates parameters and stamps CSS custom properties plus one compiled `animation` declaration. JS-rendered effects go through an `EffectInstance` lifecycle the animator gates. Published to npm and loadable via a plain `<script>` tag is the intended distribution; **neither has happened — nothing is published.**

- Repo `/Users/la/Programming/designimation`, branch `main`, HEAD **`5ea104b`**, working tree **clean**, exactly one worktree.
- **103 effect names / 33 primitives** — about 43% of the ~237-name catalog in `docs/catalog.md`.
- ~9,000 lines across `src/` and `test/` (60 files, +7,582 lines since the first commit).

**Gates, all green as of HEAD (verified, not assumed):**

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm test` | 321 passing, 15 files |
| Complexity | `npx eslint src test` | clean; `complexity` **and** `sonarjs/cognitive-complexity` both capped at 10 **as errors**, zero disable comments in the repo |
| Types | `npx tsc --noEmit` | clean; `strict` + `noUncheckedIndexedAccess` |
| Real browser | `npm run verify:browser` | 24/24 in headless Chromium |
| Showcase | `npm run check:showcase` | 3 pages, 35/35 effects install, 0 errors |

## Completed Work

Twelve commits, `a7ef519` → `5ea104b`. In order:

1. **v1** (`a7ef519`) — the compiler: owned attribute grammar, channel-based composition, activation/timeline as separate axes, per-effect reduced motion, 58 CSS-rendered effects.
2. **Browser proof** (`8aa93c7`) — headless-Chromium harness, because jsdom cannot evaluate `@keyframes` or `animation-timeline`; nothing visual was proven until this landed.
3. **v2** (`3d2db58`) — scroll scheduler, FLIP engine, SVG path interpolator; 23 names. Three defects were found *only* by the browser harness.
4. **v3** (`09c8df6`) — spring integrator, pointer-gesture recogniser, 3D/page transitions; 22 names.
5. **External review** (`126c590`) — `gpt-5.6-sol` reviewed the real source and returned P0s. Verdict: do not publish.
6. **Review fixes** (`44368eb`, `709d9ca`, `c8f1a4a`) — every finding addressed; see below.
7. **Showcase** (`5ea104b`) — three demo pages using remote image URLs.

### What the review fixes changed (the newest, least-settled code)

- `prepare()` returns an `EffectInstance`, not a `Cleanup`. Previously JS effects started during `prepare`, so **`on:enter` / `on:click` / `manual` and `reducedMotion: 'disable'` were all inert** for pinning, FLIP, scrubbing, morphing, and every gesture. `supportedActivations` is now enforced, and primitives declare `defaultActivation`.
- A **style ledger** records every inline write and what it replaced; teardown restores rather than deletes. Configuration identity is the whole config, not just `data-dsg`.
- **Timing properties are namespaced per primitive.** `pop-in, blur-in` have disjoint channels so composition was allowed, but both tracks read one `--dsg-ease` and the blur inherited `back-out`.
- **Automatic combo substitution removed** — it kept only the first spec and was order-dependent.
- Preset defaults moved out of `element.style` into a generated `dsg.presets` cascade layer (`scripts/generate-preset-css.mjs`, 23 rules), so consumer CSS can override them.
- Nested scroll roots, per-root dirtying, `ResizeObserver`, `horizontal-scroll`'s unreachable `auto` branch, the over-broad cloak, FLIP's missing triggers, the tab-indicator overshoot, and the entire `play()` API.

## Active Files And Artifacts

| Path | Why it matters |
|---|---|
| `docs/design.md` | The architecture. Read before touching `src/core/`. |
| `docs/catalog.md` | The ~237-name target catalog; 103 built. |
| `docs/review-2-gpt-5.6-sol.md` | The external review whose findings were just fixed. Its "What the tests do not prove" section is the spec for browser testing. |
| `docs/review-1-*` (`review-gpt-5.6-sol.md`, `review-packet.md`) | The earlier **design**-stage review, before code existed. |
| `docs/refactor-proposal.md` | **May or may not exist.** A Sonnet 5 Refactor agent was running when the session ended. |
| `src/core/animator.ts` | Highest-churn file; absorbed scanning, gating, lifecycle, ledgers, mutation observation. |
| `src/core/instances.ts`, `owned-styles.ts`, `effect-context.ts` | The lifecycle refactor's new seams. |
| `scripts/verify-browser.mjs` | 24 real-Chromium assertions. `npm run record` also captures video to `.artifacts/video/`. |
| `scripts/generate-preset-css.mjs` | Must be re-run (`npm run generate:css`) after changing any preset's params. |
| `demo/showcase/*.html` | Three pages; images referenced by URL, nothing downloaded. |

## Decisions And Constraints

**Honour these — several were corrected mid-session at the owner's instruction.**

1. **One folder.** `/Users/la/Programming/designimation`. Do not create `-v2`, `-v3`, or a git worktree. This was raised twice; a worktree was created and then removed at the owner's request.
2. **Complexity ≤ 10 on both metrics, as errors.** An exception requires an inline `eslint-disable-next-line` with a stated reason; there are currently **zero** in the repo. Keep it that way.
3. **Dependency injection everywhere.** Registry, capabilities, reporter, activation binder, scroll scheduler, root resolver, frame source, measurement, and animation are all injected. No module singletons in logic.
4. **Decision/effect separation.** Pure planners return a description of writes; thin appliers perform them (`style-plan.ts` is the model).
5. **Function docs** carry purpose, params, returns, `@complexity`, and `@overallScore` per the ADS function-quality skill.
6. **Tests must be able to fail.** After writing a structural or invariant test, break what it guards, confirm the failure, revert. Two guards have been negative-verified this way (the CSS channel invariant and reduced-motion enforcement).
7. **jsdom proves logic; only the browser proves animation.** Six real defects were caught exclusively by the Chromium harness.
8. **Refactor is propose-only** unless explicitly dispatched to implement.
9. **Subagents**: bootstrap the ADS persona from `AI-Dev-Shop/agents/<role>/skills.md`, dispatch with `model: "sonnet"`, require incremental commits (only committed work survives a stop).
10. **Namespace is `dsg`** (`data-dsg`, `--dsg-*`, `@keyframes dsg-*`, `@layer dsg.*`). A rename is still cheap pre-publish but touches everything.
11. **`playwright-core` is pinned to exactly `1.61.1`** — newer versions demand an uncached Chromium build. Do not widen the range without downloading browsers.

## Risks And Open Questions

- **A Refactor agent was in flight at session end.** It was told to commit only `docs/refactor-proposal.md` and change no source. Verify with `git log` and `git status` before trusting the tree.
- **`docs/review-2-gpt-5.6-sol.md` was written against `3d2db58`**, before v3 and before the fixes. Some findings are stale; all the ones it raised have been addressed, but v3 code was never externally reviewed.
- **Not publishable.** No build output (`package.json` `exports` still point at TypeScript source), no README, no LICENSE file, no CI, no `.d.ts`. The review lists these as blocking `0.1.0`.
- **Firefox and WebKit are untested.** Chromium only.
- **Showcase pages need network** for `picsum.photos` images; the smoke check ignores image failures deliberately.
- **~134 catalogued names remain unbuilt** — text/typography, media, hover, ambient, feedback, data-viz, navigation, forms. Mostly CSS-tier and cheap.
- **Unresolved from the review, by design**: write-scope metadata (`self` / `children` / `external`) for primitives that mutate descendants or external targets. The concrete leaks are fixed via ledgers, but the compiler still cannot *detect* such collisions.

## Suggested Skills

- `AI-Dev-Shop/agents/refactor/skills.md` — the audit persona; propose-only by default.
- `AI-Dev-Shop/agents/programmer/skills.md` — for executing accepted proposals.
- `AI-Dev-Shop/skills/coding-foundations/SKILL.md` — explicit dependencies, decision/effect separation.
- `AI-Dev-Shop/skills/function-quality-assessment/SKILL.md` — `@overallScore`, the variable-name audit.
- `AI-Dev-Shop/skills/llm-operations/references/codex-dispatch.md` — the canonical `codex exec` invocation for the external review.

## Next Steps

Ordered. Each stage's output feeds the next.

1. **Verify the four gates**, then check for `docs/refactor-proposal.md` and whether the Refactor agent left the tree clean.
2. **Audit** — read the refactor proposal; accept or reject each item with reasoning. Execute accepted ones as **Programmer**, not Refactor, one at a time, keeping all gates green after each. The prime candidates it was pointed at: duplication across the five effect packages, `animator.ts`'s absorbed responsibilities, the mechanical `deferredInstance` wrapping, and the oversized `src/core/index.ts` export surface.
3. **External review — `gpt-5.6-sol` at `model_reasoning_effort="xhigh"`.** Use the `<<PEER_DISPATCH>>` + stdin pattern with `-C /Users/la/Programming/designimation`, and tell it explicitly not to read `AGENTS.md`/`CLAUDE.md`. Point it at v3 (`src/core/spring.ts`, `src/core/gesture.ts`, `src/effects/gestures/`) which no reviewer has seen, and at the lifecycle refactor. `docs/review-2-packet.md` is a reusable template. Save the result to `docs/review-3-*.md` and commit it.
4. **Browser testing** — dispatch a Sonnet 5 Programmer subagent owning `scripts/` and a new `test/browser/`, forbidden from editing `src/`, reporting defects to `docs/browser-findings.md` instead of fixing them. Required coverage from the review: a nested `overflow: auto` scroller with a default `horizontal-scroll` track scrolled to exactly 50%; FLIP's actual inverse transform and final geometry; a multi-subpath SVG with a hole; real pointer events for the gesture family; reduced motion genuinely preventing JS effects; and post-`destroy()` cleanliness. Add Firefox/WebKit smoke runs only if those browsers are already cached — do not download.
5. **Then decide**: continue the catalog (the ~134 remaining names, mostly cheap CSS) or do the publish work (build output, README, LICENSE, CI, browser-support statement).

## Handoff Contract

- **Inputs used**: this conversation; `git log`/`git status`/`git diff --stat` at `5ea104b`; live runs of `npm test`, `npx eslint src test`, `npx tsc --noEmit`, `npm run verify:browser`, `npm run check:showcase`; `docs/` artifacts; `AI-Dev-Shop/agents/{programmer,refactor}/skills.md`.
- **Output summary**: enables a fresh session to resume without replaying the build, with the four gates as the definition of "still working".
- **Risks**: an in-flight Refactor agent; a review written against an older commit; v3 never externally reviewed; nothing publishable yet; Chromium-only.
- **Suggested next assignee**: Coordinator → Refactor (audit) → Programmer (execute) → peer LLM (review) → Programmer (browser tests).
