import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * `lightbox:true` on a deck, and `autoplay:` on the flat `carousel`, in a real renderer with real
 * pointers.
 *
 * The unit suites (`deck-lightbox`, `carousel-autoplay`) synthesise the click that ends a drag; only
 * here does the *browser* decide whether a press-move-release on a card is followed by a click, and
 * where that click lands. So: a real click on the front card opens the gallery at that card; a real
 * drag that starts on a card moves the ring and opens nothing, and the next click still opens; the
 * gallery cycles every card of the ring and wraps. This suite found two drag bugs jsdom could not:
 * pointer capture from `pointerdown` retargeted every tap's click to the ring, and a linked card
 * started the browser's native drag-and-drop (see `carousel/drag.ts`). And the flat deck steps on its own timer, holds still under the pointer, and
 * stops for its pause control. Desktop with a mouse, then a 390px phone with real touches.
 */
export const name = 'deck-lightbox'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/deck-lightbox.html', import.meta.url))}`

const settle = (page, ms) => page.waitForTimeout(ms)
const counter = (page) => page.evaluate(() => document.querySelector('.kui-lightbox-counter')?.textContent ?? '')
const isOpen = (page) => page.evaluate(() => document.querySelector('dialog.kui-lightbox')?.open === true)
const stepOf = (page, id) => page.evaluate((hostId) => document.getElementById(hostId).getAttribute('data-kui-step'), id)

/** Centre of the ring's live card, where a person would click it. */
const liveCard = (page) => page.evaluate(() => {
  const card = document.querySelector('#ring [data-kui-step-state="active"]')
  const rect = card.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, index: [...card.parentElement.children].indexOf(card) }
})

async function closeViewer(page) {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('dialog.kui-lightbox')?.open !== true)
  await settle(page, 350)
}

async function openFixture(browser, options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('deck').hasAttribute('data-kui-step'))
  await page.evaluate(() => document.getElementById('ring').scrollIntoView({ block: 'center' }))
  // The slots' first placement is a 620ms transition from `none`.
  await settle(page, 900)
  return { context, page }
}

async function checkClickOpens(page, check, label, press) {
  const card = await liveCard(page)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.card') ===
    document.querySelector('#ring [data-kui-step-state="active"]'), card)
  check(`${label}: the live card is what is under its own centre`, hit)
  await press(card)
  await page.waitForSelector('dialog.kui-lightbox.is-open', { timeout: 3000 }).catch(() => {})
  check(`${label}: a click on the live card opens the gallery at that card`,
    (await counter(page)) === `${card.index + 1} of 6`, `counter "${await counter(page)}", card ${card.index}`)
  check(`${label}: the page did not navigate to the card's link`, page.url().endsWith('deck-lightbox.html'), page.url())
}

async function checkCycle(page, check, label) {
  const start = Number((await counter(page)).split(' ')[0])
  for (let step = 1; step <= 6; step += 1) await page.click('.kui-lightbox-next')
  check(`${label}: Next six times goes round all six cards and back`, (await counter(page)) === `${start} of 6`, await counter(page))
  await page.keyboard.press('ArrowRight')
  const expected = (start % 6) + 1
  check(`${label}: ArrowRight steps the gallery`, (await counter(page)) === `${expected} of 6`, await counter(page))
  // Card three is a clip: landing on it shows a player, not a picture.
  for (let guard = 0; guard < 6 && !(await counter(page)).startsWith('3 '); guard += 1) await page.keyboard.press('ArrowRight')
  const video = await page.evaluate(() => document.querySelector('dialog.kui-lightbox figure video') !== null)
  check(`${label}: the clip card plays as a video in the gallery`, video)
  await closeViewer(page)
}

async function mouseDrag(page, from) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 160, from.y, { steps: 12 })
  await page.mouse.up()
}

async function touchDrag(page, from) {
  const cdp = await page.context().newCDPSession(page)
  const at = (x) => [{ x, y: from.y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x) })
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x - (160 * step) / 12) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function checkDragDoesNotOpen(page, check, label, drag) {
  const before = await stepOf(page, 'ring')
  const card = await liveCard(page)
  await drag(page, card)
  await settle(page, 900)
  check(`${label}: a drag that starts on a card moves the ring`, (await stepOf(page, 'ring')) !== before, `step ${before} -> ${await stepOf(page, 'ring')}`)
  check(`${label}: and opens nothing`, !(await isOpen(page)))
  check(`${label}: and does not follow the card's link`, page.url().endsWith('deck-lightbox.html'), page.url())
}

async function checkAutoplay(page, check, label) {
  await page.evaluate(() => document.getElementById('deck').scrollIntoView({ block: 'center' }))
  await page.mouse.move(2, 2)
  const s0 = await stepOf(page, 'deck')
  await page.waitForFunction((from) => document.getElementById('deck').getAttribute('data-kui-step') !== from, s0, { timeout: 3500 })
    .catch(() => {})
  check(`${label}: carousel autoplay:2s steps on its own`, (await stepOf(page, 'deck')) !== s0, `step stayed ${s0}`)

  const box = await page.evaluate(() => {
    const rect = document.getElementById('deck').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  const held = await stepOf(page, 'deck')
  await settle(page, 2600)
  check(`${label}: it holds still under the pointer`, (await stepOf(page, 'deck')) === held, `${held} -> ${await stepOf(page, 'deck')}`)

  await page.click('#deck .pp')
  const pressed = await page.getAttribute('#deck .pp', 'aria-pressed')
  await page.mouse.move(2, 2)
  const paused = await stepOf(page, 'deck')
  await settle(page, 2600)
  check(`${label}: its pause control stops it and says so`, pressed === 'true' && (await stepOf(page, 'deck')) === paused,
    `aria-pressed=${pressed}, ${paused} -> ${await stepOf(page, 'deck')}`)
  await page.click('#deck .pp')
  await page.mouse.move(2, 2)
  await page.waitForFunction((from) => document.getElementById('deck').getAttribute('data-kui-step') !== from, paused, { timeout: 3500 })
    .catch(() => {})
  check(`${label}: pressing it again resumes`, (await stepOf(page, 'deck')) !== paused)

  // A click on the live slide opens the viewer and does not also advance the deck.
  const before = await stepOf(page, 'deck')
  await page.click('#deck [data-kui-step-state="active"] img')
  await page.waitForSelector('dialog.kui-lightbox.is-open', { timeout: 3000 }).catch(() => {})
  check(`${label}: a click on the step deck's slide opens it in the gallery`,
    (await counter(page)) === `${Number(before) + 1} of 3`, `counter "${await counter(page)}", step ${before}`)
  await closeViewer(page)
}

export async function run({ browser }) {
  const { check, results } = createChecker()

  const desktop = await openFixture(browser, { viewport: { width: 1280, height: 900 } })
  await checkClickOpens(desktop.page, check, 'desktop', (card) => desktop.page.mouse.click(card.x, card.y))
  await checkCycle(desktop.page, check, 'desktop')
  await checkDragDoesNotOpen(desktop.page, check, 'desktop mouse', mouseDrag)
  await checkClickOpens(desktop.page, check, 'desktop after a drag', (card) => desktop.page.mouse.click(card.x, card.y))
  await closeViewer(desktop.page)
  await checkAutoplay(desktop.page, check, 'desktop')
  await desktop.context.close()

  const phone = await openFixture(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await checkClickOpens(phone.page, check, 'phone tap', (card) => phone.page.touchscreen.tap(card.x, card.y))
  await closeViewer(phone.page)
  await checkDragDoesNotOpen(phone.page, check, 'phone touch', touchDrag)
  // A touch drag is never followed by a click; the next tap must still open (the drag's click
  // suppression used to wait for a click that never came, and ate this tap instead).
  await checkClickOpens(phone.page, check, 'phone tap after a swipe', (card) => phone.page.touchscreen.tap(card.x, card.y))
  await closeViewer(phone.page)
  await phone.context.close()

  return results
}
