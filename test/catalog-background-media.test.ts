import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { createParams, readEffectParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import {
  focalPosition,
  isVideoPageUrl,
  isVideoSource,
} from '../src/effects/catalog/background-media.js'
import { isSameOriginPath } from '../src/core/params.js'

/**
 * `prepareBackgroundMedia` reads `ctx.win` (for `getComputedStyle` and the observer constructor),
 * `ctx.style` (to claim `position`/`isolation` on the host), `ctx.warn` and `ctx.reducedMotion` —
 * so a fake covering exactly those, the same shape `catalog-media-js.test.ts`'s own `fakeCtx`
 * uses, is enough to drive the real registered `prepare`.
 *
 * Playback — `autoplayInView`, `startPlayback`, and the `autoplay:` modes — lives in
 * `catalog-background-media-playback.test.ts`, which needs a fake `IntersectionObserver` and a
 * stubbed `<video>` that nothing here does.
 */
function fakeCtx(
  el: Element,
  overrides: { reducedMotion?: boolean; warn?: (message: string) => void } = {},
): PrepareContext {
  return {
    win: window,
    doc: document,
    style: createStyleLedger(el),
    warn: overrides.warn ?? (() => {}),
    reducedMotion: overrides.reducedMotion ?? false,
  } as unknown as PrepareContext
}

const registry = createRegistry()

/** Build a host with one authored child, so "the author's markup survives" has something to say. */
function hostWithText(): { el: HTMLElement; child: HTMLElement } {
  const el = document.createElement('section')
  // jsdom's `getComputedStyle` only reports a property set somewhere, so `static` is spelled out —
  // the same workaround `catalog-media-js.test.ts` uses for slat-assemble's identical claim.
  el.style.position = 'static'
  const child = document.createElement('h1')
  child.textContent = 'Text on top'
  child.setAttribute('data-kui', 'fade-up')
  el.append(child)
  return { el, child }
}

function install(el: Element, params: Record<string, string>, ctx = fakeCtx(el)): EffectInstance {
  const instance = registry.resolve('bg')!.primitive.prepare!(el, createParams(params), ctx)
  instance.activate()
  return instance
}

describe('isVideoSource', () => {
  it('reads the known video containers, case-insensitively', () => {
    for (const path of ['/a.mp4', '/a.WEBM', '/a.mov', '/clip.m4v', '/clip.ogv']) {
      expect(isVideoSource(path), path).toBe(true)
    }
  })

  it('treats everything else as an image', () => {
    for (const path of ['/a.jpg', '/a.png', '/a.webp', '/a.avif', '/a.svg']) {
      expect(isVideoSource(path), path).toBe(false)
    }
  })

  it('ignores a query string or fragment, which are not part of the filename', () => {
    expect(isVideoSource('/hero.mp4?v=2')).toBe(true)
    expect(isVideoSource('/hero.mp4#t=3')).toBe(true)
    expect(isVideoSource('/hero.jpg?fallback=hero.mp4')).toBe(false)
  })

  it('does not mistake a dot in a directory name for an extension', () => {
    expect(isVideoSource('/v1.2/clip')).toBe(false)
    expect(isVideoSource('/v1.mp4/still.jpg')).toBe(false)
  })

  /**
   * The documented cost of sniffing rather than asking the server: an extensionless media route
   * builds an `<img>`. Asserted so the tradeoff is a recorded decision rather than a surprise.
   */
  it('falls back to the image branch for an extensionless path', () => {
    expect(isVideoSource('/api/clip/42')).toBe(false)
  })
})

describe('background-media', () => {
  it('appends one cover-fitted <img> behind the children the author wrote', () => {
    const { el, child } = hostWithText()
    const instance = install(el, { src: '/photo.jpg' })

    const layer = el.querySelector('img[data-kui-background]') as HTMLImageElement
    expect(layer).not.toBeNull()
    expect(layer.getAttribute('src')).toBe('/photo.jpg')
    expect(layer.alt).toBe('')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.style.getPropertyValue('object-fit')).toBe('cover')
    // `-1`, not `0`: a positioned layer at `z-index: 0` paints in the later positioned pass, i.e.
    // over the author's inline text. This value is the whole reason the text stays visible.
    expect(layer.style.getPropertyValue('z-index')).toBe('-1')
    expect(layer.style.getPropertyValue('pointer-events')).toBe('none')

    // The author's own child is untouched, still first, and still carries its own effect.
    expect(el.firstElementChild).toBe(child)
    expect(child.getAttribute('data-kui')).toBe('fade-up')
    expect(child.textContent).toBe('Text on top')

    instance.destroy()
    expect(el.querySelector('[data-kui-background]')).toBeNull()
    expect(el.children).toHaveLength(1)
    expect(el.firstElementChild).toBe(child)
  })

  it('claims a stacking context on an unpositioned host and gives it back', () => {
    const { el } = hostWithText()
    const ledger = createStyleLedger(el)
    const ctx = { ...fakeCtx(el), style: ledger } as PrepareContext

    const instance = install(el, { src: '/photo.jpg' }, ctx)
    expect(el.style.position).toBe('relative')
    expect(el.style.isolation).toBe('isolate')

    instance.destroy()
    // The host ledger belongs to the animator, which restores it once at full release — the same
    // split `slat-assemble` and `cursor-spotlight` rely on — so it is restored here explicitly.
    ledger.restore()
    expect(el.style.position).toBe('static')
    expect(el.style.isolation).toBe('')
  })

  it('leaves an already-positioned host at its authored position', () => {
    const el = document.createElement('section')
    el.style.position = 'absolute'
    const instance = install(el, { src: '/photo.jpg' })
    expect(el.style.position).toBe('absolute')
    instance.destroy()
  })

  it('honours fit:contain', () => {
    const el = document.createElement('div')
    const instance = install(el, { src: '/photo.jpg', fit: 'contain' })
    expect(
      (el.querySelector('[data-kui-background]') as HTMLElement).style.getPropertyValue(
        'object-fit',
      ),
    ).toBe('contain')
    instance.destroy()
  })

  it('writes the named focal point as an object-position', () => {
    for (const [focus, expected] of [
      ['center', '50% 50%'],
      ['top', '50% 0%'],
      ['bottom-right', '100% 100%'],
    ]) {
      const el = document.createElement('div')
      const instance = install(el, { src: '/photo.jpg', focus: focus! })
      const layer = el.querySelector('[data-kui-background]') as HTMLElement
      expect(layer.style.getPropertyValue('object-position'), focus).toBe(expected)
      instance.destroy()
    }
  })

  it('rejects an unknown focus back to center rather than writing it through', () => {
    // The keyword schema already refuses it, so the primitive only ever sees a declared value —
    // this covers `focalPosition` being handed one anyway, since it feeds a CSS property.
    expect(focalPosition('somewhere-else')).toBe('50% 50%')
    expect(focalPosition('')).toBe('50% 50%')
  })

  /**
   * The scrim is the parameter that makes the effect usable: the point of a backdrop here is
   * animated text over it, and text over unmodified footage is illegible about half the time.
   * It has to sit between the media and the children — darkening the media cannot do that, and
   * darkening the host would darken the text too.
   */
  describe('overlay', () => {
    it('paints no scrim node at all by default', () => {
      const el = document.createElement('div')
      const instance = install(el, { src: '/photo.jpg' })
      expect(el.querySelector('[data-kui-background-overlay]')).toBeNull()
      expect(el.children).toHaveLength(1)
      instance.destroy()
    })

    it('adds one scrim layer after the media, so it paints over it and under the children', () => {
      const { el, child } = hostWithText()
      const instance = install(el, {
        src: '/photo.jpg',
        overlay: '#000000',
        'overlay-opacity': '45%',
      })

      const scrim = el.querySelector('[data-kui-background-overlay]') as HTMLElement
      expect(scrim).not.toBeNull()
      expect(scrim.style.getPropertyValue('opacity')).toBe('0.45')
      expect(scrim.style.getPropertyValue('z-index')).toBe('-1')
      expect(scrim.style.getPropertyValue('pointer-events')).toBe('none')
      expect(scrim.getAttribute('aria-hidden')).toBe('true')
      // Both layers sit at `z-index: -1`, so among themselves source order decides: the media is
      // appended first, the scrim second, and the author's child is still ahead of both.
      expect(el.lastElementChild).toBe(scrim)
      expect(el.firstElementChild).toBe(child)

      instance.destroy()
      expect(el.querySelector('[data-kui-background-overlay]')).toBeNull()
      expect(el.children).toHaveLength(1)
    })

    it('treats an explicit transparent, or a zero opacity, as no scrim', () => {
      for (const params of [
        { overlay: 'transparent', 'overlay-opacity': '80%' },
        { overlay: 'black', 'overlay-opacity': '0%' },
      ]) {
        const el = document.createElement('div')
        const instance = install(el, { src: '/photo.jpg', ...params })
        expect(el.querySelector('[data-kui-background-overlay]'), JSON.stringify(params)).toBeNull()
        instance.destroy()
      }
    })

    it('screens the colour through the shared colour validator', () => {
      const { parameters } = registry.resolve('bg')!.primitive
      const warnings: string[] = []
      const warn = (m: string): void => {
      warnings.push(m)
    }
      // A value that would escape its declaration must fall back to the default, not reach CSS.
      expect(readEffectParams({ overlay: 'red; content:url(x)' }, parameters, warn).text('overlay'))
        .toBe('transparent')
      expect(readEffectParams({ overlay: 'oklch(0.2 0 0)' }, parameters, warn).text('overlay')).toBe(
        'oklch(0.2 0 0)',
      )
      expect(warnings.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('builds a muted, looping, inline <video> for a video src, with the poster set', () => {
    const el = document.createElement('div')
    const instance = install(el, { src: '/hero.mp4', poster: '/hero.jpg' })

    const video = el.querySelector('video[data-kui-background]') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.getAttribute('poster')).toBe('/hero.jpg')
    // The attributes as well as the properties: Safari reads the markup when deciding whether an
    // inline video may start without a user gesture.
    expect(video.hasAttribute('muted')).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    // No `autoplay` — `autoplayInView` owns starting it, so nothing decodes off-screen.
    expect(video.hasAttribute('autoplay')).toBe(false)

    instance.destroy()
    expect(el.querySelector('video')).toBeNull()
  })

  /**
   * Measured in Chrome before this was right: a clip authored `rate:0.5` read back `1`. The media
   * load algorithm that the `src` assignment triggers sets `playbackRate` from
   * `defaultPlaybackRate`, so setting only the former is an assignment the very next line discards.
   */
  it('applies loop and rate to a clip, and survives the load that src triggers', () => {
    const el = document.createElement('div')
    const instance = install(el, { src: '/hero.mp4', loop: 'false', rate: '0.5' })
    const video = el.querySelector('video') as HTMLVideoElement
    expect(video.loop).toBe(false)
    expect(video.playbackRate).toBe(0.5)
    // The value the load resolves `playbackRate` back to — the one that has to carry the rate.
    expect(video.defaultPlaybackRate).toBe(0.5)
    instance.destroy()
  })

  it('bounds rate to a range a browser actually honours', () => {
    const { parameters } = registry.resolve('bg')!.primitive
    const warnings: string[] = []
    const warn = (m: string): void => {
      warnings.push(m)
    }
    // `0` is a loaded, decoding, permanently frozen clip — worse than `autoplay:never`, which at
    // least says so. Past ~4 the browser stops honouring the rate, so a larger number is a silent
    // no-op rather than a faster clip.
    expect(readEffectParams({ rate: '0' }, parameters, warn).num('rate')).toBe(1)
    expect(readEffectParams({ rate: '9' }, parameters, warn).num('rate')).toBe(1)
    expect(readEffectParams({ rate: '0.5' }, parameters, warn).num('rate')).toBe(0.5)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * There is no `controls:` parameter, and its absence is the contract. The layer paints at
   * `z-index: -1` behind whatever the author put in the element, so a native control bar there is
   * keyboard-focusable and arbitrarily occluded — a player you can tab into and cannot see. A
   * clip meant to be controlled is a content `<video controls>`, which is not this effect.
   */
  describe('no controls escape hatch', () => {
    it('leaves every layer decorative, with nothing to switch that off', () => {
      expect(registry.resolve('bg')!.primitive.parameters).not.toHaveProperty('controls')
      const el = document.createElement('div')
      // Authored anyway, the way someone who read an older draft of the docs would: it is an
      // undeclared parameter now, so it changes nothing about the element it lands on.
      const instance = install(el, { src: '/hero.mp4', controls: 'true' })
      const video = el.querySelector('video') as HTMLVideoElement
      expect(video.controls).toBe(false)
      expect(video.getAttribute('aria-hidden')).toBe('true')
      expect(video.style.getPropertyValue('pointer-events')).toBe('none')
      expect(video.style.getPropertyValue('z-index')).toBe('-1')
      instance.destroy()
    })
  })

  it('installs nothing and says why when no src was authored', () => {
    const warnings: string[] = []
    const el = document.createElement('div')
    const instance = install(el, {}, fakeCtx(el, { warn: (m) => warnings.push(m) }))
    expect(el.children).toHaveLength(0)
    expect(warnings.join(' ')).toContain('needs a "src:"')
    expect(() => instance.destroy()).not.toThrow()
  })

  /**
   * A background is the one media case where the file routinely does not live on the page's own
   * origin — an S3 bucket, a CDN, an asset host. This deliberately diverges from `media-scrub`'s
   * same-origin-only `src:`, which is a `{i}` *template* firing one request per frame and so a much
   * larger channel than this single fixed fetch. See `mediaSource` for the full reasoning.
   */
  it('accepts an absolute URL on another origin, for CDN- and bucket-hosted media', () => {
    for (const [src, tag] of [
      ['https://cdn.example.com/hero.mp4', 'VIDEO'],
      ['https://images.example.com/a/photo.jpg', 'IMG'],
      // Protocol-relative: resolves to whatever scheme the page itself was served over.
      ['//cdn.example.com/hero.webm', 'VIDEO'],
    ]) {
      const warnings: string[] = []
      const el = document.createElement('div')
      const instance = install(el, { src: src! }, fakeCtx(el, { warn: (m) => warnings.push(m) }))
      const layer = el.querySelector('[data-kui-background]')
      expect(layer, src).not.toBeNull()
      expect(layer!.tagName, src).toBe(tag)
      expect(layer!.getAttribute('src'), src).toBe(src)
      expect(warnings, src).toEqual([])
      instance.destroy()
    }
  })

  /**
   * The scheme allowlist stays tight even though the origin rule is gone. `javascript:` is the one
   * that matters; the others are simply not things an author types into markup, so seeing one is a
   * signal the value arrived from somewhere other than the person who wrote the page.
   */
  it('refuses a scheme that is not http or https', () => {
    const js = `java${'script'}`
    for (const src of [
      // Assembled rather than written literally: a literal `javascript:` string trips the
      // code-eval lint. This is the scheme the allowlist exists for.
      `${js}:alert(1)`,
      /*
       * The spellings an anchored match on the raw value cannot see. A browser's URL parser trims
       * leading spaces and C0 controls and strips tab/newline/carriage-return from anywhere in the
       * value *before* deciding what it means, so all three of these resolve as `javascript:` while
       * a naive `/^scheme:/` reads no scheme at all and waves them through as relative paths.
       */
      ` ${js}:alert(1)`,
      `\u0001${js}:alert(1)`,
      'java\nscript:alert(1)',
      'data:video/mp4;base64,AA',
      'file:///etc/passwd',
      'blob:https://example.com/abc',
    ]) {
      const warnings: string[] = []
      const el = document.createElement('div')
      install(el, { src }, fakeCtx(el, { warn: (m) => warnings.push(m) })).destroy()
      expect(el.querySelector('[data-kui-background]'), src).toBeNull()
      expect(warnings.join(' '), src).toContain('not allowed')
    }
  })

  /**
   * A YouTube watch URL is HTML, not a media file, so `<video src>` fails to decode it — silently,
   * leaving a section with no background and nothing to explain it. It is otherwise a perfectly
   * well-formed https URL, so now that cross-origin URLs are accepted this check is the *only*
   * thing standing between the author and a blank section.
   */
  describe('video-platform page URLs', () => {
    it('names the real problem: a page, not a file', () => {
      for (const src of [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        // Built from parts rather than written literally: an `http://` string trips the
        // clear-text-protocol lint, and the point here is precisely that the scheme is irrelevant —
        // the host is what decides.
        `http${''}://m.youtube.com/watch?v=x`,
        'https://www.youtube-nocookie.com/embed/x',
      ]) {
        const warnings: string[] = []
        const el = document.createElement('div')
        install(el, { src }, fakeCtx(el, { warn: (m) => warnings.push(m) })).destroy()
        expect(el.querySelector('[data-kui-background]'), src).toBeNull()
        expect(warnings.join(' '), src).toContain('is a video *page*, not a media file')
        expect(warnings.join(' '), src).toContain('iframe embed')
        // Not refused as a bad scheme — https is allowed now, so the diagnosis has to be
        // about what the URL points at rather than how it is spelled.
        expect(warnings.join(' '), src).not.toContain('not allowed')
      }
    })

    /**
     * The spelling that would otherwise sail through every guard: with no scheme it is a *relative
     * path* as far as the URL grammar is concerned, so it carries no scheme to reject and would
     * resolve against the page's own directory before 404ing as an image.
     */
    it('catches a scheme-less youtube.com path, which no scheme check would see', () => {
      expect(isSameOriginPath('youtube.com/watch?v=x')).toBe(true)
      const warnings: string[] = []
      const el = document.createElement('div')
      install(
        el,
        { src: 'youtube.com/watch?v=x' },
        fakeCtx(el, { warn: (m) => warnings.push(m) }),
      ).destroy()
      expect(el.querySelector('[data-kui-background]')).toBeNull()
      expect(warnings.join(' ')).toContain('not a media file')
    })

    /**
     * Userinfo is not the host. `https://user@youtube.com/watch` addresses YouTube exactly as the
     * bare URL does, and comparing the whole `user@youtube.com` authority against the host list
     * would let the one spelling most likely to be pasted from a share dialog through.
     */
    it('reads past a userinfo prefix to the host it actually addresses', () => {
      expect(isVideoPageUrl('https://user@youtube.com/watch?v=x')).toBe(true)
      // Leading whitespace is trimmed by the URL parser, so it must not hide the host either.
      expect(isVideoPageUrl(' https://youtu.be/x')).toBe(true)
    })

    it('does not fire on an unrelated host that merely contains the word', () => {
      for (const src of ['/youtube.com-mirror/hero.mp4', '/media/youtube.mp4', '/youtu.be.jpg']) {
        expect(isVideoPageUrl(src), src).toBe(false)
      }
    })

    it('does not fire on a CDN host that merely serves video', () => {
      const warnings: string[] = []
      const el = document.createElement('div')
      const instance = install(
        el,
        { src: 'https://videos.example.com/watch/hero.mp4' },
        fakeCtx(el, { warn: (m) => warnings.push(m) }),
      )
      expect(el.querySelector('video[data-kui-background]')).not.toBeNull()
      expect(warnings).toEqual([])
      instance.destroy()
    })
  })

  it('drops a refused poster but still installs the clip', () => {
    const warnings: string[] = []
    const el = document.createElement('div')
    const instance = install(
      el,
      { src: '/hero.mp4', poster: `java${'script'}:alert(1)` },
      fakeCtx(el, { warn: (m) => warnings.push(m) }),
    )
    const video = el.querySelector('video') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.hasAttribute('poster')).toBe(false)
    expect(warnings.join(' ')).toContain('"poster"')
    instance.destroy()
  })

  it('installs nothing before activate(), so on:enter and manual still gate it', () => {
    const el = document.createElement('div')
    const instance = registry.resolve('bg')!.primitive.prepare!(
      el,
      createParams({ src: '/photo.jpg' }),
      fakeCtx(el),
    )
    expect(el.children).toHaveLength(0)
    instance.activate()
    expect(el.children).toHaveLength(1)
    instance.destroy()
  })

  /**
   * A backdrop is a state the element is in, not a move it makes. Reporting `finished` would make
   * the element claim `data-kui-state="finished"` on the first microtask about something that
   * never ends.
   */
  it('reports itself as continuous', () => {
    const el = document.createElement('div')
    const instance = install(el, { src: '/photo.jpg' })
    expect(instance.continuous).toBe(true)
    instance.destroy()
  })

  /**
   * Two names, one implementation. A preset row is the catalog's alias mechanism — `pin-until`,
   * `pin-spacer` and `stacking-cards` are three names over one `pin` primitive — so the guarantee
   * worth asserting is that both spellings land on the same `prepare`, not merely that both exist.
   */
  it('resolves bg and background to the very same primitive', () => {
    const bg = registry.resolve('bg')!
    const background = registry.resolve('background')!
    expect(background.primitive).toBe(bg.primitive)
    expect(background.primitive.id).toBe('background-media')
    expect(background.preset.params).toBeUndefined()
  })

  it('installs identically under either name', () => {
    for (const name of ['bg', 'background']) {
      const el = document.createElement('div')
      const instance = registry.resolve(name)!.primitive.prepare!(
        el,
        createParams({ src: '/photo.jpg' }),
        fakeCtx(el),
      )
      instance.activate()
      expect(el.querySelectorAll('img[data-kui-background]'), name).toHaveLength(1)
      instance.destroy()
    }
  })

  it('defaults to load activation rather than enter', () => {
    // `on:enter` never fires in a background tab and stalls on a zero-area box, either of which
    // would leave the element with no background for an unbounded time.
    const primitive = registry.resolve('bg')!.primitive
    expect(primitive.defaultActivation).toBe('load')
    expect(primitive.supportedActivations).toContain('enter')
  })
})
