// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { EASING_KEYWORDS } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'

afterEach(() => vi.restoreAllMocks())

it.each(['bounce-out', 'bonce-out', 'BACK-OUT'])('warns at install for an undefined named ease:%s without discarding it', (name) => {
  const reporter = collectingReporter()
  const animator = build(`<div data-kui="fade-up ease:${name} on:manual"></div>`, reporter).start()
  expect(el().style.getPropertyValue('--kui-reveal-ease')).toBe(`var(--kui-ease-${name}, ease-out)`)
  expect(reporter.messages).toEqual([`easing "${name}" has no --kui-ease-${name} definition — using ease-out`])
  animator.destroy()
})

it('preserves an author-defined curve through the real parser and the cascade', () => {
  const reporter = collectingReporter()
  const animator = build('<div style="--kui-ease-swift-out:cubic-bezier(.1,.2,.3,.9)" data-kui="fade-up ease:swift-out on:manual"></div>', reporter).start()
  expect(reporter.messages).toEqual([])
  expect(el().style.getPropertyValue('--kui-reveal-ease')).toBe('var(--kui-ease-swift-out, ease-out)')
  animator.destroy()
})

it('does no easing style reads for shipped names or literal functions', () => {
  const computed = vi.spyOn(window, 'getComputedStyle')
  for (const name of [...EASING_KEYWORDS, 'cubic-bezier(.2,0,.4,1)', 'steps(4)', 'linear(0,1)', 'spring(bounce:0.5)']) {
    const reporter = collectingReporter()
    const animator = build(`<div data-kui="fade-up ease:${name} on:manual"></div>`, reporter).start()
    expect(reporter.messages, name).toEqual([])
    animator.destroy()
  }
  expect(computed).not.toHaveBeenCalled()
})

it('checks each distinct authored name once on an installed host', () => {
  const computed = vi.spyOn(window, 'getComputedStyle')
  const reporter = collectingReporter()
  const animator = build('<div data-kui="wobble ease:swift-out on:manual, tween opacity:0.5 ease:swift-out on:manual"></div>', reporter).start()
  expect(reporter.messages).toHaveLength(1)
  expect(computed).toHaveBeenCalledOnce()
  animator.destroy()
})
