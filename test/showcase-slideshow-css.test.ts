import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atRuleBlocks, ruleBodies } from './support/css-scan.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(fileURLToPath(new URL('../src/showcase/showcase.css', import.meta.url)), 'utf8')

describe('slideshow CSS contract', () => {
  it('compiles an incoming-only delay while outgoing slides retain the zero-delay shorthand', () => {
    const plan = compile(parse('carousel-fade enter-delay:250ms'), catalogRegistry(), 'time')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-slideshow-enter-delay']).toBe('250ms')
    const hosts = ":is([data-kui-fx~='carousel-fade'], [data-kui-fx~='carousel-slide'], [data-kui-fx~='video-hero-slideshow'])[data-kui-slideshow-mode='fade'] [data-kui-slideshow-list] > "
    const outgoing = ruleBodies(css, hosts + '[data-kui-step-state]').join('')
    const incoming = ruleBodies(css, hosts + "[data-kui-step-state='active']").join('')
    expect(outgoing).toContain('transition: opacity var(--kui-slideshow-duration, 500ms) var(--kui-slideshow-ease, ease);')
    expect(outgoing).not.toContain('enter-delay')
    expect(incoming).toContain('transition-delay: var(--kui-slideshow-enter-delay, 0ms);')
  })
  it('gates fade and slide layout on the stamped mode, including authored overrides', () => {
    expect(css).toContain("[data-kui-slideshow-mode='fade'] [data-kui-slideshow-list]")
    expect(css).toContain("[data-kui-slideshow-mode='slide'] [data-kui-slideshow-list]")
    expect(css).toContain("[data-kui-step-state='active']")
    expect(css).toContain('translate: calc(var(--kui-step, 0) * -100%) 0')
  })

  it('scopes controls to showcase names and gives focused buttons a visible outline', () => {
    for (const name of ['carousel-fade', 'carousel-slide', 'video-hero-slideshow']) {
      expect(css).toContain(`[data-kui-fx~='${name}']`)
    }
    const hosts = ":is([data-kui-fx~='carousel-fade'], [data-kui-fx~='carousel-slide'], [data-kui-fx~='video-hero-slideshow'])"
    const focus = ruleBodies(css, `${hosts} .kui-slideshow-controls button:focus-visible`)
    expect(focus).toHaveLength(1)
    expect(focus[0]).toContain('outline: 2px solid Highlight;')

    // Scoped to the slideshow's own rules inside a forced-colors block: an unscoped toContain passes
    // as soon as any other component (the lightbox, device-frame) opens that query.
    const forced = atRuleBlocks(css, '@media (forced-colors: active)')
    const inForced = (selector: string): string => forced.flatMap((block) => ruleBodies(block, selector)).join('\n')
    const buttons = inForced(`${hosts} .kui-slideshow-controls button`)
    expect(buttons).toContain('border-color: CanvasText;')
    expect(buttons).toContain('color: CanvasText;')
    expect(inForced(`${hosts} .kui-slideshow-controls .kui-slideshow-dot[aria-current='true']`))
      .toContain('background: Highlight;')
  })
})
