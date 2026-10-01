import type { ParamNotes } from '../core/describe.js'

/**
 * The reserved `data-kui` keys — the ones the parser keeps for itself rather than handing to an
 * effect. Keyed `'data-kui.<key>'` (`KEY_NOTE_OWNER` in `core/describe.ts`), so no effect name can
 * shadow them. The first block applies to the whole element; the second to the step it is in.
 */
export const KEY_NOTES: ParamNotes = {
  'data-kui.on': {
    why: 'What starts it: scrolling into view, a hover, a click, or any event name.',
    whenOmitted: 'Each effect picks: most start in view, hover and drag ones are ready on load.',
  },
  'data-kui.actions': {
    why: 'What to do each time it scrolls in, out, back in and back out.',
    whenOmitted: 'It plays on the way in and nothing else.',
  },
  'data-kui.timeline': {
    why: 'What drives it: the clock, or the scroll position so it moves as you scroll.',
    whenOmitted: 'It plays over time, at its own speed.',
  },
  'data-kui.threshold': {
    why: 'How much of the element must be in view before it starts.',
    whenOmitted: 'It starts as soon as any part of it shows.',
  },
  'data-kui.cascade': {
    why: 'Extra wait for each child, so they arrive one after another.',
    whenOmitted: 'The children all start together.',
  },
  'data-kui.spread': {
    why: 'Total time for all children to start, however many there are.',
    whenOmitted: 'The children all start together, unless cascade sets a step.',
  },
  'data-kui.order': {
    why: 'Which child goes first: start, end, center, edges, random or a position.',
    whenOmitted: 'The first child goes first.',
  },
  'data-kui.cols': {
    why: 'How many columns the children sit in, so order can mean a cell in a grid.',
    whenOmitted: 'The children are treated as one line, in page order.',
  },
  'data-kui.along': {
    why: 'Keep a grid stagger to one direction: across (x) or down (y).',
    whenOmitted: 'The wave spreads both ways.',
  },
  'data-kui.rm': {
    why: 'What to do for visitors who ask for less motion: shorten, fade, or skip it.',
    whenOmitted: 'The effects choose, and the strictest choice wins.',
  },
  'data-kui.func': {
    why: 'The name of a page function to call when the effects finish.',
    whenOmitted: 'Nothing is called.',
  },
  'data-kui.at': {
    why: 'Start this step relative to the one before: with it, after it, or a time off.',
    whenOmitted: 'It starts at the same moment as the other steps.',
  },
  'data-kui.above': {
    why: 'Only run this step when the screen is at least this wide.',
    whenOmitted: 'It runs at every screen width.',
  },
  'data-kui.below': {
    why: 'Only run this step when the screen is narrower than this.',
    whenOmitted: 'It runs at every screen width.',
  },
  'data-kui.wide': {
    why: 'Only run this step when its container is at least this wide.',
    whenOmitted: 'It runs at every container width.',
  },
  'data-kui.narrow': {
    why: 'Only run this step when its container is narrower than this.',
    whenOmitted: 'It runs at every container width.',
  },
  'data-kui.repeat': {
    why: 'How many times this step plays, or infinite to keep going.',
    whenOmitted: 'It plays once.',
  },
  'data-kui.yoyo': {
    why: 'Play every other repeat backwards, so it swings back and forth.',
    whenOmitted: 'Every repeat plays forwards.',
  },
}
