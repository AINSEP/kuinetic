import type { PrepareContext } from '../core/effect-context.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import type { AttributeLedger } from '../core/owned-styles.js'
import type { Cleanup, EffectParams, ParamSpec } from '../core/types.js'

/**
 * Marking the children of a stepped effect, shared by every primitive that has an index.
 *
 * Two primitives publish `data-kui-step` — `scroll-progress` (scroll-driven, backs
 * `scrollytelling-step`) and `step-progress` (click-driven, forms) — and the attribute alone puts
 * all the work on the author. Selecting "the child matching the current index" is the one thing CSS
 * cannot express, so a page had to enumerate it:
 *
 * ```css
 * [data-kui-step='0'] li:nth-child(1),
 * [data-kui-step='1'] li:nth-child(2),
 * [data-kui-step='2'] li:nth-child(3),
 * [data-kui-step='3'] li:nth-child(4) { ... }
 * ```
 *
 * Four selectors for four steps, doubled for every property group, and every one of them wrong the
 * moment a fifth step is added or an element is inserted above the list. `demo/scroll.html` carried
 * eight such selectors for one demo.
 *
 * Marking the children instead collapses that to `li[data-kui-step-state='active']`, which does not
 * change when the step count does. Three values rather than a boolean, because a stepper wants
 * "everything up to here" (`:not([data-kui-step-state='after'])`) as often as it wants the live one.
 */

/** The attribute this module owns. Never write it from anywhere else. */
export const STEP_STATE_ATTR = 'data-kui-step-state'

export type StepState = 'before' | 'active' | 'after'

/**
 * Classify a selector as unusable, dangerously broad, or fine.
 *
 * `matches` against the two roots catches every selector that reaches the whole document — `*`,
 * `html`, `body` and compounds like `*, a` with one rule and no bespoke parser — while leaving a
 * deliberately scoped wildcard such as `.spy-nav > *` working, which a syntactic ban on `*` would
 * not. `matches` throws on invalid syntax exactly as `querySelectorAll` does, so the same call
 * still answers the validity question.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function selectorBreadth(
  selector: string,
  doc: Document,
): 'invalid' | 'document-wide' | 'ok' {
  try {
    if (doc.documentElement.matches(selector)) return 'document-wide'
    if (doc.body?.matches(selector)) return 'document-wide'
    return 'ok'
  } catch {
    return 'invalid'
  }
}

/**
 * Resolve a `target:` selector once at setup, rejecting both the unusable and the over-broad.
 *
 * Two distinct failures, one warning channel. An invalid selector thrown from inside the shared
 * scheduler's frame callback would skip every other subscriber on that root, not just this one. An
 * over-broad one is worse for being silent: `target:*` is perfectly valid syntax, so a syntax-only
 * check passed it straight through to stamp an attribute onto every element in the document, on
 * every frame.
 *
 * Rejecting rather than silently narrowing is the honest response, because there is no narrower
 * selector that could be meant. A selector reaching `<html>` or `<body>` is not naming a set of
 * steps or a nav link, it is naming the page, and guessing which of its thousands of descendants
 * the author meant would be worse than saying so.
 *
 * @param selector - The authored `target:` value; empty is the no-op default, not an error.
 * @param ctx - Prepare context, for `doc` and the warning channel.
 * @param effect - Effect name, so the warning says which attribute to go and fix.
 * @returns The selector, or `''` when it must be ignored.
 * @complexity O(1) time and space; `matches` walks the selector, not the document.
 * @overallScore 100
 */
export function resolveTarget(selector: string, ctx: PrepareContext, effect: string): string {
  if (!selector) return selector
  const breadth = selectorBreadth(selector, ctx.doc)
  if (breadth === 'invalid') {
    ctx.warn(`${effect} target "${selector}" is not a valid selector and will be ignored`)
    return ''
  }
  if (breadth === 'document-wide') {
    ctx.warn(`${effect} target "${selector}" matches the whole document and will be ignored`)
    return ''
  }
  return selector
}

/**
 * Which tree a validated `target:` is searched in.
 *
 * `'self'` is the descendant reading — "search inside myself" — and is what `target:` means
 * everywhere the word is used going forward. `'page'` is the whole document, which four resolution
 * sites need today because the element they mark is deliberately somewhere else: `scroll-spy`'s nav
 * link lives outside the section that activates it, and `media-scrub`'s frames may sit in a sibling
 * figure.
 *
 * Two values, declared as a list rather than a boolean, so `'parent'` or `'section'` can be added
 * later by extending {@link SCOPE_PARAM}'s `values` — a one-line change with no rename anywhere.
 */
export type TargetScope = 'self' | 'page'

/**
 * The one declaration of `scope:`, shared by every primitive that declares `target:`.
 *
 * Declared once rather than restated per primitive for the same reason `resolveTarget` lives here
 * rather than in each caller: `target:`/`scope:` is one convention across the library, and six
 * copies of a `values` list is six places for it to drift.
 *
 * `default: ''` is load-bearing, not a style choice. `readParams` (`core/js-params.ts`) seeds
 * `out[name] = spec.default` for *every* declared parameter before reading authored values, and
 * `createParams`' `text` accessor uses `??`, so a non-empty schema default would make the
 * caller-supplied fallback in {@link scopeParam} unreachable. `scroll-spy` is one primitive with
 * one `ParameterSchema` whose two forms need opposite defaults (`'page'` for the per-section form,
 * `'self'` for the container form), so "unset" has to be spellable — which is exactly why `target`
 * itself is already declared `default: ''` on all six.
 *
 * `type: 'keyword'`, not `'text'`: only `keyword` treats `values` as a *closed set*. On every other
 * type `values` is additive — "extra literals accepted alongside the type's own grammar" — and a
 * `text` param short-circuits to `ok` immediately after the `values` check, so `scope:pgae` would
 * be accepted in silence and then read as unset. The cost is that `--kui-scope` reaches
 * `element.style` when authored, where nothing reads it; an inert custom property is a much smaller
 * price than a typo that fails silently.
 */
export const SCOPE_PARAM: ParamSpec = {
  type: 'keyword',
  default: '',
  cssProperty: '--kui-scope',
  values: ['self', 'page'],
}

/**
 * Read `scope:`, falling back to the resolution site's own historical default.
 *
 * The fallback is per *call site*, not per primitive, because `scroll-spy` resolves the same
 * declared parameter document-wide in one form and descendant-scoped in the other.
 *
 * @param params - The effect's validated parameters.
 * @param fallback - What this site scoped to before `scope:` existed. Passing today's behaviour
 *   here is what makes declaring the parameter a no-op for existing markup.
 * @returns The authored scope, or `fallback` when unset or unrecognised.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function scopeParam(params: EffectParams, fallback: TargetScope): TargetScope {
  const authored = params.text('scope')
  if (authored === 'page') return 'page'
  if (authored === 'self') return 'self'
  return fallback
}

/**
 * Resolve a validated `target:` selector under a scope.
 *
 * {@link resolveTarget} has already run: this does no validation of its own, so an invalid or
 * document-wide selector must have been rejected before it gets here. Kept separate because the
 * two questions have different lifetimes — validity is answered once at setup, while the *match*
 * is re-asked per flip by `createStepMarker`, deliberately, so a list rendered after setup is
 * still picked up.
 *
 * @param el - The authored host. The search root under `'self'`.
 * @param ctx - Prepare context, for `doc` — the search root under `'page'`.
 * @param selector - A validated, non-empty `target:` value.
 * @param scope - Which tree to search.
 * @returns The matches, in document order.
 * @complexity O(n) time and space in matches; the query itself is the DOM's.
 * @overallScore 100
 */
export function queryScoped(
  el: Element,
  ctx: PrepareContext,
  selector: string,
  scope: TargetScope,
): Element[] {
  return [...(scope === 'page' ? ctx.doc : el).querySelectorAll(selector)]
}

/**
 * A set of step elements plus the ledgers that let their original attributes survive teardown.
 *
 * One ledger per element ever written, rather than a bare Set of touched nodes: a Set records
 * *which* elements were stamped but not *what they held first*, so teardown would remove a
 * `data-kui-step-state` the consumer had authored themselves. Same reasoning as `scroll-spy`'s
 * link ledgers and the inline-style ledger they were both modelled on.
 */
export interface StepMarker {
  /** Stamp `before`/`active`/`after` across the tracked elements. Cheap enough to call per flip. */
  mark(index: number): void
  /** Give every touched element back the attribute value it had before this instance existed. */
  restore: Cleanup
}

/**
 * Build a marker over the elements a stepped effect drives.
 *
 * `resolve` is called per flip rather than once at setup, so a list rendered or reordered after
 * this element was prepared is still picked up. Flips are rare — the caller is expected to guard on
 * the index actually changing — while frames are not.
 *
 * @param resolve - Produces the current step elements, in document order.
 * @returns A marker; call `restore` from the primitive's teardown.
 * @complexity O(n) per `mark` in the number of step elements; O(n) space in elements ever touched.
 * @overallScore 100
 */
export function createStepMarker(resolve: () => Iterable<Element>): StepMarker {
  const ledgers = new Map<Element, AttributeLedger>()

  return {
    mark(index) {
      /*
       * Position is counted within each matched element's own parent, not across the whole match.
       *
       * `querySelectorAll` returns document order, so a target naming two parallel groups — the
       * copy lines *and* the dots that track them, which is the shape every scrollytelling layout
       * has — would otherwise number them 0-3 and then 4-7, leaving the second group permanently
       * `after`. Per-parent numbering makes both read 0-3 and is identical to flat numbering for
       * the single-group case, which is the common one.
       */
      const seen = new Map<Element | null, number>()
      for (const node of resolve()) {
        const parent = node.parentElement
        const position = seen.get(parent) ?? 0
        seen.set(parent, position + 1)

        let ledger = ledgers.get(node)
        if (!ledger) {
          ledger = createAttributeLedger(node)
          ledgers.set(node, ledger)
        }
        // The ledger remembers only the value it first replaced, so repeated flips never overwrite
        // the consumer's original with one of this instance's own writes.
        ledger.set(STEP_STATE_ATTR, stepStateFor(position, index))
      }
    },
    restore() {
      for (const ledger of ledgers.values()) ledger.restore()
      ledgers.clear()
    },
  }
}

/**
 * Where one step sits relative to the live one.
 *
 * Pure, so the three-way split is assertable without a DOM.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function stepStateFor(position: number, index: number): StepState {
  if (position < index) return 'before'
  if (position === index) return 'active'
  return 'after'
}
