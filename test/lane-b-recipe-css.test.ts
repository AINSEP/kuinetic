// @vitest-environment node
import { expect, it } from 'vitest'

// The recipe CSS and markup, inline. The demo page they came from is deliberately untracked, so a test must not read it.
const lab = `
<style>
.lane-b-rtl { gap:32px; }
.lane-b-rtl > img { --left: clamp(0, calc((var(--kui-row-centre) + var(--kui-row-cycle) + var(--kui-row-x)) / var(--kui-row-width)), 1); filter: blur(calc((1 - var(--left)) * 4px)); transform:translateX(calc(var(--kui-row-x) + var(--kui-row-cycle))) scale(clamp(.55, calc(.55 + var(--left) * .35), .9)); transform-origin:center; opacity: calc(.3 + var(--left) * .7); }
.lane-b-scroll-area { min-block-size:300vh; }
.lane-b-scroll-stage { position:sticky; top:20vh; }
.lane-b-ripple > img { --phase:calc((var(--kui-row-centre) + var(--kui-row-cycle) + var(--kui-row-x)) / var(--kui-row-width) * 360deg); translate:0 calc(clamp(-24, var(--kui-motion-speed, 0) / 12, 24) * 1px * sin(var(--phase))); }
.lane-b-tilt > img { transform:translateX(calc(var(--kui-row-x) + var(--kui-row-cycle))) rotate(clamp(-10deg, calc(var(--kui-motion-speed, 0) / 48 * 1deg), 10deg)); }
</style>
<section class="lane-b-scroll-area"><h2>text-path — native curved letters on scroll and on a timer</h2><div class="lane-b-scroll-stage"><svg viewBox="0 0 600 180"></svg></div></section>
`
function rule(selector: string): string {
  const start = lab.indexOf(selector + ' {')
  expect(start).toBeGreaterThan(0)
  return lab.slice(start, lab.indexOf('}', start))
}
const response = (speed: number, limits: RegExpExecArray): number =>
  Math.max(Number(limits[1]), Math.min(Number(limits[3]), speed / Number(limits[2])))

it('keeps scaled RTL visuals smaller than their layout boxes, with explicit spacing', () => {
  const body = rule('.lane-b-rtl > img')
  const cap = /scale\(clamp\([^;]+,\s*([\d.]+)\)\)/.exec(body)
  expect(cap).not.toBeNull()
  expect(Number(cap![1])).toBeLessThan(1)
  const gap = /gap:([\d.]+)px/.exec(rule('.lane-b-rtl'))
  expect(Number(gap![1])).toBeGreaterThanOrEqual(20)
  expect(body).toContain('transform-origin:center')
  expect(body).toMatch(/transform:translateX\([^;]+\) scale\(/)
  expect(body).not.toMatch(/(?:^|;)\s*scale:/)
})

it('gives normal drag speed a visible 10–15% ripple amplitude and bounds fast flicks', () => {
  const limits = /clamp\((-?[\d.]+), var\(--kui-motion-speed, 0\) \/ ([\d.]+), ([\d.]+)\)/.exec(rule('.lane-b-ripple > img'))!
  expect(response(244, limits)).toBeGreaterThanOrEqual(150 * .1)
  expect(response(244, limits)).toBeLessThanOrEqual(150 * .15)
  expect(response(6000, limits)).toBeLessThanOrEqual(150 * .2)
  expect(response(-244, limits)).toBe(-response(244, limits))
  expect(response(0, limits)).toBe(0)
})

it('makes the same normal speed produce a modest reversible tilt with a hard cap', () => {
  const limits = /rotate\(clamp\((-?[\d.]+)deg, calc\(var\(--kui-motion-speed, 0\) \/ ([\d.]+) \* 1deg\), ([\d.]+)deg\)\)/.exec(rule('.lane-b-tilt > img'))!
  expect(rule('.lane-b-tilt > img')).toMatch(/transform:translateX\([^;]+\) rotate\(/)
  expect(rule('.lane-b-tilt > img')).not.toMatch(/(?:^|;)\s*rotate:/)
  expect(response(244, limits)).toBeGreaterThanOrEqual(4)
  expect(response(244, limits)).toBeLessThanOrEqual(8)
  expect(response(6000, limits)).toBeLessThanOrEqual(12)
  expect(response(-244, limits)).toBe(-response(244, limits))
  expect(response(0, limits)).toBe(0)
})

it('keeps the scroll text path in a sticky stage for its full travel', () => {
  const section = /<section[^>]*><h2>text-path [\s\S]*?<\/section>/.exec(lab)![0]
  expect(section).toContain('class="lane-b-scroll-area"')
  expect(section).toContain('class="lane-b-scroll-stage"')
  expect(rule('.lane-b-scroll-stage')).toContain('position:sticky')
  expect(rule('.lane-b-scroll-area')).toContain('min-block-size:300vh')
})
