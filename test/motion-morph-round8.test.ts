// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createParams } from '../src/core/js-params.js'
import { createJsEffectPreparer } from '../src/core/js-effect-preparer.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { collectingReporter } from '../src/core/reporter.js'
import { createMorph } from '../src/core/path-morph.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { SVG_PRIMITIVES } from '../src/effects/svg/index.js'
import { catalogRegistry } from './support/registry.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'

const STAR = 'M50 5L61 35L95 35L68 56L79 90L50 69L21 90L32 56L5 35L39 35Z'
const HEART = 'M50 90C-10 45 10 0 50 30C90 0 110 45 50 90Z'
const LIGHTNING = 'M30 5H80L55 42H80L25 95L42 55H20Z'
const PLANE = 'M50 5L55 45L95 65V75L55 60V85L65 90V95L50 90L35 95V90L45 85V60L5 75V65L45 45Z'
const HAND = 'M10 60L30 90H75V30H65V50H60V15H50V45H45V5H35V50H30V20H20V65Z'
const SHAPES = [STAR, HEART, LIGHTNING, PLANE]
const COLORS = 'var(--accent)|var(--accent-ink)'
const EXAMPLES = [
  `icon-morph loop:true to:'${HEART}' colors:'${COLORS}' 900ms ease:ease-in-out`,
  `icon-morph loop:true to:'${HAND}|${PLANE}|${HEART}' colors:'var(--accent)|var(--accent-ink)|var(--accent)|var(--accent-ink)' 700ms ease:ease-in-out`,
]
const primitive = SVG_PRIMITIVES.find((entry) => entry.id === 'path-morph')!
const registry = catalogRegistry()

function clock() {
  let now = 0
  let sequence = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++sequence, callback)
    return sequence
  })
  const cancel = vi.fn((id: number) => pending.delete(id))
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    cancel, pending,
    tick(time: number) {
      now = time
      const due = [...pending.values()]
      pending.clear()
      due.forEach((callback) => callback(time))
    },
    time(time: number) { now = time },
  }
}

function setup(values: Record<string, string> = {}, reducedMotion = false) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', STAR)
  const warn = vi.fn()
  const ledger = createStyleLedger(path)
  const ctx = { doc: document, win: window, reducedMotion, warn, style: ledger } as unknown as PrepareContext
  const params = createParams({ loop: 'true', to: HEART, duration: '100ms', ...values })
  return { path, warn, start: () => {
    const instance = primitive.prepare!(path, params, ctx)
    instance.activate()
    return instance
  } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Motion batch 21', () => {
  it('compiles exact demo/report markup without reporter warnings and claims fill only with loop colors', () => {
    const frames = clock()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const reporter = collectingReporter()
    const preparer = createJsEffectPreparer({ capabilities: CAPS, reporter, respectReducedMotion: true,
      scheduler: idleScheduler, rootResolver: () => fakeRoot })
    for (const source of EXAMPLES) {
      const plan = compile(parse(source), registry, 'time')
      expect(plan.warnings).toEqual([])
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', STAR)
      const instances = preparer.prepare({ el: path, plan, signal: new AbortController().signal, ledger: createStyleLedger(path) })
      instances.forEach((instance) => instance.activate())
      frames.tick(100)
      expect(reporter.messages).toEqual([])
      instances.forEach((instance) => instance.destroy())
      expect(compile(parse(`${source}, draw-stroke`), registry, 'time').warnings.join()).toContain('stroke')
    }
    const legacy = `icon-morph to:'${HEART}', draw-stroke`
    expect(compile(parse(legacy), registry, 'time').warnings).toEqual([])
    expect(compile(parse(`icon-morph to:'${HEART}'`), registry, 'time').vars).not.toHaveProperty('--kui-path-loop')
    expect(compile(parse(`icon-morph loop:true to:'${HEART}', draw-stroke`), registry, 'time').warnings).toEqual([])
  })

  it('loops through four unlike outlines and back to the first, ignoring pointer/focus input', () => {
    const frames = clock()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const { path, start } = setup({ to: SHAPES.slice(1).join('|') })
    const instance = start()
    expect(instance.continuous).toBe(true)
    for (let index = 0; index < SHAPES.length; index++) {
      const next = (index + 1) % SHAPES.length
      frames.tick(index * 100 + 50)
      expect(path.getAttribute('d')).toBe(createMorph(SHAPES[index]!, SHAPES[next]!).morph!.at(0.5))
    }
    path.dispatchEvent(new Event('pointerenter'))
    path.dispatchEvent(new Event('focusin'))
    path.dispatchEvent(new Event('pointerleave'))
    path.dispatchEvent(new Event('focusout'))
    frames.tick(400)
    expect(path.getAttribute('d')).toBe(createMorph(STAR, HEART).morph!.at(0))
    instance.destroy()
    expect(path.getAttribute('d')).toBe(STAR)
    expect(frames.pending.size).toBe(0)
  })

  it('seeks a paused native fill animation alongside the delayed shape and cancels it on teardown', () => {
    const frames = clock()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const { path, start } = setup({ colors: COLORS, delay: '50ms', ease: 'ease-in' })
    path.style.setProperty('fill', 'currentColor', 'important')
    const color = { currentTime: null, pause: vi.fn(), cancel: vi.fn() } as unknown as Animation
    path.animate = vi.fn(() => color)
    const instance = start()
    expect(path.animate).toHaveBeenCalledWith([
      { fill: 'var(--accent)' }, { fill: 'var(--accent-ink)' }, { fill: 'var(--accent)' },
    ], { duration: 2, fill: 'both' })
    expect(color.pause).toHaveBeenCalledOnce()
    frames.tick(25)
    expect(path.getAttribute('d')).toBe(STAR)
    expect(color.currentTime).toBe(0)
    frames.tick(100)
    expect(Number(color.currentTime)).toBeGreaterThan(0)
    expect(Number(color.currentTime)).toBeLessThan(0.5)
    const at = Number(color.currentTime)
    expect(path.getAttribute('d')).toBe(createMorph(STAR, HEART).morph!.at(at))
    frames.tick(175)
    expect(Number(color.currentTime)).toBeGreaterThan(1)
    instance.destroy()
    expect(color.cancel).toHaveBeenCalledOnce()
    expect(path.style.getPropertyValue('fill')).toBe('currentColor')
    expect(path.style.getPropertyPriority('fill')).toBe('important')
  })

  it('cancels frames in a hidden tab, resumes at its paused phase, and cannot resurrect after teardown', () => {
    const frames = clock()
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const { path, start } = setup()
    const instance = start()
    expect(frames.pending.size).toBe(0)
    frames.time(1000)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    frames.tick(1025)
    const paused = path.getAttribute('d')
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.pending.size).toBe(0)
    expect(path.getAttribute('d')).toBe(paused)
    frames.time(5000)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    frames.tick(5025)
    expect(path.getAttribute('d')).toBe(createMorph(STAR, HEART).morph!.at(0.5))
    instance.destroy()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(path.getAttribute('d')).toBe(STAR)
    expect(frames.pending.size).toBe(0)
    instance.activate() // replay gets fresh geometry and a fresh visibility subscription
    frames.tick(5050)
    expect(path.getAttribute('d')).not.toBe(STAR)
    instance.destroy()
  })

  it('keeps reduced-motion and zero-duration replays static after an enabled loop', () => {
    const frames = clock()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const enabled = setup().start()
    expect(frames.pending.size).toBe(1)
    enabled.destroy()
    for (const { reduced, duration } of [{ reduced: true, duration: '100ms' }, { reduced: false, duration: '0ms' }]) {
      const { path, start, warn } = setup({ duration }, reduced)
      const instance = start()
      expect(frames.pending.size).toBe(0)
      expect(path.getAttribute('d')).toBe(STAR)
      expect(warn).not.toHaveBeenCalled()
      instance.destroy()
    }
  })

  it('warns once and starts no frames for invalid chain/color input', () => {
    const frames = clock()
    for (const params of [
      { to: `${HEART}|M0 0A10 10 0 0 0 20 20`, colors: '' },
      { to: HEART, colors: 'var(--accent)' },
      { to: '', colors: '' },
    ]) {
      const { path, start, warn } = setup(params)
      const instance = start()
      expect(warn).toHaveBeenCalledOnce()
      expect(frames.pending.size).toBe(0)
      expect(path.getAttribute('d')).toBe(STAR)
      instance.destroy()
    }
    const missing = setup()
    missing.path.removeAttribute('d')
    const instance = missing.start()
    expect(missing.warn).toHaveBeenCalledOnce()
    expect(frames.pending.size).toBe(0)
    instance.destroy()
  })

  it('loops geometry without WAAPI and honors explicit from and the nearest time scale', () => {
    const frames = clock()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const { path, start } = setup({ from: LIGHTNING, colors: COLORS })
    path.setAttribute('data-kui-time-scale', '0.5')
    const instance = start()
    frames.tick(100)
    expect(path.getAttribute('d')).toBe(createMorph(LIGHTNING, HEART).morph!.at(0.5))
    instance.destroy()
    expect(path.getAttribute('d')).toBe(LIGHTNING)
  })
})
