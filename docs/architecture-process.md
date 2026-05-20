# dmgCtrl — Architecture: Process & Testing

> **See also:** [Overview](architecture-overview.md) | [Implementation Details](architecture-implementation.md)

---

## 1. Workflow & Development Process

### Branching strategy

| Branch type | Naming convention | Purpose |
|---|---|---|
| Feature | `feature/<short-description>` | New functionality |
| Bug fix | `bug/<short-description>` | Defect corrections |
| Refactor | `refactor/<short-description>` | Code improvements without behaviour change |
| Docs | `docs/<short-description>` | Documentation only |

All development happens on short-lived branches. `main` is the stable, deployable branch.

### PR workflow

1. Branch from `main`
2. Develop and commit on the feature branch
3. Open a pull request targeting `main`
4. All tests must pass (enforced by GitHub Actions)
5. Merge when ready

### Commit messages

Commit messages follow the pattern `<branch-name> <description>`, e.g.:

```
bug/hyperspace-art-resolution improves resolution of hyperspace art
```

---

## 2. CI/CD

### Pipeline: `.github/workflows/deploy.yml`

Triggered on push to `main` and on pull requests targeting `main`. Three sequential jobs:

```
test → build → deploy
```

| Job | Steps |
|---|---|
| `test` | `npm ci` → `npm test` (Vitest) |
| `build` | `npm ci` → `tsc` → `vite build` |
| `deploy` | Upload `dist/` to GitHub Pages |

### Deployment target

The app is hosted on **GitHub Pages** at `/dmgCtrl/`. The `base` config in `vite.config.ts` is set to `/dmgCtrl/` to ensure all asset paths are correct.

### What triggers the pipeline

- Push to `main` — runs all three jobs and deploys on success
- PRs targeting `main` — runs `test` and `build` jobs; deploy is skipped

### Pipeline: `.github/workflows/populate-base-aspects.yml`

Triggered daily at midnight UTC and on manual `workflow_dispatch`. Runs `node scripts/populate-base-aspects.mjs` to refresh the `base_aspects` InfluxDB measurement (see below). This is necessary because InfluxDB Cloud free tier has a 30-day retention window — without periodic refresh, lookup records age out and the base popularity panel loses aspect colour coding.

Credentials are stored as repository-level GitHub Actions secrets and variables:

| Name | Type | Purpose |
|---|---|---|
| `INFLUXDB_TOKEN` | Secret | InfluxDB write token |
| `INFLUXDB_URL` | Variable | InfluxDB Cloud instance URL |
| `INFLUXDB_ORG` | Variable | InfluxDB organisation name |

---

## 3. Analytics

### Cloudflare Web Analytics

A Cloudflare Web Analytics beacon is embedded in `index.html`. It fires on every page load (i.e. every app start) and provides:

- App load counts over time
- Unique visitor counts (privacy-preserving, no cookies, no consent banner required)
- Countries, browsers, devices

The beacon token (`019fc29a88ac474bab2170fe6a1f8424`, registered for `dmgctrl.app`) is a public identifier — it is not a secret and is safe to commit.

Custom event tracking (game starts, base popularity) is not covered by the Cloudflare beacon, which only records page loads. This is handled by the frontend analytics service, which queues events in localStorage and flushes them to the Cloudflare Worker in batches. The worker writes them to InfluxDB Cloud (free tier, `dmgctrl` bucket, 30-day retention). Events captured while offline are preserved across app restarts and delivered when connectivity is restored.

### Analytics Worker endpoints

**`POST /analytics/batch`** — primary endpoint used by the app

- **Payload:** `{ events: QueuedEvent[] }` where each event has `event_id`, `name`, `data`, `queued_at`
- **Storage:** Writes all events to InfluxDB in a single line-protocol batch; `queued_at` is used as the InfluxDB record timestamp (so offline events are attributed to when they occurred, not when they were delivered) and is also stored as a field for visibility
- **Response:** `{ received: number }` on success (HTTP 200), 400 for malformed JSON, 500 on InfluxDB error

**`POST /analytics`** — retained for backwards compatibility

- **Payload:** `{ event: string, data: Record<string, unknown> }`
- **Storage:** Writes a single event to InfluxDB; uses server receipt time as the timestamp
- **Response:** 204 on success, 400 for malformed JSON, 500 on InfluxDB error

Both endpoints share the same CORS policy: restricted to `https://dmgctrl.app` and `https://dev.dmgctrl.app`. Unknown origins receive no CORS headers.

**Auth:** InfluxDB write token stored as a Cloudflare Worker secret (`INFLUXDB_TOKEN`); org and URL stored as `INFLUXDB_ORG` and `INFLUXDB_URL`.

**Querying:** InfluxDB Cloud 3.x (Serverless); use SQL — camelCase column names must be double-quoted, e.g.:
```sql
SELECT time, event, "queued_at", country, city, "sessionId", "baseKey", "baseSet", hyperspace, "durationSeconds"
FROM events
WHERE env = 'production'
ORDER BY time DESC
```

### Offline queue (`src/services/analytics.ts`)

All events are written to a localStorage queue before any network attempt. A flush mechanism delivers queued events whenever connectivity is available.

```
Event occurs (online or offline)
      ↓
enqueue() — writes to localStorage analytics_queue
      ↓
flush() — POSTs queue to /analytics/batch
      ↓
If offline/error: queue preserved, app unaffected
If 200: queue cleared
      ↓
On connectivity restored (window 'online' event or next app_start):
flush() triggered automatically
```

**Queue format** (`localStorage` key: `analytics_queue`):

```typescript
interface QueuedEvent {
  event_id: string                  // UUID, for deduplication
  name: string                      // event name, e.g. 'game_started'
  data: Record<string, unknown>     // payload including env and sessionId
  queued_at: string                 // ISO 8601 timestamp of when the event occurred
}
```

The queue is capped at 200 events; if the cap is reached, the oldest events are dropped. Queue writes fail silently — localStorage errors never affect app functionality. A full tournament day generates approximately 25–40 events (~60 KB at cap), well within localStorage's 5 MB limit.

`flush()` is triggered automatically after every `enqueue()`, on the `window.online` event, and at app start (via `onAppStart()`). This covers all connectivity scenarios: events queued mid-session flush immediately when the device comes online; events queued in a previous offline session flush on next app start.

### Frontend analytics service (`src/services/analytics.ts`)

Twenty-seven public functions enqueue events and trigger a flush. All are fire-and-forget — they return `Promise<void>` so tests can await them, but callers use `void` (errors are silently discarded):

| Function | Event name | Payload fields |
|---|---|---|
| `onAppStart()` | `app_started` | `version` (from package.json) |
| `onGameStart(baseKey, baseSet, hyperspace, playMode)` | `game_started` | `baseKey`, `baseSet`, `hyperspace`, `playMode` (`'casual'` \| `'bo1'` \| `'bo3'`) |
| `onGameEnd(baseKey, baseSet, hyperspace, durationSeconds, playMode)` | `game_ended` | `baseKey`, `baseSet`, `hyperspace`, `durationSeconds`, `playMode` |
| `onMatchCompleted(playMode, matchResult, playerScore, opponentScore)` | `match_completed` | `playMode`, `matchResult` (`'won'` \| `'lost'` \| `'drawn'`), `playerScore`, `opponentScore` |
| `onAppInstall(platform)` | `app_installed` | `platform` (`'ios'` \| `'android'` \| `'other'`) |
| `onAppResume()` | `app_resumed` | `sessionDurationSoFarSeconds` |
| `onDamageDealt(baseKey, baseSet, amount)` | `damage_dealt` | `baseKey`, `baseSet`, `amount` |
| `onDamageHealed(baseKey, baseSet, amount)` | `damage_healed` | `baseKey`, `baseSet`, `amount` |
| `onRoundIncremented(baseKey, baseSet, round)` | `round_incremented` | `baseKey`, `baseSet`, `round` (new round number) |
| `onUndoUsed(baseKey, baseSet, undoneAction)` | `undo_used` | `baseKey`, `baseSet`, `undoneAction` (log entry type: `hit`, `heal`, `epic`, `force-gain`, `force-use`, `monastery`, `round`) |
| `onEpicActionUsed(baseKey, baseSet)` | `epic_action_used` | `baseKey`, `baseSet` |
| `onForceGained(baseKey, baseSet)` | `force_gained` | `baseKey`, `baseSet` |
| `onForceUsed(baseKey, baseSet)` | `force_used` | `baseKey`, `baseSet` |
| `onFavouriteAdded(baseKey, baseSet)` | `favourite_added` | `baseKey`, `baseSet` |
| `onFavouriteRemoved(baseKey, baseSet)` | `favourite_removed` | `baseKey`, `baseSet` |
| `onFavouritesCleared()` | `favourites_cleared` | — |
| `onSettingChanged(setting, value)` | `setting_changed` | `setting` (string), `value` (unknown — boolean for current settings, typed loosely to accommodate future multi-choice settings) |
| `onDeckImportSuccess(baseKey, baseSet)` | `deck_import_success` | `baseKey`, `baseSet` |
| `onDeckImportFailure(reason)` | `deck_import_failure` | `reason` (`'deck_not_accessible'` \| `'base_not_recognised'`) |
| `onImageLoadFailed(baseKey, baseSet, url)` | `image_load_failed` | `baseKey`, `baseSet`, `url` (the URL that failed to load) |
| `onBasesLoadFailed()` | `bases_load_failed` | _(none beyond auto fields)_ |
| `onBasesLoadStale()` | `bases_load_stale` | _(none beyond auto fields)_ |
| `onWakeLockFailed(reason)` | `wake_lock_failed` | `reason` (DOMException name, e.g. `'NotAllowedError'`, or `'unknown'` for non-DOM errors) |
| `onTournamentStarted(format, playMode, totalRounds)` | `tournament_started` | `format`, `playMode` (`'bo1'` \| `'bo3'`), `totalRounds` |
| `onTournamentRoundCompleted(roundNumber, result, playerScore, opponentScore, format, playMode)` | `tournament_round_completed` | `roundNumber`, `result` (`'won'` \| `'lost'` \| `'drawn'`), `playerScore`, `opponentScore`, `format`, `playMode` |
| `onTournamentDropped(roundsCompleted, format, playMode)` | `tournament_dropped` | `roundsCompleted`, `format`, `playMode` |
| `onTournamentEnded(totalRounds, won, lost, drawn, points, format, playMode)` | `tournament_ended` | `totalRounds`, `won`, `lost`, `drawn`, `points`, `format`, `playMode` |

`onAppInstall` fires on the first launch of the app in standalone mode (i.e. launched from the home screen icon). It checks `window.matchMedia('(display-mode: standalone)').matches` (Android/Chrome) or `window.navigator.standalone === true` (iOS Safari), and only fires if a `pwa_install_tracked` flag is not yet set in localStorage. Once fired it sets the flag, so subsequent launches do not re-fire it. This approach is used instead of the `appinstalled` browser event because Safari does not support that event. Platform is detected as `'ios'` when `navigator.standalone === true` (exclusive to iOS Safari), `'android'` when the user agent contains `'Android'`, and `'other'` otherwise.

`onAppResume` fires when `document.visibilityState` transitions from `hidden` back to `visible` — but only after the page has been hidden at least once, so it never fires on initial load.

`sessionDurationSoFarSeconds` is `Math.floor((Date.now() - SESSION_START_TIME) / 1000)` where `SESSION_START_TIME` is a module-level constant set at load time.

Every event automatically includes fields from two sources:

**Appended by the frontend (`sendEvent`):**

| Auto field | Value | Notes |
|---|---|---|
| `env` | `import.meta.env.MODE` | `'development'` in dev, `'production'` in builds. Filter with `WHERE env = 'production'` to exclude dev traffic. |
| `sessionId` | 8-char alphanumeric string, e.g. `'a3f8kx2q'` | Generated once at module load (`Math.random().toString(36).slice(2, 10)`). Same across all events in a page session; resets on reload. Ephemeral — not stored in localStorage, no PII. Enables per-session grouping and session duration queries. |

**Appended by the worker (from `request.cf`):**

| Auto field | Value | Notes |
|---|---|---|
| `country` | Two-letter ISO country code, e.g. `'AU'` | Resolved from client IP by Cloudflare's edge. `'unknown'` in local dev where `request.cf` is not populated. |
| `city` | City name, e.g. `'Sydney'` | Resolved from client IP by Cloudflare's edge. `'unknown'` in local dev. Approximate — based on IP geolocation. |
| `latitude` | Float, e.g. `-33.8688` | Cloudflare edge PoP latitude. Omitted entirely if `request.cf.latitude` is absent (local dev, some edge cases). |
| `longitude` | Float, e.g. `151.2093` | Cloudflare edge PoP longitude. Omitted entirely if `request.cf.longitude` is absent. |

The endpoint URL defaults to `https://worker.dmgctrl.app/analytics` and can be overridden via the `VITE_ANALYTICS_URL` environment variable (useful for local worker dev with `wrangler dev`).

### Wiring

**App.tsx**

| Trigger | Call |
|---|---|
| App mount (`useEffect`) | `onAppStart()` |
| App mount, standalone mode, `pwa_install_tracked` flag not set | `onAppInstall()` |
| `visibilitychange` → hidden then visible | `onAppResume()` |
| User starts a casual game (`handleConfirm`) | `onGameStart(baseKey, baseSet, useHyperspace, 'casual')` |
| User ends a casual game (`handleBack`) | `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, 'casual')` |
| User enters a tournament game (`handleGoToGame`) | `onGameStart(baseKey, baseSet, useHyperspace, playMode)` |
| User backs out of a tournament game (`handleBack`) | `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode)` |
| A tournament match is confirmed complete (`handleMatchComplete`) | `onGameEnd(...)` then `onTournamentRoundCompleted(roundNumber, result, playerScore, opponentScore, format, playMode)` |

**SwuSetupScreen (swuSetupScreen.tsx)**

| Trigger | Call |
|---|---|
| Star toggle tapped on an unfavourited base | `onFavouriteAdded(baseKey, baseSet)` |
| Star toggle tapped on a favourited base | `onFavouriteRemoved(baseKey, baseSet)` |
| SWUDB deck loads successfully | `onDeckImportSuccess(baseKey, baseSet)` |
| SWUDB fetch fails or returns non-200 | `onDeckImportFailure('deck_not_accessible')` |
| SWUDB deck loads but base key not in database | `onDeckImportFailure('base_not_recognised')` |

**SwuTournamentScreen (swuTournamentScreen.tsx)**

| Trigger | Call |
|---|---|
| First match started (`handleActionButton` when `!tournament`) | `onTournamentStarted(format, playMode, totalRounds)` |
| Drop confirmed mid-tournament (`handleDropClick`, second click) | `onTournamentDropped(roundsCompleted, format, playMode)` |
| End Tournament clicked (`handleDropClick` when `isComplete`) | `onTournamentEnded(totalRounds, won, lost, drawn, points, format, playMode)` |

**SwuSettingsScreen (swuSettingsScreen.tsx)**

| Trigger | Call |
|---|---|
| Any settings toggle changed | `onSettingChanged(settingName, newValue)` |
| Remove clicked on an individual favourite | `onFavouriteRemoved(baseKey, baseSet)` |
| Clear All confirmed | `onFavouritesCleared()` |

**SwuGameScreen (swuGameScreen.tsx)**

| Trigger | Call |
|---|---|
| `+` tapped or drag-released | `onDamageDealt(baseKey, baseSet, amount)` |
| `−` tapped or drag-released | `onDamageHealed(baseKey, baseSet, amount)` |
| Round counter tapped | `onRoundIncremented(baseKey, baseSet, newRound)` |
| Undo button pressed | `onUndoUsed(baseKey, baseSet, undoneAction)` |
| Epic action button tapped | `onEpicActionUsed(baseKey, baseSet)` |
| Force button tapped (Force or non-Force base) | `onForceGained(baseKey, baseSet)` |
| Mystic Monastery action button tapped | `onForceGained(baseKey, baseSet)` |
| Force token or greyed Force button dismissed | `onForceUsed(baseKey, baseSet)` |

**useBaseArt (useBaseArt.ts)**

| Trigger | Call |
|---|---|
| Image `onError` fires (URL fails to load) | `onImageLoadFailed(baseKey, baseSet, url)` |

**useBases (useBases.ts)**

| Trigger | Call |
|---|---|
| Fetch fails, stale cache served | `onBasesLoadStale()` |
| Fetch fails, no cache (error screen shown) | `onBasesLoadFailed()` |

**useWakeLock (useWakeLock.ts)**

| Trigger | Call |
|---|---|
| `navigator.wakeLock.request()` rejects | `onWakeLockFailed(reason)` |

`durationSeconds` is computed as `Math.round((Date.now() - gameStartTime) / 1000)` where `gameStartTime` is recorded when a game starts (`handleConfirm` for casual, `handleGoToGame` for tournament rounds). `handleBack` fires `onGameEnd` on both paths: for casual/competitive games when `selectedBase` is set, and for tournament games using `selectedBase ?? tournament.base` as the base fallback. `handleBack` does not fire for help or settings back-navigation.

Install detection and resume detection are in separate `useEffect` calls. The install effect runs once on mount, checks standalone mode and the localStorage flag, and fires `onAppInstall` at most once per device. The visibility effect registers a `visibilitychange` listener with a `hasBeenHidden` local flag; the flag starts `false`, is set to `true` when `visibilityState === 'hidden'`, and `onAppResume` only fires when `visibilityState === 'visible'` and `hasBeenHidden` is already `true` — preventing a spurious event on first page load.

**React StrictMode note:** In development mode, React intentionally mounts, unmounts, and remounts components to detect side-effect bugs. This causes `onAppStart` to fire twice per page load in dev (two `app_started` rows within milliseconds of each other). This is expected and only happens in development — production builds fire once.

### Grafana dashboard

The dashboard is defined as JSON at `grafana/dmgctrl-dashboard.json` and can be imported directly into any Grafana instance. It requires an InfluxDB datasource configured against the `dmgctrl` bucket (InfluxDB 3.x / SQL query language).

**Public URL:** https://yetanotheridentifier.grafana.net/public-dashboards/18828e6c27af43318e6eb8baad0c1efb

**Panels:**

| Panel | Type | What it shows |
|---|---|---|
| Sessions over time | Time series | Distinct `sessionId` values per day |
| Games over time | Time series | `game_ended` events with `durationSeconds > 60` per day |
| Sessions by city | Geomap (markers) | Sessions per city, plotted by Cloudflare edge PoP coordinates |
| Base popularity | Bar gauge | Top 25 bases by completed games; bars colour-coded by aspect (Aggression=red, Command=green, Vigilance=blue, Cunning=yellow, no aspect=grey); joined with the `base_aspects` lookup measurement |
| Games per session distribution | Bar gauge | How many games players complete per session |
| App installs over time | Time series | `app_installed` events per day, split by platform |
| Installs by platform | Donut | Cumulative installs split by `ios` / `android` / `other` |
| Errors per session | Bar gauge | % of sessions that encountered each error event type |
| Feature adoption | Bar gauge | % of sessions using hyperspace, force token, epic action, undo |
| Sessions by play mode | Donut | `game_started` events split by `playMode` (`casual` / `bo1` / `bo3`) |
| Bo1 match results | Bar gauge | Count of `match_completed` outcomes for Bo1 matches (`won` / `lost` / `drawn`) |
| Bo3 match results | Bar gauge | Count of `match_completed` outcomes for Bo3 matches (`won` / `lost` / `drawn`) |
| Tournament usage over time | Time series | `tournament_started` events per day |
| Tournament round outcomes | Bar gauge | Count of `tournament_round_completed` results (`won` / `lost` / `drawn`) |
| Tournament completion vs drop | Donut | `tournament_ended` vs `tournament_dropped` event counts |

Feature adoption and errors per session are measured via usage events (sessions containing at least one relevant event) rather than settings state — this reflects actual use rather than whether the feature was merely enabled.

### `base_aspects` InfluxDB measurement

A separate InfluxDB measurement (`base_aspects`) stores a static `baseKey → aspect` lookup used by the base popularity panel to colour bars. It is populated by `scripts/populate-base-aspects.mjs`, which fetches base card data from swuapi.com (active sets) and the swu-db proxy (rotated sets) and writes one record per base using a fixed timestamp so re-runs overwrite rather than append.

The daily GitHub Actions workflow (`.github/workflows/populate-base-aspects.yml`) keeps the records within the 30-day InfluxDB retention window. The Grafana query joins `events` against `base_aspects` using a derived-table subquery to select only the most recent run's records:

```sql
LEFT JOIN (
  SELECT ba."baseKey", ba.aspect
  FROM base_aspects ba
  INNER JOIN (SELECT MAX(time) AS max_time FROM base_aspects) lr ON ba.time = lr.max_time
) la ON e."baseKey" = la."baseKey"
```

Aspect colour is embedded directly in the SQL result (a `CASE` expression returning a hex string) and injected into each field's `fieldConfig` via the Grafana `rowsToFields` transformation's `color` mapping handler. This bypasses Grafana's field-override matcher, which does not reliably see post-transformation fields.

All panels respect the Grafana time range picker and filter by `env = 'production'`. `country`, `city`, `latitude`, and `longitude` are populated by the Cloudflare Worker from `request.cf` and are absent or `'unknown'` for events received outside the production edge network (e.g. local dev). Coordinates reflect the Cloudflare edge PoP location, not the user's device — they are approximate but accurate enough for city-level mapping.

---

## 4. Testing Strategy

### Philosophy

Tests verify behaviour, not implementation. Hook tests cover logic in isolation; container/screen tests cover integration between hooks and views; `App.test.tsx` covers top-level navigation and feature flows.

### Test types

| Type | Location | Tools |
|---|---|---|
| Hook unit tests | `src/test/use*.test.ts` | Vitest, `renderHook`, `act` |
| Utility unit tests | `src/test/*.test.ts` | Vitest |
| Component tests | `src/test/*.test.tsx` | Vitest, React Testing Library, `userEvent` |
| End-to-end (within app) | `src/test/App.test.tsx` | Same |

### Mocking approach

- External APIs are mocked with `vi.stubGlobal('fetch', ...)` — no real network calls in tests
- localStorage is mocked with `vi.stubGlobal('localStorage', ...)` to test caching paths
- All mocks are torn down with `vi.unstubAllGlobals()` in `afterEach`
- `useUserSettings` is mocked with `vi.mock('../hooks/useUserSettings', ...)` in tests that exercise preference-gated behaviour; `vi.hoisted` is used for mock values that need per-test control
- `useFavourites` is mocked with `vi.mock('../hooks/useFavourites', ...)` in setup screen tests; `vi.hoisted` provides per-test control over `favourites`, `addFavourite`, `removeFavourite`
- `App.test.tsx` mocks `useBases` at the module level (`vi.mock('../hooks/useBases', ...)`) so data is available synchronously; this allows the tests to focus on navigation logic rather than data loading. The loading screen transitions immediately when data is ready; `waitFor` with the default timeout handles any async React batching.

### Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Always use `npm test`. The `npx vitest run` form has a cache glitch that causes spurious first-run failures.

### Coverage expectations

- All hooks must have unit tests
- All utility functions must have unit tests
- All screens must have container/view tests covering primary interaction flows
- New features must include tests before merging

---

## 5. Future Improvements

### Architecture

- **Global state** — React Context is now used for user settings; if the app grows further, a lightweight state manager (e.g. Zustand) may be worth adopting for broader shared state
- **Multi-game support** — the `Base` type and `useBases` hook are SWU-specific; a game-agnostic data abstraction layer would be needed for additional games

### Data

- **Backend / sync** — currently all data is fetched from third-party APIs; a first-party backend could provide more reliable image hosting, faster response, and support for user-specific data (favourites, history)
- **Art coverage** — swu-db.com CDN does not yet host hyperspace art for all sets; `hyperspaceArtHiRes` will become more reliable as their index grows

### UI

- **Theming system** — CSS custom properties are now in place; per-game themes (e.g. X-Wing aesthetic) could be implemented by swapping the `:root` values at runtime
- **Animations** — damage counter and screen transitions could benefit from subtle animations
