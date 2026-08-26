import { describe, expect, it } from 'vitest'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { build, el, fakeRoot, fakeScheduler, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'
import { catalogRegistry } from './support/registry.js'

/*
 * The managed contract: `data-kui` on the outer element, `target:` naming the row that moves, and
 * no page CSS. The three boxes a horizontal track needs are not negotiable, but authoring them is
 * — `distance:` and the target already carry everything the library needs to write them itself.
 */
describe('horizontal-scroll, managed by target:', () => {
  const markup =
    '<div data-kui="horizontal-scroll distance:400px travel:1000px target:.rail">' +
    '<div class="rail"><i></i></div></div>'

  it('makes the host the pinned, clipping window so a max-content row cannot scroll the document', () => {
    const animator = build(markup)
    animator.start()
    const host = el()
    expect(host.style.position).toBe('sticky')
    expect(host.style.overflow).toBe('hidden')
    expect(host.style.top).toBe('var(--kui-pin-offset, 0px)')
  })

  it('reserves exactly the authored distance as scroll room, so the stage cannot disagree with it', () => {
    const animator = build(markup)
    animator.start()
    const spacer = document.querySelector('[data-kui-spacer]') as HTMLElement
    expect(spacer).not.toBeNull()
    expect(spacer.style.height).toBe('400px')
  })

  it('lays the named row out itself and translates that, not the host', () => {
    const animator = build(`<div class="outer">${markup}</div>`)
    const host = el()
    const rail = host.querySelector('.rail') as HTMLElement
    // The host is sticky, so the tracker escapes to the box that actually moves — its parent, the
    // one spanning host plus spacer. Stubbing the host's own rect would measure a frozen element.
    stubRect(host.parentElement!, -200)
    animator.start()
    scheduler.emit(200)
    expect(rail.style.display).toBe('flex')
    expect(rail.style.width).toBe('max-content')
    expect(rail.style.translate).toBe('-500px 0')
    // The host is the window; it never moves.
    expect(host.style.translate).toBe('')
  })

  it('hands every element back untouched on destroy, spacer included', () => {
    const animator = build(`<div class="outer">${markup}</div>`)
    const host = el()
    const rail = host.querySelector('.rail') as HTMLElement
    stubRect(host.parentElement!, -200)
    animator.start()
    scheduler.emit(200)
    animator.destroy()
    // Every property the library wrote, on both elements, and the node it inserted.
    expect(rail.style.display).toBe('')
    expect(rail.style.width).toBe('')
    expect(rail.style.translate).toBe('')
    expect(host.style.position).toBe('')
    expect(host.style.overflow).toBe('')
    expect(host.style.height).toBe('')
    expect(document.querySelector('[data-kui-spacer]')).toBeNull()
  })

  it('warns and does nothing when target: matches nothing, rather than sliding the wrapper', () => {
    const animator = build(
      '<div data-kui="horizontal-scroll distance:400px target:.missing"><div></div></div>',
    )
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().style.position).toBe('')
    expect(reporter.messages.join(' ')).toContain('matched nothing')
  })

  it('tracks the host itself when it has no parent to track instead', () => {
    const registry = catalogRegistry()
    const resolved = registry.resolve('horizontal-scroll')!
    const detached = document.createElement('div')
    detached.innerHTML = '<div class="rail"><i></i></div>'
    // Never appended to the document, so parentElement is null — prepareManagedTrack must fall
    // back to tracking the host itself rather than throwing on a null tracked target, the same
    // dodge `preparePin` makes for its own pinned element.
    expect(detached.parentElement).toBeNull()
    const sched = fakeScheduler()
    const ctx = {
      win: window,
      doc: document,
      scheduler: sched,
      rootFor: () => fakeRoot,
      invalidate: () => {},
      warn: () => {},
      style: createStyleLedger(detached),
    } as unknown as PrepareContext
    const instance = resolved.primitive.prepare!(detached, createParams({ target: '.rail' }), ctx)
    expect(() => instance.activate()).not.toThrow()
    instance.destroy()
  })
})
