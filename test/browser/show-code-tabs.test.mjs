import { createChecker, startStaticServer } from '../../scripts/browser-harness.mjs'
import { VIEWPORTS, openDemoPage } from './lib/demo-pages.mjs'

/**
 * The show-code popover's Code | Args tabs, in a real browser: what jsdom cannot show.
 *
 * `test/show-code-consistency.test.ts` already pins the wiring (ARIA attributes, roving tabindex,
 * what Args lists, the defaults it prints). This suite checks the parts that need layout and real
 * input: the arrow keys move real focus, `kuinetic.notes.js` really lazy-loads next to
 * `show-code.js`, Args scrolls inside the panel at 390px with no page h-scroll, the header still
 * drags the panel while a click on a tab never does, and the selected tab is visibly marked in
 * both themes.
 *
 * Runs on `reveals.html` and `index.html`: real pages, so the popover is the shipped one with the
 * shipped stylesheet, not a fixture's copy of it. index.html links no system.css, so it proves
 * `show-code.js` links `show-code.css` itself.
 */
export const name = 'show-code-tabs'

// reveals.html loads system.css; index.html does not, so it proves show-code.js brings its own
// sheet. On index the first chip is a video-hero one, so target the lab bar's chip instead.
const PAGES = [
  { page: 'reveals.html', chip: '.kui-show-code-toggle' },
  { page: 'index.html', chip: '[data-show-code-target="lab-target"]' },
]

async function openFirstChip(page, selector) {
  await page.waitForSelector(selector)
  const chip = page.locator(selector).first()
  await chip.scrollIntoViewIfNeeded()
  await chip.click()
  await page.waitForSelector('.kui-code-modal', { state: 'visible' })
}

function readState(page) {
  return page.evaluate(() => {
    const tab = (id) => document.getElementById(`kui-code-tab-${id}`)
    const panel = (id) => document.getElementById(`kui-code-panel-${id}`)
    const dialog = document.querySelector('.kui-code-modal')
    const rect = dialog.getBoundingClientRect()
    const args = panel('args')
    const selected = document.querySelector('.kui-code-tab[aria-selected="true"]')
    return {
      focused: document.activeElement?.id ?? '',
      selected: selected?.id ?? '',
      codeHidden: panel('code').hidden,
      argsHidden: args.hidden,
      argsSteps: args.querySelectorAll('.kui-args-step').length,
      argsNotes: args.querySelectorAll('.kui-args-note').length,
      elementKeyBlocks: args.querySelectorAll('.kui-args-group > .kui-args-keys').length,
      groups: args.querySelectorAll('.kui-args-group').length,
      argsOverflowY: getComputedStyle(args).overflowY,
      argsScrollable: args.scrollHeight > args.clientHeight,
      notesLoaded: Boolean(window.kuineticNotes?.PARAM_NOTES),
      notesScripts: document.querySelectorAll('script[src$="kuinetic.notes.js"]').length,
      transform: dialog.style.transform,
      dialog: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      pageScrollWidth: document.documentElement.scrollWidth,
      selectedBg: selected ? getComputedStyle(selected).backgroundColor : '',
      selectedWeight: selected ? Number(getComputedStyle(selected).fontWeight) : 0,
      dialogDisplay: getComputedStyle(dialog).display,
      tabsDisplay: getComputedStyle(document.querySelector('.kui-code-tabs')).display,
      sheets: document.querySelectorAll('link[href$="show-code.css"]').length,
      idleWeight: Number(getComputedStyle(document.querySelector('.kui-code-tab[aria-selected="false"]')).fontWeight),
    }
  })
}

async function checkAt({ browser, origin, check, viewportName, contextOptions, theme, target }) {
  const label = `${target.page}/${viewportName}/${theme}`
  const { page, context } = await openDemoPage(browser, origin, target.page, contextOptions, { theme })
  try {
    await openFirstChip(page, target.chip)
    let state = await readState(page)
    // The sheet arrived (once) and styled the dialog: not raw buttons and a bare list.
    check(`${label}: show-code.css is linked exactly once`, state.sheets === 1, `sheets=${state.sheets}`)
    check(`${label}: the dialog is styled (flex)`, state.dialogDisplay === 'flex', state.dialogDisplay)
    // The sheet says inline-flex, but the strip is a child of the flex dialog, so it computes as flex.
    // Unstyled, it would be a plain block.
    check(`${label}: the tab strip is styled (flex)`, state.tabsDisplay === 'flex', state.tabsDisplay)
    check(`${label}: opens on the Code tab`, state.selected === 'kui-code-tab-code' && !state.codeHidden && state.argsHidden, JSON.stringify(state.selected))

    // Keyboard: real focus on the Code tab, then the arrow keys.
    await page.focus('#kui-code-tab-code')
    await page.keyboard.press('ArrowRight')
    state = await readState(page)
    check(`${label}: ArrowRight selects and focuses Args`, state.focused === 'kui-code-tab-args' && state.selected === 'kui-code-tab-args' && !state.argsHidden, `focused=${state.focused}`)
    await page.keyboard.press('Home')
    state = await readState(page)
    check(`${label}: Home goes back to Code`, state.focused === 'kui-code-tab-code' && state.selected === 'kui-code-tab-code', `focused=${state.focused}`)
    await page.keyboard.press('End')
    await page.waitForFunction(() => Boolean(window.kuineticNotes?.PARAM_NOTES), undefined, { timeout: 10000 }).catch(() => {})
    state = await readState(page)
    check(`${label}: Args lists at least one preset`, state.argsSteps > 0, `steps=${state.argsSteps}`)
    // The built bundle has describeElement(): every group ends with its element keys.
    check(`${label}: each data-kui group lists its element keys`, state.groups > 0 && state.elementKeyBlocks === state.groups, `groups=${state.groups} keyBlocks=${state.elementKeyBlocks}`)
    check(`${label}: kuinetic.notes.js lazy-loaded once`, state.notesLoaded && state.notesScripts === 1, `loaded=${state.notesLoaded} scripts=${state.notesScripts}`)
    check(`${label}: Args re-rendered with notes once they loaded`, state.argsNotes > 0, `notes=${state.argsNotes}`)

    // Selection is visible, and not by colour alone.
    check(`${label}: the selected tab is filled and heavier`, state.selectedBg !== 'rgba(0, 0, 0, 0)' && state.selectedWeight > state.idleWeight, `bg=${state.selectedBg} weight=${state.selectedWeight}/${state.idleWeight}`)

    // Layout: the panel scrolls, the dialog fits, the page does not scroll sideways.
    check(`${label}: the Args panel is its own scroll container`, state.argsOverflowY === 'auto', state.argsOverflowY)
    check(`${label}: the dialog fits the viewport`, state.dialog.left >= 0 && state.dialog.right <= state.viewport.width && state.dialog.bottom <= state.viewport.height, JSON.stringify(state.dialog))
    check(`${label}: no page h-scroll with Args open`, state.pageScrollWidth <= state.viewport.width, `scrollWidth=${state.pageScrollWidth} width=${state.viewport.width}`)

    // Drag: the header moves the panel.
    const grip = await page.locator('.kui-code-modal-grip').boundingBox()
    const startX = grip.x + grip.width / 2
    const startY = grip.y + grip.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 20, startY + 40, { steps: 5 })
    await page.mouse.up()
    const afterDrag = await readState(page)
    check(`${label}: the header still drags the panel`, afterDrag.transform.startsWith('translate('), `transform=${afterDrag.transform}`)

    // ...and a click on a tab is only a click: it selects, and the panel does not move.
    await page.locator('#kui-code-tab-code').click()
    const afterClick = await readState(page)
    check(`${label}: clicking a tab selects it without dragging`, afterClick.selected === 'kui-code-tab-code' && afterClick.transform === afterDrag.transform, `selected=${afterClick.selected} transform=${afterClick.transform}`)

    await page.keyboard.press('Escape')
    const closed = await page.evaluate(() => document.querySelector('.kui-code-modal-backdrop').style.display)
    check(`${label}: Escape still closes it`, closed === 'none', closed)
  } finally {
    await context.close()
  }
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  const { origin, close } = await startStaticServer()
  try {
    for (const target of PAGES) {
      for (const viewportName of ['phone', 'desktop']) {
        for (const theme of ['light', 'dark']) {
          await checkAt({ browser, origin, check, viewportName, contextOptions: VIEWPORTS[viewportName], theme, target })
        }
      }
    }
  } finally {
    await close()
  }
  return results
}
