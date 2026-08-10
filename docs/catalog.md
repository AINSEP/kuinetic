# First-Pass Capability Catalog (v1 + v2 merged)

Companion to `anim-design-v2.md`. This is the **shipping scope of the first release**:
the v1 and v2 tiers combined. Codename `kin` (placeholder namespace).

**Counts:** ~237 named effects from **29 primitives**. Note that 48 names come from a single
primitive (the entrance/exit matrix), so name count is not work count.

**Not in this pass:** gestures & physics (drag, swipe, inertia, elastic, rubber-band, throwable),
WebGL/particle rendering (adapter only, never a renderer).

## Legend

- **Renderer** — `css` (keyframes only) · `waapi` · `js` (per-frame) · `prep` (JS DOM surgery, then CSS)
- **Channels** — properties the effect owns, for composition-conflict detection:
  `o` opacity · `t` translate · `s` scale · `r` rotate · `f` filter · `c` clip/mask · `x` other
- Effects with **disjoint** channels compose in one comma list; collisions warn.

---

## The 29 primitives

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

## B. Scroll reveal & parallax — 12 names

Primitives 1, 25, 26. `css` with native timelines; observer fallback for `on:enter`.

`reveal-once` · `reveal-repeat` · `parallax-y` · `parallax-x` · `parallax-scale` ·
`parallax-rotate` · `depth-layer` · `scroll-progress-bar` · `scroll-progress-ring` ·
`scroll-fade` · `scroll-skew` · `reveal-direction-aware`

> `parallax-*` and `scroll-*` use `data-kin-timeline`, not `data-kin-on` — they are
> progress-linked and reverse on scroll-up by design.

---

## C. Scroll mechanics — 11 names *(the expensive tier)*

Primitives 27, 29. `js`. This group is ~40% of total engineering effort.

`pin-section` · `pin-until` · `pin-spacer` · `scrollytelling-step` · `stacking-cards` ·
`horizontal-scroll` · `sequence-scrub` · `video-scrub` · `scroll-snap-x` · `scroll-snap-y` ·
`scroll-spy`

> `scroll-snap-*` are thin CSS passthroughs. Everything else needs the orchestrator:
> measurement, resize invalidation, nested scroll containers, cleanup.

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

Primitives 15, 16.

`draw-stroke` · `draw-signature` · `draw-underline` · `checkmark-draw` · `cross-draw` ·
`hamburger-to-x` · `play-to-pause` · `plus-to-minus` · `heart-fill` · `bookmark-fill` ·
`icon-morph` · `blob-morph` · `logo-build` · `chart-line-draw` · `chart-bar-grow` ·
`chart-area-fill` · `gradient-stroke`

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

## H. Layout & FLIP — 9 names *(v2 tier)*

Primitive 28. `js`. One technique unlocks the whole group.

`flip-reorder` · `flip-filter` · `flip-sort` · `flip-shuffle` · `accordion-height` ·
`expand-to-modal` · `grid-to-list` · `tab-indicator-slide` · `masonry-reflow`

> **Boundary:** these animate elements *you* control. `accordion-height` animates height;
> it does not own `aria-expanded`, focus, or keyboard handling. Accessible accordion/carousel/
> menu **components** are deliberately out of scope.

---

## I. Hover & pointer — 20 names

Primitives 21, 22, plus CSS.

| Group | Names |
|---|---|
| button | `lift` `lift-shadow` `magnetic` `shine-sweep` `split-flap` |
| border | `border-draw` `border-glow` `beam-border` |
| link | `underline-slide` `underline-center` |
| icon | `icon-wiggle` `icon-spin` `icon-bounce` |
| card | `tilt-3d` `tilt-parallax` |
| cursor | `cursor-follow` `cursor-lag` `cursor-label` `cursor-spotlight` `cursor-invert` |

> Every hover effect ships a `:focus-visible` equivalent and a coarse-pointer fallback.

---

## J. Ambient backgrounds — 14 names

Primitives 8, 9, 11, 12. Almost entirely `css`.

`gradient-mesh` · `aurora` · `gradient-rotate-border` · `noise-overlay` · `scanline` ·
`dot-grid-drift` · `line-grid-drift` · `floating-shapes` · `float` · `bob` · `starfield` ·
`glow-pulse` · `spotlight-follow` · `wave-blob`

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

## L. Page transitions — 6 names

Primitives 1, 5, plus the View Transitions API.

`page-fade` · `page-slide` · `curtain-wipe` · `page-morph` · `loading-bar` · `smooth-scroll-to`

> `page-morph` is a View Transitions shared-element handoff; it degrades to `page-fade`
> where unsupported.

---

## M. Navigation — 8 names

`menu-stagger-open` · `menu-fullscreen` · `header-shrink` · `header-hide-on-scroll` ·
`dropdown-open` · `drawer-slide` · `mega-menu-drop` · `back-to-top-fade`

> Same boundary as section H — animation only, no menu state machine or focus trapping.

---

## N. 3D & perspective — 7 names

Primitives 14, 22.

`card-flip-x` · `card-flip-y` · `cube-rotate` · `book-page-turn` · `fold-panel` ·
`depth-layers-pointer` · `perspective-grid`

---

## O. Forms & inputs — 12 names

Primitives 1, 10, 15.

`label-float` · `input-underline-grow` · `focus-ring-grow` · `validate-shake` ·
`validate-check` · `strength-meter` · `toggle-morph` · `checkbox-draw` · `radio-fill` ·
`range-fill` · `submit-to-spinner-to-check` · `step-progress`

---

## Totals

| Section | Names |
|---|---|
| A Entrance/exit | 48 |
| B Scroll reveal & parallax | 12 |
| C Scroll mechanics | 11 |
| D Text & typography | 26 |
| E SVG & icons | 17 |
| F Numbers & data viz | 13 |
| G Media & images | 17 |
| H Layout & FLIP | 9 |
| I Hover & pointer | 20 |
| J Ambient backgrounds | 14 |
| K Feedback & status | 17 |
| L Page transitions | 6 |
| M Navigation | 8 |
| N 3D & perspective | 7 |
| O Forms & inputs | 12 |
| **Total** | **237** |

Renderer split: **~168 `css`** · ~11 `prep` · ~58 `js`.
That ratio is the whole architecture — roughly 70% of the catalog is keyframes plus a
metadata row, and ships with zero runtime JS on browsers with native timelines.

## Coverage of the original 33-item wishlist

**33 of 33.** Merging v2 into the first pass pulls in `pin-section` and `horizontal-scroll`,
which were the two deferred items. WebGL/canvas backgrounds are covered only as an adapter
driving a user-supplied canvas — the library does not render particles itself.

## Build-order recommendation

Ship in this order regardless of merged scope, because later groups depend on the lifecycle
model the earlier ones prove:

1. Core + parameter schema + parser + channel conflict detection
2. A, B, J, G (pure CSS bulk — ~91 names, proves the compiler)
3. K, O, I (event activation + first JS primitives)
4. D, E, F (DOM-transforming primitives — proves cleanup/restore)
5. L, M, N
6. **H, C** (FLIP + scroll orchestrator — build last, they stress everything above)
