import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/showcase/showcase.css', import.meta.url)), 'utf8')

describe('scroll-story CSS contract', () => {
  it('gates sticky media to the 48rem breakpoint and declares the dim token', () => {
    expect(css).toContain("[data-kui-fx~='scroll-story']")
    expect(css).toContain('block-size: 45svh')
    expect(css).toContain('--kui-story-dim')
    expect(css).toMatch(/@media \(min-width: 48rem\)[\s\S]*?inset-block-start: max\(0px, calc\(50vh - 50%\)\)/)
    expect(css).toMatch(/@media \(min-width: 48rem\)[\s\S]*?\[data-kui-fx~='scroll-story'\]\[data-kui-story-side='start'\]/)
    expect(css).toContain("[data-kui-fx~='scroll-story'] > :first-child > [data-kui-step-state='active']")
    expect(css).toContain("[data-kui-fx~='scroll-story'] > :last-child > [data-kui-step-state='active']")
  })

  it('keeps media visible until the widget stamps a step (no-JS / failed setup)', () => {
    expect(css).toMatch(
      /\[data-kui-fx~='scroll-story'\]:not\(\[data-kui-step\]\) > :first-child > \* \{[^}]*opacity: 1;/,
    )
    expect(css).toMatch(
      /\[data-kui-fx~='scroll-story'\]:not\(\[data-kui-step\]\) > :last-child > \* \{[^}]*opacity: 1;/,
    )
  })

  it('declares reduced motion and forced colors rules', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-kui-fx~='scroll-story'\] > :first-child > \*[\s\S]*?transition-duration: 1ms/)
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*?\[data-kui-fx~='scroll-story'\] > :first-child[\s\S]*?border: 1px solid CanvasText/)
  })
})
