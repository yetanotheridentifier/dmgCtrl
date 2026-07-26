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
  "opponent" seat. Registered AIs: `random` (rung 0, uniform), `greedy` (rung 1, one-ply, the
  deployed model), and `greedy-baseline` (the frozen pre-#392 greedy, kept only as a fixed reference
  for tuning). More join the list as they are built.

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

## Decision quality: finding blind spots (#393)

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

This is what diagnosed #393. Before the fix, **100% of 1417 regroup resource picks were ties**:
the AI banked a card chosen uniformly at random from an average hand of 4.5, about five times a
game per side, because `evaluate` read only `hand.length` and every `resourceCard` move therefore
scored identically. That is invisible in a win rate and unmissable here. It now sits near 0%.

The remaining rates are the roadmap: attacks ~10% (#392), which card to play ~6%. Initiative was
~21% before #394 and is now ~16%. A decision the evaluation cannot see shows up here long before it
shows up in a win rate.

Two behaviours are reported separately, because they are strict public preferences rather than ties
and so read as behaviour rather than as a gap:

- **regroup banking**: banks versus skips, and the mean pool at each. The skip rate is 0% by
  construction (see the negative result below).
- **initiative**: how often it claims, how often it takes the *cheap* window where the opponent has
  already passed, and the mean ready units it still had when it claimed mid-phase. The last of those
  is the sharpest single number in #394: it fell from **2.5 to 0.2**, meaning the bot now claims when
  it has little left to do rather than throwing away a board full of attackers.

## AI versus AI, per matchup (#319)

`--generalise` plays **mirrors**: both seats get the same deck, so it can report per deck but never
"pool X against pool Y". `--matrix` plays **one AI against itself** to measure deck strength.
Neither answers "which matchups does this AI improve", which is #319's acceptance bar and #395's
whole claim.

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

## Adding a new AI

An AI is just a function from game state to a move, `Ai = (state) => Action | null` (`ai/types.ts`).
Every opponent wears that one shape. To make a new one runnable by name, add a single line to the
registry (`ai/registry.ts`):

```ts
export const AIS: Record<string, Ai> = {
  random: randomAi,
  greedy: greedyAi,   // <- the whole change
}
```

From then on `npm run bench -- ... greedy random` just works, and nothing else in the codebase needs
to know the AI exists. This registry is the single seam the entire AI series hangs off.

## The pieces

All under `src/bench/` and `src/ai/`, pure and framework-free except the command entry point:

- `ai/types.ts`, `ai/registry.ts` the `Ai` shape and the named-AI registry.
- `ai/cardValue.ts` what a card is worth if you get to cast it (cost, stats, keywords, implemented
  abilities, rarity, aspects, uniqueness). Standalone so #396 and #398 can reuse it.
- `ai/handValue.ts` what a hand is worth to the player holding it: private information, so it is only
  ever applied to the seat being scored (see below).
- `ai/race.ts` reach, clock and role: who gets to lethal first, computed through the rules' own
  `enemyAttackTargets`. Standalone so #398 and #425 can reuse it.
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

## Public and private evaluation, and the tie-break rule (#393)

`evaluate` has two halves, and the split is a hidden-information boundary, not a tidiness one.

**`publicScore`** reads only what both players can see, hand SIZE included but never hand contents.
It is zero-sum: `publicScore(s, me) === -publicScore(s, foe)`, and `aiEvaluate.test.ts` pins that.

**`handValue`** reads card identities, which are hidden. It is therefore applied to the scored seat
**only**: subtracting the opponent's would be peeking at their hand. `evaluate` is consequently
subjective rather than zero-sum, which costs nothing at one ply because greedy only ever scores from
the acting seat. **Anything scoring a position from both seats (#400's pessimistic minimax, #425's
two-ply) must call `evaluate(s, foe)` rather than negating `evaluate(s, me)`.**

Zero-sum narrowed a **second** time with #395: role-aware weights mean the two seats price the same
board differently whenever they read different roles, which is that ticket's entire premise. The
invariant is now **zero-sum while both seats share a role**, and integer-valued always.
`aiEvaluate.test.ts` pins both, and asserts the asymmetry deliberately rather than tolerating it.

The private half is admitted **as a tie-break only**, and that is a guarantee rather than a tuning
choice. Every public weight and quantity is an integer, so `publicScore` is integer-valued; squashing
hand value into `[0, 1)` makes it strictly incapable of overriding a public preference. It can only
order moves the public half rates equally, exactly the blind spot `--decisions` measures.

That bound was arrived at by measurement, and it matters:

| Hand term | Win rate vs the same AI with the term off |
| --- | --- |
| Scaled by the best castable card's value | **40.5%** |
| Flat bonus, competing with the board score | 49.9% |
| Flat bonus, bounded below public resolution | **53.5% ± 1.9%** (5040 games) |

The first is instructive. Scaling the "I have a play" bonus by the card's own value seems more
principled, but a bomb's hand value and its board value are the same order of magnitude, so giving up
~28 of hand value to gain ~28 of board made the bot **refuse to play its own bombs**. The second
shows why the bound is needed at all: an unbounded term applies to *every* decision while only
fixing one, so its distortion grows with its weight (39.8% at moderate weights, 26.0% at large).

## Reading the role from the race (#395)

The AI had no concept of whether it was the aggressor or the defender: it maximised the same fixed
function from both seats. #395 gives it a role, and reads that role off **who gets to lethal first**
rather than off board advantage.

That distinction is the ticket. **Board power is not damage that can reach a base.** A control
player who plays a Sentinel adds one point of power and kills nothing, yet stops the opponent's clock
dead. Measured over 132 games, at round 3:

| Signal | Went on to win |
| --- | --- |
| Faster **clock** | **68.0%** |
| Board leader (control) | 62.0% |
| Faster clock, measured at round 5 | 80.5% |

`ai/race.ts` computes reach through **`enemyAttackTargets`**, the same function the rules use to
decide what a unit may attack, so Sentinel, Saboteur, arena, Hidden and "cannot be attacked" are
resolved once and not re-derived. Overwhelm tramples past a wall, Restore lengthens the attacker's
clock, and the clock splits "this round" (ready units only) from the steady rate, which is what makes
it a race rather than an average. A second copy of that logic in the AI would drift from the rules
the way the ability lookups did in #417.

**Result: 51.4% ± 0.9%** over ~11,340 games against a role-blind AI (three matched-power seeds:
50.2%, 52.8%, 51.2%). Real, but roughly a third of what #393 or #394 each returned, and higher shifts
are worse, so the effect is fragile.

### The bug worth remembering: the role belongs to the DECISION

The first implementation derived the role from each candidate's *resulting* state, which is the
natural place to put it and is badly wrong. Greedy scores `evaluate(resolve(state, move), me)`, and
**32.5% of decisions have candidate moves landing in different roles**, so their scores were
computed with different weight sets and were not comparable. It silently rewarded whichever move
flipped the role, and it got worse as the shift grew:

| roleShift | per-candidate role | role fixed per decision |
| --- | --- | --- |
| 1 | 44.2% | 48.9% |
| 2 | 39.4% | 48.9% |
| 3 | 32.7% | 47.4% |
| 4 | 26.3% | 41.8% |

`makeGreedyAi` now fixes the role once from the position it is deciding in and passes it to every
candidate via the `Evaluator`'s `asRole` parameter. That is a correctness fix, not a tuning one, and
it made the whole thing 30% faster as a side effect. Any future context-dependent weighting must do
the same.

## Pricing the initiative (#394)

`evaluate` read neither `initiative` nor `initiativeTakenBy`, so the AI had **no representation of
turn order at all**: 21% of 5930 offers tied with the best move and were settled by a coin flip. It
declined a cheap claim two times in three and made 465 expensive ones, each forfeiting an average of
2.5 developing actions.

Both halves of the decision are **public**, so unlike #393's hand value this lives in `publicScore`
and is *allowed* to outrank other moves, which it has to be to ever justify giving up a turn:

```
initiativeValue(me) = w.initiative * (initiative === me ? +1 : -1)     // acting first next round
                    - w.claimCost  * forfeitedTempo(me)                // I sit out the rest of it
                    + w.claimCost  * forfeitedTempo(foe)
```

`forfeitedTempo` is a player's ready units while `phase === 'action' && initiativeTakenBy === them`.
That guard is what makes the cheap window fall out **without hardcoding CR 1.15.5c**: claiming into a
passed opponent ends the phase (`takeInitiative` calls `enterRegroup`), so the resulting state is not
in the action phase and nothing is charged.

Worth noting the ticket's framing that claiming after their pass "costs nothing" is not quite right.
Claiming *always* forfeits your own remaining actions; what the cheap window avoids is the usual
penalty of sitting out while the opponent keeps playing.

**Result: 52.9% ± 1.9%** over 5040 games against the same AI with both weights at 0, confirmed across
three seeds (52.5%, 54.5%, 52.9%). Behaviour moved as intended: cheap chances taken 31% to 58%, and
ready units forfeited per mid-phase claim 2.5 to 0.2.

The sweep is the interesting part:

| initiative | claimCost | win rate vs off |
| --- | --- | --- |
| 4 | **0** | **41.1%**, the always-claim failure mode, exactly as the ticket predicts |
| 0 | 3 | 50.0%, cost with no benefit is inert |
| **2** | **3** | **52.9%** shipped |
| 4 | 3 | 46.8% |
| 6 | 3 | 35.4% |
| 8 | 4 | 29.4% |

Turn order is worth **far less than it looks**: raising the bonus is monotonically worse, because the
bot buys initiative by giving up whole turns. The `claimCost: 0` control is worth keeping in any
re-sweep, since it demonstrates the opportunity-cost term rather than the bonus is what makes this
work.

Out of scope and deferred to the search (#398/#400): "claim when it converts to lethal, or denies
the opponent lethal" needs to see next round, which one ply cannot.

## A measured negative result: concave resource value (#393 iteration 2)

Recorded so nobody spends an evening re-deriving it.

The greedy AI banks a card at **every** regroup, because banking is a flat public **+1**
(`resource` 3 minus `card` 2) however deep its pool already is. That looks wrong late on: you draw 2
at regroup either way, so banking is "+1 resource against +1 card retained", and once the pool
already casts what you hold, the card should be the better half of that trade. The published
guidance agrees, and it has a real threshold behind it: deployment needs *controlling* resources
equal to the leader's cost (CR 2.6.1), so "resource until you can deploy your leader" is a resource
count, not a feeling.

So `resourceValue` (`ai/evaluate.ts`) was built to make the marginal resource cheaper past a knee,
with the knee rising to the leader's deploy cost while it is undeployed. **The mechanism works**:
`--decisions` showed the skip rate move from 0% to 12.5%, every skip at a pool of exactly the knee.

**It did not win.** Against the identical AI with a flat pool, across the coverage decks:

| saturation | surplus | win rate vs flat |
| --- | --- | --- |
| 7 | 1 | **49.7% ± 1.9%** (5040 games) |
| 8 | 0 and 1 | 47.6% ± 3.4% |
| 6 | 0 and 1 | 46.1% ± 3.4% |
| 5 | 0 and 1 | 45.6% ± 3.4% |

Monotone in the knee: the more concavity, the worse. It ships **flat** (`resourceSurplus` equal to
`resource`, which also makes `saturation` inert), and the mechanism is kept only so the question can
be re-asked cheaply.

Two things are worth carrying forward. First, the obvious explanation is wrong: the bot does **not**
spend its pool late, committing a mean of 5.9 per round against pools of 7 to 8, so idle resources
are genuinely real and the premise was not the problem. Second, the likeliest reading is that
resource count also proxies development and tempo for *every other* decision, so flattening it costs
more signal than the one regroup decision it buys. That is worth re-testing after **#395**, where a
role-aware evaluation may separate the two.

## A note on trusting numbers while the engine still has bugs

Comparisons under a shared engine are robust: both AIs play the same engine, and in a mirror most
defects hurt both sides equally, so they largely cancel in a head-to-head. Absolute numbers and
fine-grained tuning decisions are more fragile, so treat any run made before the defect list is clean
as provisional, and re-run after fixes (it costs seconds). The `build_tag` stamped on every run is
what lets you tell which engine a number came from. Re-running is cheap, so nothing is ever "thrown
away" by a faulty evaluation; at worst a design decision made on a biased comparison is revisited.
