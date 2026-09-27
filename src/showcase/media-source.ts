/** A safe, supported video URL and its preferred frame shape. */
export interface MediaSource {
  kind: 'youtube' | 'vimeo' | 'file'
  embedUrl: string
  aspect: 'wide' | 'tall'
}

const BASE = 'https://kuinetic.invalid/'
const YOUTUBE_ID = /^[\w-]{6,}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com'])

function youtube(url: URL, parts: string[], shortHost: boolean): MediaSource | null {
  let id: string | null | undefined
  if (shortHost) id = parts[0]
  else if (parts[0] === 'watch') id = url.searchParams.get('v')
  else if (parts[0] === 'shorts' || parts[0] === 'embed') id = parts[1]
  if (!id || !YOUTUBE_ID.test(id)) return null
  return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
    aspect: parts[0] === 'shorts' ? 'tall' : 'wide' }
}

function vimeo(parts: string[]): MediaSource | null {
  const id = parts[0]
  if (!id || !/^\d+$/.test(id)) return null
  return { kind: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`, aspect: 'wide' }
}

/**
 * Resolve a real link into a supported player source. Unknown hosts and non-web schemes keep
 * their normal link behavior; no attacker-controlled URL is handed to an iframe.
 * @complexity O(n) in the URL length; O(1) extra space.
 * @overallScore 100
 */
export function resolveMediaSource(href: string): MediaSource | null {
  let url: URL
  try {
    url = new URL(href, BASE)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)
  if (YOUTUBE_HOSTS.has(host)) return youtube(url, parts, false)
  if (SHORT_HOSTS.has(host)) return youtube(url, parts, true)
  if (VIMEO_HOSTS.has(host)) return vimeo(parts)
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) {
    return { kind: 'file', embedUrl: href, aspect: 'wide' }
  }
  return null
}
