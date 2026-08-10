# Fix request: `designimation` — address review-3 findings

This is a **build/fix task**, not a review — full read/write access to this repo (`-C` points at
`/Users/la/Programming/designimation`, git, branch `main`). Commit incrementally; only committed
work survives. One finding (or tightly related group) per commit, gates re-verified green after
each — don't batch unrelated findings into one commit.

**Do NOT read `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` anywhere on disk.**

## Source of truth

Read `docs/review-3-gpt-5.6-sol.md` in full — it's the complete findings list (16 items, High to
Low), each with exact file/line citations, a concrete reproduction, and a fix direction. Don't
re-derive the findings; they're already precisely diagnosed. Your job is implementing fixes, not
re-discovering problems.

## Priority order

Work top-down by the review's own severity ordering (High first). If you run out of time/runway,
stop cleanly after finishing a coherent subset — do not leave a finding half-fixed. Report exactly
what's done vs. remaining.

## Two categories — treat them differently

**Mechanical fixes** (most findings): implement per the review's "Fix direction," verify with a
concrete reproduction (ideally the exact one the review gave), keep gates green, commit.

**Findings that are actually product/architecture decisions, not mechanical patches** — flag these
for owner review instead of unilaterally deciding, the same way this project's Refactor persona
flags `ARCHITECTURE_REVIEW_REQUIRED` items rather than executing them blindly:
- **Finding #2** (`text` param type → discriminated sink types `selector`/`url-pattern`/
  `attribute-name`/`svg-path`) is a real type-system redesign touching many call sites. If you can
  do it safely and mechanically without inventing new public API shape by guesswork, do it — but
  if the right sink-type boundaries aren't obvious from the existing code, stop and describe the
  options instead of picking one silently.
- **Finding #5** (explicit behavior/controller lifecycle distinct from finite animation runs) is
  an architecture change to `EffectInstance`. Same rule: fix what's mechanically safe (e.g. make
  `deferredInstance.cancel()` actually tear down setup), flag the deeper "gestures aren't really
  finite animations" contract question rather than redesigning `EffectInstance` unilaterally.
- **Finding #12** (single injected environment/realm adapter) is a real DI restructuring across
  many files. If you can do it as a mechanical injection-point addition following the existing
  `resolveCollaborators` pattern, do it; if it requires redesigning the collaborator graph, flag
  it instead.
- **Finding #13** (new `/core/authoring` export surface) is a public API scope decision, same
  category as the already-accepted REF-005. Propose the concrete export list rather than just
  shipping one.

Everything else (1, 3, 4, 6, 7, 8, 9, 10, 11, 14, 15, 16) reads as genuinely mechanical from the
review's own fix directions — implement those.

## Two things already in flight — do not touch, do not duplicate

- **`src/core/instances.ts`'s `createCssInstance`** is being actively fixed by a separate agent
  for an unrelated CSS-animation-restart bug (not from this review). By the time you start, check
  `git log` for a commit mentioning "restart"/"CSS animation" in `instances.ts` — if you need to
  touch finding #4 (unfiltered `getAnimations()`) or #5 (`deferredInstance` cancel semantics) in
  this same file, read whatever landed there first so you don't revert or conflict with it. That
  other fix was explicitly told about finding #4 already, so it may already be partially addressed
  — verify before assuming it isn't.
- **Catalog build-out** (new effects, new showcase pages) is a separate, later phase — not your
  job here. If a fix requires touching a primitive file that build phase will also extend (e.g.
  `gestures/primitives.ts`, `scroll-mechanics/primitives.ts`), that's fine and expected (findings
  3, 10 live there) — just stay scoped to the review's findings, don't build new catalog names.

## Constraints (same as the rest of this project)

- Complexity ≤ 10 on both `complexity` and `sonarjs/cognitive-complexity`, as errors. Zero
  eslint-disable comments exist — restructure instead if a fix would need one.
- Function docs: purpose/params/returns/`@complexity`/`@overallScore`, matching existing
  convention.
- DI pattern: no new module singletons; follow `resolveCollaborators`'s existing injection shape.
- For every fix, verify against the review's own concrete reproduction where one was given (e.g.
  actually measure the `calc()` regex timing before/after for finding #1, actually construct the
  `__proto__` element for finding #8) — a fix that isn't verified against the exact failure mode
  cited isn't confirmed.
- Keep all four gates green throughout: `npm test`, `npx eslint src test`, `npx tsc --noEmit`,
  `npm run verify:browser`. Re-verify after each commit, not just once at the end.

## Report back

Per finding: fixed (mechanical, verified how) / flagged for owner decision (why) / not reached
(ran out of runway). Final gate status. Commit hashes.
