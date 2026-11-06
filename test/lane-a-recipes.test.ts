// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

// The recipe markup, inline. The demo page it came from is deliberately untracked, so a test must not read it.
const SPIRAL = 'M150 10 C-30 10 -30 290 150 290 C310 290 310 40 150 40 C10 40 10 260 150 260 C270 260 270 70 150 70 C50 70 50 230 150 230 C230 230 230 100 150 100 C90 100 90 200 150 200 C190 200 190 130 150 130'
const labHtml = `
<style>
  .lane-a-cursor-stage { position:relative; padding-block:3rem; text-align:center; }
  @media (prefers-reduced-motion:reduce) { .lane-a-loop[data-kui-rm='shorten'] { animation-iteration-count:1 !important; } }
</style>
<div class="lane-a-cursor-stage" data-kui="cursor-follow over:.lane-a-badge snap:center dot-class:lane-a-photo-cursor">
  AMSTER<span class="lane-a-badge" aria-label="Artwork badge"><svg class="lane-a-loop" viewBox="0 0 120 120" aria-hidden="true" data-kui="tween rotate:360 12s ease:linear repeat:infinite"><defs><path id="lane-a-label-circle" d="M60 10 A50 50 0 1 1 60 110 A50 50 0 1 1 60 10"/></defs><text><textPath href="#lane-a-label-circle">SEE MORE</textPath></text></svg><span class="lane-a-photo-content" style="width:80px;height:80px" data-kui-cursor-content hidden><img class="lane-a-photo" src="./assets/black-cover.jpg" alt=""></span></span>DAM
</div>
<div style="position:relative;width:min(100%,420px);aspect-ratio:1">
  <svg viewBox="0 0 300 300" aria-hidden="true"><path pathLength="100" d="${SPIRAL}" data-kui="draw-stroke 4s ease:linear on:load"/></svg>
  <div style="width:32px;height:32px" data-kui="motion-path path:'${SPIRAL}' viewbox:'0 0 300 300' anchor:center rotate:auto 4s ease:linear on:load"><div style="width:100%;height:100%" data-kui="tween scale:'1,0.2' 4s ease:linear on:load"></div></div>
</div>
<svg class="lane-a-loop" viewBox="0 0 200 200" data-kui="tween rotate:360 10s ease:linear repeat:infinite"></svg>
<svg class="lane-a-loop" viewBox="0 0 200 200" data-kui="tween rotate:360 12s ease:linear repeat:infinite"></svg>
<svg class="lane-a-loop" viewBox="0 0 200 200" data-kui="tween rotate:360 14s ease:linear repeat:infinite"></svg>
`
const lab = new DOMParser().parseFromString(labHtml, 'text/html')

it('normalizes the actual drawn path and puts shrink and tangent rotation on separate elements', () => {
  const traveller = lab.querySelector<HTMLElement>('[data-kui*="viewbox:"]')!
  const path = traveller.parentElement!.querySelector('path')!
  expect(path.getAttribute('pathLength')).toBe('100')
  expect(traveller.getAttribute('data-kui')).toContain('rotate:auto')
  expect(traveller.getAttribute('data-kui')).toContain('anchor:center')
  expect(traveller.getAttribute('data-kui')).not.toContain('scale:')
  expect(traveller.firstElementChild!.getAttribute('data-kui')).toContain("scale:'1,0.2'")
  expect(traveller.style.width).toBe('32px')
  expect(traveller.style.height).toBe('32px')
})

it('gives the actual followed photo a square crop independent of match:rect', () => {
  const stage = lab.querySelector('.lane-a-cursor-stage')!
  const photo = stage.querySelector<HTMLElement>('[data-kui-cursor-content]')!
  expect(stage.getAttribute('data-kui')).not.toContain('match:rect')
  expect(stage.getAttribute('data-kui')).toContain('dot-class:lane-a-photo-cursor')
  expect(photo.style.width).toBe('80px')
  expect(photo.style.height).toBe('80px')
  expect(photo.hasAttribute('hidden')).toBe(true)
  expect(photo.querySelector('img')).not.toBeNull()
})

it('gates all four infinite label/ring rotations to one shortened iteration under reduced motion', () => {
  const loops = [...lab.querySelectorAll('.lane-a-loop')]
  expect(loops).toHaveLength(4)
  expect(loops.every((node) => node.getAttribute('data-kui')!.includes('repeat:infinite'))).toBe(true)
  const css = [...lab.querySelectorAll('style')].map((node) => node.textContent).join('').replace(/\s+/g, '')
  expect(css).toContain("@media(prefers-reduced-motion:reduce){.lane-a-loop[data-kui-rm='shorten']{animation-iteration-count:1!important;}}")
})

it('compiles the corrected curved label and photo-only follower recipe without warnings', () => {
  for (const source of [
    'cursor-follow over:.lane-a-badge snap:center dot-class:lane-a-photo-cursor',
    'tween rotate:360 12s ease:linear repeat:infinite',
    "motion-path path:'M150 10 C-30 10 -30 290 150 290 C310 290 310 40 150 40 C10 40 10 260 150 260 C270 260 270 70 150 70 C50 70 50 230 150 230 C230 230 230 100 150 100 C90 100 90 200 150 200 C190 200 190 130 150 130' viewbox:'0 0 300 300' anchor:center rotate:auto 4s ease:linear on:load",
    "tween scale:'1,0.2' 4s ease:linear on:load",
    'draw-stroke 4s ease:linear on:load',
    'confetti-burst pieces:48 on:click',
    "cursor-trail images:'.lane-a-trail-source' spacing:60px",
    "cursor-trail images:'.lane-a-trail-dense' spacing:35px",
    'cube-rotate parts:cube tumble:true 8s ease:linear repeat:infinite',
    'tween-from opacity:0 600ms on:load',
    'tween-from y:80px opacity:0 800ms 0ms on:load',
    'tween-from y:80px opacity:0 800ms 100ms on:load',
    'tween-from y:80px opacity:0 800ms 200ms on:load',
    'tween-from y:80px opacity:0 800ms 300ms on:load',
    'tween-from y:80px opacity:0 800ms 400ms on:load',
    'cube-rotate parts:cube angle:-20deg 1ms on:load',
    'cube-rotate parts:cube angle:-10deg 1ms on:load',
    'cube-rotate parts:cube angle:0deg 1ms on:load',
    'cube-rotate parts:cube angle:10deg 1ms on:load',
    'cube-rotate parts:cube angle:20deg 1ms on:load',
    'tween rotate:360 10s ease:linear repeat:infinite',
    'tween rotate:360 14s ease:linear repeat:infinite',
  ]) {
    expect(compile(parse(source), catalogRegistry(), 'time').warnings, source).toEqual([])
  }
})
