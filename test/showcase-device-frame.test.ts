// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'

// A relative `new URL(..., import.meta.url)` throws under the jsdom test environment (its `URL`
// treats `import.meta.url` as a page-relative address); `fileURLToPath(import.meta.url)` alone,
// resolved with `node:path` instead, is the precedent `test/catalog-navigation.test.ts` sets.
const showcaseCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'),
  'utf8',
)

/**
 * `device-frame` — the pattern-proving showcase widget. Covers the attribute stamp/teardown
 * contract every later showcase widget also owes, plus the CSS text checks that stand in for
 * `test/css-invariants.test.ts`'s scan, which does not reach `src/showcase/showcase.css` (see
 * `device-frame.ts`'s note on `requiresOwnSubtree`).
 */
describe('device-frame', () => {
  it('stamps the default kind when none is authored', () => {
    build('<div data-kui="device-frame"><img src="a.png" alt=""></div>').start()
    expect(el().getAttribute('data-kui-device')).toBe('browser')
  })

  it.each(['browser', 'phone', 'tablet', 'laptop'])('stamps an authored kind:%s', (kind) => {
    build(`<div data-kui="device-frame kind:${kind}"><img src="a.png" alt=""></div>`).start()
    expect(el().getAttribute('data-kui-device')).toBe(kind)
  })

  it('rejects a bad kind by keyword validation, warns, and falls back to the default', () => {
    const reporter = collectingReporter()
    build('<div data-kui="device-frame kind:desktop"></div>', reporter).start()

    expect(el().getAttribute('data-kui-device')).toBe('browser')
    expect(reporter.messages.some((m) => m.includes('"kind"'))).toBe(true)
  })

  it('restores a pre-authored data-kui-device attribute on teardown', () => {
    const animator = build(
      '<div data-kui="device-frame kind:phone" data-kui-device="already-here"></div>',
    )
    animator.start()
    expect(el().getAttribute('data-kui-device')).toBe('phone')

    animator.destroy()
    expect(el().getAttribute('data-kui-device')).toBe('already-here')
  })

  it('removes the attribute on teardown when the author never wrote one', () => {
    const animator = build('<div data-kui="device-frame"></div>')
    animator.start()
    expect(el().hasAttribute('data-kui-device')).toBe(true)

    animator.destroy()
    expect(el().hasAttribute('data-kui-device')).toBe(false)
  })

  it('refuses every timing token by name instead of silently doing nothing', () => {
    const reporter = collectingReporter()
    build('<div data-kui="device-frame 400ms 100ms linear"></div>', reporter).start()

    expect(reporter.messages.some((m) => m.includes('"device-frame" cannot honour duration'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"device-frame" cannot honour delay'))).toBe(true)
    expect(reporter.messages.some((m) => m.includes('"device-frame" cannot honour ease'))).toBe(true)
  })

  it('warns and keeps target: on the host because its CSS needs the host subtree', () => {
    const reporter = collectingReporter()
    build('<div data-kui="device-frame target:img"><img src="a.png" alt=""></div>', reporter).start()

    expect(el().getAttribute('data-kui-fx')).toContain('device-frame')
    expect(el().querySelector('img')?.hasAttribute('data-kui-fx')).toBe(false)
    expect(reporter.messages.join('\n')).toContain('"device-frame" cannot be retargeted')
    expect(reporter.messages.join('\n')).toContain('"target:img" is dropped')
  })

  it('showcase.css carries a rule for every kind and a forced-colors block', () => {
    for (const kind of ['browser', 'phone', 'tablet', 'laptop']) {
      expect(showcaseCss.includes(`[data-kui-device='${kind}']`), kind).toBe(true)
    }
    expect(showcaseCss.includes('forced-colors: active')).toBe(true)
  })
})
