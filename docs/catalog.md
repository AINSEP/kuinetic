# Effect Catalog

This catalog lists every named effect the library ships, grouped into sixteen sections (A–P).
See the [architecture document](?doc=design) for the attribute grammar, composition model, and
design rationale behind this list.

**Counts:** **261** named effects, over **33 primitive families**. Note that 48 names come from a
single family (the entrance/exit matrix), so name count is not work count. The families below are
the architectural grouping, not registry ids — the registry holds more entries than that, because a
family like `reveal` registers a few sibling primitives so that channel-conflict detection can tell
`fade-up` apart from `zoom-in-up`.

**Out of scope:** WebGL/particle rendering — canvas-based effects are supported only through an
adapter that drives a user-supplied canvas, never as a built-in renderer.

Gestures and physics (drag, swipe, long-press, magnetic pull) are a separate thirteen-name group,
outside the lettered A–P sections below — see [Gestures & physics](#gestures-physics) at the end
of this document. The [generic tween](#generic-tween) sits outside them too, and is the one entry
here that is not a named effect at all: it is how you animate something the catalog does not name.

## Legend

- **Renderer** — `css` (keyframes only) · `waapi` · `js` (per-frame) · `prep` (JS DOM surgery, then CSS)
- **Channels** — properties the effect owns, for composition-conflict detection:
  `o` opacity · `t` translate · `s` scale · `r` rotate · `f` filter · `c` clip/mask · `x` other
- Effects with **disjoint** channels compose in one comma list; collisions warn.

---

## The 33 primitive families

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
| 31 | `background-media` | prep | — | full-bleed image/video backdrop behind an element's own children (`bg`, `background`) |
| 32 | `tween` | css | per attribute | generic property tween — `tween`, `tween-from` |
| 33 | `motion-path` | css | x | travel along an arbitrary curve (`offset-path`) |

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

## D. Text & typography — 26 names

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
| variable font | `var-weight` `var-width` `var-slant` |
| structural | `word-cycler` `marquee` `marquee-scroll-linked` `redaction-reveal` `text-3d-extrude` |

> All splitting uses `Intl.Segmenter` (grapheme clusters, not code units), preserves one
> accessible reading representation, and restores selectable text on cleanup.

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

## G. Media & images — 20 names

Primitives 5, 6, 7, 4, 30, 31.

`wipe-up` · `wipe-down` · `wipe-left` · `wipe-right` · `wipe-circle` · `wipe-diagonal` ·
`mask-reveal` · `curtain-reveal` · `ken-burns` · `ken-burns-out` · `blur-up` ·
`duotone-hover` · `grayscale-hover` · `saturate-hover` · `image-parallax-frame` ·
`before-after-wipe` · `lightbox-open` · `slat-assemble` · `bg` · `background`

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

## I. Hover & pointer — 22 names

Primitives 21, 22, plus CSS.

| Group | Names |
|---|---|
| button | `lift` `lift-shadow` `pop` `magnetic` `shine-sweep` `split-flap` |
| border | `border-draw` `border-glow` `beam-border` `beam-border-auto` |
| link | `underline-slide` `underline-center` |
| icon | `icon-wiggle` `icon-spin` `icon-bounce` |
| card | `tilt-3d` `tilt-parallax` |
| cursor | `cursor-follow` `cursor-lag` `cursor-label` `cursor-spotlight` `cursor-invert` |

> Every hover effect ships a `:focus-visible` equivalent and a coarse-pointer fallback.

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

## L. Page transitions — 5 shipped, 1 planned

Primitives 1, 5, plus the View Transitions API.

`page-fade` · `page-slide` · `curtain-wipe` · `page-morph`† · `loading-bar` · `smooth-scroll-to`

> `page-morph`† is a View Transitions shared-element handoff; it degrades to `page-fade`
> where unsupported.

> **† Not yet implemented.** `page-morph` is documented here but is not registered in `src/effects` — `data-kui` will not resolve it. Verified against the live registry.

---

## M. Navigation — 8 names

`menu-stagger-open` · `menu-fullscreen` · `header-shrink` · `header-hide-on-scroll` ·
`dropdown-open` · `drawer-slide` · `mega-menu-drop` · `back-to-top-fade`

> Same boundary as section H — animation only, no menu state machine or focus trapping.

---

## N. 3D & perspective — 6 shipped, 2 planned

Primitives 14, 22.

`card-flip-x` · `card-flip-y` · `flip-card` · `cube-rotate` · `book-page-turn` ·
`fold-panel` · `depth-layers-pointer`† · `perspective-grid`†

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

> **† Not yet implemented.** `depth-layers-pointer` · `perspective-grid` are documented here but are not registered in `src/effects` — `data-kui` will not resolve them. Verified against the live registry.

---

## O. Forms & inputs — 12 names

Primitives 1, 10, 15.

`label-float` · `input-underline-grow` · `focus-ring-grow` · `validate-shake` ·
`validate-check` · `strength-meter` · `toggle-morph` · `checkbox-draw` · `radio-fill` ·
`range-fill` · `submit-to-spinner-to-check` · `step-progress`

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

## Totals

| Section | Names |
|---|---|
| A Entrance/exit | 48 |
| B Scroll reveal & parallax | 12 (+1 planned) |
| C Scroll mechanics | 12 |
| D Text & typography | 26 |
| E SVG & icons | 17 |
| F Numbers & data viz | 13 |
| G Media & images | 20 |
| H Layout & FLIP | 9 |
| I Hover & pointer | 22 |
| J Ambient backgrounds | 15 |
| K Feedback & status | 17 |
| L Page transitions | 5 (+1 planned) |
| M Navigation | 8 |
| N 3D & perspective | 6 (+2 planned) |
| O Forms & inputs | 12 |
| P Motion paths | 5 |
| Generic tween | 2 |
| **Total shipped** | **261** |
| Documented but not yet shipped | 4 |

Renderer split: **~175 `css`** · ~12 `prep` · ~58 `js`.
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
> `blur` `brightness` `saturate` `grayscale` (filter) · `color` · `background-color`. Anything
> else is reported by name rather than ignored. A bare number takes the unit the property implies
> — `x:100` is `100px`, `rotate:45` is `45deg` — and a value containing spaces or a comma must be
> quoted, e.g. `x:"calc(100% - 20px)"`.
>
> **Channels are read off your attribute**, not fixed in advance: `tween x:100` owns `translate`
> and so cannot be composed with `fade-up`, while `tween opacity:0` owns `opacity` and can be
> composed with anything that does not. That is why this is one family and not one effect.
>
> **A property is written whole.** `translate` is a single CSS property, so an axis you do not name
> resolves to its initial value rather than to whatever the element currently has: on an element
> already carrying `translate: 0 50px`, `tween x:100` returns y to 0 as well. Same for `scale` and
> for the four `filter` functions. Name every axis you need to keep.
>
> **`tween-from scale:0` is a trap and warns.** An element scaled to nothing has no box, an
> `IntersectionObserver` measures geometry, and the default `on:enter` therefore never fires — so
> it would stay invisible forever. Use a small non-zero scale, or `on:load`.
