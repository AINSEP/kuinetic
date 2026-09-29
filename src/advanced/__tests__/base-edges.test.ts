import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultClearTimer, defaultSetTimer } from '../base.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the default timer pair', () => {
  it('schedules through the global setTimeout and cancels through clearTimeout', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const id = defaultSetTimer(fn, 50)
    expect(id).not.toBeNull()

    defaultClearTimer(id)
    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()

    defaultSetTimer(fn, 50)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('answers null, rather than throwing, in a host with no setTimeout', () => {
    vi.stubGlobal('setTimeout', undefined)
    expect(defaultSetTimer(() => {}, 10)).toBeNull()
  })

  it('ignores a null id and a host with no clearTimeout', () => {
    const clear = vi.fn()
    vi.stubGlobal('clearTimeout', clear)
    defaultClearTimer(null)
    expect(clear).not.toHaveBeenCalled()

    vi.stubGlobal('clearTimeout', undefined)
    expect(() => defaultClearTimer(5)).not.toThrow()
  })
})
