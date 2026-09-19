// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { CAPS, build, el, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The two scrimmed `background-media` names — `video-hero` and `video-backdrop`.
 *
 * Deliberately not in `catalog-background-media.test.ts`, which calls the primitive's `prepare`
 * directly with a `createParams` record. That entry point cannot see a preset at all: preset
 * parameters are merged in one layer above it, at `{ ...resolved.preset.params, ...authoredParams }`
 * in `core/js-effect-preparer.ts`. A name whose whole content *is* a parameter bundle is therefore
 * only testable through the real attribute → `parse` → `compile` → `Animator` path, which is what
 * `js-effect-harness.ts` exists to drive.
 *
 * So every case below is a paired differential against `bg` — the same primitive, the same
 * attribute, the bundle removed — because "the scrim is on" only means anything next to the name
 * where it is off.
 */

const SRC = 'src:/hero.mp4 poster:/hero.jpg'

/**
 * A fake `IntersectionObserver`, since jsdom implements none — the same technique
 * `catalog-background-media-playback.test.ts` uses on the same primitive.
 *
 * Instances are counted rather than driven: the question here is only whether a name reached
 * `autoplayInView` at all, which is exactly the difference between `autoplay:in-view` and
 * `autoplay:always`.
 */
class CountingObserver {
  static readonly instances: CountingObserver[] = []
  observed: Element[] = []
  constructor() {
    CountingObserver.instances.push(this)
  }
  observe(target: Element): void {
    this.observed.push(target)
  }
  disconnect(): void {}
}

type ObserverHost = Window & { IntersectionObserver?: unknown }

let originalObserver: unknown
/** jsdom's `play()` is unimplemented and logs to the virtual console; stubbed so it can be counted. */
let play: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Emptied in place rather than reassigned: the array is `readonly`, the same shape
  // `catalog-background-media-playback.test.ts`'s own fake observer declares it.
  CountingObserver.instances.length = 0
  const win = window as ObserverHost
  originalObserver = win.IntersectionObserver
  win.IntersectionObserver = CountingObserver
  play = vi.fn(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never)
})

afterEach(() => {
  ;(window as ObserverHost).IntersectionObserver = originalObserver
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** Install one `data-kui` attribute through the whole pipeline and hand back its host. */
function mount(attribute: string): HTMLElement {
  build(`<section data-kui="${attribute}"></section>`).start()
  return el()
}

const scrim = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[data-kui-background-overlay]')

const backdrop = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[data-kui-background]')

describe('video-hero / video-backdrop bundle the scrim', () => {
  it('paints a legibility scrim that bare `bg` leaves off', () => {
    for (const name of ['video-hero', 'video-backdrop']) {
      const host = mount(`${name} ${SRC}`)
      const overlay = scrim(host)
      expect(overlay, name).not.toBeNull()
      expect(overlay!.style.background, name).toContain('black')
      // `overlay-opacity:45%` read back as the 0-1 ratio `opacity` actually takes.
      expect(overlay!.style.opacity, name).toBe('0.45')
    }
  })

  it('leaves `bg` unscrimmed on the identical attribute', () => {
    const host = mount(`bg ${SRC}`)
    // The differential: same primitive, same src, no scrim node at all — so the assertion above
    // is about the preset's parameters rather than about `background-media` always making one.
    expect(scrim(host)).toBeNull()
    expect(backdrop(host)).not.toBeNull()
  })

  it('yields the scrim to an author who turns it off', () => {
    // Preset parameters are defaults, not a hard-coded look: `js-effect-preparer` spreads the
    // authored record *over* them. At `0%` opacity `paintsOverlay` builds no node at all.
    const host = mount(`video-hero ${SRC} overlay-opacity:0%`)
    expect(scrim(host)).toBeNull()
    expect(backdrop(host)).not.toBeNull()
  })

  it('yields the scrim colour too', () => {
    const host = mount(`video-backdrop ${SRC} overlay:white`)
    expect(scrim(host)!.style.background).toContain('white')
  })
})

describe('the pair splits on autoplay', () => {
  it('starts a hero clip immediately, with no visibility gate', () => {
    const host = mount(`video-hero ${SRC}`)
    expect(backdrop(host)!.tagName).toBe('VIDEO')
    expect(play).toHaveBeenCalled()
    // `autoplay:always` returns from `startPlayback` before `autoplayInView` — the point of the
    // override is that no heuristic can catch the first screen's clip mid-stall.
    expect(CountingObserver.instances).toHaveLength(0)
  })

  it('pairs a section backdrop with the viewport instead', () => {
    const host = mount(`video-backdrop ${SRC}`)
    expect(CountingObserver.instances).toHaveLength(1)
    expect(CountingObserver.instances[0]!.observed).toEqual([backdrop(host)])
    // Not started yet: the observer decides, which is what stops a clip below the fold from
    // spending decode budget it may never be seen for.
    expect(play).not.toHaveBeenCalled()
  })
})

describe('what the names do not restate', () => {
  it('keeps the primitive defaults the bundle deliberately omits', () => {
    const node = backdrop(mount(`video-hero ${SRC}`)) as HTMLVideoElement
    // `fit:cover` is what fills a 390px phone without letterboxing or stretching, and it is the
    // primitive's default — restating it in `params` is how the two would later drift apart.
    expect(node.style.objectFit).toBe('cover')
    expect(node.style.objectPosition).toBe('50% 50%')
    expect(node.loop).toBe(true)
    // Not an authored choice and not overridable: attribute *and* property, because Safari reads
    // the markup attribute when deciding whether an inline video may autoplay.
    expect(node.muted).toBe(true)
    expect(node.hasAttribute('playsinline')).toBe(true)
    expect(node.poster).toContain('/hero.jpg')
  })

  it('degrades to the poster still under reduced motion, not to nothing', () => {
    // The standing answer for media effects: a static frame beats a blank box. `background-media`
    // declares `reducedMotion: 'shorten'` rather than `'disable'` precisely so the layer is still
    // installed — `'disable'` would leave the section with no backdrop whatsoever, which is a
    // broken page rather than a calmer one. Neither preset overrides that, and this is the
    // assertion that says so for the names an author actually types.
    document.body.innerHTML = `<section data-kui="video-hero ${SRC}"></section>`
    new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: { ...CAPS, reducedMotion: true },
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
    }).start()

    const node = backdrop(el()) as HTMLVideoElement
    expect(node).not.toBeNull()
    expect(node.poster).toContain('/hero.jpg')
    // Installed but never started, and no observer standing by to start it later either.
    expect(play).not.toHaveBeenCalled()
    expect(CountingObserver.instances).toHaveLength(0)
    // The scrim is legibility, not motion, so it stays.
    expect(scrim(el())).not.toBeNull()
  })

  it('claims no height on its host', () => {
    // A hero's box is the page's layout. `position`/`isolation` are the only properties the
    // primitive claims, and a name that forced `100svh` here would break every card-sized use.
    const host = mount(`video-hero ${SRC}`)
    expect(host.style.minHeight).toBe('')
    expect(host.style.height).toBe('')
    expect(host.style.isolation).toBe('isolate')
  })
})
