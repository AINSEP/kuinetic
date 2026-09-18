# `kuinetic/3d` — the grammar, first draft

Owner chose the **one-div** shape on 2026-09-18. This is the concrete proposal that follows from
that choice. Nothing here is built. Every convention below was read off disk today, not recalled.

## The whole thing

```html
<div data-kui="model-3d src:/models/robot.glb spin:360deg light:studio target:img">
  <h2>Meet the robot</h2>
  <img src="/img/robot.jpg" srcset="/img/robot.jpg 1x, /img/robot@2x.jpg 2x" alt="A red toy robot" />
</div>
```

The host's own children stay visible, on top of the render. That is not a nicety — see §3.

## 0. Why one div — the argument that decided it

The alternative was a host with a child per part, the `camera-scene` / `camera-layer` shape:
`<div data-kui="scene-3d">` wrapping `<div data-kui="model …">` and `<div data-kui="light …">`.

It lost on two counts.

**Those children would not be content.** Tier 1 earns that shape honestly — a `camera-layer` *is* a
real div with real text that moves in depth. A three.js mesh is not. Child elements that render
nothing, size nothing and mean nothing to a screen reader are DOM as bookkeeping.

**And the shape has a defect the test suite structurally cannot see.** Discovering virtual parts by
descendant query is how a nested scene came to claim its outer scene's children — fixed today in
`b1b1708`, "a nested scene keeps its own steps, and a nested camera its own layers", which added a
shared `ownedDescendants` helper across `base.ts`, `camera-3d.ts` and `scenes.ts` plus a new
243-line `nested-ownership.test.ts`.

That it is now fixed makes the argument *stronger*, not weaker. Relayed first-hand by the session
that fixed it: **the whole advanced suite passed before the fix and would have passed after it**,
with `camera-3d.ts` at 100% line and branch coverage throughout. The scan loop is covered;
*ownership* is not a branch. So this is not merely a bug-prone shape — it is bug-prone in a way
100% coverage reports as healthy. Building it a second time, for a tier whose parts are not even
real elements, buys nothing and re-buys that.

## 1. Parameters

Every entry is a real `ParamSpec` shape (`src/core/types.ts:218-300`). `keywords` is required on
keyword params and forbidden elsewhere — a word list on a value param is a compile error.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `src` | `text` | `''` | The glTF/GLB URL. `text` is correct here and honest about itself: it validates nothing, is consumed only by JS, and `resolveParams` drops it before the stylesheet (`types.ts:154-158`). A URL is exactly the case that type names. |
| `spin` | `angle` | `0deg` | **Total** turn across the element's scroll pass, not a rate. A real CSS unit, so it obeys the standing rule that normalised scalar ranges are ruled out (`todo.md:356`). `spin:360deg` = one full turn from entering to leaving. |
| `axis` | `keyword` | `y` | `x` / `y` / `z`. Closed list. |
| `tilt` | `angle` | `0deg` | Camera elevation. **Positive means the camera is above, looking down** — the carousel's exact convention (`src/css/carousel.css:60-77`), and it is negated on the way into the matrix for the same reason. Clamp to ±80deg: past that the model is edge-on and the effect has silently become nothing. |
| `light` | `keyword` | `studio` | `studio` / `key` / `rim` / `flat`. Named rigs, not coordinates. A designer says "studio lighting"; nobody hand-places three lights in an HTML attribute. |
| `target` | `text` | `''` | Names an element already inside the host to use as the no-WebGL / reduced-motion fallback. The **preferred** way to supply one — see §4. Same convention as everywhere else this word is used (`src/core/target.ts`); quote a selector containing a space or comma (§5). |
| `poster` | `text` | `''` | Still image URL, for when the author has no element to point at and just wants one made. The no-WebGL and reduced-motion answer when `target` is unset. See §4. |

**No `zoom` / `distance` param in v1.** The scene auto-frames: measure the model's bounding box,
fit it to the host. Model units mean nothing to an author, and "put an attribute on a div, get a 3D
scene" should not open with an arbitrary number. Add it later if a real page wants it.

**Triggers come free.** `on:enter`, `on:scroll` etc. are core grammar, already parsed.

⚠ **Commas separate STEPS, spaces separate PARAMS.** A comma between two params silently drops the
rest with no warning while the element still reports `running`.

## 2. Where the canvas goes

A `<canvas>` inserted as the host's **first child**, with the host's own content painting above it.
This is option 2 of the shader design doc's §10 — costed there at ~150 lines and called "the only
option that genuinely composes and the only one that is a library guarantee."

The two rejected alternatives, so nobody re-proposes them:

- **One fixed full-page canvas** (what `shaders.ts` does today) paints *over* anything overlapping
  its box. Put a headline on it and the headline disappears. Fine for a shader logo, fatal for a
  3D hero.
- **A `z-index:-1` fixed canvas** only sits behind content whose stacking context permits it. A
  `body` with its own background paints straight over it. Not a library guarantee.

⚠ **Treat ~150 lines as a floor, not an estimate.** The shader case blits a *region* out of one
shared GL context because every instance draws the same quad. Real geometry per instance does not
share a context anywhere near as cheaply.

## 3. Channels — what it claims

It writes `position: relative` to the host (the canvas needs a positioned parent), so it must
**claim that as a channel**. Declaring the property you write is not optional here: "host writes
`perspective`/`transform-style` without claiming them as channels" was audit finding A2 against
`camera-3d.ts`, and the fix was to add them to the list (`camera-3d.ts:519`).

Proposed: `channels: ['position']`.

Channel strings are not limited to the `CHANNEL` constant — `camera-3d` already declares the custom
`'perspective'` and `'transform-style'`. Naming the actual property is the established pattern.

⚠ **Writing to a host you do not otherwise own has a known open defect.** `createAdvancedLedgers`
in `src/advanced/base.ts:193-197` decides an element's `foreign` flag **once**, when the first
controller opens the entry, and caches it in a module-level `WeakMap`. A second controller arriving
later reuses that cached entry, so its own `hostLedger` is silently ignored, and
`releaseSharedLedger` (`base.ts:233`) then skips the restore for anything flagged `foreign` — which
is how a written property can outlive every animator that wrote it. Today's audit rates this medium
and unfixed, and reads the real seam as belonging in `core/owned-styles.ts` as a per-element,
refcounted ledger rather than an advanced module borrowing one animator's private one. **A brand-new
tier writing `position` to a host it does not otherwise own is precisely the case that hits this.**
Do not rediscover it as a ghost-style bug.

**It is not otherwise opaque.** Item 23 asked whether a GPU effect participates in the channel model
at all. For this shape the answer falls out: the render lives inside a canvas that composes with
nothing, but the *host* is an ordinary element, so a `fade-up` on the same div still works and the
channel model still arbitrates. One claimed channel, honestly declared, is the whole answer.

## 4. Reduced motion and no-WebGL — the same answer, deliberately

**Both fall back to a still image. Not the end state.**

The rule, stated in `camera-3d.ts:167-171` and worth quoting because it cuts the other way for
`scene`: use the end state when the end is a position the **author designed**; do not, when the end
is merely where a **camera finished travelling**. A spin's end is a camera position, not a design.
So: no end state. A still image instead.

**`target:` is the preferred way to supply that image, `poster:` the fallback.** An author who
already has an `<img>` in the div — `srcset`, a `loading="lazy"`, real `alt` text — should point at
it with `target:img`, not hand over a bare URL string. A `poster:` URL throws all three away: the
library would have to build a plain `<img>` from scratch, and a plain `<img>` cannot do what the
author's own already does. `target:` names the element; the library shows and hides it, it does not
create one. `poster:` stays for the case where the author has no element and just wants one made.

**If both are authored, `target:` wins.** This is not a new rule — it is the same call this
codebase already made for the identical shape of choice: `media-scrub`'s `src:`/`frames:` (a value
the library turns into an element) versus its own `target:` (an element that already exists) are
"mutually exclusive — one rewrites a single element's `src`, the other reveals one of several
elements that already exist — so there is no coherent 'both' to honour" (`scroll-mechanics/
primitives.ts:444`). Same shape here: `poster:` would have the library build an image, `target:`
points at one already built. Silently doing the `poster:` thing while the author wrote a selector
would be the more surprising of the two, so `target:` wins and `poster:` is dropped.

With neither authored, render nothing and leave the host's own children. A 3D model has no
meaningful CSS fallback — that is a **content requirement on the author**, not a library behaviour,
and the docs must say so on day one.

(Baking one frame via `toDataURL` is §10's option 3 — free, and the right reduced-motion path once
the renderer exists. `target`/`poster` cover the case where WebGL never starts at all.)

### 4a. Why `target:` keeps this a one-div tier

§0 rejected a child-per-part shape because those children "would not be content" — a mesh, a light,
a camera render nothing and mean nothing to a screen reader. An `<img>` is the opposite case: it
*is* content, the author already wrote it for a reason having nothing to do with this library, and
demanding it move under a second `data-kui` element (or exist only as a URL string) would be asking
the author to restructure their markup, or to downgrade real content to a string, just to hand it to
a 3D effect. `target:` is how this codebase always names an inner element without inventing a second
`data-kui` host for it (`src/core/target.ts`) — the same convention `carousel`'s `spatial-ring` uses
to name its ring items and `step-progress` uses to name its steps. Using it here means "one div, all
settings" survives contact with a real fallback image instead of being the one thing that forces an
exception.

## 5. Traps this design has to survive

1. **`preserve-3d` is silently defeated by an ordinary ancestor** — `overflow` other than
   `visible`, a `clip-path`, `opacity` below 1, a `filter`, a `backdrop-filter`. Nothing errors.
   Less load-bearing here than for CSS 3D (a canvas is a canvas), but the *host* still gets clipped
   by the same ancestors. The carousel already ships `warnFlatteningAncestor()` as a dev-mode
   diagnostic that walks up and names the first offender — **copy it**.
2. **Never nest this inside an animated frame.** Broke `fold-panel` and `wipe-circle` already.
3. **Any custom property published here inherits into the whole subtree.** Grep the name against
   `src/core/declarations.ts` and `src/effects/scroll-mechanics/` first. `--kui-progress` was
   already lost this way once — a ring publishing `2.4` into it handed every scrubbed descendant a
   negative delay 2.4 heads long.
4. **A hidden Chrome tab freezes rAF and fires zero IntersectionObserver callbacks**, so a
   scroll-bound 3D scene looks completely dead. Check `document.hidden` before filing a bug.
5. **Demo pages run built bundles.** Opening Chrome without rebuilding tests stale code and yields
   a confident false PASS.
6. ⚠ **A `target:` selector containing a space or comma must be quoted, or it silently breaks.**
   This is the same trap as §1's "commas separate steps, spaces separate params," and the reason is
   the interaction between the two: `target:.figure img` reads as *two* params (`target:.figure` and
   a stray `img` token), and `target:h2, h3` reads as *two steps* (`data-kui="model-3d … target:h2"`
   then a bogus `h3` effect) — both silently, no warning, same as the comma trap above. Quote it:
   `target:".figure img"` or `target:'h2, h3'`. This is not new grammar — it is `core/parse.ts`'s
   quote-aware tokenizer, the same one `path:"M 0 0 C 40 -70 120 -70 160 0"` already relies on for
   motion-path data, and the parser strips the quotes before the primitive ever sees the value.

## 5b. The parking condition is substantially met

Item 24 was parked 2026-09-10 on one condition: repair `src/advanced/` first. That repair is the
work of the last week and is substantially done — nine audit defects found today, five fixed, three
in `shaders.ts` / `glsl.ts` in flight as this was written. **Do not describe Tier 2 as blocked on
`src/advanced/` any more.** Whether the owner calls the condition closed is still the owner's to
say, but the grammar — the blocker item 24 actually names — is no longer missing. It is this file.

## 6. What is still open

- The name. `model-3d` is proposed for consistency with `carousel-3d`. Not confirmed.
- Whether `light`'s four rigs are the right four.
- Whether this draft gets written into `todo.md` item 24 as the answer to its named blocker.
