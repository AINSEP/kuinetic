// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  cloakSelector,
  cloakTokenForms,
  gateReleaseSelector,
} from '../src/core/cloak-selectors.js'

/**
 * `cloakSelector`/`gateReleaseSelector` build one `:is()` covering the four comma forms a
 * `data-kui` token can take (`N`, `N,`, `,N`, `,N,`) — see the file header for why `~=` alone
 * cannot see a comma glued to a word.
 */

describe('cloakTokenForms', () => {
  it('returns the four comma forms in match order', () => {
    expect(cloakTokenForms('text-reveal-mask')).toEqual([
      'text-reveal-mask',
      'text-reveal-mask,',
      ',text-reveal-mask',
      ',text-reveal-mask,',
    ])
  })
})

describe('cloakSelector', () => {
  it('groups all four forms in one :is(), 2-space indented, :not([data-kui-state]) suffix', () => {
    expect(cloakSelector('text-reveal-mask')).toBe(
      "  html[data-kui-cloak] :is([data-kui~='text-reveal-mask'], " +
        "[data-kui~='text-reveal-mask,'], [data-kui~=',text-reveal-mask'], " +
        "[data-kui~=',text-reveal-mask,']):not([data-kui-state])",
    )
  })

  it('matches an element whose data-kui glues a comma straight onto the name (N, form)', () => {
    // The case the comma-form handling exists for: `data-kui="text-reveal-mask,\nfade-up"` makes
    // the whitespace token `text-reveal-mask,` (comma attached), not `text-reveal-mask` — a plain
    // `~=` on the bare name would miss it entirely.
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.setAttribute('data-kui-cloak', '')
    const el = doc.createElement('div')
    el.setAttribute('data-kui', 'text-reveal-mask,\nfade-up')
    doc.body.append(el)

    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBe(el)
  })

  it('matches a name with a leading comma glued on (,N form)', () => {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.setAttribute('data-kui-cloak', '')
    const el = doc.createElement('div')
    el.setAttribute('data-kui', 'fade-up ,text-reveal-mask')
    doc.body.append(el)

    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBe(el)
  })

  it('matches a name with commas glued on both sides (,N, form)', () => {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.setAttribute('data-kui-cloak', '')
    const el = doc.createElement('div')
    el.setAttribute('data-kui', 'fade-up ,text-reveal-mask, blur-in')
    doc.body.append(el)

    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBe(el)
  })

  it('does not match the wrong token, or once the cloak is lifted', () => {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.setAttribute('data-kui-cloak', '')
    const cloaked = doc.createElement('div')
    cloaked.setAttribute('data-kui', 'fade-up')
    doc.body.append(cloaked)

    // Wrong token: the fade-up element must not match a text-reveal-mask cloak selector.
    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBeNull()

    // Ready state present: the animator has taken over, `:not([data-kui-state])` excludes it.
    const ready = doc.createElement('div')
    ready.setAttribute('data-kui', 'text-reveal-mask')
    ready.setAttribute('data-kui-state', 'ready')
    doc.body.append(ready)
    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBeNull()

    // Cloak lifted: with `data-kui-cloak` removed from <html>, the `ready` element (now the only
    // untargeted state left) must still not match, since the whole rule is scoped under the cloak.
    doc.documentElement.removeAttribute('data-kui-cloak')
    expect(doc.querySelector(cloakSelector('text-reveal-mask'))).toBeNull()
  })
})

describe('gateReleaseSelector', () => {
  it('groups all four forms in one :is(), 4-space indented, :not([data-kui-state]) suffix', () => {
    expect(gateReleaseSelector('above:md')).toBe(
      "    html[data-kui-cloak] :is([data-kui~='above:md'], [data-kui~='above:md,'], " +
        "[data-kui~=',above:md'], [data-kui~=',above:md,']):not([data-kui-state])",
    )
  })

  it('matches a gate token glued to a neighbour by comma, same as cloakSelector (N, form)', () => {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.setAttribute('data-kui-cloak', '')
    const el = doc.createElement('div')
    el.setAttribute('data-kui', 'fade-up above:md,\nblur-in')
    doc.body.append(el)

    expect(doc.querySelector(gateReleaseSelector('above:md'))).toBe(el)
  })
})
