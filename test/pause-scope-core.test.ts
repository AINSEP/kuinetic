// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  PAUSE_SCOPE_ATTR,
  PAUSE_SCOPE_EVENT,
  announcePauseScope,
  isPausedByScope,
  watchPauseScope,
} from '../src/core/pause-scope.js'

function scene(): { scope: HTMLElement; inner: HTMLElement; outside: HTMLElement } {
  document.body.innerHTML = '<section id="s"><div id="in"><i></i></div></section><div id="out"></div>'
  return {
    scope: document.getElementById('s')!,
    inner: document.querySelector('#in i') as HTMLElement,
    outside: document.getElementById('out')!,
  }
}

describe('pause scope marker', () => {
  it('names the attribute and the event', () => {
    expect(PAUSE_SCOPE_ATTR).toBe('data-kui-paused')
    expect(PAUSE_SCOPE_EVENT).toBe('kui:pausescope')
  })

  it('is false with no marker anywhere', () => {
    expect(isPausedByScope(scene().inner)).toBe(false)
  })

  it('is true for descendants and for the marked element itself, false outside', () => {
    const { scope, inner, outside } = scene()
    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    expect(isPausedByScope(inner)).toBe(true)
    expect(isPausedByScope(scope)).toBe(true)
    expect(isPausedByScope(outside)).toBe(false)
  })
})

describe('watchPauseScope', () => {
  it('reports only edges, re-evaluated on every announced event', () => {
    const { scope, inner } = scene()
    const onChange = vi.fn()
    const stop = watchPauseScope(inner, document, onChange)

    announcePauseScope(document, scope)
    expect(onChange).not.toHaveBeenCalled()

    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    announcePauseScope(document, scope)
    announcePauseScope(document, scope)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(true)

    scope.removeAttribute(PAUSE_SCOPE_ATTR)
    announcePauseScope(document, scope)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(false)
    stop()
  })

  it('ignores a scope that does not contain the element', () => {
    const { scope, outside } = scene()
    const onChange = vi.fn()
    const stop = watchPauseScope(outside, document, onChange)
    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    announcePauseScope(document, scope)
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })

  it('stops listening after cleanup', () => {
    const { scope, inner } = scene()
    const onChange = vi.fn()
    watchPauseScope(inner, document, onChange)()
    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    announcePauseScope(document, scope)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('announces from the document when the source is detached', () => {
    const { scope, inner } = scene()
    const onChange = vi.fn()
    const stop = watchPauseScope(inner, document, onChange)
    scope.setAttribute(PAUSE_SCOPE_ATTR, '')
    const detached = document.createElement('div')
    announcePauseScope(document, detached)
    expect(onChange).toHaveBeenCalledWith(true)
    stop()
  })
})
