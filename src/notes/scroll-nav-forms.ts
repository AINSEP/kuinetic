import type { ParamNotes } from '../core/describe.js'

/**
 * `effects/navigation/index.ts`, `effects/scroll-mechanics/primitives.ts` (+ `scroll-spy.ts`,
 * `params.ts`), `effects/forms/primitives.ts`.
 */
export const SCROLL_NAV_FORMS_NOTES: ParamNotes = {
  'back-to-top-fade.offset': 'How far down the page you scroll, in pixels, before the button appears.',

  'header-hide-on-scroll.offset': {
    why: 'Smallest scroll movement that counts, so tiny jitters do not hide or show the header.',
  },

  'header-shrink.offset': 'How far down the page you scroll, in pixels, before the header is fully shrunk.',

  'horizontal-track.distance': 'How much vertical scrolling it takes to slide the row all the way across.',
  'horizontal-track.travel': {
    why: 'How far the row slides sideways in total, if you do not want it measured.',
    whenOmitted: 'Measured from how much wider the row is than its window.',
  },
  'horizontal-track.target': {
    why: 'Which element is the sliding row; naming it lets the effect build the pinned window for you.',
    whenOmitted: 'The element itself is the row, and you provide the pinned window.',
  },
  'horizontal-track.scope': {
    why: 'Whether the row is looked for only inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },
  'horizontal-track.offset-top': {
    why: 'Gap left at the top while the row is held, such as for a fixed header. Only works with target.',
    whenOmitted: 'Uses the page-wide pin gap, or none.',
  },

  'media-scrub.distance': 'How much scrolling it takes to play the frames or video from start to end.',
  'media-scrub.offset-top': {
    why: 'Gap left at the top while the media is held, such as for a fixed header. Only works with spacer.',
    whenOmitted: 'Uses the page-wide pin gap, or none.',
  },
  'media-scrub.spacer': {
    why: 'Let the effect hold the media in place and reserve the scroll room, so no wrapper is needed.',
    whenOmitted: 'Off: your page positions the media and provides the scroll room.',
  },
  'media-scrub.frames': {
    why: 'How many numbered images the picture sequence has.',
    whenOmitted: 'Counts as one frame. Ignored when target is set.',
  },
  'media-scrub.src': {
    why: 'Address of the numbered images, with {i} standing in for the frame number.',
    whenOmitted: 'No images are swapped; a video still plays with scroll.',
  },
  'media-scrub.target': {
    why: 'Which elements are the frames, shown one at a time as you scroll.',
    whenOmitted: 'Swaps the picture address (src) or scrubs this element if it is a video.',
  },
  'media-scrub.scope': {
    why: 'Whether the frames are looked for only inside this element or anywhere on the page.',
    whenOmitted: 'Looks anywhere on the page.',
  },

  'pin.distance': 'How much scrolling the element stays held in place for.',
  'pin.offset-top': {
    why: 'Gap left above the held element, such as for a fixed header.',
    whenOmitted: 'Uses the page-wide pin gap, or none.',
  },
  'pin.spacer': {
    why: 'Add blank scroll room under the element so it can stay held for the full distance.',
    whenOmitted: 'Off: it only holds while its own parent is still on screen.',
  },

  'radio-fill.scale': 'Makes the filled dot inside the radio button bigger or smaller.',

  'range-fill.duration': 'No visible effect; the fill timing is fixed in the stylesheet.',
  'range-fill.delay': 'No visible effect; the fill timing is fixed in the stylesheet.',
  'range-fill.ease': 'No visible effect; the fill timing is fixed in the stylesheet.',

  'scroll-progress.distance': 'How much scrolling it takes to go from 0 to 100 percent.',
  'scroll-progress.steps': {
    why: 'Split the scroll into this many numbered steps your styles can react to.',
    whenOmitted: '0: only a smooth progress value is published, no steps.',
  },
  'scroll-progress.target': {
    why: 'Which elements get marked as before, active or after as the steps advance. Needs steps.',
    whenOmitted: 'No elements are marked; only the step number is published.',
  },
  'scroll-progress.scope': {
    why: 'Whether the marked elements are looked for only inside this element or anywhere on the page.',
    whenOmitted: 'Looks anywhere on the page.',
  },

  'scroll-snap.axis': 'Whether scrolling snaps sideways (x) or up and down (y).',
  'scroll-snap.strictness': 'Whether it always snaps (mandatory) or only when you stop close to an item.',
  'scroll-snap.align': 'Which edge of each item lines up with the scroll area when it snaps.',
  'scroll-snap.target': {
    why: 'Which elements are the snap items; naming them also makes this element the scroll area.',
    whenOmitted: 'Uses its direct children and leaves the scrolling to your page.',
  },
  'scroll-snap.scope': {
    why: 'Whether the snap items are looked for only inside this element or anywhere on the page.',
    whenOmitted: 'Looks only inside this element.',
  },

  'scroll-spy.distance': {
    why: 'How much scrolling this section counts as being the current one.',
    whenOmitted: 'One screen height. Ignored when sections is set.',
  },
  'scroll-spy.target': {
    why: 'Which menu link to highlight; with sections, each link is matched to a section by its #href.',
    whenOmitted: 'No link is highlighted.',
  },
  'scroll-spy.scope': {
    why: 'Whether the links are looked for only inside this element or anywhere on the page.',
    whenOmitted: 'Anywhere on the page for one section, inside this element when sections is set.',
  },
  'scroll-spy.sections': {
    why: 'Which elements are the sections, so one setup on a shared parent can track them all.',
    whenOmitted: 'Each section carries its own setup instead.',
  },
  'scroll-spy.offset-top': {
    why: 'Gap at the top of the screen, such as a fixed header, before a section counts as current.',
    whenOmitted: 'None. Only works when sections is set.',
  },

  'smooth-scroll.behavior': 'Whether jumping to a link glides (smooth) or lands instantly (auto).',

  'strength-meter.duration': 'No visible effect; the meter fade timing is fixed in the stylesheet.',
  'strength-meter.delay': 'No visible effect; the meter fade timing is fixed in the stylesheet.',
  'strength-meter.ease': 'No visible effect; the meter fade timing is fixed in the stylesheet.',

  'submit-flow.duration': 'No visible effect; the stage timing is set by load and hold instead.',
  'submit-flow.delay': 'No visible effect; the stage timing is set by load and hold instead.',
  'submit-flow.ease': 'No visible effect; the stage timing is set by load and hold instead.',
  'submit-flow.load': 'How long the spinner shows after a click, before the button shows done.',
  'submit-flow.hold': 'How long the done state stays before the button goes back to normal.',

  'toggle-morph.scale': 'Makes the whole toggle switch bigger or smaller.',
}
