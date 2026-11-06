// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { readEffectParams, readEffectTiming } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance, EffectTiming } from '../src/core/types.js'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { catalogRegistry } from './support/registry.js'
import { build, CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'

const registry = catalogRegistry()
const instances: EffectInstance[] = []
const examples = [
  "typewriter words:'TEN|NINE|EIGHT' erase:scatter step:70ms interval:500ms",
  "typewriter words:'TEN|NINE|EIGHT' erase:scatter step:70ms interval:500ms on:load",
  'typewriter erase:scatter loop:true',
  'typewriter rhythm:natural step:65ms on:load',
  "typewriter words:'A!|B' erase:scatter rhythm:natural step:100ms interval:20ms",
]

function mount(source: string, html = '<em>Original text</em>', timing: EffectTiming = {}) {
  const plan = compile(parse(source), registry, 'time')
  expect(plan.warnings).toEqual([])
  const { resolved, spec } = plan.jsEffects[0]!
  const host = document.body.appendChild(document.createElement('p'))
  host.innerHTML = html
  const warn = vi.fn()
  const params = readEffectParams(spec.params, resolved.primitive.parameters, warn, { ...readEffectTiming(spec, warn), ...timing })
  const instance = resolved.primitive.prepare!(host, params, {
    doc: document, win: window, warn, style: createStyleLedger(host),
  } as unknown as PrepareContext)
  instances.push(instance)
  const original = host.firstChild
  instance.activate()
  expect(warn).not.toHaveBeenCalled()
  const visual = () => host.querySelector<HTMLElement>('.kui-split-decorative')!
  return { host, instance, visual, original, plan }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  instances.splice(0).forEach(instance => instance.destroy())
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('typewriter scatter exit', () => {
  it('types whole graphemes, holds retained letters, scatters once and clears before the next word', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const { host, visual, instance } = mount("typewriter words:'a👩‍👩‍👧‍👦 é|NEXT' erase:scatter step:10ms interval:20ms")
    const done = vi.fn()
    void instance.finished.then(done)
    vi.advanceTimersByTime(10)
    const first = visual().querySelector('.kui-typewriter-letter')
    expect(first?.textContent).toBe('a')
    vi.advanceTimersByTime(30)
    expect(visual().textContent).toBe('a👩‍👩‍👧‍👦 é')
    expect([...visual().querySelectorAll('.kui-typewriter-letter')].map(node => node.textContent)).toEqual(['a', '👩‍👩‍👧‍👦', 'é'])
    expect(visual().querySelector('.kui-typewriter-letter')).toBe(first)
    expect(visual().querySelectorAll('.kui-split-word')).toHaveLength(2)
    expect(host.querySelector('.kui-sr-only')?.textContent).toBe('Original text')
    expect(visual().getAttribute('aria-hidden')).toBe('true')
    vi.advanceTimersByTime(19)
    expect(visual().dataset.kuiTypewriterPhase).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(visual().dataset.kuiTypewriterPhase).toBe('scatter')
    expect(visual().querySelector('.kui-typewriter-letter')).toBe(first)
    expect(visual().style.getPropertyValue('--kui-scatter-duration')).toBe('400ms')
    vi.advanceTimersByTime(399)
    expect(first?.isConnected).toBe(true)
    vi.advanceTimersByTime(1)
    expect(first?.isConnected).toBe(false)
    expect(visual().textContent).toBe('')
    expect(visual().dataset.kuiTypewriterPhase).toBeUndefined()
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('N')
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    expect(rect).not.toHaveBeenCalled()
  })

  it.each([5, 15, 30, 100, 445])('finishes during typing, hold, scatter or the next-word gap at %sms, then restores exact nodes and replays', async time => {
    const { host, visual, instance, original } = mount("typewriter words:'ab|c' erase:scatter step:10ms interval:20ms")
    vi.advanceTimersByTime(time)
    instance.finish()
    await instance.finished
    const expected = time === 445 ? 'c' : 'ab'
    expect(visual().textContent).toBe(expected)
    expect(visual().dataset.kuiTypewriterPhase).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(visual().textContent).toBe(expected)
    instance.destroy()
    expect(host.firstChild).toBe(original)
    expect(host.innerHTML).toBe('<em>Original text</em>')
    instance.activate()
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('a')
    instance.destroy()
    vi.advanceTimersByTime(1000)
    expect(host.firstChild).toBe(original)
  })

  it.each([5, 25, 100])('tears down during each phase at %sms without leaving a timer or letter', time => {
    const { host, instance, original } = mount("typewriter words:'ab|c' erase:scatter step:10ms interval:20ms")
    vi.advanceTimersByTime(time)
    instance.destroy()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(host.firstChild).toBe(original)
    expect(host.querySelector('.kui-typewriter-letter')).toBeNull()
  })

  it('loops original text, permits empty text, clamps zero steps and respects trigger delay', () => {
    const looping = mount('typewriter erase:scatter loop:true step:0ms interval:0ms delay:20ms', 'A')
    vi.advanceTimersByTime(20)
    expect(looping.visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(looping.visual().textContent).toBe('A')
    vi.advanceTimersByTime(1)
    expect(looping.visual().dataset.kuiTypewriterPhase).toBe('scatter')
    vi.advanceTimersByTime(401)
    expect(looping.visual().textContent).toBe('A')
    looping.instance.destroy()
    const empty = mount('typewriter erase:scatter step:1ms', '')
    vi.advanceTimersByTime(1)
    expect(empty.visual().textContent).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honours the timing delay before scatter typing ahead of a named delay', () => {
    const { visual } = mount('typewriter erase:scatter step:10ms delay:100ms', 'AB', { delayMs: 20 })
    vi.advanceTimersByTime(29)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('A')
  })

  it('spreads a positional total duration across the scatter word before completing', async () => {
    const { visual, instance } = mount('typewriter erase:scatter 1s', 'ABCD')
    const finished = vi.fn()
    void instance.finished.then(finished)
    vi.advanceTimersByTime(249)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('A')
    vi.advanceTimersByTime(749)
    expect(visual().textContent).toBe('ABC')
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await instance.finished
    expect(visual().textContent).toBe('ABCD')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends non-looping text fully typed, gives plain deletion its old DOM and claims, and adds only opt-in channels', async () => {
    const scattered = mount('typewriter erase:scatter step:10ms', 'AB')
    vi.advanceTimersByTime(20)
    await scattered.instance.finished
    expect(scattered.visual().textContent).toBe('AB')
    expect(scattered.visual().dataset.kuiTypewriterPhase).toBeUndefined()
    const plain = mount("typewriter words:'ab|c' step:10ms interval:0ms")
    vi.advanceTimersByTime(30)
    expect(plain.visual().textContent).toBe('a')
    expect(plain.visual().querySelector('.kui-typewriter-letter')).toBeNull()
    expect(plain.visual().style.cssText).not.toContain('scatter')
    expect(plain.plan.vars).not.toHaveProperty('--kui-typewriter-erase')
    expect(plain.plan.channels).not.toContain('translate')
    expect(scattered.plan.channels).toContain('translate')
    expect(compile(parse('typewriter, fade-up'), registry, 'time').warnings).toEqual([])
    expect(compile(parse('typewriter erase:scatter, draw-stroke'), registry, 'time').warnings).toEqual([])
  })

  it('compiles and prepares every example through the real animator with zero reporter warnings', () => {
    const reporter = collectingReporter()
    const animator = build(examples.map(source => `<p data-kui="${source}">TEN</p>`).join(''), reporter)
    animator.start()
    expect(reporter.messages).toEqual([])
    animator.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves reduced-motion text unsplit and keeps scatter CSS finite and scoped', () => {
    document.body.innerHTML = '<p data-kui="typewriter erase:scatter rhythm:natural on:load">TEN</p>'
    const host = document.querySelector('p')!
    const original = host.firstChild
    const animator = new Animator({
      root: document.body, registry, capabilities: { ...CAPS, reducedMotion: true },
      binder: createActivationBinder({ createObserver: undefined }), scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
    })
    animator.start()
    expect(host.firstChild).toBe(original)
    expect(host.querySelector('.kui-typewriter-letter')).toBeNull()
    animator.destroy()
    const css = readFileSync('src/css/text.css', 'utf8')
    expect(css).toContain(".kui-typewriter[data-kui-typewriter-phase='scatter'] .kui-typewriter-letter")
    expect(css).toContain('animation: kui-typewriter-scatter var(--kui-scatter-duration) ease-in both;')
    expect(css).toContain('rotate: var(--kui-scatter-rotate);')
    expect(css).toContain("[data-kui-typewriter-phase='scatter']::after { visibility: hidden; }")
  })
})

describe('natural typing rhythm', () => {
  it('varies bounded grapheme delays and pauses after punctuation without starting an interval', async () => {
    const interval = vi.spyOn(window, 'setInterval')
    const timeout = vi.spyOn(window, 'setTimeout')
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const { visual, instance } = mount('typewriter rhythm:natural step:100ms', 'a,b.c!')
    vi.advanceTimersByTime(74)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('a')
    vi.advanceTimersByTime(98)
    expect(visual().textContent).toBe('a')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('a,')
    vi.advanceTimersByTime(179)
    expect(visual().textContent).toBe('a,')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('a,b')
    vi.advanceTimersByTime(87)
    expect(visual().textContent).toBe('a,b.')
    vi.advanceTimersByTime(299)
    expect(visual().textContent).toBe('a,b.')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('a,b.c')
    vi.advanceTimersByTime(75)
    expect(visual().textContent).toBe('a,b.c!')
    await instance.finished
    expect(interval).not.toHaveBeenCalled()
    expect(timeout.mock.calls.map(call => call[1])).toEqual([0, 75, 99, 180, 87, 300, 75])
    expect(rect).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps deletion and word holds on their original step timing', () => {
    const { visual } = mount("typewriter rhythm:natural words:'AB|X' step:100ms interval:50ms")
    vi.advanceTimersByTime(174)
    expect(visual().textContent).toBe('AB')
    vi.advanceTimersByTime(199)
    expect(visual().textContent).toBe('AB')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('A')
    vi.advanceTimersByTime(100)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(74)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(visual().textContent).toBe('X')
  })

  it.each([0, 50, 200, 400])('cancels its sole pending timeout and restores nodes at %sms', async time => {
    const { instance, visual, host, original } = mount("typewriter rhythm:natural words:'ABC|D' step:100ms interval:50ms delay:20ms")
    vi.advanceTimersByTime(time)
    expect(vi.getTimerCount()).toBe(1)
    instance.finish()
    await instance.finished
    expect(visual().textContent).toBe('ABC')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(visual().textContent).toBe('ABC')
    instance.destroy()
    expect(host.firstChild).toBe(original)
    instance.activate()
    expect(vi.getTimerCount()).toBe(1)
    instance.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports natural pacing with scatter, including the next word', () => {
    const { visual } = mount("typewriter words:'A!|B' erase:scatter rhythm:natural step:100ms interval:20ms")
    vi.advanceTimersByTime(75)
    expect(visual().textContent).toBe('A')
    vi.advanceTimersByTime(99)
    expect(visual().textContent).toBe('A!')
    vi.advanceTimersByTime(20)
    expect(visual().dataset.kuiTypewriterPhase).toBe('scatter')
    vi.advanceTimersByTime(400)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(75)
    expect(visual().textContent).toBe('B')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('bounds zero steps, completes empty text, and keeps fixed typing and scramble on intervals', async () => {
    const timeout = vi.spyOn(window, 'setTimeout')
    const zero = mount('typewriter rhythm:natural step:0ms', 'A.,B')
    vi.advanceTimersByTime(4)
    await zero.instance.finished
    expect(zero.visual().textContent).toBe('A.,B')
    const [start, ...delays] = timeout.mock.calls.map(call => call[1])
    expect(start).toBe(0)
    expect(delays).toHaveLength(4)
    expect(delays.every(delay => delay !== undefined && delay >= 1)).toBe(true)
    const empty = mount('typewriter rhythm:natural step:1ms', '')
    vi.advanceTimersByTime(1)
    await empty.instance.finished
    expect(vi.getTimerCount()).toBe(0)
    const interval = vi.spyOn(window, 'setInterval')
    const plain = mount('typewriter step:100ms', 'AB')
    vi.advanceTimersByTime(99)
    expect(plain.visual().textContent).toBe('')
    vi.advanceTimersByTime(1)
    expect(plain.visual().textContent).toBe('A')
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(plain.plan.vars).not.toHaveProperty('--kui-typewriter-rhythm')
    plain.instance.destroy()
    interval.mockClear()
    mount('scramble step:100ms', 'AB')
    vi.advanceTimersByTime(0)
    expect(interval).toHaveBeenCalledOnce()
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 100)
  })
})
