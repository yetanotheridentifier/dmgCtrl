# dmgCtrl — Architecture: Implementation Details

> **See also:** [Overview](architecture-overview.md) | [Process & Testing](architecture-process.md)

---

## 1. Folder Structure

```
src/
  App.tsx                  Root component — screen routing and top-level state; calls useBases() to drive loading screen transition
  main.tsx                 Entry point
  index.css                Global reset, CSS custom property palette, help screen styles
  markdown.d.ts            Type declaration for .md imports
  vite-env.d.ts            Vite environment types

  components/
    layout/
      AppScreenLayout.tsx  Shared full-screen layout wrapper (background, safe area)
    icons.tsx               Reusable SVG icon components (BackIcon, ForwardIcon, HelpIcon, CogIcon, LogIcon)
    imagePreview.tsx        Pure view — renders card art or error message from props
    GameLogOverlay.tsx      Game screen action log overlay — scrollable entry list; auto-scrolls to bottom; undo button on last undoable entry; round entries styled with blue gradient
    swuGameScreen.tsx       Game screen container
    swuGameScreenView.tsx   Game screen view (⚙ button always visible)
    swuHelpScreen.tsx       Help screen (renders swuSetupHelp.md or swuGameHelp.md based on source prop; title row: back button + icon + "Help" h1)
    swuLoadingScreen.tsx    Loading screen (icon + "LOADING" text; calls onReady as soon as loading prop becomes false)
    swuSetupScreen.tsx      Setup screen container
    swuSetupScreenView.tsx  Setup screen view (title row: icon + "dmgCtrl" h1 + ⚙ button + help button)
    swuSettingsScreen.tsx   Settings screen container
    swuSettingsScreenView.tsx Settings screen view (toggle list; calls useOrientation directly for iOS font sizing)
    swuTournamentScreen.tsx  Tournament screen container — local config state, action/drop handlers, delegates to view
    swuTournamentScreenView.tsx Tournament screen view — config inputs (tournament ID, play mode selector, total rounds `<select>` 2–16), round table, W/L/D totals, cancel overlay; portrait and landscape CSS Grid layouts

  hooks/
    useBaseArt.ts           Ordered art fallback chain shared by setup and game screens. Exports `getFirstGameImageUrl(base, useHyperspace)` which returns the first URL from the fallback chain, used by the setup screen to preload the game image while the user is still on the setup screen
    useDragScrubber.ts      Drag-to-scrub gesture — tracks pointer events on `+`/`−` counter buttons; exposes `dragIndicator` (type, value, clientX, clientY) and pointer event handlers; 15px dead zone before scrub activates; 14px per step; caps drag value at `Math.min(max, 20)`; suppresses synthetic click after drag; disabled when `enableLongPress` is false or the reachable cap is < 2
    useBases.ts             Fetches and caches the full list of Base cards
    useFavourites.ts        Favourites list — add/remove/clear operations with deduplication on key; sorted by set then card number ascending; persists FavouriteBase[] to localStorage under key `favourites`; UI gated by enableFavourites in useUserSettings
    useGameLog.ts           Ordered action log — add/clearAndAdd/undoLast/reset; each `GameLogEntry` records id, type, message, colour, `prevState` (GameState snapshot), optional `undoable` flag, optional `prevLogEntries` (full previous log — set on game-result entries for full undo), optional `prevMatchState` (score snapshot — set on game-result entries)
    useOrientation.ts       Detects portrait vs landscape; returns isPortrait (via matchMedia change event) and vmin (Math.min(screen.width, screen.height) — stable across rotations)
    useSwuGame.ts           Damage counter, epic action used state, Force token enabled and active state
    useSwuSetup.ts          Setup screen logic — filtering, auto-select, format state, and play mode state; selectedFormat (persisted to pref_format), selectedPlayMode (persisted to pref_play_mode), validSets, handleFormatChange, handlePlayModeChange; clearing selection when the current set is not valid for the new format
    useMatch.ts             Match score state — playerScore, opponentScore, matchOver (computed), matchResult ('won'|'lost'|'drawn'|null, computed), incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState; maxScore is 1 for bo1, 2 for bo3; scores are clamped at maxScore; matchOver also true when matchDrawn or matchClosedByTimer flags are set; matchResult derived from final scores when match closes early
    useTimer.ts             Countdown timer hook — remaining (seconds), isRunning, isExpired; start (idempotent — only starts once), reset; records wall-clock start time and computes remaining from elapsed time on each tick (not by counting interval ticks), so the display catches up correctly after the device screen is off; a visibilitychange listener forces an immediate recalculation when the page becomes visible again; start is called by the game screen container on first game start
    useUserSettings.ts      React Context — persistent user preferences (useHyperspace, forceTokenDisplay, enableEpicActions, enableWakeLock, enableFavourites, enableLongPress, enableActionLog, enableCompetitiveMode, bo1TimerMinutes, bo3TimerMinutes) backed by localStorage under key `user_settings`; forceTokenDisplay is a 3-way value ('always-on' | 'lof-only' | 'always-off'), defaulting to 'lof-only'; all other boolean preferences except enableCompetitiveMode default to `true`; enableCompetitiveMode defaults to `false`; bo1TimerMinutes defaults to 25, bo3TimerMinutes defaults to 55; migrates old enableForceToken boolean (false → 'always-off', true/missing → 'lof-only'); `UserSettingsProvider` wraps the app in `main.tsx`
    useTournament.ts        Tournament state — TournamentState and TournamentRound interfaces; startTournament, startMatch, completeMatch, submitRound, dropTournament, setTournamentId; persists to localStorage under key `tournament_state`; `startMatch` uses functional setState to avoid stale-closure bugs; `points` is a derived value (win=3, draw=1, loss=0) computed from completed rounds alongside `totals`
    useWakeLock.ts          Screen Wake Lock — acquires on game screen mount, releases on unmount; reacquires on visibility change

  services/
    analytics.ts            Offline-queue analytics service (23 event functions + enqueue + flush); events written to localStorage queue first, then flushed via POST to /analytics/batch; queue preserved on network error and re-flushed on window.online; env and sessionId auto-appended to every event; worker appends country, city, and coordinates from request.cf

  constants/
    setRegistry.ts          Static set registry — maps every known set code to { rotation, type }; authoritative source for format filtering; unknown sets default to allowed (forward-compatible)
    rotatedCards.ts         Lookup table of hyperspace card numbers that require 90° rotation correction

  utils/
    formatFilter.ts         Format filtering — isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError; exports Format type ('premier' | 'limited' | 'eternal' | 'twin-suns') and FORMAT_LABELS; pure functions with no side effects
    playMode.ts             Play mode constants — PlayMode type ('casual' | 'bo1' | 'bo3'), PLAY_MODES array, PLAY_MODE_LABELS record; no logic, no side effects
    swudbUrl.ts             SWUDB URL utilities: normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck

  test/
    setup.ts                Vitest setup — jest-dom matchers + global matchMedia mock (landscape default; tests needing portrait call makeMatchMediaMock(true))
    App.test.tsx            End-to-end navigation and feature tests
    AppScreenLayout.test.tsx Layout component tests
    swuGameScreen.test.tsx  Game screen container tests
    swuHelpScreen.test.tsx  Help screen tests
    swuLoadingScreen.test.tsx Loading screen tests
    swuSetupScreen.test.tsx Setup screen container tests
    swuSettingsScreen.test.tsx Settings screen container tests
    swuTournamentScreen.test.tsx Tournament screen container tests (36 tests — rendering, action button labels, callbacks, config locking, drop confirm flow, back navigation)
    analytics.test.ts       Analytics service tests — enqueue (write, shape, append, cap, silent failure), flush (batch POST, URL, clear on 200, preserve on 500, preserve on network error, no-op when empty), window.online trigger, payload shape, PII absence, env field, sessionId consistency, all 23 event functions
    formatFilter.test.ts    Format filtering utility tests (isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError — all formats and set types)
    swudbUrl.test.ts        SWUDB URL utility tests
    useDragScrubber.test.ts Drag-to-scrub hook tests
    useBaseArt.test.ts      Art fallback chain hook tests
    useBases.test.ts        Data layer hook tests
    useFavourites.test.ts   Favourites hook tests
    useOrientation.test.ts  Orientation hook tests
    useSwuGame.test.ts      Counter hook tests
    useSwuSetup.test.ts     Setup logic hook tests
    useMatch.test.ts        Match score hook tests
    useUserSettings.test.ts User settings hook tests
    useTournament.test.ts   Tournament hook tests
    useWakeLock.test.ts     Screen Wake Lock hook tests

  assets/
    ...                     Static assets (icons, splash screens)

docs/
  architecture-overview.md      System overview, goals, tech stack, component tree, glossary
  architecture-implementation.md This document — folder structure, state, data layer, UI, feature details
  architecture-process.md       Workflow, CI/CD, analytics, testing strategy, future improvements
  swuSetupHelp.md               Setup screen user guide (imported as HTML string via custom Vite plugin)
  swuGameHelp.md                Game screen user guide (imported as HTML string via custom Vite plugin)
  project-overview.md           Product vision, planned features, AI assistant notes

public/
  dmgCtrl-icon-transparent-192.png  App icon (transparent background); used on loading screen and alongside screen titles
  dmgCtrl-icon-192.png              App icon 192×192 (opaque); used in PWA manifest and browser favicon
  dmgCtrl-icon-512.png              App icon 512×512 (opaque); used in PWA manifest
  dmgCtrl-force-token.png           Force token icon (512×512 PNG); used on Force button and as watermark in Force overlay
  dmgctrl-icon-192-white.svg        White starburst logo SVG (192×192); used on the epic action button and as watermark in the epic action overlay
  ...                       PWA manifest, icons

.github/
  workflows/
    deploy.yml                    CI/CD pipeline
    populate-base-aspects.yml     Daily cron + manual dispatch — refreshes the base_aspects InfluxDB measurement (see architecture-process.md)

scripts/
  inspect-base-data.mjs           Replicates the useBases merging logic; writes docs/base-data-snapshot.json and docs/base-data-summary.json for offline data inspection
  validate-bases.mjs              Playwright script — opens a headed Chromium window and iterates every base for semi-automated visual QA (see architecture-process.md)
  validate-errors.mjs             Playwright script — opens a headed Chromium window and steps through all five error/info message states for semi-automated visual QA (see architecture-process.md)
  measure-performance.mjs         Playwright script — measures setup ready time, LCP, preview image time, and game image time across three resolution tiers (low/normal/hi res) per iteration; reports min/median/max (see project-overview.md)
  populate-base-aspects.mjs       Fetches base card data from swuapi.com and the swu-db proxy, merges them into baseKey→aspect pairs, and writes to the base_aspects InfluxDB measurement; exports buildBaseAspects and toLineProtocol for unit testing; run by the GitHub Actions daily workflow and on-demand via node scripts/populate-base-aspects.mjs
```

---

## 2. State Management

The app uses **local React state** with one shared React Context for user settings — no global state library.

**`UserSettingsProvider`** (from `useUserSettings.ts`) wraps the entire app in `main.tsx`, giving every screen access to the same settings instance. Changes made in the settings screen propagate immediately to the game screen without requiring a game restart.

All other state is owned at the component level:

| State | Owner | How it flows |
|---|---|---|
| Current screen (`loading` / `setup` / `game` / `tournament` / `help` / `settings`) | `App` | Passed as callback props (`onReady`, `onConfirm`, `onBack`, `onHelp`, `onSettings`) |
| Back stack (for help/settings back-navigation) | `App` | A `Screen[]` stack; pushed when navigating to help or settings, popped on back — supports any depth of overlay navigation |
| `useBases()` loading state (for loading screen) | `App` | `App` calls `useBases()` and passes `loading` prop to `SwuLoadingScreen`; `SwuLoadingScreen` calls `onReady` as soon as the data is ready (`loading` becomes `false`) |
| Game start time | `App` (`useRef`) | Recorded at the start of `handleConfirm`; used by `handleBack` to compute `durationSeconds` for `onGameEnd` |
| Selected base | `App` | Set on `onConfirm`, passed into `SwuGameScreen` |
| Last setup selection (`set`, `aspect`, `key`) | `App` | Saved on `handleConfirm`; passed as `initialSelection` prop to `SwuSetupScreen` so dropdowns are pre-populated on back navigation |
| Selected format (`premier` / `limited` / `eternal` / `twin-suns`) | `useSwuSetup` / localStorage | Persisted under `pref_format`; defaults to `'premier'`; old values `'sealed'`/`'draft'`/`'chaos'` migrate to `'limited'` on first load; changing format clears the set/aspect/base selection if the current set is not valid for the new format; `'eternal'` and `'twin-suns'` have identical filtering behaviour (all sets valid) |
| Selected play mode (`casual` / `bo1` / `bo3`) | `useSwuSetup` / localStorage | Persisted under `pref_play_mode`; defaults to `'casual'`; passed to the game screen via `onConfirm(base, playMode)`; only shown in the UI when `enableCompetitiveMode` is true |
| Match scores (playerScore, opponentScore) | `useMatch` | Local to game screen; reset on each navigation to the game screen; `matchOver` is derived (true when either score reaches maxScore, or when `matchDrawn` / `matchClosedByTimer` flags are set); `matchResult` ('won'/'lost'/'drawn'/null) is derived from scores and close flags; `recordDraw()` closes the match without changing scores (intentional draw or timer-expire draw); `closeByTimer()` closes the match after a win/loss recorded at expiry; `restoreState` accepts all four fields for undo |
| Filter state (set, aspect, card) | `useSwuSetup` | Seeded from `initialSelection` on mount; local after that |
| Damage counter | `useSwuGame` | Local to game screen; clamped between 0 and `base.hp`; reset when the Back button is pressed in casual/bo1/bo3 play; **preserved** when navigating to the tournament screen (the game screen stays mounted via `display: none` and `isInTournament` skips the `game.reset()` call) |
| Epic action used state | `useSwuGame` | Local to game screen; toggled by the epic action button; reset on each casual/bo1/bo3 back-navigation; preserved across tournament ↔ game navigation |
| Force token enabled state | `useSwuGame` | Local to game screen; set to `true` by the enable tap on non-Force bases; combined with `isForceBase` in the container to derive `effectiveForceEnabled`; reset on casual back-navigation; preserved in tournament mode |
| Force token active state | `useSwuGame` | Local to game screen; toggled by the Force button and overlay; reset on casual back-navigation; preserved in tournament mode |
| Action log entries | `useGameLog` | Local to game screen; array of `GameLogEntry` records; empty on mount; Round 1 entry (not undoable) added when the user taps Start; `game-result` entries store `prevLogEntries` and `prevMatchState` for full undo; reset on casual back-navigation; preserved in tournament mode |
| Epic overlay dismissed | `swuGameScreen` | Local `epicOverlayDismissed` boolean; controls overlay visibility independently of `game.epicActionUsed`; set to `false` when epic action is marked; set to `true` by tapping the overlay when action log is disabled |
| Art fallback index, image load state | `useBaseArt` | Local to whichever screen called it; reset when base changes |
| User settings (hyperspace, force token display, epic actions, wake lock, action log, favourites, long press, competitive mode) | `useUserSettings` Context / localStorage | Persisted under `user_settings` as JSON; `forceTokenDisplay` is a 3-way value ('always-on' \| 'lof-only' \| 'always-off'), default 'lof-only'; all other boolean preferences except `enableCompetitiveMode` default to `true`; `enableCompetitiveMode` defaults to `false`; migrates old `enableForceToken` boolean; shared via React Context — updates propagate immediately to all mounted consumers |
| Favourites list | `useFavourites` / localStorage | Persisted under `favourites` as JSON array of `FavouriteBase`; sorted by set then card number ascending; deduplicated on `key`; UI visibility gated by `enableFavourites` in `useUserSettings` |
| Selection mode (`base-selector` / `swudb-import` / `favourites`) | `SwuSetupScreen` / localStorage | Persisted under `pref_selection_mode`; defaults to `base-selector`; `'favourites'` is only restored on load if `enableFavourites` is true and the favourites list is non-empty; falls back to `'base-selector'` at runtime if either condition becomes false. On mode switch: entering `'swudb-import'` always clears the base selection and deck name; entering `'favourites'` clears the selection unless the current base is already in the favourites list; entering `'base-selector'` always preserves the current selection |
| SWUDB URL input, validation error, deck name, loading state | `SwuSetupScreen` | Local; `swudbDeckName` remains `null` until a successful API load |
| Tournament state (`TournamentState` | null) | `useTournament` / localStorage | Persisted under `tournament_state`; survives app close so the user can return between rounds; `null` when no tournament is active; reset by `dropTournament` |
| Tournament local config (tournamentId, playMode, totalRounds) | `SwuTournamentScreen` | Local `useState`; locked (UI disabled) once `startTournament` is called |
| Tournament drop confirm pending | `SwuTournamentScreen` | Local boolean; `showDropConfirm`; set true on first drop-click, confirmed on second click, cancelled by clicking elsewhere |

### Note on double useBases() call

`App.tsx` calls `useBases()` to get the `loading` boolean for the loading screen transition. `SwuSetupScreen` also calls `useBases()` internally via `useSwuSetup`. This means two separate fetch calls occur on app start. In practice, both resolve immediately on repeat visits (24-hour localStorage cache), and the first fetch completes before the setup screen mounts, so the second is nearly instant. This is an acceptable trade-off to avoid refactoring `SwuSetupScreen`'s interface.

### Example flow: App startup

1. `App` mounts with `screen = 'loading'` and calls `useBases()` — initial `loading = true`
2. `SwuLoadingScreen` renders: shows the app icon and "LOADING" text
3. `onReady()` is called as soon as `loading` becomes `false`
4. `App` sets `screen = 'setup'`
5. `SwuSetupScreen` mounts, calls `useBases()` — resolves from cache almost immediately
6. User sees the dmgCtrl screen with selectors populated

### Example flow: Setup → Game

1. User selects set, aspect, and base in setup screen dropdowns
2. `useSwuSetup` manages the filter state and auto-selects when only one option remains
3. User clicks the start game button (→) — `handleSubmit` in `useSwuSetup` calls `onConfirm(selectedBase)`
4. `App` sets `screen = 'game'` and `selectedBase`
5. `SwuGameScreen` receives `base`; calls `useUserSettings()` for `useHyperspace` and other preferences; `useBaseArt` builds the ordered fallback chain and manages image state

### Example flow: Damage tracking

1. User taps `+` or `−` buttons in the game screen view
2. View calls `onIncrement` / `onDecrement` prop (callbacks from container)
3. Container delegates to `useSwuGame` — `increment()` / `decrement()`
4. `count` state updates; view re-renders showing new value
5. `increment` is clamped at `maxHp` and `decrement` is clamped at 0 — remaining HP stays in the range [0, base.hp]

### Example flow: Drag-to-scrub

1. User presses and holds `+` or `−` — `handlePointerDown` sets pointer capture on the button; `useDragScrubber` records start position
2. User drags upward — `handlePointerMove` computes `delta = startY - clientY`; below 15px (dead zone) nothing happens
3. Once delta exceeds 15px, `dragRef.current.active = true` and the indicator state is set: `{ type, value, clientX, clientY }`
4. The view renders a fixed-position floating number (e.g. "+3") offset toward the centre of the screen from the touch point; value increments by 1 per 14px of upward travel, capped at `Math.min(max, 20)` where `max` is the remaining capacity for that direction
5. User releases — `handlePointerUp` fires the increment/decrement callback `value` times; sets `dragApplied.current = true`
6. The synthetic `click` event that follows a pointer-up is suppressed by `handleClick` checking `dragApplied.current` — prevents a double-count
7. Indicator is cleared; `dragRef.current` reset to null

### Example flow: Epic action

1. Container reads `enableEpicActions` from `useUserSettings()` and computes `showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)` — excludes Mystic Monastery (whose text is "Action:", not "Epic Action:")
2. When `showEpicAction` is true, the view renders the epic action button; its position in the left column adjusts based on whether `showForce` is also true
3. User taps the epic action button — view calls `onEpicActionMark` prop; the button becomes `disabled`
4. Container calls `game.markEpicActionUsed()`, adds an epic log entry via `useGameLog`, and resets `epicOverlayDismissed` to `false`
5. View derives `epicActionOverlayVisible = game.epicActionUsed && !epicOverlayDismissed` and re-renders: button is disabled; a gold token overlay appears over the lower portion of the card
6. **When action log is enabled:** the overlay stays visible; undo is performed via the log's Undo button, which calls `undoLast()` to restore the previous game state
7. **When action log is disabled:** the overlay has an `onClick` handler (`onEpicActionOverlayDismiss`); tapping it sets `epicOverlayDismissed = true`, hiding the overlay without reverting game state

### Example flow: Force token

1. Container reads `forceTokenDisplay` from `useUserSettings()` — one of `'always-on' | 'lof-only' | 'always-off'`; derives:
   - `isForceBase = /the force is with you/i.test(base.epicAction)` — LOF Force bases including Mystic Monastery
   - `isMysticMonastery = base.set === 'LOF' && base.number === '022'`
   - `showForce = forceTokenDisplay !== 'always-off' && (forceTokenDisplay === 'always-on' || (isForceBase && !isMysticMonastery))`
   - `showMysticMonastery = isMysticMonastery && forceTokenDisplay !== 'always-off'`
   - `effectiveForceEnabled = isForceBase || forceEnabled`
2. **Locked state** (`showForce && !effectiveForceEnabled`): view renders a dimmed Force icon button (`force-btn-locked`). User taps it → `onForceEnable` → `enableForce()` sets `forceEnabled = true` → `effectiveForceEnabled` becomes `true`
3. **Ready state** (`showForce && effectiveForceEnabled && !forceActive`): view renders the full blue Force button (`force-btn`). User taps it → `onForceGain` → `toggleForce()` sets `forceActive = true`
4. View re-renders: the full blue Force button (`force-btn`) is replaced by a greyed-out Force button (`force-btn-active`); a blue "The Force is With You" overlay appears over the lower portion of the card
5. Tapping the overlay or the greyed Force button calls `onForceDismiss`, returning `forceActive` to `false` and restoring the ready-state button
6. Force bases skip step 2 entirely: `effectiveForceEnabled` is `true` from mount, so the full blue button is shown immediately
7. **Mystic Monastery (LOF-022)**: when `showMysticMonastery` is true, renders an action counter button (`mystic-action-btn`) at slot 1 (9vw from top) when `showForce` is false, slot 2 (16vw) when `showForce` is also true. Tapping it calls `gainForceViaMonastery()` which decrements `mysticUsesRemaining` (3 → 0) and sets `forceActive = true`. The Force token overlay renders when `forceActive && (showForce || showMysticMonastery)`. The counter is always visible but disabled when `forceActive` or `mysticUsesRemaining === 0`.

### Example flow: Both overlays active

When `epicActionUsed && showEpicAction && forceActive && showForce` are all true simultaneously, the view computes `bothOverlaysActive = true`. In this state:
- The epic action overlay occupies the **left half** of the card's bottom section
- The Force token overlay occupies the **right half**
- Both are independently tappable to dismiss

### Example flow: Settings navigation

1. User taps the ⚙ button on the setup or game screen
2. `App` pushes the current screen onto `backStack` and sets `screen = 'settings'`
3. `SwuSettingsScreen` renders — user adjusts preferences; each toggle writes immediately to localStorage via `useUserSettings`
4. User taps the back button — `App` pops the top of `backStack` and sets `screen` to that value, returning to wherever they came from
5. Because `useUserSettings` is a shared React Context, the updated preferences are reflected immediately in all mounted consumers — the game screen does not need to be restarted

---

## 3. Data Layer

### `useBases` hook

The primary data hook. Fetches card data from two external APIs in parallel, merges them, caches the result in localStorage, and returns a `Base[]` array.

```typescript
export interface Base {
  set: string
  number: string              // zero-padded card number, e.g. '023'
  name: string
  subtitle: string
  hp: number
  frontArt: string | null     // standard art — swu-db.com CDN (1560×1120); null if not yet indexed
  frontArtLowRes: string | null  // standard art — swuapi.com CDN (400×286); null for SOR/SHD/TWI
  hyperspaceArtHiRes: string | null  // hi-res hyperspace art — swu-db.com CDN; null if unavailable
  hyperspaceArt: string | null       // reliable hyperspace art — swuapi.com CDN; null for SOR/SHD/TWI
  epicAction: string
  aspects: string[]
  rarity: string
}
```

### External APIs

| API | URL | Purpose |
|---|---|---|
| swu-db proxy | `worker.dmgctrl.app` | Card text, HP, aspects, rarity, standard art; source of truth for SOR/SHD/TWI |
| Analytics endpoint | `worker.dmgctrl.app/analytics/batch` (primary), `/analytics` (backwards compat) | Accepts `POST` from the frontend; writes events to InfluxDB Cloud in line-protocol format; batch endpoint uses `queued_at` as the InfluxDB timestamp so offline events are attributed to when they occurred |
| swuapi.com | `api.swuapi.com/cards?type=Base&variant=all&limit=100` | Primary source for active-format bases; provides low-res art URLs and hyperspace metadata |

**swuapi.com pagination:** The API returns 100 cards per page with cursor-based pagination. `useBases` follows `pagination.next_cursor` until it is `null`, accumulating all pages before merging.

**Source split by set:** swuapi.com no longer returns SOR, SHD, or TWI bases (those sets have rotated out of Premier format). Those sets are sourced exclusively from the swu-db proxy. Sets currently active in swuapi.com are treated as the primary source, with swu-db.com providing supplementary text and hi-res art.

**Hyperspace cards:** Identified in swuapi.com by `variant_type: 'Hyperspace'` and a non-null `variant_of_uuid`. They are merged onto their parent `Standard` card and **not** included as standalone entries in the returned `Base[]`.

### Static hyperspace map

For sets no longer in swuapi.com (SOR, SHD, TWI), hyperspace card numbers are derived from a static offset: all three sets use an offset from the standard card number. This was verified by probing `cdn.swu-db.com`.

The static map is embedded in `useBases.ts` and also duplicated in `scripts/inspect-base-data.mjs` for offline data inspection.

### Image URL resolution

Card art is served from two CDNs with different characteristics:

| CDN | Example URL | Resolution | Reliability |
|---|---|---|---|
| `cdn.swu-db.com` | `.../images/cards/SOR/023.png` | 1560×1120 | Only indexed for sets confirmed by swu-db.com; newer sets may 403 |
| `cdn.starwarsunlimited.com` | Returned directly by swuapi.com | 400×286 | Always reliable — URL is fetched from the API, not constructed |

The `Base` interface captures all four possible art sources: `frontArt`, `frontArtLowRes`, `hyperspaceArtHiRes`, `hyperspaceArt`. Any field may be `null` depending on the set's data availability.

#### Art fallback chain (`useBaseArt`)

Both the setup screen and the game screen call `useBaseArt(base, useHyperspace)`, which builds an ordered URL list (filtering out `null` entries) and maintains a fallback index. On each `onError` the index advances; `allFailed` only becomes `true` once all URLs are exhausted. The hook also tracks `imageLoaded`, `normalFailed`, and `hyperspaceFailed` so callers can derive UI state without re-inspecting the base object.

**Hyperspace preferred:**
```
hyperspaceArtHiRes → hyperspaceArt → frontArt → frontArtLowRes → text/error
```

**Normal preferred:**
```
frontArt → frontArtLowRes → hyperspaceArtHiRes → hyperspaceArt → text/error
```

The normal-preferred chain always falls back to hyperspace art before giving up — a base image is always better than a text fallback.

Some hi-res hyperspace images on cdn.swu-db.com are stored rotated 90°. `useBaseArt` calls `getRotationFromHyperspaceUrl` for each hyperspace hi-res entry and includes the correction as `rotationDeg` in the returned state. When `rotationDeg` is non-zero, both views switch to a portrait layout box sized to the card's inverse dimensions (`CARD_H/CARD_W` wide × `CARD_W/CARD_H` tall), centered with `translate(-50%,-50%) rotate(90deg)`, so the rotated visual output fills the landscape container without overflowing or changing aspect ratio. When `rotationDeg` is zero the image fills the container normally (`inset:0; width:100%; height:100%`). The lookup table in `src/constants/rotatedCards.ts` is the single place to add new entries as they are discovered.

The setup screen also calls `getFirstGameImageUrl(base, useHyperspace)` in a `useEffect` to eagerly preload the game-mode image into the browser HTTP cache whenever the selected base changes. This means the image is typically already cached by the time the user clicks Start, eliminating the fetch delay on the game screen transition.

The setup screen uses `normalFailed`, `hyperspaceFailed`, and `imageLoaded` to control contextual messages ("Only hyperspace image available", "Hyperspace variant not found"): both are suppressed until `imageLoaded` is true, preventing flicker during the loading window. The game screen uses `allFailed` to switch to the text fallback (base name, subtitle, epic action).

### Caching

Fetched and merged data is written to localStorage under key `swu_bases_cache` with a `lastChecked` timestamp. On subsequent loads, if the cache age is less than **24 hours**, the fetch is skipped and the cached `Base[]` is returned directly.

If the cache is stale and a fresh fetch fails (network error), the stale cached data is served rather than showing an error — the app remains usable offline or on poor connections. An error is only shown if there is no cache at all and the fetch fails.

To force a fresh fetch during development: `localStorage.removeItem('swu_bases_cache')` in the browser console.

### Data inspection script

`scripts/inspect-base-data.mjs` is a standalone Node.js script that replicates the `useBases` merging logic and writes two files (gitignored):

- `docs/base-data-snapshot.json` — full merged `Base[]` array
- `docs/base-data-summary.json` — compact summary with art coverage stats per base

Run with `node scripts/inspect-base-data.mjs` to inspect the live merged dataset without running the app.

### Base validation script

`scripts/validate-bases.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of every base's game screen rendering. It opens a visible Chromium window, iterates through every set / aspect / base combination, navigates to the game screen for each base, waits for the card image to load, pauses for visual inspection, then returns to the setup screen.

Prerequisites:
- Dev server must be running (`npm run dev`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-bases.mjs
```

The script reads set, aspect, and base options live from the DOM, so new bases added to the data source are picked up automatically. Progress is logged to the terminal:
```
[1] SOR / Aggression / Catacombs of Cadera
[2] SOR / Cunning / Energy Conversion Lab
...
Validation complete — 42 bases checked.
```

Timing constants at the top of the script (`VISUAL_PAUSE_MS`, `BACK_PAUSE_MS`) can be adjusted if more or less inspection time is needed.

### Error message validation script

`scripts/validate-errors.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of all five error and information message states. It opens a visible Chromium window and steps through each scenario in sequence, pausing 3 seconds for visual inspection before advancing. Settings modified during the run (e.g. `useHyperspace`) are restored to defaults at the end.

**Scenarios:**
1. SWUDB Import — "Invalid deck URL" (types an invalid URL)
2. SWUDB Import — "Deck not accessible" (loads an unreachable deck URL via the proxy)
3. Base Selector — "No base images found" (all PNG/WebP/JPEG requests blocked via `page.route`)
4. Base Selector — "Hyperspace variant not found" (`useHyperspace` set to `true`, selects a base with no hyperspace art)
5. Base Selector — "Only hyperspace image available" (`useHyperspace` set to `false`, blocks the base's standard art URLs so it falls back to hyperspace)

Scenarios 4 and 5 query `swu_bases_cache` in localStorage via `page.evaluate` to find suitable bases automatically — no hardcoded base names are required.

Prerequisites:
- HTTPS dev server must be running (`npm run dev:https`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-errors.mjs
# or, for device testing on the local network:
node scripts/validate-errors.mjs https://192.168.1.100:5173/dmgCtrl/
```

Timing can be adjusted via `VISUAL_PAUSE_MS` at the top of the script.

### `useFavourites` hook

Manages a persistent list of favourite bases for quick reselection.

```typescript
export interface FavouriteBase {
  key: string       // `${set}-${number}`, e.g. "SHD-018"
  set: string
  name: string
  hp: number
  aspect: string
  cardNumber: number
}
```

**Persistence:** Stored as a `FavouriteBase[]` JSON array in localStorage under the key `favourites`. Falls back to an empty list if the key is absent or the stored value is corrupt.

**Deduplication:** Adding an entry whose `key` already exists is a no-op.

**Sort order:** The list is sorted on every mutation — set code ascending (alphabetical), then `cardNumber` ascending within a set.

**API:** `{ favourites, addFavourite, removeFavourite, clearFavourites }`.

**Feature flag:** `enableFavourites` in `useUserSettings` (default: `true`) gates UI visibility. The stored data is retained regardless of the toggle state — disabling and re-enabling restores the list intact.

---

## 4. UI & Layout System

### AppScreenLayout

Every screen is wrapped in `AppScreenLayout`, which provides:
- Full-screen fixed container (fills viewport)
- Dark background gradient
- CSS safe area insets (for iOS notch/home indicator)
- Animated star field background

This ensures visual consistency across screens without each screen needing to re-implement the full-screen container.

### Styling approach

All styling is done with **inline styles** (React `style` prop). There is no CSS framework, no CSS Modules, and no styled-components. `index.css` contains a minimal global reset, the CSS custom property palette, and styles for the help screen's rendered HTML content.

**CSS custom properties** are defined in `:root` in `index.css` and referenced in inline styles via `var()` syntax (e.g. `color: 'var(--color-accent)'`). This gives a single source of truth for the colour palette while keeping styling co-located with component logic.

| Token | Value | Usage |
|---|---|---|
| `--color-accent` | `#4fc3f7` | Borders, headings, button highlights |
| `--color-accent-rgb` | `79, 195, 247` | `rgba()` shadow values using the accent colour |
| `--color-bg-dark` | `#000510` | Darkest background |
| `--color-bg-mid` | `#0d1b2a` | Gradient midpoint |
| `--color-bg-deep` | `#0a0e1a` | Primary background, select option backgrounds |
| `--color-text-primary` | `#ffffff` | Headings, counter, button text |
| `--color-text-body` | `#d0d0d8` | Help screen body text |
| `--color-text-muted` | `#a8a8b3` | Subtitles, secondary labels |
| `--color-text-disabled` | `#6b7280` | Disabled/placeholder states |
| `--color-ui-border` | `#6b7280` | Back/help button borders |
| `--color-ui-border-muted` | `#9ca3af` | Back/help button icon colour |
| `--color-ui-border-muted-rgb` | `156, 163, 175` | `rgba()` shadow values using the UI border colour |
| `--color-error` | `#ff6b6b` | Error messages, fallback states |
| `--color-epic` | `#f5c518` | Epic action button, token overlay border and glow |
| `--color-epic-rgb` | `245, 197, 24` | `rgba()` shadow values using the epic colour |

Pros: no class name conflicts, styling is co-located with component logic, easy to make props-driven style decisions, palette changes are a one-line edit in `index.css`.

Cons: no media query support in inline styles (workaround: derive breakpoint-based values in component logic), harder to override from outside.

### Responsive layout

The app is designed for **landscape orientation**. `useOrientation` is used in five places:

- **Setup screen** (`SwuSetupScreenView`) — renders a two-column layout in landscape (selectors left, card preview right) and a single-column scrollable layout in portrait.
- **Game screen** (`SwuGameScreen`) — renders the full-screen card layout in landscape and a rotation prompt in portrait.
- **Help screen** (`SwuHelpScreen`) — uses `vmin` to compute JS-based font sizes for the title row; `isPortrait` is used as a React `key` to force DOM remount on rotation, flushing any cached computed styles.
- **Settings screen** (`SwuSettingsScreenView`) — uses `vmin` for JS-based font sizes; `isPortrait` as a React `key` for DOM remount on rotation; `fontFamily` set to `Helvetica, Arial, sans-serif` with `-webkit-text-size-adjust: 100%` to prevent iOS Dynamic Type scaling the toggle labels.
- **Tournament screen** (`SwuTournamentScreenView`) — portrait: single-column layout (config → W/L/D totals → action buttons → round table); landscape: CSS Grid two-column layout aligning config inputs and action buttons in shared rows across both columns.

`useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events (reliable on iOS standalone PWA, unlike `orientationchange`/`resize`). It returns `isPortrait` (boolean) and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, which is stable across orientation changes unlike `window.innerWidth`).

---

## 5. Feature Architecture

### App startup and loading screen

1. `App` mounts with `screen = 'loading'` and calls `useBases()` to get the `loading` boolean
2. `SwuLoadingScreen` renders: displays the app icon (`dmgCtrl-icon-transparent-192.png`) and "LOADING" text
3. `onReady()` is called as soon as `loading` becomes `false`
4. `App` responds to `onReady` by setting `screen = 'setup'`

### Base selection flow

1. `useBases` fetches and returns `Base[]` (cached after first load)
2. `useSwuSetup` receives `bases` and exposes derived lists:
   - `availableSets` — distinct set codes
   - `availableAspects` — aspects for the selected set
   - `filteredBases` — bases matching the selected set and aspect
3. Auto-select effects: if only one value is available for a dropdown, it is selected automatically
4. User selects a base → `selectedBase` is set
5. On submit, `onConfirm(selectedBase, playMode)` is called — the game screen reads `useHyperspace` from `useUserSettings` independently; `playMode` will be wired to competitive scoring in a later ticket

### Format selection

The setup screen exposes a **Format** dropdown on the same row as the Match selector (when competitive mode is enabled) or alone (when it is not). Four formats are available: Premier, Limited, Eternal, Twin Suns. Eternal and Twin Suns are separate dropdown options with identical filtering behaviour — all sets are valid for both. The selection is persisted to localStorage under `pref_format` and defaults to `'premier'`. On first load, any previously stored `'sealed'`, `'draft'`, or `'chaos'` value is silently migrated to `'limited'`.

Format filtering is implemented as pure functions in `src/utils/formatFilter.ts`, driven by a static registry (`src/constants/setRegistry.ts`) that classifies each set:

| Set type | Description | Example sets | Premier | Limited | Eternal / Twin Suns |
|---|---|---|---|---|---|
| `standard` with recent rotation | Current sets (most recent 2 rotation labels, alphabetical) | JTL, LOF, SEC, LAW | ✓ | ✓ | ✓ |
| `standard` with old/null rotation | Rotated-out sets | SOR, SHD, TWI | ✗ | ✓ | ✓ |
| `premier-legal-special` | Always Premier-legal; excluded from Limited | IBH | ✓ | ✗ | ✓ |
| `eternal-only` | Valid in Eternal / Twin Suns only | TS26 | ✗ | ✗ | ✓ |

"Most recent 2 rotations" is derived at runtime by collecting all unique non-null rotation labels from `standard` sets, sorting alphabetically, and taking the last two. This means the filter automatically adapts when a new rotation is added to the registry.

Unknown set codes (not in the registry) default to **allowed** in all formats for forward compatibility with sets not yet registered.

Format state lives in `useSwuSetup`. When the format changes, `validSets` is recomputed and the current set/aspect/base selection is cleared if the current set is no longer valid. The view receives `validSets` (not `availableSets`) for the set dropdown.

**SWUDB Import format validation:** After a successful deck load, the loaded base is re-evaluated against the selected format on every render — `swudbFormatError` is derived state, not stored state. This means changing the format immediately re-evaluates without re-fetching the deck. If the base is invalid for the current format, the start game button is disabled and an error message is shown (e.g. `Base not valid for Premier format`; sealed/draft errors append the set code). Switching to a valid format immediately re-enables the button.

**Favourites format filtering:** `validFavourites` (passed to the view) is filtered by the current format using `isSetValidForFormat`. The Favourites input mode option only appears in the mode selector when `validFavourites` is non-empty.

### Play mode selector (competitive mode)

When `enableCompetitiveMode` is `true` in user settings, a **Match** dropdown appears on the setup screen on the same row as the Format selector. Three options are available: Casual, Best of 1, Best of 3. The selection is persisted to localStorage under `pref_play_mode` and defaults to `'casual'`. The selected play mode is passed to `App` via `onConfirm(base, playMode)`, stored as `selectedPlayMode` in `App` state, and forwarded to `SwuGameScreen` as a `playMode` prop.

`enableCompetitiveMode` defaults to `false` and is toggled in the Settings screen.

### Source selector

The setup screen supports three input modes, controlled by a `selectionMode` state (`'base-selector'` | `'swudb-import'` | `'favourites'`). The active mode is persisted to localStorage under `pref_selection_mode`. The Source selector dropdown is always visible on the setup screen.

**Base Selector mode** is the default. The three cascading dropdowns (set → aspect → base) are shown. Each base option is formatted as `${name} (${hp})` (e.g. `Catacombs of Cadera (30)`).

When `enableFavourites` is true and a base is selected, a **star toggle** (☆/★) appears inline — in the same row as the base dropdown and start button. Tapping it:
- Adds the current base to favourites (`addFavourite`) if not already saved, recording `set`, `name`, `hp`, `cardNumber` (`parseInt(base.number, 10)`), and the selected aspect (or `'None'` for bases with no aspects)
- Removes it (`removeFavourite`) if already favourited

`isFavourited` is a derived boolean in the container, computed by matching `` `${base.set}-${base.number}` `` against the `key` fields in the favourites list.

**SWUDB Import mode** shows a URL input field and a two-row layout:
- Row 1 (always visible): URL text input + Load button
- Row 2 (visible only after a load attempt): deck name + start game button (→)

The Load and start game buttons are stacked vertically and share the same width so they align.

On a successful load, `selectBaseByKey` in `useSwuSetup` is called with the base key from the deck response. This sets `selectedSet`, `selectedAspect`, and `selectedKey` so that switching back to Base Selector mode shows the correct base pre-selected. The card art preview appears below the import controls once a base is resolved, mirroring the Base Selector experience. When `enableFavourites` is true and a base has been resolved, a star toggle (☆/★) appears between the deck name and the start button, identical in behaviour to the one in Base Selector mode.

URL validation is handled by pure utility functions in `src/utils/swudbUrl.ts`:

```typescript
normaliseSwudbUrl(url)   // converts /deck/edit/<id> → /deck/<id>
isValidSwudbUrl(url)     // tests against /^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/
fetchSwudbDeck(deckId)   // fetches via the Cloudflare Worker proxy; returns { deckName, baseKey }
```

SWUDB deck IDs are alphanumeric and variable length (observed range: 9–13 characters). The URL is validated on every change; edit URLs are normalised before validation so they pass. An error message appears below the URL field for invalid input, extending the field's border in a drop-down style; focusing the field clears the error.

The Load button is disabled while a fetch is in progress (shows `...`). Possible error states after clicking Load:
- `'Invalid deck URL'` — URL failed validation (should not normally reach Load in this state)
- `'Deck not accessible'` — non-200 response or network error
- `'Base not recognised'` — deck loaded but the base key was not found in the local `Base[]`

When the base is not recognised, the deck name is still shown (so the user can see which deck was loaded) but the start game button is disabled.

**Favourites mode** is available when `enableFavourites` is `true` and the favourites list is non-empty. The Favourites option only appears in the mode selector dropdown when both conditions are met. The mode shows a single dropdown listing all saved favourites, sorted by set then card number. Each option is formatted as `${set}: ${name} (${hp})` (e.g. `SOR: Catacombs of Cadera (30)`). Selecting an entry calls `selectBaseByKey` to populate the setup state and enables the start game button. A card art preview appears once a base is selected, consistent with the other modes.

**Mode transitions:** When switching to SWUDB Import mode, the current base selection and any loaded deck name are always cleared — the form starts fresh. When switching to Favourites mode, the selection is cleared unless the currently selected base is already in the favourites list (in which case it is pre-selected in the dropdown). Switching to Base Selector mode always preserves the current selection — a base resolved via SWUDB Import or chosen from Favourites will be pre-populated in the cascading dropdowns.

If `enableFavourites` becomes `false` or the favourites list becomes empty while Favourites mode is active, a `useEffect` in the container resets `selectionMode` to `'base-selector'`. The `'favourites'` value is also rejected when restoring mode from localStorage if these conditions are not met on load.

In the portrait layout, the mode content area is wrapped in `<div key={selectionMode} style={{ display: 'contents' }}>`. The `key` forces React to fully replace the DOM node (rather than reconcile in-place) when the mode changes. Without this, iOS Safari retains GPU compositing layer tiles from the removed box-shadow elements (the base/aspect dropdowns and start button), leaving a faint ghost line in the empty area below the controls when switching from Base Selector mode with no base selected. `display: contents` makes the wrapper layout-transparent so the Fragment children from `baseSelectorContent` continue to participate directly in the outer flex column's gap spacing.

### Game screen

1. `useUserSettings()` provides `forceTokenDisplay`, `enableEpicActions`, `enableWakeLock`, `useHyperspace`, and `enableLongPress` — all user preferences for this screen
2. `useBaseArt(base, useHyperspace)` manages the ordered fallback chain and image load state
3. `useSwuGame(base.hp)` manages the damage counter, epic action, and Force token (enabled + active) state
4. `useGameLog()` manages the ordered action log; the container adds entries on counter changes, epic action mark, Force token toggle, and round increment; the log is empty on mount — a non-undoable Round 1 entry is added only when the user taps Start; `game-result` entries (added by `clearAndAdd`) replace the entire log and store `prevLogEntries` + `prevMatchState` for full undo
5. `useWakeLock(enableWakeLock)` acquires a Screen Wake Lock on mount to prevent the screen sleeping during gameplay; the lock is automatically released when the component unmounts or the page becomes hidden, and reacquired when the page becomes visible again
6. `useMatch(playMode)` tracks match scores — `playerScore`, `opponentScore`, `matchOver` (derived), `matchResult` (derived); provides `incrementPlayerScore`, `incrementOpponentScore`, `recordDraw`, `closeByTimer`, `resetMatch`, `restoreState`; active for bo1 and bo3 play modes
6a. `useTimer(durationSeconds)` manages the countdown timer — `remaining`, `isRunning`, `isExpired`; `start()` is idempotent (starts only once via an internal ref); called by the container on first game start; duration is `bo1TimerMinutes * 60` or `bo3TimerMinutes * 60` from user settings
7. The container computes:
   - `showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)`
   - `showForce` and `showMysticMonastery` from `forceTokenDisplay`, `isForceBase`, and `isMysticMonastery` (see Force token flow above)
   - `effectiveForceEnabled = isForceBase || forceEnabled` — Force bases start enabled; others start locked until the user taps the dimmed icon
   - `epicActionOverlayVisible = game.epicActionUsed && !epicOverlayDismissed` — separates overlay visibility from game state
   - The active Force button (`force-btn`) renders "Gain / Force" as two-row text behind the force icon image; an `onError` handler hides the image if it fails to load (e.g. offline), making the text visible as a fallback
8. Key props passed to the view: art state, counter callbacks, `epicActionUsed`, `epicActionOverlayVisible`, `onEpicActionMark`, `onEpicActionOverlayDismiss` (only when action log is disabled), `showEpicAction`, force state, `showMysticMonastery`, `enableActionLog`, `round`, `onRoundIncrement`, `onStartGame`, `showLog`, `onToggleLog`, `logEntries`, `onLogUndo`, `playMode`, `playerScore`, `opponentScore`, `matchOver`, `matchDrawn`, `pendingConfirm`, `onWinPending`, `onLossPending`, `onDrawPending`, `onConfirmResult`, `onCancelConfirm`, `lastGameResult`, `timerRemaining`, `timerInteractive`; the view calls `useDragScrubber` directly to manage drag gesture state
9. The left-side button column (top to bottom): back → Force icon (locked, ready, or overlay-active/greyed) when `showForce` → Mystic Monastery counter when `showMysticMonastery` → epic action button when `showEpicAction`; each non-Force button shifts up when the Force button is hidden
10. The right-side button column (top to bottom): help → ⚙ settings → **score panel** (when `playMode !== 'casual'`) from 16vw downward
11. The bottom row (when action log is enabled): log button (bottom-left, ☰ icon) → round counter button (bottom-right, blue gradient header)
12. View renders the card image, counter, and up to two overlays over the bottom portion of the card:
    - **Epic action token** (gold, "Epic Action Used"): when `epicActionOverlayVisible && showEpicAction`
    - **Force token** (blue, "The Force is With You"): when `forceActive && (showForce || showMysticMonastery)`
    - When **both** are active, `bothOverlaysActive = true` renders them side by side (epic action left, Force right), each at half width

### Score panel

Rendered in the **right column** of the game screen when `playMode !== 'casual'`. Positioned absolutely from a fixed `16vw` top offset (below the settings button at 9vw) downward to `calc(env(safe-area-inset-bottom) + 9vw)` (above the round tracker). Hidden entirely when `playMode` is `'casual'`.

Layout (top to bottom within the panel):
- **Opp** button — tap to initiate a loss confirm; shows "Confirm" when `pendingConfirm === 'loss'`; red text and border in confirm state; disabled when `matchOver`
- Opponent marker circles (1 for bo1, 2 for bo3); filled circles have a green gradient with a 3D highlight/shadow
- **Timer / Draw button** — between the two sets of marker circles; full panel width; see below
- Player marker circles (1 for bo1, 2 for bo3); same green gradient fill
- **You** button — tap to initiate a win confirm; shows "Confirm" when `pendingConfirm === 'win'`; green text and border in confirm state; disabled when `matchOver`

All three buttons (Opp, timer/Draw, You) are full-width within the 5vw panel column.

**Timer display and interactivity:**
- `timerInteractive` is true when `playMode !== 'casual'` and `!matchOver` and `pendingConfirm === null` and (`isPreFirstGame` OR `timer.isExpired`); `isPreFirstGame = game.round === 0 && gamesPlayed === 0` — between Bo3 games (`round === 0` after a reset, but games have been played) the timer is not interactive and shows the running time
- When `timerInteractive` OR `pendingConfirm === 'draw'`: rendered as a `<button>` — shows "Draw" (grey, `--color-text-muted`) when interactive, "Confirm" (accent blue, `--color-accent`) when `pendingConfirm === 'draw'`
- When not interactive: rendered as a plain `<div>` (no border) showing `MM:SS`; text turns red when `remaining < 60`
- The timer starts (once) when `handleStartGame` calls `timer.start()`; `useTimer` is idempotent — subsequent calls to `start()` have no effect

**Win/loss/draw confirmation flow:**
1. User taps You, Opp, or Draw → `pendingConfirm` is set (`'win'`, `'loss'`, or `'draw'`) in the container; a transparent full-screen dismiss overlay (zIndex 9) is added; the tapped button shows "Confirm"
2. User taps Confirm → `handleConfirmResult(outcome)` runs:
   - `'win'`: `match.incrementPlayerScore()`; if `timer.isExpired` also calls `match.closeByTimer()`
   - `'loss'`: `match.incrementOpponentScore()`; if `timer.isExpired` also calls `match.closeByTimer()`
   - `'draw'`: `match.recordDraw()` (closes match without changing scores)
   - In all cases: `game.reset()`, `log.clearAndAdd` with a `game-result` entry, `lastGameResult` set, `pendingConfirm` cleared
3. User taps elsewhere → dismiss overlay calls `onCancelConfirm`; `pendingConfirm` returns to null

**Auto-loss at 0 HP:** a `useEffect` in the container watches `game.count`. When count ≥ `base.hp`, `playMode !== 'casual'`, `game.round > 0`, `!match.matchOver`, and `pendingConfirmRef.current === null`, it sets `pendingConfirm` to `'loss'`. This also fires when the timer is expired — the confirmed loss then calls `closeByTimer()` to close the match. The ref pattern (synced via a separate effect) prevents re-triggering when the user dismisses the confirm without healing.

**Between-game display (Bo3):** when `lastGameResult !== null && !matchOver`, the game counter shows "Start Game N" and a "Game N Won/Lost" sub-label below it. Tapping the counter calls `onStartGame`.

**Match-over display:** when `matchOver`, the game counter and round tracker are hidden. The match result label shows "Match Won", "Match Lost", or "Match Drawn" based on `matchDrawn` (passed as `match.matchResult === 'drawn'`) and the final score comparison.

**Undo:** the `game-result` log entry has `undoable: true`. Calling `undoLast()` detects the `prevLogEntries` field and restores the full previous log (via `setEntries(last.prevLogEntries)`). The container also calls `match.restoreState(entry.prevMatchState)` — which includes `matchDrawn` and `matchClosedByTimer` flags — and clears `lastGameResult`.

### Settings screen

The settings screen is accessible from both the setup and game screens via the ⚙ button in the top-right area:

- Tapping ⚙ navigates to `SwuSettingsScreen`; the current screen is pushed onto `backStack` so the back button returns to the correct place
- `SwuSettingsScreen` (container) calls `useUserSettings()` and `useFavourites()` to read and write preferences and manage the saved bases list
- `SwuSettingsScreenView` (view) renders a header row (back button, icon, "Settings" h1, help button) and toggle list
- Each toggle writes immediately to localStorage via `useUserSettings` — there is no save/cancel step
- The seven toggles: **Use Hyperspace Art**, **Enable Force Token**, **Enable Epic Actions**, **Enable Screen Wake Lock**, **Enable Action Log**, **Enable Competitive Mode** (beta, defaults off), **Enable Favourites**
- When **Enable Favourites** is on, a saved-bases list appears directly below the toggle (inset with a left accent border to show hierarchy): each entry shows `SET: Name — HPHp (Aspect)` with a Remove button; a Clear All button (with a two-step inline Confirm/Cancel) appears when the list is non-empty; "No favourites saved" is shown when the list is empty
- **Landscape layout**: two `role="group"` columns — "General settings" (first five toggles: Hyperspace Art, Force Token, Epic Actions, Wake Lock, Action Log) on the left, "Favourites settings" (Enable Favourites toggle + list) on the right; each column scrolls independently. Portrait: single scrollable column.
- `SwuSettingsScreenView` calls `useOrientation()` directly (not via props) and applies `fontFamily: 'Helvetica, Arial, sans-serif'` to prevent iOS Dynamic Type from overriding font sizes

### Tournament screen

The tournament screen (`SwuTournamentScreen` / `SwuTournamentScreenView`) allows players to track multiple rounds in a structured event:

1. `useTournament()` owns all tournament state — `TournamentState | null`, `matchInProgress` (derived: last round has `result === null`), `isComplete` (derived: all rounds filled and total reached), and win/loss/draw `totals`
2. Tournament state is persisted to localStorage under `tournament_state` so the app can be closed between rounds and the player returns to the correct screen on reopen
3. The container holds three pieces of local config state — `localTournamentId`, `localPlayMode` (`'bo1' | 'bo3'`), `localTotalRounds` — that are editable before `startTournament` is called and locked (disabled inputs) once the tournament begins
4. **Action button** label is derived:
   - No tournament: "Start Match 1"
   - Match in progress: "Return to Match N"
   - Match complete, more rounds remain: "Start Match N+1"
   - Tournament complete: button hidden
5. Clicking the action button calls `startTournament` (first match only), then `startMatch` (if not already in progress), then `onGoToGame(playMode)` to navigate to the game screen
6. **Drop button** has a two-step confirmation to prevent accidental drops: first click shows "Confirm"; second click calls `dropTournament` and `onDrop`; clicking elsewhere cancels. When `isComplete`, a single click ends the tournament immediately (no confirmation). A `position: fixed, zIndex: 100` cancel overlay inside `AppScreenLayout`'s stacking context intercepts outside clicks; the drop button itself is at `zIndex: 101` to remain clickable above the overlay.
7. **Landscape layout** uses CSS Grid (`gridTemplateColumns: '45% 1fr', gridTemplateRows: 'auto auto 1fr'`) to align config inputs and match controls in independent rows across both columns — the W/L/D totals row aligns with the ID/Drop row, and the Match/Rounds row aligns with the action buttons row
8. **App routing:** `App.tsx` restores the `'tournament'` screen on load if `tournament !== null` (persisted state implies an active tournament); the game screen navigates back to `'tournament'` after a round is complete, passing the result via `useTournament.completeMatch`

### Screen Wake Lock

`useWakeLock(enabled)` wraps the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API):

- Calls `navigator.wakeLock.request('screen')` on mount when `enabled` is true
- Stores the `WakeLockSentinel` in a ref; calls `.release()` on unmount
- Listens for `visibilitychange`: reacquires the lock when `document.visibilityState === 'visible'` (the OS releases the lock automatically when the app is backgrounded)
- Silently swallows errors from `request()` (e.g. battery saver mode, permissions denied)
- No-ops if `navigator.wakeLock` is absent (older browsers, non-installed iOS Safari)

**Platform support:**
- Android Chrome: supported since Chrome 84 (2020)
- iOS Safari PWA: supported since iOS 16.4 (March 2023); only works when installed to home screen — not in a regular Safari tab

### Adding a new feature

When adding a new feature:
1. Define the logic in a hook (`src/hooks/`) or pure utility (`src/utils/`)
2. Add the hook to the relevant container
3. Pass derived state and handlers as props to the view
4. Write hook/utility tests first, then container/view tests

Avoid putting logic directly in view components. If a view needs to compute something non-trivial, move that computation to the container or a hook.

---

## 6. Performance Considerations

### Mobile-first

The app targets mobile browsers and PWA installation. Key performance constraints:

- Minimal bundle size — no large dependencies
- Fast startup — localStorage cache means data is available immediately on repeat visits
- No unnecessary network requests — the 24-hour cache prevents redundant API calls on repeat visits

### Avoiding unnecessary re-renders

- State is co-located with the component that needs it — no prop drilling through many layers
- Derived values (e.g. `filteredBases`) are computed in hooks with `useMemo`; `useBaseArt` entries are memoised so the array only rebuilds when `base` or `useHyperspace` changes

### Image loading

- Card art is lazy-loaded via the browser's default `<img>` behaviour
- The fallback chain in `useBaseArt` means a broken image never leaves a blank gap — it advances to the next URL or shows text
- When a base is selected on the setup screen, `getFirstGameImageUrl` is called in a `useEffect` that fires a `new Image()` prefetch for the game-mode URL. This warms the browser cache so the game screen image is typically instant on Start
