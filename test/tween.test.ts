// @vitest-environment node
//
// The generic tween: `data-kui="tween x:100 opacity:0 800ms"`. `compile` is a pure function and
// this file also parses `src/css/tween.css` off disk, so there is no DOM in play — and under jsdom
// `import.meta.url` is an http: URL and `fileURLToPath` throws. Same idiom as
// `css-invariants.test.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import type { Registry } from '../src/core/registry.js'
import { TWEEN_GROUP_CHANNELS, TWEEN_GROUP_ORDER } from '../src/effects/tween/properties.js'
import { MAX_WAYPOINTS } from '../src/effects/tween/waypoints.js'
import { CHANNEL_PROPERTIES } from './support/channel-properties.js'
import { catalogRegistry } from './support/registry.js'

let registry: Registry

beforeEach(() => {
  registry = catalogRegistry()
})

function run(source: string, timeline: 'time' | 'view' | 'scroll' | 'pin' = 'time') {
  return compile(parse(source), registry, timeline)
}

/** The compiled `animation-name` list, split back into the tracks it was joined from. */
function tracks(source: string): string[] {
  const names = run(source).declarations['animation-name']
  return names ? names.split(', ') : []
}

describe('tween — which keyframes get compiled', () => {
  it('compiles one track per property group the author named', () => {
    expect(tracks('tween x:100')).toEqual(['kui-tween-to-translate'])
    expect(tracks('tween opacity:0')).toEqual(['kui-tween-to-opacity'])
    expect(tracks('tween x:100 opacity:0 rotate:45deg')).toEqual([
      'kui-tween-to-translate',
      'kui-tween-to-rotate',
      'kui-tween-to-opacity',
    ])
  })

  it('collapses several keys of one group onto a single track', () => {
    // `translate` is one CSS property. Three tracks writing it would mean two of them losing.
    expect(tracks('tween x:100 y:20 z:5')).toEqual(['kui-tween-to-translate'])
    expect(tracks('tween scale:1.2 scale-x:2')).toEqual(['kui-tween-to-scale'])
    expect(tracks('tween blur:4px grayscale:1')).toEqual(['kui-tween-to-filter'])
  })

  it('orders tracks by the group table, not by the order the author typed', () => {
    // Otherwise every assertion about a compiled plan would depend on the author's typing order,
    // and two spellings of one animation would produce two different `animation-name` lists.
    expect(tracks('tween opacity:0 x:100')).toEqual(tracks('tween x:100 opacity:0'))
  })

  it('reads tween-from off the from-blocks, which is the whole direction difference', () => {
    expect(tracks('tween-from y:40 opacity:0')).toEqual([
      'kui-tween-from-translate',
      'kui-tween-from-opacity',
    ])
  })

  it('repeats the authored timing across every track of one spec', () => {
    // Two tracks are a rendering detail of "CSS cannot write translate and opacity from one
    // keyframe" — the author wrote one effect with one duration and must get one duration.
    const plan = run('tween x:100 opacity:0 800ms 200ms ease-in')
    expect(plan.declarations['animation-duration']).toBe('800ms, 800ms')
    expect(plan.declarations['animation-timing-function']).toBe('ease-in, ease-in')
    expect(plan.declarations['animation-delay']).toBe(
      'calc(200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms)), ' +
        'calc(200ms + var(--kui-i, 0) * var(--kui-stagger, 0ms))',
    )
  })

  it('still falls back to the primitive timing properties when no timing is authored', () => {
    expect(run('tween x:100').declarations['animation-duration']).toBe(
      'var(--kui-tween-duration, 600ms)',
    )
    expect(run('tween-from x:100').declarations['animation-duration']).toBe(
      'var(--kui-tween-from-duration, 600ms)',
    )
  })

  it('leaves every other effect on exactly one track', () => {
    // The multi-track path is new; the 255 names that predate it must be untouched by it.
    expect(tracks('fade-up')).toEqual(['kui-in-up'])
    expect(tracks('fade-up, blur-in')).toEqual(['kui-in-up', 'kui-blur-in'])
  })
})

describe('tween — values reaching CSS', () => {
  it('writes each named property to its own custom property', () => {
    expect(run('tween x:100px opacity:0.5').vars).toMatchObject({
      '--kui-tween-x': '100px',
      '--kui-tween-opacity': '0.5',
    })
  })

  it('reads a bare number as the unit the property implies', () => {
    // `x:100` is the spelling this feature was specified around; `params.ts` stays strict for
    // every other effect, and the coercion is scoped to the tween's own keys.
    expect(run('tween x:100').vars['--kui-tween-x']).toBe('100px')
    expect(run('tween rotate:45').vars['--kui-tween-rotate']).toBe('45deg')
    expect(run('tween blur:4').vars['--kui-tween-blur']).toBe('4px')
  })

  it('leaves a value that already carries a unit, a percentage, or a calc alone', () => {
    expect(run('tween x:2rem').vars['--kui-tween-x']).toBe('2rem')
    expect(run('tween y:50%').vars['--kui-tween-y']).toBe('50%')
    // Spaces and a comma inside the value, so it has to be quoted — the `target:` precedent.
    expect(run('tween x:"calc(100% - 20px)"').vars['--kui-tween-x']).toBe('calc(100% - 20px)')
  })

  it('never implies a unit on a property that takes a bare number', () => {
    expect(run('tween opacity:0').vars['--kui-tween-opacity']).toBe('0')
    expect(run('tween scale:1.2').vars['--kui-tween-scale']).toBe('1.2')
  })

  it('writes nothing but validated values, so an injection attempt lands nowhere', () => {
    // Author values reach a stylesheet, which is why `params.ts` screens them. A generic tween is
    // the widest door into that path in the library, so this is asserted here too.
    const plan = run('tween x:"100px; background: url(//evil.test/x)"')
    expect(plan.vars['--kui-tween-x']).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('disallowed CSS syntax')
  })

  it('drops a value it cannot parse and says so, leaving the keyframe fallback in charge', () => {
    const plan = run('tween x:banana')
    expect(plan.vars['--kui-tween-x']).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('not a valid length')
  })

  it('names a property that is not in the vocabulary instead of silently ignoring it', () => {
    const warnings = run('tween opactiy:0').warnings.join(' ')
    expect(warnings).toContain('unknown parameter "opactiy"')
    // The whole vocabulary is listed, not just the keys this attribute happened to use.
    expect(warnings).toContain('opacity')
    expect(warnings).toContain('background-color')
  })

  it('still accepts the named spelling of the shared timing parameters', () => {
    expect(run('tween x:100 delay:300ms').vars['--kui-tween-delay']).toBe('300ms')
  })
})

describe('tween — channels, declared from the attribute', () => {
  it('claims only the channels the authored properties actually write', () => {
    expect(run('tween x:100').channels).toEqual(['translate'])
    expect(run('tween opacity:0 blur:4px').channels).toEqual(['opacity', 'filter'])
  })

  it('collides with a catalog effect that writes the same channel', () => {
    // fade-up owns opacity + translate. A tween that moves the element must not compose with it.
    const plan = run('fade-up, tween x:100')
    expect(plan.warnings.join(' ')).toContain('both animate translate')
    expect(plan.fxNames).toEqual(['fade-up'])
  })

  it('composes with a catalog effect whose channels it does not touch', () => {
    const plan = run('blur-in, tween x:100')
    expect(plan.warnings).toEqual([])
    expect(plan.fxNames).toEqual(['blur-in', 'tween'])
    expect(plan.declarations['animation-name']).toBe('kui-blur-in, kui-tween-to-translate')
  })

  it('collides with itself across the two directions on one channel', () => {
    // `tween x:100, tween-from x:0` is two effects writing one `translate`; the second would win
    // silently. Deriving channels per spec is what makes that detectable at all.
    expect(run('tween x:100, tween-from y:20').warnings.join(' ')).toContain('both animate translate')
  })

  it('lets the two directions compose when they touch different channels', () => {
    const plan = run('tween x:100, tween-from opacity:0')
    expect(plan.warnings).toEqual([])
    expect(plan.declarations['animation-name']).toBe(
      'kui-tween-to-translate, kui-tween-from-opacity',
    )
  })
})

describe('tween — attributes that animate nothing or deadlock', () => {
  it('warns and emits no animation when no property was named', () => {
    const plan = run('tween 400ms')
    expect(plan.declarations).toEqual({})
    expect(plan.warnings.join(' ')).toContain('names no properties to animate')
  })

  it('warns that a from-tween starting at zero scale can never be seen by on:enter', () => {
    // Trap #2: an IntersectionObserver measures geometry, so a zero-area start state never
    // intersects, never activates, and never leaves the state that made it invisible.
    for (const source of ['tween-from scale:0', 'tween-from scale-x:0', 'tween-from scale-y:0']) {
      expect(run(source).warnings.join(' '), source).toContain('no box at all')
    }
  })

  it('does not warn for a to-tween scaling down to nothing, which has a real box throughout', () => {
    expect(run('tween scale:0').warnings).toEqual([])
  })
})

describe('tween — registry metadata', () => {
  it('registers both names', () => {
    expect(registry.has('tween')).toBe(true)
    expect(registry.has('tween-from')).toBe(true)
  })

  it('renders through CSS keyframes, not JavaScript', () => {
    // The point of the design: an arbitrary *value* never forced an arbitrary *renderer*.
    for (const name of ['tween', 'tween-from']) {
      expect(registry.resolve(name)!.primitive.renderer, name).toBe('css-keyframes')
    }
    expect(run('tween x:100').jsEffects).toEqual([])
  })

  it('cloaks the from direction and only the from direction', () => {
    // A from-tween is painted at its rest state until the runtime installs the start state; a
    // to-tween starts at the rest state, so cloaking it would blank a visible element.
    expect(registry.resolve('tween-from')!.preset.cloak).toBe(true)
    expect(registry.resolve('tween')!.preset.cloak).toBeUndefined()
  })

  it('accepts the entrance timelines, so a tween can be scrubbed as well as clocked', () => {
    expect(run('tween x:100', 'view').supportedTimelines).toContain('view')
    expect(run('tween x:100', 'pin').warnings).toEqual([])
  })
})

/**
 * `src/css/tween.css` is not in `css-invariants.test.ts`'s file list, because that file joins a
 * keyframe block to a preset through `Preset.keyframes` and the tween's blocks are named by the
 * compiler instead. The same two invariants still have to hold, so they are asserted here against
 * the real stylesheet: every block the compiler can emit exists, and no block writes a property
 * outside the channel its group claims.
 */
const TWEEN_CSS = readFileSync(
  fileURLToPath(new URL('../src/css/tween.css', import.meta.url)),
  'utf8',
)

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/** Keyframe block name → the CSS properties it declares. */
const blocks = new Map<string, Set<string>>()
for (const match of TWEEN_CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
  const body = readBalancedBlock(TWEEN_CSS, match.index + match[0].length)
  const properties = new Set<string>()
  for (const [, property] of body.matchAll(/(?:^|[{;])\s*(-?[a-z][a-z-]*)\s*:/g)) {
    properties.add(property!)
  }
  blocks.set(match[1]!, properties)
}

/** The half-keyframe pair a plain two-point tween compiles to. */
const halfBlocks = ['to', 'from'].flatMap((direction) =>
  TWEEN_GROUP_ORDER.map((group) => `kui-tween-${direction}-${group}`),
)

/**
 * The fully explicit blocks a waypoint list selects — one per group per count, from an explicit
 * two-point tween up to the ceiling `waypoints.ts` sets.
 */
const waypointBlocks = TWEEN_GROUP_ORDER.flatMap((group) =>
  Array.from({ length: MAX_WAYPOINTS - 1 }, (_, index) => `kui-tween-keys${index + 2}-${group}`),
)

/** Every block name `buildVariant` can put on a track. */
const expectedBlocks = [...halfBlocks, ...waypointBlocks]

describe('tween.css', () => {
  it('has blocks to guard, so this suite cannot pass vacuously', () => {
    expect(blocks.size).toBe(expectedBlocks.length)
  })

  it.each(expectedBlocks)('declares %s', (name) => {
    expect(blocks.has(name)).toBe(true)
  })

  it('declares no block the compiler can never reference', () => {
    expect([...blocks.keys()].filter((name) => !expectedBlocks.includes(name))).toEqual([])
  })

  it.each(expectedBlocks)('%s writes only properties on its own channel', (name) => {
    const group = TWEEN_GROUP_ORDER.find((candidate) => name.endsWith(`-${candidate}`))!
    const allowed = CHANNEL_PROPERTIES[TWEEN_GROUP_CHANNELS[group]] ?? []
    expect([...blocks.get(name)!].filter((property) => !allowed.includes(property))).toEqual([])
  })

  it.each(halfBlocks)('%s declares exactly one endpoint, so the other stays implicit', (name) => {
    // The half-keyframe is the feature: the browser builds the missing step from the element's own
    // computed style, which is what "from the element's current state" means with no JS at all.
    // Adding the other half would pin it to a fixed value and silently break that.
    const body = readBalancedBlock(TWEEN_CSS, TWEEN_CSS.indexOf('{', TWEEN_CSS.indexOf(name)) + 1)
    const wanted = name.includes('-to-') ? 'to' : 'from'
    const unwanted = wanted === 'to' ? 'from' : 'to'
    expect(new RegExp(`\\b${wanted}\\s*\\{`).test(body), `${name} declares ${wanted}`).toBe(true)
    expect(new RegExp(`\\b${unwanted}\\s*\\{|\\b(?:0|100)%\\s*\\{`).test(body)).toBe(false)
  })

  it.each(waypointBlocks)('%s declares exactly its own count of evenly spaced steps', (name) => {
    // The mirror of the half-keyframe rule above, and the reason a waypoint block is a different
    // block rather than the same one with more steps: a list writes every state including the
    // first, so there is nothing left implicit and the block must run 0% to 100%.
    const count = Number(/keys(\d+)-/.exec(name)![1])
    const body = readBalancedBlock(TWEEN_CSS, TWEEN_CSS.indexOf('{', TWEEN_CSS.indexOf(name)) + 1)
    // Read line by line rather than with a regex: every step selector in a generated block is its
    // own line, and a percentage pattern scanned across a whole stylesheet is exactly the
    // backtracking shape `sonarjs/slow-regex` exists to refuse.
    const steps = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('% {'))
      .map((line) => Number.parseFloat(line))
    expect(steps).toHaveLength(count)
    expect(steps[0]).toBe(0)
    expect(steps.at(-1)).toBe(100)
    // Evenly spaced to three decimals, which is what the generator rounds to.
    for (const [index, step] of steps.entries()) {
      expect(Math.abs(step - (index * 100) / (count - 1))).toBeLessThan(0.001)
    }
    expect(/\b(?:to|from)\s*\{/.test(body)).toBe(false)
  })

  it.each(waypointBlocks)('%s falls back through the plain property at every step', (name) => {
    // The broadcast rule. Without the inner `var(--kui-tween-<key>, …)` a key that wrote one value
    // beside a neighbour that wrote a list would snap to its identity on every step but the first.
    const body = readBalancedBlock(TWEEN_CSS, TWEEN_CSS.indexOf('{', TWEEN_CSS.indexOf(name)) + 1)
    for (const [, numbered] of body.matchAll(/var\(--kui-tween-([a-z-]+)-\d+,/g)) {
      expect(body).toContain(`var(--kui-tween-${numbered!},`)
    }
  })

  it('keeps every rule inside the effects layer', () => {
    expect(TWEEN_CSS).toContain('@layer kui.effects {')
  })
})
