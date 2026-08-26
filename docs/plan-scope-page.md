# Universal `target:` + `scope:page` — implementation plan

Status: **plan only, no code written.** Read-only survey of `main` at `ceb1c3c`.

The settled decisions this plan implements (owner's, not up for debate here):

- **`target:` always means "search inside myself"** — descendant-scoped.
- **`scope:page` means "search the whole document."** One new key, one value for now, shaped so
  `scope:parent` / `scope:section` can be added later without a rename.
- **The host owns the lifecycle** (settled 2026-08-26, was D1). One `InstanceState` on the authored
  element. Only the *writes* relocate to the matched descendants. See §2.
- **`data-kui-fx` and `data-kui-rm` go onto the matches; `data-kui-state` stays on the host**
  (settled 2026-08-26, was D6). See §2.1.

Five decisions remain open — §1.

Everything below is either **VERIFIED** (I read the line and say where) or **ASSUMED** (stated as
such). Nothing here was run — no builds, no tests, per the brief.

---

## 0. Corrections to the brief, before anything else

Five things in the brief are wrong or incomplete. Each one changes the work.

### 0.1 There are six `target:` primitives and the brief's table names four of them wrongly

`grep -rn "  target: {" src/` returns **exactly 6 lines**, and none of the four ids in the brief's
table is the primitive's actual `id`. The table used the *warn labels* and *preset names*.

| primitive `id` | declared at | resolves with | scope | cardinality |
|---|---|---|---|---|
| `scroll-progress` | `src/effects/scroll-mechanics/primitives.ts:686` | `ctx.doc.querySelectorAll` (`:229`) | **document** | all |
| `horizontal-track` | `:700` | `el.querySelector` (`:276`) | descendant | **first only** |
| `media-scrub` | `:721` | `ctx.doc.querySelectorAll` (`:491`, `:502`) | **document** | all |
| `scroll-spy` | `:738` | *both* — see 0.2 | **both** | all |
| `scroll-snap` | `:791` | `el.querySelectorAll` (`:629`) | descendant | all |
| `step-progress` | `src/effects/forms/primitives.ts:266` | `ctx.doc.querySelectorAll` (`:240`) | **document** | all |

`step-progress` is missing from the brief entirely. It is document-scoped **only when `target:` is
authored** — with no `target:` it falls back to `el.children` (`forms/primitives.ts:240`). So it is
a fifth document-scoped resolution site, not four.

The warn labels are also stale: `scroll-mechanics/primitives.ts:228` passes `'scrollytelling-step'`
and `:274` passes `'horizontal-scroll'` to `resolveTarget`. Those are *preset* names. The primitive
backs more than one preset, so an author who wrote `scroll-progress` gets told to fix
`scrollytelling-step`. Minor, but fix it while touching these lines (step 2).

### 0.2 `scroll-spy` resolves the same `target:` two different ways — a per-primitive `scope` default cannot express it

This is the finding that breaks the brief's proposed migration path outright.

- Section form (`scroll-spy.ts:117`, `markLinks`): `doc.querySelectorAll(selector)` — **document**.
  It has to be; the nav link lives in another subtree.
- Container form (`scroll-spy.ts:303`): `el.querySelectorAll(linksSelector)` — **descendant**.
  Its `sections:` (`:299`) is descendant-scoped too.

One primitive, one `ParameterSchema`, one `default:` field, two required defaults. The brief's
"the three document-scoped primitives declare `scope: 'page'` as their own default, so nothing
breaks" **does not hold for `scroll-spy`**. The fix is in step 1 and it is cheap, but it has to be
designed rather than assumed.

### 0.3 The "94 generated rules" are 91 selectors and **none of them is generated**

Measured by parsing every selector list in `src/css/*.css` (comments stripped, split on commas,
checked for a combinator + a real compound after the `[data-kui-fx~='…']`):

- **91 selectors** where the fx element reaches a descendant or sibling.
- **0** of them in `presets.generated.css`. All 91 are hand-written, in five files:
  `forms.css` 44, `three-d.css` 18, `svg.css` 13, `base.css` 12, `scroll.css` 4.
- **386 selectors** where the fx element is itself the animated one (241 of those generated).
- Only **16 distinct preset names** reach past themselves:
  `card-flip-x`, `card-flip-y`, `checkbox-draw`, `flip-card`, `hamburger-to-x`,
  `input-underline-grow`, `label-float`, `play-to-pause`, `plus-to-minus`, `radio-fill`,
  `sequence-scrub`, `step-progress`, `strength-meter`, `submit-to-spinner-to-check`,
  `toggle-morph`, `video-scrub`.

Why it matters: this is not a generator change, it is a **16-name allowlist**. That is small
enough to declare per-preset and assert in a test (step 7), instead of being a standing hazard.

### 0.4 Blocker 1 (cloak) is real but is not the failure the brief describes

The brief says: "With `target:h1` on an `<article>`, the whole article gets cloaked and the `h1`
that actually animates gets no pre-JS flash protection."

The first half is right. The second half is not. `opacity: 0` on the `<article>` composites the
**entire subtree** to invisible — a child with `opacity: 1` still renders at the parent's zero. So
the `h1` gets *more* hiding pre-JS, not less. There is no flash of the `h1`'s rest state.

The two real defects, both of which the plan must answer:

1. **Over-cloaking.** The whole host subtree goes blank pre-JS, not just the animated descendant.
   On a `target:` over a large container that is a big blank region for up to 2s in the
   script-blocked case (`kui-cloak-release` at `presets.generated.css:1566`).
2. **The release key.** The layer releases per element via `:not([data-kui-state])`
   (`generate-preset-css.mjs:137`). Today `install` stamps `ATTR.state` on the host through
   `state.attributes` (`animator.ts:311` + `style-plan.ts:93`). **If retargeting moves
   `data-kui-state` onto the matched descendants, the host never releases and sits at opacity 0
   for two full seconds.** That is the silent break — and it is a design decision, not an
   inherent property. **Settled by D6: `data-kui-state` stays on the host.** See §2.1 and step 6.

`base.css:98` (the brief says `:106`; it has moved) —
`html[data-kui-cloak] [data-kui][data-kui-reveal]:not([data-kui-state])` — needs both attributes on
one element, and with `target:` the author still writes both on the host. It keeps working
unchanged. It is not a compounding problem.

**The genuine, unfixable-in-CSS gap is `scope:page`**, not `target:`. A cloaking preset whose
matches live outside the host's subtree cannot be cloaked at all — CSS cannot resolve a selector
that is the *value* of an attribute. Owner decision D4.

### 0.5 `channels.ts` and `stagger.ts` were **not** touched by the merge

The brief asks me to flag where the plan depends on just-moved code. Verified against
`git show --stat bd446b1`:

- **Moved:** `parse.ts`, `compile.ts`, `types.ts`, `animator.ts`, `params.ts`, `style-plan.ts`,
  `js-effect-preparer.ts`, `scroll-mechanics/primitives.ts`, `forms/primitives.ts`.
- **Untouched:** `channels.ts`, `stagger.ts`, `dom-watcher.ts`, `owned-styles.ts`,
  `step-marking.ts`, `scroll-spy.ts`.

So steps 4 (ledgers), 8 (`--kui-i`) and 9 (rescan) sit on stable ground. Steps 5 and 6 sit on
`compile.ts`/`animator.ts`, both of which moved a lot (compile +224, animator +386) — re-read
`resolveEntries` and `install` at the moment coding starts.

---

## 1. Owner decisions

### Settled — 2026-08-26

| # | Decision | Answer |
|---|---|---|
| **D1** | Who owns the lifecycle — the host, or each match? | **The host.** One `InstanceState` on the authored element; only the writes relocate. §2. |
| **D6** | Where do the library-owned attributes go? | **`data-kui-fx` + `data-kui-rm` onto the matches, `data-kui-state` on the host.** §2.1. |

These were the two that could not be deferred; everything downstream is shaped by them, and every
step below now assumes them rather than branching on them.

### Still open — five

| # | Decision | Recommendation |
|---|---|---|
| **D2** | `scroll-spy`'s two-form scope default (0.2) | Schema `default: ''`, each form supplies its own fallback. Works because `readParams` (`js-params.ts:89`) seeds declared defaults, so `''` is the only way to say "unset" — exactly what `target: { default: '' }` already does. |
| **D3** | `horizontal-track` first-match vs all-match | **All-match resolution, first-match use, warn when >1.** See §3. |
| **D4** | Cloak under `scope:page` (0.4) | Refuse: `compile` warns and drops `scope:page` on any preset with `cloak: true`. Their whole purpose is pre-JS flash protection that CSS cannot provide off-subtree. |
| **D5** | Does a later-inserted element join a live `target:`? | **No in v1.** See step 9. All six existing primitives already resolve at install. Document the limit rather than build a match registry nobody asked for. |
| **D7** | Stagger numbering over a targeted set: per-parent or flat document order? | **Per-parent**, matching `createStepMarker` (`step-marking.ts:136-140`) — the one place the library already answered this question. See step 8. |

None of the five blocks the start of coding. D2 lands inside step 1, D3 inside step 3, D4 inside
step 7, D7 inside step 8, and D5 is a decision to *not* build step 9. Steps 4, 5 and 6 — the
structural core — depend on none of them.

---

## 2. The architecture — settled (D1)

**The host owns the lifecycle. Only the *writes* relocate.**

One `InstanceState` on the authored element. The host keeps `data-kui`, `data-kui-state`, the
activation binding, the gate, and the lifecycle events. What moves to the matched descendants is:
inline properties, `data-kui-fx`, `data-kui-rm`, `--kui-i`, and the per-match `EffectInstance`s.

The rejected alternative was "each match becomes a virtual host" — its own `InstanceState`, gate,
binding and events. Recorded here so it is not re-proposed. Reasons it lost, each checkable in the
source:

- One attribute should produce one `kui:start`. Per-match lifecycles would make `fade-up target:li`
  on a 20-item list fire 20 `kui:start`s from one authored attribute. `control.ts` and `play()`
  both take a host.
- `on:`/`timeline:`/`threshold:` are **already hoisted element-wide** by `parse.ts`'s `HOISTS`
  (`:308`) with the comment "one element has exactly one activation and one timeline". Per-match
  lifecycles would contradict a decision the parser already made.
- `release()` already destroys every instance in `state.instances` (`animator.ts:782`). With the
  host owning the lifecycle, the only structural gap is that the *ledgers* are singular. That is
  one contained change.
- `states` is a `WeakMap<Element, InstanceState>`; per-match lifecycles would need a match→host
  back-reference or `releaseTree` (`animator.ts:815`) tears down half a group.

**What this settles, concretely:** blocker 3 is no longer "the largest piece of work". It is "make
two fields plural" — `InstanceState` keeps its single gate, single `AbortController`, single
`status`, single `direction`, single `releaseActivation` and single event stream. Nothing in
`activate`/`deactivate`/`reverseFrom`/`cancel` changes shape. Only `ledger`/`attributes` go plural,
and `release()`'s one-`restore()`-each becomes one-`restore()`-per-element. Step 4 is still the
biggest single diff in the plan, but it is now a bounded mechanical change with no behaviour
change at all, and it can land on its own.

### 2.1 Attribute placement — settled (D6)

| attribute | host | matches | why |
|---|---|---|---|
| `data-kui` | ✅ authored | ❌ | it is the authored directive; stamping it on matches would make `scan()` install them again |
| `data-kui-state` | ✅ | ❌ | it is the cloak's per-element release key (`generate-preset-css.mjs:137`). Moving it leaves the host cloaked at `opacity: 0` for the full 2s `kui-cloak-release` window — see 0.4 |
| `data-kui-fx` | only for the host's own group | ✅ | the CSS that animates keys on it |
| `data-kui-rm` | ✅ | ✅ | `base.css` pairs it with `data-kui-fx` **on the same compound** — `[data-kui-rm][data-kui-fx~='label-float'] ~ label`. Wherever `fx` goes, `rm` must go, or the reduced-motion layer stops matching |

The `data-kui-rm` pairing is verified, not inferred: 12 of the 91 reaching selectors in 0.3 are in
`base.css` and every one of them leads with `[data-kui-rm][data-kui-fx~='…']`.

---

## 3. `horizontal-track`: first-match vs all-match (D3)

Verified: `prepareHorizontal` (`scroll-mechanics/primitives.ts:273-282`) calls `el.querySelector`
— one match. Everything else in the library takes all matches. CSS has no first-match concept.

**Recommend: resolve with `querySelectorAll`, use `[0]`, warn when `length > 1`.**

Why not true all-match: `prepareManagedTrack` makes the *host* a sticky, `overflow: hidden`,
spacer-reserved window sized from `distance:` (`:306-320`). Two tracks would share one window but
each needs its own `trackTravel` measurement (`:295`), so they would desync and translate at
different rates inside one clip. That is not "all-match" behaviour, it is a bug with a plural
selector.

Why not leave it silent: the current code makes a broad selector *look* like it worked. A warn is
the honest middle — the author is told their selector matched more than the effect can use.

**Breakage if normalised as recommended: none.** `demo/index.html:1532` and `demo/scroll.html:1751`
both use `target:.track` against a single `.track`. Verified — those are the only two
`horizontal-scroll` usages in `demo/`.

**Breakage if pushed to true all-match: the two demos still pass** (one match each), and no test
covers >1. That is exactly the hazard — it would ship untested. Do not.

---

## Ordered steps

Each step is independently landable and independently verifiable. Steps 1–4 change no behaviour at
all; they are the ones to land first and separately.

---

### Step 1 — Give the six primitives an explicit `scope`, defaulting to today's behaviour

**Files:** `src/effects/step-marking.ts` (new helper), `src/effects/scroll-mechanics/primitives.ts`,
`src/effects/scroll-mechanics/scroll-spy.ts`, `src/effects/forms/primitives.ts`.

Add to `step-marking.ts`, beside `resolveTarget`:

```ts
export type TargetScope = 'self' | 'page'

/** Resolve a validated `target:` selector under a scope. `resolveTarget` has already run. */
export function queryScoped(
  el: Element, ctx: PrepareContext, selector: string, scope: TargetScope,
): Element[]
```

`scope === 'page' ? [...ctx.doc.querySelectorAll(selector)] : [...el.querySelectorAll(selector)]`.

Then each of the six declares `scope: { type: 'keyword', default: '', cssProperty: '--kui-scope',
values: ['self', 'page'] }` and reads it as `params.text('scope') || <its own default>`:

| primitive | file:line | default | note |
|---|---|---|---|
| `scroll-progress` | `scroll-mechanics/primitives.ts:686` | `'page'` | today's `ctx.doc.querySelectorAll` (`:229`) |
| `media-scrub` | `:721` | `'page'` | today's, both sites (`:491`, `:502`) |
| **`step-progress`** | **`forms/primitives.ts:266`** | `'page'` | **the fifth document-scoped resolver, missing from the brief entirely.** `ctx.doc.querySelectorAll` at `:240`, but *only* when `target:` is authored — with no `target:` it uses `el.children` and no scope applies |
| **`scroll-spy` section form** | `scroll-mechanics/primitives.ts:738` | `'page'` | **must stay page** — `markLinks` (`scroll-spy.ts:117`) resolves document-wide because the nav link it marks lives in another subtree |
| **`scroll-spy` container form** | same declaration | `'self'` | **the same parameter, resolved descendant-scoped** at `scroll-spy.ts:303`; its `sections:` (`:299`) too |
| `horizontal-track` | `:700` | `'self'` | today's (`:276`) |
| `scroll-snap` | `:791` | `'self'` | today's (`:629`) |

The two bolded rows are the corrections from §0.1 and §0.2, restated here so this step is
implementable without cross-referencing.

**`scroll-spy` is why `default: ''` is load-bearing, not a style choice.** It is one primitive with
one `ParameterSchema` and one `default:` field, but two forms that need opposite answers — and
`readParams` (`js-params.ts:89`) seeds `out[name] = spec.default` for every declared parameter
*before* reading authored values, so any non-empty schema default makes `params.text('scope', X)`'s
fallback unreachable and the second form impossible. `''` is the only way to spell "unset", which
is exactly why `target: { default: '' }` is already written that way on all six. This is **D2**,
still open, but no alternative shape is known to work.

`values: ['self','page']` is what leaves room for `parent`/`section` later — adding a value is a
one-line change, and `validate` (`params.ts:106`) already rejects anything not listed.

**What could go wrong:** `keyword` params with a `cssProperty` do reach the stylesheet
(`resolveParams` only skips `type: 'text'`, `params.ts:360`). `--kui-scope` would be written inline
and read by nothing. Either accept it as harmless (it matches how `--kui-target` is *declared* on
all six but never written, since `text` is dropped) or declare `scope` as `type: 'text'` with a
`values` list — `validate` checks `spec.values` at `params.ts:111` *before* the `text` short-circuit
at `:114`, so a `text` param with `values` is still validated as a closed set and is still dropped
before the stylesheet. **Recommend `type: 'text'` with `values: ['self','page']`** — same
validation, nothing inert reaches the DOM.

**Verified by:** existing `test/scroll-mechanics.test.ts`, `test/catalog-forms.test.ts`,
`test/browser/horizontal-track-pinned.test.mjs`, `test/browser/scroll-nested.test.mjs` must all
stay green with zero edits — that is the proof of "no behaviour change". Plus new unit tests: one
per primitive asserting the default scope, and one asserting the opposite value flips it.

---

### Step 2 — Fix the `resolveTarget` warn labels

**Files:** `src/effects/scroll-mechanics/primitives.ts:228`, `:274`.

`'scrollytelling-step'` → `'scroll-progress'`, `'horizontal-scroll'` → `'horizontal-track'`. Or
thread the resolved preset name through if the intent was to name what the author typed — but the
primitive backs several presets, so it cannot know. Name the primitive.

**Verified by:** grep the test suite for those two strings first; if any test asserts the message
text, it changes with the code.

---

### Step 3 — `horizontal-track` all-match resolution

**File:** `src/effects/scroll-mechanics/primitives.ts:273-282`.

Per D3. `el.querySelector` → `queryScoped(...)` from step 1; take `[0]`; warn when `length > 1`.

**What could go wrong:** nothing measurable — one match in both demos, no test above one.

**Verified by:** `test/browser/horizontal-track-pinned.test.mjs` unchanged, plus one new unit test
for the >1 warn.

---

### Step 4 — Plural ledgers (blocker 3), with no retargeting yet

**Files:** `src/core/owned-styles.ts`, `src/core/types.ts`, `src/core/animator.ts`,
`src/core/js-effect-preparer.ts`.

**Scope note, now that D1 is settled:** this step is *only* the two ledger fields. Every other
field on `InstanceState` stays singular — one gate, one `AbortController`, one `status`, one
`direction`, one `releaseActivation`, one event stream — because the host owns the lifecycle. If
this diff starts touching `activate`, `deactivate`, `reverseFrom` or `cancel`, it has gone beyond
what D1 asks for and should be stopped and re-read.

Still the largest diff in the plan, and it lands with **zero behaviour change** — one element in
the set is exactly today.

Verified state today: `install` creates one `createStyleLedger(el)` + one
`createAttributeLedger(el)` (`animator.ts:310-311`); `InstanceState.ledger`/`.attributes` are
singular (`types.ts:601-602`); `release()` does one `restore()` each (`animator.ts:785-786`).

Add to `owned-styles.ts`:

```ts
export interface LedgerSet {
  style(el: Element): StyleLedger        // memoised per element
  attributes(el: Element): AttributeLedger
  restore(): void                        // descendants first, host last
  elements(): Element[]
}
export function createLedgerSet(host: Element): LedgerSet
```

`InstanceState` gains `ledgers: LedgerSet` and keeps `ledger`/`attributes` as accessors onto the
host's, so nothing outside `animator.ts` changes shape in this step.

**Restore order matters and must be host-last.** `release()` already runs abort → destroy →
restore. The host's `data-kui-state` is the cloak's release key (0.4); removing it before the
descendants have been unwound reopens `opacity: 0` on a subtree still carrying library styles.

**What could go wrong:** `createStyleLedger.restore()`'s `style=""` handling
(`owned-styles.ts:83`) is per-element and must run per element — that is the exact defect
`test/browser/teardown-sweep.test.mjs` reads as "leaves synthetic nodes behind" (see the comment at
`owned-styles.ts:61-82`). A `LedgerSet.restore()` that forgets one element leaves one `style=""`
and that sweep will catch it — which is the point of doing this step alone.

**Verified by:** `test/owned-styles.test.ts`, `test/animator.test.ts`,
`test/browser/teardown-sweep.test.mjs`, `test/browser/destroy-cleanup.test.mjs`, all unchanged.
Plus a new unit test that a `LedgerSet` over three elements restores all three and removes all
three `style` attributes.

---

### Step 5 — compile: lift `target`/`scope`, partition, conflict-check per partition

**Files:** `src/core/compile.ts`, `src/core/types.ts`. `parse.ts` unchanged.

`parse.ts` stays untouched — it has no registry access, so `target`/`scope` ride in `spec.params`
exactly as the brief says.

In `resolveEntries` (`compile.ts:188`), after `registry.resolve`:

- If `Object.hasOwn(primitive.parameters, 'target')` → leave both keys in `spec.params`. The six
  keep working and read them through `params.text` as they do today.
- Otherwise → lift **both** off onto the entry (`entry.target`, `entry.scope`) and delete them from
  the params the entry carries forward.

**`scope` travels with `target`, always.** Not independently. If `scope` were lifted on its own for
a primitive that declares `target` but not `scope`, then `media-scrub target:.x scope:self` would
be silently inert — the primitive resolves document-wide on its own and would never see the key.
Step 1 gives all six a `scope` declaration precisely so this rule holds without exception.

Note `resolveEntries` must not mutate `spec.params`: `compile` is pure and `Entry.spec` is the same
object on every rescan (`types.ts:497` says `variantFor` must not mutate `spec`, same contract).
Copy the params record when lifting.

Then partition. Group key is `` `${scope} ${target}` ``; `''` (the host) is always group zero.
`findConflicts` runs **per group** — two clauses hitting different descendants may both animate
`opacity`, and `channels.ts`'s analysis is global today (`channels.ts:26`, one flat `seen` map).

**The constraint the brief does not name:** four `CompiledPlan` fields are *element*-scoped, not
group-scoped, and there is exactly one of each per host:

- `reducedMotion` → **strictest across all groups** (`strictestPolicy`, `compile.ts:471`).
- `supportedActivations`, `supportedTimelines` → **intersected across all groups**
  (`intersect`, `compile.ts:392`). Emptiness must survive, per that function's own note.
- `defaultActivation` → first across all groups, as today.
- `channels` → union across all groups, because `unsupportedChannelWarnings`
  (`animator.ts:257`) and `needsIndividualTransforms` (`style-plan.ts:172`) are asked once.

Otherwise `fade-up target:h1` and `pin target:.x` on one host could each ask for a different gate,
and there is only one activation binding. **The gate is decided once, from the merged facts.**

**Do not turn `CompiledPlan` into a map.** `public-api.test.ts:130` asserts `CompiledPlan` is an
exported name, and it is consumed by `style-plan.ts:34`, `animator.ts:101/110/290`,
`js-effect-preparer.ts:14` and `js-effect-preparer.test.ts:37`. Add alongside it instead:

```ts
export interface CompiledTarget { selector: string; scope: TargetScope; plan: CompiledPlan }
export interface CompiledDocument { targets: CompiledTarget[]; warnings: string[] }
export function compileTargets(parsed, registry, timeline): CompiledDocument
```

`compile()` keeps its exact current signature and returns `targets[0].plan` — every existing
consumer and test compiles unchanged. `Animator.process` moves to `compileTargets`.

**What could go wrong:** `resolveSequence` (`compile.ts:270`) positions `at:` across the whole
comma list. Partitioning splits that list. `at:` positions a segment against *its neighbours*, and
two segments on different targets are not neighbours in any meaningful sense — but an author
writing `fade-up target:h1, slide-left target:p at:-200ms` clearly means them to overlap. **Run the
sequencer once over the full, unpartitioned entry list, before partitioning**, and carry
`SequenceStep` onto the entries. Then partition. This is the one place the two features genuinely
interact and it is easy to get backwards.

**Verified by:** `compile` is pure — all of this is assertable with plain objects and no DOM.
New tests: per-partition conflict detection (two `opacity` effects on different targets compose;
two on the same target do not), merged reduced-motion/activation/timeline facts, and the
`at:`-across-partitions case.

---

### Step 6 — animator: install per target

**Files:** `src/core/animator.ts`, `src/core/style-plan.ts`, `src/core/js-effect-preparer.ts`.

In `install` (`animator.ts:301`), for each `CompiledTarget`:

1. Resolve matches. `scope === 'page' ? doc : el`. `resolveTarget`'s document-wide/invalid
   rejection (`step-marking.ts:81`) must run **here**, at compile-to-install time — it currently
   only runs inside the six primitives' `prepare`, which a CSS-rendered retarget never reaches.
2. Zero matches → step 10.
3. Per match: `applyStylePlan({ el: match, plan: groupStylePlan, ledger: ledgers.style(match),
   attributes: ledgers.attributes(match) })`.
4. Per match: push `createCssInstance(match, ledgers.style(match), animationNames, scrubbed)`.
5. `jsEffectPreparer.prepare` loops per match with `contextFor(match, signal, ledgers.style(match))`.

**Attribute split — settled per D6 (§2.1), and this is the whole of blocker 1's real fix.**

`planStyles` (`style-plan.ts:53`) currently returns all three attributes in one record (`:90-94`).
Split it into `hostAttributes` (`data-kui-state`, `data-kui-rm`, and `data-kui-fx` for the host's
own group) and `targetAttributes` (`data-kui-fx`, `data-kui-rm`) rather than giving
`applyStylePlan` a flag — `planStyles` is pure, so the split is assertable with plain objects and
no DOM, which a flag on the writer is not.

The `data-kui-state`-stays-on-host half is what stops the host sitting cloaked at `opacity: 0` for
the full 2s release window. Assert it directly (step 11's `target-cloak.test.mjs`); it is silent
when wrong.

**JS primitives do not change.** Verified: `PrepareContext` (`effect-context.ts:17`) has no `el` —
`prepare(el, params, ctx)` takes the element as its first argument (`js-effect-preparer.ts:130`).
Looping per match with a per-match `ctx` (whose `style` is that match's ledger and whose `warn` is
bound to that match) is entirely inside `createJsEffectPreparer`. Confirmed: no primitive signature
changes.

**What could go wrong:**

- `contextFor` closes over `el` for `warn` (`js-effect-preparer.ts:92`). Building one `ctx` per
  match instead of one per element is the change; missing it means every warning points at the host
  and a 20-match group produces 20 identical unattributable warnings.
- `state.instances` grows from O(effects) to O(effects × matches). `release()` already iterates it
  (`animator.ts:782`) so teardown is correct. `activate`/`deactivate`/`reverseFrom` iterate it too
  — under D1 they keep driving *all* of them as one group, which is right, but check none of them
  assumes one instance per effect name. I did not read `animator.ts:424-705` closely; this is the
  one place D1 could still surprise the implementer.
- `progressDriven` (`types.ts:597`) is computed from one `stylePlan.gate`. Under D1 plus the
  merged-gate rule from step 5 this stays a single boolean — but verify it after merging.

**Verified by:** `test/animator.test.ts`, `test/style-plan.test.ts`, `test/lifecycle.test.ts`,
`test/control.test.ts` all unchanged (the host path is byte-identical when no group has a target).
New browser coverage per step 11.

---

### Step 7 — `data-kui-fx` relocation and the opt-out (0.3)

**Files:** `src/core/types.ts`, the catalog files declaring the 16 names, `src/core/compile.ts`,
`test/css-invariants.test.ts`.

Add to **`Preset`**, not `Primitive` — verified: all 16 names that reach past themselves are preset
names, and `Preset.cloak` (`types.ts:528`) sets the precedent for "a CSS fact only this name's
author knows".

```ts
/**
 * This preset's CSS reaches past the fx-stamped element — to a child, a sibling, or a
 * descendant it assumes exists. `target:` may not relocate it, because the relocated rule
 * would match nothing and the effect would compile to silence.
 */
requiresOwnSubtree?: boolean
```

`compile` warns and **drops the `target:`** (keeping the effect on the host) when a preset
declaring this is retargeted. Dropping rather than refusing the whole attribute follows
`resolveComposition`'s existing precedent (`compile.ts:239`): fall back to something that works,
and always warn.

This is the concrete answer to the brief's `card-flip-x target:.foo` question. Verified: the CSS at
`three-d.css:106-154` branches on `:has(> :nth-child(2))` — a flip relocated onto a childless
element silently takes the single-face branch and spins a bare element. `card-flip-x`/`-y` are on
the 16-name list, so `requiresOwnSubtree: true` refuses it by name instead.

**Make the list un-driftable.** Add to `test/css-invariants.test.ts` a generated assertion: parse
every selector in `src/css/*.css`, and for each `[data-kui-fx~='NAME']` followed by a combinator +
compound, assert `registry.resolve(NAME).preset.requiresOwnSubtree === true`. That turns my
one-off 91-selector measurement into something a future CSS edit cannot break silently. This test
is worth writing *first*, before the flag is declared anywhere — it will fail with the 16 names,
which is the list.

**What could go wrong:** my parser strips trailing pseudo-classes/pseudo-elements from the fx
compound before deciding "reaches past itself", so `[data-kui-fx~='x']::before` correctly counts as
self-only. A hand-written selector splitting a compound across lines inside a comment would be
mis-parsed — I stripped comments first, so this is handled, but the test should re-derive rather
than hard-code my 16.

---

### Step 8 — `--kui-i` over a targeted set

**File:** `src/core/stagger.ts` (untouched by the merge — safe ground).

Verified: `indexStaggerGroup` (`stagger.ts:13`) walks `group.children` gated on
`hasAttribute(ATTR.source)` (`:19`). A retargeted set has neither the parent relationship nor the
attribute. It needs its own pass.

Add `indexTargetGroup(host, matches, ledgers)`: `--kui-i` per match in match order,
`--kui-stagger-count` on the host, `--kui-stagger` from `data-kui-stagger` on the host if present.

**Write through the ledgers, not `element.style`.** `indexStaggerGroup` writes
`(child as HTMLElement).style.setProperty` directly (`:20`, `:32`) — those writes are outside every
ledger and leak on teardown. That is a **pre-existing bug** independent of this project; the
targeted version must not copy it, and the existing one is worth a separate fix.

Reset semantics, verified in `base.css`:

- `--kui-i: 0` **is** reset in `kui.tokens` (`base.css:49`), because it is a position within one
  group and a nested group must not inherit its ancestor's (`:37-39` documents the 660ms bug).
- `--kui-stagger` is **deliberately not** reset (`:44`) — authors set it on a wrapper precisely so
  children inherit it. Do not "fix" this.
- `--kui-stagger-count` is likewise not reset. Confirmed by absence.

Per the recall note: inline runtime writes still win over the `kui.tokens` reset, so writing
`--kui-i` on each match is sufficient and the reset does not fight it.

**What could go wrong:** match order — this is **D7, still open**. `querySelectorAll` returns
document order. `createStepMarker` (`step-marking.ts:136-140`) numbers **per parent** rather than
flat, deliberately, so a target naming two parallel groups reads 0–3 twice instead of 0–7. A
stagger over a targeted set has the same shape and probably wants the same rule. Recommend
per-parent, for consistency with the one place the library already answered this. Either answer is
a small, local change inside `indexTargetGroup`; the rest of step 8 does not depend on it.

**Verified by:** `test/stagger-count.test.ts`, `test/browser/effect-sweep.test.mjs`. New: a
targeted stagger where `(matches − 1) × stagger` is a real fraction of the duration — per the
recall note, a stagger only reads at all when that holds.

---

### Step 9 — Rescan (blocker 2)

**Verified, and the brief slightly overstates it:** `dom-watcher.ts`'s `attributeFilter`
(`:91`) is `[source, on, timeline, threshold]`, but that filter applies only to **attribute**
mutations. For `childList`, `collect` (`:58`) queues the added node **unfiltered** and
`onElementAdded` → `this.scan(el)` (`animator.ts:843`). The gap is therefore entirely in
`scan()`'s selector `[data-kui]` (`animator.ts:224`), not in the watcher. One place, not two.

**Recommend: not in v1 (D5).** All six existing `target:` primitives already resolve at install and
never re-resolve — the sole exception is `createStepMarker`, which re-resolves per *index flip*
(`step-marking.ts:116` documents why). Nobody has asked for insert-later, and building a live
`(host, selector, scope)` match registry adds a per-insertion cost to every page for a case with no
demand.

Document the limit in `docs/catalog.md` and `docs/getting-started.md`: **`target:` is resolved when
the host is installed. Elements inserted afterwards are not picked up; re-run
`kui.reset(host); kui.process(host)`.**

If the owner wants it, the cheap version is: keep a `Map<Element, {selector, scope}[]>` of live
targets; in `onElementAdded(node)`, for each live entry whose scope contains `node`, test
`node.matches(selector)` plus `node.querySelectorAll(selector)`. It must install **only the newly
matched elements** — re-`process`ing the host would restart every already-running animation on
every DOM insert, which is worse than the gap.

---

### Step 10 — Diagnostics that are actually visible

**Files:** `src/core/animator.ts`, `src/core/compile.ts`.

Zero matches must be reported by name — reuse `resolveTarget`'s rejection style
(`step-marking.ts:85`, `:89`).

The brief is right that the default reporter is silent (`animator.ts:867` →
`silentReporter()`, `reporter.ts:33`) — but **every demo page passes `consoleReporter()`**
(verified: `demo/index.html:1910`, `demo/scroll.html`, and 8 more). So this is invisible to
*production consumers*, not to us.

**Recommend: make a zero-match `target:` a compile failure, not a warning.** Stamp
`data-kui-state="failed"` on the host — exactly the treatment an unknown effect name already gets
(`animator.ts:264`). That is inspectable in devtools with no reporter configured, which is the
concrete answer to "a warn nobody sees is not a diagnostic".

Careful: `animator.ts:261-266` returns early on `fxNames.length === 0` and deliberately does *not*
stamp `data-kui-fx`, so a later-registered effect can still claim the element on rescan. A
zero-match target is a different case — the effects *are* registered. Do not reuse that early
return; add a distinct state value (`'failed'` with the host still installed, or a new
`'unmatched'`) and say which in the plan review.

---

### Step 11 — Tests

**Numbers, re-measured rather than trusted.** The brief's figures are close but not exact:

| the brief says | actual | how |
|---|---|---|
| ~20 `data-kui-fx` assertions across 5 files | **21 `ATTR.normalized` assertions across 5 files** | `grep -rc "ATTR.normalized" test/*.ts` |
| 12 in `animator.test.ts` | **17** in `animator.test.ts` | same |
| ~136 inline-style assertions across ~25 files | **132 across 30 files** | `grep -rn "style\.getPropertyValue\|style\.cssText\|getAttribute('style')" test/` |

There are also 21 raw `data-kui-fx` string mentions across 12 more files, but those are CSS-invariant
and fixture checks, not element assertions.

**Confirmed: none of these needs rewriting for the six existing primitives.** Every one asserts the
host, and with the host owning the lifecycle (D1) and no `target:` authored, the host path is
byte-identical — group
zero is the only group and it writes exactly what `install` writes today. That is the invariant to
protect, and steps 1–4 landing green with zero test edits is the proof.

Net-new coverage needed:

*Unit (`vitest`), pure and fast:*
- `compileTargets` partitioning: per-partition conflicts, merged reduced-motion/activation/
  timeline/channel facts, `at:` sequenced before partitioning.
- `resolveEntries` lift rule: lifted for undeclared primitives, left alone for the six, `scope`
  never lifted without `target`.
- `LedgerSet`: N elements restored, N `style` attributes removed, host last.
- `requiresOwnSubtree`: retargeting one of the 16 warns and falls back to the host.
- The generated `css-invariants` assertion from step 7.

*Browser (`test/browser/`) — the only tier that proves an effect animates:*

Per the recall note, 100% unit coverage proves registration, not motion. New `.test.mjs` files:
- `target-retarget.test.mjs` — `<article data-kui="fade-up target:h1">`: the `h1` moves, the
  `article` does not, `data-kui-fx` is on the `h1`, `data-kui-state` is on the `article`.
- `target-teardown.test.mjs` — after `reset()`, both elements are byte-identical to authored
  markup, **including no `style=""`** on either (the exact failure `owned-styles.ts:61-82`
  documents).
- `target-cloak.test.mjs` — with `data-kui-cloak` on `<html>`, the host releases (no 2s blank).
- `target-stagger.test.mjs` — `--kui-i` across the matched set, with the stagger span chosen so it
  is actually observable.

Two harness traps from prior sessions that will otherwise produce false failures:
- **A hidden tab delivers no `IntersectionObserver` callbacks at all**, so every `on:enter` stalls.
  Check `document.hidden` before filing any bug against a retargeted `on:enter`.
- **Pause the animation at a fixed `currentTime` and read the computed value.** Reading mid-flight,
  or from a `MutationObserver` (which runs after the stylesheet has repainted), reads the *end*
  state and can make a working effect look reversed.

---

## What I verified vs what I am assuming

**Verified by reading the line:**

- All six `target:`-declaring primitives, their resolution sites, scopes and cardinality (0.1).
- `scroll-spy`'s two forms resolving the same parameter differently (0.2).
- 91 fx-reaches-past-itself selectors, 16 distinct names, 0 in `presets.generated.css` (0.3).
- The cloak layer: 108 selectors = 54 presets × 2 blocks, all `[data-kui~=…]`, zero `data-kui-fx`;
  the release key; `base.css:98` (not `:106`).
- `InstanceState.ledger`/`.attributes` singular, one `restore()` each (blocker 3 — real).
- `indexStaggerGroup` gated on `hasAttribute('data-kui')` and writing outside every ledger.
- `PrepareContext` has no `el`; `prepare(el, params, ctx)` at `js-effect-preparer.ts:130`.
- `readParams` seeds schema defaults before authored values — why `default: ''` is load-bearing.
- `resolveParams` drops `type: 'text'` before the stylesheet; `spec.values` is checked before the
  `text` short-circuit.
- `dom-watcher` does *not* filter childList additions; the gap is `scan()`'s selector alone.
- Every demo passes `consoleReporter()`.
- Test counts: 21/5/17 and 132/30.
- `channels.ts`, `stagger.ts`, `dom-watcher.ts`, `owned-styles.ts`, `step-marking.ts`,
  `scroll-spy.ts` untouched by `bd446b1`.

**Assumed, not verified:**

- The total primitive count of 131. I did not re-derive it — most primitives get their `id` from a
  factory call rather than a literal `id:` field, so a grep undercounts badly (returns 14). The
  load-bearing number, **6 primitives declare `target`**, I did verify exhaustively.
- That `opacity: 0` on an ancestor hides a descendant regardless of the descendant's own opacity.
  This is CSS compositing, not a repo fact — I did not confirm it in a browser.
- That no primitive's `activate`/`deactivate`/`reverseFrom` path assumes one instance per effect
  name (step 6). I read `release()` and `install()` closely; I did not read all of
  `animator.ts:424-705`.

**Nothing in this plan was run.** No build, no test, no browser. Per the brief.
