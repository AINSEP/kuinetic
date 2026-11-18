// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { PAUSE_SCOPE_ATTR, PAUSE_SCOPE_EVENT, isPausedByScope } from '../src/core/pause-scope.js'
import { build, el } from './support/js-effect-harness.js'

function script(state: { playState: string }): Animation {
  const animation = {
    playState: state.playState,
    pause: vi.fn(() => {
      animation.playState = 'paused'
    }),
    play: vi.fn(() => {
      animation.playState = 'running'
    }),
  }
  return animation as unknown as Animation
}

const css = (): Animation => ({ playState: 'running', animationName: 'fade', pause: vi.fn(), play: vi.fn() }) as unknown as Animation

describe('pause-scope', () => {
  it('toggles the marker, aria-pressed and the event, and holds only script animations', () => {
    const animator = build(
      '<section data-kui="pause-scope pause:.stop"><div class="child"></div><button class="stop">Pause</button></section>',
    )
    const host = el()
    const scripted = script({ playState: 'running' })
    const alreadyPaused = script({ playState: 'paused' })
    const stylesheet = css()
    host.getAnimations = vi.fn(() => [scripted, alreadyPaused, stylesheet])
    const heard = vi.fn()
    document.addEventListener(PAUSE_SCOPE_EVENT, heard)
    animator.start()

    const button = host.querySelector('.stop') as HTMLButtonElement
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(false)

    button.click()
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(true)
    expect(isPausedByScope(host.querySelector('.child')!)).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(scripted.pause).toHaveBeenCalledTimes(1)
    expect(alreadyPaused.pause).not.toHaveBeenCalled()
    expect(stylesheet.pause).not.toHaveBeenCalled()
    expect(heard).toHaveBeenCalledTimes(1)

    button.click()
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(scripted.play).toHaveBeenCalledTimes(1)
    expect(alreadyPaused.play).not.toHaveBeenCalled()
    expect(heard).toHaveBeenCalledTimes(2)

    document.removeEventListener(PAUSE_SCOPE_EVENT, heard)
    animator.destroy()
  })

  it('reaches a page-level control and starts paused on paused:true', () => {
    const animator = build(
      '<button class="outside">Pause</button><section data-kui="pause-scope pause:.outside paused:true"></section>',
    )
    animator.start()
    const host = el()
    const button = document.querySelector('.outside') as HTMLButtonElement
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.click()
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(false)
    animator.destroy()
  })

  it('teardown resumes held animations, restores the marker and the control, and announces', () => {
    const animator = build('<section data-kui="pause-scope pause:.stop"><button class="stop">Pause</button></section>')
    const host = el()
    const scripted = script({ playState: 'running' })
    host.getAnimations = vi.fn(() => [scripted])
    animator.start()
    const button = host.querySelector('.stop') as HTMLButtonElement
    button.click()
    const heard = vi.fn()
    document.addEventListener(PAUSE_SCOPE_EVENT, heard)

    animator.destroy()
    expect(host.hasAttribute(PAUSE_SCOPE_ATTR)).toBe(false)
    expect(button.hasAttribute('aria-pressed')).toBe(false)
    expect(scripted.play).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledTimes(1)
    document.removeEventListener(PAUSE_SCOPE_EVENT, heard)
  })
})
