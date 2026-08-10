# Live-testing backlog — 2026-08-10

Captured during owner visual/manual testing in a headful browser (Playwright MCP, plus
cross-checks in the project's own pinned Chromium 149.0.7827.55 to rule out browser-version
false alarms). This is the running list — nothing here should be lost or silently dropped.

## Confirmed defects

Ordered roughly by how they were found; all reproduced with real pointer/scroll interaction, not
synthetic events.

### D1. Gesture family never calls `setPointerCapture` (widened scope)

- **Found by:** automated `test/browser/gestures.test.mjs` (elastic-pull specifically), then
  independently reproduced by the owner across `drag`, `throwable`, and `drag-x` too.
- **Source:** `src/core/gesture.ts`, `recognise()`.
- **Symptom:** once the element's rendered position diverges from the real cursor (which
  `elastic-pull`/`rubber-band` cause by design via resistance, and which `throwable`/`drag-x` can
  cause via inertia/axis-locking), release lands on whatever's actually under the cursor instead
  of the gesture's own target. Re-grabbing afterward is unreliable — hit-testing keeps landing on
  neighboring elements. `pressable` shares `recognise()` and is likely exposed the same way on a
  long real-world press with drift; not yet reproduced there specifically.
- **Owner's words:** "when I don't drag and hold it, it's just messed up... it pushes away
  somehow... not smooth and buggy."
- **Not fixed yet.** `docs/browser-findings.md` has the original automated write-up.

### D2. `card-flip-y` click activation doesn't toggle

- **Found by:** owner, live click test; independently reproduced programmatically (2 real clicks,
  state read between).
- **Source:** likely `src/core/activation.ts` / `src/core/animator.ts`'s click-gate handling —
  not yet root-caused, needs investigation. Keyframe itself is `src/css/three-d.css`
  `dsg-card-flip-y`.
- **Symptom:** first click flips the card (`state: ready → finished`, animation runs). Second
  click produces a **byte-identical** result to the first — same `data-dsg-state`, same inline
  style string. Nothing happens. No way to flip back.
- **Repro:** click `.flip-card` twice with a ~900ms wait between, compare
  `getAttribute('data-dsg-state')` and `getAttribute('style')`.

### D3. `parallax-y` (and likely `parallax-x`, `depth-layer` — same keyframe/mechanism) freezes mid-scroll

- **Found by:** owner ("is the parallax even working? i dont think it is"), confirmed by direct
  measurement.
- **Source:** `src/css/scroll.css` `dsg-parallax-y`/`dsg-parallax-x` keyframes, driven by
  `animation-timeline: view()`. `depth-layer` reuses `dsg-parallax-y` (`src/effects/presets.ts:105`).
- **Symptom:** `getComputedStyle(el).translate` (the standalone `translate` property, not
  `transform` — verified this is the right property to read, `individualTransforms` capability is
  real) settles near one value shortly after entering view (~109→110.6px) and then **stays frozen
  across 600px+ of further scroll**. The whole point of parallax is continuous scroll-linked
  motion; this is static after initial settle.
- **Verified in two browsers** to rule out a version artifact: Playwright MCP's Chromium 151 and
  the project's own pinned `playwright-core` 149.0.7827.55 (the exact browser `verify:browser`
  trusts). Identical frozen behavior in both — this is real, not an environment mismatch.
- **Not covered by any existing automated check** — `scripts/verify-browser.mjs` and
  `test/browser/` never exercise parallax at all. This was invisible until manual testing.

### D4. `horizontal-scroll` (pinned-track variant) — progress tracks correctly, but the track never visually moves

- **Found by:** owner ("Horizontal scroll doesn't work"), confirmed by direct measurement.
- **Source:** `src/effects/scroll-mechanics/presets.ts:22` (`horizontal-scroll` → primitive
  `horizontal-track`). **Different code path from the already-tested nested `overflow:auto`
  variant** (`test/browser/scroll-nested.test.mjs`, which passes) — this is the pinned-container,
  scroll-hijack style used in `demo/showcase/scroll.html`'s `.track-stage`/`.track-viewport`/
  `.track` structure.
- **Symptom:** `--dsg-progress` custom property updates correctly and continuously as you scroll
  (`0.0000 → 0.0716 → 0.4716`, verified in the project's own pinned Chromium), proving the
  scheduler/measurement side works. But `getComputedStyle(el).translate` stays at `0px` the
  entire time — `--dsg-progress` is being published but nothing consumes it to actually move the
  track. The horizontal scroll effect is visually inert despite tracking scroll correctly
  internally.
- **Not covered by the existing `test/browser/scroll-nested.test.mjs`** — that test uses the
  `overflow:auto` variant, which is a genuinely different mechanism from this pinned-track one.

### D5. Replay-all FAB doesn't actually replay declaratively-authored effects

- **Found by:** owner (asked to verify the FAB visually), root-caused by direct testing.
- **Source:** `demo/showcase/replay.js`, `replayEveryEffect()`.
- **Symptom:** clicking the FAB visibly does nothing for any element authored via a `data-dsg="..."`
  attribute (i.e. almost every effect on every showcase page). Verified: `h1`'s
  `data-dsg-state`/`getComputedStyle().opacity` are byte-identical before and 800ms+ after
  clicking the FAB.
- **Root cause, confirmed in source:** `Animator.process()` (`src/core/animator.ts:181`) has a
  config-identity short-circuit — `if (existing?.fingerprint === fingerprint) return` — so calling
  `play()` with the exact same effect string an element already has installed is a silent no-op.
  There is a dedicated method for exactly this situation, `Animator.reset(el)`
  (`src/core/animator.ts:352`), whose own doc comment says *"Needed for replay... playing the same
  effect twice was previously a no-op."* `replayEveryEffect()` never calls it — it calls
  `anim.play(el, el.getAttribute('data-dsg'))` directly, so it hits the exact short-circuit the
  library already has a documented fix for.
- **Fix direction:** call `anim.reset(el)` (or the equivalent public entry point, if `reset` isn't
  exposed on the public animator handle — check `AnimatorOptions`/the instance returned by
  `designimation()`) for each element before `play()`.
- **Why it wasn't caught by the agent that built it:** the one demo that *does* use pure
  JS-driven `anim.play()` with no pre-existing `data-dsg` attribute (the gallery `pop-in` replay
  button) has no fingerprint to collide with, so it always "works" — that's the only case the FAB
  build likely spot-checked.

## Feature requests (not defects)

### F1. "Replay all" FAB on showcase pages

White circular floating button, black rewind/circular-arrow icon. Re-triggers every effect on the
current page via the existing `anim.play()` API, regardless of original activation (load/enter/
hover/click), so load- and scroll-triggered effects that already fired before the owner scrolled
to them can be reviewed on demand without reloading or re-scrolling.

### F2. Comprehensive showcase / documentation expansion

Owner wants this to function as **a doc page for people to read** — comprehensive, not a sampler.
Two parts, both approved:
1. Showcase everything already built (~103 names) across the owner's 8 requested categories
   (scroll-triggered, hover/interaction, page/transitions, feedback, ambient/polish, text, layout/
   scroll mechanics, 3D/depth) — organized like the existing reveals/scroll/interactive split.
2. **Also build out meaningful coverage of the ~134 catalogued-but-unbuilt names** (counters,
   checkmark-draw, more of the cursor-follow/spotlight family, skeleton-to-content, toast variants,
   etc. — see `docs/catalog.md` sections C–N for the full unbuilt list) so the documentation is
   actually comprehensive rather than showing only what happened to get built first.

**Explicitly out of scope, per the catalog's own stated boundary** (`docs/catalog.md` line
280–281): WebGL/canvas particle systems and wave meshes. The library only ever provides an
adapter to a user-supplied canvas — it will never render particles itself. Flagging so this
doesn't get built toward by mistake.

### F3. Auto-advancing carousel with frosted white edges

A row of divs that cycles automatically on a timer, with a frosted/faded-white mask at both edges
(edge content fades toward white rather than hard-clipping). Likely composable from existing
primitives — `mask-reveal` or a CSS gradient-mask for the frosted edges, `flip-filter`-style FLIP
or a scroll/translate loop for the cycling — but needs design/build, not yet started.

## Not yet investigated live

- `pressable` — same `recognise()` as D1, likely exposed to the same pointer-capture issue on long
  presses with drift, flagged but not reproduced.
- Everything else in the "already built" list from the F2 write-up — only magnetic, card-flip-y,
  parallax-y, and horizontal-scroll (pinned-track) have been directly tested live so far.
