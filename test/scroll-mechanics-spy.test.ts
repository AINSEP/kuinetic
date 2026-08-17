import { beforeEach, describe, expect, it } from 'vitest'
import { build, el, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * scroll-spy coverage split out of scroll-mechanics.test.ts (which every other scroll-mechanics
 * primitive still lives in) purely to keep both files under the line cap — scroll-spy's ledger
 * and target-validation rules are involved enough to need this many cases on their own.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('scroll-spy', () => {
  it('warns and ignores an invalid target selector rather than throwing inside the shared scheduler', () => {
    const animator = build('<div data-kui="scroll-spy target:["></div>')
    stubRect(el(), -200)
    animator.start()

    // A throw here would abort the scheduler's frame loop for every other subscriber on the root,
    // not just this instance.
    expect(() => scheduler.emit(200)).not.toThrow()
    expect(reporter.messages.join()).toContain('not a valid selector')
    expect(el().getAttribute('data-kui-active')).toBe('true')
  })

  it('marks and clears only the links it actually wrote to', () => {
    const animator = build('<a class="spy-link" href="#a"></a><div data-kui="scroll-spy target:.spy-link"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    const link = el('.spy-link')
    expect(link.getAttribute('data-kui-active')).toBe('true')

    animator.destroy()
    expect(link.hasAttribute('data-kui-active')).toBe(false)
  })

  it('leaves a matching link alone when no frame ever wrote to it', () => {
    const animator = build('<a class="spy-link" data-kui-active="true"></a><div data-kui="scroll-spy target:.spy-link"></div>')
    stubRect(el(), -200)
    animator.start()

    // Destroyed before any frame fires: cleanup must undo what this instance wrote, and it wrote
    // nothing. A re-query on teardown would wipe state that was never the library's to clear.
    animator.destroy()
    expect(el('.spy-link').getAttribute('data-kui-active')).toBe('true')
  })

  it('restores a link that already carried data-kui-active, and removes one that did not', () => {
    // The touched-set alone recorded *which* links were stamped but not *what they held first*,
    // so teardown deleted the consumer's own value. Both halves of the ledger contract are
    // asserted here: "had a value" restores it, "had none" removes the attribute.
    const animator = build(
      '<a class="spy-link" id="owned" data-kui-active="sticky"></a>' +
        '<a class="spy-link" id="fresh"></a>' +
        '<div data-kui="scroll-spy target:.spy-link"></div>',
    )
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    // This instance really did overwrite both, so the restore is doing work, not no-op'ing.
    expect(el('#owned').getAttribute('data-kui-active')).toBe('true')
    expect(el('#fresh').getAttribute('data-kui-active')).toBe('true')

    animator.destroy()
    expect(el('#owned').getAttribute('data-kui-active')).toBe('sticky')
    expect(el('#fresh').hasAttribute('data-kui-active')).toBe(false)
  })

  it('restores an authored data-kui-active on the tracked element itself', () => {
    const animator = build('<div data-kui="scroll-spy" data-kui-active="authored"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().getAttribute('data-kui-active')).toBe('true')

    animator.destroy()
    expect(el().getAttribute('data-kui-active')).toBe('authored')
  })

  it('does not restore a stale value when the boolean flips more than once', () => {
    // Each flip re-runs the query; the ledger must keep the value from *before* the first write,
    // not the value this instance itself left behind on the previous flip.
    const animator = build('<a class="spy-link" data-kui-active="sticky"></a><div data-kui="scroll-spy distance:400px target:.spy-link"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el('.spy-link').getAttribute('data-kui-active')).toBe('true')

    // Past the end of the range: active flips back to false and the links are rewritten.
    stubRect(el(), -400)
    scheduler.emit(400, 1)
    expect(el('.spy-link').getAttribute('data-kui-active')).toBe('false')

    animator.destroy()
    expect(el('.spy-link').getAttribute('data-kui-active')).toBe('sticky')
  })

  it('rejects target:* rather than stamping the whole document', () => {
    // `*` is syntactically valid, so setup-time syntax validation passed it through to query and
    // write across the entire document on every frame — a correctness *and* a performance defect.
    const animator = build('<p id="bystander">unrelated</p><div data-kui="scroll-spy target:*"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    expect(reporter.messages.join()).toContain('matches the whole document')
    expect(el('#bystander').hasAttribute('data-kui-active')).toBe(false)
    expect(document.documentElement.hasAttribute('data-kui-active')).toBe(false)
    expect(document.body.hasAttribute('data-kui-active')).toBe(false)
    // The element's own state still works; only the mirroring is dropped.
    expect(el().getAttribute('data-kui-active')).toBe('true')
  })

  it('rejects other document-wide selectors by the same rule', () => {
    for (const target of ['html', 'body', ':root']) {
      const animator = build(`<div data-kui="scroll-spy target:${target}"></div>`)
      stubRect(el(), -200)
      animator.start()
      scheduler.emit(200)

      expect(reporter.messages.join(), target).toContain('matches the whole document')
      expect(document.documentElement.hasAttribute('data-kui-active'), target).toBe(false)
      expect(document.body.hasAttribute('data-kui-active'), target).toBe(false)
      animator.destroy()
    }
  })

  it('still allows a wildcard scoped to a container', () => {
    // The rule rejects breadth, not the `*` character: a scoped wildcard names a bounded set, so
    // a syntactic ban on `*` would have been the wrong instrument. Written without spaces because
    // the `data-kui` grammar splits parameters on top-level whitespace.
    const animator = build('<nav class="spy-nav"><a></a><a></a></nav><div data-kui="scroll-spy target:.spy-nav>*"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    const anchors = [...document.querySelectorAll('.spy-nav a')]
    expect(anchors.length).toBe(2)
    expect(anchors.every((a) => a.getAttribute('data-kui-active') === 'true')).toBe(true)
    expect(reporter.messages.join()).not.toContain('matches the whole document')
  })

  it('does not re-query the document on frames that do not flip the boolean', () => {
    const animator = build('<a class="spy-link"></a><div data-kui="scroll-spy distance:400px target:.spy-link"></div>')
    stubRect(el(), -200)
    animator.start()

    let queries = 0
    const real = document.querySelectorAll.bind(document)
    document.querySelectorAll = ((selector: string) => {
      if (selector === '.spy-link') queries += 1
      return real(selector)
    }) as typeof document.querySelectorAll

    try {
      scheduler.emit(200)
      expect(queries).toBe(1)
      // Progress advances but `active` stays true, so these frames must do no document work.
      stubRect(el(), -250)
      scheduler.emit(250, 1)
      stubRect(el(), -300)
      scheduler.emit(300, 2)
      expect(queries).toBe(1)
    } finally {
      document.querySelectorAll = real
    }

    animator.destroy()
  })
})
