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

type Declarations = Record<string, string>

const uncommented = showcaseCss.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Every declaration in every innermost block whose selector is exactly `selector`, merged in order.
 * Split on braces rather than matched with one regex: a `[^{}]+\{[^{}]*\}` pattern is the shape
 * `sonarjs/slow-regex` refuses, and this repo carries no eslint-disable.
 */
function declarations(selector: string): Declarations {
  const merged: Declarations = {}
  for (const chunk of uncommented.split('}')) {
    const open = chunk.lastIndexOf('{')
    if (open < 0) continue
    const sel = chunk.slice(chunk.lastIndexOf('{', open - 1) + 1, open)
    if (sel.trim().split(/\s+/).join(' ') !== selector) continue
    for (const line of chunk.slice(open + 1).split(';')) {
      const colon = line.indexOf(':')
      if (colon > 0) merged[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/\s+/g, ' ')
    }
  }
  return merged
}

/** What a `[data-kui-device='kind']` host declares, plus whatever the primitive writes inline for its params. */
function hostDeclarations(kind: string, inline: Declarations = {}): Declarations {
  return {
    ...inline,
    ...declarations('[data-kui-device]'),
    ...declarations(`[data-kui-device='${kind}']`),
  }
}

/** The index of the `)` that closes the `(` at `open`. */
function closing(value: string, open: number): number {
  for (let at = open, depth = 0; at < value.length; at += 1) {
    if (value[at] === '(') depth += 1
    else if (value[at] === ')' && --depth === 0) return at
  }
  throw new Error(`unbalanced: ${value}`)
}

/** Split on `separator` wherever it sits outside every parenthesis. */
function splitTop(value: string, separator: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < value.length; at += 1) {
    if (value[at] === '(') depth += 1
    else if (value[at] === ')') depth -= 1
    else if (depth === 0 && separator.test(value[at]!)) {
      parts.push(value.slice(start, at))
      start = at + 1
    }
  }
  return [...parts, value.slice(start)].map((part) => part.trim()).filter((part) => part !== '')
}

/** Substitute `var()` until none is left, as the cascade would on the host (and its child, by inheritance). */
function resolve(value: string, vars: Declarations): string {
  let out = value
  for (let at = out.indexOf('var('), guard = 0; at >= 0 && guard < 200; at = out.indexOf('var('), guard += 1) {
    const close = closing(out, at + 3)
    const [name, ...fallback] = splitTop(out.slice(at + 4, close), /,/)
    const substitute = vars[name!] ?? (fallback.length > 0 ? fallback.join(', ') : 'UNSET')
    out = out.slice(0, at) + substitute + out.slice(close + 1)
  }
  return out
}

/** Evaluate one resolved px term: a number, `a - b - c`, or a `min()`/`max()` of terms. */
function px(term: string): number {
  const [first, ...rest] = splitTop(term, / /).filter((part) => part !== '-')
  const value = (part: string): number => {
    const fn = /^(min|max)\(/.exec(part)
    if (!fn) return parseFloat(part)
    const args = splitTop(part.slice(fn[0].length, -1), /,/).map(px)
    return fn[1] === 'min' ? Math.min(...args) : Math.max(...args)
  }
  return rest.reduce((total, part) => total - value(part), value(first!))
}

const numbers = (value: string): number[] => value.split(/\s+/).map((part) => parseFloat(part))

/**
 * The child rule's corner radii, evaluated against a host's properties: four circular `max()`
 * terms (tl tr br bl) when derived, or the one authored `screen-radius:` value.
 */
function innerRadii(host: Declarations): number[] {
  const value = resolve(declarations('[data-kui-device] > *')['border-radius']!, host)
  // `max(a, b - c - d)` keeps its inner spaces; split the list on top-level spaces only.
  return splitTop(value, / /).map(px)
}

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

  it('writes an authored radius: to the custom property the bezel and screen both derive from', () => {
    build('<div data-kui="device-frame kind:phone radius:24px"><img src="a.png" alt=""></div>').start()
    expect(el().style.getPropertyValue('--kui-device-radius')).toBe('24px')
  })

  it('writes an authored screen-radius: to the custom property that replaces the derived screen', () => {
    build('<div data-kui="device-frame kind:browser screen-radius:12px"><img src="a.png" alt=""></div>').start()
    expect(el().style.getPropertyValue('--kui-device-screen-radius')).toBe('12px')
  })

  it('writes neither radius when none is authored, so each kind keeps its own', () => {
    build('<div data-kui="device-frame kind:browser"><img src="a.png" alt=""></div>').start()
    expect(el().style.getPropertyValue('--kui-device-radius')).toBe('')
    expect(el().style.getPropertyValue('--kui-device-screen-radius')).toBe('')
  })

  // The screen's inner radius is CSS arithmetic jsdom does not compute, so these resolve the
  // stylesheet's own declarations by hand: substitute the custom properties a kind's host would
  // carry, then evaluate the child rule's `min()`/`max()` terms. A broken formula, a kind restating
  // its own `padding`/`border-radius` past the shared properties, a fallback radius drifting, or
  // the floor going missing all change the numbers.
  describe('screen radius follows the bezel', () => {
    const KIND_BOX = {
      // [padding top side bottom], [outer radius tl tr br bl]
      browser: { padding: [30, 14, 14], outer: [10, 10, 10, 10] },
      phone: { padding: [16, 8, 16], outer: [36, 36, 36, 36] },
      tablet: { padding: [18, 18, 18], outer: [22, 22, 22, 22] },
      laptop: { padding: [10, 10, 34], outer: [12, 12, 4, 4] },
    } as const

    // [tl tr br bl]: outer − the thinner of the two bezels meeting at that corner − 1px border,
    // never below the floor — the frame's top radius, up to 8px. Every kind whose bezel outruns
    // its radius lands on the floor instead of a square.
    it.each([
      ['browser', undefined, [8, 8, 8, 8]],
      ['browser', '24px', [9, 9, 9, 9]],
      ['browser', '4px', [4, 4, 4, 4]],
      ['browser', '0px', [0, 0, 0, 0]],
      ['phone', undefined, [27, 27, 27, 27]],
      ['phone', '20px', [11, 11, 11, 11]],
      ['tablet', undefined, [8, 8, 8, 8]],
      ['tablet', '40px', [21, 21, 21, 21]],
      ['laptop', undefined, [8, 8, 8, 8]],
      ['laptop', '30px', [19, 19, 8, 8]],
    ] as const)('kind:%s radius:%s', (kind, radius, expected) => {
      const host = hostDeclarations(kind, radius === undefined ? {} : { '--kui-device-radius': radius })
      expect(numbers(resolve(host.padding!, host))).toEqual(KIND_BOX[kind].padding)
      if (radius === undefined) {
        expect(numbers(resolve(host['border-radius']!, host))).toEqual(KIND_BOX[kind].outer)
      }
      expect(innerRadii(host)).toEqual(expected)
    })

    it.each(['browser', 'phone', 'tablet', 'laptop'])('kind:%s takes an authored screen-radius: verbatim', (kind) => {
      const host = hostDeclarations(kind, { '--kui-device-radius': '30px', '--kui-device-screen-radius': '12px' })
      expect(innerRadii(host)).toEqual([12])
    })

    it('rounds every screen corner as a circle: a per-axis ellipse reads square on a thin bezel', () => {
      // A strictly concentric corner on a `radius:20px` phone is 11px across by 3px down.
      expect(declarations('[data-kui-device] > *')['border-radius']).not.toContain('/')
    })

    it('clips the screen on the child itself, for every media type the frame accepts', () => {
      const child = declarations('[data-kui-device] > *')
      expect(child.overflow).toBe('hidden')
      expect(child['inline-size']).toBe('100%')
      expect(child['block-size']).toBe('100%')
      expect(declarations('[data-kui-device] > :is(img, video, iframe, picture)').display).toBe('block')
      expect(declarations('[data-kui-device] > picture > img')['block-size']).toBe('100%')
    })
  })

  it('showcase.css carries a rule for every kind and a forced-colors block', () => {
    for (const kind of ['browser', 'phone', 'tablet', 'laptop']) {
      expect(showcaseCss.includes(`[data-kui-device='${kind}']`), kind).toBe(true)
    }
    expect(showcaseCss.includes('forced-colors: active')).toBe(true)
  })
})
