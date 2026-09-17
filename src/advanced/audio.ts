// Created by Gemini 3.8 Flash
/**
 * kUInetic Audio - Web Audio Reactive Source Module
 *
 * Exposes audio frequency bands (bass, mid, treble, overall level)
 * as CSS custom properties on scoped elements:
 * - --kui-audio-bass (0..1)
 * - --kui-audio-mid (0..1)
 * - --kui-audio-treble (0..1)
 * - --kui-audio-level (0..1)
 * - --kui-audio (alias to level)
 *
 * Supports page audio/video elements by default, with opt-in mic streaming.
 */

import type { EffectInstance, EffectParams, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import type { StyleLedger } from '../core/owned-styles.js'
import {
  type AdvancedEnv, type AdvancedLedgers, type AnyWindow, type AnyDocument,
  type RafFunction, type CafFunction,
  clamp, createAdvancedLedgers, createEffectInstance, createInertInstance, isReducedMotion,
  registerInto, resolveEnv, styleOf,
} from './base.js'

/** The host custom properties this module owns. Also the primitive's declared channels. */
export const AUDIO_CHANNELS = [
  '--kui-audio-bass',
  '--kui-audio-mid',
  '--kui-audio-treble',
  '--kui-audio-level',
  '--kui-audio',
] as const

export interface AudioBands {
  bass: number
  mid: number
  treble: number
  level: number
}

/**
 * The bands a *consumer* can subscribe to, and the custom property each one reads.
 *
 * The same names {@link AUDIO_CHANNELS} declares, minus the `--kui-audio` alias — an alias is a
 * second spelling of `level`, not a fifth band, and offering both as separate choices would make
 * two authored values mean exactly the same thing. `__tests__/audio.test.ts` asserts every
 * property here is one this module actually writes, so the two cannot drift apart.
 */
export const AUDIO_BAND_PROPERTIES = {
  bass: '--kui-audio-bass',
  mid: '--kui-audio-mid',
  treble: '--kui-audio-treble',
  level: '--kui-audio-level',
} as const

export type AudioBand = keyof typeof AUDIO_BAND_PROPERTIES

/** Band names, for a consumer's `keywords` list. */
export const AUDIO_BANDS: readonly AudioBand[] = Object.keys(AUDIO_BAND_PROPERTIES) as AudioBand[]

function parseBandValue(raw: string | null | undefined): number | null {
  if (!raw) return null
  const val = parseFloat(raw)
  return Number.isFinite(val) ? clamp(val, 0, 1) : null
}

/**
 * The band an authored keyword names, or `null` for "no band" — including `off` and any word that
 * is not a band at all.
 *
 * `Object.hasOwn`, not `AUDIO_BANDS.includes`, for the same reason `readParams` uses it: a plain
 * property read answers for `__proto__`/`constructor` too, and would report those as bands whose
 * property is a function.
 */
export function parseAudioBand(raw: string | null | undefined): AudioBand | null {
  if (!raw) return null
  const name = raw.trim()
  return Object.hasOwn(AUDIO_BAND_PROPERTIES, name) ? (name as AudioBand) : null
}

/**
 * One band's current value for this element, as a consumer sees it.
 *
 * Inline first, then computed — the same two-step `shaders.ts`'s `readElementProgress` uses, and
 * for the same reason: `--kui-audio-*` are ordinary unregistered custom properties (nothing in
 * this codebase declares them with `@property`), so they inherit, and an `audio-source` on an
 * *ancestor* is already visible through `getComputedStyle` without this module doing anything
 * special. The inline read is the fast path for the common case — the driver on the element
 * itself, where its own per-frame write lands.
 *
 * `0` when nothing has declared a value, which is also what a silent driver writes: a consumer
 * that reads 0 behaves as if there were no audio, rather than having to distinguish the two.
 *
 * Callers on a shared render loop must read every element before any of them writes style; see
 * `SharedShaderRenderer`'s `inputReaders` pass for why the ordering matters.
 *
 * @complexity O(1) time (one inline read, at most one computed-style read); O(1) space.
 */
export function readAudioBand(el: HTMLElement, band: AudioBand): number {
  const prop = AUDIO_BAND_PROPERTIES[band]
  const fromInline = parseBandValue(el.style?.getPropertyValue?.(prop))
  if (fromInline !== null) return fromInline
  const view = el.ownerDocument?.defaultView
  return parseBandValue(view?.getComputedStyle?.(el).getPropertyValue(prop)) ?? 0
}

export interface AudioSourceOptions {
  source?: 'media' | 'mic'
  media?: string
  fftSize?: number
  smoothing?: number
}

export function computeFrequencyBands(
  data: Uint8Array,
  sampleRate: number,
): AudioBands {
  const binCount = data.length
  if (binCount === 0) return { bass: 0, mid: 0, treble: 0, level: 0 }
  const nyquist = sampleRate > 0 ? sampleRate / 2 : 22050
  const hzPerBin = nyquist / binCount

  const getAverage = (minHz: number, maxHz: number): number => {
    const startBin = Math.max(0, Math.floor(minHz / hzPerBin))
    const endBin = Math.min(binCount, Math.max(startBin + 1, Math.ceil(maxHz / hzPerBin)))
    let sum = 0
    let count = 0
    for (let i = startBin; i < endBin; i++) {
      sum += data[i]!
      count++
    }
    return count > 0 ? sum / (count * 255) : 0
  }

  let totalSum = 0
  for (let i = 0; i < binCount; i++) totalSum += data[i]!
  const level = totalSum / (binCount * 255)

  return {
    bass: clamp(getAverage(20, 250), 0, 1),
    mid: clamp(getAverage(250, 4000), 0, 1),
    treble: clamp(getAverage(4000, 16000), 0, 1),
    level: clamp(level, 0, 1),
  }
}

/** What `media:` searches for when the author named nothing. */
const DEFAULT_MEDIA_SELECTOR = 'audio, video'

/**
 * Whether this element is itself a media element.
 *
 * The constructor comes off the injected window so a cross-document element answers correctly. The
 * `?? Object` this replaced made the check true for *every* element, so any window without an
 * `HTMLMediaElement` — which is every test double in this directory — treated a plain `<div>` as
 * its own media source and then handed it to `createMediaElementSource`.
 */
function isMediaElement(el: Element, win: Window | null): boolean {
  const injected = (win as { HTMLMediaElement?: typeof HTMLMediaElement } | null)?.HTMLMediaElement
  const ctor = injected ?? (typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement : null)
  return ctor ? el instanceof ctor : false
}

/**
 * The media element this effect reads, or `null` when there is none to read.
 *
 * @param el - The authored element.
 * @param authored - The author's `media:` selector, or `null` when they wrote none.
 * @complexity O(n) in the subtree searched.
 */
function findMediaElement(
  el: HTMLElement,
  authored: string | null,
  win: Window | null,
  doc: Document | null,
): HTMLMediaElement | null {
  if (isMediaElement(el, win)) return el as unknown as HTMLMediaElement
  const local = el.querySelector?.(authored ?? DEFAULT_MEDIA_SELECTOR)
  if (local) return local as unknown as HTMLMediaElement
  // Only an author who actually named a selector reaches outside their own subtree. On the
  // default, an element containing no media used to bind to the first media element *anywhere in
  // the document* — a hero card silently reacting to a footer video.
  if (!authored) return null
  return (doc?.querySelector?.(authored) as HTMLMediaElement | null) || null
}

function safeDisconnect(node: { disconnect?: () => void } | null): void {
  if (!node || typeof node.disconnect !== 'function') return
  try {
    node.disconnect()
  } catch {
    return
  }
}

/**
 * Cut one edge and leave the node's other outputs alone.
 *
 * The distinction matters for exactly one node — see {@link mediaSourceFor}. A shared media source
 * also feeds the speakers, so the bare `disconnect()` above would mute the page.
 */
function safeDisconnectFrom(
  node: { disconnect?: (destination?: AudioNode) => void } | null,
  destination: AudioNode | null,
): void {
  if (!node || typeof node.disconnect !== 'function' || !destination) return
  try {
    node.disconnect(destination)
  } catch {
    return
  }
}

/** Legal `AnalyserNode.fftSize` values inside this parameter's declared range. */
const FFT_SIZES = [32, 64, 128, 256, 512, 1024, 2048] as const

/**
 * The nearest legal `fftSize`.
 *
 * `AnalyserNode.fftSize` must be a power of two and throws `IndexSizeError` for anything else. The
 * parameter schema bounds the range but `clamp` cannot snap, so an authored `fft:300` threw inside
 * initialisation, left an open `AudioContext` with no analyser behind it, and then wrote `0.000`
 * for all five properties every frame — a silent dead effect with a running audio thread.
 */
export function snapFftSize(requested: number): number {
  let best: number = FFT_SIZES[0]
  for (const size of FFT_SIZES) {
    if (Math.abs(size - requested) < Math.abs(best - requested)) best = size
  }
  return best
}

/** The gestures a suspended context is allowed to wake on. */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const

type AudioWindow = (Window & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}) | null

/**
 * One `AudioContext` per window, and the media sources living inside it.
 *
 * Two irreversible facts about the Web Audio API drive this whole shape:
 *
 * 1. `createMediaElementSource(el)` re-routes that element's output into the context **for the
 *    lifetime of the element**, and it cannot be undone. From that moment the page's own
 *    `<video>` is only audible because something in the graph carries it to the destination.
 * 2. It may be called **once per element, ever**. A second call throws `InvalidStateError`.
 *
 * Together they mean the previous design — a context per instance, closed on `cancel()` — silenced
 * the visitor's video permanently the first time an `on:enter` effect deactivated, and could never
 * recover: re-activation's second `createMediaElementSource` threw, the throw was swallowed, and
 * the effect wrote `0.000` forever. Two `audio-source` effects on one video hit the same wall.
 *
 * So the ownership rule is:
 *
 * - **Per window (shared, ref-counted):** the `AudioContext`, one
 *   `MediaElementAudioSourceNode` per media element, and a muted sink. Once a media source exists
 *   this context is never closed and never suspended, because doing either silences the page.
 * - **Per instance:** the `AnalyserNode`, its byte buffer, the frame loop and the style writes.
 *   `cancel()` gives all four back; the media element's own path to the speakers is untouched, and
 *   a later `activate()` just builds a new analyser onto the source that is already there.
 * - **Per instance, never shared:** a microphone's `MediaStream` and its source node. Those are
 *   fully released on `cancel()`/`destroy()` — tracks stopped, node disconnected — and a graph
 *   that only ever carried a microphone *is* closed when its last consumer leaves, since nothing
 *   of the page's own audio runs through it.
 */
interface SharedAudioGraph {
  ctx: AudioContext
  /** The one source node each media element will ever have. */
  sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>
  /** A gain-0 path to the destination. See {@link createMutedSink}. */
  sink: AudioNode | null
  /** Instances still holding this graph. */
  consumers: number
  /** Whether some media element's only path to the speakers now runs through this context. */
  ownsMediaOutput: boolean
}

const sharedGraphs = new WeakMap<object, SharedAudioGraph>()

/**
 * A silent path from an analyser to the destination.
 *
 * An `AnalyserNode` left as a dead end is not guaranteed to receive anything: the spec only
 * processes a node that reaches an `AudioDestinationNode`, and WebKit holds to that — which is
 * this repo's main audience. Chaining every analyser through one gain-0 node gives each of them a
 * live path without any of them being heard, and without the input arriving at the speakers twice.
 */
function createMutedSink(ctx: AudioContext): AudioNode | null {
  if (typeof ctx.createGain !== 'function') return null
  try {
    const gain = ctx.createGain()
    if (gain.gain) gain.gain.value = 0
    gain.connect(ctx.destination)
    return gain
  } catch {
    return null
  }
}

/**
 * This window's graph, building it on the first ask.
 *
 * Keyed on the window rather than the document because the `AudioContext` constructor is a
 * property of the window, and a test double supplies one without supplying a matching document.
 *
 * @returns The graph with this caller counted, or `null` when the environment has no Web Audio.
 * @complexity O(1).
 */
function acquireSharedGraph(win: AudioWindow): SharedAudioGraph | null {
  if (!win) return null
  const existing = sharedGraphs.get(win)
  if (existing) {
    existing.consumers++
    return existing
  }
  const AudioCtxCtor = win.AudioContext || win.webkitAudioContext
  if (!AudioCtxCtor) return null
  try {
    const ctx = new AudioCtxCtor()
    const graph: SharedAudioGraph = {
      ctx,
      sources: new WeakMap(),
      sink: createMutedSink(ctx),
      consumers: 1,
      ownsMediaOutput: false,
    }
    sharedGraphs.set(win, graph)
    return graph
  } catch {
    return null
  }
}

/**
 * Drop one consumer, closing the context only when nothing of the page's own audio depends on it.
 *
 * @complexity O(1).
 */
function releaseSharedGraph(win: AudioWindow): void {
  if (!win) return
  const graph = sharedGraphs.get(win)
  if (!graph) return
  graph.consumers--
  if (graph.consumers > 0 || graph.ownsMediaOutput) return
  sharedGraphs.delete(win)
  const closing = graph.ctx.close?.()
  if (closing) closing.catch(() => undefined)
}

/**
 * This media element's source node, created once and reused forever after.
 *
 * The `connect(destination)` here is the line that keeps the page audible, and it is deliberately
 * never undone: the element has no other route to the speakers from the moment the node exists.
 *
 * @complexity O(1).
 */
function mediaSourceFor(
  graph: SharedAudioGraph,
  mediaEl: HTMLMediaElement,
): MediaElementAudioSourceNode | null {
  const existing = graph.sources.get(mediaEl)
  if (existing) return existing
  if (typeof graph.ctx.createMediaElementSource !== 'function') return null
  try {
    const source = graph.ctx.createMediaElementSource(mediaEl)
    source.connect(graph.ctx.destination)
    graph.sources.set(mediaEl, source)
    graph.ownsMediaOutput = true
    return source
  } catch {
    return null
  }
}

export class AudioSourceController {
  element: HTMLElement
  options: AudioSourceOptions
  env: AdvancedEnv
  window: AnyWindow
  document: AnyDocument
  raf: RafFunction
  caf: CafFunction

  audioCtx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  sourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null
  stream: MediaStream | null = null
  freqData: Uint8Array<ArrayBuffer> | null = null
  rafId: number | null = null
  isActive = false

  /** The window-wide graph this instance is currently counted against. */
  private graph: SharedAudioGraph | null = null
  /**
   * Whether `sourceNode` belongs to the shared graph rather than to this instance.
   *
   * True for `source: media` — the node feeds the page's speakers as well as this analyser, so
   * teardown may only cut its edge to *this* analyser. False for `source: mic`, where the node and
   * its stream are this instance's alone and must be released in full.
   */
  private sourceIsShared = false

  /**
   * The author's inline custom properties, and what this module replaced them with.
   *
   * Not a snapshot taken here: the ledger for `element` is opened at the first write in
   * `updateFrame`, so what it restores is whatever the author had at that instant. The field it
   * replaced captured all five properties in this constructor and restored them on destroy, which
   * meant an author who wrote `--kui-audio-bass` any time after `prepare` had that write silently
   * reverted to a value from before their own.
   *
   * Shared with every other controller writing to this element — see `createAdvancedLedgers`. Two
   * `audio-source` effects on one element (`audio-reactive` plus `audio-mic`, say) would otherwise
   * open a ledger each, and the second would capture the first's `0.000` as the author's value.
   */
  private ledgers: AdvancedLedgers

  /**
   * Which microphone request is the live one.
   *
   * `getUserMedia` cannot be cancelled — the permission prompt belongs to the browser, and the
   * promise settles whenever the visitor answers it. Every `stop()` bumps this, so a request the
   * visitor grants *after* the effect was cancelled resolves into a handler that no longer
   * recognises its own generation and stops the tracks instead of connecting them. Without it,
   * cancelling while the prompt is open and then granting leaves the microphone recording until
   * the element is eventually destroyed.
   */
  private micRequestToken = 0

  /** Detaches the one-shot gesture listeners armed by {@link armGestureResume}. */
  private releaseGestureResume: (() => void) | null = null

  constructor(
    element: HTMLElement,
    options: AudioSourceOptions = {},
    env: AdvancedEnv = {},
    hostLedger?: StyleLedger | null,
  ) {
    this.element = element
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.document = resolved.document
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.ledgers = createAdvancedLedgers(element, hostLedger)
  }

  private connectMicSource(graph: SharedAudioGraph, analyser: AnalyserNode, win: Window | null): void {
    const nav = win?.navigator
    if (!nav?.mediaDevices?.getUserMedia) return
    const token = ++this.micRequestToken
    nav.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      // `this.analyser !== analyser`, not merely "is there an analyser": a cancel followed by a
      // re-activation leaves a *different* analyser in place, and connecting a stream the visitor
      // granted for the previous generation to it would leak this one's tracks.
      if (token !== this.micRequestToken || this.analyser !== analyser) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      this.stream = stream
      this.sourceNode = graph.ctx.createMediaStreamSource(stream)
      this.sourceIsShared = false
      this.sourceNode.connect(analyser)
    }).catch(() => undefined)
  }

  private connectMediaSource(graph: SharedAudioGraph, analyser: AnalyserNode, win: Window | null): void {
    const doc = this.document as Document | null
    try {
      const mediaEl = findMediaElement(this.element, this.options.media || null, win, doc)
      if (!mediaEl) return
      const source = mediaSourceFor(graph, mediaEl)
      if (!source) return
      source.connect(analyser)
      this.sourceNode = source
      this.sourceIsShared = true
    } catch {
      return
    }
  }

  /**
   * This instance's analyser, already on a live path to the destination.
   *
   * @returns The analyser, or `null` when the context refused to build one.
   */
  private buildAnalyser(graph: SharedAudioGraph): AnalyserNode | null {
    try {
      const analyser = graph.ctx.createAnalyser()
      analyser.fftSize = snapFftSize(this.options.fftSize || 256)
      analyser.smoothingTimeConstant = this.options.smoothing ?? 0.8
      if (graph.sink) analyser.connect(graph.sink)
      return analyser
    } catch {
      return null
    }
  }

  /**
   * Join the window's audio graph and give this instance an analyser on it.
   *
   * `this.analyser`, not `this.audioCtx`, is the "already initialised" test, and nothing is
   * recorded on `this` until the analyser exists. Assigning the context first is what left a
   * half-built instance behind — an open context, no analyser, and a loop writing zeros — whenever
   * `createAnalyser` or `fftSize` threw.
   */
  initAudio(): boolean {
    if (this.analyser) return true
    const win = this.window as AudioWindow
    const graph = acquireSharedGraph(win)
    if (!graph) return false
    const analyser = this.buildAnalyser(graph)
    if (!analyser) {
      releaseSharedGraph(win)
      return false
    }
    this.graph = graph
    this.audioCtx = graph.ctx
    this.analyser = analyser
    this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    if (this.options.source === 'mic') this.connectMicSource(graph, analyser, win)
    else this.connectMediaSource(graph, analyser, win)
    return true
  }

  start(): void {
    if (this.isActive) return
    this.isActive = true
    this.initAudio()
    this.resumeContext()
    this.startLoop()
  }

  /**
   * Wake a context the browser suspended for autoplay policy.
   *
   * `defaultActivation` is `'load'`, so the context is very often constructed before the visitor
   * has touched anything, and a context built outside a user gesture starts `suspended`. A bare
   * `resume()` there is rejected or left pending — WebKit is strict about it, and iOS is this
   * repo's main audience — after which `getByteFrequencyData` fills zeros and all five properties
   * sit at `0.000` for the rest of the session. `on:click` only worked by luck, because it happens
   * to run inside a gesture.
   *
   * So: try immediately, and arm a one-shot retry on the visitor's first gesture. The `on:click`
   * path still succeeds on the first attempt and the listeners are never needed.
   */
  private resumeContext(): void {
    const ctx = this.audioCtx
    if (!ctx || ctx.state !== 'suspended') return
    ctx.resume().catch(() => undefined)
    this.armGestureResume()
  }

  private armGestureResume(): void {
    const win = this.window
    if (this.releaseGestureResume || !win?.addEventListener || !win.removeEventListener) return
    const onGesture = (): void => {
      this.releaseGestureResume?.()
      this.audioCtx?.resume().catch(() => undefined)
    }
    this.releaseGestureResume = () => {
      this.releaseGestureResume = null
      for (const type of GESTURE_EVENTS) win.removeEventListener?.(type, onGesture)
    }
    for (const type of GESTURE_EVENTS) win.addEventListener(type, onGesture, { passive: true })
  }

  startLoop(): void {
    if (this.rafId) return
    const tick = () => {
      this.updateFrame()
      if (this.isActive) {
        this.rafId = this.raf(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = this.raf(tick)
  }

  updateFrame(): void {
    const style = styleOf(this.ledgers, this.element)
    if (!style) return
    let bands: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0 }
    if (this.analyser && this.freqData && this.audioCtx) {
      this.analyser.getByteFrequencyData(this.freqData)
      bands = computeFrequencyBands(this.freqData, this.audioCtx.sampleRate)
    }

    const level = bands.level.toFixed(3)
    this.writeChannel(style, '--kui-audio-bass', bands.bass.toFixed(3))
    this.writeChannel(style, '--kui-audio-mid', bands.mid.toFixed(3))
    this.writeChannel(style, '--kui-audio-treble', bands.treble.toFixed(3))
    this.writeChannel(style, '--kui-audio-level', level)
    this.writeChannel(style, '--kui-audio', level)
  }

  /**
   * One channel, written only when it would actually change anything.
   *
   * These are unregistered custom properties, so they inherit: five unconditional `setProperty`
   * calls per frame per instance dirty the whole subtree's style 60 times a second even on a page
   * whose audio is silent or whose context never resumed, where all five values are the identical
   * `0.000`.
   *
   * The comparison reads the live inline value rather than a remembered one on purpose. A cache
   * would go stale the moment the author wrote the property themselves — this module would agree
   * with its own record, skip the write, and look dead. Reading the CSSOM's own map is a lookup,
   * not a style resolution, so it costs nothing a `setProperty` would not already cost.
   *
   * `claim()` first and unconditionally, because the very first frame can legitimately skip its
   * write (the author happened to have written the same string), and the ledger still has to have
   * captured what was there to restore it.
   *
   * @complexity O(1).
   */
  private writeChannel(style: StyleLedger, property: string, value: string): void {
    style.claim(property)
    if (this.element.style.getPropertyValue(property) === value) return
    style.set(property, value)
  }

  /**
   * Give back everything this instance owns: the frame loop, its analyser, the microphone.
   *
   * This is what `cancel()` and `finish()` reach, and it is deliberately a full release of the
   * *instance's* half of the graph. A cancelled `audio-mic` that only stopped its loop left the
   * stream connected and the recording indicator lit until the element was eventually destroyed —
   * the visitor stopped the effect and the microphone stayed on.
   *
   * What it deliberately does **not** do is touch the page's own audio or the author's styles.
   * The shared media source keeps its edge to the destination (see {@link SharedAudioGraph}), and
   * the ledger is left as it is because `EffectInstance.cancel` means "stop where it is, leaving
   * the element mid-effect" — unwinding the five custom properties here would snap every rule
   * reading `var(--kui-audio-bass, 0)` back to its fallback on a pause, which is not what the
   * other five modules in this directory do. `destroy()` is where the styles go back.
   *
   * Idempotent, and safe on a controller that was never started — every step below no-ops on an
   * empty graph. It runs unguarded for that reason: the old `isActive` early-return meant a
   * controller cancelled twice, or destroyed without ever activating, skipped the parts that had
   * nothing to do with the loop.
   */
  stop(): void {
    this.isActive = false
    // Before the graph is torn down, so a request granted during teardown finds a token that has
    // already moved on rather than a context that is merely about to disappear.
    this.micRequestToken++
    if (this.rafId) {
      this.caf(this.rafId)
      this.rafId = null
    }
    this.releaseGestureResume?.()
    this.disconnectAudioNodes()
  }

  private disconnectAudioNodes(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    const analyser = this.analyser
    if (this.sourceIsShared) safeDisconnectFrom(this.sourceNode, analyser)
    else safeDisconnect(this.sourceNode)
    this.sourceNode = null
    this.sourceIsShared = false
    safeDisconnect(analyser)
    this.analyser = null
    this.freqData = null
    this.audioCtx = null
    if (this.graph) {
      releaseSharedGraph(this.window as AudioWindow)
      this.graph = null
    }
  }

  /**
   * Everything `stop()` gives back, plus the author's inline styles.
   *
   * `try`/`finally` because the restore must not be hostage to the graph teardown: the animator
   * swallows a throwing `instance.destroy()` (`runQuietly`), and an element this module reached on
   * its own — a `camera-layer`, a `scene-step` — is in no ledger the animator will ever restore.
   * A single throw on the way out would otherwise leave the library's values on it permanently.
   */
  destroy(): void {
    try {
      this.stop()
    } finally {
      this.ledgers.restore()
    }
  }
}

export function prepareAudioSource(
  el: Element,
  params: EffectParams,
  ctx?: PrepareContext | null,
): EffectInstance {
  if (isReducedMotion(ctx)) return createInertInstance()

  const resolvedEnv = resolveEnv(ctx)
  const rawSource = params.text ? params.text('source', 'media') : 'media'
  const source = rawSource === 'mic' ? 'mic' : 'media'
  const media = params.text ? params.text('media', '') : ''
  const smoothing = clamp(params.num ? params.num('smoothing', 0.8) : 0.8, 0, 0.99)
  const fftSize = snapFftSize(clamp(params.num ? params.num('fft', 256) : 256, 32, 2048))

  // `ctx.style` is this element's entry in the animator's own `LedgerSet`; see `camera-3d.ts`.
  const controller = new AudioSourceController(
    el as HTMLElement,
    { source, media, smoothing, fftSize },
    resolvedEnv,
    ctx?.style,
  )

  return createEffectInstance({
    continuous: true,
    activate() { controller.start() },
    cancel() { controller.stop() },
    finish() { controller.stop() },
    destroy() { controller.destroy() },
  })
}

export const AUDIO_PARAMETERS = {
  source: { type: 'keyword' as const, default: 'media', keywords: ['media', 'mic'], cssProperty: '--kui-audio-source' },
  media: { type: 'text' as const, default: '', cssProperty: '--kui-audio-media' },
  smoothing: { type: 'number' as const, default: '0.8', minimum: 0, maximum: 0.99, cssProperty: '--kui-audio-smoothing' },
  fft: { type: 'number' as const, default: '256', minimum: 32, maximum: 2048, cssProperty: '--kui-audio-fft' },
}

export const AUDIO_PRIMITIVES: Primitive[] = [
  {
    id: 'audio-source',
    renderer: 'javascript',
    // The five custom properties `updateFrame` writes, named exactly. `[]` said this primitive
    // touched nothing, so the registry's conflict detection could not see a second source writing
    // the same variables and let the two race, last frame wins.
    channels: [...AUDIO_CHANNELS],
    parameters: AUDIO_PARAMETERS,
    supportedTimelines: ['time'],
    // `manual` alongside the existing three (same additive shape as `interaction-proximity.ts`
    // and `interaction.ts`): `on:load` (the default) leaves `resumeContext`'s one-shot
    // page-gesture listener as the fallback, but an author who wants the AudioContext to wake on
    // one specific, deliberate gesture — a "start visualiser" button, not the visitor's next
    // incidental tap anywhere on the page — can now write `on:manual` and call `.play()` from
    // that button's own handler, which still lands inside the same user gesture the browser
    // requires.
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare: prepareAudioSource,
  },
]

export const AUDIO_PRESETS: Preset[] = [
  { name: 'audio-source', primitive: 'audio-source' },
  { name: 'audio-reactive', primitive: 'audio-source' },
  { name: 'audio-mic', primitive: 'audio-source', params: { source: 'mic' } },
]

export function registerAudio(target: unknown): Registry | Animator {
  return registerInto(target, AUDIO_PRIMITIVES[0]!, AUDIO_PRESETS, 'AudioSource')
}
