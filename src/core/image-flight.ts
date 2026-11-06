import { timeScaleOf } from './time-scale.js'

export interface ImageFlightOptions {
  image: HTMLImageElement
  parent: HTMLElement
  from: DOMRect
  to: DOMRect
  duration: number
  delay?: number
  easing: string
  frames?: Keyframe[]
  lift?: number
  zIndex?: string
}

export function scaledFrames(from: DOMRect, to: DOMRect): Keyframe[] {
  return [
    { translate: `${from.left - to.left}px ${from.top - to.top}px`, scale: `${from.width / to.width} ${from.height / to.height}` },
    { translate: '0px 0px', scale: '1 1' },
  ]
}

export interface ImageFlight {
  finished: Promise<boolean>
  cancel(): void
  finish(): void
  reverse(): boolean
}

/** Bound lazy-image readiness; abort and failed decodes are ordinary fallbacks. */
export function flightImageReady(image: HTMLImageElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  if (image.complete && image.naturalWidth > 0) return Promise.resolve(true)
  if (!image.decode) return Promise.resolve(false)
  return new Promise((resolve) => {
    const win = image.ownerDocument.defaultView!
    const end = (ready: boolean): void => {
      win.clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      resolve(ready)
    }
    const aborted = (): void => end(false)
    const timer = win.setTimeout(() => end(false), 150)
    signal.addEventListener('abort', aborted, { once: true })
    void image.decode().then(() => end(true), () => end(false))
  })
}

function animateFlight(flyer: HTMLImageElement, frames: Keyframe[], options: ImageFlightOptions): { run?: Animation; lift?: Animation } {
  const timing = { duration: options.duration, delay: options.delay ?? 0 }
  let run: Animation | undefined
  try {
    run = flyer.animate?.(frames, { ...timing, easing: options.easing, fill: 'both' })
    const lift = options.lift ? flyer.animate?.([
      { translate: '0px 0px' }, { translate: `0px ${-options.lift}px` }, { translate: '0px 0px' },
    ], { ...timing, easing: 'ease-in-out', composite: 'add' }) : undefined
    return { run, lift }
  } catch (error) {
    void run?.finished.catch(() => {})
    run?.cancel()
    flyer.remove()
    throw error
  }
}

/** A fresh inert image, measured only at the two boundaries; never a subtree snapshot. */
export function flyImage(options: ImageFlightOptions): ImageFlight {
  const { image, parent, from, to } = options
  const flyer = image.ownerDocument.createElement('img')
  flyer.src = image.currentSrc || image.src
  flyer.alt = ''
  flyer.setAttribute('aria-hidden', 'true')
  flyer.setAttribute('inert', '')
  flyer.className = 'kui-image-flight'
  Object.assign(flyer.style, { position: 'fixed', pointerEvents: 'none', margin: '0', maxWidth: 'none', maxHeight: 'none',
    left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, transformOrigin: '0 0',
    objectFit: 'fill', zIndex: options.zIndex ?? '1', borderRadius: image.ownerDocument.defaultView!.getComputedStyle(image).borderRadius })
  parent.append(flyer)
  const frames = options.frames ?? scaledFrames(from, to)
  const { run, lift } = animateFlight(flyer, frames, options)
  let settle!: (landed: boolean) => void
  const finished = new Promise<boolean>((resolve) => { settle = resolve })
  let done = false
  const end = (landed: boolean): void => {
    if (done) return
    done = true
    run?.cancel()
    lift?.cancel()
    flyer.remove()
    settle(landed)
  }
  if (run) {
    run.playbackRate = timeScaleOf(image)
    if (lift) { lift.playbackRate = run.playbackRate; void lift.finished.catch(() => {}) }
    void run.finished.then(() => end(true), () => end(false))
  } else end(true)
  return { finished, cancel: () => end(false), finish: () => end(true), reverse() {
    if (done || !run?.reverse) return false
    run.reverse()
    lift?.reverse()
    return true
  } }
}
