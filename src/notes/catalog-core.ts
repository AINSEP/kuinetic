import type { ParamNotes } from '../core/describe.js'

/**
 * The primitives whose only timelines are scroll-driven (`view`/`scroll`/`pin`), so a clock has no
 * meaning for them in a browser that can link to scroll. They still declare the shared timing four,
 * and those still do something — just not what `*.duration`/`*.delay` say:
 *
 * - On a native `view()`/`scroll()` timeline the compiled `animation-duration`/`-delay` stay times,
 *   which the browser turns into shares of the scroll range — so `delay` starts the motion later in
 *   the range, in proportion to `duration`, and `duration` alone changes nothing.
 * - Under `timeline:pin` the scrub seeks by `delay - progress × head`, so `delay` and `stagger` shift
 *   the start inside the hold the same way (`core/declarations.ts`'s `pinnedDelays`).
 * - In a browser with no scroll-linked animation the effect degrades to a one-shot `on:enter`, where
 *   `duration` *is* the clock (`core/style-plan.ts`'s `effectiveActivation`).
 */
const SCROLL_LINKED = [
  'desaturate',
  'parallax',
  'parallax-rotate',
  'parallax-scale',
  'progress',
  'progress-stroke',
  'scroll-fade',
  'skew',
] as const

const SCROLL_LINKED_TIMING: ParamNotes = Object.fromEntries(
  SCROLL_LINKED.flatMap((id) => [
    [`${id}.duration`, "Scrolling sets the pace; this counts only next to delay, or as a clock where scroll-linking isn't supported."],
    [`${id}.delay`, 'Not a clock wait: it starts the motion later in the scroll range, in proportion to duration.'],
    [`${id}.stagger`, {
      why: 'Starts each item a little later in the scroll range, so a group moves one after another.',
      whenOmitted: 'Every item moves together, unless a parent sets a stagger.',
    }],
  ]),
)

/** `effects/catalog/core.ts` and `effects/catalog/feedback.ts` (entrance, scroll-linked and feedback effects). */
export const CATALOG_CORE_NOTES: ParamNotes = {
  ...SCROLL_LINKED_TIMING,

  'desaturate.from': 'How grey the element is at the start of the scroll range.',
  'desaturate.to': 'How grey the element is at the end of the scroll range.',

  'feedback-burst.scale': 'How much the element swells at the peak of the pop.',
  'feedback-burst.distance': 'How far the confetti flies, as a size or a share of the element.',
  'feedback-burst.fan': 'How wide the confetti spreads sideways; 0 is a narrow fountain.',
  'feedback-burst.size': 'How big each confetti speck is.',
  'feedback-burst.spill': 'How far past the element the confetti is allowed to show.',
  'feedback-burst.color1': { why: 'Colour of the first confetti speck.', whenOmitted: "The page's own --kui-c1 if set, else a pink-red." },
  'feedback-burst.color2': { why: 'Colour of the second confetti speck.', whenOmitted: "The page's own --kui-c2 if set, else amber." },
  'feedback-burst.color3': { why: 'Colour of the third confetti speck.', whenOmitted: "The page's own --kui-c3 if set, else green." },
  'feedback-burst.color4': { why: 'Colour of the fourth confetti speck.', whenOmitted: "The page's own --kui-c4 if set, else blue." },
  'feedback-burst.color5': { why: 'Colour of the fifth confetti speck.', whenOmitted: "The page's own --kui-c5 if set, else purple." },

  'feedback-confirm.duration': 'How long the confirmation takes in total, fade in, hold and fade out.',

  'feedback-dot-pulse.duration': 'How long one full pulse of the dots takes, repeating forever.',
  'feedback-dot-pulse.dotSize': 'How big each of the three dots is.',

  'feedback-heart-burst.scale': 'How much the heart swells at the peak of the pop.',

  'feedback-pop.scale': 'How much the element swells at the peak of the pop.',

  'feedback-progress-track.duration': 'How long the bar takes to sweep across once, repeating forever.',

  'feedback-pull.distance': 'How far the element is pulled down before it springs back.',

  'feedback-ripple.extent': 'How many times larger the ripple grows than the element.',
  'feedback-ripple.color': { why: 'Colour of the ripple disc.', whenOmitted: "Uses the element's own text colour." },
  'feedback-ripple.strength': 'How solid the ripple looks at its brightest, from 0 to 1.',
  'feedback-ripple.startScale': 'How big the ripple begins, as a share of the element.',

  'feedback-shimmer.duration': 'How long one sweep of light takes, repeating forever.',

  'feedback-spin.duration': 'How long one full turn takes, repeating forever.',

  'feedback-toast.distance': 'How far the toast slides as it enters or leaves.',

  'flip-3d.angle': 'How far turned away the element starts, before it flips flat.',
  'flip-3d.perspective': 'How strong the 3D depth looks; smaller is more dramatic.',

  'parallax.distance': 'How far the element drifts against the scroll.',

  'parallax-rotate.angle': 'How far the element has turned by the end of the scroll range.',
  'parallax-rotate.from': 'How far turned the element is at the start of the scroll range.',

  'parallax-scale.scale': 'How big the element is at the end of the scroll range.',
  'parallax-scale.from': 'How big the element is at the start of the scroll range.',

  'progress-stroke.length': {
    why: 'The total length of the line being drawn, so it draws exactly to the end.',
    whenOmitted: 'Assumes a path length of 100.',
  },

  'reveal.distance': 'How far the element travels while it appears.',
  'reveal.opacity': 'How see-through the element is when it starts; 0 is invisible.',

  'reveal-blur.distance': 'How far the element travels while it appears.',
  'reveal-blur.opacity': 'How see-through the element is when it starts; 0 is invisible.',
  'reveal-blur.blur': 'How blurry the element is when it starts.',

  'roll.distance': 'How far the element travels while it rolls in.',
  'roll.angle': 'How far turned the element starts before it rolls upright.',

  'scale-move.distance': 'How far the element travels while it grows in.',
  'scale-move.scale': 'How small the element starts before it grows to full size.',

  'scroll-fade.opacity': 'How see-through the element is at the start of the scroll range.',
}
