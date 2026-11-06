import type { PrepareContext } from '../../core/effect-context.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import type { DeckAttachment } from './deck.js'
import { createHelixFit } from './shape-fit.js'
import type { ShapeFitRequest } from './shape-fit.js'

const RAD = Math.PI / 180

function vanDerCorput(index: number): number {
  let value = 0
  let weight = .5
  for (let rest = index; rest > 0; rest = Math.floor(rest / 2)) {
    value += weight * (rest % 2)
    weight /= 2
  }
  return value
}

/**
 * One added latitude per card, in degrees, spread for equal area. Longitude stays `place * spacing`,
 * so the live card, the wrap and every control keep the ring's own meaning. The first card sits on
 * the equator so a deck opens facing a card, not a pole.
 */
export function sphereLatitude(index: number, count: number): number {
  const spread = (vanDerCorput(index) + .5) % 1
  return Math.asin(2 * (spread * (1 - 1 / count) + .5 / count) - 1) / RAD
}

/** Where a card's face points after the CSS placement, with every angle in radians. */
export function sphereNormal(angle: number, latitude: number, tilt: number): [number, number, number] {
  const flat = Math.cos(latitude) * Math.cos(angle)
  const up = -Math.sin(latitude)
  return [
    Math.cos(latitude) * Math.sin(angle),
    up * Math.cos(tilt) - flat * Math.sin(tilt),
    up * Math.sin(tilt) + flat * Math.cos(tilt),
  ]
}

/** Latitudes are written when the slides change, never per frame. */
export function createSphereAttachment(request: Omit<ShapeFitRequest, 'sphere'>): DeckAttachment {
  const fit = createHelixFit({ ...request, sphere: true })
  const ledgers = new Map<Element, StyleLedger>()
  let placed: readonly Element[] = []
  return {
    render(nodes, count) {
      fit.render(nodes, count)
      if (nodes.length === placed.length && nodes.every((node, i) => node === placed[i])) return
      placed = nodes
      nodes.forEach((node, index) => {
        if (!ledgers.has(node)) ledgers.set(node, createStyleLedger(node))
        ledgers.get(node)!.set('--kui-sphere-lat', `${sphereLatitude(index, count)}deg`)
      })
    },
    release() {
      fit.release()
      for (const ledger of ledgers.values()) ledger.restore()
    },
  }
}

/**
 * The second axis of `drag-axis:both`: one host variable every slot reads, so a drag costs no per-card
 * work. Bounded so the pole never tips past the camera and sideways drags keep their direction.
 */
export function createSpherePitch(ctx: PrepareContext, tiltParamDeg: number, arcDeg: number) {
  const tilt = Math.min(80, Math.max(-80, -tiltParamDeg))
  let pitch = 0
  let from = 0
  return {
    value: (): number => pitch,
    begin(): void { from = pitch },
    /** `turns` is the drag as a fraction of a full cycle, the same law as the ring's own axis. */
    move(turns: number): void {
      pitch = Math.min(80 - tilt, Math.max(-80 - tilt, from - turns * arcDeg))
      ctx.style.set('--kui-sphere-pitch', `${pitch}deg`)
    },
  }
}
