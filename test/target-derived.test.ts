// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import type { FakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * Phase 2a (derived install) — `src/core/derived/install.ts`, exercised through a real `Animator`.
 *
 * Deliberately stub-agnostic per the plan: no grouped-keys assertions (3a/3b's `cascade:`/`spread:`/
 * `order:` grouping still has an inert `group-gate.ts`), no multi-group union assertions (2b's
 * `compileUnion` is real, but a union needs a match claimed by two groups of one host, which is an
 * integration-level scenario left to the reconcile pass), and no `data-kui-unmatched` attribute
 * assertions (5b's `markUnmatched` is real and wired, but the exact attribute contract is reconcile's
 * to pin down against 9b's suspect-selector list too). What's tested here is what 2a alone owns:
 * derived hosts install and carry their own state; document order; the D-D collision rule with its
 * aggregated warning; the "nothing claimable" failure path; and a clean release.
 */

let reporter: CollectingReporter
let binder: FakeBinder

function build(html: string, capabilities: Partial<Capabilities> = {}) {
  document.body.innerHTML = html
  reporter = collectingReporter()
  binder = fakeBinder()
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: { ...CAPS, ...capabilities },
    reporter,
    binder,
  })
  animator.start()
  return animator
}

function el(selector = '[data-kui]'): HTMLElement {
  return document.body.querySelector(selector) as HTMLElement
}

function all(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll(selector)] as HTMLElement[]
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('installWithTargets — derived hosts', () => {
  it('installs every match as its own derived host, ready, in document order', () => {
    build('<div data-kui="fade-up target:li"><ul><li>a</li><li>b</li><li>c</li></ul></div>')
    const items = all('li')
    expect(items.map((li) => li.getAttribute(ATTR.state))).toEqual(['ready', 'ready', 'ready'])
    expect(items.map((li) => li.getAttribute(ATTR.normalized))).toEqual(['fade-up', 'fade-up', 'fade-up'])
  })

  it('stamps the host ready as a zero-instance aggregate when it has no own group', () => {
    build('<div data-kui="fade-up target:li"><ul><li>a</li></ul></div>')
    const host = el()
    expect(host.getAttribute(ATTR.state)).toBe('ready')
    expect(host.hasAttribute(ATTR.normalized)).toBe(false)
    expect(host.style.getPropertyValue('animation-name')).toBe('')
  })

  it('installs the host group alongside its derived matches when it has its own segment', () => {
    build('<div data-kui="blur-in, fade-up target:h2"><h2>Title</h2></div>')
    expect(el().getAttribute(ATTR.normalized)).toBe('blur-in')
    expect(el().getAttribute(ATTR.state)).toBe('ready')
    expect(el('h2').getAttribute(ATTR.normalized)).toBe('fade-up')
  })
})

describe('claimMatches — collision rules (D-D)', () => {
  it('never claims the host itself', () => {
    build('<div id="wrap" data-kui="fade-up target:#wrap scope:page"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
    expect(reporter.messages.join()).toContain('is the target: host itself')
  })

  it('never claims an element that already carries its own data-kui', () => {
    build(
      '<div data-kui="fade-up target:.item"><p class="item" data-kui="blur-in">a</p><p class="item">b</p></div>',
    )
    const authored = el('p[data-kui]')
    const plain = el('p:not([data-kui])')
    expect(authored.getAttribute(ATTR.normalized)).toBe('blur-in')
    expect(plain.getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(reporter.messages.join()).toContain('already carries its own data-kui')
  })

  it('lets the first host win when two hosts target the same element, with one aggregated warning', () => {
    document.body.innerHTML =
      '<div id="first" data-kui="fade-up target:.shared scope:page"></div>' +
      '<div id="second" data-kui="blur-in target:.shared scope:page"></div>' +
      '<p class="shared">a</p><p class="shared">b</p>'
    reporter = collectingReporter()
    binder = fakeBinder()
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter,
      binder,
    })
    animator.start()
    const shared = all('.shared')
    expect(shared.every((match) => match.getAttribute(ATTR.normalized) === 'fade-up')).toBe(true)
    const claimedWarnings = reporter.messages.filter((message) =>
      message.includes('already claimed by another target: host'),
    )
    // One aggregated warning naming a count of 2, not one warning per rejected match.
    expect(claimedWarnings).toHaveLength(1)
    expect(claimedWarnings[0]).toContain('2 matches')
  })
})

describe('installWithTargets — the failure path', () => {
  it('marks the host failed when it has no own group and nothing is claimable', () => {
    build('<div data-kui="fade-up target:.nope"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
  })

  it('keeps the host running off its own group even when every target: group is unclaimable', () => {
    build('<div data-kui="blur-in, fade-up target:.nope"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('ready')
    expect(el().getAttribute(ATTR.normalized)).toBe('blur-in')
  })
})

describe('release — derived hosts', () => {
  it('restores host and every match to authored markup on reset', () => {
    const html = '<div data-kui="fade-up target:li"><ul><li>a</li><li>b</li></ul></div>'
    document.body.innerHTML = html
    reporter = collectingReporter()
    binder = fakeBinder()
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter,
      binder,
    })
    animator.start()
    animator.reset(el())
    expect(document.body.querySelector('ul')!.outerHTML).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(el().hasAttribute(ATTR.state)).toBe(false)
  })
})
