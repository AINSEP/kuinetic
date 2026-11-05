import { describe, expect, it } from 'vitest'
import { additiveResolution, claimedChannels, findConflicts } from '../src/core/channels.js'
import type { ChannelClaim } from '../src/core/channels.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

describe('additive rescue with excluded bystanders', () => {
  it('rescues the above:md pair without making the below:md entrance additive', () => {
    const compiled = compile(
      parse('fade-up below:md, parallax-y above:md, depth-layer above:md'),
      catalogRegistry(),
      'view',
    )
    expect(compiled.warnings).toEqual([])
    expect(compiled.fxNames).toEqual(['fade-up', 'parallax-y', 'depth-layer'])
    expect(compiled.declarations['animation-composition']).toBe('replace, add, add')
  })

  it('excludes a state that is phase-independent of both contested entrances', () => {
    const claims: ChannelClaim[] = [
      { name: 'state', channels: ['translate'], phase: 'state', additive: false },
      { name: 'entrance-a', channels: ['translate'], phase: 'entrance', additive: true },
      { name: 'entrance-b', channels: ['translate'], phase: 'entrance', additive: true },
    ]
    expect(findConflicts(claims)).toEqual([
      { channel: 'translate', effects: ['entrance-a', 'entrance-b'] },
    ])
    expect(additiveResolution(claims, findConflicts(claims))).toEqual(new Set([1, 2]))
  })

  it('still refuses a real non-additive participant, even when only its first clash is reported', () => {
    const claims: ChannelClaim[] = [
      { name: 'non-additive', channels: ['translate', 'opacity'], phase: 'state', additive: false },
      { name: 'additive-a', channels: ['translate'], phase: 'entrance', additive: true },
      { name: 'additive-b', channels: ['translate'], additive: true },
    ]
    // In the second order the named conflict edges omit the non-additive second claimant:
    // findConflicts reports only the first prior clash for each later claim.
    const hiddenParticipant = [claims[1]!, claims[0]!, claims[2]!]
    expect(findConflicts(hiddenParticipant)).toEqual([
      { channel: 'translate', effects: ['additive-a', 'additive-b'] },
    ])
    for (const ordered of [claims, hiddenParticipant, [...claims].reverse()]) {
      expect(findConflicts(ordered).length).toBeGreaterThan(0)
      expect(additiveResolution(ordered, findConflicts(ordered))).toBeUndefined()
    }
    const compiled = compile(parse('fade-up, parallax-y, depth-layer'), catalogRegistry(), 'time')
    expect(compiled.fxNames).toEqual(['fade-up'])
    expect(compiled.warnings).toHaveLength(1)
    expect(compiled.warnings[0]).toContain('cannot compose')
    expect(compiled.declarations['animation-composition']).toBeUndefined()
  })
})

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
