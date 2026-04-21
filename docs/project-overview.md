# dmgCtrl — Project Overview

A Progressive Web App for tracking game state in tabletop games, starting with Star Wars: Unlimited (SWU). Built to run on iPhone in landscape mode, installed via Safari "Add to Home Screen". No App Store, no native build tools required.

**Live app:** https://yetanotheridentifier.github.io/dmgCtrl/
**GitHub repo:** https://github.com/yetanotheridentifier/dmgCtrl

---

## Planned Features

### SWU game screen
- Epic action tracker (boolean flag, with exceptions for multi-use bases)
- Force token tracker (for specific bases)
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
- Settings screen (consolidate localStorage preferences)
- Per-game theming (X-Wing aesthetic vs SWU aesthetic)
- Deck lookup via swudb.com API (`/api/getDeckJson/{deckId}`)
- Melee.gg integration (API exists, partially public)

---

## Known Issues

- **Toggle styling** — Hyperspace variant toggle renders as a native checkbox rather than a toggle switch. CSS-only toggle implementation planned.

---

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
