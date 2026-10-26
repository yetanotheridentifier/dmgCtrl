/**
 * Semi-automated base validation script.
 *
 * Prerequisites:
 *   - Dev server is running (npm run dev OR npm run dev:https)
 *   - Playwright + Chromium installed:
 *       npm install --legacy-peer-deps
 *       npx playwright install chromium
 *
 * Usage:
 *   node scripts/validate-bases.mjs [URL] [--set=CODE] [--headless]
 *
 * Examples:
 *   node scripts/validate-bases.mjs
 *   node scripts/validate-bases.mjs https://127.0.0.1:5173/
 *   node scripts/validate-bases.mjs https://192.168.1.100:5173/ --set=LAW
 *
 * The script opens a visible Chromium window emulating an iPhone in landscape,
 * reads every base from the card data the app has loaded (swu_bases_cache), and
 * for each one, in set order: chooses it in the base sheet (search by name, tap
 * the tile), goes to the game screen, waits for the card image to load, pauses
 * for visual inspection, then returns to setup. `--set=CODE` checks one set.
 * Progress is logged to the terminal; bases the sheet does not offer, and bases
 * whose image did not load on the game screen, are listed at the end.
 */

import {
  parseArgs, launch, openSetup, readBases, baseLabel, chooseBase, goToGame, waitForGameImage, backToSetup,
} from './qa-helpers.mjs'

// ─── Configuration ────────────────────────────────────────────────────────────

const args = parseArgs()
const SET = args.flags.find(f => f.startsWith('--set='))?.slice('--set='.length).toUpperCase() ?? null

// Time (ms) to hold on the game screen after the card image has settled,
// so you can visually inspect the rendering.
const VISUAL_PAUSE_MS = 1000

// How long to wait for the card image on the game screen.
const IMAGE_TIMEOUT_MS = 10000

// Brief settling pause after returning to the setup screen.
const BACK_PAUSE_MS = 300

// ─── Main ─────────────────────────────────────────────────────────────────────

const { browser, context } = await launch({ ...args, devtools: true })
const page = await context.newPage()
await openSetup(page, browser, args.url)

const bases = (await readBases(page))
  .filter(b => SET === null || b.set === SET)
  .sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number))

if (bases.length === 0) {
  console.error(`\nNo bases in the card data${SET ? ` for set ${SET}` : ''}.`)
  await browser.close()
  process.exit(1)
}

console.log(`Setup ready. Checking ${bases.length} bases...\n`)

const notOffered = []
const noImage = []
let count = 0

for (const base of bases) {
  count++
  console.log(`[${count}/${bases.length}] ${baseLabel(base)}`)

  if ((await chooseBase(page, base)) === null) {
    console.log('      Not offered in the base sheet: skipped.')
    notOffered.push(base)
    continue
  }

  await goToGame(page)

  // Wait for the card image to load; if it does not, say so and carry on
  try {
    await waitForGameImage(page, IMAGE_TIMEOUT_MS)
  } catch {
    console.log(`      No card image within ${IMAGE_TIMEOUT_MS / 1000} s.`)
    noImage.push(base)
  }

  // Hold for visual inspection
  await page.waitForTimeout(VISUAL_PAUSE_MS)

  await backToSetup(page)
  await page.waitForTimeout(BACK_PAUSE_MS)
}

console.log(`\nValidation complete: ${count - notOffered.length} of ${count} bases checked.`)
if (notOffered.length) {
  console.log('Not offered in the base sheet:')
  for (const b of notOffered) console.log(`  ${baseLabel(b)}`)
}
if (noImage.length) {
  console.log('No card image on the game screen:')
  for (const b of noImage) console.log(`  ${baseLabel(b)}`)
}
await browser.close()
