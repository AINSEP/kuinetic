# `kuinetic/3d` — the grammar, first draft

Owner chose the **one-div** shape on 2026-09-18. This is the concrete proposal that follows from
that choice. Nothing here is built. Every convention below was read off disk today, not recalled.

## The whole thing

```html
<div data-kui="model-3d src:/models/robot.glb spin:360deg light:studio poster:/img/robot.jpg">
  <h2>Meet the robot</h2>
</div>
```

The host's own children stay visible, on top of the render. That is not a nicety — see §3.

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
| `poster` | `text` | `''` | Still image URL. The no-WebGL and reduced-motion answer. See §4. |

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

**It is not otherwise opaque.** Item 23 asked whether a GPU effect participates in the channel model
at all. For this shape the answer falls out: the render lives inside a canvas that composes with
nothing, but the *host* is an ordinary element, so a `fade-up` on the same div still works and the
channel model still arbitrates. One claimed channel, honestly declared, is the whole answer.

## 4. Reduced motion and no-WebGL — the same answer, deliberately

**Both render `poster` as a still image. Not the end state.**

The rule, stated in `camera-3d.ts:167-171` and worth quoting because it cuts the other way for
`scene`: use the end state when the end is a position the **author designed**; do not, when the end
is merely where a **camera finished travelling**. A spin's end is a camera position, not a design.
So: no end state. A poster.

With no `poster` authored, render nothing and leave the host's own children. A 3D model has no
meaningful CSS fallback — that is a **content requirement on the author**, not a library behaviour,
and the docs must say so on day one.

(Baking one frame via `toDataURL` is §10's option 3 — free, and the right reduced-motion path once
the renderer exists. `poster` covers the case where WebGL never starts at all.)

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

## 6. What is still open

- The name. `model-3d` is proposed for consistency with `carousel-3d`. Not confirmed.
- Whether `light`'s four rigs are the right four.
- Whether this draft gets written into `todo.md` item 24 as the answer to its named blocker.
