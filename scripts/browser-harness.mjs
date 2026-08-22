/**
 * Shared plumbing for every real-browser script: `verify-browser.mjs` and everything under
 * `test/browser/`. Centralised so both get the same Chromium resolution and the same frame-naming
 * scheme, instead of two scripts drifting apart on how evidence is captured.
 */
import { mkdirSync, rmSync } from 'node:fs'

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
    const suffix = detail ? `  — ${detail}` : ''
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${suffix}`)
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
 * The directory is wiped and recreated on construction, so a rerun's frames are never mixed with
 * a stale set left over from a previous run under different numbering — a rerunnable regression
 * suite is only trustworthy if its evidence directory reflects the run that just happened.
 *
 * @param dir - Directory frames are written to; cleared and recreated.
 * @returns A `snap(page, name)` function resolving to the written file's basename.
 * @complexity O(1) time and space to construct; each `snap` call costs one screenshot.
 * @overallScore 100
 */
export function createFrameRecorder(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let count = 0

  return async function snap(page, name) {
    count += 1
    const file = `${String(count).padStart(2, '0')}-${slugify(name)}.png`
    await page.screenshot({ path: `${dir}/${file}` })
    return file
  }
}

/**
 * Sample a continuous motion at several points across its duration, capturing a named frame at
 * each and returning what `read` observed there.
 *
 * A single before/after frame pair proves endpoints, not the motion between them — it cannot show
 * a wrong overshoot, dropped frames, or geometry that briefly goes somewhere it should never go.
 * FLIP, spring physics, and gesture drags are exactly the effects where "it reached the right
 * place" is not the same claim as "it got there correctly", so this burst-samples instead of
 * checking two static states.
 *
 * Sample times are anchored to a real clock, not to a running tally of the waits requested.
 * Every `read()` is a browser round trip and every `snap()` is a screenshot; both cost real
 * wall-clock time that a tally never counts, so an accounting-only version falls further behind
 * the motion at each sample — and falls behind *more* on a loaded machine. The drift is silent:
 * the samples stay labelled 12.5%, 25%, … while actually being taken well after those points,
 * which turns any assertion about an early sample's magnitude into a load-dependent coin flip.
 * Anchoring to `performance.now()` and reporting where each sample really landed makes the drift
 * measurable instead of invisible.
 *
 * @param page - Page to sample from.
 * @param snap - Frame recorder from `createFrameRecorder`.
 * @param label - Prefix for each sample's frame name.
 * @param durationMs - Total span the fractions are measured against.
 * @param fractions - Points in `[0, 1]` of `durationMs` to sample at, in ascending order.
 * @param read - Called on `page` at each sample point; its return value is collected.
 * @param startedAt - `performance.now()` at the true zero of the motion, for a caller that does
 *   work between starting it and calling this. Defaults to entry, which assumes zero is now.
 * @returns `{ samples, elapsed, sampledAtMs, maxDriftMs }` — one `read()` result per fraction, the
 *   real time since `startedAt` (so a caller can subtract it from a subsequent "wait past the end"
 *   step), when each sample was actually requested relative to that zero, and the worst gap between
 *   a sample's nominal and actual time.
 * @complexity O(f) browser round trips in `fractions.length`; O(f) space for the collected samples.
 * @overallScore 100
 */
export async function burstSample({ page, snap, label, durationMs, fractions, read, startedAt }) {
  const zero = startedAt ?? performance.now()
  const samples = []
  const sampledAtMs = []
  let maxDriftMs = 0
  for (const [index, fraction] of fractions.entries()) {
    const target = durationMs * fraction
    await page.waitForTimeout(Math.max(0, target - (performance.now() - zero)))
    // Stamped before the read, not after: this is the moment the sample was asked for, which is
    // what the wait above was aiming at. Stamping after would fold the round trip into the drift.
    const askedAt = performance.now() - zero
    samples.push(await read(page))
    sampledAtMs.push(askedAt)
    maxDriftMs = Math.max(maxDriftMs, askedAt - target)
    await snap(page, `${label}-${index + 1}-of-${fractions.length}-at-${Math.round(fraction * 100)}pct`)
  }
  return { samples, elapsed: performance.now() - zero, sampledAtMs, maxDriftMs }
}
