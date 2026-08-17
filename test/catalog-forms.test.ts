import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  FORMS_PRESETS,
  NATIVE_STATE_PRIMITIVE,
  RANGE_FILL_PRIMITIVE,
  STEP_PROGRESS_PRIMITIVE,
  STRENGTH_METER_PRIMITIVE,
  SUBMIT_FLOW_PRIMITIVE,
  computeStrength,
  nextStep,
  nextSubmitStage,
} from '../src/effects/forms/index.js'

// A relative `new URL(..., import.meta.url)` throws under the jsdom test environment (its `URL`
// implementation rejects the resolved result) — resolving through `node:path` off this file's own
// URL avoids that, same trick as `catalog-numbers.test.ts`. jsdom (rather than `node`) is needed
// here because the JS-tier primitives below are exercised through real DOM elements.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/forms.css'), 'utf8')

function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

const CSS_TIER_PRESETS = ['focus-ring-grow', 'validate-shake', 'validate-check']

describe('forms catalog', () => {
  it('registers all 12 section O names', () => {
    const registry = createRegistry()
    expect(FORMS_PRESETS).toHaveLength(12)
    expect(FORMS_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every css-keyframes preset', () => {
    const presets = FORMS_PRESETS.filter((preset) => CSS_TIER_PRESETS.includes(preset.name))
    expect(presets).toHaveLength(3)
    const missing = presets.filter((preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`))
    expect(missing).toEqual([])
  })

  it('gives the five native-state presets an inert instance — the browser drives them, not JS', () => {
    const registry = createRegistry()
    const names = ['label-float', 'input-underline-grow', 'toggle-morph', 'checkbox-draw', 'radio-fill']
    for (const name of names) {
      const resolved = registry.resolve(name)
      expect(resolved?.primitive.id).toBe('native-state')
    }
  })
})

describe('computeStrength', () => {
  it('scores an empty value at zero', () => {
    expect(computeStrength('')).toBe(0)
  })

  it('scores length, case variety, digits, and symbols independently', () => {
    expect(computeStrength('short')).toBe(0)
    expect(computeStrength('longenough')).toBeGreaterThanOrEqual(2)
    expect(computeStrength('Aa1!longenough')).toBe(4)
  })

  it('never exceeds the maximum level', () => {
    expect(computeStrength('Aa1!Aa1!Aa1!Aa1!Aa1!')).toBe(4)
  })
})

describe('nextStep', () => {
  it('advances and wraps back to zero', () => {
    expect(nextStep(0, 4)).toBe(1)
    expect(nextStep(3, 4)).toBe(0)
  })

  it('stays at zero for a degenerate total', () => {
    expect(nextStep(0, 0)).toBe(0)
  })
})

describe('nextSubmitStage', () => {
  it('cycles idle -> loading -> done -> idle', () => {
    expect(nextSubmitStage('idle')).toBe('loading')
    expect(nextSubmitStage('loading')).toBe('done')
    expect(nextSubmitStage('done')).toBe('idle')
  })
})

describe('native-state', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('is a no-op prepare — the browser drives it entirely through CSS pseudo-classes', () => {
    const el = document.createElement('input')
    document.body.append(el)
    const instance = NATIVE_STATE_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))

    expect(() => instance.activate()).not.toThrow()
    expect(el.outerHTML).toBe('<input>')

    instance.destroy()
  })
})

describe('strength-meter', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('publishes computeStrength on activation and on every input event, and clears it on destroy', () => {
    const el = document.createElement('input') as HTMLInputElement
    document.body.append(el)
    const instance = STRENGTH_METER_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect(el.getAttribute('data-kui-strength-level')).toBe(String(computeStrength('')))

    el.value = 'Aa1!longenough'
    el.dispatchEvent(new Event('input'))
    expect(el.getAttribute('data-kui-strength-level')).toBe(String(computeStrength(el.value)))

    instance.destroy()
    expect(el.hasAttribute('data-kui-strength-level')).toBe(false)

    // Destroy must have removed the listener too, not just the attribute.
    el.value = 'short'
    el.dispatchEvent(new Event('input'))
    expect(el.hasAttribute('data-kui-strength-level')).toBe(false)
  })
})

describe('range-fill', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('publishes the filled percentage on activation and recomputes it on input', () => {
    const el = document.createElement('input') as HTMLInputElement
    el.min = '0'
    el.max = '200'
    el.value = '50'
    document.body.append(el)
    const instance = RANGE_FILL_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect(el.style.getPropertyValue('--kui-fill')).toBe('25.00%')

    el.value = '100'
    el.dispatchEvent(new Event('input'))
    expect(el.style.getPropertyValue('--kui-fill')).toBe('50.00%')

    instance.destroy()
  })

  it('defaults min/max to 0/100 when the input declares neither attribute', () => {
    const el = document.createElement('input') as HTMLInputElement
    el.value = '50'
    document.body.append(el)
    const instance = RANGE_FILL_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect(el.style.getPropertyValue('--kui-fill')).toBe('50.00%')
    instance.destroy()
  })

  it('reports zero fill for a degenerate range where max does not exceed min', () => {
    const el = document.createElement('input') as HTMLInputElement
    el.min = '5'
    el.max = '5'
    el.value = '5'
    document.body.append(el)
    const instance = RANGE_FILL_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect(el.style.getPropertyValue('--kui-fill')).toBe('0.00%')

    instance.destroy()
  })
})

describe('step-progress', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('advances the step index on click and wraps back to zero, clearing state on destroy', () => {
    const el = document.createElement('button')
    document.body.append(el)
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(el, createParams({ steps: '3' }), fakeCtx(el))
    instance.activate()

    expect(el.getAttribute('data-kui-step')).toBe('0')
    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-step')).toBe('1')
    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-step')).toBe('2')
    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-step')).toBe('0')

    instance.destroy()
    expect(el.hasAttribute('data-kui-step')).toBe(false)

    // Destroy must have removed the listener too, not just the attribute.
    el.dispatchEvent(new Event('click'))
    expect(el.hasAttribute('data-kui-step')).toBe(false)
  })
})

describe('submit-flow', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('cycles idle -> loading -> done -> idle on click, ignoring clicks mid-flight', () => {
    vi.useFakeTimers()
    const el = document.createElement('button')
    document.body.append(el)
    const instance = SUBMIT_FLOW_PRIMITIVE.prepare!(
      el,
      createParams({ load: '1200ms', hold: '1500ms' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.getAttribute('data-kui-stage')).toBe('idle')

    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-stage')).toBe('loading')

    // A click mid-flight must be ignored — only one submit flow runs at a time.
    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-stage')).toBe('loading')

    vi.advanceTimersByTime(1200)
    expect(el.getAttribute('data-kui-stage')).toBe('done')

    vi.advanceTimersByTime(1500)
    expect(el.getAttribute('data-kui-stage')).toBe('idle')

    instance.destroy()
    expect(el.hasAttribute('data-kui-stage')).toBe(false)
  })

  it('clears a pending timeout when destroyed mid-flight, rather than resurrecting the flow later', () => {
    vi.useFakeTimers()
    const el = document.createElement('button')
    document.body.append(el)
    const instance = SUBMIT_FLOW_PRIMITIVE.prepare!(
      el,
      createParams({ load: '1200ms', hold: '1500ms' }),
      fakeCtx(el),
    )
    instance.activate()

    el.dispatchEvent(new Event('click'))
    expect(el.getAttribute('data-kui-stage')).toBe('loading')

    instance.destroy()
    expect(el.hasAttribute('data-kui-stage')).toBe(false)

    vi.advanceTimersByTime(5000)
    expect(el.hasAttribute('data-kui-stage')).toBe(false)
  })

  it('destroying before any click is a clean no-op — nothing was ever scheduled', () => {
    const el = document.createElement('button')
    document.body.append(el)
    const instance = SUBMIT_FLOW_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect(() => instance.destroy()).not.toThrow()
    expect(el.hasAttribute('data-kui-stage')).toBe(false)
  })
})
