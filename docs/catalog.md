# Effect Catalog

This catalog lists every named effect the library ships, grouped into fifteen sections (A–O).
See the [architecture document](?doc=design) for the attribute grammar, composition model, and
design rationale behind this list.

**Counts:** **251** named effects, over **29 primitive families**. Note that 48 names come from a
single family (the entrance/exit matrix), so name count is not work count. The families below are
the architectural grouping, not registry ids — the registry holds more entries than that, because a
family like `reveal` registers a few sibling primitives so that channel-conflict detection can tell
`fade-up` apart from `zoom-in-up`.

**Out of scope:** WebGL/particle rendering — canvas-based effects are supported only through an
adapter that drives a user-supplied canvas, never as a built-in renderer.

Gestures and physics (drag, swipe, long-press, magnetic pull) are a separate thirteen-name group,
outside the lettered A–O sections below — see [Gestures & physics](#gestures-physics) at the end
of this document.

## Legend

- **Renderer** — `css` (keyframes only) · `waapi` · `js` (per-frame) · `prep` (JS DOM surgery, then CSS)
- **Channels** — properties the effect owns, for composition-conflict detection:
  `o` opacity · `t` translate · `s` scale · `r` rotate · `f` filter · `c` clip/mask · `x` other
- Effects with **disjoint** channels compose in one comma list; collisions warn.

---

## The 29 primitive families

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

---

## C. Scroll mechanics — 12 names

Primitives 27, 29. `js`. This is the JS-heaviest group in the catalog.

`pin-section` · `pin-until` · `pin-spacer` · `scroll-progress` · `scrollytelling-step` ·
`stacking-cards` · `horizontal-scroll` · `sequence-scrub` · `video-scrub` · `scroll-snap-x` ·
`scroll-snap-y` · `scroll-spy`

> `scroll-snap-*` are thin CSS passthroughs. Everything else needs the orchestrator:
> measurement, resize invalidation, nested scroll containers, cleanup.

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
> for this section with `data-kui-active`) and on `step-progress` in section O. A selector that
> matches `<html>` or `<body>` is rejected with a warning rather than stamping the whole document,
> and so is one that does not parse.

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

## G. Media & images — 17 names

Primitives 5, 6, 7, 4.

`wipe-up` · `wipe-down` · `wipe-left` · `wipe-right` · `wipe-circle` · `wipe-diagonal` ·
`mask-reveal` · `curtain-reveal` · `ken-burns` · `ken-burns-out` · `blur-up` ·
`duotone-hover` · `grayscale-hover` · `saturate-hover` · `image-parallax-frame` ·
`before-after-wipe` · `lightbox-open`

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

`gradient-mesh` · `aurora` · `gradient-rotate-border` · `noise-overlay` · `scanline` ·
`dot-grid-drift` · `line-grid-drift` · `floating-shapes` · `float` · `bob` · `orbit` · `starfield` ·
`glow-pulse` · `spotlight-follow` · `wave-blob`

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

## N. 3D & perspective — 31 shipped, 2 planned

Primitives 14, 22.

`card-flip-x` · `card-flip-y` · `flip-card` · `cube-rotate` · `book-page-turn` ·
`fold-panel` · `depth-layers-pointer`† · `perspective-grid`†

> **`card-flip-y` and `flip-card` are not the same thing**, and the similar names are worth
> reading twice. `card-flip-y` is an *entrance*: one keyframe, half a turn, played once, nothing on
> the other side. `flip-card` is a component with a front, a back, and a state in between — which a
> keyframe cannot express, because a one-shot animation has no way to come back.
>
> `flip-card` is a CSS transition keyed off `aria-pressed` on the control inside the card, read with
> `:has()`. The accessibility state *is* the visual state, so the two cannot drift apart. Toggling
> that attribute is yours to do — one line — the same as the icon toggles in section E.
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

## Totals

| Section | Names |
|---|---|
| A Entrance/exit | 48 |
| B Scroll reveal & parallax | 12 (+1 planned) |
| C Scroll mechanics | 12 |
| D Text & typography | 26 |
| E SVG & icons | 17 |
| F Numbers & data viz | 13 |
| G Media & images | 17 |
| H Layout & FLIP | 9 |
| I Hover & pointer | 22 |
| J Ambient backgrounds | 15 |
| K Feedback & status | 17 |
| L Page transitions | 5 (+1 planned) |
| M Navigation | 8 |
| N 3D & perspective | 31 (+2 planned) |
| O Forms & inputs | 12 |
| **Total shipped** | **251** |
| Documented but not yet shipped | 4 |

Renderer split: **~168 `css`** · ~11 `prep` · ~58 `js`.
That ratio is the whole architecture — roughly 70% of the catalog is keyframes plus a
metadata row, and ships with zero runtime JS on browsers with native timelines.

---

## Gestures & physics

Thirteen names over four primitives (`draggable`, `swipeable`, `pressable`, `magnetic`), sitting
outside the lettered A–O sections above. `js`.

`drag` · `drag-x` · `drag-y` · `drag-inertia` · `throwable` · `elastic-pull` · `rubber-band` ·
`snap-back` · `swipe` · `swipe-x` · `long-press` · `magnetic` · `magnetic-snap`

> The drag family differs only in what happens on release: nothing (`drag`), back to origin
> (`elastic-pull`, `rubber-band`, `snap-back` — spring stiffness varies), or onward with
> momentum (`drag-inertia`, `throwable`). One primitive, several parameter presets.
