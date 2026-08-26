import type { PrepareContext } from '../../core/effect-context.js'
import type { Cleanup } from '../../core/types.js'

/**
 * DOM surgery behind `background-media` (catalog section G).
 *
 * Every other DOM-creating primitive in the library builds *scaffolding* — `pin`'s spacer,
 * `slat-assemble`'s slats, `split-text`'s spans — synthetic nodes that stand in for something the
 * author already wrote. This one is the opposite: it creates a node that exists nowhere in the
 * author's markup and is the whole point of the effect, so that a full-bleed backdrop costs one
 * attribute instead of a wrapper, a `<video muted loop playsinline>`, an `object-fit` rule, a
 * z-index rule and a page-level `IntersectionObserver`.
 *
 * The layer is styled inline rather than through a class in `media.css`, which is the reverse of
 * `slat-assemble`'s split, for two reasons. Nothing on it is authored, so there is no cascade to
 * respect and no ledger to keep — the node is deleted whole on teardown. And a page that ships
 * `kuinetic.js` without `kuinetic.css` would otherwise render an unsized, unclipped image on top
 * of its own text: for a decorative slat that is a missing animation, but for the element that
 * *is* the background it is a broken page, and this primitive's promise is that one attribute is
 * enough.
 */

/**
 * Extensions that mean "this URL is a video".
 *
 * Sniffing the extension is a heuristic and the alternatives are worse: a `HEAD` request to read
 * `Content-Type` costs a round trip before anything can paint and fails on any host that does not
 * answer `HEAD`, and making the author write `as:video` beside a URL that already ends in `.mp4`
 * is exactly the redundant tagging this primitive exists to delete. The failure mode is narrow and
 * loud — an extensionless media route (`/api/clip/42`) builds an `<img>` that never decodes — and
 * every media path in this repo and in ordinary static hosting carries its extension.
 *
 * `.ogg` is deliberately absent: it is an audio container as often as a video one, so it is the
 * single extension where the guess is a coin flip rather than a safe default.
 */
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])

/**
 * Hosts whose URLs are *pages about* a video rather than a video.
 *
 * A YouTube watch URL is HTML — hand it to `<video src>` and the element fails to decode, silently,
 * leaving a section with no background and nothing in the console to explain it. Playing one needs
 * the iframe embed API, which is a different mechanism end to end: a third-party document, its own
 * player, its own consent and cookie story, and no `object-fit` to cover a box with. That is a
 * separate effect if it is ever wanted, not a branch inside this one.
 *
 * Listed so the author gets told which of those two things they asked for. Adding another platform
 * is one entry — the diagnostic already speaks generally.
 */
const VIDEO_PAGE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
])

/**
 * An authored value as the browser's URL parser will see it.
 *
 * The parser strips tab, newline and carriage return from anywhere in a URL and trims leading C0
 * controls and spaces *before* it decides what the value means, so `" javascript:alert(1)"` and
 * `"java\nscript:alert(1)"` are both the `javascript:` URL that `schemeOf` below must recognise.
 * Reading the raw string instead sees no scheme at all and classifies either one as a relative
 * path — the guard passes and the browser runs the script. Normalising first is what makes the two
 * agree about what they are looking at.
 *
 * The strip is a single-character class and the trim is a forward scan, so this stays linear on
 * author input — the same constraint `hostOf` below is written to.
 *
 * @complexity O(n) time and space in value length.
 * @overallScore 100
 */
function normalizeUrl(value: string): string {
  const stripped = value.replace(/[\t\n\r]/g, '')
  // Scanned by code unit rather than matched by a `[\u0000-\u0020]` class, which `no-control-regex`
  // refuses on sight — and `trimStart()` is not a substitute: it trims Unicode whitespace, which
  // does not include the C0 controls that are exactly what this is here to catch.
  let start = 0
  while (start < stripped.length && stripped.charCodeAt(start) <= 0x20) start += 1
  return stripped.slice(start)
}

/**
 * The host an authored value addresses, or `''` when it addresses no host at all.
 *
 * Written as two anchored replaces and a search rather than one host-matching pattern: a regex with
 * a repeated optional subdomain group (`(?:[\w-]+\.)*`) is exactly the shape that backtracks badly,
 * and this runs on author input. Every step here is a single linear pass.
 *
 * `youtube.com/watch?v=x` with no scheme is deliberately covered. It is a *relative path* as far as
 * the URL grammar is concerned, so it carries no scheme to reject and would resolve against the
 * page's own directory — the one spelling of this mistake that would otherwise sail through every
 * guard and 404 as an image.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
function hostOf(value: string): string {
  const withoutScheme = normalizeUrl(value)
    .replace(/^[a-z][a-z0-9+.-]*:/i, '')
    .replace(/^\/\//, '')
  const end = withoutScheme.search(/[/?#]/)
  const authority = end === -1 ? withoutScheme : withoutScheme.slice(0, end)
  // Userinfo is not the host. `https://user@youtube.com/watch` addresses YouTube, and comparing
  // `user@youtube.com` against the list below would miss it.
  return authority.slice(authority.lastIndexOf('@') + 1).toLowerCase()
}

/**
 * Whether an authored `src` names a video platform's web page instead of a media file.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function isVideoPageUrl(value: string): boolean {
  return VIDEO_PAGE_HOSTS.has(hostOf(value))
}

/**
 * Named focal points, as `object-position` percentage pairs.
 *
 * A `cover` fit crops, and which part it crops away is the whole editorial decision — the classic
 * failure is a portrait cropped through the subject's chin. Percentages rather than the equivalent
 * CSS keywords (`top`, `left top`) because the pair is written into one property from two halves,
 * and `50% 0%` composes where `center top` would need its own keyword-order rules.
 */
const FOCAL_POINTS = {
  center: '50% 50%',
  top: '50% 0%',
  bottom: '50% 100%',
  left: '0% 50%',
  right: '100% 50%',
  'top-left': '0% 0%',
  'top-right': '100% 0%',
  'bottom-left': '0% 100%',
  'bottom-right': '100% 100%',
} as const

export type FocalPoint = keyof typeof FOCAL_POINTS

/** The nine named focal points, in the order the parameter schema declares them. */
export const FOCAL_POINT_NAMES = Object.keys(FOCAL_POINTS) as FocalPoint[]

/**
 * Resolve a focal point name to an `object-position` value.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function focalPosition(focus: string): string {
  return FOCAL_POINTS[focus as FocalPoint] ?? FOCAL_POINTS.center
}

/** How a background clip decides when to run. */
export type AutoplayMode = 'in-view' | 'always' | 'never'

export interface BackgroundMediaOptions {
  /** URL or path to the image or video, already screened by `mediaSource`. */
  src: string
  /** Still shown before a video's first frame; `''` for none. */
  poster: string
  /** `object-fit` for the layer. */
  fit: 'cover' | 'contain'
  /** `object-position` for the layer, already resolved from a named focal point. */
  position: string
  /** Scrim colour painted over the media and under the author's children. */
  overlay: string
  /** Scrim opacity, `0`–`1`. */
  overlayOpacity: number
  /** When a clip plays. Ignored for an image. */
  autoplay: AutoplayMode
  /** `playbackRate` for a clip. Ignored for an image. */
  rate: number
  /** Whether a clip restarts when it ends. Ignored for an image. */
  loop: boolean
  /** Suppresses autoplay, leaving the poster frame standing. */
  reducedMotion: boolean
}

export interface BackgroundLayer {
  /** Stop observing and delete every node this effect added, leaving the author's own as written. */
  remove: Cleanup
}

/**
 * Whether a scrim colour is actually asking for a scrim.
 *
 * `transparent` is the default so that the parameter stays a real `type: 'color'` — validated by
 * the same screen every other colour goes through — rather than an empty string that no colour
 * grammar accepts. It also happens to be the honest spelling of "no scrim", so an author who
 * writes it explicitly gets exactly what the default gives them.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function paintsOverlay(options: BackgroundMediaOptions): boolean {
  return options.overlay !== 'transparent' && options.overlayOpacity > 0
}

/**
 * Whether an authored `src` names a video rather than an image.
 *
 * @param src - Author-supplied path, already accepted as same-origin.
 * @returns `true` when the path's final extension is a known video container.
 * @complexity O(n) time in path length; O(1) space.
 * @overallScore 100
 */
export function isVideoSource(src: string): boolean {
  // A query string or fragment is not part of the filename, and `/clip.mp4?v=2` is still a video.
  const path = src.split('?')[0]!.split('#')[0]!
  const dot = path.lastIndexOf('.')
  // `<=` and not `<`: a dot inside a *directory* name (`/v1.2/clip`) is not this file's extension,
  // and a path ending in `/.` has no extension at all.
  if (dot <= path.lastIndexOf('/')) return false
  return VIDEO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

/**
 * Schemes a background may be fetched over.
 *
 * Everything else is refused — `javascript:` above all, but also `data:`, `file:` and `blob:`,
 * none of which an author writes by hand in markup and any of which is a signal that the value
 * came from somewhere other than the person who wrote the page.
 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https'])

/**
 * The URL scheme an authored value carries, or `''` for a relative or protocol-relative path.
 *
 * Read off `normalizeUrl`, not the raw string: an anchored match on the raw string is walked around
 * by any leading space or embedded control character, and the value it then calls scheme-less is
 * one the browser still resolves as `javascript:`.
 */
function schemeOf(value: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalizeUrl(value))
  return match ? match[1]!.toLowerCase() : ''
}

/**
 * Screen an authored media URL before it can reach `src`/`poster`.
 *
 * **Cross-origin URLs are allowed here, unlike `media-scrub`'s frame pattern, and that is a
 * deliberate divergence rather than an oversight.** `isSameOriginPath` (`core/params.ts`) refuses
 * every absolute URL on the grounds that `data-kui` is not always written by the site owner — a CMS
 * field, a comment — so an unconstrained `src` turns the visitor's browser into an
 * attacker-directed request tool. That reasoning still stands, and it is why the scheme allowlist
 * above is kept tight.
 *
 * It is not the right trade for *this* parameter, though. A background is the one media case where
 * the file routinely does not live on the page's own origin — an S3 bucket, a CDN, an asset host —
 * and `media-scrub`'s `src:` is materially more dangerous than this one for a second reason: it is
 * a `{i}` *template* that fires one request per frame, so a two-hundred-frame sequence is a
 * two-hundred-request channel where this is a single fixed fetch. A site that does accept untrusted
 * `data-kui` should set a `Content-Security-Policy` with `img-src`/`media-src`, which is the
 * control actually designed for this and the one thing a library cannot do on the consumer's
 * behalf.
 *
 * @param authored - Author-supplied value; `''` when none was written.
 * @param name - Parameter name, for the diagnostic.
 * @returns The URL, or `''` when it was rejected or absent.
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function mediaSource(authored: string, name: string, ctx: PrepareContext): string {
  if (!authored) return authored
  /*
   * Checked first, because it is a different mistake with a different fix. A YouTube link *looks*
   * like a perfectly good absolute URL and passes every other check here — it just is not a file.
   */
  if (isVideoPageUrl(authored)) {
    ctx.warn(
      `background-media "${name}": "${authored}" is a video *page*, not a media file — a YouTube ` +
        `URL cannot be played by <video> and needs an iframe embed instead. Point "${name}" at an ` +
        `.mp4/.webm file, or use a YouTube facade alongside this effect.`,
    )
    return ''
  }

  const scheme = schemeOf(authored)
  if (!scheme || ALLOWED_SCHEMES.has(scheme)) return authored
  ctx.warn(
    `background-media "${name}": "${scheme}:" URLs are not allowed — use https:, http:, or a ` +
      `path such as "/media/hero.mp4".`,
  )
  return ''
}

/**
 * Size the layer to its host and put it behind every one of the host's own children.
 *
 * `z-index: -1` is load-bearing and `0` does not work. Inside a stacking context the paint order
 * is: the context's own background, then negative-z children, then in-flow block backgrounds, then
 * *inline content* — so a positioned layer at `z-index: 0` paints in the later positioned pass,
 * i.e. over the author's text. `-1` is the one value that lands between the host's own background
 * and its children. `isolation: isolate` on the host (see `prepareBackgroundMedia`) is what stops
 * that `-1` from escaping to sit behind an ancestor's background instead.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function styleLayer(node: HTMLElement): void {
  const { style } = node
  style.setProperty('position', 'absolute')
  style.setProperty('top', '0')
  style.setProperty('left', '0')
  style.setProperty('width', '100%')
  style.setProperty('height', '100%')
  // A rounded card would otherwise show square media corners poking past its own radius. Cheaper
  // and far less invasive than claiming `overflow: hidden` on the host, which would clip the
  // author's own children and break any sticky descendant.
  style.setProperty('border-radius', 'inherit')
  style.setProperty('pointer-events', 'none')
  style.setProperty('z-index', '-1')
}

/**
 * Build the scrim that makes text legible over busy footage.
 *
 * A second node rather than a `box-shadow: inset` or a filter on the media itself, because it has
 * to sit *between* the media and the author's children: darkening the media alone cannot do that,
 * and darkening the host would darken the text too. Both layers carry `z-index: -1`, so among
 * themselves source order decides — the scrim is appended after the media and therefore paints over
 * it, while both stay under every child.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function createOverlay(doc: Document, options: BackgroundMediaOptions): HTMLElement {
  const scrim = doc.createElement('div')
  styleLayer(scrim)
  scrim.style.setProperty('background', options.overlay)
  scrim.style.setProperty('opacity', String(options.overlayOpacity))
  scrim.setAttribute('aria-hidden', 'true')
  return scrim
}

/**
 * Build the `<video>` a background clip needs, with the four attributes that are not optional.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function createVideo(doc: Document, options: BackgroundMediaOptions): HTMLVideoElement {
  const video = doc.createElement('video')
  // Property *and* attribute. Safari decides whether an inline video may play without a user
  // gesture by reading the markup attributes, so setting only the properties yields a video that
  // plays everywhere except iOS — the platform where a surprise unmuted background clip is worst.
  video.muted = true
  video.setAttribute('muted', '')
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.loop = options.loop
  /*
   * `defaultPlaybackRate` as well as `playbackRate`, and this pair is not belt-and-braces.
   *
   * The media load algorithm — which the `src` assignment below triggers — sets `playbackRate`
   * back to `defaultPlaybackRate`. Setting only `playbackRate` here is therefore dead: measured in
   * Chrome, a clip authored `rate:0.5` read back `1`, because the assignment happened and was then
   * discarded by the load it preceded. Setting the default is what makes the load resolve to the
   * authored rate instead of to `1`, on this load and on any later re-load, with no event listener
   * to install or leak.
   */
  video.defaultPlaybackRate = options.rate
  video.playbackRate = options.rate
  // No `autoplay`: `startPlayback` below owns starting it, and the attribute would start a
  // still-offscreen clip decoding before the observer ever got to say no.
  video.preload = 'metadata'
  if (options.poster) video.poster = options.poster
  video.src = options.src
  return video
}

/** Start a clip immediately, swallowing the rejection an interrupted load produces. */
function play(video: HTMLVideoElement): void {
  const started = video.play()
  if (started) void started.catch(() => {})
}

/**
 * Apply the authored playback policy to a clip.
 *
 * `autoplay:` is the opt-out the three real cases need. `in-view` (default) pairs the clip with the
 * viewport. `always` is for a short hero clip that must never be caught mid-stall by a visibility
 * heuristic. `never` installs the clip and leaves it on its poster, which is also what any mode
 * degrades to under a reduced-motion preference.
 *
 * @returns A teardown that stops any observer and leaves the clip paused.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function startPlayback(
  video: HTMLVideoElement,
  win: Window,
  options: BackgroundMediaOptions,
): Cleanup {
  // Under reduced motion the clip is installed but never started, so the poster stands in for it.
  // Refusing to install at all — which is what `reducedMotion: 'disable'` on the primitive would
  // do — would leave the element with no backdrop whatsoever, which is a broken page rather than
  // a calmer one.
  if (options.reducedMotion || options.autoplay === 'never') return () => {}
  if (options.autoplay === 'always') {
    play(video)
    return () => {
      if (!video.paused) video.pause()
    }
  }
  return autoplayInView(video, win)
}

function createImage(doc: Document, options: BackgroundMediaOptions): HTMLImageElement {
  const image = doc.createElement('img')
  // Decorative by construction. An image that carries meaning belongs in the author's own markup,
  // where they control its `alt`; this one sits behind their text and has nothing to announce.
  image.alt = ''
  image.decoding = 'async'
  image.src = options.src
  return image
}

/**
 * Play a background clip while any part of it is on screen, and pause it the rest of the time.
 *
 * This is the primitive's own observer rather than the animator's `on:enter` gate, because the two
 * answer different questions: `on:enter` fires once and stays fired, which is right for a reveal
 * and wrong for a clip that should stop costing decode budget the moment it scrolls away.
 *
 * `threshold: 0` — any intersection at all — rather than the `0.25` a card-sized video wants.
 * `intersectionRatio` is measured against the *target*, and this target is usually a full section:
 * one taller than four viewports can never reach a ratio of 0.25 no matter where it is scrolled,
 * so a fractional threshold is a clip that silently never plays.
 *
 * @returns A teardown that disconnects the observer and leaves the clip paused.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function autoplayInView(video: HTMLVideoElement, win: Window): Cleanup {
  // Read off the injected window rather than the bare global, the same defensive way
  // `media-shared.ts`'s `watchImageBox` reads `ResizeObserver` — it is not implemented in every
  // test or SSR environment.
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  if (!Observer) return () => {}

  const observer = new Observer(
    (entries) => {
      for (const entry of entries) {
        // A pause arriving mid-load rejects the play promise. That is the normal cost of scrolling
        // quickly past a clip, not an error worth surfacing to the page — see `play`.
        if (entry.isIntersecting) play(video)
        else if (!video.paused) video.pause()
      }
    },
    { threshold: 0 },
  )
  observer.observe(video)

  return () => {
    observer.disconnect()
    if (!video.paused) video.pause()
  }
}

/**
 * Create the backdrop layer and hand back the handle that deletes it again.
 *
 * @param el - The host element, which keeps every child the author wrote.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function installBackgroundMedia(
  el: Element,
  ctx: PrepareContext,
  options: BackgroundMediaOptions,
): BackgroundLayer {
  const doc = el.ownerDocument
  const video = isVideoSource(options.src) ? createVideo(doc, options) : null
  const node: HTMLImageElement | HTMLVideoElement = video ?? createImage(doc, options)
  styleLayer(node)
  node.style.setProperty('object-fit', options.fit)
  node.style.setProperty('object-position', options.position)

  /*
   * Unconditionally decorative, with no parameter to opt out of it. This layer paints at
   * `z-index: -1` behind whatever the author put in the element, so a control bar here would be
   * keyboard-focusable and arbitrarily occluded — a player you can tab into and cannot see. There
   * is no version of that worth shipping, and the alternative already exists: an author who wants
   * a controllable clip writes a content `<video controls>`, which is not this effect.
   */
  node.setAttribute('aria-hidden', 'true')
  // Not a class: nothing styles it. A marker so anyone reading the DOM, or a teardown assertion,
  // can tell the library's layer from a node the page put there itself.
  node.setAttribute('data-kui-background', '')

  // Appended, not prepended, even though "background" reads like "put it first". Source order has
  // no say in paint order against the author's children — `z-index: -1` decides that — so the only
  // thing prepending would change is which of their children answers `:first-child`, and a
  // `> :first-child` margin reset is far more common in real stylesheets than a `:last-child` one.
  el.append(node)

  // Only when one was actually asked for, so the default costs no node at all.
  const overlay = paintsOverlay(options) ? createOverlay(doc, options) : null
  if (overlay) {
    overlay.setAttribute('data-kui-background-overlay', '')
    el.append(overlay)
  }

  const stopPlayback = video ? startPlayback(video, ctx.win, options) : () => {}

  return {
    remove: () => {
      stopPlayback()
      node.remove()
      overlay?.remove()
    },
  }
}
