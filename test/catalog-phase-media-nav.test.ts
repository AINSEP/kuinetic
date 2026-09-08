// @vitest-environment node
//
// The phase gap in `src/effects/catalog/media.ts` (three names) and `src/effects/navigation/index.ts`
// (four names): an undeclared `Preset.phase` is not a permissive default, `compile.ts`'s `phaseOf`
// treats it as "nothing is known", and an unknown phase conflicts with everything including another
// unknown — the same shape `catalog-gestures-phase.test.ts` and `catalog-phase-materials.test.ts`
// already document for their own families.
//
// `menu-stagger-open`/`dropdown-open`/`mega-menu-drop`/`drawer-slide` are from-only navigation
// reveals that share `translate` with `lift`'s hover state. That pair used to be refused outright
// with no warning that a real entrance or hover had quietly lost its neighbour, and declaring the
// phase fixed it.
//
// `duotone-hover`/`grayscale-hover`/`saturate-hover` share the `filter` channel with `blur-in`'s
// entrance and were given the same treatment in the same change — and that half was wrong, so this
// file now proves the opposite for them. The difference is *delivery*: `lift`'s hover is a
// transition, which is an underlying value a from-only entrance resolves against; a `media-filter`
// hover is a second keyframe track, which is not. See `channels.ts`'s `INDEPENDENT_PHASES` for the
// full rule and the 2026-09-08 catalog review for how it was found.
//
// `menu-fullscreen` stays unphased on purpose — its keyframe closes with an explicit `to`, the same
// closed shape the ten `cloak: true` presets `composition-phase.test.ts` already excludes from
// `entrance` — so this file also proves it still refuses, not just that the other four now compose.
//
// The node environment is not optional: `compile`/`parse` are pure and need no DOM, and this mirrors
// `composition-phase.test.ts`, `catalog-gestures-phase.test.ts` and `catalog-phase-materials.test.ts`'s
// own choice for the same reason.
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { MEDIA_CSS_PRESETS } from '../src/effects/catalog/media.js'
import { NAV_CSS_PRESETS } from '../src/effects/navigation/index.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

function resolvedPreset(name: string, from: Registry = registry) {
  const resolved = from.resolve(name)
  if (!resolved) throw new Error(`catalog-phase-media-nav.test.ts: "${name}" is not in the catalog`)
  return resolved.preset
}

/** What an author ends up with for one attribute: the effects that survived, and any refusal. */
function plan(attribute: string) {
  const compiled = compile(parse(attribute), registry, 'time')
  return {
    fx: compiled.fxNames,
    refused: compiled.warnings.filter((message) => message.includes('cannot compose')),
  }
}

const MEDIA_HOVER_NAMES = ['duotone-hover', 'grayscale-hover', 'saturate-hover']
const NAV_ENTRANCE_NAMES = ['menu-stagger-open', 'dropdown-open', 'mega-menu-drop', 'drawer-slide']

describe('media.ts: the three hover filters are unphased, because their state is a keyframe', () => {
  // These three carried `phase: 'state'` for one commit and this block asserted it. Both the
  // declaration and the assertion have been reverted, and the reason is not that the phase was the
  // wrong *name* for when the channel is held — "held while the pointer is on it" is an accurate
  // description of a hover filter. It is that `INDEPENDENT_PHASES` (`core/channels.ts`) is not
  // really gating on timing. Its exemption is sound only when the state half is delivered as a
  // transition or a normal declaration, so that it sits in the cascade *beneath* the entrance and
  // shows through once the entrance has played. `media-filter` is `renderer: 'css-keyframes'`, so
  // the "state" here is a second `@keyframes` track *beside* the entrance on the same channel:
  // `blur-in, duotone-hover` compiled to `animation-name: kui-blur-in, kui-duotone-hover` with
  // `fill-mode: both, both` and no warning, and because `kui-duotone-hover` is two-ended it won
  // `filter` outright and clamped it. See the block comment above the three presets in `media.ts`.
  it.each(MEDIA_HOVER_NAMES)('leaves %s unphased', (name) => {
    expect(resolvedPreset(name).phase).toBeUndefined()
  })

  it('has no Preset.transitions to derive a phase from either', () => {
    // The other half of the same guarantee. `phaseOf` derives `'state'` from a preset's
    // `transitions` field, so leaving `phase` off is only enough while these three also carry no
    // transition list — and they carry none, because they compile through a keyframed `animation:`
    // on `:hover`/`:focus-visible` (`media-filter`'s `defaultActivation: 'hover'`) rather than a
    // bare host-rule `transition:`. If one ever gains a real host transition, deriving `state` from
    // it would be correct, and this assertion is what will fail first and force that to be thought
    // about rather than inherited.
    for (const name of MEDIA_HOVER_NAMES) expect(resolvedPreset(name).transitions, name).toBeUndefined()
  })

  it('leaves the deliberately-unphased media names alone', () => {
    // `image-parallax-frame` is scroll/view-timeline-scrubbed (same precedent as `parallax-y`); `bg`
    // and `background` are a permanent backdrop material held unconditionally from `load`. Neither
    // fits any of the four phases, and this is a record of that, not a claim this file changed it.
    for (const name of ['image-parallax-frame', 'bg', 'background']) {
      expect(resolvedPreset(name).phase, name).toBeUndefined()
    }
  })

  it('leaves the closed-keyframe media names unphased, not just the cloak:true ones', () => {
    // `ken-burns`, `ken-burns-out`, `before-after-wipe` and `lightbox-open` are the same
    // closed-keyframe shape as the ten `cloak: true` presets in this file, but are one-shot plays
    // rather than a hover-toggled condition, so `state` would misdescribe them and `entrance` would
    // fail `composition-phase.test.ts`'s "no closing keyframe" invariant outright.
    for (const name of ['ken-burns', 'ken-burns-out', 'before-after-wipe', 'lightbox-open']) {
      expect(resolvedPreset(name).phase, name).toBeUndefined()
    }
  })
})

describe('navigation/index.ts: the four from-only reveals declare phase: entrance', () => {
  it.each(NAV_ENTRANCE_NAMES)('declares phase: entrance on %s', (name) => {
    expect(resolvedPreset(name).phase).toBe('entrance')
  })

  it('declares phase directly rather than through Preset.transitions', () => {
    // None of the four CSS-tier nav presets carries `transitions` — the three names that do
    // (`header-shrink`, `header-hide-on-scroll`, `back-to-top-fade`) are the JS-tier scroll
    // reactions this task does not touch, and `phaseOf` already derives `state` for them.
    for (const name of NAV_ENTRANCE_NAMES) expect(resolvedPreset(name).transitions, name).toBeUndefined()
  })

  it('leaves menu-fullscreen unphased — its keyframe closes with a real to', () => {
    // `kui-menu-fullscreen` ends at `opacity: 1; clip-path: circle(150%)`, so
    // `animation-fill-mode: both` pins both channels for good; declaring it `entrance` would be the
    // silent-clobber bug this whole axis exists to prevent.
    expect(resolvedPreset('menu-fullscreen').phase).toBeUndefined()
  })

  it('covers exactly the five CSS-tier nav presets — a name added here without a phase call is a gap', () => {
    const names = NAV_CSS_PRESETS.map((preset) => preset.name)
    expect(names).toEqual([
      'menu-stagger-open', 'menu-fullscreen', 'dropdown-open', 'mega-menu-drop', 'drawer-slide',
    ])
  })
})

describe('an entrance still refuses a keyframe-delivered hover on the same channel', () => {
  // The inverse of the block below, and the distinction between the two is the whole lesson of the
  // 2026-09-08 catalog review. `lift` earns the exemption because its hover is a *transition* — a
  // real underlying value for `menu-stagger-open`'s open endpoint to resolve against. These three
  // do not, because a `media-filter` hover is another keyframe track: it lands beside the entrance
  // in `animation-name`, wins the channel on source order, and `fill-mode: both` clamps it there.
  //
  // Refusing is the honest outcome, not a lesser one. The author sees a warning naming both effects
  // and can nest them; the composing version silently deleted the entrance and spent the hover
  // before the pointer arrived. Both orders, for the reason the block below gives.
  it.each([
    ['blur-in, grayscale-hover', ['blur-in']],
    ['grayscale-hover, blur-in', ['grayscale-hover']],
    ['blur-in, duotone-hover', ['blur-in']],
    ['blur-in, saturate-hover', ['blur-in']],
  ])('%s refuses, keeping only the first effect', (attribute, expectedFx) => {
    const result = plan(attribute)
    expect(result.refused, attribute).toHaveLength(1)
    expect(result.refused[0], attribute).toContain('both animate filter')
    expect(result.fx, attribute).toEqual(expectedFx)
  })
})

describe('an entrance composes with a transition-delivered hover state on the same channel', () => {
  // Both orders, for the reason `composition-phase.test.ts`'s own `COMPOSES` table checks both
  // orders of `fade-up, lift`: authoring order decided which effect the old undeclared-phase code
  // kept, and a table frozen around one spelling would miss a rule that only works left-to-right.
  it.each([
    ['menu-stagger-open, lift', ['menu-stagger-open', 'lift']],
    ['lift, menu-stagger-open', ['lift', 'menu-stagger-open']],
    ['dropdown-open, lift', ['dropdown-open', 'lift']],
    ['mega-menu-drop, lift', ['mega-menu-drop', 'lift']],
    ['drawer-slide, lift', ['drawer-slide', 'lift']],
  ])('%s composes both effects with no "cannot compose" warning', (attribute, expectedFx) => {
    const result = plan(attribute)
    expect(result.refused, attribute).toEqual([])
    expect(result.fx, attribute).toEqual(expectedFx)
  })
})

describe('a clash the phase rule does not cover is still refused, loudly', () => {
  it('fade-up, menu-stagger-open still refuses — two entrances genuinely fight, same phase', () => {
    const result = plan('fade-up, menu-stagger-open')
    expect(result.refused).toHaveLength(1)
    expect(result.fx).toEqual(['fade-up'])
  })

  it('fade-up, menu-fullscreen still refuses — an entrance beside a name that stays unphased', () => {
    const result = plan('fade-up, menu-fullscreen')
    expect(result.refused).toHaveLength(1)
    expect(result.fx).toEqual(['fade-up'])
  })

  it('menu-stagger-open against itself still refuses as a same-name clash, not a phase gap', () => {
    const result = plan('menu-stagger-open, menu-stagger-open')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['menu-stagger-open'])
  })

  it('grayscale-hover against itself still refuses as a same-name clash, not a phase gap', () => {
    const result = plan('grayscale-hover, grayscale-hover')
    expect(result.refused.length).toBeGreaterThan(0)
    expect(result.fx).toEqual(['grayscale-hover'])
  })

  it('duotone-hover, grayscale-hover still refuses — two states are resolved by source order', () => {
    // Both are `phase: 'state'` on the same `filter` channel — `state, state` is not one of
    // `channels.ts`'s `INDEPENDENT_PHASES` pairs, so this is a genuine clash regardless of order.
    const result = plan('duotone-hover, grayscale-hover')
    expect(result.refused).toHaveLength(1)
    expect(result.fx).toEqual(['duotone-hover'])
  })
})

describe('MEDIA_CSS_PRESETS still exposes all seventeen names by this list', () => {
  it('has not dropped or renamed a preset while adding phase', () => {
    const names = MEDIA_CSS_PRESETS.map((preset) => preset.name)
    expect(names).toEqual([
      'wipe-up', 'wipe-down', 'wipe-left', 'wipe-right', 'wipe-circle', 'wipe-diagonal',
      'mask-reveal', 'curtain-reveal', 'ken-burns', 'ken-burns-out', 'blur-up', 'duotone-hover',
      'grayscale-hover', 'saturate-hover', 'image-parallax-frame', 'before-after-wipe',
      'lightbox-open',
    ])
  })
})
