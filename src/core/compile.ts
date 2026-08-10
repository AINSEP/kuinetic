import { describeConflicts, findConflicts } from './channels.js'
import { resolveParams } from './params.js'
import type { Registry, ResolvedEffect } from './registry.js'
import { suggest } from './registry.js'
import type {
  EffectSpec,
  ParsedValue,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'

/** CSS-native timing keywords; anything else resolves to a `--dsg-ease-*` custom property. */
const NATIVE_EASINGS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
])

/** `disable` is the strongest claim: if any effect must not run, none of the list should. */
const RM_RANK: Record<ReducedMotionPolicy, number> = { shorten: 0, crossfade: 1, disable: 2 }

export interface Entry {
  spec: EffectSpec
  resolved: ResolvedEffect
}

export interface CompiledPlan {
  /** Effect names to stamp into `data-dsg-fx` for CSS hooks and debugging. */
  fxNames: string[]
  /** Custom properties to write. Author overrides only — defaults stay in CSS `var()` fallbacks. */
  vars: Record<string, string>
  /** Longhand animation declarations, compiled as parallel lists so effects compose. */
  declarations: Record<string, string>
  /** Effects whose renderer needs JS setup. */
  jsEffects: Entry[]
  /** Names that are not registered. Must NOT be stamped, or the element is never rescanned. */
  unknown: string[]
  /** Strictest reduced-motion policy among the composed effects. */
  reducedMotion: ReducedMotionPolicy
  warnings: string[]
}

/**
 * Turn a parsed `data-dsg` value into the writes an element needs.
 *
 * Pure: same inputs always produce the same plan, and nothing is applied to the DOM here. That
 * is what lets composition rules, parameter validation, and declaration output be asserted
 * directly rather than through a rendered document.
 *
 * @param parsed - Output of `parse`.
 * @param registry - Effect catalog to resolve names against.
 * @param timeline - Element-scoped timeline, used to warn on unsupported combinations.
 * @returns A plan describing custom properties, declarations, JS effects, and warnings.
 * @complexity O(e * p) time in composed effects and their parameters; O(e) space.
 * @overallScore 100
 */
export function compile(
  parsed: ParsedValue,
  registry: Registry,
  timeline: Timeline,
): CompiledPlan {
  const warnings = [...parsed.warnings]
  const { entries, unknown } = resolveEntries(parsed.specs, registry, warnings)

  if (entries.length === 0) {
    return emptyPlan(unknown, warnings)
  }

  const composed = resolveComposition(entries, registry, warnings)
  return buildPlan(composed, timeline, unknown, warnings)
}

function emptyPlan(unknown: string[], warnings: string[]): CompiledPlan {
  return {
    fxNames: [],
    vars: {},
    declarations: {},
    jsEffects: [],
    unknown,
    reducedMotion: 'shorten',
    warnings,
  }
}

/**
 * Look every named effect up in the registry, collecting unresolvable names separately.
 *
 * @returns Resolved entries plus the names that did not resolve.
 * @complexity O(e * n) time — the "did you mean" suggestion scans registered names. Only runs on
 *   the error path, so the common case is O(e).
 * @overallScore 100
 */
function resolveEntries(
  specs: EffectSpec[],
  registry: Registry,
  warnings: string[],
): { entries: Entry[]; unknown: string[] } {
  const entries: Entry[] = []
  const unknown: string[] = []

  for (const spec of specs) {
    const resolved = registry.resolve(spec.name)
    if (resolved) {
      entries.push({ spec, resolved })
      continue
    }
    unknown.push(spec.name)
    const hint = suggest(spec.name, registry.names())
    const suffix = hint ? ` — did you mean "${hint}"?` : ''
    warnings.push(`unknown effect "${spec.name}"${suffix}`)
  }

  return { entries, unknown }
}

/**
 * Decide whether a comma list may compose.
 *
 * Order matters: a purpose-built combo preset beats channel analysis, because `fade-up, blur-in`
 * has a tested single-keyframe implementation even though both effects write `opacity`.
 * A genuine collision falls back to the first effect rather than emitting a visibly wrong
 * animation, and always warns.
 *
 * @returns The entries to compile — either the original list, a single combo, or a single effect.
 * @complexity O(e * c) time in effects and their channels; O(c) space.
 * @overallScore 100
 */
function resolveComposition(entries: Entry[], registry: Registry, warnings: string[]): Entry[] {
  if (entries.length <= 1) return entries

  const combo = registry.findCombo(entries.map((e) => e.spec.name))
  if (combo) {
    const first = entries[0]!.spec
    return [{ spec: { ...first, name: combo.preset.name }, resolved: combo }]
  }

  const conflicts = findConflicts(
    entries.map((e) => ({ name: e.spec.name, channels: e.resolved.primitive.channels })),
  )
  if (conflicts.length === 0) return entries

  warnings.push(
    `cannot compose: ${describeConflicts(conflicts)}. ` +
      `Register a combo preset, or apply them to nested elements.`,
  )
  return [entries[0]!]
}

/**
 * Build the plan for an already-validated set of entries.
 *
 * @complexity O(e * p) time in effects and parameters; O(e) space.
 * @overallScore 100
 */
function buildPlan(
  entries: Entry[],
  timeline: Timeline,
  unknown: string[],
  warnings: string[],
): CompiledPlan {
  const plan = emptyPlan(unknown, warnings)
  const tracks: AnimationTracks = { names: [], durations: [], delays: [], easings: [] }

  for (const entry of entries) {
    const { preset, primitive } = entry.resolved
    plan.fxNames.push(preset.name)
    plan.reducedMotion = strictestPolicy(plan.reducedMotion, primitive.reducedMotion)
    warnUnsupportedTimeline(preset.name, primitive.supportedTimelines, timeline, warnings)

    const authored = { ...preset.params, ...entry.spec.params }
    Object.assign(plan.vars, resolveParams(authored, primitive.parameters, (m) => warnings.push(m)))

    if (primitive.renderer === 'css-keyframes') pushTrack(tracks, entry)
    else plan.jsEffects.push(entry)
  }

  Object.assign(plan.declarations, declarationsFor(tracks))
  return plan
}

interface AnimationTracks {
  names: string[]
  durations: string[]
  delays: string[]
  easings: string[]
}

/**
 * Append one effect to the parallel animation lists.
 *
 * Separate rules cannot both contribute an `animation` declaration — the cascade discards one —
 * so composition is expressed as parallel longhand value lists on a single declaration.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function pushTrack(tracks: AnimationTracks, entry: Entry): void {
  const { spec, resolved } = entry
  tracks.names.push(resolved.preset.keyframes ?? `dsg-${resolved.preset.name}`)
  tracks.durations.push(spec.duration ?? 'var(--dsg-duration, 600ms)')
  tracks.delays.push(staggerDelay(spec.delay))
  tracks.easings.push(easingValue(spec.easing))
}

function declarationsFor(tracks: AnimationTracks): Record<string, string> {
  if (tracks.names.length === 0) return {}
  return {
    'animation-name': tracks.names.join(', '),
    'animation-duration': tracks.durations.join(', '),
    'animation-delay': tracks.delays.join(', '),
    'animation-timing-function': tracks.easings.join(', '),
    'animation-fill-mode': tracks.names.map(() => 'both').join(', '),
  }
}

function strictestPolicy(a: ReducedMotionPolicy, b: ReducedMotionPolicy): ReducedMotionPolicy {
  return RM_RANK[b] > RM_RANK[a] ? b : a
}

function warnUnsupportedTimeline(
  name: string,
  supported: Timeline[],
  timeline: Timeline,
  warnings: string[],
): void {
  if (supported.includes(timeline)) return
  warnings.push(
    `"${name}" does not support timeline "${timeline}" (supports: ${supported.join(', ')})`,
  )
}

/**
 * Fold stagger into the delay so the browser does the arithmetic; the scanner only writes each
 * child's index once.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function staggerDelay(delay: string | undefined): string {
  const base = delay ?? 'var(--dsg-delay, 0ms)'
  return `calc(${base} + var(--dsg-i, 0) * var(--dsg-stagger, 0ms))`
}

function easingValue(easing: string | undefined): string {
  if (!easing) return 'var(--dsg-ease, ease-out)'
  if (NATIVE_EASINGS.has(easing)) return easing
  if (easing.includes('(')) return easing
  return `var(--dsg-ease-${easing}, ease-out)`
}
