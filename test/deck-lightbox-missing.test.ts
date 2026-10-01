// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { attachDeckViewer, deckLightbox } from '../src/core/deck-viewer.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import { registerCarousel, registerCore } from '../src/effects/index.js'
import { registerForms } from '../src/effects/forms/index.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'

/**
 * `lightbox:true` on a page that never loaded the showcase module.
 *
 * Its own file because the viewer is provided once per module graph, by `registerShowcase` — which
 * every suite using the full catalog calls. Vitest isolates each file's graph, so here nothing has
 * provided it, which is exactly the page this test is about: a deck built from the carousel and
 * forms registrations alone.
 */

let animator: Animator | undefined

afterEach(() => {
  animator?.destroy()
  animator = undefined
  document.body.replaceChildren()
})

function start(html: string, reporter: ReturnType<typeof collectingReporter>): void {
  document.body.innerHTML = html
  const registry = new Registry()
  registerCore(registry)
  registerCarousel(registry)
  registerForms(registry)
  animator = new Animator({
    root: document.body,
    registry,
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
  })
  animator.start()
}

// Hash links, so the click this suite proves is *not* intercepted has somewhere jsdom can navigate.
const CARDS = '<a href="#a"><img src="/a.jpg" alt="A"></a><a href="#b"><img src="/b.jpg" alt="B"></a>'

describe('lightbox:true without the showcase module', () => {
  it.each([
    ['carousel-3d', 'carousel'],
    ['carousel-stack', 'carousel-stack'],
    ['carousel', 'step-progress'],
  ])('%s warns once, naming why, and its cards stay plain links', (name, label) => {
    const reporter = collectingReporter()
    start(`<div data-kui="${name} lightbox:true">${CARDS}</div>`, reporter)
    const warnings = reporter.messages.filter((message) => message.includes('lightbox:true'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!).toContain(label)
    expect(warnings[0]!).toContain('showcase module')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('img')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('says nothing when the parameter is off', () => {
    const reporter = collectingReporter()
    start(`<div data-kui="carousel-3d">${CARDS}</div>`, reporter)
    expect(reporter.messages.filter((message) => message.includes('lightbox'))).toHaveLength(0)
  })

  it('attaches nothing and returns an inert release', () => {
    const host = document.createElement('div')
    const request = { host, cards: () => [], doc: document, reducedMotion: false }
    expect(attachDeckViewer(request)).toBeNull()
    const warned: string[] = []
    expect(() => deckLightbox(false, request, (message) => warned.push(message))()).not.toThrow()
    expect(warned).toEqual([])
  })
})
