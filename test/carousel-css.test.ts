// @vitest-environment node
//
// Static checks of `src/css/carousel.css` against the registry. Node environment for the same reason
// as `catalog-docs.test.ts`: under jsdom `import.meta.url` is an http: URL and `fileURLToPath` throws.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SPATIAL_STACK_PRIMITIVE } from '../src/effects/carousel/stack.js'
import { catalogRegistry } from './support/registry.js'
import { stripComments } from './support/css-scan.js'

/**
 * The carousel stylesheet keys every rule on preset *names*, and a name the stylesheet forgot is the
 * quietest failure this family has: the runtime publishes every number, the slots are marked, and
 * nothing moves, because no rule matches. So the name lists are derived from the registry here —
 * every preset of either deck primitive, not a remembered four or five — and each must reach the
 * host rule and the pre-runtime rule.
 *
 * The stack's parameter defaults are also its stylesheet's `var()` fallbacks (design.md §7: an unset
 * parameter is never written inline, so the fallback *is* the default). Two copies of one number are
 * pinned to each other rather than trusted to be edited together.
 */

const css = readFileSync(fileURLToPath(new URL('../src/css/carousel.css', import.meta.url)), 'utf8')
const registry = catalogRegistry()

describe('row structure and runtime ownership', () => {
  const rules = [...stripComments(css).matchAll(/(?<=[{}])([^{}]*)\{([^{}]*)\}/g)]
    .map((match) => ({ selectors: match[1]!, body: match[2]! }))

  it('keeps raw row selectors scrollable and free of motion, including non-slide children', () => {
    const raw = rules.filter(rule => rule.selectors.includes("[data-kui~='carousel-loop']"))
    expect(raw.length).toBeGreaterThan(0)
    for (const rule of raw) expect(rule.body).not.toMatch(/(?:transform|transition|--kui-ring-drift)\s*:/)
    expect(raw.some(rule => rule.body.includes('overflow-x: auto'))).toBe(true)
  })

  it('clips looping overflow without scrolling, and moves only direct marked slides', () => {
    const runtime = rules.filter(rule => rule.selectors.includes("[data-kui-fx~='carousel-loop']"))
    expect(runtime.some(rule => rule.body.includes('overflow: clip'))).toBe(true)
    const motion = runtime.filter(rule => /transform\s*:/.test(rule.body))
    expect(motion.length).toBeGreaterThan(0)
    for (const rule of motion) expect(rule.selectors).toContain("[data-kui-fx~='carousel-loop'] > [data-kui-step-offset]")
    expect(runtime.some(rule => rule.selectors.includes("[data-kui-ring-wrap='true']") && rule.body.includes('transition: none'))).toBe(true)
    const base = readFileSync(fileURLToPath(new URL('../src/css/base.css', import.meta.url)), 'utf8')
    expect(base).toContain("[data-kui-rm][data-kui-fx~='carousel-loop'] [data-kui-step-offset]")
  })
})

const deckNames = (primitive: string): string[] =>
  registry.names().filter((name) => registry.resolve(name)?.primitive.id === primitive)

describe('carousel.css reaches every deck preset the registry has', () => {
  const ring = deckNames('spatial-ring')
  const stack = deckNames('spatial-stack')

  it('finds the names, so this cannot pass over an empty list', () => {
    expect(ring).toEqual(expect.arrayContaining(['carousel-3d', 'carousel-orbit']))
    expect(stack).toEqual(['carousel-stack'])
  })

  it.each([...ring, ...stack])('styles the %s host once the runtime has stamped it', (name) => {
    expect(css).toContain(`[data-kui-fx~='${name}']`)
  })

  it.each([...ring, ...stack])('stacks %s in one cell before the runtime arrives', (name) => {
    expect(css).toContain(`[data-kui~='${name}'] > *`)
  })

  it.each(ring)('places the %s slots with the ring rule', (name) => {
    expect(css).toContain(`[data-kui-fx~='${name}'] [data-kui-step-offset]`)
  })
})

describe('the stack’s stylesheet fallbacks are its parameter defaults', () => {
  const declared = Object.values(SPATIAL_STACK_PRIMITIVE.parameters).filter((spec) =>
    spec.cssProperty?.startsWith('--kui-stack-') && !spec.cssProperty.includes('leave'),
  )

  it('has the six existing geometry parameters and optional resting rotation to check', () => {
    expect(declared).toHaveLength(7)
  })

  it.each(declared.map((spec) => [spec.cssProperty!, spec.default]))('%s falls back to %s', (property, fallback) => {
    const uses = [...css.matchAll(new RegExp(`var\\(${property}, ([^)]+)\\)`, 'g'))].map((match) => match[1])
    expect(uses.length, `${property} is never read`).toBeGreaterThan(0)
    expect(new Set(uses)).toEqual(new Set([fallback]))
  })

  it('keeps swipe defaults in the opt-in selector and leaves legacy fallbacks intact', () => {
    const swipe = /\[data-kui-stack-leave='swipe'\]\s*\{([^}]+)\}/.exec(css)![1]!
    for (const name of ['leave-x', 'leave-rotate', 'leave-fade']) {
      const spec = SPATIAL_STACK_PRIMITIVE.parameters[name]!
      expect(swipe).toContain(`${spec.cssProperty}: ${spec.default};`)
    }
    expect(css).toContain('var(--kui-stack-leave-fade, 2)')
    expect(css).toContain('var(--kui-stack-leave-rotate, 0deg)')
    expect(SPATIAL_STACK_PRIMITIVE.parameters.leave!.default).toBe('depth')
  })
})

describe('the rules that suspend the transition', () => {
  it('come last, so they win over every shape’s slot rule at equal specificity', () => {
    const suspend = css.lastIndexOf("[data-kui-ring-dragging='true'] [data-kui-step-offset]")
    const lastSlotRule = Math.max(
      css.lastIndexOf("[data-kui-fx~='carousel-stack'] [data-kui-step-offset] {"),
      css.lastIndexOf("[data-kui-ring-plane='screen'] [data-kui-step-offset] {"),
      css.lastIndexOf("[data-kui-fx~='carousel-3d-inside'] [data-kui-step-offset] {"),
    )
    expect(suspend).toBeGreaterThan(lastSlotRule)
    const block = css.slice(suspend, css.indexOf('}', suspend))
    expect(block).toContain("[data-kui-ring-spinning='true'] [data-kui-step-offset]")
    expect(block).toContain("[data-kui-step-offset][data-kui-ring-wrap='true']")
    expect(block).toContain('transition: none')
  })

  it('transitions the stack’s visibility, so a card hidden by a step fades before it goes', () => {
    expect(css).toMatch(/transition-property: transform, opacity, filter, z-index, visibility;/)
  })
})

describe('a depth ring’s radius is capped by its fit to the page', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (selector: string): string => {
    const start = bare.indexOf(selector)
    expect(start).toBeGreaterThanOrEqual(0)
    return bare.slice(start, bare.indexOf('}', start))
  }

  it('resets the fit on every ring host, so a nested ring never inherits an outer ring’s cap', () => {
    const host = block("[data-kui-fx~='carousel-3d'],")
    for (const name of deckNames('spatial-ring')) expect(host).toContain(`[data-kui-fx~='${name}']`)
    expect(host).toContain('--kui-ring-fit: initial;')
    // The fit replaced a size container; no host may become one again (it resized content-sized hosts).
    expect(host).not.toContain('container-type')
  })

  it('takes the smaller of the wanted radius and the fit, and the wanted one when there is no fit', () => {
    const slot = block("[data-kui-fx~='carousel-3d'] [data-kui-step-offset],")
    expect(slot).toMatch(/--kui-ring-wanted: var\(\s*--kui-radius,/)
    expect(slot).toContain('--kui-ring-radius: min(var(--kui-ring-wanted), var(--kui-ring-fit, var(--kui-ring-wanted)));')
  })
})
