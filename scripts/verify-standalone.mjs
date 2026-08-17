/**
 * Smoke-test the standalone bundle in a real (if headless-DOM) environment.
 *
 * Not part of `vitest run` on purpose — it exercises a *built artifact*
 * (`dist/kuinetic.all.js`), the same convention `verify:browser`/`check:showcase` already follow
 * for build-dependent checks kept out of the main suite.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = readFileSync(`${root}dist/kuinetic.all.js`, 'utf8')

function fail(message) {
  console.error(`verify:standalone — FAIL: ${message}`)
  process.exitCode = 1
}

// jsdom's CSS engine can't parse @layer/color-mix()/linear()-easing and logs a "jsdomError" for
// it — expected and harmless here (see the comment below), so it's filtered rather than left to
// bury the real pass/fail line under a full stylesheet dump.
const virtualConsole = new VirtualConsole()
virtualConsole.sendTo(console, { omitJSDOMErrors: true })

const dom = new JSDOM(
  '<!doctype html><html><body><h1 data-kui="fade-up">hi</h1></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole },
)
const { window } = dom
const { document } = window

// A real <script> element, not eval(): the bundle starts with "use strict" (esbuild's default),
// and strict-mode indirect eval scopes top-level `var` to the eval call itself rather than the
// global object — invisible from outside, unlike a real script tag's global var. Testing via
// eval would fail on a wiring detail a real browser never hits.
const script = document.createElement('script')
script.textContent = bundle
try {
  document.body.appendChild(script)
} catch (error) {
  // jsdom's CSS engine doesn't parse @layer/color-mix()/linear()-easing — real browsers do (this
  // exact stylesheet is already covered by real-browser Playwright checks in verify:browser). The
  // <style> node is still attached by the time this throws, so the checks below still verify what
  // this script actually cares about: the injection + auto-start wiring, not CSS validity.
  if (!String(error.message).includes('Could not parse CSS stylesheet')) throw error
}

const style = window.document.getElementById('kuinetic-styles')
if (!style) fail('no <style id="kuinetic-styles"> was injected')
else if (!style.textContent.includes('@layer')) fail('injected style content looks empty/wrong')

if (typeof window.kuinetic?.kuinetic !== 'function') {
  fail('window.kuinetic.kuinetic was not exposed by the IIFE')
}
if (!window.__kuinetic || typeof window.__kuinetic.start !== 'function') {
  fail('window.__kuinetic was not auto-started')
}
const marked = window.document.querySelector('[data-kui-fx]')
if (!marked) fail('the fade-up element was never scanned/processed — auto-start did not run')

if (process.exitCode !== 1) {
  console.log('verify:standalone — OK: styles injected, animator auto-started, DOM scanned')
}
