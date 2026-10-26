/**
 * Shared helpers for the Playwright QA scripts (validate-bases, validate-errors,
 * measure-performance). Not a script itself.
 *
 * Every script takes the dev server address as its first positional argument and
 * opens SWU setup at `<address>swu`. `--headless` runs without a visible window
 * (for a machine with no display, or with only Playwright's headless shell).
 */

import { chromium, devices } from 'playwright'

// Default uses 127.0.0.1 rather than localhost: on Windows, localhost can
// resolve to IPv6 (::1) while Vite binds to IPv4, causing a silent failure.
// The dev server serves HTTPS (vite.config.ts).
export const DEFAULT_URL = 'https://127.0.0.1:5173/'

export const SEL = {
  setup:      '[data-testid="swu-setup"]',
  baseCard:   '[data-testid="base-card"]',
  sheet:      '[role="dialog"]',
  search:     'input[aria-label="Search bases"]',
  swudbInput: '#swudb-link',
  gameCard:   '[data-testid="game-card"]',
  gameImage:  '[data-testid="game-card-image"]',
  gameBack:   '[aria-label="Back"]',
}

export function parseArgs(argv = process.argv.slice(2)) {
  const positional = argv.filter(a => !a.startsWith('--'))
  const flags = argv.filter(a => a.startsWith('--'))
  const url = positional[0] ?? DEFAULT_URL
  return {
    url: url.endsWith('/') ? url : `${url}/`,
    positional: positional.slice(1),
    flags,
    headless: flags.includes('--headless'),
  }
}

// An iPhone 15 Pro in landscape. HTTPS certificate errors are ignored so the
// scripts work with the mkcert-backed dev:https server without importing the
// mkcert CA into Chromium's own certificate store.
export async function launch({ url, headless, devtools = false }) {
  const browser = await chromium.launch({ headless, devtools: devtools && !headless })
  const context = await browser.newContext({
    ...devices['iPhone 15 Pro landscape'],
    ignoreHTTPSErrors: url.startsWith('https://'),
  })
  // From the second launch the install banner covers the foot of setup: as if
  // Not now had been tapped (useInstallPrompt.ts).
  await context.addInitScript(() => {
    localStorage.setItem('install_banner_hidden_until', String(Date.now() + 24 * 60 * 60 * 1000))
  })
  return { browser, context }
}

export const setupUrl = url => `${url}swu`

// Opens SWU setup and waits for it, or exits with a reason if the server or the
// screen is not there. The first launch also loads the card data.
export async function openSetup(page, browser, url) {
  console.log(`Connecting to ${setupUrl(url)} ...`)
  try {
    await page.goto(setupUrl(url), { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch (err) {
    console.error(`\nCould not reach ${url}: ${err.message}`)
    console.error('Is the dev server running?\n')
    await browser.close()
    process.exit(1)
  }
  try {
    await waitForSetup(page)
  } catch (err) {
    console.error(`\nSWU setup did not appear: ${err.message}`)
    await browser.close()
    process.exit(1)
  }
}

export async function waitForSetup(page, timeout = 15000) {
  await page.waitForSelector(SEL.setup, { timeout })
}

// The card data setup was built from: every base, as the app stores it.
export async function readBases(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('swu_bases_cache')
    return raw ? JSON.parse(raw).data : []
  })
}

export const baseLabel = b => `${b.set}-${b.number} ${b.name} (${b.set} · ${b.hp} HP)`

// Patch a user setting. A reload is needed for the app to read it.
export async function setSetting(page, key, value) {
  await page.evaluate(([key, value]) => {
    const settings = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
    settings[key] = value
    localStorage.setItem('user_settings', JSON.stringify(settings))
  }, [key, value])
}

// Opens the base sheet from Your base: "Choose your base" when none is chosen,
// "Change base" otherwise.
export async function openBaseSheet(page) {
  await page.locator(SEL.baseCard).getByRole('button', { name: /Choose your base|Change base/ }).click()
  await page.waitForSelector(SEL.sheet)
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Chooses a base through the base sheet: search by name, tap the tile whose
// name and "SET · HP" line match. Returns the time of the tap (Date.now()), or
// null if no such tile is offered.
export async function chooseBase(page, base) {
  await openBaseSheet(page)
  await page.fill(SEL.search, base.name)
  const tile = page
    .locator(`${SEL.sheet} [role="group"][aria-label="Results"] button`)
    .filter({ hasText: new RegExp(`^${escapeRegExp(base.name)}${escapeRegExp(`${base.set} · ${base.hp} HP`)}$`) })
    .first()
  try {
    await tile.waitFor({ timeout: 3000 })
  } catch {
    await page.keyboard.press('Escape')
    await page.waitForSelector(SEL.sheet, { state: 'detached' })
    return null
  }
  const tappedAt = Date.now()
  await tile.click()
  await page.waitForSelector(SEL.sheet, { state: 'detached' })
  return tappedAt
}

// Resolves once the art on Your base has loaded and is shown.
export async function waitForPreviewImage(page, base, timeout) {
  await page.waitForFunction(
    ([cardSel, name]) => {
      const img = [...document.querySelectorAll(`${cardSel} img`)].find(i => i.alt === name)
      return !!img && img.complete && img.naturalWidth > 0 && img.parentElement.style.opacity !== '0'
    },
    [SEL.baseCard, base.name],
    { timeout },
  )
}

export async function goToGame(page) {
  await page.getByRole('button', { name: 'Go to game' }).click()
  await page.waitForSelector(SEL.gameCard, { timeout: 10000 })
}

// Resolves once the base art on the game screen has loaded and is shown.
export async function waitForGameImage(page, timeout) {
  await page.waitForFunction(
    sel => {
      const img = document.querySelector(sel)
      return !!img && img.complete && img.naturalWidth > 0 && img.style.display === 'block'
    },
    SEL.gameImage,
    { timeout },
  )
}

export async function backToSetup(page) {
  await page.click(SEL.gameBack)
  await waitForSetup(page, 10000)
}
