import { createChecker, startStaticServer } from '../../scripts/browser-harness.mjs'
import { VIEWPORTS, listDemoPages, openDemoPage } from './lib/demo-pages.mjs'

/**
 * Regressions specific to shipped `demo/*.html` pages — one named check per bug, each written to
 * fail on the page as it was before the fix. Properties true of every page belong in
 * `page-invariants.test.mjs` instead.
 *
 * Checks (each named `<page> @ <viewport>: <regression>`):
 *   1. one animator per page: no "an animator was created by hand" warning on load. `kuinetic.js`
 *      starts an animator itself; a page that also calls `kuinetic.kuinetic(...).start()` gets a
 *      second one (or a silently adopted one) and the library says so. A page that wants its own
 *      options puts `data-kui-manual` on the script tag.
 *   2. (index.html) the `target:` hoists reach their elements. The home page teaches `target:` by
 *      declaring `pop` once on `.deck-shell` / `#reel`, the chip entrance once on `.lab-chips`, and
 *      the tile entrance once on `.slices`, instead of repeating each on every child. Every element
 *      they name must really receive the effect (`data-kui-fx`), the Gestures tile — which has no
 *      entrance and must not gain one — must not, and the page must load with no library warning
 *      ("cannot be retargeted", "activation ... is not supported", "already carries its own
 *      data-kui"). The `.deck-contract` caption must print the shell's real attribute.
 *   3. (index.html) a click inside the `swipe-x` video hero reaches what was pressed. Pointer
 *      capture taken on `pointerdown` retargets the `click` at the section, which killed every dot
 *      and "Show code" chip in it; `swipeable` must only capture once a drag starts, never on a tap.
 */
export const name = 'page-regressions'

export async function run({ browser }) {
  const { check, results } = createChecker()
  const { origin, close } = await startStaticServer()
  // KUI_PAGES=a.html,b.html narrows a local run; CI never sets it.
  const only = process.env.KUI_PAGES?.split(',')
  const pages = listDemoPages().filter((page) => !only || only.includes(page.file))

  try {
    for (const { file } of pages) {
      for (const [viewportName, contextOptions] of Object.entries(VIEWPORTS)) {
        // The library's warnings pass the offending element as a second argument; name it, so a failure
        // points at markup rather than at "JSHandle@node".
        const subjects = []
        const nameSubjects = (page) =>
          page.on('console', (msg) => {
            if (msg.type() !== 'warning') return
            const handle = msg.args()[1]
            if (handle) subjects.push(handle.evaluate((el) => el.outerHTML.slice(0, 200)).catch(() => 'n/a'))
          })
        const { context, page, collected } = await openDemoPage(browser, origin, file, contextOptions, { beforeGoto: nameSubjects })
        try {
          if (file === 'index.html') {
            await checkIndexHoists(page, collected, subjects, `${file} @ ${viewportName}`, check)
            await checkHeroTaps(page, `${file} @ ${viewportName}`, check)
          }
          const doubled = collected.kuiWarnings.filter((message) => /animator was created by hand/.test(message))
          check(
            `${file} @ ${viewportName}: exactly one animator (no "created by hand" warning)`,
            doubled.length === 0,
            doubled.length ? doubled[0].slice(0, 160) : '',
          )
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await close()
  }
  return results
}

/** Check 2. Runs in the page; returns plain data so the assertions stay out here. */
async function measureIndexHoists(page) {
  return page.evaluate(() => {
    const fx = (el) => (el.getAttribute('data-kui-fx') || '').split(/\s+/).filter(Boolean)
    const own = (el) => el.hasAttribute('data-kui')
    const collect = (selector, effect) => {
      const all = [...document.querySelectorAll(selector)]
      return {
        total: all.length,
        missing: all.filter((el) => !fx(el).includes(effect)).length,
        withOwnAttr: all.filter(own).length,
      }
    }
    const slices = [...document.querySelectorAll('.slices > .slice')]
    const gesture = slices.filter((el) => el.querySelector('.slice-puck'))
    const others = slices.filter((el) => !el.querySelector('.slice-puck'))
    const shell = document.getElementById('deck-demo')
    const caption = document.querySelector('.deck-contract code')?.textContent ?? ''
    return {
      pop: collect('.yt-play', 'pop'),
      chips: collect('.lab-chip', 'fade-up'),
      tiles: {
        total: others.length,
        missing: others.filter((el) => !fx(el).includes('tween-from')).length,
        withOwnAttr: others.filter(own).length,
        gestureCount: gesture.length,
        gestureFx: gesture.map((el) => el.getAttribute('data-kui-fx')),
        gestureOwn: gesture.filter(own).length,
      },
      captionMatches: !!shell && caption === `data-kui="${shell.getAttribute('data-kui')}"`,
    }
  })
}

/** Check 3. Real mouse clicks (down + up, no movement) on the hero's own controls. */
async function checkHeroTaps(page, label, check) {
  const hero = page.locator('.video-hero')
  await hero.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    window.__heroClickTargets = []
    document.addEventListener('click', (event) => window.__heroClickTargets.push(event.target.className), true)
  })
  const chip = page.locator('.video-hero-slide.is-active .video-hero-code')
  await chip.click()
  const chipTarget = await page.evaluate(() => String(window.__heroClickTargets.at(-1)))
  check(
    `${label}: a click on the hero "Show code" chip reaches the chip, not the swipe-x section`,
    chipTarget.includes('video-hero-code'),
    `click target was "${chipTarget}"`,
  )
  // The chip opens the code modal, which covers the dots; close it the way a user would.
  await page.keyboard.press('Escape')
  await page.locator('.video-hero-dot[data-slide-target="1"]').click()
  const active = await page.evaluate(() => document.querySelector('.video-hero-slide.is-active')?.id)
  check(
    `${label}: clicking a hero dot switches the slide`,
    active === 'video-hero-slide-1',
    `active slide is ${active}`,
  )
}

async function checkIndexHoists(page, collected, subjects, label, check) {
  const m = await measureIndexHoists(page)
  const each = (what, group) =>
    check(
      `${label}: every ${what} gets the hoisted effect and none keeps its own data-kui`,
      group.total > 0 && group.missing === 0 && group.withOwnAttr === 0,
      `${group.total} found, ${group.missing} without the effect, ${group.withOwnAttr} still carrying data-kui`,
    )
  each('.yt-play (deck + reel) gets pop', m.pop)
  each('.lab-chip gets its fade-up', m.chips)
  each('non-gesture .slice gets its tween-from', m.tiles)
  check(
    `${label}: the Gestures tile gets no entrance`,
    m.tiles.gestureCount === 1 && m.tiles.gestureFx.every((value) => value === null) && m.tiles.gestureOwn === 0,
    `${m.tiles.gestureCount} gesture tile(s), data-kui-fx=${JSON.stringify(m.tiles.gestureFx)}`,
  )
  check(`${label}: the deck caption prints the shell's real attribute`, m.captionMatches)
  check(
    `${label}: no library warnings on load`,
    collected.kuiWarnings.length === 0,
    collected.kuiWarnings.length ? `${collected.kuiWarnings[0].slice(0, 160)} on ${(await Promise.all(subjects))[0]}` : '',
  )
}
