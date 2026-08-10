# External review — gpt-5.6-sol (xhigh), architecture + security + bugs

Reviewed at HEAD `d229b39`. Read-only sandbox, no files modified. Covers v3 (spring/gesture/gestures), the lifecycle refactor collaborators, and the narrowed `/core` barrel — none seen by prior reviews.

Reviewed final observed HEAD `d229b393673eaa710875454992d607049b6218d1` (the review began at `644c056`; intervening commits were docs/demo changes). I excluded the four known live-testing defects and their fixes. No files were modified.

No code-execution or arbitrary-CSS-injection primitive was found, but there are several high-impact availability and lifecycle problems.

## Findings

1. **High — the `calc()` validator is catastrophically backtracking**

[params.ts:37](/Users/la/Programming/designimation/src/core/params.ts:37) repeats an alternation where the single-character branch can consume everything matched by the `var(...)` branch. A failing 199-character input caused the exact regex to take approximately 1.63 seconds on this host:

```html
<div data-dsg="fade-up distance:calc(var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)var(--a)!)"></div>
```

The 200-character limit at [params.ts:15](/Users/la/Programming/designimation/src/core/params.ts:15) therefore does not bound CPU cost; many elements multiply it.

Fix direction: replace `CALC` with a single-pass tokenizer/parser. Add adversarial failure benchmarks, not just valid-`calc()` tests.

2. **High — `text` is not a security type; its consumers require incompatible validation**

The contract says `text` may represent selectors or URL patterns and remains JS-only at [types.ts:80](/Users/la/Programming/designimation/src/core/types.ts:80), but [params.ts:62](/Users/la/Programming/designimation/src/core/params.ts:62) applies a CSS-oriented blacklist and otherwise accepts arbitrary text.

This produces several concrete problems:

- `<div data-dsg="tab-indicator-slide follow:]">` reaches `document.querySelector(']')` at [layout/primitives.ts:128](/Users/la/Programming/designimation/src/effects/layout/primitives.ts:128) and throws during activation. The preparer’s catch at [js-effect-preparer.ts:95](/Users/la/Programming/designimation/src/core/js-effect-preparer.ts:95) does not cover deferred setup.
- `<section data-dsg="scroll-spy target:*">` selects and writes `data-dsg-active` to every element in the document on every progress frame at [scroll-mechanics/primitives.ts:246](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:246) and [scroll-mechanics/primitives.ts:263](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:263). This is unbounded DOM fanout and escapes the effect element’s scope.
- `<img data-dsg="sequence-scrub src:https://attacker.example/pixel">` causes a network-capable `.src` assignment at [scroll-mechanics/primitives.ts:234](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:234). This can turn an otherwise inert `data-*` allowance in a sanitizer/CMS into a URL-loading gadget.
- The intended sequence syntax is itself unusable: `src:/frames/frame-{i}.webp` is rejected because the CSS blacklist bans braces at [params.ts:13](/Users/la/Programming/designimation/src/core/params.ts:13), although `applyFrame()` explicitly searches for `{i}`.
- Programmatic selectors containing spaces and quotes are corrupted by [play.ts:38](/Users/la/Programming/designimation/src/core/play.ts:38), because the tokenizer at [parse.ts:97](/Users/la/Programming/designimation/src/core/parse.ts:97) does not understand escaped quotes.

Fix direction: replace `text` with discriminated sink types such as `selector`, `url-pattern`, `attribute-name`, and `svg-path`, each with its own parser/policy. Scope selectors to an explicit root, catch syntax errors, cap matches, and provide a consumer URL-policy hook. Prefer compiling programmatic options structurally instead of serializing and reparsing them.

3. **High — valid spring parameters can create a permanent rAF loop**

`number` accepts zero and arbitrarily large digit strings at [params.ts:24](/Users/la/Programming/designimation/src/core/params.ts:24), while `springFrom()` uses them without semantic bounds at [gestures/primitives.ts:46](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:46).

```html
<div data-dsg="elastic-pull stiffness:0"></div>
```

After one drag and release, the spring has nonzero displacement, zero velocity, and zero restoring force. `isSettled()` remains false at [spring.ts:90](/Users/la/Programming/designimation/src/core/spring.ts:90), so [spring.ts:141](/Users/la/Programming/designimation/src/core/spring.ts:141) schedules forever while repeatedly writing the same translation. A 200-digit number can also convert to `Infinity`, producing `NaN` and the same non-settling behavior.

Fix direction: add schema constraints (`finite`, minimum/maximum, integer where applicable), validate `SpringConfig` defensively inside the runner, and stop/report when state becomes non-finite or exceeds a maximum settle budget.

4. **High — CSS lifecycle operations control unrelated consumer animations**

`createCssInstance()` obtains every animation affecting the element at [instances.ts:11](/Users/la/Programming/designimation/src/core/instances.ts:11), then reverses, cancels, finishes, and awaits all of them at [instances.ts:55](/Users/la/Programming/designimation/src/core/instances.ts:55).

An element with both `data-dsg="fade-up"` and a consumer `animation: pulse 2s infinite` will:

- never resolve the Designimation `finished` promise;
- have `pulse` cancelled by `PlaybackHandle.cancel()`;
- have it reversed during click-toggle if another animation is finished;
- potentially throw from `finish()` on an infinite animation.

Fix direction: retain only animation handles owned by the compiled plan—filter CSS animations by the exact emitted names and installation snapshot, or use WAAPI-created handles. Never rediscover ownership through unfiltered `getAnimations()`.

5. **High — `EffectInstance` is uniform in shape but not in semantics for JS behaviors**

`deferredInstance()` only supplies `activate` and `destroy` at [instances.ts:93](/Users/la/Programming/designimation/src/core/instances.ts:93). Consequently [instances.ts:141](/Users/la/Programming/designimation/src/core/instances.ts:141):

- gives every deferred JS effect an already-resolved `finished`;
- makes `cancel()` merely clear an internal boolean;
- makes `finish()` a no-op.

For example:

```js
const run = anim.play(el, 'magnetic')
await run.finished // resolves while the window listener and springs remain active
run.cancel()       // listener and current spring remain active
```

Reactivating after cancel can install a second listener while overwriting the sole cleanup reference. This affects gestures, scroll mechanics, FLIP watchers, and SVG morphing because they all use `deferPrepare`.

It also exposes the deeper mismatch: gestures are long-lived input behaviors, not finite animations. Under reduced motion the animator refuses to activate them at [animator.ts:280](/Users/la/Programming/designimation/src/core/animator.ts:280), contradicting the gesture module’s statement that dragging should remain interactive while only physics is suppressed at [gestures/primitives.ts:16](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:16).

Fix direction: introduce an explicit behavior/controller lifecycle distinct from finite animation runs, or define continuous `finished`/cancel/finish semantics. At minimum, `deferredInstance.cancel()` must tear down active setup and each primitive must provide a real completion contract. Reduced motion should separate essential pointer tracking from decorative inertia/settling.

6. **High — animator-wide teardown can miss live instances and leak global listeners**

The runtime source of truth is a non-iterable `WeakMap` at [animator.ts:104](/Users/la/Programming/designimation/src/core/animator.ts:104), but `destroy()` discovers descendants through the debug attribute selector at [animator.ts:380](/Users/la/Programming/designimation/src/core/animator.ts:380).

Concrete leak:

```js
const magnet = document.querySelector('#magnet')
magnet.removeAttribute('data-dsg-fx')
animator.destroy()
```

If `magnet` was a child of the root, `releaseTree()` skips it and its window-level `pointermove` listener survives. The same happens when a node is removed and `destroy()` disconnects the mutation observer before its queued removal record is delivered.

Additionally, [animator.ts:385](/Users/la/Programming/designimation/src/core/animator.ts:385) destroys the scheduler before primitive cleanup; pin cleanup can then call `ctx.invalidate()` and schedule fresh work after scheduler destruction.

Fix direction: maintain an iterable `Set<Element>` beside the `WeakMap`, release every live state from that set, then destroy shared collaborators. Treat attributes strictly as diagnostics, never as the lifecycle index.

7. **Medium-high — mutation and observer work is not actually bounded**

`DomWatcher` invokes callbacks once per raw mutation record at [dom-watcher.ts:39](/Users/la/Programming/designimation/src/core/dom-watcher.ts:39), and each added node immediately triggers a subtree scan at [animator.ts:404](/Users/la/Programming/designimation/src/core/animator.ts:404).

A connected chain built synchronously:

```js
root.append(a)
a.append(b)
b.append(c)
// ...
```

produces records for `a`, `b`, `c`, while by delivery time `a` contains the whole chain. The watcher scans `a`, then `b`, then `c`: quadratic traversal. Removals have the same shape.

Separately, activation observers are cached forever by the raw threshold string at [activation.ts:46](/Users/la/Programming/designimation/src/core/activation.ts:46). Thousands of elements with distinct but equivalent values such as `0.1`, `0.10`, and `10%` create thousands of retained `IntersectionObserver`s.

Fix direction: batch records, deduplicate elements, discard descendants when an ancestor is already queued, and process with a per-frame budget. Canonicalize thresholds to a numeric ratio and ref-count or cap observer variants.

The scroll scheduler itself does correctly coalesce repeated root events into one pending frame and reads metrics once per dirty root; the blowups are above it, not in its core loop.

8. **Medium-high — inherited object keys can abort the entire scan**

Reserved parameter dispatch uses inherited lookup on a normal object at [parse.ts:255](/Users/la/Programming/designimation/src/core/parse.ts:255):

```html
<div data-dsg="fade-up __proto__:x"></div>
```

This reproducibly throws `TypeError: HOISTS[token.key] is not a function`, because `HOISTS.__proto__` resolves to `Object.prototype`. `constructor:x` and `toString:x` are silently swallowed as inherited handlers. One such element escapes `Animator.process()` and aborts `start()` at [animator.ts:184](/Users/la/Programming/designimation/src/core/animator.ts:184).

I did not find an actual attacker-controlled object being assigned into a prototype, so this is unsafe object-key use and denial of service rather than confirmed prototype pollution.

Fix direction: use `Object.hasOwn(HOISTS, key)`, null-prototype dictionaries, and own-property checks for schemas and parsed parameter bags. Add a per-element error boundary so one malformed node cannot stop the remaining scan.

9. **Medium — the overall attribute grammar has no resource limits**

Only individual schema values have a 200-character limit. Effect names, segment count, parameter count, and total source length are unbounded. Unknown names trigger Levenshtein work at [registry.ts:131](/Users/la/Programming/designimation/src/core/registry.ts:131) against every registered name.

```js
el.setAttribute('data-dsg', 'x'.repeat(1_000_000))
animator.process(el)
```

This causes work proportional to the huge name times the catalog, then embeds that name in a warning. Repeated unknown segments also repeatedly sort `registry.names()`.

Fix direction: cap total attribute length, effect count, parameter count, token length, and warning length before parsing. Skip suggestions above a small name limit and cache the registry name list.

10. **Medium — DOM/style ownership is not available to primitive authors**

`PrepareContext` exposes a style ledger but no attribute or external-node ledger at [effect-context.ts:39](/Users/la/Programming/designimation/src/core/effect-context.ts:39). JS primitives therefore perform direct writes and blind cleanup:

- Gesture attributes are removed regardless of prior consumer values at [gestures/primitives.ts:98](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:98).
- Scroll-spy removes pre-existing `data-dsg-active` from arbitrary links at [scroll-mechanics/primitives.ts:254](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:254).
- Auto-height directly deletes the consumer’s inline `height` at [layout/primitives.ts:101](/Users/la/Programming/designimation/src/effects/layout/primitives.ts:101).
- Media scrub does not restore the original `src` or `currentTime` at [scroll-mechanics/primitives.ts:203](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:203).
- Stagger writes bypass both the planner and ledger at [stagger.ts:13](/Users/la/Programming/designimation/src/core/stagger.ts:13).
- `observeLayout()` drops every returned `FlipRun` at [flip.ts:213](/Users/la/Programming/designimation/src/core/flip.ts:213), so active FLIP animations cannot be cancelled on teardown.

This is the main decision/effect-separation leak: the reference model exists for initial styles, but runtime writes have no equivalent plan/ownership abstraction.

Fix direction: expose attribute/property/external-element ledgers or a generalized write-plan sink in `PrepareContext`; require primitives to return or register all active animation handles.

11. **Medium — several authored CSS values bypass the parameter schema**

Unvalidated strings still reach `style.setProperty`:

- positional easing is accepted by a superficial starts/ends check at [parse.ts:165](/Users/la/Programming/designimation/src/core/parse.ts:165) and emitted verbatim at [compile.ts:261](/Users/la/Programming/designimation/src/core/compile.ts:261);
- the trailing timeline range is raw at [element-config.ts:59](/Users/la/Programming/designimation/src/core/element-config.ts:59) and written at [style-plan.ts:95](/Users/la/Programming/designimation/src/core/style-plan.ts:95);
- `data-dsg-stagger` is copied directly at [stagger.ts:14](/Users/la/Programming/designimation/src/core/stagger.ts:14);
- programmatic `options.stagger` is copied directly at [play.ts:87](/Users/la/Programming/designimation/src/core/play.ts:87).

For example, this bypasses `DANGEROUS` entirely:

```html
<div data-dsg="fade-up cubic-bezier(0);background:url(https://attacker.example/x))"></div>
```

CSSOM `setProperty` contains the semicolon rather than creating a second declaration, so I did not confirm arbitrary CSS or a fetch from this example. It still disproves the claimed single validation boundary and permits malformed/stalled effects.

Fix direction: validate positional values through the same typed validators, define a grammar for animation ranges, and route both declarative and programmatic stagger through `time` validation and the ledger.

12. **Medium — dependency injection and realm isolation are incomplete**

Concrete violations include:

- global, module-cached capabilities at [capabilities.ts:29](/Users/la/Programming/designimation/src/core/capabilities.ts:29);
- global root IDs at [scroll-scheduler.ts:274](/Users/la/Programming/designimation/src/core/scroll-scheduler.ts:274);
- gesture primitives internally choosing global frame/timer sources at [gestures/primitives.ts:80](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:80);
- SVG morphing directly using global `performance` and rAF at [svg/index.ts:36](/Users/la/Programming/designimation/src/effects/svg/index.ts:36);
- global observer constructors rather than the owning document’s realm;
- parent-realm `instanceof Element` checks in [animator.ts:161](/Users/la/Programming/designimation/src/core/animator.ts:161), [dom-watcher.ts:41](/Users/la/Programming/designimation/src/core/dom-watcher.ts:41), and [play.ts:29](/Users/la/Programming/designimation/src/core/play.ts:29).

With an iframe element passed to a parent-realm animator, `resolveTargets()` does not recognize it as an `Element` and attempts to iterate it; mutation callbacks ignore foreign-realm nodes; capability detection probes the parent document and then caches that answer.

Fix direction: introduce one injected environment/realm adapter containing document, window, constructors, clock, frames, timers, and observers. Scope IDs to a resolver/scheduler instance and avoid cross-realm `instanceof` where node-type/owner-document checks suffice.

13. **Medium — the narrowed `/core` boundary is internally inconsistent**

The public barrel at [core/index.ts:1](/Users/la/Programming/designimation/src/core/index.ts:1) exports `AnimatorOptions`, `Primitive`, and `PrepareContext`, but omits types and helpers those contracts reference or bundled primitive authors require:

- `ScrollScheduler`, `ScrollRoot`, `JsEffectPreparer`, and `DomWatcher` appear in public options but cannot be imported through `/core`.
- Bundled gestures require `deferPrepare`, gesture recognition, and spring helpers via deep imports at [gestures/primitives.ts:1](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:1).
- Bundled scroll primitives require unit conversion, measure caching, and ledgers via deep imports at [scroll-mechanics/primitives.ts:1](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:1).

The export-list test only asserts a hand-selected allowlist; it does not compile a third-party primitive using supported imports.

Fix direction: retain compiler internals as private, but add a deliberate `/core/authoring` surface containing lifecycle constructors, collaborator types, owned-write APIs, unit conversion, and stable frame/measurement utilities. Add an external-package fixture that builds without deep imports.

14. **Medium — primitive-level channels miss preset and static-rule ownership**

The v3 `flip-face` primitive claims only `rotate`, while its CSS also writes `perspective`, `transform-style`, and `transform-origin` at [three-d.css:43](/Users/la/Programming/designimation/src/css/three-d.css:43). `loading-bar` writes another static `transform-origin` at [three-d.css:87](/Users/la/Programming/designimation/src/css/three-d.css:87).

```html
<div data-dsg="fold-panel, loading-bar"></div>
```

The compiler allows this because rotate and scale are disjoint, but the later loading-bar rule wins `transform-origin`, so the fold pivots around the wrong edge.

The inverse problem also exists: `page-fade` shares a primitive claiming opacity and translate at [three-d/index.ts:39](/Users/la/Programming/designimation/src/effects/three-d/index.ts:39), although its keyframe writes only opacity at [three-d.css:62](/Users/la/Programming/designimation/src/css/three-d.css:62), creating false conflicts.

Fix direction: store actual animated and supporting-property claims per preset, or split primitives whenever preset write sets differ. Extend invariant tests beyond keyframe bodies to static effect selectors.

15. **Medium — stationary long-press never clears, and pointer state is not keyed by pointer ID**

A stationary hold fires `onLongPress`, but `onEnd` is called only when drag threshold state is active at [gesture.ts:186](/Users/la/Programming/designimation/src/core/gesture.ts:186). Therefore:

```html
<button data-dsg="long-press">Hold</button>
```

Holding for 500ms without moving sets `data-dsg-pressed="true"` at [gestures/primitives.ts:191](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:191); releasing leaves it true indefinitely.

The recognizer also does not store the active pointer ID or reject secondary buttons/pointers. A second touch overwrites the first gesture’s origin and timer. Cleanup at [gesture.ts:203](/Users/la/Programming/designimation/src/core/gesture.ts:203) does not release capture during mid-gesture teardown.

Fix direction: distinguish release/cancel from drag-end, track one active pointer ID, ignore non-primary pointers/buttons, handle `lostpointercapture`, and release capture during cleanup. This is separate from the known pointer-capture defect, which is fixed at the reviewed HEAD.

16. **Low — diagnostics can leak untrusted values to telemetry**

Rejected raw values are embedded verbatim at [params.ts:174](/Users/la/Programming/designimation/src/core/params.ts:174), and parser warnings include whole tokens or segments at [parse.ts:247](/Users/la/Programming/designimation/src/core/parse.ts:247). `consoleReporter` additionally passes the live element object at [reporter.ts:18](/Users/la/Programming/designimation/src/core/reporter.ts:18).

For example:

```html
<div data-dsg="fade-up distance:customer-email@example.com"></div>
```

places that value in `collectingReporter.messages`; a consumer forwarding those messages to analytics would disclose it. The production default is silent, so this is not a default leak.

Fix direction: truncate and redact raw values by default, use structured diagnostic codes, and make element/value inclusion an explicit development option.

## Explicit clean results

- No `eval`, `new Function`, or input-derived dynamic `import()` exists under `src/`.
- No use of HTML-clobberable `window.<name>` globals was found.
- No confirmed prototype-pollution write was found; registry/catalog lookup uses `Map`. The inherited-key crash above is the relevant unsafe-key issue.
- Runtime code does not generate stylesheet text from attribute input.
- Outside `CALC`, the reviewed parser/validator regexes are linear or bounded simple matches. `splitTopLevel` is a single-pass scanner.
- `keyword` is allowlisted; length/time/number/percentage/angle are shape-restricted; color/easing block URL/declaration syntax. Their remaining weakness is absent semantic bounds, not declaration escape.
- SVG path text is parsed and reserialized numerically before the `d` write; raw path text does not reach `setAttribute`.
- Normal destroy paths for gesture listeners/spring runners, scroll subscriptions, morph rAF, and observers do contain cleanup. The leaks arise from cancellation semantics, missed instance discovery, and untracked FLIP runs.
- Scroll scheduling itself coalesces event bursts and shares one metrics read per dirty root.

## Verification and test gaps

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: could not start in the read-only sandbox because Vite attempted to write `vitest.config.ts.timestamp-….mjs` beside the config and received `EPERM`.
- Browser tests were not run because their setup rebuilds writable demo artifacts.

The existing tests specifically miss adversarial `calc()`, inherited parameter keys, invalid/global selectors, semantic numeric bounds, real `deferPrepare` cancellation/finished behavior, unrelated animations on the same element, removed-before-destroy nodes, mutation-record deduplication, stationary long-press release, and static CSS-rule channel conflicts.