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
  // Negative: from inside a ring the next card sits to the LEFT, so a leftward drag that the cards
  // follow walks the deck backwards. This asserted `+` until 2026-09-30, which pinned the bug
  // (cards moving against the hand); `deck-drag-direction.test.mjs` checks the cards themselves.
  const expected = -DRAG_PX / TRAVEL_PX
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

/**
 * A real mouse drag across a deck's text selects nothing, during the drag or after it, and gives the
 * page its selection back on release. jsdom cannot perform a native selection gesture, so this is
 * the only place the blue highlight could be seen.
 */
async function checkNoSelection(page, check, id) {
  await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
  await settle(page, 200)
  const host = await hostBox(page, id)
  const read = () => page.evaluate(() => ({
    selected: document.getSelection().toString(),
    userSelect: getComputedStyle(document.documentElement).userSelect,
  }))
  await page.mouse.move(host.x - host.width / 4, host.y)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width / 4, host.y + 20, { steps: 20 })
  const mid = await read()
  await page.mouse.up()
  await settle(page, 100)
  const after = await read()
  check(`mouse: dragging ${id} selects no text`, mid.selected === '' && after.selected === '',
    `mid ${JSON.stringify(mid.selected)}, after ${JSON.stringify(after.selected)}`)
  check(`mouse: ${id} gives the page its text selection back on release`,
    mid.userSelect === 'none' && after.userSelect === 'auto', `mid ${mid.userSelect}, after ${after.userSelect}`)
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

/**
 * The rings nothing clips: a depth ring fits its page by itself (`effects/carousel/fit.ts`), so these
 * must stay inside the viewport at every width. The band rows are not here on purpose — they sit in
 * `.ring-band { overflow: clip }`, an author-declared bleed, and a clipping ancestor opts a ring out.
 */
const UNCLIPPED_RINGS = ['ring', 'stepper', 'inside-spin']
const BAND_ROWS = ['band-a', 'band-b', 'band-c']

/** Every slot's resolved radius — the length of its placement translation — and its slot width. */
function radii(page, id) {
  return page.evaluate((hostId) => [...document.querySelectorAll(`#${hostId} [data-kui-step-offset]`)].map((slot) => {
    const m = new DOMMatrix(getComputedStyle(slot).transform)
    return { radius: Math.hypot(m.m41, m.m42, m.m43), width: slot.offsetWidth }
  }), id)
}

/** The radius a band row wants: the tangent rule for 9 cards over 180deg, a 24px gap, no fit. */
const bandWanted = (width) => (width + 24) / (2 * Math.tan((10 * Math.PI) / 180))
/** `#inside-spin`: 8 cards over the concave name's default 120deg arc, the default 24px gap. */
const insideWanted = (width) => (width + 24) / (2 * Math.tan((7.5 * Math.PI) / 180))

/**
 * The band rows sit under `overflow: clip`, which opts them out of the fit: they keep the radius
 * they want at every width, including a phone's, where they bleed past the band and are clipped.
 * Deliberate — the author declared that bleed by clipping — and the showcase's band relies on it.
 */
async function checkBandsUnfitted(page, check, label) {
  for (const id of BAND_ROWS) {
    const slots = await radii(page, id)
    const wanted = bandWanted(slots[0].width)
    const ok = slots.every((slot) => Math.abs(slot.radius - wanted) < 0.01)
    check(`${label}: clipped #${id} keeps the radius it wants`, ok, `${slots[0].radius.toFixed(2)} vs wanted ${wanted.toFixed(2)}`)
  }
}

/**
 * The radius each ring resolved to. Where a ring already fits, `min(wanted, fit)` must hand it its
 * own radius to the pixel; the band rows are clipped, so they get no fit at any width.
 */
async function checkRadii(page, check, label) {
  for (const id of ['ring', 'stepper']) {
    const slots = await radii(page, id)
    const ok = slots.every((slot) => Math.abs(slot.radius - 200) < 0.01)
    check(`${label}: #${id} keeps its authored radius:200px`, ok, slots.map((slot) => slot.radius.toFixed(2)).join(','))
  }
  await checkBandsUnfitted(page, check, label)
  const inside = await radii(page, 'inside-spin')
  const wanted = insideWanted(inside[0].width)
  check(`${label}: #inside-spin never exceeds the radius it wants`, inside.every((slot) => slot.radius <= wanted + 0.01), `${inside[0].radius.toFixed(2)} vs wanted ${wanted.toFixed(2)}`)
}

/**
 * Sweep every unclipped ring through a whole place of drift, synchronously in one evaluate so no
 * spin frame or transition lands between the write and the read, and report each ring's widest
 * extent. `data-kui-ring-spinning` turns the slot transition off, as the spin does. A concave card
 * turned past a quarter from the camera is `visibility: hidden` in the real deck (the attribute
 * that says so is not re-published mid-sweep), so it is skipped by its placement: behind the viewer
 * is a positive Z after `translateZ(-r)`.
 */
function driftSweep(page) {
  return page.evaluate((ids) => ids.map((id) => {
    const host = document.getElementById(id)
    const inside = host.matches('[data-kui-fx~="carousel-3d-inside"]')
    const step = Number(host.style.getPropertyValue('--kui-step')) || 0
    const savedPosition = host.style.getPropertyValue('--kui-step-position')
    const savedSpinning = host.getAttribute('data-kui-ring-spinning')
    host.setAttribute('data-kui-ring-spinning', 'true')
    let left = Infinity
    let right = -Infinity
    for (let d = -0.5; d <= 0.5 + 1e-9; d += 0.02) {
      host.style.setProperty('--kui-step-position', String(step + d))
      for (const slot of host.querySelectorAll('[data-kui-step-offset]')) {
        if (inside && new DOMMatrix(getComputedStyle(slot).transform).m43 >= 0) continue
        const rect = slot.getBoundingClientRect()
        left = Math.min(left, rect.left)
        right = Math.max(right, rect.right)
      }
    }
    host.style.setProperty('--kui-step-position', savedPosition)
    if (savedSpinning === null) host.removeAttribute('data-kui-ring-spinning')
    else host.setAttribute('data-kui-ring-spinning', savedSpinning)
    return { id, left, right, width: document.documentElement.clientWidth }
  }), UNCLIPPED_RINGS)
}

/** The unclipped rings whose fit binds: they resolved to less than the radius they want. */
async function boundRings(page) {
  const bound = []
  for (const id of UNCLIPPED_RINGS) {
    const [slot] = await radii(page, id)
    const wanted = id === 'inside-spin' ? insideWanted(slot.width) : 200
    if (slot.radius < wanted - 0.5) bound.push(id)
  }
  return bound
}

async function checkDriftSweep(page, check, label, tightIds = []) {
  const extents = await driftSweep(page)
  for (const { id, left, right, width } of extents) {
    check(`${label}: #${id} stays inside the page at every drift`, left >= -0.5 && right <= width + 0.5, `${left.toFixed(2)}..${right.toFixed(2)} of ${width}`)
    // Where the fit binds, it is the largest radius that fits: the widest card touches an edge.
    if (tightIds.includes(id)) check(`${label}: #${id}'s fitted radius is tight, not merely safe`, left <= 1 || right >= width - 1, `${left.toFixed(2)}..${right.toFixed(2)} of ${width}`)
  }
}

/** Unclipped ring slots, visible ones only, that reach past either edge of the viewport now. */
function outsideViewport(page) {
  return page.evaluate((ids) => {
    const width = document.documentElement.clientWidth
    return ids.flatMap((id) => [...document.querySelectorAll(`#${id} [data-kui-step-offset]`)]
      .filter((slot) => getComputedStyle(slot).visibility !== 'hidden')
      .map((slot) => ({ id, rect: slot.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < -0.5 || rect.right > width + 0.5)
      .map(({ id: host, rect }) => `${host} ${rect.left.toFixed(1)}..${rect.right.toFixed(1)}`))
  }, UNCLIPPED_RINGS)
}

/** Real motion at phone width: sample the spinning rings for ~1.5s and a mid-drag on `#stepper`. */
async function checkPhoneMotion(page, check, label) {
  const seen = new Set()
  for (const id of ['ring', 'inside-spin']) {
    await page.evaluate((hostId) => document.getElementById(hostId).scrollIntoView({ block: 'center' }), id)
    for (let sample = 0; sample < 15; sample += 1) {
      await settle(page, 100)
      for (const miss of await outsideViewport(page)) seen.add(miss)
    }
  }
  check(`${label}: spinning rings stay inside the viewport`, seen.size === 0, [...seen].slice(0, 6).join(', ') || 'none')

  await page.evaluate(() => document.getElementById('stepper').scrollIntoView({ block: 'center' }))
  await settle(page, 200)
  const host = await hostBox(page, 'stepper')
  await page.mouse.move(host.x, host.y)
  await page.mouse.down()
  await page.mouse.move(host.x - 110, host.y, { steps: 10 })
  const dragging = await page.evaluate(() => document.getElementById('stepper').getAttribute('data-kui-ring-dragging'))
  const midDrag = await outsideViewport(page)
  await page.mouse.up()
  await settle(page, 700)
  check(`${label}: #stepper mid-drag stays inside the viewport`, dragging === 'true' && midDrag.length === 0, `dragging=${dragging}; ${midDrag.join(', ') || 'none'}`)
}

async function checkNoSideScroll(page, check, label) {
  const { scrollWidth, clientWidth, past } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      // Named in the failure: which element reaches past the right edge, and to where.
      past: [...document.body.querySelectorAll('*')]
        .filter((node) => node.getBoundingClientRect().right > width + 0.5)
        .map((node) => `${node.closest('[id]')?.id ?? '?'}>${node.textContent.trim().slice(0, 6)}@${node.getBoundingClientRect().right.toFixed(0)}`),
    }
  })
  check(`${label}: nothing on the page pushes it sideways`, scrollWidth <= clientWidth, `scrollWidth ${scrollWidth}, clientWidth ${clientWidth}; ${past.slice(0, 6).join(', ') || 'nothing past the edge'}`)
}

async function openFixture(browser, options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined && document.getElementById('band-c').hasAttribute('data-kui-step'))
  // The fit is solved on a resize observation and published on the next frame; the slots' first
  // placement is a 620ms transition from `none`, and a radius read mid-flight is short of its end.
  await settle(page, 1000)
  return { context, page }
}

/**
 * Wide screens: every ring that already fits keeps its radius to the pixel, and no unclipped ring
 * reaches past the page at any drift. Not a page `scrollWidth` check here: at 1440px Chromium
 * reports `#inside-spin`'s scrollable overflow ending at 1454px while its widest painted card ends
 * at 1259px — an open finding, not yet explained. The painted extent is what the fit promises.
 */
async function checkRingFitAt(browser, check, width) {
  const { context, page } = await openFixture(browser, { viewport: { width, height: 900 } })
  const label = `${width}px`
  await checkRadii(page, check, label)
  await checkDriftSweep(page, check, label)
  await context.close()
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
  await checkNoSelection(page, check, 'band-a')
  await checkNoSelection(page, check, 'stack')
  await desktop.close()

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const touchPage = await touch.newPage()
  await touchPage.goto(FIXTURE_URL)
  await touchPage.waitForFunction(() => window.__kui !== undefined && document.getElementById('band-a').hasAttribute('data-kui-step'))
  await checkInsideDrag(touchPage, check, 'touch', touchDrag)
  await touch.close()

  for (const width of [1440, 820]) await checkRingFitAt(browser, check, width)

  const fitTouch = await openFixture(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await checkNoSideScroll(fitTouch.page, check, 'touch 390px')
  await checkPhoneMotion(fitTouch.page, check, 'touch 390px')
  await fitTouch.context.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobile = await phone.newPage()
  await mobile.goto(FIXTURE_URL)
  await mobile.waitForFunction(() => window.__kui !== undefined && document.getElementById('orbit').hasAttribute('data-kui-step'))
  await checkOrbit(mobile, check, 'phone')
  await snap(mobile, 'phone-orbit')
  await checkStack(mobile, check, null, 'phone')
  // Page-wide: the depth rings authoring `radius:200px` (#ring, #stepper) and the wide concave ring
  // fit a phone by themselves now, so nothing on the page may push it sideways. `scrollWidth` looks
  // at the right edge only, which is right: the card that just left the stack exits down and to the
  // left, past x=0 while hidden, and that clips rather than scrolls.
  await checkNoSideScroll(mobile, check, 'phone')
  const bound = await boundRings(mobile)
  check('phone: the unclipped rings that overflow a phone are fitted', bound.length === UNCLIPPED_RINGS.length, `fitted: ${bound.join(', ') || 'none'}`)
  await checkDriftSweep(mobile, check, 'phone', bound)
  await checkBandsUnfitted(mobile, check, 'phone')
  await checkPhoneMotion(mobile, check, 'phone')
  await phone.close()

  return results
}
