// @vitest-environment jsdom
// Foreign event sources — `core/event-sources.ts`.
//
// The module has two halves and this file is one suite per half. `createEventSourceBindings` is a
// refcount over native listeners: one listener per source/event pair however many animations ask
// for it, and — the part that has never had a test of its own — *removed* when the last of them
// lets go, or when the binder is destroyed with bindings still live. `resolveEventSources` is the
// `from:` selector's install-time resolution, which deliberately refuses two kinds of selector by
// name rather than binding them.
//
// Both were previously reached only sideways, through `activation.test.ts` driving a real animator,
// which exercises the retain path and nothing else: a suite that never tears an animator down never
// runs `destroy()`, and one that only ever writes selectors an author would write never runs the
// two refusals. Those are exactly the paths whose failure is silent — a leaked `wheel` listener on
// `window` and a `from:` that binds the whole document are both invisible until a page is slow.
import { describe, expect, it, vi } from 'vitest'
import { createEventSourceBindings, resolveEventSources } from '../src/core/event-sources.js'
import { collectingReporter } from '../src/core/reporter.js'

describe('createEventSourceBindings', () => {
  it('shares one native listener per source/event pair, and removes it when the last holder lets go', () => {
    const source = document.createElement('div')
    const add = vi.spyOn(source, 'addEventListener')
    const remove = vi.spyOn(source, 'removeEventListener')
    const bindings = createEventSourceBindings()

    const releaseFirst = bindings.bind({ sources: [source], types: ['click'], run: () => {} })
    const releaseSecond = bindings.bind({ sources: [source], types: ['click'], run: () => {} })
    expect(add).toHaveBeenCalledTimes(1)

    // The second holder is still there, so the shared listener must stay installed — removing it
    // here is the bug the refcount exists to prevent, and it would show up as one animation's
    // trigger silently killing another's.
    releaseFirst()
    expect(remove).not.toHaveBeenCalled()

    releaseSecond()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  /**
   * Passive, and asserted rather than assumed. The module's own comment promises this binder never
   * cancels the source event "including `wheel` and `submit`" — a non-passive `wheel` listener on a
   * scroller blocks the compositor from scrolling until JavaScript has run, which is the single
   * most expensive mistake available here and is completely invisible from behaviour.
   */
  it('installs every listener passively', () => {
    const source = document.createElement('div')
    const add = vi.spyOn(source, 'addEventListener')
    createEventSourceBindings().bind({ sources: [source], types: ['wheel'], run: () => {} })

    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true })
  })

  it('binds the cartesian product of sources and types, and releases all of it at once', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const seen: string[] = []
    const release = createEventSourceBindings().bind({
      sources: [first, second],
      types: ['click', 'wheel'],
      run: () => seen.push('run'),
    })

    for (const source of [first, second]) for (const type of ['click', 'wheel']) source.dispatchEvent(new Event(type))
    expect(seen).toHaveLength(4)

    release()
    for (const source of [first, second]) for (const type of ['click', 'wheel']) source.dispatchEvent(new Event(type))
    expect(seen).toHaveLength(4)
  })

  /**
   * `destroy()` with bindings still on it — the animator-torn-down-mid-life case, which is the one
   * path in this module nothing reached before. Without its removal loop the native listeners
   * survive the binder that owns them, delivering into callbacks whose animation no longer exists.
   */
  it('removes every listener it still owns on destroy(), across sources and types', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const seen: string[] = []
    const bindings = createEventSourceBindings()
    bindings.bind({ sources: [first, second], types: ['click', 'wheel'], run: () => seen.push('run') })

    bindings.destroy()

    for (const source of [first, second]) for (const type of ['click', 'wheel']) source.dispatchEvent(new Event(type))
    expect(seen).toEqual([])
  })

  /**
   * A release called twice must be inert the second time, and the damage of it not being is not
   * "one extra `removeEventListener`" — it is that the stale closure still points at the *old*
   * binding, whose `runs` set is empty, so the second call walks the "last holder let go" path and
   * deletes the map entry belonging to a *later* binding on the same source/event pair. The later
   * listener stays attached to the DOM with nothing left holding a reference to it, so `destroy()`
   * can no longer find it: a leak that outlives the animator.
   */
  it('ignores a second call to the same release, so it cannot orphan a later binding', () => {
    const source = document.createElement('div')
    const seen: string[] = []
    const bindings = createEventSourceBindings()

    const releaseFirst = bindings.bind({ sources: [source], types: ['click'], run: () => seen.push('first') })
    releaseFirst()
    bindings.bind({ sources: [source], types: ['click'], run: () => seen.push('second') })
    releaseFirst()

    bindings.destroy()
    source.dispatchEvent(new Event('click'))
    expect(seen).toEqual([])
  })

  /**
   * The `[...runs]` snapshot in the shared listener, which exists to "preserve the browser's
   * event-dispatch shape" — and the half of that shape a `Set` would actually get wrong is
   * *addition*, not removal. A native listener added while an event is being dispatched does not
   * hear that event; a `Set` being iterated live does visit values pushed into it mid-iteration, so
   * without the copy an animation whose trigger installs another animation would fire the new one
   * immediately, once, off an event that arrived before it existed.
   *
   * (Removal is not the discriminating case and this test does not claim it is: a callback that
   * releases *itself* has already been visited, and `Set` iteration reaches the rest either way.)
   */
  it('delivers only to the callbacks retained when the event arrived, never to one bound mid-delivery', () => {
    const source = document.createElement('div')
    const seen: string[] = []
    const bindings = createEventSourceBindings()

    bindings.bind({
      sources: [source],
      types: ['click'],
      run: () => {
        seen.push('first')
        if (seen.length === 1) bindings.bind({ sources: [source], types: ['click'], run: () => seen.push('late') })
      },
    })

    source.dispatchEvent(new Event('click'))
    expect(seen).toEqual(['first'])

    // It was deferred, not dropped: the next event reaches both.
    source.dispatchEvent(new Event('click'))
    expect(seen).toEqual(['first', 'first', 'late'])
  })

  it('lets a callback release itself from inside its own delivery without disturbing the others', () => {
    const source = document.createElement('div')
    const seen: string[] = []
    const bindings = createEventSourceBindings()

    let releaseFirst = (): void => {}
    releaseFirst = bindings.bind({
      sources: [source],
      types: ['click'],
      run: () => {
        seen.push('first')
        releaseFirst()
      },
    })
    bindings.bind({ sources: [source], types: ['click'], run: () => seen.push('second') })

    source.dispatchEvent(new Event('click'))
    expect(seen).toEqual(['first', 'second'])

    source.dispatchEvent(new Event('click'))
    expect(seen).toEqual(['first', 'second', 'second'])
  })
})

describe('resolveEventSources', () => {
  const el = (): Element => document.body.appendChild(document.createElement('div'))

  it('resolves to the animated element itself when no from: was authored', () => {
    const target = el()
    expect(resolveEventSources({ el: target })).toEqual([target])
  })

  it('resolves every match of an authored selector, in document order', () => {
    document.body.innerHTML = '<button class="src">a</button><button class="src">b</button><div id="host"></div>'
    const host = document.body.querySelector('#host')!
    const sources = resolveEventSources({ el: host, from: '.src' })

    expect(sources.map((node) => node.textContent)).toEqual(['a', 'b'])
  })

  /**
   * The two refusals, both of which return `[]` rather than falling back to the element — falling
   * back would bind the *host* instead, so the effect would still fire, on the wrong thing, with no
   * warning ever reaching the author.
   */
  it('refuses a syntactically invalid selector by name, and binds nothing', () => {
    const reporter = collectingReporter()
    const target = el()

    expect(resolveEventSources({ el: target, from: 'div:::', reporter })).toEqual([])
    expect(reporter.messages).toEqual(['activation source "div:::" is not a valid selector and will be ignored'])
  })

  it('refuses a selector that reaches <html> or <body>, and binds nothing', () => {
    const reporter = collectingReporter()
    const target = el()

    expect(resolveEventSources({ el: target, from: '*', reporter })).toEqual([])
    expect(reporter.messages).toEqual(['activation source "*" matches the whole document and will be ignored'])
  })

  it('warns by name when a valid selector matches nothing, since a silent no-op reads as a broken effect', () => {
    const reporter = collectingReporter()
    const target = el()

    expect(resolveEventSources({ el: target, from: '.nowhere', reporter })).toEqual([])
    expect(reporter.messages).toEqual(['activation source ".nowhere" matched nothing'])
  })

  it('reports the failures through the reporter only, so an author without one still gets []', () => {
    expect(resolveEventSources({ el: el(), from: 'div:::' })).toEqual([])
    expect(resolveEventSources({ el: el(), from: '.nowhere' })).toEqual([])
  })
})
