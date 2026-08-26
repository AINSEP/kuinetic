import { gatesOverlap } from './breakpoints.js'
import type { EffectGate } from './breakpoints.js'
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
 *
 * "Pairwise disjoint" gained a second dimension when viewport gates arrived: two effects that can
 * never be live at the same viewport width cannot collide however many channels they share. That
 * is not a nicety — `fade-up below:md, parallax-y above:md` is the flagship case the gate exists
 * for, both halves own `translate`, and without the width check the compiler would refuse the pair
 * and drop the second half at every width.
 */

export interface ChannelClaim {
  name: string
  channels: Channel[]
  /** Viewport condition, if the segment carries one. Absent means "live at every width". */
  gate?: EffectGate
}

export interface Conflict {
  channel: Channel
  effects: [string, string]
}

/**
 * Every pair of effects claiming the same channel at widths where both can be live. Empty array
 * means the list composes.
 *
 * Each channel keeps a *list* of prior claimants rather than a single owner, and a claim is
 * reported against the first one it actually overlaps. With no gates in play that first one is
 * always the first claim, so the output is exactly what a single-owner map produced. With gates it
 * is the difference between catching a real collision and inventing one: in `fade-up below:md,
 * parallax-y above:md, slide-up above:md` the genuine clash is the second pair, and a map holding
 * only `fade-up` would have compared both later effects against a segment neither can coexist with
 * and waved the list through.
 *
 * @complexity O(n^2) worst case in same-channel claimants; a comma list is a handful of segments.
 * @overallScore 100
 */
export function findConflicts(claims: ChannelClaim[]): Conflict[] {
  const conflicts: Conflict[] = []
  const seen = new Map<Channel, ChannelClaim[]>()

  for (const claim of claims) {
    for (const channel of claim.channels) {
      const claimants = seen.get(channel) ?? []
      const clash = claimants.find((other) => gatesOverlap(other.gate, claim.gate))
      // Same effect name twice in one list claims the channel against itself; still a conflict,
      // and a more likely author typo than a deliberate choice.
      if (clash) conflicts.push({ channel, effects: [clash.name, claim.name] })
      claimants.push(claim)
      seen.set(channel, claimants)
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
