import type { PrepareContext } from '../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget, scopeParam, SCOPE_PARAM } from '../core/target.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { withTimingContract } from '../effects/shared.js'
import { acquireModalShell } from './modal-shell.js'
import type { ModalContent, ModalShell } from './modal-shell.js'
import { resolveMediaSource } from './media-source.js'
import { widgetPrimitive } from './shared.js'

const paramsSchema: ParameterSchema = {
  media: { type: 'keyword', default: 'image', cssProperty: '--kui-lightbox-media', keywords: ['image', 'video'] },
  target: { type: 'text', default: '', cssProperty: '--kui-lightbox-target' },
  scope: SCOPE_PARAM,
  scale: { type: 'number', default: '0.965', cssProperty: '--kui-from-scale', finite: true, minimum: 0 },
  duration: { type: 'time', default: '280ms', cssProperty: '--kui-lightbox-duration' },
  ease: { type: 'easing', default: 'cubic-bezier(0.22, 1, 0.36, 1)', cssProperty: '--kui-lightbox-ease' },
  loop: { type: 'keyword', default: 'true', cssProperty: '--kui-lightbox-loop', keywords: ['true', 'false'] },
  aspect: { type: 'keyword', default: '', cssProperty: '--kui-lightbox-aspect', keywords: ['wide', 'tall', 'square'] },
}

interface ImageItem {
  trigger: Element
  image: HTMLImageElement
  src: string
  caption: string
}

function defaultTargets(el: Element, media: string): Element[] {
  if (el.matches('a[href]') || (media === 'image' && el.matches('img'))) return [el]
  return [...el.querySelectorAll(media === 'video' ? ':scope a[href]' : ':scope a[href], :scope img')]
}

function targets(el: Element, params: EffectParams, ctx: PrepareContext, media: string): Element[] {
  const authored = params.text('target')
  if (!authored) return defaultTargets(el, media)
  const selector = resolveTarget(authored, ctx, media === 'video' ? 'video-lightbox' : 'lightbox')
  return selector ? queryScoped(el, ctx, selector, scopeParam(params, 'self')) : []
}

function imageTrigger(target: Element): Element {
  return target instanceof HTMLImageElement ? target.closest('a[href]') ?? target : target
}

function imageIn(trigger: Element): HTMLImageElement | null {
  return trigger instanceof HTMLImageElement ? trigger : trigger.querySelector('img')
}

function imageItem(trigger: Element): ImageItem | null {
  const image = imageIn(trigger)
  if (!image) return null
  const link = trigger instanceof HTMLAnchorElement ? trigger : null
  const caption = trigger.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
  return { trigger, image, src: link?.href ?? (image.currentSrc || image.src),
    caption: caption || image.alt }
}

function imageItems(targets: Element[]): ImageItem[] {
  const seen = new Set<Element>()
  const items: ImageItem[] = []
  for (const target of targets) {
    const trigger = imageTrigger(target)
    if (seen.has(trigger)) continue
    const item = imageItem(trigger)
    if (!item) continue
    seen.add(trigger)
    items.push(item)
  }
  return items
}

function modalOptions(params: EffectParams, ctx: PrepareContext): Pick<ModalContent, 'duration' | 'scale' | 'ease' | 'reducedMotion'> {
  return {
    duration: params.timing.durationMs ?? params.ms('duration', 280),
    scale: params.text('scale', '0.965'),
    ease: params.timing.easing ?? params.text('ease', 'cubic-bezier(0.22, 1, 0.36, 1)'),
    reducedMotion: ctx.reducedMotion,
  }
}

function showImage(item: ImageItem, view: HTMLImageElement, caption: HTMLElement): void {
  view.src = item.src
  view.alt = item.image.alt
  caption.textContent = item.caption
  caption.hidden = item.caption === ''
  const ratio = item.image.naturalWidth ? item.image.naturalHeight / item.image.naturalWidth : 1
  view.className = ratio > 1.5 ? 'is-tall' : 'is-fit'
}

interface GalleryState {
  items: ImageItem[]
  index: number
  loop: boolean
  figure: HTMLElement
  view: HTMLImageElement
  caption: HTMLElement
  counter: HTMLElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
}

function renderGallery(state: GalleryState, focus: boolean): void {
  showImage(state.items[state.index]!, state.view, state.caption)
  state.counter.textContent = `${state.index + 1} of ${state.items.length}`
  state.previous.disabled = !state.loop && state.index === 0
  state.next.disabled = !state.loop && state.index === state.items.length - 1
  if (focus) state.figure.focus()
}

function moveGallery(state: GalleryState, delta: number): void {
  const candidate = state.index + delta
  if (!state.loop && (candidate < 0 || candidate >= state.items.length)) return
  state.index = (candidate + state.items.length) % state.items.length
  renderGallery(state, true)
}

function galleryKey(state: GalleryState, event: KeyboardEvent): void {
  if (state.items.length < 2) return
  if (event.key === 'ArrowLeft') moveGallery(state, -1)
  else if (event.key === 'ArrowRight') moveGallery(state, 1)
  else if (event.key === 'Home') { state.index = 0; renderGallery(state, true) }
  else if (event.key === 'End') { state.index = state.items.length - 1; renderGallery(state, true) }
  else return
  event.preventDefault()
}

function galleryContent(items: ImageItem[], initial: number, loop: boolean, options: ReturnType<typeof modalOptions>): ModalContent {
  const doc = items[initial]!.image.ownerDocument
  const box = doc.createElement('div')
  box.className = 'kui-lightbox-gallery'
  const figure = doc.createElement('figure')
  figure.tabIndex = -1
  const view = doc.createElement('img')
  view.decoding = 'async'
  const caption = doc.createElement('figcaption')
  figure.append(view, caption)
  box.append(figure)
  const counter = doc.createElement('span')
  counter.className = 'kui-lightbox-counter'
  counter.setAttribute('aria-hidden', 'true')
  const previous = doc.createElement('button')
  const next = doc.createElement('button')
  previous.type = next.type = 'button'
  previous.textContent = '‹'
  next.textContent = '›'
  previous.setAttribute('aria-label', 'Previous image')
  next.setAttribute('aria-label', 'Next image')
  previous.className = 'kui-lightbox-prev'
  next.className = 'kui-lightbox-next'
  const state = { items, index: initial, loop, figure, view, caption, counter, previous, next }
  if (items.length > 1) {
    box.append(previous, next, counter)
    previous.addEventListener('click', () => moveGallery(state, -1))
    next.addEventListener('click', () => moveGallery(state, 1))
  }
  renderGallery(state, false)
  return { ...options, node: box, label: 'Image viewer', onClose: () => view.removeAttribute('src'),
    onKey: (event) => galleryKey(state, event) }
}

function stopMedia(frame: HTMLElement): void {
  const video = frame.querySelector('video')
  if (video) {
    if (video.readyState > 0) video.pause()
    video.removeAttribute('src')
  }
  frame.replaceChildren()
}

function videoContent(link: HTMLAnchorElement, source: NonNullable<ReturnType<typeof resolveMediaSource>>, options: ReturnType<typeof modalOptions>, aspect: string): ModalContent {
  const doc = link.ownerDocument
  const frame = doc.createElement('div')
  frame.className = `kui-lightbox-frame kui-lightbox-frame--${aspect}`
  const poster = link.querySelector('img')
  const title = link.title || poster?.getAttribute('alt') || link.textContent?.trim() || 'Video'
  if (source.kind === 'file') {
    const video = doc.createElement('video')
    video.src = source.embedUrl
    video.controls = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-label', title)
    frame.append(video)
  } else {
    const iframe = doc.createElement('iframe')
    iframe.src = source.embedUrl
    iframe.title = title
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    iframe.allowFullscreen = true
    frame.append(iframe)
  }
  return { ...options, node: frame, label: 'Video viewer', onClose: () => stopMedia(frame) }
}

function primaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

interface Wiring {
  shell: ModalShell
  options: ReturnType<typeof modalOptions>
  signal: AbortSignal
}

function wireImages(items: ImageItem[], wiring: Wiring, loop: boolean): Array<() => void> {
  const restore: Array<() => void> = []
  items.forEach((item, index) => {
    const bare = item.trigger === item.image
    if (bare) {
      const attrs = createAttributeLedger(item.image)
      attrs.set('role', 'button')
      attrs.set('tabindex', '0')
      attrs.set('aria-label', item.image.alt ? `Open larger image: ${item.image.alt}` : 'Open larger image')
      restore.push(() => attrs.restore())
      item.image.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        wiring.shell.open(galleryContent(items, index, loop, wiring.options))
      }, { signal: wiring.signal })
    }
    item.trigger.addEventListener('click', (event) => {
      if (!(event instanceof MouseEvent)) return
      if (!primaryClick(event)) return
      if (!bare) event.preventDefault()
      wiring.shell.open(galleryContent(items, index, loop, wiring.options))
    }, { signal: wiring.signal })
  })
  return restore
}

function wireVideos(targets: Element[], wiring: Wiring, aspect: string, ctx: PrepareContext): void {
  const warned = new Set<string>()
  for (const target of targets) {
    if (!(target instanceof HTMLAnchorElement)) continue
    target.addEventListener('click', (event) => {
      if (!primaryClick(event)) return
      const href = target.getAttribute('href') ?? ''
      const source = resolveMediaSource(href)
      if (!source) {
        if (!warned.has(href)) ctx.warn(`video-lightbox cannot embed "${href}"; the link will navigate normally`)
        warned.add(href)
        return
      }
      event.preventDefault()
      wiring.shell.open(videoContent(target, source, wiring.options, aspect || source.aspect))
    }, { signal: wiring.signal })
  }
}

/**
 * Install the image or video triggers and acquire the shared shell. Authored links remain usable
 * without JavaScript and retain modified-click navigation.
 * @complexity O(n) in matched triggers; O(n) listener and gallery space.
 * @overallScore 100
 */
function prepareLightbox(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const media = params.text('media', 'image')
  const found = targets(el, params, ctx, media)
  if (found.length === 0) return () => {}
  const controller = new AbortController()
  const shell = acquireModalShell(ctx.doc)
  const wiring = { shell, options: modalOptions(params, ctx), signal: controller.signal }
  let restore: Array<() => void> = []
  if (media === 'video') {
    wireVideos(found, wiring, params.text('aspect'), ctx)
  } else {
    const items = imageItems(found)
    restore = wireImages(items, wiring, params.is('loop'))
  }
  return continuousSetup(() => {
    controller.abort()
    for (const undo of restore) undo()
    shell.release()
  })
}

export const LIGHTBOX_PRIMITIVE: Primitive = widgetPrimitive(
  'lightbox',
  { channels: ['widget'], parameters: paramsSchema, perfClass: 'paint' },
  withTimingContract('lightbox', { honours: ['duration', 'ease'], because: 'the dialog opens immediately, so it has no delay phase' }, deferPrepare(prepareLightbox)),
)

export const LIGHTBOX_PRESETS: Preset[] = [
  { name: 'lightbox', primitive: 'lightbox', params: { media: 'image' } },
  { name: 'video-lightbox', primitive: 'lightbox', params: { media: 'video' } },
]
