// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createSectionIndex,
  highestReachedIndex,
  offsetTopPixels,
} from '../src/effects/scroll-mechanics/section-index.js'
import type { ScrollFrame } from '../src/core/scroll-scheduler.js'
import { fakeRoot, fakeScheduler } from './support/scroll-mechanics-harness.js'

function makeFrame(viewportHeight = 800): ScrollFrame {
  return {
    metrics: {
      scrollTop: 0,
      scrollLeft: 0,
      viewportWidth: 1000,
      viewportHeight,
      viewportTop: 0,
      viewportLeft: 0,
    },
    epoch: 0,
  }
}

describe('section-index helpers', () => {
  it('resolves offset-top in pixels against viewport metrics', () => {
    const frame = makeFrame(800)
    expect(offsetTopPixels('50vh', frame)).toBe(400)
    expect(offsetTopPixels('100px', frame)).toBe(100)
    expect(offsetTopPixels('2rem', frame)).toBe(32)
    expect(offsetTopPixels('invalid', frame)).toBe(0)
  })

  it('determines the highest reached section index', () => {
    const tops = [100, 300, 500]
    // line = 100, scrollTop = 0 -> top - scrollTop - line <= 0 for index 0 (100 - 0 - 100 = 0 <= 0).
    expect(highestReachedIndex(tops, 0, 100)).toBe(0)
    // scrollTop = 0, line = 50 -> none reached.
    expect(highestReachedIndex(tops, 0, 50)).toBe(-1)
    // scrollTop = 200, line = 100 -> tops[1] = 300: 300 - 200 - 100 = 0 <= 0 -> index 1.
    expect(highestReachedIndex(tops, 200, 100)).toBe(1)
    // scrollTop = 500, line = 100 -> index 2.
    expect(highestReachedIndex(tops, 500, 100)).toBe(2)
    // empty tops -> -1.
    expect(highestReachedIndex([], 500, 100)).toBe(-1)
  })

  it('subscribes and fires onChange when active section changes, and releases subscription', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const sec0 = document.createElement('div')
    const sec1 = document.createElement('div')
    host.append(sec0, sec1)

    sec0.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100 } as DOMRect)
    sec1.getBoundingClientRect = () => ({ top: 400, bottom: 500, left: 0, right: 100, width: 100, height: 100 } as DOMRect)

    const scheduler = fakeScheduler()
    const changes: Array<[number, number]> = []
    const ctx = {
      scheduler,
      rootFor: () => fakeRoot,
    } as any

    const index = createSectionIndex({
      el: host,
      sections: [sec0, sec1],
      ctx,
      offsetTop: '100px',
      onChange: (next, prev) => {
        changes.push([next, prev])
      },
    })

    // scrollTop = 0 -> top - line: sec0 is 100 - 100 = 0 <= 0 -> index 0.
    scheduler.emit(0)
    expect(changes).toEqual([[0, -1]])

    // Emitting same scrollTop again: no duplicate notification.
    scheduler.emit(0)
    expect(changes.length).toBe(1)

    // Advance scroll so sec1 reaches line: 400 - 300 - 100 = 0 <= 0.
    scheduler.emit(300)
    expect(changes).toEqual([[0, -1], [1, 0]])

    // Release and verify no more events.
    index.release()
    scheduler.emit(600)
    expect(changes.length).toBe(2)
  })

  it('defaults offsetTop to 0px and supports cleanup via direct function call', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const sec0 = document.createElement('div')
    host.append(sec0)

    sec0.getBoundingClientRect = () => ({ top: 50, bottom: 150, left: 0, right: 100, width: 100, height: 100 } as DOMRect)

    const scheduler = fakeScheduler()
    const changes: Array<[number, number]> = []
    const ctx = {
      scheduler,
      rootFor: () => fakeRoot,
    } as any

    const untrack = createSectionIndex({
      el: host,
      sections: [sec0],
      ctx,
      onChange: (next, prev) => {
        changes.push([next, prev])
      },
    })

    // top = 50, scrollTop = 0, line = 0 -> 50 - 0 - 0 > 0 -> index -1 (not fired).
    scheduler.emit(0)
    expect(changes.length).toBe(0)

    // scrollTop = 50 -> 50 - 50 - 0 = 0 <= 0 -> index 0.
    scheduler.emit(50)
    expect(changes).toEqual([[0, -1]])

    // Call as function (Cleanup).
    untrack()
    scheduler.emit(100)
    expect(changes.length).toBe(1)
  })
})
