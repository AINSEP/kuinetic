//
// Multi-waypoint tweening — `tween x:'0,100,40'`. `compile` is a pure function, so no DOM is in
// play; the stylesheet invariants for the blocks this selects live in `tween.test.ts`, next to the
// two-point ones they mirror.
import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import type { CompiledPlan } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { collectWaypoints, expandWaypoints, MAX_WAYPOINTS, readWaypoints } from '../src/effects/tween/waypoints.js'
import { catalogRegistry } from './support/registry.js'

let registry: Registry

beforeEach(() => {
  registry = catalogRegistry()
})

const plan = (attribute: string): CompiledPlan => compile(parse(attribute), registry, 'time')
const names = (attribute: string): string | undefined =>
  plan(attribute).declarations['animation-name']

describe('a value list selects an N-step block', () => {
  it('leaves a single value on the half-keyframe block it has always used', () => {
    expect(names('tween x:100')).toBe('kui-tween-to-translate')
    expect(names('tween-from y:40')).toBe('kui-tween-from-translate')
  })

  it('selects a block with one step per waypoint', () => {
    expect(names("tween x:'0,100,40'")).toBe('kui-tween-keys3-translate')
    expect(names("tween opacity:'0,1,0.5,1'")).toBe('kui-tween-keys4-opacity')
  })

  it('gives a two-value list an explicit from and to, which the two-point form cannot say', () => {
    // `tween x:100` is "from wherever it is"; there was no way to write "from 0 to 100" at all.
    expect(names("tween x:'0,100'")).toBe('kui-tween-keys2-translate')
  })

  it('shares one set of blocks between tween and tween-from', () => {
    // A list writes its own first step, so there is no implicit half left for a direction to pick.
    expect(names("tween-from x:'0,100,40'")).toBe('kui-tween-keys3-translate')
  })

  it('counts per group, not per attribute', () => {
    // CSS writes `translate` as one property and `opacity` as another, so they are separate blocks
    // and there is no reason a five-state move cannot run beside a four-state fade.
    expect(names("tween x:'0,10,20,30,40' opacity:'0,1,0.5,1'")).toBe(
      'kui-tween-keys5-translate, kui-tween-keys4-opacity',
    )
  })
})

describe('the expanded custom properties', () => {
  it('does not resolve prototype names as properties in the waypoint helpers', () => {
    const unknown: [string, string[]][] = [['__proto__', ['0', '1']], ['constructor', ['0', '1']]]
    expect(collectWaypoints(unknown, () => {}).size).toBe(0)
    const params = {}
    const schema = {}
    expandWaypoints({ count: 2, keys: new Map(unknown) }, params, schema, () => {})
    expect(params).toEqual({})
    expect(schema).toEqual({})
  })
  it('validates slot constraints and CSS-wide keywords at every numbered step', () => {
    const compiled = plan("tween z:'0,10%,20' blur:'0,-2,4' brightness:'1,-1,2' color:'red,inherit,blue'")
    for (const key of ['z', 'blur', 'brightness', 'color']) {
      expect(compiled.vars[`--kui-tween-${key}-2`]).toBeUndefined()
      expect(compiled.warnings.join()).toContain(`parameter "${key}[2]"`)
    }
  })

  it('supports numeric notation and the added filters in lists', () => {
    const compiled = plan("tween contrast:'50%,1e0,150%' hue-rotate:'0,90,180' invert:'0,50%,0' sepia:'0,1,0'")
    expect(compiled.declarations['animation-name']).toBe('kui-tween-keys3-filter')
    expect(compiled.vars).toMatchObject({
      '--kui-tween-contrast-1': '0.5', '--kui-tween-contrast-2': '1', '--kui-tween-contrast-3': '1.5',
      '--kui-tween-hue-rotate-2': '90deg', '--kui-tween-invert-2': '0.5', '--kui-tween-sepia-2': '1',
    })
    expect(compiled.warnings).toEqual([])
  })
  it('writes one numbered property per waypoint, with the implied unit', () => {
    expect(plan("tween x:'0,100,40'").vars).toMatchObject({
      '--kui-tween-x-1': '0px',
      '--kui-tween-x-2': '100px',
      '--kui-tween-x-3': '40px',
    })
  })

  it('still writes the plain property, which every step falls back through', () => {
    expect(plan("tween x:'0,100,40'").vars['--kui-tween-x']).toBe('0px')
  })

  it('leaves a scalar neighbour as one plain property, broadcast by the CSS fallback', () => {
    // The point of the broadcast rule: `y` is written once and holds across all three steps, with
    // no per-step duplication and nothing in JavaScript deciding what "holds" means.
    const vars = plan("tween x:'0,100,40' y:20").vars
    expect(vars['--kui-tween-y']).toBe('20px')
    expect(vars['--kui-tween-y-1']).toBeUndefined()
  })

  it('validates every waypoint, and names the one it rejected by index', () => {
    // The synthesised key is bracketed precisely so this message locates the bad value.
    const compiled = plan("tween x:'0,banana,40'")
    expect(compiled.warnings.join()).toContain('parameter "x[2]"')
    expect(compiled.vars['--kui-tween-x-2']).toBeUndefined()
    expect(compiled.vars['--kui-tween-x-3']).toBe('40px')
  })

  it('splits on top-level commas only, so a list of colours survives', () => {
    expect(plan("tween color:'rgb(1,2,3),rgb(4,5,6)'").vars).toMatchObject({
      '--kui-tween-color-1': 'rgb(1,2,3)',
      '--kui-tween-color-2': 'rgb(4,5,6)',
    })
  })

  it('keeps a parenthesised value with commas a single value, not a list', () => {
    expect(names('tween color:rgb(1, 2, 3)')).toBe('kui-tween-to-color')
  })
})

describe('lists that disagree', () => {
  it.each(['0,,100', '0,100,', ',100', ',,', '0,   ,100'])(
    'preserves empty slots in %s and diagnoses them without changing the rhythm', (raw) => {
      const compiled = plan(`tween x:'${raw}'`)
      expect(readWaypoints(raw)).toHaveLength(raw.split(',').length)
      expect(compiled.warnings.join()).toContain('empty value')
      expect(compiled.declarations['animation-name']).toBe(`kui-tween-keys${raw.split(',').length}-translate`)
    },
  )

  it('preserves a function comma while keeping empty neighbours', () => {
    expect(readWaypoints('rgb(0, 0, 0), ,rgb(255, 255, 255)')).toEqual([
      'rgb(0, 0, 0)', '', 'rgb(255, 255, 255)',
    ])
    expect(readWaypoints('translate(1px, 2px)')).toEqual(['translate(1px, 2px)'])
    expect(readWaypoints(' 100 ')).toEqual(['100'])
    expect(readWaypoints('"a,\\"b",100')).toEqual(['"a,\\"b"', '100'])
  })

  /**
   * A quote the author never closed — the realistic typo in a hand-edited attribute. The scanner
   * runs to the end of the string looking for the partner and stops there, which keeps everything
   * after the stray quote as one value and sends it to ordinary parameter validation to be rejected
   * by name.
   *
   * The alternative reading — "no close, so it was never a quote" — is the one worth ruling out:
   * it splits on the commas *inside* what the author was plainly quoting, so a single bad value
   * silently becomes a three-waypoint animation that compiles, runs, and is wrong.
   */
  it('runs an unterminated quote to the end of the value instead of splitting inside it', () => {
    expect(readWaypoints('0,"100,40')).toEqual(['0', '"100,40'])
    expect(readWaypoints("'0,100,40")).toEqual(["'0,100,40"])
    // A trailing backslash inside the unterminated run must not read past the end either.
    expect(readWaypoints('0,"a,b\\')).toEqual(['0', '"a,b\\'])
  })

  it('keeps expansion bounded for a very long list', () => {
    const compiled = plan(`tween x:'${Array.from({ length: 2000 }, (_, i) => i).join(',')}'`)
    expect(compiled.vars['--kui-tween-x-5']).toBe('4px')
    expect(compiled.vars['--kui-tween-x-6']).toBeUndefined()
    expect(compiled.warnings.join()).toContain('2000 waypoints')
  })
  it('holds a shorter list at its last value, and says so', () => {
    // Identity would send `y` back to 0 on the last leg — a movement the author never wrote.
    const compiled = plan("tween x:'0,100,40' y:'0,-60'")
    expect(compiled.vars['--kui-tween-y-3']).toBe('-60px')
    expect(compiled.warnings.join()).toContain('holds at "-60px" for the rest')
  })

  it('names the group, since that is the surprising part', () => {
    // `x` and `y` share a block because CSS writes `translate` as one property.
    expect(plan("tween x:'0,100,40' y:'0,-60'").warnings.join()).toContain('"translate"')
  })

  it('truncates past the ceiling and says where the animation now ends', () => {
    const compiled = plan("tween x:'0,1,2,3,4,5,6'")
    expect(names("tween x:'0,1,2,3,4,5,6'")).toBe(`kui-tween-keys${String(MAX_WAYPOINTS)}-translate`)
    expect(compiled.warnings.join()).toContain('at most 5 are supported')
    expect(compiled.vars['--kui-tween-x-6']).toBeUndefined()
  })
})

describe('the zero-area trap', () => {
  it.each(['0%', '-0', '+0', '0e3', '-0.0%'])('recognizes zero scale spelled %s', (value) => {
    expect(plan(`tween-from scale:${value}`).warnings.join()).toContain('starts with no box')
  })
  it('includes scalar scale axes held by a waypoint block', () => {
    expect(plan("tween scale:'1,2' scale-x:0").warnings.join()).toContain('starts with no box')
    expect(plan("tween scale-x:'1,2' scale-y:-0").warnings.join()).toContain('starts with no box')
  })

  it('uses axis overrides before uniform scale when diagnosing the start', () => {
    expect(plan("tween scale:'0,1' scale-x:1 scale-y:1").warnings.join()).not.toContain('no box')
    expect(plan('tween-from scale:0 scale-x:1 scale-y:1').warnings.join()).not.toContain('no box')
  })

  it('does not mistake an invalid zero-prefixed value for a collapsing scale', () => {
    expect(plan('tween-from scale:0banana').warnings.join()).not.toContain('no box')
  })
  it('warns when a list starts at zero scale, whichever direction the name says', () => {
    // A list writes its own 0% step, so `tween scale:'0,1'` deadlocks exactly as `tween-from
    // scale:0` does — IntersectionObserver measures geometry, so an element with no box never
    // intersects, never activates, and never leaves the state that made it invisible.
    expect(plan("tween scale:'0,1'").warnings.join()).toContain('starts with no box area')
    expect(plan("tween-from scale:'0,1.2,1'").warnings.join()).toContain('starts with no box')
  })

  it('stays quiet for a to-tween that merely ends at zero scale', () => {
    // Its start state is wherever the element already is, which has a box.
    expect(plan('tween scale:0').warnings.join()).not.toContain('no box')
  })

  it('stays quiet when the list starts somewhere visible', () => {
    expect(plan("tween scale:'1,0'").warnings.join()).not.toContain('no box')
  })
})

describe('easing per property group', () => {
  it.each(['tween', 'tween-from'])('lets %s move and fade on different curves', (name) => {
    const compiled = plan(`${name} x:100 opacity:0 translate-ease:linear opacity-ease:back-out 800ms`)
    expect(compiled.vars).toMatchObject({
      '--kui-tween-translate-ease': 'linear',
      '--kui-tween-opacity-ease': 'var(--kui-ease-back-out, ease-out)',
      '--kui-tween-translate-default-ease': `var(--kui-${name}-ease, ease-out)`,
    })
    expect(compiled.warnings).toEqual([])
    expect(compiled.keyframeNames).toHaveLength(2)
    expect(compiled.jsEffects).toEqual([])
  })

  it('keeps positional easing ahead of named easing for groups without an override', () => {
    const compiled = plan("tween x:'0,100,40' opacity:'0,1' 800ms 0ms linear ease:back-out translate-ease:steps(2,end)")
    expect(compiled.vars['--kui-tween-translate-ease']).toBe('steps(2,end)')
    expect(compiled.vars['--kui-tween-opacity-default-ease']).toBe('linear')
    expect(compiled.warnings).toEqual([])
  })

  it('validates group curves and synthesizes a spring into CSS', () => {
    const compiled = plan('tween x:100 opacity:0 translate-ease:spring(1,100,10,0) opacity-ease:"linear; color:red"')
    expect(compiled.vars['--kui-tween-translate-ease']).toMatch(/^linear\(/)
    expect(compiled.vars['--kui-tween-opacity-ease']).toBeUndefined()
    expect(compiled.warnings.join()).toContain('disallowed CSS syntax')
  })

  it('does not create an animation from an easing alone', () => {
    expect(plan('tween translate-ease:linear').keyframeNames).toEqual([])
  })
})

describe('what a waypoint list does not change', () => {
  it('claims the same channel as the two-point form', () => {
    expect(plan("tween x:'0,100,40'").channels).toEqual(plan('tween x:100').channels)
  })

  it('still renders through CSS keyframes, with no JavaScript effect', () => {
    expect(plan("tween x:'0,100,40'").jsEffects).toEqual([])
  })

  it('still collides with an entrance on the same channel', () => {
    expect(plan("tween x:'0,100,40', fade-up").warnings.join()).toContain('translate')
  })
})
