// @vitest-environment node
//
// Split out of `css-invariants.test.ts` when that file crossed the 400-line budget, and along a
// seam of kind rather than size: every other suite in that file asserts an invariant *of the CSS*
// (a keyframe stays inside its channels, a layer is declared in order). This one asserts that a
// piece of hand-maintained TypeScript data — `Preset.requiresOwnSubtree` — still agrees with the
// CSS it describes. Same stylesheets, opposite direction, so it reads better on its own.
//
// The node environment is not optional: `./support/css-sources.js` reads the stylesheets at module
// scope, and under jsdom `import.meta.url` is an http: URL that `fileURLToPath` throws on.
import { describe, expect, it } from 'vitest'
import { stripComments } from './support/css-scan.js'
import { SOURCES } from './support/css-sources.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

/**
 * `Preset.requiresOwnSubtree` un-driftable — docs/plan-scope-page.md §0.3/§7.
 *
 * `target:` relocates `data-kui-fx` onto whatever a selector matches. A preset whose CSS reaches
 * past the fx-stamped element — to a child, a sibling, or a descendant it assumes exists — cannot
 * survive that: the relocated rule looks for the same relative shape under a different element and,
 * finding none, compiles to silence. `compile.ts`'s `liftTarget` refuses to relocate any preset that
 * declares this, but the declaration itself is hand-maintained data, and hand-maintained data drifts
 * the moment someone adds a reaching selector for a name that never opted in.
 *
 * So the true set is *re-derived* here, from the shipped stylesheets, independently of the flags —
 * scanning for every `[data-kui-fx~='NAME']` followed, in the same selector (before the next `,` or
 * `{`), by a combinator (whitespace, `>`, `~`, `+`) and then more selector text. That is a name whose
 * CSS assumes something exists beyond the fx element itself, and every such name must carry
 * `requiresOwnSubtree: true`. A future CSS edit that reaches past a name without also flagging it
 * fails this test instead of silently compiling `target:` on that name to nothing.
 *
 * Known, deliberate blind spot: a combinator written *inside* a `:has()`/`:not()` argument —
 * `:has(> :nth-child(2))` — is not counted, because it is indistinguishable here from an ordinary
 * same-compound pseudo-class. Every name in today's stylesheets that uses that form (`card-flip-x`,
 * `card-flip-y`, `flip-card`, in three-d.css) also reaches past itself through a *plain* trailing
 * combinator elsewhere in the same file, so this scan still finds all of them — verified by the
 * "matches the hand-maintained list" assertion below, which would fail the day that stops being true.
 */

/** Bracket-nesting delta for one character: `(` and `[` open a group, `)` and `]` close one. */
function nestingDelta(ch: string): number {
  if (ch === '(' || ch === '[') return 1
  if (ch === ')' || ch === ']') return -1
  return 0
}

/** A selector combinator: descendant (whitespace), child, general sibling, adjacent sibling. */
function isCombinator(ch: string): boolean {
  return ch === '>' || ch === '~' || ch === '+' || /\s/.test(ch)
}

/**
 * Whether the selector continuing at `start` carries the compound before it past itself.
 *
 * True the moment a combinator at bracket depth 0 is followed by any other character at depth 0:
 * that is a second compound, which is a second element. Returns early rather than scanning to the
 * selector's end, which is equivalent — neither flag can be un-set once set, and the only other
 * way out of the loop is the `,`/`{` that ends the selector.
 *
 * Depth is tracked so a combinator *inside* `:has(...)`/`:not(...)` — or inside an attribute
 * selector's own quoted value — does not count. See the blind spot in the block comment above.
 *
 * @complexity O(n) time in the remaining stylesheet length; O(1) space.
 * @overallScore 100
 */
function reachesPastSelf(css: string, start: number): boolean {
  let depth = 0
  let sawCombinator = false
  for (let i = start; i < css.length; i++) {
    const ch = css[i]!
    if (depth === 0) {
      if (ch === ',' || ch === '{') return false
      if (isCombinator(ch)) sawCombinator = true
      else if (sawCombinator) return true
    }
    depth += nestingDelta(ch)
  }
  return false
}

/**
 * Every preset name reached by a `[data-kui-fx~='NAME']` compound that a combinator carries past
 * itself, anywhere in the shipped effect stylesheets.
 *
 * @complexity O(n) time in total stylesheet length; O(k) space in matches found.
 * @overallScore 100
 */
function reachingPastSelf(css: string): Set<string> {
  const names = new Set<string>()
  for (const match of css.matchAll(/\[data-kui-fx~='([\w-]+)'\]/g)) {
    if (reachesPastSelf(css, match.index + match[0].length)) names.add(match[1]!)
  }
  return names
}

describe('requiresOwnSubtree — the reaching-selector set is re-derived, not trusted', () => {
  // The full shipped catalog, not `scannedCss` — that constant deliberately excludes `base.css`
  // (it is scanned separately by the channel-invariant checks in `css-invariants.test.ts`), but
  // `base.css` is exactly where 12 of these 87 reaching selectors live
  // (`checkbox-draw`/`radio-fill`/`toggle-morph`'s native-form-state family). Comments stripped for
  // the same reason `scannedCss` is: a retired selector kept for reference must not read as a live
  // one.
  const allCatalogCss = stripComments([...SOURCES.values()].join('\n'))
  const reaching = [...reachingPastSelf(allCatalogCss)].sort((a, b) => a.localeCompare(b))

  it('finds names to guard, so this suite cannot pass vacuously', () => {
    expect(reaching.length).toBeGreaterThan(0)
  })

  it('matches the hand-maintained list exactly — 16 names, unchanged since the plan measured them', () => {
    // Not a tautology: this is read straight from `src/css/*.css`, compared against a literal list
    // transcribed from `docs/plan-scope-page.md` §0.3 by a human, not derived from the scan itself.
    // A drift in either direction — a 17th reaching name, or one of these 16 stopping to reach past
    // itself — fails here first.
    expect(reaching).toEqual(
      [
        'card-flip-x',
        'card-flip-y',
        'checkbox-draw',
        'flip-card',
        'hamburger-to-x',
        'input-underline-grow',
        'label-float',
        'play-to-pause',
        'plus-to-minus',
        'radio-fill',
        'sequence-scrub',
        'step-progress',
        'strength-meter',
        'submit-to-spinner-to-check',
        'toggle-morph',
        'video-scrub',
      ].sort((a, b) => a.localeCompare(b)),
    )
  })

  it.each(reaching)('%s declares requiresOwnSubtree, so target: refuses to relocate it', (name) => {
    const resolved = registry.resolve(name)
    expect(resolved, `"${name}" is not a registered preset`).toBeDefined()
    expect(resolved!.preset.requiresOwnSubtree, `"${name}" reaches past itself in CSS`).toBe(true)
  })

  it('never flags a name whose CSS never reaches past itself', () => {
    // The other direction of the same drift: a name that no longer needs the refusal but still
    // carries it is not a correctness bug — `liftTarget` just declines a `target:` that would have
    // worked — but it is exactly the kind of stale declaration this file exists to catch before it
    // becomes a mystery bug report ("target: silently does nothing on X").
    const overFlagged = registry
      .names()
      .filter((name) => registry.resolve(name)?.preset.requiresOwnSubtree === true)
      .filter((name) => !reaching.includes(name))
    expect(overFlagged).toEqual([])
  })
})
