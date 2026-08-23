import { beforeEach, describe, expect, it } from 'vitest'
import { build, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * `scroll-spy`'s container form — one instance on the shared ancestor of the nav and the
 * sections, authored with `sections:`. Split out of `scroll-mechanics-spy.test.ts`, which covers
 * the original per-section form and is untouched by this: that suite passing unmodified is itself
 * part of the backward-compatibility claim for this change.
 *
 * What this file can and cannot prove: jsdom does no real layout, so every "top" here is a stub
 * (`stubRect`), not a browser laying anything out. What is provable statically is the *logic* —
 * given these rects, is exactly one index ever active, does pairing follow `href`/`id`, does
 * `offset-top` shift the trigger line — which is the whole of what the container form adds over
 * the per-section one. Whether `demo/scroll.html`'s real sections still read the reference line
 * correctly at 60fps is a browser question, not this one.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

/** Three sections and a nav of three links, one per section, pointing at each by id. */
const THREE_SECTIONS = `
  <div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
    <nav class="spy-nav">
      <a id="link-1" href="#s1">One</a>
      <a id="link-2" href="#s2">Two</a>
      <a id="link-3" href="#s3">Three</a>
    </nav>
    <section id="s1" class="sec"></section>
    <section id="s2" class="sec"></section>
    <section id="s3" class="sec"></section>
  </div>
`

function section(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement
}

function link(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement
}

describe('scroll-spy, container form', () => {
  it('marks the first section active once its top reaches the viewport, and its paired link', () => {
    const animator = build(THREE_SECTIONS)
    stubRect(section('s1'), -50, 300)
    stubRect(section('s2'), 250, 300)
    stubRect(section('s3'), 550, 300)
    animator.start()
    scheduler.emit(50)

    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
    expect(link('link-1').getAttribute('data-kui-active')).toBe('true')
    expect(section('s2').hasAttribute('data-kui-active')).toBe(false)
    expect(link('link-2').hasAttribute('data-kui-active')).toBe(false)
  })

  it('is never active before the first section is reached', () => {
    const animator = build(THREE_SECTIONS)
    stubRect(section('s1'), 400, 300)
    stubRect(section('s2'), 700, 300)
    stubRect(section('s3'), 1000, 300)
    animator.start()
    scheduler.emit(0)

    for (const id of ['s1', 's2', 's3']) expect(section(id).hasAttribute('data-kui-active'), id).toBe(false)
    for (const id of ['link-1', 'link-2', 'link-3']) expect(link(id).hasAttribute('data-kui-active'), id).toBe(false)
  })

  it('moves the active section forward exactly one at a time as its neighbours are reached', () => {
    const animator = build(THREE_SECTIONS)
    stubRect(section('s1'), -50, 300)
    stubRect(section('s2'), 250, 300)
    stubRect(section('s3'), 550, 300)
    animator.start()
    scheduler.emit(50)
    expect(section('s1').getAttribute('data-kui-active')).toBe('true')

    // s2's top crosses the line; s1 must hand off, not stay lit alongside it.
    stubRect(section('s2'), -10, 300)
    scheduler.emit(300, 1)
    expect(section('s1').getAttribute('data-kui-active')).toBe('false')
    expect(link('link-1').getAttribute('data-kui-active')).toBe('false')
    expect(section('s2').getAttribute('data-kui-active')).toBe('true')
    expect(link('link-2').getAttribute('data-kui-active')).toBe('true')
    expect(section('s3').hasAttribute('data-kui-active')).toBe(false)
  })

  it('never has two active at once, even across a gap between sections', () => {
    // The exact failure `demo/scroll.html` documents from its own history: a gap between tiles
    // used to leave a scroll window belonging to no section. The container form's rule is the
    // fix — "last one reached" degrades to holding the previous section through the gap instead
    // of going blank, and can never independently light a second one.
    const animator = build(THREE_SECTIONS)
    stubRect(section('s1'), -400, 300) // reached and long past
    stubRect(section('s2'), 50, 300) // not yet reached — this is the gap
    stubRect(section('s3'), 500, 300)
    animator.start()
    scheduler.emit(400)

    const activeCount = ['s1', 's2', 's3'].filter((id) => section(id).getAttribute('data-kui-active') === 'true').length
    expect(activeCount).toBe(1)
    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
  })

  it('offset-top shifts the reference line down, so a section under a sticky header counts as reached sooner', () => {
    const withoutOffset = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
        <nav class="spy-nav"><a href="#s1">One</a></nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), 50, 300)
    withoutOffset.start()
    scheduler.emit(0)
    expect(section('s1').hasAttribute('data-kui-active')).toBe(false)
    withoutOffset.destroy()

    document.body.innerHTML = ''
    const withOffset = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a' offset-top:100px">
        <nav class="spy-nav"><a href="#s1">One</a></nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), 50, 300)
    withOffset.start()
    scheduler.emit(0)
    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
  })

  it('pairs a link to its section by href -> id, and warns about an orphan on either side', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
        <nav class="spy-nav">
          <a id="matched" href="#s1">One</a>
          <a id="orphan" href="#does-not-exist">Nowhere</a>
        </nav>
        <section id="s1" class="sec"></section>
        <section class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), -10, 300)
    stubRect(document.querySelectorAll('.sec')[1]!, 290, 300)
    animator.start()
    scheduler.emit(50)

    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
    expect(link('matched').getAttribute('data-kui-active')).toBe('true')
    // The orphan link is never this instance's to touch.
    expect(link('orphan').hasAttribute('data-kui-active')).toBe(false)

    expect(reporter.messages.join()).toContain('has no id and cannot be paired')
    expect(reporter.messages.join()).toContain('matches no section id')
  })

  it('still marks a section with no id active itself, even though it cannot pair with a link', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
        <nav class="spy-nav"></nav>
        <section class="sec" id="unnamed-probe"></section>
      </div>`,
    )
    stubRect(section('unnamed-probe'), -10, 300)
    // Strip the id back off after using it only to query the element — the case under test is a
    // section `sections:` matches that has none.
    const probe = section('unnamed-probe')
    probe.removeAttribute('id')
    animator.start()
    scheduler.emit(50)

    expect(probe.getAttribute('data-kui-active')).toBe('true')
    expect(reporter.messages.join()).toContain('has no id and cannot be paired')
  })

  it('warns and tracks nothing when sections: matches no element', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.nonexistent' target:'.spy-nav a'">
        <nav class="spy-nav"><a href="#s1">One</a></nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    animator.start()
    expect(() => scheduler.emit(50)).not.toThrow()
    expect(reporter.messages.join()).toContain('matched nothing inside this element')
    // The section exists in the markup, but `.nonexistent` never matched it — it is outside this
    // instance's tracked set and must stay untouched.
    expect(section('s1').hasAttribute('data-kui-active')).toBe(false)
  })

  it('warns that distance: has no effect once sections: is authored', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a' distance:400px">
        <nav class="spy-nav"><a href="#s1">One</a></nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), -10, 300)
    animator.start()
    scheduler.emit(50)
    expect(reporter.messages.join()).toContain('"distance" has no effect with sections:')
  })

  it('warns that offset-top has no effect on the per-section form', () => {
    const animator = build('<a id="link" href="#x"></a><div id="single" data-kui="scroll-spy target:#link offset-top:50px"></div>')
    stubRect(document.getElementById('single')!, -10, 300)
    animator.start()
    scheduler.emit(50)
    expect(reporter.messages.join()).toContain('"offset-top" has no effect without sections:')
  })

  it('restores every section and link it touched on teardown', () => {
    const animator = build(THREE_SECTIONS)
    stubRect(section('s1'), -50, 300)
    stubRect(section('s2'), 250, 300)
    stubRect(section('s3'), 550, 300)
    animator.start()
    scheduler.emit(50)
    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
    expect(link('link-1').getAttribute('data-kui-active')).toBe('true')

    animator.destroy()
    expect(section('s1').hasAttribute('data-kui-active')).toBe(false)
    expect(link('link-1').hasAttribute('data-kui-active')).toBe(false)
  })

  it('ignores a link with no href, or an href with no #, rather than pairing it on an empty hash', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
        <nav class="spy-nav">
          <a id="no-href">No href</a>
          <a id="no-hash" href="page.html">No hash</a>
          <a id="matched" href="#s1">One</a>
        </nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), -10, 300)
    animator.start()
    scheduler.emit(50)

    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
    expect(link('matched').getAttribute('data-kui-active')).toBe('true')
    // Neither hashless link ever entered the hash map, so neither is touched, and — unlike
    // "orphan" from the pairing test above, whose href has a real, unmatched hash — neither
    // trips the "matches no section id" warning.
    expect(link('no-href').hasAttribute('data-kui-active')).toBe(false)
    expect(link('no-hash').hasAttribute('data-kui-active')).toBe(false)
    expect(reporter.messages.join()).not.toContain('matches no section id')
  })

  it('pairs a section with a real id but no claiming link to null, silently', () => {
    // Distinct from "has no id and cannot be paired" above: this section has a real id, and
    // simply has no link anywhere whose hash points at it.
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec' target:'.spy-nav a'">
        <nav class="spy-nav"></nav>
        <section id="unclaimed" class="sec"></section>
      </div>`,
    )
    stubRect(section('unclaimed'), -10, 300)
    animator.start()
    expect(() => scheduler.emit(50)).not.toThrow()

    expect(section('unclaimed').getAttribute('data-kui-active')).toBe('true')
    expect(reporter.messages.join()).toBe('')
  })

  it('treats an over-broad sections: selector as no sections, not the whole document', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'body' target:'.spy-nav a'">
        <nav class="spy-nav"><a href="#s1">One</a></nav>
        <section id="s1" class="sec"></section>
      </div>`,
    )
    animator.start()
    expect(() => scheduler.emit(50)).not.toThrow()
    expect(reporter.messages.join()).toContain('matches the whole document and will be ignored')
    // Rejected, not narrowed — `sections:` resolves to '', so there are no sections at all rather
    // than one covering the whole document.
    expect(section('s1').hasAttribute('data-kui-active')).toBe(false)
  })

  it('tracks sections with no nav links at all when target: is not authored', () => {
    const animator = build(
      `<div data-kui="scroll-spy sections:'.sec'">
        <section id="s1" class="sec"></section>
      </div>`,
    )
    stubRect(section('s1'), -10, 300)
    animator.start()
    expect(() => scheduler.emit(50)).not.toThrow()

    expect(section('s1').getAttribute('data-kui-active')).toBe('true')
    expect(reporter.messages.join()).toBe('')
  })
})
