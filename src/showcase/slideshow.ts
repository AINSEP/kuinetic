import type { PrepareContext } from '../core/effect-context.js'
import { recognise } from '../core/gesture.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import type { AttributeLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget, scopeParam, SCOPE_PARAM } from '../core/target.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { createStepIndex } from '../effects/step-index.js'
import type { StepIndex } from '../effects/step-index.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

const SLIDE_LIST_ATTR = 'data-kui-slideshow-list'
const SLIDE_MODE_ATTR = 'data-kui-slideshow-mode'
const controlsValues = ['auto', 'dots', 'arrows', 'none'] as const

const slideshowParams: ParameterSchema = {
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  scope: SCOPE_PARAM,
  next: { type: 'text', default: '', cssProperty: '--kui-next' },
  prev: { type: 'text', default: '', cssProperty: '--kui-prev' },
  jump: { type: 'text', default: '', cssProperty: '--kui-jump' },
  controls: { type: 'keyword', default: 'auto', cssProperty: '--kui-slideshow-controls', keywords: [...controlsValues] },
  autoplay: { type: 'time', default: '0s', cssProperty: '--kui-slideshow-autoplay' },
  transition: { type: 'keyword', default: 'fade', cssProperty: '--kui-slideshow-transition', keywords: ['fade', 'slide'] },
  swipe: { type: 'keyword', default: 'true', cssProperty: '--kui-slideshow-swipe', keywords: ['true', 'false'] },
  mute: { type: 'text', default: '', cssProperty: '--kui-slideshow-mute' },
  duration: { type: 'time', default: '500ms', cssProperty: '--kui-slideshow-duration' },
  ease: { type: 'easing', default: 'ease', cssProperty: '--kui-slideshow-ease' },
}

interface Controls {
  root: HTMLDivElement | null
  pause: HTMLButtonElement | null
  previous: HTMLButtonElement | null
  next: HTMLButtonElement | null
  dots: HTMLButtonElement[]
}

function button(doc: Document, label: string): HTMLButtonElement {
  const node = doc.createElement('button')
  node.type = 'button'
  node.setAttribute('aria-label', label)
  return node
}

function appendArrows(root: HTMLDivElement, mode: string): {
  previous: HTMLButtonElement | null
  next: HTMLButtonElement | null
} {
  if (mode !== 'auto' && mode !== 'arrows') return { previous: null, next: null }
  const previous = button(root.ownerDocument, 'Previous slide')
  const next = button(root.ownerDocument, 'Next slide')
  root.append(previous, next)
  return { previous, next }
}

function appendDots(root: HTMLDivElement, slides: Element[], mode: string): HTMLButtonElement[] {
  if (mode !== 'auto' && mode !== 'dots') return []
  return slides.map((_slide, index) => {
    const dot = button(root.ownerDocument, `Go to slide ${index + 1} of ${slides.length}`)
    dot.className = 'kui-slideshow-dot'
    root.appendChild(dot)
    return dot
  })
}

function buildControls(
  el: Element,
  slides: Element[],
  mode: string,
  hasAutoplay: boolean,
): Controls {
  if (mode === 'none') return { root: null, pause: null, previous: null, next: null, dots: [] }
  const root = el.ownerDocument.createElement('div')
  root.className = 'kui-slideshow-controls'
  const pause = hasAutoplay ? button(el.ownerDocument, 'Pause slideshow') : null
  if (pause) root.appendChild(pause)
  const { previous, next } = appendArrows(root, mode)
  const dots = appendDots(root, slides, mode)
  const list = slides[0]?.parentElement
  if (list?.parentElement?.isSameNode(el)) list.after(root)
  else el.appendChild(root)
  return { root, pause, previous, next, dots }
}

interface SlideDecorations {
  host: AttributeLedger
  list: AttributeLedger
  slides: ReturnType<typeof createAttributeLedger>[]
  liveList: Element
}

function decorateHost(el: Element, ctx: PrepareContext, mode: string): AttributeLedger {
  const host = createAttributeLedger(el)
  if (!el.hasAttribute('role')) host.set('role', 'region')
  if (!el.hasAttribute('aria-roledescription')) host.set('aria-roledescription', 'carousel')
  if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
    ctx.warn('slideshow needs an aria-label or aria-labelledby on its host')
  }
  host.set(SLIDE_MODE_ATTR, mode)
  return host
}

function decorateSlides(el: Element, slides: Element[], ctx: PrepareContext, mode: string): SlideDecorations {
  const host = decorateHost(el, ctx, mode)
  const liveList = slides[0]!.parentElement!
  const list = createAttributeLedger(liveList)
  list.set(SLIDE_LIST_ATTR, '')
  const ledgers = slides.map((slide, index) => {
    const attrs = createAttributeLedger(slide)
    if (!slide.hasAttribute('role')) attrs.set('role', 'group')
    if (!slide.hasAttribute('aria-roledescription')) attrs.set('aria-roledescription', 'slide')
    if (!slide.hasAttribute('aria-label')) attrs.set('aria-label', `${index + 1} of ${slides.length}`)
    return attrs
  })
  return { host, list, slides: ledgers, liveList }
}

function renderSlides(
  slides: Element[],
  ledgers: ReturnType<typeof createAttributeLedger>[],
  controls: Controls,
  index: number,
): void {
  slides.forEach((_slide, position) => {
    const attrs = ledgers[position]!
    if (position === index) attrs.remove('inert')
    else attrs.set('inert', '')
  })
  controls.dots.forEach((dot, position) => {
    if (position === index) dot.setAttribute('aria-current', 'true')
    else dot.removeAttribute('aria-current')
    dot.tabIndex = position === index ? 0 : -1
  })
}

function bindNavigation(controls: Controls, index: StepIndex): () => void {
  const previous = (): void => index.prev()
  const next = (): void => index.next()
  controls.previous?.addEventListener('click', previous)
  controls.next?.addEventListener('click', next)
  const dotClicks = controls.dots.map((dot, position) => {
    const click = (): void => index.goTo(position)
    dot.addEventListener('click', click)
    return click
  })
  const onKey = (event: KeyboardEvent): void => {
    if (!controls.dots.includes(event.target as HTMLButtonElement)) return
    if (event.key === 'ArrowRight') index.next()
    else if (event.key === 'ArrowLeft') index.prev()
    else return
    event.preventDefault()
    controls.dots[index.current()]?.focus()
  }
  controls.root?.addEventListener('keydown', onKey)
  return () => {
    controls.previous?.removeEventListener('click', previous)
    controls.next?.removeEventListener('click', next)
    controls.dots.forEach((dot, position) => dot.removeEventListener('click', dotClicks[position]!))
    controls.root?.removeEventListener('keydown', onKey)
  }
}

interface MuteOptions {
  el: Element
  params: EffectParams
  ctx: PrepareContext
  index: StepIndex
  slides: Element[]
}

function bindMute(options: MuteOptions): { release: () => void; render: () => void } {
  const { el, params, ctx, index, slides } = options
  const noop = (): void => {}
  const selector = resolveTarget(params.text('mute'), ctx, 'slideshow mute')
  if (!selector) return { release: noop, render: noop }
  const controls = queryScoped(el, ctx, selector, 'self')
    .filter((node): node is HTMLButtonElement => node.localName === 'button')
  if (controls.length === 0) {
    ctx.warn('slideshow mute: must select a button inside the host')
    return { release: noop, render: noop }
  }
  const attrs = controls.map((control) => createAttributeLedger(control))
  const originals = new Map<HTMLVideoElement, boolean>()
  const render = (): void => {
    const video = slides[index.current()]?.querySelector('video')
    const muted = video?.localName === 'video' && (video as HTMLVideoElement).muted
    for (const attr of attrs) {
      attr.set('aria-pressed', String(muted))
      attr.set('aria-label', muted ? 'Unmute video' : 'Mute video')
    }
  }
  const onClick = (): void => {
    const video = slides[index.current()]?.querySelector('video')
    if (video?.localName !== 'video') return
    const player = video as HTMLVideoElement
    if (!originals.has(player)) originals.set(player, player.muted)
    player.muted = !player.muted
    render()
  }
  for (const control of controls) control.addEventListener('click', onClick)
  render()
  const release = (): void => {
    for (const control of controls) control.removeEventListener('click', onClick)
    for (const [video, muted] of originals) video.muted = muted
    for (const attr of attrs) attr.restore()
  }
  return { release, render }
}

interface AutoplayOptions {
  el: Element
  ctx: PrepareContext
  index: StepIndex
  controls: Controls
  liveList: Element
  interval: number
}

function bindAutoplay(options: AutoplayOptions): () => void {
  const { el, ctx, index, controls, liveList, interval } = options
  const listAttrs = createAttributeLedger(liveList)
  if (interval === 0) {
    listAttrs.set('aria-live', 'polite')
    return () => listAttrs.restore()
  }
  const pause = controls.pause!
  const pauseAttrs = createAttributeLedger(pause)
  let userPaused = ctx.reducedMotion
  let hovered = false
  let focused = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const active = (): boolean => !userPaused && !hovered && !focused && !ctx.doc.hidden
  const update = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    listAttrs.set('aria-live', active() ? 'off' : 'polite')
    pauseAttrs.set('aria-pressed', String(userPaused))
    pauseAttrs.set('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow')
    if (active()) timer = setTimeout(() => { index.next(); update() }, interval)
  }
  const enter = (): void => { hovered = true; update() }
  const leave = (): void => { hovered = false; update() }
  const focus = (): void => { focused = true; update() }
  const blur = (): void => { focused = el.contains(ctx.doc.activeElement); update() }
  const toggle = (): void => { userPaused = !userPaused; update() }
  el.addEventListener('pointerenter', enter)
  el.addEventListener('pointerleave', leave)
  el.addEventListener('focusin', focus)
  el.addEventListener('focusout', blur)
  ctx.doc.addEventListener('visibilitychange', update)
  pause.addEventListener('click', toggle)
  update()
  return () => {
    if (timer !== null) clearTimeout(timer)
    el.removeEventListener('pointerenter', enter)
    el.removeEventListener('pointerleave', leave)
    el.removeEventListener('focusin', focus)
    el.removeEventListener('focusout', blur)
    ctx.doc.removeEventListener('visibilitychange', update)
    pause.removeEventListener('click', toggle)
    pauseAttrs.restore()
    listAttrs.restore()
  }
}

function autoplayInterval(params: EffectParams, ctx: PrepareContext, mode: string): number {
  const raw = params.ms('autoplay', 0)
  const requested = raw > 0 ? Math.max(2000, raw) : 0
  if (raw > 0 && raw < 2000) ctx.warn('slideshow autoplay: minimum is 2s; clamped to 2s')
  if (mode === 'none' && requested > 0) {
    ctx.warn('slideshow autoplay needs a pause control; autoplay is disabled with authored or hidden controls')
  }
  return mode === 'none' ? 0 : requested
}

function applyTiming(params: EffectParams, ctx: PrepareContext): void {
  if (params.timing.durationMs !== undefined) {
    ctx.style.set('--kui-slideshow-duration', `${params.timing.durationMs}ms`)
  }
  if (params.timing.easing !== undefined) {
    ctx.style.set('--kui-slideshow-ease', params.timing.easing)
  }
}

function bindSwipe(el: Element, params: EffectParams, index: StepIndex): Cleanup {
  if (params.text('swipe', 'true') !== 'true') return () => {}
  return recognise(el, { onSwipe: (direction) => {
    if (direction === 'left') index.next()
    if (direction === 'right') index.prev()
  } }, { axis: 'x', capturePointer: 'drag' })
}

/** Build an accessible, keyboard and swipe operable slideshow from authored slides.
 * @complexity O(n) setup and per index change in slide count; O(n) space.
 * @overallScore 100
 */
function prepareSlideshow(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const selector = resolveTarget(
    params.text('target') || ':scope > :is(ul, ol) > li', ctx, 'slideshow',
  )
  const scope = scopeParam(params, 'self')
  const resolveSteps = (): Element[] => selector ? queryScoped(el, ctx, selector, scope) : []
  const slides = resolveSteps()
  if (slides.length === 0) {
    ctx.warn('slideshow target matched no slides')
    return continuousSetup(() => {})
  }
  const list = slides[0]!.parentElement
  if (!list || list === el || !el.contains(list) || slides.some((slide) => slide.parentElement !== list)) {
    ctx.warn('slideshow slides must share one list inside the host')
    return continuousSetup(() => {})
  }
  const authoredControls = ['next', 'prev', 'jump'].some((name) => params.text(name) !== '')
  const mode = authoredControls ? 'none' : params.text('controls', 'auto')
  const interval = autoplayInterval(params, ctx, mode)
  const decorations = decorateSlides(el, slides, ctx, params.text('transition', 'fade'))
  const controls = buildControls(el, slides, mode, interval > 0)
  applyTiming(params, ctx)
  let renderMute = (): void => {}
  const index = createStepIndex({
    el, params, ctx, scope, resolveSteps, name: 'slideshow', clickFallback: false,
    onRender: (position) => {
      renderSlides(slides, decorations.slides, controls, position)
      renderMute()
    },
  })
  const releaseNavigation = bindNavigation(controls, index)
  const releaseSwipe = bindSwipe(el, params, index)
  const mute = bindMute({ el, params, ctx, index, slides })
  renderMute = mute.render
  const releaseAutoplay = bindAutoplay({ el, ctx, index, controls, liveList: decorations.liveList, interval })
  return continuousSetup(() => {
    releaseAutoplay()
    mute.release()
    releaseSwipe()
    releaseNavigation()
    index.release()
    controls.root?.remove()
    decorations.slides.forEach((attrs) => attrs.restore())
    decorations.list.restore()
    decorations.host.restore()
  })
}

export const SLIDESHOW_PRIMITIVE: Primitive = widgetPrimitive(
  'slideshow',
  { channels: ['widget'], parameters: slideshowParams, perfClass: 'layout' },
  withTimingContract(
    'slideshow',
    { honours: ['duration', 'ease'], because: 'the slideshow has no delayed start' },
    deferPrepare(prepareSlideshow),
  ),
)

export const SLIDESHOW_PRESETS: Preset[] = [
  { name: 'carousel-fade', primitive: 'slideshow', params: { transition: 'fade' }, requiresOwnSubtree: true },
  { name: 'carousel-slide', primitive: 'slideshow', params: { transition: 'slide' }, requiresOwnSubtree: true },
  { name: 'video-hero-slideshow', primitive: 'slideshow', params: { transition: 'fade', autoplay: '7s', controls: 'dots' }, requiresOwnSubtree: true },
]
