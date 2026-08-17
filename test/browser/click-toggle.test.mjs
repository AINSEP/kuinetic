import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Click-gated CSS effects must toggle, not go inert after the first activation.
 *
 * `card-flip-y` (and every other click-activated 3D/layout primitive) is CSS-rendered:
 * `createCssInstance.activate()` used to only ever write `animation-play-state: running`, which
 * the browser reads solely on the paused-to-running edge. A second click called `activate()` again
 * — the animator's own gate only blocks a *running* effect, not a *finished* one — but the repeat
 * write was a no-op, so the card looked permanently stuck flipped. See
 * `docs/live-testing-backlog.md` D2.
 */
export const name = 'click-toggle'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/click-toggle.html', import.meta.url))}`

/** Long enough for the fixture's 120ms flip plus the animator's finished-state bookkeeping. */
const SETTLE_MS = 300

async function readCard(page) {
  return page.$eval('#card', (el) => ({
    state: el.getAttribute('data-kui-state'),
    style: el.getAttribute('style'),
    rotate: getComputedStyle(el).rotate,
  }))
}

async function clickAndSettle(page) {
  await page.click('#card')
  await page.waitForTimeout(SETTLE_MS)
  return readCard(page)
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  const initial = await readCard(page)
  await snap(page, 'initial-ready')

  const afterFirst = await clickAndSettle(page)
  check(
    'first click flips the card to its finished state',
    afterFirst.state === 'finished' && afterFirst.rotate === 'y 180deg',
    `state=${afterFirst.state}, rotate=${afterFirst.rotate}`,
  )
  check(
    'first click actually changed rendered style from the ready state',
    afterFirst.rotate !== initial.rotate,
    `initial.rotate=${initial.rotate}, afterFirst.rotate=${afterFirst.rotate}`,
  )
  await snap(page, 'after-first-click-flipped')

  const afterSecond = await clickAndSettle(page)
  check(
    'second click reverses the flip instead of repeating a byte-identical no-op — the inline ' +
      'animation-* declarations are legitimately unchanged (play-state was already "running"), ' +
      "but the rendered rotation must not be — that's what a stuck second click looked like",
    afterSecond.rotate !== afterFirst.rotate,
    `afterFirst.rotate=${afterFirst.rotate}, afterSecond.rotate=${afterSecond.rotate}`,
  )
  check(
    'second click actually returns the card to its original unrotated angle',
    afterSecond.rotate === 'y 0deg',
    `rotate=${afterSecond.rotate}`,
  )
  await snap(page, 'after-second-click-reversed')

  const afterThird = await clickAndSettle(page)
  check(
    'a third click flips forward again, proving this is a toggle and not a one-time reversal',
    afterThird.rotate === 'y 180deg',
    `rotate=${afterThird.rotate}`,
  )
  await snap(page, 'after-third-click-flipped-again')

  await context.close()
  return results
}
