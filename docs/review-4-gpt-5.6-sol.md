<!-- Provenance: adversarial follow-up review, codex CLI, model gpt-5.6-sol, xhigh reasoning effort.
     Run 2026-08-17 as a verification pass over the 15 findings fixed that session.
     Extracted from the run transcript, which lived only in an ephemeral session scratchpad.
     Report-only: the reviewer changed no files. -->

# Follow-up verdict

11 findings are closed. Four are only partially fixed: **#6, #8, #11, and #12**. I also found two fresh High-severity integration defects and several Medium issues. No files were changed.

## Goal 1 — the original 15

1. **CLOSED — Critical.** `applyFrame()` now writes authored `src` only when `tagName === 'IMG'`; `<iframe>` and every other navigable element return without assignment. See [primitives.ts:227](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:227) and [primitives.ts:234](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:234). The exact iframe `javascript:` execution vector is gone.

2. **CLOSED — High.** Braces were removed from `DANGEROUS`, and text values such as `frame-{i}.jpg` pass validation at [params.ts:15](/Users/la/Programming/kUInetic/src/core/params.ts:15) and [params.ts:21](/Users/la/Programming/kUInetic/src/core/params.ts:21). Frame substitution is live at [primitives.ts:238](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:238).

3. **CLOSED — High.** The generator now builds and iterates the full `createRegistry()` catalog at [generate-preset-css.mjs:43](/Users/la/Programming/kUInetic/scripts/generate-preset-css.mjs:43) and [generate-preset-css.mjs:49](/Users/la/Programming/kUInetic/scripts/generate-preset-css.mjs:49). Both builds invoke it at [package.json:43](/Users/la/Programming/kUInetic/package.json:43). The generated stylesheet contains the non-v1 `gradient-rotate-border` rule at [presets.generated.css:161](/Users/la/Programming/kUInetic/src/css/presets.generated.css:161).

4. **CLOSED — High, for the reported ambient/one-shot failure.** Compilation now emits a parallel per-track `animation-iteration-count` list at [compile.ts:246](/Users/la/Programming/kUInetic/src/core/compile.ts:246) and [compile.ts:262](/Users/la/Programming/kUInetic/src/core/compile.ts:262). Ambient and feedback loops set preset-specific variables, e.g. [ambient.css:24](/Users/la/Programming/kUInetic/src/css/ambient.css:24) and [feedback.css:23](/Users/la/Programming/kUInetic/src/css/feedback.css:23). A composed fade therefore keeps iteration count `1`.

5. **CLOSED — High.** `feedback-burst` now declares both `background` and `color` in addition to its keyframe channels at [feedback.ts:108](/Users/la/Programming/kUInetic/src/effects/catalog/feedback.ts:108). The exact `gradient-mesh, confetti-burst` collision is rejected.

6. **PARTIALLY FIXED — High.** A single `fade-up timeline:view` is correctly denied a native timeline: [style-plan.ts:50](/Users/la/Programming/kUInetic/src/core/style-plan.ts:50) checks both browser support and `plan.supportedTimelines`. However, the intersection accumulator at [compile.ts:193](/Users/la/Programming/kUInetic/src/core/compile.ts:193) treats an empty intersection as “not initialized” and repopulates it from the next effect.  
   Concrete failure: `fade-up, parallax-scale, scroll-progress-ring timeline:view` has disjoint channels. After the first two effects the intersection is empty, but the third restores `['scroll','view']`, so `view()` is applied to `fade-up` anyway. `supportedActivations` has the same accumulator defect.

7. **CLOSED — High.** Hoist dispatch is guarded with `Object.hasOwn()` before invocation at [parse.ts:279](/Users/la/Programming/kUInetic/src/core/parse.ts:279). `fade-up __proto__:x` no longer throws and aborts scanning.

8. **PARTIALLY FIXED — High.** Invalid selector syntax is caught once at [primitives.ts:280](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:280), and cleanup uses a touched set at [primitives.ts:250](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:250). Two underlying problems remain:

   - `target:*` is valid and still queries and writes the entire document on every progress frame at [primitives.ts:291](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:291).
   - If a touched link already had `data-kui-active`, cleanup removes the consumer’s value instead of restoring it at [primitives.ts:298](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:298).

9. **CLOSED — High, for coverage.** Reduced motion now shortens transitions on the marked element, pseudo-elements, descendants, and form satellites at [base.css:69](/Users/la/Programming/kUInetic/src/css/base.css:69). A real-browser regression test reads computed durations for both `lift` and `checkbox-draw` at [reduced-motion.test.mjs:126](/Users/la/Programming/kUInetic/test/browser/reduced-motion.test.mjs:126). The selectors are over-broad, however; see the fresh findings.

10. **CLOSED — High.** `height` is claimed before `animateHeight()` removes it at [primitives.ts:75](/Users/la/Programming/kUInetic/src/effects/layout/primitives.ts:75). The ledger records the consumer’s value and restores it through [owned-styles.ts:39](/Users/la/Programming/kUInetic/src/core/owned-styles.ts:39). The lifecycle test exercises an actual authored `height:0px`.

11. **PARTIALLY FIXED — High.** The hardest path is improved but not complete.

   - `EffectTiming` exists at [types.ts:152](/Users/la/Programming/kUInetic/src/core/types.ts:152), is populated at [js-effect-preparer.ts:84](/Users/la/Programming/kUInetic/src/core/js-effect-preparer.ts:84), and reaches primitives through [js-params.ts:233](/Users/la/Programming/kUInetic/src/core/js-params.ts:233).
   - A one-shot typewriter genuinely waits through its delay and then resolves only after its final tick: [text.ts:210](/Users/la/Programming/kUInetic/src/effects/catalog/text.ts:210), [text-shared.ts:173](/Users/la/Programming/kUInetic/src/effects/catalog/text-shared.ts:173), and [instances.ts:218](/Users/la/Programming/kUInetic/src/core/instances.ts:218). `Animator` reads promises after activation at [animator.ts:314](/Users/la/Programming/kUInetic/src/core/animator.ts:314).
   - But `count-up 400ms 500ms linear` still starts immediately and always uses `easeOutCubic`; it consumes duration only at [numbers.ts:116](/Users/la/Programming/kUInetic/src/effects/catalog/numbers.ts:116).
   - `split-text` returns a bare cleanup at [text.ts:171](/Users/la/Programming/kUInetic/src/effects/catalog/text.ts:171), so `.finished` resolves while its child CSS animations are running.
   - `word-cycler` likewise returns a bare cleanup while its timer continues at [text.ts:307](/Users/la/Programming/kUInetic/src/effects/catalog/text.ts:307). Its test explicitly expects immediate resolution.

12. **PARTIALLY FIXED — High.** Package paths and artifacts are now real: exports point into `dist` at [package.json:10](/Users/la/Programming/kUInetic/package.json:10), `files` includes `dist` at [package.json:15](/Users/la/Programming/kUInetic/package.json:15), and `build:dist` emits ESM, IIFE, CSS, and declarations at [package.json:44](/Users/la/Programming/kUInetic/package.json:44). I imported all three existing ESM entry points and VM-evaluated the IIFE successfully; each full registry contained 229 names.  
   However, the package is still version **`0.0.0`** at [package.json:3](/Users/la/Programming/kUInetic/package.json:3). I could not run the clean build itself because it deletes/recreates `dist` and this audit environment is read-only.

13. **CLOSED — Medium.** Quote scanning tracks escapes at [parse.ts:104](/Users/la/Programming/kUInetic/src/core/parse.ts:104), `unquote()` restores escaped matching quotes at [parse.ts:164](/Users/la/Programming/kUInetic/src/core/parse.ts:164), and unterminated quotes/parentheses warn at [parse.ts:87](/Users/la/Programming/kUInetic/src/core/parse.ts:87).

14. **CLOSED — Medium.** `CompiledPlan.channels` is populated at [compile.ts:186](/Users/la/Programming/kUInetic/src/core/compile.ts:186) and [compile.ts:214](/Users/la/Programming/kUInetic/src/core/compile.ts:214). Missing individual-transform support forces the gate to `immediate` at [style-plan.ts:121](/Users/la/Programming/kUInetic/src/core/style-plan.ts:121), preventing a deferred entrance from remaining cloaked.

15. **CLOSED — Medium, for both named documentation errors.** The implementation reads only source/on/timeline/threshold at [element-config.ts:36](/Users/la/Programming/kUInetic/src/core/element-config.ts:36), and the docs now explicitly say timing has no longhand attributes at [getting-started.md:124](/Users/la/Programming/kUInetic/docs/getting-started.md:124) and [design.md:97](/Users/la/Programming/kUInetic/docs/design.md:97). Composition documentation now matches first-effect fallback at [design.md:120](/Users/la/Programming/kUInetic/docs/design.md:120) and [compile.ts:150](/Users/la/Programming/kUInetic/src/core/compile.ts:150); it no longer claims WAAPI additive resolution.

## Goal 2 — fresh findings

1. **High — deferred JS setup exceptions still escape and can abort the scan.** The preparer’s `try/catch` only wraps creation at [js-effect-preparer.ts:102](/Users/la/Programming/kUInetic/src/core/js-effect-preparer.ts:102); `deferPrepare()` postpones the real setup until activation at [instances.ts:250](/Users/la/Programming/kUInetic/src/core/instances.ts:250), and `Animator.activate()` has no per-instance isolation at [animator.ts:319](/Users/la/Programming/kUInetic/src/core/animator.ts:319).  
   `data-kui="tab-indicator-slide follow:]"` therefore throws from [layout/primitives.ts:135](/Users/la/Programming/kUInetic/src/effects/layout/primitives.ts:135) during `start()` and prevents later elements from being processed.

2. **High — feedback channel metadata remains incomplete beyond `confetti-burst`.** `spinner-dots`, `progress-indeterminate`, and `ripple` omit `background`; `spinner-dots` also omits `shadow` at [feedback.ts:77](/Users/la/Programming/kUInetic/src/effects/catalog/feedback.ts:77). Their real rules write those channels at [feedback.css:73](/Users/la/Programming/kUInetic/src/css/feedback.css:73), [feedback.css:97](/Users/la/Programming/kUInetic/src/css/feedback.css:97), and [feedback.css:200](/Users/la/Programming/kUInetic/src/css/feedback.css:200).  
   `gradient-mesh, spinner-dots` is accepted even though the later `background:` shorthand destroys the ambient gradient.

3. **Medium — reduced-motion selectors alter unrelated consumer transitions.** `[data-kui-rm] ~ label` and `[data-kui-rm] ~ svg path` at [base.css:69](/Users/la/Programming/kUInetic/src/css/base.css:69) target every matching later sibling, regardless of effect name or association. A `lift` element followed by an unrelated transitioning label/SVG has that transition forced to 1ms. `[class*='kui-']` also matches consumer class names containing that substring.

4. **Medium — time-driven marquee and gradient shimmer still do not loop.** The compiler defaults every preset to one iteration at [compile.ts:255](/Users/la/Programming/kUInetic/src/core/compile.ts:255), but neither preset defines its own infinite variable in [text.css:170](/Users/la/Programming/kUInetic/src/css/text.css:170) or [text.css:285](/Users/la/Programming/kUInetic/src/css/text.css:285). The showcase’s attempted marquee override at [text.html:130](/Users/la/Programming/kUInetic/demo/text.html:130) is a normal stylesheet rule and cannot beat the compiler’s inline iteration count.

5. **Medium security — sequence scrub remains an arbitrary image-request gadget.** Text validation explicitly accepts shape-free values at [params.ts:69](/Users/la/Programming/kUInetic/src/core/params.ts:69), and an `<img>` receives any accepted protocol/origin at [primitives.ts:238](/Users/la/Programming/kUInetic/src/effects/scroll-mechanics/primitives.ts:238). The script-execution vector is closed, but untrusted `data-kui` can still generate attacker-controlled network requests unless CSP blocks them.

6. **Medium — programmatic option serialization is not comma-safe.** `quoteIfNeeded()` quotes only whitespace at [play.ts:38](/Users/la/Programming/kUInetic/src/core/play.ts:38). `play(el, 'scroll-spy', {target: '.a,.b'})` serializes an unquoted comma, which the top-level parser splits into a second effect at [parse.ts:205](/Users/la/Programming/kUInetic/src/core/parse.ts:205).

7. **Medium workflow/test gap — the showcase still masks or describes old bugs.** The sequence-scrub page still claims braces are rejected and omits `src:` at [scroll.html:591](/Users/la/Programming/kUInetic/demo/scroll.html:591), so it does not exercise fix #2. Ambient pages retain inline preset-default workarounds at [ambient-feedback.html:385](/Users/la/Programming/kUInetic/demo/ambient-feedback.html:385), masking generator regressions. `check-showcase` only visits four pages at [check-showcase.mjs:15](/Users/la/Programming/kUInetic/scripts/check-showcase.mjs:15), excluding `ambient-feedback`, `nav-forms`, and `data-hover`.

The `dist/`, `.size-limit.json`, and package export paths themselves agree. The dev/browser workflow intentionally builds `demo/` instead; it does not validate the publishable `dist/` artifact.

## Regression-test quality

The positive-path tests for #1/#2, #5, #7, #9, #10, #13, and #14 exercise the real failure paths and would fail on straightforward reversions.

The important weak spots are:

- No test executes the generator and verifies every full-registry preset default, so reverting it to the v1 `PRESETS` list could still pass.
- Timeline tests cover one effect only and miss the three-effect empty-intersection reset.
- Scroll-spy tests cover invalid syntax and “no frame before destroy,” but not `target:*` or a pre-existing attribute that is touched.
- Reduced-motion tests have no unrelated sibling/control case.
- JS timing tests are strong for one-shot typewriter/scramble/counter completion, but explicitly codify immediate `word-cycler.finished` and do not test counter delay/easing or split-child completion.
- The CSS invariant scanner only examines `entrance.css` and `scroll.css` at [css-invariants.test.ts:21](/Users/la/Programming/kUInetic/test/css-invariants.test.ts:21), which is why the remaining feedback channel omissions pass.
- There is no clean-pack/version smoke test for #12.

A targeted Vitest rerun was attempted, but Vite tried to create a timestamped config module and was rejected by the read-only filesystem. Existing distribution artifacts were validated without writes.
