import { describe, expect, it } from 'vitest'
import { domOffsetTop, domPosition } from '../src/effects/scroll-mechanics/tracker.js'

/**
 * `domPosition` and `domOffsetTop` — the two view-dependent readers `trackProgress` injects by
 * default, both defined right next to each other in `tracker.ts` for the same reason.
 *
 * Split out of `scroll-mechanics.test.ts`, which every other describe block in that file still
 * depends on and is untouched by this move, once these two pushed it over ESLint's per-file line
 * cap — the same reason `scroll-mechanics-spy-container.test.ts` and `scroll-mechanics-spy.test.ts`
 * got their own files.
 */

describe('domPosition', () => {
  it('reads the resolved position through the element\'s own view', () => {
    const node = document.createElement('div')
    node.style.position = 'sticky'
    document.body.append(node)
    expect(domPosition(node)).toBe('sticky')
  })

  it('answers "static" for an element whose document has no view', () => {
    // A document from `createHTMLDocument`/`DOMParser` has `defaultView === null`, and so does any
    // element inside it. `getComputedStyle` is only reachable through a window, so without this
    // guard the sticky walk-up would throw on markup parsed but never attached — which is exactly
    // what `show-code.js` does to every demo page on load.
    const detached = document.implementation.createHTMLDocument('')
    expect(detached.defaultView).toBeNull()
    expect(domPosition(detached.createElement('div'))).toBe('static')
  })
})

describe('domOffsetTop', () => {
  it('falls back to 0 for a document with no view, rather than throwing on a null defaultView', () => {
    // Same guard as `domPosition`, for the same reason: `getComputedStyle` is only reachable
    // through a window, and a document from `createHTMLDocument`/`DOMParser` has none.
    const detached = document.implementation.createHTMLDocument('')
    expect(detached.defaultView).toBeNull()
    expect(domOffsetTop(detached.createElement('div'))).toBe(0)
  })
})
