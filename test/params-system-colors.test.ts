import { describe, expect, it } from 'vitest'
import { validate } from '../src/core/params.js'
import type { ParamSpec } from '../src/core/types.js'

/**
 * The CSS system colours, which closing `COLOR_KEYWORDS` to a set took away by accident.
 *
 * The check used to be `/^[a-z]+$/i` — any run of letters — so `Canvas`, `Highlight`, `ButtonFace`
 * and the rest passed without anyone deciding they should. Replacing it with a closed set of named
 * colours plus `transparent`/`currentcolor` was right about `tint:banana`, and silently dropped all
 * nineteen of these: `glass tint:Canvas` and `proximity-glow color:Highlight` began warning
 * "not a valid color" and falling back to their defaults.
 *
 * That is not a cosmetic loss. System colours are the *only* colours that mean anything under
 * `forced-colors: active` — they are how a page speaks to a high-contrast theme instead of painting
 * over it — and this library's own `css/forms.css` reaches for `Highlight` in exactly that block.
 * Regression found in the 2026-09-08 catalog review.
 *
 * Their own file rather than `params.test.ts`'s colour block, which is over its line cap.
 */

const tint: ParamSpec = { type: 'color', default: '', cssProperty: '--kui-tint' }

/** CSS Color 4's `<system-color>` production, in full. */
const SYSTEM_COLORS = [
  'AccentColor', 'AccentColorText', 'ActiveText', 'ButtonBorder', 'ButtonFace', 'ButtonText',
  'Canvas', 'CanvasText', 'Field', 'FieldText', 'GrayText', 'Highlight', 'HighlightText',
  'LinkText', 'Mark', 'MarkText', 'SelectedItem', 'SelectedItemText', 'VisitedText',
]

describe('CSS system colours are valid colour values', () => {
  it.each(SYSTEM_COLORS)('accepts %s', (value) => {
    expect(validate(value, tint), value).toMatchObject({ ok: true })
  })

  it('matches them case-insensitively, the way CSS keywords work', () => {
    // The set is spelled lowercase and read through `value.toLowerCase()`. Authors will write
    // `Canvas` (the spec's casing), so the two halves of that have to agree.
    for (const value of ['canvas', 'CANVAS', 'hIgHlIgHt', 'buttonface'])
      expect(validate(value, tint), value).toMatchObject({ ok: true })
  })

  it('still rejects the deprecated CSS2 system colours', () => {
    // Deliberately absent. These were removed from the spec, browsers map them to arbitrary
    // substitutes, and a validator that accepts them is back to guessing — which is the thing the
    // closed set was introduced to stop.
    for (const value of ['ButtonShadow', 'InfoBackground', 'ThreeDFace', 'InactiveCaption', 'Window'])
      expect(validate(value, tint), value).toMatchObject({ ok: false })
  })

  it('still rejects a word CSS has never defined, so the set did not just reopen', () => {
    for (const value of ['banana', 'canvastext2', 'highlighted'])
      expect(validate(value, tint), value).toMatchObject({ ok: false })
  })
})
