import type { ParamNotes } from '../core/describe.js'
import { CATALOG_NOTES } from './catalog.js'
import { CATALOG_CORE_NOTES } from './catalog-core.js'
import { INTERACTION_NOTES } from './interaction.js'
import { INTERACTION_REVEAL_NOTES } from './interaction-reveal.js'
import { KEY_NOTES } from './keys.js'
import { MECHANICS_NOTES } from './mechanics.js'
import { SCROLL_NAV_FORMS_NOTES } from './scroll-nav-forms.js'
import { SHARED_NOTES } from './shared.js'
import { SHOWCASE_NOTES } from './showcase.js'
import { TEXT_NOTES } from './text.js'

/**
 * The plain-words note for every parameter in the bundled catalog, read by `describe()`.
 *
 * A separate entry (`kuinetic/notes`, and `kuinetic.notes.js` for a script tag) rather than a
 * field on each `ParamSpec`, because this is prose only documentation pages read: inline, it would
 * ship to every visitor of every site using the library. It imports types only, so it carries no
 * runtime code either.
 *
 * Kept in step with the registry by `test/param-notes.test.ts`: every registered parameter must
 * resolve a note, and every key here must name a parameter that exists.
 */
export const PARAM_NOTES: ParamNotes = {
  ...SHARED_NOTES,
  ...CATALOG_CORE_NOTES,
  ...CATALOG_NOTES,
  ...INTERACTION_NOTES,
  ...INTERACTION_REVEAL_NOTES,
  ...TEXT_NOTES,
  ...SCROLL_NAV_FORMS_NOTES,
  ...MECHANICS_NOTES,
  ...SHOWCASE_NOTES,
  ...KEY_NOTES,
}
