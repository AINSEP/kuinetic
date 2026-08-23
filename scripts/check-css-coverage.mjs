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
 * What this actually checks, per class used in a `class="..."` attribute anywhere in demo/*.html:
 * is there a rule for it in ANY of — the page's own inline `<style>` block, demo/style.css,
 * demo/system.css, demo/kuinetic.css (the library's generated effect/preset CSS), or
 * demo/tailwind.css (Tailwind/daisyUI's compiled output)? If none of those own it, the class is
 * either a typo, a page that forgot to style something, or — the case this was actually built for
 * — a Tailwind/daisyUI class that source detection failed to pick up. This check does not attempt
 * to guess *which* stylesheet a class "should" live in; it only proves a rule exists somewhere,
 * which is what actually breaks (an invisible/unstyled element) when it doesn't.
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
])

/** Class selector tokens appearing anywhere in `css` (nested/compound selectors included), unescaped. */
function classSelectorsIn(css) {
  const present = new Set()
  for (const m of css.matchAll(/\.((?:[\w-]|\\.)+)/g)) present.add(m[1].replace(/\\(.)/g, '$1'))
  return present
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
// Classes styled inline in some page's own <style> block — pooled across all pages, since a
// shared/repeated pattern (e.g. .demo-card) is legitimately defined once and reused.
const inlineStyled = new Set()

for (const file of htmlFiles) {
  const html = readFileSync(join(DEMO, file), 'utf8')
  for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) recordUsage(used, c, file)
  }
  for (const styleBlock of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const c of classSelectorsIn(styleBlock[1])) inlineStyled.add(c)
  }
}

const stylesheets = {
  'demo/tailwind.css': readIfExists(join(DEMO, 'tailwind.css')),
  'demo/style.css': readIfExists(join(DEMO, 'style.css')),
  'demo/system.css': readIfExists(join(DEMO, 'system.css')),
  'demo/kuinetic.css': readIfExists(join(DEMO, 'kuinetic.css')),
}

const missingBuildOutputs = Object.entries(stylesheets)
  .filter(([, content]) => content === null)
  .map(([name]) => name)
if (missingBuildOutputs.length) {
  console.error(
    `check:css-coverage: ${missingBuildOutputs.join(', ')} not found — run \`npm run build\` first ` +
      `(this check runs as \`npm run check:css-coverage\`, which does that for you).`
  )
  process.exit(1)
}

const covered = new Set(inlineStyled)
for (const content of Object.values(stylesheets)) {
  for (const c of classSelectorsIn(content)) covered.add(c)
}

const missing = []
for (const [cls, files] of used) {
  if (covered.has(cls)) continue
  if (ALLOWLIST.has(cls)) continue
  missing.push({ cls, files: [...files].sort() })
}
missing.sort((a, b) => a.cls.localeCompare(b.cls))

if (missing.length) {
  console.error(`check:css-coverage: ${missing.length} class(es) used in demo/*.html have no CSS rule anywhere:\n`)
  for (const { cls, files } of missing) console.error(`  .${cls}  (${files.join(', ')})`)
  console.error(
    `\nEach of these needs either: a rule in the page's own <style> block / demo/style.css / ` +
      `demo/system.css / demo/kuinetic.css, a Tailwind/daisyUI utility that source detection in ` +
      `demo/tailwind-entry.css should be picking up but isn't, or — if it's a deliberate unstyled ` +
      `marker like the two in this script's ALLOWLIST — an entry added there with a reason.`
  )
  process.exit(1)
}

console.log(`check:css-coverage: ${used.size} classes used in demo/*.html, all covered (${ALLOWLIST.size} allowlisted).`)
