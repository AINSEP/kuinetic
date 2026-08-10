I’ll do this as a read-only, evidence-backed code review. I’m using the codebase knowledge-graph workflow because the repository instructions require graph-first discovery; I’ll inspect the requested docs/tests/configs directly where graph coverage is naturally weaker.

---

The required knowledge graph is not present at `.understand-anything/knowledge-graph.json`, so graph-assisted querying is unavailable for this checkout. I’m falling back to direct, targeted source reads inside the exact paths you named, without touching the excluded instruction/context files.

---

The first material gap is already clear: the CSS compiler is mostly pure and coherent, but the runtime does not track which inline properties it owns. Recompilation/teardown removes three attributes and leaves prior custom properties, animation longhands, timeline properties, and play state behind. I’m now tracing that against effects and tests to distinguish an architectural concern from observable defects.

---

The worktree is changing concurrently: `HEAD` is commit `3d2db58` (the requested v1+v2), while unrelated v3 gesture/3D files and registrations are currently uncommitted. To keep this review reproducible and within your stated 81-effect scope, I’m pinning all remaining evidence to `HEAD` and excluding those live worktree additions.

---

The main conclusion is firm: v1’s pure CSS compile path is a good nucleus, but v2 currently bypasses the very lifecycle, activation, timing, and reduced-motion contracts that make v1 coherent. I’m consolidating the review around reproducible defects at `HEAD`, plus a short publish/no-publish decision rather than inflating the list.

---

Reviewed read-only against `HEAD` commit `3d2db58`, excluding the concurrent uncommitted v3 gesture/3D work. I did not modify anything.

Verdict: the v1 CSS compiler is a strong nucleus. The combined v1+v2 library is not ready for `0.1.0`. v2 currently bypasses the activation, lifecycle, timing, and reduced-motion model instead of extending it.

## Prioritized findings

1. **[P0] JS-rendered effects do not participate in the runtime contract.**

[`Animator.install()`](/Users/la/Programming/designimation/src/core/animator.ts:161) calls every JS `prepare()` immediately, before activation. Pure JS effects are then classified as `immediate` because they have no CSS declaration in [`resolveGate()`](/Users/la/Programming/designimation/src/core/style-plan.ts:105).

Consequences:

- `on:enter`, `on:click`, and `manual` do not gate JS effects.
- `supportedActivations` is declared but never enforced.
- Positional duration/easing are ignored: [`prepareJsEffects()`](/Users/la/Programming/designimation/src/core/animator.ts:199) passes preset and named params, but not `spec.duration`, `spec.delay`, or `spec.easing`.
- `reducedMotion: 'disable'` does not disable pinning, FLIP, scrubbing, or morphing. They are prepared and run normally; the CSS reduced-motion rule cannot stop JS.
- Mixed CSS+JS composition activates the CSS half later while the JS half already runs.
- `play(..., 'icon-morph')` resolves immediately without actually driving the morph.

The SVG primitive demonstrates the split: [`prepareMorph()`](/Users/la/Programming/designimation/src/effects/svg/index.ts:20) hardcodes hover/focus listeners and global rAF regardless of the authored activation.

`PrepareContext` has good dependencies, but `prepare(): Cleanup` is the wrong lifecycle boundary. It needs to return an effect instance such as:

```ts
interface EffectInstance {
  activate(): void
  cancel(): void
  finish(): void
  finished: Promise<void>
  destroy(): void
}
```

The context also needs an `AbortSignal`, effective reduced-motion mode, owned-style helpers, and injected frame/clock services. The animator should gate every renderer through the same instance protocol.

2. **[P0] Recompilation and teardown leave stale library state behind.**

[`applyStylePlan()`](/Users/la/Programming/designimation/src/core/style-plan.ts:138) writes arbitrary inline properties, but [`release()`](/Users/la/Programming/designimation/src/core/animator.ts:289) removes only three attributes.

Concrete failures:

- Changing `fade-up distance:80px` to `zoom-in` leaves `--dsg-distance`.
- Changing `timeline:view` to `time` leaves `animation-timeline`.
- Removing `data-dsg` leaves animation declarations and play state.
- Destroying the animator leaves CSS animations installed.
- Several JS cleanups remove consumer styles instead of restoring them: horizontal scroll removes any prior `translate`; snap removes pre-existing child `scroll-snap-align`; indicator removes prior width/translate.
- Scroll-spy does not clean state written to external link targets.

Configuration identity is also only `attributes.source` at [`process()`](/Users/la/Programming/designimation/src/core/animator.ts:133), and the observer watches only `data-dsg` at [`watch()`](/Users/la/Programming/designimation/src/core/animator.ts:310). Changes to `data-dsg-on`, `data-dsg-timeline`, or `data-dsg-threshold` are permanently ignored, even after a manual `process()`.

Track a complete configuration fingerprint and an owned-write ledger per instance. Recompilation should transactionally remove only values the previous instance wrote, restoring prior inline values.

3. **[P0] Composition is safe for CSS properties but unsafe for parameters.**

[`buildPlan()`](/Users/la/Programming/designimation/src/core/compile.ts:159) repeatedly `Object.assign`s every effect’s variables into one flat record. The schemas use generic variables such as `--dsg-distance`, `--dsg-duration`, and `--dsg-ease` in [`primitives.ts`](/Users/la/Programming/designimation/src/effects/primitives.ts:9).

Example:

```html
data-dsg="pop-in, blur-in"
```

The channels are disjoint, but `pop-in` writes `--dsg-ease: back-out`. Both animation tracks use the same `--dsg-ease`, so the blur silently inherits the pop easing. At 237 names, this will become endemic.

This also repeats a design hole explicitly called out earlier:

- Primitive/preset variables are not namespaced per primitive.
- Preset “defaults” are written inline, so consumer CSS cannot override them. [`compile.test.ts`](/Users/la/Programming/designimation/test/compile.test.ts:28) currently locks that incorrect behavior in.

Automatic combo resolution is worse. [`resolveComposition()`](/Users/la/Programming/designimation/src/core/compile.ts:132) converts the pair to the combo using only the first spec:

```ts
{ ...first, name: combo.preset.name }
```

Therefore:

```html
blur-in 200ms blur:3px, fade-up 1s distance:80px
```

loses the fade timing and parameters. Reversing authored order produces different output despite the combo being order-insensitive.

I would remove automatic combo recognition. Keep `fade-blur-up` as an explicit effect with one timing model. There is no honest way for one keyframe track to preserve two independent timings.

4. **[P1] Timeline capability and gate logic are incorrect.**

[`planStyles()`](/Users/la/Programming/designimation/src/core/style-plan.ts:46) uses `capabilities.viewTimeline` for every non-time timeline.

Thus:

- `timeline:scroll` runs when view timelines exist even if `scrollTimeline` is false.
- It degrades when view timelines are false even if `scrollTimeline` is true.
- `timeline:pointer` becomes `view()`.

Additionally, inline grammar and longhand grammar are not equivalent. [`scroll.css`](/Users/la/Programming/designimation/src/css/scroll.css:85) applies `animation-range` only to elements carrying `data-dsg-timeline`. An inline `timeline:view` inside `data-dsg` never gets that attribute, so it misses the default range entirely.

Finally, unsupported timelines only warn in [`compile.ts`](/Users/la/Programming/designimation/src/core/compile.ts:224); they are still emitted and executed. `supportedActivations` is not checked at all. That makes capability metadata documentation rather than enforcement.

5. **[P1] Nested scroll roots calculate the wrong coordinate system, and epoch invalidation is incomplete.**

[`trackProgress()`](/Users/la/Programming/designimation/src/effects/scroll-mechanics/tracker.ts:58) caches:

```ts
documentTop = rect.top + root.scrollTop
```

That is valid for the window. For a nested scroller, `rect.top` is viewport-relative while `scrollTop` is local to the scroller. Progress is measured against viewport top instead of the nested scrollport’s top.

`ScrollMetrics` needs the scrollport’s viewport rectangle, or measurements must be explicitly relative to the resolved root.

Other scheduler issues:

- Any root scroll causes [`runFrame()`](/Users/la/Programming/designimation/src/core/scroll-scheduler.ts:118) to notify and measure every registered root, not only the dirty root.
- Element roots attach resize handling only to `window`, not a `ResizeObserver`, at [`elementScrollRoot()`](/Users/la/Programming/designimation/src/core/scroll-scheduler.ts:216).
- Image loads, font changes, container resizing, and external layout changes can leave cached geometry stale indefinitely.
- Root resolution treats any `overflow:auto` ancestor as the root, even if it cannot scroll or only scrolls on the irrelevant axis.

The scheduler’s teardown is otherwise clean for its tested single-root lifecycle.

6. **[P1] `horizontal-scroll` is broken by default and violates the measurement promise.**

[`trackTravel()`](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:175) intends to derive travel from `scrollWidth` unless overridden. But its schema default is `0px` at [line 310](/Users/la/Programming/designimation/src/effects/scroll-mechanics/primitives.ts:310), so it always takes the override branch and moves zero pixels.

`auto` would choose the intended branch, but the parameter is typed as `length`, so validation rejects `auto`.

When explicitly configured, `trackTravel()` reads `scrollWidth` inside every frame callback. That is the next forced-layout defect in the same family as the frozen rect cache.

Make `travel` a `keyword | length` union or separate `travel:auto` mode, default it to auto, and cache the overflow measurement against the geometry epoch.

7. **[P1] Several catalog names promise behavior their primitive cannot provide.**

Examples:

- `reveal-repeat` is identical to `reveal-once`, while the activation binder unobserves after first entry.
- [`mutationWatcher()`](/Users/la/Programming/designimation/src/core/flip.ts:227) observes direct child-list changes and the container’s own `hidden` attribute. It does not observe a child becoming hidden, class-driven grid/list changes, or arbitrary reflow. Consequently `flip-filter`, `grid-to-list`, `masonry-reflow`, and `expand-to-modal` are mostly aliases without a reliable trigger.
- `accordion-height` observes the mutation after layout changed, too late to capture the previous height reliably.
- The tab indicator writes a viewport-relative target `left` as an element-relative `translate`, so it overshoots whenever the indicator’s initial x-position is not zero.

The channel model is element-scoped, but FLIP writes animations to children, snap writes child styles, and scroll-spy writes external links. The compiler cannot detect those collisions. Future primitives need declared write scope: `self`, `children`, or external targets.

8. **[P1] Opt-in cloaking is not actually fail-open.**

Default no-cloak behavior is correct. The opt-in path does not meet the design:

- [`start()`](/Users/la/Programming/designimation/src/core/animator.ts:98) uncloaks only after scanning and has no `finally`.
- There is no watchdog implementation.
- The cloak selector in [`base.css`](/Users/la/Programming/designimation/src/css/base.css:42) hides every effect, not only known entrance reveals.
- If initialization fails, print and reduced-motion rules cannot rescue the page because they select library-stamped attributes that were never stamped.

The watchdog must live in an independent bootstrap, and cloak eligibility should use an authored, reveal-specific marker. Print/reduced-motion overrides must target that pre-init marker.

9. **[P2] The programmatic API should not be considered functional yet.**

[`toAttributeValue()`](/Users/la/Programming/designimation/src/core/play.ts:39) has several concrete defects:

- `{ delay: 200 }` without duration serializes one time token, which the parser interprets as duration.
- `stagger` remains in `rest`, so it also becomes an effect parameter and may warn.
- Text values containing spaces are not quoted.
- Replaying the same source is skipped by `Animator.process()`, and changing play state does not restart CSS animation.
- JS effects have no `Animation` objects, so `finished` resolves immediately and `cancel()`/`finish()` do nothing.
- It permanently overwrites authored `data-dsg` and `data-dsg-on`.
- The WeakMap state is not updated by cancel/finish; declarative CSS state also never reaches `finished`.

Either finish the renderer-neutral instance protocol first or remove `play()` from `0.1.0`.

## What the tests do not prove

The browser harness caught valuable defects, but several checks are theatre:

- “hover effect is paused” asserts only `opacity >= 0`, which is always true for valid opacity.
- “reveal is marked running” is checked after the animation has finished, codifying the broken state machine.
- Page errors are checked immediately after boot, then never checked again after scroll, FLIP, or SVG interactions.
- FLIP asserts only that some animation exists, not the inverse transform or final geometry.
- SVG asserts only that `d` changed and begins with `M`; malformed geometry, `NaN`, lost subpaths, and closure semantics pass.
- Fake scheduler tests collapse all roots into one subscriber set, so they cannot detect nested-root coordinate errors.

The next real-browser test I would add is one nested overflow scroller containing a default `horizontal-scroll` track. Scroll it to exactly 50% and assert:

- progress is approximately `0.5`;
- translation is half of `scrollWidth - clientWidth`;
- the window’s position does not affect that result;
- layout-count growth stays bounded across a burst of frames.

That one test should expose the default-zero travel, nested coordinate bug, and per-frame `scrollWidth` read.

For SVG, add a multi-subpath path with a hole and a stroked closed path. The current model serializes one initial `M` and never emits `Z`, so separate subpaths and stroke join/cap semantics are not preserved.

## What survives 237 names

The registry’s Maps and alias lookup are fine. The current core CSS is only about 9.1 KB raw and 2.4 KB gzip, so CSS splitting is not an immediate concern.

What will not scale:

- Flat, shared custom-property names.
- Open-string channels: a typo such as `transalte` silently defeats collision detection.
- Element-only channel ownership for primitives that mutate descendants or external targets.
- Hand-maintained catalog/docs/tests with semantic aliases that are not behaviorally distinct.
- One reduced-motion attribute containing the “strictest” policy. That is per-element, not per-effect; composing `shorten` and `disable` kills both.
- Root `createRegistry()` eagerly importing all JS categories, contrary to the statically visible effect-object packaging design.
- Exporting most compiler internals from `./core`, creating a large accidental semver surface.

Generate a canonical manifest from typed primitive/preset data and derive docs, CSS coverage, effect count, compatibility, and export entries from it.

## `0.1.0` readiness

Do not publish the current combined package.

Blocking:

- Fix or remove the JS categories and programmatic API issues above.
- Emit real JS, CSS, and `.d.ts` artifacts. [`package.json`](/Users/la/Programming/designimation/package.json:10) currently exports TypeScript source.
- Add package-consumer smoke tests for Node ESM, a normal bundler, and the CDN global.
- Add README, actual MIT LICENSE file, version, browser support statement, and migration/semver policy.
- Make the browser harness reproducible; it currently imports Playwright from an absolute path outside the repository at [`verify-browser.mjs`](/Users/la/Programming/designimation/scripts/verify-browser.mjs:12).
- Run the lifecycle and reduced-motion browser checks in CI.

One correction to the request: an exports map does exist for `.`, `./core`, `./effects`, and `./css`. The problem is that it targets source files and lacks category/effect-object entry points.

Can wait:

- The remaining 156 names.
- Lazy loading and template scanning.
- Fine-grained effect subpaths.
- CSS chunking; measure the completed stylesheet first.
- A broad performance laboratory, beyond a small regression budget.
- Full browser-matrix automation if `0.1.0` is explicitly labeled experimental and its tested browsers are documented—though Firefox and WebKit smoke tests should follow quickly.

## What I would rip out

- Automatic combo recognition; keep explicit combo effect names.
- `reveal-repeat` until replay exists.
- FLIP aliases whose triggers are not implemented; initially ship `flip-reorder` only.
- `PlaybackHandle` for JS effects until all renderers return a common lifecycle handle.
- Public `stateOf().status` until it is truthful.

The best release path is a smaller CSS-first `0.1.0` containing the compiler, entrance effects, native timelines, validation, and explicit activation. Treat the v2 primitives as experimental until the renderer-neutral lifecycle exists.