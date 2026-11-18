// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoMotion } from '../src/core/auto-motion.js'
import { PAUSE_SCOPE_ATTR, announcePauseScope } from '../src/core/pause-scope.js'

/**
 * The scheduler's `scopePaused` reason: an ancestor `[data-kui-paused]` (the `pause-scope` control,
 * `core/pause-scope.ts`) stops every clock-driven motion under it, and lifting it re-arms a full
 * period rather than catching up. The reason is independent of the motion's own pause: lifting the
 * scope must not un-pause a motion the visitor paused by itself.
 */

function mount(): { scope: HTMLElement; host: HTMLElement } {
  document.body.innerHTML = '<section id="scope"><div id="host"></div></section>'
  return {
    scope: document.getElementById('scope') as HTMLElement,
    host: document.getElementById('host') as HTMLElement,
  }
}

function start(host: HTMLElement, step: () => void) {
  return createAutoMotion({
    el: host,
    ctx: { win: window, doc: document, reducedMotion: false },
    spinMs: 0,
    autoplayMs: 2000,
    settleMs: 0,
    step,
    onPausedChange: () => {},
  })
}

function setPaused(scope: HTMLElement, host: HTMLElement, paused: boolean): void {
  if (paused) scope.setAttribute(PAUSE_SCOPE_ATTR, '')
  else scope.removeAttribute(PAUSE_SCOPE_ATTR)
  announcePauseScope(document, host)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('createAutoMotion — paused scope', () => {
  it('does not start inside a scope that is already paused', () => {
    const { scope, host } = mount()
    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    const step = vi.fn()
    const motion = start(host, step)
    vi.advanceTimersByTime(10_000)
    expect(step).not.toHaveBeenCalled()
    motion.release()
  })

  it('stops a pending step when the scope pauses', () => {
    const { scope, host } = mount()
    const step = vi.fn()
    const motion = start(host, step)
    vi.advanceTimersByTime(1500)
    setPaused(scope, host, true)
    vi.advanceTimersByTime(10_000)
    expect(step).not.toHaveBeenCalled()
    motion.release()
  })

  it('re-arms a full period when the scope lifts, with no catch-up burst', () => {
    const { scope, host } = mount()
    const step = vi.fn()
    const motion = start(host, step)
    setPaused(scope, host, true)
    vi.advanceTimersByTime(10_000)
    setPaused(scope, host, false)
    vi.advanceTimersByTime(1999)
    expect(step).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(step).toHaveBeenCalledTimes(1)
    motion.release()
  })

  it('is heard from a scope that is an ancestor, not only the element itself', () => {
    const { host } = mount()
    host.setAttribute(PAUSE_SCOPE_ATTR, '')
    const step = vi.fn()
    const motion = start(host, step)
    vi.advanceTimersByTime(5000)
    expect(step).not.toHaveBeenCalled()
    motion.release()
  })

  it('leaves the motion paused when only the scope lifts after its own pause', () => {
    const { scope, host } = mount()
    const step = vi.fn()
    const motion = start(host, step)
    motion.toggle()
    setPaused(scope, host, true)
    setPaused(scope, host, false)
    vi.advanceTimersByTime(10_000)
    expect(step).not.toHaveBeenCalled()
    motion.toggle()
    vi.advanceTimersByTime(2000)
    expect(step).toHaveBeenCalledTimes(1)
    motion.release()
  })

  it('stops listening after release', () => {
    const { scope, host } = mount()
    const step = vi.fn()
    const motion = start(host, step)
    setPaused(scope, host, true)
    motion.release()
    setPaused(scope, host, false)
    vi.advanceTimersByTime(10_000)
    expect(step).not.toHaveBeenCalled()
  })
})
