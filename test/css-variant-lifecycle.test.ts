// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  ['cube-rotate parts:cube', '<div></div>'.repeat(6)],
  ["motion-path viewbox:'0 0 100 100'", ''],
  ['wobble direction:pointer', ''],
])('keeps the CSS playhead controllable and paired exits silent with %s preparation', (source, children) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const reporter = collectingReporter()
  const animator = build(`<div data-kui="${source}" data-kui-on="pointerenter/pointerleave">${children}</div>`, reporter)
  const node = el()
  const animation = { animationName: source.startsWith('cube') ? 'kui-cube-rotate' : 'kui-motion-travel',
    playState: 'paused', playbackRate: 1, currentTime: 0, finished: new Promise(() => {}),
    effect: { getComputedTiming: () => ({ endTime: 1000 }) }, play: vi.fn(), cancel: vi.fn() }
  if (source.startsWith('wobble')) animation.animationName = 'kui-wobble'
  Object.defineProperty(node, 'getAnimations', { value: () => [animation] })
  animator.start()
  const control = animator.control(node)
  expect(control.uncontrolled).toEqual([])
  control.pause()
  expect(node.style.animationPlayState).toBe('paused')
  control.seek(0.5)
  expect(animation.currentTime).toBe(500)
  node.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: 0, clientY: 0, pointerType: 'mouse' }))
  node.dispatchEvent(new Event('pointerleave'))
  expect(animation.playbackRate).toBe(-1)
  node.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: 0, clientY: 0, pointerType: 'mouse' }))
  expect(animation.playbackRate).toBe(1)
  expect(reporter.messages).toEqual([])
  animator.destroy()
})

it('still warns that generated confetti pieces cannot reverse on a paired exit', () => {
  const reporter = collectingReporter()
  const animator = build('<button data-kui="confetti-burst pieces:5" data-kui-on="pointerenter/pointerleave">Celebrate</button>', reporter).start()
  el().dispatchEvent(new Event('pointerenter'))
  el().dispatchEvent(new Event('pointerleave'))
  expect(reporter.messages).toEqual([expect.stringContaining('cannot play backwards')])
  animator.destroy()
})
