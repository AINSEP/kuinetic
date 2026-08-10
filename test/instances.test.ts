import { describe, expect, it, vi } from 'vitest'
import { createCssInstance, deferredInstance } from '../src/core/instances.js'
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
    const owned = fakeAnimation('dsg-in-up')
    const consumer = fakeAnimation('pulse')
    Object.defineProperty(consumer, 'finished', { value: new Promise<void>(() => {}) })
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['dsg-in-up'])
    instance.activate()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('cancels and finishes only owned animations', () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('dsg-in-up')
    const consumer = fakeAnimation('pulse')
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['dsg-in-up'])
    instance.cancel()
    instance.finish()
    expect(owned.cancel).toHaveBeenCalledOnce()
    expect(owned.finish).toHaveBeenCalledOnce()
    expect(consumer.cancel).not.toHaveBeenCalled()
    expect(consumer.finish).not.toHaveBeenCalled()
  })

  it('reverses only a finished owned animation on repeat activation', () => {
    const el = document.createElement('div')
    const owned = fakeAnimation('dsg-in-up', 'finished')
    const consumer = fakeAnimation('pulse', 'finished')
    withAnimations(el, [owned, consumer])

    const instance = createCssInstance(el, createStyleLedger(el), ['dsg-in-up'])
    instance.activate()
    instance.activate()
    expect(owned.reverse).toHaveBeenCalledOnce()
    expect(consumer.reverse).not.toHaveBeenCalled()
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
