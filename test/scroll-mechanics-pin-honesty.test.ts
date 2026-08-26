import { beforeEach, describe, expect, it } from 'vitest'
import { build, el, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * `data-kui-pinned` as an honest state contract, not just a progress readout.
 *
 * Split out of `scroll-mechanics.test.ts`, which every other `pin` case still lives in and is
 * untouched by this move, once this case pushed it over ESLint's per-file line cap — the same
 * reason `scroll-mechanics-readers.test.ts` got its own file.
 */

/** Pin measures its containing block, so that is what the stub must describe. */
const stubContainer = (top: number, height = 400): void => stubRect(document.body, top, height)

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('pin — data-kui-pinned reflects CSS, not just progress', () => {
  it('does not claim pinned when CSS keeps the element out of position: sticky', () => {
    // `demo/scroll.html`'s `.showcase-media` sets `position: static !important` below 900px — the
    // one thing that beats the inline `position: sticky` `installSticky` writes. Progress keeps
    // running (it is arithmetic on the tracked ancestor, not on `node`'s own position), so the old
    // `progress > 0 && progress < 1` test alone reported `pinned="true"` while nothing was held.
    // Standing in for the `!important` override with a direct inline overwrite: same observable
    // computed position, without depending on jsdom's stylesheet cascade support.
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(-200)
    animator.start()
    el().style.position = 'static'
    scheduler.emit(200)
    expect(el().getAttribute('data-kui-pinned')).toBe('false')
  })
})
