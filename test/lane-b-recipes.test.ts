// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { animatorOverBody } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'

let animator: Animator | undefined
afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it.each([
  'carousel-loop spin:20s release:free copies:auto',
  'carousel-loop spin:20s copies:auto',
  'carousel-3d plane:screen radius:900px spin:40s',
  'carousel-loop copies:auto timeline:scroll distance:200vh speed:true',
  'carousel-loop target:img copies:auto autoplay:3s timer:true',
  'carousel-loop target:img copies:auto jump:.lane-b-scale',
  'carousel-loop target:img copies:auto jump:.lane-b-dot next:.lane-b-next prev:.lane-b-prev',
  'carousel-loop target:img copies:auto jump:.lane-b-thumb',
  'carousel-loop target:img copies:auto',
  'drag-x publish:true',
  "drag-x publish:true detents:'-120 0 120'",
])('lane B authored markup compiles without warnings: %s', effect => {
  document.body.innerHTML = `<div data-kui="${effect}"><img src="/one.jpg" alt="One"><img src="/two.jpg" alt="Two"><img src="/three.jpg" alt="Three">${effect.includes('target:') ? '<div id="decoration"></div>' : ''}</div>`
  const host = document.body.firstElementChild as HTMLElement
  Object.defineProperty(host, 'offsetWidth', { value: 390 })
  host.querySelectorAll('img').forEach((image, i) => {
    Object.defineProperty(image, 'offsetLeft', { value: i * 180 })
    Object.defineProperty(image, 'offsetWidth', { value: 160 })
  })
  for (const name of ['lane-b-scale', 'lane-b-dot', 'lane-b-thumb', 'lane-b-next', 'lane-b-prev']) {
    for (let i = 0; i < 3; i++) {
      const button = document.createElement('button')
      button.className = name
      document.body.append(button)
    }
  }
  const reporter = collectingReporter()
  animator = animatorOverBody(reporter)
  animator.start()
  expect(reporter.messages).toEqual([])
  if (effect.includes('target:')) {
    expect(host.style.getPropertyValue('--kui-item-count')).toBe('3')
    expect(host.querySelector('#decoration')!.hasAttribute('data-kui-step-offset')).toBe(false)
    document.querySelector<HTMLButtonElement>('.lane-b-next')!.click()
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(Number(host.getAttribute('data-kui-step'))).toBeGreaterThan(0)
  }
})
