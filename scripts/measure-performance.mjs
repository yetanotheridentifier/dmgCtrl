/**
 * Performance measurement script.
 *
 * Measures three timings across N iterations and reports min / median / max:
 *   - Setup ready:    navigation start → set selector enabled
 *   - Preview image:  first base selected → preview network idle  (the #142 metric)
 *   - Game image:     Start clicked → game screen network idle    (the #152 metric)
 *
 * LCP is also captured for each run (largest element painted before first
 * interaction — typically the preview image when a base is auto-selected, or
 * the header icon otherwise).
 *
 * Prerequisites:
 *   - Dev server is running (npm run dev OR npm run dev:https)
 *   - Playwright + Chromium installed:
 *       npm install --legacy-peer-deps
 *       npx playwright install chromium
 *
 * Usage:
 *   node scripts/measure-performance.mjs [URL] [iterations]
 *
 * Examples:
 *   node scripts/measure-performance.mjs
 *   node scripts/measure-performance.mjs http://127.0.0.1:5173/dmgCtrl/ 10
 *   node scripts/measure-performance.mjs https://127.0.0.1:5173/dmgCtrl/
 *
 * Flags:
 *   --cold    Clear the base data cache (swu_bases_cache) before each run.
 *             Default: warm cache (typical returning-user experience).
 */

import { chromium, devices } from 'playwright'

// ─── Configuration ────────────────────────────────────────────────────────────

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const flags      = process.argv.slice(2).filter(a => a.startsWith('--'))

const DEV_URL    = positional[0] ?? 'http://127.0.0.1:5173/dmgCtrl/'
const ITERATIONS = parseInt(positional[1] ?? '5', 10)
const COLD       = flags.includes('--cold')

// Per-phase network idle timeout (ms). Increase if on a slow connection.
const IDLE_TIMEOUT = 10000

// ─── Selectors ────────────────────────────────────────────────────────────────

const SEL = {
  setSelect:    '[data-testid="set-select"]',
  aspectSelect: '[data-testid="aspect-select"]',
  baseSelect:   '[data-testid="base-select"]',
  startGame:    '[aria-label="Start game"]',
  back:         '[aria-label="Back"]',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForOptions(page, selector) {
  await page.waitForSelector(`${selector}:not([disabled])`)
  await page.waitForFunction(
    sel => document.querySelector(`${sel} option:not([disabled])`) !== null,
    selector,
  )
}

async function selectFirstBase(page) {
  async function pickFirst(selector) {
    const opt = page.locator(`${selector} option:not([disabled])`).first()
    const value = await opt.getAttribute('value')
    await page.selectOption(selector, { value })
    return (await opt.textContent()).trim()
  }

  const setLabel  = await pickFirst(SEL.setSelect)
  await waitForOptions(page, SEL.aspectSelect)
  await pickFirst(SEL.aspectSelect)
  await waitForOptions(page, SEL.baseSelect)
  const baseLabel = await pickFirst(SEL.baseSelect)
  return `${setLabel} / ${baseLabel}`
}

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2
}

function pad(n, width = 6) {
  return String(Math.round(n)).padStart(width)
}

// ─── Browser setup ────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({
  ...devices['iPhone 15 Pro landscape'],
  ignoreHTTPSErrors: DEV_URL.startsWith('https://'),
})

// Register a LCP observer that runs before every page load in this context.
// Entries are stored in window.__lcpMs (array of startTime values in ms).
// LCP recording stops automatically on the first user interaction.
await context.addInitScript(() => {
  window.__lcpMs = []
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__lcpMs.push(e.startTime)
  }).observe({ type: 'largest-contentful-paint', buffered: true })
})

const page = await context.newPage()

// ─── Initial navigation — primes origin for localStorage access ───────────────

console.log(`Connecting to ${DEV_URL} ...`)
console.log(`Iterations: ${ITERATIONS}  |  Cache: ${COLD ? 'cold (swu_bases_cache cleared each run)' : 'warm'}\n`)

try {
  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
} catch (err) {
  console.error(`\nCould not reach ${DEV_URL}: ${err.message}`)
  console.error('Is the dev server running?\n')
  await browser.close()
  process.exit(1)
}

try {
  await page.waitForSelector(`${SEL.setSelect}:not([disabled])`, { timeout: 15000 })
} catch {
  console.error('\nSetup screen did not appear — check the dev server and try again.')
  await browser.close()
  process.exit(1)
}

// ─── Measurement loop ─────────────────────────────────────────────────────────

const results = []

for (let i = 0; i < ITERATIONS; i++) {
  // Clear base data cache if running cold (we're on the app origin, so
  // localStorage is accessible before the next navigation).
  if (COLD) {
    await page.evaluate(() => localStorage.removeItem('swu_bases_cache'))
  }

  // ── 1. Setup ready ────────────────────────────────────────────────────────
  // Timed from navigation start to the set selector becoming interactive.
  const t0 = Date.now()
  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForSelector(`${SEL.setSelect}:not([disabled])`, { timeout: 15000 })
  const setupReadyMs = Date.now() - t0

  // ── 2. LCP ────────────────────────────────────────────────────────────────
  // Read before any interaction so the observer has not been stopped.
  const lcp = await page.evaluate(() =>
    window.__lcpMs.length ? Math.round(window.__lcpMs[window.__lcpMs.length - 1]) : null
  )

  // ── 3. Preview image ──────────────────────────────────────────────────────
  // Time from first selector interaction to network idle. Covers the low-res
  // image fetch that #142 put at the front of the fallback chain.
  const tPreview = Date.now()
  const selection = await selectFirstBase(page)
  await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {})
  const previewMs = Date.now() - tPreview

  // ── 4. Game image ─────────────────────────────────────────────────────────
  // Time from Start click to game screen network idle. Covers the hi-res
  // card image fetch that #152 will preload.
  await page.waitForSelector(`${SEL.startGame}:not([disabled])`, { timeout: 5000 })
  const tGame = Date.now()
  await page.click(SEL.startGame)
  await page.waitForSelector(SEL.back, { timeout: 10000 })
  await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {})
  const gameMs = Date.now() - tGame

  results.push({ setupReadyMs, lcp, previewMs, gameMs })

  const lcpStr = lcp !== null ? `${pad(lcp)} ms` : '  n/a ms'
  console.log(
    `[${String(i + 1).padStart(2)}/${ITERATIONS}]` +
    `  setup ${pad(setupReadyMs)} ms` +
    `  lcp ${lcpStr}` +
    `  preview ${pad(previewMs)} ms` +
    `  game ${pad(gameMs)} ms` +
    `    (${selection})`,
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const setupVals   = results.map(r => r.setupReadyMs)
const previewVals = results.map(r => r.previewMs)
const gameVals    = results.map(r => r.gameMs)
const lcpVals     = results.map(r => r.lcp).filter(v => v !== null)

const divider = '─'.repeat(58)
console.log(`\n${divider}`)
console.log('Metric             '.padEnd(20) + '   min  median     max')
console.log(divider)

function row(label, vals) {
  if (!vals.length) return
  const s = [...vals].sort((a, b) => a - b)
  console.log(
    label.padEnd(20) +
    `${pad(s[0])} ms` +
    `${pad(median(vals))} ms` +
    `${pad(s[s.length - 1])} ms`,
  )
}

row('Setup ready', setupVals)
if (lcpVals.length) row('LCP', lcpVals)
row('Preview image', previewVals)
row('Game image', gameVals)
console.log(divider)

await browser.close()
