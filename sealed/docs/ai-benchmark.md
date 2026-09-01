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

The built-in sanity check is **any AI against itself**. Both sides play the same deck, so it is a
mirror match and should be a coin flip. If the reported win rate sits on 50% (within its confidence
interval), the harness itself is unbiased and you can trust it to measure real differences. If it
drifted off 50%, something in the engine or the runner would be skewing results, and no later AI
number could be believed.

**Run this check at the precision you intend to measure at.** It is only meaningful against the
effects you care about: 840 games gives +/-3.4%, which cannot see a bias a third of that size. The
seat defect below was invisible at that width and obvious at 8400 games.

### Seats and first player both alternate

`bench/seating.ts` cycles **seat** and **first player** on independent axes, so neither advantage
settles on one side. Independence is the point: flipping both together is balanced but useless,
because only two of the four combinations occur and seat stays confounded with turn order.

This matters because it was wrong. Every harness used to pin `aiA` to the `player` seat, and an AI
measured against itself read a mean of **49.67%** across six seeds at 8400 games each, five of the
six below 50. It now reads **49.99%**.

The spread is the sharper evidence. A binomial at 8400 games has an expected standard deviation of
0.55 points; the corrected readings measure 0.59, while the old ones measured **0.30, tighter than
chance allows**. The seat was deciding more of the outcome than the games were.

**The head-to-head A/B kept the defect for longer than the rest.** The seating fix reached
`generalisation`, `aiMatchups` and `matrix` but not `runBench`, which is the path `--shard` and every
head-to-head result go through: it went on pinning `aiA` to the `player` seat and alternating only who
moved first. Self-play controls through it read 50.0%, 48.8% and 46.3% on three seed sets, pooling to
**48.3%** where an unbiased harness gives 50. It uses `seating` now.

Two consequences worth knowing when reading older numbers:

- **Differences are unaffected.** Anything measured as candidate-minus-control cancels the bias, so
  the tuning result (+0.62%) stands as recorded, and so does any A/B run against a matched control at
  the same seeds.
- **Absolute win rates against a reference are understated by roughly a third of a point.** For
  head-to-head numbers that predate the `runBench` fix, treat them as directional rather than exactly
  reproducible: the ordering stands, the decimals do not.

### Always run the matched control, and quote the paired difference

**Over the coverage decks, `beam-reply` against itself does not read 50%.** Two independent seed
blocks through the fixed `runBench`:

| seeds | games | win rate (A) |
| --- | --- | --- |
| 7717-7726 | 800 | 48.6% |
| 9001-9012 | 2,040 | 48.7% |

Pooled, 1,383 of 2,840 = 48.70%, which is 1.4 SE below 50 and **not individually significant**. Two
blocks agreeing within 0.1 points is suggestive, not conclusive, so treat the residual as open rather
than as an established bias. Draws do not explain it (one draw in 2,040 games) and no evaluation
weight can, because a control is the same bot on both sides and any weight change cancels.

**The baseline is a property of the harness, not a constant.** The generalisation harness that `tune`
runs through reads **50.4% ± 6.1%** over 252 self-play games on the same decks, where `runBench` reads
48.70%. So a number carried across from one harness to another is no safer than a theoretical 50:
establish each harness's own baseline at the precision you intend to measure at, before trusting a
result from it.

**Read an arm against its own control, never against a theoretical 50%.** The size of this matters
more than it looks, because it inverts live results. The search tie-break over 2,040 games:

| read against | difference | verdict |
| --- | --- | --- |
| theoretical 50% | +1.1 | not significant |
| its matched control | **+2.35** | t = 4.94, df 11, **p < 0.001** |

Same games, opposite conclusion.

The paired form is also **immune to whatever causes the residual**, since it compares arm and control
on matched seeds, and therefore matched decks and shuffles. It removes deck variance, which dominates
on the coverage pool: across twelve shards the paired differences had a standard deviation of 1.65
points where the raw per-shard win rates spanned 44.7% to 54.7%.

**Keep games-per-shard a multiple of four.** `SEATING_CYCLE` is 4, so 170 games per shard leaves two
games covering only two of the four seat and first-player combinations. Arm and control carry it
identically, so a paired figure stays safe, but it is the same class of defect as the seat bias above.

`margin` is seat-relative (`baseDamage.opponent - baseDamage.player`), so it is negated when the
seats swap. `resultForA` owns that, because a wrongly-signed margin is silent: it still looks like a
plausible number.

### The deck population decides what can be measured at all

`--decks` chooses what a head-to-head plays over: `mirror` (the default) or `coverage`. Both seats
always play the same list either way, so it stays a mirror match.

**`mirror` is one fixed deck of the first 30 aspect-matching units, and a term whose cards are not
among them cannot fire.** It then reports neutral, which is indistinguishable from a genuine null
result. Measured on that deck against the coverage decks:

| | mirror | coverage |
| --- | --- | --- |
| an Advantage token in play | **0.0%** | 20.7% |
| a shielded Sentinel in play | **0.0%** | ~2% |
| a Shield token in play | 18.1% | ~17% |

Shields are common there and Sentinels exist, but the two never coincide. Two terms were swept for
hours against a population that could not express them, and both returned the harness's own
identical-bot baseline rather than a measurement.

So: **before sweeping a weight, confirm its quantity actually varies in the population you are about
to run**. `--decisions` and `--terms` walk the coverage decks, so their prevalence numbers do not
transfer to a `mirror` A/B. Deck and seat are decoupled by playing each deck for a whole four-game
seating cycle: cycling decks per game would pin each deck to one seat whenever the counts share a
factor, and 44 decks against a 4-game cycle does.

The deck source is part of the shard run key when it is not the default, so a coverage run can never
pool with mirror results.

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
  - `greedy` rung 1, one-ply with quiescent scoring. The reference most results are quoted against.
  - `greedy-baseline` a frozen early greedy, kept only as a fixed reference for tuning.
  - `greedy-flat` the live model minus quiescent scoring. Unlike the baseline it tracks every other
    evaluation change, which is what makes it a control for that one feature rather than a snapshot.
  - `beam` rung 2, own-turn lookahead at width 4, depth 3, assuming the opponent does nothing. Same
    weights and same chain handling as `greedy`, so `beam` against `greedy` isolates the search.
  - `beam-reply` rung 3, the same beam with the opponent's minimising reply at every level.
    **The deployed model**, and it beats `beam` 67.4% over three seeds.
  - `beam-reply-shared` the deployed model with the per-chain allowance removed, so one shared pool
    serves both chain resolution and the beam. The control for that change and nothing else, in the
    same spirit as `greedy-flat`, and it tracks every other change rather than being a snapshot.
  - `beam:WIDTHxDEPTH` or `beam:WIDTHxDEPTH:NODES` any other cell, so a sweep addresses the space
    without a registry entry per cell. The node form exists for one control: the budget is a safety
    rail, and a rail that fires has quietly become the real width and depth.
  - `reply:pessimistic` / `reply:selfish` two-ply: our move, the opponent's best answer, then score.
    The bare form is depth 1, which is this policy on its own; `reply:POLICY:WIDTHxDEPTH` combines it
    with the own-turn beam, and `reply:POLICY:WIDTHxDEPTH:NODES` sets the budget as well. A reply
    expands every legal answer at every level, so it drains the budget faster than a `beam:` cell of
    the same shape and the node form matters more here, not less.
  - `beam-lethal` / `beam-lethal:WIDTHxBEAMDEPTHxSOLVERDEPTH` the beam with a lethal override in
    front of it. Measured at **+0.8 points** and **not shipped**; kept registered so it can be
    re-measured. Outside the gate it returns exactly what `beam` returns, which is what makes an A/B
    between them one feature rather than two configurations.
  - `beam-reply-unredacted` the deployed model still reading the two cards it deals itself at regroup.
    The control for the redaction, and the only way to ask whether that fix cost anything, since
    redaction is otherwise unconditional and self-play would measure nothing.
  - `beam-horizon` the deployed model allowed to play on past the round boundary, with the opponent's
    forfeited round modelled. Measured at **-3.72 points** over 2016 games at **1.84x** the cost, and
    **not shipped**; kept registered because the mechanism works even though the bot does not win with
    it, so the question is worth re-asking with the tail removed.
  - `beam-reply-upgrade-blind` the deployed model without the hostile-upgrade tie policy. The control
    for that fix, and the only way to name the pre-fix bot: the policy is a boolean on the limits with
    no suffix grammar, so an A/B without this entry compares the arm with itself and reports `sd 0.00`.
  - `beam-claim-ties` / `beam-hold-ties` the deployed model always taking a tied initiative, and never
    taking one. A pair, because one arm alone cannot tell "claiming is underpriced" from "the tie is
    genuinely balanced"; the gap between them sizes what turn order is worth at the margin. Both only
    act on candidates still level after the second opinion, so neither can overrule the search.

  More join the list as they are built.

  Three suffixes compose with any of the above, so an A/B cell is a name rather than a registry entry:

  - `+WEIGHT=VALUE` rebuilds the bot with one evaluation weight changed, e.g.
    `beam-reply+blockedReach=12`. A new weight ships at zero and is swept upward, which needs two AIs
    differing in that weight and nothing else. An unknown weight is rejected rather than dropped.
  - `/tie=FIELD:VALUE[,FIELD:VALUE]` names the **second opinion** consulted when candidates tie for
    the lead, e.g. `beam-reply/tie=reply:null` or `beam-reply/tie=reply:null,depth:2`. Fields are
    `reply`, `width`, `depth` and `nodes`; only the tied candidates are re-searched, so this can never
    overrule a candidate that won outright. It fires on 32.0% of decisions and costs **+2.1%** per
    decision with a null reply, because a second opinion prices each root lower than the search that
    found the tie. Note that `depth:1` inherits the reply policy, so a genuinely one-ply second
    opinion is `tie=depth:1,reply:null`.

  - `/pass=N` charges N evaluation points against `pass` at the root, e.g. `beam-reply/pass=12`.
    Fractional and negative values are accepted. The shipped bot charges **8**, so `beam-reply/pass=0`
    is the pre-fix control and needs no registry entry.

  All three reject a typo loudly. A suffix that parsed to nothing would run the shipped bot under the
  candidate's name and report "no difference", which is the most expensive way a sweep can fail.

`OPPONENT_AI` in `src/config.ts` decides what the app ships, independently of any of this. The bench
takes its AIs by name on the command line and never reads it.

Examples:

```bash
npm run bench --prefix sealed                                  # 100 games, random vs random
npm run bench --prefix sealed -- --games 1000 --seed 42        # a big, reproducible run
npm run bench --prefix sealed -- --games 1000 greedy random    # measure the greedy AI
npm run bench --prefix sealed -- --decisions                   # where the evaluation has no opinion
npm run bench --prefix sealed -- --terms --games 3             # which weights can matter at all
npm run bench --prefix sealed -- --lethal --games 2 --depth 5  # what a lethal solver would add
```

`--lethal` sizes a lethal solver against the shipped beam. Its headline is **`beam missed`**, not
`lethal found`: a win the bot already plays is not headroom, and attacks-only lethal is closed form
rather than search. It also scores the **gate** (what it skips, and whether any of that cost a
winnable position) and runs an exhaustive **oracle** against the pruned search on real positions,
since a pruned line makes the answer wrong rather than imprecise, and does so silently.

`--terms` re-scores every decision once per weight per perturbation, so it costs roughly 30 times a
plain pass: 3 games a deck is ~20 minutes and is plenty for rates of this size.

Recorded baselines (mirror deck, so purely AI skill): `random` vs `random` sits at 50% (the harness
self-check), and `greedy` vs `random` is ~100% over 1000 games, the one-ply scorer demolishing
uniform-random play. `greedy` against **itself** reads 50.4% ± 3.4% over 840 games, which is the
control every comparison against `greedy` rests on. `beam` against `greedy` is 60.0% over three seeds.

**A search config costs what it costs**, and `--cost` is how to find out:

```bash
npm run bench --prefix sealed -- --cost --games 200          # every registered AI
npm run bench --prefix sealed -- --cost greedy beam beam-reply reply:pessimistic:4x4:200000
```

Name as many AIs as the sweep has cells: they are timed in one process over one corpus, which is the
whole point. Splitting a sweep across invocations re-measures the baseline each time and gives up the
shared warm-up.

It times every AI over one **identical** corpus of real decision states, collected once with a fixed
driver before any timing starts. **Ratios travel between machines; absolute milliseconds do not**,
since they depend on the box and on which positions the corpus holds, so the report divides by
`greedy` rather than leaving the reader to.

**Use at least ~200 states, and distrust a small run entirely.** The corpus is filled game by game, so
a small one is nothing but openings, where few units are in play and every search is cheap. At 30
states a depth-3 minimax measured **5.8 ms/decision**; at 200 states the same configuration measured
**142.6 ms**. That is not noise, it is a different question being answered, and note it distorts the
**ratios** as well as the absolutes, because a shallow and a deep search converge when there is
nothing to search. Filling from a wider spread of decks rather than consecutively would reduce this
and is worth doing before the next large sweep.

Do **not** take a per-decision cost from a bench wall clock. A game's clock includes the opponent's
cheap decisions and the engine's own work, which diluted the same ratio to 12x when it was really 34x,
and made a 200 ms search look like 42 ms. Both errors cost real time before this mode existed.

To estimate how long a run will take, scale a **comparable measured run** by the cost ratio rather
than multiplying a per-decision figure by a guessed decision count. Be sure the anchor really is
comparable: mistaking a `beam` vs `greedy` run for `beam` vs `beam` halves its average cost per
decision and throws the estimate out by two.

Measured over 200 states: `greedy` 1.9 ms, `beam` 61 ms (33x), `beam-reply` 130 ms (70x),
`reply:pessimistic:4x4:200000` **1495 ms (802x)**.

### Long runs: `--shard`

```bash
npm run bench --prefix sealed -- --shard 12 --games 800 --seed 4880 beam-reply beam-reply-shared
```

The bench is single-threaded, so a run that would take 58 or 416 core-hours takes a fraction of that
in wall clock. This is why the AI work needs no cloud compute: the experiments were never large, only
serial.

**Size a run from a measured run, not from core-hours.** `nproc` reports 16 but the machine is 8
physical cores with hyperthreading, so twelve shards each run at roughly two thirds speed and the
effective parallelism is about **7.3x**, not 12. Core-hour arithmetic put one run at 5.4 hours and it
took 8.8. The usable anchor is **9600 games of a 0.252 s-per-decision matchup in 8.8 wall hours at 12
shards**; scale by the combined per-decision cost of the pair being compared.

**Check memory before a long run at a new configuration.** A `beam-reply` shard holds about **365 MB**
resident, against ~53 MB for a `greedy` one, so twelve shards is ~4.4 GB of 7.8 GB: stable, but with
roughly 600 MB free and lightly into swap. Cores used to bind and memory did not; both do now. Run a
short job first, read per-worker RSS, and reduce the shard count above ~500 MB a worker. A deeper
search holds a larger frontier per root and should be expected to want more.

**`--games` is per shard, and the wall clock is set by that rather than by the total.** `--shard 10
--games 80` plays 800 games, and takes as long as one shard needs for 80. Reading it as the total
turned a 30-minute estimate into 4.3 hours.

**Keep `--games` a multiple of four.** Seat and first player cycle on independent axes with a period of
`SEATING_CYCLE = 4`, so a remainder leaves a tail of games covering only some of the four
combinations. A pre-flight check warns and names the two nearest safe values. It biases an arm and its
control identically, so a paired figure survives it, but it is the same class of defect as the seat
bias that made self-play read 48.3%.

Shards split by **seed**, not by dividing one seed's games. Every shard is therefore a valid
standalone run, exactly like the existing three-seed results, and the per-shard column is worth
reading: a finding that holds across independent seeds is far stronger than one long run, and a shard
disagreeing with the rest is a signal rather than something to average away.

### Sharding the matchup matrix

```bash
npm run bench --prefix sealed -- --matrix --shard 10 --games 10 --seed 42 beam-reply
```

`--matrix` alone still runs serially. With `--shard N` the parent spawns N children, each told only
`--shard-index K --shard-count N`, and each **deals itself every Nth pair**. The parent never hands
over a pair list: 2,628 pairs do not fit on a command line, and self-dealing keeps every child
independently re-runnable.

**Dealt round-robin, never sliced.** The enumeration is `for i, for j >= i`, so a contiguous split by
`i` would give the first shard 72 pairs and the last one a single pair, and that shard alone would set
the wall clock.

**A sharded matrix is identical to a serial one, cell for cell.** Each pair's games are seeded from the
pair (`pairSeed(base, i, j)`) rather than from a single seed advanced as the loop goes, so a pair plays
the same games wherever it runs. Verified at full size: 72 decks, 5,184 cells, zero differing. Without
per-pair seeds a child playing every Nth pair would play different games and no sharded result could
ever be checked against a serial one.

A child writes its cells and saves nothing; only the merged run reaches the database. **If any shard
fails, nothing is saved at all**, because a partial matrix is indistinguishable from a whole one with
quiet gaps, and every row and leader average read off it would be wrong without saying so.

### The matched control: `--control`

```bash
npm run bench --prefix sealed -- --shard 12 --games 168 --seed 9001 --decks coverage \
  'beam-reply/tie=reply:null' beam-reply --control
```

Runs the arm, then runs **`aiB` against itself** on the same seeds, the same games per shard and the
same decks, and reports the **paired difference with its `t`** as the headline. The control gets its
own run directory, so it banks and resumes independently.

**Use it for every A/B.** Reading an arm against a fixed 50% inverts results:

| the same 2,040 games, read against | difference | verdict |
| --- | --- | --- |
| a theoretical 50% | +1.1 | not significant, abandon |
| its own matched control | **+2.35** | t = 4.94, 11 df, **p < 0.001** |

Pairing by seed is what makes it sharp rather than merely correct. A seed fixes the decks and the
shuffles, and deck variance dominates the coverage pool: raw per-shard rates spanned 44.7% to 54.7%
while the paired differences had a standard deviation of 1.65 points. It is also immune to whatever
causes the sub-50 baseline, because both sides carry it equally.

Significance is judged against a **tabulated** two-sided 5% critical value rather than a computed
p-value. Shard counts are small (ten and twelve are typical), which is exactly where the t
distribution departs most from the normal, and an approximation that is slightly generous there would
flatter every marginal result this exists to judge.

### The evidence store

`--control` writes the comparison to `bench-results/bench.db` as **one `experiments` row** plus its
per-shard pairs, and `--history <substring>` reads them back:

```bash
npm run bench --prefix sealed -- --history 'tie=reply'
```

**The comparison is the unit of evidence, not the run.** The store previously held runs only, which
meant that of a completed tie-break experiment the pooled rate was in no row (each shard is its own
`runs` row and the pool was computed and printed), the control was twelve rows nothing marked as a
control, and the paired difference that settled it was nowhere at all. A store that logged runs more
diligently would have kept the misleading number and lost the decisive one.

The per-shard pairs are kept because **conclusions get revised on the same games**, so a stored
experiment that cannot be re-analysed is a screenshot.

`runs` also carries `decks` now. Its absence was a correctness hole rather than a missing field: a term
whose cards are not in the mirror deck reports neutral there while firing on coverage, so two
populations must never read as comparable. Existing databases are migrated by an idempotent `ALTER`,
since `CREATE TABLE IF NOT EXISTS` cannot add a column.

### Watching a run: `--status`

```bash
npm run bench --prefix sealed -- --status
```

Read-only, and safe at any time: it starts nothing. Per run it reports shards done of total, games
played of total, **measured** seconds per game, and a projected finish, all from files already on disk.

Every run also rewrites `bench-results/STATUS.md` as each shard lands, so a long run can be watched
from an open editor tab rather than by asking.

**An incomplete run is labelled `PARTIAL` and shows no pooled rate.** A subset of shards looks exactly
like a finished run, and both of us have drawn a conclusion from one. The completeness of a run cannot
be inferred from its result files either, because `shardRunKey` deliberately excludes the shard count
so a run can resume at a different one, so each run writes a `run.json` manifest at launch and that is
what makes "9 of 12" knowable at all.

A shard counts as done only if it is this run's: within the seed range, stamped with this build, exited
cleanly, and having played something. Those are the same four conditions `pendingSeeds` uses to decide
what to re-run, and they must agree, or progress would show a run as further along than a resume would
find it.

**Pooling sums the games; it never averages the rates.** An unweighted mean is correct only when every
shard completed the same number of games, and shards drop games, so the mean would silently
over-weight whichever shard lost the most. Summing is also the only way to get one interval over the
whole run instead of a mean of twelve wide ones.

### Watching a run, and resuming a broken one

Each run gets a directory named after what defines it, holding a log and a result per shard:

```
bench-results/shards/<aiA>__vs__<aiB>__g<games>__s<seed>/
  seed-4910.log     written as the shard runs
  seed-4910.json    written the moment it finishes
```

**The log is the only progress signal there is.** A shard prints its report at the end and nothing
before, so `tail -f` on a log file is how a multi-day run is distinguished from a hung one.

**Re-running the identical command resumes.** Completed shards are skipped, failed ones repeat, and
the run announces `RESUMING: N shard(s) already complete`. A shard counts as done only if it exited
cleanly **and played games**, because a process killed for memory can exit zero having completed
nothing, and treating that as finished would quietly shrink the pooled total.

The shard **count** is deliberately not part of the run's identity, so an interrupted run can be
resumed with fewer shards (memory pressure being the obvious reason) without orphaning its results.

**A resumed run pools every shard, banked and fresh alike.** This is worth stating because getting it
wrong is silent: the first implementation dropped the banked results, so a resumed run reported a win
rate over only the shards it had just re-run, with a plausibly wider interval and no indication that
anything was missing. `mergeShardResults` is a separate tested function for that reason.

### Mechanics that broke the first time

- **Children run `tsx src/bench/main.ts` directly, not `npm run bench`.** The npm script regenerates
  `src/buildIdentity.ts` first, and a dozen processes rewriting one module while others import it is
  a race that eventually reads a half-written file.
- **The database had to be made safe for concurrent writers.** With the defaults, twelve concurrent
  three-game runs lost **six of them** to `SQLITE_BUSY` at the final save, after the games had been
  played. See "Where results go" below.

Shards run under `nice`, so interactive work keeps priority. Expect the test suite to be slow while a
run is going, and treat a timeout-only failure then as contention rather than a regression.

### Is the node rail firing? `--budget`

```bash
npm run bench --prefix sealed -- --budget --games 200 beam beam-reply beam:4x3:200000
```

A cell whose budget runs out is measuring the rail rather than the width and depth in its name, and
that has cost a real result before: a depth screen reported depth 4 as **worse** than depth 3 purely
because the rail truncated it, and lifting the rail reversed the finding. So any sweep over depth or
width carries a raised-budget control cell, and this mode says whether it was needed.

**A wall clock answers this question wrongly.** Raising `nodes` from 10,000 to 200,000 costs ten times
as much per decision at depth 3, and also at depth 1 where the beam expands nothing, which reads as a
search being cut short everywhere. Measured, the rail fires on **4.0%** of decisions for `beam` and
**8.5%** for `beam-reply`. The tenfold cost is a heavy tail: a few positions with an enormous choice
fan-out expand to fill whatever budget is offered.

The **chain / beam split** is the part worth acting on. Both draw on one pool and the chain takes 80%
to 98% of it, so raising the rail buys cost and no lookahead: across a twentyfold rise the beam's own
spend goes 128, 130, 135 while the chain's goes 510, 2108, 6885. Where the rail does fire it is
starving the search at exactly the complicated positions, and the candidates left over are scored
half-resolved.

Use at least ~200 states here too. The corpus is filled game by game, so a small one is all openings,
where the budget is never troubled and every cell reports 0%.

Note the `--` after the script name: it tells npm to pass the flags through to the bench rather than
eat them itself.

## Running a long sweep unattended

Validation runs are hours long, so they outlive a terminal, a session and sometimes the machine.
Three conventions, each of which exists because its absence cost a run.

**Detach properly.** `setsid npm run bench ... > log 2>&1 &` per job, from a script. A job tied to a
terminal dies with it.

**Make it resumable, and know the granularity.** A driver script skips any log already ending in a
`wall clock` line, so a restart costs one job rather than the set. It is **per job, not per game**: an
interrupted 3-hour run restarts from game 0. That is the wrong granularity for the longest runs and
worth improving if they get longer.

**Never write a waiter that matches itself.** This is the one that bites:

```bash
while pgrep -f "tsx src/bench/main" > /dev/null; do sleep 60; done   # WRONG: never exits
while pgrep -f "[t]sx src/bench/main" > /dev/null; do sleep 60; done # correct
```

`pgrep -f` searches full command lines, and the waiter's own command line **contains the pattern**, so
it matches itself and waits forever. The bracket makes the pattern not match its own text while still
matching the target. A whole night's queued work was lost to this: the jobs it was waiting for had
finished, and it never noticed.

**Sleep does not stop a run, but it does corrupt the clock.** A suspended process resumes exactly
where it was, so nothing is lost or repeated. But a bench `wall clock` comes from `Date.now()` and so
includes the suspended time: runs have reported 6.9 and 15.4 hours for 2.3 hours of compute. Win rates
are unaffected, because the harness has no wall-clock timeout by design (see the seat and determinism
notes above). **Treat a wall clock spanning an overnight gap as unusable and the win rate as fine.**

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

- **engine** the commit the run was measured under, git-derived and unique. Every result is only
  comparable to others from the same engine, so it is stamped on every run and stored in the
  database. A **`-dirty`** suffix means the tree had uncommitted changes, so the run belongs to no
  commit and is not reproducible from one. See the build identity section in
  [operations.md](operations.md).
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
interactions broadly (the best bug-finder). It reports the coverage numbers below and any dropped
game, writing each as a replayable fixture. A drop here is a **finding**, a hang or throw in some
card, not a failure of the sweep.

### Decked, drawn, played: three different claims

A card being in a deck is availability, not evidence. It can sit in every deck of the sweep, never be
drawn, and prove nothing about itself. The sweep therefore reports three numbers, and card
implementation work rests on the third:

- **cards decked**: deck-able cards the deck set includes. ASH's 264 cards are 18 leaders, 8 bases
  and 238 deck-able, and the generated set includes all 238.
- **cards drawn**: of those, how many reached a hand.
- **cards played**: how many were actually played. Cards decked but never played are **listed by id**
  rather than summarised, so a stubborn one can be chased.

Leaders and bases are counted apart, because both are in play from the first turn. Folding them in
would credit two free cards per deck. A leader is reported as deployed only when it actually
deploys, which is the only way its deployed side runs.

An uncovered card is **not** a failure and does not affect the exit code. It is a fact about what the
run reached. Dropped games are the failure signal.

### Several seeds beat a longer run

`--seed` takes a list. Every deck plays `--games` games under each seed, and coverage is the
**union** across them:

```bash
npm run bench --prefix sealed -- --sweep --games 5 --seed 42,43,44
```

This is the shape to use, because tail coverage is **seed-luck rather than run length**. One game a
deck plays 207 of 238 cards (87%); five plays 237 (99.6%); and raising it to 40 still leaves one card
on seed 42 while covering everything on seed 99. Five games across three seeds reaches **238 of 238
in 630 games and about five seconds**, which is the sweep worth standardising on.

Each seed is an independent chain, so adding one extends the evidence instead of reshuffling what the
earlier seeds did, and the seed list is printed and reported so any result can be reproduced exactly.
The deck set itself is generated once from the first seed: regenerating it per seed would change
which cards are decked at all, and the union would no longer measure one pool.

If a card still resists, chase that card rather than raising the counts. `uncovered` names it, sorted
by set and then by collector number as a number, so `TS26_3` sorts before `TS26_10` rather than after
it as a plain string sort would have it.

### How coverage is measured

`bench/playCoverage.ts` reads **state** rather than interpreting actions. A card reaches play by
several routes (from hand, from the resource zone, from the deck, discounted from hand), several of
them arriving as an `acceptChoice` whose fields mean different things per pending choice. A card
sitting in play got there by being played, whichever route it took, so state is the stable signal.

Two cases need the action instead, because they leave no trace between moves: an **event**, which
never persists, and anything that **enters and leaves play inside a single action**, since coverage
is observed between actions. A card whose defeat is a *choice* is not that case: answering the choice
is its own action, so there is an observation point while the card is still in play.

**Where it is unsure it does not credit the card.** Under-counting yields a false "uncovered", which
is visible and gets investigated. Over-counting yields a false "covered", which is a silent lie.

Tracking is off by default and the sweep turns it on: it costs a set-union per step, and the AI
benchmark plays hundreds of thousands of games where the answer is never read.

The decks come from `deckgen/generateDeck.ts` (a reusable primitive that builds one legal,
penalty-free, realistically curved deck for a leader, respecting rarity mix and aspect balance, see
`deckgen/rules.ts`) orchestrated by `bench/coverageDecks.ts` (which picks leaders and bases so the
union covers the pool). The generator is deliberately separate from the bench so a future
"play a random representative deck" setup feature can reuse it.

## Card triage: sizing an unimplemented set

`--triage` classifies a card pool by **what the engine cannot yet express**, so a newly released set
can be sized without reading 260 cards by hand:

```bash
npm run bench --prefix sealed -- --triage LAW SEC
```

It fetches each set live from the card API (one request per set returns the whole set), so it works
on release day with no fixture. It reports:

- **Buckets**: vanilla, keyword-only on implemented keywords, otherwise-vanilla but held back by an
  unimplemented keyword, and cards with real ability text.
- **Blockers**, each with the cards it unlocks **on its own** and the cards it touches at all. The
  sole-unlock column is the ordering signal: a mechanic unlocking thirty cards is a different ticket
  from one unlocking two.
- **Batch sizing**: the trigger-head distribution over cards blocked by nothing, which is how to cut
  them into workable groups when no mechanic divides them.
- **Fallout probes**: cards classified as buildable that nonetheless want a human reading.

The tool's model of the engine lives in three lists in `bench/triage.ts`: implemented keywords,
dispatched trigger points, and unexpressible mechanics. **They shrink as mechanics land.** When
Experience tokens ship, delete that entry and every card it was blocking reclassifies itself.

### Why there are fallout probes

The blocker list catches new *nouns*: a token type, a zone, a card type. It cannot catch a card
using familiar nouns in an unfamiliar *shape*. `SEC_145 Confidence in Victory` reads as ordinary
text, yet needs a play restriction, a delayed check at regroup, and an alternate win condition. The
probes flag such cards for reading rather than reclassifying them, and they are deliberately noisy:
several probe shapes are already supported, because the point is to surface cards worth a second
look rather than to be precise about which.

**This is triage, not a specification.** It is reliable about clusters and relative sizes; every card
still needs reading before it is built.

### The ASH anchor

`benchTriage.test.ts` asserts the tool's "plays as printed" count for ASH equals the 47 that
`data/implementedCards.ts` records by hand. Two independent derivations agreeing is what makes the
tool's numbers for other sets trustworthy, and the test fails if either drifts.

### Card identity, variants and reprints

Only Normal printings are counted. A card is printed several ways (Hyperspace, foil, showcase and
so on), each with its own collector number, so counting them all would multiply the pool. Identity
within a set is type, name and subtitle: the same key `data/printings.ts` canonicalises with, and
asserted equal to it by test. Type is load-bearing, since a leader and a unit can share a name with
no subtitle to separate them.

De-duplication is **within** a set, never across. A card reprinted in a later set is a separate card
id and abilities register per id, so both printings are work. IBH is the within-set case, reprinting
single cards at up to three collector numbers, so its 104 printed slots are 51 real cards.

Cross-set reprints are reported separately, because one implementation covers every id it appears
under. Across the nine unimplemented sets that is 29 cards with ability text, covering 30 extra card
ids for no extra work. Reprints skew vanilla, since they exist mostly to balance sealed pools, and a
printing's rarity can differ without affecting any of this: the engine does not read rarity.

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

## Why did it play that? The principal variation

Not a bench mode: a flag on the search itself, for diagnosing a single position.

```ts
makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, explain: true })(position)
lastSearchTrace()!.lines   // one per root candidate, in legalMoves order
```

Each line reports the candidate's **value**, the **level its peak was found at**, and **our moves down
to that peak**. Off by default, because tracking the path allocates per frontier node.

**A bare value explains nothing**, because a root move is worth the max over every board it can reach,
so two moves can score alike for completely different reasons. Four consecutive wrong explanations for
one defect came from inferring the line from two numbers and a mental model of `ai/search.ts`; this
settled it in one run.

The reading that mattered there: the acting line and the passing line **peaked at the same level**,
which is why discounting later boards could not reorder them, and why the tie has to be broken by the
evaluation telling those two boards apart.

Read it in a test rather than printing it. An assertion is checkable and fails loudly if the search's
behaviour drifts; console output is neither.

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

Current rates for the deployed model: answering a choice 12.4%, which card to play 11.5%, initiative
8.2%, which attack 4.8%, regroup card choice 2.9%.

**Read the rate against how often the decision comes up**, or the ordering misleads. Initiative is
offered about 43 times a game, so 8.2% is roughly 3.5 ties a game; answering a choice comes up about 14
times for 1.7.

### The initiative rate compares against the best ALTERNATIVE

It has to be said explicitly because it was once implemented the other way. A tie means claiming scored
level with the best move that is **not** claiming. Comparing it against a maximum computed over every
candidate *including* claiming is satisfied whenever claiming wins outright, which counts a decisive
result as a blind spot: that read 18.3%, decomposing into 10.1% claiming won and 8.2% claiming tied.

The arithmetic that catches it needs no instrument. The bot claims 15.3% of offers and every claim
requires claiming to be at the lead, so a two-way tie taken half the time cannot produce 15.3% of claims
out of 18.3% of ties. `benchInitiativeTies.test.ts` asserts it.

### A tie is not yet a coin flip

Ties go to the second opinion first, so **only what survives that is decided at random**. The two are
reported separately, and the gap is the only measure of whether the tie-break is doing anything.

For the deployed model it resolves little: of the ties it is handed, **86.4% are still level
afterwards**, narrowed from an average 3.2 candidates to 2.4. That is consistent with the tie-break's
measured +2.35 points, since resolving 13.6% still moves about 5% of decisions, but "the second opinion
decides tied candidates" overstates what it does.

`--decisions` also reports what claiming tied **with**, by move type, because the situations want
opposite policies: tying with `pass` means the search sees nothing worth doing and the initiative is
nearly free, while tying with an attack is a real trade of damage against turn order. The split is
roughly attack 46%, pass 38%, leader ability 9%, playing a unit 7%.

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

### What the pass charge is buying, and where debuffs land

Two counters that exist to police shipped behaviour rather than to find something new.

**Decisions the charge flipped.** `SearchTrace` carries the penalty, so the pre-charge score is
recoverable and "would this have gone the other way for free" is an exact question rather than an
inference. Those are the decisions the charge is responsible for, and the tally of what was played
instead is the verdict: real actions mean it works, filler means one bad habit was traded for a worse
one. Currently 52 of 1832 decisions, into `takeInitiative` 21, `playUnit` 13, `attack` 13 and nothing at
all into playing a card for no benefit.

**Debuff upgrades, by whose unit they landed on.** Both sides are reported, because our own count alone
cannot tell "always targets correctly" from "never came up": a correct play onto an enemy leaves no
trace. Read `own / (own + enemy)`; 0 of 0 means the diagnostic cannot speak. Currently 0 of 5 onto our
own units, so the general case is healthy and the tie policy exists for the residue.

### Denial: following a decision to the end of its game

A claim rate says what the bot did. It cannot say whether it **worked**, and "they finish next round"
is a prediction that nothing checked. So every decision in the denial bucket, where the opponent
finishes next round and we do not, is followed to the end of its game and reported as a funnel with
exclusive stages in time order: lost on their free run, lost to their first action of the round the
claim bought, lost later that round, survived it, won the game.

**The free run comes first and is the stage that is easy to forget.** Claiming forfeits the rest of your
own round, so the opponent gets a turn *before* the turn order you bought ever applies. A loss there was
caused by the claim rather than not prevented by it.

Two splits decide how the rest reads. **Hopeless** uses `canFinishNow` rather than the bucket's
`reachSteady`: they finish before this round is out, so turn order next round was never on offer and
declining cannot be a mistake. **Had counterplay** is whether any legal move other than pass or claim
existed, since with none the claim is free and proves nothing about judgement.

Both columns, claimed and declined, come from the same population, but **the split is the bot's choice
rather than a treatment**, so it is confounded: the bot claims where it reads the position as
salvageable. Read the funnel's shape, not the difference between columns. Usefully, the bias direction
is known, which is what makes the current reading interpretable: declined decisions are hopeless 41.6%
of the time against claimed's 15.2%, so that column is loaded with lost positions and should look worse.
It wins slightly more anyway (13.2% against 12.1%), so **claiming in a denial spot buys time without
winning games**: 42.4% survive the round they bought against 19.6%, and it converts no better.

A real effect needs the forced counterfactual, forking the position and playing both branches. That is
not built.

### What claiming costs, over every claim

Scoped to all claims rather than the denial bucket, because a claim that hands the opponent the round
they need to **build** lethal cannot appear in a bucket that requires the threat to exist already.

Reported: how many claims had a measurable free run, whether the threat was already there, whether the
free run **created** it, and how much the opponent's steady reach grew. Currently the free run creates a
new lethal threat in 4.4% of claims and grows their reach at all in 20.7%, by about 3.6 when it does.

This is the quantity a search modelling the opponent's forfeited round is pricing, so a small number
here means that model is charging for a cost that mostly is not there.

### Lethal availability

The same run reports how often either seat could finish the enemy base with what it already has
ready, via `canFinishNow` (a clock of 1, so Sentinel, Saboteur, arena and Hidden resolve through the
rules' own targeting rather than a second damage sum).

It is the ceiling on every rule built over a lethal solver: an initiative-lethal rule or a tap-out
risk gate can only fire as often as lethal exists.

**Read the one-action figure, not the aggregate.** `canFinishNow` sums every ready unit, but players
alternate actions, so three units totalling lethal is three of your actions with three of theirs in
between: a threat, not a kill. `canFinishThisAction` asks whether a single unit can do it alone,
which is the only thing one ply can guarantee, and it is three times rarer.

Current rates over 1260 games:

| | Aggregate | One action |
| --- | --- | --- |
| We could finish | 5.8% | **1.7%** |
| They could finish | 6.6% | **2.2%** |

Almost all of it is late. Rounds 1 to 4 hold two thirds of all decisions and produce lethal **twice
in 60,749**, rising to 11.5% at round 5 and peaking near 33% at round 7. That one is arithmetic
rather than measurement: bases are ~30 HP and no early board approaches it.

### Leader deploys, and why the rate is not a quality signal

The run reports how often a deployed leader is defeated before the end of the following round:
**17.7%** for a reply-blind beam, **18.4%** with the opponent's reply modelled. It was built to test a
claim that modelling the reply would subsume a hand-coded "do not deploy into a punish" rule, and it
does not support it.

**But the metric cannot support it either way, and that is the more useful finding.** A leader's value
is largely in the deploy itself, so losing one afterwards is often a purchase rather than a mistake:
trading it to stop base damage, to remove a unit holding lethal, or to clear a Sentinel are all
correct plays that this counts as a death. The readout cannot separate a leader thrown away from one
spent well, so a rate on its own says very little.

Treat it as a **behaviour readout**: useful for noticing a large change between models, not for
judging one. A rule about deploying into a punish needs a measure of the punish, not of the death.

### Avoidable exposure

The same run asks the sharper question: not how often the opponent *could* finish, but how often the
AI **chose** to let them when a legal move existed that would not have. That is the headroom a
tap-out risk gate could recover, and it needs no opponent model to measure.

Measured with the **one-action** predicate, since that is what the opponent can take before we act
again. Every decision is classified `safe`, `avoidable` or `unavoidable`.

| | Before `lethalExposure` | Shipped |
| --- | --- | --- |
| Decisions handing them lethal | 2.5% | 2.5% |
| ...of which **unavoidable** | 82.0% | **86.3%** |
| ...of which avoidable | 18.0%, so 408 in 89,546 | 13.7% |
| Seat loss rate, made an avoidable exposure | 68.9% | 44.0% |
| Seat loss rate, made none | 46.8% | 50.8% |

**Most exposures are unavoidable**: every legal move led there, the position was already lost, and no
evaluation term recovers it. That is why the raw "they could finish" rate overstates the opportunity,
and why the total barely moves while the avoidable share falls.

The 22.1 point loss-rate gap in the first column was 7.8 standard errors, and it is what
`lethalExposure` was built against. It has since disappeared: read the disappearance rather than the
reversal, because the shipped column rests on only 50 seat-games. Treat the gap as **correlation**
either way. An avoidable exposure is plausibly a symptom of a losing position rather than its cause,
and the term's actual worth is the +3.8 points its own A/B measured, not the ceiling this readout
suggested.

Worth knowing that measuring this with the aggregate predicate gave 7.4% exposure and a 10.5 point
gap: a threefold higher rate with less than half the effect. Slow threats counted as kills dilute
exactly the signal the measure exists to find.

Both halves are measured from **public** information, so this headroom belongs to a deeper public
search rather than to any hidden-information model.

Two things to hold onto when reading it:

- **It under-counts.** Only damage that can already connect is seen, so a line needing a card played
  first, an event finisher or a when-played trigger is invisible. Early-game lethal is the figure to
  trust least, since it would most likely come from a burn event rather than from board damage.
- **"They could finish" is not "the bot blundered".** Many such positions are already lost. The rate
  bounds how often a risk gate is *live*, not how often it would *help*.

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

Current rates: **we** owe the answer in 33.7% of positions and 16.7% of chosen moves; the opponent
owes it in 4.6% and 0.3%.

These are counted on the **raw** state a move produces, so they measure how often quiescence has
something to do, not what it concluded. The chosen-move rate going **up** as the positions rate came
down is the fix showing its work: the AI used to avoid cards whose when-played effect it could not
see, and now it plays them.

## Term sensitivity: which weights can matter

`--terms` reports, per evaluation weight, whether it can influence a decision at all. It exists
because a 146-cell grid and 8400-game validation spent roughly 400,000 games discovering that most of
the weight set was at a local optimum, and a few minutes of instrumentation says which weights could
ever have moved.

The mechanism is that one ply only compares candidates from a **single** position. The score is
`sum_k w_k * q_k(candidate)`, so a term whose quantity is equal across those candidates adds the same
constant to every score and cancels exactly, whatever its weight.

Three columns, because no one of them is enough:

| Column | Question | Method |
| --- | --- | --- |
| **Varies** | Can the term influence the ranking at all? | Does `q_k` take more than one value across the candidates |
| **Pivotal** | Is the weight worth sweeping? | Does a nudge of a quarter of its value change the pick |
| **Bearing** | Can the weight be deleted? | Does setting it to zero change the pick |

The last two are not the same question, and the gap between them is the reason both are reported. A
tie-break whose ordering survives rescaling is bearing but never pivotal. Conversely a weight can be
pivotal without being bearing, when what matters is its **difference** from another weight and zeroing
it leaves that difference the same sign.

`saturation` and `roleShift` price no quantity: the first decides how the pool is split between two
rates, the second bends other weights. They report `n/a` under Varies, and only the perturbation
columns are findings for them. Reporting a bare 0 there would say the opposite of the truth for
`roleShift`, which is bearing in 4.4% of decisions.

Over 126 games and 8503 decisions:

| Weight | Varies | Pivotal | Bearing | Spread |
| --- | --- | --- | --- | --- |
| `base` | 44.7% | 10.5% | **23.1%** | 3.0 |
| `power` | 64.1% | 12.8% | 18.0% | 4.1 |
| `resource` | 14.3% | 8.9% | 14.2% | 1.0 |
| `hand.hold` | 57.7% | **0.0%** | 13.8% | 13.9 |
| `hp` | 59.0% | 14.9% | 8.9% | 4.3 |
| `unit` | 52.1% | 3.4% | 6.3% | 1.4 |
| `roleShift` | n/a | 8.1% | 4.4% | n/a |
| `card` | 53.9% | 13.3% | **2.9%** | 1.0 |
| `readyUnit` | 53.1% | 4.9% | 2.3% | 1.1 |
| `initiative` | 28.9% | 3.1% | 1.9% | 2.0 |
| `claimCost` | 43.0% | 1.0% | 1.8% | 2.3 |
| `resourceSurplus` | 1.9% | 1.6% | 1.7% | 1.0 |
| `lethalExposure` | 3.4% | 0.1% | 1.0% | 1.0 |
| `hand.canAct` | 5.5% | 0.0% | 0.1% | 1.0 |
| `saturation` | n/a | 0.0% | **0.0%** | n/a |

Read Pivotal as "the decision is sensitive to this weight", not "there is improvement available
here". `card` scores 13.3% largely by creating ties: at `card: 3` the banking gate `resource - card`
reaches exactly 0, which is the measured 15.8% catastrophe rather than an opportunity.

**The two perturbation columns overlap for any weight shipped at 1.** The step is a quarter of the
weight floored at 1, so for `hp`, `readyUnit`, `initiative` and `roleShift` the downward nudge lands
on zero and Pivotal already contains Bearing. That is a property of integer weights that small rather
than a defect: the only neighbours of 1 are 0 and 2, so "tune it down" and "delete it" are the same
experiment. For every other weight the columns are independent.

The by-kind breakout is what makes the resource terms legible. `resource` is bearing in **89.2%** of
regroup decisions and 0.1% of action-phase ones; `hand.hold` in **75.9%** of regroups. Averaged into a
single number both would look mild.

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

A paired control row (measuring the shipped weights alongside each candidate) is **no longer needed**
now that the seats alternate. It was how the seat bias got cancelled by hand, and it doubled the cost
of every comparison.

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

### Safe for concurrent shards

A sharded run has every process writing here within moments of the others, and the SQLite defaults
lose most of them. Twelve concurrent three-game runs produced **six `SQLITE_BUSY` failures** at the
final save, discarding runs whose games had already been played. Three settings prevent it:

- **`busy_timeout` of 30 seconds.** Without it a writer that finds the database locked fails on the
  spot rather than waiting for a write that takes milliseconds.
- **WAL journalling**, so a reader is not blocked by the writer and the exclusive window is short.
  Not applied to `:memory:`, which the test suite uses and which has no journal file.
- **One transaction per report.** A run is a row plus up to a thousand game rows; inserting them
  separately took and released the lock a thousand times, the widest possible collision window. It is
  also atomicity: a failure part way through used to leave a run row carrying only some of its games,
  which reads exactly like a complete run of fewer games.

### Data model

Two tables, joined on `run_id`.

**`runs`** one row per `npm run bench` invocation:

| column | meaning |
| --- | --- |
| `run_id` | primary key: the start timestamp plus a short random suffix |
| `started_at` | ISO timestamp |
| `build_tag` | the commit the run was measured under. Rows written before build identity landed hold the old `bN` counter and are engine-ambiguous: the mapping to a commit never existed |
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

**Every module is listed**, grouped by what it is for. A partial list is worse than none: a reader
using it to find where something lives concludes it does not exist, which is exactly what happened when
eight of eighteen modules were missing.

### Diagnostics

- `bench/decisions.ts` the blind-spot diagnostic behind `--decisions`.
- `bench/terms.ts` term sensitivity behind `--terms`: which weights could ever change a decision, and
  which do. Takes a model, so the perturbations can be driven through the shipped search rather than a
  one-ply scorer, and `--weights` narrows it because doing so is ~60x otherwise.
- `bench/cost.ts` per-decision timing over one identical corpus, behind `--cost`.
- `bench/budget.ts` node-rail exhaustion and the chain/beam split, behind `--budget`. Shares
  `cost.ts`'s corpus, so the two modes describe the same positions.
- `bench/lethal.ts` the one-turn lethal solver. Measured as an override and not shipped: the beam
  already finds 5.8 of the 6.6 points of lethal that exists.
- `bench/generalisation.ts` per-deck win rate across the coverage decks, weakest first, behind
  `--generalise`. Also what `npm run tune` measures each candidate with.

### Running games

- `bench/shard.ts` running work as N child processes, behind `--shard`. `spawnShards` is
  mode-agnostic: it is handed jobs (an id and an argv), streams each child's output to a log, reads
  back what the child wrote with `--out`, and reports the moment one finishes so its caller can bank
  the result before the parent can die. A mode supplies its own split and its own merge; `seedJobs`
  and `poolShards` are the head-to-head's. Also owns resumption: which seeds still need playing, and
  merging banked results with fresh ones.
- `bench/paired.ts` the arm-versus-control comparison, behind `--control`. Differences by seed, and
  judges the result against a tabulated t critical value rather than a computed p, because shard
  counts are small enough that an approximation would flatter a marginal result.
- `bench/status.ts` progress of a run in flight, behind `--status`, plus the `STATUS.md` an editor tab
  can follow and the pre-flight checks. Pure reading and formatting, so `shard.ts` depends on it and
  not the reverse.
- `bench/selfPlay.ts` `playGame`: one full game, seeded, with the drop classification.
- `bench/runBench.ts` `runBench`: N games, alternating seat and first player, aggregated into a report.
- `bench/seating.ts` seat and first-player alternation on independent axes, so four games cover all
  four combinations once and neither advantage settles on one side.

### Deck sets and whole-pool work

- `bench/decks.ts` the fixed sealed deck, built deterministically from the ASH snapshot. Both seats
  play the same list, which removes deck strength as a variable.
- `bench/coverageDecks.ts` the deck set whose union covers the whole card pool.
- `bench/matchupDecks.ts` the leader-by-base deck set the matrix plays: 18 leaders x 4 base aspects.
- `bench/sweep.ts` the whole-pool fuzzing sweep behind `--sweep`, which reports cards **played** rather
  than decked and names anything decked but never drawn.
- `bench/playCoverage.ts` the per-card play tracking that backs it.
- `bench/matrix.ts` the deck-strength matrix behind `--matrix`, sharded by dealing each child every Nth
  deck pair, with per-pair seeds so a sharded run is identical to a serial one.
- `bench/aiMatchups.ts` AI-vs-AI across every ordered deck pair, behind `--matchups`.

### Tuning and persistence

- `bench/tune.ts` the weight sweep behind `npm run tune`. Candidates are the named model with bent
  weights, taking their limits from the registry, so they track the shipped bot rather than a one-ply
  stand-in.
- `bench/stats.ts` the Wilson confidence interval.
- `bench/store.ts` the SQLite persistence: runs, games, matrix cells, experiments and term runs.
- `bench/reports.ts` writing a dropped game out as a replayable fixture.

### Everything else

- `bench/triage.ts` the card-pool classifier behind `--triage`. Pure, apart from `fetchSets`. Holds
  the tool's model of the engine: implemented keywords, dispatched trigger points, unexpressible
  mechanics. Those lists shrink as mechanics land.
- `bench/main.ts` the command line: the only impure file (reads arguments, prints, saves).

## A note on trusting numbers while the engine still has bugs

Comparisons under a shared engine are robust: both AIs play the same engine, and in a mirror most
defects hurt both sides equally, so they largely cancel in a head-to-head. Absolute numbers and
fine-grained tuning decisions are more fragile, so treat any run made before the defect list is clean
as provisional, and re-run after fixes (it costs seconds). The commit id stamped on every run is what
lets you tell which engine a number came from, and a `-dirty` one tells you the run cannot be tied to
a commit at all. Re-running is cheap, so nothing is ever "thrown away" by a faulty evaluation; at
worst a design decision made on a biased comparison is revisited.
