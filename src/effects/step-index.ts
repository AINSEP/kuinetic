import type { Cleanup, EffectParams } from '../core/types.js'
import type { PrepareContext } from '../core/effect-context.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget } from '../core/target.js'
import type { TargetScope } from '../core/target.js'
import { createStepMarker } from './step-marking.js'

export interface StepIndexOptions {
  el: Element
  params: EffectParams
  ctx: PrepareContext
  scope: TargetScope
  resolveSteps: () => Iterable<Element>
  onRender?: (index: number, total: number) => void
  clickFallback?: boolean
  name?: string
}

export interface StepIndex {
  goTo(index: number): void
  next(): void
  prev(): void
  current(): number
  total(): number
  release(): void
}

/**
 * Advance a step index, wrapping back to 0 — pure, so the wrap rule is assertable without a DOM.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function nextStep(step: number, total: number): number {
  return total > 0 ? (step + 1) % total : 0
}

/**
 * Step backwards, wrapping to the last index — the mirror of `nextStep`, and pure for the same
 * reason: the wrap is the whole of the rule and it is worth asserting without a DOM.
 *
 * `+ total` before the modulo rather than a `< 0` branch: `-1 % 5` is `-1` in JS, not `4`, so the
 * naive mirror of `nextStep` silently produces a negative index that marks nothing and reads as a
 * dead control rather than an error.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function prevStep(step: number, total: number): number {
  return total > 0 ? (step - 1 + total) % total : 0
}

/**
 * Clamp an authored or computed index into range, wrapping the same way the steppers do.
 *
 * `jump:` takes its index from a control's position among its siblings, which is trustworthy —
 * but `steps:` is authored separately, so a page with six dots and `steps:4` would otherwise set
 * an index no step element has. Wrapping rather than clamping keeps one rule across all three
 * controls instead of two.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function clampStep(step: number, total: number): number {
  return total > 0 ? ((step % total) + total) % total : 0
}

/**
 * How many steps there are, asked freshly on each call rather than fixed at setup.
 *
 * `steps:` used to be required and defaulted to 4, which is the wrong shape for a deck: the number
 * is not a *choice* an author makes, it is a fact about how many slides they wrote, and stating it
 * twice means a sixth slide that silently never gets reached. Counting instead makes `steps:` an
 * override for the case the elements cannot answer — and asking per flip rather than once means a
 * slide added after setup is picked up, matching `createStepMarker`, which already re-resolves per
 * flip for exactly that reason.
 *
 * Counted per *parent*, taking the largest group, not as a flat total. `target:` routinely names
 * two parallel groups — the slides and the dots that track them — and a flat count of a five-slide
 * deck with five dots is ten. Per-parent is also precisely how the marker numbers them, so the
 * count and the marking cannot disagree.
 *
 * Exported for `effects/carousel`, which drives an index over the same shape of markup and must
 * count it the same way. A second implementation of "how many slides are there" is exactly the
 * drift `createStepMarker` was extracted to end for the marking half.
 *
 * @complexity O(n) time and space in the matched elements.
 * @overallScore 100
 */
export function countSteps(params: EffectParams, resolveSteps: () => Iterable<Element>): number {
  const authored = Math.round(params.num('steps', 0))
  if (authored >= 1) return authored
  const groups = new Map<Element | null, number>()
  for (const node of resolveSteps()) {
    groups.set(node.parentElement, (groups.get(node.parentElement) ?? 0) + 1)
  }
  return Math.max(1, ...groups.values())
}

/** One named control group: the selector the author wrote, and what pressing a match does. */
export interface ControlGroup {
  selector: string
  /** @param position - The pressed control's place among its own group, in document order. */
  run: (node: Element, position: number) => void
}

/**
 * Bind every named control group with a *single* delegated listener on the scope root.
 *
 * One listener per matched node was the obvious form and it had a hole with no warning attached:
 * the nodes are matched once, at prepare time, so a dot rendered afterwards was inert forever. The
 * arrows kept working — they ask `countSteps` for the total on every press, so they reached the new
 * slide fine — which made the failure look like "the dots are broken" rather than "controls are
 * bound once". Delegation removes the setup-time snapshot entirely: a control is whatever matches
 * the selector at the moment of the press, which is the same rule `resolveSteps` and `countSteps`
 * already follow, and it collapses teardown from N removals to one.
 *
 * The root is the *scope* root, not simply the host. Under the page scope `step-progress` has
 * always resolved with, a control may legitimately sit outside the element it drives — arrows in a
 * section header above the deck — and a listener on the host would never see those clicks.
 *
 * Exported for `effects/carousel` alongside `countSteps`: `next:`/`prev:`/`jump:` mean the same
 * thing on a ring as they do on a bar, and every subtlety in the walk below (the `:scope` root, the
 * per-press re-query, the `scope:self` containment) was found once and should not be found again.
 *
 * @returns The teardown for the one listener.
 * @complexity O(g × (m + d)) per click — one scoped query and one ancestor walk per named group,
 *   in that group's matches `m` and the pressed node's depth `d`; O(m) space for the largest group.
 * @overallScore 100
 */
export function delegateControls(request: {
  el: Element
  ctx: PrepareContext
  scope: TargetScope
  groups: ControlGroup[]
}): Cleanup {
  const { el, ctx, scope, groups } = request
  if (groups.length === 0) return () => {}
  const root: Element | Document = scope === 'page' ? ctx.doc : el
  const onClick = (event: Event): void => {
    const from = event.target as Element | null
    // Not `instanceof Element`: the document a primitive is handed need not be this realm's, and a
    // cross-realm `instanceof` is false for a perfectly good element. Every Element carries
    // `closest`, so duck-typing it is the realm-agnostic way to ask whether this target is one.
    if (typeof from?.closest !== 'function') return
    for (const { selector, run } of groups) {
      // Looked up on the press, never captured. Captured, it goes stale the moment the deck
      // changes: with three slides doubling as their own jump controls, select the third, remove
      // the second, and the third still believes it is index 2 — which now wraps to 0, so two
      // controls select the same slide and one is unreachable.
      const matches = queryScoped(el, ctx, selector, scope)
      /*
       * Walked up from the pressed node against that set, rather than compared against it: a
       * control is usually a `<button>` with a label or an icon inside it, and the press lands on
       * that child. Per-node listeners got this for free by sitting on the button itself; a
       * delegated one has to ask. The walk is equally what keeps a click that merely *bubbles
       * through* an unrelated descendant from counting — nothing on the way up is in the set, so
       * nothing runs.
       *
       * `from.closest(selector)` was the obvious way to do that walk and is the wrong root:
       * `closest` evaluates `:scope` against the node it is called on, so `next:":scope > .next"`
       * asked for a child of the pressed button and matched nothing, ever — while setup had
       * already rooted the same `:scope` at the host. Matching against what `queryScoped` returns
       * puts the press and the setup on one root, whatever the selector says.
       *
       * It is also what enforces the `scope:self` containment `closest` needed a separate guard
       * for: `closest` searched *past* the host as well as inside it, so a deck wrapped in an
       * element that happened to match `next:` advanced on any press inside it. Under `'self'`
       * `queryScoped` only ever returns descendants of the host, so there is nothing above the
       * host in the set to walk into.
       */
      const matched = new Set(matches)
      let node: Element | null = from
      while (node && !matched.has(node)) node = node.parentElement
      if (!node) continue
      run(node, matches.indexOf(node))
    }
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}

/**
 * Shared step index for click-driven steppers and showcase slideshows.
 *
 * Re-queries steps on every render so added or removed slides cannot leave stale marks. The
 * optional render hook lets a widget mirror the selected index into ARIA without owning it twice.
 *
 * @complexity O(n) per render in the step and control groups; O(n) marker storage.
 * @overallScore 100
 */
export function createStepIndex(options: StepIndexOptions): StepIndex {
  const { el, params, ctx, scope, resolveSteps, onRender } = options
  const name = options.name ?? 'step-progress'
  const marker = createStepMarker(resolveSteps, (message) => ctx.warn(`${name} ${message}`))
  const self = createAttributeLedger(el)
  const selfStyle = createStyleLedger(el)
  const total = (): number => countSteps(params, resolveSteps)
  let step = 0
  const render = (): void => {
    self.set('data-kui-step', String(step))
    selfStyle.set('--kui-step', String(step))
    marker.mark(step)
    onRender?.(step, total())
  }
  const goTo = (index: number): void => {
    // Always render: the selected number can stay the same while the matched elements change.
    step = clampStep(index, total())
    render()
  }
  const next = (): void => goTo(nextStep(step, total()))
  const prev = (): void => goTo(prevStep(step, total()))
  const groups: ControlGroup[] = []
  const bindControl = (param: string, run: ControlGroup['run']): boolean => {
    const selector = resolveTarget(params.text(param), ctx, `${name} ${param}`)
    if (!selector) return false
    if (queryScoped(el, ctx, selector, scope).length === 0) {
      ctx.warn(`${name} ${param} "${selector}" matched nothing`)
    }
    groups.push({ selector, run })
    return true
  }
  const named = [
    bindControl('next', next),
    bindControl('prev', prev),
    bindControl('jump', (_node, position) => { if (position >= 0) goTo(position) }),
  ].some(Boolean)
  const fallback = options.clickFallback !== false && !named
  if (fallback) el.addEventListener('click', next)
  const releaseControls = delegateControls({ el, ctx, scope, groups })
  render()
  return {
    goTo, next, prev, current: () => step, total,
    release: () => {
      if (fallback) el.removeEventListener('click', next)
      releaseControls()
      self.restore()
      selfStyle.restore()
      marker.restore()
    },
  }
}
