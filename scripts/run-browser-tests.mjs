/**
 * Run every suite in `test/browser/`.
 *
 * Each suite is a plain ESM module exporting `name` and an async `run({ browser, ARTIFACT_DIR })`
 * that returns a `{ name, passed, detail }[]`. One Chromium instance is shared across suites —
 * each suite opens its own context — so the gate stays fast as the suite count grows.
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadChromium } from './browser-harness.mjs'

const TEST_DIR = fileURLToPath(new URL('../test/browser', import.meta.url))
const ARTIFACT_DIR = fileURLToPath(new URL('../.artifacts', import.meta.url))

/**
 * Load every `*.test.mjs` module in `test/browser/`, in file-name order.
 *
 * @complexity O(f) time in file count; O(f) space.
 * @overallScore 100
 */
async function loadSuites() {
  const files = readdirSync(TEST_DIR)
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
  return Promise.all(files.map((file) => import(`${TEST_DIR}/${file}`)))
}

/**
 * Run one suite against the shared browser and prefix its results with the suite name.
 *
 * @complexity O(c) time in the suite's own checks; O(c) space.
 * @overallScore 100
 */
async function runSuite(suite, browser) {
  console.log(`\n=== ${suite.name} ===`)
  const results = await suite.run({ browser, ARTIFACT_DIR })
  return results.map((result) => ({ suite: suite.name, ...result }))
}

async function run() {
  const suites = await loadSuites()
  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: true })

  const allResults = []
  for (const suite of suites) allResults.push(...(await runSuite(suite, browser)))

  await browser.close()

  const failed = allResults.filter((r) => !r.passed)
  console.log(`\n${allResults.length - failed.length}/${allResults.length} browser-test checks passed`)
  if (failed.length > 0) {
    console.log(`\nFAILED:\n${failed.map((f) => `  - [${f.suite}] ${f.name}  ${f.detail}`).join('\n')}`)
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
