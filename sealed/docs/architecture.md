# Sealed — Architecture

Standalone desktop web app for playing SWU Sealed against an AI opponent. Lives at
`dmgctrl.app/sealed` (Vite `base: '/sealed/'`), deliberately separate from the dmgCtrl PWA.
Build plan and epic breakdown: `docs/swu-ai-handoff.html` (repo root).

## Layer map

```
┌─────────────────────────────────────────────────────────────┐
│ UI (React)                                                   │
│   App ── DeckSelectScreen ── GameScreen ── HelpScreen        │
│              │                   │                           │
│          useDecks            useGame ◄── randomAi (ai/)      │
└──────────────│───────────────────│───────────────────────────┘
               │                   │ pure calls
┌──────────────▼───────────────────▼───────────────────────────┐
│ Rules engine (src/engine/ — pure, no I/O, JSON-serialisable) │
│   types → cardDb → initGame → legalMoves → resolve           │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Data (src/data/)                                             │
│   cards/thumbnails/catalogueSync → Dexie (IndexedDB)         │
│   deckStore → localStorage · gameRecords → Dexie             │
│   network: worker.dmgctrl.app → api.swu-db.com               │
└──────────────────────────────────────────────────────────────┘
```

## The rules engine

The heart of the app is a pure function pair:

- **`legalMoves(state): Action[]`** — the *single source of legality*. Everything the
  active player may do, fully enumerated. The aspect-penalty cost calculation
  (CR 8.1, multiset icon matching) lives here as `effectiveCost`.
- **`resolve(state, action): GameState`** — applies an action produced by the
  generator. Throws on engine-invariant violations (wrong phase, unknown ids,
  game over) but does not re-validate game rules.

Supporting modules: `types.ts` (schema), `cardDb.ts` (SWUDB payload → normalised
static card data), `initGame.ts` (setup per CR §5.2: shuffle, draw 6, resource 2),
`resources.ts` (cost payment/readying).

Design properties that matter for later epics:

- **States are plain JSON.** `GameState` round-trips through `JSON.stringify`; the
  static card db hangs off the state but is shared *by reference* between successive
  states, so cloning is cheap for tree search (E5 MCTS).
- **Determinism is injectable.** Shuffle, AI rng, and the setup-resource chooser are
  parameters with random defaults — tests and future self-play pin them.
- **Replayability.** A `GameRecord` stores the initial state plus every action;
  replaying them through `resolve` reproduces the game exactly (E7 training data).

Rules verified against the full Comprehensive Rules v7.0: setup (§5.2), action
phase/initiative (§1.15, §5.4), regroup (§5.5), attack timing (§6.3), empty deck
(§8.6), Sealed deckbuilding (§10.2). **Not modelled (MVP)**: card abilities,
keywords, events, upgrades (vanilla stats only), mulligan, simultaneous-loss draw,
concession.

## Game flow at runtime

`useGame` owns the loop:

1. Hydrate every unique card in both decks (`getCard` — cache-first, network fallback).
2. `buildCardDb` → `initGame` → store state; snapshot the initial state for the record.
3. Human acts via the action-menu buttons → `resolve`.
4. `driveAi` loop: while the AI is active and the game is live, `randomAi` picks from
   `legalMoves`, resolves, and logs — through action *and* regroup phases (capped at
   500 steps as a hang guard).
5. When `winner` is set, the game record persists once to IndexedDB.

## Storage tiers

| Store | Holds | Why |
|---|---|---|
| localStorage `sealed_decks` | Imported decks | Tiny, synchronous |
| IndexedDB `cards` (Dexie v1) | Card JSON + thumbnail bytes | ~KBs per card; queryable; offline |
| IndexedDB `games` (Dexie v2) | Completed game records | Replayable substrate for E7 training |

Thumbnails are stored as `ArrayBuffer + mime` rather than Blob — ArrayBuffers
structured-clone reliably in every IndexedDB implementation; Blobs do not (and
jsdom/fake-indexeddb can't round-trip them in tests either).

SQLite/Drizzle (from the original plan) is deferred to E7, whose training pipeline
is its actual consumer. `docker-compose.yml` holds commented placeholders for the
E5–E7 services (redis, influxdb, grafana, ollama).

## Network

`api.swu-db.com` serves no CORS headers, so the browser cannot fetch it directly.
All card-detail requests route through the existing Cloudflare worker
(`worker.dmgctrl.app`) whose fallback route proxies any path to api.swu-db.com and
adds `Access-Control-Allow-Origin: *` (see `proxy/worker.js`). Card art on
`cdn.swu-db.com` has the same CORS gap — thumbnails fail gracefully today and the
text UI doesn't render art; proxy or CORS support is a follow-up for an art UI.

## Testing

Strict TDD; 167 tests at the time of writing. Engine tests use hand-built fixture
states (`src/test/helpers/engineFixtures.ts`); data-layer tests run against
fake-indexeddb; screen tests drive the real hook + engine with seeded caches,
deterministic shuffles, and a "passive" AI rng (near-1 → always picks pass, the
last-ordered legal move). `npm test` at the repo root runs main + proxy + sealed.
