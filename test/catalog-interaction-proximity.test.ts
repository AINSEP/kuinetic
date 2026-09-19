// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  PROXIMITY_FIELD_PRESETS,
  PROXIMITY_GLOW_PRESETS,
  registerInteractionProximity,
} from '../src/effects/catalog/interaction-proximity.js'

/**
 * Cross-element pointer proximity — the bento-grid glow. Two primitives (`interaction-proximity.ts`
 * has the full mechanism doc comment): `proximity-field` is a real, continuous JS tracker on the
 * container; `proximity-glow` is a near-no-op CSS-driven ring on each card, exactly the
 * `stylesheetTimingPrepare` shape `catalog-interaction.test.ts` already exercises for the hover
 * family.
 *
 * A dedicated file rather than folding into `catalog-interaction.test.ts` or
 * `catalog-interaction-reveal.test.ts`, because this family is registered through its own
 * `registerInteractionProximity` — called from `catalog/index.ts`, not from `interaction.ts` — and
 * has no pre-existing test file to extend.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'),
  'utf8',
)

function registry(): Registry {
  return registerInteractionProximity(new Registry())
}

function fakeCtx(el: Element, overrides: Partial<PrepareContext> = {}): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
    ...overrides,
  } as unknown as PrepareContext
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  const event = new Event(type) as PointerEvent
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  return event
}

describe('proximity registration', () => {
  it('registers both halves of the family under their own aggregator', () => {
    expect(PROXIMITY_FIELD_PRESETS.map((p) => p.name)).toEqual(['proximity-field'])
    expect(PROXIMITY_GLOW_PRESETS.map((p) => p.name)).toEqual(['proximity-glow'])
    const reg = registry()
    expect(reg.resolve('proximity-field')!.primitive.id).toBe('proximity-field')
    expect(reg.resolve('proximity-glow')!.primitive.id).toBe('proximity-glow')
  })

  it('gives the container a channel of its own and the card the shared ::before token', () => {
    const reg = registry()
    expect(reg.resolve('proximity-field')!.primitive.channels).toEqual(['proximity'])
    expect(reg.resolve('proximity-glow')!.primitive.channels).toEqual(['pseudo-before'])
  })

  it('declares phase: state on both, explicitly — neither carries Preset.transitions to derive it from', () => {
    // `compile.ts`'s `phaseOf` treats an undeclared phase as a real fifth state that conflicts with
    // everything, not a permissive default. Neither preset here has a `transitions` field for
    // `phaseOf` to derive `'state'` from on its own (the ring's opacity lives on `::before`, not the
    // host box `Preset.transitions` describes), so both have to say so themselves. This is the exact
    // bug class four other effects shipped earlier today, undeclared — this suite exists so it
    // cannot recur silently in this family.
    const reg = registry()
    expect(reg.resolve('proximity-field')!.preset.phase).toBe('state')
    expect(reg.resolve('proximity-field')!.preset.transitions).toBeUndefined()
    expect(reg.resolve('proximity-glow')!.preset.phase).toBe('state')
    expect(reg.resolve('proximity-glow')!.preset.transitions).toBeUndefined()
  })

  it('declares proximity-field continuous and reduced-motion disabled, matching the pointer-tracking family', () => {
    const primitive = registry().resolve('proximity-field')!.primitive
    expect(primitive.perfClass).toBe('continuous')
    expect(primitive.reducedMotion).toBe('disable')
  })

  it('refuses duration/delay on proximity-field by name — it has no start moment to act on', () => {
    const warnings: string[] = []
    const el = document.createElement('div')
    const primitive = registry().resolve('proximity-field')!.primitive
    const instance = primitive.prepare!(
      el,
      createParams({}, { durationMs: 300, delayMs: 100 }),
      fakeCtx(el, { warn: (m) => warnings.push(m) }),
    )
    instance.activate()
    expect(warnings.some((w) => w.includes('duration'))).toBe(true)
    expect(warnings.some((w) => w.includes('delay'))).toBe(true)
    instance.destroy()
  })

  it('refuses delay on proximity-glow by name, but honours duration and ease', () => {
    const warnings: string[] = []
    const el = document.createElement('div')
    const primitive = registry().resolve('proximity-glow')!.primitive
    const instance = primitive.prepare!(
      el,
      createParams({}, { delayMs: 100 }),
      fakeCtx(el, { warn: (m) => warnings.push(m) }),
    )
    instance.activate()
    expect(warnings.some((w) => w.includes('delay'))).toBe(true)
    instance.destroy()
  })
})

describe('proximity-field (real JS, one listener, no per-frame loop)', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('no-ops on a coarse pointer instead of wiring listeners', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const coarseWin = { matchMedia: () => ({ matches: false }) } as unknown as Window
    const instance = registry().resolve('proximity-field')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el, { win: coarseWin }),
    )
    expect(() => instance.activate()).not.toThrow()
    el.dispatchEvent(pointerEvent('pointermove', 40, 50))
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-x')).toBe('')
    instance.destroy()
  })

  it('publishes raw viewport coordinates on pointermove — no rect subtraction, no spring', () => {
    // Deliberately the *viewport* position (`event.clientX`/`clientY`), not a position relative to
    // the container: that is the whole trick that makes `background-attachment: fixed` read every
    // card's ring as one shared light source with zero per-card math. A test that expected an
    // offset relative to the container would be asserting the wrong mechanism.
    const el = document.createElement('div')
    document.body.append(el)
    const instance = registry().resolve('proximity-field')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el),
    )
    instance.activate()

    el.dispatchEvent(pointerEvent('pointermove', 321, 87))
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-x')).toBe('321px')
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-y')).toBe('87px')
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-opacity')).toBe('1')

    el.dispatchEvent(new Event('pointerleave'))
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-opacity')).toBe('0')

    instance.destroy()
  })

  it('stops listening once destroyed', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const instance = registry().resolve('proximity-field')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el),
    )
    instance.activate()
    instance.destroy()

    el.dispatchEvent(pointerEvent('pointermove', 10, 10))
    expect((el as HTMLElement).style.getPropertyValue('--kui-proximity-x')).toBe('')
  })
})

describe('proximity-glow (CSS-driven, near no-op prepare)', () => {
  it('resolves to an inert instance — the ring is CSS reading the ancestor field', () => {
    const el = document.createElement('div')
    const instance = registry().resolve('proximity-glow')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.outerHTML).toBe('<div></div>')
    instance.destroy()
  })

  it('paints its ring on ::before with background-attachment: fixed, the whole mechanism', () => {
    const start = css.indexOf("[data-kui-fx~='proximity-glow']::before")
    expect(start).toBeGreaterThan(-1)
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('background-attachment: fixed')
    expect(body).toContain('var(--kui-proximity-x, -9999px)')
    expect(body).toContain('var(--kui-proximity-y, -9999px)')
    expect(body).toContain('mask-composite: exclude')
  })

  it('parks the ring off-screen and invisible before any pointer has been tracked', () => {
    const start = css.indexOf("[data-kui-fx~='proximity-glow']::before")
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('opacity: var(--kui-proximity-opacity, 0)')
  })

  it('exposes radius/width/outset/color, matching the beam-border ring family knobs', () => {
    const params = registry().resolve('proximity-glow')!.primitive.parameters
    expect(params.radius!.default).toBe('220px')
    expect(params.width!.default).toBe('1px')
    expect(params.outset!.default).toBe('0px')
    expect(params.color!.default).toBe('')
  })
})
