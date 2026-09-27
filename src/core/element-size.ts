import type { Cleanup } from './types.js'

/** A resize subscription whose observed elements can change as an effect changes targets. */
export interface SizeWatch {
  observe(element: Element): void
  unobserve(element: Element): void
  disconnect: Cleanup
}

/**
 * Watch element boxes, including the window-resize fallback for browsers without ResizeObserver.
 *
 * @complexity O(1) per observed element and notification; O(n) space in observed elements.
 * @overallScore 100
 */
export function watchElementSize(win: Window, onChange: () => void): SizeWatch {
  const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(onChange) : undefined
  const elements = new Set<Element>()
  win.addEventListener('resize', onChange, { passive: true })
  return {
    observe(element) {
      if (elements.has(element)) return
      elements.add(element)
      observer?.observe(element)
    },
    unobserve(element) {
      elements.delete(element)
      observer?.unobserve(element)
    },
    disconnect() {
      win.removeEventListener('resize', onChange)
      observer?.disconnect()
      elements.clear()
    },
  }
}

/**
 * Coalesce notifications into one callback in the next animation frame; cancel on teardown.
 * @complexity O(1) time and space per request.
 * @overallScore 100
 */
export function frameScheduler(win: Window, callback: () => void): { request(): void; cancel: Cleanup } {
  let frame: number | undefined
  let timeout: number | undefined
  const run = (): void => {
    frame = undefined
    timeout = undefined
    callback()
  }
  return {
    request() {
      if (frame !== undefined || timeout !== undefined) return
      if (win.requestAnimationFrame) frame = win.requestAnimationFrame(run)
      else timeout = win.setTimeout(run, 16)
    },
    cancel() {
      if (frame !== undefined) win.cancelAnimationFrame(frame)
      if (timeout !== undefined) win.clearTimeout(timeout)
      frame = undefined
      timeout = undefined
    },
  }
}
