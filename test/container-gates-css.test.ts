// @vitest-environment node
//
// Static analysis of the `@container` half of `wide:`/`narrow:` gates — split out of
// `css-invariants.test.ts` rather than added to it, once the file's own `max-lines` cap made a
// third growth spot the wrong place. The node environment is not optional here: under jsdom,
// `import.meta.url` is an http: URL and `fileURLToPath` throws — see `css-invariants.test.ts`'s
// own header comment for the same note.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BREAKPOINTS } from '../src/core/breakpoints.js'
import { readBalancedBlock } from './support/css-scan.js'

const BASE_CSS = readFileSync(fileURLToPath(new URL('../src/css/base.css', import.meta.url)), 'utf8')

/**
 * The `@container` half of `data-kui="fade-up wide:md"` — see `breakpoints.ts`'s `EffectGate` doc
 * and `base.css`'s own comment for why the defaults here are the opposite of `above:`/`below:`'s.
 *
 * `css-invariants.test.ts`'s "pre-JS cloak" suite asserts the same shape of thing for `above:`/
 * `below:` (`--kui-above-*`/`--kui-below-*` on `:root`, one `@media (min-width: X)` block per
 * breakpoint flipping both switches). This file is that suite's container-axis counterpart: same
 * method (read `base.css`, walk a `{`-balanced block by header text), different selector
 * (`[data-kui-fx]`, not `:root` — a `@container` query can never match `:root`, which has no
 * ancestor to establish containment) and a different block shape (two independent blocks per
 * breakpoint, not one, because both switches default ON here instead of one ON and one OFF).
 */
describe('container gates', () => {
  it('puts both switches ON by default, on [data-kui-fx]', () => {
    const header = '[data-kui-fx] {'
    const index = BASE_CSS.indexOf(header)
    expect(index, `no ${header} in base.css`).toBeGreaterThan(-1)
    const body = readBalancedBlock(BASE_CSS, index + header.length)
    for (const name of Object.keys(BREAKPOINTS)) {
      expect(body, name).toContain(`--kui-wide-${name}: initial;`)
      expect(body, name).toContain(`--kui-narrow-${name}: initial;`)
    }
  })

  it('turns narrow: OFF inside a positive @container block, and wide: OFF inside its exact negation', () => {
    // Two independent blocks per breakpoint, not one — unlike `above:`/`below:`, both switches
    // start ON, so tiling the axis needs a condition to turn off *each* one rather than a single
    // block that flips both. `@container not (...)` is the exact negation of `@container (...)`,
    // so the two conditions still meet at the boundary with no gap and no overlap.
    for (const [name, width] of Object.entries(BREAKPOINTS)) {
      const onHeader = `@container (min-width: ${width}) {`
      const onIndex = BASE_CSS.indexOf(onHeader)
      expect(onIndex, `no ${onHeader} in base.css`).toBeGreaterThan(-1)
      const onBody = readBalancedBlock(BASE_CSS, onIndex + onHeader.length)
      expect(onBody, name).toContain(`--kui-narrow-${name}: none;`)
      expect(onBody, name).not.toContain(`--kui-wide-${name}: none;`)

      const offHeader = `@container not (min-width: ${width}) {`
      const offIndex = BASE_CSS.indexOf(offHeader)
      expect(offIndex, `no ${offHeader} in base.css`).toBeGreaterThan(-1)
      const offBody = readBalancedBlock(BASE_CSS, offIndex + offHeader.length)
      expect(offBody, name).toContain(`--kui-wide-${name}: none;`)
      expect(offBody, name).not.toContain(`--kui-narrow-${name}: none;`)
    }
  })

  it('declares container-type once, on the opt-in attribute, and nowhere else', () => {
    const header = '[data-kui-container] {'
    const index = BASE_CSS.indexOf(header)
    expect(index, `no ${header} in base.css`).toBeGreaterThan(-1)
    const body = readBalancedBlock(BASE_CSS, index + header.length)
    expect(body).toContain('container-type: inline-size;')
    expect(BASE_CSS.indexOf(header, index + 1), 'a second [data-kui-container] rule').toBe(-1)
  })
})
