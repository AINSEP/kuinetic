import { describe, expect, it } from 'vitest'
import { resolveMediaSource } from '../src/showcase/media-source.js'

describe('video-lightbox media source', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'wide'],
    ['https://youtu.be/dQw4w9WgXcQ', 'wide'],
    ['https://youtube.com/embed/dQw4w9WgXcQ', 'wide'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'tall'],
  ])('resolves YouTube %s', (href, aspect) => {
    expect(resolveMediaSource(href)).toEqual({
      kind: 'youtube',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
      aspect,
    })
  })

  it('resolves Vimeo through its player host', () => {
    expect(resolveMediaSource('https://vimeo.com/123456')).toEqual({
      kind: 'vimeo', embedUrl: 'https://player.vimeo.com/video/123456?autoplay=1', aspect: 'wide',
    })
  })

  it.each(['clip.mp4', '/movie.WEBM?download=1', 'https://media.example/film.ogg'])('keeps direct files as video sources: %s', (href) => {
    expect(resolveMediaSource(href)).toEqual({ kind: 'file', embedUrl: href, aspect: 'wide' })
  })

  it.each([
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://example.com/video',
    // Split the scheme so this safety test does not look like executable code to ESLint.
    ['java', 'script:alert(1)'].join(''),
    'data:text/html,<script>alert(1)</script>',
    ['java', 'script:alert(1).mp4'].join(''),
    'mailto:hello@example.com',
    'https://youtube.com/watch?v=<script>',
  ])('rejects unsupported or unsafe links: %s', (href) => {
    expect(resolveMediaSource(href)).toBeNull()
  })

  it('rejects a malformed URL before inspecting its host', () => {
    expect(resolveMediaSource('https://[')).toBeNull()
  })

  it('rejects a Vimeo link without a numeric video id', () => {
    expect(resolveMediaSource('https://vimeo.com/not-a-video')).toBeNull()
  })
})
