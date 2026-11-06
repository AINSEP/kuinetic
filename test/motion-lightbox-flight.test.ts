// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { CAPS, build, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'
import { flightDom, flushFlight } from './support/image-flight-harness.js'
import { ruleBodies } from './support/css-scan.js'

let app: Animator | undefined
afterEach(() => { app?.destroy(); app = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete (Element.prototype as any).animate; delete (HTMLImageElement.prototype as any).decode; document.body.replaceChildren() })
const dialog = (): HTMLDialogElement => document.querySelector('dialog')!
const view = (): HTMLImageElement => dialog().querySelector('figure img')!
const open = (): void => document.querySelector<HTMLAnchorElement>('a')!.click()
const escape = (): void => {
  const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  dialog().dispatchEvent(key)
  if (!key.defaultPrevented) dialog().close()
}
const markup = '<a data-kui="lightbox flight:true" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>'

describe('opt-in lightbox image flight', () => {
  it('cancels and unsubscribes on visual viewport resize', async () => {
    const viewport = new EventTarget()
    const remove = vi.spyOn(viewport, 'removeEventListener')
    vi.stubGlobal('visualViewport', viewport)
    flightDom()
    app = build(markup)
    app.start()
    open()
    await flushFlight()
    viewport.dispatchEvent(new Event('resize'))
    await flushFlight()
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(view().style.visibility).toBe('')
  })

  it.each(['fill', 'cover'])('flies tall %s images to their visible viewport slice and back', async (fit) => {
    const { calls } = flightDom()
    app = build(markup)
    app.start()
    const source = document.querySelector('a img')! as HTMLImageElement
    Object.defineProperty(source, 'naturalHeight', { value: 1200 })
    source.style.objectFit = fit
    open()
    view().getBoundingClientRect = () => new DOMRect(300, 100, 400, 1200)
    await flushFlight()
    const clip = `inset(0px 0px ${1300 - window.innerHeight}px 0px round 0px)`
    expect(calls[0]!.frames[1]!.clipPath).toBe(clip)
    calls[0]!.finish()
    await flushFlight()
    escape()
    expect(calls[1]!.frames[0]!.clipPath).toBe(clip)
    calls[1]!.finish()
    await flushFlight()
    expect(dialog().open).toBe(false)
  })

  it('returns a navigated gallery image to its current visible thumbnail', async () => {
    const { calls } = flightDom()
    app = build('<div data-kui="lightbox flight:true"><a href="/first.jpg"><img src="/first-thumb.jpg" alt="First"></a><a href="/second.jpg"><img src="/second-thumb.jpg" alt="Second"></a></div>')
    app.start()
    open()
    await flushFlight()
    calls[0]!.finish()
    await flushFlight()
    document.querySelectorAll('a img')[1]!.getBoundingClientRect = () => new DOMRect(180, 70, 100, 75)
    dialog().querySelector<HTMLButtonElement>('.kui-lightbox-next')!.click()
    await flushFlight()
    expect(view().src).toContain('/second.jpg')
    escape()
    expect(calls[1]!.node.getAttribute('src')).toContain('/second.jpg')
    expect(calls[1]!.frames[1]).toEqual({ translate: '-120px -80px', scale: '0.25 0.25' })
    calls[1]!.finish()
    await flushFlight()
    expect(dialog().open).toBe(false)
  })

  it.each(['escape', 'navigation'])('does not launch an old pending decode after %s', async (action) => {
    vi.useFakeTimers()
    const { calls } = flightDom()
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    let decoded!: () => void
    HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => { decoded = resolve })
    app = build('<div data-kui="lightbox flight:true"><a href="/first.jpg"><img src="/first-thumb.jpg" alt="First"></a><a href="/second.jpg"><img src="/second-thumb.jpg" alt="Second"></a></div>')
    app.start()
    open()
    if (action === 'escape') escape()
    else dialog().querySelector<HTMLButtonElement>('.kui-lightbox-next')!.click()
    await flushFlight()
    decoded()
    await flushFlight()
    expect(calls).toHaveLength(0)
    if (action === 'escape') {
      vi.advanceTimersByTime(280)
      expect(dialog().open).toBe(false)
    } else expect(view().style.visibility).toBe('')
  })

  it.each(['initial', 'navigated'])('keeps %s video items on plain close', async (where) => {
    vi.useFakeTimers()
    const { calls } = flightDom()
    app = build('<div data-kui="lightbox flight:true media:mixed"><a href="/first.jpg"><img src="/thumb.jpg" alt="First"></a><a href="https://vimeo.com/76979871"><img src="/poster.jpg" alt="Video"></a></div>')
    app.start()
    document.querySelectorAll<HTMLAnchorElement>('a')[where === 'initial' ? 1 : 0]!.click()
    if (where === 'navigated') {
      await flushFlight()
      dialog().querySelector<HTMLButtonElement>('.kui-lightbox-next')!.click()
      await flushFlight()
      expect(calls[0]!.cancel).toHaveBeenCalled()
    } else {
      expect(dialog().classList.contains('kui-lightbox-flight')).toBe(false)
      expect(calls).toHaveLength(0)
    }
    escape()
    vi.advanceTimersByTime(280)
    expect(dialog().open).toBe(false)
    expect(document.querySelector('.kui-image-flight')).toBeNull()
  })
  it('restores the real view and reports one native animation failure', async () => {
    flightDom()
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: () => { throw new Error('native flight failure') } })
    const reporter = collectingReporter()
    app = build(markup, reporter)
    app.start()
    open()
    await flushFlight()
    expect(view().style.visibility).toBe('')
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toContain('native flight failure')
  })
  it('flies in the top layer, keeps the real view hidden until landing, then reverses to the live thumbnail', async () => {
    const { calls } = flightDom()
    const reporter = collectingReporter()
    app = build(markup, reporter)
    const dim = document.createElement('style')
    dim.textContent = 'dialog.kui-lightbox[open] { background: rgba(10, 20, 30, 0.5); }'
    document.body.append(dim)
    app.start()
    open()
    expect(view().style.visibility).toBe('hidden')
    await flushFlight()
    expect(calls).toHaveLength(1)
    const flyer = calls[0]!.node
    expect(flyer.parentElement).toBe(dialog())
    expect(dialog().classList.contains('kui-lightbox-flight')).toBe(true)
    expect(dialog().style.getPropertyValue('--kui-flight-dim')).toBe('rgba(10, 20, 30, 0.5)')
    expect(calls[0]!.frames[0]).toEqual({ translate: '-260px -100px', scale: '0.25 0.25' })
    calls[0]!.finish()
    await flushFlight()
    expect(view().style.visibility).toBe('')
    document.querySelector('a img')!.getBoundingClientRect = () => new DOMRect(90, 60, 100, 75)
    escape()
    expect(dialog().open).toBe(true)
    expect(calls[1]!.frames[1]).toEqual({ translate: '-210px -90px', scale: '0.25 0.25' })
    calls[1]!.finish()
    await flushFlight()
    expect(dialog().open).toBe(false)
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(reporter.messages).toEqual([])
  })

  it('reverses Escape mid-flight without creating another flyer', async () => {
    const { calls } = flightDom()
    app = build(markup)
    app.start()
    open()
    await flushFlight()
    escape()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.reverse).toHaveBeenCalledOnce()
    expect(view().style.visibility).toBe('hidden')
    calls[0]!.finish()
    await flushFlight()
    expect(dialog().open).toBe(false)
  })

  it('waits for the larger linked image to decode before measuring its destination', async () => {
    const { calls } = flightDom()
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    let decoded!: () => void
    HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => { decoded = resolve })
    app = build(markup)
    app.start()
    open()
    expect(calls).toHaveLength(0)
    expect(view().getAttribute('src')).toContain('/full.jpg')
    decoded()
    await flushFlight()
    expect(calls).toHaveLength(1)
  })

  it.each(['timeout', 'failed', 'zero', 'offscreen', 'position', 'percent-radius', 'contain', 'none', 'scale-down'])('falls back for %s and restores plain close motion', async (kind) => {
    vi.useFakeTimers()
    const { calls } = flightDom()
    if (kind === 'timeout' || kind === 'failed') {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
      HTMLImageElement.prototype.decode = () => kind === 'failed' ? Promise.reject(new Error('decode')) : new Promise(() => {})
    }
    app = build(markup)
    app.start()
    const source = document.querySelector('a img')! as HTMLImageElement
    if (kind === 'zero') source.getBoundingClientRect = () => new DOMRect()
    if (kind === 'offscreen') source.getBoundingClientRect = () => new DOMRect(-200, -200, 100, 75)
    if (kind === 'position') { source.style.objectFit = 'cover'; source.style.objectPosition = 'left top' }
    if (kind === 'percent-radius') { source.style.objectFit = 'cover'; source.style.borderRadius = '50%' }
    if (['contain', 'none', 'scale-down'].includes(kind)) source.style.objectFit = kind
    open()
    vi.advanceTimersByTime(150)
    await flushFlight()
    expect(calls).toHaveLength(0)
    expect(dialog().classList.contains('kui-lightbox-flight')).toBe(false)
    expect(view().style.visibility).toBe('')
    escape()
    vi.advanceTimersByTime(280)
    expect(dialog().open).toBe(false)
  })

  it('uses a uniform cover scale and an animated clip for a differently cropped thumbnail', async () => {
    const { calls } = flightDom()
    app = build(markup)
    app.start()
    const source = document.querySelector('a img')! as HTMLImageElement
    source.style.objectFit = 'cover'
    source.style.objectPosition = '25% 50%'
    source.style.borderRadius = '10px'
    source.getBoundingClientRect = () => new DOMRect(40, 50, 100, 100)
    open()
    view().style.borderRadius = '8px'
    view().getBoundingClientRect = () => new DOMRect(300, 150, 400, 200)
    await flushFlight()
    const expected = [
      { translate: '-285px -100px', scale: '0.5', clipPath: 'inset(0px 150px 0px 50px round 20px)' },
      { translate: '0px 0px', scale: '1', clipPath: 'inset(0px 0px 0px 0px round 8px)' },
    ]
    expect(calls[0]!.frames).toEqual(expected)
    calls[0]!.finish()
    await flushFlight()
    escape()
    expect(calls[1]!.frames).toEqual([...expected].reverse())
  })

  it.each(['release', 'closeNow', 'reentry', 'scroll', 'resize', 'navigation', 'source-removed', 'thumbnail-removed'])('cleans owned motion on %s', async (exit) => {
    vi.useFakeTimers()
    const { calls } = flightDom()
    app = build(markup)
    app.start()
    open()
    await flushFlight()
    if (exit === 'release') app.destroy()
    if (exit === 'closeNow') dialog().close()
    if (exit === 'reentry') { escape(); open() }
    if (exit === 'scroll' || exit === 'resize') window.dispatchEvent(new Event(exit))
    if (exit === 'navigation') view().src = '/next.jpg'
    const removed: Record<string, string> = { 'source-removed': 'a', 'thumbnail-removed': 'a img' }
    if (removed[exit]) { calls[0]!.finish(); await flushFlight(); document.querySelector(removed[exit]!)!.remove(); escape(); vi.advanceTimersByTime(280) }
    await flushFlight()
    expect(calls[0]!.cancel).toHaveBeenCalled()
    expect(document.querySelectorAll('.kui-image-flight')).toHaveLength(exit === 'reentry' ? 1 : 0)
    if (exit === 'reentry') {
      vi.advanceTimersByTime(330)
      expect(dialog().open).toBe(true)
    }
  })

  it('cannot resurrect a flyer after release during decode', async () => {
    const { calls } = flightDom()
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    let decoded!: () => void
    HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => { decoded = resolve })
    app = build(markup)
    app.start()
    open()
    app.destroy()
    decoded()
    await flushFlight()
    expect(calls).toHaveLength(0)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('skips flight under reduced motion and keeps ordinary CSS defaults intact', async () => {
    const { calls } = flightDom()
    document.body.innerHTML = markup
    app = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: { ...CAPS, reducedMotion: true },
      binder: createActivationBinder({ createObserver: undefined }), scheduler: idleScheduler, rootResolver: () => fakeRoot })
    app.start()
    open()
    await flushFlight()
    expect(calls).toHaveLength(0)
    expect(dialog().classList.contains('kui-lightbox-flight')).toBe(false)
    const css = readFileSync('src/showcase/showcase.css', 'utf8')
    expect(ruleBodies(css, 'dialog.kui-lightbox[open]')[0]).toContain('opacity: 0;')
    expect(ruleBodies(css, 'dialog.kui-lightbox[open]')[0]).toContain('background: rgb(8 9 10 / 0.58);')
    expect(ruleBodies(css, 'dialog.kui-lightbox.kui-lightbox-flight[open]')[0]).toContain('opacity: 1;')
    expect(ruleBodies(css, 'dialog.kui-lightbox.kui-lightbox-flight[open]')[0]).toContain('background: transparent;')
    expect(ruleBodies(css, 'dialog.kui-lightbox.kui-lightbox-flight::backdrop')[0]).toContain('background: var(--kui-flight-dim);')
    expect(ruleBodies(css, '.kui-lightbox.kui-lightbox-flight .kui-lightbox-gallery')[0]).toContain('scale: none;')
    expect(ruleBodies(css, '.kui-lightbox.kui-lightbox-flight .kui-lightbox-gallery')[0]).toContain('translate: none;')
    expect(ruleBodies(css, '.kui-lightbox.kui-lightbox-flight .kui-lightbox-gallery')[0]).toContain('transition: none;')
  })
})
