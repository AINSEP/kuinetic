// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { prepareConfetti } from '../src/effects/catalog/confetti.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

afterEach(() => {
  delete (Element.prototype as any).getAnimations
  vi.restoreAllMocks()
})

it('creates no generated particles under reduced motion', () => {
  const node = document.createElement('button')
  const instance = prepareConfetti(node, createParams({ pieces: '48' }), { reducedMotion: true } as PrepareContext)
  instance.activate()
  expect(node.childElementCount).toBe(0)
  expect(node.hasAttribute('data-kui-confetti-pieces')).toBe(false)
  instance.destroy()
})

it('owns bounded child playback, continues after release, replays and removes decoration on destroy', async () => {
  const runs = new Map<Element, any>()
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value(this: Element) {
      if (!this.hasAttribute('data-kui-confetti-piece')) return []
      if (!runs.has(this)) {
        let done!: () => void
        const finished = new Promise<void>((resolve) => { done = resolve })
        runs.set(this, { animationName: 'kui-confetti-piece', playState: 'running', finished,
          cancel: vi.fn(done), finish: vi.fn(done), reverse: vi.fn(), play: vi.fn() })
      }
      return [runs.get(this)]
    },
  })
  const animator = build('<button data-kui="confetti-burst pieces:5 1200ms 100ms ease:linear on:click">Celebrate</button>').start()
  const node = el()
  const pieces = () => [...node.querySelectorAll<HTMLElement>('[data-kui-confetti-piece]')]
  expect(pieces()).toHaveLength(5)
  expect(pieces()[0]!.style.animationDuration).toBe('1200ms')
  expect(Number.parseFloat(pieces()[0]!.style.animationDelay)).toBeGreaterThanOrEqual(100)
  expect(Number.parseFloat(pieces()[0]!.style.animationDelay)).toBeLessThan(244)
  expect(pieces()[0]!.style.background).toBe('var(--kui-confetti-c1, var(--kui-c1, var(--accent, currentColor)))')
  expect(pieces().every((p) => p.inert && p.getAttribute('aria-hidden') === 'true')).toBe(true)
  node.click()
  expect(pieces().every((p) => p.style.display === 'block')).toBe(true)
  node.dispatchEvent(new Event('pointerup'))
  expect(pieces().every((p) => p.style.display === 'block')).toBe(true)
  for (const run of runs.values()) run.finish()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(pieces().every((p) => p.style.display === 'none')).toBe(true)
  node.click()
  expect(pieces()).toHaveLength(5)
  expect(pieces().every((p) => p.style.display === 'block')).toBe(true)
  node.click()
  expect(pieces()).toHaveLength(5)
  animator.destroy()
  expect(node.textContent).toBe('Celebrate')
  expect(pieces()).toHaveLength(0)
  expect(node.hasAttribute('data-kui-confetti-pieces')).toBe(false)
})

it('keeps the default burst and target relocation unchanged and bounds opted-in count', () => {
  const registry = catalogRegistry()
  expect(compile(parse('confetti-burst'), registry, 'time').jsEffects).toHaveLength(0)
  expect(compile(parse('confetti-burst pieces:0'), registry, 'time').jsEffects).toHaveLength(0)
  expect(compile(parse('confetti-burst target:button'), registry, 'time').warnings).toEqual([])
  expect(compile(parse('confetti-burst pieces:1000'), registry, 'time').warnings.join()).toContain('96')
  const animator = build('<button data-kui="confetti-burst pieces:96">Go</button>').start()
  expect(el().querySelectorAll('[data-kui-confetti-piece]')).toHaveLength(96)
  animator.destroy()
})

it.each(['0.4', '1.5'])('rejects fractional pieces:%s and preserves the default burst', (pieces) => {
  const reporter = collectingReporter()
  const animator = build(`<button data-kui="confetti-burst pieces:${pieces}">Celebrate</button>`, reporter).start()
  expect(reporter.messages).toEqual([expect.stringContaining('expected an integer')])
  expect(el().hasAttribute('data-kui-confetti-pieces')).toBe(false)
  expect(el().childElementCount).toBe(0)
  animator.destroy()
})

it.each(['3', 'infinite'])('warns when repeat:%s cannot repeat the pieces', (repeat) => {
  const plan = compile(parse(`confetti-burst pieces:5 repeat:${repeat}`), catalogRegistry(), 'time')
  expect(plan.warnings).toEqual([expect.stringContaining('pieces play once')])
  expect(compile(parse(`confetti-burst repeat:${repeat}`), catalogRegistry(), 'time').warnings).toEqual([])
})

it('scatters small dots and thin strips across independently hashed trajectories and delays', () => {
  const animator = build('<button data-kui="confetti-burst pieces:48">Celebrate</button>').start()
  const pieces = [...el().querySelectorAll<HTMLElement>('[data-kui-confetti-piece]')]
  const rise = pieces.map((p) => -Number.parseFloat(p.style.getPropertyValue('--kui-piece-rise')))
  expect(Math.min(...rise)).toBeGreaterThanOrEqual(40)
  expect(Math.max(...rise)).toBeLessThan(240)
  expect(Math.max(...rise) - Math.min(...rise)).toBeGreaterThan(160)
  const xs = pieces.map((p) => Number.parseFloat(p.style.getPropertyValue('--kui-piece-x')))
  expect(new Set(xs.slice(1).map((x, i) => Math.round(x - xs[i]!))).size).toBeGreaterThan(20)
  expect(new Set(pieces.map((p) => p.style.animationDelay)).size).toBe(48)
  expect(new Set(pieces.map((p) => p.style.getPropertyValue('--kui-piece-turn'))).size).toBe(48)
  expect(pieces[0]!.style.height).toBe('calc(var(--kui-confetti-size, 6px) / 2)')
  expect(pieces[1]!.style.height).toBe('calc(var(--kui-confetti-size, 6px) * 2)')
  animator.destroy()
})

it('settles explicit finish and cancellation even without browser animation handles', async () => {
  const node = document.createElement('button')
  const instance = prepareConfetti(node, createParams({ pieces: '3', ease: 'linear' }), {
    doc: document, win: window, reducedMotion: false,
  } as unknown as PrepareContext)
  instance.activate()
  instance.finish()
  await instance.finished
  expect([...node.children].every((piece) => (piece as HTMLElement).style.display === 'none')).toBe(true)
  instance.cancel()
  instance.destroy()
  expect(node.childElementCount).toBe(0)
})
