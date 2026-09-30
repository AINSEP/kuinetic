import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * A mixed row (`lightbox media:mixed`) as one gallery, in a real renderer with real media. The unit
 * tests stub `play()`/`pause()` — jsdom implements neither — so only here can a test see a native
 * player actually play on landing, actually stop when left, and resume where it stopped rather than
 * restart. Checked at desktop and again at 390px, where the controls and the frame must fit.
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
  return results
}
