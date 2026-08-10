import type { Channel } from './types.js'

/**
 * Composition safety.
 *
 * Two CSS rules that each declare `animation` do NOT concatenate — the cascade discards one.
 * So a comma list is compiled into a single declaration with parallel value lists. That fixes
 * the cascade problem but not the *property* problem: two animations writing `opacity` replace
 * rather than blend.
 *
 * Hence channels. An effect declares the property groups it owns; a comma list is only safe to
 * compile when those sets are pairwise disjoint. See docs/design.md §4.
 */

export interface ChannelClaim {
  name: string
  channels: Channel[]
}

export interface Conflict {
  channel: Channel
  effects: [string, string]
}

/** Every pair of effects claiming the same channel. Empty array means the list composes. */
export function findConflicts(claims: ChannelClaim[]): Conflict[] {
  const conflicts: Conflict[] = []
  const seen = new Map<Channel, string>()

  for (const claim of claims) {
    for (const channel of claim.channels) {
      const owner = seen.get(channel)
      if (owner === undefined) {
        seen.set(channel, claim.name)
        continue
      }
      // Same effect name twice in one list claims the channel against itself; still a conflict,
      // and a more likely author typo than a deliberate choice.
      conflicts.push({ channel, effects: [owner, claim.name] })
    }
  }
  return conflicts
}

export function describeConflicts(conflicts: Conflict[]): string {
  return conflicts
    .map((c) => `"${c.effects[0]}" and "${c.effects[1]}" both animate ${c.channel}`)
    .join('; ')
}

/** Union of all claimed channels, for debugging and perf accounting. */
export function claimedChannels(claims: ChannelClaim[]): Channel[] {
  return [...new Set(claims.flatMap((c) => c.channels))]
}
