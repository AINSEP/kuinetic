import type { ParamNotes } from '../core/describe.js'

/** `effects/catalog/ambient.ts`, `media.ts`, `materials.ts`, `transforms.ts`, `view-transitions.ts`. */
export const CATALOG_NOTES: ParamNotes = {
  'ambient-float.duration': 'How long one full up-and-down drift takes, repeating forever.',
  'ambient-float.distance': 'How far the element drifts up and down.',

  'ambient-gradient.duration': 'How long one full colour drift takes, repeating forever.',
  'ambient-gradient.from': {
    why: 'The first colour of the gradient.',
    whenOmitted: 'Uses the effect’s built-in colours.',
  },
  'ambient-gradient.to': {
    why: 'The second colour of the gradient.',
    whenOmitted: 'Uses the effect’s built-in colours.',
  },

  'ambient-gradient-ring.duration': 'How long the colours take to travel once around the edge.',
  'ambient-gradient-ring.from': {
    why: 'The first colour of the glowing edge.',
    whenOmitted: 'Uses the effect’s built-in colours.',
  },
  'ambient-gradient-ring.to': {
    why: 'The second colour of the glowing edge.',
    whenOmitted: 'Uses the effect’s built-in colours.',
  },

  'ambient-orbit.duration': 'How long one full turn takes, repeating forever.',
  'ambient-orbit.angle': 'How far it turns each cycle; 360deg is one full circle.',

  'ambient-pulse.duration': 'How long one swell-and-shrink beat takes, repeating forever.',
  'ambient-pulse.scale': 'How big it swells at the peak; 1.15 is 15% larger.',

  'ambient-tint.duration': 'How long one full drift of the pattern takes, repeating forever.',
  'ambient-tint.from': {
    why: 'The colour of the pattern or glow.',
    whenOmitted: 'Uses the effect’s built-in colour, or the text colour.',
  },

  'background-media.src': {
    why: 'The picture or video file to fill the background with.',
    required: true,
  },
  'background-media.poster': {
    why: 'A still picture shown while the video loads, so the background is never blank.',
    whenOmitted: 'The background stays empty until the first video frame arrives.',
  },
  'background-media.fit': 'Cover crops the media to fill the box; contain shows all of it.',
  'background-media.focus': 'Which part of the picture stays visible when it gets cropped.',
  'background-media.overlay': {
    why: 'A colour laid over the media, so text on top stays readable.',
    whenOmitted: 'No overlay; the media shows at full strength.',
  },
  'background-media.overlay-opacity': 'How strongly the overlay colour covers the media.',
  'background-media.autoplay': {
    why: 'When a video plays: only while on screen, always, or never.',
  },
  'background-media.rate': 'Video speed; 1 is normal, 0.5 is half speed, up to 4.',
  'background-media.loop': 'Whether the video starts over when it ends.',

  'glass.blur': 'How much the content behind the panel is blurred.',
  'glass.saturate': 'How vivid the colours behind the panel look; 1 leaves them unchanged.',
  'glass.opacity': 'How strongly the panel’s tint shows over the blurred background.',
  'glass.tint': {
    why: 'The colour of the frosted glass itself.',
    whenOmitted: 'White-ish glass that follows the page’s colour scheme.',
  },
  'glass.rim': {
    why: 'The colour of the thin edge line, which also colours the top highlight.',
    whenOmitted: 'A faint white edge.',
  },
  'glass.rim-width': 'How thick the thin edge line is.',
  'glass.sheen': 'How bright the soft highlight across the top is; 0 removes it.',
  'glass.radius': {
    why: 'How rounded the corners are; a very large value makes a pill.',
    whenOmitted: 'Rounded corners of 16px, unless the page sets its own.',
  },

  'media-blur-up.distance': 'How far the image rises into place as it sharpens.',
  'media-blur-up.blur': 'How blurry the image starts before it sharpens.',

  'media-ken-burns.distance': 'How far the image pans while it zooms, right and a little up; negative pans the other way.',
  'media-ken-burns.scale': 'How far the image zooms; 1.12 is 12% bigger at the zoomed-in end.',

  'media-lightbox.scale': 'The size it starts at before growing to full size.',

  'media-parallax-frame.distance': 'How far the image shifts as the page scrolls.',

  'rotate-static.angle': {
    why: 'How far to tilt the element, held still.',
    whenOmitted: 'No tilt; the element keeps its own rotation.',
  },

  'slat-assemble.slats': 'How many strips the picture is cut into, from 2 to 24.',
  'slat-assemble.axis': 'Cut the picture into vertical or horizontal strips.',
  'slat-assemble.angle': {
    why: 'Cut the strips at any angle instead; 0deg is vertical, 90deg is horizontal.',
    whenOmitted: 'Follows the axis setting.',
  },
  'slat-assemble.from': {
    why: 'Which strips land first: alternating ends, start, end, outside-in, or scattered.',
  },
  'slat-assemble.fold': {
    why: 'Strips flip in like hinged panels instead of sliding in.',
    whenOmitted: 'Off: strips slide in.',
  },
  'slat-assemble.duration': 'How long each strip takes to land, not the whole run.',

  'view-morph.name': {
    why: 'The shared name that pairs this element with its twin on the other view.',
    whenOmitted: 'Uses the element’s own id, so it needs one.',
  },

  'view-swap.controls': {
    why: 'Which element this control opens and closes, by selector like #panel.',
    whenOmitted: 'Uses the element named by the control’s aria-controls.',
  },
  'view-swap.attribute': {
    why: 'The marker added or removed on that element each time the control is clicked.',
    whenOmitted: 'Uses data-open.',
  },
  'view-swap.type': {
    why: 'Names the transition motion to run, like kui-page-slide; a browser without that feature cross-fades.',
    whenOmitted: 'The browser’s default cross-fade, or an instant swap where view transitions are missing.',
  },
}
