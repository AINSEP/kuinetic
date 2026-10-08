/**
 * Plain-words notes about a whole effect, keyed by preset name: what it does with the markup it is
 * put on, rather than what one parameter means. Each value is a list of bullets, shown on the
 * Notes tab of the "Show code" popover only for an effect in the printed markup that has an entry.
 *
 * Most effects need none. An entry belongs here when the effect reads its element's structure or
 * children in a way the markup alone does not reveal.
 */
type Bullets = readonly string[]

/** Build `{ name: bullets(name) }` entries for a list of preset names. */
function fromEntriesOf(names: readonly string[], bullets: (name: string) => Bullets): Record<string, Bullets> {
  return Object.fromEntries(names.map((name) => [name, bullets(name)]))
}

/** Presets that move or mark their own children and so refuse `target:` (compile.ts warns and drops it). */
const OWN_CHILDREN_PRESETS: readonly string[] = [
  'hamburger-to-x',
  'play-to-pause',
  'video-scrub',
  'label-float',
  'strength-meter',
  'toggle-morph',
  'checkbox-draw',
  'radio-fill',
  'step-progress',
  'group-dim',
]

function onOwnChildren(name: string): Bullets {
  return [
    `${name} works on its own children, so target: doesn't apply here.`,
    'If you add target:, the library warns and ignores it. The effect stays on the box you put data-kui on.',
  ]
}

// Left/right entrances are named for where the element comes IN FROM (fade-left starts at the left).
// Up/down entrances (fade-up starts below and rises) get no note: they read the way they look, and
// they sit on so many demos that a note there was noise the owner asked to remove.
const ENTER_FROM_SIDE: readonly string[] = ['fade-left', 'fade-right', 'slide-left', 'slide-right']
// Exits are named for the way the element leaves.
const EXIT_TOWARD: readonly string[] = [
  'fade-out-left',
  'fade-out-right',
  'fade-out-up',
  'fade-out-down',
  'slide-out-left',
  'slide-out-right',
  'slide-out-up',
  'slide-out-down',
]
const WIPES_HORIZONTAL: readonly string[] = ['wipe-left', 'wipe-right']
const WIPES_VERTICAL: readonly string[] = ['wipe-up', 'wipe-down']
const CURSOR_DOT_PRESETS: readonly string[] = ['cursor-follow', 'cursor-lag', 'cursor-label', 'cursor-invert']

function enterFromSide(name: string): Bullets {
  const side = name.endsWith('left') ? 'left' : 'right'
  const away = side === 'left' ? 'right' : 'left'
  return [`The side in the name is where it comes in from. ${name} starts off to the ${side} and moves ${away} into place.`]
}

function exitToward(name: string): Bullets {
  const direction = name.slice(name.lastIndexOf('-') + 1)
  return [`The direction in the name is where it heads. ${name} moves ${direction} as it leaves.`]
}

function wipeHorizontal(name: string): Bullets {
  const left = name.endsWith('left')
  return [`${name} reveals the box starting from its ${left ? 'left' : 'right'} edge, sweeping ${left ? 'right' : 'left'}.`]
}

function wipeVertical(name: string): Bullets {
  const up = name.endsWith('up')
  return [`${name} reveals the box starting from its ${up ? 'bottom' : 'top'} edge, sweeping ${up ? 'up' : 'down'}.`]
}

const CURSOR_DOT_LINES: Readonly<Record<string, string>> = {
  'cursor-follow': 'The dot follows the pointer closely.',
  'cursor-lag': 'The dot trails a little behind the pointer on purpose.',
  'cursor-label': 'The dot is a small pill of text. Set the words with label: (the default is View).',
  'cursor-invert': 'The dot flips the colours of whatever it passes over.',
}

function cursorDot(name: string): Bullets {
  return [
    `${name} adds a small dot to the page that follows the pointer. The box you put data-kui on doesn't move.`,
    CURSOR_DOT_LINES[name] ?? '',
    'The dot only shows while the pointer is over the box, or when the box has keyboard focus. It is skipped on touch screens.',
  ].filter((line) => line !== '')
}

export const EFFECT_NOTES: Readonly<Record<string, readonly string[]>> = {
  'flip-card': [
    'flip-card turns its first two child elements into the front and back faces, and flips between them. No special classes needed.',
    'Already using kui-face-front / kui-face-back classes? Those still work, and they win over the first-two-children rule.',
    'A button with aria-pressed directly inside the card becomes the flip control. With no button, the card adds one.',
    ...onOwnChildren('flip-card'),
  ],
  ...fromEntriesOf(OWN_CHILDREN_PRESETS, (name) => onOwnChildren(name)),
  ...fromEntriesOf(ENTER_FROM_SIDE, (name) => enterFromSide(name)),
  ...fromEntriesOf(EXIT_TOWARD, (name) => exitToward(name)),
  ...fromEntriesOf(WIPES_HORIZONTAL, (name) => wipeHorizontal(name)),
  ...fromEntriesOf(WIPES_VERTICAL, (name) => wipeVertical(name)),
  ...fromEntriesOf(CURSOR_DOT_PRESETS, (name) => cursorDot(name)),
  'cursor-spotlight': [
    'cursor-spotlight lights up the box with a soft glow that follows the pointer. No extra dot is added.',
    'The box itself stays where it is. Only the glow moves, and that is normal.',
    'The glow only shows while the pointer is over the box, or when the box has keyboard focus.',
  ],
  carousel: [
    'target: names the slides and the dots together, like target:\'.slide, .dot\'. Any value with a comma or a space needs quotes.',
    'next: and prev: are the arrow buttons. jump: is the row of dots, and each dot jumps to the slide in the same position.',
    'Past the last slide it wraps back to the first. With no next:, prev: or jump:, clicking the carousel moves it forward.',
  ],
  'horizontal-scroll': [
    'target: names the strip that slides sideways. The outer box stays put while you scroll down.',
    'Only the first match is used, so point target: at one strip.',
    'Without a target:, the box with data-kui is the strip, and it just slides sideways as you scroll.',
  ],
}
