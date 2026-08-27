// @vitest-environment node
//
// Multi-waypoint tweening — `tween x:'0,100,40'`. `compile` is a pure function, so no DOM is in
// play; the stylesheet invariants for the blocks this selects live in `tween.test.ts`, next to the
// two-point ones they mirror.
import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import type { CompiledPlan } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { MAX_WAYPOINTS } from '../src/effects/tween/waypoints.js'
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
  it('warns when a list starts at zero scale, whichever direction the name says', () => {
    // A list writes its own 0% step, so `tween scale:'0,1'` deadlocks exactly as `tween-from
    // scale:0` does — IntersectionObserver measures geometry, so an element with no box never
    // intersects, never activates, and never leaves the state that made it invisible.
    expect(plan("tween scale:'0,1'").warnings.join()).toContain('starts with no box at all')
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
