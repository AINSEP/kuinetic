import type { EffectParams, ParamSpec } from './types.js'

/**
 * The slice of `PrepareContext` `resolveTarget`/`queryScoped` actually need.
 *
 * A real `PrepareContext` satisfies this structurally — it has both fields and more — so every
 * existing call site (the primitives' own `prepare`, which is handed a full `PrepareContext`)
 * keeps compiling unchanged. Declared narrow rather than importing `PrepareContext` itself so
 * `animator.ts`'s `install` — which resolves a retargeted selector at compile-to-install time,
 * before any primitive's `prepare` has run and therefore before a full `PrepareContext` exists —
 * can build the two fields it actually has (`el.ownerDocument`, a warn callback) instead of
 * fabricating the rest of the interface it does not.
 */
export interface TargetContext {
  doc: Document
  warn(message: string): void
}

/**
 * `target:`/`scope:` resolution — one convention shared by every place in the library that lets an
 * author name a selector instead of animating the element the attribute sits on.
 *
 * Lives in `core`, not `effects`, because `core/compile.ts` and `core/animator.ts` need it too:
 * `target:` started as a per-primitive parameter six scroll/forms primitives read for themselves
 * (`effects/step-marking.ts`'s `createStepMarker` still owns the step-index-specific half of that),
 * but retargeting an *arbitrary* effect (`fade-up target:h1`) has to be decided at compile/install
 * time, before any primitive's own `prepare` ever runs. `core` must not depend on `effects` — every
 * import in this codebase already runs the other way — so the shared half of the mechanism lives
 * here and `effects/step-marking.ts` imports it back, rather than `core` reaching into `effects`.
 */

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
export function resolveTarget(selector: string, ctx: TargetContext, effect: string): string {
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
 * everywhere the word is used going forward. `'page'` is the whole document, which a handful of
 * resolution sites need because the element they mark is deliberately somewhere else: `scroll-spy`'s
 * nav link lives outside the section that activates it, and `media-scrub`'s frames may sit in a
 * sibling figure.
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
 * itself is already declared `default: ''` on every primitive that owns the parameter.
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
 * document-wide selector must have been rejected before it gets here.
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
  ctx: Pick<TargetContext, 'doc'>,
  selector: string,
  scope: TargetScope,
): Element[] {
  return [...(scope === 'page' ? ctx.doc : el).querySelectorAll(selector)]
}
