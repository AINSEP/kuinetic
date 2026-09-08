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

### Added

Nine new named effects, none of them changing anything about an existing name:

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
- **`glass-surface`** is the catalog's first *material* — a resting surface treatment (blur, a
  masked rim) rather than a change of state — and the first thing in the source to use
  `backdrop-filter`. It exists because pages were hand-writing glassmorphism in their own
  stylesheets next to a library that had no name for it.
- **`carousel-3d`, `carousel-3d-high`, `carousel-3d-low`, `carousel-3d-inside`** arrange a
  carousel's children as a draggable ring in 3D space — the first primitive to place several
  elements relative to each other instead of animating one element about its own centre. The three
  named variants steepen the ring's tilt up (`-high`) or down (`-low`), or flip it concave so the
  viewer stands inside the ring facing a 120° arc instead of outside the full circle (`-inside`).

And two effects gained parameters whose defaults reproduce the shipped look byte-for-byte, so no
existing page changes at all:

- **`beam-border`** gained `arc:` and `softness:` (defaults `100deg` / `0.22`).
- **`shine-sweep`** gained `angle:`, `width:`, and `color:` (defaults `115deg` / `0.2` / unset).

---

**No authored `data-kui` attribute changed meaning.** Every existing HTML page — every
`data-kui="ripple"`, every `data-kui="confetti-burst"`, every `data-kui="beam-border"` — keeps
working exactly as it did before, untouched. Everything above is either a TypeScript-only compile
break for custom-primitive authors, a fix to effects that weren't doing what their names promised,
a wholly new name, or a purely additive parameter.
