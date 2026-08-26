// @vitest-environment node
//
// Static analysis of the v3 stylesheet plus registry checks. No DOM needed, and under jsdom
// `import.meta.url` is an http: URL that `fileURLToPath` rejects.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { createRegistry } from '../src/effects/index.js'
import { GESTURE_PRESETS } from '../src/effects/gestures/index.js'
import { THREE_D_PRESETS } from '../src/effects/three-d/index.js'
import { CHANNEL_PROPERTIES } from './support/channel-properties.js'

const CSS = readFileSync(fileURLToPath(new URL('../src/css/three-d.css', import.meta.url)), 'utf8')

function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

function extractKeyframes(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    const properties = new Set<string>()
    for (const [, property] of body.matchAll(/^ *([a-z-]+):/gm)) {
      if (property) properties.add(property)
    }
    found.set(match[1]!, properties)
  }
  return found
}

const keyframes = extractKeyframes(CSS)
const registry = createRegistry()

/**
 * Section N presets that are state, not animation, and so deliberately have no `@keyframes` and no
 * CSS-keyframes renderer.
 *
 * `flip-card` is a two-sided card that stays on the face you turned it to. A one-shot keyframe
 * cannot express that — it has no way to come back — so the whole effect is a CSS transition in
 * `three-d.css` keyed off `aria-pressed` on the control inside the card, and its primitive
 * animates nothing itself. Named here rather than inferred, so a *new* preset that quietly stops
 * declaring keyframes still fails the assertions below instead of being silently excused.
 *
 * "Animates nothing" is not the same as "does nothing": `trigger:` gave `flip-card`'s `prepare` one
 * job — attaching a hover listener that writes the same `aria-pressed` a click would — and the last
 * test in this file is written to survive that distinction. See `test/three-d-flip-trigger.test.ts`
 * for the behaviour of the four trigger values, which needs a DOM and so lives in its own file.
 */
const STATE_DRIVEN = new Set(['flip-card'])

describe('three-d stylesheet', () => {
  it('parses the expected number of keyframe blocks', () => {
    // Guards against the extractor silently matching nothing, which would make every assertion
    // below pass vacuously.
    expect(keyframes.size).toBeGreaterThanOrEqual(9)
  })

  it('every v3 CSS preset references a keyframe block that exists', () => {
    const missing = THREE_D_PRESETS.filter(
      (preset) => !STATE_DRIVEN.has(preset.name) && !keyframes.has(preset.keyframes ?? ''),
    ).map((preset) => `${preset.name} -> ${preset.keyframes}`)
    expect(missing).toEqual([])
  })

  it('the state-driven presets claim no keyframes at all', () => {
    // The other half of the carve-out. A state preset that *did* name a keyframe block would be
    // claiming an animation it does not have, and `css-invariants.test.ts` would then hunt for a
    // block that never gets written.
    const claiming = THREE_D_PRESETS.filter(
      (preset) => STATE_DRIVEN.has(preset.name) && preset.keyframes !== undefined,
    ).map((preset) => preset.name)
    expect(claiming).toEqual([])
  })

  it('every keyframe block is referenced by a preset', () => {
    const referenced = new Set(THREE_D_PRESETS.map((preset) => preset.keyframes))
    expect([...keyframes.keys()].filter((name) => !referenced.has(name))).toEqual([])
  })

  it('no keyframe writes a property outside its declared channels', () => {
    const violations: string[] = []
    for (const preset of THREE_D_PRESETS) {
      const resolved = registry.resolve(preset.name)
      const properties = keyframes.get(preset.keyframes ?? '')
      if (!resolved || !properties) continue

      const allowed = new Set(
        resolved.primitive.channels.flatMap((channel) => CHANNEL_PROPERTIES[channel] ?? []),
      )
      for (const property of properties) {
        if (!allowed.has(property)) {
          violations.push(
            `${preset.keyframes} (${preset.name}) writes "${property}", not in [${resolved.primitive.channels.join(', ')}]`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps every rule inside the effects cascade layer', () => {
    expect(CSS).toContain('@layer kui.effects {')
  })
})

describe('v3 registration', () => {
  it.each([
    'drag',
    'drag-x',
    'drag-y',
    'drag-inertia',
    'throwable',
    'elastic-pull',
    'rubber-band',
    'snap-back',
    'swipe',
    'swipe-x',
    'long-press',
    'magnetic',
    'magnetic-snap',
  ])('registers the gesture name %s', (name) => {
    expect(registry.has(name)).toBe(true)
  })

  it.each([
    'card-flip-x',
    'card-flip-y',
    'cube-rotate',
    'book-page-turn',
    'fold-panel',
    'page-fade',
    'page-slide',
    'curtain-wipe',
    'loading-bar',
  ])('registers the 3D/transition name %s', (name) => {
    expect(registry.has(name)).toBe(true)
  })

  it('marks every gesture as continuous and reduced-motion-exempt', () => {
    for (const preset of GESTURE_PRESETS) {
      const resolved = registry.resolve(preset.name)!
      expect(resolved.primitive.perfClass, preset.name).toBe('continuous')
      // A gesture that follows a finger is interaction, not decoration; shortening it would
      // break the interaction rather than calm it.
      expect(resolved.primitive.reducedMotion, preset.name).toBe('disable')
    }
  })

  it('keeps every animated 3D effect on the CSS renderer', () => {
    for (const preset of THREE_D_PRESETS) {
      if (STATE_DRIVEN.has(preset.name)) continue
      expect(registry.resolve(preset.name)!.primitive.renderer, preset.name).toBe('css-keyframes')
    }
  })

  it('the state-driven presets render nothing themselves — the stylesheet does all of it', () => {
    for (const name of STATE_DRIVEN) {
      const resolved = registry.resolve(name)!
      // `javascript` here means "the animator holds the handle", not "this ships a frame loop":
      // the primitive's `prepare` writes no styles and drives no clock — at most it attaches the
      // one hover listener `trigger:` asks for, and that listener sets an attribute the stylesheet
      // transitions off. The registration exists to stamp `data-kui-fx` and resolve the timing
      // params onto the card, which the faces then inherit — exactly the forms.css native-state
      // arrangement.
      expect(resolved.primitive.renderer, name).toBe('javascript')
      expect(resolved.primitive.reducedMotion, name).toBe('disable')
    }
  })

  it('the state-driven presets\' prepare animates nothing, whatever else it wires up', async () => {
    // The assertions above read the primitive's *metadata*. That is not the same claim: a
    // `renderer: 'javascript'` primitive is still handed to the animator, which calls every hook on
    // the instance it returns, so the guarantee that has to hold is behavioural — activate, cancel,
    // finish and destroy are all safe, and `finished` settles.
    //
    // `prepare` stopped ignoring its arguments when `trigger:` landed, so it can no longer be
    // invoked with none. It is still invoked here without a DOM, and deliberately: this file is
    // `environment: node` (line 1), and `createParams({})` is the empty-attribute case — the
    // `click` default, which is where a state-driven preset must animate nothing. On that path
    // `prepare` reads the keyword and returns a no-op teardown without ever reaching for the
    // element or the context, so `undefined` for both is not a stub that papers over anything: if a
    // preset listed above ever starts touching the DOM on its *default* path, that lands inside the
    // `not.toThrow()` below and fails, which is the correct answer rather than a missed one. The
    // trigger values that do need a DOM are covered in `test/three-d-flip-trigger.test.ts`.
    const noDom = undefined as unknown as never
    for (const name of STATE_DRIVEN) {
      const prepare = registry.resolve(name)!.primitive.prepare!
      const instance = prepare(noDom, createParams({}), noDom)

      expect(() => {
        instance.activate()
        instance.cancel()
        instance.finish()
        instance.destroy()
      }, name).not.toThrow()
      // Already settled, so the animator's `finished` bookkeeping cannot strand `data-kui-state`
      // on "running" for the life of the page.
      await expect(instance.finished).resolves.toBeUndefined()
    }
  })

  it('registers no duplicate names across all packages', () => {
    const names = registry.names()
    expect(new Set(names).size).toBe(names.length)
  })
})
