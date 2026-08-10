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
    const decorative = el.querySelector('.dsg-count-decorative')!
    expect(decorative.getAttribute('aria-hidden')).toBe('true')
    const srOnly = el.querySelector('.dsg-sr-only')!
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
    expect(el.textContent).toBe('10')
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
    expect(el.querySelector('.dsg-count-decorative')?.textContent).toBe(
      formatCount(4820, { format: 'currency', decimals: 0, currency: 'USD' }),
    )
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
    expect(el.querySelector('.dsg-count-decorative')?.textContent).toBe('50')
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
    const columns = el.querySelectorAll('.dsg-odometer-col')
    expect(columns).toHaveLength(3) // "125" is the wider of "0" and "125" at 3 digits
    expect(el.querySelector('.dsg-sr-only')?.textContent).toBe('000')

    vi.advanceTimersByTime(80)
    const strips = el.querySelectorAll('.dsg-odometer-strip')
    const digits = [...strips].map((strip) => (strip as HTMLElement).style.getPropertyValue('--dsg-o'))
    expect(digits.join('')).toBe('125')
    expect(el.querySelector('.dsg-sr-only')?.textContent).toBe('125')

    instance.destroy()
    expect(el.textContent).toBe('125')
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
    expect(el.querySelectorAll('.dsg-odometer-col')).toHaveLength(4)
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
