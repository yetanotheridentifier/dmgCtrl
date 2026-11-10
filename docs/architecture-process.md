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

Triggered on push to `main` and on pull requests targeting `main`:

```
lint ┐
     ├→ build → deploy   (push to main)
test ┘        → preview  (pull request)
```

| Job | Steps |
|---|---|
| `lint` | `npm install` → `npm run lint` for the PWA and for sealed |
| `test` | `npm install` → the three suites as three steps (Vitest) |
| `build` | `npm install` → `tsc` → `vite build` for the PWA and for sealed → sealed copied into `dist/sealed/` |
| `preview` | `npm install` (for wrangler) → deploy the same build to a `pr-<number>` Cloudflare Worker, and link it on the pull request |
| `deploy` | Upload `dist/` to GitHub Pages |

`lint` and `test` are separate jobs and run in parallel; `build` waits for both. Kept apart so one push reports both answers: as steps in a single job, a lint failure stopped the tests from running at all, and the test result only appeared on the next push.

Sealed's simulation tests are not in that `test` job. They play real games to reach their numbers and are CPU-bound, so they get their own workflow (`.github/workflows/simulation-tests.yml`), which runs on pull requests, on pushes to `main`, and nightly. Each job has its own runner, so that costs a runner rather than wall-clock time and it still finishes inside the test job's window. It does not gate deployment. See [sealed/docs/operations.md](../sealed/docs/operations.md) for the reasoning behind each trigger.

### Deployment target

Production is hosted on **GitHub Pages** under the custom domain `dmgctrl.app` (set by `public/CNAME`), with Cloudflare handling the domain's DNS. The site is served from the root, so the build uses base `/`. The PWA is at `/` and sealed at `/sealed/`; the `build` job assembles both into one `dist/`.

### Build identity

Each app has a generated, gitignored `src/buildIdentity.ts` with two constants, written by its own `scripts/buildIdentity.mjs`. The PWA's script is a copy of Sealed's (the two packages share no build code), so a change to one is made in both.

| | Local | CI | Audience |
| --- | --- | --- | --- |
| `COMMIT_ID` | `3f2a1c7`, or `3f2a1c7-dirty` | `github.sha`, short | machine |
| `RELEASE` | `dev-3f2a1c7` | `github.run_number` | human |

Both apps are built in the same deploy run, so a deploy gives them the same `RELEASE`. A local build carries `dev-` so it can never be mistaken for a release. The PWA sends `RELEASE` as `version` on every analytics event and shows it at the foot of the Help screen; Sealed shows it on its Help page and puts both constants on its bug reports (see [sealed/docs/operations.md](../sealed/docs/operations.md)).

The PWA's `dev`, `build`, `build:github`, `test:pwa` and `test:watch` scripts each run the generator first themselves rather than through an npm `pre` hook, because installs run with `ignore-scripts` (locally and in CI), which also skips `pre` and `post` hooks.

### Pull request previews

Every pull request from this repository gets its own preview at `https://pr-<number>.dmgctrl.workers.dev`, so a branch can be tried on a phone before it reaches production. Each preview is a Cloudflare Worker of its own, named `pr-<number>`. The `preview` job deploys the exact `dist/` that `build` produced to it with `wrangler deploy --name pr-<number>`, then posts the URL as a comment on the pull request, edited in place on each later push (`scripts/pr-preview-comment.sh`).

When the pull request is merged or closed, `.github/workflows/preview-teardown.yml` deletes the `pr-<number>` Worker through the Cloudflare API and edits the comment to say the preview is deleted. Deleting the Worker removes every version and address it had, so nothing from the branch stays reachable. A whole Worker is the unit Cloudflare can delete: it offers no way to remove a single version or preview alias, which is why each preview is its own Worker rather than a version of a shared one. If the delete fails, the teardown run fails, and the Worker is deleted by hand in the Cloudflare dashboard. The teardown shares its concurrency group with the `preview` job, so a deploy still running when the pull request closes is cancelled rather than recreating the Worker.

- **Production is untouched.** The preview Workers serve nothing on `dmgctrl.app`.
- **One address per preview.** `wrangler.jsonc` turns `workers_dev` on (the `pr-<number>` address) and `preview_urls` off, so a preview has no version-numbered addresses besides it.
- **Real HTTPS**, so the PWA installs and runs its service worker as it does in production. Each preview is its own origin, so it does not share storage or the service worker with `dmgctrl.app`.
- **Analytics and game records are refused.** `worker.dmgctrl.app` only accepts them from `https://dmgctrl.app` and `https://dev.dmgctrl.app`, which keeps preview traffic out of production data. Card data and art load from any origin.
- **Pull requests from forks and from Dependabot get no preview**, as they get no repository secrets.
- **The Cloudflare files stay off GitHub Pages.** The Cloudflare Vite plugin writes `dist/wrangler.json` and `dist/.assetsignore`, which the preview needs. `build` hands the preview the build with them, then removes them before packaging the build for Pages.

Both workflows need the `CLOUDFLARE_API_TOKEN` repository secret (a custom token with only Account → Workers Scripts → Edit). Nothing is deployed to Cloudflare from the repo root by hand; there is no `npm run deploy` script.

### What triggers the pipeline

- Push to `main`: `lint`, `test`, `build`, then `deploy` on success
- PRs targeting `main`: `lint`, `test`, `build`, then `preview`; `deploy` is skipped
- PR merged or closed: `preview-teardown.yml` deletes the preview

### Supply chain

- **No install scripts in CI.** Every `npm install` in the workflows passes `--ignore-scripts`, so no dependency's install script runs on a runner that holds a deploy secret. Nothing the build needs depends on one: esbuild, sharp and workerd, the only packages with install scripts, all work without them.
- **Actions are pinned to commit SHAs**, with the release in a comment (`actions/checkout@<sha> # v7.0.1`), so a tag moved upstream cannot change what runs.
- **Dependabot** (`.github/dependabot.yml`) proposes updates weekly for the three npm packages and for the actions, each only once it has been public for 7 days. Minor and patch updates come as one pull request per package; a major comes on its own. Security updates are raised as soon as an advisory is published. Dependabot's pull requests are exempt from `close-outside-prs.yml` and get no preview.
- **Branch protection on `main` applies to admins.** `test` and `build` must pass, and the branch must be up to date with `main`, for every merge, the owner's included.

### Pipeline: `.github/workflows/upstream-watch.yml`

Some upgrades wait on an upstream release rather than on this project, and Dependabot gives no clear signal when one lands: the release arrives inside a grouped pull request without saying it unblocks anything. This workflow runs weekly (Monday 06:00 UTC) and on manual `workflow_dispatch`, and runs `node scripts/upstream-watch.mjs` over the entries in `.github/upstream-watch.json`.

Each entry names a package, one of its peer dependencies, the version that peer range must accept, and the ticket waiting on it:

```json
{ "package": "typescript-eslint", "peer": "typescript", "version": "7.0.0", "blocks": 991 }
```

- **A watch clears** when the package's latest release on npm accepts the version. The run raises a ticket titled `chore/upstream-watch: <package> now accepts <peer> <version> (unblocks #<ticket>)`, once: the title is the record, so a later run that finds it, open or closed, stays quiet.
- **Every watch is checked before any action**, so a registry failure fails the run and raises nothing, rather than reading as a cleared blocker.
- **When every watch has cleared, the workflow disables itself.** To watch something new, add an entry and run `gh workflow enable upstream-watch.yml`. Remove an entry once its ticket is done.

It uses only the job's own token, with `issues: write` (to raise the ticket) and `actions: write` (to disable itself). A raised ticket is not on the project board: the token cannot edit it, so it is added by hand.

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
| `onAppStart()` | `app_started` | none beyond the auto fields |
| `onGameStart(baseKey, baseSet, hyperspace, playMode)` | `game_started` | `game` (`'swu'`), `baseKey`, `baseSet`, `hyperspace`, `playMode` (`'casual'` \| `'bo1'` \| `'bo3'`) |
| `onGameEnd(baseKey, baseSet, hyperspace, durationSeconds, playMode, format?)` | `game_ended` | `game` (`'swu'`), `baseKey`, `baseSet`, `hyperspace`, `durationSeconds`, `playMode`, and `format` (the tournament's) for a tournament game only; a casual game sends no `format` |
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
| `onXwingGameStarted(playerDeficit, opponentDeficit, playerFaction?, opponentFaction?)` | `game_started` | `game` (`'xwing'`), `player_deficit`, `opponent_deficit`, `player_faction`, `opponent_faction` |
| `onXwingGameEnded(payload)` | `game_ended` | `game` (`'xwing'`), `final_round`, `player_score`, `opponent_score`, `player_deficit`, `opponent_deficit`, `result`, `elapsed_seconds`, `timer_expired`, `player_faction`, `opponent_faction` |
| `onXwingRoundAdvanced(fromRound, toRound)` | `xwing_round_advanced` | `from_round`, `to_round` |
| `onXwingListSaved(faction)` | `xwing_list_saved` | `faction` |

X-Wing factions are XWS faction ids (`rebelalliance`, `galacticempire` and so on). A side's faction is taken from its list's pilots (`listFaction` in `src/utils/xwingListRules.ts`): the first pilot the card table knows. A side playing without a list, or with only pilots the table does not know, has no faction, and the field is left out. `xwing_list_saved` fires from `saveList`, which both the list builder and Import XWS go through, and leaves `faction` out for a list saved without one.

`onAppInstall` fires on the first launch of the app in standalone mode (i.e. launched from the home screen icon). It checks `window.matchMedia('(display-mode: standalone)').matches` (Android/Chrome) or `window.navigator.standalone === true` (iOS Safari), and only fires if a `pwa_install_tracked` flag is not yet set in localStorage. Once fired it sets the flag, so subsequent launches do not re-fire it. This approach is used instead of the `appinstalled` browser event because Safari does not support that event. Platform is detected as `'ios'` when `navigator.standalone === true` (exclusive to iOS Safari), `'android'` when the user agent contains `'Android'`, and `'other'` otherwise.

`onAppResume` fires when `document.visibilityState` transitions from `hidden` back to `visible` — but only after the page has been hidden at least once, so it never fires on initial load.

`sessionDurationSoFarSeconds` is `Math.floor((Date.now() - SESSION_START_TIME) / 1000)` where `SESSION_START_TIME` is a module-level constant set at load time.

Every event automatically includes fields from two sources:

**Appended by the frontend (`sendEvent`):**

| Auto field | Value | Notes |
|---|---|---|
| `env` | `import.meta.env.MODE` | `'development'` in dev, `'production'` in builds. Filter with `WHERE env = 'production'` to exclude dev traffic. |
| `sessionId` | 8-char alphanumeric string, e.g. `'a3f8kx2q'` | Generated once at module load (`Math.random().toString(36).slice(2, 10)`). Same across all events in a page session; resets on reload. Ephemeral — not stored in localStorage, no PII. Enables per-session grouping and session duration queries. |
| `version` | `RELEASE` from `src/buildIdentity.ts`, e.g. `'412'` | The deploy run number in production, `dev-<commit>` locally (see [Build identity](#build-identity)). On every event, so events from a device still running a cached build name that build. Events written before the release was recorded carry `'0.0.0'` on `app_started` only. |

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
| Start round 1 on the setup start sheet (`handleStartTournament`) | `onTournamentStarted(format, playMode, totalRounds)` |
| A tournament match is confirmed complete (`handleMatchComplete`) | `onTournamentRoundCompleted(roundNumber, result, playerScore, opponentScore, format, playMode)` |

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
| Drop confirmed in the Drop sheet (`handleDrop`) | `onTournamentDropped(roundsCompleted, format, playMode)` |
| Finish tapped on a complete tournament (`handleFinish`) | `onTournamentEnded(totalRounds, won, lost, drawn, points, format, playMode)` |

**SettingsScreen (settingsScreen.tsx)**

| Trigger | Call |
|---|---|
| Any setting changed but the Melee player ID | `onSettingChanged(settingName, newValue)` |

**SwuGameScreen (swuGameScreen.tsx)**

| Trigger | Call |
|---|---|
| Start button tapped (`handleStartGame`, round 0 → 1) | `onGameStart(baseKey, baseSet, useHyperspace, playMode)` |
| Result confirmed (`handleConfirmResult`) | `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)` — duration from Start tap to result confirmation |
| Back pressed while game is in progress (`handleReset`, `game.round > 0`) | `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)` — covers casual back-out and mid-game abandonment; guard prevents double-fire after a result is already confirmed |
| `+` tapped or drag-released | `onDamageDealt(baseKey, baseSet, amount)` |
| `−` tapped or drag-released | `onDamageHealed(baseKey, baseSet, amount)` |
| Round counter tapped | `onRoundIncremented(baseKey, baseSet, newRound)` |
| Undo button pressed | `onUndoUsed(baseKey, baseSet, undoneAction)` |
| Epic action button tapped | `onEpicActionUsed(baseKey, baseSet)` |
| Force button tapped (Force or non-Force base) | `onForceGained(baseKey, baseSet)` |
| Mystic Monastery action button tapped | `onForceGained(baseKey, baseSet)` |
| Force overlay or active Force button tapped (every SWU mode, Twin Suns included) | `onForceUsed(baseKey, baseSet)` |

**useBaseArt (useBaseArt.ts)**

| Trigger | Call |
|---|---|
| Image `onError` fires (URL fails to load) | `onImageLoadFailed(baseKey, baseSet, url)` |

**useBases (useBases.ts)**

| Trigger | Call |
|---|---|
| Fetch fails, stale cache served | `onBasesLoadStale()` |
| Fetch fails, no cache (error screen shown) | `onBasesLoadFailed()` |

**XwingGameScreen (xwingGameScreen.tsx)**

| Trigger | Call |
|---|---|
| Start Game tapped | `onXwingGameStarted(playerDeficit, opponentDeficit)` |
| Back tapped (if game was started) | `onXwingGameEnded(payload)` — includes `elapsed_seconds`, `timer_expired`, `final_round`, scores, deficits, result |
| Round segment tapped to advance | `onXwingRoundAdvanced(fromRound, toRound)` |

**useWakeLock (useWakeLock.ts)**

| Trigger | Call |
|---|---|
| `navigator.wakeLock.request()` rejects | `onWakeLockFailed(reason)` |

`durationSeconds` for SWU game events is computed in `SwuGameScreen` as `Math.round((Date.now() - gameStartTime.current) / 1000)` where `gameStartTime` is a `useRef` set in `handleStartGame` when the user taps Start. Duration therefore reflects the time spent actually playing (Start tap → result confirmation or back-out), not the time spent on the setup or between-game screens. `handleBack` in App does not fire for help or settings back-navigation. `gameBase` in App uses `tournamentCurrentBase ?? selectedBase ?? tournament?.base` so the game screen always gets the correct base after a change-base selection.

Install detection and resume detection are in separate `useEffect` calls. The install effect runs once on mount, checks standalone mode and the localStorage flag, and fires `onAppInstall` at most once per device. The visibility effect registers a `visibilitychange` listener with a `hasBeenHidden` local flag; the flag starts `false`, is set to `true` when `visibilityState === 'hidden'`, and `onAppResume` only fires when `visibilityState === 'visible'` and `hasBeenHidden` is already `true` — preventing a spurious event on first page load.

**React StrictMode note:** In development mode, React intentionally mounts, unmounts, and remounts components to detect side-effect bugs. This causes `onAppStart` to fire twice per page load in dev (two `app_started` rows within milliseconds of each other). This is expected and only happens in development — production builds fire once.

### Grafana dashboards

Dashboards are defined as JSON under `grafana/` and can be imported directly into any Grafana instance. All require an InfluxDB datasource configured against the `dmgctrl` bucket (InfluxDB 3.x / SQL query language). Each dashboard has an **Environment** variable (`$env`) — dropdown with `production` / `development` — that filters all panels to a single deployment environment.

Public (externally shared) dashboards do not substitute variables, so `$env` reaches the query as the literal text `$env`. Every environment filter is therefore written with a production fallback, and the public links show production data:

```sql
WHERE env = CASE WHEN '$env' LIKE '$%' THEN 'production' ELSE '$env' END
```

A bare `env = '$env'` works on the private dashboard and returns nothing on the public one. `src/test/grafanaDashboards.test.ts` fails on any query in `grafana/` that uses `$env` without the fallback, and on any query comparing `event` against a name that `src/services/analytics.ts` no longer sends.

| File | Purpose | Public link |
|---|---|---|
| `grafana/dmgctrl-dashboard.json` | Core app analytics: cross-game metrics, game selection, settings | [dmgCtrl Analytics](https://yetanotheridentifier.grafana.net/public-dashboards/022803ee5cd043dcaf0a19ce2f8e1d4a) |
| `grafana/dmgctrl-swu-dashboard.json` | SWU-specific analytics: sessions, bases, competitive play, settings | [dmgCtrl SWU Analytics](https://yetanotheridentifier.grafana.net/public-dashboards/02e71e370db24d1bbf6519ab9074405f) |
| `grafana/dmgctrl-xwing-dashboard.json` | X-Wing analytics: sessions, countries, results, duration, timer, squad points | [dmgCtrl X-Wing Analytics](https://yetanotheridentifier.grafana.net/public-dashboards/57328004542545778d63605a37f9f44b) |
| `grafana/dmgctrl-sealed-dashboard.json` | Sealed analytics: sessions, countries, results against the bot, leaders, sets, builds | [dmgCtrl Sealed Analytics](https://yetanotheridentifier.grafana.net/public-dashboards/496a98f3e940411b9de97bdc81018791) |

The files are in the Grafana v2 resource format (`apiVersion: dashboard.grafana.app/v2`), and `metadata.name` is the dashboard UID. A file can be created or replaced on the stack through the dashboards API (`/apis/dashboard.grafana.app/v2/namespaces/stacks-1634354/dashboards`) as well as by importing it in the UI. Every dashboard needs the **Business Charts** panel plugin (`volkovlabs-echarts-panel`) installed on the stack for its country map (see [Country maps](#country-maps)).

**Core dashboard panels (`dmgctrl-dashboard.json`):**

SWU, X-Wing and Sealed all send `game_started`, told apart by its `game` field (`swu`, `xwing`, `sealed`). SWU events written before that field existed have no `game`, so the core panels count `game IS NULL OR game = 'swu'` as SWU. Sealed's events come from its own sender, described in [sealed/docs/architecture.md](../sealed/docs/architecture.md). `src/test/grafanaDashboards.test.ts` reads the `game` values both senders use and fails if a core panel that splits games leaves one out, since an unnamed game would otherwise be counted under another.

| Panel | Type | What it shows |
|---|---|---|
| Sessions over time | Time series | Distinct `sessionId` values per day |
| Games over time | Time series | `game_started` per day, split into SWU, X-Wing and Sealed by `game`; colours: SWU = `semi-dark-blue`, X-Wing = `semi-dark-red`, Sealed = `semi-dark-purple` |
| Sessions by country | Business Charts (world map) | Each country shaded by distinct sessions there, from any event |
| Game selection | Donut | `game_started` split into SWU, X-Wing and Sealed by `game` (same colours); any other `game` shows under its own value |
| Games per session | Bar gauge | How many games (of either kind) players start per session |
| App installs over time | Time series | `app_installed` events per day, split by platform |
| Installs by platform | Donut | Cumulative installs split by `ios` / `android` / `other` |
| General feature use | Bar gauge | % of sessions that started a game, and % that returned to the app (`app_resumed`) |
| Settings changes | Bar gauge | Change count for general settings (`enableActionLog`, `enableInitiativeBar`) |
| Errors per session | Bar gauge | % of sessions that encountered cross-game errors (wake lock, image load) |
| Sessions by version | Bar gauge | Distinct sessions per `version`, newest release first (top 12): how quickly devices move off a cached build. `0.0.0` is a build from before the release was recorded |

**SWU dashboard panels (`dmgctrl-swu-dashboard.json`):**

All SWU panels on `game_started` and `game_ended` filter with `AND (game IS NULL OR game = 'swu')`: this captures events written before the `game` column existed (where it is `NULL`) and new tagged events, while excluding X-Wing. The other events these panels read (undo, force, epic action, round, favourite, match and tournament events) are sent only from SWU screens. The dashboard title is "dmgCtrl SWU Analytics".

| Panel | Type | What it shows |
|---|---|---|
| Sessions over time | Time series | Distinct `sessionId` values per day |
| Games over time | Time series | SWU game sessions started per day |
| Sessions by country | Business Charts (world map) | Each country shaded by distinct sessions that started an SWU game there |
| Base popularity | Bar gauge | Most-played bases (by `baseKey`), coloured by aspect |
| Games per session | Bar gauge | How many SWU game sessions players start per session |
| Rounds per game | Bar gauge | `round_incremented` by `round`: how many games reached each round from round 2. A round advanced, undone and advanced again counts twice |
| Favourite bases | Bar gauge | Top 15 bases by `favourite_added` minus `favourite_removed` in the time range. Favourites live on the device, so this counts changes, not the favourites players hold |
| Feature adoption | Bar gauge | % of SWU game sessions that used each feature (undo, multi-session) |
| SWU settings changes | Bar gauge | Change count for SWU-specific settings (`useHyperspace`, `enableEpicActions`, `forceTokenDisplay`, `enableCompetitiveMode`) |
| Errors per session | Bar gauge | % of SWU sessions that encountered errors (wake lock, image load) |
| Play mode | Donut | Proportion of SWU game sessions by play mode (casual / bo1 / bo3); colours: green = casual, blue = bo1, grey = bo3 |
| Tournament format | Donut | Tournaments started by format (premier / limited / eternal / twin-suns); colours: blue / green / red / grey |
| Tournament rounds | Bar gauge | Distribution of tournament length (total rounds), split by play mode (bo1 / bo3); labels show "N rounds (bo1/bo3)" |
| Bo1 game results | Bar gauge | Win / loss / draw outcomes for bo1 matches; colours: green = won, red = lost, yellow = drawn |
| Bo3 game results | Bar gauge | Win / loss / draw outcomes for bo3 matches (same colour scheme) |
| Tournament usage over time | Time series | Tournament sessions started per day |
| Tournament round outcomes | Bar gauge | Cumulative round result distribution across all tournament rounds |
| Tournament completion vs drop | Bar gauge | How tournaments end: completed (`tournament_ended`) vs dropped (`tournament_dropped`); colours: green = ended, red = dropped |
| Avg game duration by play mode | Bar gauge | Average SWU game duration in minutes (Start tap to result), split by play mode |
| Avg game duration by format | Bar gauge | Average SWU game duration in minutes, split by format |
| Avg game duration by aspect | Bar gauge | Average SWU game duration in minutes, split by base aspect (joined from `base_aspects` measurement) |

Consistent colour palettes are applied across related panels using Grafana `byName` overrides:
- **Play mode:** casual = `semi-dark-green`, bo1 = `semi-dark-blue`, bo3 = `#9e9e9e`
- **Format:** premier = `semi-dark-blue`, limited = `semi-dark-green`, twin-suns = `semi-dark-red`, eternal = `#9e9e9e`
- **Results:** won = `semi-dark-green`, lost = `semi-dark-red`, drawn = `semi-dark-yellow`
- **Tournament end:** `tournament_ended` = `semi-dark-green`, `tournament_dropped` = `semi-dark-red`
- **Tournament rounds:** `byRegexp` on `.*\(bo1\)` = `semi-dark-blue`, `.*\(bo3\)` = `#9e9e9e`
- **Aspect (avg duration panel):** Aggression = `semi-dark-red`, Command = `semi-dark-green`, Cunning = `semi-dark-yellow`, Vigilance = `semi-dark-blue`, Villainy = `#636363`; all others (Heroism, None) fall through to default `#9e9e9e`
- Bar gauge panels use `displayMode: gradient` and `color.mode: continuous-YlBl` as the standard styling; aspect panels use `color.mode: fixed, fixedColor: #9e9e9e` as the default with named overrides per aspect

Feature use is measured via usage events (sessions containing at least one relevant event) rather than settings state — this reflects actual use rather than whether the feature was merely enabled.

**X-Wing dashboard panels (`dmgctrl-xwing-dashboard.json`):**

The X-Wing game panels filter with `AND game = 'xwing'` on `game_started` and `game_ended`; "Lists saved per faction" reads `xwing_list_saved`, which only X-Wing sends. The dashboard title is "dmgCtrl X-Wing Analytics".

| Panel | Type | What it shows |
|---|---|---|
| Sessions over time | Time series | Distinct `sessionId` values per day with an X-Wing `game_started` |
| Games over time | Time series | X-Wing games started per day |
| Games by country | Business Charts (world map) | Each country shaded by X-Wing games started there; darker means more |
| Games per session | Bar gauge | How many X-Wing games players start per session |
| Games ended in the app | Stat | `game_ended` as a share of `game_started` |
| Avg game duration | Stat | Mean `elapsed_seconds` in minutes, for games over 60 seconds |
| Results | Donut | `result` as won / lost / drawn / no result, using the results palette above; no result is `#9e9e9e` |
| Timer | Donut | Whether `timer_expired` was set: finished in time = `semi-dark-blue`, timer expired = `#9e9e9e` |
| Squad points deficit | Bar gauge | Games by the player's `player_deficit`, taken from `game_started` |
| Final round | Bar gauge | Games by `final_round` |
| Score margin | Bar gauge | `player_score - opponent_score` in bands (lost by 50+ through won by 50+), for games with a result |
| Lists saved per faction | Bar gauge | `xwing_list_saved` events by `faction`; a list saved without one shows as "no faction" |
| Win rate per faction | Bar gauge | Share of sides won per faction over games with a result, counting both sides (the opponent's faction takes the reversed result); draws count as not won; the label carries the number of sides |

What the X-Wing events can and cannot show:

- **Only games left through the game screen send `game_ended`.** Closing the app mid-game sends nothing, so results, duration, timer, final round and score margin cover only the share shown in "Games ended in the app".
- **Tournament games are not distinguished.** A tournament round uses the same game screen and sends the same events as a casual game, so tournament games are counted with the rest and there is no tournament panel.
- **No scenario, match type or settings events are sent for X-Wing**, so the dashboard has no panels for them.
- **Lists live only on the device**, so "Lists saved per faction" counts saves in the time range, not the lists players hold, and saving an edited list counts again.
- **`result` is stored as the string `'null'`** when a game ends without one, not as a SQL `NULL`; the Results panel maps everything other than `win` / `loss` / `draw` to "no result".

**Sealed dashboard panels (`dmgctrl-sealed-dashboard.json`):**

Every panel filters with `AND game = 'sealed'`. Sealed sends its events from its own sender (see [sealed/docs/architecture.md](../sealed/docs/architecture.md)); a game end repeats the game start's deck fields, so the result panels read `game_ended` alone. The dashboard title is "dmgCtrl Sealed Analytics".

| Panel | Type | What it shows |
|---|---|---|
| Sessions over time | Time series | Distinct `sessionId` values per day with any Sealed event |
| Games over time | Time series | Sealed `game_started` per day, rematches included |
| Sessions by country | Business Charts (world map) | Each country shaded by Sealed sessions there |
| Win rate by leader | Bar gauge | The player's win rate against the bot by `player_leader_name` (`Card Name (SET)`), top 20; draws count as not won; the label carries the number of games after a dot. Games from builds that sent only the id fall back to `player_leader` |
| Results against the bot | Donut | `result` as won / lost / drawn, using the results palette above |
| How games end | Donut | `conceded_by`: played out = `semi-dark-blue`, bot conceded = `semi-dark-green` (an offer to concede the player accepted), player conceded = `semi-dark-red` |
| Games finished | Stat | `game_ended` as a share of `game_started`: leaving for a new setup or closing the app sends no end |
| Avg game duration | Stat | Mean `durationSeconds` in minutes, for games over 60 seconds |
| Rounds per game | Bar gauge | Games by the `round` they ended in |
| Opponent deck | Donut | `opponent_deck`: generated = `semi-dark-blue`, saved = `#9e9e9e`; "Any of my decks" counts as saved |
| Set popularity | Bar gauge | Games by `player_set`, named `Set Name (CODE)` in the query (names from the card API's `/sets`); a code it does not name shows bare. `src/test/grafanaDashboards.test.ts` fails if a set in Sealed's `SET_TOTALS` (`sealed/src/data/implementedCards.ts`) is missing, so adding a set to Sealed means naming it here |
| Sessions by version | Bar gauge | Distinct sessions per Sealed `version`, newest release first (top 12) |

#### Country maps

Each dashboard has one country map (core, SWU and Sealed "Sessions by country", X-Wing "Games by country"). They are Business Charts panels because the built-in Geomap cannot shade a country from query data: its GeoJSON layer styles shapes only by properties in the file.

They all run the same script, and `src/test/grafanaDashboards.test.ts` fails if any copy differs, so a fix to it is made in every dashboard file. Only the query changes between them. The query returns a `country` column and one count column. The script names the count in the tooltip and legend after that column (`games`, `sessions`), and turns the two-letter `country` code into the English country name the plugin's world map uses, with `Intl.DisplayNames` and a short alias table for the names that differ (for example `US` is "United States of America"). Countries too small for that map, such as Malta or Singapore, are counted but not drawn, and development traffic has no country.

### `base_aspects` InfluxDB measurement

A separate InfluxDB measurement (`base_aspects`) stores a static `baseKey → aspect` lookup used by the base popularity panel to colour bars. It is populated by `scripts/populate-base-aspects.mjs`, which fetches base card data from swuapi.com (active sets) and the swu-db proxy (rotated sets) and writes one record per base. Every record in a run shares a single timestamp, so the Grafana query can select one whole run by its time.

swuapi is the primary source: the script reads its set list, then queries swu-db only for the sets swuapi has no bases for. Those swu-db queries are **scoped to one set each**. An unscoped `type:base` query is a single point of failure, because swu-db returns 502 for the entire query when any one set's base records cannot be served. Per-set queries confine that to the offending set: it is named in a warning, its bases are omitted from the run, and the remaining sets are still written. A set absent from swuapi's set list is never queried, so bases for a set that only swu-db knows about are not picked up until swuapi lists it.

The daily GitHub Actions workflow (`.github/workflows/populate-base-aspects.yml`) keeps the records within the 30-day InfluxDB retention window. The Grafana query joins `events` against `base_aspects` using a derived-table subquery to select only the most recent run's records:

```sql
LEFT JOIN (
  SELECT ba."baseKey", ba.aspect
  FROM base_aspects ba
  INNER JOIN (SELECT MAX(time) AS max_time FROM base_aspects) lr ON ba.time = lr.max_time
) la ON e."baseKey" = la."baseKey"
```

Aspect colour is embedded directly in the SQL result (a `CASE` expression returning a hex string) and injected into each field's `fieldConfig` via the Grafana `rowsToFields` transformation's `color` mapping handler. This bypasses Grafana's field-override matcher, which does not reliably see post-transformation fields.

All panels respect the Grafana time range picker and use the `$env` variable to filter by environment. `country`, `city`, `latitude`, and `longitude` are populated by the Cloudflare Worker from `request.cf` and are absent or `'unknown'` for events received outside the production edge network (e.g. local dev). The dashboards map by `country`. The city and coordinates are those of the Cloudflare edge PoP that served the request, not the user's device, so no panel plots them.

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
- Standalone scripts under `scripts/` instead take an optional `fetchImpl` parameter defaulting to `fetch`, so tests pass a stub directly rather than replacing the global. `populate-base-aspects.mjs` uses this for `fetchSetCodes` and `fetchSwuDbBases`, which lets a test drive per-set success and failure in one call
- localStorage is mocked with `vi.stubGlobal('localStorage', ...)` to test caching paths
- All mocks are torn down with `vi.unstubAllGlobals()` in `afterEach`
- `useUserSettings` is mocked with `vi.mock('../hooks/useUserSettings', ...)` in tests that exercise preference-gated behaviour; `vi.hoisted` is used for mock values that need per-test control
- `useFavourites` is mocked with `vi.mock('../hooks/useFavourites', ...)` in setup screen tests; `vi.hoisted` provides per-test control over `favourites`, `addFavourite`, `removeFavourite`
- `App.test.tsx` mocks `useBases` at the module level (`vi.mock('../hooks/useBases', ...)`) so data is available synchronously; this allows the tests to focus on navigation logic rather than data loading. A test that needs the splash or the offline screen sets the mock's `loading` or `error` with no bases; `waitFor` with the default timeout handles any async React batching.

### Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Always use `npm test`. The `npx vitest run` form has a cache glitch that causes spurious first-run failures.

`npm test` runs three separate Vitest suites in sequence: this app (`npm run test:pwa`), the proxy worker, and sealed. Each config sets `test.name` (`pwa`, `proxy`, `sealed`), which labels individual failures and the terminal output.

**The CI job runs them as three named steps rather than one `npm test`**, each writing a heading to the job summary before it runs, and a final step strips Vitest's own heading so each suite has exactly one:

```
# PWA Test Report
_The tracker app in `src/`: X-Wing, SWU tracking, Kill Team._
### Summary
...
```

Vitest's GitHub reporter hardcodes its `## Vitest Test Report` heading and puts the project name only on individual failures, so three suites in one step produced three identical anonymous blocks that had to be told apart by counting tests. `test.name` does not reach that block; the headings are ours, and the strip step runs on `always()` so the summary still reads properly on a failed run.

### Linting

```bash
npm run lint                 # this app
npm run lint --prefix sealed # sealed
```

Both run at **`--max-warnings 0`**, in CI's own `lint` job. A warning is therefore a build failure, which is the point: a rule worth enabling as a warning is worth acting on, and a permanently warning-but-green build teaches everyone to scroll past it.

Each package lints itself with its own config. Flat config does not cascade, so `sealed` is in the root config's `ignores`; without that the root run would lint sealed's files with the PWA's ruleset as well as sealed's own run doing it properly.

### Test environments

This suite defaults to the **`jsdom`** environment, because 36 of its 44 files render a component or a hook. The handful of pure-logic files (parsing, formatting, URL helpers, the Node script test) carry a `// @vitest-environment node` docblock, which skips building a DOM they never use.

Sealed defaults the other way round, to `node`, since most of its files are engine and AI code. The rule is the same in both: the default matches the common case for that suite, and the exception declares itself in the file.

### mkcert is a dev-server-only plugin

`vite-plugin-mkcert` issues the local certificate behind `npm run dev:https`. It asks the GitHub API for the latest mkcert release while Vite resolves the config, so it is applied **only when serving locally** (`command === 'serve'`, and neither `VITEST` nor `CI` set).

It must not run anywhere else. Vitest resolves this config on startup, so an ungated plugin called that API on every test run too, and CI runners share an IP and therefore share the unauthenticated rate limit: a pipeline run failed with a 403 that had nothing to do with certificates, and the next passed only because the shared quota had moved on.

### The Cloudflare plugin stays out of a test run

`@cloudflare/vite-plugin` builds the Worker that serves the app, so a build (CI's included) and the dev server load it. A test run (`VITEST` set) does not: since its 1.58 the plugin stops Vitest starting at all ("There is already a server associated with the config", workers-sdk #15969), and no test runs the Worker. `viteConfig.test.ts` pins both sides.

### jest-dom matcher types

jest-dom's own type augmentation targets Vitest's old `Assertion<T>`, and Vitest 5's `Assertion<R, T>` no longer merges with it (testing-library/jest-dom #738), so each suite declares the matchers onto Vitest's `Matchers` interface itself, in `src/test/jestDomVitest.d.ts`. Sealed holds an identical copy. Both go once jest-dom ships a fix.

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
