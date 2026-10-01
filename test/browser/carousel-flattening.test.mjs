import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * Which `overflow` actually flattens a `carousel-3d` ring, in a real renderer.
 *
 * jsdom has no 3D rendering, so the unit tier can only say which computed values the diagnostic
 * reads. This says what the compositor does with them: a grouping property flattens the element
 * that carries `preserve-3d` — the ring's own host — and not an ancestor above it, because the host
 * establishes its own 3D context. The probe is hit-testing along the ring's centre line: in 3D the
 * browser depth-sorts and the front card (`0`) is whole; flattened, cards paint in DOM order and
 * its neighbours, later in the DOM, cover its edges.
 */
export const name = 'carousel-flattening'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/carousel-flattening.html', import.meta.url))}`

export async function run({ browser }) {
  const { check, results } = createChecker()
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined &&
    ['clip-band', 'hidden-band', 'clipped-host'].every((id) => document.getElementById(id).hasAttribute('data-kui-step')))
  await page.waitForTimeout(400)

  // How much of the centre line the front card owns. The ring is tight enough (radius 120px, cards
  // 160px wide) that its ±45° neighbours cross it: in 3D they intersect it and it keeps its middle
  // (~124px); flattened, they come later in DOM order and paint over both of its sides (~60px).
  const front = await page.evaluate(() => Object.fromEntries(['clip-band', 'hidden-band', 'clipped-host'].map((id) => {
    const host = document.getElementById(id)
    const box = host.getBoundingClientRect()
    let owned = 0
    for (let x = box.left; x <= box.right; x += 4) {
      if (document.elementFromPoint(x, box.top + box.height / 2)?.closest('.card')?.textContent === '0') owned += 4
    }
    return [id, owned]
  })))
  check('a ring under an overflow: clip band is depth-sorted: the front card owns the middle', front['clip-band'] >= 100, JSON.stringify(front))
  check('a ring under an overflow: hidden ancestor is depth-sorted the same', front['hidden-band'] === front['clip-band'], JSON.stringify(front))
  check('overflow: clip on the ring host itself flattens it: later cards paint over the front one',
    front['clipped-host'] < front['clip-band'] - 40, JSON.stringify(front))

  const flattening = await page.evaluate(() => window.__warnings.filter((message) => message.includes('flattens')))
  check('exactly one flattening warning, for the host that is actually flat',
    flattening.length === 1 && flattening[0].includes('overflow: clip') && flattening[0].includes("ring's own"), JSON.stringify(flattening))

  await context.close()
  return results
}
