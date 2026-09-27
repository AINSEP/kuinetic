// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

const showcaseCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'), 'utf8')

const active: Array<ReturnType<typeof build>> = []
const start = (html: string, reporter?: ReturnType<typeof collectingReporter>): ReturnType<typeof build> => {
  const animator = build(html, reporter)
  active.push(animator)
  animator.start()
  return animator
}
const dialog = (): HTMLDialogElement => document.querySelector('dialog.kui-lightbox') as HTMLDialogElement
const click = (target: Element, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
})

afterEach(() => {
  for (const animator of active.splice(0).reverse()) animator.destroy()
  vi.useRealTimers()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

describe('lightbox', () => {
  it('opens a linked image on an unmodified primary click and preserves modified clicks', () => {
    start('<a data-kui="lightbox" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    const link = document.querySelector('a')!
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(click(link, init).defaultPrevented).toBe(false)
      expect(document.querySelector('dialog')).toBeNull()
    }
    expect(click(link).defaultPrevented).toBe(true)
    expect(dialog().open).toBe(true)
    expect(dialog().querySelector('img')?.alt).toBe('Map')
    expect(dialog().getAttribute('aria-label')).toBe('Image viewer')
  })

  it('makes a bare image keyboard operable and restores its authored attributes', () => {
    const animator = start('<img data-kui="lightbox" src="/photo.jpg" alt="Lake" role="presentation">')
    const image = document.querySelector('img')!
    expect(image.getAttribute('role')).toBe('button')
    expect(image.tabIndex).toBe(0)
    expect(image.getAttribute('aria-label')).toBe('Open larger image: Lake')
    image.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(dialog().open).toBe(true)
    animator.destroy()
    expect(image.getAttribute('role')).toBe('presentation')
    expect(image.hasAttribute('tabindex')).toBe(false)
    expect(image.hasAttribute('aria-label')).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('opens a bare image with Space', () => {
    start('<img data-kui="lightbox" src="/photo.jpg" alt="Lake">')
    document.querySelector('img')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(dialog().open).toBe(true)
  })

  it('width-caps a tall screenshot so the dialog can scroll', () => {
    start('<img data-kui="lightbox" src="/tall.jpg" alt="Long page">')
    const image = document.querySelector('img')!
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 2400 } })
    click(image)
    expect(dialog().querySelector('img')?.classList.contains('is-tall')).toBe(true)
  })

  it('navigates a gallery by keys, wraps, and chooses figcaption over alt', () => {
    start('<div data-kui="lightbox"><figure><a href="/a.jpg"><img src="/a-small.jpg" alt="Alt A"></a><figcaption>Caption A</figcaption></figure><a href="/b.jpg"><img src="/b-small.jpg" alt="Alt B"></a></div>')
    click(document.querySelector('a')!)
    expect(dialog().querySelector('figcaption')?.textContent).toBe('Caption A')
    expect(dialog().querySelector('.kui-lightbox-counter')?.textContent).toBe('1 of 2')
    expect(dialog().querySelector('.kui-lightbox-counter')?.getAttribute('aria-hidden')).toBe('true')
    expect(dialog().querySelector('.kui-lightbox-prev')?.getAttribute('aria-label')).toBe('Previous image')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('Alt B')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('Alt A')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('Alt B')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('Alt A')
  })

  it('leaves unrelated gallery keys available to the browser', () => {
    start('<div data-kui="lightbox"><a href="/a.jpg"><img src="/a.png" alt="A"></a><a href="/b.jpg"><img src="/b.png" alt="B"></a></div>')
    click(document.querySelector('a')!)
    const key = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    dialog().dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    expect(dialog().querySelector('img')?.alt).toBe('A')
  })

  it('keeps single-image gallery keys available and labels a bare image without alt', () => {
    start('<img data-kui="lightbox" src="/solo.jpg" alt="">')
    const image = document.querySelector('img')!
    expect(image.getAttribute('aria-label')).toBe('Open larger image')
    image.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.querySelector('dialog')).toBeNull()
    click(image)
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    dialog().dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    expect(dialog().querySelector('img')?.src).toContain('/solo.jpg')
  })

  it('ignores links without images', () => {
    start('<div data-kui="lightbox"><a href="/empty.jpg">No image</a><a href="/full.jpg"><img src="/thumb.jpg" alt="Image"></a></div>')
    const links = document.querySelectorAll('a')
    click(links[0]!)
    expect(document.querySelector('dialog')).toBeNull()
    click(links[1]!)
    expect(dialog().querySelector('img')?.alt).toBe('Image')
  })

  it('uses an authored image target and safely skips invalid or empty targets', () => {
    start('<div data-kui="lightbox target:\'.photo\'"><img class="photo" src="/a.jpg" alt="A"><img src="/b.jpg" alt="B"></div>')
    click(document.querySelector('.photo')!)
    expect(dialog().querySelector('img')?.alt).toBe('A')

    const reporter = collectingReporter()
    start('<div data-kui="lightbox target:\'[\'"><img src="/c.jpg" alt="C"></div>', reporter)
    expect(reporter.messages.join()).toContain('not a valid selector')
    expect(document.querySelectorAll('dialog')).toHaveLength(0)

    start('<div data-kui="lightbox"></div>')
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
  })

  it('holds the gallery at the ends when loop:false', () => {
    start('<div data-kui="lightbox loop:false"><a href="/a.jpg"><img src="/a.png" alt="A"></a><a href="/b.jpg"><img src="/b.png" alt="B"></a></div>')
    click(document.querySelector('a')!)
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('A')
    expect((dialog().querySelector('.kui-lightbox-prev') as HTMLButtonElement).disabled).toBe(true)
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(dialog().querySelector('img')?.alt).toBe('B')
    expect((dialog().querySelector('.kui-lightbox-next') as HTMLButtonElement).disabled).toBe(true)
  })

  it('animates Escape dismissal with a timer and releases the scroll lock', () => {
    vi.useFakeTimers()
    document.documentElement.style.overflow = 'scroll'
    start('<a data-kui="lightbox duration:50ms" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    expect(document.documentElement.style.overflow).toBe('hidden')
    const cancel = new Event('cancel', { cancelable: true })
    dialog().dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog().open).toBe(true)
    vi.advanceTimersByTime(49)
    expect(dialog().open).toBe(true)
    vi.advanceTimersByTime(1)
    expect(dialog().open).toBe(false)
    expect(document.documentElement.style.overflow).toBe('scroll')
    document.documentElement.style.removeProperty('overflow')
  })

  it('releases one scroll lock after repeated opens', () => {
    vi.useFakeTimers()
    document.documentElement.style.overflow = 'auto'
    start('<a data-kui="lightbox duration:10ms" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    click(document.querySelector('a')!)
    dialog().querySelector('button')!.click()
    vi.advanceTimersByTime(10)
    expect(document.documentElement.style.overflow).toBe('auto')
  })

  it('also releases the scroll lock when the dialog closes directly', () => {
    start('<a data-kui="lightbox" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    expect(document.documentElement.style.overflow).toBe('hidden')
    dialog().close()
    expect(document.documentElement.style.overflow).toBe('')
    expect(dialog().querySelector('img')).toBeNull()
  })

  it('dismisses when the dialog backdrop is clicked', () => {
    vi.useFakeTimers()
    start('<a data-kui="lightbox duration:10ms" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    click(dialog())
    vi.advanceTimersByTime(10)
    expect(dialog().open).toBe(false)
  })

  it('keeps the gallery open when its image is clicked', () => {
    vi.useFakeTimers()
    start('<a data-kui="lightbox duration:10ms" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    click(dialog().querySelector('img')!)
    vi.advanceTimersByTime(10)
    expect(dialog().open).toBe(true)
  })

  it('closes immediately for a reduced-motion visitor', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<a data-kui="lightbox" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>'
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: defaultCapabilities({ reducedMotion: true }),
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
    })
    active.push(animator)
    animator.start()
    click(document.querySelector('a')!)
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    vi.advanceTimersByTime(0)
    expect(dialog().open).toBe(false)
  })

  it('restores scroll styles and removes the dialog during teardown mid-open', () => {
    const before = document.documentElement.getAttribute('style')
    const animator = start('<a data-kui="lightbox" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    expect(document.documentElement.style.overflow).toBe('hidden')
    animator.destroy()
    expect(document.documentElement.getAttribute('style')).toBe(before)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('keeps the shared dialog until the last instance tears down', () => {
    const animator = start('<div><a data-kui="lightbox" href="/a.jpg"><img src="/a.png" alt="A"></a><a data-kui="lightbox" href="/b.jpg"><img src="/b.png" alt="B"></a></div>')
    const links = document.querySelectorAll('a')
    click(links[0]!)
    const shared = dialog()
    animator.reset(links[0]!)
    expect(dialog()).toBe(shared)
    click(links[1]!)
    expect(dialog()).toBe(shared)
    animator.destroy()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('keeps a closed modal out of hit testing and removes motion in CSS', () => {
    expect(showcaseCss).toContain('dialog.kui-lightbox { display: none; }')
    expect(showcaseCss).toContain('dialog.kui-lightbox[open]')
    expect(showcaseCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(showcaseCss).toContain('@media (forced-colors: active)')
  })
})

describe('video-lightbox', () => {
  it('finds links in a video container and keeps modified clicks as navigation', () => {
    start('<div data-kui="video-lightbox"><a href="/tour.mp4">Tour</a></div>')
    const link = document.querySelector('a')!
    expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
    expect(click(link).defaultPrevented).toBe(true)
    expect(dialog().querySelector('video')).not.toBeNull()
  })

  it('uses poster alt, link text, then a fallback for video titles', () => {
    start('<div data-kui="video-lightbox"><a href="/a.mp4"><img src="/a.png" alt="Poster"></a><a href="/b.mp4">Text title</a><a href="/c.mp4"></a></div>')
    const links = document.querySelectorAll('a')
    click(links[0]!)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('Poster')
    click(links[1]!)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('Text title')
    click(links[2]!)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('Video')
  })

  it('pauses loaded direct media when the viewer closes', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    start('<a data-kui="video-lightbox" href="/tour.mp4">Tour</a>')
    click(document.querySelector('a')!)
    const video = dialog().querySelector('video')!
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 })
    dialog().close()
    expect(pause).toHaveBeenCalledOnce()
    expect(video.hasAttribute('src')).toBe(false)
  })

  it('ignores non-links selected by target and handles a link whose href was removed', () => {
    const reporter = collectingReporter()
    start('<div data-kui="video-lightbox target:\'.clip\'"><img class="clip" src="/poster.png" alt="Poster"><a class="clip" href="/tour.mp4">Tour</a></div>', reporter)
    const link = document.querySelector('a')!
    link.removeAttribute('href')
    expect(click(link).defaultPrevented).toBe(false)
    expect(reporter.messages.join()).toContain('cannot embed')
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('opens a privacy-hosted iframe and empties the frame on close', () => {
    vi.useFakeTimers()
    start('<a data-kui="video-lightbox duration:20ms" href="https://youtu.be/dQw4w9WgXcQ" title="Tour"><img src="/poster.png" alt="Poster"></a>')
    expect(click(document.querySelector('a')!).defaultPrevented).toBe(true)
    const frame = dialog().querySelector('.kui-lightbox-frame')!
    const iframe = frame.querySelector('iframe')!
    expect(iframe.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')
    expect(iframe.title).toBe('Tour')
    dialog().querySelector('button')!.click()
    vi.advanceTimersByTime(20)
    expect(frame.childElementCount).toBe(0)
    expect(dialog().open).toBe(false)
  })

  it('builds a native player for a direct file', () => {
    start('<a data-kui="video-lightbox aspect:square" href="/tour.mp4">Tour</a>')
    click(document.querySelector('a')!)
    expect(dialog().querySelector('.kui-lightbox-frame--square')).not.toBeNull()
    const video = dialog().querySelector('video')!
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(true)
    expect(video.playsInline).toBe(true)
    const frame = video.parentElement!
    dialog().close()
    expect(frame.childElementCount).toBe(0)
  })

  it('uses a tall frame for YouTube Shorts unless aspect is authored', () => {
    start('<a data-kui="video-lightbox" href="https://youtube.com/shorts/dQw4w9WgXcQ">Short</a>')
    click(document.querySelector('a')!)
    expect(dialog().querySelector('.kui-lightbox-frame--tall')).not.toBeNull()
  })

  it('does not hijack an unknown URL and warns only once', () => {
    const reporter = collectingReporter()
    start('<a data-kui="video-lightbox" href="https://example.com/other">Other</a>', reporter)
    const link = document.querySelector('a')!
    expect(click(link).defaultPrevented).toBe(false)
    expect(click(link).defaultPrevented).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
    expect(reporter.messages.filter((message) => message.includes('https://example.com/other'))).toHaveLength(1)
  })
})
