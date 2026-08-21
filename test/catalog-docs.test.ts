// @vitest-environment node
//
// Static analysis of docs/catalog.md against the live registry — no DOM required. The node
// environment is not optional: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath`
// throws. Same idiom as `css-invariants.test.ts` and `reduced-motion-coverage.test.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'

/**
 * Drift guard between the catalog document and the effects that actually exist.
 *
 * `docs/catalog.md` is the page someone reads before typing a `data-kui` attribute, so a name
 * listed there is a promise: copy this, it works. For a long stretch it documented 238 names while
 * the library shipped 234, and the gap was only ever found by someone writing a throwaway script —
 * nothing in the repo compared the two. Twenty-two names resolved to silence: an author wrote
 * `data-kui="checkmark-draw"`, no effect was registered, no warning fired at build time, and the
 * element simply did not animate.
 *
 * The reverse direction matters just as much and is easier to miss: a shipped effect that nobody
 * documented is an effect nobody will ever use. `beam-border-auto`, `scroll-progress`, and
 * `scroll-progress-bar-y` were all in that state.
 *
 * Both directions are asserted here so neither can drift again without a red test.
 */

const catalog = readFileSync(fileURLToPath(new URL('../docs/catalog.md', import.meta.url)), 'utf8')

/**
 * Sections that list *primitive* ids or aggregate counts rather than effect names. Including them
 * would compare the wrong vocabulary against the registry and produce noise in both directions.
 */
const NON_CATALOG_SECTIONS = /^(Legend|Totals|The \d+ primitive)/

/**
 * Every effect name the catalog lists, in document order.
 *
 * The document uses two list shapes — markdown table rows (sections A, D, I, …) and paragraphs of
 * backticked names joined by `·` (sections B, C, E, …) — so both are read. Everything else is
 * skipped deliberately:
 *
 * - Blockquote lines (`>`) are prose notes, caveats, and required-markup examples. They mention
 *   real names, but also `data-kui`, `--kui-path-length`, and HTML snippets, none of which are
 *   effects. Since a note only ever repeats a name the section list already carries, dropping
 *   these loses nothing and removes the entire class of false positives.
 * - Ordinary prose lines. `Primitives 1-4. All \`css\`.` would otherwise contribute "css".
 */
function namesInLine(line: string): string[] {
  if (line.startsWith('>')) return []
  const trimmed = line.trim()
  const carriesNames = trimmed.startsWith('|') || trimmed.startsWith('`') || line.includes('·')
  if (!carriesNames) return []
  return [...line.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((match) => match[1]!)
}

/** `## E. SVG & icons — 17 names` -> `E. SVG & icons`, for readable failure messages. */
function sectionLabel(heading: string): string {
  return heading.split('—')[0]!.trim()
}

function documentedNames(): Map<string, string> {
  const names = new Map<string, string>()
  let section = ''
  let inCatalogSection = false

  for (const line of catalog.split('\n')) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim()
      inCatalogSection = !NON_CATALOG_SECTIONS.test(title)
      section = sectionLabel(title)
      continue
    }
    if (!inCatalogSection) continue
    for (const token of namesInLine(line)) if (!names.has(token)) names.set(token, section)
  }
  return names
}

/**
 * Names the catalog knowingly documents ahead of implementation, each carrying a `†` and an
 * explanation in its section. All four need JavaScript — scroll direction, the View Transitions
 * API, or pointer tracking — which is a decision the library has not taken, not an oversight.
 *
 * Implementing one means deleting it from here. Adding one means the same conversation happened
 * again, which is the point of it being a hand-written list rather than "anything with a dagger".
 */
const KNOWN_PLANNED = [
  'depth-layers-pointer',
  'page-morph',
  'perspective-grid',
  'reveal-direction-aware',
]

const documented = documentedNames()
const registered = new Set(createRegistry().names())

describe('docs/catalog.md against the live registry', () => {
  it('extracts a plausible number of names from the document', () => {
    // Backstop against the extractor silently matching nothing after a reformat, which would make
    // every assertion below pass vacuously — the same guard css-invariants.test.ts uses.
    expect(documented.size).toBeGreaterThanOrEqual(240)
  })

  it('every documented name either resolves or is a known planned name', () => {
    const broken = [...documented]
      .filter(([name]) => !registered.has(name) && !KNOWN_PLANNED.includes(name))
      .map(([name, section]) => `${name} (${section})`)
    expect(broken).toEqual([])
  })

  it('every known planned name is still marked with a dagger in the document', () => {
    const unmarked = KNOWN_PLANNED.filter((name) => !catalog.includes(`\`${name}\`†`))
    expect(unmarked).toEqual([])
  })

  it('every known planned name is genuinely still unregistered', () => {
    // The list going stale in the other direction: implementing one and forgetting to remove it
    // here would leave a shipped effect permanently excused from the resolution check above.
    expect(KNOWN_PLANNED.filter((name) => registered.has(name))).toEqual([])
  })

  it('every registered effect is documented somewhere', () => {
    const undocumented = [...registered]
      .filter((name) => !documented.has(name))
      .sort((a, b) => a.localeCompare(b))
    expect(undocumented).toEqual([])
  })

  it('the totals table agrees with the registry', () => {
    const shipped = /\|\s*\*\*Total shipped\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/.exec(catalog)
    const planned = /\|\s*Documented but not yet shipped\s*\|\s*(\d+)\s*\|/.exec(catalog)
    expect(Number(shipped?.[1])).toBe(registered.size)
    expect(Number(planned?.[1])).toBe(KNOWN_PLANNED.length)
  })
})
