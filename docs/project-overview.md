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
- Settings screen — ticket #5 covers migrating the remaining build-time flags (`FEATURE_EPIC_ACTION`, `FEATURE_FORCE_TOKEN`, `FEATURE_WAKE_LOCK`) to user preferences on the settings screen (UI delivered in #113; `FEATURE_USER_SETTINGS` gates it until #5 is complete)
- Per-game theming (X-Wing aesthetic vs SWU aesthetic)
- Melee.gg integration (API exists, partially public)
- Analytics custom events: game starts and base popularity via Cloudflare Worker + InfluxDB (issues #97, #98, #99)

## Known Issues

- **Toggle styling** — Hyperspace variant toggle renders as a native checkbox rather than a toggle switch. CSS-only toggle implementation planned.

## Development

### Local dev server

`npm run dev` — plain HTTP on localhost. Sufficient for visual and layout testing.

`npm run dev:https` — HTTPS on the local network (requires mkcert; see setup below). Required for service worker, wake lock, install prompt, and OAuth redirect testing. The service worker is disabled in dev mode (`devOptions: { enabled: false }` in `vite.config.ts`) to prevent stale caching between reloads.

### One-time HTTPS setup (mkcert)

1. Install mkcert: `winget install FiloSottile.mkcert`
2. Register the root CA with Windows: `mkcert -install`
3. **iOS trust (once per device) — two separate steps, both required:**
   - Find the CA file: `mkcert -CAROOT` gives the folder path; the file is `rootCA.pem`
   - AirDrop or email `rootCA.pem` to the iPhone
   - On iPhone: open the file from the Files app → iOS redirects to Settings → General → VPN & Device Management → install the profile
   - **Then separately:** Settings → General → About → Certificate Trust Settings → enable full trust for the mkcert certificate. This second step is required — installing the profile alone is not enough and will result in a "not trusted" warning in Safari.

After setup, `npm run dev:https` will print a local network URL (e.g. `https://192.168.x.x:5173/dmgCtrl/`). Open that URL in Safari on the device.

## Notes for AI Assistants

- `npm install` requires `--legacy-peer-deps` due to Vite / vite-plugin-pwa version conflict
- **File edits:** prefer Node.js scripts for all source file edits (`.ts`, `.tsx`, `.css`, `package.json`, etc.) — Windows CRLF line endings cause the Edit tool to fail silently. For `.md` files use the Write tool (full rewrite). Never use PowerShell file-write cmdlets (corrupts non-ASCII characters).
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
- Feature flags live in `src/flags.ts`. Most flags default to `true` and can be disabled by setting the corresponding `VITE_FEATURE_*` env var to `'false'`. `FEATURE_USER_SETTINGS` is **inverted** — it defaults to `false` and requires `VITE_FEATURE_USER_SETTINGS=true` to enable locally. Current flags: `FEATURE_EPIC_ACTION`, `FEATURE_FORCE_TOKEN`, `FEATURE_WAKE_LOCK`, `FEATURE_USER_SETTINGS`.
- The Force button is shown for **all bases** when `FEATURE_FORCE_TOKEN` is enabled. LOF Force bases (whose `epicAction` text matches `/the force is with you/i`) start in a ready/enabled state; all other bases start in a locked/dimmed state that requires one enable tap before the Force can be gained. This covers the case where a non-Force base gains the Force via a card or leader ability.
- `public/dmgCtrl-force-token.png` is the Force token icon (512×512 PNG); used on the Force button and as a watermark inside the Force token overlay
- App icon file: `public/dmgCtrl-icon-transparent-192.png` — transparent PNG icon used on the loading screen and alongside titles on the setup and help screens
- The app starts on a `SwuLoadingScreen` (screen type `'loading'`) which shows the app icon and "LOADING" text while `useBases()` resolves. The loading screen has a **1-second minimum display time** — even if data loads instantly, it stays visible for at least 1 second before calling `onReady`. `App.tsx` calls `useBases()` at the top level to drive this transition; `SwuSetupScreen` also calls `useBases()` internally (via `useSwuSetup`) for its own state, resulting in two fetches — both are fast in practice due to the 24-hour localStorage cache.
- The setup screen title is **"dmgCtrl"**, displayed alongside the app icon. The help screen heading is **"Help"** alongside the app icon. The settings screen heading is **"Settings"** alongside the app icon. The app name "dmgCtrl" is used as the `alt` text for the icon image across all screens.
- Cloudflare Web Analytics beacon is embedded in `index.html` (token `aaed1e18376f4bdd9f56a0050acce291`). This is a public token — not a secret. It tracks page loads (app starts) only; game start events require the Worker + InfluxDB pipeline (issues #97–#99).
- Screen Wake Lock (`useWakeLock`) is active on the game screen when `FEATURE_WAKE_LOCK` is enabled. It uses `navigator.wakeLock.request('screen')` and requires iOS 16.4+ when installed as a PWA; it is not available in a regular Safari tab. The hook silently no-ops if the API is absent. Focus mode / Do Not Disturb cannot be controlled from a PWA — users must enable it manually.
- `useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events for reliable iOS detection (not `orientationchange` or `resize`, which are unreliable in iOS standalone PWA mode). It returns `isPortrait` and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, stable across rotations; `window.innerWidth`/`innerHeight` can get stuck at landscape values on iOS).
- **Do not use `system-ui` or `-apple-system` in CSS class font stacks** (e.g. in `index.css`). On iOS 17+, these trigger Dynamic Type which overrides explicit font sizes in landscape mode regardless of `-webkit-text-size-adjust`. Use `Helvetica, Arial, sans-serif` instead. For inline styles, set `fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif"` and `WebkitTextSizeAdjust: '100%'` on the container — this is the pattern used by both the help screen (via `.help-content` CSS class) and the settings screen (via inline style on the outer div).
- `src/test/setup.ts` includes a global `matchMedia` mock that defaults to landscape. Tests that need portrait orientation should call `makeMatchMediaMock(true)` (imported from `./setup`).
- HTTPS local dev: `npm run dev:https` serves over HTTPS on the local network using `vite-plugin-mkcert`. Requires mkcert installed and `mkcert -install` run once; iOS devices need the root CA manually trusted (see Development section above). The service worker is disabled in dev mode to prevent stale caching.
- `useUserSettings` hook persists user preferences to localStorage under key `user_settings` as JSON. All four preferences (`useHyperspace`, `enableForceToken`, `enableEpicActions`, `enableWakeLock`) default to `true`. The hook handles corrupt/missing storage gracefully by falling back to defaults for any missing key.
- The settings screen (`SwuSettingsScreen` / `SwuSettingsScreenView`) is gated by `FEATURE_USER_SETTINGS`. When enabled, a ⚙ button appears on the setup and game screens (top-right, alongside or below the `?` help button). `SwuSettingsScreenView` calls `useOrientation()` directly — not via props — to avoid iOS Dynamic Type scaling issues. Tests that control `FEATURE_USER_SETTINGS` per-test use `vi.hoisted(() => ({ value: false }))` with a getter in `vi.mock('../flags', ...)`.