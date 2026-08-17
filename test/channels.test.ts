import { describe, expect, it } from 'vitest'
import { claimedChannels } from '../src/core/channels.js'

describe('claimedChannels', () => {
  it('unions channels across claims, deduplicating repeats', () => {
    const claims = [
      { name: 'fade-in', channels: ['opacity'] },
      { name: 'slide-up', channels: ['translate', 'opacity'] },
    ]
    expect(claimedChannels(claims)).toEqual(['opacity', 'translate'])
  })

  it('returns an empty array for no claims', () => {
    expect(claimedChannels([])).toEqual([])
  })
})
