import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  METER_PRESETS,
  NUMBERS_PRESETS,
  registerNumbers,
} from '../src/effects/catalog/numbers.js'
import {
  easeOutCubic,
  formatCount,
  groupDigits,
  odometerTokens,
  paddedDigits,
  resolveEasing,
  tweenValue,
} from '../src/effects/catalog/numbers-shared.js'

// A relative `new URL(..., import.meta.url)` throws under the jsdom test environment (its `URL`
// implementation rejects the resolved result), unlike the `node`-environment media test this file
// otherwise mirrors — resolving through `node:path` off this file's own URL avoids that entirely.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/numbers.css'), 'utf8')

function registry(): Registry {
  return registerNumbers(new Registry())
}

/** JS-tier count/odometer primitives only read `win` off `ctx`, same as the text-tier primitives. */
function fakeCtx(reducedMotion = false): PrepareContext {
  return { win: window, doc: window.document, reducedMotion } as unknown as PrepareContext
}

describe('numbers catalog registration', () => {
  it('registers all 13 section F names', () => {
    expect(NUMBERS_PRESETS).toHaveLength(13)
    const reg = registry()
    expect(NUMBERS_PRESETS.every((preset) => reg.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = METER_PRESETS.filter((preset) => !css.includes(`@keyframes ${preset.keyframes}`))
    expect(missing).toEqual([])
  })
})

describe('count-up / count-down / count-currency / count-percent / count-compact', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ticks an aria-hidden display and finalizes an SR-only twin exactly once, on completion', () => {
    const resolved = registry().resolve('count-up')!
    const el = document.createElement('span')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '10', duration: '100ms' }),
      fakeCtx(),
    )

    instance.activate()
    const decorative = el.querySelector('.kui-count-decorative')!
    expect(decorative.getAttribute('aria-hidden')).toBe('true')
    const srOnly = el.querySelector('.kui-sr-only')!
    expect(srOnly.textContent).toBe('0')

    vi.advanceTimersByTime(48) // partway through a 100ms ramp
    expect(decorative.textContent).not.toBe('0')
    expect(decorative.textContent).not.toBe('10')
    // The SR-only layer must not move mid-count — only the decorative layer ticks.
    expect(srOnly.textContent).toBe('0')

    vi.advanceTimersByTime(100)
    expect(decorative.textContent).toBe('10')
    expect(srOnly.textContent).toBe('10')

    instance.destroy()
    // Authored empty, so it comes back empty. `destroy()` unwinds the library; it does not get to
    // leave behind a number the author never wrote.
    expect(el.textContent).toBe('')
  })

  it('restores the authored content on destroy rather than the value it counted to', () => {
    const resolved = registry().resolve('count-up')!
    const el = document.createElement('span')
    el.textContent = '42'

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '100', duration: '100ms' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(200)
    expect(el.querySelector('.kui-count-decorative')?.textContent).toBe('100')

    instance.destroy()
    expect(el.textContent).toBe('42')
  })

  it('puts back element children it never owned', () => {
    const resolved = registry().resolve('count-up')!
    const el = document.createElement('span')
    el.innerHTML = '<b>42</b>'
    const authored = el.innerHTML

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '100', duration: '100ms' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(200)

    instance.destroy()
    expect(el.innerHTML).toBe(authored)
  })

  it('formats count-currency and count-percent through their registered defaults', () => {
    const reg = registry()
    const currency = reg.resolve('count-currency')!
    expect(currency.preset.params?.format).toBe('currency')
    const percent = reg.resolve('count-percent')!
    expect(percent.preset.params?.format).toBe('percent')

    const el = document.createElement('span')
    const instance = currency.primitive.prepare!(
      el,
      createParams({ from: '0', to: '4820', format: 'currency', currency: 'USD', decimals: '0' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(1600)
    expect(el.querySelector('.kui-count-decorative')?.textContent).toBe(
      formatCount(4820, { format: 'currency', decimals: 0, currency: 'USD' }),
    )
  })

  it('jumps straight to the final value on the first tick when duration is zero', () => {
    const resolved = registry().resolve('count-up')!
    const el = document.createElement('span')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '10', duration: '0ms' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(16)
    expect(el.querySelector('.kui-count-decorative')?.textContent).toBe('10')
  })

  it('collapses to an effectively-instant tick under reduced motion instead of freezing blank', () => {
    const resolved = registry().resolve('count-up')!
    const el = document.createElement('span')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '50', duration: '5000ms' }),
      fakeCtx(true),
    )
    instance.activate()
    vi.advanceTimersByTime(16)
    expect(el.querySelector('.kui-count-decorative')?.textContent).toBe('50')
  })
})

describe('odometer-roll', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('builds a fixed digit-column layout and rolls every column to the final value', () => {
    const resolved = registry().resolve('odometer-roll')!
    const el = document.createElement('span')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '125', duration: '80ms' }),
      fakeCtx(),
    )

    instance.activate()
    const columns = el.querySelectorAll('.kui-odometer-col')
    expect(columns).toHaveLength(3) // "125" is the wider of "0" and "125" at 3 digits
    expect(el.querySelector('.kui-sr-only')?.textContent).toBe('000')

    vi.advanceTimersByTime(80)
    const strips = el.querySelectorAll('.kui-odometer-strip')
    const digits = [...strips].map((strip) => (strip as HTMLElement).style.getPropertyValue('--kui-o'))
    expect(digits.join('')).toBe('125')
    expect(el.querySelector('.kui-sr-only')?.textContent).toBe('125')

    instance.destroy()
    // Authored empty, so it comes back empty — the rolled total belongs to the library, not the
    // author, and teardown hands the element back.
    expect(el.textContent).toBe('')
  })

  it('puts back the authored fallback content on destroy', () => {
    const resolved = registry().resolve('odometer-roll')!
    const el = document.createElement('span')
    el.innerHTML = '<b>125</b>'
    const authored = el.innerHTML

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '125', duration: '80ms' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(80)

    instance.destroy()
    expect(el.innerHTML).toBe(authored)
  })

  it('keeps grouping separators static while only digit columns roll', () => {
    const resolved = registry().resolve('odometer-roll')!
    const el = document.createElement('span')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ from: '0', to: '4820', duration: '16ms' }),
      fakeCtx(),
    )
    instance.activate()
    vi.advanceTimersByTime(16)
    // "4820" is 4 digits, grouped as "4,820" — one comma, rendered as a plain text node.
    expect(el.querySelectorAll('.kui-odometer-col')).toHaveLength(4)
    expect(el.textContent).toContain(',')
  })
})

describe('numbers pure math', () => {
  it('easeOutCubic clamps and settles at both ends', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(2)).toBe(1)
  })

  it('tweenValue interpolates linearly at a given eased ratio', () => {
    expect(tweenValue(0, 10, 20)).toBe(10)
    expect(tweenValue(0.5, 10, 20)).toBe(15)
    expect(tweenValue(1, 10, 20)).toBe(20)
  })

  it('formatCount renders each family distinctly', () => {
    expect(formatCount(1284, { format: 'number', decimals: 0, currency: 'USD' })).toMatch(/1,?284/)
    expect(formatCount(0.5, { format: 'percent', decimals: 0, currency: 'USD' })).toContain('%')
    expect(formatCount(128400, { format: 'compact', decimals: 0, currency: 'USD' })).not.toBe('128400')
  })

  it('paddedDigits left-pads to a fixed width and never goes negative', () => {
    expect(paddedDigits(7, 3)).toBe('007')
    expect(paddedDigits(-5, 3)).toBe('000')
    expect(paddedDigits(1234, 3)).toBe('1234')
  })

  it('groupDigits inserts thousands separators from the right', () => {
    expect(groupDigits('4820')).toBe('4,820')
    expect(groupDigits('04820')).toBe('04,820')
    expect(groupDigits('12')).toBe('12')
  })

  it('odometerTokens tags digits and separators correctly', () => {
    expect(odometerTokens('04,820')).toEqual([
      { char: '0', digit: true },
      { char: '4', digit: true },
      { char: ',', digit: false },
      { char: '8', digit: true },
      { char: '2', digit: true },
      { char: '0', digit: true },
    ])
  })
})

describe('resolveEasing', () => {
  it('defaults to easeOutCubic when no easing was authored', () => {
    expect(resolveEasing(undefined, () => {})).toBe(easeOutCubic)
  })

  it('resolves "linear" to an unclamped-input, clamped-output identity ramp', () => {
    const linear = resolveEasing('linear', () => {})
    expect(linear(0)).toBe(0)
    expect(linear(0.5)).toBe(0.5)
    expect(linear(1)).toBe(1)
  })

  it('warns and falls back to easeOutCubic for an easing with no JS equivalent', () => {
    const warnings: string[] = []
    const fn = resolveEasing('steps(4)', (m) => warnings.push(m))
    expect(fn).toBe(easeOutCubic)
    expect(warnings.join()).toContain('steps(4)')
    expect(warnings.join()).toContain('no JS equivalent')
  })

  it('parses a raw cubic-bezier(...) function into an evaluator matching its endpoints', () => {
    const fn = resolveEasing('cubic-bezier(0.42,0,1,1)', () => {})
    expect(fn(0)).toBeCloseTo(0, 5)
    expect(fn(1)).toBeCloseTo(1, 5)
  })

  describe('keyword curves — bisection fallback near a flat tangent', () => {
    // back-out's curve overshoots past 1 partway through and has a near-flat tangent there, which
    // is exactly the region where Newton-Raphson struggles and the bisection fallback matters —
    // per the function's own doc comment.
    it('is monotonic at the endpoints and overshoots past 1 partway through', () => {
      const backOut = resolveEasing('back-out', () => {})
      expect(backOut(0)).toBeCloseTo(0, 2)
      expect(backOut(1)).toBeCloseTo(1, 2)

      const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(backOut)
      expect(samples.some((v) => v > 1)).toBe(true)
      expect(samples.every((v) => Number.isFinite(v))).toBe(true)
    })

    it('resolves every other keyword curve to a finite, endpoint-anchored evaluator', () => {
      const keywords = [
        'ease',
        'ease-in',
        'ease-out',
        'ease-in-out',
        'expo-in',
        'expo-out',
        'expo-in-out',
        'back-in',
        'back-in-out',
        'quart-out',
        'circ-out',
      ]
      for (const keyword of keywords) {
        const fn = resolveEasing(keyword, () => {})
        expect(fn(0), keyword).toBeCloseTo(0, 1)
        expect(fn(1), keyword).toBeCloseTo(1, 1)
        for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          expect(Number.isFinite(fn(t)), `${keyword} at ${t}`).toBe(true)
        }
      }
    })
  })
})
