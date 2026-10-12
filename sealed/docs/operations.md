# Sealed: Operations & Maintenance

## Local development

```bash
npm --prefix sealed install        # once
npm --prefix sealed run dev        # dev server (Vite, hot reload, port 5174)
npm --prefix sealed test           # test suite, minus the simulation tests
npm --prefix sealed run test:bench # the simulation tests on their own
npm --prefix sealed run test:watch # TDD loop
npm --prefix sealed run lint       # eslint, at --max-warnings 0
npx --prefix sealed tsc -b         # typecheck (also part of build)
npm run check --prefix sealed      # validation gate: build identity, test, tsc, eslint
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
npm run bench --prefix sealed -- --sweep --games 5 --seed 42,43,44
```

`--seed` takes a list, and coverage is the union across them. Five games a deck on three seeds plays
every card in the pool in a few seconds; one long single-seed run does not, because the last card or
two is seed-luck rather than run length.

`--set LAW,SEC` (or `--set all`) sweeps other sets, each building its own decks. Sets under 200 cards
are not designed for sealed and are left out. A set's bundled card data is refreshed from the card API
with `--fixture SET` (or `--fixture all`); see the sweep section of `ai-benchmark.md` before
refreshing ASH, since it changes the decks every bench plays.

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

The **matchup matrix** (`--matrix`) measures deck strength and matchups: every leader paired with
every base aspect it does not already carry (52 decks), played deck-vs-deck under one model, stored in
the SQLite `matchups` table (under 40 min for `greedy`; `--seed` picks the deck suite):

```bash
npm run bench --prefix sealed -- --matrix --games 14 --seed 42 greedy
```

The **card triage** (`--triage`) is not an AI mode: it classifies a card pool by what the engine
cannot yet express, so a newly released set can be sized without reading every card by hand. It
fetches each set live from the card API, so it works on release day with no fixture:

```bash
npm run bench --prefix sealed -- --triage LAW SEC
```

#### Comparing two AIs: always with `--control`

A long comparison runs as N parallel single-threaded processes (`--shard`), one per seed, and
`--control` additionally plays the baseline against **itself** on the same seeds:

```bash
npm run bench --prefix sealed -- 'beam-reply+someWeight=3' beam-reply \
  --games 168 --shard 12 --seed 9001 --decks coverage --control
```

**`--games` is per shard**, so that is 2,016 games a side, and the wall clock is set by the 168 rather
than by the total. Keep it a multiple of four; a pre-flight check warns if not.

**The paired difference is the result, not the win rate.** Identical bots do not measure 50% over the
coverage decks (48.6% and 48.7% on two independent seed blocks), so an arm read against a theoretical
50% can invert: one arm reads +1.1 and non-significant against 50, and +2.35 at p < 0.001 against its
own control on the same games.

Each comparison is stored as one row and read back with `--history`:

```bash
npm run bench --prefix sealed -- --history 'tie=reply'
```

#### Watching a long run

```bash
npm run bench --prefix sealed -- --status      # read-only, starts nothing
```

Reports, per run, shards done of total, games played, **measured** seconds per game and a projected
finish. Every sharded run also rewrites `sealed/bench-results/STATUS.md` as each shard lands, so a
multi-hour run can be followed from an open editor tab.

**An incomplete run is labelled `PARTIAL` and shows no pooled rate.** A subset of shards looks exactly
like a finished run and has been mistaken for one more than once.

A run resumes by re-running the identical command: finished shards are skipped, failed ones repeat.
Results carry a `commitId`, so a re-run after a code change re-plays rather than replaying stale
numbers as new ones. The practical consequence is that **a seed range is spent once per AI-name pair**:
after a code change, use a fresh base seed, and a fresh control at those seeds.

Full guide, output format, data model, the coverage sweep, the generalisation diagnostic, the card
triage, weight tuning and how to add an AI: [ai-benchmark.md](ai-benchmark.md).

`npm run check` is the one-shot validation gate: it regenerates the build identity, then runs the
tests, `tsc -b` and `eslint .` in sequence, stopping at the first failure. **It runs every test,
including the simulation tests that `npm test` leaves out**, so it stays the honest local gate
before handing work over.

The root `npm test` runs all three suites (main app, proxy worker, sealed). Each is a separate
Vitest run writing its own CI summary, so each config sets `test.name` (`pwa`, `proxy`, `sealed`)
and the report says which is which.

### Two projects, and which one runs when

The sealed suite is split into two Vitest projects:

| Project | Holds | Runs |
| --- | --- | --- |
| `sealed` | everything else | `npm test`, and CI's `test` job |
| `sealed-bench` | the files in `SIMULATION_TESTS` (`vite.config.ts`) | `npm run test:bench`, and CI's own **Simulation tests** workflow |

The split is about CPU, not importance. The simulation tests play real games to reach their
numbers, and cost roughly 254s of the suite's ~350s of test CPU. A single job is CPU-bound on a
4-vCPU runner, so leaving them in the test job was the difference between a five-minute pipeline
and a two-minute one. Their sample sizes are deliberately **not** trimmed to make them fit: they
measure rates over simulated games, and a smaller sample widens the interval until the assertion
stops meaning anything.

**Each CI job gets its own runner**, so moving them to a separate workflow costs a runner rather
than wall-clock time: that job finishes inside the test job's window. They still run on every
pull request, so a failure is attributable to the change that caused it, and on pushes to `main`,
where only one merge sits between runs. The nightly run exists for a narrower reason: CI installs
with `npm install` rather than `npm ci`, so a failure on an unchanged tree points at the
environment.

That workflow does not gate deployment. It is not in `deploy.yml`, and `build` waits only on
`lint` and `test`.

Locally, `npm test` leaves them out so the inner loop stays around 25s, and `npm run check`
includes them. Both projects share one worker pool, so `check` is about 122s rather than the 126s
of running them one after the other; the floor is the suite's CPU, not the split.

### Test environments

Tests default to the **`node`** environment in sealed, because about 150 of its ~190 files are
engine, AI and bench code that never touch a DOM, and building one per file cost more than
running the tests: measured over 16 engine files, 28.6s of CPU against 9.2s. **A new sealed test
that renders a component, or touches `localStorage`, `document` or the Dexie `db`, needs a
`// @vitest-environment jsdom` docblock at the top of the file.** Without one it fails on a
missing global, which is loud rather than subtle.

The PWA suite defaults the other way, to `jsdom`, because 36 of its 44 files render something.
Its few pure-logic files carry `// @vitest-environment node` instead. Both defaults follow the
same rule, which is to match the common case in that suite and make the exception declare itself.

## Build identity: two identifiers, two audiences

`src/buildIdentity.ts` is **generated and gitignored**, written by `scripts/buildIdentity.mjs` before
every dev server, build, test, bench and tune run (npm `pre` hooks), and on `npm install`.

| | Local | CI | Audience |
| --- | --- | --- | --- |
| `COMMIT_ID` | `3f2a1c7`, or `3f2a1c7-dirty` | `github.sha`, short | machine |
| `RELEASE` | `dev-3f2a1c7` | `github.run_number` | human |

**`COMMIT_ID` identifies the code.** It is stamped on every bench run and stored in the SQLite `runs`
table, so a measurement is attributable to real code. A **`-dirty`** suffix means the tree had
uncommitted changes and the run belongs to no commit at all, which matters because most AI
measurement happens exactly there.

**`RELEASE` is what a person reads out.** It is issued once by the deployment pipeline, so it is
monotonic and cannot collide. A local build shows `dev-` so it can never be mistaken for a release.
The bug report carries both.

The file is generated rather than tracked for a specific reason. It used to be a hand-maintained
counter bumped by `npm run check`, so two branches incremented it independently and **the same tag
was issued to different code**, with no merge involved. An untracked file cannot do that, and cannot
conflict on merge either.

Two consequences worth knowing:

- **Rows in `runs` from before this change carry the old `bN` counter** and cannot be mapped to a
  commit, because the mapping never existed. Treat them as engine-ambiguous rather than inventing one.
- The column is still named `build_tag`. Renaming it needs a migration for no gain; what it holds
  changed, and that is recorded here.

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
static blue fallback in `index.html`). Both icons live in `sealed/public/`.

## Build & deploy (prod: https://dmgctrl.app/sealed)

Production is GitHub Pages, deployed by `.github/workflows/deploy.yml` on every
push to `main`. The workflow:

1. installs root + proxy + sealed dependencies and runs the full test suite
2. builds the main app into `dist/`
3. builds the sealed app (`npm run build --prefix sealed` into `sealed/dist`, asset
   URLs rooted at `/sealed/`)
4. copies `sealed/dist/*` into `dist/sealed/` and publishes `dist` to Pages

So **pushing to main is all that's needed**: dmgctrl.app/sealed deploys with
the PWA. The app's only server is the existing Cloudflare worker: it makes read-only
calls to it and to swuapi.com for cards, and, for a player who opted in, posts each
finished game to it (see "Game collection" below). **The worker is not deployed by
this workflow**: it goes out by hand with `npm run deploy:proxy`.

**PWA interaction**: the main app's service worker controls the whole origin.
Its workbox config carries `navigateFallbackDenylist: [/^\/sealed/]` (see root
`vite.config.ts`) so navigations to `/sealed` are never rewritten to the PWA's
index.html. Keep that in place if the workbox config is ever reworked.

To reproduce the prod artifact locally:

```bash
npm run build && npm run build --prefix sealed
mkdir -p dist/sealed && cp -r sealed/dist/* dist/sealed/
```

The sealed build is one main script and stylesheet plus one script per bundled set
(`assets/<set>Set-<hash>.js`, about 870 kB between the eleven, 140 kB gzipped), each requested from
the same `assets/` folder when its set is first needed. A set that appears inside the main script
instead has been imported statically somewhere: `bundledSets.test.ts` guards against that.

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
Changes to `proxy/worker.js` (the `/art/`, `/cards/`, `/analytics`, `/records` routes) only
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

### Game collection (`POST /records`)

The proxy stages finished games from players who opted in (`proxy/records.js`; what it keeps and
what it refuses to keep is in [architecture.md](architecture.md#network)). Three bindings in
`proxy/wrangler.toml` belong to it:

| Binding | What it is | Needs creating |
|---|---|---|
| `GAME_RECORDS` | the Workers KV namespace games are staged in | **yes, once, by hand** |
| `RECORDS_RATE_LIMITER` | a Workers rate limiter, 30 requests a minute per sender | no: it exists once deployed |
| `RECORD_COLLECTION` | the switch, a plain variable: `on`, or anything else for off | no |

**Setting it up, in this order.** The store comes first because the config holds a placeholder
where its id goes, and a deploy is refused until the placeholder is replaced.

1. Create the namespace: `npx wrangler kv namespace create GAME_RECORDS --config proxy/wrangler.toml`.
   It prints an id.
2. Put that id in `proxy/wrangler.toml`, in place of `REPLACE_WITH_GAME_RECORDS_KV_NAMESPACE_ID`.
3. Deploy the proxy: `npm run deploy:proxy`.
4. Check it answers. A preflight from the app's origin should come back 204 naming that origin:

```bash
curl -si -X OPTIONS https://worker.dmgctrl.app/records -H "Origin: https://dmgctrl.app" | head -n 12
# expect: HTTP/2 204 and access-control-allow-origin: https://dmgctrl.app
```

While the endpoint is unreachable or off, no game is lost outright: each undelivered game waits on
its device (up to 50) and is offered again on a later start.

**Reading what is staged.** Each game is one key, `records/<gameKey>`, whose value is the payload as
JSON. `<gameKey>` is the key the training rows give the same game.

```bash
npx wrangler kv key list --binding GAME_RECORDS --prefix records/ --remote --config proxy/wrangler.toml
npx wrangler kv key get "records/<gameKey>" --binding GAME_RECORDS --remote --config proxy/wrangler.toml
```

A list returns up to 1,000 keys a page. A staged payload is replay data in the exported shape less
its deck names and timestamps, so wrapped as `{ "games": [ ... ] }` it is close to what `--rows`
reads (see "Turning an export into training rows" below); there is no command that pulls the
namespace into such a file.

**Switching collection off.** Fastest first:

- **In the Cloudflare dashboard**, set the Worker's `RECORD_COLLECTION` variable to `off` and deploy
  from there. It takes effect in seconds and needs no checkout. The next `npm run deploy:proxy`
  puts back whatever `proxy/wrangler.toml` says, so change the file too.
- **From the repo**, set `RECORD_COLLECTION = "off"` in `proxy/wrangler.toml` and run
  `npm run deploy:proxy`.

Off, the endpoint answers 503 and stages nothing, and the card routes carry on. Each app keeps its
undelivered games on the device and offers them again later, so switching back on loses nothing
that is still within a device's list of 50. Players are not told: nothing in the app changes.

**Do not turn on Workers Logs, Logpush or a tail for this Worker** while collection is on.
`proxy/wrangler.toml` has no `[observability]` block on purpose. The route itself logs nothing, but
Cloudflare's own invocation logs record each request with its address and the second it arrived,
which is exactly the link between a person and a game that the players' notice says does not exist.
Cloudflare's aggregate analytics for the zone (request counts, countries) are outside the Worker's
control and are not tied to a stored game.

**What KV limits mean here.** On the free plan KV takes 1,000 writes a day, so that is the most
games a day that can be staged: past it writes fail, the endpoint answers 503, and the games wait
on their devices. A value can be 25 MiB; the endpoint's own cap is 512 KiB.

## Client-side state (support playbook)

Everything is on-device; there is no account or server state.

| What | Where | Reset |
|---|---|---|
| Imported decks | localStorage key `sealed_decks` | Remove buttons in-app, or clear the key |
| Card cache | IndexedDB `dmgctrl-sealed` → `cards` | Delete the DB in devtools, it re-hydrates on next play |
| Game records | IndexedDB `dmgctrl-sealed` → `games` | See "Clearing game records" and "Exporting game records" below |

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

**When you need to:** records written before the AI became state-seeded **do not replay
faithfully**, because that opponent drew from `Math.random`, so re-resolving the stored move list
diverges from the stored final state. Records are the substrate for E7 training, so clear the
store once before collecting anything you intend to train on. Records written since are exact
replays, and there's a test pinning that (`deterministicReplay.test.ts`).

### Exporting game records

Saved games come off the device as one JSON file, from the same console as above:

```js
__sealedExportGames()
```

The browser downloads `dmgctrl-sealed-games-<timestamp>.json`, and the call logs
`[sealed] exported N game records` and resolves to the number in the file, newest first. With
nothing saved it logs `0` and downloads nothing. Exporting only reads: the store is unchanged, so
exporting twice gives the same games twice. Nothing is sent anywhere; the file goes wherever you
put it, and it carries your deck names.

```json
{
  "formatVersion": 1,
  "build": { "release": "...", "commitId": "..." },
  "records": [
    {
      "initialState": {},
      "moves": [{ "by": "player", "action": { "type": "pass" } }],
      "playerDeckName": "...",
      "opponentDeckName": "...",
      "winner": "player",
      "startedAt": 0,
      "endedAt": 0,
      "undoCount": 0,
      "build": { "release": "...", "commitId": "..." },
      "opponentAi": "beam-reply",
      "humanSeat": "player"
    }
  ]
}
```

- The top-level `build` is the build that wrote the file. Each record's `build` is the build that
  played that game, which is the one that matters when replaying it.
- `initialState` has no `cards`: the card database is rebuilt by the reader. There is no
  `finalState` either, since replaying `moves` from `initialState` produces it.
- `startedAt` and `endedAt` are milliseconds since the epoch. `winner` is `player`, `opponent` or
  `draw`.
- `undoCount`, `build`, `opponentAi` and `humanSeat` are left out of a record saved before they
  were captured. Absent means unknown, not zero or a default. A record with no `build` also
  has no real start time: its `startedAt` is its `endedAt`, give or take a millisecond.

**Each record is a report the replay harness reads as it stands** (`src/test/helpers/replayReport.ts`):
save one record as a file under `src/test/fixtures/reports/`, register it, and `replay` it, exactly
as for a filed bug report or a dropped bench game. The harness rebuilds the card database from the
bundled ASH set, so a game whose decks hold cards from another set needs those cards passed as
`extra`; it throws naming the missing ids otherwise. A record does not say which sets it needs: read
them off the card ids in its `initialState`.

### Turning an export into training rows

One command replays every game in one or more export files and writes a row per move, as JSON Lines:

```bash
npm run bench --prefix sealed -- --rows /path/to/dmgctrl-sealed-games-<timestamp>.json --out /path/to/rows.jsonl
```

Use absolute paths: the command runs with `sealed/` as its working directory. `--out` is overwritten.
Add `--legal` to carry each position's legal moves on its row, and `--view mover` to write each
position as the seat that moved saw it, with the other seat's hand, deck and face-down resources
replaced by placeholders (rows for imitation; see "The two views of a state" in
[ai-benchmark.md](ai-benchmark.md) for exactly what that hides). It prints how many games and rows it
wrote, the size, and the time, and it needs no network and no card cache: the cards come from the
bundled set fixtures, so a game from any bundled set replays.

A game that does not replay to its recorded winner is listed as `refused` with the reason, gives no
rows, and makes the command exit 1; the other games are still written. That usually means the game
was played by a build whose rules have since changed, so check the record's `build`. Exit 2 means a
file was not an export at all, or is in a newer export format.

Each row holds the whole game state, both hands and both decks included, with the seat that moved
named beside it. The row format, what each field means and the measured sizes are under "Training
rows" in [ai-benchmark.md](ai-benchmark.md).

## Diagnostics & logging

### Where bench artefacts live

All under `sealed/bench-results/`, which is gitignored, so none of it appears in `git status`:

| path | what |
| --- | --- |
| `bench.db` | every run, and every `--control` comparison as an `experiments` row |
| `STATUS.md` | at-a-glance progress, rewritten as each shard lands |
| `shards/<run-key>/run.json` | the manifest: shards requested, games per shard, base seed, build |
| `shards/<run-key>/seed-N.json` | that shard's banked result, written the moment it finishes |
| `shards/<run-key>/seed-N.log` | that shard's streamed output, for following or post-mortem |
| `shards/<run-key>/seed-N.out` | the child's structured result, read by the parent |
| `failures/` | each dropped game as a replayable fixture |
| `records/<commit>/<run-key for one seed>.json` | only from a `--record` run: that seed's completed games as replayable records, in the shape the app exports. A `.partial` beside it is a run still in flight, or one that died |

A run directory is keyed by the AI names, games per shard, base seed and deck source, but **not** by
shard count, so an interrupted run can resume at a different one. Deleting a run directory forces a
full re-run; deleting a single `seed-N.json` re-runs just that shard. Records are kept apart from the
run directory and under the build that played them, so neither of those deletes them; see "Recording
games" in [ai-benchmark.md](ai-benchmark.md).

### The app

The app keeps a capped in-memory diagnostic log (`src/data/log.ts`). Every entry
also mirrors to the devtools console with a `[sealed]` prefix.

- **Console**: filter on `[sealed]` to follow hydration and game-load events live.
- **Support dump**: run `__sealedLogs()` in the devtools console for the last 200
  entries (`{at, level, message, detail}`), useful to paste into a bug report.
- **Wipe game records**: `__sealedClearGames()`, see "Clearing game records" above.
- **Export game records**: `__sealedExportGames()`, see "Exporting game records" above.

**"Couldn't load the cards for this deck"** now shows the specific cause under the
message (e.g. `Card ASH_020 could not be loaded (SWUDB 502, no swuapi match)`),
and the log records each stage. Card hydration tries, in order:

1. IndexedDB cache
2. The bundled set (`data/bundledSets.ts`): the Normal printings of every set the setup panel lists
   ship with the app, one file per set, loaded when the set is first asked for. No network, and
   nothing is written to the cache. Either spelling of a number finds the card (`IBH_052` and
   `IBH_52`), which plays under the number its set uses
3. SWUDB card detail via the worker (`worker.dmgctrl.app/cards/{set}/{number}`). A 404 on a
   zero-padded number is asked once more without the padding: SWUDB files a few sets unpadded
   (`IBH/52` is a card and `IBH/052` is a 404, and TS26 is the same), while deck lists pad every
   number. The card is cached under the deck's spelling and plays under the id it is served as
   (`IBH_52`), which is the id its abilities are registered against
4. swuapi.com Base list fallback. SWUDB's detail endpoint is known to 502 on
   some base ranges (observed: all ASH bases); swuapi is the same source the
   main app uses for base data

So the network is asked only for a card no bundled set holds: a Hyperspace, foil, prestige or
showcase printing, a second collector number of a card its set prints more than once (IBH), or a
set with no snapshot. If a card fails on all sources, the thrown error names the card id and the
upstream status. Check whether the id exists on swudb.com, whether the worker
is up, and whether the browser is offline.

**What works with the card API down, and what does not.** With the site itself reachable, a first
visit builds a generated deck from any set and plays it, and plays a deck list of Normal printings,
without one card request. Card art still streams from the worker, so with the worker down the
cards show their text summaries. **The app shell is not available offline**: Sealed registers no
service worker, and the PWA's worker precaches only the PWA's own files, so opening `/sealed` with
no connection at all fails before any of this runs.

**The cache is read before the bundled set**, so a browser that cached a card keeps playing that
copy after a release ships a newer snapshot. To put a browser back on the shipped data, delete the
`dmgctrl-sealed` database (see the support playbook above).

**"Failed to fetch" in the log** means the browser rejected the request before
any HTTP status existed, usually a response without CORS headers. The worker
now guarantees CORS headers on *error* responses too (upstream errors used to
escape as Cloudflare 1101 pages without them), and the client treats a rejected
fetch like an error status and continues to the fallback. If the worker is
changed, redeploy it (`npx wrangler deploy` in `proxy/`). The client-side
fallback covers base cards even against a broken worker, but other card types
need the worker healthy.

When chasing a load failure, first make sure you're running current code: the app shows the
**release** (see build identity below). In dev it's a small badge in the
**bottom-right corner** (hidden while Help is open, which would otherwise show it through the
backdrop); in prod it sits at the foot of the **Help** overlay. If the browser shows an
older one, restart the dev servers and hard-reload (Ctrl+Shift+R). Known
upstream state (2026-07): SWUDB card detail 502s on the ASH bases
(ASH_019/020/023 confirmed); all recover via the swuapi fallback.

A broken IndexedDB cannot break card loading: cache reads/writes are
non-fatal (logged as warnings, hydration continues from the bundled set and the network). If the
`dmgctrl-sealed` database gets into a crossed-version state during dev (e.g. a
`VersionError` in the log after switching between old and new code), delete it
in devtools → Application → IndexedDB; it rebuilds on the next game.

## Updating for new card sets

A deck list from a set the app does not list needs nothing: its cards are fetched by
`{set}/{number}` straight from SWUDB via the worker, so they load as soon as SWUDB serves them. If
SWUDB changes its payload field names, update `SwuCard` (`data/cards.ts`) and `normaliseCard`
(`engine/cardDb.ts`); both are test-covered.

### The bundled sets

The app ships a snapshot of every set the setup panel lists, and the snapshots are the bench
fixtures, so there is one file per set and one command that writes it:

```bash
npm run bench --prefix sealed -- --fixture LAW SEC     # or --fixture all
```

Run it when a set is added, and when upstream corrects a card that the shipped copy still has
wrong. It warns about any card whose art is not filed under its set and number, which is where the
app looks for the art of a bundled card. Then:

1. **A new set** needs its loader in `data/bundledSets.ts`, its import in `bench/setPools.ts` and
   its totals in `data/implementedCards.ts`. `bundledSets.test.ts` and `benchSetPools.test.ts` fail
   until all three are there.
2. **Read the diff before committing it.** The snapshot is what players get and what every bench
   plays: a changed cost reshapes generated decks, and `coverageDecks.test.ts` pins a fingerprint so
   that is seen (see "The card pools" in [ai-benchmark.md](ai-benchmark.md)).
3. Run `npm run check --prefix sealed` and deploy as usual. Each set is its own hashed file in the
   build, so a refreshed set is one changed file.

A value the card API gets wrong does not need a refresh: `engine/cardDataCorrections.ts` overrides
it by card id whichever tier served the card, and `engine/upgradeStatOverrides.ts` does the same
for an upgrade whose modifier the snapshot does not carry.

### Printing maps

When a set gains card-ability support (or FFG ships a new print run for one that already has a
bundled map), generate/refresh its printing map so every printing resolves offline with no
cache/network dependency:

```bash
node scripts/generatePrintingMap.mjs ASH
```

Writes `src/data/printingMaps/<set>.json`; import it in `data/bundledPrintings.ts` if it's a new
set. The script warns and omits any printing it cannot join to a Normal row rather than guessing,
so those fall back to the existing dynamic (cache/network) path.

That map is within one set. A card the new set shares with an implemented one needs a line in
`data/reprints.ts` as well, or it plays without its ability. Find them with:

```bash
npm run bench --prefix sealed -- --triage ASH SEC
```

Every cross-set reprint is listed, and the ones already collapsed onto a single implementation are
marked `registered`; the rest are the lines to add.

## Extending the engine

- **A new AI**: implement `(state) => Action | null`, choosing from `legalMoves(state)` and drawing
  any randomness from `state.rngSeed` so games stay replayable. Register it by name in
  `ai/registry.ts`, then measure it with `npm run bench` (see [ai-benchmark.md](ai-benchmark.md)).
  **Deploy** by setting `OPPONENT_AI` in `src/config.ts` to its registered name and redeploying: a
  reviewed one-line change, not a user choice. Tests inject their own via `UseGameOptions.ai`. The
  deployed model is `greedy`.
- **Card behaviour**: register it in `engine/cardDefinitions.ts`; see
  [abilities.md](abilities.md).
- **Schema changes**: `GameState` changes ripple into `engineFixtures.ts` and the
  JSON round-trip test; the compiler walks you through every site.
- **New Dexie tables**: add a new `this.version(n).stores({...})` block in
  `data/db.ts`; never edit an existing version line.

## Docs

See [README.md](README.md) for the full map of this folder.
