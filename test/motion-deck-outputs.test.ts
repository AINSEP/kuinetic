// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, CAPS } from './support/js-effect-harness.js'
import type { Animator } from '../src/core/animator.js'

let animator: Animator | undefined
const initialReducedMotion = CAPS.reducedMotion
const cards = '<a href="#one">One</a><a href="#two">Two</a><a href="#three">Three</a>'
const dots = '<button class="dot">One</button><button class="dot">Two</button><button class="dot">Three</button>'
const host = (): HTMLElement => document.querySelector('#deck')!
const controls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.dot')]
const value = (node: HTMLElement, property: string): number => Number(node.style.getPropertyValue(property))

function start(effect: string, authored = dots): ReturnType<typeof collectingReporter> {
  const reporter = collectingReporter()
  const jump = /jump:\.([\w-]+)/.exec(effect)?.[1] ?? 'dot'
  const controlsMarkup = authored.replaceAll('class="dot"', `class="dot ${jump}"`)
  animator = build(`<div id="deck" data-kui="${effect}">${cards}</div><nav>${controlsMarkup}</nav>`, reporter)
  animator.start()
  return reporter
}

function key(name: string): void {
  host().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
})

afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  CAPS.reducedMotion = initialReducedMotion
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('authored spatial-deck outputs', () => {
  it('numbers wrapped controls in click order, repeating after the slide count', () => {
    const wrapped = `<ul>${dots.replaceAll('<button', '<li><button').replaceAll('</button>', '</button></li>')}</ul>`
    const reporter = start('carousel-stack jump:.dot', wrapped + wrapped)
    controls()[2]!.click()
    expect(host().getAttribute('data-kui-step')).toBe('2')
    expect(controls().map(node => value(node, '--kui-step-distance'))).toEqual([1, -1, 0, 1, -1, 0])
    expect(controls().map(node => value(node, '--kui-item-count'))).toEqual([3, 3, 3, 3, 3, 3])
    for (const group of document.querySelectorAll('ul')) {
      expect(group.querySelectorAll('[data-kui-step-state="active"]')).toHaveLength(1)
    }
    expect(reporter.messages).toEqual([])
    controls()[5]!.click()
    expect(host().getAttribute('data-kui-step')).toBe('2')
    // An incomplete parallel group still uses the slides' count, not its own size.
    controls()[5]!.closest('li')!.remove()
    controls()[2]!.click()
    expect(controls().map(node => node.getAttribute('data-kui-step-state'))).toEqual(['before', 'before', 'active', 'before', 'before'])
    expect(controls().map(node => value(node, '--kui-step-distance'))).toEqual([1, -1, 0, 1, -1])
  })

  it('updates only cached control distances between step changes during spin', () => {
    start('carousel-3d jump:.dot spin:4s')
    const nodes = controls()
    const query = vi.spyOn(document, 'querySelectorAll')
    const attributes = nodes.map(node => vi.spyOn(node, 'setAttribute'))
    const writes = nodes.map(node => vi.spyOn(node.style, 'setProperty'))
    vi.advanceTimersByTime(160)
    expect(query).not.toHaveBeenCalled()
    expect(attributes.every(spy => spy.mock.calls.length === 0)).toBe(true)
    for (const spy of writes) {
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      expect(spy.mock.calls.every(([name]) => name === '--kui-step-distance')).toBe(true)
    }
    expect(value(nodes[0]!, '--kui-step-distance')).toBeCloseTo(-value(host(), '--kui-step-position'), 3)
    vi.advanceTimersByTime(560)
    expect(query).toHaveBeenCalled()
    expect(nodes.map(node => node.getAttribute('data-kui-step-state'))).toEqual(['before', 'active', 'after'])
    const drift = value(host(), '--kui-step-position') - value(host(), '--kui-step')
    expect(value(nodes[1]!, '--kui-step-distance')).toBeCloseTo(-drift, 3)
    animator!.destroy()
    animator = undefined
    expect(nodes.every(node => !node.hasAttribute('style'))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('marks page-level jump controls and restores their authored values on teardown', () => {
    start('carousel-stack jump:.dot', '<button class="dot" data-kui-step-state="saved" style="--kui-step-distance:9">One</button><button class="dot">Two</button><button class="dot">Three</button>')
    expect(controls().map(node => node.getAttribute('data-kui-step-state'))).toEqual(['active', 'after', 'after'])
    controls()[2]!.click()
    expect(host().getAttribute('data-kui-step')).toBe('2')
    expect(controls().map(node => value(node, '--kui-step-distance'))).toEqual([1, -1, 0])
    expect(controls().filter(node => node.getAttribute('data-kui-step-state') === 'active')).toHaveLength(1)
    animator!.destroy()
    animator = undefined
    expect(controls()[0]!.getAttribute('data-kui-step-state')).toBe('saved')
    expect(controls()[0]!.style.getPropertyValue('--kui-step-distance')).toBe('9')
    expect(controls()[1]!.hasAttribute('data-kui-step-state')).toBe(false)
    expect(controls()[1]!.hasAttribute('style')).toBe(false)
  })

  it('marks inside jump buttons without granting them slide geometry', () => {
    const reporter = collectingReporter()
    animator = build(`<div id="deck" data-kui="carousel-stack target:a jump:.dot">${cards}${dots}</div>`, reporter)
    animator.start()
    expect(controls()[0]!.getAttribute('data-kui-step-state')).toBe('active')
    expect(controls().every(node => !node.hasAttribute('data-kui-step-offset') && !node.hasAttribute('data-kui-ring-face'))).toBe(true)
    expect([...host().querySelectorAll('a')].every(node => node.hasAttribute('data-kui-step-offset'))).toBe(true)
    expect(reporter.messages).toEqual([])
  })

  it('keeps signed control distance aligned with fractional spin, including wrapping', () => {
    start('carousel-3d jump:.dot spin:-4s')
    vi.advanceTimersByTime(512)
    const drift = value(host(), '--kui-step-position') - value(host(), '--kui-step')
    expect(Math.abs(drift)).toBeGreaterThan(0.1)
    expect(value(controls()[0]!, '--kui-step-distance')).toBeCloseTo(-drift, 3)
    vi.advanceTimersByTime(512)
    expect(controls().filter(node => node.getAttribute('data-kui-step-state') === 'active')).toHaveLength(1)
    const active = Number(host().getAttribute('data-kui-step'))
    expect(controls()[active]!.getAttribute('data-kui-step-state')).toBe('active')
  })

  it('publishes the same fractional distance during direct dragging', () => {
    start('carousel-stack jump:.dot travel:200')
    for (const [type, x] of [['pointerdown', 0], ['pointermove', -60], ['pointermove', -80]] as const) {
      host().dispatchEvent(Object.assign(new Event(type, { bubbles: true }), {
        clientX: x, clientY: 0, pointerId: 1,
      }))
    }
    expect(value(host(), '--kui-step-position')).toBeCloseTo(0.4, 4)
    expect(controls()[0]!.style.getPropertyValue('--kui-step-distance')).toBe('-0.4')
    expect(controls()[1]!.style.getPropertyValue('--kui-step-distance')).toBe('0.6')
  })

  it('resolves inserted controls, respects inside-first scope and restores overlapping slide controls', () => {
    const reporter = collectingReporter()
    animator = build('<div id="deck" data-kui="carousel-stack jump:.dot"><a class="dot" href="#one">One</a><a class="dot" href="#two">Two</a></div><button class="dot">Outside</button>', reporter)
    animator.start()
    const outside = controls()[2]!
    expect(outside.hasAttribute('data-kui-step-state')).toBe(false)
    const added = document.createElement('a')
    added.className = 'dot'
    added.href = '#three'
    host().append(added)
    added.click()
    expect(added.getAttribute('data-kui-step-state')).toBe('active')
    expect(value(added, '--kui-step-distance')).toBe(0)
    const nodes = [...host().children]
    animator.destroy()
    animator = undefined
    expect(nodes.every(node => !node.hasAttribute('data-kui-step-state') && !node.hasAttribute('style'))).toBe(true)
    expect(reporter.messages).toEqual([])
  })

  it.each(['carousel-stack', 'carousel-3d'])('adds no timer output or jump query on spinning %s', effect => {
    const query = vi.spyOn(document, 'querySelectorAll')
    start(`${effect} spin:4s`)
    expect(query.mock.calls.every(([selector]) => !selector.includes('.dot'))).toBe(true)
    query.mockClear()
    const style = vi.spyOn(window, 'getComputedStyle')
    vi.advanceTimersByTime(500)
    expect(query).not.toHaveBeenCalled()
    expect(style).not.toHaveBeenCalled()
    expect(host().style.getPropertyValue('--kui-autoplay-progress')).toBe('')
    expect(controls().every(node => !node.hasAttribute('style'))).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    animator!.destroy()
    start(`${effect} jump:.dot`)
    expect(controls()[0]!.getAttribute('data-kui-step-state')).toBe('active')
  })
})

describe('opt-in autoplay clock', () => {
  it('starts at zero when reduced motion pauses autoplay, plays, resets and restores the authored value', () => {
    CAPS.reducedMotion = true
    const reporter = collectingReporter()
    animator = build(`<div id="deck" style="--kui-autoplay-progress:.7" data-kui="carousel-stack autoplay:2s timer:true target:a pause:.play">${cards}<button class="play">Play</button></div>`, reporter)
    animator.start()
    expect(value(host(), '--kui-autoplay-progress')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    const play = host().querySelector<HTMLButtonElement>('.play')!
    expect(play.getAttribute('aria-pressed')).toBe('true')
    play.click()
    expect(play.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(1008)
    expect(value(host(), '--kui-autoplay-progress')).toBeCloseTo(0.504, 2)
    vi.advanceTimersByTime(992)
    expect(host().getAttribute('data-kui-step')).toBe('1')
    expect(value(host(), '--kui-autoplay-progress')).toBe(0)
    animator.destroy()
    animator = undefined
    expect(host().style.getPropertyValue('--kui-autoplay-progress')).toBe('.7')
    expect(vi.getTimerCount()).toBe(0)
    expect(reporter.messages).toEqual([])
  })

  it('restarts a full period after hover, hidden-tab and manual-input pauses', () => {
    start('carousel-3d autoplay:-2s timer:true jump:.dot')
    vi.advanceTimersByTime(800)
    expect(value(host(), '--kui-autoplay-progress')).toBeGreaterThan(0.3)
    host().dispatchEvent(new Event('pointerenter'))
    expect(value(host(), '--kui-autoplay-progress')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    host().dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(2000)
    expect(host().getAttribute('data-kui-step')).toBe('2')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(vi.getTimerCount()).toBe(0)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(800)
    key('Home')
    expect(value(host(), '--kui-autoplay-progress')).toBe(0)
    vi.advanceTimersByTime(620)
    vi.advanceTimersByTime(1008)
    expect(value(host(), '--kui-autoplay-progress')).toBeCloseTo(0.5, 2)
  })

  it.each(['autoplay:2s', 'timer:true', 'spin:4s timer:true', 'autoplay:2s timer:false'])('leaves timer output absent with %s', options => {
    expect(start(`carousel-stack ${options}`).messages).toEqual([])
    if (options.startsWith('autoplay:')) expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(512)
    expect(host().style.getPropertyValue('--kui-autoplay-progress')).toBe('')
    animator!.destroy()
    start('carousel-stack autoplay:2s timer:true')
    vi.advanceTimersByTime(512)
    expect(value(host(), '--kui-autoplay-progress')).toBeGreaterThan(0.2)
  })

  it('uses the scheduler fallback when animation frames are unavailable', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.stubGlobal('cancelAnimationFrame', undefined)
    try {
      start('carousel-stack autoplay:2s timer:true')
      vi.advanceTimersByTime(1008)
      expect(value(host(), '--kui-autoplay-progress')).toBeCloseTo(0.504, 2)
      host().dispatchEvent(new Event('pointerenter'))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

it.each([
  'carousel-stack autoplay:3s timer:true target:a',
  'carousel-stack jump:.motion-scale-dot target:a',
  'carousel-stack jump:.motion-arrow-dot next:.motion-next prev:.motion-prev target:a',
  'carousel-stack jump:.motion-thumb target:a',
  'carousel-stack target:a',
])('round 5 authored markup compiles without warnings: %s', effect => {
  expect(start(effect, dots + '<button class="motion-next">Next</button><button class="motion-prev">Previous</button>').messages).toEqual([])
  if (effect.includes('jump:')) expect(controls()[0]!.getAttribute('data-kui-step-state')).toBe('active')
})
