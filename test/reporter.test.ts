import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectingReporter, consoleReporter, silentReporter } from '../src/core/reporter.js'

describe('consoleReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefixes the message when warning without a subject', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleReporter().warn('missing selector')
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('[kuinetic] missing selector')
  })

  it('appends the subject as a second console.warn argument when given', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const subject = { selector: '.oops' }
    consoleReporter().warn('missing selector', subject)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('[kuinetic] missing selector', subject)
  })
})

describe('silentReporter', () => {
  it('discards warnings without touching the console', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => silentReporter().warn('ignored', { any: 'thing' })).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('collectingReporter', () => {
  it('accumulates warning messages in call order', () => {
    const reporter = collectingReporter()
    reporter.warn('first')
    reporter.warn('second', { ignored: 'subject' })
    expect(reporter.messages).toEqual(['first', 'second'])
  })

  it('starts with an empty messages array', () => {
    expect(collectingReporter().messages).toEqual([])
  })
})
