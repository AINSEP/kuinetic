import type { PrepareContext } from '../../core/effect-context.js'
import { frameScheduler } from '../../core/element-size.js'

/** Image sources can change without changing a fixed-size image's observed box. */
export function watchCopySources(host: Element, ctx: PrepareContext, refresh: () => void) {
  const frame = frameScheduler(ctx.win, refresh)
  const original = (node: Element): boolean => !node.hasAttribute('data-kui-row-copy')
  const Observer = (ctx.win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver
  const observer = Observer ? new Observer(records => {
    if (records.some(record => original(record.target as Element))) frame.request()
  }) : undefined
  observer?.observe(host, { subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'dir'] })
  const load = (event: Event): void => { if (original(event.target as Element)) frame.request() }
  host.addEventListener('load', load, true)
  return () => {
    observer?.disconnect()
    host.removeEventListener('load', load, true)
    frame.cancel()
  }
}

/** Fresh image visuals only: never duplicate links, IDs, effects or semantic slides. */
export function createRowCopies(host: Element, ctx: PrepareContext) {
  let copies: HTMLImageElement[] = []
  let warned = false
  const clear = (): void => {
    for (const copy of copies) copy.remove()
    copies = []
  }
  return {
    clear,
    measure(slides: readonly HTMLElement[], widths: number[], cycle: number, required: number): HTMLImageElement[] {
      clear()
      if (!slides.length || cycle <= 0) return copies
      if (slides.some(slide => slide.localName !== 'img')) {
        if (!warned) ctx.warn('carousel-loop copies:auto supports direct images only; keeping the original strip.')
        warned = true
        return copies
      }
      const turns = Math.max(0, Math.ceil(required / cycle) - 1)
      if (turns > 32) return copies
      const heights = slides.map(slide => slide.offsetHeight)
      for (let turn = 0; turn < turns; turn++) {
        slides.forEach((slide, index) => {
          const image = slide as HTMLImageElement
          const copy = ctx.doc.createElement('img')
          copy.src = image.currentSrc || image.src
          copy.className = image.className
          copy.style.cssText = image.style.cssText
          for (const name of Array.from(copy.style)) if (name.startsWith('--kui-')) copy.style.removeProperty(name)
          copy.style.boxSizing = 'border-box'
          copy.style.width = `${widths[index]}px`
          copy.style.height = `${heights[index]}px`
          copy.alt = ''
          copy.inert = true
          copy.setAttribute('aria-hidden', 'true')
          copy.setAttribute('data-kui-row-copy', '')
          host.append(copy)
          copies.push(copy)
        })
      }
      return copies
    },
  }
}
