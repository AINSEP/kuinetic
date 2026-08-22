// @vitest-environment node
//
// Static analysis of docs/catalog.md against the live registry — no DOM required. The node
// environment is not optional: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath`
// throws. Same idiom as `css-invariants.test.ts` and `reduced-motion-coverage.test.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHANNEL } from '../src/core/types.js'
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

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

const catalog = read('docs/catalog.md')

/**
 * Every document that states the catalog's size in prose.
 *
 * The catalog's own totals table is checked further down, but the number also appears in the
 * README, the tutorial, and the architecture doc — and those had all been sitting at "~237" while
 * the library shipped 251, because nothing compared them to anything. A count in prose is a claim,
 * and a wrong one is the first thing a reader can catch you on.
 */
const COUNTED_DOCS = [
  'README.md',
  'docs/getting-started.md',
  'docs/design.md',
  // The showcase landing page states the count twice — once in its `<meta name="description">`,
  // once as the headline over the catalog section — and it was the one file left out of this list.
  // It was still reading "~237" when the registry had passed 250, which is the exact drift the
  // three entries above exist to prevent, sitting on the most-read page in the repo. A marketing
  // number is a claim like any other. (The headline was `~<span>237</span> named effects`, which
  // the contiguous match below could never have seen; it is one text run now.)
  'demo/index.html',
]

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

  it('every prose claim about the catalog size agrees with the registry', () => {
    const wrong: string[] = []
    for (const path of COUNTED_DOCS) {
      const text = read(path)
      // Bounded rather than `\d+`: an unbounded quantifier in a global scan is what the
      // slow-regex rule objects to, and no honest catalog count needs six digits.
      const claims = [...text.matchAll(/(\d{1,5}) named effects/g)]
      // A doc that stopped stating a count at all would otherwise pass by saying nothing.
      expect(claims.length, `${path} states no effect count`).toBeGreaterThan(0)
      for (const claim of claims) {
        if (Number(claim[1]) !== registered.size) {
          wrong.push(`${path}: claims ${claim[1]} named effects, registry has ${registered.size}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('design.md enumerates exactly the channels the source declares', () => {
    // The channel table is not illustrative — it is the reference for the composition model, and a
    // channel missing from it reads as "this cannot collide with anything", which is the one wrong
    // conclusion the model exists to prevent. It had six of eleven rows.
    const design = read('docs/design.md')
    const header = '| Channel | Property | Example primitives |'
    const start = design.indexOf(header)
    expect(start, 'design.md has no channel table').toBeGreaterThan(-1)
    const table = design.slice(start, design.indexOf('\n\n', start))
    const listed = new Set(
      [...table.matchAll(/^\| ([a-z]{1,20}) \|/gm)].map((match) => match[1]!),
    )
    const declared = new Set(Object.keys(CHANNEL))
    expect([...declared].filter((name) => !listed.has(name)), 'missing from design.md').toEqual([])
    expect([...listed].filter((name) => !declared.has(name)), 'in design.md but not in CHANNEL').toEqual([])
  })

  it('the totals table agrees with the registry', () => {
    const shipped = /\|\s*\*\*Total shipped\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/.exec(catalog)
    const planned = /\|\s*Documented but not yet shipped\s*\|\s*(\d+)\s*\|/.exec(catalog)
    expect(Number(shipped?.[1])).toBe(registered.size)
    expect(Number(planned?.[1])).toBe(KNOWN_PLANNED.length)
  })
})
