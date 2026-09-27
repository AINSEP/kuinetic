//
// Static analysis of `src/css/ready-gates.css` — the Phase 4a file that makes S-12's inert
// `var(--kui-gate-X, var(--kui-X, default))` rewrite do anything. Node is the default environment;
// `SOURCES` (from `css-sources.ts`) reads every stylesheet at module scope via `fileURLToPath`, which
// throws under jsdom — see that file's own header comment for the same note.
//
// Same method `container-gates-css.test.ts` uses for the `@container` half of `wide:`/`narrow:`
// gates: read the real CSS text, locate a rule by its header or a selector fragment inside a shared
// one, and read its `{`-balanced body with `readBalancedBlock` rather than parsing CSS for real.
import { describe, expect, it } from 'vitest'
import { readBalancedBlock, stripComments } from './support/css-scan.js'
import { SOURCES } from './support/css-sources.js'

const RAW_CSS = SOURCES.get('ready-gates.css')
if (RAW_CSS === undefined) throw new Error('ready-gates.css missing from SOURCES')

// This file's own header comment documents the rules below in prose — including, deliberately,
// literal fragments like `[data-kui-state='ready']` and the word "!important" (to explain why the
// real rules don't use it). Scanning the raw text would let that prose match as if it were code, the
// exact trap `stripComments`'s own doc comment describes. Every check below runs against the
// stripped text instead.
const CSS = stripComments(RAW_CSS)

/** The body of the rule whose header is exactly `header` (header text includes the trailing ` {`). */
function blockAfterHeader(header: string): string {
  const index = CSS.indexOf(header)
  expect(index, `no "${header}" in ready-gates.css`).toBeGreaterThan(-1)
  expect(CSS.indexOf(header, index + 1), `a second "${header}"`).toBe(-1)
  return readBalancedBlock(CSS, index + header.length)
}

/**
 * The body of the (possibly multi-selector) rule that has `fragment` somewhere in its selector list —
 * for the two rules Phase 4a enumerates by preset name, where each name is one selector among several
 * that all share one rule body.
 */
function blockContaining(fragment: string): string {
  const index = CSS.indexOf(fragment)
  expect(index, `no selector containing "${fragment}" in ready-gates.css`).toBeGreaterThan(-1)
  const braceIndex = CSS.indexOf('{', index)
  return readBalancedBlock(CSS, braceIndex + 1)
}

const FROM_ANGLE_PRESETS = [
  'flip-in-x',
  'flip-in-y',
  'rotate-in',
  'rotate-in-left',
  'rotate-in-right',
  'swing-in',
  'roll-in',
  'fold-panel',
]

const BAR_FROM_PRESETS = ['loading-bar', 'chart-bar-grow', 'progress-bar']

describe('ready-gates.css', () => {
  it.each([
    ['--kui-gate-distance'],
    ['--kui-gate-from-angle'],
    ['--kui-gate-bar-from'],
  ])('declares %s via @property, untyped and non-inheriting', (token) => {
    const body = blockAfterHeader(`@property ${token} {`)
    expect(body).toContain("syntax: '*';")
    expect(body).toContain('inherits: false;')
  })

  it('resets --kui-gate-distance to 0px for every ready effect, unscoped by preset', () => {
    const body = blockAfterHeader(`[data-kui-fx][data-kui-state='ready'] {`)
    expect(body).toContain('--kui-gate-distance: 0px;')
  })

  it.each(FROM_ANGLE_PRESETS)('flattens --kui-gate-from-angle to 0deg when %s is ready', (name) => {
    const body = blockContaining(`[data-kui-fx~='${name}'][data-kui-state='ready']`)
    expect(body).toContain('--kui-gate-from-angle: 0deg;')
  })

  it.each(BAR_FROM_PRESETS)('flattens --kui-gate-bar-from to 1 when %s is ready', (name) => {
    const body = blockContaining(`[data-kui-fx~='${name}'][data-kui-state='ready']`)
    expect(body).toContain('--kui-gate-bar-from: 1;')
  })

  it('has exactly one ready rule per gated preset — a drift guard against an extra or missing name', () => {
    // 1 unscoped (distance) + 8 named (from-angle) + 3 named (bar-from). A name added to or dropped
    // from either enumerated list without a matching selector changes this count, catching the drift
    // the per-name tests above can't: they only prove the names present are right, not that the set
    // is complete.
    const readyRuleCount = (CSS.match(/\[data-kui-state='ready'\]/g) ?? []).length
    expect(readyRuleCount).toBe(1 + FROM_ANGLE_PRESETS.length + BAR_FROM_PRESETS.length)
  })

  it('never uses !important — nothing inline ever sets --kui-gate-*, so nothing here needs to outrank it', () => {
    expect(CSS).not.toContain('!important')
  })
})
