# kUInetic Advanced Modules

`src/advanced/` is a set of WebGL/CSS-3D/Web-Audio extensions that sit outside the core library.

**Status: shipped as an opt-in subpath, and experimental.** As of 2026-09-17 `src/advanced/index.ts`
is a published entry point — `package.json`'s `exports` map names `"./advanced"`, and `build:dist`
emits `dist/esm/advanced/index.mjs` plus `dist/types/advanced/*.d.ts` alongside the core outputs:

```js
import { registerAdvanced } from 'kuinetic/advanced'
```

Read "experimental" literally. This directory was written by an AI, has been through five review
rounds, and two further reviews on the day it was exported each found P1 bugs still being fixed. The
parameter names, preset names, and module boundaries can change without a major version bump. It is
**not covered by the core library's stability guarantees**, and none of core's "CSS-first, zero-JS,
zero-dependency" claims describe it: every module here is JavaScript, and the shader modules need
WebGL2. `demo/shaders-audio.html` is the one page built on it. Prefer a core effect
whenever one will do.

It is opt-in in the strict sense — `src/index.ts` does not import it and nothing auto-registers, so
the default entry is byte-for-byte identical whether or not this subpath exists (verified by
`test/advanced-subpath.test.ts`, which also asserts none of these exports leak into `kuinetic`). The
subpath's own code is 56,973 bytes minified — 16,820 gzip, 15,148 brotli — measured on 2026-09-17
with `src/core` externalised, so those are the advanced modules alone. Core is not double-counted
for a consumer who also imports `kuinetic` or `kuinetic/core`: the split build shares one core chunk
across all four entries. To re-measure rather than trust this line:

```bash
esbuild src/advanced/index.ts --bundle --format=esm --minify --external:'../core/*' \
  --outfile=/tmp/adv.mjs --metafile=/tmp/adv.meta.json
```

The metafile is the point — it lists the inputs that landed in the output, which is how you confirm
no `src/core/*` leaked in. Earlier size claims in this repo were wrong for exactly that reason.

Treat everything below as a description of what the code on disk does today.

## Files

| File | What it does |
|---|---|
| `index.ts` | Re-exports each module's public surface and `registerAdvanced(target)`, which registers all six primitives (shaders, scenes, camera, particles, fluid cursor, audio) onto one `Registry` or `Animator` in one call. |
| `base.ts` | Shared runtime plumbing every module builds on: `resolveEnv()` (window/document/canvas/raf/caf injection, so the modules can run outside a real browser), `isReducedMotion()`, `createEffectInstance()`/`createInertInstance()` (the `EffectInstance` lifecycle contract: `activate`/`cancel`/`finish`/`destroy`/`finished`), `styleOf()` (looks up an element's `StyleLedger` from a `LedgerSet`, or `null` when the element can't carry one), and `registerInto()` (the primitive/preset registration used by every module's `register*` function). |
| `shaders.ts` | A single shared WebGL2 renderer (`SharedShaderRenderer`) driving one fixed full-viewport canvas, ref-counted across every active `shaders` instance. Each instance scissors the canvas to its own element's bounding rect and draws one of seven modes (`displace`, `fluid`, `liquid`, `particles`, `morph`, `gradient`, `logo`) sourced from `glsl.ts` — six linked programs, because `gradient` and `logo` share one. Handles WebGL context loss/restore, per-instance draw-error isolation (one instance throwing does not stop the others or the render loop), and hides the source element only after a real successful draw — never before, and never over an author-authored `opacity`. Its per-frame `inputReaders` pass reads each instance's scroll progress and (opt-in) audio band before any instance draws. |
| `glsl.ts` | The GLSL ES 3.00 source strings for the six shader programs, plus the shared fullscreen-quad vertex shader, the shared `audioGain()` and `shapeMask()` snippets interpolated into all of them, and the **procedural noise core** (`kuiHash`/`kuiGradient`/`kuiNoise`/`kuiFbm`) that `gradient` is built on. Pure data — no logic. The sources are template literals, so a backtick in a GLSL comment is a TypeScript parse error. |
| `gl-utils.ts` | Low-level WebGL wrappers used by `shaders.ts`: `compileShader`, `createProgram`, `extractLocations` (uniform/attribute location lookup), `disposeGLResources`, `createGLTexture`. |
| `scenes.ts` | `SceneController` — parses `scene-step` children of a `scene` container into opacity/x/y/scale keyframe ranges and interpolates them against either scroll progress or a fixed-duration timer. |
| `camera-3d.ts` | `CameraController` — projects `camera-layer` children into CSS 3D space by depth (`translate3d`), tied to scroll progress, plus an optional pointer-tilt rig on the container itself and an optional audio band that pushes the camera forward (see "Audio consumers"). |
| `particles.ts` | `ParticleEmitter` — dissolves an element into a Canvas2D particle grid that repels from the pointer and springs back to its origin. |
| `fluid-cursor.ts` | `FluidTrail` — a shared full-viewport Canvas2D overlay that spawns decaying "drops" following pointer velocity; supports multiple registered clients with per-client color/size/viscosity, resolved by DOM ancestry or bounding-rect hit-test. |
| `audio.ts` | `AudioSourceController` — Web Audio `AnalyserNode` reactive source. Computes bass/mid/treble/level bands from FFT frequency data and writes them as five CSS custom properties (`--kui-audio-bass`, `-mid`, `-treble`, `-level`, `--kui-audio`) on the host element every animation frame. Reads from a page `<audio>`/`<video>` element by default, or an opt-in microphone stream. Also holds the *consumer* side of that contract: `AUDIO_BAND_PROPERTIES` (band name → property), `parseAudioBand()` and `readAudioBand()`, which `shaders.ts` and `camera-3d.ts` use rather than each spelling the property names itself. |

All six modules manage their inline style/attribute writes through `core/owned-styles.ts`'s
`StyleLedger`/`LedgerSet` (see `src/core/owned-styles.ts`), the same mechanism core JS primitives
use: a property's pre-effect value (and `!important` priority) is captured at the moment this code
first writes it, and restored on teardown — not a snapshot taken at construction or at `prepare`
time, which would discard anything the author wrote in between.

## Registration

Nothing here is auto-registered. A consumer opts in explicitly:

```javascript
import { kuinetic } from 'kuinetic'
import { registerAdvanced } from 'kuinetic/advanced'

const k = kuinetic()
registerAdvanced(k) // registers all six primitives
k.start()
```

Or one module at a time, via each file's own `register*` export (`registerShaders`,
`registerScenes`, `registerCamera`, `registerParticles`, `registerFluidCursor`, `registerAudio`) —
`registerAdvanced` is exactly these six calls in sequence.

`registerAdvanced` takes a `Registry`, an `Animator`, or anything carrying a `.registry` — so
`kuinetic/core`'s bare `new Registry()` works too, for a consumer assembling their own catalog
without the bundled effects. There is no CSS counterpart to `kuinetic/css`: nothing here ships a
stylesheet.

## Authoring surface

Each module registers one primitive and a small set of presets; see `*_PARAMETERS` / `*_PRESETS` in
each file for the authoritative parameter names, defaults, and validation ranges — that is generated
data, not prose, so it does not drift the way a hand-written parameter table does. The primitive ids
are `shaders`, `scene`, `camera-scene`, `particle-dissolve`, `fluid-trail`, and `audio-source`.

Every module declares `reducedMotion: 'disable'`, which is what stops the animator activating any
instance; what each `prepare*` then does with that is a per-module decision — see "Accessibility"
at the end.

## The generative modes — `shaders mode:gradient` and `shaders mode:logo`

Five of the seven shader modes are **filters**: they sample `u_image`, a texture uploaded from a
real, already-loaded `<img>`, and warp or blend pixels that already exist. The other two compute
their image from mathematics instead.

`gradient` computes a field and fills the element's box with it, so it works on any element — a
`<div>` with nothing in it is the normal case.

```html
<div data-kui="shader-gradient color1:#ff0080 color2:#7928ca color3:#0070f3 warp:1.2"></div>
```

Four presets ship: `shader-gradient` (bare), `gradient-liquid`, `gradient-bands`, `gradient-holo`.

`logo` computes the same field and paints it **only where the host image's mark is** — the `<img>`
is the stencil, not the picture:

```html
<img src="mark.svg" data-kui="shader-logo" alt="…" />
```

Two presets ship: `shader-logo` (bare) and `logo-gradient`.

All six are the same fragment program with different defaults — a preset here is a starting point
in one parameter space, not a separate shader. `gradient` and `logo` are one *linked* program too,
selected by a uniform: a second copy of the noise core is not worth the link.

### The parameters that are new, and the three that sound alike

`scale` zooms the field. `frequency` is the rate of the *warping* field that distorts it. `detail`
is how many octaves of fine structure ride on top. Three knobs that sound similar and are not: one
changes how big the shapes are, one how contorted, one how intricate.

| Parameter | Range | What it does |
|---|---|---|
| `seed` | integer 0..9999 | Which pattern. The same seed gives the same image on every load. |
| `scale` | 0.05..20 | How zoomed. Larger means smaller, more numerous shapes. |
| `detail` | integer 1..6 | Octaves of detail. Capped at the shader's `KUI_MAX_OCTAVES`. |
| `warp` | 0..2 | How far a second field distorts the first. The difference between contour rings and something that reads as liquid. |
| `bands` | integer 0..32 | Posterise the ramp into this many steps. `0` is off. |
| `grain` | 0..1 | Film grain. |
| `hue` | an angle | Hue rotation — `hue:30deg`, `hue:0.25turn`, or a bare `hue:30`. |
| `color1`..`color5` | colours | The palette. Fewer than two set falls back to a built-in pair, so a bare `shader-gradient` is never grey. |
| `mask` | `alpha`\|`luma`\|`luma-invert` | `mode:logo` only — which part of the host image is the mark. Ignored everywhere else. |

`mask` defaults to `alpha`, which is right for the usual transparent-ground SVG or PNG. A JPEG has
no alpha at all, so `alpha` on one gives an all-opaque stencil and the field fills the whole
rectangle; `luma` takes the **bright** pixels as the mark (white on black) and `luma-invert` the
**dark** ones (black on white, which is the common logo file). Both directions are spelled out
because guessing one produces a perfect negative of the mark — an image that looks deliberate and
is exactly wrong.

`iridescence` was widened from `0..1` to `0..8`: for a filter it was a mix amount, and for a
generator it is **how many times the colour ramp wraps** — the shimmer count. It had never reached a
shader before this mode existed. No fragment program declared `u_iridescence` at all, so the value
was extracted and uploaded to a location that was `null` in all five programs.

### The limit you will hit first — and the one mode that dodges it

**The replica's place in the stacking order is the canvas's, not the element's.**
`SharedShaderRenderer` is one `position: fixed` canvas for the whole page, at `z-index: 1` by
default. So a *positioned* headline laid over a field paints on top of it, which is what you want;
a *static* one does not, because the canvas is `fixed` and static content is not. `gradient`'s
honest surface is therefore still an element nothing overlaps with ordinary flow content — a
full-bleed band between sections, a card face, a footer strip.

This is a change. The canvas used to sit at `z-index: 9999`, where a headline over a field
disappeared *behind* it and, worse, so did the page's own modals, sticky headers and toasts. The
defence written for 9999 — that anything lower hides the replica behind a positioned card — does not
hold up: a positioned card over a shader element probably *should* paint on top. That is stacking
working.

What has **not** changed is the ceiling itself (see "Known limits"): a shader still cannot
interleave with content the way a real element would, because there is one canvas for every replica
on the page. A hero background with real text composited into it is not available today.

**`logo` is not subject to this**, which is why it shipped alongside `gradient`. A mark *should*
paint over the page, exactly as the five image filters already do, so a generated logo is the one
generative surface that needs nothing lifted.

Unlike the five filters, `gradient` does **not** hide its host: the element may have the author's
own content in it, so hiding it would destroy that content without gaining anything — the canvas
already covers the box either way. `logo` **does** hide its host, because there it is the correct
thing to do: the field replaces the `<img>` rather than sitting over it.

### `--kui-shader-z` — the escape hatch, and what it is not

A page that opens a dialog, a sticky nav or a sheet over a shader element can move the shared canvas
below that layer:

```css
:root { --kui-shader-z: 500; }   /* sit above a z-index: 100 card, below a 1000 modal */
```

It is read once off `:root` when the canvas is built, defaults to `1`, and ignores anything that is
not a number rather than writing a broken `z-index`. Custom properties inherit, so a value on
`:root` reaches a canvas this library created even though no stylesheet can name it — one line, no
JS, no build step.

There is deliberately **no `data-kui` parameter** for it. One canvas serves the whole page, so a
per-element `zIndex:` would look per-element and silently not be: two shader elements asking for
different values, last writer wins, and the loser has no way to tell.

**This is a coping knob, not the composition fix.** There is one canvas for the whole page, so the
number moves *every* replica at once, and anything positioned above the new value now covers the
shaders instead. Lowering it does not let a shader sit behind content in general — that needs
per-element canvases, which is the decision in "Known limits" that has not been made.

### Reduced motion: a still frame, not nothing

`gradient` is the one place in this directory where `prefers-reduced-motion` gets something rather
than nothing. One frame of a procedural gradient is simply a good image, where one frame of a
pointer-driven displacement is not an image at all.

The frame is rendered once, read back with `toDataURL`, and written to the element's inline
`background-image` (with `background-size: 100% 100%`), then the renderer is released. After that it
costs nothing per frame, and because it is a real CSS background on the real element it sits in the
page's own paint order — so it keeps the element's `border-radius` and clipping and *does* compose
with content above it, which the live path cannot.

Two details worth knowing. The bake happens in `prepareShaders`, not in the instance's `activate()`,
because it has to: under reduced motion the animator's `openGate` marks the element finished, emits
`kui:finish` with reason `reduced-motion`, and returns **without activating any instance** — an
`activate()` body would be unreachable. The instance stays genuinely inert, so the lifecycle an
author observes is unchanged. And the bake is capped at 640px on its longest side
(`STATIC_BAKE_MAX`), because a full device-resolution hero is several megabytes of base64 in a style
attribute, which would be an expensive answer on the one code path whose purpose is to stop being
expensive. A generated field is smooth, so scaling it back up loses nothing visible; grain softens.

## The scroll bridge is opt-in — `scrub: scroll`

`scroll-progress` writes `--kui-progress`. A `shaders` instance reads it as a scrub position, but
**only when it authored `scrub: scroll`**. Default is `off`.

```html
<div data-kui="scroll-progress">
  <!-- Scrubbed by the ancestor's progress. -->
  <img data-kui="shaders mode:morph to:#b scrub:scroll" src="…" />
  <!-- Not scrubbed. Runs at full effect regardless of where the page is. -->
  <img data-kui="shaders mode:particles" src="…" />
</div>
```

This is the same gate `audio:` already has, and for the same reason. `--kui-progress` is an
ordinary inherited custom property, so the read falls back to `getComputedStyle` and an ancestor
reaches it. Without a gate, every shader anywhere inside a scrollytelling section was scrubbed
with no way out — and at the top of the range the multiplier is zero, which renders a
pixel-faithful copy of the source. The effect did not look misconfigured; it looked dead.

An authored `progress:` still wins over the bridge, so `scrub:scroll progress:0.4` is a fixed
0.4. Note also that the `progress` parameter's backing property is `--kui-shader-progress`, not
`--kui-progress`: every authored parameter is written to its `cssProperty`, so sharing the name
would have had the consumer writing the driver's own channel onto the element and inheriting it
to every descendant.

## Audio consumers

`audio-source` is a driver: it writes `--kui-audio-bass` / `-mid` / `-treble` / `-level` (and
`--kui-audio`, an alias of `-level`) on its host every frame and reads nothing back. Two primitives
in this directory can follow one of those bands, through the same parameter spelling on both:

```html
<!-- Driver and consumer on one element, the comma grammar any two primitives share. -->
<img data-kui="audio-source target:#track, shaders mode:liquid audio:bass" src="…" />

<!-- Or the driver on an ancestor: the properties are ordinary unregistered custom properties, so
     they inherit, and a consumer below reads the inherited value through getComputedStyle. -->
<section data-kui="audio-source target:#track">
  <img data-kui="shaders mode:displace audio:treble" src="…" />
  <div data-kui="camera-scene audio:bass depth:1200">…</div>
</section>
```

`audio:` accepts `off` (the default) `bass`, `mid`, `treble`, `level`. It is a `keyword`, so the
list is closed; an unknown word warns and falls back to `off`.

**What each consumer does with it**

| Consumer | Response at a full-scale band |
|---|---|
| `shaders mode:displace` | Ripple throw doubles. |
| `shaders mode:fluid` | Ambient flow and the pointer's push both double. |
| `shaders mode:liquid` | Wave depth doubles; wavelength and speed unchanged. |
| `shaders mode:particles` | Sparkle brightness doubles (0.3 → 0.6). The dot mask is left alone: it is already multiplied by an unbounded `strength` and feeds a `mix()`, so widening it would extrapolate past the texture over a growing area. |
| `shaders mode:morph` | Crossfade noise doubles. Not `progress` — where the morph sits between its two images belongs to the author or to scroll, and a beat driving it would run the transition backwards on every quiet frame. |
| `camera-scene` | The camera pushes forward by a tenth of the scene's `depth` (`AUDIO_PUSH_RATIO`), which is ~5% of the perspective distance in real z, i.e. a ~5% swell at any `depth`. |

Every shader response is a gain in 1..2 on the amplitude the program already had, uploaded as one
`u_audio` float. Silence is a gain of exactly 1.0, so audio-off output is unchanged. `u_audio` is
uploaded on **every** draw rather than only by instances that asked for a band: the programs are
shared across every instance on the page, so a skipped upload would leave a neighbour's value in
place.

**Honest limits**

- **No amount knob.** The shader response is fixed at "up to double"; `strength` is the only gain
  (audio multiplies it), and `camera-scene`'s push is a fixed fraction of `depth`. If a page needs
  a subtler or stronger response, that is a parameter this code does not have yet.
- **A band is read per consumer per frame**, inline first and then `getComputedStyle` — so the
  ancestor case costs a computed-style read per consumer per frame. Shader instances do it in one
  batched pass before any of them writes (`inputReaders`), so it forces at most one style
  recalculation per frame rather than one per instance; `camera-scene` folds its read into the same
  pass as its `getBoundingClientRect` read, before it writes any transform.
- **`camera-scene audio:…` changes how the scene renders.** With a band selected it runs one
  continuous rAF loop (`startAudioLoop`) and `onScroll`/`startLoop` stand down; with no band it
  stays event-driven exactly as before. The loop runs while the effect is active whether or not the
  scene is on screen.
- **A cancelled consumer freezes rather than settling.** `cancel()`/`finish()` leave the layers at
  their last transform, audio push included — the same as the existing behaviour for scroll
  position and pointer tilt. Only `destroy()` restores the author's styles.
- **Only these two.** `scene`, `particle-dissolve` and `fluid-trail` read no audio, and nothing in
  the main catalog (`src/effects/`, `src/css/`) does either — presets that read a variable from a
  driver that does not ship would be dead weight in the shipped CSS.
- **The driver's own constraints still apply**: browsers will not start an `AudioContext` before a
  user gesture, and `createMediaElementSource` on a cross-origin media element feeds silence into
  the analyser. Neither is something a consumer can work around.

## Tests

- `src/advanced/__tests__/` — jsdom unit tests: `audio.test.ts`, `contracts.test.ts`, `fx.test.ts`,
  `ownership.test.ts`, `shaders.test.ts`, `staging.test.ts` (plus `prepare-context-fixture.ts`, a
  shared fixture, not a test file). 140 tests across those 6 files as of this writing. Run with
  `npx vitest run src/advanced/__tests__`. WebGL is mocked
  here — jsdom has no real GL context — so these tests cover control flow, lifecycle, and ledger
  restoration, not real GPU behavior.
- `test/browser/advanced-webgl.test.mjs` — real Chromium, real WebGL2, run via Playwright (63 checks
  as of this writing). Covers context loss/restore, partial-clip scissor correctness, cross-instance
  draw error isolation, authored-`opacity:0` persistence, double-destroy idempotency, real
  shader-program compilation (the six programs in `glsl.ts` actually link, and a genuinely broken
  GLSL source is rejected — a mocked `getContext` can't tell either apart), real canvas-2D color
  resolution, the generative field (it draws with no texture at all; `speed:0` is byte-identical
  across frames; a seed reproduces and a different one does not; `detail` changes structure without
  changing mean brightness; an authored palette really reaches `u_colors`; `logo`'s stencil is
  opaque inside the mark and empty in its hole) — **every one of those at 390px as well as
  desktop** — the scroll→shader progress bridge (see below), and the audio bridge: a band on the
  consumer's own element and on an ancestor driving the real `u_audio` uniform (read back with
  `gl.getUniform`) and the camera's real `translate3d`, plus one end-to-end check that builds a
  120Hz WAV in the page and plays it through a real `audio-source` graph. This is the tier that
  exercises actual GPU/canvas behavior the jsdom unit tests mock away.
- Fixtures: `advanced-webgl.html` (fixed layout), `advanced-progress-bridge.html` (a page that
  really scrolls), `advanced-audio-bridge.html` (the audio consumers), `advanced-generative.html`
  (plain `<div>`s with no image in them, and an original square-annulus mark whose hole is what
  separates a real stencil from one that painted the bounding box). The end-to-end audio check
  needs two environment facts to work headless, and both are the browser's rules rather than this
  code's: a trusted click before anything starts, because Chromium will not let an `AudioContext`
  leave `suspended` without user activation, and a blob URL for the WAV, because a tainted
  (cross-origin) media element feeds silence into `createMediaElementSource`. It settles in ~0.4s
  against an 8s budget.
- Do not run this via `npm run test:browser` or `npm run build` — both rewrite `demo/kuinetic.js`/
  `demo/tailwind.css` as a side effect. Run the `.mjs` file directly against a Playwright-resolved
  Chromium instead.

Exact current counts are whatever `npx vitest run src/advanced/__tests__` and the browser suite
report on the day you read this. Treat any number in this file as a snapshot, not a contract — a
previous version of this doc hand-typed "16 tests" against two test files (`test/advanced-shaders.
test.ts`, `test/advanced-modules.test.ts`) that do not exist on disk. Re-derive counts from an actual
test run before quoting them elsewhere.

## Known limits

- **Shader style reads are batched per frame, not per instance.** `SharedShaderRenderer` reads the
  `--kui-progress` of every instance that authored `scrub: scroll` (`readElementProgress`, which
  checks the element's own inline style, then falls back to `getComputedStyle` so a
  `scroll-progress` primitive on an *ancestor* also reaches it) and, for an instance with an
  `audio:` band, that band
  (`readAudioBand`, same two steps) before any instance's draw call runs and can write a style this
  frame. Reading a computed style after another instance's write in the same pass would force a
  style recalculation per instance rather than at most once per frame — see the comment on
  `inputReaders` in `shaders.ts` for the mechanism.
- **This doc has drifted from the code before.** A previous version described the shaders module as
  spanning `shaders.js`/`shader-sources.js` (the latter was merged into `shaders.ts` and no longer
  exists) and claimed "Status: Fully functional". Re-verify claims here against the source rather
  than trusting this file on faith.

## Should a WebGL library (e.g. OGL) be used instead of raw WebGL2?

Not for what these modules currently do. `shaders.ts` draws a single fullscreen quad per instance —
there is no scene graph, no mesh/geometry buffers, and no camera matrix math, so a library built
around those concepts (OGL, three.js) would add dependency weight without removing any real
complexity from this file. `camera-3d.ts` similarly gets 3D depth from CSS (`perspective` +
`transform-style: preserve-3d`), not WebGL, so it has no library to adopt in the first place.

If a future feature needs true 3D geometry (loading a `.glTF` model, arbitrary mesh particles), that
would be a real justification to reconsider — but that is not what's implemented today, and no such
feature exists in this directory.

## Accessibility

Every `prepare*` function checks `isReducedMotion(ctx)` before doing anything continuous (starting a
render loop, an audio graph, a particle simulation), and every primitive declares
`reducedMotion: 'disable'` so the animator marks the element finished and activates nothing. What
the module does instead is decided per module, because "a still frame" is only honest where a still
frame exists. Every instance returned on this path is inert either way; where a frame is produced it
is written during `prepare`, since `activate()` is never reached.

| Primitive | Under reduced motion |
|---|---|
| `shaders` (generative modes) | One baked frame as an inline `background-image` — see above. |
| `shaders` (the five image filters) | Nothing. A still frame of a pointer-driven displacement is the source image with extra steps. |
| `camera-scene` | The scene composed once: the container's `perspective`, and every layer at its authored `z:` with the camera parked at the start of its travel. The depth arrangement *is* the design; the scroll only moves a camera through it. Not the end state, which is the camera pushed all the way through — a 2x to 10x blow-up with the nearer layers past the viewer. |
| `camera-layer` | Nothing of its own, in either mode. The scene writes it. |
| `scene` | The last keyframe, held (`progress = 1`) — the same thing `finish()` writes, and the same answer the policy layer gives a CSS effect. It also keeps content readable: a step the author styled `opacity: 0` in a stylesheet and expected this effect to fade in was invisible for the whole visit before. A step authored to fade *out* is correspondingly held faded out, which is the trade every CSS effect here already makes. |
| `particle-dissolve` | Nothing. At rest it is a grid of identically-coloured dots sampled from nothing, and its default activation is `hover`, so the canvas does not exist until the pointer arrives — baking would add decoration no other visitor sees un-hovered. |
| `fluid-trail` | Nothing. A pointer trail has no still form, and this primitive never writes to the host element at all (`channels: []`). |
| `audio-source` | Nothing. It is a data source, not motion; its static value is `0.000` on all five channels, which is already what its absence means (`readAudioBand` answers 0 for an undeclared property). Writing them would only override an author's own inline value, and running the analyser would open an `AudioContext` and page-wide gesture listeners for a visitor who asked for less. |
