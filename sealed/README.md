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
    cards.ts         Local-first card hydration from api.swu-db.com
    thumbnails.ts    Background art bytes (ArrayBuffer, not Blob — Safari/clone safety)
    catalogueSync.ts Progressive prefetch of deck cards
    deckStore.ts     Imported decks in localStorage
    gameRecords.ts   Completed games: initial state + move list = deterministic replay
  hooks/
    useDecks.ts      Deck import/list/remove
    useGame.ts       Hydrate cards → init → act(); drives the AI turn loop; saves records
  components/        Text-first UI: deck selection, board/hand/action-menu/log/game-over
  utils/             ProtectThePod parser, action describer
```

The AI runs synchronously in `useGame` for the random rung; the Web Worker
offload (T5.4) is only needed from MCTS onwards.

## Decisions & assumptions to revisit

- **Rules verified against the full CR (v7.0)**: setup (draw 6, resource 2 ready — §5.2),
  regroup (draw 2 → resource 1 exhausted → ready all — §5.5), empty-deck draw
  (3 damage per missed card — §8.6), attack timing (§6.3), Sealed deckbuilding (§10.2).
  Not modelled (MVP): mulligan (§5.2.1e), simultaneous-loss draw (§5.6.3), concession.
- **MVP engine plays vanilla cards**: ability text, keywords, events and upgrades are
  not executed (events/upgrades can still be resourced). Units, combat, leaders,
  bases, aspect penalties and initiative are fully modelled.
- **ProtectThePod JSON shape is assumed** (SWUDB-style `{metadata, leader, base, deck}`);
  parser isolated in `utils/parseProtectThePod.ts` — swap when a real export sample exists.
- **Game records live in IndexedDB, not SQLite** (T2.7 decision): better-sqlite3 cannot
  run in a browser and the SQLite consumer is the E7 training pipeline (out of scope).
  Records are JSON-exportable; migration belongs to E7.
- **Opponent plays a mirror match** (same imported deck) until AI deck assignment (T5.6).
- **docker-compose.yml is a placeholder** — services (redis/influx/grafana/ollama)
  commented out until their epics (E5–E7).
