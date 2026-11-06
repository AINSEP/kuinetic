import type { ParamNotes } from '../core/describe.js'

/** `effects/catalog/text.ts`, `effects/catalog/numbers.ts`, `effects/catalog/discrete.ts` (this batch's families). */
export const TEXT_NOTES: ParamNotes = {
  'split-text.hold': 'Keep the split and light each piece using inherited scroll progress until teardown.',
  'text-gradient-sweep.fill': 'Fill dim glyphs with a hard edge from left to right, using the existing sweep animation.',
  'fade-open.enter-delay': 'Extra wait only when opening; match the outgoing duration for out-then-in order.',
  'fade-open.shape': 'Reveal through a circle or rounded inset in both directions; none keeps the ordinary fade.',
  'fade-open.origin': 'Circle centre: center, top, bottom, left, right, or a quoted corner such as top left.',
  'fade-open.radius': 'Corner radius throughout an inset reveal.',
  'count.from': 'The number the counter starts at.',
  'count.to': 'The number the counter ends on.',
  'count.decimals': 'How many digits to show after the decimal point; ignored by compact, which shows at most one.',
  'count.format': {
    why: 'How the number is written: plain, as money, as a percent, or shortened like 1.2K.',
    whenOmitted: 'Plain number. Percent expects a fraction, so 0.82 shows 82%.',
  },
  'count.currency': {
    why: 'The three-letter currency code used when the format is currency.',
    whenOmitted: 'US dollars.',
  },

  'count-odometer.from': 'The number the rolling digits start at; whole numbers from 0 up, so -5 counts as 0.',
  'count-odometer.to': 'The number the rolling digits land on; whole numbers from 0 up, so 2.5 rounds to 3.',

  'drop-open.distance': 'How far the element drops down into place as it opens.',
  'drop-open.radius': 'Distance from the group centre; use distance:0px to fan out from that centre.',
  'drop-open.angle': 'Angle of the first item, with -90deg pointing up. Existing cascade: assigns each child its index and stagger.',
  'drop-open.step': 'Angle between items: 60deg gives six items a ring; a smaller step gives an arc.',

  'meter-bar.from': {
    why: 'How full the bar is when it starts, from 0 (empty) to 1 (full).',
    whenOmitted: 'Starts empty and grows to its full width.',
  },

  'pop-open.scale': 'How small the element starts, where 1 is full size.',

  'scale-open.scale': 'How small the element starts, where 1 is full size.',

  'scramble-text.step': {
    why: 'How long each scramble flicker lasts; ignored when a total duration is given.',
    whenOmitted: '40ms per flicker, so longer text takes longer to resolve.',
  },
  'scramble-text.revealEvery': 'How many flickers pass before the next letter locks in.',
  'scramble-text.charset': 'Which characters the unsolved letters flicker through.',

  'slide-open-down.distance': 'How far the element slides in from above.',

  'slide-open-up.distance': 'How far the element slides in from below.',

  'split-text.stagger': 'Wait between each piece, so letters or words arrive one by one.',
  'split-text.unit': 'What the text is cut into: single letters, whole words, or lines.',
  'split-text.direction': {
    why: 'How pieces arrive: fade, up/down, a mask wipe, or rise-mask sliding up 120% behind a still clip.',
    whenOmitted: "Uses the preset's direction; --kui-mask-bleed adds room for letters above and below a mask's edge.",
  },

  'split-text-motion.stagger': 'Offset between neighbouring letters, which shapes the wave or jitter.',
  'split-text-motion.motion': 'The style of letter movement: a smooth wave or a nervous jitter.',

  'text-3d-extrude.angle': 'How far the text is turned at the start before it straightens; negative turns it anticlockwise.',
  'text-3d-extrude.distance': 'How far below its place the text starts before it rises in.',

  'text-gradient-sweep.color': {
    why: 'The colour of the glowing band that sweeps across the text.',
    whenOmitted: "Uses the text's own colour.",
  },

  'text-marquee.duration': 'How long one full trip of the scrolling text takes; longer is slower.',

  'text-shimmer.duration': 'How long one shimmer pass takes before the next one starts.',

  'text-sweep.color': {
    why: 'The colour of the highlight bar or underline.',
    whenOmitted: "Uses the text's own colour; the highlight preset uses gold.",
  },

  'typewriter.step': 'How long each typed letter takes; ignored when a total duration is given.',
  'typewriter.words': 'The words to type and fully delete in turn, separated by |.',
  'typewriter.interval': 'How long each whole word stays before it deletes.',
  'typewriter.loop': {
    why: 'Delete the text and type it again, over and over.',
    whenOmitted: 'Off: it types once and stops.',
  },

  'var-axis.axis': {
    why: 'The four-character name of the font setting to animate, letters or digits, case exact: wght, GRAD.',
    whenOmitted: 'Animates weight (wght); a font without that setting does not move.',
  },
  'var-axis.from': 'The value of the font setting at the start.',
  'var-axis.to': 'The value of the font setting at the end.',

  'var-slant.from': 'How far the letters lean at the start.',
  'var-slant.to': 'How far the letters lean at the end.',

  'var-weight.from': 'How bold the text is at the start, from thin (100) up.',
  'var-weight.to': 'How bold the text is at the end, up to extra heavy (900).',

  'var-width.from': 'How wide the letters are at the start; 100% is normal.',
  'var-width.to': 'How wide the letters are at the end; 100% is normal.',

  'word-cycler.words': {
    why: 'The words to cycle through, separated by | and quoted, like "fast|simple|bold".',
    required: true,
  },
  'word-cycler.interval': 'How long each word stays before the next one swaps in.',
  'word-cycler.swap': 'Whether words fade or scramble into the next word.',
  'word-cycler.order': 'Where letters start scrambling and returning: start, end, centre or edges.',
  'word-cycler.step': 'The pause between scramble steps.',
}
