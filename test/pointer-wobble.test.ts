// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('chooses direction before activation, updates on reentry and restores author styles', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const animator = build('<div data-kui="wobble direction:pointer on:hover" style="--kui-wobble-x:0.25"></div>')
  const node = el()
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 80 } as DOMRect)
  animator.start()
  const seen: string[] = []
  node.addEventListener('pointerenter', () => seen.push(node.style.getPropertyValue('--kui-wobble-x')))
  const enter = (x: number, y: number, pointerType = 'mouse') => {
    node.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: x, clientY: y, pointerType }))
  }
  enter(10, 60)
  expect(seen.at(-1)).toBe('-1')
  expect(node.style.getPropertyValue('--kui-wobble-y')).toBe('0px')
  node.dispatchEvent(new Event('pointerleave'))
  enter(110, 100)
  expect(seen.at(-1)).toBe('1')
  expect(node.style.getPropertyValue('--kui-wobble-y')).toBe('-6px')
  enter(60, 20)
  expect(node.style.getPropertyValue('--kui-wobble-angle')).toBe('1')
  enter(10, 60, 'touch')
  expect(node.getBoundingClientRect).toHaveBeenCalledTimes(3)
  animator.destroy()
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('0.25')
  expect(node.style.getPropertyValue('--kui-wobble-y')).toBe('')
})

it('keeps plain wobble and y compositions free of preparers and pointer writes', () => {
  const registry = catalogRegistry()
  for (const source of ['wobble', 'wobble y:6px on:hover', 'wobble, tween opacity:0.5']) {
    const plan = compile(parse(source), registry, 'time')
    expect(plan.warnings).toEqual([])
    expect(plan.jsEffects).toHaveLength(0)
    expect(plan.vars['--kui-wobble-x']).toBeUndefined()
  }
  expect(compile(parse('wobble direction:pointer on:hover'), registry, 'time').warnings).toEqual([])
})

it('ignores coarse pointers and handles a zero-sized tile without non-finite amplitudes', () => {
  const media = vi.fn(() => ({ matches: false }))
  vi.stubGlobal('matchMedia', media)
  const animator = build('<div data-kui="wobble direction:pointer on:hover"></div>').start()
  const node = el()
  const enter = () => node.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: 0, clientY: 0, pointerType: 'mouse' }))
  enter()
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('')
  media.mockReturnValue({ matches: true })
  enter()
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('0')
  animator.destroy()
})

it('keeps active amplitudes on reentry within 600ms, then accepts a fresh direction after settling', () => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', undefined)
  const animator = build('<div data-kui="wobble direction:pointer on:hover"></div>')
  const node = el()
  const measure = vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect)
  const animation = { animationName: 'consumer-pulse', playState: 'running', finished: new Promise(() => {}), cancel: vi.fn() }
  Object.defineProperty(node, 'getAnimations', { value: () => [animation] })
  animator.start()
  const enter = (x: number) => node.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: x, clientY: 50, pointerType: 'mouse' }))
  enter(0)
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('-1')
  animation.animationName = 'kui-wobble'
  animation.playState = 'running'
  node.dispatchEvent(new Event('pointerleave'))
  vi.advanceTimersByTime(120)
  enter(100)
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('-1')
  expect(measure).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(480)
  animation.playState = 'finished'
  enter(100)
  expect(node.style.getPropertyValue('--kui-wobble-x')).toBe('1')
  expect(measure).toHaveBeenCalledTimes(2)
  animator.destroy()
})
