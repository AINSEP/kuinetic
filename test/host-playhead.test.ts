// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { createHostPlayhead } from '../src/effects/auto-motion.js'

function setup(): { host: HTMLElement; hold: (paused: boolean) => void; ledger: ReturnType<typeof createStyleLedger> } {
  const host = document.createElement('div')
  const ledger = createStyleLedger(host)
  const hold = createHostPlayhead({ style: ledger } as unknown as PrepareContext)
  return { host, hold, ledger }
}

describe('createHostPlayhead', () => {
  it('writes nothing until a pause is first requested', () => {
    const { host, hold } = setup()
    hold(false)
    expect(host.style.getPropertyValue('animation-play-state')).toBe('')
  })

  it('holds and releases the host through its own ledger', () => {
    const { host, hold } = setup()
    hold(true)
    expect(host.style.getPropertyValue('animation-play-state')).toBe('paused')
    hold(false)
    expect(host.style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('does not rewrite an unchanged state', () => {
    const { host, hold } = setup()
    hold(true)
    host.style.setProperty('animation-play-state', 'running')
    hold(true)
    expect(host.style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('unwinds to the author value when the ledger restores', () => {
    const { host, hold, ledger } = setup()
    host.style.setProperty('animation-play-state', 'running')
    hold(true)
    ledger.restore()
    expect(host.style.getPropertyValue('animation-play-state')).toBe('running')
  })
})
