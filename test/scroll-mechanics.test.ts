import { beforeEach, describe, expect, it } from 'vitest'
import { progressFrom } from '../src/effects/scroll-mechanics/tracker.js'
import { createRegistry } from '../src/effects/index.js'
import { build, el, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

// Fake scheduler, fake measurer, `build`/`stubRect`/`el` helpers, and the `scheduler`/`reporter`
// state `build` populates all live in test/support/scroll-mechanics-harness.ts — every describe
// block below depends on them. See that file's doc comment for why it isn't `*.test.ts`.

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('progressFrom', () => {
  it('is 0 before the element reaches the top of the scrollport', () => {
    expect(progressFrom(100, 400)).toBe(0)
  })

  it('is a ratio while travelling', () => {
    expect(progressFrom(-200, 400)).toBeCloseTo(0.5)
  })

  it('clamps to 1 past the end', () => {
    expect(progressFrom(-900, 400)).toBe(1)
  })

  it('returns 0 for a degenerate span rather than dividing by zero', () => {
    // An element measured before layout settles reports height 0; Infinity here would poison
    // every downstream style write.
    expect(progressFrom(-100, 0)).toBe(0)
    expect(progressFrom(-100, -5)).toBe(0)
  })
})

/** Pin measures its containing block, so that is what the stub must describe. */
const stubContainer = (top: number, height = 400): void => stubRect(document.body, top, height)

describe('pin', () => {
  it('makes the element sticky and subscribes to the scheduler', () => {
    const animator = build('<div data-kui="pin-section"></div>')
    stubContainer(0)
    animator.start()

    expect(el().style.position).toBe('sticky')
    expect(scheduler.subscriberCount()).toBe(1)
  })

  it('publishes progress as a custom property', () => {
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(0)
    animator.start()

    scheduler.emit(0)
    expect(el().style.getPropertyValue('--kui-progress')).toBe('0.0000')

    stubContainer(-200)
    scheduler.emit(200, 1)
    expect(Number(el().style.getPropertyValue('--kui-progress'))).toBeCloseTo(0.5)
  })

  it('marks the pinned window with an attribute', () => {
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(-200)
    animator.start()
    scheduler.emit(200)
    expect(el().getAttribute('data-kui-pinned')).toBe('true')
  })

  it('adds a spacer so a pin longer than its container still holds', () => {
    // Sticky silently does nothing once its containing block scrolls away; the spacer is the fix.
    const animator = build('<div data-kui="pin-section distance:600px"></div>')
    stubContainer(0)
    animator.start()

    const spacer = document.querySelector('[data-kui-spacer]') as HTMLElement
    expect(spacer).not.toBeNull()
    expect(spacer.style.height).toBe('600px')
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
  })

  it('omits the spacer when not requested', () => {
    const animator = build('<div data-kui="pin-until"></div>')
    stubContainer(0)
    animator.start()
    expect(document.querySelector('[data-kui-spacer]')).toBeNull()
  })

  it('restores the element and removes the spacer on destroy', () => {
    const animator = build('<div data-kui="pin-section"></div>')
    stubContainer(0)
    animator.start()
    animator.destroy()

    expect(el().style.position).toBe('')
    expect(document.querySelector('[data-kui-spacer]')).toBeNull()
    expect(el().hasAttribute('data-kui-pinned')).toBe(false)
    expect(scheduler.subscriberCount()).toBe(0)
  })
})

describe('scroll-progress', () => {
  it('publishes a discrete step index for scrollytelling', () => {
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), 0)
    animator.start()

    scheduler.emit(0)
    expect(el().getAttribute('data-kui-step')).toBe('0')

    stubRect(el(), -300)
    scheduler.emit(300, 1)
    expect(el().getAttribute('data-kui-step')).toBe('3')
  })

  it('clamps the final step rather than going one past the end', () => {
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), -400)
    animator.start()
    scheduler.emit(400)
    expect(el().getAttribute('data-kui-step')).toBe('3')
  })

  it('omits the step attribute when steps is 0', () => {
    const animator = build('<div data-kui="scroll-progress"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    expect(el().hasAttribute('data-kui-step')).toBe(false)
  })
})

describe('horizontal-scroll', () => {
  it('translates the track in proportion to progress', () => {
    const animator = build('<div data-kui="horizontal-scroll distance:400px travel:1000px"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().style.translate).toBe('-500px 0')
  })

  it('clears the translation on destroy', () => {
    const animator = build('<div data-kui="horizontal-scroll travel:100px"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    animator.destroy()
    expect(el().style.translate).toBe('')
  })
})

describe('media-scrub', () => {
  it('writes the frame pattern to an <img> src, substituting {i}', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:4 src:frame-{i}.jpg">',
    )
    stubRect(el('img'), 0)
    animator.start()
    scheduler.emit(0)
    expect((el('img') as HTMLImageElement).src).toContain('frame-0.jpg')

    stubRect(el('img'), -400)
    scheduler.emit(400, 1)
    expect((el('img') as HTMLImageElement).src).toContain('frame-3.jpg')
  })

  it('scrubs currentTime for a <video>, never touching src', () => {
    const animator = build('<video data-kui="video-scrub distance:400px"></video>')
    const video = el('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 10, configurable: true })
    let currentTime = 0
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTime,
      set: (v) => {
        currentTime = v
      },
      configurable: true,
    })
    stubRect(video, -200)
    animator.start()
    scheduler.emit(200)
    expect(currentTime).toBeCloseTo(5)
    expect(video.getAttribute('src')).toBeNull()
  })

  it('never writes src on a non-<img> element, closing the javascript: URL vector', () => {
    const animator = build(
      '<iframe data-kui="sequence-scrub distance:400px frames:1 src:javascript:window.pwned=true"></iframe>',
    )
    const iframe = el('iframe') as HTMLIFrameElement
    stubRect(iframe, 0)
    animator.start()
    scheduler.emit(0)
    expect(iframe.getAttribute('src')).toBeNull()
  })

  // The test above already proves a same-origin `frame-{i}.jpg` pattern keeps substituting once
  // this gate is in place — that regression coverage isn't duplicated here. Exhaustive shape
  // coverage (root-relative, protocol-relative, cross-origin, non-http(s) schemes) lives in
  // test/params.test.ts's `isSameOriginPath` suite; this proves the gate is wired into the
  // primitive end to end, not just correct in isolation.
  it('blocks and warns on a cross-origin src instead of issuing the request', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:1 src:https://evil.test/beacon.gif">',
    )
    const img = el('img') as HTMLImageElement
    stubRect(img, 0)
    animator.start()
    scheduler.emit(0)
    expect(img.getAttribute('src')).toBeNull()
    expect(reporter.messages.join()).toContain('must be a same-origin path')
  })

  // demo/scroll.html's real sequence-scrub markup, verified live: must keep cycling frames.
  it('keeps the showcase\'s ./assets/scenic_scrub_{i}.jpg pattern working', () => {
    const animator = build(
      '<img data-kui="sequence-scrub frames:5 src:./assets/scenic_scrub_{i}.jpg distance:220vh">',
    )
    stubRect(el('img'), 0)
    animator.start()
    scheduler.emit(0)
    // `./` is stripped by URL resolution, same as any browser normalizing a relative path.
    expect((el('img') as HTMLImageElement).src).toContain('assets/scenic_scrub_0.jpg')
    expect(reporter.messages.join()).not.toContain('same-origin')
  })
})

describe('scroll-snap', () => {
  it('applies native snapping to the container and its children', () => {
    const animator = build('<ul data-kui="scroll-snap-x"><li></li><li></li></ul>')
    animator.start()

    expect(el('ul').style.scrollSnapType).toContain('x')
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items.every((item) => item.style.scrollSnapAlign === 'start')).toBe(true)
  })
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

describe('registration and parameters', () => {
  it('registers every v2 scroll name', () => {
    const registry = createRegistry()
    for (const name of [
      'pin-section',
      'pin-until',
      'pin-spacer',
      'stacking-cards',
      'scroll-progress',
      'scrollytelling-step',
      'horizontal-scroll',
      'sequence-scrub',
      'video-scrub',
      'scroll-spy',
      'scroll-snap-x',
      'scroll-snap-y',
    ]) {
      expect(registry.has(name), name).toBe(true)
    }
  })

  it('rejects a dangerous parameter before it reaches the primitive', () => {
    const animator = build('<div data-kui="pin-until distance:url(http://evil.test)"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(reporter.messages.join()).toContain('disallowed CSS syntax')
  })

  it('never writes a text parameter into the element style', () => {
    const animator = build('<div data-kui="scroll-spy target:nav a"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(el().style.getPropertyValue('--kui-target')).toBe('')
  })
})
