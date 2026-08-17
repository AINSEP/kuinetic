/**
 * Local showcase server.
 *
 * Serves `demo/` at the site root, so `http://localhost:8934/` opens the showcase directly
 * instead of being nested under `/demo/`. `docs/*.md` is mapped in separately from the repo-level
 * `docs/` folder, since `demo/docs.html` fetches catalog/design docs from there and they
 * live outside `demo/`.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import { spawn } from 'node:child_process'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT ?? 8934
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEMO_ROOT = join(ROOT, 'demo')
const DOCS_ROOT = join(ROOT, 'docs')

// Start build watchers in dev mode
if (process.env.NODE_ENV !== 'production') {
  console.log('Starting build watchers...')
  const spawnOpts = { stdio: 'inherit', cwd: ROOT, shell: true }
  spawn('npx', ['esbuild', 'src/index.ts', '--bundle', '--format=iife', '--global-name=kuinetic', '--outfile=demo/kuinetic.js', '--watch=forever'], spawnOpts)
  spawn('npx', ['esbuild', 'src/css/index.css', '--bundle', '--outfile=demo/kuinetic.css', '--watch=forever'], spawnOpts)
  spawn('npx', ['@tailwindcss/cli', '-i', 'demo/tailwind-entry.css', '-o', 'demo/tailwind.css', '--watch'], spawnOpts)
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

/** Resolves a URL path to a file under `base`, refusing to escape it via `..` traversal. */
function resolveWithin(base, urlPath) {
  const resolved = normalize(join(base, decodeURIComponent(urlPath)))
  if (resolved !== base && !resolved.startsWith(base + sep)) return null
  return resolved
}

async function resolveFile(pathname) {
  const base = pathname.startsWith('/docs/') ? DOCS_ROOT : DEMO_ROOT
  const relative = pathname.startsWith('/docs/') ? pathname.slice('/docs'.length) : pathname

  let target = resolveWithin(base, relative)
  if (!target) return null

  if (target.endsWith(sep) || target === base) target = join(target, 'index.html')

  try {
    const stats = await stat(target)
    if (stats.isDirectory()) target = join(target, 'index.html')
    return target
  } catch {
    return null
  }
}

let clients = []
let reloadTimeout = null
function triggerReload() {
  if (reloadTimeout) clearTimeout(reloadTimeout)
  reloadTimeout = setTimeout(() => {
    clients.forEach(res => res.write('data: reload\n\n'))
  }, 100)
}

if (process.env.NODE_ENV !== 'production') {
  watch(DEMO_ROOT, { recursive: true }, triggerReload)
  watch(DOCS_ROOT, { recursive: true }, triggerReload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  
  if (url.pathname === '/livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    clients.push(res)
    req.on('close', () => {
      clients = clients.filter(c => c !== res)
    })
    return
  }

  const file = await resolveFile(url.pathname)

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
    return
  }

  try {
    const body = await readFile(file)
    const type = MIME_TYPES[extname(file)] ?? 'application/octet-stream'
    
    if (type === 'text/html; charset=utf-8' && process.env.NODE_ENV !== 'production') {
      let html = body.toString('utf-8')
      const script = `<script>new EventSource('/livereload').onmessage = () => location.reload()</script>`
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${script}</body>`)
      } else {
        html += script
      }
      res.writeHead(200, { 'Content-Type': type })
      res.end(html)
    } else {
      res.writeHead(200, { 'Content-Type': type })
      res.end(body)
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
  }
})

server.listen(PORT, () => {
  console.log(`Showcase running at http://localhost:${PORT}/`)
})
