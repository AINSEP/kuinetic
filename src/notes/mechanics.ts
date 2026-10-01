import type { ParamNotes } from '../core/describe.js'

/**
 * `effects/layout/primitives.ts`, `effects/three-d/index.ts`, `effects/gestures/primitives.ts`,
 * `effects/svg/index.ts`, `effects/motion-path/index.ts`, `effects/tween/*` and the `blur`, `scale`,
 * `rotate`, `skew`, `progress` primitives in `effects/catalog/core.ts`.
 */
export const MECHANICS_NOTES: ParamNotes = {
  'auto-height.attribute': {
    why: 'Which attribute changing tells the panel it opened or closed, so it can animate its height.',
    whenOmitted: 'Watches data-open.',
  },

  'bar.from': 'How wide the bar starts, growing from its left edge: 0 is empty, 1 is full width.',

  'bar-grow.from': 'How short the bar starts, growing up from its base: 0 is flat, 1 is full height.',

  'blur.blur': 'How blurry it is at its blurriest, before sharpening or after fading out.',

  'card-toggle.delay': 'Wait this long before turning to the back; turning back to the front is never delayed.',
  'card-toggle.perspective': 'How deep the 3D looks as the card turns; smaller is more dramatic.',
  'card-toggle.trigger': {
    why: 'What turns the card: a click, a hover, a hover that stays turned, or a hover that flips each time.',
    whenOmitted: 'Click.',
  },

  'draggable.stiffness': 'How firmly it springs toward where it is headed; higher snaps harder.',
  'draggable.damping': 'How quickly the spring wobble dies out; lower wobbles longer.',
  'draggable.mass': 'How heavy it feels; higher is slower and swingier.',
  'draggable.axis': 'Limit dragging to sideways only, up and down only, or both.',
  'draggable.bounds': {
    why: 'The furthest, in pixels, it can be pulled from its start; it gets stiffer near the limit.',
    whenOmitted: 'No limit.',
  },
  'draggable.return': {
    why: 'Spring back to the starting spot when you let go.',
    whenOmitted: 'Off: it stays where you drop it.',
  },
  'draggable.inertia': {
    why: 'Keep gliding after you let go, carrying the speed of your flick.',
    whenOmitted: 'Off: it stops exactly where you released it.',
  },
  'draggable.resistance': 'How stiff it feels near the limit, from 0 to 1; lower is harder to stretch. Needs bounds.',
  'draggable.momentum': 'How far a flick carries it past the release point. Needs inertia, and does nothing with return.',

  'flip-container.scale': {
    why: 'Also stretch items that change size as they move, instead of only sliding them.',
    whenOmitted: 'Off: items only slide into place.',
  },
  'grid-to-list.scale': {
    why: 'Also stretch items that change size as they move, instead of only sliding them.',
    whenOmitted: 'On for this name, since every item changes shape between grid and list.',
  },
  'expand-to-modal.scale': {
    why: 'Also stretch items that change size as they move, instead of only sliding them.',
    whenOmitted: 'On for this name, since the item grows into the modal.',
  },

  'flip-face.angle': 'How far the face turns, in degrees; 180deg is a full flip.',
  'flip-face.perspective': 'How deep the 3D looks while turning; smaller is more dramatic.',

  'flip-indicator.follow': {
    why: 'Which element the indicator slides to, such as the active tab; the first match on the page.',
    whenOmitted: 'Nothing to follow, so the indicator stays put.',
    required: true,
  },
  'flip-indicator.attribute': {
    why: 'Which attribute changing tells it the active item has moved.',
    whenOmitted: 'Watches aria-selected.',
  },

  'icon-toggle.delay': 'Wait this long before opening; closing is never delayed.',

  'magnetic.stiffness': 'How firmly it springs toward the pointer; higher follows tighter.',
  'magnetic.damping': 'How quickly the spring wobble dies out; lower wobbles longer.',
  'magnetic.mass': 'How heavy it feels; higher is slower and swingier.',
  'magnetic.radius': 'How close the pointer must come, in pixels, before it starts drifting toward it.',
  'magnetic.strength': 'How much of the pointer distance it follows; higher drifts further.',

  'motion-path.path': {
    why: 'The route it travels, drawn as SVG path data.',
    whenOmitted: "The name's own route; plain motion-path uses a straight 120 pixel line to the right.",
  },
  'motion-path.rotate': {
    why: 'Turn to face the way it travels (auto), the reverse way, or hold a fixed angle.',
    whenOmitted: 'Keeps its own orientation.',
  },
  'motion-path.anchor': {
    why: 'Which point of the element rides the path; use center when it turns to follow.',
    whenOmitted: 'Its top-left corner.',
  },
  'motion-path.from': 'Where along the path it starts, as a percentage of the length.',
  'motion-path.to': 'Where along the path it stops, as a percentage of the length.',

  'page-reveal.distance': 'How far the page slides as it fades in. Only the slide version moves.',
  'page-fade.distance': 'Does nothing here: page-fade only fades. Use page-slide to move as well.',

  'path-draw.length': {
    why: 'The total length of the line, so it draws fully; match it to your shape.',
    whenOmitted: 'Assumes 100.',
  },

  'path-morph.from': {
    why: 'The starting shape, as SVG path data.',
    whenOmitted: "Uses the path's own shape.",
  },
  'path-morph.to': {
    why: 'The shape it morphs into, as SVG path data.',
    whenOmitted: 'Nothing to morph into: a warning, and the shape never changes.',
    required: true,
  },
  'path-morph.delay': 'Wait this long after the pointer arrives before morphing; moving away is never delayed.',

  'pressable.duration': 'How long you must hold before it counts as a press.',

  'rotate.angle': 'How far it is turned at the start, before straightening up.',

  'scale.scale': 'How small it starts before growing to full size; 1 means no size change.',

  'skew.from': 'The tilt at the start of the scroll range.',
  'skew.to': 'The tilt at the end of the scroll range.',

  'swipeable.axis': 'Only count sideways swipes, only up and down swipes, or both.',
  'swipeable.velocity': 'How fast a flick must be, in pixels per second, to count as a swipe.',

  'tween.x': "How far it slides sideways by the end; a quoted list like x:'0,100,40' passes through each.",
  'tween.y': "How far it slides up or down by the end; a quoted list like y:'0,-60,0' passes through each.",
  'tween.z': 'How far it moves toward or away from you by the end.',
  'tween.rotate': "How far it has turned by the end; a quoted list like rotate:'0,90,45' passes through each.",
  'tween.scale': "How big it is by the end; 2 is double. A quoted list like scale:'1,1.2,1' passes through each.",
  'tween.scale-x': 'How wide it is by the end, separate from its height.',
  'tween.scale-y': 'How tall it is by the end, separate from its width.',
  'tween.opacity': "How see-through it is by the end; 0 is invisible. A quoted list like opacity:'1,0,1' steps through each.",
  'tween.blur': 'How blurry it is by the end.',
  'tween.brightness': 'How bright it is by the end; 1 is normal, 0 is black.',
  'tween.saturate': 'How vivid the colours are by the end; 0 is grey.',
  'tween.grayscale': 'How grey it is by the end; 1 is fully black and white.',
  'tween.contrast': 'How strong the light and dark difference is by the end.',
  'tween.hue-rotate': 'How far its colours have shifted around the colour wheel by the end.',
  'tween.invert': 'How inverted its colours are by the end; 1 is fully flipped.',
  'tween.sepia': 'How much of an old-photo brown tone it has by the end.',
  'tween.color': 'The text colour it fades to.',
  'tween.background-color': 'The background colour it fades to.',
  'tween.translate-ease': {
    why: 'Speed curve for just the sliding part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.rotate-ease': {
    why: 'Speed curve for just the turning part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.scale-ease': {
    why: 'Speed curve for just the resizing part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.opacity-ease': {
    why: 'Speed curve for just the fading part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.filter-ease': {
    why: 'Speed curve for just the blur and colour-effect part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.color-ease': {
    why: 'Speed curve for just the text colour change.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween.background-ease': {
    why: 'Speed curve for just the background colour change.',
    whenOmitted: 'Uses the main speed curve.',
  },

  'tween-from.x': "How far sideways it starts, then slides back; a quoted list like x:'80,-20,0' passes through each.",
  'tween-from.y': "How far up or down it starts, then slides back; a quoted list like y:'40,-10,0' passes through each.",
  'tween-from.z': 'How far toward or away from you it starts, then settles back.',
  'tween-from.rotate': 'How far it is turned at the start, before straightening up.',
  'tween-from.scale': 'How big it starts; 0.5 is half size, growing to normal.',
  'tween-from.scale-x': 'How wide it starts, separate from its height.',
  'tween-from.scale-y': 'How tall it starts, separate from its width.',
  'tween-from.opacity': 'How see-through it starts; 0 is invisible, fading in.',
  'tween-from.blur': 'How blurry it starts, sharpening to normal.',
  'tween-from.brightness': 'How bright it starts; 1 is normal, 0 is black.',
  'tween-from.saturate': 'How vivid the colours start; 0 is grey.',
  'tween-from.grayscale': 'How grey it starts; 1 is fully black and white.',
  'tween-from.contrast': 'How strong the light and dark difference starts.',
  'tween-from.hue-rotate': 'How far its colours start shifted around the colour wheel.',
  'tween-from.invert': 'How inverted its colours start; 1 is fully flipped.',
  'tween-from.sepia': 'How much of an old-photo brown tone it starts with.',
  'tween-from.color': 'The text colour it starts as, fading to its normal colour.',
  'tween-from.background-color': 'The background colour it starts as, fading to its normal one.',
  'tween-from.translate-ease': {
    why: 'Speed curve for just the sliding part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.rotate-ease': {
    why: 'Speed curve for just the turning part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.scale-ease': {
    why: 'Speed curve for just the resizing part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.opacity-ease': {
    why: 'Speed curve for just the fading part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.filter-ease': {
    why: 'Speed curve for just the blur and colour-effect part.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.color-ease': {
    why: 'Speed curve for just the text colour change.',
    whenOmitted: 'Uses the main speed curve.',
  },
  'tween-from.background-ease': {
    why: 'Speed curve for just the background colour change.',
    whenOmitted: 'Uses the main speed curve.',
  },
}
