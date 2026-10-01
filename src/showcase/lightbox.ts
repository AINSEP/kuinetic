import type { PrepareContext } from '../core/effect-context.js'
import { recognise } from '../core/gesture.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget, scopeParam, SCOPE_PARAM } from '../core/target.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { withTimingContract } from '../effects/shared.js'
import { swipeStep } from '../effects/swipe-event.js'
import { acquireModalShell } from './modal-shell.js'
import type { ModalContent, ModalShell } from './modal-shell.js'
import { resolveMediaSource } from './media-source.js'
import type { MediaSource } from './media-source.js'
import { widgetPrimitive } from './shared.js'

const paramsSchema: ParameterSchema = {
  media: { type: 'keyword', default: 'image', cssProperty: '--kui-lightbox-media', keywords: ['image', 'video', 'mixed'] },
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  scope: SCOPE_PARAM,
  scale: { type: 'number', default: '0.965', cssProperty: '--kui-from-scale', finite: true, minimum: 0 },
  duration: { type: 'time', default: '280ms', cssProperty: '--kui-lightbox-duration' },
  ease: { type: 'easing', default: 'cubic-bezier(0.22, 1, 0.36, 1)', cssProperty: '--kui-lightbox-ease' },
  loop: { type: 'keyword', default: 'true', cssProperty: '--kui-lightbox-loop', keywords: ['true', 'false'] },
  aspect: { type: 'keyword', default: '', cssProperty: '--kui-lightbox-aspect', keywords: ['wide', 'tall', 'square'] },
  caption: { type: 'keyword', default: 'figcaption', cssProperty: '--kui-lightbox-caption', keywords: ['figcaption', 'alt', 'title', 'none'] },
}

/**
 * What a row holds. `image` and `video` keep their historical trigger rules; `mixed` accepts both,
 * classifying each trigger when the viewer opens: a link to a playable video is a video, anything
 * else with an image in it is an image.
 */
type Media = 'image' | 'video' | 'mixed'

interface ImageItem {
  kind: 'image'
  trigger: Element
  image: HTMLImageElement
  src: string
  caption: string
}

interface VideoItem {
  kind: 'video'
  trigger: HTMLAnchorElement
  source: MediaSource
  title: string
  caption: string
}

type LightboxItem = ImageItem | VideoItem

function defaultTargets(el: Element, media: Media): Element[] {
  if (el.matches('a[href]') || (media !== 'video' && el.matches('img'))) return [el]
  return [...el.querySelectorAll(media === 'video' ? ':scope a[href]' : ':scope a[href], :scope img')]
}

function effectName(media: Media): string {
  return media === 'video' ? 'video-lightbox' : 'lightbox'
}

function targets(el: Element, params: EffectParams, ctx: PrepareContext, media: Media): Element[] {
  const authored = params.text('target')
  if (!authored) return defaultTargets(el, media)
  const selector = resolveTarget(authored, ctx, effectName(media))
  return selector ? queryScoped(el, ctx, selector, scopeParam(params, 'self')) : []
}

function imageTrigger(target: Element): Element {
  return target instanceof HTMLImageElement ? target.closest('a[href]') ?? target : target
}

function imageIn(trigger: Element): HTMLImageElement | null {
  return trigger instanceof HTMLImageElement ? trigger : trigger.querySelector('img')
}

/**
 * The caption `caption:` names. `figcaption` falls back to the alt text, which is what a gallery
 * of figures wants; the other three read one source only, so a page whose figcaptions label
 * something other than the picture can pick `alt`, and `none` hides the line entirely. A video
 * without a poster has no alt or image title to fall back to.
 */
function captionFor(trigger: Element, image: HTMLImageElement | null, source: string): string {
  if (source === 'none') return ''
  const alt = image?.alt ?? ''
  if (source === 'alt') return alt
  if (source === 'title') return titleOf(trigger, image)
  return trigger.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || alt
}

function titleOf(trigger: Element, image: HTMLImageElement | null): string {
  return (trigger.getAttribute('title') || image?.title || '').trim()
}

function imageItem(trigger: Element, captionSource: string): ImageItem | null {
  const image = imageIn(trigger)
  if (!image) return null
  const link = trigger instanceof HTMLAnchorElement ? trigger : null
  return { kind: 'image', trigger, image, src: link?.href ?? (image.currentSrc || image.src),
    caption: captionFor(trigger, image, captionSource) }
}

function videoTitle(link: HTMLAnchorElement, poster: HTMLImageElement | null): string {
  // An icon-only play button has no text and no poster inside it; its aria-label is its name.
  return link.title || poster?.getAttribute('alt') || link.getAttribute('aria-label')?.trim() ||
    link.textContent?.trim() || 'Video'
}

function videoItem(link: HTMLAnchorElement, captionSource: string): VideoItem | null {
  const source = resolveMediaSource(link.getAttribute('href') ?? '')
  if (!source) return null
  const poster = link.querySelector('img')
  return { kind: 'video', trigger: link, source, title: videoTitle(link, poster), caption: captionFor(link, poster, captionSource) }
}

/**
 * Classify a trigger from its live markup, so a link whose href changed after activation is read
 * as it is now. Image rows never become videos: `media:image` behaves exactly as it always has.
 */
function itemFor(trigger: Element, media: Media, captionSource: string): LightboxItem | null {
  if (media !== 'image' && trigger instanceof HTMLAnchorElement) {
    const video = videoItem(trigger, captionSource)
    if (video || media === 'video') return video
  }
  return imageItem(trigger, captionSource)
}

/**
 * The row's triggers in document order, one per link. A video row takes links only; an image row
 * takes whatever holds an image; a mixed row takes both, so a text link to a clip is an item too.
 */
function triggersFor(found: Element[], media: Media): Element[] {
  const seen = new Set<Element>()
  const triggers: Element[] = []
  for (const target of found) {
    const trigger = media === 'video' ? target : imageTrigger(target)
    if (seen.has(trigger)) continue
    if (!usable(trigger, media)) continue
    seen.add(trigger)
    triggers.push(trigger)
  }
  return triggers
}

function usable(trigger: Element, media: Media): boolean {
  const link = trigger instanceof HTMLAnchorElement
  if (media === 'video') return link
  const image = imageIn(trigger) !== null
  return media === 'image' ? image : link || image
}

function modalOptions(params: EffectParams, ctx: PrepareContext): Pick<ModalContent, 'duration' | 'scale' | 'ease' | 'reducedMotion'> {
  return {
    duration: params.timing.durationMs ?? params.ms('duration', 280),
    scale: params.text('scale', '0.965'),
    ease: params.timing.easing ?? params.text('ease', 'cubic-bezier(0.22, 1, 0.36, 1)'),
    reducedMotion: ctx.reducedMotion,
  }
}

function showImage(item: ImageItem, view: HTMLImageElement): void {
  view.src = item.src
  view.alt = item.image.alt
  const ratio = item.image.naturalWidth ? item.image.naturalHeight / item.image.naturalWidth : 1
  view.className = ratio > 1.5 ? 'is-tall' : 'is-fit'
}

function videoFrame(item: VideoItem, aspect: string, doc: Document): HTMLElement {
  const frame = doc.createElement('div')
  frame.className = `kui-lightbox-frame kui-lightbox-frame--${aspect || item.source.aspect}`
  if (item.source.kind === 'file') {
    const video = doc.createElement('video')
    video.src = item.source.embedUrl
    video.controls = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-label', item.title)
    frame.append(video)
  } else {
    const iframe = doc.createElement('iframe')
    iframe.src = item.source.embedUrl
    iframe.title = item.title
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    iframe.allowFullscreen = true
    frame.append(iframe)
  }
  return frame
}

function pauseVideo(video: HTMLVideoElement): void {
  if (video.readyState > 0) video.pause()
}

function stopMedia(frame: HTMLElement): void {
  const video = frame.querySelector('video')
  if (video) {
    pauseVideo(video)
    video.removeAttribute('src')
  }
  frame.replaceChildren()
}

interface Viewer {
  items: LightboxItem[]
  index: number
  loop: boolean
  aspect: string
  figure: HTMLElement
  view: HTMLImageElement
  caption: HTMLElement
  counter: HTMLElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
  /** A direct-file player survives leaving its slide, paused, so coming back resumes it. */
  players: Map<VideoItem, HTMLElement>
  shown?: { item: LightboxItem; node: HTMLElement }
}

/**
 * Leave the slide on screen. A native player pauses in place; an embed has no pause the page can
 * reach across origins, so its iframe is emptied, which stops it.
 */
function leave(state: Viewer, node: HTMLElement): void {
  if (node === state.view) return
  const video = node.querySelector('video')
  if (video) pauseVideo(video)
  else node.replaceChildren()
}

function land(state: Viewer, item: LightboxItem): HTMLElement {
  if (item.kind === 'image') {
    showImage(item, state.view)
    return state.view
  }
  const cached = state.players.get(item)
  if (cached) {
    // A returning slide plays again; a browser that refuses unmuted playback just leaves it paused.
    void cached.querySelector('video')!.play().catch(() => {})
    return cached
  }
  const frame = videoFrame(item, state.aspect, state.figure.ownerDocument)
  if (item.source.kind === 'file') state.players.set(item, frame)
  return frame
}

function renderGallery(state: Viewer, focus: boolean): void {
  const item = state.items[state.index]!
  if (state.shown?.item !== item) {
    if (state.shown) leave(state, state.shown.node)
    const node = land(state, item)
    state.shown = { item, node }
    state.caption.textContent = item.caption
    state.caption.hidden = item.caption === ''
    state.figure.replaceChildren(node, state.caption)
  }
  state.counter.textContent = `${state.index + 1} of ${state.items.length}`
  state.previous.disabled = !state.loop && state.index === 0
  state.next.disabled = !state.loop && state.index === state.items.length - 1
  if (focus) state.figure.focus()
}

/** Keyboard navigation moves focus to the figure; a Prev/Next button click leaves it on the button. */
function moveGallery(state: Viewer, delta: number, focus: boolean): void {
  const candidate = state.index + delta
  if (!state.loop && (candidate < 0 || candidate >= state.items.length)) return
  state.index = (candidate + state.items.length) % state.items.length
  renderGallery(state, focus)
}

function clickGallery(state: Viewer, delta: number, button: HTMLButtonElement): void {
  moveGallery(state, delta, false)
  // Reaching an end disables the button that was just pressed, which would drop focus to <body>.
  if (button.disabled && button.ownerDocument.activeElement === button) state.figure.focus()
}

function galleryKey(state: Viewer, event: KeyboardEvent): void {
  if (state.items.length < 2) return
  // A focused native player owns its arrow and Home/End keys: they seek.
  if ((event.target as Element).closest('video')) return
  if (event.key === 'ArrowLeft') moveGallery(state, -1, true)
  else if (event.key === 'ArrowRight') moveGallery(state, 1, true)
  else if (event.key === 'Home') { state.index = 0; renderGallery(state, true) }
  else if (event.key === 'End') { state.index = state.items.length - 1; renderGallery(state, true) }
  else return
  event.preventDefault()
}

/**
 * Swipe between items on touch: a flick left shows the next item, right the previous one, through
 * the same `moveGallery` the buttons and keys use, so `loop:` holds at the ends. A vertical flick is
 * not a step; it scrolls a tall image as it always did.
 *
 * The recogniser is the one `swipe`/`swipe-x` use (`core/gesture.ts`), with the page-facing half of
 * `swipeable` (an attribute, a bubbling `kui:swipe`) left out: nothing outside a modal steps with
 * it, and a `kui:swipe` bubbling out of the dialog would be heard by any page listener as a swipe on
 * the page. What is shared is the recognition and the direction-to-step mapping (`swipeStep`).
 *
 * It listens on the whole gallery, so a swipe on the dimmed space around the media counts too, not
 * only on a small picture. The exceptions are the media that own their own gestures:
 *
 * - A native `<video>`: its controls live in a closed shadow root, and a press on the timeline
 *   reaches the page as a press on the `<video>`. Scrubbing is a sideways drag, indistinguishable
 *   from a swipe, so presses on the player are refused outright (`accept`) and scrubbing stays the
 *   player's. The space around the player still swipes.
 * - An embed's `<iframe>` needs no exception: its pointer events never reach this document at all,
 *   so taps on a YouTube or Vimeo player are the player's by construction.
 * - A mouse is refused too. Buttons and arrow keys already step on a desktop, and a mouse drag here
 *   is a text selection in the caption; accepting it would also retarget the click that ends it at
 *   the gallery, which the shell reads as a click outside the media and closes the viewer.
 *
 * `touch-action: pan-y pinch-zoom` (`.is-swipeable` in `showcase.css`) keeps horizontal pans from
 * the browser, which would otherwise take them and cancel the pointer mid-swipe. It would also stop
 * a visitor who pinch-zoomed into a picture from panning across it, so while the visual viewport is
 * zoomed the class comes off and swiping is refused: the fingers are panning the zoomed page.
 *
 * @returns Removes the recogniser and the zoom listener.
 * @complexity O(1) per pointer event; O(1) space.
 */
function swipeGallery(state: Viewer, box: HTMLElement): () => void {
  const viewport = box.ownerDocument.defaultView?.visualViewport ?? null
  const zoomed = (): boolean => (viewport?.scale ?? 1) > 1.01
  const sync = (): void => {
    box.classList.toggle('is-swipeable', !zoomed())
  }
  sync()
  viewport?.addEventListener('resize', sync)
  const stop = recognise(box, {
    onSwipe(direction) {
      if (direction === 'left' || direction === 'right') moveGallery(state, swipeStep(direction), false)
    },
  }, {
    // A press on a button still clicks it: capture is taken only once the finger has moved.
    capturePointer: 'drag',
    accept: (event) => event.pointerType !== 'mouse' && !zoomed() && (event.target as Element).closest('video') === null,
  })
  return () => {
    stop()
    viewport?.removeEventListener('resize', sync)
  }
}

function closeViewer(state: Viewer): void {
  state.view.removeAttribute('src')
  for (const frame of state.players.values()) stopMedia(frame)
  if (state.shown && state.shown.node !== state.view) stopMedia(state.shown.node)
}

/** Name the gallery by what it holds, so a video row is not announced as images. */
function vocabulary(items: LightboxItem[]): { noun: string; label: string } {
  const kinds = new Set(items.map((item) => item.kind))
  if (kinds.size > 1) return { noun: 'item', label: 'Media viewer' }
  return kinds.has('video') ? { noun: 'video', label: 'Video viewer' } : { noun: 'image', label: 'Image viewer' }
}

interface ViewerOptions extends Pick<ModalContent, 'duration' | 'scale' | 'ease' | 'reducedMotion'> {
  loop: boolean
  aspect: string
}

function galleryContent(items: LightboxItem[], initial: number, options: ViewerOptions): ModalContent {
  const doc = items[initial]!.trigger.ownerDocument
  const box = doc.createElement('div')
  box.className = 'kui-lightbox-gallery'
  const figure = doc.createElement('figure')
  figure.tabIndex = -1
  const view = doc.createElement('img')
  view.decoding = 'async'
  const caption = doc.createElement('figcaption')
  box.append(figure)
  const counter = doc.createElement('span')
  counter.className = 'kui-lightbox-counter'
  counter.setAttribute('aria-hidden', 'true')
  const previous = doc.createElement('button')
  const next = doc.createElement('button')
  previous.type = next.type = 'button'
  previous.textContent = '‹'
  next.textContent = '›'
  const { noun, label } = vocabulary(items)
  previous.setAttribute('aria-label', `Previous ${noun}`)
  next.setAttribute('aria-label', `Next ${noun}`)
  previous.className = 'kui-lightbox-prev'
  next.className = 'kui-lightbox-next'
  const state: Viewer = { items, index: initial, loop: options.loop, aspect: options.aspect, figure, view, caption,
    counter, previous, next, players: new Map() }
  if (items.length > 1) {
    box.append(previous, next, counter)
    previous.addEventListener('click', () => clickGallery(state, -1, previous))
    next.addEventListener('click', () => clickGallery(state, 1, next))
  }
  renderGallery(state, false)
  const unswipe = items.length > 1 ? swipeGallery(state, box) : undefined
  const { duration, scale, ease, reducedMotion } = options
  return { duration, scale, ease, reducedMotion, node: box, label,
    // The media and the controls keep the viewer open; the empty figure around them closes it.
    inside: (target) => box.contains(target) && target.closest('img, video, iframe, button') !== null,
    onClose: () => {
      unswipe?.()
      closeViewer(state)
    },
    onKey: (event) => galleryKey(state, event) }
}

function primaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

interface Wiring {
  shell: ModalShell
  options: ViewerOptions
  signal: AbortSignal
  media: Media
  captionSource: string
  ctx: PrepareContext
  warned: Set<string>
}

/**
 * Open the row at `trigger`. Every trigger is read as it is now, and the ones that no longer make
 * an item (a link that lost its href) drop out of the gallery. Returns false when the clicked
 * trigger itself is not an item, so its link navigates normally.
 */
function openAt(triggers: Element[], trigger: Element, wiring: Wiring): boolean {
  const items: LightboxItem[] = []
  let initial = -1
  for (const candidate of triggers) {
    const item = itemFor(candidate, wiring.media, wiring.captionSource)
    if (!item) continue
    if (candidate === trigger) initial = items.length
    items.push(item)
  }
  if (initial < 0) {
    const href = trigger.getAttribute('href') ?? ''
    if (!wiring.warned.has(href)) wiring.ctx.warn(`${effectName(wiring.media)} cannot embed "${href}"; the link will navigate normally`)
    wiring.warned.add(href)
    return false
  }
  wiring.shell.open(galleryContent(items, initial, wiring.options))
  return true
}

function wireTriggers(triggers: Element[], wiring: Wiring): Array<() => void> {
  const restore: Array<() => void> = []
  for (const trigger of triggers) {
    const bare = trigger instanceof HTMLImageElement
    if (bare) {
      const attrs = createAttributeLedger(trigger)
      attrs.set('role', 'button')
      attrs.set('tabindex', '0')
      attrs.set('aria-label', trigger.alt ? `Open larger image: ${trigger.alt}` : 'Open larger image')
      restore.push(() => attrs.restore())
      trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        openAt(triggers, trigger, wiring)
      }, { signal: wiring.signal })
    }
    trigger.addEventListener('click', (event) => {
      if (!primaryClick(event as MouseEvent)) return
      if (openAt(triggers, trigger, wiring) && !bare) event.preventDefault()
    }, { signal: wiring.signal })
  }
  return restore
}

/**
 * Install the triggers of one row and acquire the shared shell. Every trigger in the row opens
 * the same gallery, images and videos alike, so prev/next never has to close the viewer. Authored
 * links remain usable without JavaScript and retain modified-click navigation.
 * @complexity O(n) per open in the row's triggers; O(n) listener and gallery space.
 * @overallScore 100
 */
function prepareLightbox(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const media = params.text('media', 'image') as Media
  const triggers = triggersFor(targets(el, params, ctx, media), media)
  if (triggers.length === 0) return () => {}
  const controller = new AbortController()
  const shell = acquireModalShell(ctx.doc)
  const options = { ...modalOptions(params, ctx), loop: params.is('loop'), aspect: params.text('aspect') }
  const restore = wireTriggers(triggers, { shell, options, signal: controller.signal, media,
    captionSource: params.text('caption', 'figcaption'), ctx, warned: new Set() })
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
  // A video row has never shown captions; `caption:figcaption` opts one in.
  { name: 'video-lightbox', primitive: 'lightbox', params: { media: 'video', caption: 'none' } },
]
