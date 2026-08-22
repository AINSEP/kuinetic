import { describe, expect, it } from 'vitest'
import {
  installSlatStage,
  slatAngleDegrees,
  slatBandClip,
  slatTravelVector,
} from '../src/effects/catalog/media-shared.js'

/*
 * `angle:` generalised `axis:` from two keywords to any degree, which meant replacing the
 * sprite-sheet slicing — `100% / count` wide slats walked by `background-position` — with a
 * per-slat `clip-path`. `background-position` shifts and cannot shear, so it could never have
 * produced a diagonal; but it *was* correct for the two angles it served, so the first duty of
 * these tests is to pin that the replacement reproduces it exactly at 0deg and 90deg.
 */
describe('slat angle', () => {
  it('reads the axis keyword when no angle is authored, so every existing attribute still means what it did', () => {
    expect(slatAngleDegrees('', 'vertical')).toBe(0)
    expect(slatAngleDegrees('', 'horizontal')).toBe(90)
    expect(slatAngleDegrees('   ', 'horizontal')).toBe(90)
  })

  it('lets an authored angle win over the axis', () => {
    expect(slatAngleDegrees('45deg', 'horizontal')).toBe(45)
    expect(slatAngleDegrees('0deg', 'horizontal')).toBe(0)
  })

  it('accepts a bare number and the other CSS angle units', () => {
    expect(slatAngleDegrees('45', 'vertical')).toBe(45)
    expect(slatAngleDegrees('0.25turn', 'vertical')).toBe(90)
    expect(slatAngleDegrees('100grad', 'vertical')).toBe(90)
    expect(slatAngleDegrees('1.5707963rad', 'vertical')).toBeCloseTo(90, 4)
  })

  it('normalises to [0, 180): a band at 200deg is the same set of bands as one at 20deg', () => {
    expect(slatAngleDegrees('200deg', 'vertical')).toBeCloseTo(20, 6)
    expect(slatAngleDegrees('-45deg', 'vertical')).toBe(135)
    expect(slatAngleDegrees('360deg', 'horizontal')).toBe(0)
  })

  it('falls back to the axis rather than throwing on nonsense', () => {
    expect(slatAngleDegrees('sideways', 'horizontal')).toBe(90)
    expect(slatAngleDegrees('45px', 'vertical')).toBe(0)
    expect(slatAngleDegrees('NaN', 'vertical')).toBe(0)
  })

  it('travels along the band, which is the vertical slide the axis keyframes spelled out by hand', () => {
    const flat = slatTravelVector(0)
    expect(flat.x).toBeCloseTo(0, 6)
    expect(flat.y).toBeCloseTo(1, 6)

    const upright = slatTravelVector(90)
    expect(upright.x).toBeCloseTo(-1, 6)
    expect(upright.y).toBeCloseTo(0, 6)
  })
})

describe('slat band geometry', () => {
  /** Every x/y pair in a `polygon(...)`, as numbers. */
  const points = (clip: string): Array<[number, number]> =>
    clip
      .slice('polygon('.length, -1)
      .split(', ')
      .map((pair) => {
        const [x, y] = pair.split(' ').map((value) => Number.parseFloat(value))
        return [x, y] as [number, number]
      })

  it('cuts 0deg into the same columns the sprite-sheet did, to the pixel', () => {
    // 400px over 4 slats is 100px each; the old rule was `width: 100%/4 + 1px` at `left: i*100%/4`,
    // i.e. band 0 spanning x -1..101 once the seam overlap is counted at both edges.
    const clip = slatBandClip(0, 4, 0, { width: 400, height: 300 })
    const xs = points(clip).map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(-1, 6)
    expect(Math.max(...xs)).toBeCloseTo(101, 6)

    const last = points(slatBandClip(3, 4, 0, { width: 400, height: 300 })).map(([x]) => x)
    expect(Math.min(...last)).toBeCloseTo(299, 6)
    expect(Math.max(...last)).toBeCloseTo(401, 6)
  })

  it('cuts 90deg into rows the same way, over the height instead of the width', () => {
    const ys = points(slatBandClip(0, 4, 90, { width: 400, height: 300 })).map(([, y]) => y)
    expect(Math.min(...ys)).toBeCloseTo(-1, 6)
    expect(Math.max(...ys)).toBeCloseTo(76, 6)
  })

  it('spans the box at every angle, so no band is ever short of the edge', () => {
    // The union of all bands has to cover the box; each band's own extent along the cut normal is
    // one step plus the overlap, and consecutive bands must therefore overlap, never gap.
    for (const angle of [0, 30, 45, 90, 135, 170]) {
      const normal = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) }
      const project = ([x, y]: [number, number]): number => x * normal.x + y * normal.y
      let previousFar = Number.NEGATIVE_INFINITY
      for (let index = 0; index < 5; index++) {
        const projections = points(slatBandClip(index, 5, angle, { width: 400, height: 300 })).map(project)
        const near = Math.min(...projections)
        const far = Math.max(...projections)
        if (index > 0) expect(near).toBeLessThan(previousFar) // overlap, not a gap
        previousFar = far
      }
    }
  })

  it('is genuinely diagonal at 45deg — neither axis-aligned', () => {
    const pts = points(slatBandClip(1, 4, 45, { width: 400, height: 300 }))
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1)
    // A 45deg band's two long edges have slope +1 in screen coordinates.
    const [first, second] = pts
    if (!first || !second) throw new Error('a band polygon always has four corners')
    expect((second[1] - first[1]) / (second[0] - first[0])).toBeCloseTo(-1, 6)
  })

  it('answers in pixels, so the angle survives a non-square box', () => {
    // The same angle on a wide box and a tall box must produce edges of the same slope. A
    // percentage polygon would not: it resolves per axis, and 45deg would paint as two different
    // angles on the two boxes.
    const slope = (clip: string): number => {
      const [first, second] = points(clip)
      if (!first || !second) throw new Error('a band polygon always has four corners')
      return (second[1] - first[1]) / (second[0] - first[0])
    }
    expect(slope(slatBandClip(1, 4, 30, { width: 800, height: 200 }))).toBeCloseTo(slope(slatBandClip(1, 4, 30, { width: 200, height: 800 })), 6)
  })
})

describe('slat stage contract', () => {
  /*
   * The stage carries the cut as two things the rest of the system reads: `--kui-slat-dx`/`-dy`,
   * which the one shared keyframe pair turns into both the from-state displacement and the
   * `fold:true` hinge axis, and `data-kui-slat-axis`, which is now only a label for whoever is
   * reading the DOM — no stylesheet keys on it since the clip-path rewrite.
   */
  it.each([
    [0, 'vertical', '0.0000', '1.0000'],
    [90, 'horizontal', '-1.0000', '0.0000'],
    [35, 'diagonal', '-0.5736', '0.8192'],
  ])('labels a %sdeg cut as %s and hands CSS its travel vector', (angleDegrees, label, dx, dy) => {
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const built = installSlatStage(el, document, window, {
      count: 4,
      angleDegrees,
      from: 'start',
      fold: false,
    })!
    expect(built.stage.dataset.kuiSlatAxis).toBe(label)
    expect(built.stage.dataset.kuiSlatAngle).toBe(String(angleDegrees))
    expect(built.stage.style.getPropertyValue('--kui-slat-dx')).toBe(dx)
    expect(built.stage.style.getPropertyValue('--kui-slat-dy')).toBe(dy)
    // Each slat is clipped to its own band rather than positioned as a strip.
    for (const slat of built.slats) expect(slat.style.clipPath).toMatch(/^polygon\(/)
    built.restore()
  })

  it('treats an overflowing number as unparseable rather than producing NaN bands', () => {
    expect(slatAngleDegrees(`${'9'.repeat(400)}deg`, 'horizontal')).toBe(90)
  })
})
