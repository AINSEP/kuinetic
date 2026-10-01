import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * "carousel-stack freezes sometimes", in a real renderer: a self-moving deck must always move again
 * once nobody is touching it, however the last touch ended.
 *
 * The unit tier (`test/deck-motion-freeze.test.ts`) drives synthetic events through jsdom, which has
 * no pointer capture and no boundary events of its own. These are the sequences a real Chromium
 * produces: a mouse drag released outside the deck (capture retargets the release; the leave comes
 * from the browser, not the test), a two-finger touch on the deck, and `hover:none` with the mouse
 * parked on top.
 */
export const name = 'deck-motion-freeze'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/deck-motion-freeze.html', import.meta.url))}`

const settle = (page, ms) => page.waitForTimeout(ms)

const stepOf = (page, id) => page.evaluate((hostId) => document.getElementById(hostId).getAttribute('data-kui-step'), id)
const draggingOf = (page, id) =>
  page.evaluate((hostId) => document.getElementById(hostId).getAttribute('data-kui-ring-dragging'), id)

async function centreOf(page, id) {
  await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
  return page.evaluate((hostId) => {
    const rect = document.getElementById(hostId).getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, right: rect.right, bottom: rect.bottom }
  }, id)
}

/** Drag left across the deck and release well outside it, then park the mouse outside too. */
async function checkReleaseOutside(page, check) {
  const box = await centreOf(page, 'stack')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x - i * 20, box.y)
  // Out past the deck's corner, still held: capture keeps the drag ours.
  await page.mouse.move(box.right + 200, box.bottom + 120)
  await page.mouse.up()
  await page.mouse.move(5, 5)
  const dragging = await draggingOf(page, 'stack')
  check('mouse: the drag ends when released outside the deck', dragging === 'false', `data-kui-ring-dragging=${dragging}`)
  const before = await stepOf(page, 'stack')
  // One settle (620ms) plus a full 2s period, with slack.
  await settle(page, 3500)
  const after = await stepOf(page, 'stack')
  check('mouse: autoplay resumes after a drag released outside', after !== before, `step ${before} -> ${after}`)
}

/** `hover:none`: the mouse parked on the deck does not hold it. */
async function checkHoverNone(page, check) {
  const box = await centreOf(page, 'stack-unhovered')
  await page.mouse.move(box.x, box.y)
  const before = await stepOf(page, 'stack-unhovered')
  await settle(page, 2600)
  const after = await stepOf(page, 'stack-unhovered')
  check('hover:none: the deck keeps stepping under a resting mouse', after !== before, `step ${before} -> ${after}`)
  await page.mouse.move(5, 5)
}

/** Default: the mouse parked on the deck holds it — the rule `hover:none` opts out of. */
async function checkHoverPauses(page, check) {
  const box = await centreOf(page, 'stack')
  await page.mouse.move(box.x, box.y)
  await settle(page, 200)
  const before = await stepOf(page, 'stack')
  await settle(page, 2600)
  const after = await stepOf(page, 'stack')
  check('default: a resting mouse pauses the deck', after === before, `step ${before} -> ${after}`)
  await page.mouse.move(5, 5)
}

/**
 * A second finger lands mid-drag, then both lift. Raw CDP touch events, because Playwright's
 * `touchscreen` has one finger.
 */
async function checkSecondFinger(page, check) {
  const box = await centreOf(page, 'stack')
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  const one = (x) => ({ x, y: box.y, id: 1 })
  const two = { x: box.x + 30, y: box.y + 20, id: 2 }
  await touch('touchStart', [one(box.x)])
  for (let i = 1; i <= 6; i += 1) await touch('touchMove', [one(box.x - i * 15)])
  await touch('touchStart', [one(box.x - 90), two])
  await touch('touchMove', [one(box.x - 100), two])
  await touch('touchEnd', [two])
  await touch('touchEnd', [])
  await cdp.detach()
  const dragging = await draggingOf(page, 'stack')
  check('touch: a second finger mid-drag does not leave the drag held', dragging === 'false', `data-kui-ring-dragging=${dragging}`)
  const selectable = await page.evaluate(() => getComputedStyle(document.documentElement).userSelect)
  check('touch: the page is selectable again after the two-finger drag', selectable !== 'none', `user-select=${selectable}`)
  const before = await stepOf(page, 'stack')
  await settle(page, 3500)
  const after = await stepOf(page, 'stack')
  check('touch: autoplay resumes after a two-finger drag', after !== before, `step ${before} -> ${after}`)
}

export async function run({ browser }) {
  const { check, results } = createChecker()

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await desktop.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('stack').hasAttribute('data-kui-step'))
  await checkHoverPauses(page, check)
  await checkReleaseOutside(page, check)
  await checkHoverNone(page, check)
  await desktop.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const touchPage = await phone.newPage()
  await touchPage.goto(FIXTURE_URL)
  await touchPage.waitForFunction(() => window.__kui !== undefined && document.getElementById('stack').hasAttribute('data-kui-step'))
  await checkSecondFinger(touchPage, check)
  await phone.close()

  return results
}
