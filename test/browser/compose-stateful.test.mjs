import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * `swipe-y, carousel` on one element, with real touches.
 *
 * The unit tier (`test/compose-stateful.test.ts`) proves the pair compiles, mounts and tears down,
 * with synthetic pointer events and no `touch-action` (jsdom drops it). What only a browser shows is
 * that the composed element still behaves like the wrapper arrangement `swipe-y-touch.test.mjs`
 * covers: the swipe owns the vertical axis on the deck itself, a vertical touch steps the deck
 * without scrolling the page, and teardown leaves the element as authored.
 */
export const name = 'compose-stateful'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/compose-stateful.html', import.meta.url))}`

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

const read = (page) => page.evaluate(() => {
  const deck = document.getElementById('deck')
  return {
    fx: deck.getAttribute('data-kui-fx'),
    swipe: deck.getAttribute('data-kui-swipe'),
    step: deck.getAttribute('data-kui-step'),
    touchAction: getComputedStyle(deck).touchAction,
    scrollY: window.scrollY,
  }
})

export async function run({ browser }) {
  const { check, results } = createChecker()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('deck').hasAttribute('data-kui-step'))

  const mounted = await read(page)
  check('both effects mount on the one element', mounted.fx === 'swipe-y carousel' && mounted.step === '0', JSON.stringify(mounted))
  check('the swipe still hands the browser only the horizontal axis', mounted.touchAction === 'pan-x pinch-zoom', JSON.stringify(mounted))

  await page.evaluate(() => window.scrollTo(0, 0))
  const mid = await page.evaluate(() => {
    const rect = document.getElementById('deck').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await touchSwipe(page, mid.x, mid.y + 100, mid.y - 100)
  const up = await read(page)
  check('a touch swipe up is reported, steps the same element, and does not scroll the page',
    up.swipe === 'up' && up.step === '1' && up.scrollY === 0, JSON.stringify(up))

  await touchSwipe(page, mid.x, mid.y - 100, mid.y + 100)
  const down = await read(page)
  check('a swipe down steps it back', down.swipe === 'down' && down.step === '0', JSON.stringify(down))

  await page.evaluate(() => window.__kui.destroy())
  const after = await page.evaluate(() => {
    const deck = document.getElementById('deck')
    return {
      leftover: deck.getAttributeNames().filter((n) => n.startsWith('data-kui-')),
      touchAction: getComputedStyle(deck).touchAction,
      style: deck.getAttribute('style'),
    }
  })
  check('teardown removes both effects\' writes',
    after.leftover.length === 0 && after.touchAction === 'auto' && !after.style, JSON.stringify(after))

  await context.close()
  return results
}
