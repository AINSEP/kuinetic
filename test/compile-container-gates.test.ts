import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The `wide:`/`narrow:` half of the gate grammar — split into its own file rather than folded
 * into `compile.test.ts`'s "compile — viewport gates" suite, once that file's own `max-lines` cap
 * made a fourth growth spot the wrong place. Mirrors that suite's shape one-for-one: the compiled
 * `animation-name` output, then composition across a disjoint band, then the one behaviour the
 * viewport axis never needed — refusing the gate outright on a JavaScript-rendered primitive,
 * since there is no `matchContainer()` for `compile.ts`'s `refuseContainerGate` to hand off to.
 */

const registry = catalogRegistry()

function run(source: string, timeline: 'time' | 'view' | 'scroll' = 'time') {
  return compile(parse(source), registry, timeline)
}

describe('compile — container gates', () => {
  it('wraps a container-gated track in its switch property, keeping the ident as the fallback', () => {
    // Same compiled shape as the viewport half, different property names — see `gatedAnimationName`.
    expect(run('fade-up wide:md').declarations['animation-name']).toBe(
      'var(--kui-wide-md, kui-in-up)',
    )
  })

  it('nests both halves of a container band', () => {
    expect(run('fade-up wide:md narrow:xl').declarations['animation-name']).toBe(
      'var(--kui-wide-md, var(--kui-narrow-xl, kui-in-up))',
    )
  })

  it('nests a viewport gate and a container gate together, viewport outermost', () => {
    expect(run('fade-up above:md wide:lg').declarations['animation-name']).toBe(
      'var(--kui-above-md, var(--kui-wide-lg, kui-in-up))',
    )
  })

  it('composes two effects that share a channel but can never share a container width', () => {
    // The container axis narrows composition exactly the way the viewport axis does —
    // `gatesOverlap` checks both.
    const plan = run('fade-up narrow:md, parallax-y wide:md', 'view')
    expect(plan.fxNames).toEqual(['fade-up', 'parallax-y'])
    expect(plan.warnings.join()).not.toContain('cannot compose')
  })

  // `count-up` is a `renderer: 'javascript'` primitive — `compile.test.ts`'s "reports no keyframe
  // names for an element with no CSS-rendered effect" test is the existing proof of that.
  describe('on a JavaScript-rendered primitive', () => {
    it('strips wide:/narrow: and warns by name, rather than silently never running', () => {
      const plan = run('count-up wide:md')
      expect(plan.jsEffects).toHaveLength(1)
      expect(plan.jsEffects[0]?.spec.gate).toBeUndefined()
      expect(plan.warnings.join()).toContain('"count-up" ignores "wide:"/"narrow:"')
      expect(plan.warnings.join()).toContain('runs unconditionally')
    })

    it('leaves an above:/below: gate on the same segment untouched', () => {
      const plan = run('count-up above:md narrow:lg')
      expect(plan.jsEffects[0]?.spec.gate).toEqual({ above: 'md' })
    })

    it('does not warn when the segment carries no container gate at all', () => {
      expect(run('count-up above:md').warnings.join()).not.toContain('wide')
      expect(run('count-up').warnings).toEqual([])
    })

    it('does not let a soon-to-be-stripped container gate suppress a real channel conflict', () => {
      // Regression for the ordering in `compile.ts`: if composition ran before the strip, two
      // JS-rendered effects claiming the same channel on a disjoint container band would look
      // non-overlapping and compose — then both run unconditionally once the gate is gone, which
      // is a live collision the compiler waved through.
      const custom = new Registry()
      const jsPrimitive = (id: string) => ({
        id,
        renderer: 'javascript' as const,
        channels: ['text'],
        parameters: {},
        supportedTimelines: ['time' as const],
        supportedActivations: ['load' as const],
        defaultActivation: 'load' as const,
        perfClass: 'paint' as const,
        reducedMotion: 'shorten' as const,
        prepare: () => ({
          activate() {},
          cancel() {},
          finish() {},
          finished: Promise.resolve(),
          destroy() {},
        }),
      })
      custom.registerPrimitives([jsPrimitive('p-js-a'), jsPrimitive('p-js-b')])
      custom.registerPresets([
        { name: 'js-a', primitive: 'p-js-a' },
        { name: 'js-b', primitive: 'p-js-b' },
      ])

      const plan = compile(parse('js-a wide:md, js-b narrow:md'), custom, 'time')
      expect(plan.warnings.join()).toContain('cannot compose')
      expect(plan.fxNames).toEqual(['js-a'])
    })
  })
})
