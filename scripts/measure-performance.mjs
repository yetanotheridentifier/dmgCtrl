/**
 * Performance measurement script.
 *
 * Measures timings across N iterations and reports min / median / max:
 *   - Setup ready:    navigation start → set selector enabled
 *   - Preview image:  first base selected → card image visible in DOM  (the #142 metric)
 *   - Game image (3 resolution tiers, each measured per iteration):
 *       low res    — TS26 base      (frontArtLowRes only, no CDN art)
 *       normal res — LAW-021        (frontArt from CDN)
 *       hi res     — SOR-019        (hyperspaceArtHiRes / SOR-285, hyperspace enabled)
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

// Per-phase timeout (ms). Increase if on a slow connection.
const IDLE_TIMEOUT = 10000

// The three game-image scenarios measured on every iteration.
// null aspect / baseKey → pick the first available option from the select.
const GAME_SCENARIOS = [
  // TS26 has no CDN frontArt — only frontArtLowRes is available.
  { label: 'low res',    setCode: 'TS26', aspect: null,        baseKey: null,      hyperspace: false },
  // LAW-021 (Coaxium Mine) has a normal-res CDN image (frontArt).
  { label: 'normal res', setCode: 'LAW',  aspect: 'Vigilance', baseKey: 'LAW-021', hyperspace: false },
  // SOR-019 (Security Complex) has a hi-res hyperspace image (SOR-285).
  { label: 'hi res',     setCode: 'SOR',  aspect: 'Vigilance', baseKey: 'SOR-019', hyperspace: true  },
]

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

// Select a specific set + aspect + base. Pass null for aspect or baseKey to
// fall back to the first available option in that select.
async function selectBase(page, setCode, aspect, baseKey) {
  await page.selectOption(SEL.setSelect, { value: setCode })
  await waitForOptions(page, SEL.aspectSelect)
  if (aspect) {
    await page.selectOption(SEL.aspectSelect, { value: aspect })
  } else {
    const opt = page.locator(`${SEL.aspectSelect} option:not([disabled])`).first()
    await page.selectOption(SEL.aspectSelect, { value: await opt.getAttribute('value') })
  }
  await waitForOptions(page, SEL.baseSelect)
  if (baseKey) {
    await page.selectOption(SEL.baseSelect, { value: baseKey })
  } else {
    const opt = page.locator(`${SEL.baseSelect} option:not([disabled])`).first()
    await page.selectOption(SEL.baseSelect, { value: await opt.getAttribute('value') })
  }
}

// Patch useHyperspace in localStorage. Requires a page.reload() to take effect
// in React state (the app reads settings only on mount).
async function setHyperspace(page, enabled) {
  await page.evaluate(enabled => {
    const KEY = 'user_settings'
    const settings = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    settings.useHyperspace = enabled
    localStorage.setItem(KEY, JSON.stringify(settings))
  }, enabled)
}

// Returns true once any image on the page has finished loading and is visible.
// Covers both components:
//   imagePreview.tsx      — wrapper div has style.visibility = 'visible' on load
//   swuGameScreenView.tsx — img element has style.display = 'block' on load
const imageVisibleFn = () => {
  for (const img of document.querySelectorAll('img')) {
    if (!img.complete || !img.naturalWidth || !img.src) continue
    const parent = img.parentElement
    if (parent && parent.style.visibility === 'visible') return true
    if (img.style.display && img.style.display !== 'none') return true
  }
  return false
}

// Time from Start click to the card image becoming visible in the game screen.
async function measureGameImageMs(page) {
  await page.waitForSelector(`${SEL.startGame}:not([disabled])`, { timeout: 5000 })
  const t = Date.now()
  await page.click(SEL.startGame)
  await page.waitForSelector(SEL.back, { timeout: 10000 })
  await page.waitForFunction(imageVisibleFn, undefined, { timeout: IDLE_TIMEOUT }).catch(() => {})
  return Date.now() - t
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
  if (COLD) {
    await page.evaluate(() => localStorage.removeItem('swu_bases_cache'))
  }

  // Ensure hyperspace is off for setup + preview timing (clean baseline).
  await setHyperspace(page, false)

  // ── 1. Setup ready ────────────────────────────────────────────────────────
  // Timed from navigation start to the set selector becoming interactive.
  const t0 = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForSelector(`${SEL.setSelect}:not([disabled])`, { timeout: 15000 })
  const setupReadyMs = Date.now() - t0

  // ── 2. LCP ────────────────────────────────────────────────────────────────
  // Read before any interaction so the observer has not been stopped.
  const lcp = await page.evaluate(() =>
    window.__lcpMs.length ? Math.round(window.__lcpMs[window.__lcpMs.length - 1]) : null
  )

  // ── 3. Preview image ──────────────────────────────────────────────────────
  // Time from first selector interaction to card image visible. Covers the low-res
  // image fetch that #142 put at the front of the fallback chain.
  const tPreview = Date.now()
  const selection = await selectFirstBase(page)
  // waitForLoadState('networkidle') only detects network requests — a cached image
  // produces no traffic and fires immediately. Instead wait for imagePreview.tsx to
  // set visibility:'visible' on the wrapper div, which only happens once imageLoaded
  // becomes true (i.e. the img onLoad callback has fired).
  await page.waitForFunction(imageVisibleFn, undefined, { timeout: IDLE_TIMEOUT }).catch(() => {})
  const previewMs = Date.now() - tPreview

  // ── 4. Game image — three resolution tiers ────────────────────────────────
  // Each scenario reloads with the correct hyperspace setting, selects its
  // specific base, then times Start click → image visible.
  const gameMsMap = {}

  for (const scenario of GAME_SCENARIOS) {
    await setHyperspace(page, scenario.hyperspace)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForSelector(`${SEL.setSelect}:not([disabled])`, { timeout: 15000 })
    await selectBase(page, scenario.setCode, scenario.aspect, scenario.baseKey)
    gameMsMap[scenario.label] = await measureGameImageMs(page)
    await page.click(SEL.back)
    await page.waitForSelector(`${SEL.setSelect}:not([disabled])`, { timeout: 10000 })
  }

  results.push({ setupReadyMs, lcp, previewMs, gameMsMap })

  const lcpStr = lcp !== null ? `${pad(lcp)} ms` : '  n/a ms'
  const gameStr = GAME_SCENARIOS.map(s => `  game-${s.label.replace(' res', '')} ${pad(gameMsMap[s.label])} ms`).join('')
  console.log(
    `[${String(i + 1).padStart(2)}/${ITERATIONS}]` +
    `  setup ${pad(setupReadyMs)} ms` +
    `  lcp ${lcpStr}` +
    `  preview ${pad(previewMs)} ms` +
    gameStr +
    `    (${selection})`,
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const setupVals   = results.map(r => r.setupReadyMs)
const previewVals = results.map(r => r.previewMs)
const lcpVals     = results.map(r => r.lcp).filter(v => v !== null)

const divider = '─'.repeat(64)
console.log(`\n${divider}`)
console.log('Metric                 '.padEnd(24) + '   min  median     max')
console.log(divider)

function row(label, vals) {
  if (!vals.length) return
  const s = [...vals].sort((a, b) => a - b)
  console.log(
    label.padEnd(24) +
    `${pad(s[0])} ms` +
    `${pad(median(vals))} ms` +
    `${pad(s[s.length - 1])} ms`,
  )
}

row('Setup ready', setupVals)
if (lcpVals.length) row('LCP', lcpVals)
row('Preview image', previewVals)
for (const scenario of GAME_SCENARIOS) {
  row(`Game (${scenario.label})`, results.map(r => r.gameMsMap[scenario.label]))
}
console.log(divider)

await browser.close()
