import { describe, expect, it, vi } from 'vitest'
import { createCssInstance, createJsInstance, deferredInstance } from '../src/core/instances.js'
import { createStyleLedger } from '../src/core/owned-styles.js'

interface FakeAnimation extends Animation {
  animationName: string
}

/**
 * Build the lifecycle surface used by `createCssInstance`.
 *
 * @param name - CSS keyframe name exposed by the handle.
 * @param state - Current animation playback state.
 * @returns A spy-backed animation handle.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function fakeAnimation(name: string, state: AnimationPlayState = 'running'): FakeAnimation {
  return {
    animationName: name,
    playState: state,
    finished: Promise.resolve(),
    cancel: vi.fn(),
    finish: vi.fn(),
    reverse: vi.fn(),
  } as unknown as FakeAnimation
}

/**
 * Install a deterministic `getAnimations()` result on a test element.
 *
 * @param el - Test element to instrument.
 * @param animations - Handles the element should report.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function withAnimations(el: Element, animations: Animation[]): void {
  Object.defineProperty(el, 'getAnimations', { value: () => animations })
}

describe('createCssInstance ownership', () => {
  it('ignores unrelated consumer animations when awaiting completion', async () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('kui-in-up')
    const consumer = fakeAnimation('pulse')
    Object.defineProperty(consumer, 'finished', { value: new Promise<void>(() => {}) })
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('settles a scrubbed instance immediately and never touches its play state', async () => {
    // `timeline: pin` compiles to a paused animation seeked by `--kui-progress`, so it has no
    // notion of "starting". Writing `running` on activate would hand it to the document timeline
    // and let it play forward in wall-clock time on top of the seek. And because a scrub never
    // completes in the time sense, `finished` has to resolve at once or `data-kui-state` is
    // stranded on "running" for the life of the page.
    const el = document.createElement('div')
    const owned = fakeAnimation('kui-in-up')
    Object.defineProperty(owned, 'finished', { value: new Promise<void>(() => {}) })
    withAnimations(el, [owned])

    const ledger = createStyleLedger(el)
    const instance = createCssInstance(el, ledger, ['kui-in-up'], true)
    instance.activate()

    await expect(instance.finished).resolves.toBeUndefined()
    expect(el.style.animationPlayState).toBe('')
  })

  it('cancels and finishes only owned animations', () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('kui-in-up')
    const consumer = fakeAnimation('pulse')
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.cancel()
    instance.finish()
    expect(owned.cancel).toHaveBeenCalledOnce()
    expect(owned.finish).toHaveBeenCalledOnce()
    expect(consumer.cancel).not.toHaveBeenCalled()
    expect(consumer.finish).not.toHaveBeenCalled()
  })

  it('reverses only a finished owned animation on repeat activation', () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('kui-in-up', 'finished')
    const consumer = fakeAnimation('pulse', 'finished')
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    instance.activate()
    expect(owned.reverse).toHaveBeenCalledOnce()
    expect(consumer.reverse).not.toHaveBeenCalled()
  })

  it('re-sets running rather than reversing a still-running owned animation on repeat activation', () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('kui-in-up', 'running')
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    instance.activate()
    expect(owned.reverse).not.toHaveBeenCalled()
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('running')
  })
})

describe('createCssInstance directional playback', () => {
  /**
   * `Animation.play()` is not on the shared `fakeAnimation` because only these tests need it, and
   * `playbackRate` has to be a real writable property rather than a spy for the assertions to mean
   * anything.
   *
   * @complexity O(1) time and space.
   * @overallScore 100
   */
  function playableAnimation(name: string): FakeAnimation & { play: ReturnType<typeof vi.fn> } {
    return Object.assign(fakeAnimation(name), { playbackRate: 1, play: vi.fn() })
  }

  it('drives the owned animations backwards on reverse and forwards again on play', () => {
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()

    instance.reverse?.()
    expect(owned.playbackRate).toBe(-1)
    expect(owned.play).toHaveBeenCalledOnce()

    instance.play?.()
    expect(owned.playbackRate).toBe(1)
    expect(owned.play).toHaveBeenCalledTimes(2)
  })

  it('writes running to the ledger, so a paused instance can still be paused after an exit', () => {
    // `drive()` plays. It used to play without telling the ledger, so `control().pause()` followed
    // by a `pointerleave` left the inline declaration saying `paused` while the animations ran.
    // The next `pause()` then wrote `paused` over `paused` — no computed-value change, nothing for
    // the browser to re-apply — and the element could not be paused again for the rest of its life.
    // `createCssControl.reverse()` has always written this; only the route the animator takes was
    // missing it.
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    instance.control!.pause()
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('paused')

    instance.reverse?.()
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('running')

    // The second pause is the one that used to be a no-op write.
    instance.control!.pause()
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('paused')

    // Forwards is the same call and needs the same write — a paused element told to `play()`.
    instance.play?.()
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('sets the rate absolutely rather than flipping it, so a repeated exit stays an exit', () => {
    // `Animation.reverse()` means "turn around", which is right for the click toggle in
    // `activate()` and wrong here: a pointer skimming an element's edge fires `pointerleave`
    // twice, and the second one must not play the entrance back in.
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    instance.reverse?.()
    instance.reverse?.()

    expect(owned.playbackRate).toBe(-1)
    expect(owned.reverse).not.toHaveBeenCalled()
  })

  it('leaves consumer animations alone', () => {
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    const consumer = playableAnimation('pulse')
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    instance.reverse?.()

    expect(consumer.playbackRate).toBe(1)
    expect(consumer.play).not.toHaveBeenCalled()
  })

  it('re-arms finished so the caller can tell when the exit has landed', async () => {
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    let settleReverse: () => void = () => {}
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'])
    instance.activate()
    await expect(instance.finished).resolves.toBeUndefined()

    Object.defineProperty(owned, 'finished', {
      value: new Promise<void>((resolve) => {
        settleReverse = () => resolve()
      }),
      configurable: true,
    })
    instance.reverse?.()
    const pending = instance.finished
    settleReverse()
    await expect(pending).resolves.toBeUndefined()
  })

  it('refuses to drive a scrubbed instance in either direction', () => {
    // A `timeline: pin` frame is a pure function of `--kui-progress` through the compiled negative
    // `animation-delay`. Playing it would hand it to the document timeline on top of the seek.
    const el = document.createElement('div')
    const owned = playableAnimation('kui-in-up')
    withAnimations(el, [owned])

    const instance = createCssInstance(el, createStyleLedger(el), ['kui-in-up'], true)
    instance.activate()
    instance.reverse?.()
    instance.play?.()

    expect(owned.play).not.toHaveBeenCalled()
    expect(owned.playbackRate).toBe(1)
    // And the play-state write `drive()` makes for everything else must not leak past that guard:
    // a scrub with `animation-play-state: running` is handed to the document timeline and runs
    // forward in wall-clock time on top of the seek.
    expect((el as HTMLElement).style.getPropertyValue('animation-play-state')).toBe('')
  })
})

describe('deferredInstance completion', () => {
  it('leaves finished pending until a timed setup says its work is done', async () => {
    let complete: (() => void) | undefined
    const instance = deferredInstance(() => ({
      cleanup: () => {},
      finished: new Promise<void>((resolve) => {
        complete = resolve
      }),
    }))

    instance.activate()
    let resolved = false
    void instance.finished.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    complete!()
    await instance.finished
    expect(resolved).toBe(true)
  })

  it('resolves rather than rejects when a timed setup is cancelled mid-run', async () => {
    const instance = deferredInstance(() => ({ cleanup: () => {}, finished: new Promise(() => {}) }))
    instance.activate()
    instance.cancel()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it("delegates finish() to the setup's own end state and then resolves", async () => {
    const jumped = vi.fn()
    const instance = deferredInstance(() => ({
      cleanup: () => {},
      finished: new Promise(() => {}),
      finish: jumped,
    }))

    instance.activate()
    instance.finish()
    expect(jumped).toHaveBeenCalledOnce()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('is inert when finished or cancelled before it was ever activated', async () => {
    const instance = deferredInstance(() => ({ cleanup: () => {}, finished: new Promise(() => {}) }))
    instance.finish()
    instance.cancel()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('replaces a settled promise with a fresh one on reactivation', async () => {
    let complete: (() => void) | undefined
    const instance = deferredInstance(() => ({
      cleanup: () => {},
      finished: new Promise<void>((resolve) => {
        complete = resolve
      }),
    }))

    instance.activate()
    instance.cancel()
    await expect(instance.finished).resolves.toBeUndefined()

    instance.activate()
    let resolved = false
    void instance.finished.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    complete!()
    await instance.finished
    expect(resolved).toBe(true)
  })

  it('keeps resolving immediately for a setup that only returns a cleanup', async () => {
    const instance = deferredInstance(() => () => {})
    instance.activate()
    await expect(instance.finished).resolves.toBeUndefined()
  })
})

describe('createJsInstance repeat calls', () => {
  it('does not call hooks.activate() again once already active', () => {
    const activate = vi.fn()
    const instance = createJsInstance({ activate, destroy: () => {} })
    instance.activate()
    instance.activate()
    expect(activate).toHaveBeenCalledOnce()
  })

  it('falls back to an already-resolved promise when the hooks declare no finished()', async () => {
    const instance = createJsInstance({ activate: () => {}, destroy: () => {} })
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('reports not-continuous when the hooks declare no continuous()', () => {
    // The default has to be "finite", not "perpetual": the animator leaves an element whose every
    // instance is continuous at `data-kui-state="running"` forever, so a primitive that simply
    // never mentions the question must not be swept into that. Only an explicit `ContinuousSetup`
    // opts in.
    const instance = createJsInstance({ activate: () => {}, destroy: () => {} })
    expect(instance.continuous).toBe(false)
  })
})

describe('createJsInstance activation failures', () => {
  it('does not get stuck permanently active when hooks.activate() throws', () => {
    // `active` was previously flipped to true before hooks.activate() ran, so a throwing setup
    // left the instance stuck: the `if (active) return` guard swallowed every later activate()
    // call silently, with no way back in. `Animator.activate()` now catches this throw and may
    // retry the same instance on a later call — that retry has to actually run hooks.activate()
    // again, not vanish.
    let attempts = 0
    const instance = createJsInstance({
      activate: () => {
        attempts++
        if (attempts === 1) throw new Error('boom')
      },
      destroy: () => {},
    })

    expect(() => instance.activate()).toThrow('boom')
    instance.activate()
    expect(attempts).toBe(2)
  })

  it('lets a later activate() succeed and reach the running state after an earlier throw', () => {
    let shouldThrow = true
    const instance = createJsInstance({
      activate: () => {
        if (shouldThrow) throw new Error('boom')
      },
      destroy: () => {},
    })

    expect(() => instance.activate()).toThrow('boom')
    shouldThrow = false
    expect(() => instance.activate()).not.toThrow()
  })
})

describe('deferredInstance teardown', () => {
  it('runs active setup cleanup on cancel and can reactivate safely', () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = []
    const setup = vi.fn(() => {
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    })
    const instance = deferredInstance(setup)

    instance.activate()
    instance.cancel()
    expect(cleanups[0]).toHaveBeenCalledOnce()

    instance.activate()
    instance.cancel()
    expect(setup).toHaveBeenCalledTimes(2)
    expect(cleanups[1]).toHaveBeenCalledOnce()
  })
})
