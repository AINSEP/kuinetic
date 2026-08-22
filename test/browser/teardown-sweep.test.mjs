import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * Every effect in the catalog, applied and then torn down, checked for what it left behind.
 *
 * `destroy-cleanup.test.mjs` already does this thoroughly — for two names. Two is enough to prove
 * the *mechanism* works and no help at all against the case that actually shipped: `slat-assemble`
 * dropped its animating class on `land()` but never called `built.restore()`, so a finished effect
 * left eight background-image strips standing in front of a permanently `visibility: hidden`
 * source image. Nothing was thrown, nothing was logged, and the unit suite — which asserts the
 * instance was created and that `finished` resolves — stayed green.
 *
 * The oracle here needs no expected values and no per-effect knowledge, which is the only reason
 * it can cover 252 names: **teardown is a round trip.** Snapshot the subtree, apply the effect,
 * let it run, reset it, and the snapshot must come back byte-identical. Any inline property left
 * written, any synthetic node left in the tree, any attribute not removed is a difference, and a
 * difference is a defect regardless of which effect produced it.
 *
 * `Animator.reset(el)` is the public per-element teardown, the same entry point `destroy()` calls
 * across every tracked element.
 */
export const name = 'teardown-sweep'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/effect-sweep.html', import.meta.url))}`

export async function run({ browser }) {
  const { check, results } = createChecker()

  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  const names = await page.evaluate(() => window.__registry.names())
  check('the sweep sees the whole catalog', names.length > 200, `${names.length} effects`)

  const dirty = await page.evaluate(async (effects) => {
    const stage = document.getElementById('stage')
    const offenders = []

    for (const effect of effects) {
      const host = document.createElement('div')
      host.className = 'probe-host'
      // Some effects decompose an <img> (slat-assemble) or split text (split-text), so the probe
      // carries both — a bare <div> would let those effects no-op and pass without doing anything.
      host.innerHTML =
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" ' +
        'width="200" height="140" alt="" /><p>probe text for the split family</p>'
      stage.replaceChildren(host)

      const before = host.innerHTML
      host.setAttribute('data-kui', `${effect} 120ms`)
      await new Promise((resolve) => setTimeout(resolve, 90))
      window.__kui.reset(host)
      // A frame for any cancelled animation to release the properties it was holding.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const leftoverAttributes = [...host.attributes]
        .map((attribute) => attribute.name)
        .filter((attribute) => attribute.startsWith('data-kui') && attribute !== 'data-kui')
      const leftoverInline = host.getAttribute('style') ?? ''

      if (host.innerHTML !== before || leftoverAttributes.length > 0 || leftoverInline !== '') {
        // A character count says something changed but never what, which cost a whole debugging
        // session: the effect reproduced only inside the full loop, and "160→169" is not enough
        // to tell a stray attribute from a stray node. Carry the first differing region too.
        const after = host.innerHTML
        let at = 0
        while (at < before.length && at < after.length && before[at] === after[at]) at += 1
        offenders.push({
          effect,
          diff: host.innerHTML === before ? null : `…${after.slice(Math.max(0, at - 20), at + 40)}…`,
          subtree: host.innerHTML === before ? null : `${before.length}→${host.innerHTML.length} chars`,
          attributes: leftoverAttributes,
          inline: leftoverInline.slice(0, 80),
        })
      }
      host.removeAttribute('data-kui')
    }
    return offenders
  }, names)

  const subtree = dirty.filter((row) => row.subtree)
  check(
    'no effect leaves synthetic nodes in the tree after reset',
    subtree.length === 0,
    subtree.length === 0
      ? `${names.length} effects restore their subtree`
      : subtree.map((row) => `${row.effect} (${row.subtree}) ${row.diff}`).join(', '),
  )

  const attributes = dirty.filter((row) => row.attributes.length > 0)
  check(
    'no effect leaves a data-kui-* attribute behind after reset',
    attributes.length === 0,
    attributes.length === 0
      ? `${names.length} effects clear their attributes`
      : attributes.map((row) => `${row.effect} → ${row.attributes.join('/')}`).join(', '),
  )

  const inline = dirty.filter((row) => row.inline !== '' && row.inline !== undefined)
  check(
    'no effect leaves an inline style behind after reset',
    inline.length === 0,
    inline.length === 0
      ? `${names.length} effects hand their inline properties back`
      : inline.map((row) => `${row.effect} → ${row.inline}`).join(' | '),
  )

  await context.close()
  return results
}
