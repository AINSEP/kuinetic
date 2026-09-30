// @vitest-environment node
//
// Static checks of `src/css/carousel.css` against the registry. Node environment for the same reason
// as `catalog-docs.test.ts`: under jsdom `import.meta.url` is an http: URL and `fileURLToPath` throws.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SPATIAL_STACK_PRIMITIVE } from '../src/effects/carousel/stack.js'
import { catalogRegistry } from './support/registry.js'

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
    spec.cssProperty?.startsWith('--kui-stack-'),
  )

  it('has the six geometry parameters to check', () => {
    expect(declared).toHaveLength(6)
  })

  it.each(declared.map((spec) => [spec.cssProperty!, spec.default]))('%s falls back to %s', (property, fallback) => {
    const uses = [...css.matchAll(new RegExp(`var\\(${property}, ([^)]+)\\)`, 'g'))].map((match) => match[1])
    expect(uses.length, `${property} is never read`).toBeGreaterThan(0)
    expect(new Set(uses)).toEqual(new Set([fallback]))
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
