// @vitest-environment node
//
// Every stylesheet is read at module scope, so any suite importing this file must run under the
// node environment: under jsdom `import.meta.url` is an http: URL and `fileURLToPath` throws.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PRESETS } from '../../src/effects/catalog/core.js'
import { AMBIENT_PRESETS } from '../../src/effects/catalog/ambient.js'
import { DISCRETE_PRESETS } from '../../src/effects/catalog/discrete.js'
import { FEEDBACK_PRESETS } from '../../src/effects/catalog/feedback.js'
import { INTERACTION_PRESETS } from '../../src/effects/catalog/interaction.js'
import { MEDIA_PRESETS } from '../../src/effects/catalog/media.js'
import { NUMBERS_PRESETS } from '../../src/effects/catalog/numbers.js'
import { TEXT_PRESETS } from '../../src/effects/catalog/text.js'
import { FORMS_PRESETS } from '../../src/effects/forms/index.js'
import { NAVIGATION_PRESETS } from '../../src/effects/navigation/index.js'
import { MOTION_PATH_PRESETS } from '../../src/effects/motion-path/index.js'
import { SVG_PRESETS } from '../../src/effects/svg/index.js'
import { THREE_D_PRESETS } from '../../src/effects/three-d/index.js'
import { extractBaseRuleProperties, extractKeyframes, stripComments } from './css-scan.js'

/**
 * The shipped stylesheets, read and pre-scanned once, for every suite that asserts against the
 * real CSS rather than against a compiled plan.
 *
 * Fixture data, deliberately separated from the assertions that consume it: `css-invariants.test.ts`
 * and `css-requires-own-subtree.test.ts` both scan the same catalog, and two copies of "which files
 * are the catalog" is two places for that answer to drift. `css-scan.ts` beside this file holds the
 * scanning *functions*; this holds the one set of inputs they are run over.
 */

/**
 * Stylesheets scanned for both the keyframe-channel and static-rule-channel invariants.
 *
 * `media.css` and `text.css` were once excluded because the properties their `mask`/`font`
 * channels write (`mask-image`/`mask-position`/`mask-size`, `font-weight`/`font-stretch`/
 * `font-style`) had no entry in `CHANNEL_PROPERTIES`. Both channels are mapped now — see
 * `./channel-properties.js` — so every catalog stylesheet is audited.
 *
 * `tween.css` is the one stylesheet deliberately outside this list, and not because it is exempt.
 * Every check joins a keyframe block to a primitive through `Preset.keyframes`, and the generic
 * tween has no such field: its blocks are chosen per attribute by `variantFor`, and its channels
 * are read off that attribute too, so there is no preset to compare a block against. The same two
 * invariants are asserted against it in `tween.test.ts`, using the same `CHANNEL_PROPERTIES` map.
 */
export const EFFECT_FILES = [
  'entrance.css',
  'scroll.css',
  'feedback.css',
  'ambient.css',
  'interaction.css',
  'discrete.css',
  'layout.css',
  'numbers.css',
  'forms.css',
  'navigation.css',
  'three-d.css',
  'media.css',
  'text.css',
  'svg.css',
  'motion-path.css',
]

/**
 * All stylesheets, read once at module scope. `base.css` first, then every effect stylesheet —
 * reading them lazily inside a test fails under the jsdom environment, where `import.meta.url` is
 * no longer a `file:` URL.
 */
export const SOURCES = new Map<string, string>(
  ['base.css', ...EFFECT_FILES].map((file) => [
    file,
    readFileSync(fileURLToPath(new URL(`../../src/css/${file}`, import.meta.url)), 'utf8'),
  ]),
)

/**
 * Every preset across the catalogs scanned by {@link EFFECT_FILES}, so the widened checks validate
 * real presets instead of silently skipping everything outside the original entrance/scroll matrix.
 * Skip guards (`if (!resolved) continue`) make it safe to include a preset here whose stylesheet
 * isn't in `EFFECT_FILES` — it just never matches a rule.
 */
export const ALL_PRESETS = [
  ...PRESETS,
  ...AMBIENT_PRESETS,
  ...FEEDBACK_PRESETS,
  ...INTERACTION_PRESETS,
  ...DISCRETE_PRESETS,
  ...MEDIA_PRESETS,
  ...NUMBERS_PRESETS,
  ...TEXT_PRESETS,
  ...FORMS_PRESETS,
  ...NAVIGATION_PRESETS,
  ...SVG_PRESETS,
  ...MOTION_PATH_PRESETS,
  ...THREE_D_PRESETS,
]

/**
 * The effect stylesheets joined and comment-stripped — see `stripComments`'s own doc comment.
 *
 * Without the strip, a retired preset's CSS kept commented-out for reference (`ambient.css`'s
 * `noise-overlay` cut is the live example) reads to every regex downstream as if it were still
 * shipping: its `@keyframes` block looked like a real, orphaned one to `extractKeyframes`, and its
 * `animation:`/`[data-kui-fx~=]` text would have been equally readable by
 * `extractBaseRuleProperties`/`extractHostAnimationBindings`, had either happened to collide with
 * something live.
 *
 * `base.css` is deliberately *not* in here — it is scanned separately by the channel-invariant
 * checks. A scan that needs the whole shipped catalog builds its own join from {@link SOURCES}.
 */
export const scannedCss = stripComments(EFFECT_FILES.map((file) => SOURCES.get(file)).join('\n'))

export const keyframes = extractKeyframes(scannedCss)
export const baseRules = extractBaseRuleProperties(scannedCss)
