/**
 * Copy the docs `demo/docs.html` reads into `demo/docs/`, so they exist on the deployed site.
 *
 * `demo/docs.html` fetches its three tabs from the *relative* path `./docs/<doc>.md`. Locally that
 * works by accident of the dev server: `scripts/dev-server.mjs` special-cases `/docs/` and maps it
 * to the repo-level `docs/` folder, so all three tabs resolve. In production nothing does that
 * mapping — `vercel.json` sets `"outputDirectory": "demo"`, so the web root *is* `demo/` and
 * `./docs/catalog.md` resolves to `demo/docs/catalog.md`. That file did not exist, so Catalog and
 * Architecture 404'd on the live site while Getting Started (the one file someone had hand-copied
 * in, and which had since gone 700 lines stale) kept working. The dev server's convenience mapping
 * is exactly what hid it: the pages were only ever broken where nobody was looking.
 *
 * So the deployed copies are a build artifact, generated here rather than hand-maintained — the
 * same treatment `demo/kuinetic.js` and `demo/kuinetic.css` already get. They are committed,
 * because Vercel serves `demo/` as static output and does not run this build.
 *
 * `test/demo-docs.test.ts` is the guard: it re-derives the tab list from `demo/docs.html` itself
 * and fails if any tab has no deployed copy, or if a copy has drifted from its source.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE_DIR = join(ROOT, 'docs')
const TARGET_DIR = join(ROOT, 'demo', 'docs')

/**
 * The tab list is read out of `demo/docs.html`'s own `DOCS` map rather than hardcoded here, so
 * adding a fourth tab to the page is all it takes — this script and the test both pick it up.
 * Deliberately the same extraction the test does, and deliberately a plain regex: the map is a
 * hand-written object literal in an inline `<script>`, not something worth parsing HTML for.
 */
function docKeysFromPage(html) {
  const map = /var DOCS = \{([\s\S]*?)\}/.exec(html)
  if (!map) throw new Error('Could not find the `var DOCS = {...}` map in demo/docs.html')
  const keys = [...map[1].matchAll(/(?:^|,)\s*'?([\w-]+)'?\s*:/g)].map((m) => m[1])
  if (!keys.length) throw new Error('The `DOCS` map in demo/docs.html parsed to zero tabs')
  return keys
}

const keys = docKeysFromPage(readFileSync(join(ROOT, 'demo', 'docs.html'), 'utf8'))

mkdirSync(TARGET_DIR, { recursive: true })

// Drop stale copies first: a tab renamed or removed from `docs.html` should not leave an orphan
// markdown file sitting in the deploy output forever.
const wanted = new Set(keys.map((key) => `${key}.md`))
for (const file of readdirSync(TARGET_DIR)) {
  if (file.endsWith('.md') && !wanted.has(file)) unlinkSync(join(TARGET_DIR, file))
}

for (const key of keys) {
  copyFileSync(join(SOURCE_DIR, `${key}.md`), join(TARGET_DIR, `${key}.md`))
}

console.log(`sync-demo-docs: copied ${keys.length} docs into demo/docs/ (${keys.join(', ')})`)
