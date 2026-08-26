import { describe, expect, it, vi } from 'vitest'
import { autoplayInView, startPlayback } from '../src/effects/catalog/background-media.js'
import type {
  AutoplayMode,
  BackgroundMediaOptions,
} from '../src/effects/catalog/background-media.js'

/**
 * jsdom implements no `IntersectionObserver`, so the real environment's branch is exercised by a
 * fake — the same technique `catalog-media-js.test.ts` uses for `ResizeObserver`.
 */
describe('autoplayInView', () => {
  class FakeIntersectionObserver {
    static readonly instances: FakeIntersectionObserver[] = []
    callback: (entries: { isIntersecting: boolean }[]) => void
    observed: Element[] = []
    disconnected = false
    options: unknown
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void, options?: unknown) {
      this.callback = callback
      this.options = options
      FakeIntersectionObserver.instances.push(this)
    }
    observe(target: Element): void {
      this.observed.push(target)
    }
    disconnect(): void {
      this.disconnected = true
    }
  }

  type ObserverHost = Window & { IntersectionObserver?: unknown }

  function withFakeObserver(run: () => void): void {
    const win = window as ObserverHost
    const original = win.IntersectionObserver
    win.IntersectionObserver = FakeIntersectionObserver
    try {
      run()
    } finally {
      win.IntersectionObserver = original
    }
  }

  /** jsdom's `play()`/`pause()` are unimplemented, so both are stubbed and observed. */
  function fakeVideo(): HTMLVideoElement & { plays: number; pauses: number } {
    const video = document.createElement('video') as HTMLVideoElement & {
      plays: number
      pauses: number
    }
    video.plays = 0
    video.pauses = 0
    let paused = true
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true })
    video.play = vi.fn(() => {
      video.plays++
      paused = false
      return Promise.resolve()
    })
    video.pause = vi.fn(() => {
      video.pauses++
      paused = true
    })
    return video
  }

  it('plays on any intersection at all and pauses when the clip leaves', () => {
    withFakeObserver(() => {
      const video = fakeVideo()
      const stop = autoplayInView(video, window)
      const observer = FakeIntersectionObserver.instances.at(-1)!

      expect(observer.observed).toEqual([video])
      /*
       * `threshold: 0`, not the `0.25` a card-sized video would use. `intersectionRatio` is
       * measured against the target, and this target is usually a whole section: one taller than
       * four viewports can never reach 0.25 at any scroll position, so a fractional threshold is a
       * clip that silently never plays.
       */
      expect(observer.options).toEqual({ threshold: 0 })

      observer.callback([{ isIntersecting: true }])
      expect(video.plays).toBe(1)
      observer.callback([{ isIntersecting: false }])
      expect(video.pauses).toBe(1)

      stop()
      expect(observer.disconnected).toBe(true)
    })
  })

  it('never starts an already-paused clip a second time on leaving', () => {
    withFakeObserver(() => {
      const video = fakeVideo()
      const stop = autoplayInView(video, window)
      const observer = FakeIntersectionObserver.instances.at(-1)!
      observer.callback([{ isIntersecting: false }])
      expect(video.pauses).toBe(0)
      stop()
    })
  })

  it('swallows the rejection a pause-during-load race produces', async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('interrupted by pause')))
    let stop = (): void => {}
    withFakeObserver(() => {
      const video = fakeVideo()
      video.play = rejecting
      stop = autoplayInView(video, window)
      FakeIntersectionObserver.instances.at(-1)!.callback([{ isIntersecting: true }])
    })
    // Scrolling quickly past a clip rejects the play promise. Left unhandled it surfaces as an
    // `unhandledrejection` on the consumer's page, which is a library bug report for something
    // that is not an error at all.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejecting).toHaveBeenCalledTimes(1)
    expect(() => stop()).not.toThrow()
  })

  it('is inert where the environment has no IntersectionObserver', () => {
    const video = fakeVideo()
    expect(() => autoplayInView(video, window)()).not.toThrow()
    expect(video.plays).toBe(0)
  })

  it('pauses a still-playing clip on teardown, not just on leaving the viewport', () => {
    withFakeObserver(() => {
      const video = fakeVideo()
      const stop = autoplayInView(video, window)
      FakeIntersectionObserver.instances.at(-1)!.callback([{ isIntersecting: true }])
      stop()
      expect(video.pauses).toBe(1)
    })
  })

  /** The `autoplay:` opt-out, exercised through the same fake. */
  describe('autoplay modes', () => {
    const options = (autoplay: AutoplayMode, reducedMotion = false): BackgroundMediaOptions => ({
      src: '/hero.mp4',
      poster: '',
      fit: 'cover',
      position: '50% 50%',
      overlay: 'transparent',
      overlayOpacity: 1,
      autoplay,
      rate: 1,
      loop: true,
      reducedMotion,
    })

    it('always: plays at once and observes nothing, so a short hero clip never stalls', () => {
      withFakeObserver(() => {
        const before = FakeIntersectionObserver.instances.length
        const video = fakeVideo()
        const stop = startPlayback(video, window, options('always'))
        expect(video.plays).toBe(1)
        expect(FakeIntersectionObserver.instances).toHaveLength(before)
        stop()
        expect(video.pauses).toBe(1)
      })
    })

    it('never: installs the clip and leaves it on its poster', () => {
      withFakeObserver(() => {
        const before = FakeIntersectionObserver.instances.length
        const video = fakeVideo()
        startPlayback(video, window, options('never'))()
        expect(video.plays).toBe(0)
        expect(FakeIntersectionObserver.instances).toHaveLength(before)
      })
    })

    it('in-view: pairs the clip with the viewport', () => {
      withFakeObserver(() => {
        const video = fakeVideo()
        const stop = startPlayback(video, window, options('in-view'))
        FakeIntersectionObserver.instances.at(-1)!.callback([{ isIntersecting: true }])
        expect(video.plays).toBe(1)
        stop()
      })
    })

    it('lands every mode on the poster under reduced motion, including always', () => {
      withFakeObserver(() => {
        const before = FakeIntersectionObserver.instances.length
        for (const mode of ['in-view', 'always', 'never'] as AutoplayMode[]) {
          const video = fakeVideo()
          startPlayback(video, window, options(mode, true))()
          expect(video.plays, mode).toBe(0)
        }
        /*
         * Not merely "never played": `in-view` under reduced motion must not install an observer
         * at all. An observer that exists is a clip that starts the moment the section scrolls
         * into view, which is the whole thing the preference asked not to happen — and this is the
         * only assertion that can tell the two apart, since both leave `plays` at 0 on the frame
         * the guard runs.
         */
        expect(FakeIntersectionObserver.instances).toHaveLength(before)
      })
    })
  })
})
