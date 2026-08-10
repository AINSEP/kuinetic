import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * A multi-subpath SVG path with a hole, morphing.
 *
 * `scripts/verify-browser.mjs` only asserts the `d` attribute changed and starts with `M` — true
 * even for a shape that lost a subpath. `docs/review-2-gpt-5.6-sol.md` named this gap directly:
 * "the current model serializes one initial M and never emits Z, so separate subpaths and stroke
 * join/cap semantics are not preserved." This suite morphs a square-with-a-hole (two subpaths,
 * `evenodd` fill) and counts subpath boundaries in the output, rather than trusting the leading
 * character.
 *
 * This is a defect-finding suite, not a passing regression guard: `src/core/path-morph.ts` is out
 * of scope for this dispatch (Programmer is forbidden from editing `src/`), so a failing check here
 * is expected and is reported to `docs/browser-findings.md` rather than fixed.
 */
export const name = 'svg-morph-subpath'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/svg-morph-subpath.html', import.meta.url))}`

/** Count of subpath-start ('M'/'m') commands in a `d` string. */
const moveToCount = (d) => (d.match(/[Mm]/g) ?? []).length
/** Count of subpath-close ('Z'/'z') commands in a `d` string. */
const closeCount = (d) => (d.match(/[Zz]/g) ?? []).length

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 400, height: 400 } })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await snap(page, 'authored-two-subpath-hole')

  const beforeD = await page.$eval('#morph', (el) => el.getAttribute('d'))
  check(
    'sanity: the authored fixture itself has two subpaths, both closed',
    moveToCount(beforeD) === 2 && closeCount(beforeD) === 2,
    `d=${beforeD}`,
  )

  // `page.hover()` fails actionability checks here — the `<svg>` intercepts pointer targeting
  // for its zero-stroke-area `<path>` children — so this dispatches the same trusted-enough
  // PointerEvent scripts/verify-browser.mjs already uses for its single-subpath morph check.
  await page.$eval('#morph', (el) => el.dispatchEvent(new PointerEvent('pointerenter')))
  await page.waitForTimeout(450)
  const afterD = await page.$eval('#morph', (el) => el.getAttribute('d'))
  await snap(page, 'morphed-output')

  check(
    'morph output preserves both subpath boundaries (M count)',
    moveToCount(afterD) === 2,
    `expected 2 "M" commands, found ${moveToCount(afterD)} — d=${afterD}`,
  )
  check(
    'morph output preserves subpath closure (Z count)',
    closeCount(afterD) >= 2,
    `expected >=2 "Z" commands, found ${closeCount(afterD)} — d=${afterD}`,
  )

  await context.close()
  return results
}
