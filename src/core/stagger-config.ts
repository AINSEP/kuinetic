import { isSafeCssValue } from './params.js'
import { parse, splitTopLevel } from './parse.js'

/**
 * The stagger *grammar* — what an author's two attributes mean, with no DOM anywhere in sight.
 *
 * Split from `stagger.ts` when the 2D orderings landed and the module went past its line budget,
 * and split along the seam `activation.ts` already uses for the same reason: vocabulary first as
 * pure functions over text, machinery second. Everything here turns `data-kui-stagger` and the
 * hoisted `cascade:`/`spread:`/`order:`/`cols:`/`along:` keys into one {@link StaggerConfig};
 * nothing here ranks a child or touches an element. `stagger.ts` does both, and re-exports this
 * module's public names so the split is invisible to every caller.
 */

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
 *
 * A {@link GridOrigin} is the same rule again, for a group that declared one: an arbitrary point in
 * the grid rather than one of its named landmarks.
 */
export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | 'random' | number | GridOrigin

/**
 * An arbitrary origin inside a grid, as fractions of it — GSAP's decimal `from: [x, y]`.
 *
 * `0/0` is the top-left cell, `1/1` the bottom-right, `0.5/0.5` the middle, `1/0` the top-right
 * corner. Fractions rather than cell coordinates so the same attribute keeps meaning the same thing
 * when the grid reflows to a different column count — which is the whole reason a *point* is worth
 * having over an index.
 *
 * Only meaningful once the group declares a grid with `cols:`; without one there is no second axis
 * to place it on, and {@link staggerRanks} says so rather than quietly reading half of it.
 */
export interface GridOrigin {
  readonly x: number
  readonly y: number
}

/** Which dimension of a grid a stagger measures across. */
export type StaggerAxis = 'x' | 'y'

/**
 * A group's grid, resolved to what the ranking actually needs.
 *
 * Only the column count, because the row count follows from it and the child count. Carrying rows
 * as a second authored number would be a knob that changes nothing — GSAP takes `[rows, cols]` and
 * uses only the second, and a parameter that is read but never used is worse than one that does not
 * exist.
 */
export interface StaggerLayout {
  readonly cols: number
  readonly along?: StaggerAxis
}

/** How many columns a group has: an authored count, or `auto` to measure the laid-out children. */
export type StaggerColumns = number | 'auto'

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
  /**
   * The group's column count, turning the ordering from a rank over DOM index into a rank over
   * distance through a real 2D layout. Absent means the ordering is 1D, which is what every group
   * did before this existed.
   */
  cols?: StaggerColumns
  /**
   * Restrict the 2D distance to one dimension — `x` staggers strictly by column whatever row a
   * child is in, `y` strictly by row. Absent means both, i.e. straight-line distance.
   *
   * Meaningless without {@link cols}, and warned about rather than ignored when it appears alone.
   */
  along?: StaggerAxis
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

/** The column-count key. One word in both attributes — nothing in the catalog is called `cols`. */
const COLS_KEY = 'cols'

/**
 * The two spellings of the axis constraint inside `data-kui-stagger`.
 *
 * `axis:` is GSAP's word and the one an author arriving from it will reach for. It could not be the
 * `data-kui` spelling: `axis` is already a parameter on four primitives (`parallax`, `slat-assemble`
 * and both draggables), and a hoisted key never reaches `spec.params`, so lifting it element-wide
 * would make `data-kui="parallax-y axis:x"` unwritable. That is exactly the `from:` → `order:`
 * situation and it gets exactly the same answer: the hoist is `along:`, this attribute accepts both,
 * and one word works in both places.
 */
const AXIS_KEYS: ReadonlySet<string> = new Set(['axis', 'along'])

/** The two axes a grid stagger can be restricted to. */
const AXIS_VALUES: ReadonlySet<string> = new Set(['x', 'y'])

/**
 * An arbitrary grid origin, as `x/y` fractions.
 *
 * A slash rather than a comma, for the reason `activation.ts` gives for its own pair separator: a
 * comma is structural in `parse.ts`'s tokenizer, so `order:0.5,0.5` inside `data-kui` would split
 * into two effect segments and the author would have to quote it. A slash is inert to the
 * tokenizer, needs no quoting in either attribute, and is how CSS already writes a paired value
 * (`grid-area: 1 / 2`).
 */
const ORIGIN_RE = /^(\d+(?:\.\d+)?|\.\d+)\/(\d+(?:\.\d+)?|\.\d+)$/

/** A column count: a plain positive integer, bounded for the reason {@link INDEX_RE} is. */
const COLS_RE = /^\d{1,9}$/

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
  const seen = { from: false, spread: false, cols: false, along: false }

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
  seen: { from: boolean; spread: boolean; cols: boolean; along: boolean }
  warnings: string[]
}

/**
 * Apply one `key:value` token from `data-kui-stagger`.
 *
 * Split out of {@link parseStaggerTokens} to keep that function's branch count under the budget;
 * every rule it implements is documented inline below. Every key here is first-one-wins with a
 * named duplicate, matching `assignOnce` in `parse.ts`.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function applyStaggerPair(key: string, raw: string, state: StaggerParseState): void {
  const slot = slotFor(key)
  if (slot === undefined) {
    state.warnings.push(
      `unrecognised key "${key}" in data-kui-stagger — expected a time step, ` +
        `"spread:", "cols:", "along:", "from:" or "order:"`,
    )
    return
  }
  if (claim(slot, raw, state, key)) ASSIGN[slot](raw, state, key)
}

/**
 * Which setting a key writes, collapsing the synonym pairs.
 *
 * `axis:`/`along:` and `from:`/`order:` each resolve to one slot, which is what makes writing both
 * spellings of one setting a duplicate rather than a second chance.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function slotFor(key: string): StaggerSlot | undefined {
  if (key === SPREAD_KEY) return 'spread'
  if (key === COLS_KEY) return 'cols'
  if (AXIS_KEYS.has(key)) return 'along'
  if (ORDER_KEYS.has(key)) return 'from'
  return undefined
}

/** The four settings a `key:value` token in `data-kui-stagger` can write. */
type StaggerSlot = keyof StaggerParseState['seen']

/**
 * What each slot does with its value — a table rather than a branch chain, so adding a fifth
 * setting stays a data change.
 *
 * Every entry takes the author's own spelling as its third argument so a diagnostic quotes the word
 * they wrote rather than the one this module happens to key on.
 */
const ASSIGN: Record<StaggerSlot, (raw: string, state: StaggerParseState, key: string) => void> = {
  spread: (raw, state) => {
    state.config.spread = raw.trim()
  },
  cols: (raw, state) => {
    state.config.cols = parseCols(raw, state.warnings)
  },
  along: (raw, state, key) => {
    state.config.along = parseAxis(raw, state.warnings, key)
  },
  from: (raw, state, key) => {
    state.config.from = parseFrom(raw, state.warnings, key as 'from' | 'order')
  },
}

/**
 * Record that a key has been written, and report whether this occurrence is the one that counts.
 *
 * First one wins, matching `assignOnce` in `parse.ts`: a second, differing value across the same
 * attribute is a mistake, and letting the last one win makes which mistake you get depend on token
 * order.
 *
 * @param slot - Which flag to claim. Two spellings of one key share a slot, so writing `axis:` and
 *   `along:` is the same mistake as writing either one twice.
 * @param spelling - The word the author actually used, so the warning quotes their own text.
 * @returns `true` for the first occurrence, `false` (having warned) for every later one.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function claim(
  slot: StaggerSlot,
  raw: string,
  state: StaggerParseState,
  spelling: string,
): boolean {
  if (state.seen[slot]) {
    state.warnings.push(`duplicate "${spelling}:" in data-kui-stagger — "${raw}" ignored`)
    return false
  }
  state.seen[slot] = true
  return true
}

/**
 * Resolve a `cols:` value to a column count or to the request to measure one.
 *
 * Refused rather than defaulted, because there is no column count that is right by default: a wrong
 * one silently reorders the whole group, which is exactly the kind of "it animates, just wrongly"
 * failure a warning is cheaper than.
 *
 * @returns The count, `'auto'`, or `undefined` when the value is not either — which leaves the
 *   group ordering over DOM index, as it would have without the key.
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
function parseCols(raw: string, warnings: string[]): StaggerColumns | undefined {
  const value = raw.trim()
  if (value === 'auto') return 'auto'
  // Zero columns is not a degenerate grid, it is a division by nothing: every child would land in
  // column `i % 0` — `NaN` — and the whole group would rank `NaN` and lose its stagger silently.
  if (COLS_RE.test(value) && Number(value) > 0) return Number(value)
  warnings.push(`unrecognised "cols:${raw}" — expected a column count or "auto"`)
  return undefined
}

/**
 * Resolve an `axis:`/`along:` value.
 *
 * @param key - The spelling the author used, echoed back so the warning names their own word.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function parseAxis(raw: string, warnings: string[], key: string): StaggerAxis | undefined {
  const value = raw.trim()
  if (AXIS_VALUES.has(value)) return value as StaggerAxis
  warnings.push(`unrecognised "${key}:${raw}" — expected x or y`)
  return undefined
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
  const budgeted = { ...config }
  delete budgeted.step
  return budgeted
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
  const { cascade, spread, order, cols, along } = parse(source)
  const keys: InlineGroupKeys = { cascade, spread, order, cols, along }
  return Object.values(keys).some((value) => value !== undefined) ? keys : undefined
}

/** The hoisted group keys, exactly as `parse()` returns them. */
interface InlineGroupKeys {
  cascade?: string
  spread?: string
  order?: string
  cols?: string
  along?: string
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
  const screened: StaggerConfig = { ...config }
  // Deleted rather than set to `undefined`, so a refused value is genuinely absent for a caller
  // testing `'step' in config` and for a `toEqual` in a test.
  if (!keepValue('step', config.step, warnings)) delete screened.step
  if (!keepValue('spread', config.spread, warnings)) delete screened.spread
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
  mergeInlineGrid(config, longhand, inline, warnings)
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
 * Overlay the hoisted `cols:`/`along:` values, which unlike the step and the budget have to be
 * *parsed* before they can be compared — and a value that fails to parse leaves the longhand's
 * standing rather than blanking it, so a typo in one attribute cannot silently discard a working
 * declaration in the other.
 *
 * Split from {@link mergeInline} only to keep that function's branch count under the budget.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function mergeInlineGrid(
  config: StaggerConfig,
  longhand: StaggerConfig,
  inline: InlineGroupKeys,
  warnings: string[],
): void {
  if (inline.cols !== undefined) {
    const cols = parseCols(inline.cols, warnings)
    warnOverride('stagger columns', longhand.cols, cols, warnings)
    if (cols !== undefined) config.cols = cols
  }
  if (inline.along !== undefined) {
    const along = parseAxis(inline.along, warnings, 'along')
    warnOverride('stagger axis', longhand.along, along, warnings)
    if (along !== undefined) config.along = along
  }
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
  return GROUP_KEY_PREFIXES.some((prefix) => source.includes(prefix))
}

/** The hoisted group keys, as the substrings {@link hasGroupKey} screens on. */
const GROUP_KEY_PREFIXES: readonly string[] = [
  'cascade:',
  'spread:',
  'order:',
  'cols:',
  'along:',
]

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
  previous: string | StaggerFrom | StaggerColumns | undefined,
  next: string | StaggerFrom | StaggerColumns | undefined,
  warnings: string[],
): void {
  if (previous === undefined || next === undefined || previous === next) return
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
  const origin = ORIGIN_RE.exec(value)
  // Clamped rather than refused, for `originOf`'s reason: at each boundary the clamp *is* the
  // identity, so `order:2/0` degrades to the top-right corner an author could have written as
  // `order:1/0` rather than to a delay nobody asked for.
  if (origin) return { x: clamp01(Number(origin[1]), value, warnings), y: clamp01(Number(origin[2]), value, warnings) }
  // The key is echoed back rather than hard-coded, and the attribute name is no longer named at
  // all: the same ordering arrives as `from:` or `order:` on `data-kui-stagger` and as `order:`
  // inside `data-kui`, so a fixed "in data-kui-stagger" would send two thirds of the authors who
  // read this warning looking at an attribute they never wrote.
  warnings.push(
    `unrecognised "${key}:${raw}" — expected ` +
      `start, end, center, edges, random, a child index, or an "x/y" point in a grid`,
  )
  return 'start'
}

/**
 * Hold one half of a grid origin inside the grid.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clamp01(value: number, source: string, warnings: string[]): number {
  if (value >= 0 && value <= 1) return value
  warnings.push(`stagger order "${source}" is outside the grid (0 to 1 on each axis) — clamped`)
  return Math.min(Math.max(value, 0), 1)
}
