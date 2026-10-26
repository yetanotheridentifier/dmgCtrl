/**
 * Semi-automated error message validation script.
 *
 * Covers the five error / info message states on SWU setup:
 *   1. "Invalid deck URL"                 base sheet, Paste SWUDB link, invalid URL typed
 *   2. "Deck not accessible"              base sheet, Paste SWUDB link, unreachable deck loaded
 *   3. "No base images found"             Your base, all images blocked
 *   4. "Hyperspace variant not found"     Your base, useHyperspace on, base without hyperspace art
 *   5. "Only hyperspace image available"  Your base, useHyperspace off, normal art blocked
 *
 * Prerequisites:
 *   - Dev server is running  (npm run dev  OR  npm run dev:https)
 *   - Playwright + Chromium installed
 *       npm install --legacy-peer-deps
 *       npx playwright install chromium
 *
 * Usage:
 *   node scripts/validate-errors.mjs [URL] [--headless]
 *
 * Examples:
 *   node scripts/validate-errors.mjs
 *   node scripts/validate-errors.mjs https://192.168.1.100:5173/
 *
 * Settings changed during the run (useHyperspace) live in the script's own
 * browser profile, which is discarded at the end.
 */

import {
  SEL, parseArgs, launch, openSetup, waitForSetup, readBases, baseLabel, setSetting, openBaseSheet, chooseBase,
} from './qa-helpers.mjs'

// ─── Configuration ────────────────────────────────────────────────────────────

const args = parseArgs()

// How long to hold on each scenario for visual inspection.
const VISUAL_PAUSE_MS = 3000

const IMAGE_PATTERNS = ['**/*.png', '**/*.webp', '**/*.jpg']

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function reloadWithHyperspace(page, enabled) {
  await setSetting(page, 'useHyperspace', enabled)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForSetup(page)
}

async function showMessage(text, timeout) {
  await page.getByText(text, { exact: true }).waitFor({ timeout })
  console.log('      Message visible. Pausing...')
  await page.waitForTimeout(VISUAL_PAUSE_MS)
}

// ─── Browser setup ────────────────────────────────────────────────────────────

const { browser, context } = await launch({ ...args, devtools: true })
const page = await context.newPage()
await openSetup(page, browser, args.url)
console.log('Setup ready.\n')

const bases = await readBases(page)

// ─── [1/5] Invalid deck URL ───────────────────────────────────────────────────

console.log('[1/5] Paste SWUDB link: "Invalid deck URL"')
await openBaseSheet(page)
await page.getByRole('button', { name: 'Paste SWUDB link' }).click()
await page.fill(SEL.swudbInput, 'not-a-valid-url')
await showMessage('Invalid deck URL', 5000)

// ─── [2/5] Deck not accessible ────────────────────────────────────────────────

console.log('[2/5] Paste SWUDB link: "Deck not accessible"')
await page.fill(SEL.swudbInput, 'https://swudb.com/deck/validateErrors000')
await page.locator(SEL.sheet).getByRole('button', { name: 'Load' }).click()
await showMessage('Deck not accessible', 15000)
await page.keyboard.press('Escape')
await page.waitForSelector(SEL.sheet, { state: 'detached' })

// ─── [3/5] No base images found ───────────────────────────────────────────────

console.log('[3/5] Your base: "No base images found" (blocking all images)')
for (const p of IMAGE_PATTERNS) await page.route(p, r => r.abort())

const anyBase = bases.find(b => b.frontArt || b.frontArtLowRes)
console.log(`      ${baseLabel(anyBase)}`)
await chooseBase(page, anyBase)
await showMessage('No base images found', 10000)

for (const p of IMAGE_PATTERNS) await page.unroute(p)

// ─── [4/5] Hyperspace variant not found ───────────────────────────────────────
// Needs useHyperspace=true (app default) + a base that has no hyperspace art.

console.log('[4/5] Your base: "Hyperspace variant not found"')
await reloadWithHyperspace(page, true)

const noHyperBase = bases.find(b => !b.hyperspaceArtHiRes && !b.hyperspaceArt && !!b.frontArt)
if (noHyperBase) {
  console.log(`      ${baseLabel(noHyperBase)}`)
  await chooseBase(page, noHyperBase)
  await showMessage('Hyperspace variant not found', 8000)
} else {
  console.log('      No suitable base in the card data: skipped.')
}

// ─── [5/5] Only hyperspace image available ────────────────────────────────────
// Needs useHyperspace=false + normal art blocked for a base that has hyperspace art.

console.log('[5/5] Your base: "Only hyperspace image available"')
await reloadWithHyperspace(page, false)

const hasHyperBase = bases.find(b => !!b.hyperspaceArtHiRes && (!!b.frontArt || !!b.frontArtLowRes))
if (hasHyperBase) {
  // Block the normal art URLs for this base so it falls back to hyperspace.
  const blocked = [hasHyperBase.frontArt, hasHyperBase.frontArtLowRes].filter(Boolean)
  for (const url of blocked) await page.route(url, r => r.abort())

  console.log(`      ${baseLabel(hasHyperBase)}`)
  await chooseBase(page, hasHyperBase)
  await showMessage('Only hyperspace image available', 8000)

  for (const url of blocked) await page.unroute(url)
} else {
  console.log('      No suitable base in the card data: skipped.')
}

console.log('\nValidation complete: 5 scenarios checked.')
await browser.close()
