// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'

const showcaseCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'),
  'utf8',
)

describe('hotspots', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds one button per note in note order', () => {
    build(`
      <figure data-kui="hotspots">
        <img src="dashboard.png" alt="Dashboard">
        <ol>
          <li style="--kui-x: 20%; --kui-y: 30%"><strong>First</strong> Note 1</li>
          <li style="--kui-x: 60%; --kui-y: 70%"><strong>Second</strong> Note 2</li>
        </ol>
      </figure>
    `).start()

    const host = el()
    const buttons = host.querySelectorAll<HTMLButtonElement>('button.kui-hotspot')

    expect(buttons.length).toBe(2)
    const firstButton = buttons[0]!
    const secondButton = buttons[1]!
    expect(firstButton.getAttribute('aria-label')).toBe('First')
    expect(secondButton.getAttribute('aria-label')).toBe('Second')
  })

  it('applies label rules: strong, heading, or fallback Note n', () => {
    build(`
      <figure data-kui="hotspots">
        <img src="map.png" alt="">
        <ul>
          <li style="--kui-x: 10%; --kui-y: 10%"><strong>From Strong</strong> Details</li>
          <li style="--kui-x: 20%; --kui-y: 20%"><h3>From Heading</h3> Details</li>
          <li style="--kui-x: 30%; --kui-y: 30%">Just plain text with no heading</li>
        </ul>
      </figure>
    `).start()

    const buttons = el().querySelectorAll<HTMLButtonElement>('button.kui-hotspot')
    expect(buttons.length).toBe(3)
    const b0 = buttons[0]!
    const b1 = buttons[1]!
    const b2 = buttons[2]!
    expect(b0.getAttribute('aria-label')).toBe('From Strong')
    expect(b1.getAttribute('aria-label')).toBe('From Heading')
    expect(b2.getAttribute('aria-label')).toBe('Note 3')
  })

  it('wires popover and popovertarget, generating ids only when absent', () => {
    const animator = build(`
      <figure data-kui="hotspots">
        <img src="app.png" alt="">
        <ol>
          <li id="custom-note" style="--kui-x: 15%; --kui-y: 25%">Authored ID</li>
          <li style="--kui-x: 50%; --kui-y: 50%">Generated ID</li>
        </ol>
      </figure>
    `)
    animator.start()

    const host = el()
    const notes = host.querySelectorAll('li')
    const buttons = host.querySelectorAll<HTMLButtonElement>('button.kui-hotspot')

    const firstNote = notes[0]!
    const secondNote = notes[1]!
    const firstButton = buttons[0]!
    const secondButton = buttons[1]!

    expect(firstNote.id).toBe('custom-note')
    expect(firstNote.getAttribute('popover')).toBe('auto')
    expect(firstButton.getAttribute('popovertarget')).toBe('custom-note')

    expect(secondNote.id).toMatch(/^kui-hotspot-note-/)
    expect(secondNote.getAttribute('popover')).toBe('auto')
    expect(secondButton.getAttribute('popovertarget')).toBe(secondNote.id)

    animator.destroy()

    expect(firstNote.id).toBe('custom-note')
    expect(firstNote.hasAttribute('popover')).toBe(false)
    expect(secondNote.hasAttribute('id')).toBe(false)
    expect(secondNote.hasAttribute('popover')).toBe(false)
    expect(host.querySelectorAll('button.kui-hotspot').length).toBe(0)
  })

  it('sets marker style: number vs dot', () => {
    build(`
      <figure data-kui="hotspots">
        <img src="a.png" alt="">
        <ol>
          <li style="--kui-x: 10%; --kui-y: 10%">One</li>
          <li style="--kui-x: 20%; --kui-y: 20%">Two</li>
        </ol>
      </figure>
    `).start()

    const numberButtons = el().querySelectorAll<HTMLButtonElement>('button.kui-hotspot')
    expect(numberButtons[0]?.textContent).toBe('1')
    expect(numberButtons[1]?.textContent).toBe('2')

    build(`
      <figure data-kui="hotspots marker:dot">
        <img src="a.png" alt="">
        <ol>
          <li style="--kui-x: 10%; --kui-y: 10%">One</li>
        </ol>
      </figure>
    `).start()

    const dotButtons = el().querySelectorAll<HTMLButtonElement>('button.kui-hotspot')
    expect(dotButtons[0]?.textContent).toBe('')
  })

  it('warns when a note is missing --kui-x or --kui-y position', () => {
    const reporter = collectingReporter()
    build(
      `
      <figure data-kui="hotspots">
        <img src="a.png" alt="">
        <ol>
          <li>Missing coordinates</li>
        </ol>
      </figure>
      `,
      reporter,
    ).start()

    expect(reporter.messages.some((m) => m.includes('missing --kui-x or --kui-y'))).toBe(true)
  })

  it('runs fallback positioning on toggle when CSS.supports is false', () => {
    vi.stubGlobal('CSS', {
      supports: vi.fn().mockReturnValue(false),
    })

    build(`
      <figure data-kui="hotspots">
        <img src="a.png" alt="">
        <ol>
          <li style="--kui-x: 30%; --kui-y: 40%"><strong>Filter</strong> Info</li>
        </ol>
      </figure>
    `).start()

    const host = el()
    const button = host.querySelector<HTMLButtonElement>('button.kui-hotspot')!
    const note = host.querySelector<HTMLLIElement>('li')!

    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      left: 200,
      width: 24,
      height: 24,
      bottom: 174,
      right: 224,
      x: 200,
      y: 150,
      toJSON: () => {},
    })

    const toggleEvent = new Event('toggle') as Event & { newState: string }
    toggleEvent.newState = 'open'
    note.dispatchEvent(toggleEvent)

    expect(note.style.getPropertyValue('position')).toBe('fixed')
    expect(note.style.getPropertyValue('top')).toBe('150px')
    expect(note.style.getPropertyValue('left')).toBe('212px')
    expect(note.style.getPropertyValue('translate')).toBe('-50% -100%')
  })

  it('configures anchor positioning when CSS.supports(position-area: top) is true', () => {
    vi.stubGlobal('CSS', {
      supports: vi.fn().mockImplementation((prop: string) => prop === 'position-area: top'),
    })

    build(`
      <figure data-kui="hotspots">
        <img src="a.png" alt="">
        <ol>
          <li style="--kui-x: 30%; --kui-y: 40%"><strong>Anchor</strong> Info</li>
        </ol>
      </figure>
    `).start()

    const host = el()
    const button = host.querySelector<HTMLButtonElement>('button.kui-hotspot')!
    const note = host.querySelector<HTMLLIElement>('li')!

    const anchorName = button.style.getPropertyValue('anchor-name')
    expect(anchorName).toMatch(/^--kui-anchor-/)
    expect(note.style.getPropertyValue('position-anchor')).toBe(anchorName)
    expect(note.style.getPropertyValue('position-area')).toBe('top')
    expect(note.style.getPropertyValue('position-try-fallbacks')).toBe('flip-block')
  })

  it('refuses timing tokens by name', () => {
    const reporter = collectingReporter()
    build(
      `
      <figure data-kui="hotspots 500ms 200ms ease">
        <img src="a.png" alt="">
        <ol><li style="--kui-x: 10%; --kui-y: 10%">A</li></ol>
      </figure>
      `,
      reporter,
    ).start()

    expect(reporter.messages.some((m) => m.includes('"hotspots" cannot honour duration'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"hotspots" cannot honour delay'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"hotspots" cannot honour ease'))).toBe(true)
  })

  it('showcase.css carries hotspots rules, popover styling, starting-style, and forced-colors', () => {
    expect(showcaseCss.includes("[data-kui-fx~='hotspots']")).toBe(true)
    expect(showcaseCss.includes('.kui-hotspot')).toBe(true)
    expect(showcaseCss.includes('[popover]')).toBe(true)
    expect(showcaseCss.includes(':popover-open')).toBe(true)
    expect(showcaseCss.includes('@starting-style')).toBe(true)
    const forcedColors = /@media \(forced-colors: active\) \{([\s\S]*?)\n {2}\}/.exec(showcaseCss)?.[1]
    expect(forcedColors).toMatch(
      /\[data-kui-fx~='hotspots'\] \.kui-hotspot \{\s*border-color: CanvasText;\s*background: Canvas;\s*color: CanvasText;/,
    )
    expect(forcedColors).toMatch(
      /\[data-kui-fx~='hotspots'\] \[popover\] \{\s*border-color: CanvasText;\s*background: Canvas;\s*color: CanvasText;/,
    )
  })
})
