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
 *
 * There are two separate teardown laws here, not one — see `restoresOnFinish` in `core/types.ts`
 * for the full reasoning:
 *
 * - **Law A — interruption restores.** `reset()` mid-effect puts the markup back. Unconditional,
 *   every effect owes it, checked below for the whole catalog with no exceptions.
 * - **Law B — natural finish restores.** Left alone to finish on its own, with no `reset()` ever
 *   called, the markup comes back too. Only primitives that declare `restoresOnFinish: true` owe
 *   this — most of the catalog either never resolves `finished` at all (ambient loops, hover/drag)
 *   or finishes by design in a state that differs from authored markup, and flagging those would be
 *   exactly the over-reporting this split exists to avoid.
 *
 * This file used to run one check and report every failure as "leaves synthetic nodes behind" —
 * true of the symptom, wrong about the cause, and it cost a whole debugging session chasing
 * `slat-assemble` as a DOM-node leak when the actual defect was a lazily-synced `style` attribute
 * (`core/owned-styles.ts`'s `restore()`). Failures below name the law that broke instead.
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
    'Law A (interruption restores): no effect leaves synthetic nodes in the tree after reset',
    subtree.length === 0,
    subtree.length === 0
      ? `${names.length} effects restore their subtree`
      : subtree.map((row) => `${row.effect} (${row.subtree}) ${row.diff}`).join(', '),
  )

  const attributes = dirty.filter((row) => row.attributes.length > 0)
  check(
    'Law A (interruption restores): no effect leaves a data-kui-* attribute behind after reset',
    attributes.length === 0,
    attributes.length === 0
      ? `${names.length} effects clear their attributes`
      : attributes.map((row) => `${row.effect} → ${row.attributes.join('/')}`).join(', '),
  )

  const inline = dirty.filter((row) => row.inline !== '' && row.inline !== undefined)
  check(
    'Law A (interruption restores): no effect leaves an inline style behind after reset',
    inline.length === 0,
    inline.length === 0
      ? `${names.length} effects hand their inline properties back`
      : inline.map((row) => `${row.effect} → ${row.inline}`).join(' | '),
  )

  // Law B — natural finish restores. Only primitives that declare `restoresOnFinish: true` on
  // themselves (see `core/types.ts`) are asked this question at all; everything else either never
  // resolves `finished` in bounded time or settles by design somewhere other than authored markup,
  // and neither of those is a defect.
  const lawBCandidates = await page.evaluate(
    (effects) => effects.filter((effect) => window.__registry.resolve(effect)?.primitive.restoresOnFinish === true),
    names,
  )

  const lawBDirty = await page.evaluate(async (effects) => {
    const stage = document.getElementById('stage')
    const offenders = []
    const FINISH_TIMEOUT_MS = 3000
    const POLL_MS = 20

    for (const effect of effects) {
      const host = document.createElement('div')
      host.className = 'probe-host'
      host.innerHTML =
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" ' +
        'width="200" height="140" alt="" /><p>probe text for the split family</p>'
      stage.replaceChildren(host)

      const before = host.innerHTML
      host.setAttribute('data-kui', `${effect} 120ms`)

      let waited = 0
      while (host.getAttribute('data-kui-state') !== 'finished' && waited < FINISH_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        waited += POLL_MS
      }
      // A frame for anything the finish handler wrote to settle before serializing.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      if (host.getAttribute('data-kui-state') !== 'finished') {
        offenders.push({ effect, reason: `never reached data-kui-state="finished" within ${FINISH_TIMEOUT_MS}ms` })
        host.removeAttribute('data-kui')
        continue
      }

      // Only the subtree, deliberately not `host`'s own attributes or inline style: those are the
      // *animator's* bookkeeping (`data-kui-fx`, `data-kui-state`, a defensively-claimed
      // `position: relative`, …), owned by `state.ledger` / `state.attributes` and restored only on
      // a full `release()` — i.e. `reset()`. Natural finish was never that, for any primitive, and
      // checking it here would flag every single one of them. What natural finish *does* own is
      // whatever the primitive built or touched below the host — `slat-assemble`'s stage and the
      // `<img>`'s `visibility` — which is exactly what `host.innerHTML` (children only, no host
      // attributes) captures.
      const after = host.innerHTML

      if (after !== before) {
        let at = 0
        while (at < before.length && at < after.length && before[at] === after[at]) at += 1
        offenders.push({
          effect,
          reason: `subtree changed (${before.length}→${after.length} chars) …${after.slice(Math.max(0, at - 20), at + 40)}…`,
        })
      }
      host.removeAttribute('data-kui')
    }
    return offenders
  }, lawBCandidates)

  check(
    'Law B (natural finish restores): every primitive that declares restoresOnFinish keeps its promise',
    lawBDirty.length === 0,
    lawBDirty.length === 0
      ? `${lawBCandidates.length} effects declare restoresOnFinish and all of them kept it`
      : lawBDirty.map((row) => `${row.effect} — ${row.reason}`).join(' | '),
  )

  await context.close()
  return results
}
