I’ll review this as a design artifact only—no filesystem access. I’m going to concentrate on the architectural contradictions first, because a few of them will break the promised semantics before catalog size becomes the hard problem.

---

## Bottom line

There is a real product here, but the defensible version is narrower than “GSAP + twelve libraries in 250 effects.”

The strong wedge is:

> A tiny, HTML-first, framework-independent animation system that uses native CSS timelines where semantics permit, fails open, and ships accessible presets.

The weak positioning is:

> A declarative replacement for GSAP, ScrollTrigger, SplitText, FLIP, gestures, physics, page transitions, and UI components.

The second promise will force a large orchestration runtime, destroy semantic consistency across tiers, and turn 250 effects into a permanent compatibility burden.

## Highest-impact problems

| Priority | Problem | Recommended change |
|---|---|---|
| P0 | Multiple effects do not compose under the proposed CSS | Allow one declarative visual effect per element initially, or compile complete parallel animation lists with explicit conflict rules |
| P0 | `enter` and native `view()` animations have different semantics | Separate event-triggered animations from progress-linked timelines |
| P0 | The FOUC guard can permanently hide the page | Make cloaking opt-in and only activate it after the required runtime/CSS is known to have loaded; add a fail-open watchdog |
| P0 | Runtime lazy loading is too late for reveal CSS | Preload common CSS/packs; use lazy loading mainly for expensive JS effects |
| P0 | “Generic, schema-free variables” breaks validation, typing, security, documentation, and CSS precedence | Add parameter metadata while keeping execution mechanically generic |
| P1 | The three tiers conflate renderer, trigger, and timeline | Model those as separate dimensions |
| P1 | The size model probably overstates the cost of 250 aliases | Ship aliases as metadata over roughly 30 primitives; measure a complete CSS catalog before designing 250 chunks |
| P1 | The catalog mixes effects with accessible UI behavior | Separate visual effects, orchestrators, and behavior components into distinct packages |

## 1. Your composition model currently does not work

These two rules cannot both contribute an `animation` declaration:

```css
[data-anim-fx~="fade-up"] { animation: ... }
[data-anim-fx~="blur-in"] { animation: ... }
```

The cascade chooses one declaration. It does not concatenate them.

Even if the compiler emits:

```css
animation-name: anim-fade-up, anim-blur-in;
animation-duration: 800ms, 400ms;
```

you still have property conflicts. Both animations may write `opacity`, `filter`, `translate`, or `transform`. CSS animations use replacement composition by default. Additive composition is not a safe universal answer, and adding two opacity animations rarely produces the intended visual result.

Your example also promises per-effect timing:

```html
data-anim="fade-up 800ms, blur-in 400ms"
```

That contradicts the claim that timing is shared.

My recommendation:

- In the declarative v1 API, allow one effect with one timing configuration.
- Publish combined presets such as `fade-blur-up` when the combination is intentional and tested.
- Put arbitrary parallel/sequence composition in the JS API.
- If multiple declarative tracks are eventually supported, compile full ordered animation lists and document which property collisions are illegal.

Shared timing is reasonable for a deliberately composed preset. It is not reasonable for arbitrary comma-separated effects, especially after the syntax appears to assign each effect its own duration.

There is another cascade problem: `applyVars({...fx.vars})` writes defaults into `element.style`. Inline custom properties beat consumer styles, so “consumer CSS wins” is false. Keep defaults in CSS:

```css
translate: 0 var(--lib-reveal-distance, 24px);
```

Only explicit author/programmatic overrides should receive stronger precedence.

## 2. `enter` is not a view timeline

This is the most important conceptual correction.

These are different animation models:

- `enter`: a moment occurs; start an 800 ms clock animation.
- `view`: animation progress maps continuously to the element’s viewport progress.
- `scroll`: animation progress maps continuously to a scroller.
- `hover`, `focus`, `click`, `load`: state or event activation.

`animation-timeline: view()` does not natively replace an IntersectionObserver-driven timed entrance. Duration, delay, reverse scrolling, replay, completion events, and stagger all behave differently.

Visible differences include:

- Native view animations reverse as the user scrolls backward; a typical observed reveal remains completed.
- An `800ms` duration is meaningful on a time timeline but generally not the controlling concept on a scroll-progress timeline.
- Time-based stagger does not map cleanly to scroll progress.
- Deep links and elements initially above the viewport produce different starting states.
- A view timeline uses the relevant scroll container; an IntersectionObserver using the viewport does not necessarily do so.
- `animationend`, fill behavior, cancellation, and “play once” differ.
- IntersectionObserver cannot reproduce continuous parallax or scrubbing.

Use distinct syntax:

```html
<div data-lib-anim="fade-up" data-lib-on="enter" data-lib-threshold="30%">
<div data-lib-anim="parallax" data-lib-timeline="view 10% 90%">
<div data-lib-anim="progress" data-lib-timeline="scroll">
```

Then define fallback semantics honestly:

- `enter` always uses an event/observer activation model.
- `view` and `scroll` use native CSS timelines when available.
- A non-native fallback either samples progress with a shared scheduler or degrades to a documented non-scrub reveal.

“Same attribute, approximately similar degradation” is achievable. “Same behavior” is not.

## 3. Replace the three tiers with orthogonal capabilities

The current tiers combine unrelated concerns:

- Who renders the frame?
- What activates it?
- What controls progress?
- Does it need setup or DOM transformation?

A better internal model is approximately:

```ts
interface Effect {
  name: string
  renderer: 'css-keyframes' | 'waapi' | 'javascript'
  parameters: ParameterSchema
  supportedTimelines: Array<'time' | 'view' | 'scroll' | 'pointer'>
  prepare?: PrepareFunction
  cleanup?: CleanupFunction
}
```

Separately:

```ts
type Activation = 'load' | 'enter' | 'hover' | 'focus' | 'click' | 'manual'
type Timeline = 'time' | 'view' | 'scroll' | 'pointer'
```

A CSS keyframe effect can still require IntersectionObserver activation. A JS-prepared effect such as split text might render through CSS after setup. A WAAPI effect may run without per-frame JavaScript.

Also, one global check is inadequate:

```js
CSS.supports('animation-timeline', 'view()')
```

You need per-capability checks and behavioral tests for things such as:

- `animation-range`
- named timelines and `timeline-scope`
- nested scroll containers
- individual transform properties
- additive animation composition, if used
- clip-path and SVG interpolation
- browser-specific lifecycle bugs

Native scroll animation support is good enough to be a major enhancement. It is not a sufficient abstraction boundary by itself.

## 4. The tree-shaking strategy should not depend on build plugins

Template scanning is useful, but it should be an optional optimizer, not the main payload story.

It breaks on:

- dynamically constructed effect names
- CMS or database-provided markup
- JSX/template abstractions that do not contain literal attributes
- aliases and constants around `.play()`
- runtime localization or A/B tests
- custom template languages
- monorepos where templates live outside the bundler graph
- arbitrary HTML inserted after build
- user configuration that lists effects indirectly

A grep-based scanner will also misparse commas inside `steps()` or `linear()` and find strings in comments/examples. Use AST/template adapters where available, plus a safelist and extraction callback.

### Better packaging model

Offer three explicit products:

1. **CDN starter build**

   Core plus the common reveal/hover primitives and their CSS. Deterministic, no lazy flash.

2. **CDN loader build**

   Small manifest and lazy JS packs for uncommon expensive features. Market it as the flexible build, not the default smallest build.

3. **Explicit ESM core**

```js
import { createAnimator } from 'the-lib/core'
import { fadeUp, tilt } from 'the-lib/effects'

const animator = createAnimator({
  effects: [fadeUp, tilt]
})

animator.play('.card', fadeUp)
```

Passing an effect object gives bundlers something statically visible and gives TypeScript effect-specific options. String names remain available for already-registered effects.

The build-time scanner can transform strings into those imports, but correctness must not depend on that transformation.

### Reconsider what needs splitting

If 250 names come from about 30 primitives, do not create 250 runtime chunks. Ship:

- a compressed alias table mapping names to primitives and defaults
- CSS per primitive or category
- lazy chunks only for expensive JS implementations

CSS containing all reveal presets may compress extremely well. Your estimate of 200 bytes per named CSS effect likely counts repeated syntax before gzip. Generate the entire proposed catalog and measure gzip/Brotli plus request overhead before accepting the premise that it must be split.

Fifteen tiny network requests can be worse than one 10 KB stylesheet.

### Lazy loading hazards

Unknown-name loading needs:

- A fixed manifest, never `import("./effects/" + userValue)`.
- Promise deduplication.
- Pending, ready, failed, and cancelled states.
- Resumption of the exact parsed specification after loading.
- CSS-load completion before an element is hidden or activated.
- An explicit asset base for unpkg, jsDelivr, self-hosting, and bundlers.
- CSP and cross-origin failure handling.
- Limits against user-generated markup requesting hundreds of expensive effects.

The scanner shown currently encounters an unknown effect, starts loading it, then stamps `data-anim-fx`. The `:not([data-anim-fx])` selector prevents ordinary rescanning. That element can be lost permanently.

## 5. The attribute grammar is CSS-like, but not actually CSS

Mirroring CSS shorthand sounds familiar but imports substantial ambiguity:

- CSS shorthand permits values in more than one order.
- `steps()` and `linear()` can contain commas.
- Animation names can collide with grammar keywords.
- You have omitted iteration count, direction, fill mode, play state, and timeline.
- Effect-specific positional arguments will become irresistible as the catalog grows.
- Error messages from a dense positional grammar are poor.
- HTML authors are generally less comfortable with CSS shorthand parsing rules than this design assumes.

Prefer a deliberately smaller grammar:

```html
<div
  data-lib-anim="fade-up"
  data-lib-duration="800ms"
  data-lib-delay="200ms"
  data-lib-ease="out"
  data-lib-on="enter"
  data-lib-threshold="30%">
```

This is verbose but legible, inspectable, and easy for CMS editors to generate.

If shorthand remains, define it as your grammar rather than claiming CSS equivalence:

```text
effect [duration] [delay] [easing]
```

Require that order and reject unexpected tokens with useful development warnings.

I would omit comma-separated composition from v1.

Also, `data-anim` and `--anim-*` are too generic for a public library. They will collide with site code and other libraries. Use a short project namespace for:

- attributes
- custom properties
- keyframe names
- cascade layers
- emitted events

Keep the source/normalized distinction; that part is sound. The normalized attribute should be documented as library-owned and unstable.

## 6. A schema-free argument system is a false economy

You need parameter metadata even if the execution remains generic:

```ts
parameters: {
  distance: {
    type: 'length',
    default: '24px',
    cssProperty: '--lib-reveal-distance'
  }
}
```

Without it, you cannot provide:

- TypeScript options
- editor autocomplete
- generated documentation
- validation and useful warnings
- safe handling of untrusted markup
- unit normalization
- effect-specific reduced-motion behavior
- compatibility metadata
- stable semver guarantees

Custom-property values are not harmless strings. Once substituted into CSS, values such as URLs, huge filters, pathological calculations, or invalid syntax can create security and performance problems.

Use variables namespaced by primitive rather than generic names where collisions are possible:

```css
--lib-reveal-distance
--lib-tilt-perspective
--lib-text-blur
```

The compiler can still be generic over the schema. Adding a CSS-only parameter would require metadata plus CSS, not bespoke runtime logic.

## 7. The FOUC guard is not fail-open

The proposed sequence fails like this:

1. The inline head script executes and sets `data-anim="ready"`.
2. The stylesheet loads and hides every `[data-anim]`.
3. The CDN library fails.
4. The page remains hidden forever.

It also reuses `data-anim` on the root for an unrelated runtime state, and it hides hover effects, tilt targets, counters, and anything else carrying the attribute—not merely entrance reveals.

There is no perfect combination of zero flash, asynchronous loading, strict CSP, and unconditional fail-open. Make the tradeoff explicit.

Recommended policy:

- Default mode is fail-open and does not globally cloak content.
- Zero-FOUC cloaking is opt-in.
- Only elements known to be reveal effects receive a cloak marker.
- The required reveal CSS is loaded eagerly.
- A nonce/hash-compatible bootstrap or external bootstrap installs the cloak.
- A short watchdog removes the cloak if initialization does not complete.
- Print and reduced-motion CSS always force final readable state.

Do not rely on `animationend` as a correctness mechanism. It may not fire after cancellation, removal, replacement, or certain reduced-motion paths. State machines need cancellation and timeout handling.

Reduced motion also needs effect-specific policy. Setting everything to `1ms` does not meaningfully reduce parallax, flashing, pinning, 3D rotation, or continuous ambient motion.

## 8. Performance claims need to become budgets, not absolutes

Several invariants conflict with the catalog:

- `filter` is not reliably compositor-cheap.
- `clip-path`, SVG morphing, text effects, gauges, and background effects can require painting.
- Accordion auto-height inherently involves layout.
- FLIP requires layout measurement.
- Scramble text and counters change text, potentially causing layout.
- Pinning and continuous scrub fallbacks may need scroll-position sampling.

“One passive listener per active scroll root that marks a shared rAF scheduler dirty” is a perfectly good architecture. “Zero scroll listeners” is not a product benefit if the alternative is an always-running rAF loop or visibly different fallback.

Classify effects instead:

- compositor-friendly
- paint-heavy
- layout-measuring
- continuous CPU
- DOM-transforming

Attach performance budgets and automated tests to each class.

Likewise, `will-change` cannot always be installed shortly before activation and removed on completion while also promising zero runtime JavaScript for native scroll timelines. Use it sparingly; persistent `will-change` across large scroll ranges can consume substantial memory.

## 9. Scanner and lifecycle holes

Even as pseudocode, the scanner exposes missing contracts:

- `querySelectorAll()` does not include `root` itself when an inserted root carries the attribute.
- `css-observed` is not handled by the shown condition.
- A CSS fallback calls `fx.setup`, although `setup` is declared JS-tier-only.
- Changing `data-anim` after processing does not recompile it.
- Removed elements are not cleaned up.
- Lazy-loading races can leave partially initialized elements.
- Applying shared variables inside the loop makes the last effect win.
- Replaying the same CSS animation requires a defined restart mechanism.
- MutationObserver work needs batching and subtree limits.
- Stagger needs a defined group selector, dynamic-child behavior, and reindex policy.
- Unknown, malformed, or duplicate effect names need documented behavior.

Use a `WeakMap<Element, InstanceState>` as the source of runtime truth. Attributes are useful for CSS and debugging but are a poor state machine.

The auto-observing build and explicit core should be separate entry points. Library import should not mutate the document automatically in SSR or application environments.

## 10. Programmatic API changes

The selector wrapper is pleasant, but `.play()` returning something awaitable while `.stop()` belongs to the selection is underspecified.

Prefer a playback handle:

```js
const run = animator.play('.card', fadeUp, {
  duration: 800,
  stagger: 60
})

await run.finished
run.cancel()
run.finish()
run.reverse()
```

Define:

- whether completion waits for every selected element
- cancellation result versus rejection
- behavior for infinite, hover, and scroll-linked animations
- whether a second play replaces, queues, or runs concurrently
- whether `stop()` restores original inline styles and DOM
- empty-selector behavior
- live versus snapshotted collections

Use `Element`, not `HTMLElement`, because SVG is in scope.

Prefer an instance API:

```js
const animator = createAnimator({
  root: document,
  effects,
  reducedMotion: 'respect',
  assetBase
})
```

This makes ShadowRoots, iframes, testing, multiple versions, and SSR much easier than a process-wide registry.

## 11. Platform concerns that need first-class designs

### Shadow DOM

Document CSS and MutationObservers do not cross shadow boundaries.

Provide `animator.attach(shadowRoot)` and a stylesheet installation strategy. Closed shadow roots must be initialized by their owner. Do not pretend global auto-scan can support them.

### SSR and hydration

Imports must have no browser side effects. Provide explicit `start()` or `hydrate()` entry points. Mutating attributes before a framework hydrates can produce mismatches or races, so document initialization after hydration or provide deterministic server normalization.

### CSP

Do not claim CSP compatibility until tested with real headers in Chromium, Firefox, and WebKit.

Specific problems include:

- the inline head guard needs a nonce or hash
- dynamic imports must be permitted by `script-src`
- CDN CSS must be permitted by `style-src`
- inline style/custom-property mutation has browser and policy nuances
- nonce-backed `<style>` elements and constructed stylesheets are not interchangeable across policies

Offer a CSP-strict mode with external CSS and finite class/data tokens. Arbitrary per-element CSS values may require inline CSSOM mutation or a nonce-backed generated stylesheet; document that tradeoff.

### Accessibility

At minimum:

- Split text by grapheme clusters using `Intl.Segmenter`, not code units.
- Do not split arbitrary interactive or semantically rich descendants.
- Preserve one accessible reading representation; visual fragments should not be announced individually.
- Do not spam `aria-live` while counters animate; expose the final value.
- Invisible reveal targets must not become invisible keyboard focus targets.
- Pinned sections must preserve keyboard navigation and reading order.
- Hover interactions require focus and coarse-pointer behavior.
- Add policies for flashing, continuous motion, zoom, forced colors, and reduced transparency—not only reduced motion.
- Restore selectable/searchable text after temporary splitting where possible.

### Directionality

Keep `slide-left` physically left. Add logical names:

- `slide-inline-start`
- `slide-inline-end`
- `slide-block-start`
- `slide-block-end`

Silently reversing “left” in RTL would be surprising.

### Print

Ship an unconditional final-state print layer disabling animation, transforms, filters, clipping, sticky pinning, and hidden initial states.

### Versioning

Treat preset visuals as API. Changing default distance, easing, or direction can break branded sites even if TypeScript remains compatible.

Have explicit policies for:

- immutable names and defaults
- aliases and deprecation
- custom-effect collision behavior
- duplicate library copies
- CDN version pinning
- registry/plugin compatibility

## 12. The catalog is mixing three different products

These are visual effects:

- fade
- blur
- clip wipe
- path draw
- tilt

These are orchestrators:

- scrollytelling
- pinning
- sequencing
- FLIP
- shared-element transitions

These are accessible behavior components:

- accordion
- carousel
- menu
- before/after control
- form feedback

They should not share one flat `Effect` interface. Menus and accordions own state, targets, focus, keyboard behavior, and ARIA. Treating them as animation presets will produce attractive but inaccessible components.

Suggested package boundaries:

- `core`
- `effects`
- `text`
- `scroll`
- `layout`
- `gestures`
- `view-transitions`
- `adapters`

The 250 public names can still exist eventually, but classify them as presets, primitives, orchestrators, and components.

## 13. Testing strategy

Animation testing must be deterministic, not merely “take a screenshot after 500 ms.”

Test:

- Parser and normalization contracts.
- Effect metadata/schema validation.
- Visual states at 0%, 25%, 50%, 75%, and 100%.
- Forward and reverse scrolling.
- Nested and horizontal scrollers.
- Resize during animation.
- Dynamic insertion, removal, and attribute changes.
- Chromium, Firefox, and WebKit.
- Reduced motion, RTL, zoom, print, forced colors, keyboard-only use.
- Strict CSP response headers.
- SSR/hydration races.
- ShadowRoots and iframes.
- Memory cleanup after repeated page transitions.
- Per-effect layout, paint, and long-task budgets.

Build a controllable timeline abstraction so tests can set progress directly instead of depending on wall-clock timing.

## Recommended v1

I would ship:

- Roughly 20–30 primitives and 60–80 named presets.
- One declarative effect per element.
- Separate `enter` and progress-linked `view` semantics.
- Load, enter, hover/focus, and manual triggers.
- Native view/scroll timelines with an explicitly documented fallback.
- A complete small CSS preset sheet if measurement shows it compresses well.
- Lazy JS only for tilt, counter, scramble/split, and similarly expensive features.
- Explicit ESM effect imports plus a CDN starter build.
- An optional build scanner, not a required one.
- No pinning, general FLIP, physics, gestures, accessible UI components, or arbitrary composition until the lifecycle model is proven.

There is a market gap for that library. It becomes “a worse GSAP” only when it claims general choreography and application behavior. The defensible promise is not “everything GSAP can do without JavaScript”; it is “the common 80% of web motion, directly from HTML, with native execution and strong progressive enhancement.”