// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

const faces = '<div data-kui-cube-face="author">1</div><div>2</div><div>3</div><div>4</div><div>5</div><div>6</div>'

it('marks only opted-in faces, suppresses double perspective and restores attributes/styles', () => {
  const reporter = collectingReporter()
  const animator = build(`<div style="position:static;perspective:900px" data-kui="cube-rotate parts:cube tumble:true 8s ease:linear repeat:infinite">${faces}</div>`, reporter).start()
  const node = el()
  expect(reporter.messages).toEqual([])
  expect([...node.children].map((face) => face.getAttribute('data-kui-cube-face'))).toEqual(['front', 'back', 'right', 'left', 'top', 'bottom'])
  expect(node.style.perspective).toBe('none')
  expect(node.style.position).toBe('relative')
  expect(node.style.animationName).toBe('kui-cube-tumble')
  expect(node.style.animationIterationCount).toContain('infinite')
  expect(node.querySelector('button')).toBeNull()
  animator.destroy()
  expect(node.firstElementChild!.getAttribute('data-kui-cube-face')).toBe('author')
  expect(node.children[1]!.hasAttribute('data-kui-cube-face')).toBe(false)
  expect(node.hasAttribute('data-kui-cube')).toBe(false)
  expect(node.style.perspective).toBe('900px')
  expect(node.style.position).toBe('static')
})

it('preserves plain cube rotation, target relocation and independent opacity composition', () => {
  const registry = catalogRegistry()
  for (const source of ['cube-rotate', 'cube-rotate target:.cube', 'cube-rotate, tween opacity:0.5']) {
    const plan = compile(parse(source), registry, 'time')
    expect(plan.warnings).toEqual([])
    expect(plan.jsEffects).toHaveLength(0)
    expect(plan.declarations['animation-name']).toContain('kui-cube-rotate')
  }
  const reporter = collectingReporter()
  const animator = build(`<div data-kui="cube-rotate parts:cube target:.cube"><div class="cube">${faces}</div></div>`, reporter).start()
  expect(reporter.messages).toEqual([])
  expect(document.querySelector('.cube')!.hasAttribute('data-kui-cube')).toBe(true)
  animator.destroy()
})

it('warns for unsupported siblings, orphan tumble and invalid face count', () => {
  const registry = catalogRegistry()
  for (const source of ['card-flip-x parts:cube', 'book-page-turn tumble:true', 'fold-panel parts:cube']) {
    expect(compile(parse(source), registry, 'time').warnings.join()).toContain('only to cube-rotate')
  }
  expect(compile(parse('cube-rotate tumble:true'), registry, 'time').warnings.join()).toContain('needs parts:cube')
  const reporter = collectingReporter()
  const animator = build('<div data-kui="cube-rotate parts:cube"><div>Only one</div></div>', reporter).start()
  expect(reporter.messages.join()).toContain('exactly six')
  expect(el().hasAttribute('data-kui-cube')).toBe(false)
  animator.destroy()
})

it('builds a static angle pose without a tumble keyframe', () => {
  const animator = build(`<div data-kui="cube-rotate parts:cube tumble:false angle:35deg 1ms">${faces}</div>`).start()
  expect(el().style.animationName).toBe('kui-cube-rotate')
  expect(el().style.getPropertyValue('--kui-from-angle')).toBe('35deg')
  animator.destroy()
})
