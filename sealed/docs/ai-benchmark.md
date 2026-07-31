# Sealed: AI Benchmark

A headless harness that plays many full games between two AI opponents and reports how they did. It
is the measuring stick for the whole AI effort: without it, "is this new AI any good?" can only be
answered by playing a few games by hand, which tells you almost nothing. It ships on its own and
changes nothing about the app.

## Why it can be trusted

The AI is a **pure function of the game state** (see the determinism notes in
[architecture.md](architecture.md)). Feed the same starting position and seed, and the same game
comes out every time, move for move. That is what makes a benchmark meaningful: if AI B beats AI A
55% of the time, the difference is the AI, not luck, because every source of randomness (the shuffle,
the opening dice roll, every in-game decision) is fixed by the run's seed. Re-run with the same seed
and you get identical numbers.

The built-in sanity check is **random versus random**. Both sides play the same deck, so it is a
mirror match and should be a coin flip. If the reported win rate sits on 50% (within its confidence
interval), the harness itself is unbiased and you can trust it to measure real differences. If it
drifted off 50%, something in the engine or the runner would be skewing results, and no later AI
number could be believed.

## Running it

```bash
npm run bench --prefix sealed -- [--games N] [--seed N] [aiA] [aiB]
```

Everything is optional:

- `--games N` how many games to play (default 100).
- `--seed N` the run's seed (default 1). The same seed reproduces the run exactly.
- `aiA aiB` the two AIs by name (default `random random`). `aiA` plays the "player" seat, `aiB` the
  "opponent" seat. Registered AIs:
  - `random` rung 0, uniform.
  - `greedy` rung 1, one-ply with quiescent scoring. The deployed model.
  - `greedy-baseline` a frozen early greedy, kept only as a fixed reference for tuning.
  - `greedy-flat` the live model minus quiescent scoring. Unlike the baseline it tracks every other
    evaluation change, which is what makes it a control for that one feature rather than a snapshot.

  More join the list as they are built.

Examples:

```bash
npm run bench --prefix sealed                                  # 100 games, random vs random
npm run bench --prefix sealed -- --games 1000 --seed 42        # a big, reproducible run
npm run bench --prefix sealed -- --games 1000 greedy random    # measure the greedy AI
```

Recorded baselines (mirror deck, so purely AI skill): `random` vs `random` sits at 50% (the harness
self-check), and `greedy` vs `random` is ~100% over 1000 games, the one-ply scorer demolishing
uniform-random play.

Note the `--` after the script name: it tells npm to pass the flags through to the bench rather than
eat them itself.

## Reading the output

```
dmgCtrl AI bench  (engine b355)
random vs random   1000 games   seed 42

  win rate (random/A)   : 48.5%  ± 3.1%   (45.4% – 51.6%)
  draw rate             : 1.9%
  base-damage margin    : +0.3   (A's view)
  game length           : 11.4 rounds avg
  throughput            : 21,283 moves/s   (135,162 moves)
  completed / dropped   : 1000 / 0
  wall clock            : 6.4s

  ✓ clean run
```

- **engine bNNN** the build tag the run was measured under. Every result is only comparable to others
  from the same (or a known) engine build, so it is stamped on every run and stored in the database.
- **win rate (± confidence)** how often seat A won, over completed games. The `±` is the margin of
  error (a 95% Wilson confidence interval): the true win rate is very likely within that band. **More
  games shrink the band.** At 1000 games it is about ±3%; at 20 games it is ±20%, which is too wide to
  conclude anything. This is the number to watch when deciding whether one AI really beats another:
  they differ for real only when their bands do not overlap.
- **base-damage margin** the average difference in damage dealt to the two bases, from seat A's view.
  Near zero in a mirror, as expected.
- **game length** average rounds per game. A sharper AI that trades well tends to end games sooner.
- **throughput** moves resolved per second, and the total. This is the early-warning gauge for when
  in-browser AI will need a background worker: a lookahead AI does far more work per move than
  `random`, so watch this fall as the AIs get smarter.
- **completed / dropped** how many games finished versus were abandoned (see below).
- **clean vs PROVISIONAL** a run with any dropped game is flagged provisional, prints the failing
  seeds, and the command exits non-zero, so a dirty result can never be quoted as clean.

## When a game is dropped

The harness must survive engine defects without wedging or silently corrupting a run. A game is
**dropped**, not counted, for one of four reasons:

- `stuck` an AI had no legal move while the game was still live (usually an engine hang).
- `threw` resolving a move threw an error.
- `nonterminating` the game exceeded a large move ceiling (a cycle that never ends).
- `timeout` the game ran past a wall-clock limit.

Each dropped game is written to `bench-results/failures/` as a **replayable fixture**: the starting
position plus every move, in the exact `{ initialState, moves }` shape the bug-replay harness
(`src/test/helpers/replayReport.ts`) already reads. Drop that file into `src/test/fixtures/reports/`,
replay it, and step through to the exact move where things went wrong, then file it as a bug. This is
how the bench found and pinned two real hangs during its own construction.

## Coverage sweep: whole-pool fuzzing

The default bench plays one fixed deck, so it only exercises the ~30 cards in that deck. The
**coverage sweep** plays across a generated set of legal, realistic decks whose union touches **every
card in the set**, turning the bench into a fuzzer over the whole pool:

```bash
npm run bench --prefix sealed -- --sweep [--games N] [--seed N] [ai]
```

`--games` is games *per deck* (default 5); `ai` defaults to `random`, which is fast and pokes card
interactions broadly (the best bug-finder). It reports how many decks and games ran, how many cards
were exercised, and any dropped game, writing each as a replayable fixture. A drop here is a
**finding**, a hang or throw in some card, not a failure of the sweep.

The decks come from `deckgen/generateDeck.ts` (a reusable primitive that builds one legal,
penalty-free, realistically curved deck for a leader, respecting rarity mix and aspect balance, see
`deckgen/rules.ts`) orchestrated by `bench/coverageDecks.ts` (which picks leaders and bases so the
union covers the pool). The generator is deliberately separate from the bench so a future
"play a random representative deck" setup feature can reuse it.

## Generalisation diagnostic

`--generalise` plays one AI against another across the whole coverage deck set and reports the first
AI's win rate broken down **by leader, by base aspect, and per deck** (each weakest-first), so you can
see which leaders / mechanics it handles worst rather than hiding that in an aggregate:

```bash
npm run bench --prefix sealed -- --generalise --games 40 --seed 42   # greedy vs random by default
```

It answers "is the AI overfit to one deck, and is there anything to hand-tune?" with data. Against
`random`, greedy sits at ~100% on every deck (random cannot punish its flaws), which is exactly why
the useful gradient comes from measuring a *new* AI against the *current* one here, not against
random.

## Decision quality: finding blind spots

Win rate is a blunt instrument for diagnosing an evaluation. It moves a point or two over hundreds
of games and says nothing about *why*. `--decisions` measures something far sharper: how often the
evaluation has **no opinion at all**.

```bash
npm run bench --prefix sealed -- --decisions [--games N] [--seed N] [ai]
```

It plays across the coverage decks and, at every position, scores each candidate move exactly as the
greedy driver does. When every candidate scores the same, the seeded tie-break picks one at random:
that is a **blind spot**, not a close call. It reports the tie rate per decision kind, with the mean
number of options so the rate can be read against how much was at stake.

This is the sharpest diagnostic in the harness, because a blind spot is invisible in a win rate. A
term the evaluation lacks entirely shows up here as a 100% tie rate on the decision it should be
deciding, long before it shows up as lost games.

Current rates: initiative ~18%, which card to play ~7%, attacks ~2%, regroup card choice near 0%.
See [planned-work.md](planned-work.md) for what that ordering implies.

Attacks were the highest-volume blind spot at ~10% until scoring became quiescent, which is what a
tie rate is for: an attack that suspended on a choice used to be scored before it had done anything,
so it scored the same as every other attack that suspended.

Two behaviours are reported separately, because they are strict public preferences rather than ties
and so read as behaviour rather than as a gap:

- **regroup banking**: banks versus skips, and the mean pool at each. The skip rate is 0% by
  construction, since the pool is valued flat.
- **initiative**: how often it claims, how often it takes the *cheap* window where the opponent has
  already passed, and the mean ready units it still had when it claimed mid-phase. That last number
  is the clearest read on whether the AI is claiming sensibly: low means it claims when it has little
  left to do, high means it is throwing away a board full of attackers.

### Half-resolved scoring

The same run reports how often a candidate move is scored **before its action has finished**. Some
moves leave a choice owed: a when-played effect whose target is unpicked, or an attack suspended on
the defender's "may prevent damage". Either way the evaluation reads a partial board.

The split is by **who owes the answer**, because that decides the fix. An answer we owe can be
finished on the spot by resolving the chain; one the opponent owes has to be resolved pessimistically;
and a choice like `support`, which opens a whole extra attack, is a second action rather than an
unfinished first one. Reported at three granularities (candidates scored, positions where any
candidate is affected, and moves actually chosen) plus the choice kinds driving each side, since one
card causing all of it is a different problem from a broad spread.

Current rates: **we** owe the answer in 33.8% of positions and 17.0% of chosen moves; the opponent
owes it in 4.6% and 0.4%.

These are counted on the **raw** state a move produces, so they measure how often quiescence has
something to do, not what it concluded. The chosen-move rate going **up** as the positions rate came
down is the fix showing its work: the AI used to avoid cards whose when-played effect it could not
see, and now it plays them.

## AI versus AI, per matchup

`--generalise` plays **mirrors**: both seats get the same deck, so it can report per deck but never
"pool X against pool Y". `--matrix` plays **one AI against itself** to measure deck strength.
Neither answers "which matchups does this AI improve", which is what a role-aware or matchup-
sensitive change actually claims.

```bash
npm run bench --prefix sealed -- --matchups [--games N] [--seed N] aiA aiB
```

Every **ordered** pair of 18 decks (one per leader), aiA on the first deck and aiB on the second,
seats alternated so first-player advantage cancels. Ordered rather than the triangle `matrix.ts`
uses, because with two different AIs "A on deck i vs B on deck j" is a different experiment from its
reverse; that symmetry trick is only valid when both seats play identically. 18 decks keeps it to 324
cells and about a minute; 72 would be over 5000.

**A trap worth knowing about.** The first version took the *first* base for each leader, which
handed all 18 decks an Aggression base. On that set greedy measured **49.1%** against the frozen
baseline; on an aspect-rotated set of the same size it measures **53.9% ± 2.7%**. A single-aspect
sample is not a matchup sample, and it was very nearly reported as a real result.

Note the mirror harness reads higher on the same comparison (60.0% ± 3.3%). That is expected rather
than contradictory: in a mirror both AIs face identical decks so pure skill shows, whereas across
matchups deck strength adds variance that a stronger AI cannot always overcome, compressing the rate
toward 50%. Quote both, and say which is which.

## Tuning evaluation weights

The greedy evaluation's weights are parameterised (`ai/evaluate.ts: EvalWeights`). `npm run tune`
sweeps candidate weights, measuring each against the frozen `greedy-baseline` across the coverage
decks, so weights are chosen from data rather than guessed:

```bash
npm run tune --prefix sealed -- --games 100 4,2,1,4 3,2,1,4 6,2,1,3   # unit,power,hp,base per config
```

It prints each config's win rate vs baseline (higher is better) and its wall clock. The current
deployed weights were chosen this way (see `DEFAULT_WEIGHTS`); to change the model, re-sweep, set the
winning weights, and redeploy.

Candidates are built by `makeTunedGreedy`, the same factory that builds the deployed bot. That is
deliberate and load-bearing: a tuner that assembles its own AI drifts from the real one the moment
the driver changes, and then measures weights for a bot nobody plays.

**The frozen baseline is running out of resolution as a reference.** The deployed model now beats it
81.9% ± 3.7%, so weight differences have limited room to show before the ceiling. Before the next
weight sweep, move the reference to `greedy-flat` or take a fresh frozen snapshot; a tuner that
cannot separate its candidates reports noise with a confidence interval on it.

## Matchup matrix

`--matrix` measures **deck strength** and **matchups**. It builds an even deck set (every one of the
18 leaders paired with each of the 4 base aspects = 72 decks, `bench/matchupDecks.ts`) and, under one
fixed AI model, plays every deck against every deck (mirrors included). First player is alternated so
seat advantage cancels, which means "i vs j" already measures "j vs i", so only the upper triangle is
played and the rest derived.

```bash
npm run bench --prefix sealed -- --matrix --games 14 --seed 42 greedy   # ~14 games/cell => ~1000/deck
```

`--games` is games *per cell*; a whole run is ~30-40 min at 14. It prints strongest/weakest decks,
by-leader and by-base strength (each deck's average win rate across all opponents) and saves every
ordered pair to the SQLite `matchups` table. It answers two questions:

- **Which decks are strongest** (for a fixed model): the deck-strength ranking, or `AVG(win_rate_a)`
  grouped by `deck_a`.
- **Which decks improve or degrade as the model changes**: run the matrix for two models (e.g.
  `greedy` and `greedy-baseline`, or before/after a tune) and diff their rows.

### Interrogating a matrix

The results live in the SQLite DB (`bench-results/bench.db`, standard format): open it with a VS Code
SQLite extension, **DB Browser for SQLite**, the `sqlite3` CLI, or Node. Useful SQL:

```sql
-- deck strength for a run (find the run_id in the matrix_runs table)
SELECT deck_a, ROUND(AVG(win_rate_a), 3) AS strength FROM matchups WHERE run_id = ? GROUP BY deck_a ORDER BY strength DESC;
-- by leader
SELECT leader_a, ROUND(AVG(win_rate_a), 3) AS strength FROM matchups WHERE run_id = ? GROUP BY leader_a ORDER BY strength DESC;
-- a specific matchup
SELECT win_rate_a, avg_margin FROM matchups WHERE run_id = ? AND deck_a = ? AND deck_b = ?;
-- model comparison: how each deck's strength changed between two runs
SELECT a.deck_a, ROUND(AVG(a.win_rate_a) - AVG(b.win_rate_a), 3) AS delta
FROM matchups a JOIN matchups b ON a.deck_a = b.deck_a AND a.deck_b = b.deck_b
WHERE a.run_id = ? AND b.run_id = ? GROUP BY a.deck_a ORDER BY delta;
```

## Where results go: the SQLite database

Every run is saved to a local SQLite database at `bench-results/bench.db` (both `bench-results/` and
its contents are git-ignored: they are generated, machine-specific, and can grow large). It uses
Node's built-in `node:sqlite`, so there is no extra dependency and no server. Query it with any
SQLite tool, or from a quick script:

```bash
sqlite3 sealed/bench-results/bench.db \
  "SELECT build_tag, ai_a, ai_b, games_requested, completed, round(win_rate_a,3), round(win_ci,3)
   FROM runs ORDER BY started_at DESC LIMIT 10;"
```

### Data model

Two tables, joined on `run_id`.

**`runs`** one row per `npm run bench` invocation:

| column | meaning |
| --- | --- |
| `run_id` | primary key: the start timestamp plus a short random suffix |
| `started_at` | ISO timestamp |
| `build_tag` | engine build the run was measured under |
| `ai_a`, `ai_b` | the two AI names |
| `seed` | the run seed (reproduces the whole run) |
| `games_requested` | how many games were asked for |
| `completed`, `dropped` | how many finished versus were abandoned |
| `provisional` | 1 if any game dropped |
| `win_rate_a` | seat A win rate over completed games |
| `win_ci` | half-width of the 95% confidence band on the win rate |
| `draw_rate` | draw rate over completed games |
| `avg_margin` | mean base-damage margin (A's view) |
| `avg_rounds` | mean game length in rounds |
| `moves_per_sec` | throughput |

**`games`** one row per game, in play order:

| column | meaning |
| --- | --- |
| `run_id`, `game_index` | primary key: which run, and the game's position in it |
| `seed` | that game's own seed (reproduces this single game) |
| `first_player` | which seat held the opening initiative (alternated each game) |
| `winner` | `player`, `opponent`, `draw`, or null |
| `rounds`, `move_count` | length of the game |
| `base_damage_a`, `base_damage_b`, `margin` | the damage detail |
| `status`, `drop_reason` | `completed`, or `dropped` with why |

The full move list is not stored for completed games (that would be gigabytes over a big run); only
dropped games are kept whole, and those go to the `failures/` files above.

## The pieces

All under `src/bench/`, pure and framework-free except the command entry point. The AI itself lives
in `src/ai/` and is described in [ai-model.md](ai-model.md).

- `bench/decisions.ts` the blind-spot diagnostic behind `--decisions`.
- `bench/aiMatchups.ts` AI-vs-AI across every ordered deck pair, behind `--matchups`.
- `bench/decks.ts` the fixed sealed deck, built deterministically from the ASH snapshot. For now the
  same deck plays both sides (a mirror), which removes deck strength as a variable. The runner already
  takes two decks, so deck-versus-deck comparisons are a fixture change away, not a code change.
- `bench/selfPlay.ts` `playGame`: one full game, seeded, with the drop classification.
- `bench/runBench.ts` `runBench`: N games, alternating who goes first, aggregated into a report.
- `bench/stats.ts` the Wilson confidence interval.
- `bench/store.ts` the SQLite persistence.
- `bench/reports.ts` writing a dropped game out as a replayable fixture.
- `bench/main.ts` the command line: the only impure file (reads arguments, prints, saves).

## A note on trusting numbers while the engine still has bugs

Comparisons under a shared engine are robust: both AIs play the same engine, and in a mirror most
defects hurt both sides equally, so they largely cancel in a head-to-head. Absolute numbers and
fine-grained tuning decisions are more fragile, so treat any run made before the defect list is clean
as provisional, and re-run after fixes (it costs seconds). The `build_tag` stamped on every run is
what lets you tell which engine a number came from. Re-running is cheap, so nothing is ever "thrown
away" by a faulty evaluation; at worst a design decision made on a biased comparison is revisited.
