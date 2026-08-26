// @vitest-environment node
//
// Static analysis of docs/catalog.md against the live registry — no DOM required. The node
// environment is not optional: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath`
// throws. Same idiom as `css-invariants.test.ts` and `reduced-motion-coverage.test.ts`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHANNEL } from '../src/core/types.js'
import { catalogRegistry } from './support/registry.js'

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

/** A section's stated count, and the names it actually lists. */
interface SectionCount {
  claim: { shipped: number; planned: number }
  names: Set<string>
}

/**
 * The count a section heading claims, in either shape the document uses:
 * `— 17 names` or `— 6 shipped, 2 planned`.
 *
 * Read by splitting into words rather than by pattern-matching across whitespace. `\d+\s+word` is
 * exactly the shape that makes a regex backtrack, and a claim is only ever a handful of tokens, so
 * there is nothing to gain by matching one.
 *
 * Returns `null` for a heading that states no number, which is not a failure — `Gestures &
 * physics` spells its count in prose ("Thirteen names") and sits outside the lettered sections on
 * purpose. A section can only be checked against a number it actually states.
 */
function claimedCount(heading: string): SectionCount['claim'] | null {
  const claim = heading.split('—')[1]?.trim()
  if (!claim) return null
  const words = claim.split(/[\s,]+/)
  const numberBefore = (label: string): number | null => {
    const at = words.indexOf(label)
    if (at < 1) return null
    const before = words[at - 1]!
    return /^\d+$/.test(before) ? Number(before) : null
  }
  const shipped = numberBefore('names') ?? numberBefore('shipped')
  if (shipped === null) return null
  return { shipped, planned: numberBefore('planned') ?? 0 }
}

/**
 * The totals table's rows, keyed by section letter.
 *
 * Keyed by the letter and not the title, because the two deliberately differ — the heading reads
 * `A. Entrance & exit matrix` while its row reads `A Entrance/exit`. The letter is the only stable
 * join between them.
 */
function totalsRows(): Map<string, string> {
  const rows = new Map<string, string>()
  for (const line of catalog.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue
    const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
    if (cells.length !== 2) continue
    const letter = cells[0]!.split(' ')[0]!
    // A–P: the lettered catalog sections as they stand. A row outside the range is not a section
    // row — the totals table also carries `**Total shipped**` and the planned-count line, and both
    // are read separately below. Widen the range when a section letter is added, or the new
    // section silently reports "no row in the totals table" while the row is sitting right there.
    if (letter.length === 1 && letter >= 'A' && letter <= 'P') rows.set(letter, cells[1]!)
  }
  return rows
}

/** A heading's section record, or `null` for one this check has no number to compare against. */
function sectionEntry(title: string): SectionCount | null {
  if (NON_CATALOG_SECTIONS.test(title)) return null
  const claim = claimedCount(title)
  return claim ? { claim, names: new Set<string>() } : null
}

/**
 * Names listed under each section that states a count, kept per-section rather than deduplicated
 * across the document.
 *
 * `documentedNames` above answers "does this name appear anywhere", so it keeps the first section
 * to mention a name and drops the rest. That is the wrong shape here: `magnetic` is listed under
 * both `I. Hover & pointer` and `Gestures & physics`, and a global dedupe would silently make one
 * of those sections come up a name short.
 */
/** Add a line's names to the section currently being read, if any section is. */
function collectNames(section: SectionCount | null, line: string): void {
  if (!section) return
  for (const token of namesInLine(line)) section.names.add(token)
}

function namesBySection(): Map<string, SectionCount> {
  const sections = new Map<string, SectionCount>()
  let current: SectionCount | null = null

  for (const line of catalog.split('\n')) {
    if (!line.startsWith('## ')) {
      collectNames(current, line)
      continue
    }
    const title = line.slice(3).trim()
    current = sectionEntry(title)
    if (current) sections.set(sectionLabel(title), current)
  }
  return sections
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
const registered = new Set(catalogRegistry().names())

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

  /*
   * The grand total was already checked above, and it was right — which is exactly why this was
   * missed. `N. 3D & perspective` claimed "31 shipped" over a list of six names for as long as
   * anyone can tell, and both the section heading and its row in the totals table said so. The
   * total stayed correct throughout, because 252 is counted from the registry rather than summed
   * from the sections, so no assertion anywhere compared a section's headline to the section.
   *
   * A per-section number is a claim a reader checks by counting the row in front of them. It is
   * the easiest claim in the document to falsify and was the only one nothing guarded.
   */
  it('every section heading counts the names that section actually lists', () => {
    const sections = [...namesBySection()]
    // Backstop against a reformat that makes the heading regex match nothing, which would leave
    // this test passing over an empty list — the same trap the extractor check above guards.
    expect(sections.length).toBeGreaterThanOrEqual(15)

    const wrong = sections
      .filter(([, { claim, names }]) => names.size !== claim.shipped + claim.planned)
      .map(
        ([label, { claim, names }]) =>
          `${label}: heading claims ${claim.shipped} shipped + ${claim.planned} planned, lists ${names.size}`,
      )
    expect(wrong).toEqual([])
  })

  /*
   * The same claim restated in the totals table. It drifted with the heading last time — both read
   * 31 — so checking one and not the other would leave the copy that a reader skimming the summary
   * actually sees.
   */
  it('each totals row agrees with its own section heading', () => {
    const rows = totalsRows()
    expect(rows.size).toBeGreaterThanOrEqual(15)

    const wrong: string[] = []
    for (const [label, { claim }] of namesBySection()) {
      const letter = label.split('.')[0]!.trim()
      const cell = rows.get(letter)
      if (cell === undefined) {
        wrong.push(`${label}: no row in the totals table`)
        continue
      }
      const expected = claim.planned
        ? `${claim.shipped} (+${claim.planned} planned)`
        : String(claim.shipped)
      if (cell !== expected) wrong.push(`${label}: totals row says "${cell}", heading says "${expected}"`)
    }
    expect(wrong).toEqual([])
  })
})
