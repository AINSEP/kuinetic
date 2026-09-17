# kUInetic Advanced Modules

`src/advanced/` is a set of WebGL/CSS-3D/Web-Audio extensions that sit outside the core library.

**Status: experimental, unshipped.** Nothing under `src/advanced/` is exported from `src/index.ts`,
listed in `package.json`'s `exports` map, built into `dist/`, or referenced by any page in `demo/`.
There is no public entry point today — a consumer would have to import the source files directly
(`kuinetic/src/advanced/index.ts`), which is not a supported path. Core's "CSS-first, zero-dependency"
claims are unaffected by this directory: nothing here is bundled into the core output regardless of
whether `src/advanced/` itself ships.

Treat everything below as a description of what the code on disk does today, not a commitment about
if or when it ships.

## Files

| File | What it does |
|---|---|
| `index.ts` | Re-exports each module's public surface and `registerAdvanced(target)`, which registers all six primitives (shaders, scenes, camera, particles, fluid cursor, audio) onto one `Registry` or `Animator` in one call. |
| `base.ts` | Shared runtime plumbing every module builds on: `resolveEnv()` (window/document/canvas/raf/caf injection, so the modules can run outside a real browser), `isReducedMotion()`, `createEffectInstance()`/`createInertInstance()` (the `EffectInstance` lifecycle contract: `activate`/`cancel`/`finish`/`destroy`/`finished`), `styleOf()` (looks up an element's `StyleLedger` from a `LedgerSet`, or `null` when the element can't carry one), and `registerInto()` (the primitive/preset registration used by every module's `register*` function). |
| `shaders.ts` | A single shared WebGL2 renderer (`SharedShaderRenderer`) driving one fixed full-viewport canvas, ref-counted across every active `shaders` instance. Each instance scissors the canvas to its own element's bounding rect and draws one of five fragment programs (`displace`, `fluid`, `liquid`, `particles`, `morph`) sourced from `glsl.ts`. Handles WebGL context loss/restore, per-instance draw-error isolation (one instance throwing does not stop the others or the render loop), and hides the source element only after a real successful draw — never before, and never over an author-authored `opacity`. |
| `glsl.ts` | The GLSL ES 3.00 source strings for the five shader modes, plus the shared fullscreen-quad vertex shader. Pure data — no logic. |
| `gl-utils.ts` | Low-level WebGL wrappers used by `shaders.ts`: `compileShader`, `createProgram`, `extractLocations` (uniform/attribute location lookup), `disposeGLResources`, `createGLTexture`. |
| `scenes.ts` | `SceneController` — parses `scene-step` children of a `scene` container into opacity/x/y/scale keyframe ranges and interpolates them against either scroll progress or a fixed-duration timer. |
| `camera-3d.ts` | `CameraController` — projects `camera-layer` children into CSS 3D space by depth (`translate3d`), tied to scroll progress, plus an optional pointer-tilt rig on the container itself. |
| `particles.ts` | `ParticleEmitter` — dissolves an element into a Canvas2D particle grid that repels from the pointer and springs back to its origin. |
| `fluid-cursor.ts` | `FluidTrail` — a shared full-viewport Canvas2D overlay that spawns decaying "drops" following pointer velocity; supports multiple registered clients with per-client color/size/viscosity, resolved by DOM ancestry or bounding-rect hit-test. |
| `audio.ts` | `AudioSourceController` — Web Audio `AnalyserNode` reactive source. Computes bass/mid/treble/level bands from FFT frequency data and writes them as five CSS custom properties (`--kui-audio-bass`, `-mid`, `-treble`, `-level`, `--kui-audio`) on the host element every animation frame. Reads from a page `<audio>`/`<video>` element by default, or an opt-in microphone stream. |

All six modules manage their inline style/attribute writes through `core/owned-styles.ts`'s
`StyleLedger`/`LedgerSet` (see `src/core/owned-styles.ts`), the same mechanism core JS primitives
use: a property's pre-effect value (and `!important` priority) is captured at the moment this code
first writes it, and restored on teardown — not a snapshot taken at construction or at `prepare`
time, which would discard anything the author wrote in between.

## Registration

Nothing here is auto-registered. A consumer opts in explicitly:

```javascript
import { kuinetic } from '../src/index.js'
import { registerAdvanced } from '../src/advanced/index.js'

const k = kuinetic()
registerAdvanced(k) // registers all six primitives
k.start()
```

Or one module at a time, via each file's own `register*` export (`registerShaders`,
`registerScenes`, `registerCamera`, `registerParticles`, `registerFluidCursor`, `registerAudio`) —
`registerAdvanced` is exactly these six calls in sequence.

## Authoring surface

Each module registers one primitive and a small set of presets; see `*_PARAMETERS` / `*_PRESETS` in
each file for the authoritative parameter names, defaults, and validation ranges — that is generated
data, not prose, so it does not drift the way a hand-written parameter table does. The primitive ids
are `shaders`, `scene`, `camera-scene`, `particle-dissolve`, `fluid-trail`, and `audio-source`.

Every `prepare*` function bails out to an inert no-op instance under reduced motion
(`isReducedMotion(ctx)`), matching every module's `reducedMotion: 'disable'` declaration.

## Tests

- `src/advanced/__tests__/` — jsdom unit tests: `audio.test.ts`, `contracts.test.ts`, `fx.test.ts`,
  `ownership.test.ts`, `shaders.test.ts`, `staging.test.ts` (plus `prepare-context-fixture.ts`, a
  shared fixture, not a test file). Run with `npx vitest run src/advanced/__tests__`. WebGL is mocked
  here — jsdom has no real GL context — so these tests cover control flow, lifecycle, and ledger
  restoration, not real GPU behavior.
- `test/browser/advanced-webgl.test.mjs` — real Chromium, real WebGL2, run via Playwright (49 checks
  as of this writing). Covers context loss/restore, partial-clip scissor correctness, cross-instance
  draw error isolation, authored-`opacity:0` persistence, double-destroy idempotency, real
  shader-program compilation (the five programs in `glsl.ts` actually link, and a genuinely broken
  GLSL source is rejected — a mocked `getContext` can't tell either apart), real canvas-2D color
  resolution, and the scroll→shader progress bridge (see below). This is the tier that exercises
  actual GPU/canvas behavior the jsdom unit tests mock away.
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
- **Scroll→shader progress reads are batched per frame, not per instance.** `SharedShaderRenderer`
  reads every registered instance's `--kui-progress` (`readElementProgress`, which checks the
  element's own inline style, then falls back to `getComputedStyle` so a `scroll-progress` primitive
  on an *ancestor* also reaches it) before any instance's draw call runs and can write a style this
  frame. Reading a computed style after another instance's write in the same pass would force a
  style recalculation per instance rather than at most once per frame — see the comment on
  `progressReaders` in `shaders.ts` for the mechanism.
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
