# CLAUDE.md

Read AGENTS.md before starting any work in this repository.

## Design work

For any visual/design work on `demo/*.html` (layout, typography, spacing, imagery, motion, hero/section composition — not pure bug fixes), act as the `AI-Dev-Shop/agents/web-design` agent by default: load its `skills.md` and the `ui-ux-design` skill bundle it points to (`AI-Dev-Shop/skills/ui-ux-design/SKILL.md` + the premium-ui reference bundle) before proposing or making changes. Don't wait to be asked to "be the web design agent" — this is the default posture for this repo's demo pages.

## Show-code chips

`.kui-show-code-toggle` is styled once, in `demo/system.css`, as an **accent outline chip** that
fills with `--accent` on hover and focus. That is the treatment on every demo page — a control
meaning the same thing everywhere should look the same everywhere.

Do not re-style it per page. If a page needs a variation, override the one property that differs
(`scroll.html` overrides only `opacity`, for chip density) rather than restating the chip. The one
real exception is a surface already painted with `--accent`, where an accent chip is invisible and
has to fall back to `currentColor`.

Any new page in the CSS-animations set inherits this by default. Check it does before shipping.
