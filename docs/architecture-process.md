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

---

## 3. Analytics

### Cloudflare Web Analytics

A Cloudflare Web Analytics beacon is embedded in `index.html`. It fires on every page load (i.e. every app start) and provides:

- App load counts over time
- Unique visitor counts (privacy-preserving, no cookies, no consent banner required)
- Countries, browsers, devices

The beacon token (`aaed1e18376f4bdd9f56a0050acce291`) is a public identifier — it is not a secret and is safe to commit.

Custom event tracking (game starts, base popularity) is not covered by the Cloudflare beacon, which only records page loads. This is handled by a `POST /analytics` endpoint on the Cloudflare Worker, which writes structured events to InfluxDB Cloud (free tier, `dmgctrl` bucket, 30-day retention).

### Analytics Worker endpoint

- **Endpoint:** `POST https://worker.dmgctrl.app/analytics`
- **Payload:** `{ event: string, data: Record<string, unknown> }`
- **Storage:** Writes to InfluxDB Cloud in line-protocol format — event name becomes a tag (`event=<name>`), payload fields become InfluxDB fields with type inference (integers get the `i` suffix, floats are bare, strings are quoted)
- **Measurement:** `events`
- **Auth:** InfluxDB write token stored as a Cloudflare Worker secret (`INFLUXDB_TOKEN`); org and URL stored as `INFLUXDB_ORG` and `INFLUXDB_URL`
- **CORS:** Restricted to an allowed-origins set (`https://dmgctrl.app`, `https://dev.dmgctrl.app`). The worker reads the `Origin` request header and echoes it in `Access-Control-Allow-Origin` only when it matches — unknown origins receive no CORS headers. This is intentionally stricter than the card-data proxy routes (which use `*`).
- **Responses:** 204 on success, 400 for malformed JSON, 500 on InfluxDB error
- **Querying:** InfluxDB Cloud 3.x (Serverless); use SQL — camelCase column names must be double-quoted, e.g.:
  ```sql
  SELECT time, event, "sessionId", "baseKey", "baseSet", hyperspace, "durationSeconds"
  FROM events
  WHERE time > now() - interval '24 hours'
  ORDER BY time ASC
  ```

### Frontend analytics service (`src/services/analytics.ts`)

Three public functions fire events to the worker endpoint. All are fire-and-forget — they return `Promise<void>` so tests can await them, but callers use `void` (errors are silently discarded):

| Function | Event name | Payload fields |
|---|---|---|
| `onAppStart()` | `app_started` | `version` (from package.json) |
| `onGameStart(baseKey, baseSet, hyperspace)` | `game_started` | `baseKey`, `baseSet`, `hyperspace` |
| `onGameEnd(baseKey, baseSet, hyperspace, durationSeconds)` | `game_ended` | `baseKey`, `baseSet`, `hyperspace`, `durationSeconds` |

Every event automatically includes two fields appended by `sendEvent`:

| Auto field | Value | Notes |
|---|---|---|
| `env` | `import.meta.env.MODE` | `'development'` in dev, `'production'` in builds. Filter with `WHERE env = 'production'` to exclude dev traffic. |
| `sessionId` | 8-char alphanumeric string, e.g. `'a3f8kx2q'` | Generated once at module load (`Math.random().toString(36).slice(2, 10)`). Same across all events in a page session; resets on reload. Ephemeral — not stored in localStorage, no PII. Enables per-session grouping and session duration queries. |

The endpoint URL defaults to `https://worker.dmgctrl.app/analytics` and can be overridden via the `VITE_ANALYTICS_URL` environment variable (useful for local worker dev with `wrangler dev`).

### Wiring in App.tsx

| Trigger | Call |
|---|---|
| App mount (`useEffect`) | `onAppStart()` |
| User starts a game (`handleConfirm`) | `onGameStart(baseKey, baseSet, useHyperspace)` |
| User ends a game (`handleBack`) | `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds)` |

`durationSeconds` is computed as `Math.round((Date.now() - gameStartTime) / 1000)` where `gameStartTime` is recorded at the start of `handleConfirm`. `handleBack` only fires `onGameEnd` when `selectedBase` is set (i.e. the back button was pressed from the game screen, not from help or settings).

**React StrictMode note:** In development mode, React intentionally mounts, unmounts, and remounts components to detect side-effect bugs. This causes `onAppStart` to fire twice per page load in dev (two `app_started` rows within milliseconds of each other). This is expected and only happens in development — production builds fire once.

The Worker endpoint (#97) and frontend service (#98) are both complete. Base popularity events (#99) are pending.

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
