// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { TIME_SCALE_ATTR } from '../src/core/time-scale.js'
import { SLOW_MO_PRESETS } from '../src/showcase/slow-mo.js'
import { build, el } from './support/js-effect-harness.js'

function motion(rate: number, field: string, name: string): Animation {
  return { playbackRate: rate, [field]: name } as unknown as Animation
}

function event(type: string, field: string, name: string): Event {
  // CSS start/run events do not bubble; a host sees descendants only with capture listeners.
  const result = new Event(type, { bubbles: false })
  Object.defineProperty(result, field, { value: name })
  return result
}

describe('slow-mo', () => {
  it('toggles the marker and rescales existing animations without changing direction', () => {
    const animator = build('<section data-kui="slow-mo rate:0.25"><div></div></section>')
    const host = el()
    const forward = motion(1, 'animationName', 'fade')
    const reverse = motion(-1, 'animationName', 'slide')
    const getAnimations = vi.fn(() => [forward, reverse])
    host.getAnimations = getAnimations
    animator.start()

    const button = host.firstElementChild as HTMLButtonElement
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.className).toBe('kui-slowmo-toggle')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(host.hasAttribute(TIME_SCALE_ATTR)).toBe(false)

    button.click()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.25')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect([forward.playbackRate, reverse.playbackRate]).toEqual([0.25, -0.25])
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true })

    button.click()
    expect(host.hasAttribute(TIME_SCALE_ATTR)).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect([forward.playbackRate, reverse.playbackRate]).toEqual([1, -1])
    button.click()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.25')
    animator.destroy()
    expect(button.isConnected).toBe(false)
    expect(host.hasAttribute(TIME_SCALE_ATTR)).toBe(false)
    expect([forward.playbackRate, reverse.playbackRate]).toEqual([1, -1])
  })

  it('scales only the new CSS animation or transition named by a captured event', () => {
    const animator = build('<section data-kui="slow-mo"><div></div></section>')
    const host = el()
    const child = host.querySelector('div')!
    host.getAnimations = vi.fn(() => [])
    const named = motion(-1, 'animationName', 'fade')
    const other = motion(1, 'animationName', 'pulse')
    child.getAnimations = vi.fn(() => [named, other])
    animator.start()
    const button = host.querySelector('button')!
    button.click()

    child.dispatchEvent(event('animationstart', 'animationName', 'fade'))
    expect(named.playbackRate).toBe(-0.25)
    expect(other.playbackRate).toBe(1)

    const opacity = motion(1, 'transitionProperty', 'opacity')
    const transform = motion(1, 'transitionProperty', 'transform')
    child.getAnimations = vi.fn(() => [opacity, transform])
    child.dispatchEvent(event('transitionrun', 'propertyName', 'opacity'))
    expect(opacity.playbackRate).toBe(0.25)
    expect(transform.playbackRate).toBe(1)

    button.click()
    named.playbackRate = -1
    opacity.playbackRate = 1
    child.getAnimations = vi.fn(() => [named, opacity])
    child.dispatchEvent(event('animationstart', 'animationName', 'fade'))
    child.dispatchEvent(event('transitionrun', 'propertyName', 'opacity'))
    expect([named.playbackRate, opacity.playbackRate]).toEqual([-1, 1])

    button.click()
    animator.destroy()
    named.playbackRate = -1
    opacity.playbackRate = 1
    child.dispatchEvent(event('animationstart', 'animationName', 'fade'))
    child.dispatchEvent(event('transitionrun', 'propertyName', 'opacity'))
    expect([named.playbackRate, opacity.playbackRate]).toEqual([-1, 1])
  })

  it('starts slowed without controls and restores rates and the marker on teardown', () => {
    const animator = build('<section data-kui="slow-mo controls:none rate:0.5"><div></div></section>')
    const host = el()
    const reverse = motion(-1, 'animationName', 'fade')
    host.getAnimations = vi.fn(() => [reverse])
    animator.start()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.5')
    expect(host.querySelector('button')).toBeNull()
    expect(reverse.playbackRate).toBe(-0.5)

    animator.destroy()
    expect(host.hasAttribute(TIME_SCALE_ATTR)).toBe(false)
    expect(reverse.playbackRate).toBe(-1)
    expect(SLOW_MO_PRESETS[0]?.requiresOwnSubtree).toBeUndefined()
  })

  it('restores an authored time-scale marker through the attribute ledger', () => {
    const animator = build(`<section data-kui="slow-mo controls:none rate:0.5" ${TIME_SCALE_ATTR}="0.75"></section>`)
    const host = el()
    host.getAnimations = vi.fn(() => [])
    animator.start()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.5')
    animator.destroy()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.75')
  })

  it('toggles without Web Animations support and treats a paused rate as forward', () => {
    const animator = build('<section data-kui="slow-mo"><div></div></section>')
    const host = el()
    animator.start()
    const button = host.querySelector('button')!
    button.click()
    expect(host.getAttribute(TIME_SCALE_ATTR)).toBe('0.25')
    const paused = motion(0, 'animationName', 'fade')
    host.getAnimations = vi.fn(() => [paused])
    button.click()
    button.click()
    expect(paused.playbackRate).toBe(0.25)
    animator.destroy()
  })

})
