import { describe, expect, it, vi } from 'vitest'
import { inertInstance } from '../src/core/types.js'

describe('inertInstance', () => {
  it('does nothing and never rejects, for effects with no work in the current environment', async () => {
    const instance = inertInstance()
    expect(() => instance.activate()).not.toThrow()
    expect(() => instance.cancel()).not.toThrow()
    expect(() => instance.finish()).not.toThrow()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('runs the supplied destroy callback', () => {
    const destroy = vi.fn()
    inertInstance(destroy).destroy()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('defaults destroy to a no-op when none is supplied', () => {
    expect(() => inertInstance().destroy()).not.toThrow()
  })
})
