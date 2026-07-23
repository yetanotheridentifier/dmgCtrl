# Sealed: Operations & Maintenance

## Local development

```bash
npm --prefix sealed install        # once
npm --prefix sealed run dev        # dev server (Vite, hot reload, port 5174)
npm --prefix sealed test           # test suite
npm --prefix sealed run test:watch # TDD loop
npm --prefix sealed run lint       # eslint
npx --prefix sealed tsc -b         # typecheck (also part of build)
npm run check --prefix sealed      # validation gate: bump build tag, test, tsc, eslint
npm run bench --prefix sealed      # AI benchmark: play many games between two AIs, report win rates
```

### AI benchmark

`npm run bench` is the headless yardstick for the AI opponents: it plays many full games between two
named AIs and reports win rate (with a confidence interval), base-damage margin, game length and
throughput, saving each run to a local SQLite database (`sealed/bench-results/bench.db`). It is not
part of `npm test` (a large run is hundreds of thousands of `resolve` calls) and needs no server.

```bash
npm run bench --prefix sealed -- --games 1000 --seed 42 random random
```

It also has a **coverage sweep** (`--sweep`) that plays across a generated deck set covering every
card in the pool, fuzzing the whole set for hangs and throws (each dropped game is saved as a
replayable fixture):

```bash
npm run bench --prefix sealed -- --sweep --games 20 --seed 42
```

And a **generalisation diagnostic** (`--generalise`) that plays one AI against another across the
coverage decks and reports the per-deck win rate (weakest first), to see where an AI is weak and
whether a new version beats the current one:

```bash
npm run bench --prefix sealed -- --generalise --games 40 --seed 42   # greedy vs random by default
```

To tune the greedy evaluation weights, `npm run tune` sweeps candidate weights against the frozen
baseline across the coverage decks:

```bash
npm run tune --prefix sealed -- --games 100 4,2,1,4 3,2,1,4   # unit,power,hp,base per config
```

Full guide, output format, data model, the coverage sweep, the generalisation diagnostic, weight
tuning and how to add an AI: [ai-benchmark.md](ai-benchmark.md).

`npm run check` is the one-shot validation gate: it auto-increments `BUILD_TAG`
(`src/buildTag.ts`) via `scripts/bumpBuild.mjs`, then runs the tests, `tsc -b`
and `eslint .` in sequence, stopping at the first failure. Prefer it over bumping
the tag by hand.

The root `npm test` runs all three suites (main app, proxy worker, sealed).

### Serving at https://dev.dmgctrl.app/sealed (dev)

The sealed app rides the PWA's dev setup: the main Vite server proxies
`/sealed` (including the HMR websocket) to the sealed dev server on port 5174.
One command starts both (Ctrl+C stops both):

```bash
npm run dev:all       # sealed dev server (5174) + main PWA dev server (5173)
```

Or run them individually in two terminals:

```bash
npm run dev:https     # main PWA dev server, https via mkcert, port 5173
npm run dev:sealed    # sealed dev server, port 5174 (fixed, strict)
```

Then browse the same way you already reach the PWA dev site. Whatever routes
`dev.dmgctrl.app` to the main dev server (Cloudflare tunnel or hosts entry)
also serves `/sealed`, because the sealed app is proxied through the **same
origin**. No Cloudflare changes are needed. Directly on the machine,
`https://localhost:5173/sealed/` works too.

**Bad Gateway (502) on `/sealed`** means the sealed dev server (port 5174)
isn't running, so the main server's proxy has nothing to forward to. Start
`npm run dev:sealed` and reload. (A 502 on the whole site means the main dev
server on 5173 is down.)

Plain `npm --prefix sealed run dev` alone still works too, at
`http://localhost:5174/sealed/` (no https, no PWA).

**Tab favicon**: dev shows the **white** dmgCtrl icon, prod the **blue** one, so
the dev tab is easy to tell apart (`src/favicon.ts`, driven by `import.meta.env.DEV`;
static blue fallback in `index.html`). Both icons live in `sealed/public/` (#329).

## Build & deploy (prod: https://dmgctrl.app/sealed)

Production is GitHub Pages, deployed by `.github/workflows/deploy.yml` on every
push to `main`. The workflow:

1. installs root + proxy + sealed dependencies and runs the full test suite
2. builds the main app into `dist/`
3. builds the sealed app (`npm run build --prefix sealed` into `sealed/dist`, asset
   URLs rooted at `/sealed/`)
4. copies `sealed/dist/*` into `dist/sealed/` and publishes `dist` to Pages

So **pushing to main is all that's needed**: dmgctrl.app/sealed deploys with
the PWA. There is no server-side component; the app only makes read-only calls
to the existing Cloudflare worker and swuapi.com.

**PWA interaction**: the main app's service worker controls the whole origin.
Its workbox config carries `navigateFallbackDenylist: [/^\/sealed/]` (see root
`vite.config.ts`) so navigations to `/sealed` are never rewritten to the PWA's
index.html. Keep that in place if the workbox config is ever reworked.

To reproduce the prod artifact locally:

```bash
npm run build && npm run build --prefix sealed
mkdir -p dist/sealed && cp -r sealed/dist/* dist/sealed/
```

**Worker dependency**: card detail is proxied through the worker's fallback route
and card art through its `/art/<path>` route (`proxy/worker.js`). If the worker's
routing changes, keep paths that forward `/cards/...` to `api.swu-db.com` and
`/art/...` to `cdn.swu-db.com`, both with `Access-Control-Allow-Origin`. The
app-side base URL is `SWU_DB_API` in `sealed/src/data/cards.ts` (pinned by a
test).

### ⚠️ Two workers: deploy the right one

There are **two separate Cloudflare Worker projects** in this repo, and they are
easy to confuse:

| Worker | Config | Serves | Deploy |
|---|---|---|---|
| **swu-proxy** | `proxy/wrangler.toml` | `worker.dmgctrl.app`, the CORS/art proxy the sealed app depends on | `npm run deploy:proxy` |
| **dmgctrl** | root `wrangler.jsonc` | the main app as a CF Worker (added with `@cloudflare/vite-plugin`) | `npm run deploy` |

Running bare `wrangler deploy` (or `npm run deploy`) **from the repo root deploys
the main-app worker, NOT the proxy**: it picks up the root `wrangler.jsonc`.
Changes to `proxy/worker.js` (the `/art/`, `/cards/`, `/analytics` routes) only
go live via **`npm run deploy:proxy`**.

**The redirect trap (why `deploy:proxy` needs `--config`):** the
`@cloudflare/vite-plugin` writes a repo-wide redirect at
`.wrangler/deploy/config.json` pointing wrangler at the built main-app config
(`dist/wrangler.json`). Wrangler honours that redirect from *any* subdirectory,
so even `wrangler deploy` run inside `proxy/` will silently redeploy the **main
app** instead of the proxy (telltale: `Using redirected Wrangler configuration`
plus `Uploaded dmgctrl` in the output). The `deploy:proxy` script therefore passes
`--config wrangler.toml` explicitly, which overrides the redirect. Do **not**
remove that flag.

Quick check that the proxy is current: art must return an image, not JSON.

```bash
curl -sI "https://worker.dmgctrl.app/art/images/cards/SOR/086.png" | grep -i content-type
# expect: content-type: image/png   (JSON => old worker, redeploy the proxy)
```

## Client-side state (support playbook)

Everything is on-device; there is no account or server state.

| What | Where | Reset |
|---|---|---|
| Imported decks | localStorage key `sealed_decks` | Remove buttons in-app, or clear the key |
| Card cache | IndexedDB `dmgctrl-sealed` → `cards` | Delete the DB in devtools, it re-hydrates on next play |
| Game records | IndexedDB `dmgctrl-sealed` → `games` | See "Clearing game records" below |

### Clearing game records

1. Open the app: **https://dmgctrl.app/sealed** (or the dev server). IndexedDB is per-origin,
   so this must be the tab actually running the app, not a blank tab.
2. Open devtools (**F12**, or **Ctrl+Shift+I** / **Cmd+Option+I**) and go to the **Console**.
3. Paste and run:

```js
__sealedClearGames()
```

It logs `[sealed] cleared N game records` and resolves to the number deleted. Run it again and
you should see `0`, which confirms the store is empty rather than the call having silently done
nothing.

If the console reports `__sealedClearGames is not defined`, the tab is running an older build:
hard-reload (**Ctrl+Shift+R** / **Cmd+Shift+R**) and try again. Failing that, either route below
works without any app code:

```js
indexedDB.open('dmgctrl-sealed').onsuccess = e => {
  const store = e.target.result.transaction('games', 'readwrite').objectStore('games')
  store.clear().onsuccess = () => console.log('game records cleared')
}
```

Or by hand: **Application → IndexedDB → dmgctrl-sealed → games → Clear object store**.

All three touch only `games`. Imported decks (localStorage) and the card cache are untouched, so
nothing needs re-hydrating afterwards and your decks stay put.

**When you need to:** records written before the AI became state-seeded (#366) **do not replay
faithfully**, because that opponent drew from `Math.random`, so re-resolving the stored move list
diverges from the stored final state. Records are the substrate for E7 training, so clear the
store once before collecting anything you intend to train on. Records written since are exact
replays, and there's a test pinning that (`deterministicReplay.test.ts`).

## Diagnostics & logging

The app keeps a capped in-memory diagnostic log (`src/data/log.ts`). Every entry
also mirrors to the devtools console with a `[sealed]` prefix.

- **Console**: filter on `[sealed]` to follow hydration and game-load events live.
- **Support dump**: run `__sealedLogs()` in the devtools console for the last 200
  entries (`{at, level, message, detail}`), useful to paste into a bug report.
- **Wipe game records**: `__sealedClearGames()`, see "Clearing game records" above.

**"Couldn't load the cards for this deck"** now shows the specific cause under the
message (e.g. `Card ASH_020 could not be loaded (SWUDB 502, no swuapi match)`),
and the log records each stage. Card hydration tries, in order:

1. IndexedDB cache
2. SWUDB card detail via the worker (`worker.dmgctrl.app/cards/{set}/{number}`)
3. swuapi.com Base list fallback. SWUDB's detail endpoint is known to 502 on
   some base ranges (observed: all ASH bases); swuapi is the same source the
   main app uses for base data

If a card fails on all sources, the thrown error names the card id and the
upstream status. Check whether the id exists on swudb.com, whether the worker
is up, and whether the browser is offline.

**"Failed to fetch" in the log** means the browser rejected the request before
any HTTP status existed, usually a response without CORS headers. The worker
now guarantees CORS headers on *error* responses too (upstream errors used to
escape as Cloudflare 1101 pages without them), and the client treats a rejected
fetch like an error status and continues to the fallback. If the worker is
changed, redeploy it (`npx wrangler deploy` in `proxy/`). The client-side
fallback covers base cards even against a broken worker, but other card types
need the worker healthy.

When chasing a load failure, first make sure you're running current code:
the app shows a **build tag** (e.g. `b58`, the `BUILD_TAG` constant in
`src/buildTag.ts`, auto-bumped by `npm run check`). In dev it's a small badge in
the **bottom-right corner**; in prod it sits at the foot of the **Help** page
(#332). If the browser shows an older tag, restart the dev servers and
hard-reload (Ctrl+Shift+R). Known
upstream state (2026-07): SWUDB card detail 502s on the ASH bases
(ASH_019/020/023 confirmed); all recover via the swuapi fallback.

A broken IndexedDB cannot break card loading: cache reads/writes are
non-fatal (logged as warnings, hydration continues from the network). If the
`dmgctrl-sealed` database gets into a crossed-version state during dev (e.g. a
`VersionError` in the log after switching between old and new code), delete it
in devtools → Application → IndexedDB; it rebuilds on the next game.

## Updating for new card sets

Nothing to do: cards are fetched by `{set}/{number}` straight from SWUDB via the
worker, so new sets work as soon as SWUDB serves them. If SWUDB changes its payload
field names, update `SwuCard` (`data/cards.ts`) and `normaliseCard`
(`engine/cardDb.ts`); both are test-covered.

## Extending the engine (post-spike epics)

- **Smarter AI (T5.2+)**: implement alongside `ai/randomAi.ts`; the contract is
  `(state) => Action | null` choosing from `legalMoves(state)`, drawing any
  randomness from `state.rngSeed` so games stay replayable. Register it by name in
  `ai/registry.ts`, then measure it with `npm run bench` (see
  [ai-benchmark.md](ai-benchmark.md)). **Deploy** a model by setting `OPPONENT_AI` in
  `src/config.ts` to its registered name and redeploying (a reviewed one-line change, not a
  user choice); tests still inject their own via `UseGameOptions.ai`. Move to a Web Worker
  (T5.4) before MCTS. The current deployed model is `greedy` (one-ply, beats `random` ~100%).
- **Abilities/keywords**: extend `EngineCard` with parsed ability data in
  `cardDb.ts`, generate/resolve in `legalMoves.ts`/`resolve.ts`. Keep both pure.
- **Schema changes**: `GameState` changes ripple into `engineFixtures.ts` and the
  JSON round-trip test; the compiler walks you through every site.
- **New Dexie tables**: add a new `this.version(n).stores({...})` block in
  `data/db.ts`; never edit an existing version line.

## Docs

- `sealed/docs/architecture.md`: system design (this folder)
- `sealed/docs/operations.md`: this file
- `sealed/docs/ai-benchmark.md`: the AI benchmark harness (`npm run bench`), output, data model
- `sealed/docs/userGuide.md`: user guide, **imported at build time as the in-app
  Help page**, so editing it updates the app's help content
- `sealed/README.md`: quick orientation + decisions log
- `docs/swu-ai-handoff.html` (repo root): original build plan / epic roadmap
