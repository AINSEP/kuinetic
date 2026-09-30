import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * `swipe-y` on a phone, with real touches. A vertical swipe is the one gesture a browser most wants
 * for itself — it is a page scroll — so the unit tier (which cannot even store `touch-action` in
 * jsdom) cannot tell whether the deck ever sees one. Here CDP touches go through the compositor:
 * the deck must report the swipe without scrolling the page, a finger outside it must still scroll
 * the page, and a vertical deck *without* `swipe-y` must leave the page scrolling through it.
 */
export const name = 'swipe-y-touch'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/swipe-y-touch.html', import.meta.url))}`

async function touchSwipe(page, x, fromY, toY) {
  const cdp = await page.context().newCDPSession(page)
  const at = (y) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromY) })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(fromY + ((toY - fromY) * step) / 10) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await page.waitForTimeout(400)
}

const middle = (page, id) => page.evaluate((target) => {
  const rect = document.getElementById(target).getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}, id)

const top = (page) => page.evaluate(() => { window.scrollTo(0, 0); return window.scrollY })

export async function run({ browser }) {
  const { check, results } = createChecker()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('swiped-deck').hasAttribute('data-kui-step'))

  const actions = await page.evaluate(() => Object.fromEntries(['swiped', 'plain', 'authored'].map((id) =>
    [id, getComputedStyle(document.getElementById(id)).touchAction]).concat([
    ['body', getComputedStyle(document.body).touchAction], ['html', getComputedStyle(document.documentElement).touchAction]])))
  check('swipe-y hands the browser the horizontal axis only, on the deck itself',
    actions.swiped === 'pan-x pinch-zoom' && actions.authored === 'pan-x pinch-zoom', JSON.stringify(actions))
  check('a vertical deck without swipe-y, and the page around both, keep the browser default',
    actions.plain === 'auto' && actions.body === 'auto' && actions.html === 'auto', JSON.stringify(actions))

  await top(page)
  const swiped = await middle(page, 'swiped')
  await touchSwipe(page, swiped.x, swiped.y + 100, swiped.y - 100)
  const onDeck = await page.evaluate(() => ({
    swipe: document.getElementById('swiped').getAttribute('data-kui-swipe'),
    step: document.getElementById('swiped-deck').getAttribute('data-kui-step'),
    scrollY: window.scrollY,
  }))
  check('a touch swipe up on a swipe-y deck is reported and does not scroll the page',
    onDeck.swipe === 'up' && onDeck.scrollY === 0, JSON.stringify(onDeck))
  // No page script in the fixture: the carousel inside the swipe steps on the library's own event.
  check('the swipe up steps the carousel inside the swipe-y wrapper to its next slide', onDeck.step === '1', JSON.stringify(onDeck))
  await top(page)
  await touchSwipe(page, swiped.x, swiped.y - 100, swiped.y + 100)
  const back = await page.evaluate(() => document.getElementById('swiped-deck').getAttribute('data-kui-step'))
  check('a swipe down steps it back to the previous slide', back === '0', `step=${back}`)

  await top(page)
  const plain = await middle(page, 'plain')
  await touchSwipe(page, plain.x, plain.y + 100, plain.y - 100)
  const through = await page.evaluate(() => ({ scrollY: window.scrollY, step: document.getElementById('plain').getAttribute('data-kui-step') }))
  check('the same swipe on a deck without swipe-y scrolls the page (opt-in) and leaves the deck where it was',
    through.scrollY > 50 && through.step === '0', JSON.stringify(through))

  // On the filler below every deck: the page must still scroll there.
  const start = await page.evaluate(() => {
    const filler = document.querySelector('.filler')
    window.scrollTo(0, filler.offsetTop)
    return window.scrollY
  })
  const lead = await middle(page, 'swiped')
  await touchSwipe(page, lead.x, 600, 400)
  const outside = await page.evaluate(() => window.scrollY)
  check('a touch outside the swipe-y deck still scrolls the page', outside - start > 50, `scrollY ${start} -> ${outside}`)

  await page.evaluate(() => window.__kui.destroy())
  const restored = await page.evaluate(() => ({
    swiped: getComputedStyle(document.getElementById('swiped')).touchAction,
    authored: document.getElementById('authored').style.touchAction,
  }))
  check('teardown puts touch-action back, including an authored inline value',
    restored.swiped === 'auto' && restored.authored === 'manipulation', JSON.stringify(restored))

  await context.close()
  return results
}
