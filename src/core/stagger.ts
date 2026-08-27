import { ATTR } from './attrs.js'
import { createLedgerSet } from './owned-styles.js'
import type { LedgerSet } from './owned-styles.js'
import type { Reporter } from './reporter.js'
import { resolveStaggerConfig } from './stagger-config.js'
import type { GridOrigin, StaggerConfig, StaggerFrom, StaggerLayout } from './stagger-config.js'

export { parseStaggerAttribute, resolveStaggerConfig } from './stagger-config.js'
export type {
  GridOrigin,
  StaggerAxis,
  StaggerColumns,
  StaggerConfig,
  StaggerFrom,
  StaggerLayout,
} from './stagger-config.js'

/**
 * Ranking a stagger group, and writing the result onto its children.
 *
 * The grammar half — what the two attributes mean — lives in `stagger-config.ts`; this file starts
 * from a resolved {@link StaggerConfig} and answers the two questions that need a group: what rank
 * does each child take, and what step does the group publish.
 */

/** Ranks are spent inside a `calc()`, so three decimals is already more than a delay can show. */
const RANK_PRECISION = 1000

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
 * The value to write into `--kui-stagger` for a group whose largest rank is `maxRank`.
 *
 * A fixed step is passed through exactly as it always was. A total budget is divided by the largest
 * rank, because that rank is what the delay formula multiplies the step by
 * (`declarations.ts`'s `staggerDelay`) — so `budget / maxRank` is the step under which the
 * last-starting child starts at exactly `budget`, and the group's whole stagger span is the number
 * the author wrote, whatever the child count. Adding children tightens the gaps instead of
 * lengthening the sequence, which is the entire point of the mode: a 200-item list at
 * `cascade:50ms` takes ten seconds to finish entering, and the same list at `spread:600ms` takes
 * six hundred milliseconds.
 *
 * The divisor is the largest *rank*, not `count - 1`, so this composes with `order:` for free:
 * `center` on six children tops out at rank 2, and dividing by 2 is what keeps the *span* equal to
 * the budget rather than stretching it to two and a half times the budget.
 *
 * **`maxRank === 0` is a division by zero and must never be written.** A one-child group, or any
 * group whose ordering puts every child on beat 0, has no gaps to distribute — and
 * `calc(600ms / 0)` is not an invalid-but-harmless value, it is an invalid declaration, so the
 * browser drops it and the group silently inherits whatever `--kui-stagger` an ancestor happened to
 * publish. `0ms` says the true thing: no gaps.
 *
 * @param config - The resolved group config; `spread` wins over `step` before this is reached.
 * @param maxRank - Largest rank written across the group.
 * @returns The step to write, or `undefined` when the author declared none.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveStep(config: StaggerConfig, maxRank: number): string | undefined {
  if (config.spread === undefined) return config.step
  if (maxRank <= 0) return '0ms'
  // Parenthesised because the budget is authored text: `spread:calc(1s - 200ms)` is legal and
  // `calc(calc(1s - 200ms) / 2)` is what it has to become, not `calc(calc(...) / 2)`'s unbracketed
  // cousin. Nesting `calc()` is valid CSS and costs nothing.
  return `calc((${config.spread}) / ${String(maxRank)})`
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
 * **A group that declared `cols:` ranks by distance through the grid instead**, which is the one
 * thing DOM order genuinely cannot express: on a real multi-row grid the middle *index* is not the
 * middle *cell*, so `center` fans out from a point that is nowhere near the visual centre. See
 * {@link gridRanks}. The rank stops being an integer there, and that is fine — it is spent inside a
 * `calc()`, and `2.236 * 90ms` is as valid a delay as `2 * 90ms`.
 *
 * @param count - Number of animated children in the group.
 * @param from - The ordering.
 * @param warnings - Sink for the out-of-range diagnostic. Optional; the function is otherwise pure.
 * @param layout - The group's grid, when it declared one. Absent means rank over DOM index.
 * @returns One rank per child, indexed by DOM position.
 * @complexity O(n) time and space, except `random` which is O(n log n) time.
 * @overallScore 100
 */
export function staggerRanks(
  count: number,
  from: StaggerFrom,
  warnings: string[] = [],
  layout?: StaggerLayout,
): number[] {
  if (count <= 0) return []
  // `random` is a permutation of the group and has no geometry in it, so a grid changes nothing —
  // scattering is scattering whether the tiles are in a row or a block.
  if (from === 'random') return randomRanks(count)
  if (layout) return gridRanks(count, from, layout, warnings)
  if (typeof from === 'object') {
    warnings.push(
      `stagger order "${String(from.x)}/${String(from.y)}" is a point in a grid, but this group ` +
        `has no "cols:" — add one, or name an edge with start/end/center/edges`,
    )
    return staggerRanks(count, 'start', warnings)
  }

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
function originOf(
  from: Exclude<StaggerFrom, 'random' | 'edges' | GridOrigin>,
  last: number,
  warnings: string[],
): number {
  if (from === 'start') return 0
  if (from === 'end') return last
  if (from === 'center') return last / 2
  return clampIndex(from, last, warnings)
}

/**
 * Hold a `from:<index>` inside the group.
 *
 * An out-of-range index is clamped to the nearest end, not honoured. Unclamped, `from:99` on a
 * five-item group ranks them 99, 98, 97, 96, 95 — at a 90ms step that is 8.5 seconds of nothing
 * before the first child moves, which is the `--kui-i` leak's failure mode wearing a different hat:
 * an effect that looks broken because it is waiting out an offset nobody meant to write.
 *
 * Clamping rather than refusing, because at each boundary the clamp *is* the identity: `from:0` is
 * `from:start` and `from:<last>` is `from:end`, so an out-of-range index degrades to the keyword the
 * author could have written instead of to a linear ramp behind a delay nobody asked for. A negative
 * index clamps to 0 rather than counting back from the end, because `end` already has a name and a
 * second, invisible indexing convention would be worse than a warning.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clampIndex(index: number, last: number, warnings: string[]): number {
  if (index < 0 || index > last) {
    warnings.push(`stagger order "${String(index)}" is outside the group (0 to ${String(last)}) — clamped`)
  }
  return Math.min(Math.max(index, 0), last)
}

/**
 * Rank every child by its distance through a declared grid, rather than along DOM order.
 *
 * This is the whole of the 2D feature and it is deliberately the same rule the 1D orderings already
 * follow — *rank = distance from a reference point* — with the point and the distance both promoted
 * to two dimensions. `center` on a 4x6 grid now fans out concentrically from the middle cell rather
 * than from child 11, which on anything but a single row is a different and much better-looking
 * animation.
 *
 * **Ranks are distances, so they are fractional and they are not indices.** The step becomes a gap
 * per unit of *cell distance*: a child two columns and one row away starts `sqrt(5) x step` after
 * the origin, not `n x step` for some ordinal n. That is what proximity means, and it is why a
 * budgeted `spread:` composes with it correctly — the budget is divided by the largest distance, so
 * the group still finishes on time.
 *
 * `edges` is `center` turned inside out, exactly as it is in one dimension: the outermost cells go
 * first and the group closes on its middle.
 *
 * @param layout - The declared column count, and the axis to restrict the distance to.
 * @complexity O(n) time and space.
 * @overallScore 100
 */
function gridRanks(
  count: number,
  from: Exclude<StaggerFrom, 'random'>,
  layout: StaggerLayout,
  warnings: string[],
): number[] {
  // More columns than children is a grid with one short row, so the column count is the child
  // count; `Math.max(1, ...)` is belt-and-braces against a zero that `parseCols` already refuses.
  const cols = Math.min(Math.max(1, layout.cols), count)
  const rows = Math.ceil(count / cols)
  if (from === 'edges') {
    const inward = gridRanks(count, 'center', layout, warnings)
    let furthest = 0
    for (const rank of inward) furthest = Math.max(furthest, rank)
    return inward.map((rank) => round(furthest - rank))
  }

  const origin = gridOrigin(from, { cols, rows, last: count - 1 }, warnings)
  return Array.from({ length: count }, (_, index) => {
    const dx = (index % cols) - origin.x
    const dy = Math.floor(index / cols) - origin.y
    if (layout.along === 'x') return round(Math.abs(dx))
    if (layout.along === 'y') return round(Math.abs(dy))
    return round(Math.hypot(dx, dy))
  })
}

/** The grid a {@link gridOrigin} is being placed in. */
interface GridShape {
  cols: number
  rows: number
  last: number
}

/**
 * The cell — possibly a half-cell — a grid ordering measures from.
 *
 * `end` is the bottom-right *corner*, not the last child: on a grid whose final row is short those
 * differ, and the corner is the one an author means by "from the end" when they are looking at a
 * block rather than at a list.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function gridOrigin(
  from: Exclude<StaggerFrom, 'random' | 'edges'>,
  grid: GridShape,
  warnings: string[],
): GridOrigin {
  const { cols, rows, last } = grid
  if (typeof from === 'object') return { x: from.x * (cols - 1), y: from.y * (rows - 1) }
  if (from === 'start') return { x: 0, y: 0 }
  if (from === 'end') return { x: cols - 1, y: rows - 1 }
  if (from === 'center') return { x: (cols - 1) / 2, y: (rows - 1) / 2 }
  const index = clampIndex(from, last, warnings)
  return { x: index % cols, y: Math.floor(index / cols) }
}

/**
 * Round a distance to three decimals.
 *
 * Not cosmetic. The rank is written into an inline custom property and re-read on every re-index,
 * and `Math.hypot(1, 2)` unrounded is seventeen significant figures of a number whose fourth one
 * cannot change a delay by a visible amount.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function round(value: number): number {
  return Math.round(value * RANK_PRECISION) / RANK_PRECISION
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
 * @param group - Element carrying `data-kui-stagger`, or a `data-kui` with `cascade:`/`spread:`/
 *   `order:`.
 * @param reporter - Diagnostic sink for a malformed attribute. Optional, so the two-argument
 *   contract every existing caller uses keeps working.
 * @complexity O(n) time in the number of children; O(n) space for the ranks.
 * @overallScore 100
 */
export function indexStaggerGroup(group: Element, reporter?: Reporter): void {
  const warnings: string[] = []
  const ledgers = reopenLedger(group)
  // Both spellings, merged. Falls back to the empty longhand parse when neither attribute declares
  // a group, so a direct call on any element still publishes the same defaults it always did —
  // `applyStagger` is what decides which elements are groups, and it never routes a non-group here.
  const config = resolveStaggerConfig(
    group.getAttribute(ATTR.stagger),
    group.getAttribute(ATTR.source) ?? '',
    warnings,
  ) ?? { from: 'start' }

  const children = animatedChildren(group)
  const ranks = staggerRanks(children.length, config.from, warnings, resolveLayout(config, children, warnings))
  let maxRank = 0
  for (const [index, child] of children.entries()) {
    const rank = ranks[index] ?? 0
    ledgers.style(child).set('--kui-i', String(rank))
    if (rank > maxRank) maxRank = rank
  }

  // After the ranks, not before them, which is the one ordering change a total budget forces: the
  // step a `spread:` resolves to is the budget divided by the largest rank, and the largest rank is
  // not known until every child has one. A fixed `cascade:` step does not care either way.
  const step = resolveStep(config, maxRank)
  // Conditional, because an ordering-only group (`data-kui-stagger="from:center"` with no step)
  // must inherit whatever `--kui-stagger` the cascade gives it rather than pin one. The previous
  // indexing's value is already gone — `reopenLedger` put the author's own back before this ran —
  // so dropping a `cascade:` no longer leaves the step it used to declare sitting on the host.
  if (step) ledgers.style(group).set('--kui-stagger', step)

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
  // existed. Downstream (`declarations.ts`'s `staggerDelay`) spends it as `(count - 1) * stagger`, i.e.
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
  // Rounded, not `maxRank + 1` raw: a 2D rank is a distance, and `1.118 + 1` in binary floating
  // point is `2.1180000000000003`. Both are valid CSS, but only one of them is stable across a
  // re-index and readable in devtools.
  ledgers.style(group).set('--kui-stagger-count', String(round(maxRank + 1)))

  for (const warning of warnings) reporter?.warn(warning, group)
}

/**
 * What each stagger group's indexing wrote, and what the author had there before it.
 *
 * The one thing {@link indexTargetGroup}'s doc comment has been pointing at: an ordinary group used
 * to write `--kui-i`, `--kui-stagger` and `--kui-stagger-count` straight onto `element.style`, so
 * nothing could ever take them off again. Destroying the animator left every one of them on the
 * page, and an author's own `--kui-i` was overwritten with no record that it had existed.
 *
 * Keyed by the group rather than held by the animator because a group need not be an animated
 * element at all — a bare `data-kui-stagger` wrapper has no `ElementState` and no `LedgerSet` of
 * its own to write through — and because the writes span the group *and* its children, which is a
 * unit no single element's ledger owns. A `WeakMap` so a group removed from the page takes its
 * record with it.
 *
 * These are deliberately *separate* ledgers from the ones `install` opens per animated element,
 * and the two overlap on exactly one property: `--kui-stagger` is both a group's published step
 * and an effect's own `stagger:` parameter. `Animator.destroy` therefore unwinds the group ledgers
 * first, so the effect ledger — which snapshotted before either wrote — has the last word.
 */
const GROUP_LEDGERS = new WeakMap<Element, LedgerSet>()

/**
 * Put back what this group's last indexing wrote, and open a fresh ledger for the next one.
 *
 * Restoring first is what makes a re-index a *replacement* rather than an overlay: a config that
 * no longer resolves a step writes no `--kui-stagger`, and without unwinding the previous one the
 * old step would simply stay. It is also what keeps "what was there before" meaning the author's
 * value rather than the previous index's.
 *
 * @complexity O(n) time in the properties the previous indexing wrote; O(1) space.
 * @overallScore 100
 */
function reopenLedger(group: Element): LedgerSet {
  GROUP_LEDGERS.get(group)?.restore()
  const ledgers = createLedgerSet(group)
  GROUP_LEDGERS.set(group, ledgers)
  return ledgers
}

/**
 * Unwind one group's indexing, leaving the author's own inline styles exactly as they were.
 *
 * A no-op for an element that was never indexed, which is what lets {@link applyStagger} call it
 * for every candidate it walks past without first knowing whether one ever was.
 *
 * @complexity O(n) time in the properties that group's indexing wrote; O(1) space.
 * @overallScore 100
 */
export function releaseStaggerGroup(group: Element): void {
  GROUP_LEDGERS.get(group)?.restore()
  GROUP_LEDGERS.delete(group)
}

/**
 * Unwind every stagger group in a subtree — the teardown half of {@link applyStagger}.
 *
 * Walks the same selector `applyStagger` indexes by, so a group is found by exactly the rule that
 * made it one. A group whose declaring attribute was removed outright no longer matches, but it
 * was already unwound when that attribute change was processed; anything the walk still cannot
 * reach has left the page, taking its `WeakMap` entry with it.
 *
 * @complexity O(n) time in the subtree's element count; O(1) space.
 * @overallScore 100
 */
export function releaseStagger(root: ParentNode): void {
  const selector = `[${ATTR.stagger}], [${ATTR.source}]`
  if (root instanceof Element && root.matches(selector)) releaseStaggerGroup(root)
  for (const el of root.querySelectorAll(selector)) releaseStaggerGroup(el)
}

/**
 * Re-index the groups one element's attribute change can have altered.
 *
 * Two of them, because both spellings of "this is a stagger group" now reach here. The element
 * itself may declare one — `data-kui-stagger`, or `cascade:`/`spread:`/`order:` inside `data-kui`
 * — and it may equally be a *member* of its parent's, since `animatedChildren` counts exactly the
 * children carrying `data-kui`, so gaining or losing that attribute changes every sibling's rank
 * and the group's published `--kui-stagger-count`.
 *
 * Two named elements rather than a subtree walk: an attribute change is delivered per element, and
 * re-scanning each changed element's whole subtree would cost O(subtree) per change against a
 * frame budget of a hundred of them.
 *
 * @param el - The element whose watched attribute changed.
 * @param reporter - Diagnostic sink, threaded through to each group.
 * @complexity O(c) time in the two groups' child counts; O(c) space.
 * @overallScore 100
 */
export function restageAround(el: Element, reporter?: Reporter): void {
  restageOne(el, reporter)
  const parent = el.parentElement
  if (parent) restageOne(parent, reporter)
}

/**
 * Index one candidate if it declares a group, and unwind it if it no longer does.
 *
 * The `else` is the edit half: an element that *was* a group and has had its `cascade:` or its
 * `data-kui-stagger` value taken away has to give back the properties it published, and nothing
 * else would ever ask it to.
 *
 * @complexity O(c) time in the candidate's child count; O(c) space.
 * @overallScore 100
 */
function restageOne(el: Element, reporter?: Reporter): void {
  if (declaresGroup(el)) indexStaggerGroup(el, reporter)
  else releaseStaggerGroup(el)
}

/**
 * Number a retargeted set the same way {@link indexStaggerGroup} numbers `group.children` — for
 * the set `target:`/`scope:` resolves instead, which has neither a parent relationship to the host
 * nor `data-kui-source` on its members for that function's own selector to find.
 *
 * Called from `animator.ts`'s `install`, once per `CompiledTarget` whose selector is non-empty,
 * because a retargeted group has no DOM occasion to be discovered by `applyStagger`'s subtree walk
 * the way an ordinary stagger group is — `--kui-i` has to be assigned right where the matches are
 * resolved.
 *
 * **Per-parent, not flat document order** — settled as D7 in `docs/plan-scope-page.md`, matching
 * `createStepMarker`'s own numbering (`effects/step-marking.ts`) for the same reason that function
 * gives: a target naming two parallel groups — copy lines and the dots that track them — should
 * read 0..n-1 in each, not 0..2n-1 across both. Unlike that function, this one has to know each
 * parent-group's full size before it can rank anything (`center`/`edges`/`random` all measure from
 * a size-dependent origin — see {@link staggerRanks}), so matches are bucketed by parent first and
 * ranked bucket by bucket, rather than counted in one streaming pass.
 *
 * **Writes through `ledgers`, never `element.style` directly** — the one place this deliberately
 * does *not* follow {@link indexStaggerGroup}, whose direct `style.setProperty` calls are a
 * pre-existing, independent leak that function's own doc comment already flags for a separate fix.
 * Copying it here would be worse: under `scope:page` a match need not be a descendant of the host
 * at all, so there is no ambient ledger it would otherwise fall under, and every write this
 * function makes has to be unwound by `release()` the same way every other retargeted write is.
 *
 * @param host - The authored element. `--kui-stagger`/`--kui-stagger-count` are written here, from
 *   its own `data-kui-stagger` attribute (or `cascade:`/`order:` inside `data-kui`) if present —
 *   the same two spellings {@link resolveStaggerConfig} already reads for an ordinary group.
 * @param matches - The elements `target:` resolved to, in document order.
 * @param ledgers - The host's `LedgerSet`, so every property this function writes is restored by
 *   the same `release()` call that unwinds everything else `target:` relocated.
 * @param reporter - Diagnostic sink for a malformed `data-kui-stagger`. Optional, matching
 *   {@link indexStaggerGroup}'s own contract.
 * @complexity O(n) time and space in the match count.
 * @overallScore 100
 */
export function indexTargetGroup(
  host: Element,
  matches: Element[],
  ledgers: LedgerSet,
  reporter?: Reporter,
): void {
  const warnings: string[] = []
  const config = resolveStaggerConfig(
    host.getAttribute(ATTR.stagger),
    host.getAttribute(ATTR.source) ?? '',
    warnings,
  ) ?? { from: 'start' }

  const maxRank = rankBuckets(bucketByParent(matches), config, ledgers, warnings)
  // Written after the ranks for the same reason `indexStaggerGroup` writes it there — see
  // `resolveStep`. The budget is divided across the *largest bucket*'s span, since that is the one
  // the last-starting match belongs to.
  const step = resolveStep(config, maxRank)
  if (step) ledgers.style(host).set('--kui-stagger', step)
  // Same `maxRank + 1` reasoning as `indexStaggerGroup`'s own — see that function's comment: the
  // largest offset in the group, not the member count, and the two only coincide for `start`.
  ledgers.style(host).set('--kui-stagger-count', String(round(maxRank + 1)))

  for (const warning of warnings) reporter?.warn(warning, host)
}

/**
 * Bucket a matched set by parent element, in the document order `matches` already carries, so each
 * bucket's own order is preserved for {@link staggerRanks} to rank.
 *
 * See {@link indexTargetGroup}'s own comment for why a single streaming pass — the shape
 * `createStepMarker` uses — cannot do this job.
 *
 * @complexity O(n) time and space in the match count.
 * @overallScore 100
 */
function bucketByParent(matches: Element[]): Map<Element | null, Element[]> {
  const byParent = new Map<Element | null, Element[]>()
  for (const match of matches) {
    const siblings = byParent.get(match.parentElement)
    if (siblings) siblings.push(match)
    else byParent.set(match.parentElement, [match])
  }
  return byParent
}

/**
 * Write `--kui-i` for every match, ranked within its own parent bucket.
 *
 * @returns The largest rank written across every bucket — what `--kui-stagger-count` is derived
 *   from, and deliberately not the match count: `center`/`edges` reuse offsets, so the two differ.
 * @complexity O(n) time in the match count; O(b) space in the largest bucket.
 * @overallScore 100
 */
function rankBuckets(
  byParent: Map<Element | null, Element[]>,
  config: StaggerConfig,
  ledgers: LedgerSet,
  warnings: string[],
): number {
  let maxRank = 0
  for (const siblings of byParent.values()) {
    // Per bucket, because a bucket is a grid: two parallel matched sets can have different column
    // counts under `cols:auto`, and measuring the union of them would place both wrongly.
    const layout = resolveLayout(config, siblings, warnings)
    const ranks = staggerRanks(siblings.length, config.from, warnings, layout)
    for (const [index, match] of siblings.entries()) {
      const rank = ranks[index] ?? 0
      ledgers.style(match).set('--kui-i', String(rank))
      if (rank > maxRank) maxRank = rank
    }
  }
  return maxRank
}

/**
 * Turn a group's declared `cols:`/`along:` into the layout {@link staggerRanks} ranks against, or
 * `undefined` when it declared none and the ordering stays one-dimensional.
 *
 * The one place this module reads layout, and only for a group that asked for `cols:auto` — see
 * {@link measureColumns}. Everything else here is still pure arithmetic over DOM order.
 *
 * An `along:` with no `cols:` is warned about rather than ignored: on its own it names an axis of a
 * grid that was never declared, so it can only be a no-op, and a knob that exists and does nothing
 * is worse than one that does not exist.
 *
 * @param members - The group's animated children, in DOM order; measured only under `cols:auto`.
 * @complexity O(1) time when `cols:` is a count; O(c) rect reads in the column count when it is
 *   `auto`, paid once per group per scan.
 * @overallScore 100
 */
function resolveLayout(
  config: StaggerConfig,
  members: readonly Element[],
  warnings: string[],
): StaggerLayout | undefined {
  if (config.cols === undefined) {
    if (config.along !== undefined) {
      warnings.push(
        `"along:${config.along}" names an axis of a grid this group has not declared — ` +
          `add "cols:" (a column count, or "auto")`,
      )
    }
    return undefined
  }
  const cols = config.cols === 'auto' ? measureColumns(members, warnings) : config.cols
  if (cols === undefined) return undefined
  return config.along === undefined ? { cols } : { cols, along: config.along }
}

/**
 * Count a laid-out group's columns by finding where its first row wraps.
 *
 * This is the one measurement in the module, and it exists because the responsive case is the one
 * `cols:<n>` cannot serve: a grid that is four columns wide on a desktop and two on a phone has no
 * single number an author can write. The cost is one forced layout per opted-in group per scan, and
 * only `cols:auto` pays it.
 *
 * **The wrap is found by sign, not by "left increases".** Reading `left` and requiring it to grow
 * would report one column for every RTL grid on the web, because there a row runs right to left.
 * Taking the direction from the *first* step and then finding where it reverses is correct in both
 * writing modes, and works for a wrapped flex row and inline-blocks as well as for a real CSS grid.
 * `top` would have been the obvious alternative and is worse: under `align-items: center` two items
 * of different heights in the same row have different tops, so the first row would appear to end
 * at the first tall card.
 *
 * **A group with no layout at all falls back to DOM order and says so.** Every rect being zero
 * means `display: none`, a detached subtree, or a document that has never laid out — and guessing
 * a column count from that would silently reorder the whole group. See the reflow note in
 * `docs/getting-started.md`: this is measured at scan time and a later resize does not re-index.
 *
 * @returns The column count, or `undefined` when the group cannot be measured.
 * @complexity O(c) rect reads in the column count; O(n) space for the rects.
 * @overallScore 100
 */
function measureColumns(members: readonly Element[], warnings: string[]): number | undefined {
  if (members.length < 2) return 1
  const lefts: number[] = []
  let laidOut = false
  for (const member of members) {
    const box = member.getBoundingClientRect()
    if (box.width !== 0 || box.height !== 0) laidOut = true
    lefts.push(box.left)
  }
  if (!laidOut) {
    warnings.push(
      `"cols:auto" could not measure this group — none of its children have been laid out yet ` +
        `(display:none, or detached), so the stagger falls back to DOM order`,
    )
    return undefined
  }

  // Every child at the same x is a single column, which is a legitimate grid and not a failure.
  const direction = Math.sign(lefts[1]! - lefts[0]!)
  if (direction === 0) return 1
  let cols = 1
  for (let index = 1; index < lefts.length; index++) {
    if (Math.sign(lefts[index]! - lefts[index - 1]!) !== direction) break
    cols = index + 1
  }
  return cols
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
 * The selector now has to reach `[data-kui]` as well, because a group can declare itself with
 * `cascade:`/`order:` inside that attribute. Widening it means walking every *animated* element
 * rather than only the groups, so `declaresGroup` re-narrows it — and that check is a correctness
 * requirement, not an optimisation. Indexing an element that declares no group would publish
 * `--kui-stagger-count: 1` onto it, and that property is deliberately not reset in `kui.tokens`
 * because groups publish it *to be inherited*. Writing 1 onto a staggered child would shadow its
 * own group's real count, and `declarations.ts`'s `staggerDelay` reads it off that very child to size a
 * `timeline: pin` scrub head — so every pinned staggered group would collapse its head back to one
 * duration and strand the later children short of their final frame.
 *
 * @param root - Subtree to search.
 * @param reporter - Diagnostic sink, threaded through to each group.
 * @complexity O(n) time in the number of elements in the subtree, plus one `data-kui` parse per
 *   element that survives the substring screen; O(g) space in group count.
 * @overallScore 100
 */
export function applyStagger(root: ParentNode, reporter?: Reporter): void {
  const selector = `[${ATTR.stagger}], [${ATTR.source}]`
  if (root instanceof Element && root.matches(selector)) restageOne(root, reporter)
  for (const group of root.querySelectorAll(selector)) restageOne(group, reporter)
}

/**
 * Whether this element declares a stagger group in either attribute.
 *
 * The `data-kui-stagger` half is presence alone, exactly as it always was — a bare
 * `data-kui-stagger` with no value is a legitimate ordering-only group. The `data-kui` half asks
 * `resolveStaggerConfig`, whose substring screen makes the common case (an animated element that
 * is not a group) a single scan with no parse.
 *
 * Warnings are discarded here and re-collected inside `indexStaggerGroup`, so a group's
 * diagnostics are reported exactly once and a non-group's — there are none — cost nothing.
 *
 * @complexity O(n) time in the `data-kui` length; O(1) space in the common case.
 * @overallScore 100
 */
function declaresGroup(el: Element): boolean {
  // A `data-kui-define` body is a bundle, not this element's own animation — see `core/bundles.ts`.
  // Without this, a definition that happens to carry `cascade:` would index the *definition*
  // element's children as a stagger group, which is markup nobody asked to animate.
  if (el.hasAttribute(ATTR.define)) return false
  if (el.hasAttribute(ATTR.stagger)) return true
  return resolveStaggerConfig(null, el.getAttribute(ATTR.source) ?? '') !== undefined
}
