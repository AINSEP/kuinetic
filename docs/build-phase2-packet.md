# Build request: `designimation` — comprehensive catalog build-out + showcase + one bug fix

This is a **build task**, not a review — you have full read/write access to this repo (`-C`
points at `/Users/la/Programming/designimation`, git, branch `main`, currently clean). Commit
incrementally as you go; only committed work survives. One logical unit of work per commit (e.g.
one catalog section, or the bug fix, or the carousel) — don't batch unrelated changes into one
commit.

**Do NOT read `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` anywhere on disk.**

## Fix this first (small, unblocks nothing else, but do it before the big work)

**D5 — the replay FAB doesn't work.** `demo/showcase/replay.js`'s `replayEveryEffect()` calls
`anim.play(el, el.getAttribute('data-dsg'))` directly. `Animator.process()`
(`src/core/animator.ts:181`) has a config-identity short-circuit —
`if (existing?.fingerprint === fingerprint) return` — so replaying an already-installed effect
with the same attribute value is a silent no-op. There is a dedicated method for this exact case,
`Animator.reset(el)` (`src/core/animator.ts:352`), whose own doc comment says *"Needed for
replay... playing the same effect twice was previously a no-op."* Fix `replayEveryEffect()` to
call the reset/replay path before `play()` for each element (check whether `reset` is exposed on
the public handle returned by `designimation()`/`createAnimator()` — if not, that's part of the
fix too, since a demo page should only need the public API). Verify by actually clicking the FAB
in a real browser (headless Chromium via the repo's own `playwright-core` is fine) and confirming
an already-fired `on:load` effect visibly re-runs, not just that no error is thrown.

## The main task

Read `docs/catalog.md` in full — it's the ~237-name target catalog, organized into sections A–O.
**103 names are currently built** (v1 CSS entrance/exit/scroll-reveal, v2 scroll-mechanics/FLIP/
SVG-morph, v3 gestures/spring/3D). The rest — **roughly 134 names across sections C (partially),
D, E (partially), F, G, I (partially), J (partially), K, L (partially), M, N (partially), O** —
are catalogued but have no implementation. Build out as much of this as you can while holding
every existing quality bar (below) — **do not sacrifice correctness or the quality gates for raw
name-count.** If you run out of runway, stop cleanly, commit what's done, and write a clear
"remaining work" list rather than rushing the last stretch.

**Explicitly out of scope:** WebGL/canvas particle systems and wave meshes
(`docs/catalog.md` line 280–281 — the library only ever adapts to a user-supplied canvas, it
never renders particles itself). Do not build toward this.

### Conventions to follow (read the existing code first, don't guess)

- Look at `src/effects/index.ts`, `src/effects/gestures/`, `src/effects/three-d/` for the
  registration pattern (`registerX(registry)` functions, `Primitive`/`Preset` shape,
  `Registry.registerPrimitives()`/`registerPresets()`).
- CSS-tier effects: keyframes go in `src/css/` (see `src/css/scroll.css`, `src/css/three-d.css`
  for the `@layer dsg.effects` pattern and how `--dsg-*` custom properties parameterize a
  keyframe). Channel model: each primitive declares which CSS properties it owns
  (`docs/catalog.md`'s legend: `o` opacity, `t` translate, `s` scale, `r` rotate, `f` filter,
  `c` clip/mask, `x` other) so composition-conflict detection works.
- JS-tier effects: follow the `EffectInstance`/`deferPrepare()` pattern in
  `src/core/instances.ts` and the existing gesture/scroll-mechanics primitives as the template —
  do not hand-write the wrapping boilerplate `deferPrepare` already exists to avoid.
- Dependency injection: no module singletons in logic. Any new collaborator (a new scheduler, a
  new observer, etc.) gets constructor-injected like `scheduler`/`binder`/`reporter` already are.
- Decision/effect separation where it applies: `src/core/style-plan.ts` is the reference model —
  a pure planner returns a description of writes, a thin applier performs them.
- Function docs: purpose, params, returns, `@complexity`, `@overallScore` — see any existing
  function in `src/core/` for the exact format expected.
- **Complexity ≤ 10 on both `complexity` and `sonarjs/cognitive-complexity`, as errors. Zero
  `eslint-disable` comments exist in the repo today — keep it that way.** If a new primitive
  would need one, restructure instead (extract a helper, split responsibilities) rather than
  disabling the rule.
- Accessibility boundaries the catalog already states — respect them: hover effects need a
  `:focus-visible` equivalent and a coarse-pointer fallback (section I); layout/FLIP effects
  animate elements you control but don't own `aria-expanded`/focus/keyboard handling (section H,
  same boundary applies to nav in section M); counters expose final value to assistive tech and
  never spam `aria-live` mid-animation (section F); continuous ambient motion uses
  `reducedMotion: 'disable'`, not `'shorten'` (section J).

### Showcase pages — organized by these 8 categories, comprehensive (this is meant to be read as documentation, not a sampler)

Map `docs/catalog.md`'s sections onto these owner-specified categories and build/extend
`demo/showcase/*.html` pages accordingly (reuse the existing `reveals.html`/`scroll.html`/
`interactive.html` where a category already has a page; add new pages for categories that don't):

1. **Scroll-triggered** — section B (parallax family, scroll-progress) + section A's scroll-reveal
   subset. `scroll.html` exists; extend it.
2. **Hover/interaction** — section I in full. `interactive.html` exists; extend it.
3. **Page/transitions** — section L in full.
4. **Feedback** — section K in full.
5. **Ambient/polish** — section J in full.
6. **Text animations** — section D in full.
7. **Layout/scroll mechanics** — sections C and H combined.
8. **3D/depth** — section N in full (this also covers `card-flip-x`/`card-flip-y`, already built —
   D2's fix already landed, so this should demo cleanly now).

(Sections E, F, G and O don't map 1:1 to the 8 categories above — fold E/G into a "Media & SVG"
page and F/O into a "Data & forms" page, or wherever fits your page structure best; use judgment,
just don't drop them silently.)

Every new showcase page needs the same `<script src="./replay.js"></script>` tag the existing
three already have (per how `replay.js` was built — one script, shared, so new pages get the FAB
for free) and should follow the existing pages' visual style (`demo/showcase/style.css`) rather
than introducing a new one.

### One more feature: auto-advancing carousel with frosted edges

A row of divs that cycles automatically on a timer, with a frosted/faded-white mask at both edges
(edge content fades toward white/transparent rather than hard-clipping — a CSS gradient-mask on
the container is the standard technique). Compose it from what's being built/exists rather than
writing one-off bespoke logic where a primitive already fits — `mask-reveal` (section G) or a
plain CSS gradient-mask for the frosted edges; a FLIP-based reorder or a `parallax-x`/translate
loop for the auto-cycling, whichever fits the existing architecture better. Add it to whichever
showcase page it fits best (or its own).

## Quality bar — same four gates as everywhere else in this repo, must stay green throughout

- `npm test` (currently 324/324)
- `npx eslint src test` (clean)
- `npx tsc --noEmit` (clean, `strict` + `noUncheckedIndexedAccess`)
- `npm run verify:browser` (currently 24/24)

Run all four after each meaningful batch of work, not just once at the end. For new JS-tier
effects that need real-browser proof (jsdom can't evaluate `@keyframes`/`animation-timeline`),
add focused checks to `scripts/verify-browser.mjs` or `test/browser/` following the existing
pattern — you don't need exhaustive per-effect browser coverage for 130+ names, but spot-check
the ones with real runtime behavior (anything JS-tier, anything using `animation-timeline`).

## Report back

What you built (by catalog section, with name counts), what you fixed (D5), what's left and why
(ran out of scope/time vs. genuinely blocked on something), final gate status, and commit
hashes.
