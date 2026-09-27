import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/showcase/showcase.css', import.meta.url)), 'utf8')

describe('slideshow CSS contract', () => {
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
    expect(css).toContain('.kui-slideshow-controls button:focus-visible')
    expect(css).toContain('outline: 2px solid Highlight')
    expect(css).toContain('@media (forced-colors: active)')
  })
})
