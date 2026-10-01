import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * A mixed row (`lightbox media:mixed`) as one gallery, in a real renderer with real media. The unit
 * tests stub `play()`/`pause()` — jsdom implements neither — so only here can a test see a native
 * player actually play on landing, actually stop when left, and resume where it stopped rather than
 * restart. Checked at desktop and again at 390px, where the controls and the frame must fit; on
 * two short screens, where every item must fit with its caption and counter; and with real touches.
 */
export const name = 'lightbox-gallery'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/lightbox-gallery.html', import.meta.url))}`

const counter = (page) => page.evaluate(() => document.querySelector('.kui-lightbox-counter')?.textContent ?? '')

/** The player currently in the viewer, stashed on window by position so later steps can find it. */
const stash = (page, key) => page.evaluate((k) => {
  window[k] = document.querySelector('dialog.kui-lightbox figure video')
  return window[k] !== null
}, key)

const playing = (page, key) => page.waitForFunction((k) => {
  const video = window[k]
  return video && !video.paused && video.currentTime > 0.2
}, key, { timeout: 5000 }).then(() => true, () => false)

async function checkCycle(page, check, label) {
  await page.click('#row a >> nth=0')
  await page.waitForSelector('dialog.kui-lightbox.is-open')
  check(`${label}: a mixed row opens as one gallery`, (await counter(page)) === '1 of 4', await counter(page))
  check(`${label}: the gallery is announced as media, not images`,
    (await page.getAttribute('dialog.kui-lightbox', 'aria-label')) === 'Media viewer')

  await page.click('.kui-lightbox-next')
  const first = await stash(page, '__a')
  check(`${label}: next lands on the video without closing`, first && (await page.evaluate(() => document.querySelector('dialog.kui-lightbox').open)))
  check(`${label}: the landed video plays`, await playing(page, '__a'))

  await page.keyboard.press('ArrowRight')
  await stash(page, '__b')
  check(`${label}: ArrowRight moves video to video`, (await counter(page)) === '3 of 4', await counter(page))
  check(`${label}: the second video plays`, await playing(page, '__b'))
  const left = await page.evaluate(() => ({ paused: window.__a.paused, at: window.__a.currentTime, attached: window.__a.isConnected }))
  check(`${label}: the video it left is paused`, left.paused && !left.attached, JSON.stringify(left))

  await page.keyboard.press('ArrowRight')
  check(`${label}: ArrowRight moves video to image`, (await counter(page)) === '4 of 4' &&
    (await page.evaluate(() => window.__b.paused && document.querySelector('dialog.kui-lightbox figure img') !== null)))

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  const back = await page.evaluate((at) => {
    const video = document.querySelector('dialog.kui-lightbox figure video')
    return { same: video === window.__a, from: video.currentTime, resumed: video.currentTime >= at - 0.05 }
  }, left.at)
  check(`${label}: returning to a video resumes the same player where it paused`, back.same && back.resumed, JSON.stringify(back))
  check(`${label}: and it plays again`, await playing(page, '__a'))

  if (label === 'phone') {
    const fit = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      const boxes = ['.kui-lightbox-prev', '.kui-lightbox-next', '.kui-lightbox-close', '.kui-lightbox-frame']
        .map((sel) => document.querySelector(sel).getBoundingClientRect())
      return { fits: boxes.every((box) => box.left >= 0 && box.right <= width + 0.5), width, scroll: document.documentElement.scrollWidth }
    })
    check('phone: the frame and the controls fit the screen', fit.fits && fit.scroll <= fit.width, JSON.stringify(fit))
  }

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog.kui-lightbox').open)
  const stopped = await page.evaluate(() => [window.__a, window.__b].every((video) => video.paused && !video.hasAttribute('src')))
  check(`${label}: closing stops every player the gallery kept`, stopped)
}

/**
 * A touch drag through the compositor, as `swipe-y-touch.test.mjs` does, in five moves. CDP paces
 * each move at 15-60ms, so a ten-move 135px drag lands near the recogniser's 300px/s floor and
 * passed or failed by scheduling; five moves over 300px is unambiguously a flick.
 */
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page)
  const at = (t) => [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) })
  for (let step = 1; step <= 5; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step / 5) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await page.waitForTimeout(300)
}

/**
 * Swipe between items on a phone. The gallery listens on its whole box, so a flick on the empty
 * space above the media counts; a flick that starts on a native player does not, because that is
 * the player's timeline being scrubbed.
 */
async function checkSwipe(browser, check) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.querySelector('#row img[role]') === null)
  await page.tap('#row a >> nth=0')
  await page.waitForSelector('dialog.kui-lightbox.is-open')
  await page.waitForTimeout(400)

  const action = await page.evaluate(() => getComputedStyle(document.querySelector('.kui-lightbox-gallery')).touchAction)
  check('swipe: the gallery hands the browser vertical pans only', action === 'pan-y pinch-zoom', action)

  // Above the picture: the gallery's own space, not the media.
  const space = { x: 345, y: 90 }
  const left = { x: 45, y: 90 }
  await touchDrag(page, space, left)
  check('swipe: a flick left shows the next item', (await counter(page)) === '2 of 4', await counter(page))
  await touchDrag(page, left, space)
  check('swipe: a flick right shows the previous one', (await counter(page)) === '1 of 4', await counter(page))
  await touchDrag(page, left, space)
  check('swipe: loop: wraps a flick right from the first item to the last', (await counter(page)) === '4 of 4', await counter(page))
  await touchDrag(page, { x: 195, y: 600 }, { x: 195, y: 200 })
  check('swipe: a vertical flick is not a step', (await counter(page)) === '4 of 4', await counter(page))

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  const player = await page.evaluate(() => {
    const box = document.querySelector('dialog.kui-lightbox figure video').getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.bottom - 12 }
  })
  await touchDrag(page, { x: player.x - 150, y: player.y }, { x: player.x + 150, y: player.y })
  check('swipe: a sideways drag along the native player stays with the player', (await counter(page)) === '2 of 4', await counter(page))
  await context.close()
}

/**
 * On a short screen every item fits: the media shrinks to what the caption and the counter leave,
 * keeping its aspect ratio, and nothing scrolls. 1440×723 is the size that cut a video off.
 */
async function checkShortScreen(browser, check) {
  for (const viewport of [{ width: 1440, height: 723 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(FIXTURE_URL)
    await page.waitForFunction(() => window.__kui !== undefined && document.querySelector('#row img[role]') === null)
    await page.click('#row a >> nth=0')
    await page.waitForSelector('dialog.kui-lightbox.is-open')
    for (let item = 0; item < 4; item += 1) {
      await page.waitForFunction(() => {
        const media = document.querySelector('dialog.kui-lightbox figure > img, dialog.kui-lightbox .kui-lightbox-frame video')
        return media && (media.localName === 'video' ? media.readyState > 0 : media.complete && media.naturalWidth > 0)
      })
      await page.waitForTimeout(350)
      const fit = await page.evaluate(() => {
        const media = document.querySelector('dialog.kui-lightbox figure > img, dialog.kui-lightbox .kui-lightbox-frame video')
        const box = media.getBoundingClientRect()
        const counterBox = document.querySelector('.kui-lightbox-counter').getBoundingClientRect()
        const caption = document.querySelector('dialog.kui-lightbox figcaption')
        const lowest = Math.max(counterBox.bottom, caption.hidden ? 0 : caption.getBoundingClientRect().bottom)
        const natural = media.localName === 'video' ? 16 / 9 : media.naturalWidth / media.naturalHeight
        return { item: document.querySelector('.kui-lightbox-counter').textContent, kind: media.localName, tall: media.classList.contains('is-tall'),
          top: Math.round(box.top), bottom: Math.round(lowest), height: innerHeight,
          ratio: +(box.width / box.height).toFixed(3), natural: +natural.toFixed(3),
          scrolls: document.querySelector('dialog.kui-lightbox').scrollHeight > innerHeight + 1 }
      })
      // A picture taller than 3:2 portrait (`is-tall`, the fixture's last) is read by scrolling, by
      // design; it must start at the top, where the scroll does reach it.
      if (fit.tall) check(`short screen ${viewport.width}x${viewport.height}, ${fit.item}: a tall picture scrolls from its top edge`,
        fit.top >= 0 && fit.scrolls, JSON.stringify(fit))
      else check(`short screen ${viewport.width}x${viewport.height}, ${fit.item} (${fit.kind}): media, caption and counter all on screen`,
        fit.top >= 0 && fit.bottom <= fit.height && !fit.scrolls, JSON.stringify(fit))
      check(`short screen ${viewport.width}x${viewport.height}, ${fit.item} (${fit.kind}): keeps its aspect ratio`,
        Math.abs(fit.ratio - fit.natural) < 0.02, JSON.stringify(fit))
      await page.keyboard.press('ArrowRight')
    }
    await context.close()
  }
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(FIXTURE_URL)
    await page.waitForFunction(() => window.__kui !== undefined && document.querySelector('#row img[role]') === null)
    await checkCycle(page, check, label)
    await context.close()
  }
  await checkShortScreen(browser, check)
  await checkSwipe(browser, check)
  return results
}
