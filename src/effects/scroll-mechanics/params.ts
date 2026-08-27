import type { ParameterSchema } from '../../core/types.js'

/**
 * The parameter schemas shared across the scroll-mechanics primitives.
 *
 * Extracted from `primitives.ts`, which sits close enough to the 400-line cap that adding one
 * parameter pushes it over. They belong together anyway: these are the knobs more than one
 * primitive declares, and the whole point of declaring them once is that `pin` and `media-scrub`
 * cannot drift apart on what a hold means.
 */

export const distanceParam: ParameterSchema = {
  distance: { type: 'length', default: '100vh', cssProperty: '--kui-distance' },
}

/**
 * Shared by every primitive that has to hold still while its scroll range passes.
 *
 * `pin` and `media-scrub` were solving the same problem twice from opposite ends. The pin declared
 * both of these and did the work; the scrub declared neither and left it to the page, which is why
 * `demo/scroll.html` carried a `.scrub-stage` whose entire job was `height: 260vh` and a
 * `.scrub-viewport` whose entire job was `position: sticky`. Two hand-written boxes to restate
 * something the library already knew, because `distance:` was on the attribute the whole time.
 *
 * Declaring it once means the two cannot drift, and it is what lets a scrub become one attribute
 * with no wrapper at all.
 */
export const stickyParams: ParameterSchema = {
  'offset-top': {
    type: 'length',
    default: 'var(--kui-pin-offset, 0px)',
    cssProperty: '--kui-offset-top',
  },
  spacer: {
    type: 'keyword',
    default: 'false',
    cssProperty: '--kui-spacer',
    values: ['true', 'false'],
  },
}
