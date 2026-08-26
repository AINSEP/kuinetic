/**
 * Check that every class used in demo/*.html actually has a CSS rule somewhere.
 *
 * This exists because of issue #15: `demo/tailwind.css` (Tailwind + daisyUI's compiled output)
 * drifted from what a clean rebuild produces by 2400+ lines, and nothing caught it because nobody
 * was checking the compiled output against what the pages actually use. A naive version of this
 * check — grep the classes out of demo/*.html, grep the selectors out of demo/tailwind.css, diff
 * — sounds right but isn't: most classes on this site are hand-rolled (page-specific styling in
 * each page's own `<style>` block, or shared chrome in demo/style.css, demo/system.css, or the
 * library's own demo/kuinetic.css) and were never meant to come from Tailwind/daisyUI at all. A
 * check that only knows about demo/tailwind.css reports every one of those as "missing" — on this
 * codebase that's 300+ false positives, which is worse than no check: nobody reads a report that
 * is 99% noise, so a real regression drowns in it.
 *
 * What this actually checks, per class used in a `class="..."` attribute on a given page: is there
 * a rule for it in *that page's own* inline `<style>` block, or in one of demo/style.css,
 * demo/system.css, demo/kuinetic.css, demo/tailwind.css *that page's own `<head>` actually links*?
 * If none of those own it, the class is either a typo, a page that forgot to style something, a
 * page that forgot to link the sheet its class lives in, or — the case this was actually built for
 * — a Tailwind/daisyUI class that source detection failed to pick up. This check does not attempt
 * to guess *which* stylesheet a class "should" live in; it only proves a rule is actually reachable
 * from the page using the class, which is what determines whether an element renders styled or not.
 *
 * Every source of coverage — inline `<style>` included — is scoped to the one page it can actually
 * reach, not pooled across all of demo/*.html. Pooling was itself the bug this check used to miss:
 * `.btn-primary` has a rule in demo/system.css *and* inline in three unrelated pages' own `<style>`
 * blocks, but landing-studio.html links neither system.css nor any of those pages' markup — it
 * links demo/style.css, which had no `.btn-primary` rule at all. A pooled check called the class
 * "covered" because *some* page, any page, defined it somewhere; the button rendered as a bare
 * unstyled link in the actual browser. A page only gets credit for CSS its own `<head>` can load.
 *
 * Run via `npm run check:css-coverage`, which builds first — demo/tailwind.css and demo/kuinetic.css
 * are both build output (see demo/tailwind-entry.css's header comment and .gitignore), so this
 * check is meaningless against whatever stale copy happens to be on disk.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DEMO = fileURLToPath(new URL('../demo/', import.meta.url))

// A handful of classes are legitimate markers with no CSS rule of their own: they select a
// default/base state that needs no override (the opposite-state class carries the one property
// that differs), so requiring a rule for them would be requiring dead CSS. Each entry says why.
const ALLOWLIST = new Map([
  // .flip-face is the shared base for both faces of a flip card; .flip-back carries the
  // `rotate: y 180deg` override. .flip-front is the resting face and needs no rule of its own.
  ['flip-front', 'index-old.html — default face of a flip card; .flip-back carries the one rotate override'],
  // <figure class="pin-section-figure"> is a semantic wrapper around .pin-section-media; the
  // actual layout/sizing rules live on .pin-section-stage/.pin-section-card/.pin-section-media.
  ['pin-section-figure', 'scroll.html — semantic <figure> wrapper, styled entirely via its children'],
  // The three-line headline's first line (.l1) needs no per-line nudge; .l2 and .l3 each carry the
  // one `margin-inline-start` override that makes their glyphs optically align under .l1. Same
  // shape as .flip-front above: the default case is the one with nothing to override.
  ['l1', 'motif-kinetic.html — first headline line; .l2/.l3 carry the only per-line overrides'],
  // On every `.demo-hero` page, `.hero-copy` needs `max-width: 46rem` of its own (each such page
  // repeats that one rule in its own <style> block — see demo/reveals.html:38 and its siblings).
  // index-basic.html and index-old.html don't use `.demo-hero` at all; their hero is `.hero {
  // display: grid; grid-template-columns: minmax(0,.94fr) minmax(0,1.06fr); }`, which already sizes
  // `.hero-copy` as the first grid track — an explicit width rule there would be redundant, not
  // missing. Semantic wrapper, same shape as .pin-section-figure above.
  ['hero-copy', 'index-basic.html, index-old.html — sized by the parent .hero grid track, not its own rule'],
])

/** Class selector tokens appearing anywhere in `css` (nested/compound selectors included), unescaped. */
function classSelectorsIn(css) {
  // Strip comments first — two independent reasons, both found by hand while fixing this function.
  // (1) A comment can say a class name without a rule backing it: this codebase's CSS is prose-heavy
  // ("`.flip-front` is the resting face...", literally how the ALLOWLIST entries above were found),
  // so the raw text can contain a `.classname`-shaped token that was never a selector. (2) A comment
  // can contain the bare word "@layer" without being one — demo/data-hover.html has three, all
  // prose ("...beats their `@layer kui.effects` display rules..."). The `@layer`-header strip below
  // has no way to tell a real at-rule from a comment mentioning the word, so on this file the "fix"
  // for the regex-DoS report below (`[^{;]*`, greedy up to the next `{`/`;`) matched from that
  // comment's "@layer" all the way to `.hero-stat-label {` — the next real `{` in the file — and
  // deleted that selector before the scan two lines down ever saw it. Comments never carry a real
  // rule either way, so removing them first is correct on top of being what closes this hole.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Strip `@layer` headers next. Cascade layers nest with dots (`@layer daisyui.l1.l2.l3 {`,
  // Tailwind/daisyUI's own scheme), and the class-selector scan below can't tell a layer path
  // segment from a real selector — `.l1`/`.l2`/`.l3` would otherwise read as "covered" on any page
  // that merely links tailwind.css, whether or not that page's own CSS defines them. Found via
  // demo/motif-kinetic.html's `.l1`, which had no rule anywhere and was masked exactly this way.
  // `[^{;]*` (not `\s+[\w.,\s-]+`) on purpose: a negated class has one quantifier with nothing else
  // in the pattern able to match the same character, so there is no split to backtrack over — an
  // adjacent `\s+` next to a class that also contains `\s` is what `sonarjs/slow-regex` flagged
  // (two quantifiers claiming the same whitespace run, super-linear on a long one). This version
  // stops at the header's real boundary (the block's `{` or a statement's `;`) in one linear pass —
  // safe to be this permissive now that comments (the one place "@layer" turned up without a real
  // `{`/`;` anywhere near it) are already gone.
  const withoutLayerHeaders = withoutComments.replace(/@layer[^{;]*/g, '')
  const present = new Set()
  for (const m of withoutLayerHeaders.matchAll(/\.((?:[\w-]|\\.)+)/g)) present.add(m[1].replace(/\\(.)/g, '$1'))
  return present
}

/**
 * Basenames (e.g. `system.css`) of the local stylesheets a page's `<head>` actually links, read
 * from its `<link rel="stylesheet" href="...">` tags. Google Fonts and other external `href`s are
 * excluded — this check only ever has rules to cross-reference for the four local sheets. A `?v=`
 * / cache-busting query on the href is stripped, not matched against.
 */
function linkedStylesheetsIn(html) {
  const linked = new Set()
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag[0])) continue
    const href = tag[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
    const local = href?.match(/^\.\/([\w-]+\.css)(?:\?.*)?$/)
    if (local) linked.add(local[1])
  }
  return linked
}

function readIfExists(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const htmlFiles = readdirSync(DEMO).filter((f) => f.endsWith('.html'))

/** Records that `cls` is used by `file` in the `used` map (class -> Set of files). */
function recordUsage(used, cls, file) {
  if (!cls) return
  if (!used.has(cls)) used.set(cls, new Set())
  used.get(cls).add(file)
}

// Classes actually written in class="..." attributes, and which file(s) use each.
const used = new Map()
// Classes styled in each page's OWN inline <style> block — a file only reaches its own <style>,
// never another page's, so this is per-file, not pooled. (It used to be pooled; see the header
// comment — that's what hid `.btn-primary` on landing-studio.html.)
const inlineStyledByFile = new Map()
// Which local stylesheet(s) each page's <head> actually links, by basename (e.g. `system.css`).
const linkedByFile = new Map()

for (const file of htmlFiles) {
  const html = readFileSync(join(DEMO, file), 'utf8')
  for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) recordUsage(used, c, file)
  }
  const ownInlineClasses = new Set()
  for (const styleBlock of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const c of classSelectorsIn(styleBlock[1])) ownInlineClasses.add(c)
  }
  inlineStyledByFile.set(file, ownInlineClasses)
  linkedByFile.set(file, linkedStylesheetsIn(html))
}

const stylesheets = {
  'tailwind.css': readIfExists(join(DEMO, 'tailwind.css')),
  'style.css': readIfExists(join(DEMO, 'style.css')),
  'system.css': readIfExists(join(DEMO, 'system.css')),
  'kuinetic.css': readIfExists(join(DEMO, 'kuinetic.css')),
}

const missingBuildOutputs = Object.entries(stylesheets)
  .filter(([, content]) => content === null)
  .map(([name]) => `demo/${name}`)
if (missingBuildOutputs.length) {
  console.error(
    `check:css-coverage: ${missingBuildOutputs.join(', ')} not found — run \`npm run build\` first ` +
      `(this check runs as \`npm run check:css-coverage\`, which does that for you).`
  )
  process.exit(1)
}

// Class selectors present in each stylesheet, computed once rather than per page.
const stylesheetClasses = Object.fromEntries(
  Object.entries(stylesheets).map(([name, content]) => [name, classSelectorsIn(content)])
)

/**
 * Whether `cls` actually resolves to a rule reachable from `file`: a rule in that same file's own
 * inline `<style>` block, or in one of tailwind.css/style.css/system.css/kuinetic.css that `file`'s
 * own `<head>` links. Nothing here is pooled across pages — see the header comment for why that
 * was the bug.
 */
function isCoveredForFile(cls, file) {
  if (inlineStyledByFile.get(file)?.has(cls)) return true
  for (const sheet of linkedByFile.get(file) ?? []) {
    if (stylesheetClasses[sheet]?.has(cls)) return true
  }
  return false
}

const missing = []
for (const [cls, files] of used) {
  if (ALLOWLIST.has(cls)) continue
  const uncoveredFiles = [...files].filter((file) => !isCoveredForFile(cls, file)).sort()
  if (uncoveredFiles.length) missing.push({ cls, files: uncoveredFiles })
}
missing.sort((a, b) => a.cls.localeCompare(b.cls))

if (missing.length) {
  console.error(`check:css-coverage: ${missing.length} class(es) used in demo/*.html have no reachable CSS rule:\n`)
  for (const { cls, files } of missing) console.error(`  .${cls}  (${files.join(', ')})`)
  console.error(
    `\nEach of these needs either: a rule in the page's own <style> block / demo/style.css / ` +
      `demo/system.css / demo/kuinetic.css — AND that page's <head> linking whichever sheet the ` +
      `rule lives in — a Tailwind/daisyUI utility that source detection in demo/tailwind-entry.css ` +
      `should be picking up but isn't, or — if it's a deliberate unstyled marker like the two in ` +
      `this script's ALLOWLIST — an entry added there with a reason.`
  )
  process.exit(1)
}

console.log(`check:css-coverage: ${used.size} classes used in demo/*.html, all covered (${ALLOWLIST.size} allowlisted).`)
