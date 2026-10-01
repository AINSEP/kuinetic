// @vitest-environment jsdom
/**
 * Does every primitive claim every host write it makes?
 *
 * A composition channel is a promise: two effects whose channels are disjoint never write the same
 * thing on one element. `findConflicts` can only keep that promise for writes a primitive declares,
 * and the bugs in this area were all undeclared writes — a deck's step index, a widget's inserted
 * toggle, a `position: relative` — each found by hand, one at a time. This file finds them from the
 * registry instead: it mounts one preset of every registered primitive, plays a whole visit
 * through it (hover, press, drag, type, scroll), and holds what it wrote on its host against what
 * it claims:
 *
 * - a new attribute needs `attributeChannel(name)`;
 * - an inline property needs a channel that covers it (`CHANNEL_PROPERTIES`), or one named after it;
 * - a changed child list, or every child written to (children taken as items), needs `SUBTREE_CHANNEL`.
 *
 * Writes on descendants are out of scope: claims are about the host (see `attributeChannel`).
 * CSS-keyframes primitives are swept too, but their properties are policed where they are written,
 * in the stylesheet, by `css-invariants.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { SUBTREE_CHANNEL, attributeChannel } from '../src/core/types.js'
import { allowedProperties } from './support/channel-properties.js'
import { catalogRegistry } from './support/registry.js'
import { fakeRoot, fakeScheduler } from './support/scroll-mechanics-harness.js'

const registry = catalogRegistry()

/** One preset per primitive: the first registered name that resolves to it. */
function onePresetPerPrimitive(): Map<string, string> {
  const byPrimitive = new Map<string, string>()
  for (const name of registry.names()) {
    const id = registry.resolve(name)!.primitive.id
    if (!byPrimitive.has(id)) byPrimitive.set(id, name)
  }
  return byPrimitive
}

const img = (name: string): string => `<img src="${name}.jpg" alt="${name}">`
const GENERIC =
  `<ul><li>${img('a')}</li><li>${img('b')}</li><li>${img('c')}</li></ul>` +
  `${img('d')}<a href="e.jpg">${img('e')}</a><p>Some text here</p>` +
  `<ol><li style="--kui-x: 20%; --kui-y: 30%">One</li><li>Two</li></ol>`

interface Observed {
  /** New attributes on the host, minus the animator's own and the authored ones. */
  attrs: Set<string>
  /** Inline properties ever seen on the host. */
  props: Set<string>
  /** The host's child list changed, or a direct child was marked as an item. */
  subtree: boolean
  /** Anything at all changed outside the animator's own host attributes. */
  acted: boolean
}

let animator: Animator | undefined

const HOST = '{host}'
const INPUT = `<input ${HOST} type="text" value="ab">`

const ANIMATOR_ATTRS = new Set<string>(Object.values(ATTR))

/** Collects the writes on one host from a document-wide MutationObserver, sampled per frame. */
function recorder(host: HTMLElement): { sample(): void; finish(): Observed } {
  const before = new Set(host.getAttributeNames())
  const children = new Set(host.children)
  const observed: Observed = { attrs: new Set(), props: new Set(), subtree: false, acted: false }
  const marked = new Set<Element>()
  const mo = new MutationObserver(() => {})
  mo.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true })
  const onHost = (record: MutationRecord): void => {
    const name = record.attributeName
    if (record.type === 'childList') observed.subtree = observed.acted = true
    else if (name && name !== 'style' && !ANIMATOR_ATTRS.has(name)) {
      observed.acted = true
      if (!before.has(name)) observed.attrs.add(name)
    }
  }
  const sample = (): void => {
    for (const record of mo.takeRecords()) {
      if (record.target === host) {
        onHost(record)
        continue
      }
      observed.acted = true
      const target = record.target as Element
      if (record.attributeName && children.has(target)) marked.add(target)
    }
    for (let i = 0; i < host.style.length; i++) observed.props.add(host.style[i]!)
  }
  const finish = (): Observed => {
    sample()
    mo.disconnect()
    // Children taken as items cannot be seen as a child-list change: the sign is that every one of
    // them was written to. A primitive that marks only some (a lightbox its pictures) is reading
    // descendants, not owning the host's children.
    if (children.size > 1 && marked.size === children.size) observed.subtree = true
    // The compiler's own inline bookkeeping is not the primitive acting.
    const own = (p: string): boolean => !p.startsWith('animation') && p !== '--kui-transition'
    if ([...observed.props].some(own)) observed.acted = true
    return observed
  }
  return { sample, finish }
}

/**
 * A person's whole visit: hover in and across (the host, then its first child, for a group effect
 * that listens for a member), focus, press and hold (long-press), drag right (drag, swipe),
 * release and click, type (an input host), Enter, leave, then scroll down the page and back up
 * (hide-on-scroll needs the direction).
 */
function visit(host: HTMLElement, frames: (count: number) => void, emit: (top: number) => void): void {
  const pointer = (type: string, x: number, target: Element = host): void => {
    const event = new MouseEvent(type, { clientX: x, clientY: 30, bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: 'mouse' },
      isPrimary: { value: true },
    })
    target.dispatchEvent(event)
    frames(1)
  }
  const each = (types: string[], x: number, target?: Element): void => {
    for (const type of types) pointer(type, x, target)
  }
  for (const target of [host, host.firstElementChild ?? host]) {
    each(['pointerover', 'pointerenter', 'mouseover', 'mouseenter'], 40, target)
    for (const x of [40, 120, 180]) each(['pointermove', 'mousemove'], x, target)
  }
  host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  host.dispatchEvent(new FocusEvent('focus'))
  each(['pointerdown', 'mousedown'], 40)
  frames(50)
  for (const x of [60, 100, 160, 190]) each(['pointermove', 'mousemove'], x)
  each(['pointerup', 'mouseup', 'click'], 190)
  if (host instanceof HTMLInputElement) {
    host.value = 'Tr0ub4dor&3 horse'
    host.dispatchEvent(new Event('input', { bubbles: true }))
    host.dispatchEvent(new Event('change', { bubbles: true }))
  }
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  frames(30)
  each(['pointerout', 'pointerleave', 'mouseout', 'mouseleave'], 400)
  for (const scrollTop of [0, 400, 1200, 2400, 1600, 800, 300]) {
    emit(scrollTop)
    frames(4)
  }
}

/**
 * Mount `value` on a host, play a whole visit through it, and record every write it made.
 *
 * @complexity O(f * m) in frames played and mutation records per frame.
 */
function drive(value: string, inner: string): Observed {
  // Markup with a `{host}` slot is the whole fixture, for a host that is not a `<div>` (an input,
  // an SVG path); anything else is the inside of a `<div>` host.
  const open = `id="host" aria-label="Host" data-kui="${value}"`
  document.body.innerHTML = inner.includes(HOST)
    ? inner.replace(HOST, open)
    : `<div ${open}>${inner}</div>`
  const host = document.getElementById('host')!
  const record = recorder(host)
  const scheduler = fakeScheduler()
  animator = new Animator({
    root: document.body,
    registry,
    capabilities: defaultCapabilities({
      intersectionObserver: true,
      individualTransforms: true,
      motionPath: true,
      viewTransitions: true,
    }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler,
    rootResolver: () => fakeRoot,
    // Silent: a primitive that refuses its fixture shows up as silent in the second test.
    reporter: { warn: () => {} },
  })
  animator.start()
  const frames = (count: number): void => {
    for (let frame = 0; frame < count; frame++) {
      vi.advanceTimersByTime(16)
      record.sample()
    }
  }
  frames(30)
  visit(host, frames, (top) => scheduler.emit(top))
  frames(120)
  return record.finish()
}

const TEXT = 'Hello there world'
const LIST = `<ul><li>${img('a')}</li><li>${img('b')}</li><li>${img('c')}</li></ul>`

/**
 * Markup a primitive needs before it does anything, keyed by primitive id, as
 * `[data-kui value, inner markup]`. This is input, not the list of what is checked: every
 * registered primitive is checked, with its first preset name and `GENERIC` by default.
 */
const FIXTURES: Record<string, [string, string]> = {
  // Text effects refuse a host with a link inside (they would replace it).
  count: ['count-compact', '12345'],
  'count-odometer': ['odometer-roll', '1234'],
  'scramble-text': ['decode', TEXT],
  'split-text': ['split-chars', TEXT],
  'split-text-motion': ['text-jitter', TEXT],
  typewriter: ['typewriter', TEXT],
  'background-media': ['background src:/a.jpg', GENERIC],
  slideshow: ['carousel-fade', LIST],
  'strength-meter': ['strength-meter', INPUT],
  'range-fill': ['range-fill', INPUT],
  'path-morph': [`icon-morph to:'M0 0 L20 20'`, `<svg><path ${HOST} d="M0 0 L10 10"></path></svg>`],
  'word-cycler': ['word-cycler words:one|two|three', 'zero'],
  'rotate-static': ['rotate-static angle:10deg', GENERIC],
  'flip-indicator': ['tab-indicator-slide follow:#tab', `<button id="tab">Tab</button>`],
  'tilt-parallax': ['tilt-parallax', `<div data-depth="2">Layer</div>${GENERIC}`],
  'icon-toggle': ['hamburger-to-x', '<span></span><span></span><span></span>'],
  'view-swap': ['view-swap controls:#panel', `<div id="panel">Panel</div>`],
}

const HOVER_SHEET = 'its stylesheet paints the hover; prepare writes only --kui-transition'
const OPEN_SHEET = 'its stylesheet paints the open state; prepare writes only --kui-transition'

/**
 * JS primitives that, even with the stubs above and their fixture, write nothing on the host,
 * its children or the page: the check above has nothing to say about them. Each with why.
 */
const SILENT: Record<string, string> = {
  lift: HOVER_SHEET,
  pop: HOVER_SHEET,
  'lift-shadow': HOVER_SHEET,
  'shine-sweep': HOVER_SHEET,
  'split-flap': HOVER_SHEET,
  'border-draw': HOVER_SHEET,
  'border-glow': HOVER_SHEET,
  'beam-border': HOVER_SHEET,
  'beam-border-auto': 'its stylesheet runs the beam; prepare writes only --kui-transition',
  'underline-slide': HOVER_SHEET,
  'underline-center': HOVER_SHEET,
  'icon-wiggle': HOVER_SHEET,
  'icon-spin': HOVER_SHEET,
  'icon-bounce': HOVER_SHEET,
  'proximity-glow': HOVER_SHEET,
  press: 'its stylesheet paints :active; prepare writes only --kui-transition',
  'group-dim': 'its stylesheet dims the siblings of a hovered child; prepare writes only --kui-transition',
  'fade-open': OPEN_SHEET,
  'drop-open': OPEN_SHEET,
  'pop-open': OPEN_SHEET,
  'scale-open': OPEN_SHEET,
  'slide-open-up': OPEN_SHEET,
  'slide-open-down': OPEN_SHEET,
  'native-state': 'inert: forms.css paints :checked on the input itself',
  'radio-fill': 'writes only on its next sibling (the drawn control), never the host',
  'toggle-morph': 'writes only on its next sibling (the drawn control), never the host',
  glass: 'a surface made of its stylesheet; prepare is a no-op',
  'label-swap': HOVER_SHEET,
  'search-expand': 'its stylesheet widens it on focus; prepare writes only --kui-transition',
  'flip-container': 'animates a layout change the page makes (FLIP); none happens here',
}

/** Inline properties a family channel covers beyond its own name. */
const PROPERTY_FAMILIES: Record<string, string[]> = {
  position: ['position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index'],
}

/**
 * Inline properties every effect may write without a claim:
 * - custom properties (`--*`) are each primitive's own names, read only by its own stylesheet;
 * - `animation-*` longhands are the compiler's, which owns every keyframe track on the element;
 * - `--kui-transition` is the transition merge's, shared on purpose (`transition-merge.test.ts`).
 */
const unpoliced = (property: string): boolean =>
  property.startsWith('--') || property.startsWith('animation')

/** Every host write in `observed` that `channels` does not cover. */
function unclaimed(observed: Observed, channels: readonly string[]): string[] {
  const allowed = new Set([
    ...allowedProperties(channels),
    ...channels,
    ...channels.flatMap((channel) => PROPERTY_FAMILIES[channel] ?? []),
  ])
  // `class` is a token list: an effect adding its own `kui-` token cannot overwrite another's.
  const claimable = [...observed.attrs].filter((name) => name !== 'class')
  return [
    ...claimable.filter((name) => !channels.includes(attributeChannel(name))).map((n) => `@${n}`),
    ...[...observed.props].filter((property) => !unpoliced(property) && !allowed.has(property)),
    ...(observed.subtree && !channels.includes(SUBTREE_CHANNEL) ? ['subtree'] : []),
  ]
}

/** One primitive's sweep: what it wrote that it does not claim, and whether it wrote at all. */
interface Finding {
  id: string
  value: string
  renderer: string
  missing: string[]
  acted: boolean
}

let findings: Finding[] | undefined

/** Mount one preset per registered primitive and read back what each wrote. */
function sweep(): Finding[] {
  if (findings) return findings
  findings = []
  for (const [id, name] of onePresetPerPrimitive()) {
    const { primitive } = registry.resolve(name)!
    const [value, inner] = FIXTURES[id] ?? [name, GENERIC]
    const observed = drive(value, inner)
    animator?.destroy()
    animator = undefined
    document.body.replaceChildren()
    findings.push({
      id,
      value,
      renderer: primitive.renderer,
      missing: unclaimed(observed, primitive.channels),
      acted: observed.acted,
    })
  }
  return findings
}

describe('every primitive claims every host write it makes', () => {
  beforeAll(() => {
    vi.useFakeTimers({
      toFake: [
        'performance',
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
    // A desktop with a mouse and no reduced-motion preference: the cursor and hover effects gate
    // themselves on the first two, and every effect on the last.
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: /pointer:\s*fine|hover:\s*hover|no-preference/.test(media),
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }))
    // Everything is on screen, at once.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(target: Element): void {
          const rect = target.getBoundingClientRect()
          const entry = {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0,
          }
          this.callback([entry], this as unknown as IntersectionObserver)
        }
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return []
        }
      },
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    // A View Transitions browser that runs the update and finishes at once, so the two effects
    // built on it get as far as naming their element.
    const done = Promise.resolve()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update?: () => void) => {
        update?.()
        return { finished: done, ready: done, updateCallbackDone: done, skipTransition() {} }
      },
    })
    // jsdom lays nothing out, so every box is 0x0 and the pointer-geometry effects see a pointer
    // that is never over anything. One fixed box for every element is enough to get them moving.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect)
    // jsdom computes no `position` at all; a browser computes `static` for an unpositioned box,
    // which is the value the effects that position their host test for before writing.
    const computed = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = computed(element, pseudo)
      return new Proxy(style, {
        get(target, key) {
          if (key === 'position') return target.position || 'static'
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    })
  })

  afterAll(() => {
    vi.restoreAllMocks()
    delete (document as Partial<Document>).startViewTransition
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('every attribute, inline property and child list a primitive writes on its host, it claims', () => {
    const unclaimedWrites = sweep()
      .filter((finding) => finding.missing.length > 0)
      .map((finding) => `${finding.id} (${finding.value}): ${finding.missing.join(', ')}`)
    expect(unclaimedWrites.join('\n')).toBe('')
  })

  it('the JS primitives that wrote nothing on the way are exactly the listed ones', () => {
    // A silent primitive is a primitive the check above says nothing about, so the list is kept
    // honest both ways: a new silent one fails here until it gets a fixture or a reason, and a
    // listed one that starts writing fails until it comes off the list.
    const silent = sweep()
      .filter((finding) => finding.renderer !== 'css-keyframes' && !finding.acted)
      .map((finding) => finding.id)
    const unlisted = silent.filter((id) => !(id in SILENT))
    const writesNow = Object.keys(SILENT).filter((id) => !silent.includes(id))
    expect({ unlisted, writesNow }).toEqual({ unlisted: [], writesNow: [] })
  })
})
