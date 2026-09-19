//
// Materials (catalog section S) — `effects/catalog/materials.ts` and `src/css/glass.css`, plus the
// two parameter additions in section I that exist to serve them (`beam-border`'s `arc`/`softness`
// and `shine-sweep`'s `angle`/`width`/`color`).
//
// The node environment is not optional: the CSS assertions read the shipped stylesheets at module
// scope, and under jsdom `import.meta.url` is an http: URL that `fileURLToPath` throws on. Nothing
// here needs a DOM — every question below is answerable from the registry and the stylesheet text,
// which is the same shape `css-invariants.test.ts` uses.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import type { CompiledPlan } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { readEffectParams } from '../src/core/js-params.js'
import { validate } from '../src/core/params.js'
import { CHANNEL_PROPERTIES } from './support/channel-properties.js'
import { stripComments } from './support/css-scan.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

const glassCss = stripComments(
  readFileSync(fileURLToPath(new URL('../src/css/glass.css', import.meta.url)), 'utf8'),
)
const interactionCss = stripComments(
  readFileSync(fileURLToPath(new URL('../src/css/interaction.css', import.meta.url)), 'utf8'),
)

/** Compile one authored attribute against the real catalog. */
const plan = (attribute: string): CompiledPlan => compile(parse(attribute), registry, 'time')

describe('glass registration', () => {
  const resolved = registry.resolve('glass')!

  it('resolves at all, its primitive sharing the preset name rather than a second one', () => {
    // Preset name and primitive id are both `glass` — separate maps in `registry.ts`, so there is
    // no collision, and a distinctly-named preset (a future house style) would still be one
    // `Preset` row pointing at this same primitive, the same split `press`/`press-depth` uses.
    expect(resolved).toBeDefined()
    expect(resolved.primitive.id).toBe('glass')
  })

  /**
   * The channel claim is the whole composition contract, and every member of it was chosen against
   * a specific effect this one has to be wearable with. Asserted as an exact list rather than a
   * `toContain`, because the failure this guards is a channel being *added* — `shadow` or `border`
   * would each silently un-compose a pairing the family exists for, and the pairing tests below
   * would then be the only thing to notice.
   */
  it('claims background and backdrop, and nothing else', () => {
    expect(resolved.primitive.channels).toEqual(['background', 'backdrop'])
  })

  it('paints a resting surface, so it refuses every timing token by name', () => {
    const { parameters } = resolved.primitive
    expect(parameters).not.toHaveProperty('duration')
    expect(parameters).not.toHaveProperty('delay')
    expect(parameters).not.toHaveProperty('ease')
  })

  it('activates on load, so a panel already on screen is not stranded behind on:enter', () => {
    expect(resolved.primitive.defaultActivation).toBe('load')
    expect(resolved.primitive.supportedActivations).toEqual(['load', 'enter', 'manual'])
  })

  /**
   * Never `'disable'`: that is a fact about the *host*, folded across every composed effect by
   * `strictestPolicy` and implemented by activating nothing at all, so it would silence whatever
   * `glass` was written beside. `'shorten'` is the identity element of that fold — the
   * spelling of "I impose no reduced-motion constraint of my own" — which is precisely true of a
   * surface with no motion in it. Same reasoning `rotate-static` and `background-media` record.
   */
  it("declares the neutral 'shorten', so it constrains no neighbour it is composed with", () => {
    expect(resolved.primitive.reducedMotion).toBe('shorten')
  })

  /**
   * `'paint'` is a deliberate choice and the honest upper bound of a vocabulary with no exact word
   * for a backdrop filter's cost — see the long note at the primitive. This asserts the choice
   * rather than the reasoning, so that a later edit to `'compositor'` (which would be a lie: this
   * is extra render passes, not layer work) has to argue with a red test first.
   */
  it("is paint-class, never 'compositor'", () => {
    expect(resolved.primitive.perfClass).toBe('paint')
  })
})

describe('glass parameters', () => {
  const { parameters } = registry.resolve('glass')!.primitive

  /**
   * The owner's requirement, stated as a test: total control of the surface from the attribute.
   * A missing name here is a knob an author has to reach past the library to set.
   */
  it('exposes every literal the stylesheet uses', () => {
    expect(Object.keys(parameters).sort((a, b) => a.localeCompare(b))).toEqual([
      'blur',
      'opacity',
      'radius',
      'rim',
      'rim-width',
      'saturate',
      'sheen',
      'tint',
    ])
  })

  /**
   * `0.8` and `80%` are the same request. This is the whole reason `'number|percentage'` exists,
   * and the reason it is checked through `validate` rather than by reading the declared `type`:
   * the union's value is the *normalisation*, and a type that accepted both spellings without
   * normalising would leave `maximum: 1` unenforceable on one of them.
   */
  it.each([
    ['opacity', '0.8', '0.8'],
    ['opacity', '80%', '0.8'],
    ['sheen', '25%', '0.25'],
    ['saturate', '160%', '1.6'],
  ])('normalises %s:%s to %s', (name, authored, normalised) => {
    const result = validate(authored, parameters[name]!)
    expect(result.ok).toBe(true)
    expect(result.value).toBe(normalised)
  })

  it('bounds opacity as an alpha, so an out-of-range value is named rather than silently clamped', () => {
    expect(validate('1.4', parameters.opacity!).ok).toBe(false)
    expect(validate('140%', parameters.opacity!).ok).toBe(false)
    expect(validate('-0.1', parameters.opacity!).ok).toBe(false)
  })

  it('accepts a bare colour keyword for the rim, which is the spelling the docs promise', () => {
    expect(validate('silver', parameters.rim!).ok).toBe(true)
    expect(validate('rgb(255 255 255 / 0.4)', parameters.rim!).ok).toBe(true)
  })

  it('accepts both a length and a percentage radius, so one name covers a panel and a pill', () => {
    expect(validate('999px', parameters.radius!).ok).toBe(true)
    expect(validate('50%', parameters.radius!).ok).toBe(true)
    expect(parameters.radius!.type).toBe('length|percentage')
  })

  /**
   * The three "author said nothing" sentinels. `readParams` prefills every declared parameter with
   * its default before it looks at what was authored, and `resolveParams` emits only what *was*
   * authored — so an empty default is what guarantees no declaration reaches the element and
   * `glass.css`'s own `var()` fallback decides. For `radius:` in particular a real default would
   * put an inline custom property in front of a page's own `border-radius`.
   */
  it.each(['tint', 'rim', 'radius'])('leaves %s unset by default rather than seizing it', (name) => {
    expect(parameters[name]!.default).toBe('')
    expect(readEffectParams({}, parameters, () => {}).text(name)).toBe('')
  })

  it('rejects a value that is not the declared type instead of writing it to a stylesheet', () => {
    expect(validate('banana', parameters.blur!).ok).toBe(false)
    expect(validate('url(evil)', parameters.tint!).ok).toBe(false)
  })
})

/**
 * The four-way composition this whole family is designed around: one element, four effects, four
 * physical surfaces (the host box, its `::before`, its `::after`, and its `:active` state).
 *
 * `compile` *drops* every effect after the first when two channel claims overlap, so a broken
 * claim shows up here as a short `fxNames` rather than as a thrown error — which is exactly why
 * the list is asserted rather than just the warning count.
 */
describe('glass composes with the effects it was designed to be worn with', () => {
  it.each([
    ['glass, press-depth'],
    ['glass, beam-border'],
    ['glass, beam-border-auto'],
    ['glass, shine-sweep'],
  ])('composes %s', (attribute) => {
    const { warnings, fxNames } = plan(attribute)
    // `describeConflicts` is the only warning that costs an effect, so it is the one asserted
    // against by text — a timeline or activation note would be a different (and here absent)
    // complaint, and failing on the whole list would make this test about those instead.
    expect(warnings.join(' ')).not.toContain('both animate')
    expect(fxNames).toHaveLength(2)
  })

  it('composes all four at once, which is the reference look end to end', () => {
    const { warnings, fxNames } = plan('glass, beam-border, shine-sweep, press-depth')
    expect(warnings.join(' ')).not.toContain('both animate')
    expect([...fxNames].sort((a, b) => a.localeCompare(b))).toEqual([
      'beam-border',
      'glass',
      'press-depth',
      'shine-sweep',
    ])
  })

  /**
   * The other direction, so the assertions above cannot pass vacuously through a compiler that has
   * simply stopped detecting conflicts. `ambient-tint`'s presets paint `background` on the same
   * host box, which is a genuine collision and must still be refused.
   */
  it('still refuses a second effect that paints the same host background', () => {
    const { warnings, fxNames } = plan('glass, gradient-mesh')
    expect(warnings.join(' ')).toContain('background')
    expect(fxNames).toHaveLength(1)
  })
})

describe('glass.css', () => {
  it('writes every declaration on the host box and claims no pseudo-element', () => {
    // `::before` belongs to `beam-border`, `::after` to `shine-sweep`. A pseudo-element here would
    // have taken one of them, and there is no third to retreat to.
    expect(glassCss).not.toContain('::before')
    expect(glassCss).not.toContain('::after')
  })

  /**
   * `border:` is one of the few CSS shorthands that resets a property it does not name — it sets
   * `border-image` back to its initial value, which is the property `border-draw` paints its ring
   * with on this same host box. This primitive does not claim the `border` channel (it must not, or
   * `glass, beam-border` would be refused), so the shorthand would erase a composed
   * `border-draw` while the compiler reported a clean compose.
   */
  it('sets the hairline with border longhands, never the border shorthand', () => {
    expect(glassCss).toContain('border-width:')
    expect(glassCss).toContain('border-style:')
    expect(glassCss).toContain('border-color:')
    // Line-based rather than a regex: a pattern with a `\s*` on both sides of a literal is the
    // overlapping-quantifier shape `sonarjs/slow-regex` objects to, and every declaration in this
    // stylesheet is on its own line anyway.
    const shorthand = glassCss.split('\n').filter((line) => line.trim().startsWith('border:'))
    expect(shorthand).toEqual([])
  })

  it('ships the -webkit- twin of backdrop-filter, which Safari still needs', () => {
    expect(glassCss).toContain('-webkit-backdrop-filter:')
  })

  /**
   * Order matters and is not cosmetic: blurring averages the backdrop's colours toward grey, and
   * saturating the averaged result is what puts the colour back. The reverse order saturates
   * detail the blur then discards, and the panel reads flat.
   */
  it('saturates after blurring, not before', () => {
    const declaration = /(?:^|[^-])backdrop-filter: ([^;]+);/.exec(glassCss)?.[1] ?? ''
    expect(declaration.indexOf('blur(')).toBeGreaterThanOrEqual(0)
    expect(declaration.indexOf('blur(')).toBeLessThan(declaration.indexOf('saturate('))
  })

  /**
   * `backdrop-filter` is not a colour property, so `forced-colors: active` does not override it:
   * the blur would survive into the one mode whose entire purpose is maximum legibility. Nothing
   * else in the catalog writes the property, so this is not a case the catalog-wide forced-colors
   * pass would have caught by pattern.
   */
  it('drops the blur under forced-colors, where a UA-painted backdrop must stay legible', () => {
    const at = glassCss.indexOf('@media (forced-colors: active)')
    expect(at).toBeGreaterThan(-1)
    expect(glassCss.slice(at)).toContain('backdrop-filter: none')
  })

  it('is inside the kui.effects layer, so an unlayered page rule still beats it', () => {
    expect(glassCss).toContain('@layer kui.effects {')
  })

  /**
   * Every parameter's `cssProperty` has to be a property this stylesheet actually reads, or the
   * knob is advertised and swallowed — the quiet defect `interaction.ts`'s `hoverTimingFor` comment
   * describes for timing tokens. This is the same check for the material's own eight.
   */
  it('reads every custom property the schema declares', () => {
    const { parameters } = registry.resolve('glass')!.primitive
    const unread = Object.values(parameters)
      .map((spec) => spec.cssProperty)
      .filter((property) => !glassCss.includes(`var(${property}`))
    expect(unread).toEqual([])
  })
})

/**
 * `backdrop-filter` had no channel at all before this section existed, which made it structurally
 * invisible to `css-invariants.test.ts`'s static-rule check rather than merely unasserted — the
 * same hole `text-shadow` and `border` each had before their own entries landed.
 */
describe('the backdrop channel', () => {
  it('covers backdrop-filter and its prefixed twin', () => {
    expect(CHANNEL_PROPERTIES.backdrop).toEqual(['backdrop-filter', '-webkit-backdrop-filter'])
  })

  it('is kept out of the filter channel, so blurring yourself and your backdrop can compose', () => {
    expect(CHANNEL_PROPERTIES.filter).not.toContain('backdrop-filter')
    const { warnings, fxNames } = plan('glass, blur-in')
    expect(warnings.join(' ')).not.toContain('both animate')
    expect(fxNames).toHaveLength(2)
  })
})

/**
 * The two section-I parameter additions. Both were made instead of minting a near-duplicate effect,
 * so the load-bearing property of each is that the *defaults reproduce the shipped look exactly* —
 * a generalisation, not a replacement. A regression here is silent and visual, which is why the
 * arithmetic is asserted rather than the presence of the parameters.
 */
describe('beam-border gains a soft partial arc rather than a second effect', () => {
  const { parameters } = registry.resolve('beam-border')!.primitive

  it('declares arc and softness on both the hover and the always-on variant', () => {
    expect(parameters.arc!.type).toBe('angle')
    expect(parameters.softness!.type).toBe('number|percentage')
    const auto = registry.resolve('beam-border-auto')!.primitive.parameters
    expect(auto).toHaveProperty('arc')
    expect(auto).toHaveProperty('softness')
  })

  /**
   * At `softness: 1` the fade consumes the whole arc, putting the first colour stop past the last
   * one; CSS clamps out-of-order stops to their predecessor, so asking for maximum softness would
   * render a *hard* edge — the inverse of the parameter's own name. `0.9` is the largest value
   * that keeps the stops in order.
   */
  it('caps softness below 1, where the stops would cross and render the inverse look', () => {
    expect(parameters.softness!.maximum).toBe(0.9)
    expect(validate('1', parameters.softness!).ok).toBe(false)
    expect(validate('0.9', parameters.softness!).ok).toBe(true)
    expect(validate('60%', parameters.softness!).value).toBe('0.6')
  })

  /**
   * The defaults, resolved by hand against the `calc()` chain in `interaction.css`, against the six
   * literal stop angles the gradient shipped with. This is the assertion that makes "no existing
   * page changes" a fact rather than an intention.
   */
  it('resolves to the shipped 260/282/306/330/354/360 stops at its defaults', () => {
    const arc = Number.parseFloat(parameters.arc!.default)
    const softness = Number.parseFloat(parameters.softness!.default)
    const start = 360 - arc
    const stop1 = start + arc * softness
    const stop4 = 360 - arc * 0.06
    const step = (stop4 - stop1) / 3
    expect([start, stop1, stop1 + step, stop1 + step * 2, stop4]).toEqual([260, 282, 306, 330, 354])
  })

  it('drives the gradient from those derived properties rather than the old literals', () => {
    expect(interactionCss).toContain('--kui-beam-arc-start:')
    expect(interactionCss).toContain('var(--kui-beam-border-arc, 100deg)')
    expect(interactionCss).toContain('var(--kui-beam-border-softness, 0.22)')
    // The literals the chain replaced. Their absence is what proves the chain is live rather than
    // sitting unused beside a still-hardcoded gradient.
    expect(interactionCss).not.toContain('transparent 260deg')
    expect(interactionCss).not.toContain('#ff5f6d) 282deg')
  })

  it('still freezes at a fixed angle under reduced motion', () => {
    const at = interactionCss.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(-1)
    expect(interactionCss.slice(at)).toContain('--kui-border-angle: 45deg')
  })
})

describe('shine-sweep gains a parameterised band rather than a second effect', () => {
  const { parameters } = registry.resolve('shine-sweep')!.primitive

  it('declares the three literals its rule used to hardcode', () => {
    expect(parameters.angle!.type).toBe('angle')
    expect(parameters.width!.type).toBe('number|percentage')
    expect(parameters.color!.type).toBe('color')
  })

  /**
   * `calc(50% - 0.2 * 50%)` is `40%` and `calc(50% + 0.2 * 50%)` is `60%` — the shipped band,
   * unchanged, computed from one parameter instead of authored as a pair that could disagree.
   */
  it('reproduces the shipped 40%/50%/60% band at its default width', () => {
    const width = Number.parseFloat(parameters.width!.default)
    expect([50 - width * 50, 50 + width * 50]).toEqual([40, 60])
  })

  it('keeps the pre-existing --kui-c1 hook working behind the new parameter', () => {
    expect(interactionCss).toContain(
      'var(--kui-shine-sweep-color, var(--kui-c1, rgb(255 255 255 / 0.35)))',
    )
  })

  it('bounds width to the gradient it divides', () => {
    expect(validate('1.2', parameters.width!).ok).toBe(false)
    expect(validate('40%', parameters.width!).value).toBe('0.4')
  })

  /**
   * The sheen the glass family actually asks for, written entirely in the existing effect's own
   * grammar — which is the evidence that no `glass-sheen` effect was needed.
   */
  it('expresses the glass sheen with no new effect', () => {
    const { warnings, fxNames } = plan(
      'glass, shine-sweep angle:135deg width:0.4 color:rgb(255 255 255 / 0.5)',
    )
    expect(warnings).toEqual([])
    expect([...fxNames].sort((a, b) => a.localeCompare(b))).toEqual(['glass', 'shine-sweep'])
  })
})
