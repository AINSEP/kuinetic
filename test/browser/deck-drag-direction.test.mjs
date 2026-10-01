import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * A drag moves the card under the pointer the way the pointer went — outside a ring and from inside
 * one (the showcase hero band: `carousel-3d-inside arc:180deg facing:radial`), by mouse and by touch.
 * And a real click on a band card, with the 1-3px wobble a hand puts into it, opens the lightbox.
 *
 * The unit tier (`test/deck-drag-direction.test.ts`) stands in a layout and proves the drag obeys
 * it. Only a real renderer says which way `translateZ(-r)` actually puts the next card, which is
 * the whole bug: inside rings dragged their cards against the hand.
 */
export const name = 'deck-drag-direction'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/deck-drag-direction.html', import.meta.url))}`
const DRAG_PX = 60

const settle = (page, ms) => page.waitForTimeout(ms)
const isOpen = (page) => page.evaluate(() => document.querySelector('dialog.kui-lightbox')?.open === true)

/**
 * The front card, pressed at its own centre — tagged so it can be found again mid-drag — and its
 * centre x.
 *
 * Not the host's centre: a tilted ring's host reserves room above and below its cards, so on the
 * hero band the host's centre falls ~70px under the front card, on no card at all.
 */
async function cardUnderCentre(page, id) {
  await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
  await settle(page, 300)
  return page.evaluate((hostId) => {
    const host = document.getElementById(hostId)
    const front = [...host.querySelectorAll('[data-kui-step-state="active"]')]
      .find((node) => node.parentElement === host || host.contains(node))
    if (!front) return null
    const face = front.getBoundingClientRect()
    const x = face.left + face.width / 2
    const y = face.top + face.height / 2
    // Not `elementFromPoint`: on a concave ring the host wins the hit test over its own cards.
    const card = document.elementsFromPoint(x, y)
      .map((node) => node.closest('[data-kui-step-offset]'))
      .find((node) => node && host.contains(node))
    if (!card) return null
    document.querySelectorAll('[data-probe]').forEach((node) => node.removeAttribute('data-probe'))
    card.setAttribute('data-probe', '')
    const rect = card.getBoundingClientRect()
    return { x, y, cardX: rect.left + rect.width / 2 }
  }, id)
}

const probeX = (page) => page.evaluate(() => {
  const rect = document.querySelector('[data-probe]').getBoundingClientRect()
  return rect.left + rect.width / 2
})

async function checkFollows(page, check, label, id, drag) {
  const start = await cardUnderCentre(page, id)
  check(`${label}: a card is under ${id}'s centre`, start !== null)
  if (!start) return
  for (const direction of [-1, 1]) {
    const before = await probeX(page)
    const mid = await drag(page, start, direction)
    const moved = mid - before
    check(
      `${label}: dragging ${id} ${direction < 0 ? 'left' : 'right'} moves the card under the pointer ${direction < 0 ? 'left' : 'right'}`,
      Math.sign(moved) === direction && Math.abs(moved) > DRAG_PX / 4,
      `card moved ${moved.toFixed(1)}px for a ${direction * DRAG_PX}px drag`,
    )
    // Let it settle and the hold lapse before the next drag.
    await settle(page, 900)
  }
}

/** Mouse: press, move in small steps, read the card mid-drag, release. */
async function mouseDrag(page, from, direction) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + direction * DRAG_PX, from.y, { steps: 12 })
  const x = await probeX(page)
  await page.mouse.up()
  await page.mouse.move(5, 5)
  return x
}

/** Touch through CDP, since Playwright's touchscreen only taps. */
async function touchDrag(page, from, direction) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y: from.y, id: 1 }],
  })
  await touch('touchStart', from.x)
  for (let i = 1; i <= 12; i += 1) await touch('touchMove', from.x + (direction * DRAG_PX * i) / 12)
  const x = await probeX(page)
  await touch('touchEnd', 0)
  await cdp.detach()
  return x
}

/** A real click on the band's centre card, with a 1-3px wobble between press and release. */
async function checkWobblyClick(page, check, wobble) {
  const start = await cardUnderCentre(page, 'band')
  if (!start) return
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + wobble, start.y + Math.min(wobble, 2), { steps: wobble })
  await page.mouse.up()
  await page.waitForSelector('dialog.kui-lightbox.is-open', { timeout: 2000 }).catch(() => {})
  check(`a click with ${wobble}px of wobble on a band card opens the lightbox`, await isOpen(page))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('dialog.kui-lightbox')?.open !== true).catch(() => {})
  await page.mouse.move(5, 5)
  await settle(page, 400)
  // Escape left a focus ring on the restored host; that is the viewer's hand-back, not a Tab, and
  // must not hold the spin (`auto-motion.ts`, `onFocusIn`).
  const at = () => page.evaluate(() => Number(document.getElementById('band').style.getPropertyValue('--kui-step-position')))
  const p0 = await at()
  await settle(page, 600)
  const p1 = await at()
  check(`after an Escape close (${wobble}px click), the band spins again`, p1 !== p0, `position ${p0} -> ${p1}`)
}

/** Every slot of `id` the viewer faces, by alt text and on-screen centre. */
const frontSlots = (page, id) => page.evaluate((hostId) =>
  [...document.querySelectorAll(`#${hostId} .ring-slot`)]
    .filter((slot) => slot.getAttribute('data-kui-ring-face') !== 'back')
    .map((slot) => {
      const rect = slot.getBoundingClientRect()
      return { alt: slot.querySelector('img').alt, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    .filter((slot) => slot.x > 20 && slot.x < innerWidth - 20), id)

const shownAlt = (page) => page.evaluate(() => document.querySelector('dialog.kui-lightbox figure img')?.alt ?? '')

async function closeIfOpen(page) {
  if (!(await isOpen(page))) return
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('dialog.kui-lightbox')?.open !== true).catch(() => {})
  await settle(page, 400)
}

/**
 * A real mouse click at a slot's centre opens THAT slot. On a concave ring the host wins the hit
 * test (its cards sit behind its plane), so this failed for every slot before the deck resolved the
 * card from the press point (`elementsFromPoint`, `showcase/lightbox.ts`).
 */
async function checkRealClicks(page, check, id) {
  await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
  await settle(page, 400)
  // Spinning rows: read and click in one breath, at a slot near the middle, where it moves least.
  const slots = await frontSlots(page, id)
  const hostHit = await page.evaluate(({ x, y, hostId }) => document.elementFromPoint(x, y) === document.getElementById(hostId),
    { ...slots[Math.floor(slots.length / 2)], hostId: id })
  check(`${id}: diagnostic — the host wins the hit test at a slot's centre`, true, `host hit: ${hostHit}`)
  for (const slot of slots.slice(0, 3)) {
    await page.mouse.click(slot.x, slot.y)
    await page.waitForSelector('dialog.kui-lightbox.is-open', { timeout: 2000 }).catch(() => {})
    const shown = await shownAlt(page)
    check(`${id}: a real click on "${slot.alt}" opens it`, (await isOpen(page)) && shown === slot.alt, `open=${await isOpen(page)}, shown "${shown}"`)
    await closeIfOpen(page)
    await page.mouse.move(5, 5)
  }
}

/** A slow press on a deck that keeps turning (`hover:none`) opens the card under the press. */
async function checkSlowPress(page, check) {
  await page.evaluate(() => document.getElementById('band-free').scrollIntoView({ block: 'center' }))
  await settle(page, 400)
  const slots = await frontSlots(page, 'band-free')
  const slot = slots[Math.floor(slots.length / 2)]
  await page.mouse.move(slot.x, slot.y)
  await page.mouse.down()
  // 20s a turn over 8 cards on half a circle: 700ms moves the row most of a card along.
  await settle(page, 700)
  await page.mouse.up()
  await page.waitForSelector('dialog.kui-lightbox.is-open', { timeout: 2000 }).catch(() => {})
  const shown = await shownAlt(page)
  check('band-free (hover:none): a slow press opens the card that was pressed', shown === slot.alt, `pressed "${slot.alt}", shown "${shown}"`)
  await closeIfOpen(page)
  await page.mouse.move(5, 5)
}

export async function run({ browser }) {
  const { check, results } = createChecker()

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await desktop.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('band').hasAttribute('data-kui-step'))
  await settle(page, 900)
  await checkFollows(page, check, 'mouse', 'band', mouseDrag)
  await checkFollows(page, check, 'mouse', 'outside', mouseDrag)
  for (const wobble of [1, 2, 3]) await checkWobblyClick(page, check, wobble)
  await checkRealClicks(page, check, 'band')
  await checkRealClicks(page, check, 'band-free')
  await checkSlowPress(page, check)
  await desktop.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const touchPage = await phone.newPage()
  await touchPage.goto(FIXTURE_URL)
  await touchPage.waitForFunction(() => window.__kui !== undefined && document.getElementById('band').hasAttribute('data-kui-step'))
  await settle(touchPage, 900)
  await checkFollows(touchPage, check, 'touch', 'band', touchDrag)
  await checkFollows(touchPage, check, 'touch', 'outside', touchDrag)
  await phone.close()

  return results
}
