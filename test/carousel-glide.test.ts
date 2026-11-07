// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimDeckArrival, GLIDE_ATTR, matrixOf, recordDeckPoses } from '../src/effects/carousel/glide.js'
import type { GlideTiming } from '../src/effects/carousel/glide.js'

type Styles = Record<string, string>

const timing: GlideTiming = { durationMs: 620, easing: 'linear', reducedMotion: false }

function fakeAnimation() {
  let settle = (): void => {}
  const finished = new Promise<void>((resolve) => { settle = resolve })
  return { finished, playbackRate: 1, pause: vi.fn(), play: vi.fn(), cancel: vi.fn(), settle: () => settle() }
}

/** A window whose computed styles are whatever the test says the stylesheet resolved to. */
function setup(cardCount = 1) {
  const host = document.createElement('div')
  const cards = Array.from({ length: cardCount }, () => host.appendChild(document.createElement('figure')))
  const styles = new Map<Element, Styles>()
  const started: { el: Element; frames: Keyframe[]; animation: ReturnType<typeof fakeAnimation> }[] = []
  const animate = function (this: Element, frames: Keyframe[]) {
    const animation = fakeAnimation()
    started.push({ el: this, frames, animation })
    return animation
  }
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get(this: HTMLElement) { return Number(this.dataset.left ?? 0) } })
  let frame: FrameRequestCallback = () => {}
  const win = {
    getComputedStyle: (el: Element) => ({ getPropertyValue: (name: string) => styles.get(el)?.[name] ?? '' }),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7 }),
    cancelAnimationFrame: vi.fn(),
  } as unknown as Window
  return { host, cards, styles, started, win, nextFrame: () => frame(0) }
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetLeft')
})

describe('matrixOf', () => {
  it('reads the three spellings a computed transform comes in', () => {
    expect(matrixOf('none')).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    expect(matrixOf('matrix(1, 2, 3, 4, 5, 6)')).toEqual([1, 2, 0, 0, 3, 4, 0, 0, 0, 0, 1, 0, 5, 6, 0, 1])
    expect(matrixOf('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,9,8,7,1)').slice(12, 15)).toEqual([9, 8, 7])
  })
})

describe('a switch of effect on one host', () => {
  it('starts each card from where it stood, and leaves the end to the stylesheet', () => {
    const { host, cards, styles, started, win, nextFrame } = setup()
    const card = cards[0]!
    card.dataset.left = '100'
    styles.set(card, { transform: 'matrix(1, 0, 0, 1, 50, 0)', opacity: '1', visibility: 'visible' })
    recordDeckPoses(host, cards, win)

    const land = claimDeckArrival(host)!
    expect(host.getAttribute(GLIDE_ATTR)).toBe('arriving')
    card.dataset.left = '300'
    styles.set(card, { transform: 'none', opacity: '1', visibility: 'visible' })
    const stop = land(cards, timing, win)

    expect(host.getAttribute(GLIDE_ATTR)).toBe('flying')
    expect(started).toHaveLength(1)
    const { frames, animation } = started[0]!
    // One keyframe at 0: the card painted at 150 now sits at 300, so it starts 150 back.
    expect(frames).toHaveLength(1)
    expect(frames[0]!.offset).toBe(0)
    expect(matrixOf(String(frames[0]!.transform))[12]).toBeCloseTo(-150)
    // Held through the install's own frame, then released.
    expect(animation.pause).toHaveBeenCalledOnce()
    expect(animation.play).not.toHaveBeenCalled()
    nextFrame()
    expect(animation.play).toHaveBeenCalledOnce()

    stop()
    expect(animation.cancel).toHaveBeenCalledOnce()
    expect(win.cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(host.hasAttribute(GLIDE_ATTR)).toBe(false)
  })

  it('lets go of the host when the last card lands', async () => {
    const { host, cards, styles, started, win } = setup()
    const card = cards[0]!
    styles.set(card, { transform: 'matrix(1, 0, 0, 1, 50, 0)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(card, { transform: 'none' })
    land(cards, timing, win)
    started[0]!.animation.settle()
    await vi.waitFor(() => expect(host.hasAttribute(GLIDE_ATTR)).toBe(false))
  })

  it('does not take the attribute from the next deck when a stopped glide settles late', async () => {
    const { host, cards, styles, started, win } = setup()
    styles.set(cards[0]!, { transform: 'matrix(1, 0, 0, 1, 50, 0)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(cards[0]!, { transform: 'none' })
    const stop = land(cards, timing, win)
    stop()
    host.setAttribute(GLIDE_ATTR, 'arriving')
    started[0]!.animation.settle()
    await Promise.resolve()
    await Promise.resolve()
    expect(host.getAttribute(GLIDE_ATTR)).toBe('arriving')
  })

  it('animates nothing for a card that did not change, or one with no recording', () => {
    const { host, cards, styles, started, win } = setup(2)
    styles.set(cards[0]!, { transform: 'none', opacity: '1' })
    recordDeckPoses(host, [cards[0]!], win)
    const land = claimDeckArrival(host)!
    land(cards, timing, win)
    expect(started).toHaveLength(0)
    expect(host.hasAttribute(GLIDE_ATTR)).toBe(false)
  })

  it('lands at once under reduced motion', () => {
    const { host, cards, styles, started, win } = setup()
    styles.set(cards[0]!, { transform: 'matrix(1, 0, 0, 1, 50, 0)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(cards[0]!, { transform: 'none' })
    land(cards, { ...timing, reducedMotion: true }, win)
    expect(started).toHaveLength(0)
    expect(host.hasAttribute(GLIDE_ATTR)).toBe(false)
  })

  it('fades a card the new shape hides, and ignores one hidden at both ends', () => {
    const { host, cards, styles, started, win } = setup(2)
    styles.set(cards[0]!, { visibility: 'visible', opacity: '1' })
    styles.set(cards[1]!, { visibility: 'hidden', opacity: '1' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(cards[0]!, { visibility: 'hidden', opacity: '1' })
    land(cards, timing, win)
    expect(started).toHaveLength(1)
    expect(started[0]!.el).toBe(cards[0])
    expect(started[0]!.frames[0]!.visibility).toBe('visible')
    expect(started[0]!.frames[1]).toEqual({ offset: 1, opacity: 0 })
  })

  it('fades in a card that was hidden, and carries a changed filter', () => {
    const { host, cards, styles, started, win } = setup()
    styles.set(cards[0]!, { visibility: 'hidden', opacity: '1', filter: 'blur(2px)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(cards[0]!, { visibility: 'visible', opacity: '1', filter: 'none' })
    land(cards, timing, win)
    expect(started[0]!.frames[0]).toMatchObject({ opacity: '0', filter: 'blur(2px)' })
  })

  it('hands a billboard to a new billboard, and folds it into the card when there is none', () => {
    const turned = 'matrix(0, 1, -1, 0, 0, 0)'
    const run = (nextStyle: string) => {
      const { host, cards, styles, started, win } = setup()
      const card = cards[0]!
      const child = card.appendChild(document.createElement('img'))
      styles.set(card, { 'transform-style': 'preserve-3d' })
      styles.set(child, { transform: turned })
      recordDeckPoses(host, cards, win)
      const land = claimDeckArrival(host)!
      styles.set(card, { 'transform-style': nextStyle })
      styles.set(child, { transform: nextStyle === 'preserve-3d' ? 'none' : turned })
      land(cards, timing, win)
      return { started, card, child }
    }
    const kept = run('preserve-3d')
    expect(kept.started.map(entry => entry.el)).toEqual([kept.child])
    const folded = run('flat')
    expect(folded.started.map(entry => entry.el)).toEqual([folded.card])
  })

  it('undoes the old camera and applies the new one, with a host scale', () => {
    const { host, cards, styles, started, win } = setup()
    styles.set(host, { perspective: '1000px', scale: '2' })
    styles.set(cards[0]!, { transform: 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,-100,1)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(host, { perspective: 'none', scale: 'none' })
    styles.set(cards[0]!, { transform: 'none' })
    land(cards, timing, win)
    const start = matrixOf(String(started[0]!.frames[0]!.transform))
    expect(start[0]).toBeCloseTo(2)
    // The recorded lens stays in the start, since the new host has none to supply it.
    expect(start[11]).toBeCloseTo(-0.001)
  })

  it('applies a per-axis host scale and the time scale', () => {
    const { host, cards, styles, started, win } = setup()
    host.setAttribute('data-kui-time-scale', '2')
    styles.set(host, { scale: '2 3' })
    styles.set(cards[0]!, { transform: 'none' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    styles.set(host, { scale: 'none' })
    land(cards, timing, win)
    const start = matrixOf(String(started[0]!.frames[0]!.transform))
    expect([start[0], start[5]]).toEqual([2, 3])
    expect(started[0]!.animation.playbackRate).toBe(2)
  })

  it('counts scrolled, bordered offset ancestors in a layout position', () => {
    const { host, cards, styles, started, win } = setup()
    const parent = document.createElement('div')
    Object.defineProperties(parent, {
      offsetLeft: { value: 10 }, clientLeft: { value: 1 }, scrollLeft: { value: 4 },
      offsetTop: { value: 0 }, clientTop: { value: 0 }, scrollTop: { value: 0 },
      offsetParent: { value: null },
    })
    Object.defineProperty(cards[0]!, 'offsetParent', { configurable: true, value: parent })
    styles.set(cards[0]!, { transform: 'none' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    Object.defineProperty(cards[0]!, 'offsetParent', { configurable: true, value: null })
    land(cards, timing, win)
    expect(matrixOf(String(started[0]!.frames[0]!.transform))[12]).toBeCloseTo(7)
  })
})

describe('a row, its edge and its copies', () => {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 }) as DOMRect
  const copyIn = (host: HTMLElement): HTMLElement => {
    const copy = host.appendChild(document.createElement('img'))
    copy.setAttribute('data-kui-row-copy', '')
    return copy
  }
  const clipHost = (host: HTMLElement) => { host.getBoundingClientRect = () => rect(0, 100) }

  it('fades in a card that was past the row’s edge, and fades out one that lands past it', () => {
    const { host, cards, styles, started, win } = setup(2)
    clipHost(host)
    styles.set(host, { 'overflow-x': 'clip' })
    const [leaving, arriving] = cards as [HTMLElement, HTMLElement]
    leaving.getBoundingClientRect = () => rect(200, 300)
    arriving.getBoundingClientRect = () => rect(-300, -200)
    for (const card of cards) styles.set(card, { transform: 'none', opacity: '1', visibility: 'visible' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    host.setAttribute('data-kui-row-static', 'false')
    leaving.getBoundingClientRect = () => rect(10, 50)
    arriving.getBoundingClientRect = () => rect(200, 300)
    land(cards, timing, win)
    expect(started.find(run => run.el === leaving)!.frames[0]!.opacity).toBe('0')
    // Out of sight at both ends, and the glide lifts the clip, so it is held unseen.
    expect(started.find(run => run.el === arriving)!.frames).toEqual([{ offset: 0, opacity: 0 }, { offset: 1, opacity: 0 }])
    expect(started.find(run => run.el === host)!.frames.at(-1)!.clipPath).toBe('inset(0px)')
  })

  it('cross-fades copies: the old row’s fade out and go, the new row’s fade in or stay unseen', async () => {
    const { host, cards, styles, started, win } = setup()
    clipHost(host)
    styles.set(host, { 'overflow-x': 'hidden' })
    styles.set(cards[0]!, { transform: 'matrix(1, 0, 0, 1, 50, 0)', opacity: '1' })
    const onScreen = copyIn(host)
    onScreen.getBoundingClientRect = () => rect(10, 50)
    const offScreen = copyIn(host)
    offScreen.getBoundingClientRect = () => rect(500, 600)
    styles.set(onScreen, { opacity: '1' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    onScreen.remove()
    offScreen.remove()
    host.setAttribute('data-kui-row-static', 'false')
    const fresh = copyIn(host)
    fresh.getBoundingClientRect = () => rect(10, 50)
    const freshOff = copyIn(host)
    freshOff.getBoundingClientRect = () => rect(500, 600)
    styles.set(cards[0]!, { transform: 'none', opacity: '1' })
    land(cards, timing, win)
    expect(started.find(run => run.el === fresh)!.frames).toEqual([{ offset: 0, opacity: 0 }])
    expect(started.find(run => run.el === freshOff)!.frames).toHaveLength(2)
    expect(onScreen.isConnected).toBe(true)
    expect(onScreen.style.position).toBe('absolute')
    expect(started.find(run => run.el === onScreen)!.frames.at(-1)!.opacity).toBe(0)
    expect(offScreen.isConnected).toBe(false)
    // It was clipping already, so it goes on clipping.
    expect(started.find(run => run.el === host)!.frames[0]!.clipPath).toBe('inset(0px)')
    for (const run of started) run.animation.settle()
    await new Promise(resolve => setTimeout(resolve))
    expect(onScreen.isConnected).toBe(false)
    expect(host.hasAttribute(GLIDE_ATTR)).toBe(false)
  })

  it('brings the clip back only in the second half, when the old shape was not clipping', () => {
    const { host, cards, styles, started, win } = setup()
    clipHost(host)
    styles.set(cards[0]!, { transform: 'matrix(1, 0, 0, 1, 50, 0)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    host.setAttribute('data-kui-row-static', 'false')
    styles.set(cards[0]!, { transform: 'none' })
    land(cards, timing, win)
    expect(started.find(run => run.el === host)!.frames[0]!.clipPath).toBe('inset(-100px)')
  })

  it.each([
    ['a line, which does not clip', 'line', 'false'],
    ['a static row, which is a scroller', 'row', 'true'],
  ])('leaves the clip alone on %s', (_name, shape, isStatic) => {
    const { host, cards, styles, started, win } = setup()
    styles.set(cards[0]!, { transform: 'matrix(1, 0, 0, 1, 50, 0)' })
    recordDeckPoses(host, cards, win)
    const land = claimDeckArrival(host)!
    host.setAttribute('data-kui-row-shape', shape)
    host.setAttribute('data-kui-row-static', isStatic)
    styles.set(cards[0]!, { transform: 'none' })
    land(cards, timing, win)
    expect(started.map(run => run.el)).toEqual([cards[0]])
  })
})

describe('when no switch is happening', () => {
  it('claims nothing on a host nothing was recorded for', () => {
    expect(claimDeckArrival(document.createElement('div'))).toBeUndefined()
  })

  it('forgets a recording no deck claimed in the same task', async () => {
    const { host, cards, win } = setup()
    recordDeckPoses(host, cards, win)
    await Promise.resolve()
    expect(claimDeckArrival(host)).toBeUndefined()
  })

  it('does nothing at expiry when the recording was already claimed', async () => {
    const { host, cards, win } = setup()
    recordDeckPoses(host, cards, win)
    expect(claimDeckArrival(host)).toBeDefined()
    host.removeAttribute(GLIDE_ATTR)
    await Promise.resolve()
    expect(claimDeckArrival(host)).toBeUndefined()
  })

  it('records nothing where the Web Animations API is missing', () => {
    const host = document.createElement('div')
    const win = { getComputedStyle: vi.fn() } as unknown as Window
    recordDeckPoses(host, [], win)
    expect(win.getComputedStyle).not.toHaveBeenCalled()
    expect(claimDeckArrival(host)).toBeUndefined()
  })
})
