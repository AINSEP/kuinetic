import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup } from '../../core/instances.js'
import type { ContinuousSetup } from '../../core/instances.js'
import type { Cleanup, EffectParams } from '../../core/types.js'
import { createDeckMotion } from '../auto-motion.js'
import { delegateControls } from '../step-index.js'

/** How long a programmatic smooth scroll is given before the timer may resume after a takeover. */
const SETTLE_MS = 700

type Align = 'start' | 'center' | 'end'

/**
 * The scroll offset at which `item` sits on its snap line inside `host`.
 *
 * Measured from rects plus the current scroll, so it needs no `offsetParent` and works for any
 * item depth. Clamped to the scrollable range, because that is where the browser would put it.
 *
 * @complexity O(1) time and space.
 */
function snapOffset(host: HTMLElement, item: Element, axis: 'x' | 'y', align: Align): number {
  const h = host.getBoundingClientRect()
  const r = item.getBoundingClientRect()
  const x = axis === 'x'
  const scroll = x ? host.scrollLeft : host.scrollTop
  const client = x ? host.clientWidth : host.clientHeight
  const max = (x ? host.scrollWidth : host.scrollHeight) - client
  const start = (x ? r.left - h.left : r.top - h.top) + scroll
  const size = x ? r.width : r.height
  let raw = start
  if (align === 'center') raw = start + size / 2 - client / 2
  else if (align === 'end') raw = start + size - client
  return Math.min(Math.max(raw, 0), Math.max(max, 0))
}

/**
 * Give a snap strip an `autoplay:` that steps through its items, on the carousel's own scheduler.
 *
 * Returns `null` (after warning where it is the author's mistake) when autoplay is not asked for or
 * cannot be honoured, so the caller keeps its plain cleanup. The pause rules — offscreen, hidden
 * tab, hover and focus, the `pause:` control, the 2s floor — all live in `createDeckMotion`; the
 * only things supplied here are how to step and when a person has taken over.
 *
 * @complexity O(n) per step in the number of items; O(1) space.
 */
export function startSnapAutoplay(request: {
  el: Element
  items: Element[]
  params: EffectParams
  ctx: PrepareContext
  release: Cleanup
}): ContinuousSetup | null {
  const { el, items, params, ctx, release } = request
  if (params.ms('autoplay', 0) === 0) return null
  const doc = ctx.doc
  if (el === doc.documentElement || el === doc.body || el === doc.scrollingElement) {
    ctx.warn('scroll-snap autoplay: refused on the page itself — it would scroll the page')
    return null
  }
  if (items.length < 2) {
    ctx.warn('scroll-snap autoplay: needs at least 2 items')
    return null
  }
  const host = el as HTMLElement
  const axis = params.is('axis', 'x') ? 'x' : 'y'
  const align = params.text('align', 'start') as Align

  const { motion, pause, release: releaseMotion } = createDeckMotion({
    el,
    ctx,
    params,
    label: 'scroll-snap',
    settleMs: SETTLE_MS,
    step(direction) {
      const scroll = axis === 'x' ? host.scrollLeft : host.scrollTop
      const range = axis === 'x' ? host.scrollWidth - host.clientWidth : host.scrollHeight - host.clientHeight
      if (range <= 0) return
      const targets = items.map((item) => snapOffset(host, item, axis, align))
      let current = 0
      let best = Infinity
      // `<=`: when clamped targets tie at the end of the range, the last of them is "current".
      targets.forEach((t, i) => {
        const d = Math.abs(t - scroll)
        if (d <= best) { best = d; current = i }
      })
      const next = (current + direction + items.length) % items.length
      host.scrollTo({ [axis === 'x' ? 'left' : 'top']: targets[next]!, behavior: 'smooth' })
    },
  })
  // A person taking over. Not `scroll`: our own `scrollTo` fires it.
  const takeOver = (): void => motion.interrupt()
  const opts = { passive: true } as const
  const events = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const
  for (const name of events) host.addEventListener(name, takeOver, opts)

  const releaseControls = delegateControls({ el, ctx, groups: pause ? [pause] : [] })

  return continuousSetup(() => {
    releaseControls()
    for (const name of events) host.removeEventListener(name, takeOver)
    releaseMotion()
    release()
  })
}
