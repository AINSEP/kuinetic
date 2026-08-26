import { ATTR } from './attrs.js'
import { splitTopLevel } from './parse.js'
import type { Reporter } from './reporter.js'

/**
 * Where a group's stagger starts from, as a rank over DOM order.
 *
 * A number is a child index — `from:2` blooms outward from the third child.
 *
 * Every keyword except `random` is the same rule under a different origin: *rank = distance from
 * a reference point*. `start` is distance from child 0, `end` from the last child, `center` from
 * the middle, a number from that index, and `edges` from whichever of the two ends is nearer.
 * That is deliberately the whole set. GSAP's is `center | edges | random | <index>`; `start` is
 * added because the default behaviour needs a name an author can write down, and `end` because it
 * is the one ordering that is otherwise impossible to express — `from:<count-1>` requires knowing
 * a count the author cannot see from the markup.
 *
 * `slat-assemble`'s `alternate` (a zig-zag, see `slatOrder` in `effects/catalog/media-shared.ts`)
 * is deliberately *not* here. It is the one ordering whose look cannot be predicted from the name,
 * and it does not fit the distance-from-a-point model above, so it would be a second rule in a set
 * that otherwise has one. It earns its place on slats because there the children are library-made
 * strips of a single image and the zig-zag reads as a wipe; across authored DOM children it reads
 * as noise.
 */
export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | 'random' | number

/** Parsed form of the `data-kui-stagger` value. */
export interface StaggerConfig {
  /**
   * The raw step, written to `--kui-stagger` verbatim. Never validated here: the attribute has
   * always been passed straight through, so `data-kui-stagger="var(--speed)"` and
   * `calc(90ms * 2)` work today, and narrowing this to a `<time>` literal would break them.
   */
  step?: string
  from: StaggerFrom
}

const FROM_KEYWORDS: ReadonlySet<string> = new Set(['start', 'end', 'center', 'edges', 'random'])

/**
 * A `key:value` token in this attribute's grammar. The key is a bare identifier, which is what
 * keeps this from misreading a step: no CSS time is written with a leading identifier and a colon,
 * and `calc(90ms * 2)` / `var(--speed)` contain no colon at all.
 */
const PAIR_RE = /^([a-zA-Z-]+):(.*)$/

/**
 * Digit-bounded on purpose. `Number('9'.repeat(400))` is `Infinity`, and an infinite origin makes
 * every rank `Infinity`, which `String()` writes into `--kui-i` as the keyword `Infinity` —
 * invalid in the `calc()` downstream, so the whole delay declaration drops and the group loses its
 * stagger silently. Nine digits clamp long before that, and any index this large is clamped to the
 * group's last child anyway.
 */
const INDEX_RE = /^-?\d{1,9}$/

/**
 * Mixing constants for `randomRanks`. `0x9e3779b1` is 2^32/φ, the usual choice; the other three
 * are the splitmix32 finalizer's. Fixed literals, never a clock or `Math.random()` seed — see
 * `randomRanks` for why that matters.
 */
const RANDOM_SALT = 0x9e3779b1
const COUNT_SALT = 0x85ebca6b
const MIX_A = 0x21f0aaad
const MIX_B = 0x735a2d97

/**
 * Parse `data-kui-stagger`.
 *
 * The grammar is the smallest thing that could carry an ordering without a new attribute:
 *
 *   value := [step] key:value*
 *
 * — the step positional and first, exactly as `duration` is positional and first in `data-kui`.
 * So `data-kui-stagger="90ms"` (every use in the repo today) parses unchanged, and
 * `data-kui-stagger="90ms from:center"` adds the ordering.
 *
 * This lives on `data-kui-stagger` rather than as a key inside `data-kui`, for three reasons and
 * the third is decisive:
 *
 *  1. The group parent usually has no `data-kui` at all — it is a bare `<div class="grid">` in
 *     every one of the demo pages. Ordering a group would mean inventing an effect for a wrapper
 *     that is not animating.
 *  2. `data-kui`'s grammar is per-*effect*: `data-kui="fade-up, zoom-in"` is two specs. Ordering
 *     is a property of the group, not of an effect, so it would have to be hoisted element-wide
 *     like `on:` and `timeline:` — a third scope in an attribute that already has two.
 *  3. `from:` is already taken inside `data-kui`, by fourteen primitives. `count-up from:0`,
 *     `scale-in from:1`, `gradient-shift from:#f00`, `path-draw from:0%` — it is one of the most
 *     common parameter names in the catalog. A group ordering spelled `from:` there would be
 *     ambiguous with all of them and unresolvable, because `resolveParams` cannot know whether the
 *     author meant the effect's parameter or the group's order. `data-kui-stagger` has no
 *     parameter namespace to collide with, so the word is free here and means one thing.
 *
 * Warnings rather than silence, because the failure is invisible otherwise: an unparsed token
 * lands in `--kui-stagger` as garbage, CSS drops the declaration, and the group animates as one
 * block with nothing in the console to say why.
 *
 * @param value - Raw attribute text. `''` for a bare `data-kui-stagger` with no value.
 * @param warnings - Sink for diagnostics. Optional so a pure parse can ignore them.
 * @returns The step (absent when the author wrote only an ordering) and the ordering.
 * @complexity O(n) time in the attribute length; O(n) space for the tokens.
 * @overallScore 100
 */
export function parseStaggerAttribute(value: string, warnings: string[] = []): StaggerConfig {
  const config: StaggerConfig = { from: 'start' }
  let sawFrom = false

  // Paren- and quote-aware, so `calc(90ms * 2)` survives as one token rather than three. That is
  // the same tokenizer `data-kui` uses; a plain `.split(' ')` here would shred exactly the values
  // this attribute has always accepted.
  for (const token of splitTopLevel(value, ' ', warnings)) {
    const pair = PAIR_RE.exec(token)
    if (!pair) {
      config.step = keepFirstStep(config.step, token, warnings)
      continue
    }

    const [, key = '', raw = ''] = pair
    if (key !== 'from') {
      warnings.push(
        `unrecognised key "${key}" in data-kui-stagger — expected a time step or "from:"`,
      )
      continue
    }
    // First one wins, matching `assignOnce` in `parse.ts`: a second, differing value across the
    // same attribute is a mistake, and letting the last one win makes which mistake you get depend
    // on token order.
    if (sawFrom) {
      warnings.push(`duplicate "from:" in data-kui-stagger — "${raw}" ignored`)
      continue
    }
    sawFrom = true
    config.from = parseFrom(raw, warnings)
  }
  return config
}

/**
 * The first bare token is the step. A second is an authoring mistake worth naming: both used to be
 * concatenated into `--kui-stagger`, which made the declaration invalid and dropped the group's
 * stagger entirely rather than just ignoring the stray token.
 *
 * @returns The step to keep — the one already found, or this token if there was none.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function keepFirstStep(current: string | undefined, token: string, warnings: string[]): string {
  if (current === undefined) return token
  warnings.push(`extra token "${token}" in data-kui-stagger (expected one time step)`)
  return current
}

/**
 * Resolve one `from:` value to an ordering, falling back to the default rather than failing.
 *
 * The string-or-number return is the domain, not sloppiness: GSAP's `from` is a keyword *or* an
 * index, and flattening it to a string here would only move the `Number()` — and the "is this
 * "2" the keyword or the index?" question — into every consumer.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line sonarjs/function-return-type -- `StaggerFrom` is a keyword OR an index by design; see above.
function parseFrom(raw: string, warnings: string[]): StaggerFrom {
  const value = raw.trim()
  if (FROM_KEYWORDS.has(value)) return value as StaggerFrom
  if (INDEX_RE.test(value)) return Number(value)
  warnings.push(
    `unrecognised "from:${raw}" in data-kui-stagger — expected ` +
      `start, end, center, edges, random, or a child index`,
  )
  return 'start'
}

/**
 * Rank every child of a group of `count` animated children.
 *
 * Returns ranks, not delays. The rank is what lands in `--kui-i`, and the offset arithmetic stays
 * in the CSS `calc()` where it always was — so an ordering changes *which integer* goes in that
 * one slot and nothing downstream, which is the whole reason ordering was cheap to add.
 *
 * Ranks are always `>= 0`, and that is a correctness requirement rather than an accident: a
 * negative `--kui-i` makes `animation-delay` negative, and a negative delay does not delay an
 * animation — it seeks it, so an entrance would paint already half-played instead of waiting its
 * turn. Every branch below is a distance or a permutation index, both non-negative by
 * construction, and `from:<index>` is clamped into range before it can produce one.
 *
 * Ties are allowed and are not a bug: `center` on an even-sized group starts its two middle
 * children on the same beat, which is what "from the centre" means when there is no single centre.
 *
 * Ordering is over **DOM order**, not visual order. That is the only order available without
 * measuring geometry, and measuring would force a layout on every group on every scan. It also
 * makes this correct in RTL for free, and answers the question of whether `--kui-dir` (the
 * writing-mode sign in `kui.tokens`) is involved: it is not. `--kui-dir` flips the *sign of a
 * translation* for the logical slide family and never touches `--kui-i`. `start` and `end` are
 * named logically for the same reason those presets are — in RTL the "start" child is the
 * rightmost one, because that is where its row begins — so no sign flip is wanted here. `center`,
 * `edges` and `random` are symmetric under reversal and could not care either way. The one case
 * this cannot see is `flex-direction: row-reverse`, where the author has divorced visual order
 * from DOM order themselves; `from:end` is the fix there.
 *
 * @param count - Number of animated children in the group.
 * @param from - The ordering.
 * @param warnings - Sink for the out-of-range diagnostic. Optional; the function is otherwise pure.
 * @returns One rank per child, indexed by DOM position.
 * @complexity O(n) time and space, except `random` which is O(n log n) time.
 * @overallScore 100
 */
export function staggerRanks(
  count: number,
  from: StaggerFrom,
  warnings: string[] = [],
): number[] {
  if (count <= 0) return []
  if (from === 'random') return randomRanks(count)

  const last = count - 1
  // Both ends rank 0 and the middle ranks highest, so a row closes inward. The mirror image of
  // `center`, and the only member of the set with two origins rather than one.
  if (from === 'edges') {
    return Array.from({ length: count }, (_, index) => Math.min(index, last - index))
  }

  const origin = originOf(from, last, warnings)
  // `Math.floor` only ever bites on `center` with an even count, where the origin sits on a half
  // index: distances come out .5, 1.5, 2.5 and the floor pulls them back to 0, 1, 2 — the two
  // middle children on beat 0 rather than every child half a step late. Every other origin is an
  // integer and the floor is a no-op.
  return Array.from({ length: count }, (_, index) => Math.floor(Math.abs(index - origin)))
}

/**
 * The index a distance-based ordering measures from.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function originOf(from: Exclude<StaggerFrom, 'random' | 'edges'>, last: number, warnings: string[]): number {
  if (from === 'start') return 0
  if (from === 'end') return last
  if (from === 'center') return last / 2

  // An out-of-range `from:` is clamped to the nearest end, not honoured. Unclamped, `from:99` on a
  // five-item group ranks them 99, 98, 97, 96, 95 — at a 90ms step that is 8.5 seconds of nothing
  // before the first child moves, which is the `--kui-i` leak's failure mode wearing a different
  // hat: an effect that looks broken because it is waiting out an offset nobody meant to write.
  // Clamping rather than refusing, because at each boundary the clamp *is* the identity: `from:0`
  // is `from:start` and `from:<last>` is `from:end`, so an out-of-range index degrades to the
  // keyword the author could have written instead of to a linear ramp behind a delay nobody asked
  // for. A negative index clamps to 0 rather than counting back from the end, because `end`
  // already has a name and a second, invisible indexing convention would be worse than a warning.
  if (from < 0 || from > last) {
    warnings.push(
      `"from:${from}" in data-kui-stagger is outside the group (0 to ${last}) — clamped`,
    )
  }
  return Math.min(Math.max(from, 0), last)
}

/**
 * A deterministic shuffle: ranks 0..count-1, each used exactly once, in a scattered order.
 *
 * Stability is the whole design constraint here, and it is why there is no seed at all. `random`
 * has to survive a re-activation, a teardown and re-install, a `scan()` of a mutated subtree, and
 * a page reload — `applyStagger` re-runs on all four, and a fresh shuffle on each would reshuffle
 * a list mid-interaction and make the order in a bug report unreproducible for whoever reads it.
 * `Math.random()` anywhere in this function would do exactly that, and so would seeding off a
 * clock or a mutable counter. Instead the rank is a pure function of `(index, count)`, so the same
 * group always scatters the same way — on every run, on every machine, and in a test.
 *
 * The cost of no seed is that two same-sized groups on one page shuffle identically. That is the
 * right trade: variety between groups is worth less than an order you can reproduce, and an author
 * who wants two grids to differ can give them different `from:` values or different sizes.
 *
 * A permutation rather than a scatter, unlike `slatOrder`'s `random-ish` in
 * `effects/catalog/media-shared.ts`. That one is `floor(frac(i·φ) · n)`, which collides for almost
 * every `n` — fine for slats, where a tie is two strips landing together and invisible, but here a
 * tie is two cards moving as a pair, which reads as a grid that failed to randomise rather than
 * one that did.
 *
 * @complexity O(n log n) time, O(n) space — paid once per group, not once per child.
 * @overallScore 100
 */
function randomRanks(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index)
  // The `|| a - b` tie-break is not decoration. Two indices can hash to the same 32-bit key, and a
  // comparator that returns 0 for them would leave their relative order to the engine's sort — the
  // one place a "deterministic" shuffle could still differ between browsers. With the tie-break the
  // comparator is a total order and the result is fixed no matter how the sort is implemented.
  order.sort((a, b) => scatterKey(a, count) - scatterKey(b, count) || a - b)

  const ranks = new Array<number>(count)
  // `order` reads "which child takes rank r"; `--kui-i` needs the inverse, "which rank child i
  // takes". Writing `order` straight out staggers the wrong children.
  for (const [rank, index] of order.entries()) ranks[index] = rank
  return ranks
}

/**
 * Hash one index to a 32-bit key. `Math.imul` throughout so every multiply stays in the int32
 * domain: plain `*` on these constants exceeds 2^53 for large indices and starts losing low bits,
 * which is where a "deterministic" hash quietly stops being one.
 *
 * `count` is mixed in so a group of 5 and a group of 20 get unrelated orders rather than the
 * second being the first with a tail.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function scatterKey(index: number, count: number): number {
  let hash = (Math.imul(index, RANDOM_SALT) ^ Math.imul(count, COUNT_SALT)) >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, MIX_A) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, MIX_B) >>> 0
  hash ^= hash >>> 15
  return hash >>> 0
}

/**
 * Index the animated children of one stagger group.
 *
 * Only the index is written; the offset arithmetic stays in the CSS `calc()` so the browser
 * applies it, rather than JS recomputing a delay per element. `from:` changes which index a child
 * gets and nothing else — the delay formula in `compile.ts` is untouched by ordering.
 *
 * No new custom property is introduced, deliberately. `--kui-i` inherits and does not stop at the
 * group boundary (a dropdown nested inside item 11 of a staggered list read `--kui-i: 11` off its
 * ancestor and opened 660ms after the click), which is why `kui.tokens` resets it — so an ordering
 * expressed as a *different value of the same property* inherits the fix for free, where a new
 * `--kui-order` or `--kui-from` would have needed its own reset and would have been one more thing
 * to remember.
 *
 * @param group - Element carrying `data-kui-stagger`.
 * @param reporter - Diagnostic sink for a malformed attribute. Optional, so the two-argument
 *   contract every existing caller uses keeps working.
 * @complexity O(n) time in the number of children; O(n) space for the ranks.
 * @overallScore 100
 */
export function indexStaggerGroup(group: Element, reporter?: Reporter): void {
  const warnings: string[] = []
  const { step, from } = parseStaggerAttribute(group.getAttribute(ATTR.stagger) ?? '', warnings)
  if (step) (group as HTMLElement).style.setProperty('--kui-stagger', step)

  const children = animatedChildren(group)
  const ranks = staggerRanks(children.length, from, warnings)
  let maxRank = 0
  for (const [index, child] of children.entries()) {
    const rank = ranks[index] ?? 0
    child.style.setProperty('--kui-i', String(rank))
    if (rank > maxRank) maxRank = rank
  }

  // The group's stagger span, published for `timeline: pin`. A time-driven stagger does not need
  // it — the clock keeps running past the last item's delay, so everything finishes eventually. A
  // scrub has no such luxury: its head travels exactly one `duration` between progress 0 and 1, so
  // a staggered child sitting `i * stagger` further along would still be mid-animation when the
  // scroll range ends, and the last child could never reach its final frame at all. Widening the
  // head by the group's total stagger span fixes that, and the compiler cannot know the span
  // because it compiles one element without reference to its siblings. Defaults to 1 in the
  // `var()` fallback, where the extra term is zero and the head is plain `progress x duration`.
  //
  // This is `maxRank + 1`, not the child count, and the difference only appeared once ordering
  // existed. Downstream (`compile.ts`'s `staggerDelay`) spends it as `(count - 1) * stagger`, i.e.
  // it wants *the largest offset in the group*, and the two coincided only while the sole ordering
  // was linear and the largest offset was always the last child's. `center` and `edges` on six
  // children top out at rank 2, not 5: publishing 6 there would stretch the scrub head over a span
  // more than twice the real one, so the group would finish animating less than halfway through
  // the pinned range and leave dead scroll behind it. So the property keeps its name and its
  // consumers, and its meaning narrows from "how many children" to "how many stagger beats" —
  // which is what the formula always actually needed. For `start` the two are still identical,
  // so nothing that exists today changes value.
  //
  // Unlike `--kui-i`, this one is *not* reset in `kui.tokens` and must not be: the group publishes
  // it precisely so its children inherit it, exactly as `--kui-stagger` is inherited.
  //
  // `maxRank` starts at 0 and the loop above only raises it, so an empty or entirely unmarked
  // group publishes 1 without a special case. That matters: 0 would make the scrub head one
  // stagger step *shorter* than a single duration, seeking past the final frame before progress
  // reached 1.
  ;(group as HTMLElement).style.setProperty('--kui-stagger-count', String(maxRank + 1))

  for (const warning of warnings) reporter?.warn(warning, group)
}

/**
 * The group's direct children that actually carry an effect.
 *
 * Materialised into an array rather than ranked in place, because a rank needs the group size and
 * the size is only known once every child has been tested. The old single pass could count as it
 * went, but only because `start` is the one ordering that never looks ahead.
 *
 * @complexity O(n) time and space in the number of direct children.
 * @overallScore 100
 */
function animatedChildren(group: Element): HTMLElement[] {
  const children: HTMLElement[] = []
  for (const child of group.children) {
    if (child.hasAttribute(ATTR.source)) children.push(child as HTMLElement)
  }
  return children
}

/**
 * Index every stagger group in a subtree, including the root itself.
 *
 * @param root - Subtree to search.
 * @param reporter - Diagnostic sink, threaded through to each group.
 * @complexity O(n) time in the number of elements in the subtree; O(g) space in group count.
 * @overallScore 100
 */
export function applyStagger(root: ParentNode, reporter?: Reporter): void {
  const selector = `[${ATTR.stagger}]`
  if (root instanceof Element && root.matches(selector)) indexStaggerGroup(root, reporter)
  for (const group of root.querySelectorAll(selector)) indexStaggerGroup(group, reporter)
}
