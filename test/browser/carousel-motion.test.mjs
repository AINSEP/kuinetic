import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * The spatial decks in a real renderer: `spin:` actually turning a ring frame by frame, the flat
 * ring (`carousel-orbit`) actually laid out on a circle with upright cards, the depth stack
 * (`carousel-stack`) actually receding and cycling, and a wrapped ring slot actually landing without
 * sweeping round.
 *
 * The unit tests (`carousel-spin`, `carousel-orbit-stack`, `carousel-css`) prove the published
 * numbers, the attributes and the stylesheet's text. None of them renders a frame, so none of them
 * can tell a `calc()` the browser accepted from one it discarded — `mod()`, `sin()`, `50cqi` and a
 * `calc()` in `z-index` all fail silently to their initial values if unsupported or mistyped, and the
 * deck would sit flat in one cell with every unit test green. This suite reads what the browser
 * resolved.
 *
 * Checked at desktop width and again at 390px, where the orbit must shrink to fit rather than push
 * the page sideways.
 */
export const name = 'carousel-motion'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/carousel-motion.html', import.meta.url))}`

const settle = (page, ms) => page.waitForTimeout(ms)

/** Centre of each element's rendered box, and its transform, for every node matching `selector`. */
function boxes(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      transform: style.transform,
      opacity: Number(style.opacity),
      filter: style.filter,
      visibility: style.visibility,
      zIndex: style.zIndex,
    }
  }), selector)
}

async function hostBox(page, id) {
  return page.evaluate((hostId) => {
    const rect = document.getElementById(hostId).getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height }
  }, id)
}

const position = (page, id) =>
  page.evaluate((hostId) => Number(document.getElementById(hostId).style.getPropertyValue('--kui-step-position')), id)

async function checkSpin(page, check) {
  await page.evaluate(() => document.getElementById('ring').scrollIntoView({ block: 'center' }))
  await settle(page, 300)
  const spinning = await page.evaluate(() => document.getElementById('ring').getAttribute('data-kui-ring-spinning'))
  check('ring with spin: reports frames driving it', spinning === 'true', `data-kui-ring-spinning=${spinning}`)
  const before = await boxes(page, '#ring .slide')
  const p0 = await position(page, 'ring')
  await settle(page, 400)
  const p1 = await position(page, 'ring')
  const after = await boxes(page, '#ring .slide')
  // 6 slides at 4s a cycle: 0.4s is 0.6 of a place. Generous bounds — this is "it moves, forwards,
  // at roughly the authored rate", not a frame-timing benchmark.
  const moved = ((p1 - p0) + 6) % 6
  check('spin: advances the ring forward at about the authored rate', moved > 0.2 && moved < 1.2, `moved ${moved.toFixed(3)} places in 400ms`)
  const changed = before.filter((box, index) => box.transform !== after[index].transform).length
  check('spin: moves the rendered slots, not only the published number', changed === before.length, `${changed}/${before.length} slot transforms changed`)
}

async function checkOrbit(page, check, label) {
  await page.evaluate(() => document.getElementById('orbit').scrollIntoView({ block: 'center' }))
  await settle(page, 200)
  const host = await hostBox(page, 'orbit')
  const cards = await boxes(page, '#orbit .card')
  const word = (await boxes(page, '#orbit .word'))[0]
  const radii = cards.map((card) => Math.hypot(card.x - host.x, card.y - host.y))
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  const spread = Math.max(...radii) - Math.min(...radii)
  check(`${label}: orbit cards sit on one circle around the host centre`, mean > 40 && spread < 2, `mean radius ${mean.toFixed(1)}, spread ${spread.toFixed(2)}`)
  check(`${label}: the word stays centred`, Math.hypot(word.x - host.x, word.y - host.y) < 2, `word at ${word.x.toFixed(1)},${word.y.toFixed(1)}; host ${host.x.toFixed(1)},${host.y.toFixed(1)}`)
  const upright = cards.every((card) => {
    const m = /matrix\(([^)]+)\)/.exec(card.transform)
    if (!m) return false
    const [a, b] = m[1].split(',').map(Number)
    return Math.abs(a - 1) < 1e-3 && Math.abs(b) < 1e-3
  })
  check(`${label}: facing:camera keeps every orbit card upright`, upright, cards.map((card) => card.transform).join(' | ').slice(0, 200))
  check(`${label}: the orbit host reserves a square for its circle`, Math.abs(host.width - host.height) < 2, `${host.width.toFixed(1)}x${host.height.toFixed(1)}`)
  const inside = cards.every((card) => card.x - 45 >= -1 && card.x + 45 <= page.viewportSize().width + 1)
  check(`${label}: every orbit card is inside the viewport horizontally`, inside, cards.map((card) => card.x.toFixed(0)).join(','))
  const p0 = await position(page, 'orbit')
  await settle(page, 300)
  const p1 = await position(page, 'orbit')
  const moved = ((p0 - p1) + 8) % 8
  check(`${label}: negative spin: turns the orbit backwards`, moved > 0.1 && moved < 2, `moved back ${moved.toFixed(3)} places`)
}

async function checkStack(page, check, snap, label) {
  await page.evaluate(() => document.getElementById('stack').scrollIntoView({ block: 'center' }))
  await settle(page, 200)
  const cards = await boxes(page, '#stack .deck')
  const [front, second, third] = cards
  check(`${label}: the front card is sharp and opaque`, front.opacity === 1 && front.filter.includes('blur(0px)'), `opacity=${front.opacity}, filter=${front.filter}`)
  check(
    `${label}: each card behind steps up, to the right, and smaller`,
    second.x > front.x && second.y < front.y && second.width < front.width && third.x > second.x && third.width < second.width,
    `front ${front.x.toFixed(0)},${front.y.toFixed(0)} w${front.width.toFixed(0)}; second ${second.x.toFixed(0)},${second.y.toFixed(0)} w${second.width.toFixed(0)}`,
  )
  check(`${label}: cards behind are blurred and fainter`, second.opacity < 1 && !second.filter.includes('blur(0px)'), `opacity=${second.opacity}, filter=${second.filter}`)
  check(`${label}: the front card paints above the ones behind`, Number(front.zIndex) > Number(second.zIndex), `z ${front.zIndex} vs ${second.zIndex}`)
  check(`${label}: cards past the depth, and the one in front, are hidden`, cards[4].visibility === 'hidden' && cards[5].visibility === 'hidden', `${cards[4].visibility}, ${cards[5].visibility}`)
  if (snap) await snap(page, `${label}-stack-at-rest`)

  await page.evaluate(() => document.querySelector('#stack .stack-next').click())
  await settle(page, 900)
  const after = await boxes(page, '#stack .deck')
  check(`${label}: next sends the front card out and brings the second forward`, after[0].opacity === 0 && after[1].opacity === 1, `old front opacity ${after[0].opacity}, new front ${after[1].opacity}`)
  check(`${label}: the card that left is hidden once its fade has finished`, after[0].visibility === 'hidden', after[0].visibility)
  if (snap) await snap(page, `${label}-stack-after-next`)
}

async function checkWrap(page, check) {
  await page.evaluate(() => document.getElementById('stepper').scrollIntoView({ block: 'center' }))
  await settle(page, 200)
  // Which slot wraps on the next step: the one with the most negative circular offset.
  const wrapIndex = await page.evaluate(() => {
    const slides = [...document.querySelectorAll('#stepper .slide')]
    const offsets = slides.map((slide) => Number(slide.getAttribute('data-kui-step-offset')))
    return offsets.indexOf(Math.min(...offsets))
  })
  const running = await page.evaluate((index) => {
    document.querySelector('#stepper .ring-next').click()
    const slides = [...document.querySelectorAll('#stepper .slide')]
    // Read synchronously after the click's style change: transitions have been created (or not).
    getComputedStyle(slides[0]).transform
    return slides.map((slide) => slide.getAnimations().length)
  }, wrapIndex)
  const others = running.filter((_, index) => index !== wrapIndex)
  check('a step transitions every ring slot but the one whose offset wrapped', running[wrapIndex] === 0 && others.every((count) => count > 0), `animations per slot: ${running.join(',')}, wrapped slot ${wrapIndex}`)
}

const INSIDE_ROWS = ['inside-spin', 'band-a', 'band-b', 'band-c']
/** Pixels dragged left, and the default `travel:` — the ring should follow by their ratio. */
const DRAG_PX = 150
const TRAVEL_PX = 220

/** Signed places between two positions on a ring of `count`, the short way round. */
function placesMoved(from, to, count) {
  const raw = (((to - from) % count) + count) % count
  return raw > count / 2 ? raw - count : raw
}

/**
 * Press on an inside ring's centre, drag left in many small moves, and report where the ring was
 * mid-drag. `input` does the pointer work: a real mouse, or CDP touches on a touch context.
 */
async function dragInside(page, id, input) {
  await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
  await settle(page, 200)
  const host = await hostBox(page, id)
  const count = await page.evaluate((hostId) => document.querySelectorAll(`#${hostId} .ring-slot`).length, id)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-kui-fx]')?.id ?? null, host)
  const readMid = async () => ({
    position: await position(page, id),
    dragging: await page.evaluate((hostId) => document.getElementById(hostId).getAttribute('data-kui-ring-dragging'), id),
  })
  const { before, mid } = await input(page, host, readMid, () => position(page, id))
  // Read at once: the release publishes the snapped place synchronously, and a spinning ring is
  // only held there for its settle period before the spin carries it on (a touch leaves no hover).
  const settled = await position(page, id)
  await settle(page, 900)
  return { hit, count, before, mid, settled }
}

const mouseDrag = async (page, host, readMid, readPosition) => {
  await page.mouse.move(host.x, host.y)
  await settle(page, 50)
  const before = await readPosition()
  await page.mouse.down()
  await page.mouse.move(host.x - DRAG_PX, host.y, { steps: 15 })
  const mid = await readMid()
  await page.mouse.up()
  return { before, mid }
}

const touchDrag = async (page, host, readMid, readPosition) => {
  const cdp = await page.context().newCDPSession(page)
  const at = (x) => [{ x, y: host.y, id: 1 }]
  const before = await readPosition()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(host.x) })
  for (let step = 1; step <= 15; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(host.x - (DRAG_PX * step) / 15) })
  }
  const mid = await readMid()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  return { before, mid }
}

async function checkInsideDrag(page, check, label, input) {
  const expected = DRAG_PX / TRAVEL_PX
  for (const id of INSIDE_ROWS) {
    const { hit, count, before, mid, settled } = await dragInside(page, id, input)
    const moved = placesMoved(before, mid.position, count)
    check(`${label}: a press on ${id}'s centre lands on that ring`, hit === id, `hit ${hit}`)
    check(
      `${label}: dragging ${id} follows the pointer`,
      mid.dragging === 'true' && Math.abs(moved - expected) < 0.25,
      `dragging=${mid.dragging}, moved ${moved.toFixed(3)} places for ${DRAG_PX}px (expected ~${expected.toFixed(2)})`,
    )
    check(`${label}: ${id} settles on a whole place after the drag`, Math.abs(settled - Math.round(settled)) < 1e-3, `settled at ${settled}`)
  }
}

/** After a drag on the spinning inside ring, the spin resumes from where the drag left it. */
async function checkResumeAfterDrag(page, check) {
  const { settled } = await dragInside(page, 'inside-spin', mouseDrag)
  await page.mouse.move(5, 5)
  // The settle hold (the ring's own transition duration) has passed by now: frames are driving it.
  await settle(page, 900)
  const spinning = await page.evaluate(() => document.getElementById('inside-spin').getAttribute('data-kui-ring-spinning'))
  const resumed = await position(page, 'inside-spin')
  // 8 slides at 20s a cycle is 0.4 places a second; ~1s of spin is well under one place. A snap back
  // to where the spin "would have been" would be a different number entirely.
  const drift = placesMoved(settled, resumed, 8)
  check('spin resumes after a drag, from where the drag left the ring', spinning === 'true' && drift > 0 && drift < 1, `spinning=${spinning}, drift ${drift.toFixed(3)} places from ${settled}`)
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await desktop.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('ring').hasAttribute('data-kui-step'))
  await checkSpin(page, check)
  await checkOrbit(page, check, 'desktop')
  await snap(page, 'desktop-orbit')
  await checkStack(page, check, snap, 'desktop')
  await checkWrap(page, check)
  await checkInsideDrag(page, check, 'mouse', mouseDrag)
  await checkResumeAfterDrag(page, check)
  await desktop.close()

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const touchPage = await touch.newPage()
  await touchPage.goto(FIXTURE_URL)
  await touchPage.waitForFunction(() => window.__kui !== undefined && document.getElementById('band-a').hasAttribute('data-kui-step'))
  await checkInsideDrag(touchPage, check, 'touch', touchDrag)
  await touch.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobile = await phone.newPage()
  await mobile.goto(FIXTURE_URL)
  await mobile.waitForFunction(() => window.__kui !== undefined && document.getElementById('orbit').hasAttribute('data-kui-step'))
  await checkOrbit(mobile, check, 'phone')
  await snap(mobile, 'phone-orbit')
  await checkStack(mobile, check, null, 'phone')
  // Scoped to the two new decks. The depth rings (#ring, #stepper) author `radius:200px`, and a
  // depth ring honours an authored radius at any width — that pre-dates this suite and is not what
  // it checks — so a page-wide `scrollWidth` would fail on them, not on the orbit or the stack.
  // Right edge only, as `scrollWidth` measures: the card that just left the stack exits down and to the left,
  // past x=0 while hidden, which clips rather than scrolls.
  const spill = await mobile.evaluate(() => [...document.querySelectorAll('#orbit *, #stack *')]
    .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 0.5)
    .map((node) => `${node.parentElement.id}>${node.className}:${node.textContent.trim().slice(0, 8)}`))
  check('phone: neither the orbit nor the stack pushes the page sideways', spill.length === 0, spill.join(', ') || 'none')
  await phone.close()

  return results
}
