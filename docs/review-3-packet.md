# Code review request: `designimation` — deep adversarial sweep, architecture + security

You reviewed the design of this library before any code existed, then reviewed the v1+v2
implementation at commit `3d2db58` (before v3, before the lifecycle refactor). **Neither of your
prior reviews has seen what you're being asked to review now.**

## What changed since your last review

- **v3** — spring integrator, pointer-gesture recogniser, 3D/page transitions. `src/core/spring.ts`,
  `src/core/gesture.ts`, `src/effects/gestures/`. You have not seen any of this.
- **A lifecycle refactor**: `prepare()` now returns an `EffectInstance` instead of a bare
  `Cleanup`, gated through the animator. `src/core/instances.ts`, `src/core/animator.ts`.
- **Two collaborators extracted out of `Animator`** for responsibility separation:
  `src/core/js-effect-preparer.ts`, `src/core/dom-watcher.ts`.
- **`src/core/index.ts`** (the published `/core` npm subpath) was just narrowed to drop
  compiler-internal exports — check whether the new boundary is actually correct, not just
  smaller.
- Baseline commit for this review is `3104988` — `git log` may show a few commits past that by
  the time you read this (defect fixes landing concurrently); note the actual commit you observe.

## Read the real repository

`-C` points at `/Users/la/Programming/designimation`, a git repo. **Read the source directly, do
not infer from docs.**

1. `docs/design.md` — the architecture
2. `src/core/` — the engine, ~24 modules
3. `src/effects/gestures/`, `src/core/spring.ts`, `src/core/gesture.ts` — v3, unreviewed
4. `src/core/animator.ts`, `src/core/js-effect-preparer.ts`, `src/core/dom-watcher.ts` — the
   lifecycle refactor
5. `src/core/compile.ts`, `src/core/parse.ts`, `src/core/params.ts`, `src/core/js-params.ts` —
   the parser/compiler path; this is where untrusted `data-dsg` attribute strings from HTML
   become CSS custom properties, DOM writes, and (for JS-tier effects) executed logic
6. `test/` — what's actually asserted vs. what's merely exercised

**Do NOT read `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` anywhere on disk.** Do not modify any
file — this is review only, read-only sandbox.

## What it is

A standalone, MIT, framework-independent web animation library. Authors write
`data-dsg="fade-up 800ms"` on HTML; a compiler validates parameters and stamps CSS custom
properties plus a compiled `animation` declaration. JS-tier effects (gestures, springs, FLIP, SVG
morph, scroll orchestration) go through an `EffectInstance` lifecycle. Not published yet —
`0.0.0`, no consumers, so anything found now is free to fix.

## What I actually want: an adversarial sweep, not a design-fidelity check

Your last two reviews asked "did the design survive contact with implementation." This one is
different. **Assume the code is hostile input's first line of defense, not a trusted internal
module, and try to break it.** Two lenses, both mandatory:

### 1. Architecture flaws

- Where does an abstraction leak, or a responsibility sit in the wrong place, in ways that will
  compound as the catalog grows from 103 names toward ~237+?
- Where does the DI pattern (registry, capabilities, reporter, activation binder, scroll
  scheduler, root resolver, frame source, measurement — all supposed to be injected, no module
  singletons in logic) actually get violated, even subtly?
- Where does the "decision/effect separation" principle (`src/core/style-plan.ts` is the stated
  reference model — pure planner returns a description of writes, thin applier performs them)
  get violated elsewhere in the codebase?
- Is the newly-narrowed `/core` export surface (`src/core/index.ts`) actually the right boundary,
  or did it just move the problem — e.g., is there anything a legitimate primitive author now
  cannot do without reaching past the published barrier into deep imports?
- v3 gestures/spring: does the abstraction actually fit the two established renderer tiers
  (`css`, `js`), or is it a third thing wearing the `js` tier's clothes in a way that will cause
  friction for the next 20 gesture-family effects?

### 2. Security issues — this is the part your prior reviews never asked for

This library's entire input surface is: (a) author-authored `data-dsg` attribute strings on HTML
elements, (b) programmatic calls to `createAnimator()`/`anim.play()`, (c) pointer/scroll/DOM
events. In most consuming applications, at least one of these categories can end up influenced by
data the site owner does not fully control (CMS-authored HTML, user-generated content rendered
into a template, a query-string-driven landing page builder, etc.) — so treat `data-dsg` values
as **attacker-influenced input**, not developer-authored config, and hunt accordingly:

- **Injection into CSS/DOM.** `src/core/parse.ts`, `src/core/params.ts`, `src/core/js-params.ts`,
  `src/core/compile.ts` turn attribute strings into CSS custom property values and, for some
  param types, direct DOM/attribute writes. Is there any path where an attacker-controlled string
  reaches `element.style.setProperty`, a generated stylesheet rule, or an attribute write without
  going through the parameter schema's validation? Check every param `type` (`keyword`, `number`,
  `time`, `text`, whatever else exists) for whether its validator can actually be bypassed —
  and specifically the `text` param type, which the codebase's own history flags as added because
  "selectors and URL patterns... must never reach a stylesheet."
- **ReDoS.** Any regex in the parser/grammar (`parse.ts`, `splitTopLevel`, attribute grammar)
  that isn't provably linear against adversarial input (nested quantifiers, catastrophic
  backtracking on malformed `data-dsg` strings)?
- **Selector injection.** Anywhere a `text`-typed param or raw string flows into
  `querySelector`/`querySelectorAll`/`closest` — can a crafted string escape the intended
  selector scope or throw in a way that's exploitable (not just a crash)?
- **Prototype pollution / object injection.** Anywhere attribute-derived keys get used to index
  into a plain object, `Object.assign` target, or similar, without a safe-key check.
- **DOM clobbering.** Does anything trust `window.<name>` or a global that a page's own HTML
  (`<img name="...">`, `<form id="...">`) could clobber?
- **ReDoS/DoS via the scroll/mutation observers.** `src/core/scroll-scheduler.ts`,
  `src/core/dom-watcher.ts` — can a pathological DOM (huge fanout, rapid mutation) be used to
  force unbounded work per frame, defeating the coalescing the code claims to do? (Note:
  `scroll-nested.test.mjs` already tests bounded reads for one specific pattern — is there a
  pattern it doesn't cover that still blows the budget?)
- **Memory/listener leaks as DoS.** Every `prepare()` returns a `Cleanup`/`EffectInstance` that's
  supposed to fully tear down. Audit for a leaked listener, observer, or spring runner on any
  code path — repeated create/destroy cycles (e.g. a SPA repeatedly mounting/unmounting the same
  component) are a realistic attack surface for gradual memory exhaustion, not just a tidiness
  issue.
- **Information disclosure via the reporter.** `consoleReporter`/`collectingReporter` — does
  anything log attribute values, DOM content, or internal state in a way that could leak
  sensitive page data to the console/telemetry in production if a consumer wires
  `collectingReporter` to an analytics sink?
- **Supply chain / eval-adjacent patterns.** Any `new Function`, `eval`, or dynamic
  `import()` of a string built from external input, anywhere in `src/`?

For every security finding: show the exact file/line, the concrete attacker-controlled input that
reaches it, and a minimal reproduction (an HTML snippet or attribute string), not just "this
looks unsafe." If you looked for a category above and found nothing, say so explicitly — a
reviewed-and-clean result is a real finding too, not silence.

### 3. Correctness / bugs

Same as your prior two reviews' core ask, applied to what you haven't seen: v3
(`spring.ts`/`gesture.ts`/`src/effects/gestures/`), the lifecycle refactor
(`animator.ts`/`js-effect-preparer.ts`/`dom-watcher.ts`), and the narrowed `core/index.ts`. Where
is this actually broken or fragile, independent of the architecture/security lenses above? Four
defects were already found by manual testing this session and are logged in
`docs/live-testing-backlog.md` (gesture pointer-capture, a click-toggle activation bug, a frozen
scroll-linked parallax animation, a scroll-progress-tracks-but-nothing-moves horizontal-track bug)
— **read that file first so you don't waste time re-finding those same four**; the value you add
is everything past them. Fixes for those four may already be landing in parallel with your review
(you'll see the commits if so) — treat them as informational, not as something to re-verify.

## Format

Prioritized by actual impact, most severe first. Architecture and security findings can
interleave — don't force them into separate halves if a single finding is both (e.g., an
architectural leak that happens to also be the security hole). For each: file/line, concrete
failure scenario, and a proposed fix direction (not a full patch — this is review, not
implementation).
