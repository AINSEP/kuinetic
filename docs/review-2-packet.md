# Code review request: `designimation` — combined v1 + v2

You reviewed the **design** of this library earlier, before any code existed. Your review
shaped what was built (composition model, activation-vs-timeline split, fail-open cloaking,
per-effect reduced motion, parameter schema, packaging). **Now review the actual code.**

## Read the real repository

`-C` points at `/Users/la/Programming/designimation`, a git repo. **Read the source directly.**
Start with:

1. `docs/design.md` — the architecture, revised after your earlier review
2. `docs/catalog.md` — the ~237-name target catalog (only 81 are built)
3. `src/core/` — 21 modules, the engine
4. `src/effects/` — the catalog: entrance/scroll (CSS), scroll-mechanics, layout/FLIP, svg
5. `test/` — 224 tests
6. `scripts/verify-browser.mjs` — 23 real-Chromium assertions

**Do NOT read `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` anywhere on disk** (none should exist
in this repo; do not go looking outside it). Do not modify any file — this is review only.

## What it is

A standalone, MIT, framework-independent web animation library. npm + plain `<script>` from a
CDN. Vanilla HTML/CSS/JS + TypeScript. Not tied to any product.

Central bet: **the JS is a compiler, not an animator.** It parses `data-dsg` attributes,
validates parameters, and stamps CSS custom properties plus one compiled `animation`
declaration. On browsers with native scroll timelines, the entire scroll-reveal category runs
with zero JS after the initial scan.

~6,400 lines across src + test. 81 effect names over 24 primitives.

## What was built, in order

**v1 — the compiler and the CSS catalog.** Owned attribute grammar
(`effect [duration] [delay] [easing] key:value*`). Channel model for composition: each primitive
declares the CSS properties it owns, and a comma list compiles into one declaration with parallel
value lists only when those sets are disjoint. Activation (`on:enter`) and timeline
(`timeline:view`) kept as separate axes. Fail-open cloaking. Per-effect reduced-motion policy.
48 entrance/exit names from 8 primitives over 24 keyframe blocks, plus 10 scroll-reveal names.

**v2 — the JS-rendered categories.** A shared scroll scheduler (one passive listener per scroll
root, one rAF per dirtied frame, measurements cached against a resize epoch). A FLIP engine.
An SVG path interpolator. 23 names: pinning, scrollytelling, horizontal scroll, media scrubbing,
scroll-spy, snap; FLIP reorder/filter/sort/shuffle/grid-to-list/masonry/expand-to-modal,
accordion height, tab indicator; icon and blob morph.

v2 also changed core: `PrepareContext` gained the scheduler, a scroll-root resolver, capabilities,
and `invalidate()`; `prepare()` now receives validated, defaulted parameters through a typed
reader (`EffectParams`) instead of raw author strings; a `text` param type was added for selectors
and URL patterns that must never reach a stylesheet; attribute values can be quoted.

## Quality gates currently passing

- 224 unit tests (vitest, jsdom)
- 23 real-browser checks in headless Chromium
- eslint: `complexity` ≤ 10 **and** `sonarjs/cognitive-complexity` ≤ 10, both as errors, **zero
  disable comments anywhere in the repo**
- `tsc --noEmit` clean, `strict` + `noUncheckedIndexedAccess`

## What is NOT built

Roughly 156 of the 237 catalogued names. Entire categories missing: text & typography, numbers
& data viz, media & images, hover & pointer, ambient backgrounds, feedback & status, navigation,
forms, 3D & perspective, page transitions, gestures & physics. Most are CSS-tier and cheap; the
JS ones are not.

## What I want from you

Be blunt and specific, prioritised by impact. Read code before asserting — I would rather have
five findings grounded in actual files than twenty plausible ones.

1. **Did the design survive contact with implementation?** You recommended the channel model,
   the activation/timeline split, fail-open cloaking, the parameter schema, and a narrower
   promise. Look at how each actually landed. Where did the implementation quietly betray the
   design, or where was the design wrong once real?

2. **Correctness.** Where is this broken or fragile? I care most about: the compile path in
   `src/core/compile.ts`, the gate logic in `src/core/style-plan.ts`, the lifecycle in
   `src/core/animator.ts`, and the scroll scheduler's teardown and epoch handling.

3. **The seam between CSS-rendered and JS-rendered effects.** v1 assumed the browser owns the
   frame loop; v2 is the first consumer that needs JS to own it. Is `PrepareContext` the right
   boundary now, or still wrong in a way I have not hit yet?

4. **Testing.** 224 tests and 23 browser checks — what do they *not* prove? Which assertions are
   theatre? Three real defects were caught only by the browser harness (a measure cache that
   froze the one value that changes on scroll; pin tracking a sticky element whose whole purpose
   is not to move; `Z` parsed but emitting no segment). What is the next defect of that class,
   and what would catch it?

5. **What breaks at 237 names.** The catalog is 34% built. What in the current architecture will
   not survive tripling the effect count — registry, CSS payload, channel vocabulary, docs,
   semver, naming?

6. **Public-library readiness.** No build output, no bundle-size measurement, no exports map for
   subpaths, no README, no CI, no browser matrix. What is genuinely blocking a `0.1.0` publish
   versus what can wait?

7. **Anything you would rip out.** Over-engineering, premature abstraction, or a module that
   earns less than it costs.

Where you disagree with a decision, name the file, say why it is wrong, and give the alternative.
Concrete beats comprehensive.
