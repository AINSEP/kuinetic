import type { PrepareContext } from '../../core/effect-context.js'
import { effectDurationMs } from '../../core/js-params.js'
import type { createAttributeLedger, StyleLedger } from '../../core/owned-styles.js'
import type { EffectParams } from '../../core/types.js'

const FLIGHT_STAGGER_MS = 24

function pixelOf(centres: readonly number[], place: number): number {
  const last = centres.length - 1
  if (last < 1) return 0
  const at = Math.max(0, Math.min(place, last))
  const index = Math.min(Math.floor(at), last - 1)
  return centres[index]! + (centres[index + 1]! - centres[index]!) * (at - index)
}

function placeOf(centres: readonly number[], pixel: number): number {
  const last = centres.length - 1
  if (last < 1) return 0
  let index = 0
  while (index < last - 1 && pixel >= centres[index + 1]!) index++
  const span = Math.max(1, centres[index + 1]! - centres[index]!)
  return Math.max(0, Math.min(index + (pixel - centres[index]!) / span, last))
}

/**
 * The bounded half of `shape:line attribute:`: the app names the arrangement, this answers where a
 * place is in the column. The flex row stays the only layout, so the switch is one transform
 * interpolation. Heights are read at row measurement boundaries, never during a flight.
 */
export function createArchive(host: HTMLElement, params: EffectParams, ctx: PrepareContext,
  attributes: ReturnType<typeof createAttributeLedger>) {
  const name = params.text('attribute')
  let column = false
  let centres: number[] = []
  let timer: number | undefined

  const sync = (): boolean => {
    const next = host.getAttribute(name) === 'column'
    const changed = next !== column
    column = next
    attributes.set('data-kui-row-arrangement', column ? 'column' : 'line')
    return changed
  }
  sync()

  return {
    isColumn: () => column,
    pixelAt: (place: number): number => pixelOf(centres, place),
    bound: (place: number): number | undefined => column ? Math.max(0, Math.min(place, centres.length - 1)) : undefined,
    positionAt: (from: number, dy: number): number => placeOf(centres, pixelOf(centres, from) - dy),
    measure(slides: readonly HTMLElement[], styles: ReadonlyMap<Element, StyleLedger>): void {
      // Not the row's horizontal gap, which a negative card margin can make negative.
      const gap = parseFloat(ctx.win.getComputedStyle(host).getPropertyValue('row-gap')) || 0
      let y = 0
      centres = slides.map((slide, i) => {
        if (i > 0) y += (slides[i - 1]!.offsetHeight + slide.offsetHeight) / 2 + gap
        styles.get(slide)!.set('--kui-column-place', `${y}px`)
        return y
      })
    },
    /** Hold the deck's own motion too: a spin frame would restart every card's staggered delay. */
    fly(live: number, slides: readonly HTMLElement[], styles: ReadonlyMap<Element, StyleLedger>,
      hold: (holding: boolean) => void): void {
      if (ctx.reducedMotion) return
      slides.forEach((slide, i) => styles.get(slide)!.set('--kui-flight-rank', String(Math.abs(i - live))))
      attributes.set('data-kui-row-flight', 'true')
      hold(true)
      ctx.win.clearTimeout(timer)
      timer = ctx.win.setTimeout(() => {
        attributes.remove('data-kui-row-flight')
        hold(false)
      }, effectDurationMs(params, 620) + slides.length * FLIGHT_STAGGER_MS)
    },
    watch(onSwitch: () => void): () => void {
      const Observer = (ctx.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver
      const observer = new Observer(() => { if (sync()) onSwitch() })
      observer.observe(host, { attributes: true, attributeFilter: [name] })
      return () => {
        observer.disconnect()
        ctx.win.clearTimeout(timer)
      }
    },
  }
}
