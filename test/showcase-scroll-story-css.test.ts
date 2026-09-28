// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ruleBodies } from './support/css-scan.js'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'), 'utf8')

function mediaBlock(query: string): string {
  const start = css.lastIndexOf(`@media ${query} {`)
  if (start < 0) return ''
  const opening = css.indexOf('{', start)
  let depth = 1
  for (let index = opening + 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(opening + 1, index)
  }
  return ''
}

describe('scroll-story CSS contract', () => {
  const media = "[data-kui-fx~='scroll-story'] > :first-child [data-kui-step-state]"
  const activeMedia = "[data-kui-fx~='scroll-story'] > :first-child [data-kui-step-state='active']"
  const sections = "[data-kui-fx~='scroll-story'] > :last-child [data-kui-step-state]"
  const activeSection = "[data-kui-fx~='scroll-story'] > :last-child [data-kui-step-state='active']"
  const rule = (selector: string): string | undefined => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) return undefined
    const opening = css.indexOf('{', start)
    return css.slice(opening + 1, css.indexOf('}', opening))
  }

  it('gates sticky media to the 48rem breakpoint and declares the dim token', () => {
    expect(css).toMatch(/\[data-kui-fx~='scroll-story'\] > :first-child \{[^}]*block-size: 45svh;/)
    expect(rule(sections)).toContain('opacity: var(--kui-story-dim, 0.45);')
    const wide = mediaBlock('(min-width: 48rem)')
    const column = ruleBodies(wide, "[data-kui-fx~='scroll-story'] > :first-child")
    expect(column).toHaveLength(1)
    expect(column[0]).toContain('block-size: 100svh;')
    expect(column[0]).toContain('align-content: center;')
    const directMedia = "[data-kui-fx~='scroll-story'] > :first-child > [data-kui-step-state]"
    expect(ruleBodies(wide, directMedia)[0]).toContain('grid-area: 1 / 1;')
    expect(ruleBodies(wide, directMedia)[0]).toContain('position: relative;')
    // An authored target may match nested media. Those still use the base absolute overlay.
    expect(ruleBodies(wide, media)).toHaveLength(0)
    // Any percentage in a sticky inset resolves against the scrollport (calc(50vh - 50%) === 0),
    // so no sticky inset in the story may depend on one.
    const stickyColumns = ruleBodies(css, "[data-kui-fx~='scroll-story'] > :first-child")
    expect(stickyColumns).toHaveLength(3) // narrow band, wide column, forced-colors border
    for (const body of stickyColumns) expect(body).not.toMatch(/inset-block-start:[^;]*%/)
    expect(mediaBlock('(min-width: 48rem)')).toMatch(
      /\[data-kui-fx~='scroll-story'\]\[data-kui-story-side='start'\] > :first-child \{[^}]*grid-column: 1;/,
    )
    expect(rule(activeMedia)).toContain('opacity: 1;')
    expect(rule(activeSection)).toContain('opacity: 1;')
  })

  it('lays out and reveals any matched nested media or section', () => {
    expect(rule(media)).toContain('position: absolute;')
    expect(rule(media)).toContain('inset: 0;')
    expect(rule(media)).toContain('opacity: 0;')
    expect(rule(sections)).toContain('min-block-size: 60vh;')
    expect(rule(sections)).toContain('opacity: var(--kui-story-dim, 0.45);')
    const host = document.createElement('div')
    host.innerHTML = `<section data-kui-fx="scroll-story">
      <div><div><img data-kui-step-state="active"></div></div>
      <ol><li><div data-kui-step-state="active">Step</div></li></ol>
    </section>`
    expect(host.querySelector('img')?.matches(activeMedia)).toBe(true)
    expect(host.querySelector('ol [data-kui-step-state]')?.matches(activeSection)).toBe(true)
  })

  it('keeps media visible until the widget stamps a step (no-JS / failed setup)', () => {
    expect(css).toMatch(
      /\[data-kui-fx~='scroll-story'\]:not\(\[data-kui-step\]\) > :first-child \* \{[^}]*opacity: 1;/,
    )
    expect(css).toMatch(
      /\[data-kui-fx~='scroll-story'\]:not\(\[data-kui-step\]\) > :last-child \* \{[^}]*opacity: 1;/,
    )
  })

  it('declares reduced motion and forced colors rules', () => {
    expect(mediaBlock('(prefers-reduced-motion: reduce)')).toMatch(
      /\[data-kui-fx~='scroll-story'\] > :first-child \[data-kui-step-state\],[^}]*transition-duration: 1ms/,
    )
    expect(mediaBlock('(forced-colors: active)')).toMatch(
      /\[data-kui-fx~='scroll-story'\] > :first-child,[^}]*border: 1px solid CanvasText/,
    )
  })
})
