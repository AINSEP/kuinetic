import { createChecker, startStaticServer } from '../../scripts/browser-harness.mjs'
import {
  SELECTOR_PATH_SOURCE,
  VIEWPORTS,
  listDemoPages,
  nextFrames,
  openDemoPage,
  settle,
} from './lib/demo-pages.mjs'

/**
 * Line-split headings on the real pages must re-wrap when the viewport narrows.
 *
 * `split-lines` and `text-reveal-mask` measure where a paragraph wraps and wrap each visual line in
 * its own span. Measured once, at load, those spans are wrong the moment the window gets narrower:
 * a line that fitted at 1440px now wraps inside its span, so a "line" becomes two rows and the
 * reveal animates half a sentence. The library re-measures on resize (`prepareResponsiveLines`
 * observes the element's size), but a fixture-sized test cannot see whether the shipped pages —
 * with their own fonts, widths and paddings — still get a correct re-wrap. This loads each page
 * that uses a line preset at 1440px, shrinks it to a phone width in place, and checks every host:
 * still at least one line, every line exactly one row, no line wider than its host, and the lines
 * still spell the same text as the screen-reader copy.
 *
 * Which presets count as "line presets" is asked of the live registry, and which elements are hosts
 * is read off the pages' own `data-kui` attributes, so a new preset or a new heading is covered
 * without editing this file.
 */
export const name = 'page-resize-lines'

const WIDE = VIEWPORTS.desktop.viewport
const NARROW = { width: 390, height: 844 }

/** Presets whose split unit is lines, straight from the library's registry (never a hand-kept list). */
async function readLinePresets(page) {
  return page.evaluate(() => {
    const registry = window.kuinetic.createRegistry()
    return registry.names().filter((preset) => {
      const resolved = registry.resolve(preset)
      return resolved?.primitive.id === 'split-text' && resolved.preset.params?.unit === 'lines'
    })
  })
}

/** A page can only contain a line host if its source names a line preset or `split-text ... unit:lines`. */
function mentionsLines(html, linePresets) {
  const attribute = /data-kui="([^"]*)"/g
  for (const [, value] of html.matchAll(attribute)) {
    if (segmentsOf(value).some((segment) => isLineSegment(segment, linePresets))) return true
  }
  return false
}

const segmentsOf = (value) => value.split(',').map((segment) => segment.trim())
const isLineSegment = (segment, linePresets) => {
  const first = segment.split(/\s+/)[0]
  return linePresets.includes(first) || (first === 'split-text' && /\bunit:lines\b/.test(segment))
}

/**
 * Collect the line hosts in the page (elements whose `data-kui` has a line segment) into
 * `window.__lineHosts`, keeping element identity in a JS array rather than tagging the DOM. Returns
 * a label per host and whether it carries a `above:`/`below:` breakpoint gate.
 */
async function collectHosts(page, linePresets) {
  return page.evaluate(
    ({ presets, selectorSource }) => {
      const selectorPath = (0, eval)(selectorSource)
      const isLine = (segment) => {
        const first = segment.split(/\s+/)[0]
        return presets.includes(first) || (first === 'split-text' && /\bunit:lines\b/.test(segment))
      }
      window.__lineHosts = [...document.querySelectorAll('[data-kui]')].filter((el) =>
        el.getAttribute('data-kui').split(',').some((segment) => isLine(segment.trim())),
      )
      return window.__lineHosts.map((el, index) => ({
        index,
        path: selectorPath(el),
        gated: /\b(above|below):/.test(el.getAttribute('data-kui')),
      }))
    },
    { presets: linePresets, selectorSource: SELECTOR_PATH_SOURCE },
  )
}

/** Bring host `index` into view (that is what fires `on:enter`) and wait until its lines exist. */
async function revealHost(page, index) {
  await page.evaluate((i) => window.__lineHosts[i].scrollIntoView({ block: 'center', behavior: 'instant' }), index)
  await page.waitForFunction(
    (i) => window.__lineHosts[i].querySelector(':scope > .kui-split-decorative .kui-split-line') !== null,
    index,
    { timeout: 3000 },
  )
}

/** Line count, plus every fact the assertions need, for host `index`. */
async function measureHost(page, index) {
  return page.evaluate((i) => {
    const host = window.__lineHosts[i]
    const lines = [...host.querySelectorAll(':scope > .kui-split-decorative .kui-split-line')]
    const style = getComputedStyle(host)
    const contentWidth = host.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
    const normalise = (text) => text.replace(/\s+/g, ' ').trim()
    const measured = lines.map((line, n) => {
      const range = document.createRange()
      range.selectNodeContents(line)
      // A `display:block` line's own rect spans the whole host, so rows come from the text itself.
      const rows = []
      for (const rect of range.getClientRects()) {
        if (rect.width < 0.5) continue
        if (!rows.some((top) => Math.abs(top - rect.top) <= 2)) rows.push(rect.top)
      }
      const bounds = range.getBoundingClientRect()
      return { n, rows: rows.length, width: bounds.width, text: normalise(line.textContent) }
    })
    const screenReader = host.querySelector(':scope > .kui-sr-only')
    return {
      count: lines.length,
      contentWidth,
      lines: measured,
      spelled: normalise(measured.map((line) => line.text).join(' ')),
      screenReader: screenReader ? normalise(screenReader.textContent) : null,
    }
  }, index)
}

/**
 * Shrink one host's own box while the window stays the same size, measure, then put it back.
 *
 * The library re-wraps on two triggers — a window `resize` and a `ResizeObserver` on the host — and
 * a viewport change fires both, so a viewport-only test passes with either one broken. Only a
 * change to the host's own width, with the window untouched, isolates the observer.
 */
async function measureAfterContainerShrink(page, index) {
  await page.evaluate((i) => {
    const host = window.__lineHosts[i]
    host.style.maxWidth = `${Math.round(host.clientWidth * 0.7)}px`
  }, index)
  await nextFrames(page, 2)
  await page.waitForTimeout(200)
  await settle(page)
  const shrunk = await measureHost(page, index)
  await page.evaluate((i) => {
    window.__lineHosts[i].style.maxWidth = ''
  }, index)
  await nextFrames(page, 2)
  await page.waitForTimeout(200)
  await settle(page)
  return shrunk
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  const { origin, close } = await startStaticServer()
  const allPages = listDemoPages()
  const gatedSkips = []
  let anyCountChanged = false
  let anyContainerChanged = false
  let totalHosts = 0

  try {
    const probe = await openDemoPage(browser, origin, 'index.html', VIEWPORTS.desktop)
    const linePresets = await readLinePresets(probe.page)
    await probe.context.close()
    check('the registry has line presets to test', linePresets.length > 0, linePresets.join(', '))

    const pages = allPages.filter((page) => mentionsLines(page.html, linePresets))
    check(
      'the pages that use a line preset include text.html',
      pages.some((page) => page.file === 'text.html'),
      pages.map((page) => page.file).join(', '),
    )

    for (const { file } of pages) {
      const { context, page } = await openDemoPage(browser, origin, file, VIEWPORTS.desktop)
      try {
        const hosts = await collectHosts(page, linePresets)
        check(`${file}: source names a line preset and the page has hosts for it`, hosts.length > 0, `${hosts.length} hosts`)
        const testable = hosts.filter((host) => {
          if (host.gated) gatedSkips.push(`${file} ${host.path}`)
          return !host.gated
        })
        totalHosts += testable.length

        const wide = new Map()
        for (const host of testable) {
          try {
            await revealHost(page, host.index)
          } catch {
            check(`${file} #${host.index} ${host.path}: lines exist after scrolling into view`, false, 'no .kui-split-line within 3s')
            continue
          }
          await settle(page)
          wide.set(host.index, await measureHost(page, host.index))
        }

        // Every element that ended up split into lines should be one the attributes predicted.
        const stray = await page.evaluate(() => {
          const predicted = new Set(window.__lineHosts)
          return [...document.querySelectorAll('.kui-split-decorative')]
            .filter((layer) => layer.querySelector('.kui-split-line') && !predicted.has(layer.parentElement))
            .length
        })
        check(`${file}: every element split into lines was predicted from its data-kui`, stray === 0, `${stray} unpredicted`)

        await page.setViewportSize(NARROW)
        await page.evaluate(() => document.fonts.ready)
        await nextFrames(page, 2)
        await page.waitForTimeout(200)
        // A rewrap creates new spans, and new spans start new animations.
        await settle(page)

        for (const host of testable) {
          if (!wide.has(host.index)) continue
          const label = `${file} #${host.index} ${host.path}`
          try {
            await revealHost(page, host.index)
          } catch {
            check(`${label}: still has lines at ${NARROW.width}px`, false, 'no .kui-split-line within 3s')
            continue
          }
          await settle(page)
          const narrow = await measureHost(page, host.index)
          if (narrow.count !== wide.get(host.index).count) anyCountChanged = true
          const counts = `${wide.get(host.index).count} lines at ${WIDE.width}px, ${narrow.count} at ${NARROW.width}px`

          check(`${label}: still has at least one line after narrowing`, narrow.count >= 1, counts)
          const multiRow = narrow.lines.find((line) => line.rows !== 1)
          check(
            `${label}: every line is exactly one row at ${NARROW.width}px`,
            !multiRow,
            multiRow ? `line ${multiRow.n} "${multiRow.text.slice(0, 40)}" is ${multiRow.rows} rows; ${counts}` : counts,
          )
          const overflowing = narrow.lines.find((line) => line.width > narrow.contentWidth + 1)
          check(
            `${label}: no line is wider than its host`,
            !overflowing,
            overflowing
              ? `line ${overflowing.n} is ${overflowing.width.toFixed(1)}px in a ${narrow.contentWidth.toFixed(1)}px host`
              : `widest ${Math.max(...narrow.lines.map((line) => line.width)).toFixed(1)}px in ${narrow.contentWidth.toFixed(1)}px`,
          )
          // The screen-reader copy is only there while the reveal runs: when it lands the library drops
          // `.kui-sr-only` and un-hides the lines themselves (`lineCompletion`'s `land`). So the reference
          // text is the sr-only copy if the wide read still had one, else what the lines spelled then.
          const reference = wide.get(host.index).screenReader ?? wide.get(host.index).spelled
          check(
            `${label}: lines still spell the same text after narrowing`,
            narrow.spelled === reference && (narrow.screenReader === null || narrow.screenReader === reference),
            narrow.spelled === reference ? '' : `lines "${narrow.spelled.slice(0, 60)}" vs original "${reference.slice(0, 60)}"`,
          )

          // Window untouched: only the host's own width changes, which only its ResizeObserver sees.
          const shrunk = await measureAfterContainerShrink(page, host.index)
          if (shrunk.count !== narrow.count) anyContainerChanged = true
          // A lone word wider than the shrunken box can only break inside itself; that is CSS, not a rewrap bug.
          const shrunkRows = shrunk.lines.find((line) => line.rows !== 1 && /\s/.test(line.text))
          check(
            `${label}: lines re-wrap when only the host's own width shrinks`,
            shrunk.count >= 1 && !shrunkRows && shrunk.spelled === narrow.spelled,
            shrunkRows
              ? `line ${shrunkRows.n} "${shrunkRows.text.slice(0, 40)}" is ${shrunkRows.rows} rows after a 30% max-width cut; ${narrow.count} -> ${shrunk.count} lines`
              : `${narrow.count} -> ${shrunk.count} lines after a 30% max-width cut`,
          )
        }
      } finally {
        await context.close()
      }
    }

    // Without a host whose wrap really changes, "still one row" could be true of a page that never rewraps.
    check('at least one host changes its line count between 1440px and 390px', anyCountChanged, `${totalHosts} hosts tested`)
    check('at least one host changes its line count when only its own width shrinks', anyContainerChanged, `${totalHosts} hosts tested`)
    check('the run tested at least one host', totalHosts > 0, `${totalHosts} hosts`)
    if (gatedSkips.length) console.log(`SKIP  breakpoint-gated hosts (may not apply at ${NARROW.width}px): ${gatedSkips.join('; ')}`)
  } finally {
    await close()
  }

  return results
}
