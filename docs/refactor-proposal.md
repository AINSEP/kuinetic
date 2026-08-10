# Refactor Audit — 2026-08-10

**Auditor:** Refactor agent (propose-only)
**Scope:** four owner-named suspicion areas — effect-package duplication, `src/core/animator.ts`,
the `deferredInstance` wrapping pattern, and `src/core/index.ts`'s export surface.
**Baseline:** branch `main`, commit `226f94a`, all four gates green (321/321 tests, ESLint clean,
`tsc --noEmit` clean, 24/24 browser checks).

**Methodology note:** repo has 1,636 non-`node_modules` files, which per the Refactor persona's
Graphify Gate falls in the "ask before using Graphify" band (500–4,999). Skipped it: the dispatch
already named the four target areas by file/directory, so blast-radius mapping added no
information a direct read didn't already give me. Noting the call here for the record rather than
stalling on it.

No governance ADRs are currently active (`ADS-memory/governance/adrs/ADR-INDEX.md` is empty), so
none of the four areas below are constrained by cross-cutting governance rules.

---

## REF-001

```
Type:         B — Duplication
Priority:     Low
Affected:     src/effects/index.ts:19-24
              src/effects/gestures/index.ts:40-43
              src/effects/layout/index.ts:16-19
              src/effects/scroll-mechanics/index.ts:18-21
              src/effects/svg/index.ts:105-108
              src/effects/three-d/index.ts:81-84
```

**Finding**

Every one of the six `register*(registry)` functions across `src/effects/` has the same two-line
body:

```ts
for (const primitive of X_PRIMITIVES) registry.registerPrimitive(primitive)
return registry.registerPresets(X_PRESETS)
```

(`registerCore` in `src/effects/index.ts` additionally loops `COMBOS`, but the primitive+preset
half is identical to the other five.) `Registry` (`src/core/registry.ts`) already has
`registerPresets(presets: Preset[]): this` (line 42) doing the bulk-preset loop; there is no
symmetric `registerPrimitives`, so every package re-writes the primitive half by hand.

**Proposed Fix**

Add `registerPrimitives(primitives: Primitive[]): this` to `Registry`, directly mirroring the
existing `registerPresets` (same shape, one line):

```ts
registerPrimitives(primitives: Primitive[]): this {
  for (const primitive of primitives) this.registerPrimitive(primitive)
  return this
}
```

Then each `register*` body collapses to one line, e.g.:

```ts
export function registerGestures(registry: Registry): Registry {
  return registry.registerPrimitives(GESTURE_PRIMITIVES).registerPresets(GESTURE_PRESETS)
}
```

Keep every exported function name and signature (`registerGestures`, `registerLayout`, etc.)
exactly as-is — they're part of the packaging story described in `docs/design.md` §9 ("Packages
register separately so a consumer paying attention to payload can take only what they use"). This
proposal only dedupes the body, not the public shape.

**Risk Assessment**

Low. `registerPrimitives` is additive and structurally identical to the already-tested
`registerPresets`. The five call-site edits are pure eta-reduction of an already-tested loop —
`registerPrimitive` itself (with its duplicate-id guard) is unchanged and already covered by
`test/` (registry duplicate-registration behavior is exercised via the primitive catalogs loading
without throwing).

**Tests Required Before Refactor**

None new. Existing catalog-loading tests (anything that calls `createRegistry()` /
`registerGestures()` etc., which is most of `test/*.test.ts` transitively via `designimation()`)
already prove primitive+preset registration end-to-end; they'll catch any regression.

**Estimated Blast Radius**

6 files. 1 new method on `Registry`. No contract changes — no exported function's name, signature,
or behavior changes.

**Route Recommendation:** Programmer, single commit, all gates re-verified after.

---

## REF-002

```
Type:         B — Duplication
Priority:     Medium
Affected:     src/core/instances.ts:76-87 (deferredInstance definition)
              src/effects/scroll-mechanics/primitives.ts:300,311,321,332,343,364
              src/effects/gestures/primitives.ts:272,282,289,300
              src/effects/svg/index.ts:88
              src/effects/layout/primitives.ts:178,185,195
```

**Finding**

This is the "mechanical `deferredInstance` wrapping" the dispatch flagged. I checked every one of
the 14 call sites (grepped `deferredInstance` across `src/`) — `deferredInstance` is *never* called
any other way in the codebase. Every call site is the identical shape:

```ts
prepare: (el, params, ctx) => deferredInstance(() => prepareX(el, params, ctx)),
```

or, for the three primitives whose setup doesn't need `ctx` (`prepareSwipeable`, `preparePressable`,
`prepareFlipContainer`):

```ts
(el, params) => deferredInstance(() => prepareX(el, params)),
```

This is pure eta-expansion — the wrapper arrow function does nothing but re-forward its own
arguments into a thunk. It was introduced across all four effect files in the same lifecycle
refactor (`prepare()` returning `EffectInstance` instead of `Cleanup`), which is exactly the kind
of mechanical, low-variance conversion boilerplate this audit was asked to check for.

**Proposed Fix**

Add one small generic helper next to `deferredInstance` in `src/core/instances.ts`:

```ts
/**
 * Wrap a `(el, params, ctx) => Cleanup`-shaped setup function as a deferred `Primitive['prepare']`.
 *
 * Every JS primitive's `prepare` is `deferredInstance(() => setup(...args))` — this names that
 * composition once instead of re-deriving it at each of the library's fourteen call sites.
 *
 * @complexity O(1) time and space beyond the wrapped call.
 * @overallScore 100
 */
export function deferPrepare<Args extends unknown[]>(
  setup: (...args: Args) => Cleanup,
): (...args: Args) => EffectInstance {
  return (...args: Args) => deferredInstance(() => setup(...args))
}
```

Each call site becomes a direct reference, no wrapping arrow needed:

```ts
prepare: deferPrepare(preparePin),
```

TypeScript accepts `deferPrepare(prepareSwipeable)` (2-arg setup) being assigned to the 3-arg
`Primitive['prepare']` slot the same way the current hand-written 2-arg arrow is accepted — JS/TS
function assignability allows a function of smaller declared arity to satisfy a larger-arity
call signature, so no per-primitive arity gymnastics are needed.

This is additive: `deferredInstance` itself is untouched (it's the correct low-level primitive —
`deferPrepare` is sugar over the one composition every current caller happens to want).

**Risk Assessment**

Low. Behaviorally, `deferPrepare(preparePin)` and the current
`(el, params, ctx) => deferredInstance(() => preparePin(el, params, ctx))` are the same function
under eta-reduction — same arguments forwarded, same call timing (still built at catalog-definition
time, still deferred until `activate()`). No effect changes when it fires or what it's called with.

**Tests Required Before Refactor**

None new. Every primitive using this pattern already has direct coverage (`scroll-mechanics.test.ts`,
`gesture.test.ts`, `path-morph.test.ts`, `flip.test.ts`) that exercises `prepare` → `activate()` →
teardown for each one; those tests will catch any behavioral drift from the mechanical rewrite.

**Estimated Blast Radius**

5 files (1 new export in `instances.ts`, 4 files' `prepare` lines rewritten — 14 call sites total).
No exported type changes; `deferPrepare` is a new named export, additive to `src/core/instances.ts`.
Note `src/core/instances.ts` is not currently re-exported from `src/core/index.ts` at all (see
REF-004) — if `deferPrepare` should be reachable from `/core` for third-party primitive authors,
that's a one-line addition to make alongside REF-004, not a reason to block this proposal.

**Route Recommendation:** Programmer, single commit, all gates re-verified after.

---

## REF-003 / REF-004

```
Type:         C — Oversized Unit
Priority:     Medium
Affected:     src/core/animator.ts (520 lines, all of `class Animator`)
```

**Assessment**

`animator.ts` is the highest-churn file and, at 520 lines with 96 lines of class field
declarations, imports, and helper types before the class body even starts, it's the largest file
in `src/core/` by a wide margin (next is `scroll-scheduler.ts` at 395). But raw size is a weak
signal here on its own: every method is already individually documented with
`@complexity`/`@overallScore 100`, and the ESLint complexity gates (both `complexity` and
`sonarjs/cognitive-complexity` at 10, as errors, zero disable comments) already pass on this file
today — so this is not a per-function complexity problem. It's a class-level responsibility
question the automated gates can't see, because a class can hold arbitrarily many small, individually
clean methods and still be doing five jobs.

Walking the methods by what they actually coordinate:

| Concern | Members | Lines |
|---|---|---|
| Compile → style-plan → gate lifecycle (the class's actual job) | `process`, `install`, `resolveActivation`, `openGate`, `activate`, `release`, `reset` | ~161-425 |
| Cloak/watchdog | `start`, `uncloak` | 119-133, 387-390 |
| Scan entry points | `scan` | 145-152 |
| **JS-effect setup** | `prepareJsEffects`, `contextFor` | 294-346 |
| **DOM mutation watching** | `mutationObserver` field, `watch`, `handleMutation` | 96, 440-467 |
| Teardown-on-removal | `releaseTree`, `destroy` | 427-438 |

The five rows that aren't bolded are genuinely one cohesive responsibility — "run the compiled plan
lifecycle for one element, and know when to scan/uncloak/tear down the tree it lives in." That's
the class's actual single job, and every field it holds (`states`, `started`) is state that
lifecycle needs. I would **not** propose splitting that core any further; doing so would just
relocate the coordination problem into a second file without reducing it, since `process`,
`install`, `openGate`, and `activate` share the `InstanceState` they progressively build up.

The two bolded rows are real extraction candidates, because they're each cohesive *and* only
loosely coupled to the rest of the class through the same seam every other collaborator already
uses:

**REF-003 — extract JS-effect preparation (`prepareJsEffects` + `contextFor`, lines 294-346)**

This pair only reads `this.scheduler`, `this.rootResolver`, `this.capabilities`,
`this.respectReducedMotion`, and calls `this.reporter.warn`/`this.scheduler.invalidate` — every one
of those is already an injected collaborator, none of it is `this.states`/`this.started`/other
lifecycle-only state. It can become a factory function built once in `resolveCollaborators` (the
existing pattern — `activation.ts`, `scroll-scheduler.ts` etc. are already built there), e.g. a
`createJsEffectPreparer({ scheduler, rootResolver, capabilities, reporter, respectReducedMotion })`
returning `{ prepare(el, plan, signal, ledger): EffectInstance[] }`, injected into the constructor
exactly like `binder` or `scheduler` are today.

**REF-004 — extract mutation observation (`mutationObserver` field + `watch` + `handleMutation`,
lines 96, 440-467)**

This trio's only coupling to the rest of the class is two callbacks it invokes: "an element
appeared" (→ `this.scan`) and "an element was removed" (→ `this.releaseTree`) and "an attribute
changed" (→ `this.process`). That's exactly the shape of the existing `binder`/`scheduler`
injection points: a collaborator that takes callbacks at construction and owns its own
`MutationObserver` lifecycle (`disconnect()` on `destroy()`, same as `binder.destroy()` /
`scheduler.destroy()` today).

Note `releaseTree` (line 427) is used by *both* extraction candidates' natural homes: mutation
handling calls it directly, and `destroy()` also calls it. It should stay a method (or a bare
function taking `release` and the root) on `Animator` itself — moving it would just relocate the
coupling rather than remove it. Only `watch`/`handleMutation`/the observer field move.

**Why Medium risk, not Low:** both `test/animator.test.ts` (213 lines) and `test/lifecycle.test.ts`
(342 lines) almost certainly construct `Animator` directly and may assert on `observe` behavior or
JS-effect setup ordering through the public `Animator` surface rather than through a would-be
`DomWatcher`/`JsEffectPreparer` in isolation. Splitting is safe *for behavior* (both extractions are
pure "move plus inject" — no logic changes), but confirming that needs a pass over those two test
files before touching anything, and the `observe: boolean` / `shouldObserve` option on
`AnimatorOptions` would need to gate collaborator construction the same way it gates `watch()`
today, not silently start observing.

**Proposed Fix**

Two separate, independently-shippable extractions (do not do both in one change — each is its own
commit, gates re-verified after each, per "one refactor type per change"):

1. REF-003: extract `prepareJsEffects`/`contextFor` into an injected `jsEffectPreparer` collaborator,
   built in `resolveCollaborators` like every other default today.
2. REF-004: extract the `MutationObserver` field, `watch()`, and `handleMutation()` into an
   injected `domWatcher` collaborator, constructed only when `shouldObserve` is true (currently
   `watch()` is only called from `start()` when `this.shouldObserve`; the collaborator should
   preserve that "off by default, and not constructed at all when off" property rather than always
   building an inert watcher).

Both leave `Animator`'s remaining ~350 lines focused on the one job worth defending: the
compile → style-plan → gate → activate lifecycle for a single element and its subtree.

**Risk Assessment**

Medium for both (per the taxonomy's Type C default). No algorithmic change in either case — pure
move-plus-inject — but both touch the file with the deepest existing test surface in the repo, and
the constructor/`AnimatorOptions` wiring needs to add two more optional injected fields following
the existing pattern exactly (so `resolveCollaborators`, already flagged in this same file as
extracted "so the defaulting rules stay assertable on their own," is the right place to extend, not
a new location).

**Tests Required Before Refactor**

- Read `test/animator.test.ts` and `test/lifecycle.test.ts` fully first to confirm no test reaches
  into `mutationObserver`/`prepareJsEffects` as private internals (TypeScript would already block
  that, but a test could use `as any` — grep both files for `as any` and `(animator as`, before
  starting).
- Confirm existing `observe: true` tests still pass unmodified after REF-004 (they should, since
  the collaborator is meant to be behaviorally identical, just relocated).

**Estimated Blast Radius**

REF-003: 2 files (`animator.ts`, new `js-effect-preparer.ts` or similar). `AnimatorOptions` gains
one new optional injected field (additive, not breaking). REF-004: same shape, 2 files, one new
optional `AnimatorOptions` field. Neither changes `Animator`'s public methods or their signatures.

**Route Recommendation:** Programmer, two separate dispatches (REF-003 then REF-004, or either
order), full gate suite after each. If either extraction turns up a case where `test/animator.test.ts`
or `test/lifecycle.test.ts` asserts on private state directly, pause and route back to Refactor —
that would mean the test itself is coupled to `Animator`'s current internal shape, which is a
`SPEC_REVISION_REVIEW_REQUIRED`-flavored finding, not something to route around silently.

---

## REF-005

```
Type:         D — Structural Mismatch (public contract wider than its actual consumers)
Priority:     Medium — flagging for ARCHITECTURE_REVIEW_REQUIRED, not a mechanical fix
Affected:     src/core/index.ts:1-24
              package.json:11 ("./core": "./src/core/index.ts")
```

**Finding**

`src/core/index.ts` is not an internal convenience barrel — `package.json`'s `exports` map
publishes it as its own subpath (`designimation/core`), alongside the root package and `/effects`.
That means every name it re-exports is part of the library's versioned public contract, the same
way `docs/design.md` §12 treats preset visuals as "the API" that can't change without breaking
consumers.

I checked who actually imports through this barrel: **nothing in the repo does.** Every file under
`src/effects/` and every file under `test/` imports individual core modules directly
(`../../core/types.js`, `../../core/registry.js`, `../../core/instances.js`, etc. — 20+ distinct
deep-import call sites, `grep -rln "core/index" src scripts demo development` returns nothing).
`src/index.ts` is the *only* file that touches `core/index.ts`, via `export * from './core/index.js'`.
So this file's entire reason to exist is external consumers — and it currently re-exports
essentially every named export from every core module, not just the ones a consumer would need.

Cross-checking against what `docs/design.md` §6 actually describes as the third-party authoring
contract ("ESM core: app developers — `createAnimator({ effects: [fadeUp, tilt] })` — effect
**objects**, statically visible to bundlers"), a primitive author needs: `Primitive`,
`ParameterSchema`/`ParamSpec`, `EffectParams`, `PrepareContext`, `Cleanup`, `EffectInstance`,
`Channel`/`CHANNEL`, `Activation`, `Timeline`, `PerfClass`, `ReducedMotionPolicy`, plus
`Animator`/`createAnimator`/`AnimatorOptions`, `Registry`, and the reporter/`play()` surface. That's
roughly the *type*-heavy half of the file.

The other half is compiler-internal machinery no primitive author or `createAnimator()` caller ever
needs to call directly, exported anyway because `export * from './types.js'` and the individual
module re-exports are unconditional:

- `compile`, `CompiledPlan`, `Entry` (line 9-10) — the attribute-spec → render-plan compiler.
- `applyStylePlan`, `planStyles`, `Gate`, `StylePlan`, `StylePlanInput` (22-23) — this is the exact
  "pure planner returns a description of writes, thin applier performs them" module the dispatch
  named as this project's *reference pattern* for decision/effect separation. It's compiler-internal
  machinery, not something a consumer calling `createAnimator()` or authoring a primitive ever needs
  to import.
- `readAttributes`, `resolveConfig`, `toThresholdRatio`, `ElementAttributes`, `ElementConfig` (11-12)
  — `data-dsg-*` attribute parsing/resolution.
- `parse`, `splitTopLevel` (13) — the `data-dsg` grammar parser.
- `resolveParams`, `validate` (14) — raw-string → `EffectParams` resolution (a primitive receives
  the *result* of this in `prepare`, never calls it itself).
- `claimedChannels`, `describeConflicts`, `findConflicts`, `ChannelClaim`, `Conflict` (7-8) —
  compiler-internal channel-collision analysis.
- `applyStagger`, `indexStaggerGroup` (21) — `data-dsg-stagger` index computation, wired
  automatically by `scan()`.
- `suggest` (17) — the "did you mean" dev-mode hint, called internally by whatever reports unknown
  effect names.
- `export * from './types.js'` (24) additionally re-exports `InstanceState` — pure animator-internal
  bookkeeping (`fingerprint`, `controller: AbortController`, `ledger`, `status`) that a consumer has
  no legitimate reason to construct, inspect, or receive.

I'm not counting `createActivationBinder`/`ActivationBinder` or `collectingReporter` as clear
over-exposure — both are legitimate `AnimatorOptions` injection points (`binder`, `reporter`) an
advanced consumer might genuinely supply a custom implementation for, matching the "dependency
injection everywhere" constraint this project holds itself to.

**Why this matters concretely, not just aesthetically:** shipping `compile()`/`CompiledPlan`,
`planStyles()`/`StylePlan`, the parser, and the channel-conflict analyzer as public means any future
internal refactor of the compiler pipeline — splitting `compile` into two passes, changing
`CompiledPlan`'s shape, renaming a `StylePlan` field — becomes a breaking change for the published
`/core` subpath, even though (by the grep above) *no current code path, internal or external, needs
any of them exposed.* The project is at `0.0.0` pre-release, so the real-world blast radius of
narrowing this today is close to zero — which is exactly the moment to fix it, before any consumer
exists to break.

**Proposed Fix**

Narrow `src/core/index.ts` to two tiers:
1. Runtime surface: `Animator`, `createAnimator`, `AnimatorOptions`, `ATTR`, `Registry`,
   `ResolvedEffect`, `play`/`resolveTargets`/`toAttributeValue`/`PlaybackHandle`/`PlayOptions`/`Target`,
   `Reporter`/`consoleReporter`/`silentReporter`/`collectingReporter`/`CollectingReporter`,
   `createActivationBinder`/`ActivationBinder`/`ActivationBinderOptions`, `detect`/`Capabilities`.
2. Authoring-contract types (replace the blanket `export * from './types.js'` with a named list):
   `Primitive`, `Preset`, `ParameterSchema`, `ParamSpec`, `EffectParams`, `PrepareContext`,
   `Cleanup`, `EffectInstance`, `Channel`/`CHANNEL`, `Activation`, `Timeline`, `PerfClass`,
   `ReducedMotionPolicy`, `inertInstance`.

Drop from the public barrel (they remain fully usable internally via deep import, since that's
already how every internal caller reaches them today): `compile`/`CompiledPlan`/`Entry`,
`applyStylePlan`/`planStyles`/`Gate`/`StylePlan`/`StylePlanInput`, `readAttributes`/`resolveConfig`/
`toThresholdRatio`/`ElementAttributes`/`ElementConfig`, `parse`/`splitTopLevel`, `resolveParams`/
`validate`, `claimedChannels`/`describeConflicts`/`findConflicts`/`ChannelClaim`/`Conflict`,
`applyStagger`/`indexStaggerGroup`, `suggest`, `resetCapabilities`, and `InstanceState`/
`ResolvedParams` from `types.ts`.

**This is not a pure mechanical refactor** — narrowing a published subpath's export list is a
product/API decision about what the library promises to support, not just a code-quality cleanup,
even though nothing currently breaks. Flagging per the persona's escalation rule
(`ARCHITECTURE_REVIEW_REQUIRED`) rather than treating it as routine — it should get an explicit
owner decision before a Programmer executes it, and ideally a one-line note in `docs/design.md` (or
wherever the eventual public API doc lives) recording that `/core`'s export list is a deliberate,
reviewed contract rather than "whatever `export *` happened to pick up."

**Risk Assessment**

Low *mechanically* (nothing internal imports through the barrel, confirmed by grep — removing
exports can't break any current internal caller), but the change itself is a scope/product decision,
which is why priority is listed as Medium despite low mechanical risk.

**Tests Required Before Refactor**

None currently exercise the barrel (confirmed — no test file imports from `core/index`), so there's
nothing to break in the test suite itself. If the owner accepts this proposal, consider adding a
`test/public-api.test.ts` (or similar) that imports from `designimation/core` and asserts the
intended surface, so the boundary stays intentional going forward rather than drifting back to
`export *` under time pressure.

**Estimated Blast Radius**

1 file changes (`src/core/index.ts`). 0 internal call sites need updates (nothing imports through
the barrel). Public contract: narrows a currently-unreleased (`0.0.0`) subpath — no known consumers
to break.

**Route Recommendation:** Escalate to Coordinator as `ARCHITECTURE_REVIEW_REQUIRED` for an explicit
accept/reject on the export list before dispatching to Programmer. If accepted, it's a single
mechanical commit (delete lines, no logic touched).

---

## Summary for Coordinator

| ID | Type | Priority | Effort | Can execute independently? |
|---|---|---|---|---|
| REF-001 | B — Duplication | Low | Low | Yes |
| REF-002 | B — Duplication | Medium | Low | Yes |
| REF-003 | C — Oversized Unit | Medium | Medium | Yes (before or after REF-004) |
| REF-004 | C — Oversized Unit | Medium | Medium | Yes (before or after REF-003) |
| REF-005 | D — Structural Mismatch | Medium | Low (mechanical) / requires owner decision | Needs `ARCHITECTURE_REVIEW_REQUIRED` sign-off first |

Suggested execution order if all are accepted: REF-001 and REF-002 first (independent, low-risk,
no test-file reading required), then REF-005's decision (cheap either way, unblocks nothing else),
then REF-003/REF-004 last (the only ones requiring a pre-read of `test/animator.test.ts` and
`test/lifecycle.test.ts` before starting).

No area produced a "nothing actionable" result — all four owner-named suspicion areas had at least
one concrete, file-and-line-referenced finding.
