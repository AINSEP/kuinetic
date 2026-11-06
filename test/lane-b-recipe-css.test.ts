// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const lab = readFileSync(fileURLToPath(new URL('../demo/motion-lab.html', import.meta.url)), 'utf8')
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
