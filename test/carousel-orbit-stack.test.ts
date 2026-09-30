// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams, readParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'
import { CHANNEL } from '../src/core/types.js'
import { CAROUSEL_PRESETS, SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'
import { FACE_ATTR, WRAP_ATTR } from '../src/effects/carousel/deck.js'
import { SPATIAL_STACK_PRIMITIVE, STACK_PRESETS, stackFace, stackPlace } from '../src/effects/carousel/stack.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The two new shapes on the shared deck: the flat ring (`carousel-orbit`, `plane:screen` on
 * `spatial-ring`) and the depth stack (`carousel-stack`, `spatial-stack`).
 *
 * Everything the deck does for every shape — the index, controls, drag, keyboard, motion — is
 * covered against the ring in `carousel-3d*.test.ts` and `carousel-spin.test.ts`; this file covers
 * only what the shapes add: their published facts, their face tests and their wrap numbering. What
 * they look like is the stylesheet's, pinned structurally in `carousel-css.test.ts` and in a real
 * browser in `test/browser/carousel-motion.test.mjs`.
 */

function fakeCtx(el: Element, options: { warn?: (m: string) => void; computed?: (node: Element) => void } = {}): PrepareContext {
  return {
    win: {
      getComputedStyle: (node: Element) => {
        options.computed?.(node)
        return window.getComputedStyle(node)
      },
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (handle: number) => clearTimeout(handle),
      requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
      cancelAnimationFrame: (handle: number) => cancelAnimationFrame(handle),
    } as unknown as Window,
    doc: window.document,
    reducedMotion: false,
    warn: options.warn ?? (() => {}),
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

function mount(
  primitive: Primitive,
  html: string,
  params: Record<string, string>,
  options: { warn?: (m: string) => void; computed?: (node: Element) => void } = {},
): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = html
  const host = document.body.querySelector('[data-host]') as HTMLElement
  const instance = primitive.prepare!(
    host,
    readEffectParams(params, primitive.parameters, () => {}),
    fakeCtx(host, options),
  )
  instance.activate()
  return { host, instance }
}

const ORBIT_PRESET = CAROUSEL_PRESETS.find((preset) => preset.name === 'carousel-orbit')!

const ORBIT = `
  <div data-host>
    <h2 class="word">CAROUSEL</h2>
    <figure class="card">1</figure><figure class="card">2</figure>
    <figure class="card">3</figure><figure class="card">4</figure>
    <button class="fwd" type="button">Next</button>
  </div>
`

const STACK = `
  <div data-host>
    <figure>1</figure><figure>2</figure><figure>3</figure>
    <figure>4</figure><figure>5</figure><figure>6</figure>
  </div>
`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('carousel-orbit: the ring in the screen plane', () => {
  it('is the ring primitive with plane:screen, upright cards, and the ring’s own guarantees', () => {
    expect(ORBIT_PRESET.primitive).toBe('spatial-ring')
    expect(ORBIT_PRESET.params).toEqual({ plane: 'screen', facing: 'camera' })
    expect(ORBIT_PRESET.requiresOwnSubtree).toBe(true)
    expect(ORBIT_PRESET.phase).toBe('idle')
    expect(catalogRegistry().resolve('carousel-orbit')?.primitive.id).toBe('spatial-ring')
  })

  it('closes the plane word list and defaults to the 3D ring every existing name is', () => {
    const warnings: string[] = []
    expect(readParams({}, SPATIAL_RING_PRIMITIVE.parameters, () => {}).plane).toBe('depth')
    readParams({ plane: 'flat' }, SPATIAL_RING_PRIMITIVE.parameters, (m) => warnings.push(m))
    expect(warnings).toHaveLength(1)
  })

  it('publishes the plane, and never calls a flat card turned away — not even at six o’clock', () => {
    const { host, instance } = mount(SPATIAL_RING_PRIMITIVE, ORBIT, { ...ORBIT_PRESET.params, target: '.card' })
    expect(host.getAttribute('data-kui-ring-plane')).toBe('screen')
    expect(host.getAttribute('data-kui-ring-facing')).toBe('camera')
    const faces = [...host.querySelectorAll('.card')].map((card) => card.getAttribute(FACE_ATTR))
    expect(faces).toEqual(['front', 'front', 'front', 'front'])
    // The word is not a slot: `target:` left it alone, so it stays centred and off the ring.
    expect(host.querySelector('.word')!.hasAttribute('data-kui-step-offset')).toBe(false)
    instance.destroy()
  })

  it('a 3D ring of the same size does call the far card turned away (the contrast)', () => {
    const { host, instance } = mount(SPATIAL_RING_PRIMITIVE, ORBIT, { target: '.card' })
    const faces = [...host.querySelectorAll('.card')].map((card) => card.getAttribute(FACE_ATTR))
    expect(faces).toContain('back')
    instance.destroy()
  })

  it('publishes the host’s slide count and a card’s size, even with an authored radius', () => {
    document.body.innerHTML = ORBIT
    const first = document.querySelector('.card')!
    Object.defineProperty(first, 'offsetWidth', { value: 180, configurable: true })
    Object.defineProperty(first, 'offsetHeight', { value: 240, configurable: true })
    const host = document.querySelector('[data-host]') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ plane: 'screen', radius: '300px', target: '.card' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      fakeCtx(host),
    )
    instance.activate()
    // The host reserves its own circle from these: transformed slots take no layout space.
    expect(host.style.getPropertyValue('--kui-item-count')).toBe('4')
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('180px')
    expect(host.style.getPropertyValue('--kui-item-height')).toBe('240px')
    instance.destroy()
    expect(host.getAttribute('style') ?? '').toBe('')
  })

  it('does not warn about flattening ancestors, which a flat ring cannot suffer from', () => {
    const warnings: string[] = []
    document.body.innerHTML = `<div style="overflow: hidden">${ORBIT}</div>`
    const host = document.querySelector('[data-host]') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ plane: 'screen', target: '.card' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      fakeCtx(host, { warn: (m) => warnings.push(m) }),
    )
    instance.activate()
    expect(warnings.filter((m) => m.includes('flattens'))).toEqual([])
    instance.destroy()
  })

  it('turns with spin: like any ring', () => {
    const { host, instance } = mount(SPATIAL_RING_PRIMITIVE, ORBIT, { ...ORBIT_PRESET.params, target: '.card', spin: '40s' })
    vi.advanceTimersByTime(10_000)
    expect(Number(host.style.getPropertyValue('--kui-step-position'))).toBeCloseTo(1, 1)
    instance.destroy()
  })
})

describe('carousel-stack: the depth stack', () => {
  it('re-reads a circular offset as a place in the stack, with one place in front for the card that left', () => {
    // Six cards: circular offsets 0, 1, 2, ±3, -2, -1.
    expect([0, 1, 2, 3, -3, -2, -1].map((offset) => stackPlace(offset, 6))).toEqual([0, 1, 2, 3, 3, 4, -1])
  })

  it('shows the front card, depth cards behind, and neither the one that left nor the rest', () => {
    expect(stackFace(0, 0, 6, 3)).toBe('front')
    expect(stackFace(3, 0, 6, 3)).toBe('front')
    expect(stackFace(-2, 0, 6, 3)).toBe('back')
    expect(stackFace(-1, 0, 6, 3)).toBe('back')
    // Mid-drag, the leaving card is still showing until it is half a place gone.
    expect(stackFace(0, 0.4, 6, 3)).toBe('front')
    expect(stackFace(0, 0.6, 6, 3)).toBe('back')
  })

  it('is its own primitive, declaring the channels it paints that the ring does not', () => {
    expect(SPATIAL_STACK_PRIMITIVE.channels).toEqual(
      expect.arrayContaining([CHANNEL.skew, 'discrete', CHANNEL.opacity, CHANNEL.filter]),
    )
    expect(SPATIAL_RING_PRIMITIVE.channels).not.toContain(CHANNEL.opacity)
    expect(STACK_PRESETS.map((preset) => preset.name)).toEqual(['carousel-stack'])
    expect(catalogRegistry().resolve('carousel-stack')?.primitive.id).toBe('spatial-stack')
  })

  it('takes the deck’s motion and controls, and none of the ring’s geometry', () => {
    const names = Object.keys(SPATIAL_STACK_PRIMITIVE.parameters)
    expect(names).toEqual(expect.arrayContaining(['spin', 'autoplay', 'pause', 'next', 'prev', 'jump', 'grab']))
    expect(names).toEqual(expect.arrayContaining(['shift', 'rise', 'shrink', 'blur', 'fade', 'depth']))
    for (const ring of ['tilt', 'arc', 'radius', 'facing', 'plane']) expect(names).not.toContain(ring)
  })

  it('holds depth to a whole number of cards in range', () => {
    const warnings: string[] = []
    readParams({ depth: '2.5' }, SPATIAL_STACK_PRIMITIVE.parameters, (m) => warnings.push(m))
    readParams({ depth: '0' }, SPATIAL_STACK_PRIMITIVE.parameters, (m) => warnings.push(m))
    readParams({ depth: '4' }, SPATIAL_STACK_PRIMITIVE.parameters, (m) => warnings.push(m))
    expect(warnings).toHaveLength(2)
  })

  it('marks which cards show, and moves them on with autoplay:', () => {
    const { host, instance } = mount(SPATIAL_STACK_PRIMITIVE, STACK, { autoplay: '3s' })
    const faces = (): (string | null)[] => [...host.children].map((card) => card.getAttribute(FACE_ATTR))
    expect(faces()).toEqual(['front', 'front', 'front', 'front', 'back', 'back'])
    vi.advanceTimersByTime(3_000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    // The first card has left (place -1); the fifth has come into view at the back.
    expect(faces()).toEqual(['back', 'front', 'front', 'front', 'front', 'back'])
    instance.destroy()
    expect(host.querySelectorAll(`[${FACE_ATTR}]`)).toHaveLength(0)
  })

  it('recycles the card that left to the back without a transition — and only that card', () => {
    const flushedWithFlag: Element[] = []
    const { host, instance } = mount(SPATIAL_STACK_PRIMITIVE, `${STACK.replace('</div>', '<button class="fwd">n</button></div>')}`, { next: '.fwd', target: 'figure' }, {
      computed: (node) => { if (node.getAttribute(WRAP_ATTR) === 'true') flushedWithFlag.push(node) },
    })
    const fwd = host.querySelector('.fwd')!
    const cards = [...host.querySelectorAll('figure')]
    fwd.dispatchEvent(new Event('click', { bubbles: true }))
    // Step 1: at rest the sixth card waits in the "just left" slot (-1), so it is the one recycled
    // to the back (4). Card 4's *circular* offset also jumped, 3 to -3 — but its stack place went
    // 3 to 2, a real visible move, and it is not flagged.
    expect(flushedWithFlag).toEqual([cards[5]])
    fwd.dispatchEvent(new Event('click', { bubbles: true }))
    // Step 2: now card 1, which left on the first press, is the one recycled.
    expect(flushedWithFlag).toEqual([cards[5], cards[0]])
    expect(host.querySelectorAll(`[${WRAP_ATTR}]`)).toHaveLength(0)
    instance.destroy()
  })
})
