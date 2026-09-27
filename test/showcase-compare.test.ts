// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'

const showcaseCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'),
  'utf8',
)

describe('compare', () => {
  it('builds range and handle once', () => {
    build(
      '<figure data-kui="compare"><img src="a.jpg" alt="Before"><img src="b.jpg" alt="After"></figure>',
    ).start()

    const host = el()
    const ranges = host.querySelectorAll('.kui-compare-range')
    const handles = host.querySelectorAll('.kui-compare-handle')

    expect(ranges.length).toBe(1)
    expect(handles.length).toBe(1)

    const range = ranges[0] as HTMLInputElement
    const handle = handles[0] as HTMLElement

    expect(range.type).toBe('range')
    expect(range.min).toBe('0')
    expect(range.max).toBe('100')
    expect(range.step).toBe('1')
    expect(handle.getAttribute('aria-hidden')).toBe('true')
  })

  it('sets position: default and authored', () => {
    build(
      '<figure data-kui="compare"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    ).start()

    const defaultHost = el()
    const defaultRange = defaultHost.querySelector('.kui-compare-range') as HTMLInputElement
    expect(defaultHost.style.getPropertyValue('--kui-compare')).toBe('50%')
    expect(defaultRange.value).toBe('50')

    build(
      '<figure data-kui="compare position:75%"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    ).start()

    const authoredHost = el()
    const authoredRange = authoredHost.querySelector('.kui-compare-range') as HTMLInputElement
    expect(authoredHost.style.getPropertyValue('--kui-compare')).toBe('75%')
    expect(authoredRange.value).toBe('75')
  })

  it('stamps axis: default x and authored y', () => {
    build(
      '<figure data-kui="compare"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    ).start()
    expect(el().getAttribute('data-kui-compare-axis')).toBe('x')

    build(
      '<figure data-kui="compare axis:y"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    ).start()
    expect(el().getAttribute('data-kui-compare-axis')).toBe('y')
  })

  it('sets accessible label from aria-label or media alts', () => {
    build(
      '<figure data-kui="compare" aria-label="Retouch grade"><img src="a.jpg" alt="Before"><img src="b.jpg" alt="After"></figure>',
    ).start()

    const rangeWithAuthoredLabel = el().querySelector('.kui-compare-range') as HTMLInputElement
    expect(rangeWithAuthoredLabel.getAttribute('aria-label')).toBe('Retouch grade')

    build(
      '<figure data-kui="compare"><img src="a.jpg" alt="Raw photo"><img src="b.jpg" alt="Color graded"></figure>',
    ).start()

    const rangeWithAltLabel = el().querySelector('.kui-compare-range') as HTMLInputElement
    expect(rangeWithAltLabel.getAttribute('aria-label')).toBe('Compare: Raw photo / Color graded')
  })

  it('names video media and fills in missing media names', () => {
    build('<figure data-kui="compare"><video aria-label="Raw take"></video><video title="Edit"></video></figure>').start()
    expect(el().querySelector('input')?.getAttribute('aria-label')).toBe('Compare: Raw take / Edit')

    build('<figure data-kui="compare"><video></video><video title="Edit"></video></figure>').start()
    expect(el().querySelector('input')?.getAttribute('aria-label')).toBe('Compare: Before / Edit')

    build('<figure data-kui="compare"><video></video><video></video></figure>').start()
    expect(el().querySelector('input')?.getAttribute('aria-label')).toBe('Compare: Before / After')
  })

  it('uses the image alt inside a picture for the comparison label', () => {
    build('<figure data-kui="compare"><picture><img src="a.jpg" alt="Original"></picture><picture><img src="b.jpg" alt="Edited"></picture></figure>').start()
    expect(el().querySelector('input')?.getAttribute('aria-label')).toBe('Compare: Original / Edited')
  })

  it('sets aria-valuetext and updates it on range input', () => {
    build(
      '<figure data-kui="compare position:40%"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    ).start()

    const host = el()
    const range = host.querySelector('.kui-compare-range') as HTMLInputElement
    expect(range.getAttribute('aria-valuetext')).toBe('40% after')

    range.value = '62'
    range.dispatchEvent(new Event('input'))

    expect(host.style.getPropertyValue('--kui-compare')).toBe('62%')
    expect(range.getAttribute('aria-valuetext')).toBe('62% after')
  })

  it('warns when fewer than two media elements are present', () => {
    const reporter = collectingReporter()
    build(
      '<figure data-kui="compare"><img src="solo.jpg" alt="Solo"></figure>',
      reporter,
    ).start()

    expect(reporter.messages.some((m) => m.includes('requires at least two media children'))).toBe(true)
  })

  it('teardown removes inserted nodes and restores styles and attributes', () => {
    const animator = build(
      '<figure data-kui="compare" style="--kui-compare: 25%"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
    )
    animator.start()

    const host = el()
    expect(host.querySelector('.kui-compare-range')).not.toBeNull()
    expect(host.querySelector('.kui-compare-handle')).not.toBeNull()
    expect(host.getAttribute('data-kui-compare-axis')).toBe('x')

    const range = host.querySelector('.kui-compare-range') as HTMLInputElement
    range.value = '80'
    range.dispatchEvent(new Event('input'))
    expect(host.style.getPropertyValue('--kui-compare')).toBe('80%')

    animator.destroy()

    expect(host.querySelector('.kui-compare-range')).toBeNull()
    expect(host.querySelector('.kui-compare-handle')).toBeNull()
    expect(host.hasAttribute('data-kui-compare-axis')).toBe(false)
    expect(host.style.getPropertyValue('--kui-compare')).toBe('25%')
  })

  it('refuses timing tokens by name', () => {
    const reporter = collectingReporter()
    build(
      '<figure data-kui="compare 300ms 150ms ease"><img src="a.jpg" alt=""><img src="b.jpg" alt=""></figure>',
      reporter,
    ).start()

    expect(reporter.messages.some((m) => m.includes('"compare" cannot honour duration'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"compare" cannot honour delay'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"compare" cannot honour ease'))).toBe(true)
  })

  it('warns and keeps target: on the host because its CSS needs the host subtree', () => {
    const reporter = collectingReporter()
    build(
      '<figure data-kui="compare target:img"><img src="a.jpg" alt="Before"><img src="b.jpg" alt="After"></figure>',
      reporter,
    ).start()

    expect(el().getAttribute('data-kui-fx')).toContain('compare')
    expect(el().querySelectorAll('img[data-kui-fx]')).toHaveLength(0)
    expect(reporter.messages.join('\n')).toContain('"compare" cannot be retargeted')
    expect(reporter.messages.join('\n')).toContain('"target:img" is dropped')
  })

  it('showcase.css carries compare rules, axis branching, and forced-colors styles', () => {
    expect(showcaseCss).toMatch(/\[data-kui-fx~='compare'\] \{[^}]*display: grid;/)
    expect(showcaseCss).toMatch(/\[data-kui-fx~='compare'\] > \.kui-compare-handle \{[^}]*translate: calc\(var\(--kui-compare, 50%\) - 100%\) 0;/)
    expect(showcaseCss).toMatch(/\[data-kui-fx~='compare'\] > \.kui-compare-range:focus-visible \+ \.kui-compare-handle \{[^}]*outline: 2px solid Highlight;/)
    const forcedColors = /@media \(forced-colors: active\) \{([\s\S]*?)\n {2}\}/.exec(showcaseCss)?.[1]
    expect(forcedColors).toMatch(
      /\[data-kui-fx~='compare'\] > \.kui-compare-handle::before \{\s*border: 2px solid CanvasText;\s*background: Canvas;/,
    )
  })

  it('clips only the second media child on both axes', () => {
    const second = ':is(img, picture, video):nth-child(2 of :is(img, picture, video))'
    const x = `[data-kui-fx~='compare'] > ${second}`
    const y = `[data-kui-fx~='compare'][data-kui-compare-axis='y'] > ${second}`
    const rules = showcaseCss.split('}')
      .filter((part) => part.includes("[data-kui-fx~='compare']") && part.includes('clip-path:'))
    expect(rules.map((part) => part.slice(0, part.indexOf('{')).trim())).toEqual([x, y])
    expect(rules[0]).toContain('clip-path: inset(0 0 0 var(--kui-compare, 50%))')
    expect(rules[1]).toContain('clip-path: inset(var(--kui-compare, 50%) 0 0 0)')
  })
})
