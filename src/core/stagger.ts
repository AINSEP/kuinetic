import { ATTR } from './attrs.js'
import type { LedgerSet } from './owned-styles.js'
import { isSafeCssValue } from './params.js'
import { parse, splitTopLevel } from './parse.js'
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
  /**
   * A total time budget for the whole group, instead of a per-item step — GSAP's `stagger.amount`
   * beside `step`'s `stagger.each`.
   *
   * The two are alternatives, never a pair: {@link resolveStep} divides this by the group's largest
   * rank to *produce* the step, so a group carrying both would be asking for two different steps.
   * Where both are written, this one wins and the step is named in a warning.
   *
   * Unvalidated beyond the escape screen, for `step`'s exact reason — it is divided inside a
   * `calc()`, and `var(--speed)` divides as well as `600ms` does.
   */
  spread?: string
  from: StaggerFrom
}

const FROM_KEYWORDS: ReadonlySet<string> = new Set(['start', 'end', 'center', 'edges', 'random'])

/**
 * The two spellings of the ordering key inside `data-kui-stagger`.
 *
 * `from:` is the original and stays supported forever — it is the word GSAP uses and the one this
 * branch shipped with. `order:` is the same key under the name the `data-kui` hoist had to use,
 * because `from` is a parameter on eighteen primitives and could not be lifted element-wide (see
 * `HOISTS` in `parse.ts`). Accepting both here is what stops an author having to remember that
 * the word changes depending on which attribute they happen to be writing in.
 */
const ORDER_KEYS: ReadonlySet<string> = new Set(['from', 'order'])

/**
 * The total-budget spelling, accepted in this attribute under the same word `data-kui` hoists it
 * as. Unlike the step it has no positional form: the bare first token has meant "a per-item step"
 * since before this existed, and a second bare token that quietly meant something else would be
 * the worst possible way to spend the one positional slot this grammar has.
 */
const SPREAD_KEY = 'spread'

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
 * This attribute is no longer the only home for a group declaration — `data-kui` now carries the
 * same two settings as `cascade:` and `order:` (see `HOISTS` in `parse.ts`, and
 * `resolveStaggerConfig` below for how the two spellings merge). What has not changed is *why the
 * words differ between the two attributes*, and the reasoning is worth keeping because it is what
 * fixes the names:
 *
 *  1. The group parent usually has no `data-kui` at all — it is a bare `<div class="grid">` in
 *     every one of the demo pages. So this attribute cannot be retired: a hoist-only design would
 *     force an author to invent an effect for a wrapper that is not animating.
 *  2. `data-kui`'s grammar is per-*effect*: `data-kui="fade-up, zoom-in"` is two specs. Ordering
 *     is a property of the group, not of an effect, which is why the `data-kui` spelling had to be
 *     an element-wide hoist rather than an ordinary parameter.
 *  3. `from:` is already taken inside `data-kui`, by eighteen primitives. `count-up from:0`,
 *     `scale-in from:1`, `gradient-shift from:#f00`, `path-morph from:...` — it is one of the most
 *     common parameter names in the catalog. A group ordering spelled `from:` there would be
 *     ambiguous with all of them and unresolvable, because `resolveParams` cannot know whether the
 *     author meant the effect's parameter or the group's order. That is an argument about the
 *     *word*, not the attribute, so the hoisted spelling is `order:` and this attribute keeps
 *     `from:` — and now accepts `order:` too, so one word works in both places.
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
  return parseStaggerTokens(value, warnings).config
}

/**
 * The parse above, plus whether the author actually wrote an ordering.
 *
 * `StaggerConfig.from` cannot answer that: it is `'start'` both when the author wrote
 * `from:start` and when they wrote nothing at all, and `resolveStaggerConfig` needs the
 * difference — otherwise `data-kui-stagger="90ms"` beside `data-kui="order:center"` reports a
 * conflict with a value nobody wrote. Kept off `StaggerConfig` rather than added to it because
 * that type is the module's public shape and an always-present flag would be a field every
 * consumer has to ignore.
 *
 * @complexity O(n) time in the attribute length; O(n) space for the tokens.
 * @overallScore 100
 */
function parseStaggerTokens(
  value: string,
  warnings: string[],
): { config: StaggerConfig; sawFrom: boolean } {
  const config: StaggerConfig = { from: 'start' }
  const seen = { from: false, spread: false }

  // Paren- and quote-aware, so `calc(90ms * 2)` survives as one token rather than three. That is
  // the same tokenizer `data-kui` uses; a plain `.split(' ')` here would shred exactly the values
  // this attribute has always accepted.
  for (const token of splitTopLevel(value, ' ', warnings)) {
    const pair = PAIR_RE.exec(token)
    if (pair) applyStaggerPair(pair[1] ?? '', pair[2] ?? '', { config, seen, warnings })
    else config.step = keepFirstStep(config.step, token, warnings)
  }
  return { config, sawFrom: seen.from }
}

/** What {@link applyStaggerPair} is filling in, grouped so the call site stays one argument. */
interface StaggerParseState {
  config: StaggerConfig
  seen: { from: boolean; spread: boolean }
  warnings: string[]
}

/**
 * Apply one `key:value` token from `data-kui-stagger`.
 *
 * Split out of {@link parseStaggerTokens} to keep that function's branch count under the budget;
 * every rule it implements is documented inline below.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function applyStaggerPair(key: string, raw: string, state: StaggerParseState): void {
  const { config, seen, warnings } = state
  if (key === SPREAD_KEY) {
    if (seen.spread) warnings.push(`duplicate "spread:" in data-kui-stagger — "${raw}" ignored`)
    else config.spread = raw.trim()
    seen.spread = true
    return
  }
  if (!ORDER_KEYS.has(key)) {
    warnings.push(
      `unrecognised key "${key}" in data-kui-stagger — ` +
        `expected a time step, "spread:", "from:" or "order:"`,
    )
    return
  }
  // First one wins, matching `assignOnce` in `parse.ts`: a second, differing value across the
  // same attribute is a mistake, and letting the last one win makes which mistake you get depend
  // on token order. One flag rather than one per spelling, because `from:` and `order:` are the
  // same key — writing both is the same mistake as writing `from:` twice, not a second chance.
  if (seen.from) {
    warnings.push(`duplicate "${key}:" in data-kui-stagger — "${raw}" ignored`)
    return
  }
  seen.from = true
  config.from = parseFrom(raw, warnings)
}

/**
 * Merge the two spellings of a group declaration into one config.
 *
 * `data-kui-stagger="90ms from:center"` and `data-kui="cascade:90ms order:center"` are the same
 * request written two ways, and both have to keep working — the longhand appears on 77 group
 * elements in the demo pages alone and predates the hoist.
 *
 * **Merged per key, not per attribute.** `data-kui-stagger="90ms"` on a grid whose `data-kui` says
 * `order:center` is a perfectly coherent thing to have written while migrating, and blanking the
 * step because the *other* attribute happened to mention ordering would be a silent regression of
 * exactly the kind this module keeps warning about. So each key is resolved on its own and only a
 * genuine disagreement about the same key is a conflict.
 *
 * **Where they disagree, `data-kui` wins and the longhand is named.** Not a coin toss:
 * `element-config.ts` already resolves `on:`/`timeline:`/`threshold:` this way — "values written
 * inline are a convenience that takes precedence over the longhand attribute" — and a fourth and
 * fifth key that resolved the *other* way would make the precedence rule something an author has
 * to memorise per key instead of learn once. Naming the loser by value is what turns "why is my
 * stagger 90ms when I wrote 200ms" into a one-line answer.
 *
 * @param attribute - Raw `data-kui-stagger` text, or `null` when the element has none.
 * @param source - Raw `data-kui` text; only its hoisted `cascade:`/`order:` keys are read.
 * @param warnings - Sink for conflict and grammar diagnostics.
 * @returns The resolved group config, or `undefined` when neither attribute declares a group at
 *   all — which is how `applyStagger` tells a group element from any other animated element.
 * @complexity O(n) time in the two attributes' combined length; O(n) space for their tokens.
 * @overallScore 100
 */
export function resolveStaggerConfig(
  attribute: string | null,
  source: string,
  warnings: string[] = [],
): StaggerConfig | undefined {
  // `parse()` is re-run here rather than threaded down from `animator.process()`, and its warnings
  // are deliberately dropped: `process()` has already reported every one of them against this same
  // element, so forwarding them would double every grammar diagnostic on the page. Only the two
  // hoisted values are taken. The cost is one extra parse per *group*, not per animated element —
  // `hasGroupKey` screens the rest out for a substring scan.
  const inline = inlineGroupKeys(source)
  if (attribute === null && inline === undefined) return undefined

  const { config: longhand, sawFrom } = parseStaggerTokens(attribute ?? '', warnings)
  return oneStepMode(screenStep(mergeInline(longhand, sawFrom, inline ?? {}, warnings), warnings), warnings)
}

/**
 * Reduce a config that states both a per-item step and a total budget to the one it can honour.
 *
 * The budget wins, and the rule is deliberately order-independent — the same answer whichever
 * attribute each half arrived in and whichever order the tokens were written in. `spread:` is a
 * constraint on the whole group ("everybody has started by 600ms") and `step` is the quantity a
 * budget *solves for*, so honouring the budget is the one reading under which both statements
 * cannot visibly contradict the result. Naming the loser is what keeps that from being a silent
 * choice; `parse.ts` names the same conflict when both spellings sit in one `data-kui`, and this is
 * the check that also catches the cross-attribute case.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function oneStepMode(config: StaggerConfig, warnings: string[]): StaggerConfig {
  if (config.spread === undefined || config.step === undefined) return config
  warnings.push(
    `stagger step "${config.step}" is ignored — "spread:${config.spread}" already budgets the ` +
      `whole group, and the step is what it divides out`,
  )
  return { from: config.from, spread: config.spread }
}

/**
 * The hoisted group keys in a `data-kui` value, or `undefined` when it declares no group.
 *
 * Two stages, and the first is what keeps this cheap. `hasGroupKey` is a substring scan run
 * against every animated element in the subtree; `parse()` only runs for the few that survive it,
 * and only its verdict — did a hoist actually land? — reaches the caller. `border:` ends in
 * `order:` and gets through the scan, which is exactly why the parse has the final say.
 *
 * @complexity O(n) time in the attribute length; O(1) space in the common case, O(n) when parsed.
 * @overallScore 100
 */
function inlineGroupKeys(source: string): InlineGroupKeys | undefined {
  if (!hasGroupKey(source)) return undefined
  // `parse()`'s warnings are deliberately dropped: `animator.process()` has already reported every
  // one of them against this same element, so forwarding them would double every grammar
  // diagnostic on the page. Only the hoisted values are taken.
  const { cascade, spread, order } = parse(source)
  if (cascade === undefined && spread === undefined && order === undefined) return undefined
  return { cascade, spread, order }
}

/** The hoisted group keys, exactly as `parse()` returns them. */
interface InlineGroupKeys {
  cascade?: string
  spread?: string
  order?: string
}

/**
 * Drop a step that could escape the declaration it is about to be written into.
 *
 * The step is written to a custom property verbatim, and `data-kui` is not always authored by the
 * site owner — a CMS field or a comment can reach it, which is the threat model `params.ts` is
 * built around. Every *other* value in that attribute goes through `validate()` before it reaches
 * `style.setProperty`; this one never has, because narrowing it to a `<time>` literal would break
 * the `var(--speed)` and `calc(90ms * 2)` steps `data-kui-stagger` has always accepted. The escape
 * screen is the half of that validation those forms pay nothing for, so both spellings get it.
 *
 * Dropped rather than defaulted, and warned by name: there is no safe step to substitute, and a
 * group with no step is a group that does not stagger, which is visible.
 *
 * The total budget gets the identical treatment, and needs it slightly more: it is written into a
 * `calc()` rather than straight into the property, so an escape there would land inside an
 * expression rather than beside one.
 *
 * A rebuilt object rather than a `delete`, so `StaggerConfig`'s optional fields are genuinely
 * absent under `exactOptionalPropertyTypes` rather than present-and-undefined.
 *
 * @complexity O(n) time in the two values' length; O(1) space.
 * @overallScore 100
 */
function screenStep(config: StaggerConfig, warnings: string[]): StaggerConfig {
  const screened: StaggerConfig = { from: config.from }
  if (keepValue('step', config.step, warnings)) screened.step = config.step
  if (keepValue('spread', config.spread, warnings)) screened.spread = config.spread
  return screened
}

/**
 * Whether one authored time value survives the escape screen. Absent values pass silently — there
 * is nothing to refuse — and a refused one is named, because the substitute (no step at all) is a
 * group that does not stagger, which is visible but not self-explaining.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function keepValue(label: 'step' | 'spread', value: string | undefined, warnings: string[]): value is string {
  if (value === undefined) return false
  if (isSafeCssValue(value)) return true
  warnings.push(`stagger ${label} "${value}" contains disallowed CSS syntax — ignored`)
  return false
}

/**
 * Overlay the hoisted `cascade:`/`order:` values on the longhand parse, one key at a time.
 *
 * Split out of `resolveStaggerConfig` only to keep that function under the complexity budget; the
 * precedence rule it implements is documented there.
 *
 * @param longhand - The `data-kui-stagger` parse.
 * @param sawFrom - Whether the longhand actually wrote an ordering, as opposed to defaulting.
 * @param inline - The two hoisted values, either or both absent.
 * @complexity O(1) time and space beyond the ordering parse.
 * @overallScore 100
 */
function mergeInline(
  longhand: StaggerConfig,
  sawFrom: boolean,
  inline: InlineGroupKeys,
  warnings: string[],
): StaggerConfig {
  const config: StaggerConfig = { ...longhand }
  if (inline.cascade !== undefined) {
    warnOverride('stagger step', longhand.step, inline.cascade, warnings)
    config.step = inline.cascade
  }
  if (inline.spread !== undefined) {
    warnOverride('stagger budget', longhand.spread, inline.spread, warnings)
    config.spread = inline.spread
  }
  if (inline.order !== undefined) {
    const order = parseFrom(inline.order, warnings, 'order')
    // `sawFrom`, not `longhand.from`: an unwritten ordering reads as `'start'`, so comparing the
    // values alone would report a conflict against markup nobody wrote.
    //
    // Compared on the *parsed* orderings, so the same ordering written in both attributes is
    // silent. The comparison stops there and deliberately does not normalise: `from:0` and
    // `order:start` are the same ordering (see `originOf`) but are reported as a conflict, because
    // the other boundary identity — `from:<last>` is `end` — needs a group size this function does
    // not have, and special-casing only the half that happens to be knowable would be a rule an
    // author could not predict. Both spellings still resolve to the same wave; the warning names
    // which one won, which is true and useful, rather than silently claiming they differ.
    warnOverride('stagger order', sawFrom ? longhand.from : undefined, order, warnings)
    config.from = order
  }
  return config
}

/**
 * Whether a `data-kui` value could contain a hoisted group key.
 *
 * A substring test, not the grammar: `border:` ends in `order:` and `tween cascade:...` is not a
 * thing, so this over-matches by design and `parse()` makes the real decision. Over-matching costs
 * one wasted parse; under-matching would silently drop a group, so a cleverer regex with a
 * word-boundary guard is the wrong trade here — it would have to agree with `splitTopLevel`'s
 * quote- and paren-aware tokenizer in every case, and where it did not the failure would be an
 * animation that just does not stagger, with nothing in the console.
 *
 * @complexity O(n) time in the attribute length; O(1) space.
 * @overallScore 100
 */
function hasGroupKey(source: string): boolean {
  return source.includes('cascade:') || source.includes('spread:') || source.includes('order:')
}

/**
 * Name the value an inline key is about to displace.
 *
 * Silent when the longhand said nothing, or said the same thing: the common case during a
 * migration is one attribute carrying the step and the other carrying the order, which is not a
 * mistake and must not read like one.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function warnOverride(
  label: string,
  previous: string | StaggerFrom | undefined,
  next: string | StaggerFrom,
  warnings: string[],
): void {
  if (previous === undefined || previous === next) return
  warnings.push(
    `conflicting ${label}: data-kui-stagger says "${String(previous)}", ` +
      `data-kui says "${String(next)}" — data-kui wins`,
  )
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
function parseFrom(raw: string, warnings: string[], key: 'from' | 'order' = 'from'): StaggerFrom {
  const value = raw.trim()
  if (FROM_KEYWORDS.has(value)) return value as StaggerFrom
  if (INDEX_RE.test(value)) return Number(value)
  // The key is echoed back rather than hard-coded, and the attribute name is no longer named at
  // all: the same ordering arrives as `from:` or `order:` on `data-kui-stagger` and as `order:`
  // inside `data-kui`, so a fixed "in data-kui-stagger" would send two thirds of the authors who
  // read this warning looking at an attribute they never wrote.
  warnings.push(
    `unrecognised "${key}:${raw}" — expected ` +
      `start, end, center, edges, random, or a child index`,
  )
  return 'start'
}

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
    warnings.push(`stagger order "${from}" is outside the group (0 to ${last}) — clamped`)
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
 * @param group - Element carrying `data-kui-stagger`, or a `data-kui` with `cascade:`/`spread:`/
 *   `order:`.
 * @param reporter - Diagnostic sink for a malformed attribute. Optional, so the two-argument
 *   contract every existing caller uses keeps working.
 * @complexity O(n) time in the number of children; O(n) space for the ranks.
 * @overallScore 100
 */
export function indexStaggerGroup(group: Element, reporter?: Reporter): void {
  const warnings: string[] = []
  const host = group as HTMLElement
  // Both spellings, merged. Falls back to the empty longhand parse when neither attribute declares
  // a group, so a direct call on any element still publishes the same defaults it always did —
  // `applyStagger` is what decides which elements are groups, and it never routes a non-group here.
  const config = resolveStaggerConfig(
    group.getAttribute(ATTR.stagger),
    group.getAttribute(ATTR.source) ?? '',
    warnings,
  ) ?? { from: 'start' }

  const children = animatedChildren(group)
  const ranks = staggerRanks(children.length, config.from, warnings)
  let maxRank = 0
  for (const [index, child] of children.entries()) {
    const rank = ranks[index] ?? 0
    child.style.setProperty('--kui-i', String(rank))
    if (rank > maxRank) maxRank = rank
  }

  // After the ranks, not before them, which is the one ordering change a total budget forces: the
  // step a `spread:` resolves to is the budget divided by the largest rank, and the largest rank is
  // not known until every child has one. A fixed `cascade:` step does not care either way.
  const step = resolveStep(config, maxRank)
  if (step) host.style.setProperty('--kui-stagger', step)

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
  host.style.setProperty('--kui-stagger-count', String(maxRank + 1))

  for (const warning of warnings) reporter?.warn(warning, group)
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

  const maxRank = rankBuckets(bucketByParent(matches), config.from, ledgers, warnings)
  // Written after the ranks for the same reason `indexStaggerGroup` writes it there — see
  // `resolveStep`. The budget is divided across the *largest bucket*'s span, since that is the one
  // the last-starting match belongs to.
  const step = resolveStep(config, maxRank)
  if (step) ledgers.style(host).set('--kui-stagger', step)
  // Same `maxRank + 1` reasoning as `indexStaggerGroup`'s own — see that function's comment: the
  // largest offset in the group, not the member count, and the two only coincide for `start`.
  ledgers.style(host).set('--kui-stagger-count', String(maxRank + 1))

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
  from: StaggerFrom,
  ledgers: LedgerSet,
  warnings: string[],
): number {
  let maxRank = 0
  for (const siblings of byParent.values()) {
    const ranks = staggerRanks(siblings.length, from, warnings)
    for (const [index, match] of siblings.entries()) {
      const rank = ranks[index] ?? 0
      ledgers.style(match).set('--kui-i', String(rank))
      if (rank > maxRank) maxRank = rank
    }
  }
  return maxRank
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
  if (root instanceof Element && root.matches(selector) && declaresGroup(root)) {
    indexStaggerGroup(root, reporter)
  }
  for (const group of root.querySelectorAll(selector)) {
    if (declaresGroup(group)) indexStaggerGroup(group, reporter)
  }
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
