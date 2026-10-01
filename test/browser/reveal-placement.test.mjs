import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * `place:` and the tooltip card on `hover-intent` / `anchored-preview`, in real layout.
 *
 * `test/reveal-placement.test.ts` drives the flip logic with stubbed geometry, because jsdom lays
 * nothing out. What only a browser can say is whether the stamped side actually *moves the box*:
 * that `[data-kui-fx][data-kui-hint-place='bottom']` outranks the host rule, that the offset-based
 * extent matches the real hint, and that the card's default and authored colours resolve. And for
 * `SHIFT`: that the offset-based start matches real layout — including a trigger that is an inline
 * word in running text, the 390px showcase case — so the shifted part really clears the edge.
 */
export const name = 'reveal-placement'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/reveal-placement.html', import.meta.url))}`

/** Past the fixture's 0ms transitions plus a frame for the stamped attribute to restyle. */
const SETTLE_MS = 150

async function hoverAndRead(page, id, part) {
  await page.hover(`#${id}`)
  await page.waitForTimeout(SETTLE_MS)
  return page.$eval(
    `#${id}`,
    (host, partSelector) => {
      const child = host.querySelector(partSelector)
      const hostRect = host.getBoundingClientRect()
      const partRect = child.getBoundingClientRect()
      const style = getComputedStyle(child)
      return {
        hint: host.getAttribute('data-kui-hint-place'),
        preview: host.getAttribute('data-kui-preview-place'),
        host: { top: hostRect.top, bottom: hostRect.bottom, left: hostRect.left, right: hostRect.right },
        part: { top: partRect.top, bottom: partRect.bottom, left: partRect.left, right: partRect.right },
        background: style.backgroundColor,
        color: style.color,
        radius: style.borderTopLeftRadius,
        opacity: style.opacity,
        viewport: { width: innerWidth, height: innerHeight },
        client: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
      }
    },
    part,
  )
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  for (const viewport of [
    { width: 1024, height: 700 },
    { width: 390, height: 844 },
  ]) {
    const label = `${viewport.width}px`
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(FIXTURE_URL)
    await page.waitForFunction(() => window.__kui !== undefined)

    // Read before any hover: the tease is the only thing that can have opened this one.
    await page.waitForTimeout(SETTLE_MS)
    const teased = await page.$eval('#teased', (host) => ({
      attr: host.hasAttribute('data-kui-hint-tease'),
      opacity: getComputedStyle(host.querySelector('[data-kui-hint]')).opacity,
    }))
    check(
      `${label}: tease: opens the hint on entry with no hover`,
      teased.attr && teased.opacity === '1',
      JSON.stringify(teased),
    )

    const targeted = await hoverAndRead(page, 'targeted', '.preview-img')
    await snap(page, `${label}-targeted`)
    check(
      `${label}: target: names the preview — stamped, shown, and below the trigger`,
      targeted.preview === 'bottom' &&
        targeted.opacity === '1' &&
        targeted.part.top >= targeted.host.bottom,
      JSON.stringify(targeted),
    )
    check(
      `${label}: target: left the effect on the trigger, not the part`,
      await page.$eval(
        '#targeted',
        (host) =>
          host.getAttribute('data-kui-fx') === 'anchored-preview-bottom' &&
          host.querySelector('.preview-img').hasAttribute('data-kui-preview') &&
          !host.querySelector('.preview-img').hasAttribute('data-kui-fx'),
      ),
    )

    const edge = await hoverAndRead(page, 'edge-top', '[data-kui-hint]')
    await snap(page, `${label}-edge-top`)
    check(
      `${label}: auto flips a hint with no room above to below its trigger`,
      edge.hint === 'bottom' && edge.part.top >= edge.host.bottom,
      JSON.stringify(edge),
    )
    check(`${label}: the flipped hint is on screen`, edge.part.top >= 0, JSON.stringify(edge.part))

    const middle = await hoverAndRead(page, 'middle', '[data-kui-hint]')
    check(
      `${label}: auto keeps the hint above when it fits`,
      middle.hint === 'top' && middle.part.bottom <= middle.host.top,
      JSON.stringify(middle),
    )
    check(
      `${label}: the default card is the library's dark surface`,
      middle.background === 'rgb(17, 17, 17)' &&
        middle.color === 'rgb(244, 244, 240)' &&
        middle.radius === '12px',
      `${middle.background} / ${middle.color} / ${middle.radius}`,
    )

    const fixed = await hoverAndRead(page, 'fixed-bottom', '[data-kui-hint]')
    check(
      `${label}: place:bottom pins the hint below`,
      fixed.hint === 'bottom' && fixed.part.top >= fixed.host.bottom,
      JSON.stringify(fixed),
    )

    const styled = await hoverAndRead(page, 'styled', '[data-kui-hint]')
    check(
      `${label}: color / bg-color / radius reach the hint`,
      styled.background === 'rgb(228, 242, 34)' &&
        styled.color === 'rgb(0, 0, 0)' &&
        styled.radius === '2px',
      `${styled.background} / ${styled.color} / ${styled.radius}`,
    )

    const right = await hoverAndRead(page, 'edge-right', '[data-kui-preview]')
    await snap(page, `${label}-edge-right`)
    check(
      `${label}: auto flips anchored-preview-right to the left at the viewport edge`,
      right.preview === 'left' && right.part.right <= right.host.left,
      JSON.stringify(right),
    )

    // SHIFT: each part must end up inside the viewport with the 8px margin (±1px for subpixel
    // layout), still on the side it was placed on.
    const inside = (r, axis) =>
      axis === 'x'
        ? r.part.left >= 7 && r.part.right <= r.client.width - 7
        : r.part.top >= 7 && r.part.bottom <= r.client.height - 7

    const leftEdge = await hoverAndRead(page, 'shift-left', '[data-kui-hint]')
    await snap(page, `${label}-shift-left`)
    check(
      `${label}: a hint against the left edge slides right into view, still above`,
      inside(leftEdge, 'x') && leftEdge.part.bottom <= leftEdge.host.top,
      JSON.stringify(leftEdge),
    )

    const topEdge = await hoverAndRead(page, 'shift-top', '[data-kui-preview]')
    await snap(page, `${label}-shift-top`)
    check(
      `${label}: a right-placed preview against the top edge slides down, still to the right`,
      inside(topEdge, 'y') && topEdge.part.left >= topEdge.host.right,
      JSON.stringify(topEdge),
    )

    const line = await hoverAndRead(page, 'shift-word', '.pic')
    await snap(page, `${label}-shift-line`)
    check(
      `${label}: a preview on a word at the end of a line stays inside the viewport`,
      line.preview === 'bottom' && line.opacity === '1' && inside(line, 'x'),
      JSON.stringify(line),
    )
    check(
      `${label}: the shift is the script's custom property on the host`,
      (await page.$eval('#shift-word', (host) =>
        host.style.getPropertyValue('--kui-anchored-preview-shift'),
      )) !== '',
    )

    await context.close()
  }

  return results
}
