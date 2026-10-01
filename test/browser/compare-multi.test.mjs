import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * `compare` with four media, dragged by a real mouse in a real renderer.
 *
 * `test/showcase-compare-multi.test.ts` covers the arithmetic with a stubbed box and synthetic
 * events. What only a browser can say: that the transparent surface really is what the pointer
 * lands on, that the inline clip-paths really paint the strips in order, and that a drag on one
 * divider moves that divider alone and stops at its neighbours.
 *
 * Which medium paints at a point is read with `elementsFromPoint`: Chromium's hit testing honours
 * `clip-path`, so the first `img` in the stack is the one visible there. The fixture's media are
 * flat colours named by their `alt`, so a failure prints a colour, not an index.
 *
 * `#pair` is the control: the two-media slider keeps its one native range, and a drag on it still
 * moves `--kui-compare` on the host.
 */
export const name = 'compare-multi'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/compare-multi.html', import.meta.url))}`

/** The `alt` of the medium painted at each fraction across `#four`, and every divider's value. */
function read(page, fractions) {
  return page.evaluate((across) => {
    const host = document.getElementById('four')
    const box = host.getBoundingClientRect()
    const y = box.top + box.height / 2
    const strips = across.map((f) => {
      const hit = document.elementsFromPoint(box.left + box.width * f, y).find((node) => node.localName === 'img')
      return hit ? hit.alt : null
    })
    const values = [...host.querySelectorAll('.kui-compare-range')].map((range) => Number(range.value))
    return { strips, values }
  }, fractions)
}

/** Press at `from`, move to `to` in steps, release — fractions of `#four`'s width. */
async function drag(page, from, to) {
  const box = await page.locator('#four').boundingBox()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, y, { steps: 8 })
  await page.mouse.up()
}

async function checkFour(page, check, label) {
  const quarters = [0.125, 0.375, 0.625, 0.875]
  let m = await read(page, quarters)
  check(`${label}: four strips paint in order at an even split`,
    JSON.stringify(m.strips) === JSON.stringify(['Black', 'White', 'Blue', 'Pink']) &&
      JSON.stringify(m.values) === JSON.stringify([25, 50, 75]), JSON.stringify(m))
  const surfaceOnTop = await page.evaluate(() => {
    const box = document.getElementById('four').getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.className
  })
  check(`${label}: the pointer lands on the surface`, surfaceOnTop === 'kui-compare-surface', String(surfaceOnTop))

  await drag(page, 0.5, 0.6)
  m = await read(page, [0.125, 0.55, 0.7, 0.875])
  check(`${label}: dragging divider 2 moves divider 2 only`,
    m.values[0] === 25 && Math.abs(m.values[1] - 60) <= 1 && m.values[2] === 75, JSON.stringify(m))
  check(`${label}: the strip it uncovered now shows its left neighbour`,
    JSON.stringify(m.strips) === JSON.stringify(['Black', 'White', 'Blue', 'Pink']), JSON.stringify(m))

  await drag(page, 0.6, 0.95)
  m = await read(page, [0.7, 0.8])
  check(`${label}: divider 2 stops at divider 3`, JSON.stringify(m.values) === JSON.stringify([25, 75, 75]), JSON.stringify(m))
  check(`${label}: with the blue strip closed, white meets pink`,
    JSON.stringify(m.strips) === JSON.stringify(['White', 'Pink']), JSON.stringify(m))

  // Where two dividers meet, a press just left of the point takes the earlier one.
  await drag(page, 0.74, 0.02)
  m = await read(page, [0.125])
  check(`${label}: divider 2 stops at divider 1 going left`, JSON.stringify(m.values) === JSON.stringify([25, 25, 75]), JSON.stringify(m))
}

async function checkKeyboard(page, check, label) {
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  check(`${label}: tab order reaches divider 2 second`, focused === 'Divider 2 of 3: White / Blue', String(focused))
  await page.keyboard.press('End')
  const m = await read(page, [])
  check(`${label}: End takes divider 2 to its neighbour, not the edge`, m.values[1] === m.values[2], JSON.stringify(m))
}

async function checkPair(page, check, label) {
  const box = await page.locator('#pair').boundingBox()
  await page.locator('#pair').scrollIntoViewIfNeeded()
  const fresh = await page.locator('#pair').boundingBox()
  const y = fresh.y + fresh.height / 2
  await page.mouse.move(fresh.x + fresh.width * 0.5, y)
  await page.mouse.down()
  await page.mouse.move(fresh.x + fresh.width * 0.3, y, { steps: 8 })
  await page.mouse.up()
  const value = await page.$eval('#pair', (host) => parseFloat(host.style.getPropertyValue('--kui-compare')))
  check(`${label}: the two-media slider still drags with its native range`, Math.abs(value - 30) <= 3,
    JSON.stringify({ value, box }))
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(FIXTURE_URL)
    await page.waitForFunction(() => window.__kui !== undefined &&
      document.querySelectorAll('#four .kui-compare-range').length === 3 &&
      [...document.images].every((img) => img.complete))
    await page.locator('#four').scrollIntoViewIfNeeded()
    await checkFour(page, check, label)
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('#four .kui-compare-range').length === 3)
    await checkKeyboard(page, check, label)
    await checkPair(page, check, label)
    await context.close()
  }
  return results
}
