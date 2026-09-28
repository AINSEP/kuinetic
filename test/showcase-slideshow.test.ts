// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { build, el } from './support/js-effect-harness.js'
import { createRegistry } from '../src/effects/index.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { SLIDESHOW_PRIMITIVE } from '../src/showcase/slideshow.js'

const LIST = '<ul><li>First</li><li>Second</li><li>Third</li></ul>'

function mount(name = 'carousel-fade', params = '', list = LIST) {
  const animator = build(
    `<section data-kui="${name} ${params}" aria-label="Features">${list}</section>`,
  )
  animator.start()
  return { animator, host: el() }
}

function dots(host: Element): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.kui-slideshow-dot')]
}

function pointer(type: string, x: number): Event {
  const event = new Event(type, { bubbles: true }) as Event & {
    clientX: number
    clientY: number
    pointerId: number
  }
  event.clientX = x
  event.clientY = 0
  event.pointerId = 1
  return event
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('showcase slideshow', () => {
  it('registers three names while the original carousel stays a plain step-progress', () => {
    const registry = createRegistry()
    for (const name of ['carousel-fade', 'carousel-slide', 'video-hero-slideshow']) {
      expect(registry.resolve(name)?.primitive.id).toBe('slideshow')
      expect(registry.resolve(name)?.preset.requiresOwnSubtree).toBe(true)
    }
    const original = registry.resolve('carousel')
    expect(original?.primitive.id).toBe('step-progress')
    expect(original?.preset.params?.scope).toBe('self')
    expect(registry.resolve('video-hero')?.primitive.id).toBe('background-media')
    const { host } = mount('carousel')
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    expect(host.hasAttribute('aria-roledescription')).toBe(false)
  })

  it('builds arrows and dots, with labelled dots and one current step', () => {
    const { animator, host } = mount()
    const controls = host.querySelector('.kui-slideshow-controls')!
    expect(controls.previousElementSibling).toBe(host.querySelector('ul'))
    expect(controls.querySelector('[aria-label="Previous slide"]')).not.toBeNull()
    expect(controls.querySelector('[aria-label="Next slide"]')).not.toBeNull()
    expect(dots(host)).toHaveLength(3)
    expect(dots(host)[1]?.getAttribute('aria-label')).toBe('Go to slide 2 of 3')
    expect(dots(host)[0]?.getAttribute('aria-current')).toBe('true')
    dots(host)[1]?.click()
    expect(host.getAttribute('data-kui-step')).toBe('1')
    expect(dots(host)[1]?.getAttribute('aria-current')).toBe('true')
    expect(dots(host)[0]?.hasAttribute('aria-current')).toBe(false)
    animator.destroy()
  })

  it('selects only dots or arrows when requested, and allows no built controls', () => {
    const dotsOnly = mount('carousel-fade', 'controls:dots')
    expect(dots(dotsOnly.host)).toHaveLength(3)
    expect(dotsOnly.host.querySelector('[aria-label="Previous slide"]')).toBeNull()
    dotsOnly.animator.destroy()
    const arrowsOnly = mount('carousel-slide', 'controls:arrows')
    expect(dots(arrowsOnly.host)).toHaveLength(0)
    expect(arrowsOnly.host.querySelector('[aria-label="Previous slide"]')).not.toBeNull()
    arrowsOnly.animator.destroy()
    const none = mount('carousel-fade', 'controls:none')
    expect(none.host.querySelector('.kui-slideshow-controls')).toBeNull()
    expect(none.host.querySelector('ul')?.getAttribute('aria-live')).toBe('polite')
    none.animator.destroy()
  })

  it('suppresses built controls when next: is authored and delegates to that control', () => {
    const { animator, host } = mount(
      'carousel-slide', 'next:.advance',
      '<ul><li>First</li><li>Second</li></ul><button class="advance">Next</button>',
    )
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    host.querySelector<HTMLButtonElement>('.advance')?.click()
    expect(host.getAttribute('data-kui-step')).toBe('1')
    animator.destroy()
  })

  it('lets authored jump: buttons select slides by document order', () => {
    const list = '<ul><li>First</li><li>Second</li><li>Third</li></ul><nav><button class="jump">One</button><button class="jump">Two</button><button class="jump">Three</button></nav>'
    const { animator, host } = mount('carousel-fade', 'jump:.jump', list)
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    host.querySelectorAll<HTMLButtonElement>('.jump')[2]!.click()
    expect(host.getAttribute('data-kui-step')).toBe('2')
    animator.destroy()
  })

  it('selects authored target: slides inside the host and leaves other list items alone', () => {
    const list = '<ul><li class="slide">First</li><li>Decoration</li><li class="slide">Second</li></ul>'
    const { animator, host } = mount('carousel-fade', 'target:.slide', list)
    const items = host.querySelectorAll('li')
    expect(dots(host)).toHaveLength(2)
    expect(items[0]?.getAttribute('data-kui-step-state')).toBe('active')
    expect(items[1]?.hasAttribute('data-kui-step-state')).toBe(false)
    dots(host)[1]?.click()
    expect(items[2]?.getAttribute('data-kui-step-state')).toBe('active')
    animator.destroy()
  })

  it('warns and leaves markup alone when target: matches no slides', () => {
    const reporter = collectingReporter()
    const animator = build(
      `<section data-kui="carousel-fade target:.missing" aria-label="Features">${LIST}</section>`,
      reporter,
    )
    const host = el()
    const before = host.innerHTML
    animator.start()
    expect(host.innerHTML).toBe(before)
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    expect(reporter.messages.some((message) => message.includes('matched no slides'))).toBe(true)
    animator.destroy()
  })

  it('rejects an invalid CSS target selector before querying slides', () => {
    document.body.innerHTML = `<section aria-label="Features">${LIST}</section>`
    const host = document.body.firstElementChild!
    const warnings: string[] = []
    const params = readEffectParams(
      { target: ':unknown-pseudo' }, SLIDESHOW_PRIMITIVE.parameters, (message) => warnings.push(message),
    )
    const instance = SLIDESHOW_PRIMITIVE.prepare!(host, params, {
      doc: document, win: window, reducedMotion: false,
      warn: (message: string) => warnings.push(message), style: createStyleLedger(host),
    } as unknown as PrepareContext)
    instance.activate()
    expect(warnings.some((message) => message.includes('not a valid selector'))).toBe(true)
    expect(warnings.some((message) => message.includes('matched no slides'))).toBe(true)
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    instance.cancel()
  })

  it('accepts a nested slide list and places its controls at the end of the host', () => {
    const nested = '<div><ul><li class="slide">First</li><li class="slide">Second</li></ul></div>'
    const { animator, host } = mount('carousel-fade', 'target:.slide', nested)
    const controls = host.querySelector('.kui-slideshow-controls')!
    expect(controls.parentElement).toBe(host)
    expect(controls.previousElementSibling).toBe(host.querySelector('div'))
    expect(host.querySelector('ul')?.hasAttribute('data-kui-slideshow-list')).toBe(true)
    animator.destroy()
  })

  it('rejects target: slides spread across two lists instead of silently failing to style them', () => {
    const reporter = collectingReporter()
    const animator = build(
      '<section data-kui="carousel-fade target:.slide" aria-label="Features"><ul><li class="slide">One</li></ul><ul><li class="slide">Two</li></ul></section>',
      reporter,
    )
    animator.start()
    expect(el().querySelector('.kui-slideshow-controls')).toBeNull()
    expect(reporter.messages.some((message) => message.includes('share one list'))).toBe(true)
    animator.destroy()
  })

  it('keeps the list visible before startup and hands the markup back on destroy', () => {
    const animator = build(`<section data-kui="carousel-fade" aria-labelledby="deck-title">${LIST}</section>`)
    const host = el()
    const before = host.innerHTML
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    expect(host.querySelector('li')?.hasAttribute('inert')).toBe(false)
    animator.start()
    expect(host.querySelector('.kui-slideshow-controls')).not.toBeNull()
    animator.destroy()
    expect(host.innerHTML).toBe(before)
    expect(host.hasAttribute('role')).toBe(false)
  })

  it('uses authored region labels and timing tokens', () => {
    const { animator, host } = mount('carousel-fade', '800ms ease-in')
    expect(host.style.getPropertyValue('--kui-slideshow-duration')).toBe('800ms')
    expect(host.style.getPropertyValue('--kui-slideshow-ease')).toBe('ease-in')
    animator.destroy()
    expect(host.style.getPropertyValue('--kui-slideshow-duration')).toBe('')
    expect(host.style.getPropertyValue('--kui-slideshow-ease')).toBe('')
  })

  it('honours an authored transition mode over the preset default', () => {
    const { animator, host } = mount('carousel-fade', 'transition:slide')
    expect(host.getAttribute('data-kui-slideshow-mode')).toBe('slide')
    animator.destroy()
    expect(host.hasAttribute('data-kui-slideshow-mode')).toBe(false)
  })

  it('disables autoplay when controls are suppressed so a moving deck always has a pause button', () => {
    vi.useFakeTimers()
    const reporter = collectingReporter()
    const animator = build(
      `<section data-kui="carousel-fade autoplay:2s controls:none" aria-label="Features">${LIST}</section>`,
      reporter,
    )
    animator.start()
    const host = el()
    vi.advanceTimersByTime(5000)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
    expect(reporter.messages.some((message) => message.includes('autoplay needs a pause control'))).toBe(true)
    animator.destroy()
  })

  it('stamps region and slide semantics, marks inactive slides inert, and restores them', () => {
    const { animator, host } = mount('carousel-fade', '', '<ul><li role="option">First</li><li inert>Second</li></ul>')
    const slides = host.querySelectorAll('li')
    const first = slides[0]!
    const second = slides[1]!
    expect(host.getAttribute('role')).toBe('region')
    expect(host.getAttribute('aria-roledescription')).toBe('carousel')
    expect(first.getAttribute('role')).toBe('option')
    expect(first.getAttribute('aria-roledescription')).toBe('slide')
    expect(first.getAttribute('aria-label')).toBe('1 of 2')
    expect(first.hasAttribute('inert')).toBe(false)
    expect(second.hasAttribute('inert')).toBe(true)
    dots(host)[1]!.click()
    expect(first.hasAttribute('inert')).toBe(true)
    expect(second.hasAttribute('inert')).toBe(false)
    animator.destroy()
    expect(host.hasAttribute('role')).toBe(false)
    expect(host.hasAttribute('aria-roledescription')).toBe(false)
    expect(first.getAttribute('role')).toBe('option')
    expect(first.hasAttribute('aria-label')).toBe(false)
    expect(second.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('.kui-slideshow-controls')).toBeNull()
  })

  it('warns when the region has no accessible name', () => {
    const reporter = collectingReporter()
    const animator = build(`<section data-kui="carousel-fade">${LIST}</section>`, reporter)
    animator.start()
    expect(reporter.messages.some((message) => message.includes('aria-label or aria-labelledby'))).toBe(true)
    animator.destroy()
  })

  it('starts paused for reduced motion and allows an explicit Play press', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `<section aria-label="Features">${LIST}</section>`
    const host = document.body.firstElementChild!
    const params = readEffectParams(
      { autoplay: '2s' }, SLIDESHOW_PRIMITIVE.parameters, () => {},
    )
    const instance = SLIDESHOW_PRIMITIVE.prepare!(host, params, {
      doc: document, win: window, reducedMotion: true, warn: () => {},
      style: createStyleLedger(host),
    } as unknown as PrepareContext)
    instance.activate()
    const pause = host.querySelector<HTMLButtonElement>('[aria-label="Play slideshow"]')!
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(3000)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    pause.click()
    vi.advanceTimersByTime(2000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    instance.cancel()
  })

  it('autoplays, pauses for pointer and focus, and keeps a user pause sticky', () => {
    vi.useFakeTimers()
    const { animator, host } = mount('video-hero-slideshow', 'autoplay:2s')
    const list = host.querySelector('ul')!
    const pause = host.querySelector<HTMLButtonElement>('[aria-label="Pause slideshow"]')!
    expect(list.getAttribute('aria-live')).toBe('off')
    vi.advanceTimersByTime(2000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    host.dispatchEvent(new Event('pointerenter'))
    expect(list.getAttribute('aria-live')).toBe('polite')
    vi.advanceTimersByTime(3000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    host.dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(2000)
    expect(host.getAttribute('data-kui-step')).toBe('2')
    host.dispatchEvent(new Event('focusin'))
    vi.advanceTimersByTime(3000)
    expect(host.getAttribute('data-kui-step')).toBe('2')
    host.dispatchEvent(new Event('focusout'))
    pause.click()
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    expect(pause.getAttribute('aria-label')).toBe('Play slideshow')
    vi.advanceTimersByTime(3000)
    expect(host.getAttribute('data-kui-step')).toBe('2')
    animator.destroy()
  })

  it('defaults the hero slideshow to seven-second autoplay with dots and a pause button', () => {
    vi.useFakeTimers()
    const { animator, host } = mount('video-hero-slideshow')
    expect(dots(host)).toHaveLength(3)
    expect(host.querySelector('[aria-label="Previous slide"]')).toBeNull()
    expect(host.querySelector('[aria-label="Pause slideshow"]')).not.toBeNull()
    vi.advanceTimersByTime(6999)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    vi.advanceTimersByTime(1)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    animator.destroy()
  })

  it('pauses while the document is hidden', () => {
    vi.useFakeTimers()
    const { animator, host } = mount('video-hero-slideshow', 'autoplay:2s')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(3000)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(2000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    animator.destroy()
  })

  it('clamps a short autoplay interval to two seconds and warns', () => {
    vi.useFakeTimers()
    const reporter = collectingReporter()
    const animator = build(`<section data-kui="carousel-fade autoplay:500ms" aria-label="Features">${LIST}</section>`, reporter)
    animator.start()
    const host = el()
    vi.advanceTimersByTime(500)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    vi.advanceTimersByTime(1499)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    vi.advanceTimersByTime(1)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    expect(reporter.messages.some((message) => message.includes('clamped to 2s'))).toBe(true)
    animator.destroy()
  })

  it('recognises a left swipe and lets a focused dot move right', () => {
    vi.useFakeTimers()
    const { animator, host } = mount()
    host.dispatchEvent(pointer('pointerdown', 100))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointermove', 20))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointerup', 0))
    expect(host.getAttribute('data-kui-step')).toBe('1')
    dots(host)[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('2')
    expect(document.activeElement).toBe(dots(host)[2])
    animator.destroy()
  })

  it('turns swipe off when requested and supports backwards keyboard and arrow controls', () => {
    vi.useFakeTimers()
    const { animator, host } = mount('carousel-slide', 'swipe:false')
    host.dispatchEvent(pointer('pointerdown', 100))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointermove', 20))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointerup', 0))
    expect(host.getAttribute('data-kui-step')).toBe('0')
    host.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!.click()
    expect(host.getAttribute('data-kui-step')).toBe('2')
    host.querySelector<HTMLButtonElement>('[aria-label="Next slide"]')!.click()
    expect(host.getAttribute('data-kui-step')).toBe('0')
    host.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!.click()
    dots(host)[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('1')
    host.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('1')
    dots(host)[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(host.getAttribute('data-kui-step')).toBe('1')
    animator.destroy()
  })

  it('recognises a right swipe as previous', () => {
    vi.useFakeTimers()
    const { animator, host } = mount()
    host.dispatchEvent(pointer('pointerdown', 0))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointermove', 80))
    vi.advanceTimersByTime(20)
    host.dispatchEvent(pointer('pointerup', 100))
    expect(host.getAttribute('data-kui-step')).toBe('2')
    animator.destroy()
  })

  it('warns when mute: does not name a button', () => {
    const reporter = collectingReporter()
    const animator = build(
      `<section data-kui="carousel-fade mute:.missing" aria-label="Features">${LIST}</section>`,
      reporter,
    )
    animator.start()
    expect(reporter.messages.some((message) => message.includes('mute: must select a button'))).toBe(true)
    animator.destroy()
  })

  it('toggles the active video mute state and restores authored button attributes', () => {
    const list = '<ul><li><video></video><button class="sound" aria-label="Audio">Sound</button></li><li><video></video><button class="sound" aria-label="Audio">Sound</button></li></ul>'
    const { animator, host } = mount('video-hero-slideshow', 'mute:.sound autoplay:0s', list)
    const videos = host.querySelectorAll('video')
    const buttons = host.querySelectorAll<HTMLButtonElement>('.sound')
    const sound = buttons[0]!
    expect(sound.getAttribute('aria-pressed')).toBe('false')
    sound.click()
    expect(videos[0]?.muted).toBe(true)
    expect(sound.getAttribute('aria-label')).toBe('Unmute video')
    sound.click()
    expect(videos[0]?.muted).toBe(false)
    dots(host)[1]?.click()
    buttons[1]?.click()
    expect(videos[1]?.muted).toBe(true)
    animator.destroy()
    expect(videos[0]?.muted).toBe(false)
    expect(videos[1]?.muted).toBe(false)
    expect(sound.getAttribute('aria-label')).toBe('Audio')
    expect(sound.hasAttribute('aria-pressed')).toBe(false)
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Audio')
  })

  it('leaves a mute button operable when the current slide has no video', () => {
    const { animator, host } = mount(
      'carousel-fade', 'mute:.sound',
      '<ul><li>First</li><li>Second</li></ul><button class="sound">Sound</button>',
    )
    const button = host.querySelector<HTMLButtonElement>('.sound')!
    button.click()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    animator.destroy()
  })
})
