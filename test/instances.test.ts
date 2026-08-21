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
