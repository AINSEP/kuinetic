# Shaders / WebGL as a labs package — scoping plan

Status: **plan only, no code written, nothing in this area has been started.** This document exists
to decide *whether and how* the package gets built, not to sequence its implementation. Where a
question has no confident answer, it is listed as open rather than guessed at — see §8.

The framing this plan implements comes from `todo.md` item 23 (the project's source of truth for
this idea) and `ADS-memory/2026-09-08-catalog-review/40-architecture-decisions-v2.md` (D3, the
Core/Add-on/Labs tier split). Read both before disputing anything here.

---

## 1. Why this is a real architectural question, not a feature request

`docs/design.md` §1a states the whole reason this library exists instead of "just use GSAP":
CSS-native execution — once `data-kui-fx` is stamped, the animation runs as a real
`@keyframes`/`animation-timeline` rule on the compositor, off the main thread, and a slow or
crashed script afterward cannot stall or corrupt it. §14 makes the boundary explicit:

> **WebGL/canvas rendering.** Supported only through an adapter that drives a user-supplied
> canvas, never as a built-in renderer.

A shared-renderer shader tier is precisely a built-in renderer. It is per-frame JS the whole way
through, a canvas that composes with no CSS channel, a real byte cost, and a new accessibility
surface. If it leaks into the core bundle or the core narrative, it contradicts the sentence that
currently explains why this project is worth existing next to GSAP.

**This plan's position:** §14's line is a true statement about *core* and should stay one. A
separate `labs` product is not an exception carved into core — it is the "adapter" pattern from
that same bullet, productized and given a shared renderer instead of leaving every consumer to
hand-roll their own canvas adapter. That reframing is what makes labs additive rather than a
contradiction, and it is worth a one-line note added to §14 pointing at this document once labs is
real — flagged as **§8, Q6**, not done here since it edits a file this task must not touch.

## 2. What ships and why

`todo.md` item 23 names five effect classes as the actual justification, each one something CSS
provably cannot do:

| Effect | Why CSS cannot do it |
|---|---|
| **True refraction** (`shader-displace`) | The thing that killed `glass-refract` — see the RULED OUT list: *"If real refraction ever matters, it is one shared WebGL renderer in a labs package, not 'CSS glass.'"* This is the one item with an existing paper trail. |
| **Fluid pointer distortion** | Needs a per-pixel displacement field driven by cursor velocity, not a fixed filter graph. |
| **Image-to-image transitions with real displacement** | Cross-fades and clip-path wipes are the CSS ceiling; a displacement-map morph between two images is a shader problem. |
| **Liquid / metaball surfaces** | Requires distance-field blending between shapes, recomputed per frame. |
| **Particle fields with actual physics** | `confetti-burst`'s five static dots (a separate, already-filed bug) is what CSS-only particles top out at; real per-particle simulation needs a GPU buffer, not five DOM nodes. |

**Scope cut, stated up front because it drives the size and complexity budget:** shader effects in
v1 operate on **raster sources already on the page — `<img>`, `<video>`, `<canvas>`** — never on
arbitrary live DOM subtrees. Rasterizing an arbitrary element tree into a texture is its own hard
problem (that is what `html2canvas`-class libraries exist for, imperfectly, at real size cost) and
it is not needed for any of the five effects above — all of them consume an image, a video frame,
or a canvas as their input texture. This is the scoping decision that keeps the renderer small
enough to have an honest budget in §6. If the owner wants live-DOM shader effects later, that is a
materially bigger package and a separate proposal.

**Deliberately does not ship in labs**, per D3's tier test and `docs/design.md` §14:

- Anything expressible in CSS. If a reviewer can point at a `filter`/`clip-path`/`mask` recipe that
  gets 90% of the look, it belongs in core or the add-on tier, not labs — GPU cost is not a style
  choice.
- Accessible UI components (accordions, carousels, menus) — out of scope for the whole library, not
  just labs (`design.md` §14).
- A general-purpose WebGL/Three.js-style engine. The package ships **named effects**, the same
  promise as the rest of the catalog (`design.md` §1: "a catalog, not an engine"), not a toolkit for
  authoring new shaders without touching the package's source.

## 3. Package shape

**A genuinely separate delivery unit, not a subpath of the existing bundle.** Two ways to spell
"separate entry point" exist and they are not equivalent — flagged as an open decision (§8, Q1)
because it is a real product call, but here is the tradeoff:

- **`"./labs"` export subpath on the existing `kuinetic` package** (parallel to today's `.`,
  `./core`, `./effects`, `./css` in `package.json`). Cheapest to ship; one repo, one publish, one
  version number for everything.
- **A separate npm package** (`kuinetic-labs` or scoped `@kuinetic/labs`, depending on what the
  main package's publish name allows). More setup, but it buys two things a subpath cannot:
  independent semver (labs can break its API without forcing a major bump on the stable core the
  rest of the catalog promises — versioning is already called out as a hard problem in `design.md`
  §12: "preset visuals ARE the API"), and the package listing itself signals "this is the
  experimental one" the way `next` vs `next-experimental`-style splits do elsewhere. D3 explicitly
  lists "unstable platform support" as one of the three qualifying traits for the labs tier — a
  separate package makes that instability contractual rather than a comment in the README.

**This plan recommends the separate package**, on the versioning argument specifically: a
shared-renderer shader effect is one browser update (a WebGL2 extension changing availability, a
driver quirk) away from needing a breaking fix, and core's users should never see that churn in
their lockfile.

Regardless of which way it ships: its own size-limit row (§6), its own docs page (not a section
appended to `docs/catalog.md`), and the loud label D3 asks for — an explicit "unstable, browser-GPU
dependent, opt-in" banner in whatever doc introduces it, not just a mention in a table.

## 4. The shared renderer — architecture and lifecycle

**One WebGL2 context for the whole page, shared by every shader effect instance.** This is the
non-negotiable constraint from the brief, and it is non-negotiable for a concrete, measurable
reason, not a style preference:

- Browsers cap the number of live WebGL contexts per page — historically around 8–16 depending on
  browser and GPU, after which the **oldest** context is silently force-lost
  (`webglcontextlost` fires with no user-visible error). A page with, say, six `shader-displace`
  instances and one context each is one scroll-heavy page away from losing the first effect a user
  scrolled past. One effect per context is not just wasteful, it is a correctness bug waiting for a
  page with enough instances.
- Every context duplicates shader compilation (a real, measurable stall — compiling a fragment
  shader is not free) and duplicates the baseline GPU memory footprint (framebuffers, default
  state) even before a single texture is uploaded.
- A shared context lets effects share compiled programs when they share a shader, and share the
  texture upload of the same `<img>`/`<video>` source if two effects ever read the same element —
  neither is possible across isolated contexts.

**Lifecycle, modeled on the pattern this library already uses for element lifecycle**
(`docs/design.md` §10: a `WeakMap<Element, InstanceState>` is the source of truth, not attributes):

1. **Created lazily**, on the first shader-effect element the labs entry point processes. Importing
   the labs module must not touch the document any more than importing core does today (`design.md`
   §10: "Importing the library must not mutate the document").
2. **Held in a module-level singleton**, reference-counted by live shader-effect instances — not a
   registry keyed by element, since the context itself has no per-element identity; what is keyed
   per element is the compiled program + texture + uniform state for that instance, all of which
   live inside the one shared context.
3. **Each shader-effect instance registers a draw call** rather than owning a render loop. The
   shared renderer runs exactly one `requestAnimationFrame` loop for the whole page (the same
   "one passive listener, not N" principle `design.md` §13 already states for scroll: "'Zero scroll
   listeners' is not a product benefit if the alternative is an always-running rAF loop... one
   shared scheduler"), and iterates registered draw calls per frame. A one-shot transition effect
   (image-to-image displacement) deregisters its draw call on completion; a continuous effect
   (liquid surface, particle field) stays registered until torn down.
4. **Torn down when the reference count reaches zero** — the last live shader-effect instance being
   released drops the canvas, the context, and stops the shared rAF loop. This mirrors `release()`
   already tearing down `state.instances` per element (`design.md` §10); the addition here is that
   the *shared* resource's teardown is gated on the count across *all* elements, not one.
5. **`webglcontextlost`/`webglcontextrestored` are handled once, centrally**, not per effect. On
   loss, every registered draw call switches to its fallback (§5) until `webglcontextrestored`
   fires and programs/textures are recompiled. This is the same event a GPU driver crash, a
   backgrounded mobile tab, or another page hogging contexts can all trigger — it is not a rare
   edge case for a page that runs any shader effect for more than a few minutes.

**The cost of getting "one renderer" wrong is not abstract — it is the context-limit failure mode
above, plus N× the shader-compile stall, plus N× the baseline GPU memory, on the exact pages most
likely to want more than one shader effect (a hero + a few inline image transitions).**

## 5. Authoring — how a shader effect looks in `data-kui`

**No new syntax.** Every prior addition to this grammar has held to "this feature adds no syntax"
(`design.md` §3.3, on `data-kui-define`) and there is no reason a shader effect needs to be the
first exception:

```html
<img data-kui="shader-displace 800ms strength:40" src="hero.jpg">
<video data-kui="liquid-surface" src="loop.mp4" muted loop></video>
```

Parameters are declared the same `ParameterSchema` way as every other primitive (`design.md` §7) —
`strength`, `frequency`, colors, whatever a given shader exposes as a uniform, each with a typed
default. This buys the same things it buys elsewhere: validation of untrusted markup before a value
reaches a shader uniform, generated docs, and editor autocomplete. It also means a shader effect's
`data-kui` attribute is inert to read for anyone who has never heard of WebGL — it looks exactly
like `fade-up distance:40px`.

**Where it gets genuinely new, and needs an owner decision, not an assumption:**

- **Composition.** Every other primitive declares the CSS channels it claims (`design.md` §4) so
  the compiler can detect collisions. A shader effect that takes over its host's paint entirely
  (the canvas *is* the visible content) is not "one more channel" — it is closer to the
  `gradient-rotate-border`/`ripple`/`confetti-burst`/`border-draw` family already flagged in
  `todo.md` as effects that deface or replace their host, and to the still-undecided
  `masksOwnContent`/`replacesHostBox` flag proposed there as the real fix (not `requiresOwnSubtree`,
  which is about CSS selectors reaching past the element, a different problem). **Recommendation:
  shader effects should ride whichever mechanism that undecided flag work lands as, rather than
  inventing a second, shader-specific exclusivity check.** That means labs' authoring story has a
  real dependency on a decision that is still open in core, not merely convenient overlap.
- **The `Effect` interface has no renderer arm for this.** `design.md` §6 defines
  `renderer: 'css-keyframes' | 'waapi' | 'javascript'`. A shader effect is none of these — it needs
  a fourth arm (`'webgl'` or similar), which is a small, additive change to `src/core/types.ts`.
  Small does not mean free: that file is explicitly off-limits to this scoping task and to most
  agents working in this repo today, so this is a concrete, named ask for whoever owns core, not
  something labs can silently work around. Same question applies to `perfClass` (§6 of
  `design.md`): the existing enum (`compositor | paint | layout | continuous | dom-transform`) has
  no arm for "runs on the GPU via a shared context," and budgeting/monitoring code that switches on
  `perfClass` today would need to know about a new one.
- **Activation.** Continuous shader effects (liquid surface, particle field) should default to
  `on:load`, the same convention `ambient.ts` already uses for continuous CSS ambient motion — see
  §7 for why. One-shot shader transitions (the image-displacement case) behave like any other
  one-shot entrance and take a normal trigger (`on:enter`, `on:click`, etc.).

## 6. The no-WebGL / blocked-GPU fallback

This has to be a **per-effect** answer, not one global rule, for the same reason `reducedMotion` is
per-effect (`design.md` §8: "Blanket `1ms` does not meaningfully reduce parallax, pinning,
flashing, or continuous ambient motion") — a single fallback policy cannot be right for both a
one-shot transition and a continuous ambient loop.

**Detection is two-layered, and both layers matter:**

1. **At install time**, feature-test with `canvas.getContext('webgl2')` (falling back to
   `'webgl'` if the effect can be written against WebGL1; recommend requiring WebGL2 only, to keep
   the shader dialect and the shared-renderer code path singular — a second GLSL dialect to
   maintain for a marginal reach gain is not worth it for a labs tier that is explicitly allowed to
   be narrow). A `null` context, or a caught exception (some blocked-GPU configurations throw
   rather than return `null`), routes straight to the fallback with no attempt to recover.
2. **At runtime**, the same fallback path fires on `webglcontextlost` (§4) — a page that rendered
   the effect successfully a minute ago and then lost the context (driver crash, backgrounded tab,
   another page's contexts evicting this one) must degrade the same way a page that never had
   WebGL does, not freeze on the last rendered frame.

**What the fallback actually shows, per effect, declared the same way `reducedMotion` is declared
on the primitive — not left to the page author to notice and handle:**

| Effect | No-WebGL fallback |
|---|---|
| `shader-displace` (refraction) | The plain, undistorted image. No CSS effect fakes real refraction — that is the entire reason `glass-refract` was ruled out of the CSS-first catalog — so there is no meaningful CSS understudy to substitute. |
| Fluid pointer distortion | No motion; the static image. Same reasoning. |
| Image-to-image displacement transition | A plain CSS cross-fade between the two images. This one has a real, meaningful CSS understudy — cross-fade is a legitimate transition in its own right, not a degraded version of nothing. |
| Liquid/metaball surface | A static rendering of the shape (an author-supplied poster image, or a single rendered frame captured once and frozen — needs a decision, see §8 Q4). |
| Particle field with physics | The plain background with no particles. A CSS particle system is a different, already-shipped thing (`confetti-burst`'s family) and should not be silently substituted for a fundamentally different effect the author explicitly asked for. |

The guiding rule, stated because it already exists elsewhere in this codebase and should not be
re-litigated for labs: **"Same degradation, never 'same behavior'"** (`design.md` §5, on scrub
fallbacks). A blocked-GPU visitor gets something honest and non-broken, never a fake shader.

## 7. `prefers-reduced-motion`

Per-effect, exactly like `reducedMotion` on every other primitive (`design.md` §6), and exactly
like the precedent already written down for continuous CSS ambient motion in
`src/effects/catalog/ambient.ts`:

> Continuous ambient motion never shortens to 1ms under reduced motion — a 1ms aurora is
> meaningless, so every primitive here declares `reducedMotion: 'disable'` and starts on `load`.

**The same reasoning applies with more force to shader effects, because they are strictly more
expensive per frame than a CSS keyframe animation.** A user who has asked for reduced motion is
very often also a user on constrained hardware or battery, and a 1ms-duration GPU shader loop is
not "reduced" in any way that matters to them — the GPU is still running every frame.

- **Continuous shader effects** (liquid surface, particle field): `reducedMotion: 'disable'`,
  matching `ambient.ts`. Falls to the same static-frame fallback described in §6 — reduced motion
  and no-WebGL converge on the same visible result for these, which is a nice property but should
  be verified rather than assumed once the renderer exists.
- **One-shot shader transitions** (image displacement): a case for `'crossfade'`, not `'disable'`
  — a short, still-real cross-fade between the two images is a legitimate reduced-motion substitute
  for a displacement transition, the same way `fade-blur-up`-style CSS entrances shorten rather than
  vanish. This is the one place labs' reduced-motion story is *not* a copy of `ambient.ts`'s, and it
  should be stated as a deliberate choice rather than inherited by accident.

## 8. Open questions for the owner

None of these block scoping the package on paper, but all of them block writing its first line of
code:

1. **Subpath export vs. separate npm package** (§3). Recommendation given: separate package, for
   independent versioning. Needs a real decision — it changes the publish pipeline.
2. **The `renderer`/`perfClass` core-type additions** (§5). Small, additive changes to
   `src/core/types.ts` that labs depends on but cannot make itself under this task's constraints.
   Needs sign-off from whoever owns core, and should probably land *before* labs authoring is
   designed in detail, not alongside it.
3. **Composition/exclusivity mechanism** (§5). Should shader effects wait for the undecided
   `masksOwnContent`/`replacesHostBox` flag from `todo.md` to land, or does labs need its own
   interim exclusivity check? Recommend waiting — building a second bespoke mechanism that the core
   flag work would then have to reconcile with is the kind of duplicate-mechanism problem this
   codebase has hit before (`ParamSpec.values`, the reserved-key collision).
4. **Static-frame capture for continuous effects' fallback** (§6). Does the library render one
   frame of the shader once (at effect-author time, or lazily on first fallback) and cache it, or
   does the *author* have to supply a poster image the way `<video poster>` works? Caching a
   rendered frame is more "it just works" but adds real complexity (when does the cache invalidate
   if the source image changes?); an author-supplied poster is simpler and consistent with how the
   web already asks authors to handle this for video.
5. **Forced-colors / `prefers-contrast`.** `todo.md` already flags this as unaddressed across the
   *entire* catalog, not a labs-specific gap. Shader effects are the worst-case instance of it —
   they paint arbitrary pixels with no relationship to the user's forced palette at all. Does labs
   wait for that catalog-wide policy decision, or does it need to set the precedent first because it
   is the most exposed case? Recommend labs waits; setting a one-off precedent here that the
   catalog-wide fix then has to match or override is the same duplicate-mechanism risk as Q3.
6. **The one-line carve-out in `docs/design.md` §14** (§1). Not this task's file to edit, but
   worth flagging explicitly so the "never a built-in renderer" line does not read as contradicted
   by this document once labs ships.

## 9. Size budget

**No confident number exists yet, and this plan says so rather than inventing one.** The only real
precedent in this repo is `.size-limit.json`'s CSS row — `14 KB` brotli, current usage `~12.2 KB` —
which was itself corrected once already this session after an earlier planning pass cited a wrong
number (`todo.md`'s note: "The original size justification was wrong"). That is the exact failure
mode to avoid here: a budget asserted before anything is built has no measured basis and has
already burned a planning cycle in this project once.

**Recommended process, modeled on how this repo already resolved a different open architecture
question** (`40-architecture-decisions-v2.md`'s D1: *"This is the one open decision, and the test
answers it rather than an argument"*): build the shared renderer plus exactly one shader effect
(`shader-displace` is the best candidate — it has the clearest existing paper trail via
`glass-refract`), measure its brotli size for real, and set the permanent labs budget from that
number rather than from a guess.

**A rough order-of-magnitude estimate, offered only to bound expectations, not as the number to
adopt:** the scope cut in §2 (raster sources only, no live-DOM capture) means the shared renderer
does not need anything resembling `html2canvas` — it needs WebGL2 context setup, a fullscreen-quad
draw path, texture upload from `img`/`video`/`canvas`, uniform plumbing, and the shared rAF loop
from §4. That is meaningfully smaller than a general rendering engine; a hand-written renderer of
that shape plausibly lands in the low single-digit kilobytes gzipped, with each additional shader
effect adding well under a kilobyte (a GLSL string plus a thin parameter-to-uniform mapping). A
budget in the same order of magnitude as the *entire* core CSS budget (14 KB) for the shared
renderer plus its first few shipped effects combined would not be a surprising outcome — but this
is an estimate reasoned from the scope cut, not a measurement, and should be replaced with a real
number at the first opportunity rather than cited as settled.

## 10. Reasons not to build this

Stated plainly, because the brief asked for honesty over confidence:

- **It is the exact tension `todo.md` item 23 names as the strong case against**, worth quoting in
  full because it is the best-argued objection available and this plan should not paper over it:
  *"'CSS-first, ~63% of the catalog never touches JS per frame' is this library's entire
  differentiator... It must not dilute the core claim."* Perfect package isolation does not fully
  neutralize this — a labs tier existing at all changes how the project gets described, and can
  shift contributor instinct toward "there's a GPU escape hatch" in code review over time, eroding
  the "if a demo page hand-writes an animation, that's a bug" culture this repo currently has
  (`todo.md`'s own ground rule).
- **The addressable effect list is short.** Five concrete ideas (§2) currently justify GPU work.
  That may not be enough surface area to justify a new package, a new renderer, new docs, a new
  size budget, and a new accessibility surface, versus documenting one effect as a "bring your own
  canvas" recipe under the adapter pattern `design.md` §14 already sanctions — no new product, no
  new maintenance commitment, just a documented pattern.
- **It compounds an already-open liability rather than starting clean.** Forced-colors and
  `prefers-contrast` are unaddressed across the whole catalog today (§8 Q5). Shipping the
  highest-risk category for that gap before the gap itself has a policy is building on ground the
  project has already flagged as unstable.
- **Real, ongoing maintenance cost that is qualitatively different from the rest of the catalog.**
  WebGL has cross-vendor driver quirks, shader precision differences across GPUs, mobile thermal
  throttling, and context-loss handling that CSS-first effects simply do not have. This is not a
  one-time build cost; it is a standing category of bug report (D3 names "unstable platform
  support" as a defining trait of the labs tier for exactly this reason) that nothing else in this
  catalog carries.
- **No verification tooling exists for it.** This repo's browser-verification tier
  (`test/browser/*.test.mjs`, driven live rather than reasoned about from source) has no established
  pattern for asserting pixel-level correctness through a shader/texture pipeline. Building that
  tooling is its own project, not a footnote to this one.
- **Competing, more proportionate work is already open and unblocking.** The channel/composition
  bugs, the reserved-parameter-key collision, and the four host-defacing effects are all still open
  in `todo.md` and are cheaper, lower-risk wins for the existing catalog. Whether labs is worth
  prioritizing ahead of those is a real tradeoff the owner should weigh explicitly, not one this
  plan can resolve.

**The case for still doing it:** every one of the five effect classes in §2 is currently either
impossible in CSS or a documented bad fake (`glass-refract`'s fate). If the owner wants that class
of effect in the catalog at all, a single shared, well-isolated renderer is a better outcome than
either building none of them, or — worse — five different agents each reaching for their own
one-off canvas hack per effect, which is the exact "one renderer per effect" failure mode §4 argues
against.
