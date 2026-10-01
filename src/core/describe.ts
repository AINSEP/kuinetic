import { BREAKPOINT_NAMES } from './breakpoints.js'
import type { GateDirection } from './breakpoints.js'
import { decimalNumber, validate } from './params.js'
import { parse } from './parse.js'
import { suggest } from './registry.js'
import type { Registry } from './registry.js'
import { ALL_TIMING_TOKENS, timingContractOf } from './timing-contract.js'
import type {
  EffectSpec,
  ParamNote,
  ParamNoteDetail,
  ParamSpec,
  ParamType,
  ParsedValue,
  ReducedMotionPolicy,
  Renderer,
  Timeline,
} from './types.js'

/**
 * Everything a reader can write for an effect, generated from the registry rather than written by
 * hand — the data behind the demo's "Args" tab, and anything else that documents a `data-kui`.
 *
 * Generated, not listed, so it cannot drift: a parameter added to a primitive appears here the
 * moment it is registered, with the type, default and accepted spellings the validator in
 * `params.ts` actually enforces. The one hand-written part is the plain-words note, and that is
 * supplied separately (see {@link ParamNotes}) so the prose never ships in the core bundle.
 */

/**
 * Plain-words notes, keyed most specific first:
 *
 * - `'<preset>.<param>'` — one name whose parameter means something its siblings' does not;
 * - `'<primitive>.<param>'` — the usual case, shared by every preset of one primitive;
 * - `'*.<param>'` — a parameter that means the same thing on every primitive declaring it
 *   (`duration`, `delay`, `ease`, `stagger`).
 *
 * The catalog's own table is `src/notes/index.ts`, built as a separate entry.
 */
export type ParamNotes = Readonly<Record<string, ParamNote>>

/** One of the three bare tokens the grammar reads by position or shape. See `parse.ts`. */
export interface PositionalSlot {
  /** Which value the token sets. */
  slot: 'duration' | 'delay' | 'ease'
  /** The shape that fills it: a time token by order, an easing token by its shape. */
  accepts: 'time' | 'easing'
  /** The declared parameter the bare token stands in for, when the primitive declares one. */
  param?: string
  /**
   * Whether the effect acts on this token. The grammar always assigns it, but a few JS effects
   * have nothing to apply it to — a scroll-driven pin has no start to delay — and warn instead.
   */
  honoured: boolean
}

export interface ParamDescription {
  name: string
  type: ParamType
  /** Effective default for this name: the preset's own override if it has one, else the primitive's. */
  default: string
  /** Whether `default` came from the preset (`Preset.params`) rather than the primitive. */
  presetDefault: boolean
  /** The effect does nothing useful without it. From the note; nothing enforces it at runtime. */
  required: boolean
  /**
   * Example values the validator accepts, each one tested to pass `validate()`. Empty for `text`,
   * which has no grammar — any value that passes the escape screen, quoted if it has spaces.
   */
  spellings: string[]
  /** The closed word list, for `keyword` and `angle|keyword`. */
  keywords?: readonly string[]
  minimum?: number
  maximum?: number
  integer?: boolean
  /** 0-based position when a bare token can set this parameter (`fade-up 600ms 200ms`), else absent. */
  positionalIndex?: number
  /** Why you would set it, in plain words. */
  note?: string
  /** What happens when it is left out, where the default alone does not say. */
  whenOmitted?: string
}

export interface EffectDescription {
  /** The name as written in `data-kui`. */
  name: string
  /** The implementation it resolves to; several names share one. */
  primitive: string
  renderer: Renderer
  params: ParamDescription[]
  /** The bare tokens this name accepts, in grammar order. */
  positionalOrder: PositionalSlot[]
  /**
   * Why the effect cannot act on the slots marked `honoured: false` — the same reason the runtime
   * warning gives. Present only when at least one slot is not honoured.
   */
  unhonouredBecause?: string
}

/** A `data-kui` step whose name is not registered. */
export interface UnknownEffect {
  name: string
  unknown: true
  /** Closest registered name, when one is close enough to be a likely typo. */
  suggestion?: string
}

/** What one comma step of a `data-kui` value wrote, read back from the runtime's own parse. */
export interface StepWritten {
  /**
   * The effect's own arguments this step sets: every `key:value`, plus each bare token under the
   * slot it fills (`hover-intent 160ms 350ms` → `{ duration: '160ms', delay: '350ms' }`). A bare
   * token wins over the same name written as `key:value`, as it does at runtime. A key the effect
   * does not declare still appears — the runtime warns that it ignores it.
   */
  written: Record<string, string>
  /**
   * Reserved keys this step sets that are not arguments of the effect: the step-scoped ones
   * (`at:`, `above:`/`below:`/`wide:`/`narrow:`, `repeat:`, `yoyo:`), and — on a step carrying
   * `target:` — the element keys that step scopes to its own target group.
   */
  writtenKeys: Record<string, string>
}

/** One step of a described `data-kui` value. */
export type DescribedStep = (EffectDescription | UnknownEffect) & StepWritten

/** Which part of a `data-kui` value a reserved key applies to. */
export type KeyScope = 'element' | 'step'

/**
 * A reserved `data-kui` key — one the parser takes for itself rather than handing to the effect,
 * like `on:` or `at:`. Same row shape as a parameter, so one renderer draws both.
 */
export interface KeyDescription extends ParamDescription {
  /**
   * `'element'`: one value for the whole element, whichever step it is written in (`on:`,
   * `timeline:`, `rm:` …). `'step'`: belongs to the comma step it is written in (`at:`, `repeat:` …).
   */
  scope: KeyScope
}

/** A whole `data-kui` value: its steps, every reserved key, and the element-wide keys it sets. */
export interface ElementDescription {
  steps: DescribedStep[]
  /** Every reserved key, element-scoped first, each with its scope. Not filtered to this value. */
  keys: KeyDescription[]
  /** The element-scoped keys this value sets, by the name written (`on`, not `activation`). */
  written: Record<string, string>
}

/**
 * The positional grammar, stated once: `name [duration] [delay] [easing]`. Times fill the first
 * two slots in order; an easing is recognised by its shape. `parse.ts`'s `applyTime` and
 * `applyEasing` are what this mirrors, and `test/describe.test.ts` parses each slot back through
 * `parse()` to prove it.
 */
const POSITIONAL: readonly Omit<PositionalSlot, 'param' | 'honoured'>[] = [
  { slot: 'duration', accepts: 'time' },
  { slot: 'delay', accepts: 'time' },
  { slot: 'ease', accepts: 'easing' },
]

/**
 * Describe one registered effect name.
 *
 * @param registry - The registry to read; pass the running animator's to include tiers.
 * @param name - An effect name as written in `data-kui`.
 * @param notes - Plain-words notes table; omit for structure only.
 * @returns The description, or `undefined` for an unregistered name.
 * @complexity O(p) time and space in the primitive's parameter count.
 * @overallScore 100
 */
export function describeEffect(
  registry: Registry,
  name: string,
  notes: ParamNotes = {},
): EffectDescription | undefined {
  const resolved = registry.resolve(name)
  if (!resolved) return undefined
  const { preset, primitive } = resolved
  const declared = primitive.parameters
  // No contract means all three: a primitive that cannot honour a token must declare so.
  const contract = timingContractOf(primitive)
  const honours = contract ? (contract.honours ?? []) : ALL_TIMING_TOKENS
  const positionalOrder = POSITIONAL.map((slot) => ({
    ...slot,
    ...(Object.hasOwn(declared, slot.slot) ? { param: slot.slot } : {}),
    honoured: honours.includes(slot.slot),
  }))
  const params = Object.entries(declared).map(([param, spec]) => {
    const override = preset.params?.[param]
    const note = findNote(spec.note, notes, [preset.name, primitive.id, '*'], param)
    return {
      name: param,
      type: spec.type,
      default: override ?? spec.default,
      presetDefault: override !== undefined,
      required: note?.required === true,
      spellings: spellingsFor(spec, override ?? spec.default),
      ...optionalFields(spec, param, note),
    }
  })
  const described: EffectDescription = {
    name: preset.name,
    primitive: primitive.id,
    renderer: primitive.renderer,
    params,
    positionalOrder,
  }
  if (contract && honours.length < ALL_TIMING_TOKENS.length) described.unhonouredBecause = contract.because
  return described
}

type OptionalFields = Omit<
  ParamDescription,
  'name' | 'type' | 'default' | 'presetDefault' | 'required' | 'spellings'
>

/** The fields a description carries only when they apply, so a reader never sees an empty one. */
function optionalFields(spec: ParamSpec, param: string, note: ParamNoteDetail | undefined): OptionalFields {
  const out: OptionalFields = {}
  if (spec.keywords) out.keywords = spec.keywords
  if (spec.minimum !== undefined) out.minimum = spec.minimum
  if (spec.maximum !== undefined) out.maximum = spec.maximum
  if (spec.integer) out.integer = true
  const index = POSITIONAL.findIndex((slot) => slot.slot === param)
  if (index >= 0) out.positionalIndex = index
  if (note) out.note = note.why
  if (note?.whenOmitted) out.whenOmitted = note.whenOmitted
  return out
}

/**
 * Describe every step of a `data-kui` value, in order — the "which effect does this step mean"
 * question, answered by the same parser the runtime uses.
 *
 * @complexity O(n + s·p) time in attribute length, step count and parameter count.
 * @overallScore 100
 */
export function describeAttribute(
  registry: Registry,
  value: string,
  notes: ParamNotes = {},
): DescribedStep[] {
  return describeSpecs(registry, parse(value).specs, notes)
}

/**
 * Describe a whole `data-kui` value: {@link describeAttribute}'s steps, plus every reserved key
 * and the element-scoped ones this value sets. Element keys come back once, here, because the
 * parser gives one element one value for each of them whichever step it is written in; step keys
 * come back on each step's `writtenKeys`, because the parser keeps them per step.
 *
 * @complexity O(n + s·p) time in attribute length, step count and parameter count.
 * @overallScore 100
 */
export function describeElementAttribute(
  registry: Registry,
  value: string,
  notes: ParamNotes = {},
): ElementDescription {
  const parsed = parse(value)
  const written: Record<string, string> = {}
  for (const [field, key] of Object.entries(ELEMENT_KEYS) as [ElementField, KeySpec][]) {
    const set = parsed[field]
    if (set !== undefined) written[key.key] = set
  }
  return { steps: describeSpecs(registry, parsed.specs, notes), keys: describeKeys(notes), written }
}

/**
 * Every reserved key, element-scoped first, with its notes. Independent of any value.
 *
 * @complexity O(k) time and space in the fixed key count.
 * @overallScore 100
 */
export function describeKeys(notes: ParamNotes = {}): KeyDescription[] {
  const element = Object.values(ELEMENT_KEYS).map((key) => keyRow(key, 'element', notes))
  return [...element, ...STEP_KEY_LIST.map((key) => keyRow(key, 'step', notes))]
}

function describeSpecs(registry: Registry, specs: readonly EffectSpec[], notes: ParamNotes): DescribedStep[] {
  return specs.map((spec) => {
    const written = { written: writtenArgs(spec), writtenKeys: writtenStepKeys(spec) }
    const described = describeEffect(registry, spec.name, notes)
    if (described) return { ...described, ...written }
    const suggestion = suggest(spec.name, registry.names())
    const unknown: UnknownEffect = suggestion
      ? { name: spec.name, unknown: true, suggestion }
      : { name: spec.name, unknown: true }
    return { ...unknown, ...written }
  })
}

/** `spec.params`, then each bare token under its slot's name — bare wins, as at runtime. */
function writtenArgs(spec: EffectSpec): Record<string, string> {
  const written = { ...spec.params }
  if (spec.duration !== undefined) written.duration = spec.duration
  if (spec.delay !== undefined) written.delay = spec.delay
  if (spec.easing !== undefined) written.ease = spec.easing
  return written
}

/** The step-scoped keys this spec carries, plus element keys a `target:` scoped to it. */
function writtenStepKeys(spec: EffectSpec): Record<string, string> {
  const written: Record<string, string> = {}
  if (spec.at !== undefined) written.at = spec.at
  // `parse.ts`'s `applyGate` writes a direction only with a valid breakpoint, never `undefined`.
  Object.assign(written, spec.gate)
  if (spec.repeat !== undefined) written.repeat = spec.repeat
  if (spec.yoyo !== undefined) written.yoyo = String(spec.yoyo)
  for (const [field, value] of Object.entries(spec.hoists ?? {})) {
    written[ELEMENT_KEYS[field as ElementField].key] = value
  }
  return written
}

/** Where every reserved key's note lives in a {@link ParamNotes} table: `'data-kui.on'`. */
export const KEY_NOTE_OWNER = 'data-kui'

function keyRow(key: KeySpec, scope: KeyScope, notes: ParamNotes): KeyDescription {
  const note = findNote(undefined, notes, [KEY_NOTE_OWNER], key.key)
  const row: KeyDescription = {
    name: key.key,
    type: key.type,
    default: key.default,
    presetDefault: false,
    required: false,
    spellings: [...key.spellings],
    scope,
  }
  if (key.keywords) row.keywords = key.keywords
  if (note) row.note = note.why
  if (note?.whenOmitted) row.whenOmitted = note.whenOmitted
  return row
}

/** One reserved key: the word written, and how it is spelled. */
interface KeySpec {
  key: string
  type: ParamType
  /**
   * Always `''`: what an unwritten key means is decided at runtime — by the effects on the element,
   * the page, or the group — so the note's `whenOmitted` says it in words rather than a value here
   * that could drift from the code that decides.
   */
  default: ''
  /** Each one parses without a warning — `test/describe.test.ts` checks. */
  spellings: readonly string[]
  keywords?: readonly string[]
}

/** Every field of {@link ParsedValue} a reserved key writes into. */
type ElementField = Exclude<keyof ParsedValue, 'specs' | 'warnings'>

/** Closed sets taken from their types, so a new member is a compile error until listed. */
const TIMELINES = Object.keys({ time: 0, view: 0, scroll: 0, pointer: 0, pin: 0 } satisfies Record<Timeline, 0>)
const RM_POLICIES = Object.keys({ shorten: 0, crossfade: 0, disable: 0 } satisfies Record<ReducedMotionPolicy, 0>)

/**
 * The element-scoped keys, keyed by the `ParsedValue` field each one lands in — so a hoist the
 * parser gains is a compile error here until it is described. The key *word* is checked against
 * the parser by `test/describe.test.ts`: each spelling must land in this field.
 */
const ELEMENT_KEYS: Record<ElementField, KeySpec> = {
  activation: { key: 'on', type: 'text', default: '', spellings: ['enter', 'load', 'hover', 'click', 'hover/unhover'] },
  actions: { key: 'actions', type: 'text', default: '', spellings: ['play/pause/resume/reset', 'play/none/none/reset'] },
  timeline: { key: 'timeline', type: 'keyword', default: '', spellings: TIMELINES, keywords: TIMELINES },
  threshold: { key: 'threshold', type: 'percentage', default: '', spellings: ['0%', '25%'] },
  cascade: { key: 'cascade', type: 'time', default: '', spellings: ['90ms', '0.09s'] },
  spread: { key: 'spread', type: 'time', default: '', spellings: ['600ms', '0.6s'] },
  order: { key: 'order', type: 'text', default: '', spellings: ['start', 'end', 'center', 'edges', 'random', '3'] },
  cols: { key: 'cols', type: 'text', default: '', spellings: ['auto', '4'] },
  along: { key: 'along', type: 'keyword', default: '', spellings: ['x', 'y'], keywords: ['x', 'y'] },
  rm: { key: 'rm', type: 'keyword', default: '', spellings: RM_POLICIES, keywords: RM_POLICIES },
  func: { key: 'func', type: 'text', default: '', spellings: ['onRevealDone'] },
}

/** Every field of {@link EffectSpec} a reserved key writes into. */
type StepField = Exclude<keyof EffectSpec, 'name' | 'duration' | 'delay' | 'easing' | 'params' | 'hoists'>

const gateKey = (key: GateDirection): KeySpec => ({
  key,
  type: 'keyword',
  default: '',
  spellings: BREAKPOINT_NAMES,
  keywords: BREAKPOINT_NAMES,
})

/** The step-scoped keys, keyed by the `EffectSpec` field — compile-checked like {@link ELEMENT_KEYS}. */
const STEP_KEYS: Record<StepField, KeySpec | Record<GateDirection, KeySpec>> = {
  at: { key: 'at', type: 'text', default: '', spellings: ['after', 'with', '-200ms', 'with+100ms'] },
  gate: { above: gateKey('above'), below: gateKey('below'), wide: gateKey('wide'), narrow: gateKey('narrow') },
  repeat: { key: 'repeat', type: 'text', default: '', spellings: ['infinite', '3'] },
  yoyo: { key: 'yoyo', type: 'keyword', default: '', spellings: ['true', 'false'], keywords: ['true', 'false'] },
}

const STEP_KEY_LIST: readonly KeySpec[] = Object.values(STEP_KEYS).flatMap((entry) =>
  'key' in entry ? [entry as KeySpec] : Object.values(entry),
)

/**
 * An inline `ParamSpec.note` first, then the table, most specific owner first — `owners` is
 * preset, primitive, `*` — normalised to the object form.
 */
function findNote(
  inline: ParamNote | undefined,
  notes: ParamNotes,
  owners: readonly string[],
  param: string,
): ParamNoteDetail | undefined {
  const key = owners.map((owner) => `${owner}.${param}`).find((k) => Object.hasOwn(notes, k))
  const note: ParamNote | undefined = inline ?? (key === undefined ? undefined : notes[key])
  if (note === undefined) return undefined
  return typeof note === 'string' ? { why: note } : note
}

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)/

/**
 * Example spellings for one parameter, built from its default so they read as that effect's own
 * values. Each list is the set of *forms* the grammar in `params.ts` takes — `12 | 12d | 12deg`
 * for an angle, `0.8 | 80%` for an alpha — and `test/describe.test.ts` runs every example of every
 * registered parameter back through `validate()`, so a list here cannot claim a form the validator
 * rejects.
 *
 * @param spec - The declaration.
 * @param fallback - The effective default to build examples from.
 * @complexity O(k) time and space in the keyword count.
 * @overallScore 100
 */
export function spellingsFor(spec: ParamSpec, fallback: string = spec.default): string[] {
  // A default is not always an authorable value — `offset-top` defaults to a `var()` reaching for
  // the page's own property — so one the validator would refuse is not offered as an example.
  const value = validate(fallback, spec).ok ? fallback.trim() : ''
  return EXAMPLES[spec.type](value, spec.keywords ?? [])
}

/**
 * One builder per type, keyed by the full `ParamType` union so a new type is a compile error here
 * until it says how it is spelled. `value` is the validated default, or `''` when there is none.
 */
const EXAMPLES: Record<ParamType, (value: string, keywords: readonly string[]) => string[]> = {
  angle: (value) => angleForms(value),
  'angle|keyword': (value, keywords) => [...angleForms(keywords.includes(value) ? '' : value), ...keywords],
  keyword: (_, keywords) => [...keywords],
  time: timeForms,
  number: (value) => [value || '1'],
  percentage: (value) => [value || '50%'],
  'number|percentage': alphaForms,
  length: (value) => [value || '24px', 'calc(1rem + 4px)'],
  'length|percentage': (value) => [value || '24px', '50%'],
  color: (value) => [value || '#e4f222', 'rgb(228 242 34)', 'currentcolor'],
  easing: (value) => [value || 'ease-out', 'linear', 'cubic-bezier(.2, .8, .2, 1)', 'spring'],
  path: () => ['M0,0L100,0'],
  text: () => [],
}

/** `12 | 12d | 12deg` — see `params.ts`'s `BARE_ANGLE`. A non-degree default is kept as written. */
function angleForms(value: string): string[] {
  const n = NUMBER.exec(value)?.[0]
  const degrees = value.endsWith('deg') || /^-?[\d.]+d?$/.test(value)
  const base = degrees && n ? n : '45'
  const forms = [base, `${base}d`, `${base}deg`]
  return degrees || !value ? forms : [value, ...forms]
}

/** `600ms | 0.6s`, or `2s | 2000ms`. */
function timeForms(value: string): string[] {
  const n = NUMBER.exec(value)?.[0]
  if (!n) return ['600ms', '0.6s']
  return value.endsWith('ms') ? [value, `${decimalNumber(n, -3)}s`] : [value, `${decimalNumber(n, 3)}ms`]
}

/** `0.8 | 80%` — the two spellings `params.ts` normalises to one. */
function alphaForms(value: string): string[] {
  const n = NUMBER.exec(value)?.[0]
  if (!n) return ['0.5', '50%']
  return value.endsWith('%') ? [`${decimalNumber(n, -2)}`, value] : [value, `${decimalNumber(n, 2)}%`]
}
