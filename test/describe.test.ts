import { describe, expect, it } from 'vitest'
import {
  describeAttribute,
  describeEffect,
  describeElementAttribute,
  describeKeys,
  spellingsFor,
} from '../src/core/describe.js'
import { validate } from '../src/core/params.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { parsePosition } from '../src/core/sequence.js'
import { declareTimingContract, inheritTimingContract, timingContractOf } from '../src/core/timing-contract.js'
import { inertInstance } from '../src/core/types.js'
import type { ParamSpec, Primitive } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'
import { describe as describeName, describeElement, describeSteps } from '../src/index.js'

const catalog = createRegistry()

function primitive(id: string, parameters: Primitive['parameters']): Primitive {
  return {
    id,
    renderer: 'css-keyframes',
    channels: [],
    parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    perfClass: 'compositor',
    reducedMotion: 'shorten',
  }
}

/** A tiny registry whose every lookup path is under the test's control. */
function fixture(): Registry {
  return new Registry()
    .registerPrimitive(
      primitive('wobble', {
        duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
        size: { type: 'length', default: '4px', cssProperty: '--kui-size' },
        tilt: { type: 'angle', default: '12deg', cssProperty: '--kui-tilt' },
        mode: { type: 'keyword', default: 'a', keywords: ['a', 'b'], cssProperty: '--kui-mode' },
        inline: { type: 'number', default: '1', cssProperty: '--kui-inline', note: 'Inline wins.' },
      }),
    )
    .registerPreset({ name: 'wobble', primitive: 'wobble' })
    .registerPreset({ name: 'wobble-big', primitive: 'wobble', params: { size: '20px' } })
}

describe('describeEffect', () => {
  it('returns undefined for an unregistered name', () => {
    expect(describeEffect(fixture(), 'nope')).toBeUndefined()
  })

  it('applies a Preset.params override to the default and says so', () => {
    const plain = describeEffect(fixture(), 'wobble')!.params.find((p) => p.name === 'size')!
    const big = describeEffect(fixture(), 'wobble-big')!.params.find((p) => p.name === 'size')!
    expect(plain).toMatchObject({ default: '4px', presetDefault: false })
    expect(big).toMatchObject({ default: '20px', presetDefault: true })
    expect(big.spellings[0]).toBe('20px')
    // The real catalog: carousel-3d sets its own tilt over spatial-ring's.
    const tilt = describeEffect(catalog, 'carousel-3d')!.params.find((p) => p.name === 'tilt')!
    expect(tilt).toMatchObject({ default: '12deg', presetDefault: true, spellings: ['12', '12d', '12deg'] })
  })

  it('looks notes up preset first, then primitive, then shared, and an inline note beats all', () => {
    const notes = {
      'wobble-big.size': 'preset',
      'wobble.size': { why: 'primitive', whenOmitted: 'w', required: true },
      '*.size': 'shared',
      '*.tilt': 'shared tilt',
      'wobble.inline': 'table',
    }
    const big = describeEffect(fixture(), 'wobble-big', notes)!.params
    const plain = describeEffect(fixture(), 'wobble', notes)!.params
    expect(big.find((p) => p.name === 'size')).toMatchObject({ note: 'preset', required: false })
    expect(plain.find((p) => p.name === 'size')).toMatchObject({ note: 'primitive', whenOmitted: 'w', required: true })
    expect(plain.find((p) => p.name === 'tilt')!.note).toBe('shared tilt')
    expect(plain.find((p) => p.name === 'inline')!.note).toBe('Inline wins.')
    expect(plain.find((p) => p.name === 'mode')).not.toHaveProperty('note')
  })

  it('reports keywords and numeric bounds', () => {
    const r = new Registry()
      .registerPrimitive(
        primitive('n', {
          count: { type: 'number', default: '3', minimum: 1, maximum: 9, integer: true, cssProperty: '--c' },
        }),
      )
      .registerPreset({ name: 'n', primitive: 'n' })
    expect(describeEffect(r, 'n')!.params[0]).toMatchObject({ minimum: 1, maximum: 9, integer: true })
    const mode = describeEffect(fixture(), 'wobble')!.params.find((p) => p.name === 'mode')!
    expect(mode.keywords).toEqual(['a', 'b'])
    expect(mode).not.toHaveProperty('minimum')
  })
})

describe('positional order', () => {
  it('matches how parse() assigns bare tokens: 1st time, 2nd time, then an easing by shape', () => {
    const hover = describeEffect(catalog, 'hover-intent')!
    expect(hover.positionalOrder).toEqual([
      { slot: 'duration', accepts: 'time', param: 'duration', honoured: true },
      { slot: 'delay', accepts: 'time', param: 'delay', honoured: true },
      { slot: 'ease', accepts: 'easing', param: 'ease', honoured: true },
    ])
    // Prove the order against the real parser rather than restating it.
    const spec = parse('hover-intent 160ms 350ms ease-in').specs[0]!
    const bySlot = { duration: spec.duration, delay: spec.delay, ease: spec.easing }
    expect(hover.positionalOrder.map((s) => bySlot[s.slot])).toEqual(['160ms', '350ms', 'ease-in'])
    const index = Object.fromEntries(hover.params.map((p) => [p.name, p.positionalIndex]))
    expect(index).toMatchObject({ duration: 0, delay: 1, ease: 2, distance: undefined })
  })

  it('omits param for a slot the primitive does not declare', () => {
    const order = describeEffect(fixture(), 'wobble')!.positionalOrder
    expect(order.map((s) => s.param)).toEqual(['duration', undefined, undefined])
  })
})

describe('spellings', () => {
  it('every example of every registered parameter passes the validator', () => {
    const rejected = catalog.names().flatMap((name) => {
      const { primitive } = catalog.resolve(name)!
      return describeEffect(catalog, name)!.params.flatMap((param) =>
        param.spellings
          .filter((value) => !validate(value, primitive.parameters[param.name]!).ok)
          .map((value) => `${name}.${param.name}: ${value}`),
      )
    })
    expect(rejected).toEqual([])
  })

  const spec = (type: ParamSpec['type'], def = '', keywords?: string[]): ParamSpec =>
    ({ type, default: def, cssProperty: '--x', ...(keywords ? { keywords } : {}) }) as ParamSpec

  it.each([
    ['angle', '12deg', ['12', '12d', '12deg']],
    ['angle', '-8', ['-8', '-8d', '-8deg']],
    ['angle', '0.5turn', ['0.5turn', '45', '45d', '45deg']],
    ['angle', '', ['45', '45d', '45deg']],
    ['time', '350ms', ['350ms', '0.35s']],
    ['time', '2s', ['2s', '2000ms']],
    ['time', '', ['600ms', '0.6s']],
    ['number', '', ['1']],
    ['percentage', '', ['50%']],
    ['number|percentage', '0.07', ['0.07', '7%']],
    ['number|percentage', '80%', ['0.8', '80%']],
    ['number|percentage', '', ['0.5', '50%']],
    ['length', '', ['24px', 'calc(1rem + 4px)']],
    ['length|percentage', '', ['24px', '50%']],
    ['color', '', ['#e4f222', 'rgb(228 242 34)', 'currentcolor']],
    ['easing', '', ['ease-out', 'linear', 'cubic-bezier(.2, .8, .2, 1)', 'spring']],
    ['path', '', ['M0,0L100,0']],
    ['text', 'x', []],
  ] as const)('%s with default %j', (type, def, expected) => {
    const s = spec(type, def)
    expect(spellingsFor(s)).toEqual(expected)
    for (const value of expected) expect(validate(value, s).ok).toBe(true)
  })

  it('lists words for keyword types, after the angle forms for angle|keyword', () => {
    expect(spellingsFor(spec('keyword', 'a', ['a', 'b']))).toEqual(['a', 'b'])
    expect(spellingsFor(spec('angle|keyword', 'auto', ['auto', 'reverse']))).toEqual([
      '45', '45d', '45deg', 'auto', 'reverse',
    ])
    expect(spellingsFor(spec('angle|keyword', '30deg', ['auto']))).toEqual(['30', '30d', '30deg', 'auto'])
  })

  it('does not offer a default the validator would refuse', () => {
    // `offset-top`'s real default reaches for the page's own property.
    expect(spellingsFor(spec('length', 'var(--kui-pin-offset, 0px)'))).toEqual(['24px', 'calc(1rem + 4px)'])
  })
})

describe('describeAttribute', () => {
  it('describes each step of a data-kui value in order, flagging unknown names', () => {
    const steps = describeAttribute(fixture(), 'wobble 200ms, wobbel, zzzzzzzzzz')
    expect(steps.map((s) => s.name)).toEqual(['wobble', 'wobbel', 'zzzzzzzzzz'])
    expect(steps[0]).toHaveProperty('primitive', 'wobble')
    const none = { written: {}, writtenKeys: {} }
    expect(steps[1]).toEqual({ name: 'wobbel', unknown: true, suggestion: 'wobble', ...none })
    expect(steps[2]).toEqual({ name: 'zzzzzzzzzz', unknown: true, ...none })
  })
})

describe('what a step wrote', () => {
  it('maps bare tokens to the param they stand in for, beside key:value params', () => {
    const [step] = describeAttribute(catalog, 'hover-intent 160ms 350ms ease-in place:bottom')
    expect(step!.written).toEqual({ duration: '160ms', delay: '350ms', ease: 'ease-in', place: 'bottom' })
    expect(step!.writtenKeys).toEqual({})
  })

  it('gives each step only its own values, and an empty record when it set nothing', () => {
    const steps = describeAttribute(catalog, 'fade-up 900ms distance:40px, lift')
    expect(steps.map((s) => s.written)).toEqual([{ duration: '900ms', distance: '40px' }, {}])
  })

  it('lets a bare token win over the same name written as key:value, as the runtime does', () => {
    expect(describeAttribute(catalog, 'fade-up duration:300ms 900ms')[0]!.written).toEqual({ duration: '900ms' })
  })

  it('keeps a key the effect does not declare, so a reader can be told it is ignored', () => {
    expect(describeAttribute(catalog, 'fade-up bogus:1')[0]!.written).toEqual({ bogus: '1' })
  })

  it('reports step-scoped reserved keys apart from the effect args', () => {
    const [, second] = describeAttribute(catalog, 'fade-up, lift at:-200ms above:md narrow:sm repeat:3 yoyo:true')
    expect(second!.written).toEqual({})
    expect(second!.writtenKeys).toEqual({ at: '-200ms', above: 'md', narrow: 'sm', repeat: '3', yoyo: 'true' })
  })

  it('reports element keys a target: scoped to its own step under the written word', () => {
    const [step] = describeAttribute(catalog, "fade-up target:'.card img' on:click cascade:90ms rm:disable")
    expect(step!.written).toEqual({ target: '.card img' })
    // rm: is never scoped to a step — one element has one reduced-motion policy.
    expect(step!.writtenKeys).toEqual({ on: 'click', cascade: '90ms' })
    expect(describeElementAttribute(catalog, "fade-up target:'.card img' rm:disable").written).toEqual({
      rm: 'disable',
    })
  })
})

describe('reserved keys', () => {
  const keys = describeKeys()
  const byName = new Map(keys.map((key) => [key.name, key]))

  it('describes every element key once per attribute, with what this value set', () => {
    const element = describeElementAttribute(catalog, 'fade-up on:click timeline:view, lift rm:shorten')
    expect(element.written).toEqual({ on: 'click', timeline: 'view', rm: 'shorten' })
    expect(element.steps.map((s) => s.name)).toEqual(['fade-up', 'lift'])
    expect(element.keys).toEqual(keys)
  })

  it('scopes each key the way the parser does: element-wide or per step', () => {
    const scopes = Object.fromEntries(keys.map((key) => [key.name, key.scope]))
    expect(scopes).toEqual({
      on: 'element', actions: 'element', timeline: 'element', threshold: 'element', cascade: 'element',
      spread: 'element', order: 'element', cols: 'element', along: 'element', rm: 'element', func: 'element',
      at: 'step', above: 'step', below: 'step', wide: 'step', narrow: 'step', repeat: 'step', yoyo: 'step',
    })
    // Proved against the parser, not restated: an element key lands on the ParsedValue whichever
    // step carries it; a step key lands on that step's own spec only.
    for (const key of keys) {
      const value = `${key.name}:${key.spellings[0]}`
      const parsed = parse(`fade-up, lift ${value}`)
      const own = describeAttribute(catalog, `fade-up, lift ${value}`)
      if (key.scope === 'element') {
        expect(describeElementAttribute(catalog, `fade-up, lift ${value}`).written, value).toHaveProperty(key.name)
        expect(own[1]!.writtenKeys, value).toEqual({})
      } else {
        expect(own[1]!.writtenKeys, value).toHaveProperty(key.name)
        expect(own[0]!.writtenKeys, value).toEqual({})
      }
      // Never reaches the effect as an argument.
      expect(parsed.specs[1]!.params, value).toEqual({})
    }
  })

  it('offers only spellings the parser accepts without a warning', () => {
    const warned = keys.flatMap((key) =>
      key.spellings.flatMap((spelling) => {
        const { warnings } = parse(`fade-up ${key.name}:${spelling}`)
        return warnings.map((w) => `${key.name}:${spelling} — ${w}`)
      }),
    )
    expect(warned).toEqual([])
    // at: is checked later, by the sequencer; prove its spellings there.
    for (const spelling of byName.get('at')!.spellings) expect(parsePosition(spelling).ok, spelling).toBe(true)
  })

  it('reads notes from the data-kui owner, and leaves the default to the note', () => {
    const [on] = describeKeys({ 'data-kui.on': { why: 'Starts it.', whenOmitted: 'In view.' }, '*.on': 'no' })
    expect(on).toMatchObject({ name: 'on', note: 'Starts it.', whenOmitted: 'In view.', default: '', required: false })
    expect(keys.every((key) => key.default === '' && key.note === undefined)).toBe(true)
    expect(byName.get('rm')!.keywords).toEqual(['shorten', 'crossfade', 'disable'])
    expect(byName.get('above')!.keywords).toContain('md')
  })
})

describe('which bare timing tokens an effect honours', () => {
  it('marks a token the primitive refuses, with its reason', () => {
    const pin = describeEffect(catalog, 'pin-section')!
    expect(pin.positionalOrder.find((s) => s.slot === 'delay')!.honoured).toBe(false)
    expect(pin.unhonouredBecause).toMatch(/scroll/)
  })

  it('honours all three with no reason when the primitive declares no contract', () => {
    const fade = describeEffect(catalog, 'fade-up')!
    expect(fade.positionalOrder.map((s) => s.honoured)).toEqual([true, true, true])
    expect(fade).not.toHaveProperty('unhonouredBecause')
  })

  it('reads the contract through a wrapper that carries it over', () => {
    const inner = declareTimingContract(() => inertInstance(), { honours: ['duration'], because: 'b' })
    const outer = inheritTimingContract(inner, () => inertInstance())
    expect(timingContractOf({ ...primitive('p', {}), prepare: outer })).toEqual({ honours: ['duration'], because: 'b' })
    expect(inheritTimingContract(() => inertInstance(), outer)).toBe(outer)
    const none = declareTimingContract(() => inertInstance(), { because: 'nothing to time' })
    const registry = new Registry()
      .registerPrimitive({ ...primitive('still', {}), renderer: 'javascript', prepare: none })
      .registerPreset({ name: 'still', primitive: 'still' })
    expect(describeEffect(registry, 'still')!.positionalOrder.map((s) => s.honoured)).toEqual([false, false, false])
  })
})

describe('top-level describe()/describeSteps()', () => {
  it('default to the bundled catalog and accept a registry and notes', () => {
    expect(describeName('fade-up')!.primitive).toBe('reveal')
    expect(describeName('no-such-effect')).toBeUndefined()
    expect(describeName('wobble', { registry: fixture(), notes: { '*.size': 'n' } })!.params[1]!.note).toBe('n')
    expect(describeSteps('fade-up, lift').map((s) => s.name)).toEqual(['fade-up', 'lift'])
    expect(describeSteps('wobble', { registry: fixture() })[0]).toHaveProperty('primitive', 'wobble')
    expect(describeSteps('fade-up 900ms')[0]!.written).toEqual({ duration: '900ms' })
    const element = describeElement('fade-up on:click', { notes: { 'data-kui.on': 'Starts it.' } })
    expect(element.written).toEqual({ on: 'click' })
    expect(element.keys[0]).toMatchObject({ name: 'on', note: 'Starts it.' })
    expect(describeElement('wobble', { registry: fixture() }).steps[0]).toHaveProperty('primitive', 'wobble')
  })
})
