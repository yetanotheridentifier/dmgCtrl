# dmgCtrl — Project Overview

A Progressive Web App for tracking game state in tabletop games, supporting Star Wars: Unlimited (SWU) and Star Wars X-Wing. Built to run on iPhone in landscape mode, installed via Safari "Add to Home Screen". No App Store, no native build tools required.

**Live app:** https://yetanotheridentifier.github.io/dmgCtrl/

**GitHub repo:** https://github.com/yetanotheridentifier/dmgCtrl

## Roadmap

### X-Wing (in progress)
- ✅ Game screen — pre-game deficit entry (0–4 per side), dual score counters (0–50), drag scrubber on all buttons, result banner centred between scores at game over
- ✅ Timer — configurable countdown (default 75 min, 5:30–90 min via Settings); starts with the game; freezes on game over or round 12; displayed in centre column
- ✅ Round tracker — continuous bar spanning the top of the screen between the nav buttons; 12 segments; current round extends downward as a seamless tab; tapping the next segment advances the round; colour follows the timer (accent → warning → error); timer stops at round 12
- ✅ Action log — all entries undoable (Round 1, round advances, score changes); entries styled consistently with SWU log; undoing Round 1 resets the timer; score entries use semantic colours (green = you scored / opponent lost points, red = opponent scored / you lost points)
- ✅ Help screen
- ✅ Initiative bar — vertical bar in the left column; slides between OPP/YOU; resets to neutral on round advance; shared component with SWU
- Remaining features — includes applying stored deficit to score when opponent ships are destroyed

### Future games
- Kill Team
- Warhammer 40K
- Mordheim / Old World

### Infrastructure
- Per-game theming (X-Wing aesthetic vs SWU aesthetic)
- Melee.gg integration (API exists, partially public)

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

### Base validation script

`scripts/validate-bases.mjs` automates the visual QA process for all bases. It opens a visible Chromium window and iterates through every set / aspect / base, navigating to the game screen for each one. You watch while it runs; the script handles the navigation and timing.

**One-time setup** (Playwright + Chromium browser binary):
```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

**Running the script:**
1. Start the dev server: `npm run dev`
2. In a separate terminal: `node scripts/validate-bases.mjs`

The script logs each base as it goes:
```
[1] SOR / Aggression / Catacombs of Cadera
[2] SOR / Cunning / Energy Conversion Lab
...
Validation complete — 42 bases checked.
```

Timing can be adjusted via `VISUAL_PAUSE_MS` and `BACK_PAUSE_MS` at the top of the script.

### Error message validation script

`scripts/validate-errors.mjs` automates the visual QA process for all five error and information message states. It opens a visible Chromium window and steps through each scenario in sequence, pausing for visual inspection before advancing.

**Scenarios covered:**
1. SWUDB Import — "Invalid deck URL" (invalid URL typed)
2. SWUDB Import — "Deck not accessible" (unreachable deck URL)
3. Base Selector — "No base images found" (all images blocked via Playwright route interception)
4. Base Selector — "Hyperspace variant not found" (useHyperspace on, base without hyperspace art)
5. Base Selector — "Only hyperspace image available" (useHyperspace off, normal art blocked for a base that has hyperspace art)

**One-time setup** (Playwright + Chromium browser binary):
```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

**Running the script:**
1. Start the HTTPS dev server: `npm run dev:https`
2. In a separate terminal: `node scripts/validate-errors.mjs`

The script can also be pointed at a custom URL (e.g. the local network HTTPS address for device testing):
```
node scripts/validate-errors.mjs https://192.168.1.100:5173/dmgCtrl/
```

Timing can be adjusted via `VISUAL_PAUSE_MS` at the top of the script.

### Performance measurement script

`scripts/measure-performance.mjs` measures key timings across N iterations (default 5) and reports min / median / max:

| Metric | What it measures |
|---|---|
| **Setup ready** | Navigation start → set selector enabled (covers loading screen + base data fetch) |
| **Preview image** | First base selected → card image visible in setup screen |
| **Game (low res)** | Start clicked → card image visible — TS26 base (`frontArtLowRes` only, no CDN art) |
| **Game (normal res)** | Start clicked → card image visible — LAW-021 (`frontArt` from CDN) |
| **Game (hi res)** | Start clicked → card image visible — SOR-019 with hyperspace on (`hyperspaceArtHiRes` / SOR-285) |

LCP is also captured per run (largest element painted before first interaction).

**One-time setup** (Playwright + Chromium browser binary):
```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

**Running the script:**
1. Start the dev server: `npm run dev`
2. In a separate terminal: `node scripts/measure-performance.mjs`

```
node scripts/measure-performance.mjs                          # 5 iterations, warm cache
node scripts/measure-performance.mjs http://... 10           # 10 iterations
node scripts/measure-performance.mjs http://... 5 --cold     # clear cache before each run
```

Sample output (warm cache):
```
[ 1/5]  setup    88 ms  lcp    80 ms  preview    49 ms  game-low   137 ms  game-normal    47 ms  game-hi    43 ms    (SOR / Catacombs of Cadera)
...

────────────────────────────────────────────────────────────────
Metric                     min  median     max
────────────────────────────────────────────────────────────────
Setup ready                 88 ms    93 ms   100 ms
LCP                         80 ms    88 ms    92 ms
Preview image               49 ms    50 ms   146 ms
Game (low res)             137 ms   176 ms   384 ms
Game (normal res)           47 ms    63 ms   134 ms
Game (hi res)               43 ms    60 ms   111 ms
────────────────────────────────────────────────────────────────
```

Use `--cold` to simulate a first-time user (clears `swu_bases_cache` before each run). Default is warm cache, which reflects the typical returning-user experience. The Chromium window must remain visible during measurement — LCP is not recorded for hidden pages.

## Notes for AI Assistants

- `npm install` requires `--legacy-peer-deps` due to Vite / vite-plugin-pwa version conflict
- The app is designed for **landscape iPhone** — portrait mode is functional but not the primary target
- swu-db.com blocks direct browser requests (CORS) — all calls go via the Cloudflare Worker proxy at `https://worker.dmgctrl.app`
- swuapi.com has CORS enabled and can be called directly from the browser
- Set codes: `SOR` (Spark of Rebellion), `SHD` (Shadows of the Galaxy), `TWI` (Twilight of the Republic), `JTL` (Jump to Lightspeed), `LOF` (Legends of the Force), `SEC` (Secrets of Power), `LAW` (A Lawless Time), `IBH` (Intro Battle: Hoth)
- The owner's handle is `yetanotheridentifier` — replace in any URLs
- Tests use `--legacy-peer-deps` in the GitHub Actions install step
- `vmin` units are used for game screen sizing to work correctly across orientations
- localStorage cache must be cleared (`localStorage.removeItem('swu_bases_cache')`) when testing data layer changes
- Always use `npm test` to run tests — `npx vitest run` has a cache glitch causing spurious first-run failures
- Run a filtered test summary: `npm test 2>&1 | grep -E "×|FAIL|Tests|Test Files"`
- Run a single test file: `npm test -- src/test/swuSetupScreen.test.tsx`
- SWUDB deck URL format: `https://swudb.com/deck/<id>` where `<id>` is alphanumeric, variable length. Edit links (`/deck/edit/<id>`) are normalised automatically. Validation regex: `/^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/`
- The Cloudflare Worker at `worker.dmgctrl.app` also proxies `swudb.com/api/deck/<id>` under the path `/swudb/deck/<id>` — this is how `fetchSwudbDeck` retrieves deck data
- The Force button visibility is controlled by `forceTokenDisplay` (default: `'lof-only'`). `'always-on'` shows the Force button for every base. `'lof-only'` shows it only for LOF Force bases (epicAction matches `/the force is with you/i`) that are not Mystic Monastery. `'always-off'` hides the Force button everywhere. LOF Force bases start in a ready/enabled state; non-Force bases start locked (one enable tap required). Mystic Monastery has its own counter button instead of the Force button in lof-only mode — it shows alongside the Force button in always-on mode, and is hidden entirely in always-off mode.
- `public/dmgCtrl-force-token.png` is the Force token icon (512×512 PNG); used on the Force button and as a watermark inside the Force token overlay
- App icon file: `public/dmgCtrl-icon-transparent-192.png` — transparent PNG icon used on the loading screen, the game select screen header, the help screen header, and the settings screen header
- The app starts on a `SwuLoadingScreen` (screen type `'loading'`) which shows the app icon and "LOADING" text while `useBases()` resolves. The loading screen transitions to setup as soon as `useBases()` resolves — there is no minimum display time. `App.tsx` calls `useBases()` at the top level to drive this transition; `SwuSetupScreen` also calls `useBases()` internally (via `useSwuSetup`) for its own state, resulting in two fetches — both are fast in practice due to the 24-hour localStorage cache.
- The game select screen header shows the app icon (`5vw × 5vw`) + **"dmgCtrl"** h1. The SWU setup screen header shows **"dmgCtrl"** h1 only (no icon) so the title lands at the same horizontal position as game select. The help screen heading is **"Help"** alongside the app icon. The settings screen heading is **"Settings"** alongside the app icon. The app name "dmgCtrl" is used as the `alt` text for the icon image.
- Cloudflare Web Analytics beacon is embedded in `index.html` (token `019fc29a88ac474bab2170fe6a1f8424`, registered for `dmgctrl.app`). This is a public token — not a secret. It tracks page loads (app starts) only; custom game events use the Worker + InfluxDB pipeline.
- Screen Wake Lock (`useWakeLock`) is active on the game screen when `enableWakeLock` is true in user settings (default: on). It uses `navigator.wakeLock.request('screen')` and requires iOS 16.4+ when installed as a PWA; it is not available in a regular Safari tab. The hook silently no-ops if the API is absent. Focus mode / Do Not Disturb cannot be controlled from a PWA — users must enable it manually.
- `useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events for reliable iOS detection (not `orientationchange` or `resize`, which are unreliable in iOS standalone PWA mode). It returns `isPortrait` and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, stable across rotations; `window.innerWidth`/`innerHeight` can get stuck at landscape values on iOS).
- **Do not use `system-ui` or `-apple-system` in CSS class font stacks** (e.g. in `index.css`). On iOS 17+, these trigger Dynamic Type which overrides explicit font sizes in landscape mode regardless of `-webkit-text-size-adjust`. Use `Helvetica, Arial, sans-serif` instead. For inline styles, set `fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif"` and `WebkitTextSizeAdjust: '100%'` on the container — this is the pattern used by both the help screen (via `.help-content` CSS class) and the settings screen (via inline style on the outer div).
- `src/test/setup.ts` includes a global `matchMedia` mock that defaults to landscape. Tests that need portrait orientation should call `makeMatchMediaMock(true)` (imported from `./setup`). The settings screen tests mock `useOrientation` directly via `vi.mock('../hooks/useOrientation', ...)` with a `vi.hoisted` object to allow per-test orientation control.
- `useUserSettings` is a **React Context** — `UserSettingsProvider` (from `src/hooks/useUserSettings.ts`) wraps the entire app in `main.tsx` so all screens share one settings instance. Changes in the settings screen propagate immediately to the game screen without requiring a restart. Preferences are persisted to localStorage under key `user_settings` as JSON. `forceTokenDisplay` is a 3-way string ('always-on' | 'lof-only' | 'always-off'), defaulting to `'lof-only'`. Six other boolean preferences (`useHyperspace`, `enableEpicActions`, `enableWakeLock`, `enableFavourites`, `enableLongPress`, `enableActionLog`) default to `true`. `enableCompetitiveMode` defaults to `false`. `bo1TimerMinutes` defaults to `25`; `bo3TimerMinutes` defaults to `55` — both adjustable in 5-minute increments (5–90) via steppers in Settings (visible only when `enableCompetitiveMode` is on). `xwingTimerMinutes` defaults to `75` — adjustable via a stepper in Settings (always visible in the X-Wing section) using a non-uniform values list `[5.5, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]`; `5.5` is a test value formatted as '5:30 (test)'. Migrates the old `enableForceToken` boolean (false → 'always-off', true/missing → 'lof-only'). Handles corrupt/missing storage gracefully by falling back to defaults.
- `useTimer` is a countdown hook (`src/hooks/useTimer.ts`) that takes `durationSeconds`. Returns `{ remaining, isRunning, isExpired, start, stop, reset }`. `start()` is idempotent — a `startedRef` flag ensures calling it multiple times does nothing after the first call. `stop()` freezes `remaining` at its current value (sets `isRunning = false`) without resetting to the full duration — used when a terminal game condition is reached. Remaining is computed from the wall-clock elapsed time (`Date.now() - startTimeRef`) rather than by counting interval ticks, so the timer stays accurate when the device screen turns off and JavaScript timers are throttled. A `visibilitychange` listener calls `recalculate()` immediately when the page becomes visible again. `isExpired` is `remaining === 0`. Used by both SWU game screen (duration = `bo1TimerMinutes * 60` or `bo3TimerMinutes * 60`) and X-Wing game screen (duration = `xwingTimerMinutes * 60`). In SWU: Draw is only available pre-first-game (`isPreFirstGame = round === 0 && gamesPlayed === 0`) or when the timer has expired — not between Bo3 games.
- `useTournament` manages tournament state (`src/hooks/useTournament.ts`). Exports `TournamentState` (base, format, playMode, totalRounds, rounds[]) and `TournamentRound` (roundNumber, playerScore, opponentScore, result: 'won'|'lost'|'drawn'|null, submitted). Persists to localStorage under `tournament_state`. `startMatch` uses functional `setState(prev => ...)` to avoid stale-closure bugs. `App.tsx` restores the `'tournament'` screen on load when `tournament !== null`.
- `useMatch` manages match scores and state for competitive play (`src/hooks/useMatch.ts`). Returns `{ playerScore, opponentScore, matchOver, matchResult, incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState }`. `matchResult` is `'won' | 'lost' | 'drawn' | null` — derived from scores (winning score for the play mode reached) or from `matchDrawn`/`matchClosedByTimer` flags (using current score gap to decide won/lost/drawn). `recordDraw()` sets `matchDrawn = true`; `closeByTimer()` sets `matchClosedByTimer = true` (called after a win/loss when the timer is already expired, to prevent further games in Bo3). `restoreState` accepts `{ playerScore, opponentScore, matchDrawn?, matchClosedByTimer? }`.
- `useGameHistory<TSnapshot>` (`src/hooks/useGameHistory.ts`) is a generic action-log hook used by both SWU and X-Wing. Each `HistoryEntry<TSnapshot>` records `id`, `type`, `message`, `color`, `snapshot` (full game state before the action). API: `{ entries, add, undoLast, reset }`. `undoLast()` pops and returns the last entry (or `null` if empty) so the caller can restore the snapshot. SWU uses `useGameHistory<SwuGameSnapshot>` where `SwuGameSnapshot = { gameState: GameState, matchState: { playerScore, opponentScore, matchDrawn, matchClosedByTimer }, lastGameResult }`.
- `GameLogOverlay` renders the scrollable log panel on the left side of the game screen (left-anchored at 8vw, expanding rightward). Shared by SWU and X-Wing. Auto-scrolls to the latest entry. Undo button on the last entry when `undoable !== false`. Round-type entries get a blue gradient header (`rgba(59,130,246,0.2) → rgba(59,130,246,0)`) with flat bottom corners and a top separator border — applied to every round entry including the first.
- `App.tsx` keeps `SwuGameScreen` mounted during help/settings navigation via a `display: none` wrapper controlled by an `isInGame` flag. Game state (damage counter, log, round) is preserved while the user browses settings — no restart required.
- `useDragScrubber` implements the long-press drag-to-scrub gesture on the `+`/`−` counter buttons. Signature: `useDragScrubber(onIncrement, onDecrement, maxIncrement, maxDecrement, enabled)`. Dead zone: 15px; step: 14px per point; max: 20; caps at `Math.min(max, 20)`. Suppresses the synthetic click event that follows a pointer-up via a `dragApplied` ref. Disabled when `enabled` is false or the reachable cap < 2. Returns `{ dragIndicator, handleClick, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel }`.
- The settings screen (`SettingsScreen` / `SettingsScreenView`) is always available — a ⚙ button appears on the setup and game screens (top-right, alongside or below the `?` help button). The settings screen has its own `?` help button which always opens `settingsHelp.md`, regardless of which screen settings was opened from. The container calls both `useUserSettings()` and `useFavourites()`. The view renders three tabs — **General** (Start Screen selector, Wake Lock toggle, Action Log toggle), **SWU** (Use Hyperspace Art, Force Token Display, Enable Epic Actions, Enable Competitive Mode + sub-settings when on: Bo1 Timer, Bo3 Timer steppers and Melee Player ID input; Enable Favourites + saved-bases list when on), **X-Wing** (Game Timer stepper). In portrait, tabs are a horizontal bar across the top; in landscape, a vertical sidebar with rotated labels. `SettingsScreenView` calls `useOrientation()` directly — not via props — to avoid iOS Dynamic Type scaling issues.
