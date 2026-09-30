# Changelog

All notable changes to kUInetic are documented here. Dates are when a change landed on `main`;
version numbers are assigned at release.

## [Unreleased]

### Added

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
- **A swipe steps the `carousel` inside it.** `swipe-x`/`swipe-y` (or `swipe`) on a deck's wrapper
  now steps the `carousel` deck within it — left or up for next, right or down for previous — with
  no page script; only the outermost deck inside the wrapper moves. Every swipe also dispatches a
  bubbling `kui:swipe` event (`event.detail.direction`) for pages that drive something else.

### Fixed

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
- **Dragging a ring follows the pointer.** Each `pointermove` added the whole distance from where
  the press began to the ring's *current* place, so a real drag (dozens of moves) flung the ring
  several places round instead of tracking the hand. The drag now moves from where it began.

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
