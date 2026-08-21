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
  RADIO_FILL_PRIMITIVE,
  RANGE_FILL_PRIMITIVE,
  STEP_PROGRESS_PRIMITIVE,
  STRENGTH_METER_PRIMITIVE,
  SUBMIT_FLOW_PRIMITIVE,
  TOGGLE_MORPH_PRIMITIVE,
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

  it('gives label-float/input-underline-grow/checkbox-draw an inert instance — the browser drives them, not JS', () => {
    const registry = createRegistry()
    const names = ['label-float', 'input-underline-grow', 'checkbox-draw']
    for (const name of names) {
      const resolved = registry.resolve(name)
      expect(resolved?.primitive.id).toBe('native-state')
    }
  })

  it('gives toggle-morph/radio-fill their own primitive, for the sibling-scale write their shared scale param needs', () => {
    const registry = createRegistry()
    expect(registry.resolve('toggle-morph')?.primitive.id).toBe('toggle-morph')
    expect(registry.resolve('radio-fill')?.primitive.id).toBe('radio-fill')
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

describe('toggle-morph / radio-fill (sibling scale)', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('writes the resolved scale onto the next sibling on activation and removes it on destroy', () => {
    const el = document.createElement('input')
    const sibling = document.createElement('span')
    const container = document.createElement('div')
    container.append(el, sibling)
    document.body.append(container)

    const instance = TOGGLE_MORPH_PRIMITIVE.prepare!(el, createParams({ scale: '1.5' }), fakeCtx(el))
    instance.activate()
    expect(sibling.style.getPropertyValue('--kui-toggle-scale')).toBe('1.5')

    instance.destroy()
    expect(sibling.style.getPropertyValue('--kui-toggle-scale')).toBe('')
  })

  it('defaults the scale to 1 when the param is not supplied', () => {
    const el = document.createElement('input')
    const sibling = document.createElement('span')
    const container = document.createElement('div')
    container.append(el, sibling)
    document.body.append(container)

    const instance = RADIO_FILL_PRIMITIVE.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()
    expect(sibling.style.getPropertyValue('--kui-radio-scale')).toBe('1')

    instance.destroy()
  })

  it('is a clean no-op when the element carrying the attribute has no next sibling', () => {
    const el = document.createElement('input')
    document.body.append(el)

    const instance = RADIO_FILL_PRIMITIVE.prepare!(el, createParams({ scale: '2' }), fakeCtx(el))
    expect(() => instance.activate()).not.toThrow()
    expect(() => instance.destroy()).not.toThrow()
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

  it('marks its own children by default, so the shipped CSS needs no selector', () => {
    document.body.innerHTML = '<div id="bar"><i></i><i></i><i></i></div>'
    const el = document.getElementById('bar')!
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(el, createParams({ steps: '3' }), fakeCtx(el))
    instance.activate()

    const states = (): (string | null)[] =>
      [...el.children].map((c) => c.getAttribute('data-kui-step-state'))
    expect(states()).toEqual(['active', 'after', 'after'])

    el.dispatchEvent(new Event('click'))
    expect(states()).toEqual(['before', 'active', 'after'])

    instance.destroy()
    expect(states()).toEqual([null, null, null])
  })

  it('marks a named target when the segments live outside the control', () => {
    document.body.innerHTML = '<button id="bar"></button><ol class="legend"><li></li><li></li></ol>'
    const el = document.getElementById('bar')!
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ steps: '2', target: '.legend > li' }),
      fakeCtx(el),
    )
    instance.activate()

    const states = (): (string | null)[] =>
      [...document.querySelectorAll('.legend li')].map((c) =>
        c.getAttribute('data-kui-step-state'),
      )
    expect(states()).toEqual(['active', 'after'])
    // The control itself is not a segment, so it must not be marked as one.
    expect(el.hasAttribute('data-kui-step-state')).toBe(false)

    el.dispatchEvent(new Event('click'))
    expect(states()).toEqual(['before', 'active'])
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
