import { gatesOverlap } from './breakpoints.js'
import type { EffectGate } from './breakpoints.js'
import type { Channel, DeliveryMechanism, EffectPhase } from './types.js'

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
 *
 * And a third: *when* each effect holds the channel. Disjointness in space and time are the same
 * kind of exemption — `fade-up, lift` share `translate` and share every width, but an entrance and
 * a hover state are not fighting over the property, they are taking turns with it. See
 * {@link EffectPhase} for why that is a declared fact rather than a derived one, and
 * {@link independentPhases} for which pairs qualify.
 */

export interface ChannelClaim {
  name: string
  channels: Channel[]
  /** Viewport condition, if the segment carries one. Absent means "live at every width". */
  gate?: EffectGate
  /**
   * When this segment holds its channels, if that is known. Absent means unphased — the preset
   * declares no phase and none could be derived — and an unphased claim collides with everything,
   * itself included, which is exactly how every claim behaved before this field existed.
   */
  phase?: EffectPhase
  /**
   * Whether the caller can put `animation-composition: add` on whatever this segment compiles to.
   * Asked of the caller rather than worked out here because the answer is about the *renderer* —
   * how many keyframe blocks the segment produces, and whether it produces any at all — which is
   * `compile.ts`'s knowledge. What is additive about a *channel* stays here, in
   * {@link CHANNEL_COMPOSITION}.
   */
  additive?: boolean
  /**
   * How this segment's motion reaches the element, when that is something composition has to act on
   * — see `types.ts`'s {@link DeliveryMechanism}. Read only by {@link deliveryClobbers}, never by
   * {@link findConflicts}: it describes a fight over a *property* rather than over a channel.
   */
  delivery?: DeliveryMechanism
  /**
   * Whether this segment writes `animation-name` to `element.style`. Asked of the caller for the
   * same reason {@link additive} is — it is a fact about the renderer, which is `compile.ts`'s
   * knowledge, not this module's.
   */
  inlineAnimation?: boolean
}

export interface Conflict {
  channel: Channel
  effects: [string, string]
}

/**
 * Phase pairs that can share a channel without fighting over it, keyed by {@link phasePair}.
 *
 * Only two entries, and both have the same shape: a one-shot animation beside a state the visitor
 * drives. The reason is a property of how the catalog's keyframes are written rather than a guess
 * about timing. `kui-in-up` and its family declare a `from` block and no `to`; CSS resolves a
 * missing endpoint keyframe against the *underlying* value, so a filling entrance holds whatever
 * the cascade beneath it says. The `:hover` rule that `lift` ships is that underlying value, and it
 * shows through the moment the entrance has played. Exits are the mirror image — `to`-only, resting
 * at the authored state until they run — so they layer the same way.
 *
 * **The real precondition is delivery, not timing, and `phase` is only a proxy for it.** Read that
 * paragraph again and every load-bearing step is about *how* the state half reaches the element:
 * "the cascade beneath it", "the `:hover` rule `lift` ships". The exemption is sound when the state
 * half is a **transition or a normal declaration**, and unsound the moment it is a keyframe
 * animation, which sits beside the entrance rather than beneath it. Two shapes broke on this, both
 * shipped silently, and the two are fixed in different places because they are different failures:
 *
 * - **A `state` preset that compiles its own keyframe track.** `blur-in, duotone-hover` emitted
 *   `animation-name: kui-blur-in, kui-duotone-hover` with `fill-mode: both, both` and no warning;
 *   `kui-duotone-hover` is two-ended, so it is no underlying value for `kui-blur-in`'s open
 *   endpoint — it is later in the list, wins `filter`, and clamps it. The entrance was deleted.
 *   That one is a *channel* collision that the exemption was wrongly waving through, so the fix is
 *   to stop claiming the exemption: `catalog/media.ts`'s three `media-filter` hovers and
 *   `catalog/interaction.ts`'s `HOVER_PRESETS` no longer declare `phase: 'state'`, and phase is
 *   derived from `transitions` alone — sound by construction, since a transition emits no track.
 * - **A `state` preset whose motion is a stylesheet `animation:` on the host.** A composed entrance
 *   writes `animation-name` *inline*, which outranks any author rule, so `fade-up, icon-bounce`
 *   compiled clean and the hover could never run at all. Dropping the phase does **not** fix this
 *   one and never could, because it is not a channel collision: `fade-up` writes
 *   `opacity`/`translate` and `icon-spin` writes `rotate`, so the pair is disjoint, this set is
 *   never consulted, and it composed anyway with the hover dead — 548 pairs of it, measured.
 *
 * The second failure is what `Preset.delivery` and `compile.ts`'s `deliveryClobbers` exist for, and
 * they sit deliberately *outside* this set: what they refuse is a property the two effects fight
 * over regardless of channels, gates or phases, so it is not an exemption this table could grant or
 * withhold. `types.ts`'s {@link DeliveryMechanism} carries the five-mechanism picture.
 *
 * What is left here, then, is the timing rule *given* that delivery has already been checked — and
 * the honest reading of it is that the state half must reach the element through the cascade rather
 * than through a track of its own. A preset that declares `phase: 'state'` while compiling
 * keyframes is still exempting a condition this table cannot see. The two names that did are gone;
 * a third would need `test/composition-phase.test.ts`'s stylesheet-reading suite to catch it, which
 * is why that suite reads the shipped CSS rather than the effect records.
 * Found by three of four auditors in the 2026-09-08 catalog review.
 *
 * Every other pair is a genuine clash and stays one:
 *
 * - `entrance | exit` — both are filling tracks with a real from- or to-state, both live on the
 *   element at once, and the later `animation-name` in the list wins the property outright.
 * - `idle | anything` — an unbounded loop never yields the channel back, so there is no turn for
 *   the other effect to take. This is the pair {@link CHANNEL_COMPOSITION} exists for.
 * - `state | state` — two normal declarations for one property, resolved by source order and held
 *   forever. `declarations.ts`'s `pushTransitions` already warns when two presets transition the
 *   same property for the same reason.
 * - anything involving an unphased claim — nothing is known, so nothing is exempted.
 */
const INDEPENDENT_PHASES = new Set(['entrance|state', 'exit|state'])

/** Order-independent key for a phase pair, so `a, b` and `b, a` look the same up here. */
function phasePair(a: EffectPhase, b: EffectPhase): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Whether two claims hold a shared channel at different times, and so may compose despite it.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function independentPhases(a: ChannelClaim, b: ChannelClaim): boolean {
  if (!a.phase || !b.phase) return false
  return INDEPENDENT_PHASES.has(phasePair(a.phase, b.phase))
}

/**
 * Which channels may be composed by *adding* two animations' output rather than replacing it, and
 * which must stay one-writer-only.
 *
 * Deliberately an allowlist with one member. `animation-composition: add` looks like a general
 * answer to this whole problem and is not: addition in Web Animations L1 is defined per property
 * type, and a property with no additive definition — anything discrete, and every value CSS
 * resolves as a keyword — falls back toward replacement *silently*. Applying `add` across the
 * board would convert a loud, detectable conflict into a quiet browser-dependent last-writer
 * result, which is strictly worse than the drop it was meant to fix. The channel set includes
 * `clip`, `background`, `text`, display-like channels and, through `Channel`'s open `string` arm,
 * whatever a third-party primitive registers — none of which anyone has tested.
 *
 * So: `translate` is here because a translation is a vector with a well-defined sum and a neutral
 * `0px 0px 0px`, and nothing else is here until someone measures it in a browser and adds it.
 */
// `Partial`, so the absent keys carry their meaning rather than being an oversight: every channel
// not written here — the ten other built-ins and every string a third-party primitive registers —
// is replace-only, which is what the whole library did before this table existed.
export const CHANNEL_COMPOSITION: Partial<Record<Channel, 'add'>> = {
  translate: 'add',
}

/** Whether every channel a claim writes can survive being made additive. */
export function additiveChannels(channels: readonly Channel[]): boolean {
  // `every`, not `some`: `animation-composition` applies to a whole animation track, and a track
  // compiled from one `@keyframes` block writes every channel its preset claims. `fade-up` writes
  // `opacity` and `translate` from `kui-in-up`, so marking that track additive to rescue the
  // translate half would also add its opacity to the underlying 1 and delete the fade.
  return channels.length > 0 && channels.every((channel) => CHANNEL_COMPOSITION[channel] === 'add')
}

/**
 * Rescue a surviving clash by summing the claims that caused it instead of letting one replace the
 * other.
 *
 * The last resort, and deliberately the narrowest of the three exemptions the detector offers — a
 * gate says the two are never live together, a phase says they take turns, and this one admits they
 * genuinely overlap and asks the browser to blend them.
 *
 * All-or-nothing over the whole contested set. A partly-additive list is the worst outcome
 * available: the author is told nothing, and one of the two effects is quietly replaced anyway.
 *
 * @returns Indices of the claims to compile additively, or `undefined` when the rescue does not
 *   apply and the caller should refuse the list.
 * @complexity O(n * c) time in claims and their channels; O(n + c) space.
 * @overallScore 100
 */
export function additiveResolution(
  claims: ChannelClaim[],
  conflicts: Conflict[],
): Set<number> | undefined {
  // A name clashing with itself is refused here rather than summed, and the reason is the one
  // `findConflicts` already records: `parallax-y, parallax-y` is far more likely a typo than a
  // request for double the parallax. Summing it would be the one case where this rescue makes a
  // mistake *quieter* instead of making a correct pairing possible.
  if (conflicts.some((conflict) => conflict.effects[0] === conflict.effects[1])) return undefined
  const contested = new Set(conflicts.map((conflict) => conflict.channel))
  const involved = new Set<number>()
  claims.forEach((claim, index) => {
    if (claim.channels.some((channel) => contested.has(channel))) involved.add(index)
  })
  for (const index of involved) if (!claims[index]!.additive) return undefined
  return involved
}

/**
 * Every pair of effects claiming the same channel at widths where both can be live, in phases where
 * both can hold it. Empty array means the list composes.
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
      const clash = claimants.find(
        // Same effect name twice in one list claims the channel against itself; still a conflict,
        // and a more likely author typo than a deliberate choice. Phase cannot exempt that pair
        // either, because a phase is only ever independent of a *different* one.
        (other) => gatesOverlap(other.gate, claim.gate) && !independentPhases(other, claim),
      )
      if (clash) conflicts.push({ channel, effects: [clash.name, claim.name] })
      claimants.push(claim)
      seen.set(channel, claimants)
    }
  }
  return conflicts
}

/**
 * Clashes over *how* each segment's motion is delivered, which {@link findConflicts} cannot see.
 *
 * That function asks which property groups two segments write, and for two compiled animation
 * tracks it is the right question. It is the wrong one here. A preset whose motion is
 * `[data-kui-fx~='icon-spin']:hover { animation: … }` in `src/css/interaction.css` loses the
 * `animation` property to *any* composed neighbour that writes `animation-name` inline, because an
 * inline declaration outranks an author rule outright. It does not matter that `icon-spin` writes
 * `rotate` and `fade-up` writes `opacity`/`translate` — the two never shared a channel, the
 * detector correctly reported nothing, and `fade-up, icon-spin` composed clean with the hover
 * silently dead. 548 such pairs, measured, and pre-existing rather than introduced by the phase
 * axis: see `types.ts`'s {@link DeliveryMechanism} and the 2026-09-08 catalog review.
 *
 * There is no rescue and deliberately none offered. A gate does not help, unlike in
 * {@link findConflicts}: `gatedAnimationName` compiles an out-of-band track to
 * `animation-name: var(--kui-above-md, kui-in-up)` and `base.css` declares that property `none`
 * outside the gate — `none` is still an inline value, still outranks the stylesheet rule, and
 * leaves the hover just as dead below the breakpoint as above it. Neither does
 * {@link additiveResolution}: `animation-composition` blends two tracks that both run, and the
 * whole failure here is a rule that never becomes active.
 *
 * @returns One sentence per clobbered claim, in the shape {@link describeConflicts} produces, or an
 *   empty array when nothing in the list writes an inline animation.
 * @complexity O(n) time in the claim count; O(n) space.
 * @overallScore 100
 */
export function deliveryClobbers(claims: ChannelClaim[]): string[] {
  const stylesheet = claims.filter((claim) => claim.delivery === 'stylesheet-animation')
  if (stylesheet.length === 0) return []
  // Excluding the stylesheet-delivered claims themselves is belt-and-braces rather than a live case
  // — a preset cannot deliver its motion from a `:hover` rule *and* compile a keyframe track — but
  // it is what keeps a future name that somehow did both from clobbering itself.
  const inline = claims.find((claim) => claim.inlineAnimation && !claim.delivery)
  if (!inline) return []
  return stylesheet.map(
    (claim) =>
      `"${inline.name}" writes an inline animation, which outranks the stylesheet rule ` +
      `"${claim.name}" delivers its motion from`,
  )
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
