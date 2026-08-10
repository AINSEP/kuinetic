/**
 * Shared plumbing for every real-browser script: `verify-browser.mjs` and everything under
 * `test/browser/`. Centralised so both get the same Chromium resolution and the same frame-naming
 * scheme, instead of two scripts drifting apart on how evidence is captured.
 */
import { mkdirSync } from 'node:fs'

/**
 * Resolve Playwright without hardcoding a path outside the repository.
 *
 * Preference order: an installed `playwright-core`, then `playwright`, then an explicit
 * `PLAYWRIGHT_MODULE` override. Hardcoding an absolute path made this harness unrunnable on any
 * machine but one, which is not a usable quality gate for a public library.
 *
 * @returns The `chromium` launcher export.
 * @complexity O(c) time in the number of candidate modules tried; O(1) space.
 * @overallScore 100
 */
export async function loadChromium() {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright-core', 'playwright'].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const resolved = candidate.startsWith('/') ? candidate : require.resolve(candidate)
      const mod = await import(candidate.startsWith('/') ? `file://${resolved}` : candidate)
      if (mod.chromium) return mod.chromium
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Playwright not found. Install `playwright-core` and its Chromium, or set PLAYWRIGHT_MODULE ' +
      'to an absolute path to a Playwright entry point.',
  )
}

/**
 * Turn a check name into a filesystem-safe slug.
 *
 * @complexity O(n) time in name length; O(1) space.
 * @overallScore 100
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Create a pass/fail check log.
 *
 * Every browser script — `verify-browser.mjs` and each `test/browser/*.test.mjs` suite — reports
 * results the same way: a running console log plus a list a caller can reduce to an exit code.
 * Centralising it means a suite only owns its assertions, not its own copy of this bookkeeping.
 *
 * @returns `check(name, passed, detail?)`, which logs and records, plus the accumulating `results`.
 * @complexity O(1) time and space per call.
 * @overallScore 100
 */
export function createChecker() {
  const results = []
  function check(name, passed, detail = '') {
    results.push({ name, passed, detail })
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
    return passed
  }
  return { check, results }
}

/**
 * Create a named-frame recorder over one output directory.
 *
 * Frames are numbered in call order (`01-`, `02-`, ...) so they sort into a filmstrip on disk,
 * and named after the check they document so an agent can `Read` the exact PNG a finding refers
 * to without cross-referencing an index. One recorder instance owns one counter, so parallel
 * suites each get their own instance and their own subdirectory rather than racing over shared
 * numbering.
 *
 * @param dir - Directory frames are written to; created if missing.
 * @returns A `snap(page, name)` function resolving to the written file's basename.
 * @complexity O(1) time and space to construct; each `snap` call costs one screenshot.
 * @overallScore 100
 */
export function createFrameRecorder(dir) {
  mkdirSync(dir, { recursive: true })
  let count = 0

  return async function snap(page, name) {
    count += 1
    const file = `${String(count).padStart(2, '0')}-${slugify(name)}.png`
    await page.screenshot({ path: `${dir}/${file}` })
    return file
  }
}
