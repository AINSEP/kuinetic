// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { COUNT_PRIMITIVES } from '../src/effects/catalog/numbers.js'
import { TIME_SCALE_ATTR } from '../src/core/time-scale.js'
import { catalogRegistry } from './support/registry.js'

const odometer = COUNT_PRIMITIVES.find((p) => p.id === 'count-odometer')!
const markup = 'odometer-roll attribute:data-value 500ms on:load'
const runs: Array<{ node: HTMLElement; frames: Keyframe[]; timing: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; playbackRate: number }> = []
let animatedWidth: number | undefined
const animationDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')

beforeEach(() => {
  runs.length = 0
  animatedWidth = undefined
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    const run = { node: this, frames, timing, playbackRate: 1, cancel: vi.fn(() => { if (this.classList.contains('kui-odometer-live')) animatedWidth = undefined }) }
    runs.push(run)
    return run
  } })
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ translate: el.getAttribute('data-rendered') ?? 'none', fontSize: '10px' }) as CSSStyleDeclaration)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: animatedWidth ?? this.querySelectorAll('.kui-odometer-col').length * 10 } as DOMRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (animationDescriptor) Object.defineProperty(HTMLElement.prototype, 'animate', animationDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

function install(initial: string | null = '9', reducedMotion = false) {
  const el = document.createElement('span')
  el.innerHTML = '<b>9</b>'
  const authored = el.firstChild
  if (initial !== null) el.setAttribute('data-value', initial)
  const warn = vi.fn()
  const instance = odometer.prepare!(el, createParams({ attribute: 'data-value', duration: '500ms', delay: '20ms' }),
    { win: window, doc: document, reducedMotion, warn } as unknown as PrepareContext)
  instance.activate()
  const update = async (value: string) => { el.setAttribute('data-value', value); await Promise.resolve() }
  return { el, authored, warn, instance, update, sr: () => el.querySelector('.kui-sr-only')!.textContent }
}

describe('round 4 live number', () => {
  it('compiles the live attribute while keeping fixed playback free of live DOM and observers', () => {
    const plan = compile(parse(markup), catalogRegistry(), 'time')
    expect(plan.warnings).toEqual([])
    expect(plan.channels).toContain('subtree')
    const observer = vi.spyOn(window, 'MutationObserver')
    const el = document.createElement('span')
    el.textContent = '5'
    const instance = odometer.prepare!(el, createParams({ to: '5', duration: '0ms' }),
      { win: window, doc: document, warn: vi.fn(), reducedMotion: false } as unknown as PrepareContext)
    try {
      instance.activate()
      expect(el.querySelector('.kui-count-decorative')).not.toBeNull()
      expect(el.querySelector('.kui-odometer-live')).toBeNull()
      expect(observer).not.toHaveBeenCalled()
    } finally { instance.destroy() }
  })
  it('rolls 9→10→99→100 and back, updates accessible text immediately, and animates width', async () => {
    const test = install()
    expect(test.sr()).toBe('9')
    expect(runs).toEqual([])
    for (const value of ['10', '99', '100', '99', '10', '9']) {
      const start = runs.length
      const before = Number(test.sr())
      await test.update(value)
      expect(test.sr()).toBe(value)
      expect(test.el.querySelectorAll('.kui-odometer-col')).toHaveLength(value.length)
      const batch = runs.slice(start)
      expect(batch.at(-1)!.frames).toEqual([{ width: `${String(before).length * 10}px` }, { width: `${value.length * 10}px` }])
      for (const run of batch.slice(0, -1)) {
        const from = Number.parseFloat(String(run.frames[0]!.translate).split(' ')[1]!)
        const to = Number.parseFloat(String(run.frames[1]!.translate).split(' ')[1]!)
        expect(Math.sign(to - from)).toBeLessThanOrEqual(Number(value) > before ? 0 : 1)
        if (Number(value) < before) expect(to).toBeGreaterThanOrEqual(from)
        expect(run.timing).toMatchObject({ duration: 500, delay: 20, fill: 'backwards', easing: 'ease-out' })
      }
    }
    expect(test.el.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(test.el.querySelector('.kui-sr-only')!.hasAttribute('aria-live')).toBe(false)
    expect(test.warn).not.toHaveBeenCalled()
    test.instance.destroy()
    expect(test.el.firstChild).toBe(test.authored)
  })
  it('retargets the displayed fractional strip offset and displayed width before cancellation', async () => {
    const test = install()
    await test.update('10')
    const first = [...runs]
    const strip = test.el.querySelectorAll('.kui-odometer-strip')[1]!
    strip.setAttribute('data-rendered', '0px -195px')
    animatedWidth = 15.5
    await test.update('11')
    expect(first.every((run) => run.cancel.mock.calls.length === 1)).toBe(true)
    expect(runs.at(-2)!.frames).toEqual([{ translate: '0 -19.5em' }, { translate: '0 -21em' }])
    expect(runs.at(-1)!.frames).toEqual([{ width: '15.5px' }, { width: '20px' }])
    test.instance.destroy()
  })
  it('coalesces rapid attribute writes to the latest value and stops observing on destroy', async () => {
    const test = install()
    test.el.setAttribute('data-value', '99')
    test.el.setAttribute('data-value', '100')
    await test.update('9')
    expect(runs).toHaveLength(0)
    await test.update('100')
    expect(test.sr()).toBe('100')
    await test.update('9')
    expect(test.sr()).toBe('9')
    const size = runs.length
    test.instance.destroy()
    expect(runs.every((run) => run.cancel.mock.calls.length === 1)).toBe(true)
    await test.update('200')
    expect(runs).toHaveLength(size)
    expect(test.el.firstChild).toBe(test.authored)
  })
  it.each([null, '', 'nope', 'Infinity', '9007199254740992'])('warns once and retains a safe value for %s', async (invalid) => {
    const test = install(invalid)
    expect(test.sr()).toBe('0')
    expect(test.warn).toHaveBeenCalledOnce()
    await test.update('99')
    expect(test.sr()).toBe('99')
    test.warn.mockClear()
    await test.update('bad')
    expect(test.sr()).toBe('99')
    expect(test.warn).toHaveBeenCalledOnce()
    test.instance.destroy()
  })
  it('groups signed values and rounds, and inherits time scale', async () => {
    const test = install('-1000')
    test.el.setAttribute(TIME_SCALE_ATTR, '0.25')
    expect(test.sr()).toBe('-1,000')
    await test.update('-999.4')
    expect(test.sr()).toBe('-999')
    expect(runs.every((run) => run.playbackRate === 0.25)).toBe(true)
    await test.update('1000')
    expect(test.sr()).toBe('1,000')
    test.instance.destroy()
  })
  it.each(['reduced', 'no-waapi'])('shows current accessible and visual digits immediately for %s', async (mode) => {
    if (mode === 'no-waapi') Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    const test = install('9', mode === 'reduced')
    await test.update('100')
    expect(test.sr()).toBe('100')
    expect([...test.el.querySelectorAll<HTMLElement>('.kui-odometer-strip')].map((strip) => strip.style.getPropertyValue('--kui-o'))).toEqual(['11', '10', '10'])
    expect(runs).toHaveLength(0)
    test.instance.destroy()
  })
  it('keeps the initial value without MutationObserver and restores authored children', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const test = install()
    expect(test.sr()).toBe('9')
    test.instance.destroy()
    expect(test.el.firstChild).toBe(test.authored)
  })
})
