import type { ParamNotes } from '../core/describe.js'

/**
 * Parameters that mean the same thing on every primitive that declares them. A primitive whose
 * `duration` means something else (one cycle of a loop, say) overrides it under its own key.
 */
export const SHARED_NOTES: ParamNotes = {
  '*.duration': 'How long the motion takes from start to finish.',
  '*.delay': 'Wait this long after the trigger before starting.',
  '*.ease': 'The speed curve: slow start, slow finish, or a bounce.',
  '*.stagger': {
    why: 'Extra wait per item, so a group arrives one after another.',
    whenOmitted: 'Every item starts at once, unless a parent sets a stagger.',
  },
}
