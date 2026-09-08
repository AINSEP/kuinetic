# Changelog

All notable changes to kUInetic are documented here. Dates are when a change landed on `main`;
version numbers are assigned at release.

## [Unreleased] — 2026-09-08

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
