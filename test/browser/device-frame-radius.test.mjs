import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * `device-frame`'s screen follows its bezel: the child's corners are the outer radius less the
 * border and the thinner of the two bezels meeting there, as a circle (both axes equal), never
 * below the floor (the frame's own radius, up to 8px) — for every kind, with and without an authored `radius:`, and replaced outright by an
 * authored `screen-radius:`. `test/showcase-device-frame.test.ts` evaluates the same arithmetic from the
 * stylesheet's text; only a real renderer can say the cascade resolves it on the child and that
 * the rounded box actually clips an img, a video, an iframe, a picture's img and a div's content.
 *
 * Two readings per frame: the child's computed corner radii against the fixture's `data-expect`,
 * and `elementFromPoint` one pixel inside each rounded corner of the child's box, which must miss
 * the child (Chromium's hit testing honours border-radius and the overflow clip it rounds) while
 * its centre still hits it. `#square` (`radius:0px`) is the negative control: same probe, square
 * screen, so its corner must land on the screen — proof the probe can see a child at a corner.
 * Run at desktop and again at 390px.
 */
export const name = 'device-frame-radius'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/device-frame-radius.html', import.meta.url))}`

const FRAMES = [
  'phone-img', 'phone-video', 'tablet-iframe', 'laptop-picture', 'browser-div', 'browser-video', 'screen-radius', 'square',
]

function measure(page, id) {
  return page.evaluate((frameId) => {
    const host = document.getElementById(frameId)
    const child = host.firstElementChild
    const style = getComputedStyle(child)
    const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']
      .map((corner) => style[`border${corner}Radius`].split(' ').map(parseFloat))
    // A single value means a circular corner: horizontal and vertical are the same.
    const radii = [...corners.map(([h]) => h), ...corners.map(([h, v = h]) => v)]
    const box = child.getBoundingClientRect()
    const inside = (x, y) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && child.contains(hit)
    }
    const points = [
      [box.left + 1, box.top + 1],
      [box.right - 1, box.top + 1],
      [box.right - 1, box.bottom - 1],
      [box.left + 1, box.bottom - 1],
    ]
    return {
      radii: radii.map((r) => Math.round(r)),
      expect: host.dataset.expect.split(' ').map(Number),
      cornerHits: points.map(([x, y]) => inside(x, y)),
      centre: inside(box.left + box.width / 2, box.top + box.height / 2),
      height: box.height,
    }
  }, id)
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(FIXTURE_URL)
    await page.waitForFunction((count) => window.__kui !== undefined &&
      document.querySelectorAll('[data-kui-device]').length === count, FRAMES.length)
    for (const id of FRAMES) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded()
      const m = await measure(page, id)
      check(`${label} ${id}: the screen's corner radii follow the bezel`,
        JSON.stringify(m.radii) === JSON.stringify(m.expect), JSON.stringify(m))
      check(`${label} ${id}: the screen has a box and its centre is the screen`, m.height > 0 && m.centre, JSON.stringify(m))
      for (let corner = 0; corner < 4; corner += 1) {
        // Only a corner rounded on both axes by more than the 1px probe inset is cut.
        const cut = m.expect[corner] > 2 && m.expect[corner + 4] > 2
        check(`${label} ${id}: corner ${corner} is ${cut ? 'clipped off' : 'square'}`,
          m.cornerHits[corner] === !cut, JSON.stringify(m))
      }
    }
    await context.close()
  }
  return results
}
