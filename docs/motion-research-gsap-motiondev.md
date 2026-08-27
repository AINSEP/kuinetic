# Motion research: GSAP + Motion.dev → kUInetic

Status: COMPLETE. Sources: gsap.com (homepage, Timeline/ScrollTrigger/Staggers/MotionPathPlugin
docs, showcase), motion.dev (homepage, examples, spring docs), kUInetic source cross-checks. Final
deliverable is the mapping table in section F.

## A. Motion vocabulary — GSAP (gsap.com, live browser observation)

### Hero (top of homepage)
- Opens on a giant "A" letterform plus the GSAP clover/flower logo mark, both sitting static/idle
  for a beat before the page reveals more — a held opening frame, not an instant cut to content.
  (Could not confirm the full intro sequence without more scroll runway; worth another look if time
  allows, but the held-frame-before-reveal pattern itself is worth noting: GSAP does NOT dump all
  copy immediately, it sits on a near-empty frame first.)

### "Why GSAP" section — scroll-scrubbed text color reveal + hand-drawn doodle
- As you scroll past the "GSAP allows you to effortlessly animate..." paragraph, individual WORDS
  (not the whole paragraph) turn from a dim cream to bright green, progressively, keyed to scroll
  position — classic scroll-scrubbed text highlight, word-by-word, not char-by-char here.
- Simultaneously, a hand-drawn SVG squiggle (looks like a small loop/spiral, stroke-dashoffset draw)
  animates in stroke-length next to the highlighted word — i.e. a `draw-stroke`-style decoration is
  choreographed to draw IN SYNC with the text-color scroll progress, not before or after it. Two
  different techniques (color tween + stroke draw) sharing one scroll-driven progress value.
- The "Get GSAP" pill button in the top-right, which was invisible/off in the first screenshot,
  fades up while gaining a green outline ring as the section scrolls into view — a border/outline
  reveal paired with a fade, not just opacity.
- Net choreography read: nothing moves fast or all at once. One paragraph, three elements (words,
  doodle, button) all reading off the SAME scroll driver at slightly different rates — a single
  timeline, several channels, no two elements racing each other.
- kUInetic mapping candidate: `highlight-sweep` (already in catalog, section D) + `draw-underline`/
  `draw-stroke` (section E) composed with `timeline:scroll`/`timeline:view` on shared scroll
  progress — TODO verify in mapping table whether text-color-only progressive reveal (word granularity)
  is actually expressible via `highlight-sweep` today or needs per-word split via `split-words` +
  stagger keyed to scroll (more likely: `split-words` + `text-reveal-*` with `timeline:view` per word,
  staggered — needs checking against primitives).

### "Animate Anything" pinned section
- A pinned/held section where several sticker-style badges ("Animate Anything", "That's right,
  Anything" in orange, "Nice and ___" in green, rotated ~15deg) fly in from OFF-SCREEN LEFT and
  RIGHT at different times while the section stays pinned — each badge has its own entrance
  direction, rotation, and stagger offset, not a uniform "everything from the bottom" reveal.
  The clover/flower logo mark sits center-screen and appears to pulse/scale gently as an idle
  ambient loop while the badges cycle around it (consistent with a `pulse`/`float`-style ambient
  loop layered UNDER the one-shot badge entrances — two motion tiers on one screen: ambient
  (continuous) + narrative (one-shot, scroll-triggered)).
- This reads as GSAP's classic "confetti of badges" scroll-pinned intro — several small elements,
  each with an independent transform origin/rotation/timing, converging on one idea (the word
  "Anything"). kUInetic equivalent would be several `data-kui="fade-left"/"fade-right"` (or
  `slide-*`) elements each given a distinct `at:` offset inside one pinned `pin-section`, composed
  with a continuous `pulse`/`float` on the center logo — everything already in the catalog, just
  never demonstrated choreographed together like this.

### Next section — word-by-word big-type reveal, dim-to-bright, one clause at a time
- "to your animations" appears as a full-brightness clause while the clause that follows/precedes it
  sits dimmed (low-opacity, same size) — classic "the sentence writes itself into focus as you
  scroll" pattern, where dimmed/undimmed is the whole effect (no motion, just opacity/brightness
  keyed to scroll) plus a small colored arc doodle in the corner echoing the arc/loop motif from the
  earlier section (visual through-line: hand-drawn SVG arcs recur as connective tissue across
  otherwise-unrelated sections, always animating their stroke-length in).
- Choreography lesson: GSAP repeatedly pairs "big bold moving/appearing text" with "one small,
  quiet, hand-drawn SVG accent" rather than making every element loud. The accent is what makes it
  feel designed instead of just "text appeared."

## C. How they teach — GSAP Timeline docs page (gsap.com/docs/v3/GSAP/Timeline)

### Page structure (this is the model to beat)
- Left sidebar: full docs nav tree (Quick Start / Fundamentals / GSAP / Tween / Timeline / properties
  / methods / ScrollTrigger etc.), always visible, current page highlighted — a real reference manual,
  not a linear scroll story.
- Right sidebar: auto-generated in-page "Contents" mini-TOC (jump links to each `##`/`###` heading
  on the current page) — lets a reader who knows what they want skip straight there.
- Center column: prose interleaved with (a) plain static code blocks showing the JS API and (b) at
  least one LIVE embedded interactive demo per major concept.
- **The opening demo is a literal timeline scrubber**: three colored blocks (green/blue/orange) each
  slide to x:585 in sequence; above them sits a draggable numbered scrubber (0 1 2 3 4) plus a Play
  button — the reader can DRAG THE PLAYHEAD and watch the three blocks re-render at that instant, or
  hit Play and watch it run. This is the single most important teaching pattern in this whole
  research: **the abstract concept ("a timeline has a playhead, seeking it renders that instant") is
  taught by handing the reader the playhead**, not by describing it in prose. Immediately after,
  the prose shows `tl.pause()/resume()/seek(1.5)/reverse()` as plain code — code and interactive demo
  sit right next to each other, same section.
- Prose-to-demo ratio: dense, thorough prose (this is a reference page, long) but every major
  subsection ("Positioning animations", "Special Properties", "Nesting", "How do timelines work?")
  gets its own short code sample, several with runnable output. Nothing is demo-only or prose-only.
- The docs read as a REFERENCE (a Properties table, a Methods table, both alphabetized, with full
  type signatures) appended after the narrative — i.e. tutorial-first, reference-appended, one page,
  not two.

### Vocabulary/mapping-relevant facts pulled from this page
- **Timeline position parameter** (`at:` equivalent) — GSAP's grammar is richer than kUInetic's in
  one specific way: it supports LABELS (`"someLabel"`, `"someLabel+=2"`) as named points a later
  tween can target, not just "relative to the previous item." kUInetic's `at:` is strictly relative
  to the immediately preceding effect in the same comma list — there is no way to label a point and
  have a THIRD, later effect in the list jump back to it, or to target a point relative to something
  other than its immediate predecessor. Also has `"<"`/`">"` (start/end of most-recently-added) and
  `"<1"`/`">-2"` (offset from that same reference) — conceptually a superset of kUInetic's five `at:`
  spellings, but only because GSAP timelines are an explicit object authors build up statement by
  statement in JS; kUInetic's whole point is that there's no JS object, so a fully faithful port of
  labels isn't obviously worth it for an attribute-string grammar. Worth naming as a real difference,
  not something to blindly copy.
- **`repeat` + `yoyo` are timeline/tween vars, not effect names** — `repeat: -1` for infinite,
  `repeat: 2` for finite, `repeatDelay`, and `yoyo: true` alternates direction each cycle without
  affecting the `reversed` state. This is EXACTLY the shape of the #1-ranked open GSAP-parity gap in
  kUInetic's todo.md (universal `repeat:`/yoyo) — GSAP's `yoyo` is semantically "alternate," which
  confirms todo.md's own recommendation to reuse the existing `direction` vocabulary
  (`animation-direction: alternate`) rather than invent a new word.
- **`defaults` object on a timeline** — set `duration`/`ease` once, every child tween inherits it
  unless overridden. kUInetic has no equivalent for a stagger/sequence group (each comma-effect
  fully specifies its own timing). Minor but real gap: verbose to write `600ms` on every one of five
  sequenced effects if they share a duration.
- **Nesting** — timelines can contain timelines arbitrarily deep, assembled from functions
  (`intro()`, `middle()`, `conclusion()`) and stitched with the same position parameter
  (`master.add(intro()).add(middle(), "+=2")`). kUInetic's `at:` chain is flat (one element, one
  comma list) — there's no equivalent of "assemble a sub-sequence, then place THAT sub-sequence
  relative to another sub-sequence." This only matters across elements, and kUInetic's per-element
  model doesn't really have a sub-timeline concept at all.
- **`scrollTrigger` is a property directly on a Timeline object** — in GSAP, scroll-driving is
  something you ATTACH to an already-built timeline, so the same sequence can be scroll-scrubbed or
  time-based by changing one config. kUInetic's `timeline:` is per-effect-spec rather than
  attachable to an assembled sequence, which is a smaller but structurally similar idea to the
  labels point above: kUInetic doesn't have a reified "sequence object" to attach a driver to.

## A/C. GSAP ScrollTrigger docs (gsap.com/docs/v3/Plugins/ScrollTrigger) — vocabulary + teaching

### Teaching structure
- Same 3-column layout as Timeline page. Opens with a "DETAILED WALKTHROUGH" embedded video (looks
  like an inline player, not autoplaying) THEN a "Simple example" (3-line code, no demo embed) THEN
  an "Advanced example" (a full pin+scrub+snap+labeled-timeline config, code only, no live embed on
  this pass) THEN a "Standalone/Custom example" (ScrollTrigger.create with only callbacks, no
  animation at all — establishing that ScrollTrigger is a general "scroll position sensor," not
  only an animation driver). Ends with a "Demos" section linking out to a full CodePen collection
  rather than embedding dozens inline — the docs page teaches the config surface, the CodePen
  collection is where volume/inspiration lives. Also a "Features" callout box and an explicit "most
  common ScrollTrigger mistakes" pointer — anticipating misuse, not just describing correct use.

### Vocabulary — significant deltas from kUInetic's scroll mechanics (catalog section C)
- **`toggleActions: "play pause resume reset"`** — FOUR independently named actions at FOUR
  distinct crossing points (onEnter, onLeave, onEnterBack, onLeaveBack), each an independent verb
  from a set of 8 (play/pause/resume/reset/restart/complete/reverse/none). kUInetic's `on:"enter/
  leave"` pair syntax only expresses two of these four crossings (forward on enter, reverse on
  leave) and only two verbs (play the two directions). GSAP can e.g. pause-in-place on leave-forward
  and resume from where it paused on re-entering backward, which kUInetic cannot express at all
  today — a real, nameable gap for the mapping table.
- **`scrub: <boolean|number>`** — a numeric scrub is not just "linked to scroll," it's a spring-like
  catch-up lag (`scrub: 0.5` = animation takes 0.5s to catch up to the scrollbar's actual position),
  decoupling "linked to scroll" from "instantaneously equal to scroll position." kUInetic's
  `timeline:scroll`/`timeline:view` docs (getting-started.md, catalog.md) don't mention any
  catch-up/smoothing knob — worth confirming in source whether one exists under a different name
  before calling this a hard gap.
- **`snap`** — snap the scrubbed progress to fixed increments (`snap: 0.1`), an explicit array of
  progress values, OR `"labels"`/`"labelsDirectional"` (snap to the nearest named point in the
  driven timeline). kUInetic has dedicated `scroll-snap-x`/`scroll-snap-y` primitives (thin CSS
  `scroll-snap-type` passthroughs per catalog §C) but that snaps the SCROLLER's native snap points,
  not a scrubbed animation's progress value mid-timeline — a different mechanism aimed at a
  different problem (snapping which section you land on vs. snapping where a scrubbed animation
  settles). Worth flagging as a naming collision risk if kUInetic ever adds progress-snapping.
- **`pin` mechanics**: auto-inserts a spacer to preserve document flow (`pinSpacing`), has
  `anticipatePin` to counter a scroll-thread repaint race that causes a visible flash of unpinned
  content on fast scroll, and `pinReparent` to escape a `transform`/`will-change` ancestor that
  breaks `position:fixed`. kUInetic's `pin-spacer` (catalog primitive 27, section C) already covers
  the spacer half of this. No evidence yet of an `anticipatePin`-equivalent race-condition guard in
  kUInetic — worth a source check, not claimed as a gap yet.
- **`toggleClass`** — add/remove a plain CSS class on an element purely from scroll position
  crossing a trigger, independent of whether an animation is even attached. This is a "scroll
  position as a state switch" primitive GSAP treats as a first-class feature alongside animation.
  kUInetic's closest equivalents are the state-contract attributes it stamps itself
  (`data-kui-step-state`, `data-kui-active` from `scroll-spy`) — conceptually similar (state you can
  style off of) but always tied to one of kUInetic's own named mechanisms (steps, scroll-spy), never
  a bare "toggle an arbitrary class on arbitrary scroll crossing" escape hatch the way `toggleClass`
  is. A generic version could be a cheap, high-leverage addition.
- **`.batch()`** — groups many ScrollTriggers (one per matched element) and coalesces their
  onEnter/onLeave callbacks within a short interval, so a grid of cards that all cross the viewport
  edge within the same scroll gesture animate as one batch rather than N independent triggers firing
  N times. This is scroll-driven entrance STAGGERING at the framework level, distinct from
  kUInetic's `cascade:`/`data-kui-stagger` (which staggers by DOM position/index, not by "arrived in
  viewport at nearly the same scroll moment"). Different axis of stagger — worth naming in the table
  even though it's a stretch to port.
- **Dev markers** (`markers: true`, customizable colors per start/end) — visible on-page debug
  labels showing exactly where a trigger's start/end lines sit during development. kUInetic has
  nothing equivalent; its dev-mode story is console warnings (`consoleReporter()`), not visual
  overlays. Purely a DX/authoring-tool idea, not a runtime feature — out of scope for a `data-kui`
  attribute but worth a footnote for tooling.
- **`containerAnimation`** — lets a ScrollTrigger fire based on an element's position inside a
  horizontally-scrolling container that is itself driven by vertical page scroll (nested scroll
  frames of reference). Related to kUInetic's `horizontal-scroll` primitive (catalog §C) but that
  page doesn't document triggering something else off of position-within-that-horizontal-scroll —
  worth a source check if this ever comes up as a request.

## A. GSAP Staggers docs (gsap.com/resources/getting-started/Staggers) — vocabulary deltas

- **2D grid-aware stagger**: `grid: [rows, cols]` or `grid: "auto"` (auto-computed via
  `getBoundingClientRect()`, explicitly called out as "great for responsive layouts"). Once a grid
  is known, `from` accepts DECIMAL COORDINATES like `[0.5, 0.5]` (center) or `[1, 0]` (top-right
  corner) — real 2D proximity-based stagger, not just a 1D array-index order. kUInetic's `order:`
  (`start|end|center|edges|random|<number>`) is explicitly 1D — "center"/"edges" read as if they
  were 2D-aware but per `src/core/stagger.ts` they operate on DOM/array order, not physical (x,y)
  grid position. On an actual CSS grid layout (not a single row), GSAP's version fans out
  concentrically from a point; kUInetic's "center" fans out from the middle INDEX, which on a
  multi-row grid is a different, less visually pleasing result. Real, demonstrable gap.
- **`axis: "x"|"y"`** restricts the 2D proximity calculation to one dimension of the grid — e.g.
  stagger strictly by column regardless of row. No kUInetic equivalent (no grid awareness at all
  yet, see above).
- **`amount` vs `each`** — GSAP splits into two distinct mental models: `each: 0.1` = fixed gap per
  item regardless of count (what kUInetic's `cascade:`/`data-kui-stagger` step always is); `amount:
  1` = fixed TOTAL spread across however many items exist, so adding more items tightens the gaps
  automatically rather than making the whole sequence longer. kUInetic has no `amount`-style
  "total duration budget" stagger mode — every group's total stagger time grows unbounded with
  item count. Worth flagging: a 200-item list with `cascade:50ms` takes 10 seconds to finish
  entering, which GSAP's `amount` mode is specifically designed to prevent.
- **`ease` on the stagger distribution itself** — not the easing of each item's motion curve, but
  the easing of the START-TIME gaps between items: `ease: "power2"` clusters gaps tighter toward
  the end so the sequence feels like it's accelerating into itself. kUInetic's `order:` has no
  analogous "shape" parameter — every stagger step is linear (constant gap) regardless of `order:`.
- **Negative stagger** (`stagger: -0.1`) reverses without renaming — same numeric parameter, sign
  flips direction. kUInetic instead uses a distinct keyword (`order:end`) for the equivalent of
  "last element first" — different grammar shape, not better/worse, just worth noting as a design
  choice difference (GSAP: sign on a number; kUInetic: closed vocabulary).
- **Per-stagger-item independent repeat/yoyo** — nesting `repeat`/`yoyo` INSIDE the stagger config
  (vs. the tween's top level) makes each staggered item repeat on its own clock the instant it
  finishes, rather than the whole group waiting for the slowest item before the group-repeat
  restarts everyone in lockstep. This is a nuance that only matters once kUInetic ships the
  universal `repeat:` gap (todo.md #1) — worth remembering as a follow-up decision at that point:
  does `cascade:` + `repeat:` on one element mean "the group repeats together" or "each child loops
  independently"? GSAP treats these as two deliberately different configurations; kUInetic will
  need to pick one default and a way to ask for the other.
- Function-based custom stagger distribution (arbitrary JS callback per index) has no realistic
  kUInetic analogue and shouldn't — that is exactly the kind of author-supplied-code escape hatch
  the whole `data-kui` attribute grammar exists to avoid needing.

## A/C. GSAP MotionPath docs (gsap.com/docs/v3/Plugins/MotionPathPlugin) — vocabulary + teaching

### C — the single best teaching-pattern finding of this whole research
- The docs page embeds a REAL, LIVE, FORKABLE CodePen directly in the page: tabs for `HTML` / `CSS`
  / `JS`, plus `Fork ↗` and `Rerun ↺` buttons, rendering the actual running animation inline. This
  is materially more than kUInetic's `getting-started.md` "live" fenced blocks (which render a real
  running kUInetic effect but with NO visible/editable source next to it — confirmed by direct
  comparison, see section E notes above). GSAP's version lets a reader read the JS that produced
  the motion, edit any value, hit Rerun, and see their own change — teaching by letting the reader
  falsify their own understanding, not just by reading correct prose next to a correct demo.
  **This is the concrete, highest-value pattern to steal for kUInetic's own demo pages**: pair every
  demo card with its exact `data-kui="..."` attribute string shown as visible, selectable text
  (this is nearly free since the codebase is CSS-attribute-driven, no build step, no bundler — a
  reader could paste it into their own page immediately) — the "Fork" affordance kUInetic gets for
  free is "copy this one attribute," which is a lower bar to clear than GSAP's whole CodePen.
- The demo itself is small and has a punchline: a purple `#div` box travels along a hand-drawn-looking
  wavy SVG curve, starting near a tilted blue "SVG <rect>" label and ending exactly on a small GSAP
  mascot illustration standing at the path's far end — the destination of the path is a tiny reward,
  not just an arbitrary stopping point. Choreography lesson: a technical demo can still have a
  narrative arc (departure → journey → arrival at something worth arriving at).

### A — MotionPath vocabulary deltas vs kUInetic's `motion-path` family (catalog §P)
- **Waypoint-array authoring**: GSAP accepts a plain JS array of `{x, y}` points and auto-plots a
  smooth curve through them (`curviness: 0` = hard corners, `1` = default curve, `2` = very curvy),
  OR explicit `type: "cubic"` bezier control points. kUInetic's `path:` parameter only accepts raw
  SVG path data (`'M 0 0 C 60 -80 180 -80 240 0'`) — there is no "just give me 3 points and a
  curviness number" convenience layer. **This is a real, nameable authoring-ergonomics gap**: hand
  -writing cubic bezier SVG path syntax is a much higher bar than listing a few x,y pairs, and it's
  the kind of thing that would keep an author reaching for GSAP even after seeing kUInetic's
  zero-JS `offset-path` pitch. Whether it's worth building a coordinate-list-to-path-data compiler
  is a real product question, not a small one.
- **Multi-waypoint property keyframing** (not positional): GSAP's motionPath can take an array of
  arbitrary property objects — `[{scale:0.5, rotation:10}, {scale:1, rotation:-10}, {scale:0.8,
  rotation:3}]` — and smooths velocity through each waypoint like a multi-stop tween. kUInetic's
  `tween`/`tween-from` (the closest analogue, catalog "Generic tween" section) is strictly two-point
  (current state → named target state); there is no multi-keyframe form. This is arguably a bigger
  gap than the path-authoring one above: GSAP treats "motion path" as a special case of a general
  "smooth through N waypoints" primitive, and kUInetic has no general waypoint tween at all, on any
  primitive.
- **`start`/`end` progress range (0-1, can invert or exceed 1 to loop)** — direct parity with
  kUInetic's `from:`/`to:` percentages on the motion-path family (catalog §P). No gap here.
- **`align`/`alignOrigin`/coordinate-space bending** across arbitrarily nested transformed
  containers is a JS-only concern (GSAP computes matrices at runtime); kUInetic's CSS-native
  `offset-path` sidesteps the whole problem by having the browser's own layout engine handle
  positioning — not a gap, an architectural non-issue in kUInetic's favor, worth stating in the
  final table as a place kUInetic's zero-JS approach is simply cleaner, not behind.
- **`resolution`** (arc-length pacing correction for bezier waypoint paths, default 12 segments) is
  solving a problem specific to GSAP's own bezier-fitting math; native CSS `offset-path` +
  `offset-distance` pacing is spec-defined arc-length already (browser-native, no equivalent knob
  needed) — another architectural non-gap.
- **MotionPathHelper** — a separate interactive tool for dragging path control points visually in
  the browser during development. Pure authoring-tool idea (like ScrollTrigger's markers), not a
  runtime feature — a good idea for kUInetic's own docs tooling (an SVG path playground where
  dragging a control point rewrites the `path:` attribute value shown below it) rather than
  something the library itself needs to ship.

## Note: GSAP Showcase page
- A curated external-sites gallery, filterable by tag (Astro/Portfolio/React/Reduced Motion/SVG
  Animation/Scroll Animation/Svelte/Text Animation/Three.js/UI Interactions/VueJS/Web GL/Webflow).
  Above it: a horizontal marquee ticker band ("SUBMIT YOUR SITE TO THE SHOWCASE", repeating,
  continuous scroll) used as a visual divider between the hero showreel and the gallery grid —
  kUInetic already ships this exact pattern (`marquee`/`marquee-scroll-linked`, catalog §D). Did not
  drill into individual showcase sites given time budget — the homepage + docs pages already
  produced far more actionable, specific findings than a gallery of external links would.

## A2/C/D. Motion.dev homepage — THE single best "teaching + choreography" pattern found

### The 8-tile feature grid — highest-value pattern in this entire research
- Right under the hero, Motion's homepage lays out an 4-col x 2-row grid of EIGHT small tiles, each
  isolating exactly ONE capability as a tiny live/looping demo, captioned with a title, a 1-sentence
  description, and the literal one-line code that produces it, numbered 01-08:
  1. **Independent** — two shapes transform on different axes on the SAME element, no wrapper divs
     needed. Code shown: `{rotate: 15, x: "50%"}`.
  2. **Scroll animation** — a circular ring/gauge fills as a stroke-arc, keyed to `scroll()`.
  3. **Native gestures** — a square in a dashed drop-zone with a `hover` / `press` / `drag` state
     legend (dots you can presumably toggle) — code: `drag={true}`.
  4. **Layout animation** — a 2x2 grid of squares that reflow/reorder — code: `layout={true}`.
  5. **Spring physics** — a round knob that slides along a track with real spring bounce — code:
     `type="spring"`.
  6. **Exit animation** — a small stack of list rows with status dots — code: `AnimatePresence` +
     `exit={...}`.
  7. **Timeline sequences** — four horizontal bars filling in a staggered wave (each bar's fill
     animates slightly after the previous) — code: `variants`, `stagger`, `stagger(0.04)`.
  8. **Motion values** — a square that rotates/tilts as a linked point is dragged along a line —
     code: `useMotionValue`, `useTransform`.
- **Why this is the pattern to steal.** Every tile is: one idea, one visible running example, one
  line of literal code, one short sentence, one link out to the full doc. A reader scanning the grid
  for 10 seconds walks away knowing the LIBRARY'S SHAPE — not just that "it can animate things" but
  the actual list of capabilities, each anchored to something they watched move. Compare to GSAP's
  homepage (a single continuous scroll-narrative building one impression) and to kUInetic's own
  `getting-started.md` (one demo at a time, in reading order, no overview grid at all) — **kUInetic
  has NO page that does this**: a single-glance grid of "here are N things this library does,"
  each with its own tiny proof. This is a direct, buildable answer to the four zero-demo GSAP-parity
  features named in todo.md — a compact grid card each for `at:` sequencing, `motion-path`, the
  activation enter/leave pair, and `kui:finish` chaining would close that gap in one page section,
  in exactly the format that's already proven to work for teaching a library's breadth fast.
- Framework toggle at the very top (REACT / JAVASCRIPT / VUE tabs) switches the code samples shown
  site-wide to match the reader's stack — not directly relevant to kUInetic (single vanilla-attribute
  model, no framework variants), but confirms "show the reader code in the dialect they'll actually
  use" is something both major libraries treat as core, not optional.

### Motion.dev homepage — examples gallery + workflow section (brief)
- Below the 8-tile grid, an "EXAMPLES" gallery of REAL native-UI recreations, not abstract shapes:
  Typewriter, iOS App Folder (expanding icon grid into a folder), iOS pointer animation, "Pokopia:
  Modal" (a game-styled modal), Floating Action Button (expanding FAB menu), iOS App Store card.
  Choreography lesson: showing a library's motion applied to RECOGNIZABLE, real interface patterns
  (not just colored boxes) sells the "this looks production-grade" pitch harder than primitive
  shapes do — worth carrying into kUInetic demo pages (e.g. a real-looking card/modal/FAB rather
  than a bare div) where a demo's whole point is showing off polish.
- A "WORKFLOW" section pitches an "AI Kit" (feeds an AI coding agent Motion-specific docs/context)
  and "Motion UI" (installable pre-built animated sections). Not relevant to kUInetic's own
  attribute-grammar demo pages — noted only because it signals both libraries now treat
  agent-assisted authoring as a first-class audience, a trend rather than a motion-vocabulary
  finding.

## A. Motion.dev spring docs (motion.dev/docs/spring) + kUInetic source cross-check — REAL GAP

- `spring()` in Motion is parametric physics: `spring({ keyframes: [25, 75], stiffness: 400 })`,
  configurable by `bounce`, `stiffness`, `damping`, `mass` — and the SAME physics model exports to
  BOTH a JS keyframe sampler (`generator.next(time)`) and a native CSS transition timing function
  (`element.style.transition = "all " + spring(0.5)`) — one tunable physics model, two renderers.
  Docs literally warn `damping: 0` springs run forever and need a sample-count constraint — i.e.
  it's a real ODE solver exposed directly to the author, not a canned curve.
- **Cross-checked against kUInetic source — this is a confirmed, concrete gap, not a guess.**
  kUInetic's `spring` and `bounce` (valid `ease:` keywords per `src/core/parse.ts` EASING_KEYWORDS)
  each resolve to exactly ONE hardcoded `linear(...)` easing curve in `src/css/base.css:15-30`:
  - `--kui-ease-spring: linear(0, 0.4 12%, 0.9 25%, 1.06 38%, 1.01 62%, 1)` — one overshoot, one feel.
  - `--kui-ease-bounce: linear(0, 0.5 10%, 1.2 30%, 0.9 50%, 1.08 68%, 0.97 82%, 1.02 92%, 1)`.
  - The grammar (`src/core/params.ts`) accepts only bare easing keywords or the literal CSS
    functions `cubic-bezier()`/`steps()`/`linear()` — there is no `spring(stiffness, damping,
    mass)`-shaped function token an author could write, and no numeric knob at all for either curve.
  - **`src/core/spring.ts` already contains a real numeric spring physics simulator** (stiffness/
    damping/mass, step function, settle detection) — but per `src/effects/catalog/core.ts:311-316`
    it is wired to JS-driven interactions elsewhere in the catalog, NOT to the declarative `ease:`
    grammar. The solver to close this gap already exists in the codebase; it just isn't exposed to
    `data-kui`. This is the single most concrete, cheapest-looking gap found in this whole research:
    the hard part (the physics) is done, what's missing is a parser rule and a CSS `linear()`
    curve generator fed by it (or a documented decision that `ease:spring` intentionally stays a
    fixed, cheap CSS-only approximation and tunable physics stays JS-only by design).

## F. Final mapping table — pattern → kUInetic attribute → status

Legend: **✅ today** = fully expressible with the current grammar, just undemonstrated. **⚠️ partial**
= expressible with manual composition but no dedicated convenience. **🔧 needs work** = the grammar
has no way to say this at all. **N/A** = a demo-page/teaching-structure idea, not an animation
feature — doesn't get a `data-kui` string because it isn't one.

| # | Pattern (source) | kUInetic attribute string | Status |
|---|---|---|---|
| 1 | Overlapping timeline sequencing (GSAP position param; Motion `stagger()`/timelines) | `data-kui="fade-up 600ms, blur-in 400ms at:-200ms"` | ✅ today — shipped, **zero demo cards anywhere** (todo.md) |
| 2 | Enter/exit hover pair, animates out on leave (GSAP `toggleActions`, Motion `AnimatePresence`/`exit`) | `data-kui="fade-up" data-kui-on="hover/unhover"` (or `enter/leave`) | ✅ today — shipped, near-zero demo visibility (todo.md) |
| 3 | Chain a second animation off the first's completion (GSAP `onComplete`/timeline callbacks; Motion `onAnimationComplete`) | `data-kui="fade-up func:onReveal"` + `kui:finish` listener | ✅ today — shipped, no visual demo (harder to show, per todo.md) |
| 4 | Curved travel along an arbitrary path (GSAP MotionPathPlugin) | `data-kui="motion-path path:'M 0 0 C 60 -80 180 -80 240 0'"` | ✅ today — CSS-native, zero JS, **zero demo cards anywhere** (todo.md) |
| 5 | Scroll-scrubbed travel along a path ("plane crossing the page") | `data-kui="path-swoop timeline:scroll"` | ✅ today — same primitive family, `timeline:scroll`/`view` already supported |
| 6 | Pinned section, several independently-timed badges flying in from different edges/rotations around a center idea (GSAP homepage "Animate Anything") | `data-kui="pin-section distance:150vh"` on wrapper; each badge its own `fade-left`/`fade-right` etc. with individual `at:`/`delay:` | ✅ today — pure composition of existing primitives, **never choreographed together in a demo** |
| 7 | Continuous ambient motion layered under one-shot narrative entrances (GSAP clover logo pulsing behind flying badges) | `pulse`/`float` (continuous) composed alongside `fade-left` etc. (one-shot) on sibling elements | ✅ today — two motion tiers already exist as separate primitives, just never paired in one composition demo |
| 8 | Scroll-scrubbed word-by-word text color reveal synced to a hand-drawn SVG stroke draw (GSAP "Why GSAP" section) | `split-words` + `text-reveal-*`/`highlight-sweep` per word, each `timeline:view` with a per-word progress range, composed with `draw-stroke`/`draw-underline` on a nearby decorative path, same `timeline:view` range | ⚠️ partial — every primitive involved exists and scroll timelines exist, but there's no single convenience for "N sibling effects share one scroll-progress driver with staggered ranges"; today an author hand-tunes each element's own `data-kui-timeline` range to fake synchronization |
| 9 | Breakpoint-gated treatment switch, compiles to `@media`, no JS (GSAP `matchMedia`, which needs a script) | `data-kui="fade-up below:md, fade-left above:md"` | ✅ today — and *stronger* than GSAP here: real `@media` rule, works even if JS never loads |
| 10 | 1D ordered stagger from a point (start/end/center/edges/random/index) (GSAP `stagger.from`) | `data-kui-stagger="90ms" order:center` | ✅ today — parity confirmed |
| 11 | 2D grid-proximity stagger (GSAP `stagger.grid`/`axis`, decimal `from:[x,y]`) | would need e.g. `order:'0.5,0.5'` or a new `grid:` param on `data-kui-stagger` | 🔧 needs work — `order:` is DOM/array-index-based only (`src/core/stagger.ts`); "center" on a real CSS grid fans out from the middle *index*, not the middle *cell*, which reads wrong on anything but a single row |
| 12 | Stagger budgeted by total duration regardless of item count (GSAP `stagger.amount` vs `each`) | no current equivalent; `cascade:` is always a per-item fixed gap | 🔧 needs work — a 200-item list at `cascade:50ms` takes 10s to finish; no `amount:`-style total-time mode exists |
| 13 | Eased stagger distribution (gaps between item starts shaped by an easing curve, not linear) (GSAP `stagger.ease`) | no current equivalent | 🔧 needs work — `order:` only picks a starting point, never a shape for the gaps themselves |
| 14 | Four-way scroll toggle actions — independent play/pause/resume/reset at onEnter/onLeave/onEnterBack/onLeaveBack (GSAP ScrollTrigger `toggleActions`) | no current equivalent; `on:"enter/leave"` only covers two of the four crossings with only forward/reverse as the two verbs | 🔧 needs work — real gap: cannot pause-in-place on leaving and resume-from-there on re-entry today |
| 15 | Scroll-scrub with a smoothing/catch-up lag, decoupling animation progress from raw scroll position (GSAP `scrub: <number>`) | no confirmed equivalent found in `getting-started.md`/`catalog.md` | 🔧 needs work *(unverified — flag for a source check, not a confirmed gap; kUInetic's `timeline:scroll`/`view` docs don't mention a catch-up parameter, but that doesn't prove one doesn't exist under another name)* |
| 16 | Generic "toggle a class on arbitrary scroll crossing," independent of any animation (GSAP `toggleClass`) | no current equivalent; kUInetic only stamps state via its own named mechanisms (`data-kui-step-state`, `scroll-spy`'s `data-kui-active`) | 🔧 needs work — a generic escape hatch, potentially cheap and high-leverage |
| 17 | Batched/coalesced scroll-entrance stagger — a grid of cards that cross the viewport edge within one scroll gesture animate as one group (GSAP `ScrollTrigger.batch()`) | no current equivalent; `cascade:`/`order:` stagger by DOM position, not "arrived on screen around the same scroll moment" | 🔧 needs work — different axis of stagger than what exists today |
| 18 | Waypoint-array path authoring with a `curviness` knob, no SVG syntax required (GSAP MotionPathPlugin coordinate arrays) | today: `path:'M 0 0 C ...'` (raw SVG data only) | 🔧 needs work — real authoring-ergonomics gap; hand-written bezier syntax vs. a short list of x,y points |
| 19 | Multi-waypoint property keyframing — smooth through N states, not just 2 (GSAP MotionPath "animating through other properties"; conceptually GSAP's `.fromTo()` chains) | today: `tween`/`tween-from` is strictly two-point (current → named target) | 🔧 needs work — arguably the deepest gap found: no primitive in the catalog does an N-point keyframe tween on arbitrary properties |
| 20 | Universal `repeat:`/yoyo (GSAP `repeat`/`yoyo` on every tween/timeline) | today: `loop`/`direction` exist only on *some* primitives | 🔧 needs work — **already todo.md's #1-ranked gap**, confirmed independently by this research; GSAP's `yoyo` = alternate direction, matching todo.md's own recommendation to reuse `direction:alternate` rather than invent a new word |
| 21 | Cross-element triggering — animate element B when element A fires an event (GSAP `scrollTrigger`/callbacks targeting arbitrary targets; any GSAP tween can target any selector regardless of what fired it) | today: nothing — no `trigger:` key exists | 🔧 needs work — **already todo.md's #2-ranked gap**, confirmed independently |
| 22 | Configurable spring/bounce physics (stiffness/damping/mass), same model exportable to CSS (Motion's `spring()`) | today: `ease:spring`/`ease:bounce` are single fixed `linear()` curves (`src/css/base.css:15-30`) | 🔧 needs work — **cheapest-looking real gap in this whole research**: `src/core/spring.ts` already has a working numeric spring solver, it's just wired to JS interactions elsewhere and never exposed to the `ease:` grammar |
| 23 | Timeline labels + relative-to-label positioning, nested sub-timelines assembled independently then stitched (GSAP Timeline labels/nesting) | no equivalent — `at:` is always relative to the immediately preceding effect in the same element's comma list | 🔧 needs work, but **debatable whether it's worth it**: this only matters once you have a reified, JS-buildable timeline object, which cuts against kUInetic's whole no-JS attribute-string premise. Flag as "known limitation, not obviously a bug" rather than a queued task |
| 24 | Grid of small tiles, each isolating ONE capability with live demo + 1-line code + short caption (Motion homepage's 8-tile feature grid) | N/A — demo-page structure, not a library feature | N/A — **direct, low-cost fix for the four zero-demo GSAP-parity features**: one grid section with a card each for `at:`, `motion-path`, the enter/leave pair, and `kui:finish` would close todo.md's demo-coverage gap in the exact format proven to teach a library's breadth fast |
| 25 | Live, forkable, editable code-next-to-demo (GSAP's embedded CodePens: HTML/CSS/JS tabs, Fork/Rerun) | N/A — demo-page/docs authoring pattern | N/A — kUInetic's own `getting-started.md` "live" blocks already run a real effect inline but show no visible/editable source beside it; showing the literal `data-kui="..."` string as selectable text next to every demo card is a much lower bar to clear than a CodePen and should be the default for every new demo card |
| 26 | Real native-UI recreations (iOS folders, FABs, modals) rather than colored boxes, for showcase/example content (Motion's examples gallery) | N/A — demo content choice | N/A — a styling/content recommendation for any new demo cards: prefer a card/modal/nav shape over a bare `<div>` when the point is to sell polish |

(End of research. Section F above is the final deliverable table.)

## E. kUInetic context (read first)

### todo.md findings (read 2026-08-27)
- Demo coverage gap: `tween` has 15 hits across demo/*.html; four other GSAP-parity features have
  ZERO demo cards anywhere:
  1. `motion-path` / `follow-path` (CSS-native `offset-path`) — no demo card at all.
  2. Open activation list: `data-kui-on="pointerleave"` + enter/exit pair syntax — highest-value
     shipped thing with zero visibility. Obvious demo: hover card that animates out on leave.
  3. Sequencing `at:` — `data-kui="fade-up 600ms, blur-in 400ms at:-200ms"` — headline feature,
     on no page.
  4. Lifecycle events `kui:finish` / `kui:reverse-finish` — harder to show, but the real use case
     is chaining a second animation off the first's completion.
- GSAP parity still open (ranked by owner 2026-08-27):
  - #2: Cross-element triggering (event fires on element A, element B animates) — no `trigger:` key
    exists in src/core/parse.ts. Needs selector-valued param, follow `target:` convention but
    probably hoisted element-wide like `on:` (decide deliberately).
  - #1 (cheapest win): Universal `repeat:`/yoyo — `loop`/`direction` exist on SOME primitives only,
    no universal `repeat` key. Plumbing exists (`compile.ts:294` writes
    `animation-iteration-count` per track off `--kui-fx-<preset>-iterations`). Yoyo should reuse
    existing `direction` vocabulary (`animation-direction: alternate`) rather than new word.
  - Arbitrary scroll ranges: half-built. Free-form range ships on longhand
    `data-kui-timeline="view entry 0% cover 35%"` already.
  - SHIPPED (don't re-litigate): breakpoint variants (`above:`/`below:`/`wide:`/`narrow:`,
    GATE_DIRECTIONS in src/core/parse.ts:358), stagger ordering (`order:` / `from:`,
    StaggerFrom in src/core/stagger.ts:27: 'start'|'end'|'center'|'edges'|'random'|number).

(Will read docs/catalog.md, docs/getting-started.md, src/effects/tween/properties.ts,
src/core/parse.ts next and append findings below.)

### docs/catalog.md — grammar/vocabulary facts that matter for mapping
- 267 named effects, 33 primitive families, ~175 css / ~64 js / ~12 prep renderer split.
- `tween`/`tween-from` (primitive 32, generic escape hatch): properties `x y z` (translate),
  `rotate`, `scale scale-x scale-y`, `opacity`, `blur brightness saturate grayscale` (filter),
  `color`, `background-color`. Bare number gets implied unit (`x:100`->`100px`, `rotate:45`->`45deg`).
  NO `width/height/top/left` (layout-animating, perf boundary), no `skew`, no `rotate-x/rotate-y`
  (need `perspective()`, different channel). This is kUInetic's rough GSAP `gsap.to()` analogue.
- `motion-path` family (primitive 33, section P, 5 names: `motion-path` `path-arc` `path-wave`
  `path-loop` `path-swoop`) is CSS-native `offset-path`+`offset-distance`, zero runtime JS. Takes
  `path:` (quoted SVG path data, coords relative to element's own top-left), `rotate:auto|reverse|<angle>`
  (off by default, unlike native CSS), `anchor:` (pivot point), `from:`/`to:` (% of curve, for
  partial-path travel — several elements can each own a stretch of one shared route), and
  `timeline:scroll`/`timeline:view` for scroll-scrubbed travel along the curve (the "plane crossing
  the page" effect people build ScrollTrigger rigs for in GSAP). THIS IS SHIPPED AND CAPABLE but has
  literally zero demo cards per todo.md — a big "GSAP MotionPathPlugin parity, unseen" finding.
- Sequencing `at:` (getting-started.md): comma-separated effects in ONE `data-kui` attribute are an
  overlapping timeline — `at:-200ms` (start before prev ends, overlap), `at:+100ms` (gap after),
  `at:after` (exactly when prev ends), `at:with` (same instant prev starts), `at:with+150ms`.
  Chains front-to-back across a 3+ effect list. This is a real (if compact) GSAP-timeline-style API
  already shipped, with ZERO demo usage. Limitation: relative to previous EFFECT not previous
  ELEMENT (no cross-sibling sequencing this way — that's `data-kui-stagger`'s job), and it compiles
  to a delay, so it's inert on `timeline:view/scroll` (works on `timeline:pin` though, where delay
  is the scrub head).
- Stagger (`cascade:`/`order:` inline, or `data-kui-stagger`/`from:` longhand): `order:` values
  `start|end|center|edges|random|<number>`. `center`/`edges` = GSAP's stagger `from: "center"` /
  `"edges"` equivalent. `random` is a deterministic scatter (not Math.random) — reproducible.
  `--kui-i` is the per-child index custom prop, `--kui-step` similar for step-marking.
- Activation model: `on:` is an OPEN list — any real DOM event name works (`on:submit`, `on:invalid`,
  `on:cart:updated`), not a closed set. Pair syntax `on:"enter/leave"` or `on:"hover/unhover"` plays
  forward then reverse (exit animation) — this is kUInetic's answer to GSAP's enter/leave hover
  choreography, but per todo.md has near-zero demo visibility for the exit half.
- Lifecycle events: `kui:start`, `kui:finish`, `kui:reverse-finish`, `kui:cancel` — plain bubbling
  CustomEvents on the element, `event.detail = {effects, activation, timeline, reason}`. `func:name`
  is sugar for a no-build page (looks up a `window`-scoped global at finish time). No per-frame event
  by design (would force main-thread animation) — progress is pull-based via `control().progress`.
  This chaining-off-completion mechanism is kUInetic's GSAP-timeline-callback / `.then()` analogue.
- `control()` API: `pause()/seek(0..1)/timeScale()/play()/reverse()`, `.progress` (0..1, least-advanced
  of selection), `.state`. Two categories have NO playhead: JS-rendered effects (drag/pin/scroll-spy/
  counters) and scroll-driven timelines (their playhead belongs to the scroller). This is the
  GSAP-Timeline-instance analogue, notably weaker than GSAP's (no true timeline object you build up
  effect-by-effect with labels — it's closer to a single Animation handle per element).
- Breakpoint gates `above:`/`below:` (viewport, 5 Tailwind-scale names) and `wide:`/`narrow:`
  (container queries) compile to real `@media`/`@container` rules, not JS — a real strength vs GSAP
  matchMedia() which needs a script.
- KNOWN GAP confirmed: no cross-element triggering (`trigger:` key does not exist) — "when the form
  submits, animate the badge elsewhere" is NOT expressible today. No universal `repeat:`/yoyo param
  (only per-primitive `loop`/`direction`).

### docs/getting-started.md — teaching structure (for section C comparison)
- Structure per feature: 1-2 sentence prose intro -> plain `<html>` code block -> a `live` fenced
  block that the docs renderer turns into an ACTUAL RUNNING kUInetic demo inline (see `data-kui-on`
  hacks pinning things to on:load since a boxed example has no scroll runway). This IS "code beside
  the running thing" already — kUInetic's docs already do live-demo-next-to-code. Worth confirming
  in browser whether the demo page (not the docs page) does this, since the brief is about DEMO
  pages, and whether values are EDITABLE (docs live blocks appear to be static-parameter, not
  playground/editable — no visible slider/input to change duration and re-render). This is a
  candidate gap vs Motion.dev's likely interactive playgrounds — verify in browser.
- "Common mistakes" section at the end of getting-started.md is a good teaching pattern (explicit
  anti-patterns named), independent of GSAP/Motion comparison.


