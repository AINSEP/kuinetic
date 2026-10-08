/**
 * Plain-words notes about a whole effect, keyed by preset name: what it does with the markup it is
 * put on, rather than what one parameter means. Each value is a list of bullets, shown on the
 * Notes tab of the "Show code" popover only for an effect in the printed markup that has an entry.
 *
 * Most effects need none. An entry belongs here when the effect reads its element's structure or
 * children in a way the markup alone does not reveal.
 */
export const EFFECT_NOTES: Readonly<Record<string, readonly string[]>> = {
  'flip-card': [
    'flip-card turns its first two child elements into the front and back faces, and flips between them. No special classes needed.',
    'Already using kui-face-front / kui-face-back classes? Those still work, and they win over the first-two-children rule.',
    'A button with aria-pressed directly inside the card becomes the flip control. With no button, the card adds one.',
  ],
}
