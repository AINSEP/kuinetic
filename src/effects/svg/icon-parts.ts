import { ATTR } from '../../core/attrs.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import { inheritTimingContract } from '../../core/timing-contract.js'
import type { Primitive } from '../../core/types.js'

/**
 * Owned by phase 7b — the icon-toggle family's structural parts: a host with no authored
 * `.kui-bar` children gets `data-kui-part="bar"` stamped on its positional bars, restored on
 * teardown, so `svg.css` (via `icon-parts.css`'s twin rules) can style them without the author
 * having to add classes of their own (mirrors 7a's flip-card parts, one prepare layer up).
 */

/** The drawable shapes svg.css's icon-toggle markup uses in place of `<span class="kui-bar">`
 *  when the whole control is one `<svg>`, in document order regardless of how the list orders
 *  them (`querySelectorAll` always returns document order, not selector-declaration order). */
const SVG_BAR_SELECTOR = 'line, rect, path, polyline, circle'

/**
 * Find a host's positional bars when it authored no `.kui-bar` of its own.
 *
 * Two shapes cover every icon-toggle preset's undocumented (class-free) markup: a single `<svg>`
 * child, whose drawable children stand in for the bars, or a plain host whose direct element
 * children are the bars — except one that carries its own text, which is a label (`<span
 * aria-hidden>Menu</span>`-style), not a moving part.
 *
 * @param el - The icon-toggle host.
 * @returns The bars, in document order; empty when neither shape matches.
 * @complexity O(n) time in the host's descendants (the `<svg>` branch) or direct children
 *   (the other branch); O(n) space for the returned list.
 * @overallScore 100
 */
function findBars(el: Element): Element[] {
  const children = Array.from(el.children)
  const sole = children.length === 1 ? children[0] : undefined
  if (sole && sole.tagName.toLowerCase() === 'svg') return Array.from(sole.querySelectorAll(SVG_BAR_SELECTOR))
  // A label sibling (`<span>Menu</span>`) has text of its own; a bar never does — it is a plain
  // decorative box the CSS transitions `translate`/`rotate`/`opacity`/`clip-path`/`scale` on.
  // Always a string, never null: `Node.textContent` can be null for a document or doctype node,
  // but `children` only ever holds `Element`s, whose own `textContent` is spec'd to always return
  // one (`''` for an empty element), never `null`.
  return children.filter((child) => child.textContent!.trim() === '')
}

/**
 * Wrap an icon-toggle-family `prepare` so a host with no `.kui-bar` children gets
 * `data-kui-part="bar"` on its positional bars.
 *
 * Stamps eagerly, before calling `inner`: `stylesheetTimingPrepare` (the only `inner` this ever
 * wraps today) runs at install, not activation — only *its* inner mirroring is deferred — and the
 * stamp has to be in place at the same moment, or `icon-parts.css`'s `[data-kui-part='bar']` rules
 * have nothing to select yet when the browser's next paint reads them. Restored on `ctx.signal`
 * abort, which fires when the instance releases (mirrors `flip-parts.ts`'s (7a) attribute-ledger
 * cleanup one primitive over) — never on `reset()`/`destroy()` directly, since `PrepareContext`
 * hands `prepare` nothing else that fires on every teardown path.
 *
 * A host that already wrote its own `.kui-bar` markup is untouched: `findBars` never runs, so
 * nothing here can clash with class-based CSS an author is already relying on.
 *
 * @param inner - The primitive's own `prepare`, unwrapped.
 * @returns A `prepare` of the same shape, with the part-stamping layered in.
 * @complexity O(n) time in the host's children, beyond whatever `inner` itself costs; O(n)
 *   additional space held past `prepare` for the bars' ledgers, until `ctx.signal` aborts.
 * @overallScore 100
 */
export function withIconParts(inner: NonNullable<Primitive['prepare']>): NonNullable<Primitive['prepare']> {
  return inheritTimingContract<NonNullable<Primitive['prepare']>>(inner, (el, params, ctx) => {
    if (!el.querySelector('.kui-bar')) {
      const bars = findBars(el)
      if (bars.length > 0) {
        // Stamped inside the same `map` that creates each ledger, rather than a second indexed
        // pass over `bars`/`ledgers` in lockstep — `noUncheckedIndexedAccess` types `ledgers[i]`
        // as possibly `undefined` no matter how obviously the two arrays stay in sync.
        const ledgers = bars.map((bar) => {
          const ledger = createAttributeLedger(bar)
          ledger.set(ATTR.part, 'bar')
          return ledger
        })
        ctx.signal.addEventListener(
          'abort',
          () => {
            for (const ledger of ledgers) ledger.restore()
          },
          { once: true },
        )
      }
    }
    return inner(el, params, ctx)
  })
}
