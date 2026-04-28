/**
 * Semi-automated base validation script.
 *
 * Prerequisites:
 *   - Dev server is running (npm run dev OR npm run dev:https)
 *
 * Usage:
 *   node scripts/validate-bases.mjs [URL]
 *
 * Examples:
 *   node scripts/validate-bases.mjs
 *   node scripts/validate-bases.mjs https://localhost:5173/dmgCtrl/
 *   node scripts/validate-bases.mjs https://192.168.1.100:5173/dmgCtrl/
 *
 * The script opens a visible Chromium window emulating an iPhone in landscape,
 * iterates through every set / aspect / base combination, navigates to the game
 * screen for each, waits for the card image to load, then pauses for visual
 * inspection before returning to setup. Progress is logged to the terminal.
 */

import { chromium, devices } from 'playwright'

// ─── Configuration ────────────────────────────────────────────────────────────

// Accept URL as first CLI argument.
// Default uses 127.0.0.1 rather than localhost — on Windows, localhost can
// resolve to IPv6 (::1) while Vite binds to IPv4, causing a silent failure.
const DEV_URL = process.argv[2] ?? 'http://127.0.0.1:5173/dmgCtrl/'

// Time (ms) to hold on the game screen after the card image has settled,
// so you can visually inspect the rendering.
const VISUAL_PAUSE_MS = 1000

// Brief settling pause after returning to the setup screen.
const BACK_PAUSE_MS = 300

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SELECTORS = {
  setSelect:    '[data-testid="set-select"]',
  aspectSelect: '[data-testid="aspect-select"]',
  baseSelect:   '[data-testid="base-select"]',
  startGame:    '[aria-label="Start game"]',
  back:         '[aria-label="Back"]',
}

async function waitForOptions(page, selector) {
  await page.waitForSelector(`${selector}:not([disabled])`)
  await page.waitForFunction(
    (sel) => document.querySelector(`${sel} option:not([disabled])`) !== null,
    selector
  )
}

async function getOptions(page, selector) {
  return page.locator(`${selector} option:not([disabled])`).allTextContents()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: false, devtools: true })

// Emulate iPhone 15 Pro in landscape orientation.
// Ignore HTTPS certificate errors so the script works with the mkcert-backed
// dev:https server without needing to import the mkcert CA into Chromium's
// own certificate store.
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

// Wait for loading screen to clear
try {
  await page.waitForSelector(SELECTORS.setSelect, { timeout: 15000 })
} catch (err) {
  console.error(`\nSetup screen did not appear: ${err.message}`)
  console.error('Ensure the app is on the Setup screen in landscape orientation.\n')
  await browser.close()
  process.exit(1)
}

console.log('Setup screen ready. Starting validation...\n')

const sets = await getOptions(page, SELECTORS.setSelect)
let count = 0

for (const set of sets) {
  await page.selectOption(SELECTORS.setSelect, { label: set })
  await waitForOptions(page, SELECTORS.aspectSelect)
  const aspects = await getOptions(page, SELECTORS.aspectSelect)

  for (const aspect of aspects) {
    await page.selectOption(SELECTORS.aspectSelect, { label: aspect })
    await waitForOptions(page, SELECTORS.baseSelect)
    const baseLabels = await getOptions(page, SELECTORS.baseSelect)

    for (const baseLabel of baseLabels) {
      count++
      // baseLabel format: "Name — XHP" — strip HP for cleaner console output
      const baseName = baseLabel.split(' — ')[0]
      console.log(`[${count}] ${set} / ${aspect} / ${baseName}`)

      await page.selectOption(SELECTORS.baseSelect, { label: baseLabel })
      await page.waitForSelector(`${SELECTORS.startGame}:not([disabled])`)
      await page.click(SELECTORS.startGame)

      // Confirm we're on the game screen
      await page.waitForSelector(SELECTORS.back)

      // Wait for the card image (or all fallbacks) to settle
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 })
      } catch {
        // Network did not reach idle within the timeout — carry on
      }

      // Hold for visual inspection
      await page.waitForTimeout(VISUAL_PAUSE_MS)

      // Return to setup screen
      await page.click(SELECTORS.back)
      await page.waitForSelector(SELECTORS.setSelect)
      await page.waitForTimeout(BACK_PAUSE_MS)
    }
  }
}

console.log(`\nValidation complete — ${count} bases checked.`)
await browser.close()