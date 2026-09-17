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
WebGL2. Nothing under `src/advanced/` is referenced by any page in `demo/`. Prefer a core effect
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
| `shaders.ts` | A single shared WebGL2 renderer (`SharedShaderRenderer`) driving one fixed full-viewport canvas, ref-counted across every active `shaders` instance. Each instance scissors the canvas to its own element's bounding rect and draws one of five fragment programs (`displace`, `fluid`, `liquid`, `particles`, `morph`) sourced from `glsl.ts`. Handles WebGL context loss/restore, per-instance draw-error isolation (one instance throwing does not stop the others or the render loop), and hides the source element only after a real successful draw — never before, and never over an author-authored `opacity`. Its per-frame `inputReaders` pass reads each instance's scroll progress and (opt-in) audio band before any instance draws. |
| `glsl.ts` | The GLSL ES 3.00 source strings for the five shader modes, plus the shared fullscreen-quad vertex shader and the shared `audioGain()` snippet interpolated into all five. Pure data — no logic. The sources are template literals, so a backtick in a GLSL comment is a TypeScript parse error. |
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

Every `prepare*` function bails out to an inert no-op instance under reduced motion
(`isReducedMotion(ctx)`), matching every module's `reducedMotion: 'disable'` declaration.

## Audio consumers

`audio-source` is a driver: it writes `--kui-audio-bass` / `-mid` / `-treble` / `-level` (and
`--kui-audio`, an alias of `-level`) on its host every frame and reads nothing back. Two primitives
in this directory can follow one of those bands, through the same parameter spelling on both:

```html
<!-- Driver and consumer on one element, the comma grammar any two primitives share. -->
<img data-kui="audio-source media:#track, shaders mode:liquid audio:bass" src="…" />

<!-- Or the driver on an ancestor: the properties are ordinary unregistered custom properties, so
     they inherit, and a consumer below reads the inherited value through getComputedStyle. -->
<section data-kui="audio-source media:#track">
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
uploaded on **every** draw rather than only by instances that asked for a band: the five programs
are shared across every instance on the page, so a skipped upload would leave a neighbour's value
in place.

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
  shader-program compilation (the five programs in `glsl.ts` actually link, and a genuinely broken
  GLSL source is rejected — a mocked `getContext` can't tell either apart), real canvas-2D color
  resolution, the scroll→shader progress bridge (see below), and the audio bridge: a band on the
  consumer's own element and on an ancestor driving the real `u_audio` uniform (read back with
  `gl.getUniform`) and the camera's real `translate3d`, plus one end-to-end check that builds a
  120Hz WAV in the page and plays it through a real `audio-source` graph. This is the tier that
  exercises actual GPU/canvas behavior the jsdom unit tests mock away.
- Fixtures: `advanced-webgl.html` (fixed layout), `advanced-progress-bridge.html` (a page that
  really scrolls), `advanced-audio-bridge.html` (the audio consumers). The end-to-end audio check
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

- **No demo page.** These modules are not wired into any `demo/*.html` page. Verification is the two
  test tiers above.
- **Shader style reads are batched per frame, not per instance.** `SharedShaderRenderer` reads every
  registered instance's `--kui-progress` (`readElementProgress`, which checks the element's own
  inline style, then falls back to `getComputedStyle` so a `scroll-progress` primitive on an
  *ancestor* also reaches it) and, for an instance with an `audio:` band, that band
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
render loop, an audio graph, a particle simulation) and returns `createInertInstance()` instead when
the visitor prefers reduced motion.
