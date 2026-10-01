# Changelog

All notable changes to kUInetic are documented here. Dates are when a change landed on `main`;
version numbers are assigned at release.

## [Unreleased]

### Fixed

- **Carousels no longer flash flat on load.** `carousel-3d`, `-high`, `-low`, `-inside`,
  `carousel-orbit` and `carousel-stack` are now `cloak: true`: under `<html data-kui-cloak>` they stay
  hidden until the ring is placed, instead of showing their cards in normal flow for a frame first.
  Without the script, the CSS-only two-second release still shows them.
- **Lightbox arrows.** Drawn chevrons centred in the button and on the viewport's middle (the
  `‹`/`›` glyphs sat on their baseline, and the buttons sat half a button low), in yellow on black.
  Restyle with `--kui-lightbox-arrow-fg` / `--kui-lightbox-arrow-bg`.

## [0.2.3] — 2026-09-30

### Added

- **Tooltip styling on `hover-intent` and `anchored-preview`.** `color:`, `bg-color:` and `radius:`
  style the hint/preview from the attribute, and `place:top|bottom|auto` picks its side — `auto`
  starts on the preferred side and flips to the opposite one when it does not fit the viewport,
  re-checking on scroll/resize only while shown. `anchored-preview`'s `place:` also takes
  `left|right` (each `-bottom`/`-left`/`-right` preset is that value), and `auto` flips along the
  preset's own axis. `hover-intent`'s hint now ships a dark card by default (`#111111`, `#f4f4f0`,
  `12px`, padding, `max-content` width up to `min(16rem, 70vw)`); a page's own unlayered CSS still
  wins. `anchored-preview`'s defaults change nothing.
- **`tease:` on `hover-intent` and `anchored-preview*`.** `tease:2s` opens the hint/preview once,
  unasked, for two seconds the first time its trigger is half in view, then closes it — so a demo
  or onboarding hint is seen without a hover. Real hover or focus takes over mid-tease (nothing
  closes under the pointer); `place:auto` measures before it opens; under reduced motion it still
  shows, without moving. No `IntersectionObserver`, no tease. Off by default.
- **`target:` names the part on `hover-intent` and `anchored-preview*`.**
  `data-kui="anchored-preview-bottom target:.preview-img"` works with no `data-kui-preview` in the
  markup (and `hover-intent target:.tip` with no `data-kui-hint`): the effect stays on the trigger
  and the library stamps the marker on the first match inside it, then removes only what it
  stamped on teardown. Markup that already writes the marker works unchanged. Zero matches or
  several warn (only the first is used). `scope:` is not accepted — the part must sit inside the
  trigger to be positioned against it.
- **`autoplay:` on `compare`.** The before/after divider can sweep by itself: `autoplay:always`
  starts at load, `autoplay:in-view` the first time the slider is on screen (default `never`).
  One run goes out to the far edge, across to the near one and home to `position:`; `loop:true`
  keeps going, `reverse:true` heads toward 0% first, `duration:` (or positional, `compare 4s`) is
  one edge-to-edge sweep (default `3s`, floor `250ms`). The moment someone presses or focuses the
  slider the sweep stops for good. Pauses off screen, never starts under reduced motion.
- **`compare` takes three or more media.** `[black | white | blue | pink]` in one frame, split by
  N−1 dividers; dragging one wipes between its two neighbours and stops at them (dividers never
  cross; two may meet, closing a strip). Each divider is its own range ("Divider 2 of 3: White /
  Blue"), tab-ordered across the frame, whose min/max are its neighbours, so arrows/Home/End clamp
  too. Even split by default; `positions:'20% 45% 80%'` (quoted, space-separated) sets them.
  `autoplay:` sweeps the dividers one at a time. Two media are unchanged.
- **Tooltips and previews stay inside the viewport.** `hover-intent`'s hint and every
  `anchored-preview*` part now slide along their cross axis (sideways for top/bottom, up/down for
  left/right) so they clear the viewport edge by 8px, instead of being clipped — a preview on a word
  near the right edge of a phone used to lose part of its picture. Measured when the part is about
  to show (hover, focus, `tease:`), re-measured on scroll/resize only while it is shown. A part
  wider than the viewport aligns to its start edge. Works with every `place:`, fixed or `auto`. On
  by default; no switch.
- **`describe()` — every parameter an effect accepts, generated from the registry.**
  `kuinetic.describe('hover-intent')` returns the effect's primitive, and per parameter its type,
  effective default (a preset's own override applied, flagged `presetDefault`), example spellings
  the validator accepts (`12 | 12d | 12deg` for an angle, `0.8 | 80%` for an alpha), keyword list,
  bounds, and which bare token sets it (`hover-intent 160ms 350ms`: 1st time → duration, 2nd →
  delay, an easing by its shape). `describeSteps('fade-up 600ms, lift')` does the same for each
  step of a whole `data-kui` value, using the runtime's own parser, and names a likely typo for an
  unknown step. Nothing is hand-listed, so it cannot drift from the catalog.
- **`describe()` reads markup back, covers the reserved keys, and says which bare timings count.**
  Each step from `describeSteps()` now carries `written` — the arguments that step sets, bare
  values mapped to their name (`hover-intent 160ms 350ms` → `duration: 160ms, delay: 350ms`) — and
  `writtenKeys` for `at:`, `repeat:`, breakpoint gates and the like. `describeElement()` adds every
  reserved key (`on:`, `timeline:`, `cascade:`, `rm:`, `at:` …), each marked element- or
  step-scoped as the parser treats it, with plain-words notes in `kuinetic/notes`. Each bare slot
  also says whether the effect acts on it (`honoured`), read from the same timing contract that
  makes the runtime warn `"pin" cannot honour delay`, so the two cannot disagree.
- **Plain-words parameter notes, as a separate entry.** `kuinetic/notes` (and
  `kuinetic.notes.js`, global `kuineticNotes`) holds a one-sentence "why would I set this" note
  for every parameter in the catalog, plus what happens when it is left out where the default
  doesn't say. Pass `{ notes: kuineticNotes.PARAM_NOTES }` to `describe()`. Kept out of the core
  bundle on purpose: ~10 KB brotli of prose only documentation pages need. A test fails if any
  registered parameter has no note, or a note names a parameter that no longer exists. Third-party
  primitives can carry a note inline on `ParamSpec.note`.
- **Demo: "Show code" has Code | Args tabs.** Args lists every parameter of every effect in the
  printed markup (nested `data-kui` and every comma step): type, default or "required", accepted
  spellings and word lists, the bare-value order, what the markup sets, the element- and step-level
  keys, which bare slots the effect ignores, and a plain-words note. All of it comes from
  `kuinetic.describeElement()`; the notes file loads only when Args first opens.
- **Decks hold still while their viewer is open.** A deck that moves on its own — `carousel
  autoplay:`, or `spin:` on `carousel-3d`/`carousel-orbit`/`carousel-stack` — holds still while its
  lightbox is open (`lightbox:true`, or a `lightbox` effect on the same deck) and carries on from the
  same card when it closes, with a fresh full period. A deck the visitor paused stays paused. The
  shared viewer announces this as a bubbling `kui:viewer` event (`detail.open`) from the element that
  opened it.
- **`spin:` and `autoplay:` on the spatial carousels.** `spin:40s` turns a `carousel-3d*` ring
  continuously, one full cycle per 40 seconds (`spin:-40s` the other way); `autoplay:4s` steps it,
  resting on each slide. Drag, keys and `next:`/`prev:`/`jump:` take over and hand back without a
  snap. Pauses on hover, keyboard focus, offscreen and hidden tabs; does not start under reduced
  motion. New `pause:` control with `aria-pressed`. Off by default.
- **`carousel-orbit`** — the ring laid flat on the screen: cards on a clock face around a centred
  word, turning with `spin:`. It is `spatial-ring` with a new `plane:screen` parameter; `facing:`
  picks upright or radial cards.
- **`carousel-stack`** (new primitive `spatial-stack`) — a deck receding diagonally into depth,
  cycling forward on `autoplay:`/`spin:`, drag and controls. `shift:`, `rise:`, `shrink:`, `blur:`,
  `fade:`, `depth:` shape the diagonal.
- **`swipe-y`** — the vertical twin of `swipe-x`: publishes `data-kui-swipe="up"`/`"down"` and
  ignores sideways flicks, for a vertical deck. Opt-in; a deck without it leaves page scroll alone.
- **One lightbox gallery across a row of images and videos.** `lightbox media:mixed` makes every
  image and video link in the row one gallery: prev/next buttons and the arrow/Home/End keys move
  through images and videos alike without closing the viewer. A native video pauses when you leave
  it and resumes where it stopped when you come back; a YouTube/Vimeo embed stops when you leave it.
  `video-lightbox` with several links now cycles the same way. Image-only rows are unchanged, and
  `video-lightbox` still shows no caption unless you add `caption:figcaption`.
- **Swipe between items in the lightbox gallery.** On a touch screen a sideways swipe on the open
  `lightbox`, `lightbox media:mixed` or multi-item `video-lightbox` viewer shows the next item
  (left) or the previous one (right), respecting `loop:`; vertical swipes still scroll. Swipes
  starting on a native video are left to its controls (scrubbing), embeds keep their taps, and
  while the page is pinch-zoomed the fingers pan the page. Built on the same recogniser as
  `swipe`/`swipe-x`, which gains an `accept` option for refusing a press.
- **A swipe steps the `carousel` inside it.** `swipe-x`/`swipe-y` (or `swipe`) on a deck's wrapper
  now steps the `carousel` deck within it — left or up for next, right or down for previous — with
  no page script; only the outermost deck inside the wrapper moves. Every swipe also dispatches a
  bubbling `kui:swipe` event (`event.detail.direction`) for pages that drive something else.
- **`lightbox:true` on every carousel.** `carousel-3d lightbox:true` (and `-high`, `-low`,
  `-inside`, `carousel-orbit`, `carousel-stack`, `carousel`) opens a clicked card in the shared
  lightbox gallery with all of that carousel's cards in it — buttons, arrow/Home/End keys and touch
  swipe cycle them, images and videos alike. A drag only turns the deck; cards turned away, and
  buttons or inputs inside a card, are left alone; Enter or Space on the deck opens the card in
  front. On the `carousel` step deck a slide click opens the viewer instead of advancing. Warns if
  the showcase module is not loaded. Off by default.
- **`autoplay:` on the `carousel` step deck.** `carousel autoplay:4s` (or `step-progress`) steps the
  deck on a timer, with the spatial carousels' own rules: pauses on hover, keyboard focus, offscreen
  and hidden tabs, does not start under reduced motion, and yields to arrows, dots, clicks and
  swipes before resuming. `pause:` names a play/pause control with `aria-pressed`. Off by default;
  without it the deck moves only by hand.
- `hover:none` on every self-moving deck (`carousel`/`step-progress`, `carousel-3d*`,
  `carousel-orbit`, `carousel-stack`): the deck keeps moving while the pointer rests on it. The
  default, `hover:pause`, is unchanged; keyboard focus, the `pause:` control and reduced motion still
  stop the deck either way.

### Changed

- `target:` on `hover-intent` / `anchored-preview*` no longer moves the effect onto the match (that
  made the match its own trigger with nothing to reveal, so the effect never showed). It now names
  the hint/preview.
- **Controls no longer share `target:`'s `scope:`.** `next:`, `prev:`, `jump:` and `pause:` now look
  inside the deck first and fall back to the whole page only when nothing inside matches. A ring
  whose pause button sits in a band header needs no `scope:page` any more, so `target:.ring-slot`
  stays this ring's slots instead of every ring's on the page. An inside match always wins: two
  decks with their own arrows drive only themselves. `scope:` now governs `target:` alone;
  `scope:page` markup keeps working.
- **`tilt-3d` composes with `rotate`-property effects** (`spin`, `wiggle`…): it writes the
  `transform` shorthand, never `rotate`, so the two apply together. It is refused beside other
  `transform` writers instead.

### Fixed

- **A swipe and a `carousel` on one element.** `data-kui="swipe-y, carousel"` used to compile to
  `swipe-y` alone — every attribute-writing effect (`swipe*`, `long-press`, `carousel`/`step-progress`,
  `submit-to-spinner-to-check`, `scroll-spy`) shared one composition channel, so any two of them in a
  comma list dropped the second, silently under the default reporter. Their channels now name the
  attribute each writes, so they compose unless they really write the same one (`swipe-x, swipe-y`
  is still refused). A swipe on the deck's own element now steps that deck even inside an outer deck.
  New `attributeChannel()` and `SUBTREE_CHANNEL`, exported from `kuinetic/core`, for third-party
  primitives that write an attribute on their host or build inside it.
- **Every step deck claims `data-kui-step`.** `carousel-3d*`, `carousel-stack`, the
  `carousel-fade`/`carousel-slide` slideshows and `scroll-story` publish the step index on their host
  but did not say so, so any of them composed with `carousel` (or `scroll-progress`) on one element
  and the two overwrote each other's index. They are now refused, with a warning, like any two
  writers of one attribute.
- **Showcase widgets compose when they don't fight.** Every widget (`lightbox`, `compare`,
  `hotspots`, `slow-mo`, `scroll-story`, the `carousel-fade`/`carousel-slide` slideshows) used to
  claim one shared composition channel, so any two in a comma list were refused and the second
  dropped. `data-kui="carousel-fade, lightbox"` now gives a slideshow whose pictures open in the
  viewer. Widgets that build inside their host — inserting controls, markers or a toggle, or laying
  out its children — still refuse each other (`scroll-story, slow-mo`, `hotspots, compare`), with a
  warning naming the `subtree`; two lightbox names on one host are refused too, since both would
  open on one click.
- **`carousel-3d lightbox:true, lightbox` opened the viewer twice.** A click on a bare picture card
  reached both the `lightbox` effect and the deck's own viewer, and the second gallery replaced the
  first. The effect now marks every click it opened as handled, so the deck stands down.
- **Step decks own their children.** `carousel`, `step-progress`, `carousel-3d*` and
  `carousel-stack` take the host's children as slides, so a widget that inserts one — `slow-mo`'s
  toggle, `compare`'s range, a `bg`/`video-hero` layer — would become a slide. These pairs are now
  refused with a warning naming the `subtree`, like any two widgets that build inside one host. `bg`
  beside `scroll-story` is refused too (its layer would replace the sections as the last child).
- **`compare` composes with a clip-path entrance.** It claimed the `clip` channel though its
  `clip-path` is on the after layer, never the host, so `compare, wipe-up` was refused for nothing.
- **The `layout` composition channel is gone.** `pin`, `scroll-snap`, `accordion-height`,
  `tab-indicator-slide`, `header-shrink`, `bg`/`video-hero` and the gradient borders shared it, so
  any two were refused — a sticky header that shrinks (`header-shrink, pin-until`) among them. Each
  now claims the properties it writes (`position`, `overflow`, `height`, `padding`, …):
  `header-shrink, pin-until` and `pin-section, scroll-snap-y` compose, while
  `gradient-border, pin-section` (both set `position`) and `header-shrink, gradient-border` (both
  set `padding`) are still refused.
- **`scroll-progress` beside a `carousel` is refused.** With `steps:` both publish `data-kui-step` /
  `--kui-step` on their element and overwrote each other's index; `scroll-progress` claimed only
  `progress`, so the pair composed. It now claims the attribute too, and the compiler keeps the first
  and warns.
- **`device-frame`'s screen follows its bezel.** The wrapped media's corners are now rounded
  concentric with the frame — the outer radius less the bezel, per side — for every `kind:` and for
  an authored `radius:`. Where the bezel is deeper than the radius (the browser bar, the laptop
  base, the tablet) the screen is floored at the frame's own radius, up to 8px, so it never reads
  square unless the frame is (`radius:0px`). New `screen-radius:` sets the screen's corners
  outright. Clips an img, video, iframe, picture or div alike; pure CSS.
- **A self-moving deck could stop for good after a two-finger touch.** A second finger landing
  mid-drag replaced the drag without ending it, so the deck stayed held (and the page unselectable)
  until the next full drag. Every gesture now ends its drag when a second pointer lands, and that
  pointer starts nothing.
- **Dragging a ring seen from inside (`carousel-3d-inside`) moved the cards against the pointer.** A
  drag now reads which way the cards lie on screen, so the card under the pointer follows it on every
  deck shape, and a flick coasts the same way.
- **A self-moving deck stayed paused after its lightbox was closed with Escape.** The focus the
  viewer handed back to the deck counted as keyboard focus. Focus that arrives while the viewer is
  open is now ignored; tabbing into a deck still pauses it.
- **Clicking a card on a concave ring (`carousel-3d-inside lightbox:true`) opened nothing.** The
  cards sit behind the host's plane, so the host took every click. A deck now opens the card that was
  under the pointer when it was pressed, which also keeps a slow press on a still-turning deck
  (`hover:none`, touch) from opening the neighbour that slid under it.
- **Links and buttons inside a ring's cards work in a real browser.** `carousel-3d*`,
  `carousel-orbit` and `carousel-stack` took pointer capture on every press, so the browser
  delivered the click that ends a tap to the deck instead of the card: card links and buttons did
  nothing. Capture is now taken only once a press becomes a drag.
- **The first tap after swiping a ring is no longer swallowed.** The click-after-drag guard waited
  for a click that a touch drag (or a cancelled drag) never sends, and ate the next real one. A new
  press now clears it.
- **Dragging a ring by a linked or pictured card turns the ring.** The browser's native
  drag-and-drop took over a few pixels in — a ghost of the card followed the pointer and the ring
  stopped. A grabbable deck now refuses native drags inside it.

- **A 3D ring no longer pushes the page sideways.** `radius:` on `carousel-3d*` is now a ceiling:
  a ring whose cards would reach past the page at any angle they turn to (a `radius:200px` ring on
  a phone, a wide `carousel-3d-inside` on a laptop) shrinks to the largest radius that fits, and
  grows back on a wider page. Rings that already fit are unchanged to the pixel. A ring under an
  ancestor with `overflow-x: clip` or `hidden` is left alone — that clip is an authored bleed.
- **`swipe-x` and `swipe-y` own their `touch-action`.** On a phone the browser claimed a flick
  along the swipe's axis as a page scroll too, so the page scrolled away under every vertical
  swipe (and, on a horizontally scrollable page, every horizontal one). The axis-locked names now write `pan-y pinch-zoom` / `pan-x pinch-zoom` on
  their own element only, restoring any authored value on teardown; the page still scrolls through
  the other axis and everywhere outside the element. `swipe` (both axes) is unchanged.
- **Dragging a ring or stack no longer selects its text.** A mouse drag across `carousel-3d*`,
  `carousel-orbit` or `carousel-stack` cards painted them blue. Once a press becomes a drag the
  half-made selection is cleared and the page is unselectable until the release; the page's own
  `user-select` comes back afterwards (and on a teardown mid-drag). Presses, clicks and keys are
  untouched.
- **A ring card no longer sweeps the long way round on a click.** On every step one slot's circular
  offset wraps from one end of the deck to the other; its angle jumped a whole turn and the
  transition swept it across the front of the ring. That jump is now committed without a transition.
- **A lightbox item no longer runs off a short screen.** The video frame was sized by width only
  (and images capped at 86% of the viewport height regardless of their caption), so at 1440×723 a
  video ran past the bottom edge and took the caption and the "4 of 8" counter with it. The media
  now takes exactly the height the caption and counter leave, in both dimensions, keeping its
  aspect ratio. A picture taller than 3:2 portrait still scrolls, and now starts at its top edge
  instead of centring part of itself out of reach.
- **No false "flattens preserve-3d" warning on a ring inside a clipped band.** The `carousel-3d*`
  diagnostic warned about any ancestor with `overflow` other than `visible`, `opacity`, a `filter`
  and so on — including the `overflow: clip` band the catalog recommends for a ring that bleeds off
  the page, whose rows render in 3D. Grouping properties flatten only the element carrying
  `preserve-3d`, and the ring establishes its own 3D context, so ancestors never flatten it
  (verified in Chrome 153). The check now reads the ring's own element, and covers what flattens
  there in Chrome: `overflow` other than `visible` (including `clip`), `opacity` below 1, `filter`,
  `backdrop-filter`, `clip-path`, `mask-image`, `mix-blend-mode` and `isolation: isolate`.
- **Dragging a ring follows the pointer.** Each `pointermove` added the whole distance from where
  the press began to the ring's *current* place, so a real drag (dozens of moves) flung the ring
  several places round instead of tracking the hand. The drag now moves from where it began.
- **Every effect now claims what it writes on its element.** A new test mounts one preset of every
  registered primitive, plays a visit through it (hover, press, drag, type, scroll) and checks each
  attribute, inline property and child-list change against its composition channels. It found 25
  that wrote something they did not claim, so pairs that overwrite each other composed silently.
  Now refused, with a warning: a text effect (`split-*`, `typewriter`, `decode`, `count*`,
  `word-cycler`) or `hamburger-to-x`, `flip-card`, `slat-assemble`, `scroll-snap-*` beside a deck
  or widget that owns the same children; `tilt-3d` beside another `transform` writer (it claimed
  `rotate` but writes `transform`); `cursor-spotlight`, `slat-assemble` or `sequence-scrub` beside
  another effect that sets `position`. Each flag attribute (`data-kui-pinned`, `-hidden`,
  `-shrunk`, `-visible`, `-dragging`, `-device`, `-strength-level`, the 3D decks' `tabindex` and
  ring attributes, the hint/preview placement) is claimed too.

## [0.2.2] — 2026-09-29

### Fixed

- **Scroll-driven effects on a snapping page.** `scroll-snap-y target:…` on `<html>` writes
  `overflow-y: auto` there, and the scroll-root resolver then treated `<html>` as its own scroller —
  but the root element's overflow belongs to the viewport, and `scroll` fires on the document, never
  on `<html>`. Every scroll-driven effect on such a page (e.g. `horizontal-scroll`) froze at progress
  0. `<html>`, and `<body>` while `<html>` is `overflow: visible`, now resolve to the window.
- **Swipes that leave a small element.** `swipeable` never captured the pointer, so a flick that
  left the element before release never delivered `pointerup` and `data-kui-swipe` stayed unset.
  Gestures now take a new `capturePointer: 'drag'` mode: no capture on press (a tap's click still
  reaches the child you pressed), capture once the drag threshold is crossed, document-level
  listeners until then, and `lostpointercapture` ends the gesture like `pointercancel`. The
  showcase slideshow uses the same mode.
- **`data-kui-manual` on the core bundle no longer disconnects tier bundles.** It now means "don't
  auto-start" only: tiers such as `kuinetic.advanced.js` still register into every animator you
  build by hand, in either tag order, including a tier that arrives after `start()`.
- **The "an animator was created by hand" warning** now fires only when the call really is
  redundant (no options, or exactly `{ observe: true }`). A call that passes its own `reporter`,
  `root` or registry is the supported way to configure the page's animator and is adopted silently.
- **"activation … is not supported" warnings** no longer fire for a load-only widget composed beside
  an entrance under `on:enter` (the widget is simply bound when the entrance triggers). They still
  fire when an effect can never run under the authored trigger.

## [0.2.1] — 2026-09-29

### Added

- **`lightbox caption:`** picks where a gallery caption comes from: `figcaption` (the default and
  the old behaviour, falling back to `alt`), `alt`, `title`, or `none`. A page whose figcaptions
  label something other than the picture — a code sample, a step number — no longer has to show
  that label under every enlarged image.
- **`video-lightbox`** names its player from the link's `aria-label` when the link has no `title`
  and no poster inside it, so an icon-only play button gets a real iframe title instead of the
  generic "Video".

### Fixed

- **Split-text line reveals** settle only once the split host is finished, so lines re-split on
  resize no longer get stuck hidden.

## [0.2.0] — 2026-09-27

### Breaking

- **`ParamSpec.values` is gone**, split into `keywords` plus a small set of union parameter types
  (`number|percentage`, `length|percentage`, `angle|keyword`). This is the narrowest change here:
  it only reaches third parties who author their own custom primitives in TypeScript via
  `registerEffect()`. Nothing that reaches a primitive through `data-kui` markup is affected —
  parameters are still authored the same `key:value` way regardless of how the primitive declares
  them internally.

  The old field meant two different, contradictory things depending on the rest of the spec. On a
  `type: 'keyword'` parameter it *closed* the accepted set — anything not listed was rejected. On
  every other type, `spec.values?.includes(value)` was checked as an early, additive escape hatch
  *before* the type's own grammar ran, so it could only ever widen acceptance, never narrow it —
  the type's normal validation still ran for everything not in the list. `motion-path`'s `rotate:`
  used that correctly (`{ type: 'angle', values: ['auto', 'reverse'] }`, so `auto`/`reverse` join a
  real angle). But the same field on, say, `{ type: 'number', values: ['80%'] }` looks exactly like
  a restriction and isn't one at all — ordinary numbers still validate exactly as before, `values`
  just quietly adds one more accepted string. A field that closes the set for one type and can only
  ever open it wider for every other type is a trap disguised as validation, which is why
  `keywords` now means only the closed-set job, and the additive job is a real union type on `type`
  itself instead. `ParamSpec` is a discriminated union as a result: `keywords` is required when
  `type` is `'keyword'` or `'angle|keyword'`, and the type system forbids it everywhere else.

  Referencing the removed `values` field, or a keyword-type spec missing the now-required
  `keywords`, is a compile error under `tsc`. That's deliberate. Keeping `values` around as an
  alias for `keywords` was considered and rejected, because an alias would restore precisely the
  bug above — the same field name meaning "closed" or "additive" depending on context, just under a
  different name.

  **Migrating a custom primitive** is mechanical: rename `values` to `keywords` on every
  `type: 'keyword'` parameter, and for the additive case, change `type` to the matching union
  (`'angle|keyword'`, etc.) and move the extra literals into `keywords` there too.

### Fixed

Both of these affect anyone who built a visual workaround against the old, broken behavior. Anyone
who only authors `data-kui="ripple"` or `data-kui="confetti-burst"` and never worked around what
they used to look like is unaffected.

- **`ripple` used to turn the element it's applied to *into* a disc.** `background: currentColor`
  and `border-radius: 50%` landed directly on the host, so the ripple replaced the host's own
  shape and content rather than layering on top of it — and it fought any author CSS that set the
  host's own background or border-radius. It now paints *over* that element instead: the disc
  draws on the host's `::after`, its own box, above the host's content, leaving the host's own
  background and shape alone. One visible side effect: `ripple` now composes with effects it
  previously fought over the `background` property (`gradient-mesh`, for one), and correctly
  refuses to compose with `shine-sweep`, which also claims `::after` — a pairing that used to
  silently break instead of being caught. (`underline-slide` and `underline-center` also refuse to
  compose with `ripple`, but that refusal predates this change — both already shared the `scale`
  channel with the old `ripple` — so nothing about that particular pair is new here.)

- **`confetti-burst` now actually bursts.** It previously rendered as five static dots whose
  positions were baked as literal stops into a `background` gradient — a burst that could never
  move, because nothing about particle position was animatable. It's rewritten to draw five
  particles on `::after`, each animating outward along its own vector and settling under a slight
  downward drift, the way the name always implied. This also removes an opacity ramp that made
  every idle `confetti-burst` host invisible until triggered; if you built a workaround around
  that — wrapping the element in an always-visible decoy so it wasn't blank before the click — it's
  no longer needed and can be removed.

- **`border-draw` no longer breaks `border-radius`.** It used to paint its ring with
  `border-image`, and `border-image` ignores `border-radius` entirely by spec — every rounded
  card or pill button using it rendered with four hard square corners regardless. It now paints on
  a masked `::before`, which inherits the host's radius and curves with it correctly. One real
  consequence: the old rule reserved 2px of genuine border, which occupied layout and pushed the
  host's own content inward; the new ring is an overlay drawn over the host's edge instead, so a
  page that was relying on `border-draw` for 2px of spacing will see that content shift out by 2px.
  It also gained `width:` and `outset:` parameters: `width:` was a hardcoded `2px` with no way to
  author it, and `outset:` compensates for the same case `beam-border` already documents — a host
  with its own border pushes an absolutely-positioned ring 1px out of alignment, and no CSS length
  can read a host's border width to correct that on its own.

### Changed

- **An entrance and a hover/state effect claiming the same property now compose, instead of the
  compiler silently dropping the second one.** `data-kui="fade-up, lift"` used to compile only
  `fade-up` — `lift`, the hover response, vanished behind a dev-mode warning most authors never
  see. Every preset now declares a `phase` (`entrance`, `exit`, `idle`, or `state`), and an
  entrance or exit is recognized as handing its channel back the moment it finishes: their
  keyframes are deliberately one-sided (`kui-in-up` has no closing block), so once the entrance has
  played, CSS resolves the missing endpoint against whatever the `:hover` rule underneath it says.

  Measured directly against the current 283-name registry (a snapshot — the catalog is still
  growing today, and this figure gets re-derived at release rather than treated as a fixed
  property of the library): sweeping every one of the 39,903 possible unordered pairs of names
  through the real compiler, 30,998 pairs composed before this change and 31,555 compose now — a
  gain of 557. "Zero regressions" is the stronger of two claims and worth stating precisely: it is
  not "the test suite passes," it is that the *same sweep*, repeated with `phase` stripped back
  off every preset that declares one, produces no pair that used to compose and now refuses — that
  set difference, checked directly rather than assumed, is empty. Reproducible from
  `ADS-memory/2026-09-08-catalog-review/phase-gain-sweep.ts`.

### Added

New named effects, none of them changing anything about an existing name:

- **`press-depth`** is the catalog's first `:active` state. Every hover effect already had a
  `:focus-visible` twin; before this, the only `:active` rule anywhere in the library was a
  coarse-pointer fallback, so "the button gets a little smaller while you hold it down" — true of
  most buttons on the web — could only be written as page CSS.
- **`group-dim`** is collective hover: hover one card and the rest of the group recedes. Every
  earlier hover rule painted only the one element under the pointer; this is the first primitive to
  key on `:has()` and look at a container's other children at all.
- **`page-morph`** names a shared-element handoff through `view-transition-name` — a card visually
  *becomes* its own detail view rather than cross-fading into it — and works whether the page
  rewrites itself in place or genuinely navigates to a new document.
- **`view-swap`** is the same-document half specifically: a one-listener shim around
  `document.startViewTransition()`, for the case that needs the browser to capture the old state
  before the DOM changes.
- **`glass`** is the catalog's first *material* — a resting surface treatment (blur, a
  masked rim) rather than a change of state — and the first thing in the source to use
  `backdrop-filter`. It exists because pages were hand-writing glassmorphism in their own
  stylesheets next to a library that had no name for it.
- **`carousel-3d`, `carousel-3d-high`, `carousel-3d-low`, `carousel-3d-inside`** arrange a
  carousel's children as a draggable ring in 3D space — the first primitive to place several
  elements relative to each other instead of animating one element about its own centre. The three
  named variants steepen the ring's tilt up (`-high`) or down (`-low`), or flip it concave so the
  viewer stands inside the ring facing a 120° arc instead of outside the full circle (`-inside`).
- **`masked-label-swap`, `masked-label-swap-x`, `masked-label-swap-diagonal`** stack two real,
  selectable copies of a label in a clipped box and slide one out as the other slides in.
  Vertical is the unsuffixed default — a price or a count changing reads as a roll — with `-x`
  and `-diagonal` for wording that reads better sliding sideways.
- **`hover-intent`** reveals a hint only once the pointer has rested on the trigger for a full
  second, and leaving early cancels it outright, so it never fires as a twitchy instant tooltip.
  The one-second default delay is deliberate rather than incidental: an unauthored `hover-intent`
  with no wait would be a different, ordinary hover reveal wearing this one's name.
- **`var-axis`** is a generic variable-font axis — `data-kui="var-axis axis:GRAD from:0 to:150"` —
  for any OpenType variation axis a font carries beyond the three (`wght`, `wdth`, `slnt`) CSS
  already gives a dedicated property to.
- **Showcase presentation widgets (10 presets, bringing the catalog total from 292 to 302 named effects)**:
  - **`device-frame`** draws realistic device chrome (browser top bar with buttons, phone notch, tablet or laptop bezel) entirely in CSS around an existing media child.
  - **`lightbox`** opens image triggers in an accessible modal viewer (`<dialog>`) with gallery navigation, captions, and scale transitions.
  - **`video-lightbox`** opens YouTube, Vimeo, or video files in an accessible modal shell with lazy embed resolution and clean audio teardown on close.
  - **`compare`** stacks two media elements in an interactive before/after slider backed by an accessible native range input.
  - **`hotspots`** places interactive pins over an image using author-authored `--kui-x`/`--kui-y` properties and opens notes via native `popover`.
  - **`carousel-fade`** stacks slides in a fade crossfade with auto-generated controls, dot indicators, touch swipe, and an autoplay pause/play button.
  - **`carousel-slide`** arranges slides in a horizontal sliding strip on the shared step index.
  - **`video-hero-slideshow`** runs a fade slideshow with 7s autoplay and dot indicators (distinct from the single-video `video-hero` preset).
  - **`scroll-story`** pairs a sticky media column with scrolling text steps, syncing active step markers and crossfading media as steps scroll.
  - **`slow-mo`** adds a toggle to scale playback rate on Web Animations and CSS animations/transitions in its subtree to inspect motion.

And three smaller parameter changes, none of which affect a page that doesn't touch them:

- **`beam-border`** gained `arc:` and `softness:` (defaults `100deg` / `0.22`), and **`shine-sweep`**
  gained `angle:`, `width:`, and `color:` (defaults `115deg` / `0.2` / unset) — both sets of
  defaults reproduce the shipped look byte-for-byte, so an existing page renders identically either
  way.
- **`ripple`'s internal `spread:` parameter is renamed `extent:`.** This is not a break: `spread`
  is a reserved attribute-level key (the stagger budget), intercepted before it ever reaches a
  primitive's own parameters. `data-kui="ripple spread:6"` was always silently redirected into the
  stagger system, never into ripple's `spread`, no matter what the primitive declared — so there
  was nothing a rename could take away from anyone.

---

**Every authored `data-kui` attribute still parses and still means what it meant.** No name was
renamed, no grammar changed, and none of this requires touching a line of markup. Three effects do
render differently than they did yesterday — `ripple`, `confetti-burst`, and `border-draw` — and
each is documented above as a fix to behavior that was wrong, not a redesign of behavior that
worked. Everything else is a TypeScript-only compile break for custom-primitive authors, new
composability between existing names, a wholly new name, or a purely additive parameter.
