// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { EffectParams } from '../../core/types.js'
import { prepareCameraScene } from '../camera-3d.js'
import { ParticleEmitter } from '../particles.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('camera layers without an authored depth', () => {
  it('sit at depth zero while a layer with z: keeps its own', () => {
    const root = document.createElement('div')
    const flat = document.createElement('div')
    const deep = document.createElement('div')
    flat.setAttribute('data-kui', 'camera-layer')
    deep.setAttribute('data-kui', 'camera-layer z:120')
    root.append(flat, deep)
    document.body.appendChild(root)

    const params = { num: () => 1000, is: () => false, text: () => 'off' } as unknown as EffectParams
    const inst = prepareCameraScene(root, params, createRealPrepareContext(root, { win: null, reducedMotion: true }))

    // The still frame parks the camera at 0, so each layer reads back its authored depth.
    expect(flat.style.transform).toBe('translate3d(0, 0, 0px)')
    expect(deep.style.transform).toBe('translate3d(0, 0, 120px)')
    inst.destroy()
  })
})

describe('particle host positioning', () => {
  it('writes nothing when the window cannot report computed style', () => {
    const host = document.createElement('div')
    const emitter = new ParticleEmitter(host, {}, { window: {} as unknown as Window, document })

    emitter.setupPosition()

    expect(host.style.position).toBe('')
    emitter.destroy()
  })
})
