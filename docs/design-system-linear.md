# Design system reference — Linear ("midnight precision instrument")

Source: https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1

Captured as a reference for the premium redesign of the kUInetic demo/showcase site. The source
spec is dark-mode-only ("Theme: Dark mode" in the original). Per direction: **the site defaults to
light mode with a white background**; dark mode is a secondary, user-toggleable theme built by
inverting this surface hierarchy (not yet derived below — flagged where it still needs values).

## System identity

- **Name:** Linear
- **Tagline:** "midnight precision instrument"
- **Description:** Near-black surfaces with paper-white type and a single electric acid-lime
  accent functioning as a "functional flashlight" for high-contrast action signals.
- **Related systems:** Vercel, Cursor, Raycast, Framer — dark-canvas precision-instrument
  aesthetic, product-screenshot-as-hero layout, tight Inter typography at 400–510 weight.

## Color palette (dark, as sourced)

### Primary accent

| Name | Value | Token | Usage |
|---|---|---|---|
| Acid Lime | `#e4f222` | `--color-acid-lime` | Exclusive primary action buttons, active nav indicators — one per view, never decorative |

### Supporting accents

| Name | Value | Token | Usage |
|---|---|---|---|
| Pulse Green | `#27a644` | `--color-pulse-green` | Tag/divider accents, focused UI edges |
| Coral Red | `#eb5757` | `--color-coral-red` | Highlight backgrounds, soft emphasis |
| Signal Teal | `#02b8cc` | `--color-signal-teal` | Decorative accents, info icons |
| Iris Violet | `#6366f1` | `--color-iris-violet` | Tag/badge fills |
| Lavender | `#8b5cf6` | `--color-lavender` | Secondary tags, category indicators |

### Neutrals (monochromatic hierarchy, dark)

| Name | Value | Token | Purpose |
|---|---|---|---|
| Void | `#08090a` | `--color-void` | Page canvas, full-bleed backgrounds |
| Carbon | `#0f1011` | `--color-carbon` | Card surfaces, nav bars |
| Obsidian | `#161718` | `--color-obsidian` | Elevated surfaces, deeper panels |
| Graphite | `#23252a` | `--color-graphite` | Subtle borders, dividers |
| Smoke | `#383b3f` | `--color-smoke` | Higher-contrast section separators |
| Ash | `#62666d` | `--color-ash` | Muted body text, inactive icons |
| Fog | `#8a8f98` | `--color-fog` | Tertiary text, placeholder copy |
| Mist | `#d0d6e0` | `--color-mist` | Secondary headings, button text |
| Bone | `#e5e5e6` | `--color-bone` | Near-white surface fills |
| Paper | `#ffffff` | `--color-paper` | Primary headings, max-contrast text |

**Surface levels (dark):**

| Level | Name | Value | Purpose |
|---|---|---|---|
| 0 | Void | `#08090a` | Page canvas |
| 1 | Carbon | `#0f1011` | Cards, product frames, nav |
| 2 | Obsidian | `#161718` | Elevated panels |
| 3 | Slate | `#23252a` | Interactive tints, ghost fills |

### Light mode — NOT in source, needs derivation before use

The user wants light-as-default with a white background. Straightforward inversion candidate
(not yet validated against contrast ratios or applied anywhere):

| Level | Dark equivalent | Proposed light value |
|---|---|---|
| Page canvas | Void `#08090a` | Paper `#ffffff` |
| Card/nav surface | Carbon `#0f1011` | Bone `#e5e5e6` or a near-white `#fafafa` |
| Elevated panel | Obsidian `#161718` | White with hairline border, or `#f5f5f5` |
| Border/divider | Graphite `#23252a` | A light neutral border, e.g. `#e2e2e4` |
| Primary heading text | Paper `#ffffff` | Void `#08090a` or near-black |
| Muted body text | Ash `#62666d` | Same or slightly darkened for AA contrast on white |
| Accent (acid lime) | `#e4f222` | Likely needs a darkened/desaturated variant — raw acid lime on
  white has poor contrast for text/icons; fine as a fill behind dark text (matches the source's
  own "Primary Action Button" spec: lime background + `#08090a` text, which already works on
  light backgrounds unchanged) |

This table is a starting point, not final values — resolve when the light theme is actually built.

## Typography

**Font families:**

| Role | Font | Weights | Sizes | Fallback |
|---|---|---|---|---|
| Primary UI/Headings | Inter Variable | 300, 400, 510, 590 | 10–72px (14 values) | system-ui |
| Code/Metadata | Berkeley Mono | 400 | 12, 14 | ui-monospace |

OpenType features on Inter Variable: `'cv01' on, 'ss03' on, 'zero' on`.

**Type scale** (Minor Third 1.2 from 16px base):

| Role | Size | Weight | Line height | Letter spacing | Token |
|---|---|---|---|---|---|
| Display | 72px | 510 | 1.0 | -0.022em | `--text-display` |
| Heading Large | 64px | 510 | 1.0 | -0.022em | `--text-heading-lg` |
| Heading | 48px | 510 | 1.0 | -0.022em | `--text-heading` |
| Heading Small | 32px | 400 | 1.13 | -0.022em | `--text-heading-sm` |
| Subheading | 24px | 400 | 1.33 | -0.012em | `--text-subheading` |
| Body Large | 20px | 590 | 1.33 | -0.012em | `--text-body-lg` |
| Body (17px) | 17px | 590 | 1.6 | default | — |
| Body | 16px | 400 | 1.5 | default | — |
| Body Small | 15px | 400 | 1.6 | -0.011em | `--text-body-sm` |
| Caption | 13px | 400 | 1.2 | default | `--text-caption` |

## Spacing & layout

**Spacing scale** (base unit 4px): 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96, 128px
(tokens `--spacing-4` … `--spacing-128`).

- **Density:** Compact
- **Max width:** 1200px
- **Section gap:** 96px
- **Card padding:** 24px
- **Element gap:** 8px

## Border radius

| Element | Value | Token |
|---|---|---|
| Small | 2px | `--radius-sm` |
| Badges | 4px | `--radius-badges` |
| Inputs | 6px | `--radius-inputs` |
| Buttons | 6px | `--radius-buttons` |
| Cards | 12px | `--radius-cards` |
| Pills | 9999px | `--radius-pills` |

3-radius vocabulary in practice: 12px (cards), 6px (buttons), 9999px (pills). No radii ≥16px on cards.

## Shadows & elevation

| Name | Value | Token |
|---|---|---|
| sm | `rgba(0,0,0,0.4) 0px 2px 4px 0px` | `--shadow-sm` |
| md | `rgba(0,0,0,0.2) 0px 0px 12px 0px inset` | `--shadow-md` |
| subtle | `rgb(35,37,42) 0px 0px 0px 1px inset` | `--shadow-subtle` |
| subtle-2 | `rgba(0,0,0,0.2) 0px 0px 0px 1px` | `--shadow-subtle-2` |
| subtle-3 | `rgba(0,0,0,0.01) 0px 5px 2px 0px, rgba(0,0,0,0.04) 0px 3px 2px 0px, rgba(0,0,0,0.07) 0px 1px 1px 0px, rgba(0,0,0,0.08) 0px 0px 1px 0px` | `--shadow-subtle-3` |
| subtle-4 | Inset highlight + outer dark border + drop shadow | `--shadow-subtle-4` |
| subtle-5 | `rgba(0,0,0,0.1) 0px 0px 0px 2px` | `--shadow-subtle-5` |
| xl | `rgba(8,9,10,0.6) 0px 4px 32px 0px` | `--shadow-xl` |

**Elevation approach:** hairline borders (0.5px `#23252a`) and inset shadows, not layered ambient
shadows. Surface progression (`#08090a` → `#0f1011` → `#161718` → `#23252a`) defines hierarchy —
this needs a light-mode equivalent (see the light-mode table above) since ambient shadows read
very differently on white.

## Component tokens

**Primary action button (acid lime)** — bg `#e4f222`, text `#08090a`, radius 6px, padding
`10px 16px`, Inter 14px/510/-0.011em, inset shadow stack. One per view, never decorative.

**Secondary/ghost button** — transparent bg, 1px `#23252a` border, text `#d0d6e0`, radius 6px,
padding `8px 12px`, Inter 13px/400.

**Sign-up button (pill)** — bg `#ffffff`, text `#08090a`, radius 9999px, padding `8px 16px`,
Inter 13px/510.

**Pill/tag button** — bg `rgba(255,255,255,0.05)`, text `#d0d6e0`, radius 9999px, padding
`4px 12px`, Inter 12–13px/400.

**Card (product frame)** — bg `#0f1011`, radius 12px, inset 1px `#23252a` border via box-shadow,
padding 24px. Hairline borders define edges, no outer shadows.

**Text input** — bg `rgba(255,255,255,0.02)`, border 1px `rgba(255,255,255,0.08)`, text
`#d0d6e0`, radius 6px, padding `12px 14px`, Inter 14px/400. Focus: border brightens to `#d0d6e0`.

**Badge/status tag** — bg `rgba(255,255,255,0.05)`, text `#8a8f98`, radius 4px, padding `0px 6px`,
Inter 12px/400. Color variants: `#27a644` success, `#eb5757` error, `#6366f1` tags, `#8b5cf6`
secondary.

## Design guidelines

**Do:**
- Use Inter Variable with OpenType features `'cv01' on, 'ss03' on, 'zero' on`.
- Reserve `#e4f222` exclusively for a single primary action per view.
- Body text at 16px Inter 400, line-height 1.5.
- -0.022em tracking at 48px and above for display type.
- 3-radius vocabulary: 12px cards, 6px buttons, 9999px pills.
- Hairline borders (`#23252a` or `#383b3f`) for surface separation, not shadows.
- 96px section gaps, 8px element gaps.

**Don't:**
- Bold weights (700+) — cap at 590.
- Decorative gradients on buttons, cards, or text.
- More than one chromatic accent button per view.
- Large radii (16px+) on cards.
- Shadows for card separation.
- Chromatic text colors on body copy.
- Berkeley Mono for headings or marketing copy.

## Imagery & layout principles

- Product-screenshot-first (real UI, no stock photography).
- Customer logos in neutral grey (`#8a8f98`), uniform size.
- Minimal line-art SVG icons, greyscale.
- Hero gradient: dark-to-light linear wash, no literal scenery.
- Max-width 1200px, centered, full-bleed backgrounds.
- Left-aligned oversized headlines (64–72px) with right-aligned link CTAs.
- Section rhythm: 96px vertical gaps, 2-column text/image compositions.
- No 3-column grids or masonry — single focal point per screen.
- Fixed top nav (left logo, right links) — no sidebar, no mega-menu.

## Open items before this can drive the actual redesign

1. Derive and validate a full light-mode token set (see table above) — contrast-checked, not a
   blind inversion.
2. Decide how this maps onto kUInetic's existing `--ink`/`--dim`/`--bg`/`--panel`/`--accent`/
   `--line` custom-property names in `demo/style.css`, or whether those get replaced outright by
   this system's token names.
3. Reconcile the "one chromatic accent, acid lime" rule with kUInetic's current single accent
   (`--accent: #d2691e`, a burnt orange) — this is a full accent-color swap, not additive.

## Second base palette — black-on-yellow (from gold-board Framer reference)

Added per direction, sourced from https://gold-board-435065.framer.app/ (dark mode), values
confirmed via live computed-style inspection (not estimated). This is a **second, distinct base
color pairing** for use on one or more of the "Designs" showcase pages — not a replacement for
the acid-lime Linear palette above. Treat the two as separate palette options a given design page
picks one of, not values that mix on the same page. Notably close in hue family to Linear's own
acid-lime `#e4f222` — both are yellow-green "signal" colors — so this palette reads as a bolder,
more saturated sibling of the Linear accent rather than an unrelated color choice.

| Name | Value | Usage on the reference site |
|---|---|---|
| Signal Yellow | `#e0f11f` (`rgb(224, 241, 31)`) | Large surface fills (buttons, highlighted blocks) — used broadly, not restricted to one CTA the way Linear's acid-lime is |
| Page Canvas (dark) | `#121212` (`rgb(18, 18, 18)`) | Near-black body background |
| Ink on Yellow | `#000000` | Text/icon color sitting on yellow fills — pure black, full contrast |
| Off-white text | `#f0f0f0` (`rgb(240, 240, 240)`) | Primary text on the dark canvas |
| Pure white | `#ffffff` | Secondary surfaces/text on dark |

Still needs: a light-mode pairing if this palette is also meant to support one, and a decision on
which "Designs" page(s) use it (not yet assigned).
