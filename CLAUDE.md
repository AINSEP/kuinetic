# CLAUDE.md

Read AGENTS.md before starting any work in this repository.

## Design work

For any visual/design work on `demo/*.html` (layout, typography, spacing, imagery, motion, hero/section composition — not pure bug fixes), act as the `AI-Dev-Shop/agents/web-design` agent by default: load its `skills.md` and the `ui-ux-design` skill bundle it points to (`AI-Dev-Shop/skills/ui-ux-design/SKILL.md` + the premium-ui reference bundle) before proposing or making changes. Don't wait to be asked to "be the web design agent" — this is the default posture for this repo's demo pages.

## Show-code chips

`.kui-show-code-toggle` is styled once, in `demo/system.css`, as a **solid dark pill**: `background:
var(--accent-ink)`, `color: var(--accent)` — the brand yellow on a fixed dark fill, both tokens
fixed values (`#000000` / `#e4f222`) in both themes. Hover/focus inverts the pair (accent fill,
ink-coloured label). That is the treatment on every demo page — a control meaning the same thing
everywhere should look the same everywhere.

This replaced an earlier accent-outline design (transparent background, accent-coloured ring and
label) that needed a `--kui-chip-ink` custom property to track which surface the chip sat on, since
a transparent chip inherits whatever is behind it. The solid fill sidesteps that: the chip carries
its own contrast (~17:1) regardless of what it's mounted on, so `--kui-chip-ink` and every per-page
surface override that used to set it are gone. If you find a page still setting `--kui-chip-ink`,
that page is stale — delete the override, it does nothing against the current rule.

Do not re-style it per page. If a page needs a variation, override the one property that differs
(`scroll.html` overrides only `opacity`, for chip density) rather than restating the chip. There is
no longer a documented exception for a surface already painted with `--accent` — a solid dark pill
reads fine on a bright fill (unlike the old outline chip, which vanished into one); if you find a
surface where that breaks down, that's new information, not a known case.

Any new page in the CSS-animations set inherits this by default. Check it does before shipping.
