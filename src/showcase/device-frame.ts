import { attributeChannel } from '../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

/**
 * `device-frame` — the pattern-proving showcase widget (Phase 1).
 *
 * Wraps one media/content child in a device chrome — a browser bezel, a phone notch, a tablet or
 * laptop frame — without cropping or replacing it. Every visible pixel of the chrome is CSS
 * (`showcase.css`): a `border`/`border-radius`/`padding` bezel, a `::before` top bar for
 * `kind:browser`, a `::after` notch for `kind:phone`. None of that can key off a CSS custom
 * property's *value* — style queries (`@container style(--kui-device-kind: phone)`) are not in
 * Firefox — so the one thing JavaScript does here is stamp `data-kui-device="<kind>"`, an
 * attribute the stylesheet branches on freely.
 *
 * The child is the screen: CSS rounds it concentric with the bezel — each corner the outer radius
 * less the border and that side's padding — from the same custom properties the bezel is drawn
 * with, so `radius:` moves both and nothing here measures a box. Where the bezel is deeper than
 * the radius (the browser bar, the laptop's base) that difference is negative, so each corner is
 * floored at the frame's own radius, up to 8px: a framed screen never reads square unless the
 * frame itself is (`radius:0px`). `screen-radius:` replaces the derived value outright.
 *
 * That is also the whole reason this primitive is `renderer: 'javascript'` rather than
 * `'css-keyframes'`: there is no keyframe, and the stamp is the entire effect.
 */

const DEVICE_FRAME_KINDS = ['browser', 'phone', 'tablet', 'laptop'] as const

/**
 * `radius`'s unset sentinel — see `catalog/materials.ts`'s `UNSET` for the full argument. Each
 * `kind` has its own resting corner radius in `showcase.css`'s `var(--kui-device-radius, …)`
 * fallback; a real default here would pick one of those four for every kind, overriding the other
 * three's own look the moment an author left `radius:` unwritten. `screen-radius:` shares it for
 * the same reason: its resting value is derived per kind, per corner, in `showcase.css`.
 */
const RADIUS_UNSET = ''

const deviceFrameParams: ParameterSchema = {
  kind: {
    type: 'keyword',
    default: 'browser',
    // Declared even though no shipped rule reads this custom property back — `data-kui-device`
    // carries the value CSS actually branches on. Every `ParamSpec` needs a `cssProperty`
    // regardless of who consumes it (`core/types.ts`'s own note on the field), and JS primitives
    // reading their own keyword straight from `EffectParams` rather than `var()` is the norm, not
    // the exception — `scramble-text`'s `charset` is the field's own example of the shape.
    cssProperty: '--kui-device-kind',
    keywords: [...DEVICE_FRAME_KINDS],
  },
  color: { type: 'color', default: '#111', cssProperty: '--kui-device-color' },
  radius: { type: 'length', default: RADIUS_UNSET, cssProperty: '--kui-device-radius' },
  // Its own knob rather than a reading of `radius:`: the frame's corner and the screen's are two
  // shapes, and the derived screen value already follows `radius:` when this is left unwritten.
  'screen-radius': { type: 'length', default: RADIUS_UNSET, cssProperty: '--kui-device-screen-radius' },
}

/**
 * Stamp the frame kind once, synchronously, through an attribute ledger so teardown restores
 * whatever `data-kui-device` (or its absence) the author had before — including none at all.
 *
 * `continuousSetup`, not a resolved completion: like `rotate-static`/`glass`, this writes a
 * persistent state and never animates, so there is no moment at which it would be honest to
 * report `data-kui-state="finished"`.
 *
 * @complexity O(1) time and space.
 */
function prepareDeviceFrame(el: Element, params: EffectParams): SetupResult {
  const state = createAttributeLedger(el)
  state.set('data-kui-device', params.text('kind', 'browser'))
  return continuousSetup(() => state.restore())
}

export const DEVICE_FRAME_PRIMITIVE: Primitive = widgetPrimitive(
  'device-frame',
  {
    // Exclusive ownership of the frame chrome. Its static box-model declarations are outside
    // the channel-property audit, as they are for the existing catalog. The chrome also reaches
    // into the direct media child (`object-fit: cover` etc.); that is a `requiresOwnSubtree`
    // question, as with the other showcase widgets. The frame kind it stamps on the host is an
    // attribute it writes, so it claims that too.
    channels: ['frame', attributeChannel('data-kui-device')],
    parameters: deviceFrameParams,
    // `'layout'`: the bezel's `border`+`padding` are box-model properties added once, at
    // activation, which is a real (if one-time) layout — not the "transform/opacity only" budget
    // `'compositor'` promises, and not a repeated cost the way `'continuous'`/`'paint'` describe.
    perfClass: 'layout',
  },
  withTimingContract(
    'device-frame',
    {
      because:
        'it stamps its frame kind once, synchronously, on activation; there is no motion to time',
    },
    deferPrepare(prepareDeviceFrame),
  ),
)

export const DEVICE_FRAME_PRESETS: Preset[] = [
  { name: 'device-frame', primitive: 'device-frame', requiresOwnSubtree: true },
]
