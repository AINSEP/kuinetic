// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { TIME_SCALE_ATTR } from '../src/core/time-scale.js'
import { SLOW_MO_PRESETS } from '../src/showcase/slow-mo.js'
import { build, el } from './support/js-effect-harness.js'

// jsdom has no `document.timeline`, so a mock with no `timeline` field is on the document timeline.
function motion(rate: number, field: string, name: string, on?: { target: Element; pseudoElement?: string }): Animation {
  const effect = on ? { target: on.target, pseudoElement: on.pseudoElement ?? null } : null
  return { playbackRate: rate, [field]: name, effect } as unknown as Animation
}

function event(type: string, field: string, name: string, pseudoElement = ''): Event {
  // CSS start/run events do not bubble; a host sees descendants only with capture listeners.
  const result = new Event(type, { bubbles: false })
  Object.defineProperty(result, field, { value: name })
  Object.defineProperty(result, 'pseudoElement', { value: pseudoElement })
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

  it('reads an event that carries no pseudoElement as one on the element itself', () => {
    const animator = build('<section data-kui="slow-mo"><div></div></section>')
    const host = el()
    const child = host.querySelector('div')!
    host.getAnimations = vi.fn(() => [])
    const named = motion(1, 'animationName', 'fade', { target: child })
    const pseudo = motion(1, 'animationName', 'fade', { target: child, pseudoElement: '::before' })
    child.getAnimations = vi.fn(() => [named, pseudo])
    animator.start()
    host.querySelector('button')!.click()

    const bare = new Event('animationstart', { bubbles: false })
    Object.defineProperty(bare, 'animationName', { value: 'fade' })
    child.dispatchEvent(bare)

    expect(named.playbackRate).toBe(0.25)
    expect(pseudo.playbackRate).toBe(1)
  })

  it('scales only the new CSS animation or transition named by a captured event', () => {
    const animator = build('<section data-kui="slow-mo"><div></div></section>')
    const host = el()
    const child = host.querySelector('div')!
    host.getAnimations = vi.fn(() => [])
    const named = motion(-1, 'animationName', 'fade', { target: child })
    const other = motion(1, 'animationName', 'pulse', { target: child })
    child.getAnimations = vi.fn(() => [named, other])
    animator.start()
    const button = host.querySelector('button')!
    button.click()

    child.dispatchEvent(event('animationstart', 'animationName', 'fade'))
    expect(named.playbackRate).toBe(-0.25)
    expect(other.playbackRate).toBe(1)

    const opacity = motion(1, 'transitionProperty', 'opacity', { target: child })
    const transform = motion(1, 'transitionProperty', 'transform', { target: child })
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

  it('leaves scroll- and view-timeline animations at their own rate', () => {
    const animator = build('<section data-kui="slow-mo"><div></div></section>')
    const host = el()
    const child = host.querySelector('div')!
    const scrollDriven = { ...motion(1, 'animationName', 'progress', { target: child }), timeline: {} } as unknown as Animation
    const timed = motion(1, 'animationName', 'fade', { target: child })
    host.getAnimations = vi.fn(() => [scrollDriven, timed])
    animator.start()
    host.querySelector('button')!.click()
    expect([scrollDriven.playbackRate, timed.playbackRate]).toEqual([1, 0.25])

    const lateScroll = { ...motion(1, 'animationName', 'grow', { target: child }), timeline: {} } as unknown as Animation
    child.getAnimations = vi.fn(() => [lateScroll])
    child.dispatchEvent(event('animationstart', 'animationName', 'grow'))
    expect(lateScroll.playbackRate).toBe(1)
    animator.destroy()
  })

  it('hands back each prior rate, and only for animations it rescaled', () => {
    const animator = build('<section data-kui="slow-mo rate:0.25"><div></div></section>')
    const host = el()
    const overridden = motion(2, 'animationName', 'a')
    const flipped = motion(1, 'animationName', 'b')
    const overriddenWhileSlowed = motion(1, 'animationName', 'c')
    host.getAnimations = vi.fn(() => [overridden, flipped, overriddenWhileSlowed])
    animator.start()
    const button = host.querySelector('button')!
    button.click()
    expect([overridden.playbackRate, flipped.playbackRate, overriddenWhileSlowed.playbackRate]).toEqual([0.25, 0.25, 0.25])

    flipped.playbackRate = -0.25 // hover-out drive(-1) while slowed
    overriddenWhileSlowed.playbackRate = 3 // control(el).timeScale(3) while slowed
    const untouched = motion(0.5, 'animationName', 'd') // appeared after slow-mo rescaled
    host.getAnimations = vi.fn(() => [overridden, flipped, overriddenWhileSlowed, untouched])
    button.click()
    expect([overridden.playbackRate, flipped.playbackRate, overriddenWhileSlowed.playbackRate, untouched.playbackRate])
      .toEqual([2, -1, 3, 0.5])

    overridden.playbackRate = 1.5
    button.click()
    expect(overridden.playbackRate).toBe(0.25)
    animator.destroy()
    expect([overridden.playbackRate, untouched.playbackRate]).toEqual([1.5, 0.5])
  })

  it('rescales a pseudo-element animation named by the event, and only that one', () => {
    const animator = build('<section data-kui="slow-mo"><div><span></span></div></section>')
    const host = el()
    const child = host.querySelector('div')!
    const grandchild = host.querySelector('span')!
    host.getAnimations = vi.fn(() => [])
    const before = motion(1, 'animationName', 'fade', { target: child, pseudoElement: '::before' })
    const own = motion(1, 'animationName', 'fade', { target: child })
    const nested = motion(1, 'animationName', 'fade', { target: grandchild })
    const getAnimations = vi.fn(() => [before, own, nested])
    child.getAnimations = getAnimations
    animator.start()
    host.querySelector('button')!.click()

    child.dispatchEvent(event('animationstart', 'animationName', 'fade', '::before'))
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true })
    expect([before.playbackRate, own.playbackRate, nested.playbackRate]).toEqual([0.25, 1, 1])

    child.dispatchEvent(event('animationstart', 'animationName', 'fade'))
    expect([before.playbackRate, own.playbackRate, nested.playbackRate]).toEqual([0.25, 0.25, 1])
    animator.destroy()
  })

})
