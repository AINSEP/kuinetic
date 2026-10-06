import type { ParamNotes } from '../core/describe.js'

/**
 * `showcase/*` (compare, device-frame, hotspots, lightbox, scroll-story, slideshow, slow-mo) and
 * the step decks in `effects/carousel/*` and `effects/step-index.ts` (spatial-ring, spatial-stack,
 * step-progress).
 */
export const SHOWCASE_NOTES: ParamNotes = {
  'compare.position': 'Where the divider starts between two images, as a share of the width.',
  'compare.positions': {
    why: 'Where each divider starts when comparing three or more images, as one quoted list.',
    whenOmitted: 'Dividers are spaced evenly.',
  },
  'compare.axis': 'Whether the divider moves left-right or up-down.',
  'compare.autoplay': {
    why: 'Makes the divider sweep back and forth by itself, until someone grabs it.',
    whenOmitted: 'Never: the divider stays put until dragged.',
  },
  'compare.duration': 'How long one sweep of the divider takes, edge to edge. Only used with autoplay.',
  'compare.reverse': 'Start the sweep toward the other edge first. Only used with autoplay.',
  'compare.loop': {
    why: 'Keep sweeping back and forth until someone takes the handle. Only used with autoplay.',
    whenOmitted: 'Off: it sweeps once and stops.',
  },

  'device-frame.kind': 'Which device the content is framed in: browser window, phone, tablet or laptop.',
  'device-frame.color': 'Colour of the device body around the screen.',
  'device-frame.radius': {
    why: 'How rounded the outer corners of the device are.',
    whenOmitted: 'Each device keeps its own natural corner size.',
  },
  'device-frame.screen-radius': {
    why: 'How rounded the corners of the screen inside the device are.',
    whenOmitted: 'The screen follows the outer corners, less the bezel, and is always at least a little rounded.',
  },

  'hotspots.target': {
    why: 'Which elements are the notes, one marker each.',
    whenOmitted: 'Uses the items of the list directly inside it.',
  },
  'hotspots.marker': 'Whether each marker shows its number or is a plain dot.',
  'hotspots.scope': {
    why: 'Whether the notes are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },

  'lightbox.media': 'What opens in the viewer: pictures, videos, or a mix of both.',
  'lightbox.target': {
    why: 'Which elements open the viewer when clicked.',
    whenOmitted: 'Uses the links (and pictures) inside it.',
  },
  'lightbox.scope': {
    why: 'Whether the clickable items are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },
  'lightbox.scale': 'How small the picture starts as it grows into the viewer; 1 means no zoom.',
  'lightbox.loop': {
    why: 'Whether the arrows wrap from the last item back to the first.',
    whenOmitted: 'On: it wraps around.',
  },
  'lightbox.aspect': {
    why: 'Forces the video frame to a wide, tall or square shape.',
    whenOmitted: 'Tall for a YouTube Shorts link, wide for every other video.',
  },
  'lightbox.caption': 'Where the line under each item comes from, or none to hide it.',
  'lightbox.arrows': {
    why: 'Where the previous and next arrows sit: a corner, top or bottom, apart, or on the sides.',
    whenOmitted: 'Bottom right, side by side, clear of the picture.',
  },
  'lightbox.arrow-gap': {
    why: 'The space between the two arrows when they sit together.',
    whenOmitted: 'Half a line of space.',
  },

  'scroll-story.target': {
    why: 'Which elements are the pictures or clips that change as you scroll.',
    whenOmitted: 'Uses the children of its first child.',
  },
  'scroll-story.sections': {
    why: 'Which elements are the text steps you scroll through.',
    whenOmitted: 'Uses the children of its last child.',
  },
  'scroll-story.offset-top': 'How far down the screen a step must reach before it counts as current.',
  'scroll-story.side': 'Which side of the screen the pinned pictures sit on.',

  'slideshow.target': {
    why: 'Which elements are the slides.',
    whenOmitted: 'Uses the items of the list directly inside it.',
  },
  'slideshow.scope': {
    why: 'Whether the slides are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },
  'slideshow.next': {
    why: 'Your own next button, looked for inside first, then on the page. Replaces the built-in controls.',
    whenOmitted: 'Uses the built-in controls instead.',
  },
  'slideshow.prev': {
    why: 'Your own previous button, looked for inside first, then on the page. Replaces the built-in controls.',
    whenOmitted: 'Uses the built-in controls instead.',
  },
  'slideshow.jump': {
    why: 'Your own buttons, each jumping to the slide at its position. Replaces the built-in controls.',
    whenOmitted: 'Uses the built-in controls instead.',
  },
  'slideshow.controls': 'Which built-in controls appear: dots, arrows, both, or none. Ignored once next, prev or jump is set.',
  'slideshow.autoplay': {
    why: 'How long each slide shows before moving on by itself; 2s at least.',
    whenOmitted: 'Off. It also stays off with controls:none or your own next, prev or jump buttons.',
  },
  'slideshow.transition': 'Whether slides cross-fade or slide sideways.',
  'slideshow.swipe': 'Whether a left or right swipe changes the slide.',
  'slideshow.mute': {
    why: 'Your own button, inside the slideshow, that mutes and unmutes the video on the current slide.',
    whenOmitted: 'No mute button.',
  },

  'slow-mo.rate': 'How slow motion runs; 0.25 plays at a quarter of normal speed.',
  'slow-mo.controls': 'Whether a toggle button is added, or slow motion is just always on.',

  'spatial-ring.grab': 'Whether people can drag the ring with a finger or mouse.',
  'spatial-ring.travel': 'How many pixels of dragging move the ring by one card.',
  'spatial-ring.target': {
    why: 'Which elements are the cards.',
    whenOmitted: 'Uses its direct children.',
  },
  'spatial-ring.next': {
    why: 'Your own button that turns the ring to the next card, looked for inside first, then on the page.',
    whenOmitted: 'No button; use drag, keys or autoplay.',
  },
  'spatial-ring.prev': {
    why: 'Your own button that turns the ring back a card, looked for inside first, then on the page.',
    whenOmitted: 'No button; use drag, keys or autoplay.',
  },
  'spatial-ring.jump': {
    why: 'Your own buttons, each turning the ring to the card at its position; inside first, then the page.',
    whenOmitted: 'No jump buttons.',
  },
  'spatial-ring.pause': {
    why: 'Your own button that pauses and resumes spin or autoplay, looked for inside first, then the page.',
    whenOmitted: 'No pause button; hovering still pauses.',
  },
  'spatial-ring.hover': {
    why: 'Whether resting the mouse on the ring pauses spin or autoplay. none keeps it moving.',
    whenOmitted: 'Hovering pauses it. Keyboard focus and the pause button always pause.',
  },
  'spatial-ring.spin': {
    why: 'Turns the ring slowly all the time; this is the time for one full turn.',
    whenOmitted: 'Off: the ring moves only when asked. A negative time turns it backwards.',
  },
  'spatial-ring.autoplay': {
    why: 'How long the ring rests on each card before turning to the next; 2s at least.',
    whenOmitted: 'Off. If spin is also set, spin wins.',
  },
  'spatial-ring.lightbox': {
    why: 'Clicking a card opens all the cards in a full-screen viewer.',
    whenOmitted: 'Off: clicks do nothing special.',
  },
  'spatial-ring.scope': {
    why: 'Whether the cards are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },
  'spatial-ring.tilt': 'How far the camera looks down on the ring; negative looks up from below.',
  'spatial-ring.arc': 'How much of a full circle the cards spread over; less makes a curved slice.',
  'spatial-ring.radius': {
    why: 'How wide the ring is; a bigger ring spaces cards further apart.',
    whenOmitted: 'Sized from the card width so neighbours just fit. Shrinks if it would overflow the page.',
  },
  'spatial-ring.gap': 'Breathing room between neighbouring cards when the ring size is worked out for you.',
  'spatial-ring.perspective': 'How close the camera is; smaller values make the 3D look more dramatic.',
  'spatial-ring.facing': 'Whether cards turn outward with the ring or always face you so text stays readable.',
  'spatial-ring.plane': 'Whether the ring turns toward you in depth, or lies flat like a clock face.',

  'spatial-stack.grab': 'Whether people can drag the stack with a finger or mouse.',
  'spatial-stack.travel': 'How many pixels of dragging move the stack by one card.',
  'spatial-stack.target': {
    why: 'Which elements are the cards.',
    whenOmitted: 'Uses its direct children.',
  },
  'spatial-stack.next': {
    why: 'Your own button that brings up the next card, looked for inside first, then on the page.',
    whenOmitted: 'No button; use drag, keys or autoplay.',
  },
  'spatial-stack.prev': {
    why: 'Your own button that brings back the previous card, looked for inside first, then on the page.',
    whenOmitted: 'No button; use drag, keys or autoplay.',
  },
  'spatial-stack.jump': {
    why: 'Your own buttons, each bringing up the card at its position; inside first, then the page.',
    whenOmitted: 'No jump buttons.',
  },
  'spatial-stack.pause': {
    why: 'Your own button that pauses and resumes spin or autoplay, looked for inside first, then the page.',
    whenOmitted: 'No pause button; hovering still pauses.',
  },
  'spatial-stack.hover': {
    why: 'Whether resting the mouse on the stack pauses spin or autoplay. none keeps it moving.',
    whenOmitted: 'Hovering pauses it. Keyboard focus and the pause button always pause.',
  },
  'spatial-stack.spin': {
    why: 'Cycles the cards slowly all the time; this is the time for one full pass.',
    whenOmitted: 'Off: the stack moves only when asked. A negative time runs it backwards.',
  },
  'spatial-stack.autoplay': {
    why: 'How long the front card rests before the next comes up; 2s at least.',
    whenOmitted: 'Off. If spin is also set, spin wins.',
  },
  'spatial-stack.lightbox': {
    why: 'Clicking a card opens all the cards in a full-screen viewer.',
    whenOmitted: 'Off: clicks do nothing special.',
  },
  'spatial-stack.scope': {
    why: 'Whether the cards are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },
  'spatial-stack.shift': 'How far each card behind steps sideways; negative steps left.',
  'spatial-stack.rise': 'How far each card behind steps up; negative steps down.',
  'spatial-stack.shrink': 'How much smaller each card behind gets, per place back.',
  'spatial-stack.blur': 'How much blurrier each card behind gets, per place back.',
  'spatial-stack.fade': 'How much fainter each card behind gets, per place back.',
  'spatial-stack.depth': 'How many cards show behind the front one; the rest wait hidden.',

  'step-progress.duration': 'Passed to your slide styles; autoplay also waits this long after someone moves it.',
  'step-progress.delay': 'Passed to your slide styles to use as a start wait; the library adds no pause itself.',
  'step-progress.ease': 'Passed to your slide styles to use as their speed curve.',
  'step-progress.steps': {
    why: 'The number of steps, for when the elements cannot tell it.',
    whenOmitted: 'Counts the step elements itself.',
  },
  'step-progress.target': {
    why: 'Which elements are the steps.',
    whenOmitted: 'Uses its direct children.',
  },
  'step-progress.next': {
    why: 'Your own button that moves to the next step, looked for inside first, then on the page.',
    whenOmitted: 'With no next, prev, jump or pause, a click on it moves on, unless lightbox is on.',
  },
  'step-progress.prev': {
    why: 'Your own button that moves to the previous step, looked for inside first, then on the page.',
    whenOmitted: 'With no next, prev, jump or pause, a click on it moves on, unless lightbox is on.',
  },
  'step-progress.jump': {
    why: 'Your own buttons, each moving to the step at its position; inside first, then the page.',
    whenOmitted: 'With no next, prev, jump or pause, a click on it moves on, unless lightbox is on.',
  },
  'step-progress.peek': 'How far, as a share of a slide, your slide styles push neighbours sideways.',
  'step-progress.rest': 'How large your slide styles draw the non-current slides, where 1 is full size.',
  'step-progress.main': 'How large your slide styles draw the current slide, where 1 is full size.',
  'step-progress.autoplay': {
    why: 'How long each step shows before moving on by itself; 2s at least.',
    whenOmitted: 'Off: steps change only when someone asks.',
  },
  'step-progress.pause': {
    why: 'Your own button that pauses and resumes autoplay, looked for inside first, then on the page.',
    whenOmitted: 'No pause button; hovering still pauses.',
  },
  'step-progress.hover': {
    why: 'Whether resting the mouse on the deck pauses autoplay. none keeps it moving.',
    whenOmitted: 'Hovering pauses it. Keyboard focus and the pause button always pause.',
  },
  'step-progress.lightbox': {
    why: 'Clicking a slide opens all the slides in a full-screen viewer.',
    whenOmitted: 'Off: clicking a slide moves to the next one.',
  },
  'step-progress.scope': {
    why: 'Whether the steps named by target are looked for inside this element or anywhere on the page.',
    whenOmitted: 'Looks anywhere on the page, except under the carousel name, which looks inside.',
  },
}
