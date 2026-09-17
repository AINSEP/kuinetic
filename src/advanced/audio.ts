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
import { createLedgerSet, type LedgerSet } from '../core/owned-styles.js'
import {
  type AdvancedEnv, type AnyWindow, type AnyDocument, type RafFunction, type CafFunction,
  clamp, createEffectInstance, createInertInstance, isReducedMotion, registerInto, resolveEnv,
  styleOf,
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

function findMediaElement(
  el: HTMLElement,
  selector: string,
  win: Window | null,
  doc: Document | null,
): HTMLMediaElement | null {
  const winMediaCtor = (win as { HTMLMediaElement?: typeof HTMLMediaElement })?.HTMLMediaElement ?? Object
  if (el instanceof winMediaCtor) return el as unknown as HTMLMediaElement
  const found = el.querySelector?.(selector) || doc?.querySelector?.(selector)
  return (found as HTMLMediaElement | null) || null
}

function safeDisconnect(node: { disconnect?: () => void } | null): void {
  if (!node || typeof node.disconnect !== 'function') return
  try {
    node.disconnect()
  } catch {
    return
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

  /**
   * The author's inline custom properties, and what this module replaced them with.
   *
   * Not a snapshot taken here: the ledger for `element` is opened at the first write in
   * `updateFrame`, so what it restores is whatever the author had at that instant. The field it
   * replaced captured all five properties in this constructor and restored them on destroy, which
   * meant an author who wrote `--kui-audio-bass` any time after `prepare` had that write silently
   * reverted to a value from before their own.
   */
  private ledgers: LedgerSet

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

  constructor(element: HTMLElement, options: AudioSourceOptions = {}, env: AdvancedEnv = {}) {
    this.element = element
    this.options = options
    this.env = env
    const resolved = resolveEnv(null, env)
    this.window = resolved.window
    this.document = resolved.document
    this.raf = resolved.raf
    this.caf = resolved.caf
    this.ledgers = createLedgerSet(element)
  }

  private connectMicSource(ctx: AudioContext, analyser: AnalyserNode, win: Window | null): void {
    const nav = win?.navigator
    if (!nav?.mediaDevices?.getUserMedia) return
    const token = ++this.micRequestToken
    nav.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (token !== this.micRequestToken || !this.audioCtx || !this.analyser) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      this.stream = stream
      this.sourceNode = ctx.createMediaStreamSource(stream)
      this.sourceNode.connect(analyser)
    }).catch(() => undefined)
  }

  private connectMediaSource(ctx: AudioContext, analyser: AnalyserNode, win: Window | null): void {
    const doc = this.document as Document | null
    const selector = this.options.media || 'audio, video'
    const mediaEl = findMediaElement(this.element, selector, win, doc)
    if (!mediaEl || typeof ctx.createMediaElementSource !== 'function') return
    try {
      this.sourceNode = ctx.createMediaElementSource(mediaEl)
      this.sourceNode.connect(analyser)
      analyser.connect(ctx.destination)
    } catch {
      return
    }
  }

  initAudio(): boolean {
    if (this.audioCtx) return true
    const win = this.window as (Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) | null
    const AudioCtxCtor = win?.AudioContext || win?.webkitAudioContext
    if (!AudioCtxCtor) return false

    try {
      const ctx = new AudioCtxCtor()
      this.audioCtx = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = this.options.fftSize || 256
      analyser.smoothingTimeConstant = this.options.smoothing ?? 0.8
      this.analyser = analyser
      this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

      if (this.options.source === 'mic') {
        this.connectMicSource(ctx, analyser, win as Window | null)
      } else {
        this.connectMediaSource(ctx, analyser, win as Window | null)
      }
      return true
    } catch {
      return false
    }
  }

  start(): void {
    if (this.isActive) return
    this.isActive = true
    this.initAudio()
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume().catch(() => undefined)
    }
    this.startLoop()
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
    style.set('--kui-audio-bass', bands.bass.toFixed(3))
    style.set('--kui-audio-mid', bands.mid.toFixed(3))
    style.set('--kui-audio-treble', bands.treble.toFixed(3))
    style.set('--kui-audio-level', level)
    style.set('--kui-audio', level)
  }

  /**
   * Give everything back: the frame loop, the audio graph, the microphone, the author's styles.
   *
   * This is what `cancel()` and `finish()` reach, and it is deliberately a full release rather
   * than just cancelling rAF. A cancelled `audio-mic` that only stopped its loop left the stream
   * connected and the recording indicator lit until the element was eventually destroyed — the
   * visitor stopped the effect and the microphone stayed on. There is nothing worth keeping warm
   * between a cancel and a later re-activation: `initAudio()` builds a fresh context on the next
   * `start()`, and holding a suspended one open across an indefinite pause is the more expensive
   * of the two mistakes.
   *
   * Idempotent, and safe on a controller that was never started — every step below no-ops on an
   * empty graph and an untouched ledger. It runs unguarded for that reason: the old `isActive`
   * early-return meant a controller cancelled twice, or destroyed without ever activating, skipped
   * the parts that had nothing to do with the loop.
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
    this.disconnectAudioNodes()
    this.ledgers.restore()
  }

  private disconnectAudioNodes(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    safeDisconnect(this.sourceNode)
    this.sourceNode = null
    safeDisconnect(this.analyser)
    this.analyser = null
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => undefined)
      this.audioCtx = null
    }
  }

  /** Nothing survives a `stop()` that a destroy would still need to unwind. */
  destroy(): void {
    this.stop()
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
  const fftSize = clamp(params.num ? params.num('fft', 256) : 256, 32, 2048)

  const controller = new AudioSourceController(
    el as HTMLElement,
    { source, media, smoothing, fftSize },
    resolvedEnv,
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
    supportedActivations: ['load', 'enter', 'click'],
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
