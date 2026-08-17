import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Post-`destroy()` cleanliness.
 *
 * `Animator.reset(el)` is the public per-element teardown (`Animator.destroy()` calls it across
 * the whole tree). Neither has a real-browser check today: the unit suite can assert a ledger's
 * *internal* bookkeeping, but not what a consumer actually observes afterward. This suite installs
 * `magnetic` (a `window`-level `pointermove` listener) and `draggable` (element-level pointer
 * listeners), interacts with both — leaving `draggable` mid-gesture, pointer still down, to stress
 * teardown during an active drag rather than only a settled one — then calls `reset()` and checks
 * what is externally observable: no lingering inline styles, no lingering `data-kui-*`
 * attributes, and no lingering event listeners.
 *
 * Listener accounting is done by wrapping `EventTarget.prototype.addEventListener` /
 * `removeEventListener` before the library loads, rather than trusting the DOM to report "no
 * listeners" some other way — there is no standard API that lists an element's own listeners, so
 * counting attach/detach calls is the only externally observable proxy.
 */
export const name = 'destroy-cleanup'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/destroy-cleanup.html', import.meta.url))}`

const COUNT_LISTENERS = () => {
  window.__listenerCounts = {}
  const keyOf = (target, type) => `${target === window ? 'window' : target.id || target.tagName}:${type}`
  const originalAdd = EventTarget.prototype.addEventListener
  const originalRemove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function counted(type, listener, options) {
    const k = keyOf(this, type)
    window.__listenerCounts[k] = (window.__listenerCounts[k] ?? 0) + 1
    return originalAdd.call(this, type, listener, options)
  }
  EventTarget.prototype.removeEventListener = function counted(type, listener, options) {
    const k = keyOf(this, type)
    window.__listenerCounts[k] = (window.__listenerCounts[k] ?? 0) - 1
    return originalRemove.call(this, type, listener, options)
  }
}

async function listenerCounts(page) {
  return page.evaluate(() => window.__listenerCounts)
}

async function readCleanupState(page, id) {
  return page.$eval(id, (el) => ({
    style: el.getAttribute('style'),
    kuiAttributes: el
      .getAttributeNames()
      .filter((n) => n.startsWith('data-kui'))
      .filter((n) => n !== 'data-kui'), // the author's own attribute is never library-owned
  }))
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 400 } })
  const page = await context.newPage()
  await page.addInitScript(COUNT_LISTENERS)

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  await page.waitForTimeout(150)

  // Engage the magnet's spring toward the pointer.
  const magnetBox = await page.$eval('#magnet', (el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.x + rect.width / 2 + 40, y: rect.y + rect.height / 2 }
  })
  await page.mouse.move(magnetBox.x, magnetBox.y)
  await page.waitForTimeout(150)

  // Start a drag and leave the pointer down — teardown must survive an in-flight gesture, not
  // just a settled one.
  const dragBox = await page.$eval('#drag', (el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  await page.mouse.move(dragBox.x, dragBox.y)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + 60, dragBox.y + 30, { steps: 6 })

  const active = await readCleanupState(page, '#drag')
  check(
    'sanity: the drag is actually active before teardown',
    active.style !== null && active.kuiAttributes.includes('data-kui-dragging'),
    `style=${active.style}, attrs=${active.kuiAttributes.join(',')}`,
  )
  await snap(page, 'active-before-destroy')

  await page.evaluate(() => {
    window.__kui.reset(document.querySelector('#magnet'))
    window.__kui.reset(document.querySelector('#drag'))
  })
  // Release the (now-unlistened) pointer so Playwright doesn't leave the mouse button down for
  // whatever runs next.
  await page.mouse.up()

  const dragAfter = await readCleanupState(page, '#drag')
  check(
    'reset() removes every library-owned attribute from a mid-gesture element',
    dragAfter.kuiAttributes.length === 0,
    `remaining attrs=${dragAfter.kuiAttributes.join(',')}`,
  )
  check(
    'reset() restores inline style, leaving no translate behind',
    !dragAfter.style || !dragAfter.style.includes('translate'),
    `style=${dragAfter.style}`,
  )

  const magnetAfter = await readCleanupState(page, '#magnet')
  check(
    'reset() restores the magnetic element’s inline style',
    !magnetAfter.style || !magnetAfter.style.includes('translate'),
    `style=${magnetAfter.style}`,
  )
  await snap(page, 'after-destroy')

  const counts = await listenerCounts(page)
  const dragListenerKeys = Object.keys(counts).filter((k) => k.startsWith('drag:'))
  const leakedDragListeners = dragListenerKeys.filter((k) => counts[k] > 0)
  check(
    'reset() leaves no net pointer listeners on the dragged element',
    leakedDragListeners.length === 0,
    `counts=${JSON.stringify(counts)}`,
  )
  check(
    'reset() leaves no net pointermove listener on window from the magnetic effect',
    (counts['window:pointermove'] ?? 0) <= 0,
    `window:pointermove=${counts['window:pointermove']}`,
  )

  await context.close()
  return results
}
