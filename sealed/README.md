# dmgCtrl · Sealed — SWU Sealed AI Opponent

Standalone desktop web app (per `docs/swu-ai-handoff.html`): play Star Wars: Unlimited
Sealed against an AI opponent. Deploys to **dmgctrl.app/sealed** (`base: '/sealed/'`);
kept separate from the dmgCtrl PWA.

**Docs**: [architecture](docs/architecture.md) · [operations & maintenance](docs/operations.md) ·
[user guide](docs/userGuide.md) (also served in-app as the Help page).

**Spike scope**: Epics 1–4 plus T5.1 (random AI) — Milestone 1, "playable vs random AI".
Heuristics/MCTS/LLM rungs (T5.2+, E6, E7) are deliberately not built.

## Run

```bash
npm --prefix sealed install
npm --prefix sealed run dev      # local dev server
npm --prefix sealed test         # test suite (also part of root `npm test`)
npm --prefix sealed run build    # production build → sealed/dist, served at /sealed
```

## Architecture

```
src/
  engine/          Pure rules core — (state, action) => state
    types.ts         Game state schema (JSON-serialisable; card db shared by reference)
    cardDb.ts        SWUDB payload → normalised EngineCard
    initGame.ts      Two decklists → starting state (injectable shuffle/choices)
    resources.ts     Pay costs, exhaust/ready, resource from hand
    legalMoves.ts    THE source of legality; aspect penalty (CR 8.1) lives here
    resolve.ts       Action resolver: turns, initiative, combat, regroup, win check
    actions.ts       Action union (CR 1.15 five actions + regroup choices)
  ai/
    randomAi.ts      Rung 0: uniform random legal move
  data/
    db.ts            Dexie (IndexedDB): cards (v1), games (v2)
    cards.ts         Local-first card hydration from api.swu-db.com (via the worker)
    setImport.ts     Cache a whole set via one SWUDB search call (offline catalogue, #310)
    thumbnails.ts    Art fetch + artUrl() proxy rewrite (ArrayBuffer, not Blob — clone safety)
    catalogueSync.ts Progressive prefetch of deck cards
    deckStore.ts     Imported decks in localStorage
    gameRecords.ts   Completed games: initial state + move list = deterministic replay
  hooks/
    useDecks.ts      Deck import/list/remove
    useGame.ts       Hydrate cards → init → act(); drives the AI turn loop; saves records
  components/        Art-dominant card UI: deck selection, battlefield, hand, action menu, log
    cardFace.tsx     Card = its art; textual fallback; per-type portrait/landscape orientation
    cardSizing.ts    Card size constants (square slot; zoom-override hook, #321)
    boardLayout.ts   Battlefront unit ordering (Sentinels held to the front)
  utils/             ProtectThePod parser, action describer
```

The AI runs synchronously in `useGame` for the random rung; the Web Worker
offload (T5.4) is only needed from MCTS onwards.

## Decisions & assumptions to revisit

- **Rules verified against the full CR (v7.0)**: setup (draw 6, resource 2 ready — §5.2),
  regroup (draw 2 → resource 1 exhausted → ready all — §5.5), empty-deck draw
  (3 damage per missed card — §8.6), attack timing (§6.3), Sealed deckbuilding (§10.2).
  Mulligan (§5.2.1e) implemented (#304): setup phase, initiative holder decides first,
  seeded in-state RNG keeps replays deterministic. Resourcing is player-chosen — each
  player picks which cards to bank one at a time, in setup (2) and each regroup (1);
  the AI resources to preserve its early curve (`ai/setupAi.ts`). Still not modelled:
  simultaneous-loss draw (§5.6.3), concession.
- **MVP engine plays vanilla card *text***: ability text, events and upgrades are not
  executed yet (events/upgrades can still be resourced). **Keywords are executed** —
  Sentinel/Saboteur (attack targeting), Raid/Grit (power), Overwhelm/Restore (combat).
  Units, combat, leaders, bases, aspect penalties and initiative are fully modelled.
- **ProtectThePod JSON shape is assumed** (SWUDB-style `{metadata, leader, base, deck}`);
  parser isolated in `utils/parseProtectThePod.ts` — swap when a real export sample exists.
- **Game records live in IndexedDB, not SQLite** (T2.7 decision): better-sqlite3 cannot
  run in a browser and the SQLite consumer is the E7 training pipeline (out of scope).
  Records are JSON-exportable; migration belongs to E7.
- **Opponent deck is picked at play time**: on the deck screen you choose a random saved
  deck or a specific one as the opponent (mirror matches still possible). Automated AI
  deck assignment (T5.6) is still future.
- **docker-compose.yml is a placeholder** — services (redis/influx/grafana/ollama)
  commented out until their epics (E5–E7).
