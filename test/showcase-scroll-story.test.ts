// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { STORY_SIDE_ATTR } from '../src/showcase/scroll-story.js'
import { STEP_STATE_ATTR } from '../src/effects/step-marking.js'
import { catalogRegistry } from './support/registry.js'
import { build, fakeRoot, fakeScheduler, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const THREE_STEPS_STORY = `
  <section id="story" data-kui="scroll-story" aria-label="Product tour">
    <div class="media">
      <img id="m0" src="0.png" alt="Overview">
      <img id="m1" src="1.png" alt="Details">
      <img id="m2" src="2.png" alt="Export">
    </div>
    <ol class="steps">
      <li id="s0"><h3>Connect</h3><p>Start here.</p></li>
      <li id="s1"><h3>Configure</h3><p>Adjust settings.</p></li>
      <li id="s2"><h3>Deploy</h3><p>Go live.</p></li>
    </ol>
  </section>
`

function sec(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement
}

describe('scroll-story primitive', () => {
  it('stamps step 0 initially and updates the active step as sections cross the line', () => {
    const animator = build(THREE_STEPS_STORY)
    // Viewport height in fakeScheduler is 800px; 50vh activation line = 400px.
    // Place s0 at 300px (past line: 300 <= 400), s1 at 600px, s2 at 900px.
    stubRect(sec('s0'), 300, 300)
    stubRect(sec('s1'), 600, 300)
    stubRect(sec('s2'), 900, 300)
    animator.start()
    scheduler.emit(0)

    const story = sec('story')
    expect(story.getAttribute('data-kui-step')).toBe('0')
    expect(story.style.getPropertyValue('--kui-step')).toBe('0')
    expect(sec('s0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('m0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('s1').getAttribute(STEP_STATE_ATTR)).toBe('after')
    expect(sec('m1').getAttribute(STEP_STATE_ATTR)).toBe('after')

    // Scroll down: s1 crosses the line (600 - 250 = 350 <= 400).
    scheduler.emit(250)
    expect(story.getAttribute('data-kui-step')).toBe('1')
    expect(sec('s0').getAttribute(STEP_STATE_ATTR)).toBe('before')
    expect(sec('m0').getAttribute(STEP_STATE_ATTR)).toBe('before')
    expect(sec('s1').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('m1').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('s2').getAttribute(STEP_STATE_ATTR)).toBe('after')
    expect(sec('m2').getAttribute(STEP_STATE_ATTR)).toBe('after')

    // Scroll down further: s2 crosses the line (900 - 550 = 350 <= 400).
    scheduler.emit(550)
    expect(story.getAttribute('data-kui-step')).toBe('2')
    expect(sec('s1').getAttribute(STEP_STATE_ATTR)).toBe('before')
    expect(sec('m1').getAttribute(STEP_STATE_ATTR)).toBe('before')
    expect(sec('s2').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('m2').getAttribute(STEP_STATE_ATTR)).toBe('active')
  })

  it('maps index -1 to 0 before the first section is reached and when scrolling back above it', () => {
    const animator = build(THREE_STEPS_STORY)
    // Place all sections well below the 400px reference line.
    stubRect(sec('s0'), 600, 300)
    stubRect(sec('s1'), 950, 300)
    stubRect(sec('s2'), 1300, 300)
    animator.start()
    scheduler.emit(0)

    const story = sec('story')
    // Index -1 maps to 0 so the first media shows immediately.
    expect(story.getAttribute('data-kui-step')).toBe('0')
    expect(story.style.getPropertyValue('--kui-step')).toBe('0')
    expect(sec('s0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('m0').getAttribute(STEP_STATE_ATTR)).toBe('active')

    // Scroll down so section 1 is reached.
    scheduler.emit(600)
    expect(story.getAttribute('data-kui-step')).toBe('1')
    expect(sec('s1').getAttribute(STEP_STATE_ATTR)).toBe('active')

    // Scroll back up before the first section (scrollTop 0: s0 at 600px > 400px line -> -1).
    scheduler.emit(0)
    expect(story.getAttribute('data-kui-step')).toBe('0')
    expect(sec('s0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('m0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('s1').getAttribute(STEP_STATE_ATTR)).toBe('after')
  })

  it('marks both media and section groups with step state and offsets', () => {
    const animator = build(THREE_STEPS_STORY)
    stubRect(sec('s0'), 200, 300)
    stubRect(sec('s1'), 600, 300)
    stubRect(sec('s2'), 1000, 300)
    animator.start()
    scheduler.emit(0)

    for (const prefix of ['s', 'm']) {
      expect(sec(`${prefix}0`).getAttribute(STEP_STATE_ATTR)).toBe('active')
      expect(sec(`${prefix}0`).style.getPropertyValue('--kui-offset')).toBe('0')
      expect(sec(`${prefix}0`).style.getPropertyValue('--kui-item-count')).toBe('3')
      expect(sec(`${prefix}1`).getAttribute(STEP_STATE_ATTR)).toBe('after')
      expect(sec(`${prefix}2`).getAttribute(STEP_STATE_ATTR)).toBe('after')
    }
  })

  it('emits count-mismatch warning directly from the step marker when group sizes differ', () => {
    const mismatchedHtml = `
      <section data-kui="scroll-story" aria-label="Mismatched tour">
        <div class="media">
          <img id="m0" src="0.png" alt="0">
          <img id="m1" src="1.png" alt="1">
        </div>
        <ol class="steps">
          <li id="s0">Step 0</li>
          <li id="s1">Step 1</li>
          <li id="s2">Step 2</li>
        </ol>
      </section>
    `
    const animator = build(mismatchedHtml)
    stubRect(sec('s0'), 100, 300)
    animator.start()

    expect(reporter.messages.join()).toContain('target matched groups of different sizes (2, 3)')
  })

  it('stamps side attribute on host with default and authored values', () => {
    const defaultAnimator = build(THREE_STEPS_STORY)
    stubRect(sec('s0'), 100, 300)
    defaultAnimator.start()
    expect(sec('story').getAttribute(STORY_SIDE_ATTR)).toBe('end')
    defaultAnimator.destroy()

    document.body.innerHTML = ''
    const startAnimator = build(`
      <section id="story-start" data-kui="scroll-story side:start" aria-label="Side start">
        <div><img id="m0" src="0.png"></div>
        <ol><li id="s0">Step 0</li></ol>
      </section>
    `)
    stubRect(sec('s0'), 100, 300)
    startAnimator.start()
    expect(sec('story-start').getAttribute(STORY_SIDE_ATTR)).toBe('start')
  })

  it('plays active video with autoplay or loop and pauses inactive videos', () => {
    const videoHtml = `
      <section id="story-video" data-kui="scroll-story" aria-label="Video tour">
        <div class="media">
          <video id="v0" loop></video>
          <video id="v1" autoplay></video>
          <video id="v2"></video>
        </div>
        <ol class="steps">
          <li id="s0">0</li>
          <li id="s1">1</li>
          <li id="s2">2</li>
        </ol>
      </section>
    `
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const animator = build(videoHtml)
    stubRect(sec('s0'), 200, 300)
    stubRect(sec('s1'), 600, 300)
    stubRect(sec('s2'), 1000, 300)
    animator.start()
    scheduler.emit(0)

    // play/pause are one prototype spy each, so `v0.play` IS `v1.play`: assert on the receiver
    // (`mock.contexts`), or swapping the active and inactive video would still pass.
    const v0 = sec('v0') as HTMLVideoElement
    const v1 = sec('v1') as HTMLVideoElement
    const v2 = sec('v2') as HTMLVideoElement
    expect(playSpy.mock.contexts).toEqual([v0])
    expect(pauseSpy.mock.contexts).toEqual([v1, v2])

    playSpy.mockClear()
    pauseSpy.mockClear()

    // Advance to step 1: v1 has autoplay so it plays; v0 pauses.
    scheduler.emit(300)
    expect(playSpy.mock.contexts).toEqual([v1])
    expect(pauseSpy.mock.contexts).toEqual([v0, v2])

    playSpy.mockClear()
    pauseSpy.mockClear()

    // Advance to step 2: v2 has neither autoplay nor loop, so it does not play.
    scheduler.emit(700)
    expect(playSpy).not.toHaveBeenCalled()
    expect(pauseSpy.mock.contexts).toEqual([v0, v1])
  })

  it('pauses the active video while the story is off screen and resumes it on return', () => {
    const observers: Array<{ fire(inView: boolean): void; target?: Element; disconnected: boolean }> = []
    class FakeIntersectionObserver {
      target?: Element
      disconnected = false
      constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observers.push(this)
      }
      observe(target: Element): void { this.target = target }
      disconnect(): void { this.disconnected = true }
      fire(inView: boolean): void { this.callback([{ isIntersecting: inView }]) }
    }
    const host = window as Window & { IntersectionObserver?: unknown }
    const original = host.IntersectionObserver
    host.IntersectionObserver = FakeIntersectionObserver
    try {
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
      const animator = build(`
        <section id="story-io" data-kui="scroll-story">
          <div><video id="v0" loop></video><video id="v1" autoplay></video></div>
          <ol><li id="s0">0</li><li id="s1">1</li></ol>
        </section>`)
      stubRect(sec('s0'), 200, 300)
      stubRect(sec('s1'), 600, 300)
      animator.start()
      scheduler.emit(0)
      const [observer] = observers
      expect(observer?.target).toBe(sec('story-io'))
      // The observer has not reported visibility yet; an initially offscreen story must not play.
      expect(playSpy).not.toHaveBeenCalled()

      observer!.fire(true)
      expect(playSpy.mock.contexts).toEqual([sec('v0')])

      // The observer repeating what it already reported changes nothing, so it starts nothing.
      playSpy.mockClear()
      observer!.fire(true)
      expect(playSpy).not.toHaveBeenCalled()

      playSpy.mockClear()
      pauseSpy.mockClear()
      observer!.fire(false)
      expect(playSpy).not.toHaveBeenCalled()
      expect(pauseSpy.mock.contexts).toContain(sec('v0'))

      // A step change while off screen still plays nothing.
      scheduler.emit(300)
      expect(playSpy).not.toHaveBeenCalled()

      observer!.fire(true)
      expect(playSpy.mock.contexts).toEqual([sec('v1')])
      animator.destroy()
      expect(observer!.disconnected).toBe(true)
    } finally {
      host.IntersectionObserver = original
    }
  })

  it('hands back each video’s pre-activation play state on teardown', () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const animator = build(`
      <section id="story-prior" data-kui="scroll-story">
        <div><video id="v0"></video><video id="v1"></video></div>
        <ol><li id="s0">0</li><li id="s1">1</li></ol>
      </section>`)
    // The author had v1 playing (an inactive step) and v0 paused.
    Object.defineProperty(sec('v1'), 'paused', { configurable: true, get: () => false })
    stubRect(sec('s0'), 200, 300)
    stubRect(sec('s1'), 600, 300)
    animator.start()
    scheduler.emit(0)
    expect(pauseSpy.mock.contexts).toContain(sec('v1'))

    playSpy.mockClear()
    pauseSpy.mockClear()
    animator.destroy()
    expect(playSpy.mock.contexts).toEqual([sec('v1')])
    expect(pauseSpy.mock.contexts).toEqual([sec('v0')])
  })

  it('finds and controls nested videos inside media containers', () => {
    const nestedHtml = `
      <section id="story-nested" data-kui="scroll-story" aria-label="Nested video tour">
        <div class="media">
          <figure id="f0"><video id="nv0" loop></video></figure>
          <figure id="f1"><video id="nv1" loop></video></figure>
        </div>
        <ol class="steps">
          <li id="ns0">0</li>
          <li id="ns1">1</li>
        </ol>
      </section>
    `
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const animator = build(nestedHtml)
    stubRect(sec('ns0'), 200, 300)
    stubRect(sec('ns1'), 600, 300)
    animator.start()
    scheduler.emit(0)

    const nv0 = sec('nv0') as HTMLVideoElement
    const nv1 = sec('nv1') as HTMLVideoElement
    expect(playSpy.mock.contexts).toEqual([nv0])
    expect(pauseSpy.mock.contexts).toEqual([nv1])

    playSpy.mockClear()
    pauseSpy.mockClear()

    scheduler.emit(300)
    expect(playSpy.mock.contexts).toEqual([nv1])
    expect(pauseSpy.mock.contexts).toEqual([nv0])
  })

  it('supports authored target, sections, and offset-top parameters', () => {
    const customHtml = `
      <section id="custom-story" data-kui="scroll-story target:'.custom-media .target-item' sections:'.custom-steps .step-item' offset-top:100px" aria-label="Custom">
        <div class="custom-media">
          <div id="ignored-m" class="ignored">Ignored</div>
          <img id="cm0" class="target-item" src="0.png">
          <img id="cm1" class="target-item" src="1.png">
        </div>
        <div class="custom-steps">
          <h2 id="header-s" class="ignored">Header</h2>
          <div id="cs0" class="step-item">Step 0</div>
          <div id="cs1" class="step-item">Step 1</div>
        </div>
      </section>
    `
    const animator = build(customHtml)
    // In fakeScheduler, viewport is 800px. With default 50vh, line = 400px.
    // Authored offset-top: 100px -> line = 100px.
    stubRect(sec('cs0'), 150, 300)
    stubRect(sec('cs1'), 500, 300)
    animator.start()
    scheduler.emit(0)

    expect(sec('ignored-m').hasAttribute(STEP_STATE_ATTR)).toBe(false)
    expect(sec('header-s').hasAttribute(STEP_STATE_ATTR)).toBe(false)
    expect(sec('custom-story').getAttribute('data-kui-step')).toBe('0')
    expect(sec('cm0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('cm1').getAttribute(STEP_STATE_ATTR)).toBe('after')

    // Scroll to 200:
    // With authored offset-top 100px, cs1 (500 - 200 = 300 > 100) has NOT reached the line (stays step 0).
    // Under default 50vh (400px), 300 <= 400 would prematurely advance to step 1.
    scheduler.emit(200)
    expect(sec('custom-story').getAttribute('data-kui-step')).toBe('0')
    expect(sec('cm0').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('cm1').getAttribute(STEP_STATE_ATTR)).toBe('after')

    // Scroll by 450: cs1 at 500 - 450 = 50 <= 100px line -> reaches step 1.
    scheduler.emit(450)
    expect(sec('custom-story').getAttribute('data-kui-step')).toBe('1')
    expect(sec('cm0').getAttribute(STEP_STATE_ATTR)).toBe('before')
    expect(sec('cm1').getAttribute(STEP_STATE_ATTR)).toBe('active')
    expect(sec('ignored-m').hasAttribute(STEP_STATE_ATTR)).toBe(false)
    expect(sec('header-s').hasAttribute(STEP_STATE_ATTR)).toBe(false)

    animator.destroy()
  })

  it('does not autoplay videos under reduced motion', () => {
    const videoHtml = `
      <section id="story-rm" data-kui="scroll-story" aria-label="Video tour RM">
        <div class="media">
          <video id="v0" autoplay loop></video>
        </div>
        <ol class="steps">
          <li id="s0">0</li>
        </ol>
      </section>
    `
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    // Build with reducedMotion: true.
    document.body.innerHTML = videoHtml
    const sched = fakeScheduler()
    const rmAnimator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: defaultCapabilities({
        individualTransforms: true,
        scrollTimelineName: true,
        intersectionObserver: true,
        motionPath: true,
        reducedMotion: true,
      }),
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: sched,
      rootResolver: () => fakeRoot,
    })
    stubRect(sec('s0'), 100, 300)
    rmAnimator.start()
    sched.emit(0)

    expect(playSpy).not.toHaveBeenCalled()
    // An authored `autoplay` starts natively, so skipping play() is not enough: the active video
    // must be paused too.
    expect(pauseSpy.mock.contexts).toContain(sec('v0'))
    rmAnimator.destroy()
  })

  it('restores all host, media, and section attributes and pauses videos on teardown', () => {
    const videoHtml = `
      <section id="story-td" data-kui="scroll-story" aria-label="Teardown story">
        <div class="media">
          <video id="v0" autoplay loop></video>
        </div>
        <ol class="steps">
          <li id="s0">Step</li>
        </ol>
      </section>
    `
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)

    const animator = build(videoHtml)
    stubRect(sec('s0'), 100, 300)
    animator.start()
    scheduler.emit(0)

    const story = sec('story-td')
    expect(story.hasAttribute('data-kui-step')).toBe(true)
    expect(story.hasAttribute(STORY_SIDE_ATTR)).toBe(true)
    expect(sec('s0').hasAttribute(STEP_STATE_ATTR)).toBe(true)

    animator.destroy()

    expect(story.hasAttribute('data-kui-step')).toBe(false)
    expect(story.style.getPropertyValue('--kui-step')).toBe('')
    expect(story.hasAttribute(STORY_SIDE_ATTR)).toBe(false)
    expect(sec('s0').hasAttribute(STEP_STATE_ATTR)).toBe(false)
    expect(sec('v0').hasAttribute(STEP_STATE_ATTR)).toBe(false)
    expect(pauseSpy).toHaveBeenCalled()
  })

  it('warns and bails out if target or sections match no elements', () => {
    const emptyMedia = build(`
      <section data-kui="scroll-story" aria-label="Empty media">
        <div class="empty-media"></div>
        <ol><li>Step</li></ol>
      </section>
    `)
    emptyMedia.start()
    expect(reporter.messages.join()).toContain('scroll-story target matched no media')
    emptyMedia.destroy()

    document.body.innerHTML = ''
    const emptySections = build(`
      <section data-kui="scroll-story" aria-label="Empty sections">
        <div><img src="1.png"></div>
        <ol class="empty-steps"></ol>
      </section>
    `)
    emptySections.start()
    expect(reporter.messages.join()).toContain('scroll-story sections matched no elements')
    emptySections.destroy()
  })

  it('rejects invalid media and section selectors without querying them', () => {
    const animator = build('<section data-kui="scroll-story target:\'[\' sections:\'[\'" aria-label="Invalid story"><div><img src="a.png"></div><ol><li>Step</li></ol></section>')
    animator.start()
    expect(reporter.messages.join()).toContain('not a valid selector')
    expect(reporter.messages.join()).toContain('scroll-story target matched no media')
    expect(document.querySelector('[data-kui-step]')).toBeNull()
    animator.destroy()
  })
})
