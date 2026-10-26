/**
 * Performance measurement script.
 *
 * Measures timings across N iterations and reports min / median / max:
 *   - Setup ready:    reload → SWU setup shown, with no base chosen
 *   - Preview image:  base tile tapped in the base sheet → its art shown on Your base
 *   - Game image (3 resolution tiers, each measured per iteration):
 *       Go to game tapped → base art shown on the game screen
 *       low res    — the first TS26 base (frontArtLowRes only, no CDN art)
 *       normal res — LAW-021             (frontArt from CDN)
 *       hi res     — SOR-019             (hyperspaceArtHiRes / SOR-285, hyperspace enabled)
 *
 * LCP is also captured for each run (largest element painted before first
 * interaction; with no base chosen, typically setup's own text).
 *
 * Prerequisites:
 *   - Dev server is running (npm run dev OR npm run dev:https)
 *   - Playwright + Chromium installed:
 *       npm install --legacy-peer-deps
 *       npx playwright install chromium
 *
 * Usage:
 *   node scripts/measure-performance.mjs [URL] [iterations] [--cold] [--headless]
 *
 * Examples:
 *   node scripts/measure-performance.mjs
 *   node scripts/measure-performance.mjs https://127.0.0.1:5173/ 10
 *
 * Flags:
 *   --cold      Clear the base data cache (swu_bases_cache) before each run.
 *               Default: warm cache (typical returning-user experience).
 *   --headless  Run without a visible window.
 */

import {
  parseArgs, launch, openSetup, waitForSetup, readBases, baseLabel, setSetting, chooseBase,
  waitForPreviewImage, goToGame, waitForGameImage, backToSetup,
} from './qa-helpers.mjs'

// ─── Configuration ────────────────────────────────────────────────────────────

const args = parseArgs()
const ITERATIONS = parseInt(args.positional[0] ?? '5', 10)
const COLD = args.flags.includes('--cold')

// Per-phase timeout (ms). Increase if on a slow connection.
const IDLE_TIMEOUT = 10000

// The base chosen for the preview timing.
const PREVIEW_BASE = { set: 'LAW', number: '021' }

// The three game-image scenarios measured on every iteration.
// A null number picks the set's first base.
const GAME_SCENARIOS = [
  // TS26 has no CDN frontArt: only frontArtLowRes is available.
  { label: 'low res',    set: 'TS26', number: null,  hyperspace: false },
  // LAW-021 (Coaxium Mine) has a normal-res CDN image (frontArt).
  { label: 'normal res', set: 'LAW',  number: '021', hyperspace: false },
  // SOR-019 (Security Complex) has a hi-res hyperspace image (SOR-285).
  { label: 'hi res',     set: 'SOR',  number: '019', hyperspace: true  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findBase(bases, { set, number }) {
  const base = bases
    .filter(b => b.set === set && (number === null || b.number === number))
    .sort((a, b) => a.number.localeCompare(b.number))[0]
  if (!base) throw new Error(`No base ${set}${number ? `-${number}` : ''} in the card data`)
  return base
}

// Reload into setup with nothing chosen, so every choice is a change.
async function reloadFresh(page) {
  await page.evaluate(() => localStorage.removeItem('swu_setup'))
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  await waitForSetup(page)
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

const { browser, context } = await launch(args)

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

// ─── Initial navigation: primes origin for localStorage access ────────────────

console.log(`Iterations: ${ITERATIONS}  |  Cache: ${COLD ? 'cold (swu_bases_cache cleared each run)' : 'warm'}`)
await openSetup(page, browser, args.url)
console.log('')

const bases = await readBases(page)
const previewBase = findBase(bases, { ...PREVIEW_BASE })
const gameBases = Object.fromEntries(GAME_SCENARIOS.map(s => [s.label, findBase(bases, s)]))

// ─── Measurement loop ─────────────────────────────────────────────────────────

const results = []

for (let i = 0; i < ITERATIONS; i++) {
  if (COLD) {
    await page.evaluate(() => localStorage.removeItem('swu_bases_cache'))
  }

  // Ensure hyperspace is off for setup + preview timing (clean baseline).
  await setSetting(page, 'useHyperspace', false)

  // ── 1. Setup ready ────────────────────────────────────────────────────────
  const t0 = Date.now()
  await reloadFresh(page)
  const setupReadyMs = Date.now() - t0

  // ── 2. LCP ────────────────────────────────────────────────────────────────
  // Read before any interaction so the observer has not been stopped.
  const lcp = await page.evaluate(() =>
    window.__lcpMs.length ? Math.round(window.__lcpMs[window.__lcpMs.length - 1]) : null
  )

  // ── 3. Preview image ──────────────────────────────────────────────────────
  // Time from tapping the base's tile in the sheet to its art shown on Your base.
  const tapped = await chooseBase(page, previewBase)
  await waitForPreviewImage(page, previewBase, IDLE_TIMEOUT).catch(() => {})
  const previewMs = Date.now() - tapped

  // ── 4. Game image: three resolution tiers ─────────────────────────────────
  // Each scenario reloads with the correct hyperspace setting, chooses its
  // base, then times Go to game → image shown.
  const gameMsMap = {}

  for (const scenario of GAME_SCENARIOS) {
    await setSetting(page, 'useHyperspace', scenario.hyperspace)
    await reloadFresh(page)
    await chooseBase(page, gameBases[scenario.label])
    const t = Date.now()
    await goToGame(page)
    await waitForGameImage(page, IDLE_TIMEOUT).catch(() => {})
    gameMsMap[scenario.label] = Date.now() - t
    await backToSetup(page)
  }

  results.push({ setupReadyMs, lcp, previewMs, gameMsMap })

  const lcpStr = lcp !== null ? `${pad(lcp)} ms` : '  n/a ms'
  const gameStr = GAME_SCENARIOS.map(s => `  game-${s.label.replace(' res', '')} ${pad(gameMsMap[s.label])} ms`).join('')
  console.log(
    `[${String(i + 1).padStart(2)}/${ITERATIONS}]` +
    `  setup ${pad(setupReadyMs)} ms` +
    `  lcp ${lcpStr}` +
    `  preview ${pad(previewMs)} ms` +
    gameStr,
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const setupVals   = results.map(r => r.setupReadyMs)
const previewVals = results.map(r => r.previewMs)
const lcpVals     = results.map(r => r.lcp).filter(v => v !== null)

const divider = '─'.repeat(64)
console.log(`\nPreview: ${baseLabel(previewBase)}`)
for (const s of GAME_SCENARIOS) console.log(`Game (${s.label}): ${baseLabel(gameBases[s.label])}`)
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
