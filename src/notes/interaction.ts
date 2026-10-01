import type { ParamNotes } from '../core/describe.js'

/**
 * `effects/catalog/interaction.ts`, `interaction-reveal.ts` (all but hover-intent, noted in
 * `notes/interaction-reveal.ts`), `interaction-states.ts` and `interaction-proximity.ts`.
 */
export const INTERACTION_NOTES: ParamNotes = {
  'anchored-preview.distance': 'How far the preview travels as it pops in.',
  'anchored-preview.gap': 'How much space is left between the preview and what it points at.',
  'anchored-preview.scale': 'How small the preview starts before it grows to full size.',
  'anchored-preview.color': {
    why: 'Text colour of the preview.',
    whenOmitted: 'Keeps the surrounding text colour.',
  },
  'anchored-preview.bg-color': {
    why: 'Background colour of the preview.',
    whenOmitted: 'No background, so a picture or your own styling shows as it is.',
  },
  'anchored-preview.radius': {
    why: 'How rounded the preview corners are.',
    whenOmitted: 'Square corners.',
  },
  'anchored-preview.place': {
    why: 'Which side the preview sits on, or auto to flip to the other side when there is no room.',
  },
  'anchored-preview.tease': {
    why: 'Show the preview once by itself on arrival, so people know it is there.',
    whenOmitted: 'Off: the preview only shows on hover or focus.',
  },
  'anchored-preview.target': {
    why: 'Which child is the preview, when it is not marked with data-kui-preview.',
    whenOmitted: 'Uses the child marked data-kui-preview.',
  },

  'beam-border.duration': 'How long one full lap of the light around the border takes.',
  'beam-border.delay': 'How long the pointer waits before the light starts circling.',
  'beam-border.color': {
    why: 'Colour of the travelling light.',
    whenOmitted: 'A four-colour rainbow.',
  },
  'beam-border.outset': {
    why: 'Pushes the ring outward, to sit over a border the element already has.',
    whenOmitted: 'The ring sits just inside any existing border.',
  },
  'beam-border.arc': 'How much of the ring is lit: a short dash or a nearly full ring.',
  'beam-border.softness': 'How gradually the light fades in at its leading edge.',

  'beam-border-auto.duration': 'How long one full lap of the light around the border takes.',
  'beam-border-auto.color': {
    why: 'Colour of the travelling light.',
    whenOmitted: 'A four-colour rainbow.',
  },
  'beam-border-auto.outset': {
    why: 'Pushes the ring outward, to sit over a border the element already has.',
    whenOmitted: 'The ring sits just inside any existing border.',
  },
  'beam-border-auto.arc': 'How much of the ring is lit: a short dash or a nearly full ring.',
  'beam-border-auto.softness': 'How gradually the light fades in at its leading edge.',

  'border-draw.color': {
    why: 'Colour of the border that draws itself.',
    whenOmitted: 'Uses the page accent colour.',
  },
  'border-draw.width': 'How thick the drawn border is.',
  'border-draw.outset': {
    why: 'Pushes the drawn border outward, to sit over a border the element already has.',
    whenOmitted: '0px: the line sits at the element edge.',
  },

  'border-glow.color': {
    why: 'Colour of the glowing outline.',
    whenOmitted: 'Uses the page accent colour.',
  },

  'cursor-follow.stiffness': 'Higher snaps the dot to the pointer faster; lower feels looser.',
  'cursor-follow.damping': 'Higher stops the dot wobbling sooner; lower lets it overshoot.',
  'cursor-follow.mass': 'Higher makes the dot feel heavier and slower to start and stop.',
  'cursor-follow.label': {
    why: 'Text shown inside the dot that follows the pointer.',
    whenOmitted: 'The dot has no text.',
  },

  'cursor-invert.stiffness': 'Higher snaps the dot to the pointer faster; lower feels looser.',
  'cursor-invert.damping': 'Higher stops the dot wobbling sooner; lower lets it overshoot.',
  'cursor-invert.mass': 'Higher makes the dot feel heavier and slower to start and stop.',
  'cursor-invert.label': {
    why: 'Text shown inside the dot that follows the pointer.',
    whenOmitted: 'The dot has no text.',
  },

  'cursor-label.stiffness': 'Higher snaps the dot to the pointer faster; lower feels looser.',
  'cursor-label.damping': 'Higher stops the dot wobbling sooner; lower lets it overshoot.',
  'cursor-label.mass': 'Higher makes the dot feel heavier and slower to start and stop.',
  'cursor-label.label': {
    why: 'Text shown inside the dot that follows the pointer.',
    whenOmitted: 'The dot has no text.',
  },

  'cursor-lag.stiffness': 'Higher snaps the dot to the pointer faster; lower feels looser.',
  'cursor-lag.damping': 'Higher stops the dot wobbling sooner; lower lets it overshoot.',
  'cursor-lag.mass': 'Higher makes the dot feel heavier and slower to start and stop.',
  'cursor-lag.label': {
    why: 'Text shown inside the dot that follows the pointer.',
    whenOmitted: 'The dot has no text.',
  },

  'group-dim.delay': 'How long the pointer rests before the others dim, so passing over does not flicker.',
  'group-dim.opacity': 'How faded the other items get; lower is dimmer.',

  'icon-spin.duration': 'How long one full turn of the icon takes.',

  'label-swap.distance': {
    why: 'How far each label slides as it swaps; 100% is a full label height.',
  },

  'lift.distance': 'How far the element rises on hover.',
  'lift-shadow.distance': 'How far the element rises on hover.',

  'pop.scale': 'How much bigger the element grows on hover; 1 is no change.',

  'press.delay': 'How long to hold before the press shows.',
  'press.scale': 'How small the element shrinks while pressed; 1 is no change.',
  'press.depth': 'How far the shadow sinks in while pressed, to look pushed down.',
  'press.color': {
    why: 'Colour of the shadow that shows while pressed.',
    whenOmitted: 'A soft dark shadow.',
  },

  'proximity-glow.color': {
    why: 'Colour of the glow on the edge nearest the pointer.',
    whenOmitted: 'Uses the page accent colour.',
  },
  'proximity-glow.radius': 'How far from the pointer the glow reaches before it fades out.',
  'proximity-glow.width': 'How thick the glowing edge line is.',
  'proximity-glow.outset': {
    why: 'Pushes the glowing edge outward, to sit over a border the element already has.',
    whenOmitted: '0px: the line sits at the element edge.',
  },

  'search-expand.collapsed': 'How wide the search box is while resting.',
  'search-expand.width': 'How wide the search box grows to when opened.',

  'shine-sweep.color': {
    why: 'Colour of the shiny band that sweeps across.',
    whenOmitted: 'A soft translucent white.',
  },
  'shine-sweep.angle': 'The tilt of the shiny band as it crosses.',
  'shine-sweep.width': 'How wide the shiny band is, as a share of the element.',

  'tilt-3d.maxAngle': 'The most it tilts, in degrees, with the pointer at its edge; mouse or trackpad only.',
  'tilt-3d.perspective': 'How strong the 3D depth looks; a smaller distance looks more dramatic.',

  'tilt-parallax.strength': 'Pixels a data-depth="1" layer shifts with the pointer at the edge; other depths scale it.',

  'underline-center.color': {
    why: 'Colour of the underline.',
    whenOmitted: 'Uses the text colour.',
  },
  'underline-slide.color': {
    why: 'Colour of the underline.',
    whenOmitted: 'Uses the text colour.',
  },
}
