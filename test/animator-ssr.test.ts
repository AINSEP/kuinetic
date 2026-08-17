// @vitest-environment node
import { describe, expect, it } from 'vitest'

/**
 * Regression coverage for constructing (and starting) an animator with no DOM globals at all —
 * the SSR/worker case `src/index.ts`'s own doc comment promises: "Importing this module has no
 * side effects — nothing is scanned and the document is not touched until `.start()` is called."
 *
 * The suite runs under jsdom by default (see vitest.config.ts), which defines `Element`,
 * `document`, etc. as real globals — a jsdom-environment test would pass whether or not the bug
 * exists, so this file overrides the environment to plain Node via the docblock above.
 */
describe('Animator construction without a DOM', () => {
  it('constructs kuinetic() in a DOM-less environment', async () => {
    const { kuinetic } = await import('../src/index.js')
    // Previously: `defaultRootResolver` evaluated `root instanceof Element` unconditionally —
    // `Element` is an undeclared global in plain Node, so this threw `ReferenceError: Element is
    // not defined` on construction, before `.start()` was ever called.
    expect(() => kuinetic()).not.toThrow()
  })

  it('constructs a bare Animator without a DOM', async () => {
    const { Animator } = await import('../src/core/animator.js')
    expect(() => new Animator()).not.toThrow()
  })

  it('start() does not throw when there is no DOM at all', async () => {
    const { Animator } = await import('../src/core/animator.js')
    const animator = new Animator()
    // With no `document` global, `resolveCollaborators` resolves `root` to `undefined`; `start()`
    // must degrade gracefully (nothing to scan) rather than crash on a stray `instanceof Element`
    // reachable from `uncloak()`, which `start()` always calls in its `finally` block.
    expect(() => animator.start()).not.toThrow()
  })
})
