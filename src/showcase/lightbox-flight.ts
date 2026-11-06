import { flyImage, flightImageReady, scaledFrames } from '../core/image-flight.js'
import type { ImageFlight } from '../core/image-flight.js'
import { createStyleLedger } from '../core/owned-styles.js'
import type { ModalMotion } from './modal-shell.js'

interface LightboxFlightOptions {
  source: () => HTMLImageElement | null
  view: HTMLImageElement
  duration: number
  easing: string
  warn(message: string): void
}

function visible(box: DOMRect, win: Window): boolean {
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < win.innerHeight && box.left < win.innerWidth
}

function viewportClip(box: DOMRect, view: HTMLImageElement, win: Window): string {
  const radius = win.getComputedStyle(view).borderRadius
  return `inset(${Math.max(0, -box.top)}px ${Math.max(0, box.right - win.innerWidth)}px ${Math.max(0, box.bottom - win.innerHeight)}px ${Math.max(0, -box.left)}px round ${radius})`
}

/** Uniform cover crops and tall viewers clip the full image without changing its proportions. */
function endpoints(source: HTMLImageElement, view: HTMLImageElement, win: Window): { from: DOMRect; to: DOMRect; frames: Keyframe[] } | undefined {
  const from = source.getBoundingClientRect()
  const to = view.getBoundingClientRect()
  if (!visible(from, win) || !visible(to, win)) return
  const css = win.getComputedStyle(source)
  if (!['cover', 'fill'].includes(css.objectFit) || css.borderRadius.includes('%')) return
  if (css.objectFit === 'fill') {
    const frames = scaledFrames(from, to)
    if (view.classList.contains('is-tall')) {
      frames[0]!.clipPath = 'inset(0px)'
      frames[1]!.clipPath = viewportClip(to, view, win)
    }
    return { from, to, frames }
  }
  const position = css.objectPosition.split(/\s+/)
  if (!position.every((value) => value.endsWith('%'))) return
  const scale = Math.max(from.width / to.width, from.height / to.height)
  const cropX = (to.width * scale - from.width) * Number.parseFloat(position[0]!) / 100
  const cropY = (to.height * scale - from.height) * Number.parseFloat(position[1]!) / 100
  const radius = (Number.parseFloat(css.borderRadius) || 0) / scale
  return { from, to, frames: [
    { translate: `${from.left - to.left - cropX}px ${from.top - to.top - cropY}px`, scale: `${scale}`,
      clipPath: `inset(${cropY / scale}px ${(to.width * scale - from.width - cropX) / scale}px ${(to.height * scale - from.height - cropY) / scale}px ${cropX / scale}px round ${radius}px)` },
    { translate: '0px 0px', scale: '1', clipPath: viewportClip(to, view, win) },
  ] }
}

/** The shell owns this handle across decode, open, reverse, re-entry and release. */
export function lightboxFlight(dialog: HTMLElement, options: LightboxFlightOptions): ModalMotion {
  const { view, duration, easing } = options
  const win = view.ownerDocument.defaultView!
  const controller = new AbortController()
  const style = createStyleLedger(view)
  let run: ImageFlight | undefined
  let closing = false
  let navigated = false
  const stopRun = (): void => {
    run?.cancel()
    run = undefined
    style.restore()
  }
  const changes = new MutationObserver(() => { navigated = true; stopRun() })
  const cancel = (): void => {
    controller.abort()
    stopRun()
    dialog.classList.remove('kui-lightbox-flight')
    changes.disconnect()
    win.visualViewport?.removeEventListener('resize', cancel)
  }
  const play = (reverse: boolean): ImageFlight | undefined => {
    const source = options.source()
    if (!source?.isConnected || !view.isConnected) return
    const boxes = endpoints(source, view, win)
    if (!boxes) return
    dialog.classList.add('kui-lightbox-flight')
    style.set('visibility', 'hidden')
    const flight = flyImage({ image: view, parent: dialog, ...boxes, duration, easing,
      frames: reverse ? [...boxes.frames].reverse() : boxes.frames })
    run = flight
    void flight.finished.then(() => { if (run === flight) style.restore() })
    return flight
  }
  style.set('visibility', 'hidden')
  void flightImageReady(view, controller.signal).then((decoded) => {
    if (controller.signal.aborted || closing || navigated) return
    if (decoded && play(false)) return
    style.restore()
    dialog.classList.remove('kui-lightbox-flight')
  }).catch((error: unknown) => { cancel(); options.warn(`lightbox flight failed: ${String(error)}`) })
  win.addEventListener('resize', cancel, { signal: controller.signal })
  win.addEventListener('scroll', cancel, { capture: true, signal: controller.signal })
  win.visualViewport?.addEventListener('resize', cancel)
  changes.observe(view, { attributes: true, attributeFilter: ['src'] })
  changes.observe(view.parentElement!, { childList: true })
  return {
    cancel,
    dismiss() {
      closing = true
      if (run && options.source()?.isConnected && run.reverse()) return run.finished
      stopRun()
      if (controller.signal.aborted || !view.complete || !view.naturalWidth) { cancel(); return }
      const reverse = play(true)
      if (!reverse) cancel()
      return reverse?.finished
    },
  }
}
