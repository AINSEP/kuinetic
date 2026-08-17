// @vitest-environment node
//
// Static analysis of the shipped stylesheets — no DOM required. The node environment is not
// optional here: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath` throws.
// Same idiom as `test/css-invariants.test.ts` (brace-balanced block reading, no full CSS parser).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Drift guard for the reduced-motion sibling fix in `src/css/base.css`.
 *
 * That fix replaced a self-maintaining wildcard (`[data-kui-rm] ~ :is(label, [class*='kui-'],
 * [class*='kui-'] *)`) with a hand-written allowlist scoped to each compiled effect name
 * (`[data-kui-rm][data-kui-fx~='name'] ~ satellite`) — more correct today, but nothing stops it
 * from silently falling out of sync with forms.css tomorrow: a new native-state effect whose
 * motion lives on a sibling gets no reduced-motion shortening and nothing fails, or a satellite
 * removed from forms.css leaves a stale, dead entry behind. Both directions are asserted here
 * against the real stylesheets rather than trusted to stay hand-maintained.
 */

/** Stylesheets that use the `[data-kui-fx~='name'] ~ selector` sibling-satellite pattern, or
 * could plausibly grow one — forms.css is the only one that does today (native-state family);
 * interaction.css and navigation.css are scanned too so a future satellite effect there is
 * covered automatically instead of requiring someone to remember to extend this list. */
const CANDIDATE_FILES = ['forms.css', 'interaction.css', 'navigation.css']

const readCss = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/css/${file}`, import.meta.url)), 'utf8')

const baseCss = readCss('base.css')
const candidateCss = CANDIDATE_FILES.map(readCss).join('\n')

/** Read from `start` to the brace that closes the block opened just before it. */
function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/** Collapse internal whitespace so formatting differences (`~  .foo` vs `~ .foo`) never cause a
 * spurious mismatch between the two sides being compared. */
const normalizeSelector = (selector: string): string => selector.trim().replace(/\s+/g, ' ')

/** `true` if a rule body declares its own `transition`/`transition-property`, as opposed to a
 * state-variant rule (`:focus ~ label`, `:checked ~ .kui-dot`) that only ever writes the end-state
 * property value and relies on the base rule for the transition itself. */
function declaresTransition(body: string): boolean {
  return /(?:^|[{;])\s*transition(?:-property)?\s*:/.test(body)
}

/**
 * name -> satellite selectors, for every `[data-kui-fx~='name'] ~ satellite { ... }` rule whose
 * own body declares a `transition`. Requires the sibling-satellite selector to be the sole (or
 * last, in a comma list) selector immediately before the opening brace — every rule in this
 * family is written that way; see forms.css's own top-of-file comment for the contract.
 */
function extractSiblingTransitionBindings(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  // Only one `\s*` between the control and `~`, none after it: `[^,{]` already matches
  // whitespace, so a second `\s*` adjacent to it is the classic overlapping-quantifier shape
  // `slow-regex` flags for catastrophic backtracking. Leading/trailing whitespace lands in the
  // capture instead and `normalizeSelector` trims it.
  const pattern = /\[data-kui-fx~=(['"])([\w-]+)\1\]\s*~([^,{]+?)\{/g
  for (const match of css.matchAll(pattern)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    if (!declaresTransition(body)) continue
    const name = match[2]!
    const satellite = normalizeSelector(match[3]!)
    const existing = found.get(name) ?? new Set<string>()
    existing.add(satellite)
    found.set(name, existing)
  }
  return found
}

/**
 * name -> satellite selectors, for every `[data-kui-rm][data-kui-fx~='name'] ~ satellite` entry
 * in base.css's reduced-motion policy list — the mirror of the bindings above. These are list
 * items inside one shared selector list (comma- or brace-terminated), not each their own rule, so
 * both terminators are accepted.
 */
function extractPolicyScopedPairs(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  // Same no-redundant-`\s*` reasoning as the pattern above; `[,{]` (a character class, not an
  // alternation) is the terminator since these are comma- or brace-terminated list items.
  const pattern = /\[data-kui-rm\]\[data-kui-fx~=(['"])([\w-]+)\1\]\s*~([^,{]+?)[,{]/g
  for (const match of css.matchAll(pattern)) {
    const name = match[2]!
    const satellite = normalizeSelector(match[3]!)
    const existing = found.get(name) ?? new Set<string>()
    existing.add(satellite)
    found.set(name, existing)
  }
  return found
}

const requiredBindings = extractSiblingTransitionBindings(candidateCss)
const policyPairs = extractPolicyScopedPairs(baseCss)

/** Flat `"name -> satellite"` label list, for readable diffs and failure messages. */
function flatten(bindings: Map<string, Set<string>>): string[] {
  return [...bindings.entries()]
    .flatMap(([name, satellites]) => [...satellites].map((satellite) => `${name} -> ${satellite}`))
    .sort((a, b) => a.localeCompare(b))
}

describe('reduced-motion sibling-satellite coverage', () => {
  it('parses a plausible number of transition-declaring sibling bindings', () => {
    // Backstop against the extractor silently matching nothing (a reflowed file, a renamed
    // attribute) and every assertion below passing vacuously — same purpose as the size
    // assertions in css-invariants.test.ts.
    expect(flatten(requiredBindings).length).toBeGreaterThanOrEqual(6)
    expect(flatten(policyPairs).length).toBeGreaterThanOrEqual(6)
  })

  it('every transition-declaring satellite binding in the stylesheets has a base.css entry', () => {
    const missing: string[] = []
    for (const [name, satellites] of requiredBindings) {
      const covered = policyPairs.get(name)
      for (const satellite of satellites) {
        if (!covered?.has(satellite)) {
          missing.push(
            `[data-kui-fx~='${name}'] ~ ${satellite} declares a transition in the stylesheet but ` +
              `base.css has no matching [data-kui-rm][data-kui-fx~='${name}'] ~ ${satellite} entry ` +
              `— add it to the reduced-motion policy list.`,
          )
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('every base.css sibling entry corresponds to a real transition-declaring satellite', () => {
    const stale: string[] = []
    for (const [name, satellites] of policyPairs) {
      const required = requiredBindings.get(name)
      for (const satellite of satellites) {
        if (!required?.has(satellite)) {
          stale.push(
            `base.css shortens [data-kui-fx~='${name}'] ~ ${satellite}, but no stylesheet rule ` +
              `matching that selector declares a transition — this entry is stale, remove it.`,
          )
        }
      }
    }
    expect(stale).toEqual([])
  })
})
