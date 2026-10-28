# dmgCtrl — Project Overview

A Progressive Web App for tracking game state in tabletop games, supporting Star Wars: Unlimited (SWU) and Star Wars X-Wing. Built to run on iPhone in landscape mode, installed via Safari "Add to Home Screen". No App Store, no native build tools required.

**Live app:** https://dmgctrl.app

**GitHub repo:** https://github.com/yetanotheridentifier/dmgCtrl

## Roadmap

### X-Wing (in progress)
- ✅ Setup screen — rebuilt with the shared controls: Back / More (Squad lists, Help, Settings); a card per player — your list remembered and pre-filled, the opponent's asking "Choose opponent's list" with last game's opponent one tap away; each opens a list sheet (saved lists with points and faction, Import XWS, No list last with a manual deficit 0–4, the only deficit shown); the card shows the list's name, points, faction and a pilot summary ("3 × Academy Pilot"); a list's deficit is `50 − total points`; Match (Casual/Tournament), Tournament's primary Start tournament opening a start sheet with Rounds (2–10); Scenario sheet (None + 5 named) with a roll button; "Go to game" enabled once both have chosen; the opponent's choice, deficits and scenario are kept across Squad Lists, Help, Settings and a game (rematch from Back) and reset when you leave X-Wing; portrait + landscape layouts; match type and rounds persisted to localStorage
- ✅ Game screen — receives deficit values as props from setup screen; scores start at 0; deficit is awarded to your score when all opponent ships are destroyed (bundled with the last ship's points so undo reverts both); dual score counters (0–50); drag scrubber on all buttons when no lists loaded; result banner at game over
- ✅ Timer — configurable countdown (default 75 min, set in the game's round and timer sheet before Start game); starts with the game; runs until game over (does not stop at round 12); displayed in centre column
- ✅ Round tracker — continuous bar spanning the top of the screen; 12 segments; current round extends downward as a seamless tab; colour follows the timer (accent → warning → error)
- ✅ Phase tracker — optional button in the centre column; cycles Planning → System → Activation → Engagement → End; End advances the round or ends the game at round 12 / timer expiry; initiative locked during non-Planning phases; gated by the Phase tracker setting (off for a new install; an existing player keeps the value they had, on if they never changed it)
- ✅ Game end — triggered by End phase at round 12/timer expiry, or score reaching 50; result (Win/Loss/Draw) calculated from scores; game-end is a log entry so it is fully undoable
- ✅ Action log — all entries undoable including game-end; undoing game-end resumes the timer from where it was stopped; score entries use semantic colours
- ✅ Help screen: the X-Wing help page (Setup, Squad lists, Game, Tournament, Rules), opened at the section for the screen it came from
- ✅ Tournament — started from setup's start sheet (Rounds 2–10); best of 1, your list fixed, the opponent chosen each round; between rounds the record (wins–losses), the margin (total of score differences), your list and every round with its score and opponent; game over in a tournament offers only Back to tournament, recording the round from the game's scores; Drop and Finish; saved under `xwing_tournament` and reopened on launch
- ✅ Initiative bar — vertical bar in the left column; slides between OPP/YOU; resets to neutral on round advance; locked during non-Planning phases when phase tracker is enabled; shared component with SWU
- ✅ Per-ship scoring (#243) — when lists are imported, each outer column shows a vertical stack of dmgCtrl icon buttons (one per ship); icon positioned inside (player icon on the right, opponent icon on the left); tap once → Damaged (awards `floor(pts/2)`, button turns amber); tap again → Destroyed (awards `ceil(pts/2)`, button removed); long-press from alive skips directly to Destroyed (awards all points); zero-point ships cycle state without scoring or logging; duplicate pilot names are numbered; each event is a separate undoable log entry; inc/dec buttons hidden when the opposing column has ship buttons or scenario scoring is active (player scores via opposing ship taps; if only one side has a list, the listless side retains inc/dec for manual scoring); **Score −/+ buttons** setting overrides all hiding rules so both pairs stay visible at all times

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

After setup, `npm run dev:https` will print a local network URL (e.g. `https://192.168.x.x:5173/`). Open that URL in Safari on the device.

### Base validation script

`scripts/validate-bases.mjs` automates the visual QA process for all bases. It opens a visible Chromium window at SWU setup (`/swu`), reads every base from the card data the app has loaded (`swu_bases_cache`), and for each one in set order chooses it in the base sheet (search by name, tap the tile), goes to the game screen and waits for the card image. You watch while it runs; the script handles the navigation and timing.

The three QA scripts share their browser setup and SWU setup steps in `scripts/qa-helpers.mjs`. Each takes the dev server address as its first argument (default `https://127.0.0.1:5173/`) and `--headless` to run without a window.

**One-time setup** (Playwright + Chromium browser binary):
```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

**Running the script:**
1. Start the dev server: `npm run dev`
2. In a separate terminal: `node scripts/validate-bases.mjs` (add `--set=LAW` to check one set)

The script logs each base as it goes, and at the end lists any base the sheet does not offer or whose image did not load:
```
[1/111] ASH-019 Fortress of the Great Mothers (ASH · 30 HP)
[2/111] ASH-020 Nevarro City, Restored (ASH · 30 HP)
...
Validation complete: 111 of 111 bases checked.
```

Timing can be adjusted via `VISUAL_PAUSE_MS`, `IMAGE_TIMEOUT_MS` and `BACK_PAUSE_MS` at the top of the script.

### Error message validation script

`scripts/validate-errors.mjs` automates the visual QA process for all five error and information message states on SWU setup. It opens a visible Chromium window and steps through each scenario in sequence, pausing for visual inspection before advancing.

**Scenarios covered:**
1. Base sheet, Paste SWUDB link: "Invalid deck URL" (invalid URL typed)
2. Base sheet, Paste SWUDB link: "Deck not accessible" (unreachable deck loaded)
3. Your base: "No base images found" (all images blocked via Playwright route interception, then a base chosen)
4. Your base: "Hyperspace variant not found" (useHyperspace on, base without hyperspace art)
5. Your base: "Only hyperspace image available" (useHyperspace off, normal art blocked for a base that has hyperspace art)

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
node scripts/validate-errors.mjs https://192.168.1.100:5173/
```

Timing can be adjusted via `VISUAL_PAUSE_MS` at the top of the script.

### Performance measurement script

`scripts/measure-performance.mjs` measures key timings across N iterations (default 5) and reports min / median / max:

| Metric | What it measures |
|---|---|
| **Setup ready** | Reload → SWU setup shown with no base chosen (covers loading screen + base data fetch) |
| **Preview image** | LAW-021's tile tapped in the base sheet → its art shown on Your base |
| **Game (low res)** | Go to game tapped → card image shown: the first TS26 base (`frontArtLowRes` only, no CDN art) |
| **Game (normal res)** | Go to game tapped → card image shown: LAW-021 (`frontArt` from CDN) |
| **Game (hi res)** | Go to game tapped → card image shown: SOR-019 with hyperspace on (`hyperspaceArtHiRes` / SOR-285) |

LCP is also captured per run (largest element painted before first interaction). Each run clears the saved setup (`swu_setup`) before reloading, so every choice is a change.

**These numbers are not comparable with runs made before the base sheet.** Setup ready used to end when the set select was enabled, the preview was timed from the first select change, and the game image from the old Start button.

**One-time setup** (Playwright + Chromium browser binary):
```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

**Running the script:**
1. Start the dev server: `npm run dev`
2. In a separate terminal: `node scripts/measure-performance.mjs`

```
node scripts/measure-performance.mjs                           # 5 iterations, warm cache
node scripts/measure-performance.mjs https://... 10           # 10 iterations
node scripts/measure-performance.mjs https://... 5 --cold     # clear cache before each run
```

Sample output (warm cache, headless, dev server):
```
[ 1/3]  setup    196 ms  lcp    188 ms  preview    209 ms  game-low    971 ms  game-normal     55 ms  game-hi    836 ms
...

Preview: LAW-021 Coaxium Mine (LAW · 27 HP)
Game (low res): TS26-009 First Battle Memorial (TS26 · 27 HP)
Game (normal res): LAW-021 Coaxium Mine (LAW · 27 HP)
Game (hi res): SOR-019 Security Complex (SOR · 25 HP)

────────────────────────────────────────────────────────────────
Metric                     min  median     max
────────────────────────────────────────────────────────────────
Setup ready                179 ms   187 ms   196 ms
LCP                        180 ms   184 ms   188 ms
Preview image               51 ms    54 ms   209 ms
Game (low res)             286 ms   303 ms   971 ms
Game (normal res)           49 ms    55 ms    58 ms
Game (hi res)               56 ms    57 ms   836 ms
────────────────────────────────────────────────────────────────
```

Use `--cold` to simulate a first-time user (clears `swu_bases_cache` before each run). Default is warm cache, which reflects the typical returning-user experience. In a visible window, keep it visible during measurement: LCP is not recorded for hidden pages.

## Notes for AI Assistants

- `npm install` requires `--legacy-peer-deps` due to Vite / vite-plugin-pwa version conflict
- The app is designed for **landscape iPhone** — portrait mode is functional but not the primary target
- swu-db.com blocks direct browser requests (CORS) — all calls go via the Cloudflare Worker proxy at `https://worker.dmgctrl.app`
- swuapi.com has CORS enabled and can be called directly from the browser
- Set codes with bases in the data: `SOR` (Spark of Rebellion), `SHD` (Shadows of the Galaxy), `TWI` (Twilight of the Republic), `JTL` (Jump to Lightspeed), `LOF` (Legends of the Force), `SEC` (Secrets of Power), `LAW` (A Lawless Time), `IBH` (Intro Battle: Hoth), `ASH` (Ashes of the Empire), `TS26` (2026 Twin Suns). No set list is hardcoded in the app: sets flow through from the card APIs, so a new set needs no code change
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
- App icon file: `public/dmgCtrl-icon-transparent-192.png` — transparent PNG icon used on the splash, the game select screen header, and the help screen header
- The app opens straight at its first screen (`launchScreen()` in `src/utils/appStart.ts`: a tournament in progress, then `/swu` or `/xwing`, then Start screen, Last game played by default). Only SWU setup waits for card data, and only with none cached: `SwuSplash` while it loads, `SwuOffline` if the fetch failed. `useBases()` has cached data on its first render, and its instances share one fetch.
- The game select screen header shows the app icon + **"dmgCtrl"** h1, with Help and Settings buttons on the right. The SWU setup screen header shows **"dmgCtrl"** h1 only (no icon) so the title lands at the same horizontal position as game select. The help screen heading is the page's title (**"SWU help"**, **"X-Wing help"**, or **"Help"** for the app page) beside Back, with no icon. The settings screen heading is **"Settings"** beside Back, with no icon. The app name "dmgCtrl" is used as the `alt` text for the icon image.
- Cloudflare Web Analytics beacon is embedded in `index.html` (token `019fc29a88ac474bab2170fe6a1f8424`, registered for `dmgctrl.app`). This is a public token — not a secret. It tracks page loads (app starts) only; custom game events use the Worker + InfluxDB pipeline.
- Screen Wake Lock (`useWakeLock`) is always active on the SWU and X-Wing game screens; there is no setting for it. It uses `navigator.wakeLock.request('screen')` and requires iOS 16.4+ when installed as a PWA; it is not available in a regular Safari tab. The hook silently no-ops if the API is absent. Focus mode / Do Not Disturb cannot be controlled from a PWA — users must enable it manually.
- `useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events for reliable iOS detection (not `orientationchange` or `resize`, which are unreliable in iOS standalone PWA mode). It returns `isPortrait` and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, stable across rotations; `window.innerWidth`/`innerHeight` can get stuck at landscape values on iOS).
- **The app font is set once, on `body` in `index.css`**: `'Segoe UI', system-ui, sans-serif`, so sheets and overlays rendered outside a screen's layout wrapper have it too. No component sets the font family itself (a test enforces it); controls that need it use `fontFamily: 'inherit'`, since buttons and inputs do not inherit it by default. On the iPhone in landscape, `system-ui` on `body` keeps explicit font sizes (Help and the game screens checked on the device); the Help screen and the install banner also set `-webkit-text-size-adjust: 100%`.
- `src/test/setup.ts` includes a global `matchMedia` mock that defaults to landscape. Tests that need portrait orientation should call `makeMatchMediaMock(true)` (imported from `./setup`). The settings screen tests mock `useOrientation` directly via `vi.mock('../hooks/useOrientation', ...)` with a `vi.hoisted` object to allow per-test orientation control.
- `useUserSettings` is a **React Context** — `UserSettingsProvider` (from `src/hooks/useUserSettings.ts`) wraps the entire app in `main.tsx` so all screens share one settings instance. Changes in the settings screen propagate immediately to the game screen without requiring a restart. Preferences are persisted to localStorage under key `user_settings` as JSON. `forceTokenDisplay` is a 3-way string ('always-on' | 'lof-only' | 'always-off'), defaulting to `'lof-only'`. `useHyperspace` and `enableInitiativeBar` default to `true`; `enableDamageButtons` and `enableXwingAlwaysIncDec` to `false`. `enableXwingPhases` is `false` for a new install (nothing stored under `user_settings` and none of the app's other keys) and `true` for an existing player who never set it; with nothing stored, the first load saves its result so the choice is made once. `xwingTimerMinutes` defaults to `75`, `bo1TimerMinutes` to 25 and `bo3TimerMinutes` to 55, all set on the game timers. Stored settings that still carry retired keys (`enableEpicActions`, `enableWakeLock`, `enableActionLog`, `enableFavourites`, `enableCompetitiveMode`, `enableLongPress`, `enableGameSelect`) load as before, and the keys are dropped on the next save. Migrates the old `enableForceToken` boolean. Handles corrupt storage by falling back to defaults.
- `useTimer` is a countdown hook (`src/hooks/useTimer.ts`) that takes `durationSeconds`. Returns `{ remaining, isRunning, isExpired, start, stop, reset, resume }`. `start()` is idempotent. `stop()` freezes `remaining` without resetting — preserves `startTimeRef`. `resume()` sets `isRunning = true` without clearing `startTimeRef`, so the timer picks up from the original wall-clock start time (time elapsed during the stopped period is automatically accounted for — used when undoing a game-end event). `reset()` fully clears all state. Remaining is computed from wall-clock elapsed time so the timer stays accurate after screen-off. Used by both SWU and X-Wing game screens.
- `useTournament` manages tournament state (`src/hooks/useTournament.ts`). Exports `TournamentState` (base, format, playMode, totalRounds, rounds[]) and `TournamentRound` (roundNumber, playerScore, opponentScore, result: 'won'|'lost'|'drawn'|null, submitted). Persists to localStorage under `tournament_state`. `startMatch` uses functional `setState(prev => ...)` to avoid stale-closure bugs. `App.tsx` restores the `'tournament'` screen on load when `tournament !== null`.
- `useMatch` manages match scores and state for competitive play (`src/hooks/useMatch.ts`). Returns `{ playerScore, opponentScore, matchOver, matchResult, incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState }`. `matchResult` is `'won' | 'lost' | 'drawn' | null` — derived from scores (winning score for the play mode reached) or from `matchDrawn`/`matchClosedByTimer` flags (using current score gap to decide won/lost/drawn). `recordDraw()` sets `matchDrawn = true`; `closeByTimer()` sets `matchClosedByTimer = true` (called after a win/loss when the timer is already expired, to prevent further games in Bo3). `restoreState` accepts `{ playerScore, opponentScore, matchDrawn?, matchClosedByTimer? }`.
- `useGameHistory<TSnapshot>` (`src/hooks/useGameHistory.ts`) is a generic action-log hook used by both SWU and X-Wing. Each `HistoryEntry<TSnapshot>` records `id`, `type`, `message`, `color`, `snapshot` (full game state before the action). API: `{ entries, add, undoLast, reset }`. `undoLast()` pops and returns the last entry (or `null` if empty) so the caller can restore the snapshot. SWU uses `useGameHistory<SwuGameSnapshot>` where `SwuGameSnapshot = { gameState: GameState, matchState: { playerScore, opponentScore, matchDrawn, matchClosedByTimer }, lastGameResult }`.
- `GameLogOverlay` renders the scrollable log panel on the left side of the game screen (left-anchored at 8vw, expanding rightward). Shared by SWU and X-Wing. Auto-scrolls to the latest entry. Undo button on the last entry when `undoable !== false`. Round-type entries get a blue gradient header (`rgba(59,130,246,0.2) → rgba(59,130,246,0)`) with flat bottom corners and a top separator border — applied to every round entry including the first.
- `App.tsx` keeps `SwuGameScreen` mounted during help/settings navigation via a `display: none` wrapper controlled by an `isInGame` flag. Game state (damage counter, log, round) is preserved while the user browses settings — no restart required. The X-Wing setup screen is kept mounted the same way (`isInXwingSetup`) from entering X-Wing until Back to game select, so each player's choice, the deficits and the scenario survive Squad Lists, Help, Settings and a game. The X-Wing screens are lazy-loaded: their code and the XWA card table download as separate chunks the first time a player enters X-Wing (precached by the service worker for offline use), keeping them out of the bundle SWU players load.
- `useDragScrubber.ts` holds two gestures. `useDragScrubber(onIncrement, onDecrement, maxIncrement, maxDecrement, enabled)` is the press-and-drag-upward gesture on `+`/`−` buttons: dead zone 15px, 14px per point from 2, capped at `Math.min(max, 20)`, inactive when `enabled` is false or the reachable cap < 2; it returns `{ dragIndicator, handleClick, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel }`. `useCardDrag(onTap, onIncrement, onDecrement, maxIncrement, maxDecrement, enabled)` is the SWU card: a tap calls `onTap`, dragging up adds and down removes from 1 past the same dead zone, capped at the capacity; it returns `{ amount, onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }`. Both swallow the click that follows a drag via a `dragApplied` ref.
- The settings screen (`SettingsScreen` / `SettingsScreenView`) is reached from **More** on the setup and game screens and from game select; Back returns to where it was opened. It is one page built from the shared controls, with no tabs and no Help button, grouped **General** (Start screen, a select that opens a sheet), **Star Wars: Unlimited** (Hyperspace art, Force tokens Always / LOF bases / Off, Melee player ID, Damage −/+ buttons, Initiative) and **X-Wing** (Phase tracker, Score −/+ buttons, a **Squad lists** button that opens the Squad Lists screen). In landscape General and X-Wing share the left column and SWU has the right; in portrait the groups stack. It fits without scrolling at 844×390 and 390×844. `SettingsScreenView` calls `useOrientation()` directly to choose the layout.
