// @vitest-environment node
//
// Static analysis of the v3 stylesheet plus registry checks. No DOM needed, and under jsdom
// `import.meta.url` is an http: URL that `fileURLToPath` rejects.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { GESTURE_PRESETS } from '../src/effects/gestures/index.js'
import { THREE_D_PRESETS } from '../src/effects/three-d/index.js'

const CSS = readFileSync(fileURLToPath(new URL('../src/css/three-d.css', import.meta.url)), 'utf8')

/** Which CSS properties each channel may claim. Mirrors `test/css-invariants.test.ts`. */
const CHANNEL_PROPERTIES: Record<string, string[]> = {
  opacity: ['opacity'],
  translate: ['translate'],
  scale: ['scale'],
  rotate: ['rotate'],
  filter: ['filter'],
  clip: ['clip-path', 'mask-image'],
}

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

describe('three-d stylesheet', () => {
  it('parses the expected number of keyframe blocks', () => {
    // Guards against the extractor silently matching nothing, which would make every assertion
    // below pass vacuously.
    expect(keyframes.size).toBeGreaterThanOrEqual(9)
  })

  it('every v3 CSS preset references a keyframe block that exists', () => {
    const missing = THREE_D_PRESETS.filter((preset) => !keyframes.has(preset.keyframes ?? '')).map(
      (preset) => `${preset.name} -> ${preset.keyframes}`,
    )
    expect(missing).toEqual([])
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
    expect(CSS).toContain('@layer dsg.effects {')
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

  it('keeps every 3D effect on the CSS renderer', () => {
    for (const preset of THREE_D_PRESETS) {
      expect(registry.resolve(preset.name)!.primitive.renderer, preset.name).toBe('css-keyframes')
    }
  })

  it('registers no duplicate names across all packages', () => {
    const names = registry.names()
    expect(new Set(names).size).toBe(names.length)
  })
})
