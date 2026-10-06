// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import { atRuleBlocks, ruleBodies } from './support/css-scan.js'
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

  it('reads the caption from the source caption: names', () => {
    const figure = (spec: string): string => `<figure data-kui="lightbox${spec}"><a href="/a.jpg" title="Link title"><img src="/a.png" alt="Alt A" title="Image title"></a><figcaption>Caption A</figcaption></figure>`
    const shown = (): string | null => {
      const caption = dialog().querySelector('figcaption')!
      return caption.hidden ? null : caption.textContent
    }
    for (const [spec, expected] of [['', 'Caption A'], [' caption:figcaption', 'Caption A'], [' caption:alt', 'Alt A'], [' caption:title', 'Link title'], [' caption:none', null]] as const) {
      start(figure(spec))
      click(document.querySelector('a')!)
      expect(shown(), spec || 'default').toBe(expected)
      for (const animator of active.splice(0)) animator.destroy()
      document.body.replaceChildren()
    }
  })

  it('falls back to the image title for caption:title and hides an empty one', () => {
    start('<div data-kui="lightbox caption:title"><img src="/a.png" alt="A" title=" Image title "><img src="/b.png" alt="B"></div>')
    const images = document.querySelectorAll('div > img')
    click(images[0]!)
    expect(dialog().querySelector('figcaption')?.textContent).toBe('Image title')
    click(images[1]!)
    expect(dialog().querySelector('figcaption')?.hidden).toBe(true)
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

  it('keeps focus on a Prev/Next button it activates, and moves it to the figure only for keys', () => {
    start('<div data-kui="lightbox"><a href="/a.jpg"><img src="/a.png" alt="A"></a><a href="/b.jpg"><img src="/b.png" alt="B"></a><a href="/c.jpg"><img src="/c.png" alt="C"></a></div>')
    click(document.querySelector('a')!)
    const next = dialog().querySelector('.kui-lightbox-next') as HTMLButtonElement
    const figure = dialog().querySelector('figure') as HTMLElement
    next.focus()
    next.click()
    expect(dialog().querySelector('img')?.alt).toBe('B')
    expect(document.activeElement).toBe(next)
    const previous = dialog().querySelector('.kui-lightbox-prev') as HTMLButtonElement
    previous.focus()
    previous.click()
    expect(dialog().querySelector('img')?.alt).toBe('A')
    expect(document.activeElement).toBe(previous)
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(figure)
  })

  it('moves focus to the figure when a click disables the button at a loop:false end', () => {
    start('<div data-kui="lightbox loop:false"><a href="/a.jpg"><img src="/a.png" alt="A"></a><a href="/b.jpg"><img src="/b.png" alt="B"></a></div>')
    click(document.querySelector('a')!)
    const next = dialog().querySelector('.kui-lightbox-next') as HTMLButtonElement
    next.focus()
    next.click()
    expect(next.disabled).toBe(true)
    expect(document.activeElement).toBe(dialog().querySelector('figure'))
  })

  it('does not steal focus from another control for a programmatic gallery click', () => {
    start('<div data-kui="lightbox loop:false"><a href="/a.jpg"><img src="/a.png" alt="A"></a><a href="/b.jpg"><img src="/b.png" alt="B"></a></div>')
    click(document.querySelector('a')!)
    const close = dialog().querySelector('.kui-lightbox-close') as HTMLButtonElement
    const next = dialog().querySelector('.kui-lightbox-next') as HTMLButtonElement
    close.focus()
    next.click()
    expect(next.disabled).toBe(true)
    expect(document.activeElement).toBe(close)
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

  const PAIR = '<a href="/a.jpg"><img src="/a-t.jpg" alt="A"></a><a href="/b.jpg"><img src="/b-t.jpg" alt="B"></a>'

  it('places the arrows as one group, bottom-right by default', () => {
    start(`<div data-kui="lightbox">${PAIR}</div>`)
    click(document.querySelector('a')!)
    const box = dialog().querySelector('.kui-lightbox-gallery')!
    const nav = box.querySelector('.kui-lightbox-nav.kui-lightbox-nav--bottom-right')!
    expect(nav).not.toBeNull()
    expect([...nav.children].map((child) => child.className)).toEqual(['kui-lightbox-prev', 'kui-lightbox-next'])
    expect(box.lastElementChild!.classList.contains('kui-lightbox-counter')).toBe(true)
    expect(nav.getAttribute('style')).toBeNull()
  })

  it('takes the arrow placement and gap from arrows: and arrow-gap:', () => {
    start(`<div data-kui="lightbox arrows:sides arrow-gap:1rem">${PAIR}</div>`)
    click(document.querySelector('a')!)
    const nav = dialog().querySelector('.kui-lightbox-nav') as HTMLElement
    expect(nav.classList.contains('kui-lightbox-nav--sides')).toBe(true)
    expect(nav.style.getPropertyValue('--kui-lightbox-arrow-gap')).toBe('1rem')
  })

  it('keeps the gallery open when the gap between the arrows is clicked', () => {
    vi.useFakeTimers()
    start(`<div data-kui="lightbox duration:10ms">${PAIR}</div>`)
    click(document.querySelector('a')!)
    click(dialog().querySelector('.kui-lightbox-nav')!)
    vi.advanceTimersByTime(10)
    expect(dialog().open).toBe(true)
  })

  it('draws no arrow group for a single item', () => {
    start('<a data-kui="lightbox" href="/full.jpg"><img src="/thumb.jpg" alt="Map"></a>')
    click(document.querySelector('a')!)
    expect(dialog().querySelector('.kui-lightbox-nav')).toBeNull()
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
    // One instance tearing down must not close the viewer the other one has open.
    click(links[1]!)
    const shared = dialog()
    animator.reset(links[0]!)
    expect(dialog()).toBe(shared)
    expect(shared.open).toBe(true)
    click(links[0]!)
    expect(dialog()).toBe(shared)
    animator.reset(links[0]!)
    expect(dialog()).toBe(shared)
    click(links[1]!)
    expect(dialog()).toBe(shared)
    expect(shared.open).toBe(true)
    animator.destroy()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('keeps a closed modal out of hit testing and removes motion in CSS', () => {
    const inBlocks = (prelude: string, selector: string): string =>
      atRuleBlocks(showcaseCss, prelude).flatMap((block) => ruleBodies(block, selector)).join('\n')
    expect(ruleBodies(showcaseCss, 'dialog.kui-lightbox')[0]?.trim()).toBe('display: none;')
    expect(ruleBodies(showcaseCss, 'dialog.kui-lightbox[open]')[0]).toContain('position: fixed;')

    const reduced = '@media (prefers-reduced-motion: reduce)'
    expect(inBlocks(reduced, 'dialog.kui-lightbox')).toContain('transition-duration: 1ms;')
    expect(inBlocks(reduced, '.kui-lightbox-gallery')).toContain('transition-duration: 1ms;')
    expect(inBlocks(reduced, '.kui-lightbox-gallery')).toContain('scale: none; translate: none;')

    const forced = '@media (forced-colors: active)'
    expect(inBlocks(forced, 'dialog.kui-lightbox')).toContain('border: 1px solid CanvasText;')
    expect(inBlocks(forced, 'dialog.kui-lightbox::backdrop')).toContain('backdrop-filter: none;')
    for (const button of ['.kui-lightbox-close', '.kui-lightbox-prev', '.kui-lightbox-next']) {
      expect(inBlocks(forced, button)).toContain('border-color: CanvasText;')
    }
  })

  it('positions the arrows as one fixed group and reserves the band they sit in', () => {
    for (const selector of ['.kui-lightbox-prev', '.kui-lightbox-next']) {
      const bodies = ruleBodies(showcaseCss, selector)
      expect(bodies.length).toBeGreaterThan(0)
      for (const body of bodies) expect(body).not.toContain('position: fixed')
    }
    expect(ruleBodies(showcaseCss, '.kui-lightbox-nav')[0]).toContain('position: fixed')
    expect(ruleBodies(showcaseCss, '.kui-lightbox-nav--bottom-right')[0]).toContain('safe-area-inset-bottom')
    const band = ruleBodies(showcaseCss, ".kui-lightbox-gallery:has(> [class*='kui-lightbox-nav--bottom'])")
    expect(band).toHaveLength(1)
    expect(band[0]).toContain('padding-block-end')
  })

  it('keeps the dialog and gallery from becoming the containing block of the fixed controls', () => {
    // backdrop-filter, and any scale/translate but none, trap position:fixed descendants in a box
    // that scrolls — the close/prev/next buttons would scroll away with a tall image.
    const trapping = /(?:backdrop-filter|filter|transform|scale|translate|perspective)\s*:\s*(?!none)/
    for (const selector of ['dialog.kui-lightbox[open]', 'dialog.kui-lightbox[open].is-open']) {
      for (const body of ruleBodies(showcaseCss, selector)) expect(body).not.toMatch(trapping)
    }
    const settled = ruleBodies(showcaseCss, '.kui-lightbox.is-open .kui-lightbox-gallery')
    expect(settled).toHaveLength(1)
    expect(settled[0]).toContain('scale: none;')
    expect(settled[0]).toContain('translate: none;')
    expect(ruleBodies(showcaseCss, 'dialog.kui-lightbox::backdrop')[0]).toContain('backdrop-filter: blur(7px);')
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

  it('names an icon-only play link by its aria-label, after title and poster alt', () => {
    start('<div data-kui="video-lightbox"><a href="https://youtu.be/dQw4w9WgXcQ" aria-label="Play: Tour"><svg aria-hidden="true"></svg></a><a href="/b.mp4" aria-label="Label" title="Title">Text</a><a href="/c.mp4" aria-label="Label"><img src="/c.png" alt="Poster"></a></div>')
    const links = document.querySelectorAll('a')
    click(links[0]!)
    expect(dialog().querySelector('iframe')?.title).toBe('Play: Tour')
    click(links[1]!)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('Title')
    click(links[2]!)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('Poster')
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

describe('one gallery across a row of images and videos', () => {
  const key = (target: Element, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }
  const next = (): HTMLButtonElement => dialog().querySelector('.kui-lightbox-next')!
  const loaded = (video: HTMLVideoElement): HTMLVideoElement => {
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 })
    return video
  }

  it('cycles a video row, pausing a native player it leaves and resuming it on return', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('blocked')))
    start('<div data-kui="video-lightbox"><a href="/a.mp4">A</a><a href="https://youtu.be/dQw4w9WgXcQ">B</a><a href="/c.mp4">C</a></div>')
    click(document.querySelectorAll('a')[0]!)
    expect(dialog().getAttribute('aria-label')).toBe('Video viewer')
    expect(next().getAttribute('aria-label')).toBe('Next video')
    expect(dialog().querySelector('.kui-lightbox-counter')?.textContent).toBe('1 of 3')
    const first = loaded(dialog().querySelector('video')!)
    next().click()
    expect(dialog().open).toBe(true)
    expect(pause).toHaveBeenCalledOnce()
    expect(first.isConnected).toBe(false)
    const embed = dialog().querySelector('.kui-lightbox-frame')!
    expect(embed.querySelector('iframe')?.title).toBe('B')
    next().click()
    expect(embed.childElementCount).toBe(0)
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('C')
    next().click()
    expect(dialog().querySelector('video')).toBe(first)
    expect(first.getAttribute('src')).toBe('/a.mp4')
    expect(play).toHaveBeenCalledOnce()
    expect(dialog().querySelector('figcaption')!.hidden).toBe(true)
  })

  it('stops every player it kept when the viewer closes', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    start('<div data-kui="video-lightbox"><a href="/a.mp4">A</a><a href="/b.mp4">B</a></div>')
    click(document.querySelector('a')!)
    const first = loaded(dialog().querySelector('video')!)
    next().click()
    const second = loaded(dialog().querySelector('video')!)
    dialog().close()
    expect(pause).toHaveBeenCalledTimes(3)
    expect(first.hasAttribute('src')).toBe(false)
    expect(second.hasAttribute('src')).toBe(false)
  })

  it('treats media:mixed as one gallery of images and videos in document order', () => {
    const reporter = collectingReporter()
    start('<div data-kui="lightbox media:mixed"><figure><a href="/full.jpg"><img src="/t.jpg" alt="Photo"></a><figcaption>Harbour</figcaption></figure><a href="https://example.com/page">Read more</a><a href="https://vimeo.com/76979871"><img src="/poster.png" alt="Clip"></a><img src="/bare.png" alt="Bare"></div>', reporter)
    const plain = document.querySelector('a[href^="https://example"]')!
    expect(click(plain).defaultPrevented).toBe(false)
    expect(reporter.messages.join()).toContain('lightbox cannot embed "https://example.com/page"')
    expect(document.querySelector('dialog')).toBeNull()

    click(document.querySelector('a')!)
    expect(dialog().getAttribute('aria-label')).toBe('Media viewer')
    expect(next().getAttribute('aria-label')).toBe('Next item')
    expect(dialog().querySelector('.kui-lightbox-counter')?.textContent).toBe('1 of 3')
    expect(dialog().querySelector('figcaption')?.textContent).toBe('Harbour')
    const figure = dialog().querySelector('figure')!
    expect(key(figure, 'ArrowRight').defaultPrevented).toBe(true)
    expect(dialog().querySelector('iframe')?.src).toBe('https://player.vimeo.com/video/76979871?autoplay=1')
    expect(dialog().querySelector('figcaption')?.textContent).toBe('Clip')
    expect(dialog().querySelector('figure img')).toBeNull()
    key(figure, 'ArrowRight')
    expect(dialog().querySelector('figure img')?.getAttribute('src')).toBe('http://localhost:3000/bare.png')
    expect(dialog().querySelector('iframe')).toBeNull()
    key(figure, 'Home')
    expect(dialog().querySelector('figure img')?.getAttribute('src')).toBe('http://localhost:3000/full.jpg')
  })

  it('opens a mixed row from a bare image and from a video link', () => {
    start('<div data-kui="lightbox media:mixed target:\'.item\'"><img class="item" src="/a.png" alt="A"><a class="item" href="/b.mp4">B</a><div class="item">not media</div></div>')
    const bare = document.querySelector('img')!
    expect(bare.getAttribute('role')).toBe('button')
    key(bare, 'Enter')
    expect(dialog().querySelector('.kui-lightbox-counter')?.textContent).toBe('1 of 2')
    expect(click(document.querySelector('a')!).defaultPrevented).toBe(true)
    expect(dialog().querySelector('.kui-lightbox-counter')?.textContent).toBe('2 of 2')
    expect(dialog().querySelector('video')?.getAttribute('aria-label')).toBe('B')
  })

  it('keeps an image row an image row: a poster linked to a clip still opens as an image', () => {
    start('<div data-kui="lightbox"><a href="/clip.mp4"><img src="/poster.png" alt="Poster"></a></div>')
    click(document.querySelector('a')!)
    expect(dialog().querySelector('video')).toBeNull()
    expect(dialog().querySelector('figure img')?.getAttribute('src')).toBe('http://localhost:3000/clip.mp4')
  })

  it('leaves arrow keys to a focused native player and stays open when the player is clicked', () => {
    vi.useFakeTimers()
    start('<div data-kui="video-lightbox duration:20ms"><a href="/a.mp4">A</a><a href="/b.mp4">B</a></div>')
    click(document.querySelector('a')!)
    const video = dialog().querySelector('video')!
    expect(key(video, 'ArrowRight').defaultPrevented).toBe(false)
    expect(dialog().querySelector('video')).toBe(video)
    click(video)
    expect(dialog().classList.contains('is-open')).toBe(true)
    click(dialog().querySelector('figure')!)
    expect(dialog().classList.contains('is-open')).toBe(false)
  })

  it('never shows a video row\'s unplayable poster link as an image', () => {
    start('<div data-kui="video-lightbox"><a href="https://example.com/page"><img src="/poster.png" alt="Poster"></a></div>')
    expect(click(document.querySelector('a')!).defaultPrevented).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('reads video captions from the source caption: names, with or without a poster', () => {
    start('<figure data-kui="video-lightbox caption:figcaption"><a href="/a.mp4" title="Titled">A</a><figcaption>Figure caption</figcaption></figure>' +
      '<div data-kui="video-lightbox caption:figcaption"><a href="/b.mp4">B</a></div>' +
      '<div data-kui="video-lightbox caption:alt"><a href="/c.mp4">C</a></div>' +
      '<div data-kui="video-lightbox caption:title"><a href="/d.mp4" title=" Link title ">D</a><a href="/e.mp4">E</a><a href="/f.mp4"><img src="/f.png" title="Poster title"></a></div>')
    const links = document.querySelectorAll('a')
    const caption = (): string => dialog().querySelector('figcaption')!.textContent!
    click(links[0]!)
    expect(caption()).toBe('Figure caption')
    click(links[1]!)
    expect(caption()).toBe('')
    click(links[2]!)
    expect(caption()).toBe('')
    click(links[3]!)
    expect(caption()).toBe('Link title')
    click(links[4]!)
    expect(caption()).toBe('')
    click(links[5]!)
    expect(caption()).toBe('Poster title')
  })
})

describe('swiping between items on touch', () => {
  let clock = 0
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  const pointer = (type: string, x: number, y: number, pointerType: string): PointerEvent => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
    for (const [name, value] of Object.entries({ clientX: x, clientY: y, pointerId: 1, pointerType })) {
      Object.defineProperty(event, name, { value })
    }
    return event
  }
  /** A 120px flick over 48ms from `from` (2500px/s), on `on`, as a finger unless told otherwise. */
  const flick = (on: Element, dx: number, dy: number, pointerType = 'touch'): void => {
    on.dispatchEvent(pointer('pointerdown', 200, 200, pointerType))
    for (let step = 1; step <= 3; step += 1) {
      clock += 16
      on.dispatchEvent(pointer('pointermove', 200 + (dx * step) / 3, 200 + (dy * step) / 3, pointerType))
    }
    on.dispatchEvent(pointer('pointerup', 200 + dx, 200 + dy, pointerType))
    clock += 500
  }
  const fresh = (): void => {
    for (const animator of active.splice(0).reverse()) animator.destroy()
    document.body.replaceChildren()
  }
  const counter = (): string => dialog().querySelector('.kui-lightbox-counter')!.textContent!
  const gallery = (): HTMLElement => dialog().querySelector('.kui-lightbox-gallery')!
  const row = (params = ''): void => {
    start(`<div data-kui="lightbox${params}"><a href="/a.jpg"><img src="/a.jpg" alt="A"></a><a href="/b.jpg"><img src="/b.jpg" alt="B"></a><a href="/c.jpg"><img src="/c.jpg" alt="C"></a></div>`)
    click(document.querySelector('a')!)
  }

  it('steps forward on a flick left and back on a flick right, from the picture or the space around it', () => {
    row()
    flick(dialog().querySelector('figure img')!, -120, 0)
    expect(counter()).toBe('2 of 3')
    flick(gallery(), -120, 0)
    expect(counter()).toBe('3 of 3')
    flick(gallery(), 120, 0)
    expect(counter()).toBe('2 of 3')
  })

  it('wraps at the ends by default and stops there under loop:false', () => {
    row()
    flick(gallery(), 120, 0)
    expect(counter()).toBe('3 of 3')
    fresh()
    row(' loop:false')
    flick(gallery(), 120, 0)
    expect(counter()).toBe('1 of 3')
    flick(gallery(), -120, 0)
    flick(gallery(), -120, 0)
    flick(gallery(), -120, 0)
    expect(counter()).toBe('3 of 3')
  })

  it('does nothing on a vertical flick, a mouse drag, or a press on a native player', () => {
    row()
    flick(gallery(), 0, -120)
    expect(counter()).toBe('1 of 3')
    flick(gallery(), 10, 120)
    expect(counter()).toBe('1 of 3')
    flick(gallery(), -120, 0, 'mouse')
    expect(counter()).toBe('1 of 3')
    fresh()
    start('<div data-kui="video-lightbox"><a href="/a.mp4">A</a><a href="/b.mp4">B</a></div>')
    click(document.querySelector('a')!)
    // A sideways drag on the player is the timeline being scrubbed.
    flick(dialog().querySelector('video')!, -120, 0)
    expect(counter()).toBe('1 of 2')
    flick(gallery(), -120, 0)
    expect(counter()).toBe('2 of 2')
  })

  it('claims horizontal pans only in a gallery of several items', () => {
    start('<a data-kui="lightbox" href="/one.jpg"><img src="/one.jpg" alt="One"></a>')
    click(document.querySelector('a')!)
    expect(gallery().classList.contains('is-swipeable')).toBe(false)
    fresh()
    row()
    expect(gallery().classList.contains('is-swipeable')).toBe(true)
    expect(ruleBodies(showcaseCss, '.kui-lightbox-gallery.is-swipeable')[0]).toContain('touch-action: pan-y pinch-zoom;')
  })

  it('hands pans back to the page while it is pinch-zoomed, and lets go of the viewport on close', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1 })
    const remove = vi.spyOn(viewport, 'removeEventListener')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    try {
      row()
      viewport.scale = 2
      viewport.dispatchEvent(new Event('resize'))
      expect(gallery().classList.contains('is-swipeable')).toBe(false)
      flick(gallery(), -120, 0)
      expect(counter()).toBe('1 of 3')
      viewport.scale = 1
      viewport.dispatchEvent(new Event('resize'))
      expect(gallery().classList.contains('is-swipeable')).toBe(true)
      flick(gallery(), -120, 0)
      expect(counter()).toBe('2 of 3')
      dialog().close()
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    } finally {
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })
})
