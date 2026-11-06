import { createJsInstance } from '../../core/instances.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import { attributeChannel, SUBTREE_CHANNEL } from '../../core/types.js'
import type { Primitive } from '../../core/types.js'

const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom']

const prepareCube: NonNullable<Primitive['prepare']> = (el, _params, ctx) => {
  if (el.children.length !== 6) {
    ctx.warn('cube-rotate parts:cube needs exactly six authored faces')
    return { ...createJsInstance({ activate() {}, destroy() {} }), setupOnly: true }
  }
  const attrs = createAttributeLedger(el)
  attrs.set('data-kui-cube', '')
  const faces = [...el.children].map((face, i) => {
    const ledger = createAttributeLedger(face)
    ledger.set('data-kui-cube-face', FACES[i]!)
    return ledger
  })
  if (ctx.win.getComputedStyle(el).position === 'static') ctx.style.set('position', 'relative')
  // The keyframe already projects the cube; a second perspective distorts its local axes.
  ctx.style.set('perspective', 'none')
  return { ...createJsInstance({
    activate() {},
    destroy() {
      for (const face of faces) face.restore()
      attrs.restore()
    },
  }), setupOnly: true }
}

export const cubeVariant: NonNullable<Primitive['variantFor']> = (spec, warn) => {
  if (spec.name !== 'cube-rotate') {
    if (spec.params.parts || spec.params.tumble) warn('parts and tumble apply only to cube-rotate')
    return {}
  }
  if (spec.params.tumble === 'true' && spec.params.parts !== 'cube') warn('cube-rotate tumble needs parts:cube')
  if (spec.params.parts !== 'cube') return {}
  return {
    prepare: prepareCube,
    channels: [SUBTREE_CHANNEL, 'position', attributeChannel('data-kui-cube')],
    ...(spec.params.tumble === 'true' ? { keyframes: ['kui-cube-tumble'] } : {}),
  }
}
