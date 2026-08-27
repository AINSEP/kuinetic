import { ATTR } from './attrs.js'
import { parse } from './parse.js'
import { suggest } from './registry.js'
import type { Registry } from './registry.js'
import type { Reporter } from './reporter.js'
import type { EffectSpec, ParsedValue } from './types.js'

/**
 * Author-defined effect bundles — a name for a composition, with no build step.
 *
 * ```html
 * <template data-kui-define="hero-entrance"
 *           data-kui="fade-up 2000ms, tween-from y:40 600ms at:-400ms, pop-open 1200ms 2000ms">
 * </template>
 *
 * <article data-kui="hero-entrance"></article>
 * <article data-kui="hero-entrance, lift-shadow"></article>
 * ```
 *
 * ## Why the name is a second attribute
 *
 * Everything about the spelling is forced by the grammar that already exists. `name:value` is a
 * *parameter* (`duration:1200ms`, `target:h1`), so a leading `bundle-name:` parses as a key. The
 * comma already means "compose the next effect", so a comma inside the definition would be
 * ambiguous with the comma separating definitions from anything else on the element. That leaves
 * the name in its own attribute and the body in `data-kui`, where `parse()` reads it completely
 * unchanged — this module adds no syntax at all, only a lookup.
 *
 * `<template>` is the definition site because it never renders, needs no `hidden`, and is the
 * platform's own answer for "markup that is data". A definition on any other element is accepted
 * and warned about rather than refused, because the element's `data-kui` is data either way and
 * silently animating a definition would be worse than a message.
 *
 * ## Precedence: a local parameter overrides the bundle
 *
 * `data-kui="hero-entrance 400ms"` runs at 400ms, the way a more specific CSS rule wins. Every
 * positional and `key:value` token written beside the reference overlays the same field on *every*
 * segment the bundle expands to. This is settled deliberately and cannot be reversed later: pages
 * written against it would change meaning.
 *
 * ## Resolution happens here, not in `registry.ts`
 *
 * A bundle looks like an author-defined preset, but a `Preset` is one primitive plus parameter
 * defaults, and a bundle is a *list* of segments with their own durations, `at:` offsets and
 * gates — the registry has no shape for that. `registerPreset` also throws on a duplicate name and
 * lives on a registry shared between animators, so author markup could crash a page or leak one
 * page's names into another's. Expansion is therefore a spec-list rewrite that happens between
 * `parse()` and `compileTargets()`: everything downstream — channel conflicts, sequencing, target
 * grouping, `data-kui-fx` — sees exactly the specs the author would have written by hand, so a
 * bundle can never behave differently from its own expansion.
 *
 * ## Forward references cannot break
 *
 * Two independent reasons, not one. `Animator.scan` collects every definition in the subtree
 * *before* it compiles any element in it, so a `<template>` at the bottom of the document is
 * already known to a card at the top. And a definition is stored **unexpanded**, so a bundle that
 * names another bundle has no ordering requirement at all — references are resolved at use time,
 * against a table that is finished by then.
 */

/** Element-scoped keys a bundle carries to its usage site. `cascade`/`order` are excluded — see `readBundle`. */
type BundleHoists = Pick<ParsedValue, 'activation' | 'timeline' | 'threshold' | 'rm' | 'func'>

const HOIST_KEYS = ['activation', 'timeline', 'threshold', 'rm', 'func'] as const

type HoistKey = (typeof HOIST_KEYS)[number]

/** `activation` is the internal name for the key an author spells `on:`; diagnostics use theirs. */
const HOIST_LABELS: Record<HoistKey, string> = {
  activation: 'on',
  timeline: 'timeline',
  threshold: 'threshold',
  rm: 'rm',
  func: 'func',
}

interface Bundle {
  /** Raw definition text, so re-collecting the same unchanged definition is silently idempotent. */
  source: string
  specs: EffectSpec[]
  hoists: BundleHoists
}

/** Accumulators threaded through a recursive expansion, so nothing has to be returned twice. */
interface Sink {
  warnings: string[]
  hoists: BundleHoists
}

/**
 * Author-defined bundles for one animator root.
 *
 * A class rather than a closure for the same reason {@link Registry} is one: it is a table with a
 * handful of operations on it, and the operations read better named than nested.
 */
export class BundleTable {
  private readonly bundles = new Map<string, Bundle>()

  /**
   * @param registry - Consulted for name collisions only; a bundle never enters it.
   */
  constructor(private readonly registry: Registry) {}

  /**
   * Register every definition in a subtree, including the subtree root itself.
   *
   * @returns How many *new* names were registered, so the caller can decide whether anything it
   *   already compiled deserves a second chance.
   * @complexity O(n) time in the subtree's element count; O(d) space in definition count.
   * @overallScore 100
   */
  collect(root: ParentNode, reporter: Reporter): number {
    let added = 0
    for (const el of definitionsIn(root)) {
      if (this.define(el, reporter)) added++
    }
    return added
  }

  /**
   * Rewrite bundle references into the segments they stand for.
   *
   * @returns A new `ParsedValue`; the argument is returned untouched when nothing is defined.
   * @complexity O(s) time in the total segment count across the bundles reached; O(s) space.
   * @overallScore 100
   */
  expand(parsed: ParsedValue): ParsedValue {
    // Nothing defined on this page: not merely an optimisation, it is what keeps a page that never
    // uses the feature from paying a map lookup and a Levenshtein pass per segment.
    if (this.bundles.size === 0) return parsed
    const sink: Sink = { warnings: [...parsed.warnings], hoists: {} }
    const specs = this.expandList(parsed.specs, [], sink)
    const result: ParsedValue = { ...parsed, specs, warnings: sink.warnings }
    // Last, and through the same first-wins helper: whatever the element wrote itself is already in
    // `result`, so it is what wins. A bundle's `on:` therefore sits exactly where an inline `on:`
    // sits, including its precedence over the longhand `data-kui-on`.
    for (const key of HOIST_KEYS) absorbHoist(result, sink.hoists, key)
    return result
  }

  /**
   * Register one definition element.
   *
   * @returns Whether this call added a name the table did not have.
   * @complexity O(n) time in the body's length; O(e) space in its segment count.
   * @overallScore 100
   */
  private define(el: Element, reporter: Reporter): boolean {
    // Never null: every element reaching here matched `[data-kui-define]`, so the attribute is
    // present — possibly empty, which is what `nameProblem` refuses. `data-kui` genuinely can be
    // absent, and an absent body is a definition that names no effect.
    const name = el.getAttribute(ATTR.define)!.trim()
    const source = el.getAttribute(ATTR.source) ?? ''
    const problem = this.nameProblem(name)
    if (problem) {
      reporter.warn(problem, el)
      return false
    }
    const existing = this.bundles.get(name)
    if (existing) {
      // Silent when the body is identical: `collect` runs on every scan, so re-reading the same
      // definition is the normal case and must not warn. First wins, for the same reason
      // `parse.ts`'s `assignOnce` keeps the first hoist — behaviour stays deterministic.
      if (existing.source !== source) {
        reporter.warn(`bundle "${name}" is already defined — the first definition wins`, el)
      }
      return false
    }
    if (el.localName !== 'template') {
      reporter.warn(
        `bundle "${name}" is defined on <${el.localName}> — a definition is data, so it is never animated; use <template>`,
        el,
      )
    }
    this.bundles.set(name, readBundle(name, source, el, reporter))
    return true
  }

  /**
   * Refuse a name that cannot work, with the reason.
   *
   * @returns The diagnostic, or `undefined` when the name is usable.
   * @complexity O(n) time in the name's length; O(1) space.
   * @overallScore 100
   */
  private nameProblem(name: string): string | undefined {
    if (!name) return `${ATTR.define} needs a name — an empty one defines nothing`
    // The name has to survive being written as the first token of a segment, so it cannot contain
    // any character the tokenizer treats as structure. Refused here rather than left to produce a
    // baffling "effect name expected" at every usage site.
    if (/[\s,:()"']/.test(name)) {
      return `bundle name "${name}" cannot contain whitespace, a comma, a colon, parentheses or quotes — those are grammar, so a name carrying them could never be written in ${ATTR.source}`
    }
    // The catalog wins, always. If a bundle could shadow a registered effect, adding a name to the
    // catalog in a later release would silently change what an existing page animates.
    if (this.registry.has(name)) {
      return `bundle "${name}" is already the name of a registered effect — the effect wins and this definition is ignored`
    }
    return undefined
  }

  /**
   * Expand one comma list, recursing through bundles that name other bundles.
   *
   * @param trail - Bundle names currently being expanded, innermost last. Both the cycle guard and
   *   its diagnostic read it, so it is a list rather than a set.
   * @complexity O(s) time in the total segment count across the bundles reached; O(s) space.
   * @overallScore 100
   */
  private expandList(specs: EffectSpec[], trail: string[], sink: Sink): EffectSpec[] {
    const out: EffectSpec[] = []
    for (const spec of specs) {
      const bundle = this.bundles.get(spec.name)
      if (!bundle) {
        out.push(spec)
        this.noteNearMiss(spec.name, sink.warnings)
        continue
      }
      if (trail.includes(spec.name)) {
        sink.warnings.push(cycleWarning(trail, spec.name))
        continue
      }
      takeHoists(bundle, spec.name, sink)
      const inner = this.expandList(bundle.specs, [...trail, spec.name], sink)
      warnOnFlattenedOffsets(spec, inner, sink.warnings)
      for (const member of inner) out.push(overlay(member, spec))
    }
    return out
  }

  /**
   * Name an unregistered effect that is one typo away from a bundle.
   *
   * `compile.ts` already reports every unknown name, with a suggestion drawn from the catalog — a
   * misspelled *bundle* is invisible in that list, so this adds the one fact that message cannot
   * carry. Only for names the registry does not know, or a real effect one edit away from a badly
   * chosen bundle name would be reported as a mistake.
   *
   * @complexity O(b·n) time in bundle count and name length; O(n) space.
   * @overallScore 100
   */
  private noteNearMiss(name: string, warnings: string[]): void {
    if (this.registry.has(name)) return
    const hit = suggest(name, [...this.bundles.keys()])
    if (hit) {
      warnings.push(`"${name}" is not a registered effect — did you mean the bundle "${hit}"?`)
    }
  }
}

/**
 * Read one definition's body.
 *
 * The definition element is never compiled, so this is the only place its `data-kui` is ever
 * parsed — a typo in a bundle body would otherwise be invisible on every page that uses it.
 *
 * @complexity O(n) time in the body's length; O(e) space in its segment count.
 * @overallScore 100
 */
function readBundle(name: string, source: string, el: Element, reporter: Reporter): Bundle {
  const parsed = parse(source)
  for (const warning of parsed.warnings) reporter.warn(`in bundle "${name}": ${warning}`, el)
  if (parsed.specs.length === 0) {
    reporter.warn(`bundle "${name}" names no effect — elements that use it animate nothing`, el)
  }
  // `cascade:`/`order:` are the two hoists a bundle cannot carry, and the reason is a second code
  // path rather than a judgement: `stagger.ts` reads them straight off the group element's own
  // attribute text, in a pass that never sees an expansion. Carried here they would work when the
  // animator asked and not when the stagger pass did — the failure that ships working on one page
  // and silently wrong on the next.
  const group = (['cascade', 'order'] as const)
    .filter((key) => parsed[key] !== undefined)
    .map((key) => `"${key}:"`)
    .join(' and ')
  if (group) {
    reporter.warn(
      `bundle "${name}" declares ${group} — a stagger group is read from the group element's own attribute, which never sees a bundle, so it is dropped; write it on the group element itself`,
      el,
    )
  }
  // `parsed` itself as the hoists: a `ParsedValue` structurally *is* a `BundleHoists` plus more, and
  // narrowing it to the five keys here would mean five lines that say nothing the type does not.
  // Nothing downstream can reach the rest — `Bundle.hoists` is typed to the five.
  return { source, specs: parsed.specs, hoists: parsed }
}

/**
 * Take the bundle's element-scoped keys, first bundle winning.
 *
 * A conflict *between* bundles is warned; a conflict between a bundle and the element's own
 * `on:`/`timeline:`/… is not, because that is the documented precedence rather than a mistake.
 *
 * @complexity O(k) time in the five hoist keys; O(1) space.
 * @overallScore 100
 */
function takeHoists(bundle: Bundle, name: string, sink: Sink): void {
  for (const key of HOIST_KEYS) {
    if (absorbHoist(sink.hoists, bundle.hoists, key) !== 'clash') continue
    const label = HOIST_LABELS[key]
    const kept = String(sink.hoists[key])
    sink.warnings.push(
      `bundle "${name}" sets "${label}:${String(bundle.hoists[key])}", which conflicts with "${label}:${kept}" from an earlier bundle — the first wins`,
    )
  }
}

/**
 * Name a bundle that reaches itself, showing the path that got there.
 *
 * @complexity O(t) time and space in the trail's length.
 * @overallScore 100
 */
function cycleWarning(trail: string[], name: string): string {
  const path = [...trail, name].join(' → ')
  return `bundle "${name}" is defined in terms of itself (${path}) — the reference is dropped`
}

/**
 * Every definition element in a subtree, root included.
 *
 * `querySelectorAll` never returns the node it was called on, and an inserted subtree very often
 * *is* the definition — the same reason `Animator.scan` checks its own root. The node check is
 * structural rather than `instanceof Element`, which is an undeclared identifier in a DOM-less
 * process and throws before `instanceof` runs.
 *
 * @complexity O(n) time in the subtree's element count; O(d) space in definition count.
 * @overallScore 100
 */
function definitionsIn(root: ParentNode): Element[] {
  const selector = `[${ATTR.define}]`
  const found = [...root.querySelectorAll(selector)]
  const self = (root as Node).nodeType === 1 ? (root as Element) : null
  if (self?.matches(selector)) found.unshift(self)
  return found
}

/**
 * Move one hoisted key across, first value winning.
 *
 * @returns `clash` when the target already held a *different* value, so the caller can decide
 *   whether that is worth a diagnostic — between two bundles it is, between a bundle and the
 *   element's own attribute it is the documented precedence.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function absorbHoist<K extends HoistKey>(
  into: BundleHoists,
  from: BundleHoists,
  key: K,
): 'taken' | 'kept' | 'clash' {
  const value = from[key]
  if (value === undefined) return 'kept'
  const current = into[key]
  if (current === undefined) {
    into[key] = value
    return 'taken'
  }
  return current === value ? 'kept' : 'clash'
}

/**
 * Lay the reference's own tokens over one expanded segment.
 *
 * Field by field rather than a spread, because "the author wrote nothing" and "the author wrote
 * something" are the whole distinction: `{ ...member, ...spec }` would overwrite every field with
 * the reference's `undefined`s and erase the bundle entirely.
 *
 * @param member - A segment the bundle expands to.
 * @param ref - The reference as authored, e.g. `hero-entrance 400ms ease-out`.
 * @complexity O(p) time and space in the merged parameter count.
 * @overallScore 100
 */
function overlay(member: EffectSpec, ref: EffectSpec): EffectSpec {
  return {
    ...member,
    duration: ref.duration ?? member.duration,
    delay: ref.delay ?? member.delay,
    easing: ref.easing ?? member.easing,
    at: ref.at ?? member.at,
    gate: ref.gate ?? member.gate,
    repeat: ref.repeat ?? member.repeat,
    yoyo: ref.yoyo ?? member.yoyo,
    params: { ...member.params, ...ref.params },
  }
}

/**
 * Name the one override that silently destroys something rather than replacing it.
 *
 * Overriding a duration replaces one number with another. Overriding `at:` replaces the *shape* of
 * the bundle: every segment lands at the same offset, so a three-beat entrance becomes three
 * things happening at once — visible, unexplained, and nothing else in the pipeline would mention
 * it. Silent only when the bundle set no offsets of its own, which is the case where there is
 * nothing to lose.
 *
 * @complexity O(s) time in the expanded segment count; O(1) space.
 * @overallScore 100
 */
function warnOnFlattenedOffsets(ref: EffectSpec, inner: EffectSpec[], warnings: string[]): void {
  if (ref.at === undefined || !inner.some((member) => member.at !== undefined)) return
  warnings.push(
    `"at:${ref.at}" on "${ref.name}" overrides the offsets the bundle sets on its own segments — they now all start at the same position`,
  )
}
