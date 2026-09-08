# Shaders / WebGL as a labs package — scoping plan

Status: **plan only, no code written, nothing in this area has been started.** This document exists
to decide *whether and how* the package gets built, not to sequence its implementation. Where a
question has no confident answer, it is listed as open rather than guessed at — see §9.

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
real — flagged as **§9, Q6**, not done here since it edits a file this task must not touch.

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
enough to have an honest budget in §10. If the owner wants live-DOM shader effects later, that is a
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
"separate entry point" exist and they are not equivalent — flagged as an open decision (§9, Q1)
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

Regardless of which way it ships: its own size-limit row (§10), its own docs page (not a section
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
   loss, every registered draw call switches to its fallback (§7) until `webglcontextrestored`
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
like `fade-up distance:40px`. **§6 designs the full uniform surface** — the type-to-uniform
mapping, the catalogue-vs-custom-GLSL question, and how pointer/time/resolution reach a shader
without a per-frame custom-property round trip — because the owner has since named this the plan's
main deliverable, not the one paragraph it was here.

**Where it gets genuinely new, and needs an owner decision, not an assumption:**

- **Composition.** Every other primitive declares the CSS channels it claims (`design.md` §4) so
  the compiler can detect collisions. A shader effect that takes over its host's paint entirely
  (the canvas *is* the visible content) is not "one more channel" — it is closer to the
  `gradient-rotate-border`/`ripple`/`confetti-burst`/`border-draw` family already flagged in
  `todo.md` as effects that deface or replace their host. §6 resolves this without waiting on that
  family's still-undecided `masksOwnContent`/`replacesHostBox` fix: a shader effect declares its own
  reserved channel through `Channel`'s existing open `string` arm (`types.ts:54`) rather than
  needing a new core mechanism, which is what makes `data-kui="fade-up, shader-warp"` a defined,
  supported composition today instead of a dependency on an open core decision.
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
  §8 for why. One-shot shader transitions (the image-displacement case) behave like any other
  one-shot entrance and take a normal trigger (`on:enter`, `on:click`, etc.).

## 6. Parameters — the uniform surface a shader effect exposes

§5 undersold this. It was written when the parameter surface was one paragraph of a scoping plan;
the owner has since said it is the plan's main deliverable, in his own words: there are probably a
lot of different ways and colours people will want to add shaders, so authors need to be **highly**
flexible in how they build them. He has also said, just as plainly, that he does not know how
shaders work beyond one effect he has seen — so what follows is not a transcription of an
instruction, it is this document's own design, offered for him to accept, amend, or reject.

That flexibility has one hard boundary the owner stated explicitly, which this whole section is
designed *inside of*, not around: **shader effects are authored in the same `data-kui` attribute as
everything else.** `data-kui="shader-warp color1:#e4f222 strength:0.4 speed:0.8"`, never a second
attribute such as `data-kui-shaders="..."`. Concretely, that is three constraints, each load-bearing
for what follows:

- **The grammar is the existing flat `key:value` list** — the same one `duration:`, `ease:` and
  `target:` already use — never a JSON blob, a nested object, or a second grammar smuggled inside
  one value's string. Every design choice below (the type-to-uniform table, "two keys instead of
  `vec2`", the fixed-slot answer to array-shaped uniforms) is downstream of this constraint, not a
  coincidence that the existing grammar happens to fit.
- **Shader effect names live in the same flat namespace as the other ~283 names.** `shader-warp` is
  an ordinary primitive/preset registered into the same registry as `fade-up`, subject to the same
  collision check any new catalog addition already gets — `shader-*` is a naming convention this
  plan adopts for readability, not a mechanism, and nothing about it is reserved at the parser
  level. What `data-kui="fade-up, shader-warp"` means is answered below, alongside composition.
- **The package split in §3 is a delivery concern the attribute must never expose.** Whether labs
  ships as a subpath or a separate package, an author's markup is identical either way — a `<script>`
  tag or an import, plus the same `data-kui` attribute they already write. If choosing between the
  two options in §3 ever turned out to require a different authoring surface, that would be a sign
  the wrong option had been picked, not a cost worth paying.

The good news, established by reading `core/types.ts` and `core/params.ts` directly rather than
from stale examples: the `ParamSpec` system that shipped today — `keywords` replacing `values`,
plus the `number|percentage`/`length|percentage`/`angle|keyword` unions — already fits a shader
uniform's shape almost exactly, for a reason that has nothing to do with shaders. Every uniform a
fragment shader usefully exposes is, in the end, a float, a small vector of floats, or an integer
selecting one of a closed number of paths through the shader — and that is precisely the shape
`ParamSpec.type` already type-checks for CSS custom properties. `type: 'number'` bounded by
`minimum`/`maximum`/`finite`/`integer` covers `strength`, `speed`, `frequency`, a noise seed.
`type: 'color'` covers `color1`, `color2`, a tint. `type: 'keyword'` covers a closed set of named
modes (`blend:screen`, `edge:wrap|clamp|mirror`) exactly as cleanly as it covers `mode` on any CSS
primitive today. Nothing about a shader uniform, as scoped in §2, asks the type system for a
grammar it does not already have.

**The mapping.** Each key is declared exactly the way `distance` is declared on `fade-up`
(`design.md` §7) — a `ParamSpec` with a `default`, a `cssProperty`, and whatever bounds apply:

```ts
parameters: {
  color1:   { type: 'color',  default: '#e4f222', cssProperty: '--kui-shader-warp-color1' },
  strength: { type: 'number', default: '0.4', minimum: 0, maximum: 1, cssProperty: '--kui-shader-warp-strength' },
  speed:    { type: 'number', default: '0.8', minimum: 0, cssProperty: '--kui-shader-warp-speed' },
}
```

`resolveParams`/`validate` run exactly as they do for every other primitive — this must never
become a second validation path. An out-of-range or malformed value takes the same road every other
parameter's does: `checkNumericConstraints` (`params.ts:477-489`) *rejects* rather than clamps —
`strength:4` does not quietly become `strength:1`, it becomes the declared default (`0.4`), with a
warning naming which bound it broke. A shader tier that clamped silently instead would be a second,
inconsistent contract an author has to learn just for this package, for a class of value (per-pixel
GPU math) where a silently substituted number is *more* dangerous to get wrong than a CSS length is
— a clamped `strength:400` fed into a displacement shader can still be a broken, flashing mess at
the clamp boundary, so "reject to a known-good default" is the right answer here even more than it
is elsewhere.

The one place this is genuinely new is the last mile — turning a *validated string* into a *number
a `gl.uniform*` call accepts* — and `ParamSpec.type` again does the deciding, with no new
declarative field required:

| `ParamSpec.type` | Validated form | Upload |
|---|---|---|
| `number` (bounded) | a decimal string | `gl.uniform1f(loc, Number(value))` |
| `color` | `#rrggbb`, `rgb()`/`hsl()`/`oklch()`/…, a keyword, or `currentColor` | resolved to linear 0–1 floats (below), `gl.uniform4fv` |
| `keyword` | one of a closed, ordered list | `spec.keywords.indexOf(value)`, `gl.uniform1i` |

No `vec2` type is proposed for a two-axis uniform (a fixed distortion centre, a wind direction).
The catalog already has a working answer for "one authored idea, two custom properties": `tween`'s
`x`/`y` are declared as two independent parameters rather than one packed value (`types.ts`'s
`EffectVariant` doc, on why `tween x:100` and `tween opacity:0` are handled per-key), and
`resolveParams` already validates each key on its own. A shader effect with a two-axis knob should
declare `centerX`/`centerY` the same way, not invent a comma-packed `center:30,60` that would need
its own parser. If a genuinely packed value shows up later, the codebase's other precedent —
`variantFor` expanding one authored value into several synthesised parameter specs, the way the
tween primitive expands a comma list into `--kui-tween-x-1`, `-2`, `-3` (`types.ts` on
`EffectVariant.schema`) — is the fallback, not a new `ParamType`. **No new `ParamSpec` type is
needed for shader uniforms as scoped in §2.** The real gap is not in the type vocabulary at all —
it is in the runtime reader, covered below.

**A real ceiling worth naming, not solving with new syntax.** The `key:value` grammar has no way to
express a variable-length list — an arbitrary number of metaball centres, an arbitrary number of
gradient stops — and it should not grow one just for this. The catalog already has a precedent for
exactly this limitation: `confetti-burst` doesn't take an open `colors:` list, it takes `color1`
through `color5`, five numbered keys, a fixed cap chosen at design time (`feedback.ts:135-139`). A
shader effect that wants an array uniform should follow that precedent — a fixed, generous cap as
numbered keys (`center1X`/`center1Y` … `center6X`/`center6Y`) rather than a comma-packed or
JSON-shaped value. An author who genuinely needs more than the shipped cap has no route through
`data-kui` at all, at any cap size someone picks — only the custom-GLSL tier below, which supplies
its own JavaScript and is not limited to attribute-string uniforms. That is a real, honest limit on
"highly flexible," not a gap this plan missed; naming it plainly is more useful than pretending a
bigger cap or a packed syntax would make it go away.

**Composition: what `data-kui="fade-up, shader-warp"` means.** §5 flagged this as a real dependency
on the still-undecided `masksOwnContent`/`replacesHostBox` flag from `todo.md`, proposed there to
fix `ripple`/`confetti-burst`/`border-draw`-style host-defacing effects. That flag is for
*retrofitting* four existing primitives onto a mechanism narrower than `Channel` that predates
today's open extension point. A shader effect has no such history — it can be designed correctly
from day one using the mechanism `Channel` already offers: "third-party primitives register their
own channels" (`types.ts:54`). So every shader effect declares a shared, reserved channel — call it
`gpu-paint` — that is not one of the built-in `CHANNEL` members and, critically, is not unique per
effect name. Shared rather than per-effect matters: if `shader-warp` and `liquid-surface` each
declared their *own* distinctly-named channel, the collision detector would see two disjoint sets
and wave through `data-kui="shader-warp, liquid-surface"` — two shader effects both trying to own
one canvas on one element, a real conflict, not a composable one. One shared channel name across the
whole shader family is what makes that case correctly refuse, the same way two `fade-up`s both
claiming `translate` already correctly refuse today.

A shader effect should also claim `filter`/`background`/`clip` defensively, alongside `gpu-paint` —
not because those are the channel it conceptually owns, but because a WebGL texture upload samples
an `<img>`'s *pixels* once, and a later CSS `filter`/`background` change on that same element has no
way to reach a texture already uploaded; composing `shader-warp` with `blur-in` would otherwise
silently produce a confusing mismatch (an unblurred shader output sitting over, or instead of, a
blurred source image) rather than a clean refusal. Claiming these defensively is intentionally
broader than the shader's own paint, on the same "a silent drop is worse than a console error"
principle `40-architecture-decisions-v2.md`'s D1c already established for the channel model
generally — it may refuse a combination that would, in some specific case, have been harmless, and
that is the acceptable side to be wrong on.

Under this design, `data-kui="fade-up, shader-warp"` **composes**: `fade-up` claims
`translate`/`opacity`, `shader-warp` claims `gpu-paint` plus its defensive channels, and the sets are
disjoint — exactly the rule `fade-up, shine-sweep` already passes today
(`test/compile-warnings.test.ts:165`). Fading a box up while a shader plays inside it is a normal,
wanted combination and nothing here blocks it. This needs no change to `src/core/channels.ts` or the
collision detector — it is a channel-declaration choice inside the labs package's own primitives,
exactly the extension point that mechanism was built to take.

**The one real gap: resolving a colour to floats.** `EffectParams` (`types.ts:461-475`) is what a
JS-rendered primitive actually reads from — `.text()`, `.ms()`, `.num()`, `.is()` — and it has no
colour accessor. That is not an oversight in today's catalog: every existing `type: 'color'`
parameter (`ambient.ts`'s `from`/`to`, `materials.ts`'s `tint`/`rim`, `feedback.ts`'s five confetti
colours) is consumed only by CSS through `var()` — the "read by CSS" case in
`ParamSpecBase.cssProperty`'s own doc comment (`types.ts:229-234`). None of them has ever needed to
become a JavaScript number, because CSS resolves colour functions and `currentColor` itself. A
shader uniform is the first consumer in this codebase that needs the case that comment doesn't yet
name: *read by a GPU uniform*, resolved to floats in JavaScript before `prepare()` ever sees it.

The mechanism cannot be "parse the string by hand." `validate()`'s colour grammar is deliberately
CSS's own — hex, `rgb()`/`hsl()`/`oklch()`/`lab()`/`color()`, any bare keyword, `currentColor` —
precisely so an author can write a real CSS colour, not a shader-specific subset. Reimplementing
`oklch()`-to-linear-sRGB conversion in this library would be real, fiddly colour-science code with
its own bug surface, for a browser capability that already exists. The right tool is the same one
`core/easing.ts` (reading `--kui-ease-*` back off a computed style) and `scroll-mechanics/tracker.ts`
already reach for when JavaScript needs an answer only the browser's own CSS engine can give: ask
the browser, via a real computed style. Concretely, a small offscreen probe element, shared once by
the renderer (the same "one shared thing, not N" instinct as the rAF loop in §4), with the
validated colour string written onto its **`color` property** — a real, typed, computed CSS
property, not the custom property the author's value was validated into — and the shader reader
takes `getComputedStyle(probe).color` back.

That distinction matters and is easy to get backwards: an *unregistered* custom property
(`--kui-shader-warp-color1`) is never parsed or converted by the browser at all —
`getComputedStyle` on a plain `--custom` property returns the literal string that was set, verbatim,
nothing more. Reading the custom property back would just hand the shader the same unresolved
string `validate()` already accepted, `currentColor` included — no closer to a float than before.
Only a **standard, typed** property computes, which is why the probe has to exist and has to use
`color`, never the effect's own `--kui-*` property, as the property the value is assigned to.

**Open question, added to §9 as Q7:** this document has no live browser to check against, and the
exact computed-value serialization a probe gets back is a genuinely live web-platform area, not
settled trivia. `rgb()`/hex inputs have returned parseable `rgb(r, g, b)` computed values for a long
time; whether an author-written `oklch(...)`/`lab(...)` input comes back from `getComputedStyle` as
an `rgb()` triple, or is preserved and serialized in its own colour-space function (which modern CSS
increasingly allows engines to do), needs verifying in real Chromium/Firefox/Safari before the
parsing code is written, not assumed from spec text. If it does not come back uniformly, the probe
technique still works — it needs a per-space parser for whichever handful of serializations show
up, a bounded and testable problem rather than the open-ended one of parsing every CSS colour
grammar an author might write.

**A second, sharper finding, worth fixing regardless of shaders:** `params.ts`'s `COLOR_KEYWORD`
pattern is `/^[a-z]+$/i` — it accepts *any* alphabetic word as a "valid" colour, not a check against
CSS's real named-colour list. Today that is harmless: an author who types `color1:foo` gets a custom
property holding the string `foo`, a stylesheet reading it with `var(--x, black)` simply fails at
computed-value time for that one declaration — CSS's usual silent-invalid behaviour — and nothing
visible breaks. Feed that same accepted-but-nonsense `foo` through the probe technique above,
though, and the probe's own `color` declaration is invalid and is *ignored*, leaving the probe
holding whatever colour it last held — the shader would read a stale or default colour and render
it with total confidence, which is worse than CSS's silent no-op: a visibly wrong colour reads as
"the shader is working, just badly" rather than "this didn't apply." The fix — a real keyword
allowlist, or having the probe step detect "no change happened" and treat that as invalid — is a
one-line change to `src/core/params.ts`, which is off-limits to this task, so it is named here as a
concrete, scoped ask for whoever next touches that file, in the same spirit §5 already names the
`renderer`/`perfClass` additions.

**Pointer, time, and resolution: fed, not authored.** Nothing here is a `ParamSpec`. A pointer
position, the current frame's timestamp, and the canvas's backing-store size are not values an
author writes in `data-kui` — they are the reason the effect needs a shader at all — and routing
them through the custom-property pipeline the way an authored `strength` goes would directly
contradict §4's argument for one shared renderer over one context per effect: writing three
uniforms' worth of values to `element.style` every animation frame, for every live shader instance,
then reading them back with `getComputedStyle` (which forces a style recalculation), is the
"always-running main-thread cost" `design.md` §13 already singles out scroll listeners for, applied
to something that changes every single frame rather than every scroll tick. So these are fed
directly, inside the one shared `requestAnimationFrame` callback §4 already establishes, straight
into the WebGL program's uniform slots — never touching a custom property, `element.style`, or
`getComputedStyle`:

- **Time** costs nothing extra: the timestamp the shared rAF loop already receives as its argument,
  uploaded as one `u_time` float shared by every registered draw call that wants one.
- **Resolution** is the canvas's own size (or the source `<img>`/`<video>`/`<canvas>`'s rendered
  box, read once on resize via the same layout-observation pattern the rest of the catalog already
  uses), pushed only when it changes, not every frame.
- **Pointer** needs a genuinely new piece of *shared* state, but not a new pattern:
  `effects/gestures/primitives.ts` already tracks `pointermove` for cursor-following effects
  (`cursor-lag`, at `primitives.ts:326-338`), one `addEventListener('pointermove', …)` per instance.
  That is the "one per element" version of exactly the failure mode §4 argues against for WebGL
  contexts — fine at one instance, wasteful and eventually janky at a page's worth of them. The
  shared renderer should install **one** `pointermove` listener, shared by every registered draw
  call the same way the one rAF loop already is, and hand each shader program the pointer position
  in that shader's own texture-local coordinate space, not raw client coordinates, at upload time.
  This is the same "one shared scheduler, not N" principle `design.md` §13 states for scroll,
  applied to pointer tracking for the first time in this codebase — worth stating as a precedent
  this plan sets, not merely one it follows.

**The big question: a catalogue, raw GLSL, or both.** Recommendation: **both, with the boundary
drawn at how the GLSL reaches the runtime, not at how flexible the result looks.**

A fixed catalogue — named effects (`shader-warp`, `shader-displace`, `liquid-surface`, …) each
shipping its own GLSL and its own `ParameterSchema` of typed uniforms, authored through `data-kui`
exactly like every other primitive — is what §2 already scoped and what this section designs in
full above. It gets everything the rest of this library's authoring story gets for free: the
escape-screening in `params.ts` that exists because "`data-kui` content is not always authored by
the site owner — a CMS field or a comment can reach it" (that module's own doc comment, on why
`isSafeCssValue` exists at all), generated docs, editor autocomplete, and a validated value the
compiler can reason about. It is also, definitionally, capped at whatever shapes were shipped — the
owner's "highly flexible" ask is not fully answered by a closed list, however deep each entry's own
parameter surface goes.

Raw author-supplied GLSL is the literal maximum of that flexibility, and it is worth being precise
about why it cannot be accepted the same way a `strength` value is. `data-kui` is an HTML
*attribute*, and this document's own security model — the one `params.ts` exists to enforce —
treats every attribute value as untrusted input that might not have been written by whoever
controls the page's JavaScript. `ParamSpec.validate` can reject a string; it has no mechanism to
review a *program*. A fragment shader is not a value with a grammar to check, it is code, and there
is no `checkNumericConstraints` for "will this shader body finish in a reasonable time per pixel on
every GPU that loads this page." Accepting multi-line GLSL through an attribute an untrusted CMS
field or comment box could populate is not a narrower version of the injection surface `params.ts`
already defends against — it is a strictly worse one, because the payload is compute the browser
will actually execute on the GPU, not a CSS value the cascade can only mis-render. This is also,
separately, the same identity argument §2 already uses to keep a general WebGL/Three.js engine out
of scope (`design.md` §1: "a catalog, not an engine") — a `data-kui` attribute that accepts
arbitrary shader source is a toolkit for authoring new shaders without touching the package's
source, which is precisely what §2 rules out.

The boundary that resolves this without giving up the flexibility: **raw GLSL is a source-code-time
decision, never a markup-time one.** A second, custom-shader tier is real, and it is reached the
same way this codebase already lets a third party extend the catalog with anything core did not
ship — by writing code, not markup. `Channel`'s open `string` arm exists precisely because
"third-party primitives register their own channels" (`types.ts:54`), and `Registry.registerPrimitive`
is already public (`params.ts:206`'s comment, in passing). A custom shader effect registers the same
way: a call in a script the site's own developer wrote and shipped, supplying the GLSL *and*
declaring a `ParameterSchema` for its own uniforms — validated by the exact same
`resolveParams`/`validate` pipeline described above for the shipped catalogue, because declaring a
schema is the price of registering any primitive today, not a shader-specific tax. The GLSL itself
never passes through an attribute string, is never something a CMS field can inject, and carries the
same trust level as any other line of code the site ships — which is the trust level GLSL actually
needs, and the one `data-kui` was never built to carry.

Once registered, an instance of a custom shader is authored exactly like a catalogued one — the same
`data-kui="my-custom-shader strength:0.5"`, the same flat namespace, the same `key:value` grammar —
because registration only changes *where the GLSL text lives*, never how an instance is invoked. The
owner's "no second attribute, no new syntax" rule and the security argument above turn out to be the
same conclusion reached twice: a real shader is easily thousands of characters, `type: 'text'`
parameters are capped at 200 characters and never trusted as anything but an inert JS-consumed
string (`params.ts`'s `MAX_VALUE_LENGTH`), and even lifting that cap would only recreate the
CMS-injection scenario the boundary above exists to avoid. There was never a version of "GLSL
through `data-kui`" that satisfied both requirements at once — which is a point in favour of the
boundary drawn above, not a compromise it had to make.

**The single strongest argument against this "both" answer, named rather than argued away:**
drawing the boundary at the registration mechanism closes the *untrusted-markup* threat model
completely, but it does not, and cannot, close a second one — a custom shader that is badly written
rather than malicious. Nothing in `ParamSpec` validates what a shader body *does* with a validated
`strength` value; a custom fragment shader with an expensive per-pixel loop, or one that never
terminates cleanly on a particular driver, degrades every other shader effect sharing the one rAF
loop and WebGL context §4 establishes, not just its own instance — and neither `ParamSpec` nor
anything currently in §4's lifecycle design gives the shared renderer a way to notice and isolate a
single slow draw call before it costs the whole page its frame budget. A compile failure is the
tractable half of this (`gl.getShaderInfoLog` catches it, and the failing instance falls back
exactly as if WebGL were unavailable, per §7) — a shader that compiles fine and is simply too
expensive per frame is not, and this plan does not have an answer for it. **Added to §9 as Q8.**

**Per-parameter fallback.** §7's table answers "what does this effect show with no WebGL," per
effect. The finer question — which of an effect's *parameters* still mean anything in that state —
falls out of a distinction `ParamSpecBase.cssProperty`'s own doc comment already draws
(`types.ts:226-245`) rather than needing a new flag: a parameter whose `cssProperty` is *also* read
by the fallback's own CSS carries over for free, because that is just the cascade doing what it
always does; a parameter that only a shader uniform ever reads is, by construction, invisible once
there is no shader running it. Concretely: `shader-displace`'s `strength` has no CSS reader
anywhere — its fallback (§7: "the plain, undistorted image") is correct precisely because there is
nothing left for `strength` to have meant, and an author should expect it silently does nothing
under no-WebGL, the same way `charset` on `scramble-text` already does nothing if a page tries to
override it in a stylesheet (`types.ts:236-238`'s own example of this exact class of parameter). An
image-to-image displacement transition's `speed` and `easing`, by contrast, should be declared with
a `cssProperty` a plain CSS `transition-duration`/`transition-timing-function` rule *also* reads —
one authored value, one validated custom property, two consumers — so the cross-fade fallback (§7)
plays at the author's chosen pace instead of reverting to a hardcoded default the moment WebGL is
unavailable. Whether a given shader effect's timing/colour parameters are declared this dual-purpose
way is, like `cloak` and `phase` before it, a fact only that effect's author knows and must declare
— not derivable from the parameter's type, and not a table this document can fill in for effects
that do not exist yet.

## 7. The no-WebGL / blocked-GPU fallback

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
| Liquid/metaball surface | A static rendering of the shape (an author-supplied poster image, or a single rendered frame captured once and frozen — needs a decision, see §9 Q4). |
| Particle field with physics | The plain background with no particles. A CSS particle system is a different, already-shipped thing (`confetti-burst`'s family) and should not be silently substituted for a fundamentally different effect the author explicitly asked for. |

The guiding rule, stated because it already exists elsewhere in this codebase and should not be
re-litigated for labs: **"Same degradation, never 'same behavior'"** (`design.md` §5, on scrub
fallbacks). A blocked-GPU visitor gets something honest and non-broken, never a fake shader.

## 8. `prefers-reduced-motion`

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
  matching `ambient.ts`. Falls to the same static-frame fallback described in §7 — reduced motion
  and no-WebGL converge on the same visible result for these, which is a nice property but should
  be verified rather than assumed once the renderer exists.
- **One-shot shader transitions** (image displacement): a case for `'crossfade'`, not `'disable'`
  — a short, still-real cross-fade between the two images is a legitimate reduced-motion substitute
  for a displacement transition, the same way `fade-blur-up`-style CSS entrances shorten rather than
  vanish. This is the one place labs' reduced-motion story is *not* a copy of `ambient.ts`'s, and it
  should be stated as a deliberate choice rather than inherited by accident.

## 9. Open questions for the owner

None of these block scoping the package on paper, but all of them block writing its first line of
code:

1. **Subpath export vs. separate npm package** (§3). Recommendation given: separate package, for
   independent versioning. Needs a real decision — it changes the publish pipeline.
2. **The `renderer`/`perfClass` core-type additions** (§5). Small, additive changes to
   `src/core/types.ts` that labs depends on but cannot make itself under this task's constraints.
   Needs sign-off from whoever owns core, and should probably land *before* labs authoring is
   designed in detail, not alongside it.
3. **Composition/exclusivity mechanism** (§5, §6) — **resolved, not open.** A shader effect
   self-declares a shared, reserved channel (e.g. `gpu-paint`) through `Channel`'s existing open
   `string` arm, so no core change or `masksOwnContent`/`replacesHostBox` dependency is needed; see
   §6 for the full reasoning. The one residual sliver left genuinely open: whether labs should
   migrate off this channel-claim workaround once that undecided core flag actually lands, in case
   its eventual semantics turn out cleaner than a plain channel collision. This is not the
   duplicate-mechanism risk the original draft worried about — it reuses the extension point
   third-party primitives already get, rather than inventing a second one.
4. **Static-frame capture for continuous effects' fallback** (§7). Does the library render one
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
7. **Colour-to-uniform resolution needs verifying in a real browser** (§6). Whether
   `getComputedStyle` on a probe element serializes an author-written `oklch()`/`lab()` colour back
   as parseable numbers uniformly across engines is not something this document can confirm without
   one. Verify before writing the resolution code; do not assume spec text has settled it.
8. **No per-instance frame-time budget in the shared renderer** (§4, §6). A single badly-written
   shader — catalogued or custom-registered — has no circuit breaker today if it is merely slow
   rather than non-compiling; §4's shared rAF loop has no mechanism to notice and isolate one slow
   draw call before it costs every other shader effect on the page its frame budget. Whether this is
   a v1 requirement or an accepted risk to harden later is a real product decision, not an oversight.
9. **Live CSS overrides on an author-set uniform** (§6). The rest of the catalog promises "consumer
   CSS wins" for every parameter's custom property (`design.md` §7) — a page can override
   `--kui-reveal-distance` in its own stylesheet and the cascade decides. Whether a shader uniform
   honours that same promise (re-checking the custom property's live computed value, at some cost)
   or only ever reflects the authored attribute value (cheaper, but a silent exception to a promise
   every other parameter keeps) is not decided here.

## 10. Size budget

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
effect adding well under a kilobyte (a GLSL string plus a thin parameter-to-uniform mapping — §6
designs that mapping as a derivation from each parameter's existing `cssProperty` name rather than a
second hand-written table per effect, which is what makes "well under a kilobyte" a plausible bound
rather than a hopeful one). A
budget in the same order of magnitude as the *entire* core CSS budget (14 KB) for the shared
renderer plus its first few shipped effects combined would not be a surprising outcome — but this
is an estimate reasoned from the scope cut, not a measurement, and should be replaced with a real
number at the first opportunity rather than cited as settled.

## 11. Reasons not to build this

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
  `prefers-contrast` are unaddressed across the whole catalog today (§9 Q5). Shipping the
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
