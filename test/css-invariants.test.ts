// @vitest-environment node
//
// Static analysis of the shipped stylesheets — no DOM required. The node environment is not
// optional here: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath` throws.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { PRESETS } from '../src/effects/presets.js'

/**
 * Structural guard on the channel model.
 *
 * Composition safety is decided from each primitive's declared `channels`. If a keyframe writes
 * a property outside those channels, two effects can collide on it while the compiler believes
 * they are disjoint — the conflict detector then reports a clean compose and the browser silently
 * discards one animation. Nothing at runtime catches that, so it is asserted here against the
 * real stylesheets.
 */

const EFFECT_FILES = ['entrance.css', 'scroll.css']

/**
 * All stylesheets are read once at module scope. Reading them lazily inside a test fails under
 * the jsdom environment, where `import.meta.url` is no longer a `file:` URL.
 */
const SOURCES = new Map<string, string>(
  ['base.css', ...EFFECT_FILES].map((file) => [
    file,
    readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8'),
  ]),
)

/** Which CSS properties each channel is allowed to claim. */
const CHANNEL_PROPERTIES: Record<string, string[]> = {
  opacity: ['opacity'],
  translate: ['translate'],
  scale: ['scale'],
  rotate: ['rotate'],
  filter: ['filter'],
  clip: ['clip-path', 'mask-image'],
  background: ['background-position', 'background-image', 'background-size'],
  color: ['color'],
  stroke: ['stroke-dashoffset', 'stroke-dasharray', 'stroke'],
  text: ['letter-spacing', 'word-spacing', 'font-variation-settings'],
}

/**
 * name → the CSS properties its keyframe blocks write.
 *
 * Brace-balanced rather than indentation-matched: an indentation-sensitive regex would quietly
 * extract nothing if a formatter reflowed the file, and every assertion below would then pass
 * vacuously. The size assertion is the backstop for that.
 */
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

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

const keyframes = extractKeyframes(EFFECT_FILES.map((file) => SOURCES.get(file)).join('\n'))
const registry = createRegistry()

describe('CSS keyframes', () => {
  it('parses a plausible number of keyframe blocks', () => {
    expect(keyframes.size).toBeGreaterThanOrEqual(24)
  })

  it('every preset references a keyframe block that exists', () => {
    const missing = PRESETS.filter((preset) => !keyframes.has(preset.keyframes ?? '')).map(
      (preset) => `${preset.name} -> ${preset.keyframes}`,
    )
    expect(missing).toEqual([])
  })

  it('every keyframe block is referenced by at least one preset', () => {
    const referenced = new Set(PRESETS.map((preset) => preset.keyframes))
    const orphans = [...keyframes.keys()].filter((name) => !referenced.has(name))
    expect(orphans).toEqual([])
  })

  it('no keyframe writes a property outside its primitive declared channels', () => {
    const violations: string[] = []

    for (const preset of PRESETS) {
      const resolved = registry.resolve(preset.name)
      const properties = keyframes.get(preset.keyframes ?? '')
      if (!resolved || !properties) continue

      const allowed = new Set(
        resolved.primitive.channels.flatMap((channel) => CHANNEL_PROPERTIES[channel] ?? []),
      )
      for (const property of properties) {
        if (allowed.has(property)) continue
        violations.push(
          `${preset.keyframes} (via ${preset.name}/${resolved.primitive.id}) writes "${property}", ` +
            `not covered by channels [${resolved.primitive.channels.join(', ')}]`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})

describe('CSS layering', () => {
  it('declares the cascade layers so consumer CSS wins without !important', () => {
    expect(SOURCES.get('base.css')).toContain('@layer dsg.tokens, dsg.effects, dsg.policy;')
  })

  it.each(EFFECT_FILES)('keeps every rule in %s inside the effects layer', (file) => {
    expect(SOURCES.get(file)).toContain('@layer dsg.effects {')
  })
})
