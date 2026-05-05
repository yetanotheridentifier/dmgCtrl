/**
 * Semi-automated error message validation script.
 *
 * Covers all five error / info message states introduced in issue #140:
 *   1. "Invalid deck URL"               — SWUDB Import, invalid URL typed
 *   2. "Deck not accessible"            — SWUDB Import, unreachable deck URL
 *   3. "No base images found"           — Base Selector, all images blocked
 *   4. "Hyperspace variant not found"   — Base Selector, useHyperspace on, base without hyperspace art
 *   5. "Only hyperspace image available"— Base Selector, useHyperspace off, normal art blocked
 *
 * Prerequisites:
 *   - Dev server is running  (npm run dev  OR  npm run dev:https)
 *   - Playwright + Chromium installed
 *       npm install --legacy-peer-deps
 *       npx playwright install chromium
 *
 * Usage:
 *   node scripts/validate-errors.mjs [URL]
 *
 * Examples:
 *   node scripts/validate-errors.mjs
 *   node scripts/validate-errors.mjs https://192.168.1.100:5173/dmgCtrl/
 */

import { chromium, devices } from 'playwright'

// ─── Configuration ────────────────────────────────────────────────────────────

const DEV_URL = process.argv[2] ?? 'https://127.0.0.1:5173/dmgCtrl/'

// How long to hold on each scenario for visual inspection.
const VISUAL_PAUSE_MS = 3000

// Brief settling pause after navigating.
const SETTLE_MS = 500

// ─── Selectors ────────────────────────────────────────────────────────────────

const SEL = {
  modeSelect:   '[data-testid="mode-select"]',
  setSelect:    '[data-testid="set-select"]',
  aspectSelect: '[data-testid="aspect-select"]',
  baseSelect:   '[data-testid="base-select"]',
  swudbInput:   'input[placeholder="Paste SWUDB link"]',
  swudbLoad:    '[data-testid="swudb-load-button"]',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForSetupScreen(page) {
  await page.waitForSelector(SEL.modeSelect, { timeout: 15000 })
}

async function waitForOptions(page, selector) {
  await page.waitForSelector(`${selector}:not([disabled])`)
  await page.waitForFunction(
    sel => document.querySelector(`${sel} option:not([disabled])`) !== null,
    selector,
  )
}

async function switchMode(page, mode) {
  await page.selectOption(SEL.modeSelect, mode)
  await page.waitForTimeout(SETTLE_MS)
}

// Select a specific base in the Base Selector dropdowns.
// aspect is the raw string stored in the Base record (e.g. 'Command', 'None').
async function selectBase(page, set, aspect, baseName, baseHp) {
  await page.selectOption(SEL.setSelect, { value: set })
  await waitForOptions(page, SEL.aspectSelect)
  await page.selectOption(SEL.aspectSelect, { value: aspect })
  await waitForOptions(page, SEL.baseSelect)
  const label = `${baseName} (${baseHp})`
  await page.selectOption(SEL.baseSelect, { label })
  await page.waitForTimeout(SETTLE_MS)
}

// Read the bases cache from localStorage and find the first base matching a predicate.
async function findBaseByCriteria(page, predicate) {
  return page.evaluate((predicateSrc) => {
    const fn = new Function('b', `return (${predicateSrc})(b)`)
    const raw = localStorage.getItem('swu_bases_cache')
    if (!raw) return null
    const { data } = JSON.parse(raw)
    return data.find(fn) ?? null
  }, predicate.toString())
}

// Derive the UI aspect label from a Base record (mirrors useSwuSetup logic).
function aspectLabel(base) {
  return base.aspects.length === 0 ? 'None' : base.aspects[0]
}

// ─── Browser setup ────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: false, devtools: true })
const context = await browser.newContext({
  ...devices['iPhone 15 Pro landscape'],
  ignoreHTTPSErrors: DEV_URL.startsWith('https://'),
})
const page = await context.newPage()

console.log(`Connecting to ${DEV_URL} ...`)
try {
  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
} catch (err) {
  console.error(`\nCould not reach ${DEV_URL}: ${err.message}`)
  console.error('Is the dev server running?\n')
  await browser.close()
  process.exit(1)
}

try {
  await waitForSetupScreen(page)
} catch {
  console.error('\nSetup screen did not appear — check the dev server and try again.')
  await browser.close()
  process.exit(1)
}

console.log('Setup screen ready.\n')

// ─── [1/5] Invalid deck URL ───────────────────────────────────────────────────

console.log('[1/5] SWUDB Import — "Invalid deck URL"')
await switchMode(page, 'swudb-import')
await page.fill(SEL.swudbInput, 'not-a-valid-url')
await page.waitForSelector('text="Invalid deck URL"', { timeout: 5000 })
console.log('      Error dropdown visible. Pausing...')
await page.waitForTimeout(VISUAL_PAUSE_MS)

// ─── [2/5] Deck not accessible ────────────────────────────────────────────────

console.log('[2/5] SWUDB Import — "Deck not accessible"')
await page.fill(SEL.swudbInput, 'https://swudb.com/deck/validateErrors000')
await page.waitForSelector(`${SEL.swudbLoad}:not([disabled])`, { timeout: 5000 })
await page.click(SEL.swudbLoad)
await page.waitForSelector('text="Deck not accessible"', { timeout: 15000 })
console.log('      Error dropdown visible. Pausing...')
await page.waitForTimeout(VISUAL_PAUSE_MS)

// ─── [3/5] No base images found ───────────────────────────────────────────────

console.log('[3/5] Base Selector — "No base images found" (blocking all images)')
await switchMode(page, 'base-selector')
await page.route('**/*.png', r => r.abort())
await page.route('**/*.webp', r => r.abort())
await page.route('**/*.jpg', r => r.abort())

await waitForOptions(page, SEL.setSelect)
await page.selectOption(SEL.setSelect, { index: 1 })
await waitForOptions(page, SEL.aspectSelect)
await page.selectOption(SEL.aspectSelect, { index: 1 })
await waitForOptions(page, SEL.baseSelect)
await page.selectOption(SEL.baseSelect, { index: 1 })

await page.waitForSelector('text="No base images found"', { timeout: 10000 })
console.log('      Error box visible. Pausing...')
await page.waitForTimeout(VISUAL_PAUSE_MS)

await page.unroute('**/*.png')
await page.unroute('**/*.webp')
await page.unroute('**/*.jpg')

// ─── [4/5] Hyperspace variant not found ───────────────────────────────────────
// Needs useHyperspace=true (app default) + a base that has no hyperspace art.

console.log('[4/5] Base Selector — "Hyperspace variant not found"')

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
  s.useHyperspace = true
  localStorage.setItem('user_settings', JSON.stringify(s))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await waitForSetupScreen(page)

const noHyperBase = await findBaseByCriteria(
  page,
  b => !b.hyperspaceArtHiRes && !b.hyperspaceArt && !!b.frontArt,
)

if (noHyperBase) {
  await selectBase(page, noHyperBase.set, aspectLabel(noHyperBase), noHyperBase.name, noHyperBase.hp)
  await page.waitForSelector('text="Hyperspace variant not found"', { timeout: 8000 })
  console.log(`      Info panel visible (${noHyperBase.set} — ${noHyperBase.name}). Pausing...`)
  await page.waitForTimeout(VISUAL_PAUSE_MS)
} else {
  console.log('      No suitable base found in cache — skipping.')
}

// ─── [5/5] Only hyperspace image available ────────────────────────────────────
// Needs useHyperspace=false + normal art blocked for a base that has hyperspace art.

console.log('[5/5] Base Selector — "Only hyperspace image available"')

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
  s.useHyperspace = false
  localStorage.setItem('user_settings', JSON.stringify(s))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await waitForSetupScreen(page)

const hasHyperBase = await findBaseByCriteria(
  page,
  b => !!b.hyperspaceArtHiRes && (!!b.frontArt || !!b.frontArtLowRes),
)

if (hasHyperBase) {
  // Block the normal art URLs for this specific base so it falls back to hyperspace.
  const blocked = [hasHyperBase.frontArt, hasHyperBase.frontArtLowRes].filter(Boolean)
  for (const url of blocked) await page.route(url, r => r.abort())

  await selectBase(page, hasHyperBase.set, aspectLabel(hasHyperBase), hasHyperBase.name, hasHyperBase.hp)
  await page.waitForSelector('text="Only hyperspace image available"', { timeout: 8000 })
  console.log(`      Info panel visible (${hasHyperBase.set} — ${hasHyperBase.name}). Pausing...`)
  await page.waitForTimeout(VISUAL_PAUSE_MS)

  for (const url of blocked) await page.unroute(url)
} else {
  console.log('      No suitable base found in cache — skipping.')
}

// ─── Restore default settings ─────────────────────────────────────────────────

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
  s.useHyperspace = true
  localStorage.setItem('user_settings', JSON.stringify(s))
})

console.log('\nValidation complete — 5 scenarios checked.')
await browser.close()
