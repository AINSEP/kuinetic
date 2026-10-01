import type { ParamNotes } from '../core/describe.js'

/** `effects/catalog/interaction-reveal.ts`. */
export const INTERACTION_REVEAL_NOTES: ParamNotes = {
  'hover-intent.duration': 'How long the hint takes to fade in once it shows.',
  'hover-intent.delay': "How long the pointer must rest first, so a mouse just passing over doesn't pop the hint.",
  'hover-intent.ease': 'The speed curve of the hint fading in.',
  'hover-intent.distance': 'How far the hint rises as it appears.',
  'hover-intent.color': 'Text colour of the hint card.',
  'hover-intent.bg-color': 'Background colour of the hint card.',
  'hover-intent.radius': 'How rounded the hint card corners are.',
  'hover-intent.place': {
    why: 'Where the hint sits: above, below, or flip below when there is no room above.',
  },
  'hover-intent.tease': {
    why: 'Show the hint once by itself on arrival, so people know it is there.',
    whenOmitted: 'Off: the hint only shows on hover or focus.',
  },
  'hover-intent.target': {
    why: 'Which child is the hint, when it is not marked with data-kui-hint.',
    whenOmitted: 'Uses the child marked data-kui-hint.',
  },
}
