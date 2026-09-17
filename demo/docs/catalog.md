# Effect Catalog

This catalog lists every named effect the library ships, grouped into nineteen sections (A–S).
See the [architecture document](?doc=design) for the attribute grammar, composition model, and
design rationale behind this list.

A composition of several of these names can itself be given a name, with no build step, using
`data-kui-define` — see [Architecture §3.3](?doc=design#33-named-bundles-data-kui-define). Those
names are yours and are not listed here.

**Counts:** **292** named effects, over **38 primitive families**. Note that 48 names come from a
single family (the entrance/exit matrix), so name count is not work count. The families below are
the architectural grouping, not registry ids — the registry holds more entries than that, because a
family like `reveal` registers a few sibling primitives so that channel-conflict detection can tell
`fade-up` apart from `zoom-in-up`.

**Out of scope:** WebGL/particle rendering — canvas-based effects are supported only through an
adapter that drives a user-supplied canvas, never as a built-in renderer.

Gestures and physics (drag, swipe, long-press, magnetic pull) are a separate thirteen-name group,
outside the lettered A–S sections below — see [Gestures & physics](#gestures-physics) at the end
of this document. The [generic tween](#generic-tween) sits outside them too, and is the one entry
here that is not a named effect at all: it is how you animate something the catalog does not name.

## Legend

- **Renderer** — `css` (keyframes only) · `waapi` · `js` (per-frame) · `prep` (JS DOM surgery, then CSS)
- **Channels** — properties the effect owns, for composition-conflict detection:
  `o` opacity · `t` translate · `s` scale · `r` rotate · `f` filter · `c` clip/mask · `x` other
- Effects with **disjoint** channels compose in one comma list; collisions warn.

---

## The 38 primitive families

| # | Primitive | Renderer | Channels | Powers |
|---|---|---|---|---|
| 1 | `reveal` | css | o,t | entrance/exit matrix, scroll reveals |
| 2 | `scale-in` | css | s | zoom, pop |
| 3 | `rotate-in` | css | r | rotate, roll, swing |
| 4 | `blur` | css | f | blur-in/out, duotone, grayscale |
| 5 | `clip-wipe` | css | c | wipes, curtains, before/after |
| 6 | `mask-reveal` | css | c | mask-image reveals |
| 7 | `ken-burns` | css | s,t | slow image drift |
| 8 | `float` | css | t | bob, floating shapes |
| 9 | `pulse` | css | s,o | glow pulse, badge, spinner |
| 10 | `shake` | css | t | error shake, wobble |
| 11 | `gradient-shift` | css | x | mesh, aurora, rotating border |
| 12 | `noise` | css | x | grain, scanline |
| 13 | `shimmer` | css | x | text/skeleton sweep |
| 14 | `flip-3d` | css | r | card flip, cube, fold |
| 15 | `stroke-draw` | css | x | SVG draw, checkmark, charts |
| 16 | `path-morph` | js | x | arbitrary SVG `d` interpolation |
| 17 | `split-text` | prep | — | chars/words/lines segmentation |
| 18 | `type` | js | x | typewriter |
| 19 | `scramble` | js | x | scramble, decode |
| 20 | `count` | js | x | numbers, odometer |
| 21 | `pointer-follow` | js | t | magnetic, cursor, spotlight |
| 22 | `tilt` | js | r | 3D tilt |
| 23 | `marquee` | css | t | seamless infinite scroll |
| 24 | `var-font` | css | x | variable font axis animation |
| 25 | `parallax` | css | t | scroll-linked movement |
| 26 | `progress` | css | s | scroll progress bar/ring |
| 27 | `pin` | js | x | sticky orchestrator |
| 28 | `flip-layout` | js | t,s | FLIP measure/invert/play |
| 29 | `sequence-scrub` | js | x | image/video frame scrub |
| 30 | `slat-assemble` | prep | — | image slats fly in and land assembled |
| 31 | `background-media` | prep | — | full-bleed image/video backdrop behind an element's own children (`bg`, `background`, `video-backdrop`, `video-hero`) |
| 32 | `tween` | css | per attribute | generic property tween — `tween`, `tween-from` |
| 33 | `motion-path` | css | x | travel along an arbitrary curve (`offset-path`) |
| 34 | `rotate-static` | js | r | fixed, persistent tilt on any element (`rotate-static`) |
| 35 | `view-morph` | js | x | View Transitions shared-element handoff (`page-morph`) |
| 36 | `view-swap` | js | x | starts a same-document view transition around one state change (`view-swap`) |
| 37 | `glass` | js | x | translucent blurred surface material |
| 38 | `spatial-ring` | js | x | N children placed on a ring in 3D — the spatial carousel |

---

## A. Entrance & exit matrix — 48 names

Primitives 1–4. All `css`. The largest name group, the smallest amount of code.

| | |
|---|---|
| **fade** | `fade-in` `fade-out` `fade-up` `fade-down` `fade-left` `fade-right` `fade-out-up` `fade-out-down` `fade-out-left` `fade-out-right` |
| **slide** | `slide-up` `slide-down` `slide-left` `slide-right` `slide-out-up` `slide-out-down` `slide-out-left` `slide-out-right` |
| **logical** | `slide-inline-start` `slide-inline-end` `slide-block-start` `slide-block-end` (RTL-aware; physical names stay physical) |
| **zoom** | `zoom-in` `zoom-out` `zoom-in-up` `zoom-in-down` `pop-in` `pop-out` |
| **flip** | `flip-in-x` `flip-in-y` `flip-out-x` `flip-out-y` |
| **rotate** | `rotate-in` `rotate-out` `rotate-in-left` `rotate-in-right` `roll-in` `roll-out` `swing-in` |
| **blur** | `blur-in` `blur-out` |
| **combo presets** | `fade-blur-up` `fade-blur-in` (single tested keyframe — no channel conflict) |
| **easing character** | `bounce-in` `bounce-in-up` `bounce-in-down` `back-in-up` `back-in-down` |

> **`bounce-in` does not bounce.** It shares `pop-in`'s primitive, keyframes, and `back-out`
> easing, differing only in starting scale (`0.3` vs `pop-in`'s `0.6`) — so it is a deeper `pop-in`,
> not a different motion quality. An overshoot-and-settle bounce needs keyframes that pass scale
> `1` before settling back to it; that is a new keyframe block, not a parameter, and hasn't been
> authored yet.

---

## B. Scroll reveal & parallax — 12 shipped, 1 planned

Primitives 1, 25, 26. `css` with native timelines; observer fallback for `on:enter`.

`reveal-once` · `parallax-y` · `parallax-x` · `parallax-scale` · `parallax-rotate` ·
`depth-layer` · `scroll-progress-bar` · `scroll-progress-bar-y` · `scroll-progress-ring` ·
`scroll-fade` · `scroll-desaturate` · `scroll-skew` · `reveal-direction-aware`†

> `parallax-*` and `scroll-*` use `data-kui-timeline`, not `data-kui-on` — they are
> progress-linked and reverse on scroll-up by design.

> **Animating across a pin.** A `view` timeline stalls the moment an element is pinned — a stuck
> element stops travelling through the viewport, so its progress freezes for exactly the span you
> wanted to animate over. Use `timeline:pin` there instead: it seeks the animation from the
> `--kui-progress` the pinning primitive publishes, so the driver and the effect it drives can sit
> on one element. `data-kui="pin-section distance:200vh, parallax-rotate from:-180deg angle:0deg
> timeline:pin"` holds a card still and unwinds half a turn across the hold. `timeline:pin` needs
> no browser scroll-timeline support — it is a paused animation and a negative delay.

> `scroll-skew` writes the `transform` shorthand, because CSS never gave skew an independent
> property beside `translate`/`rotate`/`scale`. It is the only effect in the catalog that touches
> `transform`, and it declares its own `skew` channel to keep it that way.

> **† Not yet implemented.** `reveal-direction-aware` needs to know which way the page is
> travelling, which no CSS timeline exposes — it would be the library's first JS scroll-direction
> primitive, so it is a decision rather than an oversight. `reveal-repeat` used to be listed here
> and has been removed outright: it was byte-identical to `reveal-once` once the activation binder
> stopped re-observing after first entry.

> `reveal-once` is itself byte-identical to section A's `fade-up` — same primitive, same
> keyframes, no parameter differs. It earns its keep by living in this section: someone scanning
> for scroll-triggered reveals finds it here without needing to know `fade-up` is the same
> animation under the entrance vocabulary.

---

## C. Scroll mechanics — 12 names

Primitives 27, 29. `js`. This is the JS-heaviest group in the catalog.

`pin-section` · `pin-until` · `pin-spacer` · `scroll-progress` · `scrollytelling-step` ·
`stacking-cards` · `horizontal-scroll` · `sequence-scrub` · `video-scrub` · `scroll-snap-x` ·
`scroll-snap-y` · `scroll-spy`

> `scroll-snap-*` are thin CSS passthroughs. Everything else needs the orchestrator:
> measurement, resize invalidation, nested scroll containers, cleanup.

> **`--kui-pin-offset` — set once, and every pin clears your header.**
>
> All four pinning names take `offset-top:`, which becomes the element's sticky `top`. It is spelt
> for the side it sets because plain `offset:` already means something else in the catalog — on
> `header-shrink`, `header-hide-on-scroll` and `back-to-top-fade` it is a scroll *threshold* in
> pixels, not a position, and both spellings were writing `--kui-offset`. Its default is
> not `0px` but `var(--kui-pin-offset, 0px)`, so the library still defaults to zero for a page with
> no chrome, while a page that has a fixed or sticky header answers it in one place:
>
> ```css
> :root { --kui-pin-offset: 5.5rem; }   /* header underside + a little air */
> ```
>
> Without it, every pin on such a page parks its top edge underneath the header and holds it there
> for the whole pin — the failure is invisible in a static screenshot and obvious the moment you
> scroll. Writing `offset-top:` on each pin instead puts one number in a dozen attributes, and
> they drift. An authored `offset-top:` still wins outright — `stacking-cards` is the same `pin`
> primitive under a fourth name, and that is exactly what its per-card stagger uses.
> per-card stagger. Scope the token to a subtree rather than `:root` when only part of the page is
> under the header.

> **`target:` — let the library mark the elements, so you write one rule instead of one per step.**
>
> `scrollytelling-step` publishes `data-kui-step` on the section, which is enough to style the
> section itself. Styling *the step that is currently live* is the part CSS cannot express on its
> own, and without help it costs one selector per step:
>
> ```css
> /* four steps, one property group — and every line of it wrong the moment you add a fifth */
> [data-kui-step='0'] li:nth-child(1),
> [data-kui-step='1'] li:nth-child(2),
> [data-kui-step='2'] li:nth-child(3),
> [data-kui-step='3'] li:nth-child(4) { color: white; }
> ```
>
> Point `target:` at the step elements and the library stamps `data-kui-step-state` on each of them
> — `before`, `active`, or `after`:
>
> ```html
> <section data-kui="scrollytelling-step distance:200vh steps:4 target:'.stops > li'">
> ```
> ```css
> .stops li[data-kui-step-state='active'] { color: white; }        /* the live one   */
> .stops li:not([data-kui-step-state='after']) { opacity: 1; }     /* everything done */
> ```
>
> Two rules, and neither of them mentions how many steps there are.
>
> **Quote a selector containing spaces or commas.** The `data-kui` grammar separates parameters with
> spaces and effects with commas, so `target:.stops > li` would parse `> li` as two stray tokens.
> Quoting is the escape, and it lets one `target:` drive several parallel groups at once — the copy
> and the progress dots beside it, say:
>
> ```html
> target:'.stops > li, .dots > span'
> ```
>
> Position is counted **within each matched element's parent**, so two sibling lists of four both
> number 0–3 rather than 0–3 and 4–7.
>
> The live index is also published as `--kui-step`, a plain number, for the cases a selector cannot
> reach — selectors match, they do not do arithmetic. Moving one element a fixed amount per step is
> one rule instead of one rule per step:
>
> ```css
> .frame img { transform: translateY(calc(var(--kui-step, 0) * -25%)); }
> ```
>
> `data-kui-step-state` is a state contract, not a look: the library stamps it and styles nothing,
> because `target:` marks whatever you point it at and that is as often a line of copy as a coloured
> bar. To get the shipped segment styling — off state, lit state, the transition between them — put
> `.kui-step-track` on the container holding them. `step-progress` in section O opts its own children
> in automatically.
>
> Same parameter, same validation, on `scroll-spy` (`target:#nav-link-features` — marks the nav link
> for this section with `data-kui-active`), on `step-progress` in section O, and on `sequence-scrub`
> below. A selector that matches `<html>` or `<body>` is rejected with a warning rather than
> stamping the whole document, and so is one that does not parse.
>
> `scroll-spy` also has a container form for a nav with more than one link: author `sections:` —
> not `target:` — on the shared ancestor of the nav and the sections, and `target:` there names
> every link at once rather than one section's own. One instance measures every section's own
> height instead of an authored `distance:`, and takes `offset-top:` for a sticky header, same
> spelling as the pinning family though not the same shared token — the per-section form above is
> unchanged and still wants `distance:` and one attribute per section.
>
> These four are `target:`'s original home, but the parameter is not limited to them: **any effect
> in the catalog** may be retargeted — `fade-up target:h1` animates the `h1`, not the element the
> attribute is written on — with `scope:page` to search the whole document instead of just this
> element's descendants. See [Animating a different element](getting-started.md#animating-a-different-element--target-and-scope)
> for the general grammar, the effects that refuse retargeting because their CSS reaches past
> themselves, and the one limitation shared by every use of `target:` here and below: it is resolved
> once, when the host is first processed, not kept live against later DOM insertions.

> **`sequence-scrub target:` — prefer authored frames over a `src:` pattern.**
>
> A frame sequence has two forms. Point `target:` at images that already exist and the scrub reveals
> one at a time:
>
> ```html
> <div class="stage" data-kui="sequence-scrub target:'.stage img' distance:220vh">
>   <img src="./frames/0.jpg" alt="A landing page fading up from grayscale as you scroll">
>   <img src="./frames/1.jpg" alt="">
>   <img src="./frames/2.jpg" alt="">
> </div>
> ```
>
> The older form rewrites one element's `src` from an `{i}` placeholder —
> `sequence-scrub frames:5 src:./frames/{i}.jpg` — and it is still there for sequences too long to
> author as tags. Everywhere else, prefer `target:`, for four reasons:
>
> 1. **The frames are loaded before the scrub starts.** `src:` fetches each frame at the moment
>    scrolling reaches it, so the first pass through is always cold. Measured on `demo/scroll.html`
>    before the switch: zero frames present at load, all five fetched mid-scroll.
> 2. **Per-frame `alt`, `srcset`, `<picture>`,** and any filenames at all — not just a numbered run.
> 3. **No `{i}`,** so nothing needs an exception in the CSS-escape guard on `data-kui` values.
> 4. **No URL to validate.** `src:` is an author-supplied URL template, so it carries a same-origin
>    check to stop a CMS-authored `data-kui` becoming a tracking pixel or an internal-host probe.
>    Real `<img>` tags are already covered by the page's own CSP.
>
> `frames:` is ignored when `target:` is set — the frame count is the number of elements you wrote,
> and a second source of truth for one number can only ever disagree. Frames are marked with the
> same `data-kui-step-state` contract as above, because a frame sequence *is* a stepped thing. The
> shipped stacking (absolutely positioned, `object-fit: cover`, only `active` visible) applies to
> the direct children of a `sequence-scrub`/`video-scrub` element, or to anything inside
> `.kui-frame-stack` when the frames are not direct children.

---

## D. Text & typography — 27 names

Primitives 17–19, 13, 23, 24.

| Group | Names |
|---|---|
| segmentation | `split-chars` `split-words` `split-lines` |
| reveals | `text-reveal-up` `text-reveal-down` `text-reveal-mask` |
| motion | `text-wave` `text-jitter` |
| typing | `typewriter` `typewriter-loop` |
| resolve | `scramble` `decode` `glitch` |
| color | `gradient-shimmer` `gradient-sweep` `highlight-sweep` `text-outline-fill` |
| line | `underline-draw` |
| variable font | `var-weight` `var-width` `var-slant` `var-axis` |
| structural | `word-cycler` `marquee` `marquee-scroll-linked` `redaction-reveal` `text-3d-extrude` |

> All splitting uses `Intl.Segmenter` (grapheme clusters, not code units), preserves one
> accessible reading representation, and restores selectable text on cleanup.

> **`var-axis` is the generic one; the other three are not shorthands for it.** `var-axis
> axis:GRAD from:0 to:150` animates any OpenType axis by its four-character tag — `GRAD`, `opsz`,
> `SOFT`, `CASL`, `MONO`, or whatever a foundry invented — through `font-variation-settings`. The
> tag is case-significant (`wght` is lowercase because it is a registered axis; every vendor axis
> is uppercase) and is validated as exactly four letters or digits; anything else warns and the
> effect falls back to `wght`. `from:`/`to:` are plain unbounded numbers, because an axis range
> belongs to the font rather than to CSS — a value past the end is clamped by the font, not
> rejected.
>
> `var-weight`, `var-width` and `var-slant` stay because they animate `font-weight`,
> `font-stretch` and `font-style` — the high-level properties, which behave sensibly on
> *non-variable* fonts too and which the CSS Fonts spec says to prefer wherever one exists.
> `var-slant` in particular is not `var-axis axis:slnt`: the `slnt` axis leans right for
> *negative* values and `oblique` leans right for positive ones, so the two spellings tilt
> opposite ways. Reach for `var-axis` when CSS gave your axis no property of its own.
>
> One `var-axis` per element. It writes the whole `font-variation-settings` declaration, so a
> second one — or a `var-weight` beside it — is refused as a channel conflict rather than
> silently letting the last one win.

> **`text-reveal-mask` under tight leading.** The reveal ends on `clip-path: inset(0)`, which clips
> to each item's *border box* — so display type set below `line-height: 1` gives it a box shorter
> than the glyphs, and the resting state shaves ascenders off text that is not animating at all.
> `--kui-mask-bleed` grows the clip window by that much padding and hands the space straight back
> as an equal negative margin, leaving your leading untouched. A length, not a switch, because it
> has to match that leading: `.headline { --kui-mask-bleed: 0.1em }` on any ancestor inherits down
> to the generated spans, so you never write a rule against `.kui-split-item` yourself. Default `0`.

---

## E. SVG & icons — 17 names

Primitives 15, 16. All CSS except the two morphs.

`draw-stroke` · `draw-signature` · `draw-underline` · `checkmark-draw` · `cross-draw` ·
`chart-line-draw` · `gradient-stroke` · `heart-fill` · `bookmark-fill` · `chart-area-fill` ·
`chart-bar-grow` · `logo-build` · `hamburger-to-x` · `play-to-pause` · `plus-to-minus` ·
`icon-morph` · `blob-morph`

> **The draws** animate `stroke-dashoffset` from the shape's own length down to zero. Set the
> length with `length:` — `data-kui="checkmark-draw length:48"` — or with `--kui-path-length` in
> your own CSS. The library never measures your SVG: `getTotalLength()` is a layout read on every
> element on every mount, to recover a number already sitting in your markup.

> **`gradient-stroke`** travels the stroke *colour* between `--kui-stroke-from`, `--kui-stroke-via`,
> and `--kui-stroke-to`, and loops. The literal reading of the name — an animated
> `<linearGradient>` paint server — is not reachable from CSS scoped to the path, because the
> gradient is a separate element in `<defs>`. It owns the `stroke` channel, so it will not compose
> with a draw; the conflict detector says so rather than silently dropping one.

> **The three icon toggles** are state, not a one-shot animation, so they work like the
> native-state group in section O: a CSS transition keyed off an attribute you already have to set
> for accessibility. No JS, and no second source of truth for "is the menu open".
>
> | | attribute | markup it expects |
> |---|---|---|
> | `hamburger-to-x` | `aria-expanded` | three `.kui-bar` children |
> | `play-to-pause` | `aria-pressed` (`true` = playing, so the icon shows pause) | two `.kui-bar` children |
> | `plus-to-minus` | `aria-expanded` (`true` = open, so the icon shows minus) | two `.kui-bar` children |
>
> ```html
> <button data-kui="hamburger-to-x" aria-expanded="false" aria-label="Menu">
>   <span class="kui-bar"></span><span class="kui-bar"></span><span class="kui-bar"></span>
> </button>
> ```
>
> `--kui-bar-gap` is how far an outer bar travels to meet the centre. Set it to match your own
> bar spacing.

> **`logo-build`** goes on the *parts* of a mark, with `data-kui-stagger` on their wrapper. That
> stagger is what makes it a build rather than one more scale-in.

> `icon-morph` / `blob-morph` use primitive 16 (arbitrary path interpolation). The named
> icon pairs are precomputed matched-point-count morphs — cheap and exact.

---

## F. Numbers & data viz — 13 names

Primitive 20, plus 15 and 26.

`count-up` · `count-down` · `count-currency` · `count-percent` · `count-compact` ·
`odometer-roll` · `progress-ring` · `progress-bar` · `progress-segments` · `gauge-sweep` ·
`star-rating-fill` · `sparkline-draw` · `donut-sweep`

> Counters expose the final value to assistive tech and never spam `aria-live` mid-animation.

---

## G. Media & images — 22 names

Primitives 5, 6, 7, 4, 30, 31.

`wipe-up` · `wipe-down` · `wipe-left` · `wipe-right` · `wipe-circle` · `wipe-diagonal` ·
`mask-reveal` · `curtain-reveal` · `ken-burns` · `ken-burns-out` · `blur-up` ·
`duotone-hover` · `grayscale-hover` · `saturate-hover` · `image-parallax-frame` ·
`before-after-wipe` · `lightbox-open` · `slat-assemble` · `bg` · `background` ·
`video-backdrop` · `video-hero`

> **`bg`** and **`background`** are two names for one effect: they turn an element into its own
> full-bleed backdrop and leave every child the author wrote rendering on top of it, untouched.
> `src:` is the only required parameter, and it takes a path *or* a full URL — `/media/hero.mp4`,
> `https://cdn.example.com/hero.mp4`, `//cdn.example.com/hero.webm` all work, on your own origin or
> anyone else's. A URL ending `.mp4`/`.webm`/`.mov`/`.m4v`/`.ogv` builds a `<video>`, anything else
> an `<img>`. Only `http:` and `https:` are accepted: `javascript:`, `data:`, `file:` and `blob:`
> are refused with a warning.
>
> This is looser than `sequence-scrub`'s same-origin-only `src:`, deliberately. A background is the
> one media case where the file routinely lives on a CDN or a bucket, and a scrub's `src:` is a
> `{i}` template firing one request per frame — a far larger channel than one fixed fetch. If your
> site accepts `data-kui` from untrusted authors, set a `Content-Security-Policy` with
> `img-src`/`media-src`; that is the control designed for this, and the one thing a library cannot
> do on your behalf.
>
> ```html
> <section data-kui="bg src:/media/hero.mp4 poster:/media/hero.jpg overlay:black overlay-opacity:45%">
>   <h1 data-kui="split-lines">Text still animates, on top.</h1>
> </section>
> ```
>
> | param | default | what |
> |---|---|---|
> | `src:` | — | required; path or full URL to an image or video file (http/https) |
> | `poster:` | — | still shown before a clip's first frame decodes |
> | `fit:` | `cover` | `cover` or `contain`. No `fill`: it stretches, and the rule here is crop, never stretch |
> | `focus:` | `center` | which part a `cover` crop keeps — `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right` |
> | `overlay:` | `transparent` | scrim colour painted over the media and under your children |
> | `overlay-opacity:` | `100%` | scrim opacity, for tuning legibility |
> | `autoplay:` | `in-view` | `in-view`, `always`, or `never` |
> | `rate:` | `1` | clip `playbackRate`, `0.25`–`4` |
> | `loop:` | `true` | whether a clip restarts when it ends |
>
> **`src:` must be a media file, and a YouTube link is not one.** A watch URL is a web page; handed
> to `<video>` it fails to decode and leaves the section blank. Playing one needs the iframe embed
> API — a third-party document with its own player, consent and cookie story, and no `object-fit`
> to cover a box with — so it is a different mechanism, not a branch inside this effect. A
> `youtube.com`/`youtu.be` `src:` is refused by name and says so, rather than failing silently.
>
> **There is no `controls:`, deliberately.** The layer paints at `z-index: -1` behind whatever you
> put in the element, so a native control bar there is keyboard-focusable and occluded by your own
> content — a player you can tab into and cannot see. Every layer this effect builds is
> `aria-hidden` and `pointer-events: none`, with no way to switch that off. A clip meant to be
> controlled is a content `<video controls>` you write yourself, not a background one.
>
> **`overlay:` is the parameter that makes this usable**, because the point of a backdrop here is
> animated text on top of it, and text over unmodified footage is illegible about half the time —
> one light frame arrives and the headline vanishes for those seconds. The scrim is its own layer
> between the media and your children, so it darkens the picture without touching the text.
>
> A video is created `muted playsinline preload="metadata"` and, by default, plays only while any
> part of it is on screen, pausing again when it leaves. That observer is the effect's, so a page
> never writes one; `autoplay:always` opts out of the pairing and `autoplay:never` leaves the clip
> on its poster. Under `prefers-reduced-motion` every mode lands on the poster — which is why this
> is the one JS-tier name in the section that is not `reducedMotion: disable`: refusing to install
> would leave the element with no background at all rather than a calmer one.
>
> No CSS, no wrapper, no class names. The library claims `position: relative` on the host only if
> it is unpositioned, plus `isolation: isolate` so the layers' `z-index: -1` sits between the host's
> own background and its children instead of escaping behind an ancestor. Teardown deletes both
> layers and gives the two properties back. Those two properties are why this name declares the
> `layout` channel as well as `media`: composing it with another name that positions the same
> element — `pin-section`, `scroll-snap-*` — is a reported conflict rather than two effects quietly
> disagreeing about what `position` the host has.
>
> **`video-hero`** and **`video-backdrop`** are the same effect with the scrim already on —
> `overlay:black overlay-opacity:45%` — because the point of a clip behind a section is text on top
> of it, and that is the parameter the paragraph above says makes the effect usable. Reaching for
> `bg` and discovering the legibility problem yourself is the step these two names delete; bare `bg`
> is still there when you want unscrimmed footage.
>
> They differ from each other only in `autoplay:`. **`video-hero`** forces `always`, because the
> first screen is exactly where a visibility heuristic catching the clip mid-stall is most visible,
> and a short hero clip is cheap enough to leave running. **`video-backdrop`** keeps the default
> `in-view`, so a clip further down the page stops costing decode budget once it is scrolled past.
> Every other parameter is `background-media`'s own and is not restated by either name, so
> `fit:cover` still fills a 390px phone without letterboxing or stretching (`focus:` picks which
> part of the frame a narrow viewport keeps), `loop` still defaults to `true`, and the forced
> `muted`/`playsinline` pair still has no switch — that is browser autoplay policy, not a choice,
> and unmuting can only ever come from a real click. Neither name claims a height: a hero's box is
> your layout, and a backdrop that forced `100svh` on its host would break every card-sized use of
> the same name. Give both a `poster:`, which is what a reduced-motion visitor sees — a static
> frame, not a blank box.
>
> ```html
> <section data-kui="video-hero src:/media/hero.mp4 poster:/media/hero.jpg">
>   <h1 data-kui="split-chars on:load">Animate anything</h1>
> </section>
> ```
>
> **`slat-assemble`** slices a wrapped `<img>` into `slats:` background-sliced strips and flies
> them in staggered, landing assembled over the original picture — the one `prep` name in this
> section: it builds the slats once at activation, then every frame is `translate`/`rotate`/
> `opacity` on synthetic children, same as `split-text` in section D. Every slat paints the *same*
> image URL as its own `background-image`, so N slats cost one fetch and one decode, not N — see
> `installSlatStage` in `media-shared.ts` for the band geometry. `axis:vertical` (default)
> cuts columns that fly in vertically; `axis:horizontal` cuts rows that fly in horizontally.
> `angle:` is the general form of the same idea — `0deg` is `axis:vertical`, `90deg` is
> `axis:horizontal`, and anything between (`angle:35deg`) cuts diagonal bands. An authored angle
> wins over `axis:`; bare numbers and `deg`/`rad`/`grad`/`turn` are all accepted, and the value is
> normalised to `[0, 180)` because a band at 200deg is the same set of bands as one at 20deg.
> Slats always travel *along* their own band, never across it — a band moving across its own width
> uncovers the gap it left.
> `from:` picks the stagger order — `alternate` (default), `start`, `end`, `edges`, or
> `random-ish` (a deterministic scatter, not `Math.random`) — independent of which side each slat
> flies in from, which always alternates by position. `fold:true` adds a `rotateY`/`rotateX` hinge
> for an accordion-fold look instead of a flat slide.
>
> ```html
> <figure data-kui="slat-assemble slats:8 axis:vertical from:alternate">
>   <img src="./photo.jpg" alt="…" />
> </figure>
> ```
>
> No CSS or class names required — the wrapper only needs one `<img>` child; everything else,
> including a defensive `position: relative` claim if the wrapper is unpositioned, is the
> library's own work.

---

## H. Layout & FLIP — 9 names

Primitive 28. `js`. One technique unlocks the whole group.

`flip-reorder` · `flip-filter` · `flip-sort` · `flip-shuffle` · `accordion-height` ·
`expand-to-modal` · `grid-to-list` · `tab-indicator-slide` · `masonry-reflow`

> **Boundary:** these animate elements *you* control. `accordion-height` animates height;
> it does not own `aria-expanded`, focus, or keyboard handling. Accessible accordion/carousel/
> menu **components** are deliberately out of scope.

---

## I. Hover & pointer — 35 names

Primitives 21, 22, plus CSS.

| Group | Names |
|---|---|
| button | `lift` `lift-shadow` `pop` `magnetic` `shine-sweep` `split-flap` |
| press | `press-depth` |
| border | `border-draw` `border-glow` `beam-border` `beam-border-auto` |
| link | `underline-slide` `underline-center` |
| icon | `icon-wiggle` `icon-spin` `icon-bounce` |
| card | `tilt-3d` `tilt-parallax` |
| group | `group-dim` |
| label | `masked-label-swap` `masked-label-swap-x` `masked-label-swap-diagonal` |
| intent | `hover-intent` |
| preview | `anchored-preview` `anchored-preview-bottom` `anchored-preview-left` `anchored-preview-right` |
| search | `search-expand` |
| cursor | `cursor-follow` `cursor-lag` `cursor-label` `cursor-spotlight` `cursor-invert` |
| proximity | `proximity-field` `proximity-glow` |

> Every hover effect ships a `:focus-visible` equivalent and a coarse-pointer fallback.

> **`border-draw`** paints its ring on a masked pseudo-element, not with `border-image`. That is
> worth stating because it changed: `border-image` ignores `border-radius` outright — the spec draws
> a border image against an uncurved nine-slice grid — so the old spelling put four square corners
> on every rounded card it was used on, with no workaround available inside that approach. The ring
> is now a conic gradient on a `::before`, masked down to its own perimeter, which is the same
> technique `beam-border` and `gradient-border` already used and which follows the corner radius.
> One behaviour change comes with it: the ring is an overlay rather than 2px of real border, so it
> no longer occupies layout, and a page that leaned on it for spacing will see content shift out by
> that much. Params: `color:`, plus `width:` (the ring's thickness, default `2px`, previously a
> hardcoded literal) and `outset:` (default `0px`, pulls the ring out over a host's own border — the
> same compensation `beam-border` documents, needed for the same reason). It claims `::before`, so
> it is refused against `beam-border`, `beam-border-auto` and `cursor-spotlight`.

> **`masked-label-swap`** stacks two copies of a label in a clipped box: on hover, focus or press one
> slides out as the other slides in. `masked-label-swap-x` is the horizontal axis and
> `masked-label-swap-diagonal` travels on both; vertical is the unsuffixed default because that is
> what a changing number or price reads as, where a changing call to action reads better sideways.
> The "old number slides out, upgraded number slides in" pattern is this same effect with numerals
> in the two parts, so it needs no name of its own. Markup is two marked children and no CSS:
> `<button data-kui="masked-label-swap"><span data-kui-swap="from">Download</span><span
> data-kui-swap="to">Get the file</span></button>` — real elements with real text, not
> `::before`/`content`, which cannot be selected or copied and reaches assistive technology
> inconsistently. Params: `distance:` (travel, `100%` of the part's own box by default, so the
> outgoing copy clears the clip exactly as the incoming one lands) plus duration/delay/ease. It
> claims `discrete` (it pins `display: inline-grid` to stack the copies) and a `label-swap` box
> channel of its own, so `lift, masked-label-swap` composes and two axes on one host do not.

> **`hover-intent`** reveals a hint only once the pointer has *rested* on the trigger — `delay:`
> defaults to `1000ms` here, the one non-zero delay default in the catalog, because an instant
> version of this is a different effect that should have a different name. Leaving early cancels it
> outright, and that comes free rather than from a script: a CSS transition reads its parameters
> from the after-change style, so a delay carried only by the state rule means an early leave
> reverts the property and cancels the pending transition before it ever started. Markup is one
> marked child: `<button data-kui="hover-intent" aria-describedby="t"><span data-kui-hint id="t"
> role="tooltip">…</span>Archive</button>`. On a touchscreen the fallback is `:active`, which with
> the same delay is long-press-to-reveal. The hint is `pointer-events: none` in every state,
> deliberately — a panel you can move the pointer *into* is a menu, which needs trajectory intent
> (predicting a pointer heading toward it) and is a genuinely different, JavaScript-shaped feature.
> Params: `distance:` (the small rise as it arrives, default `4px`) plus duration/delay/ease.

> **Both two-box names work with `target:`**, which is why neither writes a descendant selector.
> The trigger's state reaches the second box as an *inherited custom property* read by a standalone
> part rule, so no rule reaches past the element carrying `data-kui-fx` and `compile.ts` is free to
> relocate it: `data-kui="masked-label-swap target:.label"` on a button that also holds an icon is
> the ordinary way to write this. Any rule spelled the obvious way instead would force
> `requiresOwnSubtree` and take `target:` away silently.

> **`anchored-preview`** springs a second element out from its trigger on hover or focus — a name
> tag beside an avatar, a preview image popping out beside a linked word. One primitive, four fixed
> placements, not a `placement:` parameter: CSS cannot branch on a custom property's *value* without
> `@container style()`, so a keyword there would have to be read by JavaScript for the sake of one
> word, the same reasoning `masked-label-swap`'s axis suffixes are built on. `anchored-preview` (no
> suffix) springs from the top, matching where a tooltip normally reads; `-bottom`, `-left` and
> `-right` are the other three sides.
>
> ```html
> <span data-kui="anchored-preview" class="avatar-wrap" tabindex="0">
>   <img class="avatar" src="jane.jpg" alt="">
>   <span data-kui-preview class="name-tag">Jane Doe</span>
> </span>
> ```
>
> The trigger has to be its own focusable, hoverable element — an `<img>` can't contain the preview,
> which is why the markup above wraps both in a `<span tabindex="0">` rather than putting `data-kui`
> on the image itself. Params: `distance:` (how far the preview travels while springing in, default
> `10px`), `gap:` (how far it rests from the trigger once arrived — a separate length on purpose, so
> a bigger spring does not also push the resting position further away), `scale:` (the "sprung from"
> starting size, `0..1`, default `0.85`), plus duration/delay/ease. Like `masked-label-swap`, the
> preview is a real, selectable element rather than `::before`/`content`, and its state reaches it as
> an inherited custom property rather than a descendant selector — the same mechanism the note above
> describes — so `target:` relocates all four placements cleanly. The preview is `pointer-events:
> none` in every state, for the same reason `hover-intent`'s hint is: a panel you can move the
> pointer *into* is a menu, which needs trajectory intent (predicting where a pointer is heading) and
> is a different, JavaScript-shaped feature this name deliberately does not attempt.
>
> CSS anchor positioning (`anchor()`/`position-anchor`) is the textbook fit and was considered; it is
> the one "modern CSS technique" this project's own notes record as having a *harmful* fallback — an
> unsupported `anchor()` puts the element in the wrong place rather than a neutral one — so this
> reuses the inherited-custom-property mechanism instead, which needs no feature detection at all.

> **`search-expand`** grows a search icon into a full input field on focus, hover, or once the field
> already holds text — an explicit `inline-size` transition between two authored lengths, not a FLIP
> measure/invert/play (it grows in place; nothing relocates) and not `interpolate-size:
> allow-keywords` (deferred pending Safari support elsewhere in this catalog too).
>
> ```html
> <label data-kui="search-expand">
>   <svg aria-hidden="true">…</svg>
>   <input data-kui-search-field type="search" placeholder="Search…">
> </label>
> ```
>
> The host is a `<label>`, not a `<div>` — clicking anywhere in it, icon included, natively focuses
> the `<input>` with no JavaScript and no matching `for`/`id` pair, which is what lets a collapsed,
> icon-only control stay one click from typing. Params: `collapsed:` (icon-only width, default
> `2.5em`), `width:` (expanded width, default `240px`; both accept a percentage for a flexible
> header), plus duration/delay/ease. The input's own fade uses the same inherited-custom-property
> mechanism as `masked-label-swap`, `hover-intent` and `anchored-preview`, so `target:` still
> relocates the whole effect.

> **`proximity-field` and `proximity-glow`** are the cross-element version of `cursor-spotlight`
> (table above) — the Linear/Vercel/Raycast bento-grid effect, where one light source tracks the pointer
> across a whole grid and nearby cards illuminate at their nearest edge *without* being hovered
> themselves. `proximity-field` goes on the shared container and only tracks the pointer; it paints
> nothing itself. `proximity-glow` goes on each card and is pure CSS — a ring on a masked
> `::before`, the same technique `beam-border`/`border-draw` use, reading two custom properties the
> field publishes.
>
> ```html
> <div data-kui="proximity-field" class="grid">
>   <div class="card" data-kui="proximity-glow">…</div>
>   <div class="card" data-kui="proximity-glow">…</div>
>   <div class="card" data-kui="proximity-glow">…</div>
> </div>
> ```
>
> The field writes raw viewport coordinates on `pointermove` — no rect subtraction, no spring, no
> `requestAnimationFrame` — and every card paints the identical `radial-gradient(...)`, positioned
> with `background-attachment: fixed`, so distance falloff and the shared-light illusion both come
> from one CSS declaration rather than any per-card math. `proximity-glow` params: `color:` (default
> falls back to `--accent`), `radius:` (the light's reach, default `220px`), `width:` (ring
> thickness, default `1px`), `outset:` (pulls the ring out over the host's own border, default
> `0px`), plus duration/ease. It shares the `pseudo-before` channel with `border-draw`,
> `beam-border`, `beam-border-auto` and `cursor-spotlight`, so it refuses to compose with any of
> them — two rings fighting over one `::before` is a real conflict, not a false positive.
>
> **A transform on an ancestor breaks the illusion.** `background-attachment: fixed` measures
> against the viewport only when nothing between the card's `::before` and the viewport establishes
> its own containing block — a `transform`, `filter`, `perspective`, or `will-change: transform` on
> an ancestor (a card also running `tilt-3d`, say) breaks it for that card specifically. Nothing
> warns about this; it is a visual check, not a compile-time one. Coarse pointers get no proximity
> light at all — there is no "hover near" on a touchscreen — and keyboard users see no glow either,
> since a shared light source has no single point to jump to the way one element's own midpoint is.

> **`press-depth`** is the section's one `:active` effect: hold the control and it scales down
> while its shadow collapses toward the surface. It is the one rule in the file with no
> fine-pointer gate, deliberately — a press is released with the pointer, so it cannot leave an
> element stuck the way a tap on a `:hover` rule can, and touch is the pointer type with no hover
> to signal a control is live at all. `<button>` and `<a href>` hold `:active` for a Space/Enter
> press too, so the keyboard equivalent is native rather than a mirrored rule; a
> `<div role="button">` gets no `:active` from a keypress in any engine and needs a real button.
> Params: `scale:` (default `0.96`), `depth:` (the shadow's offset, blur and spread scale together
> from this one length, default `2px`), `color:`. Claims the `scale` and `shadow` channels and
> deliberately *not* `translate`, so `data-kui="lift, press-depth"` — raise on hover, sink on
> press — composes; `lift-shadow` and `border-glow` both write `box-shadow` on the same box and
> are refused. Its primitive is `press`, so a future pressed treatment is a new name on the same
> parameters and timing namespace rather than a second implementation.

> **`group-dim`** goes on the **container**, not the cards: hover or focus one child and every
> other child recedes. It reads whatever children are already there, so the page writes no
> structural CSS — `<ul data-kui="group-dim">` over any list, grid or row. A child stays lit when
> it is hovered, focused, or *contains* the focused element, which is what makes it work for the
> usual case where the focusable thing is a link inside the card rather than the card itself.
> Params: `opacity:` (how far the others recede, `0.4` or `40%`, default `0.4`), plus the usual
> duration/delay/ease — the delay is hover intent, applied on the way in and never on the way out.
> It claims a channel of its own (`group`) because it paints its children's opacity rather than
> its own, so `fade-in, group-dim` on one container composes; a second `group-*` effect would not.
> Because its rules reach past the element carrying them, `target:` refuses to relocate it.

---

## J. Ambient backgrounds — 15 names

Primitives 8, 9, 11, 12. Almost entirely `css`.

<!-- `noise-overlay` cut 2026-08-26 — human call, the rewritten version wasn't useful. Preset,
     rule, and @keyframes are commented out (not deleted) in ambient.ts / ambient.css; restore
     the row here alongside them to revive. -->
`gradient-mesh` · `aurora` · `gradient-rotate-border` · `gradient-border` ·
`scanline` · `dot-grid-drift` · `line-grid-drift` · `floating-shapes` · `float` · `bob` · `orbit` ·
`starfield` · `glow-pulse` · `spotlight-follow` · `wave-blob`

> `gradient-border` is `gradient-rotate-border`'s author-coloured sibling: same ring mask and
> `background-position` spin, but a `from:` → `to:` → `from:` two-stop list instead of the
> four-stop rainbow. Both, like `beam-border`, subtract their own content box to leave a ring —
> put the name on its own element, never on real content, or the mask deletes the content.

> **Colours.** `from:` sets `--kui-ambient-c1`; `to:` sets `--kui-ambient-c2`. Both inherit, so an
> outer `aurora from:#f0f to:#0ff` retints any ambient effect nested inside it — that sharing is
> deliberate. The prefix is not decorative: the unprefixed `--kui-c1`/`--kui-c2` are also read by
> `shine-sweep` and `confetti-burst`, so writing there would recolour unrelated descendants. Every
> rule still falls back to the unprefixed twin, so hand-set `--kui-cN` keeps working; set
> `--kui-ambient-c3`/`--kui-ambient-c4` by hand for `gradient-mesh`'s and
> `gradient-rotate-border`'s extra stops.
>
> `to:` is only accepted by the four two-stop names — `gradient-mesh`, `aurora`,
> `gradient-rotate-border`, `gradient-border`. The other seven paint a single colour, so they take
> `from:` alone (primitive `ambient-tint`) and warn on `to:` rather than silently ignoring it.

> `orbit` spins forever: `data-kui="orbit 3.5s"`, `angle:` for a partial turn. It defaults to
> `linear` easing rather than the section's usual `ease-in-out`, because an eased rotation
> visibly stutters once per revolution at the iteration boundary. Set `transform-origin`
> yourself — what a thing orbits around is layout, not motion.

> Continuous ambient motion is `reducedMotion: 'disable'`, not `'shorten'` — a 1ms aurora
> is meaningless.

---

## K. Feedback & status — 17 names

Primitives 9, 10, 13, 15.

`skeleton-shimmer` · `skeleton-to-content` · `spinner` · `spinner-dots` · `spinner-ring` ·
`progress-indeterminate` · `toast-slide-in` · `toast-slide-out` · `shake-error` · `wobble` ·
`ripple` · `badge-pop` · `count-bump` · `heart-burst` · `confetti-burst` · `copy-confirm` ·
`pull-to-refresh`

---

## L. Page transitions — 7 names

Primitives 1, 5, 35, 36, plus the View Transitions API.

`page-fade` · `page-slide` · `curtain-wipe` · `loading-bar` · `smooth-scroll-to` ·
`page-morph` · `view-swap`

> The first five are ordinary entrance effects that happen to look like a page arriving. The last
> two are the View Transitions API, which is a different thing entirely: it animates the
> *relationship* between two states of the page, so a card can become the detail view it links to
> rather than one thing fading out while another fades in. The browser does all of the work — it
> measures where the element was and where it ended up — which is why neither name has a distance,
> an angle, or anything else to configure.

> **`page-morph`** names an element so the browser can morph it into its counterpart on the other
> view. Put it on both halves of the pair. `name:` defaults to `auto`, which means "use this
> element's `id`" — exactly what the native `view-transition-name: auto` keyword does — so naming
> a pair is just giving both elements the same `id`:
>
> ```html
> <!-- index.html -->
> <a href="/pricing"><img id="hero-shot" src="/hero.avif" data-kui="page-morph"></a>
>
> <!-- pricing.html -->
> <img id="hero-shot" src="/hero.avif" data-kui="page-morph">
> ```
>
> Write `name:something` when the two elements cannot share an `id`. Only `load` and `manual`
> activations are accepted: an `on:enter` would leave every off-screen half of a pair unnamed,
> which is not a slower morph but no morph at all.

> **The one line the library does not write for you.** Cross-document transitions are opted into
> with an at-rule, and an at-rule cannot be scoped to a selector — a stylesheet that shipped one
> would opt every consuming site into animating every same-origin navigation. So it is yours:
>
> ```css
> @view-transition { navigation: auto; types: kui-page-slide; }
> ```
>
> `types:` picks the motion for the page *behind* the morph. Three are shipped, matching the three
> names above: `kui-page-fade`, `kui-page-slide`, `kui-curtain-wipe`. Omit `types:` for the
> browser's own cross-fade. Tune all of it from `:root` with `--kui-vt-duration`,
> `--kui-vt-delay`, `--kui-vt-ease` and `--kui-vt-distance` — these are page-level rather than
> per-effect because the `::view-transition` pseudo-elements hang off the document root and no
> value set on your card can reach them. `page-morph` says so out loud: it refuses `duration`,
> `delay` and `ease` by name instead of accepting them and doing nothing.

> **`view-swap`** is the same-document half — one page rewriting itself, with no navigation. It
> goes on the **control**, and it wraps a state change you already declare in markup:
> `aria-controls` says which element changes, and the library flips `data-open` on it (the same
> attribute section Q's open/close family reads) inside `document.startViewTransition()`. It does
> not manage focus, does not move anything, and is not a router.
>
> ```html
> <button aria-controls="detail" aria-expanded="false"
>         data-kui="view-swap type:kui-page-slide">Details</button>
> <section id="detail" data-kui="fade-open">…</section>
> ```
>
> Params: `controls:` (a selector, when `aria-controls` is not the right answer), `attribute:`
> (default `data-open`), `type:` (a view-transition type, the same vocabulary as the at-rule
> above), and `delay:`. `aria-expanded` on the control is kept in step when it is already there,
> and never added when it is not.

> **Without support, nothing breaks.** No View Transitions API: the at-rule is skipped, every
> rule in `view-transitions.css` contains a pseudo-element the browser cannot parse and is
> dropped, `page-morph` warns by name and writes nothing, and `view-swap` applies its state
> change directly. The API but no transition *types* (they shipped later): you get the browser's
> default cross-fade, and `view-swap` detects it and omits the type rather than passing an
> argument that would throw. Under `prefers-reduced-motion: reduce`, `page-morph` never names
> anything and `view-swap` skips the transition entirely — the page still navigates and still
> swaps, it just cuts.

> **† Not yet implemented.** `page-morph` is documented here but is not registered in `src/effects` — `data-kui` will not resolve it. Verified against the live registry.

---

## M. Navigation — 8 names

`menu-stagger-open` · `menu-fullscreen` · `header-shrink` · `header-hide-on-scroll` ·
`dropdown-open` · `drawer-slide` · `mega-menu-drop` · `back-to-top-fade`

> Same boundary as section H — animation only, no menu state machine or focus trapping.

---

## N. 3D & perspective — 10 shipped, 2 planned

Primitives 14, 22, 38.

`card-flip-x` · `card-flip-y` · `flip-card` · `cube-rotate` · `book-page-turn` ·
`fold-panel` · `carousel-3d` · `carousel-3d-high` · `carousel-3d-low` ·
`carousel-3d-inside` · `depth-layers-pointer`† · `perspective-grid`†

> **`card-flip-y` and `flip-card` are not the same thing**, and the similar names are worth
> reading twice. `card-flip-y` is an *entrance*: one keyframe, half a turn, played once, nothing on
> the other side. `flip-card` is a component with a front, a back, and a state in between — which a
> keyframe cannot express, because a one-shot animation has no way to come back.
>
> `flip-card` is a CSS transition keyed off `aria-pressed` on the control inside the card, read with
> `:has()`. The accessibility state *is* the visual state, so the two cannot drift apart. At the
> default `trigger:click`, toggling that attribute is yours to do — one line — the same as the icon
> toggles in section E.
>
> ```html
> <div data-kui="flip-card">
>   <div class="kui-face-front"> ... </div>
>   <div class="kui-face-back"> ... </div>
>   <button type="button" class="kui-flip-control" aria-pressed="false">Flip</button>
> </div>
> ```
>
> Faces are matched by class, not by position, so the control can sit anywhere in the source order.
> Keep it outside both faces: a button on the front face rotates away with it and stops being
> clickable the moment you use it once.

> **`trigger:` — four ways in, and the only part of `flip-card` that runs JavaScript.**
>
> - `click` — the default. Nothing is wired; you toggle the control, exactly as above.
> - `hover` — turns to the back while the pointer is inside, and back to the front when it leaves.
> - `hover-latch` — turns to the back on the first hover and stays there. Leaving does nothing.
> - `hover-toggle` — turns to whichever face is not showing. Leaving does nothing; the *next*
>   hover turns it back.
>
> ```html
> <div data-kui="flip-card trigger:hover-toggle"> ... </div>
> ```
>
> `click` is unchanged and stays entirely yours: the library wires no listener at all, so a card
> written before this parameter existed keeps working without it. The other three differ only in
> what happens *after* the pointer leaves, which is the whole reason there are three of them —
> `hover` is a peek, `hover-latch` is a reveal you pay for once, `hover-toggle` is a two-position
> switch you drive by passing over it.
>
> **Why any of this needs JavaScript.** `:hover` is true exactly while the pointer is inside the
> element and false the instant it is not, so a stylesheet can express `hover` and nothing else
> here. `hover-latch` and `hover-toggle` both ask the card to stay turned after the pointer has
> gone, and a selector has no memory of having once matched — the state has to outlive the thing
> that set it, which is a variable, not a rule. So the library sets `aria-pressed`, the same
> attribute a click sets. There is still exactly one source of truth, and the transition doing the
> turning is the same one in all four modes.
>
> The control is required in every mode, because it is where the state lives. A hover card usually
> wants no visible *Flip* button, which is a matter of hiding it rather than leaving it out. Hide it
> in CSS, not with the `hidden` attribute: `hidden` is a UA `display: none` at the lowest
> specificity there is, so any `display` your own stylesheet gives `.kui-flip-control` beats it —
> which is how a supposedly hidden control ends up rendering as an empty pill in the card's corner.
>
> ```html
> <div id="reveal" data-kui="flip-card trigger:hover-toggle">
>   <div class="kui-face-front"> ... </div>
>   <div class="kui-face-back"> ... </div>
>   <button type="button" class="kui-flip-control" aria-pressed="false">Flip</button>
> </div>
> ```
> ```css
> #reveal > .kui-flip-control { display: none; }
> ```
>
> The three hover values wire nothing on a coarse pointer — `(hover: hover) and (pointer: fine)`
> decides it. On a touch screen `pointerenter` fires from a tap, so a hover-flipped card would turn
> on the same tap that was reaching for something on the face in front of it. The control stays a
> real button there, which is the accessible path on those devices anyway — so if you hid it, bring
> it back under `@media (hover: none)`, or the back face is unreachable on a phone.
>
> Reduced motion is the same shape of gap for a different reason: `flip-card` declares
> `reducedMotion: 'disable'`, so the animator never activates the primitive and the hover listener
> is never attached. The card still turns on a click — the transition comes from the stylesheet,
> which is stamped either way — so bring the control back there too.
>
> The trigger looks for that one element and only as a direct child (`:scope > .kui-flip-control`),
> the same relationship the `:has()` rule uses, so a `flip-card` nested inside another card's face
> keeps its own state instead of writing its parent's.

> **The spatial carousel — `carousel-3d`, and the only name here that places more than one element.**
>
> Every other name in this section rotates *one* box about its own centre. This one arranges N
> children on a ring in space, which is a layout rather than an animation, and it is what a
> cover-flow, a coverwheel and a panorama all are.
>
> ```html
> <div data-kui="carousel-3d tilt:18deg" aria-label="Featured work">
>   <figure><img src="one.jpg" alt="…"></figure>
>   <figure><img src="two.jpg" alt="…"></figure>
>   <figure><img src="three.jpg" alt="…"></figure>
>   <figure><img src="four.jpg" alt="…"></figure>
>   <figure><img src="five.jpg" alt="…"></figure>
> </div>
> ```
>
> That is the whole markup. The children are the slides; no wrapper, no per-slide class, and no
> page CSS. The library stacks them in one grid cell, gives each one its place on the ring, and
> makes the container grabbable and arrow-key operable.
>
> **`tilt:` takes a real CSS angle**, not a 0–1 scalar: `18deg`, `-14deg`, `0.05turn`. **Positive
> tilts the camera up and over the ring**, looking down at it. It is clamped to ±80 degrees, because
> past that the ring is edge-on and every card is a line. Three presets carry a tilt for you —
> `carousel-3d` (a gentle 12 degrees), `carousel-3d-high` (30, a close raised camera), and
> `carousel-3d-low` (−18, looking up at it).
>
> **`radius:` defaults to the ring the content asks for.** Left unset, the library derives the
> circumradius of a regular polygon whose sides are as long as a card plus its `gap:` — the
> arrangement where neighbours just touch — from the measured width of the first slide. Set it
> (`radius:340px`) when you want a specific one. Nothing else needs solving by hand.
>
> **`arc:` is how much of a turn the slides spread over.** `360deg` is a full ring, which is the
> default for the outward-facing names; anything less is a slice.
>
> **`facing:` decides whether a slide keeps its own outward orientation (`radial`, the default) or
> stays square to the viewer (`camera`).** Billboarding lands on the slide's *child*, so
> `facing:camera` wants one element inside each slide to carry the content:
>
> ```html
> <div data-kui="carousel-3d tilt:26deg facing:camera">
>   <div><article class="card"> … </article></div>
>   <div><article class="card"> … </article></div>
> </div>
> ```
>
> **`carousel-3d-inside` is the concave one, and it is a separate name rather than a parameter.**
> It puts the camera at the centre of the ring instead of outside it, so the slides surround the
> viewer. It defaults to `arc:120deg` and `facing:camera`, because from inside a *full* ring two
> thirds of the deck is behind your head, and a slide at the edge of the slice is legible as a shape
> rather than as words. Slides that end up behind the viewer are hidden outright — `visibility`, not
> `opacity`, so they take no tab stop and swallow no clicks.

> **Grab it, press it, or drive it from your own controls.**
>
> The container is draggable by default (`grab:false` turns the gesture off; the keyboard stays).
> A drag moves the ring *between* two slides rather than a whole card at a time, throws with the
> momentum you let go with, and always settles facing a slide. `travel:` is how many pointer pixels
> move it one place — 220 by default. A drag that started on a link does not follow it.
>
> Arrow keys (both axes), Page Up/Down, Home and End all step the ring, and the container is given
> `tabindex="0"` unless you set one yourself. **Labelling is yours**: the library invents no ARIA
> role, for the same reason `step-progress` does not — a guessed `role` on markup it did not author
> announces something confidently wrong rather than nothing. Give the container an `aria-label`.
>
> `next:` / `prev:` / `jump:` take selectors and behave exactly as they do on `carousel` in section
> O, including the `scope:` rule — here they default to `scope:self`, so two rings on one page do
> not drive each other.
>
> ```html
> <div data-kui="carousel-3d next:.fwd prev:.back jump:.dot" aria-label="Case studies">
>   <figure> … </figure>
>   <figure> … </figure>
> </div>
> <button class="back" type="button">Previous</button>
> <button class="fwd" type="button">Next</button>
> ```

> **The one thing that will silently break it: a flattening ancestor.**
>
> `transform-style: preserve-3d` — which is what makes the ring three-dimensional at all — collapses
> to flat 2D if **any ancestor** has `overflow` other than `visible`, a `clip-path`, `opacity` below
> 1, a `filter`, or a `backdrop-filter`. A ring inside a modal, a drawer, or a clipped grid card
> therefore renders as a row of overlapping cards with no depth, and nothing errors. This is a
> browser rule, not a library one, and there is nothing this library can safely do about a property
> on an element it does not own — so it warns instead, naming the ancestor and the property.
>
> Two related gotchas, same cause. A 3D effect *nested inside* a slide (`card-flip-y` on a card in
> the ring) joins the ring's own 3D space rather than getting one of its own, which is rarely what
> you want. And `target:` may name elements that are not the container's direct children, but the
> grid cell that stacks the slides only reaches direct children — a deeper `target:` needs your page
> to stack them itself.
>
> Under `prefers-reduced-motion` the travel between slides is shortened by the policy layer and
> everything else keeps working: the arrows still step, the drag still follows, the right slide is
> still marked. Reduced motion is a request for less movement, never for less function.

> **† Not yet implemented.** `depth-layers-pointer` · `perspective-grid` are documented here but are not registered in `src/effects` — `data-kui` will not resolve them. Verified against the live registry.

---

## O. Forms & inputs — 13 names

Primitives 1, 10, 15.

`label-float` · `input-underline-grow` · `focus-ring-grow` · `validate-shake` ·
`validate-check` · `strength-meter` · `toggle-morph` · `checkbox-draw` · `radio-fill` ·
`range-fill` · `submit-to-spinner-to-check` · `step-progress` · `carousel`

> **`carousel`** is the same primitive as `step-progress` under the name you would actually type on
> a deck of slides — an index that wraps reads as a progress bar when its steps are segments and as
> a carousel when they are slides, and mostly only the stylesheet separates those.
>
> One thing does differ, because it has to: this name defaults to `scope:self`, so `target:` and
> the three controls resolve *inside* the deck rather than page-wide. Two carousels on one page
> would otherwise each bind both decks' arrows and mark both decks' slides, and clicking next in
> one would advance both. A deck whose controls genuinely live outside it can still say
> `scope:page`, which is what `step-progress` remains.
>
> Three optional controls turn it from a one-way stepper into something a reader can drive:
>
> ```html
> <div data-kui="carousel target:'.slide, .dot' next:.arrow-next prev:.arrow-prev jump:.dot">
>   <button class="arrow-prev" aria-label="Previous">←</button>
>   <div class="track">
>     <article class="slide">…</article>
>     …
>   </div>
>   <button class="arrow-next" aria-label="Next">→</button>
>   <nav><button class="dot"></button>…</nav>
> </div>
> ```
>
> - `next:` / `prev:` — elements whose click steps the index. Both **wrap**, so the deck is endless
>   in both directions: forward from the last slide lands on the first, back from the first lands
>   on the last.
> - `jump:` — elements that select a slide outright. Not "jump to the first" or "jump to the last":
>   it names a *set* of controls, and each one goes to **its own position** among them in document
>   order. The third dot selects the third slide. So dots written in the same order as the slides
>   need no numbering by hand, and adding a slide cannot desynchronise the pair.
>
> **`steps:` is optional here, and usually wrong to write.** The step count is not a choice; it is
> a fact about how many slides exist, and stating it twice means a sixth slide that silently never
> gets reached. Left off, the library counts the elements `target:` matched — per parent, taking
> the largest group, so a five-slide deck with five dots counts five and not ten — and re-counts on
> every step, so a slide added later is picked up without touching the attribute. Write `steps:`
> only to override that.
>
> All three are selectors resolved exactly like `target:`, including the quoting rule for one
> containing a space or comma. Naming any of them **replaces** the click-the-container behaviour
> rather than adding to it — a deck whose whole frame advances on click makes its own text
> unselectable, and the arrows are already the affordance.
>
> **`peek:`, `rest:` and `main:` — how crowded the deck is, from the attribute.** `peek:` is how
> far each place on the ring moves a slide (a percentage of the slide's own width, default `56%`),
> `rest:` is the scale of every slide that is not live (default `0.78`), and `main:` is the scale
> of the one that is (default `1`). They reach the stylesheet as `--kui-peek`, `--kui-rest` and
> `--kui-main`:
>
> ```html
> <div data-kui="carousel target:'.slide, .dot' next:.next prev:.prev jump:.dot peek:34% rest:0.9 main:0.82">
> ```
>
> ```css
> .slide { translate: calc(var(--kui-offset, 0) * var(--kui-peek, 56%)) 0; scale: var(--kui-rest, 0.78); }
> .slide[data-kui-step-state='active'] { scale: var(--kui-main, 1); }
> ```
>
> Lower `peek:` to crowd the deck, raise it to let the neighbours breathe. Per §7 the defaults are
> the `var()` fallbacks and are never written inline, so a deck naming none of them carries no
> inline style at all.
>
> **Reach for `main:` when `peek:` stops working.** The other two are measured *against* the live
> slide — one is a percentage of its width, the other a fraction of its scale — so when the live
> slide is as wide as the frame that clips it, no `peek:` can rescue the deck: the neighbours are
> already outside the clip, hidden *behind* the live slide rather than short of it. Shrinking the
> live one is the only move left, and on a phone, where a slide is most of the screen, it is the
> usual one.
>
> It is a scale and not a width on purpose. Every authored parameter lands on the element as an
> inline custom property, which a media query cannot override — and a width is exactly what a
> phone and a desktop need to disagree about. A multiplier means the same thing at both, so the
> page keeps owning the box (`width`, breakpoints and all) and the attribute owns the proportions
> inside it.
>
> Two rules for using it. **Keep it above `0`.** A negative scale is rejected, but `main:0` is
> accepted and paints nothing while the live slide stays visible to hit-testing and to the
> keyboard — the same invisible-but-clickable state the inactive slides use `visibility: hidden`
> to avoid. And **give your stylesheet the same number as the `var()` fallback.** The fallback is
> what paints before the library activates; if a deck transitions `scale`, a fallback that
> disagrees with the attribute makes the deck resize itself the moment it comes into view.
>
> Note what these are *not*: an `axis:` would only pick between two transforms the page already
> writes, which is why there is none. These are values the library publishes and `calc()`
> consumes — the same contract every other `cssProperty` parameter has.

> **`--kui-offset` — the one that makes it loop instead of rewind.** Every step element also
> carries its own signed place on the ring: `0` is live, `-1` is the slide behind it, `+1` the one
> ahead, and it *wraps* — at slide 1 of five, the last slide reads `-1`. Each slide places itself
> from that number, so there is no strip to run back across:
>
> ```css
> .slide { translate: calc(var(--kui-offset, 0) * 56%) 0; }
> ```
>
> Stepping off the end is then the same one-place move as any other step. Nothing is cloned and
> nothing is reordered. Drive the track off the container's `--kui-step` instead (below) and the
> wrap runs backwards across every slide in between, which reads as a jump to the beginning — the
> right choice for a filmstrip, the wrong one for a loop.
>
> **`--kui-step`.** Alongside `data-kui-step`, the element carries the live index as a *number*, so
> moving a strip is one rule instead of one per slide:
>
> ```css
> .track { transform: translateX(calc(var(--kui-step, 0) * -100%)); transition: transform 500ms; }
> ```
>
> Swap `translateX` for `translateY` and the same index drives a vertical deck. That is why there
> is no `axis:` parameter: the primitive owns the index, the page owns the direction, and a knob
> that only chose between two transforms would not be doing anything the stylesheet was not.
>
> **Boundary, unchanged.** This is an index, not a carousel *component* — no ARIA, no roving focus,
> no autoplay, no swipe. Section H states the same line for `accordion-height`, and a second name
> does not move it. Pair it with `swipe-x` from the gestures group for touch.

> **`step-progress`** is the click-driven half of the step pair — it advances its own index on
> click and wraps, where `scrollytelling-step` in section C takes its index from scroll position.
> Both publish `data-kui-step` and both mark their step elements with `data-kui-step-state`, so the
> shipped styling serves either one:
>
> ```html
> <div data-kui="step-progress steps:4">
>   <span></span><span></span><span></span><span></span>
> </div>
> ```
>
> `target:` defaults to this element's own children here, because a stepper's segments normally
> *are* its children. Name a selector when they are not — see section C for the full parameter,
> including how to quote a selector containing spaces or commas.
>
> The library paints steps up to and including the live one with `--accent` and the rest with
> `--dim`, which reads as a progress bar. For a position indicator — one lit segment — override
> `[data-kui-step-state='before']` back to the off state in your own CSS.

---

## P. Motion paths — 5 names

Primitive 32. All `css`.

`motion-path` · `path-arc` · `path-wave` · `path-loop` · `path-swoop`

> **What this closes.** `orbit` and `float` are fixed shapes — a full turn, a bob. These follow an
> arbitrary curve, which is the one thing the catalog previously could not express at all and the
> reason GSAP's MotionPathPlugin had no counterpart here. It is native CSS end to end: `offset-path`
> holds the curve and a keyframe animates `offset-distance` along it, so the motion composites off
> the main thread like every other entry in this table and costs no runtime JavaScript.
>
> **Bring your own curve.** Every name takes `path:`, as SVG path data. Quote it — it is full of
> spaces and commas, and the same rule applies as to a selector in `target:`:
>
> ```html
> <div data-kui="motion-path path:'M 0 0 C 60 -80 180 -80 240 0' 1400ms"></div>
> ```
>
> Coordinates are px, measured from the element's **own top-left corner**, so `M 0 0` is exactly
> where the element already sits and the rest of the path is a set of offsets from there. That
> holds in a flex row, a grid cell, or the middle of a paragraph — nothing has to know about the
> containing block. `path-swoop` is written the other way round for the same reason: it starts
> displaced and *ends* at `0 0`, so it flies in and lands precisely on its resting position.
>
> **Facing the direction of travel** is `rotate:auto` — GSAP calls it autoRotate — and is **off by
> default**, unlike the CSS property underneath. Tipping a card or a headline as it moves is almost
> never wanted; an arrow or a paper plane is the case that is, and it asks. `rotate:reverse` follows
> the tangent backwards, and any angle (`rotate:45deg`) pins a fixed rotation instead. Pair
> `rotate:auto` with `anchor:center`, because the anchor is also the pivot the rotation turns about
> and an arrow spinning on its corner looks broken.
>
> **Which point rides the path** is `anchor:`, defaulting to the element's top-left corner (that is
> what makes the coordinates read as offsets). `anchor:center`, `anchor:"top right"` and the other
> CSS position keywords are available; quote anything with a space in it.
>
> **A stretch of the path** rather than all of it: `from:` and `to:` are percentages of the curve's
> length, defaulting to `0%` and `100%`. `from:100% to:0%` runs the same curve backwards without
> rewriting the data by hand, and `from:20% to:80%` lets several elements each travel a different
> stretch of one shared route.
>
> **Scroll-driven** works too — `timeline:scroll` or `timeline:view` scrubs the travel against
> scroll position rather than a clock, which is the plane-crossing-the-page effect people otherwise
> build a ScrollTrigger rig for.
>
> **Where it is unsupported** (no `offset-path`), nothing breaks and nothing hides: the animation
> still runs and completes, and the element stays exactly where layout put it. The library warns in
> development so that stillness is not unexplained.

---

## Q. Discrete open/close — 6 names

Six primitives, `js` renderer, CSS-driven — the same shape as section I's hover family: a
near-no-op primitive that mirrors authored timing, the actual motion is a stylesheet transition
rather than a compiled `animation-*` track.

`fade-open` · `pop-open` · `scale-open` · `drop-open` · `slide-open-up` · `slide-open-down`

> **What this closes.** Every other entrance in this catalog needs the element already laid out and
> hidden-but-present for `on:enter`'s IntersectionObserver to ever measure it. An element that is
> actually `display: none`, a closed `<dialog>`, or a non-open `popover` never intersects, so it can
> never enter that way. `@starting-style` plus `transition-behavior: allow-discrete` animates the
> transition from the moment the browser first resolves the element's style — no observer involved —
> which is the only way to animate something genuinely entering or leaving the DOM.
>
> ```html
> <button popovertarget="menu">Menu</button>
> <div id="menu" popover data-kui="pop-open 240ms">…</div>
>
> <div class="panel" data-kui="drop-open" data-open>…</div>
> ```
>
> Works with a native `popover`, a native `<dialog>` (shown via `.showModal()`), or a plain element
> toggled by the author's own `[data-open]` attribute — the library reacts to whichever one the
> author is already using and owns none of them, the same "supplies the motion, not the component"
> boundary the navigation and layout modules state for themselves.
>
> **`on:` cannot defer these.** There is no `transition-play-state` to hold a `@starting-style`
> transition paused behind an activation, so every name here is `supportedActivations: ['manual']`.
> Writing `on:enter`/`on:click` warns by name instead of silently doing nothing; the transition
> still fires on its own the moment the element's open/closed state changes.
>
> **Unsupported browsers see the rest state, not a broken one.** No `@supports` guard exists or is
> needed: a browser that cannot parse `@starting-style` shows the element already open, with no
> entrance animation; one that cannot parse `transition-behavior` flips `display` instantly instead
> of easing it. Nothing is stranded, nothing is invisible, nothing sits in the wrong place.

---

## R. Static transforms — 1 name

Primitive 34. `js`, and the smallest JS-rendered primitive in the catalog: one property, written
once, on activation.

`rotate-static`

> **What this is not.** Section A's `rotate-in`/`rotate-out`/`roll-in`/`swing-in` are *entrances* —
> they animate from an authored angle down to `0deg` and the motion is the whole point.
> `rotate-static` never animates: it sets a fixed tilt and leaves it there, the way you would reach
> for `angle:180deg` on `rotate-in` if you wanted the element to *arrive* rotated but instead want
> it to simply *be* rotated, indefinitely, with nothing to watch. Reach for section A when you want
> motion into a resting angle; reach for this when the angle **is** the resting state.
>
> ```html
> <span data-kui="rotate-static angle:-4deg">on sale</span>
> ```
>
> `angle:` is the one parameter, and it is deliberately the same `type: 'angle'` grammar
> `rotate-in`'s own `angle:` uses — `45`, `45d`, `45deg`, and the `rad`/`grad`/`turn` units all mean
> what they mean there. **There is no default angle**: unlike `rotate-in`'s `-8deg` or `orbit`'s
> `360deg`, the bare name has no canonical look of its own to default to, so a `rotate-static` with
> no `angle:` writes nothing at all rather than picking an arbitrary one. That is a genuine no-op,
> which matters more than it sounds: writing a default `0deg` would flatten a rotation you had
> already set yourself in CSS, so the bare name would silently undo your own stylesheet. An
> explicit `angle:0deg` is a different instruction and is still honoured — that one really does
> mean "flatten this". An angle it cannot parse (`angle:banana`) warns and leaves the element
> alone, for the same reason.
>
> **Works on anything** — text, a number, an image, an icon, a whole card — because it makes no
> assumption about content at all. Where `background-media` is a full-bleed backdrop plus DOM
> surgery, this is the smallest version of the same "persistent state, not an animation" idea: one
> property write and nothing else. Composes with anything that does not also claim the `rotate`
> channel:
> `rotate-static angle:6deg, fade-up` tilts and fades in together, and `rotate-static angle:-8deg,
> split-chars` tilts the whole heading while its own characters animate independently.
>
> **No timing tokens**, refused by name the same way `background-media` refuses all three: there is
> no later moment for a `delay` to push a single synchronous write to, no span for a `duration` to
> stretch it across, and no curve for an `ease` to bend it along. `rotate-static angle:45deg 400ms`
> warns rather than silently discarding the `400ms`.
>
> Writes the CSS **individual** `rotate` property, never `transform` — the same convention every
> other rotation in this catalog follows (`entrance.css`, `ambient.css`'s `orbit`), and the reason a
> static tilt never collides with an unrelated `translate`/`scale` effect on the same element.

---

## S. Materials — 1 name

Primitive 37. `js`, and like section R it never animates: a *material* is what an element is made
of, not something it does.

`glass`

> **The whole family in one attribute.** Glassmorphism is four separate things stacked on one box —
> a blurred backdrop, a translucent tint, a light rim, a sheen — and only the first two are new.
> The other two already had names, so this section adds one effect and two sets of parameters
> rather than four effects:
>
> ```html
> <div data-kui="glass, beam-border softness:0.8 arc:140deg, shine-sweep angle:135deg width:0.4, press-depth">
>   Frosted panel with a travelling rim light, a sheen on hover, and a press response.
> </div>
> ```
>
> Four effects, four different physical surfaces — the host box, its `::before`, its `::after`, and
> its `:active` state — so the channels are disjoint and all four run. `glass` claims
> nothing but `background` and `backdrop`, deliberately: claiming `border` would have made the rim
> light impossible and claiming `shadow` would have refused the press.
>
> **Params:** `blur:` (backdrop blur radius, default `16px`), `saturate:` (default `1.6` — the blur
> averages the backdrop toward grey and this puts the colour back), `opacity:` (how opaque the tint
> is, `0.12` by default; `0.8` and `80%` are the same request), `tint:` (the glass colour — white on
> a dark page, near-black on a light one), `rim:` (hairline colour, which also colours the sheen),
> `rim-width:` (default `1px`), `sheen:` (strength of the top-weighted highlight, default `0.16`,
> `0` to remove it), `radius:` (default `16px`; `radius:999px` is the pill).
>
> **It imposes no markup.** `<div data-kui="glass">` works on any box — no wrapper, no
> pseudo-element, no structural CSS in your page. Every rule lands on the element itself, which is
> also what leaves `::before` and `::after` free for the two effects above.
>
> **What it costs, and where that bites.** `backdrop-filter` is not compositor-cheap. The browser
> snapshots everything painted behind the element, blurs it, and composites the result — extra
> render passes whose cost scales with the panel's **area**, and which are paid again whenever
> anything *behind* the panel changes, even though the panel itself is static. A fixed glass header
> over a scrolling page re-blurs every frame. Two overlapping glass surfaces multiply it, because
> each one's backdrop contains the other. Keep the blurred area small, do not stack glass on glass,
> and remember `blur:0px` turns the pass off entirely while leaving the tint, rim and sheen — a
> legible non-glass surface you can fall back to behind your own media query.
>
> **Where it degrades.** A browser with no `backdrop-filter` shows the tint and the rim with no
> blur: a flat translucent panel, which is a resting state rather than a broken one, so there is no
> `@supports` guard. Under Windows High Contrast (`forced-colors: active`) the blur and the sheen
> are dropped outright — `backdrop-filter` is not a colour property, so the UA would not have
> overridden it, and a blur is exactly wrong in a mode that exists for legibility.
>
> **It needs something behind it to blur.** The effect is invisible on an element sitting on a flat
> page background, and clipped if an ancestor carries its own `filter` or `backdrop-filter`. That is
> the property's own rule, not this library's.
>
> **`glass-refract`** — warping the content behind at the panel's edges — is not planned and is not
> a gap. It needs an SVG `feDisplacementMap` over live DOM, which no engine composites predictably,
> or a WebGL renderer, which is out of scope for this library (see the note at the top).

---

## Totals

| Section | Names |
|---|---|
| A Entrance/exit | 48 |
| B Scroll reveal & parallax | 12 (+1 planned) |
| C Scroll mechanics | 12 |
| D Text & typography | 27 |
| E SVG & icons | 17 |
| F Numbers & data viz | 13 |
| G Media & images | 22 |
| H Layout & FLIP | 9 |
| I Hover & pointer | 35 |
| J Ambient backgrounds | 15 |
| K Feedback & status | 17 |
| L Page transitions | 7 |
| M Navigation | 8 |
| N 3D & perspective | 10 (+2 planned) |
| O Forms & inputs | 13 |
| P Motion paths | 5 |
| Q Discrete open/close | 6 |
| R Static transforms | 1 |
| S Materials | 1 |
| Generic tween | 2 |
| **Total shipped** | **292** |
| Documented but not yet shipped | 3 |

Renderer split: **~175 `css`** · ~12 `prep` · ~69 `js`.
That ratio is the whole architecture — roughly 70% of the catalog is keyframes plus a
metadata row, and ships with zero runtime JS on browsers with native timelines.

---

## Gestures & physics

Thirteen names over four primitives (`draggable`, `swipeable`, `pressable`, `magnetic`), sitting
outside the lettered A–P sections above. `js`.

`drag` · `drag-x` · `drag-y` · `drag-inertia` · `throwable` · `elastic-pull` · `rubber-band` ·
`snap-back` · `swipe` · `swipe-x` · `long-press` · `magnetic` · `magnetic-snap`

> The drag family differs only in what happens on release: nothing (`drag`), back to origin
> (`elastic-pull`, `rubber-band`, `snap-back` — spring stiffness varies), or onward with
> momentum (`drag-inertia`, `throwable`). One primitive, several parameter presets.

---

## Generic tween

Two names over one primitive family, sitting outside the lettered A–P sections above. `css`.

`tween` · `tween-from`

> Everything else in this document is a name with a fixed meaning. This is the escape hatch: you
> name the properties instead of the effect, and the compiler builds the keyframes. `tween`
> animates **to** the values you give, from wherever the element already is; `tween-from` animates
> **from** them to the element's natural state. Direction is in the name because the grammar's
> first token is the effect name and every later bare token is a duration, a delay or an easing —
> there is no slot for a bare `from`.
>
>     <div data-kui="tween x:100 opacity:0 rotate:45deg 800ms">
>     <div data-kui="tween-from y:40 opacity:0 600ms on:enter">
>
> **Properties.** `x` `y` `z` (translate) · `rotate` · `scale` `scale-x` `scale-y` · `opacity` ·
> `blur` `brightness` `saturate` `grayscale` `contrast` `hue-rotate` `invert` `sepia` (filter) · `color` · `background-color`. Anything
> else is reported by name rather than ignored. A bare number takes the unit the property implies
> — `x:100` is `100px`, `rotate:45` is `45deg` — and a value containing spaces or a comma must be
> quoted, e.g. `x:"calc(100% - 20px)"`. Scientific notation and a leading plus work too:
> `x:1e3` means 1000px and `rotate:+45` means 45deg. Number-valued properties accept percentages:
> `scale:50%`, `opacity:50%`, and `contrast:150%` mean 0.5, 0.5, and 1.5 respectively.
> `z` and `blur` require lengths without percentages; blur and numeric filter amounts cannot be
> negative. CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) warn and
> are dropped, because on a custom property they would affect that variable rather than the
> animated property. `width`, `height`, and `clip-path` are outside this vocabulary.
>
> **Channels are read off your attribute**, not fixed in advance: `tween x:100` owns `translate`
> and so cannot be composed with `fade-up`, while `tween opacity:0` owns `opacity` and can be
> composed with anything that does not. That is why this is one family and not one effect.
>
> **A property is written whole.** `translate` is a single CSS property, so an axis you do not name
> resolves to its initial value rather than to whatever the element currently has: on an element
> already carrying `translate: 0 50px`, `tween x:100` returns y to 0 as well. Same for `scale` and
> for the eight `filter` functions. Name every axis you need to keep.
>
> **Several states, not just two: give a property a list.**
>
>     <div data-kui="tween x:'0,100,40' y:'0,-60,0' 1200ms">
>
> Two to five comma-separated values, quoted because a bare comma separates effects. The values are
> spread evenly across the duration and the property is smoothed through all of them — the shape
> every other library spells as a keyframe array (`animate(el, { x: [0, 100, 40] })`), and the one
> thing the catalog had no primitive for at all.
>
> It is still one static `@keyframes` block and one CSS animation per group; the list picks
> which block. Even spacing is not a simplification but the mechanism: a keyframe's percentage is
> the one part of a block that cannot be a `var()`. Repeat a value to hold it for a step.
>
> A list writes its own first state, so `tween` and `tween-from` do the same thing with one — and
> the element paints its rest state until the library installs, so add `data-kui-cloak` if that
> first frame is a long way from where the element sits.
>
> **Within a group, one list sets the rhythm and plain values ride along.** `tween x:'0,100,40'
> y:20` holds `y` at 20px across all three steps. Two lists of different lengths in the same group
> is a warning, and the shorter one holds at its last value. An axis-specific scale always wins
> over uniform `scale`, including when one is a list and the other is a scalar.
>
> Empty entries (`x:'0,,100'`, including leading/trailing commas) warn at their waypoint index and
> retain their place in the rhythm, using the plain property's fallback value. A list longer than
> five entries is truncated with a warning naming its new endpoint. Commas inside CSS functions
> are preserved: `color:'rgb(0,0,0),rgb(255,255,255)'` has two waypoints.
>
> **Easing per group.** Add `translate-ease`, `rotate-ease`, `scale-ease`, `opacity-ease`,
> `filter-ease`, `color-ease`, or `background-ease` to give that group's segments their own curve:
>
>     <div data-kui="tween x:'0,100,40' opacity:'0,1,1' translate-ease:back-out opacity-ease:linear 1200ms">
>
> CSS curves, named kUInetic curves and `spring(...)` use the same validation as ordinary easing.
> A group without an override uses the effect's positional easing, then its named/theme easing,
> then `ease-out`. `x` and `y` share one `translate` property and therefore one curve; the same
> applies to scale axes and filter functions. The override works for both directions and for
> each segment of a waypoint list, without JavaScript interpolation.
>
> Arbitrary per-waypoint offsets are not supported: this compiler selects shipped blocks and has
> no custom-keyframe emission hook, while CSS selectors require literal percentages. Offsets
> would need a compiler extension; they cannot be supplied through the existing CSS variables.
>
> **A zero-scale start warns about viewport activation.** `tween-from scale:0`, a list starting
> at zero (`tween scale:'0,1'`), or a zero scalar axis held beside a scale waypoint list all
> collapse the starting box. That can prevent `on:enter` from activating depending on geometry;
> it is not guaranteed, since observers can report zero-area intersections. Use a small non-zero
> scale, or `on:load`. The check follows axis overrides and recognizes percentages and signed
> zero. It cannot evaluate stylesheet values or `calc()` expressions at compile time.
