# dmgCtrl — Project Overview

A Progressive Web App for tracking game state in tabletop games, starting with Star Wars: Unlimited (SWU). Built to run on iPhone in landscape mode, installed via Safari "Add to Home Screen". No App Store, no native build tools required.

**Live app:** https://yetanotheridentifier.github.io/dmgCtrl/

**GitHub repo:** https://github.com/yetanotheridentifier/dmgCtrl

## Planned Features

### SWU game screen
- Round tracker

### Setup screen
- Format selector (Premier, Sealed, Draft, Twin Suns, Eternal, Chaos)
- Format drives which sets are legal for base selection
- Best of 1 / Best of 3 selector
- Game counter within a match

### Future games
- X-Wing (requires round tracker)
- Kill Team (requires round tracker)
- Warhammer 40K
- Mordheim / Old World

### Infrastructure
- Settings screen (consolidate localStorage preferences — ticket #5; will convert FEATURE_EPIC_ACTION, FEATURE_FORCE_TOKEN, and FEATURE_WAKE_LOCK flags to user preferences)
- Per-game theming (X-Wing aesthetic vs SWU aesthetic)
- Melee.gg integration (API exists, partially public)
- Analytics custom events: game starts and base popularity via Cloudflare Worker + InfluxDB (issues #97, #98, #99)

## Known Issues

- **Toggle styling** — Hyperspace variant toggle renders as a native checkbox rather than a toggle switch. CSS-only toggle implementation planned.

## Notes for AI Assistants

- `npm install` requires `--legacy-peer-deps` due to Vite / vite-plugin-pwa version conflict
- The app is designed for **landscape iPhone** — portrait mode is functional but not the primary target
- swu-db.com blocks direct browser requests (CORS) — all calls go via the Cloudflare Worker proxy at `https://swu-proxy.dmgctrl.workers.dev`
- swuapi.com has CORS enabled and can be called directly from the browser
- Set codes: `SOR` (Spark of Rebellion), `SHD` (Shadows of the Galaxy), `TWI` (Twilight of the Republic), `JTL` (Jump to Lightspeed), `LOF` (Legends of the Force), `SEC` (Secrets of Power), `LAW` (A Lawless Time), `IBH` (Intro Battle: Hoth)
- The owner's handle is `yetanotheridentifier` — replace in any URLs
- Tests use `--legacy-peer-deps` in the GitHub Actions install step
- `vmin` units are used for game screen sizing to work correctly across orientations
- localStorage cache must be cleared (`localStorage.removeItem('swu_bases_cache')`) when testing data layer changes
- Always use `npm test` to run tests — `npx vitest run` has a cache glitch causing spurious first-run failures
- Run a filtered test summary in PowerShell: `npm test 2>&1 | Select-String "×|FAIL|Tests|Test Files"`
- Run a single test file: `npm test -- src/test/swuSetupScreen.test.tsx`
- SWUDB deck URL format: `https://swudb.com/deck/<id>` where `<id>` is alphanumeric, variable length. Edit links (`/deck/edit/<id>`) are normalised automatically. Validation regex: `/^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/`
- The Cloudflare Worker at `swu-proxy.dmgctrl.workers.dev` also proxies `swudb.com/api/deck/<id>` under the path `/swudb/deck/<id>` — this is how `fetchSwudbDeck` retrieves deck data
- Feature flags live in `src/flags.ts`. Each flag defaults to `true` and can be disabled by setting the corresponding `VITE_FEATURE_*` env var to `'false'`. Current flags: `FEATURE_EPIC_ACTION`, `FEATURE_FORCE_TOKEN`, `FEATURE_WAKE_LOCK`. Ticket #5 will convert these to user preferences on a settings screen.
- The Force button is shown for **all bases** when `FEATURE_FORCE_TOKEN` is enabled. LOF Force bases (whose `epicAction` text matches `/the force is with you/i`) start in a ready/enabled state; all other bases start in a locked/dimmed state that requires one enable tap before the Force can be gained. This covers the case where a non-Force base gains the Force via a card or leader ability.
- `public/dmgCtrl-force-token.png` is the Force token icon (512×512 PNG); used on the Force button and as a watermark inside the Force token overlay
- App icon file: `public/dmgCtrl-icon-transparent-192.png` — transparent PNG icon used on the loading screen and alongside titles on the setup and help screens
- The app starts on a `SwuLoadingScreen` (screen type `'loading'`) which shows the app icon and "LOADING" text while `useBases()` resolves. The loading screen has a **1-second minimum display time** — even if data loads instantly, it stays visible for at least 1 second before calling `onReady`. `App.tsx` calls `useBases()` at the top level to drive this transition; `SwuSetupScreen` also calls `useBases()` internally (via `useSwuSetup`) for its own state, resulting in two fetches — both are fast in practice due to the 24-hour localStorage cache.
- The setup screen title is **"dmgCtrl"**, displayed alongside the app icon. The help screen heading is **"Help"** alongside the app icon. The app name "dmgCtrl" is used as the `alt` text for the icon image across all screens.
- Cloudflare Web Analytics beacon is embedded in `index.html` (token `aaed1e18376f4bdd9f56a0050acce291`). This is a public token — not a secret. It tracks page loads (app starts) only; game start events require the Worker + InfluxDB pipeline (issues #97–#99).
- Screen Wake Lock (`useWakeLock`) is active on the game screen when `FEATURE_WAKE_LOCK` is enabled. It uses `navigator.wakeLock.request('screen')` and requires iOS 16.4+ when installed as a PWA; it is not available in a regular Safari tab. The hook silently no-ops if the API is absent. Focus mode / Do Not Disturb cannot be controlled from a PWA — users must enable it manually.