# Browser-test findings

Generated: 2026-08-10, by a Programmer dispatch scoped to `scripts/`, `test/browser/`, and `docs/`
(forbidden from editing `src/`). Source: `npm run test:browser`, run against `src/` as it stood
after the concurrent Refactor→Programmer execution pass on this branch. Every finding below was
reproduced multiple times and is backed by a named frame in `.artifacts/frames/` plus, in each
case, independent verification beyond the failing assertion itself (see "How this was confirmed").

Two real defects. Both are reported here, not fixed — that decision belongs to the next Programmer
dispatch.

---

## 1. Multi-subpath SVG paths lose their subpath boundaries when morphed

**Severity:** High. Any shape with a hole, a stroked compound path, or more than one `M` in its `d`
silently corrupts into one connected outline the moment it morphs.

**Source:** [`src/core/path-morph.ts`](/Users/la/Programming/designimation/src/core/path-morph.ts)

**What's wrong:** `parsePath()` (lines 45–74) correctly walks multiple `M` commands — each resets
`state.current`/`state.start` — but the `Cubic[]` segment list it builds (`PathState.segments`,
declared line 77) carries no marker for *where* a new subpath started. `toPathData()` (lines
238–248) then serializes that flat list as a single figure: one leading `M` from `segments[0].from`,
followed by an unbroken chain of `C` commands, and no `Z` ever. Two independent subpaths that
happen to be adjacent in the array get silently joined by an implicit line between the first
subpath's closing point and the second subpath's first control point — geometry that was never
authored.

**Reproduction:** `test/browser/svg-morph-subpath.test.mjs` morphs a square with a square hole
(`fill-rule="evenodd"`, both subpaths explicitly closed with `Z`) to a differently sized version of
the same shape, via the real `icon-morph` primitive in a real browser.

- Authored `d` (sanity baseline, confirms the *fixture* is correct):
  `M10,10 L90,10 L90,90 L10,90 Z M30,30 L70,30 L70,70 L30,70 Z` — 2 `M`, 2 `Z`.
- Morphed output at `t≈1`:
  `M15,15 C38.33,15 61.67,15 85,15 C85,38.33 85,61.67 85,85 C61.67,85 38.33,85 15,85 C15,61.67 15,38.33 15,15 C46.67,40 53.33,40 60,40 C60,46.67 60,53.33 60,60 C53.33,60 46.67,60 40,60 C40,53.33 40,46.67 40,40`
  — **1** `M`, **0** `Z`.

The break is visible, not just textual: after `C15,61.67 15,38.33 15,15` closes the outer square
back to its start point `(15,15)`, the very next command jumps straight into the inner hole's
geometry with no moveto in between, drawing a spurious connecting line from the outer square's
corner into the hole.

**How this was confirmed:** the rendered frame shows the actual defect, not an inference from the
string — a dark wedge cuts from the top-left corner of the square into the hole, which is exactly
what an erroneous connecting segment between two subpaths looks like when filled with `evenodd`.

**Frame:** `.artifacts/frames/svg-morph-subpath/02-morphed-output.png`
(baseline: `.artifacts/frames/svg-morph-subpath/01-authored-two-subpath-hole.png`)

**Likely fix shape (not implemented here):** `Cubic` segments need a subpath-boundary flag (or
`Cubic[][]`, one array per subpath) threaded through `parsePath`, `normaliseCount`, `splitCubic`,
and `toPathData`, so the serializer can emit a new `M`/`Z` at each boundary instead of assuming one
continuous figure. `normaliseCount`'s longest-segment-split strategy would also need to stay
within a single subpath's segments rather than comparing chord lengths across subpath boundaries.

---

## 2. Gesture recognisers lose `pointerup`/`pointermove` once the element's rendered position diverges from the pointer — `elastic-pull`, `rubber-band`, and `swipe*` get stuck permanently

**Severity:** High. Not a visual glitch — the affected element's drag state never clears. Repeated
use leaks a `pointermove` listener's worth of dead weight per stuck gesture and leaves
`data-dsg-dragging`/`data-dsg-swipe` permanently wrong for CSS consumers styling off them.

**Source:** [`src/core/gesture.ts`](/Users/la/Programming/designimation/src/core/gesture.ts),
`recognise()` (lines 118–205)

**What's wrong:** `recognise()` attaches `pointerdown`/`pointermove`/`pointerup`/`pointercancel`
listeners directly to the target element (lines 191–196) and never calls
`el.setPointerCapture(event.pointerId)` in `onDown` (lines 149–156), nor releases capture anywhere
in teardown (lines 198–204). Without explicit capture, the browser routes `pointermove`/`pointerup`
using ordinary hit-testing at the pointer's *current* screen position — not to whichever element
received the `pointerdown`. That is safe only as long as the element's rendered position keeps
pace with the pointer. It does not for two shipped primitives:

- **`elastic-pull` / `rubber-band`** (`draggable` with `bounds > 0`): `resist()` →
  `rubberBand()` in [`src/core/gesture.ts`](/Users/la/Programming/designimation/src/core/gesture.ts)
  (lines 229–234) deliberately damps the tracked offset once the pointer passes the bound — that's
  the entire point of the effect. The element then lags behind the real cursor by design, so by
  release time the cursor is no longer over the element at all.
- **`swipe` / `swipe-x`** (`swipeable`): [`prepareSwipeable`](/Users/la/Programming/designimation/src/effects/gestures/primitives.ts:161)
  never writes any position at all — the element never moves — so *any* real flick ends with the
  cursor well outside it.

Once `pointerup` misses the element, `onEnd`/`onSwipe` never fire: `data-dsg-dragging` never
returns to `"false"`, the spring `return` never gets its `.to(0)` call, and `data-dsg-swipe` is
never written. `pressable` (`preparePressable`, same file) uses the same `recognise()` and is
architecturally exposed to the identical failure during a long real-world press with finger drift,
though it was not separately reproduced here.

**How this was confirmed:** a `dispatchEvent(new PointerEvent('pointerup'))` shortcut — the pattern
the existing `scripts/verify-browser.mjs` SVG check already used, and the one this dispatch was
explicitly asked to avoid for the gesture suite — targets the element directly and bypasses
hit-testing entirely, so it *cannot* reproduce this class of bug. This finding only exists because
`test/browser/gestures.test.mjs` drives real `page.mouse` input. It was further confirmed, beyond
the failing assertion, by attaching a capturing `document`-level `pointerup` listener and logging
`event.target`: on release, the event's target was **the neighbouring `swipe` chip, 94px away from
`#elastic`** — direct proof the event was delivered to the wrong element, not merely "not handled".
`el.hasPointerCapture(event.pointerId)` was confirmed `false` at the same moment.

**Reproduction:** `test/browser/gestures.test.mjs`, `checkElasticPull` and `checkSwipe`.

- `elastic-pull`: resistance grows correctly throughout the drag (burst-sampled at four points —
  `38.1px` → `51.61px` → `56.11px` → `56.11px` against raw pointer deltas of `40/80/115/150px` —
  the primitive's own math is fine). After a real `page.mouse.up()`: `data-dsg-dragging` stays
  `"true"` forever, and an 8-point burst sample across the full 800ms spring-settle window shows
  `translate.x` magnitude **frozen at exactly `56.1px` for all eight samples** — not merely "didn't
  reach 0 yet", but provably never moved at all, because the spring's `.to(0)` call that should
  have started it never ran.
- `swipe`: after a fast real flick (4 moves × 30px over ~60ms, ≈2000px/s, well above the 300px/s
  `swipeVelocity` default), `data-dsg-swipe` stays `null`.

**Frames:**
`.artifacts/frames/gestures/07..10-elastic-resisted-*-of-4-*.png` (correct resistance, growing
across the drag), `.artifacts/frames/gestures/11..18-elastic-spring-return-*-of-8-at-*pct.png` (the
full 800ms burst — a static chip across all eight frames proves it did *not* settle, not just that
the last one looked wrong), `.artifacts/frames/gestures/19-swipe-detected.png` (no visual change;
the swipe was never recognised).

**Likely fix shape (not implemented here):** call `el.setPointerCapture(event.pointerId)` in
`onDown`, and `el.releasePointerCapture(event.pointerId)` (guarded, since capture can already be
lost on `pointercancel`) wherever `recognise()` tears down a gesture. This is a same-file,
low-risk-looking change, but it was not made here — `src/` is out of scope for this dispatch.

---

## What did *not* find a defect

For completeness, since a defect-finding pass is easy to read as exhaustive when it is not:

- **Nested `overflow: auto` scroll root + `horizontal-scroll`** (`test/browser/scroll-nested.test.mjs`):
  progress, translation, window-position isolation, and measurement-read boundedness all matched
  the source's own claims exactly. The three defects `docs/review-2-gpt-5.6-sol.md` predicted this
  test would catch were already fixed by the time this suite ran (see `docs/HANDOFF.md`'s Completed
  Work #6); this suite is now the regression guard for that fix, not a new finding.
- **FLIP inverse transform and final geometry** (`test/browser/flip-geometry.test.mjs`): the first
  keyframe's `translate` matched the independently-measured layout delta exactly (`-120px`, to the
  pixel), and the element rests at its true new position with `translate: none` once the animation
  finishes.
- **Reduced motion for JS-driven effects** (`test/browser/reduced-motion.test.mjs`): confirmed at
  the listener-attachment level, not just visually — a real drag under
  `prefers-reduced-motion: reduce` produces no `data-dsg-dragging` attribute at all (not `"false"`)
  and no `translate` write, proving `recognise()` never runs, not merely that its effect is calmed.
- **Post-`destroy()` cleanliness, including mid-gesture** (`test/browser/destroy-cleanup.test.mjs`):
  calling `reset()` on a `draggable` element with the pointer still held down — not a settled one —
  still fully restores inline style, clears every `data-dsg-*` attribute, and nets listener counts
  to zero, for both the dragged element and the `window`-level listener a separate `magnetic`
  effect installed.
