# Planned work

Where the next session picks up. **This is the only doc that tracks tickets and history**; every
other file describes what the software does now.

Shipped work is not recorded here. Evidence from it is, but only where it decides what to build next.

## What the evidence says

Four findings shape the whole order below.

### Initiative is the largest blind spot

`npm run bench --prefix sealed -- --decisions` reports how often every candidate move scores
identically, so the seeded tie-break picks at random:

| Decision | Coin-flip rate | Options | Coin flips per game |
| --- | --- | --- | --- |
| Initiative | 18.2% | n/a | **~7.4** |
| Which card to play | 7.4% | 4.6 | ~1.5 |
| Answering a choice | 7.4% | 8.7 | ~0.9 |
| Attacks | 1.7% | 7.8 | ~0.5 |
| Regroup: which card | 0.1% | 4.8 | ~0 |

The last column is what ranks the work: a rate is meaningless without how often the decision arises.

### Re-weighting was exhausted AT ONE PLY, which is no longer the bot

A 146-cell interaction grid plus 8400-game validation across multiple seeds put the weight set at a
local optimum, and that stood as "further strength must come from new information, not from
re-weighting". **It measured a one-ply evaluator.** The evaluation is now the leaf function inside a
depth-3 minimax with an opponent reply at every level, and the optimum for a leaf function is not the
optimum for a bot that plays its own scores directly.

So the conclusion is correct for what it measured and does not transfer. **#487** re-tests it against
the shipped search, and is now unblocked: the configuration is settled at width 4, depth 3. The
measured constraints live in [ai-model.md](ai-model.md); the tool is `npm run tune`.

Term sensitivity (`--terms`) now says which weights could ever have moved, over 8503 decisions. One
ply only compares candidates from a single position, so a term equal across them cancels exactly.
**`saturation` is the only genuinely dead weight**: no quantity, nothing when nudged, nothing when
switched off. `hand.canAct` is nearly so at 0.1%.

Everything else earns its place, but not the way a sweep would suggest. `hand.hold` has the widest-
varying quantity in the model and **no rescaling of it changes any decision**, while switching it off
changes 75.9% of regroups: load-bearing and untunable at once. That is the shape of the null sweep
result, and it is why "can it be deleted" is reported separately from "is it worth sweeping".

The rest are expected to be **dormant rather than dead**, pricing futures one ply cannot see.
Re-running `--terms` after lookahead is how the two are told apart.

### The hidden information is small, and what matters is public

A one-action lethal is available to the opponent in **2.2%** of decisions and is **absent before
round 5** (twice in 60,749 decisions across rounds 1 to 4). Of the positions where they could finish,
**86% are unavoidable**: every legal move leads there and no policy recovers them.

Every part of that was measured from **public** information, so the headroom belongs to evaluation
and search rather than to a belief model. This is the gate on #434 to #439 below.

### What a one-ply lethal check cannot see

`canFinishThisAction` reads only damage already on the board. An event finisher, a pump, or a
when-played base hit is invisible to it, so both the lethal readout and the shipped exposure term are
lower bounds.

**A real solver closes that gap and it is worth very little.** `ai/lethal.ts` sees the hand, the
leader and Sentinel-clearing lines, and the shipped beam still finds 5.8 of the 6.6 points of lethal
that exists. Wired in as an override it measured **+0.8 points** over three seeds and 2580 games:
same sign every time, indistinguishable from neutral, and not shipped. The beam was already
converting these wins.

Two of the gaps are **public**: a leader deploys ready, so an undeployed leader is an attacker its
owner can produce at will, and a few units ready themselves while some events ready an exhausted one.
Neither earns a term, and both make the race model under-read a player about to deploy.

### Pessimism and depth compose, and that decided the shipped model

A reply alone (depth 1) beats a reply-blind beam by 4.5 points, so **one move of looking at the
opponent beats three moves of looking at yourself**. Stacking them was expected to be fraught, since
one policy is optimistic and the other pessimistic. They are strongly **super-additive**:

| Against a reply-blind beam | Mean over 2580 games |
| --- | --- |
| reply only | 54.5% |
| reply + depth 2 | 64.7% |
| **reply + depth 3, shipped as `beam-reply`** | **67.4%** |

Depth without a reply was worth +10; depth on top of a reply is worth +12.9. With a reply at every
level the search is proper minimax, so depth compounds instead of extending lines that need the
opponent to cooperate.

**The curve peaks there.** Depth 4 was measured at matched budgets and lost, 47.6% ± 1.0% over 9600
games with every shard below 50%, so the gains run +10.2, +2.7, then negative. Width is flat over the
same range. **The search configuration is settled: width 4, depth 3, pessimistic reply.**

`min(evaluate(s, me))` leads `argmax(evaluate(s, foe))` by about a point at both depths, not separably
at this width.

### Some of what the model knows may be standing in for search

`lethalExposure` is a static proxy for "they can kill me next action"; `role` is a static proxy for
trajectory. A deeper search computes both directly, so their measured value should **shrink** as depth
rises, and once #425 models the reply, `lethalExposure` risks double-counting outright.

That decides what transfers between search configurations. Changes that add **information the search
cannot get** carry over; changes that **proxy for search** do not. `--terms` is the instrument: watch
the Bearing column for those two terms.

The prediction is now harder to test than when it was written, because depth is fixed: the search will
not get deeper, so the "as depth rises" comparison is unavailable. What remains testable is the
absolute reading at the shipped depth, which is enough to decide whether either term still earns its
place. #493 supplies the counter-example worth holding onto: a token is information the search
demonstrably **cannot** recover, since stripping a Shield leaves a board that scores identically.

## One search, several policies

The search tickets are not separate features. They are **one bounded tree search over `legalMoves`**
where a node's owner is `state.activePlayer`, differing only in what happens when that owner is not
us:

| Ticket | At an opponent node | Depth |
| --- | --- | --- |
| #400 (shipped) | minimise our evaluation | the owed-choice chain only |
| #410 | null move (pass), continue our own sequence | our own actions, budgeted |
| #425 | minimise our evaluation | one full reply |

They share `ai/search.ts`: determinism, the node budget and the leaf-scoring rule live in one place,
so each ticket is a measurement rather than a separate implementation. It also makes #425's standing
question (does two-ply justify its cost, given MCTS supersedes it?) a config flag rather than a new
bot.

## Next up

Ordered on one principle: **correctness, then structure, then calibration.** A weight sweep tunes
against whatever the engine and the horizon happen to be, so anything that changes those has to land
first or the sweep is repeated.

1. **#446 give the bot a horizon: the mechanism, not the rule.** The rule this ticket is named for has
   been built and rejected, and the structural item survives it.

   **The search stops dead at the round boundary** (`search.ts` drops any node that leaves the action
   phase), so no board it can reach ever contains next round's damage. Every proxy term for
   out-of-horizon value exists because of this, and **four of them have now measured nothing**:
   `blockedReach`, Advantage-as-one-shot, `initiativeHorizon`, and a per-kind tie-break restriction.
   Every premise was correct and every evaluation term was worth approximately nothing.

   The blindness is measured rather than assumed. The claim rate is **flat across all four horizon
   buckets** (conversion 21.1%, denial 15.1%, we-finish-only 9.5%, quiet control 12.3%; chi-square ~5.9
   on 3 df against 7.8), so the bot does not discriminate at all. The denial case, "they are lethal
   next round and we are not", is 10.4% of claim offers and **four times commoner** than the conversion
   case the ticket is named after.

   Pricing that predicate directly gives +1.87 at weight 3 fading to +1.0 at weight 6, for 65-70% more
   compute. So build the horizon; do not price another proxy for it.

   The hidden-information rule is settled: the two cards drawn at regroup are **not** read (one may be
   assumed resourceable). `drawCards` slices a fully-ordered deck held in state, so a search crossing
   regroup would otherwise see both players' actual draws. Deck-composition probabilities are
   deliberately out of scope: knowable, but not worth the cost here.

   **Re-ask the lockout the moment it works.** If the search can extend one round, the strip line
   finally contains its own payoff and `blockedReach` may be deletable rather than shippable.
2. **#492 generalise sharding**, immediately before the largest sweep in the project rather than
   after it. It has picked up a second requirement that matters more than the first: **every A/B runs
   its matched control and reports the paired difference as the headline.** Identical bots measure
   48.6% and 48.7% over the coverage decks on two independent seed blocks, and reading an arm against a
   theoretical 50% inverts live results (the tie-break reads +1.1 and non-significant against 50%,
   +2.35 at p < 0.001 against its own control). Also warn when games-per-shard is not a multiple of
   `SEATING_CYCLE`.
3. **#487 re-tune the weights for the shipped search.** Last, deliberately. A re-tune is calibration
   against a fixed target, so doing it before #446 means doing it twice. The "re-weighting is
   exhausted" result measured a one-ply evaluator, and #430 identified why several weights could not
   matter there. Still the largest unexamined lever, and much cheaper than it was: #488 cut
   deep-search cost roughly sixfold. Re-size with `--cost` before sweeping.
4. **#396 and #398 are ready to close, and the tie-break they were waiting for has shipped.** Both
   said "land the search, re-run `--decisions`, build only what still ties". Measured: the search
   contributes **nothing** to choice answering (11.4% one ply, 11.3% searched), and it makes resourcing
   and card-play **worse**. Neither was subsumed, and the answer turned out to be a search change
   rather than a term.

   The tie-break is now the default in `BEAM_REPLY_LIMITS`: **+2.35 points** (t = 4.94, df 11,
   p < 0.001, 2,040 games against a matched control) for +2.1% a decision. Restricting it to
   answer/play/resource measured indistinguishable, which confirms the benefit lives in exactly the
   decisions these two tickets name.

   What remains in each is small. **#396**: its named always-accept failure mode is refuted (the bot
   declines 12% of optional triggers against a uniform picker's 29.5%, and varies 71% to 91% by kind),
   and both token-value routes it depended on returned null. **#398**: the unbuilt idea worth keeping
   is the public escape hatch, since resource count and hand SIZE are public and so "I am holding up
   three resources" may legitimately outrank the board score where "I hold Vanquish" cannot.
5. **Re-run `--terms`**, with two caveats discovered since it was scheduled. The instrument picks
   moves with a **one-ply** scorer, so it currently reports term sensitivity for a bot we no longer
   ship; testing #430's pre-registered prediction needs the perturbations driven through the real
   search. That also makes it roughly 70x more expensive, so scope it to the weights the prediction
   names. The payoff grew: `lethalExposure` and `role` are proxies for search, and a reply policy
   computes the first directly, so this is now a route to **deleting** model complexity.

### The shielded-Sentinel lockout, parked pending a ship call

A candidate is built and screened: `blockedReach: 2` over the `lockoutSwing` quantity (reach denied by
a shielded blocker, plus what that blocker deals, gated to blockers the evaluation cannot otherwise
see). It ships at **0**.

- The defect is real and far worse than the bench sees. The `shieldedSentinelLockout` fixture has the
  bot decline the strip **19 times in one game**, lane shut for twenty consecutive decisions, where
  the bench measures a shut lane on 2.1% of decisions and never lasting a round.
- **The bot is not blind, it is refusing a bad trade.** The Shield absorbs the whole attack so the
  blocker takes nothing, the counter kills the attacker, and the board is a body down for a token: a
  steady **11 to 12 points**. It strips immediately once the strip is cheap.
- The candidate strips **11 of 18 and first acts in round 4**, against 1 of 18 in round 6 shipped.
- **No measurement has separated any version of this term from neutral, in either direction**:
  49.6% +/- 1.0% over 9,600 games for the previous quantity, 49.6% +/- 3.3% over 900 for this one.
- It is live on **0.5%** of decisions, which makes a large hidden cost implausible and equally means
  self-play will never score the fix. The fixture is the evidence it works; the bench only bounds
  what it costs.

Shipping it is a judgement call about a visible defect against an unmeasurable cost, not a
measurement waiting to be taken. **Re-open it after #446** either way.

## Running a long experiment

Operational knowledge, kept here because every one of these was learned by getting it wrong.

**Size from a measured run, never from per-decision costs or core-hours.** Both understate,
independently:

- `nproc` reports 16, but the machine is **8 physical cores with hyperthreading**. Core-hour
  arithmetic put one run at 5.4 hours and it took 8.8.
- **`--cost` understates real in-game cost by 1.65x to 1.90x**, even at 200 corpus states, because the
  corpus is filled game by game and under-samples the late, busy boards where search is most
  expensive. The same trap reports 5.8 ms at 30 states for a search costing 142.6 ms.
- **It understates RATIOS as well as absolutes.** Width 8 measured 5% dearer than width 4 on the
  corpus and ran **14.6%** dearer over real games, because width only binds when the frontier is
  large, which happens late.

**An anchor only transfers to a run of the same shape.** Sizing `--decisions` from the A/B anchors
below overestimated it **threefold**: those play matchup decks and average ~192 decisions a game,
while `--decisions` plays the coverage decks and averages ~134. Borrowing an inflation factor derived
from sharded A/B runs on top of that compounded the error. Match the mode and the deck set, or measure
a short run first.

| measured run | mode | games | shards | per game |
| --- | --- | --- | --- | --- |
| `beam-reply` vs `beam-reply-shared` | A/B | 9600 | 12 | 39.6 s |
| `reply:pessimistic:8x3` vs `beam-reply` | A/B | 8400 | 12 | 44.6 s |
| `4x4:200000` vs `4x3:200000` | A/B | 9600 | 10 | 67.6 s |
| `beam-reply` | `--decisions` | 420 | 1 | **15.0 s** |

**A resumed shard run checks the commit, and seeds are consumed per experiment.** The run key is built
from the AI names, the game count and the base seed, so it cannot see a code change. Re-running an A/B
after editing an evaluation term therefore found ten complete shards, replayed the previous numbers in
**0.0s** and reported them as the new measurement, matching the earlier run game for game. Results now
carry a `commitId` and a mismatch re-runs the shard, so resuming an interrupted run of the same code
still works. The practical consequence: **a seed range is spent once per AI-name pair**, so a re-run
of the same names after a code change needs a fresh base seed, and a matched control at those new
seeds if the old one is to be compared against.

**Memory binds before cores do.** During a 12-shard run `vmstat` showed 22% idle CPU with `wa` and
`st` both zero: core headroom exists and cannot be used, because memory runs out first.

**Size shards on projected END-of-run RSS, never on the opening measurement.** A worker starts around
220 MB and reaches 450 to 460 MB over eighteen hours, roughly doubling. Growth decelerates (17 MB/hour
early, 7 MB/hour later), so a linear extrapolation from the first hour over-predicts, and a reading
from the first minute badly under-predicts. Ten shards fits; twelve would not have.

**There is no progress signal.** `runBench` and `runDecisions` print nothing until they finish, so the
per-shard log plumbing carries nothing: an 18-hour run left every log file at 0 bytes, and an
unsharded `--decisions` run writes only its npm preamble. The pipe is connected to a silent source.

What can be checked mid-run is **liveness, not progress**: `ps -o etime=,time=,pcpu=,rss=` on a worker
shows whether it is still getting a full core and whether its heap is growing. That distinguishes
"working" from "hung", and nothing more. Estimating completion currently requires either a **completed
run of the same shape** to subtract from, or CPU-time-against-predicted-work arithmetic, which is
weak. Emitting a periodic line from `runBench` is the top outstanding item on #492.

## Gated on the search, and the gate moved away from them

**#396** (optional abilities and tokens) and **#398** (hand and resource optionality) are both "value
something whose payoff arrives later", and search covers the part of "later" inside its horizon. That
horizon grew considerably with `beam-reply`, so the residue should be smaller than when these were
scoped. Re-run `--decisions` and see what still ties before building either. Land
the matrix, re-run `--decisions`, build only what still ties. The residue is genuinely latent value: a
Shield's worth being what it will prevent, held removal being worth the target it has not met yet.

That is the heuristic baseline. Stop there before ML.

### What ML would look like, and why the GPU sits idle until then

The machine has an **RTX 2080 Max-Q (8 GB)** and CUDA works under WSL2 (`/dev/dxg` and `libcuda.so`
are present). It is untouched by any current work, and that is correct rather than wasteful.

**The search cannot use it.** A GPU runs 32 threads in lockstep, so it needs many threads doing the
same operation on regular data. `resolve` is the opposite: a large switch over action types, card
abilities dispatched as registered closures, and a fresh object graph allocated per call. Divergent
branches serialise, closures do not compile to kernels, and the state is not a flat array. GPU game
simulation works for bitboard games, where a position is a few 64-bit words; the card-ability system
is exactly the part of this engine that cannot vectorise, and it is the part worth keeping.

**MCTS plus a network is where it fits**, in the standard split: tree search and self-play generation
on CPU, batched position evaluation on GPU. The network replaces the random playout with a value
estimate and a policy over moves.

Two things to carry forward rather than re-derive:

- **MCTS probably arrives with the network, not before it.** Classic MCTS wants thousands of cheap
  playouts a move; `resolve` gives a few hundred nodes per 126 ms. Naive MCTS here could easily be
  weaker than the shipped beam for want of samples. The network is what removes the need to play
  games out, which makes this one piece of work rather than two.
- **CPU and GPU share a thermal budget on a Max-Q laptop.** The GPU idles at 61 C purely from a
  saturated CPU. Generation and training will throttle each other, so expect alternating phases
  rather than both flat out.

The sharded bench harness is already the CPU half of this: seeded reproducibility, drop
classification, pooled results. Not a detour.

## Gated on the baseline: the opponent model

#434 pool, #435 sampler, #436 `P(lethal)`, #437 calibration, #438 learned priors, #439 PIMC.

The gate is **whatever the public search fails to recover**. The belief model does not need to beat
zero, it needs to beat the public version, and it is the heaviest machinery in the series. Its
originally proposed first customer, the carried initiative rules, is the weakest term in the
evaluation and worth 2 to 3 points in total. If it is built, the first customer should be the
**general tap-out risk gate**, which applies to every action-phase decision rather than the ~9
initiative decisions a game.

One design question to settle deliberately rather than by accident: the opponent's deck comes from
our own generator, so a sampler could draw from the true generating distribution instead of inferring
from revealed aspects. More accurate, arguably legitimate, but a different honesty claim.

## After the baseline

- **Epic 7 data pipeline** (#403 export, #404 consent, #405 collection Worker, #406 training store).
  #403 is small and would let a self-play corpus accumulate from the current bot immediately.

## The card programme (parallel stream)

ASH is implemented. The other nine sets are not: 1,960 distinct cards, triaged by what the engine
cannot yet express rather than by how hard the text looks. The triage is repeatable:
`npm run bench --prefix sealed -- --triage LAW SEC` classifies any pool, fetching live, so the next
set can be sized on release day. See `ai-benchmark.md`.

It runs on its own branch alongside the AI work and now shares nothing with it. The build tag used to
conflict on every merge; it is generated and untracked since #480, so that class of conflict is gone
rather than automated around.

**The programme is 27 tickets, #451 to #477.** GitHub holds them; this section holds only the shape.

Three prerequisites block everything, none of them card work:

- **#451** the sweep counts cards *decked*, not cards *played*, so per-card coverage is currently
  unbackable and every acceptance criterion below rests on it.
- **#452** the sweep pool is hard-wired to ASH. Tickets are cut per mechanic, so every group's cards
  span all nine sets and a coverage run needs a multi-set pool.
- **#478** the setup panel counts registered cards for ASH only, and the test that keeps the manifest
  honest filters to `ASH_` ids first. The first card registered outside ASH is therefore invisible
  and nothing fails. It bites on the first card of #453.

Then two phases:

- **Phase 1 (#453 to #460), 1,073 cards blocked by nothing.** 65% of the pool is expressible with the
  primitives already in `engine/effects.ts`. Cut by trigger point, since no mechanic divides cards
  that need none. Events (#453) are the largest and most uniform batch.
- **Phase 2 (#461 to #476), 487 cards blocked by exactly one mechanic each**, ordered by how many
  cards each unlocks on its own.

**Batches shrink, never grow.** A card that turns out not to fit its batch is lifted into #477 and the
batch ships without it. The classification is regex triage over ability prose: it catches new nouns
but not familiar nouns in an unfamiliar shape. `SEC_145 Confidence in Victory` reads as ordinary text
yet needs a play restriction, a delayed regroup check and an alternate win condition. Roughly 40 cards
are expected to fall out this way.

Three findings worth keeping, because they contradict the assumptions the programme started from:

- **Experience tokens are the largest single unlock at 89 cards, and were unplanned.** They are
  printed in every set and are, with Shield, the most common token in the game. `implementedCards.ts`
  already records ASH as 3 of 4 tokens for exactly this reason.
- **Resource manipulation is near the bottom at 15 cards, not the top.** Most resource prose is
  `resourceTopOfDeck`, ready and exhaust, which all exist. What does matter is *playing a card out of
  the resource zone* (#468), which gates Smuggle and Plot, roughly 50 cards. `The Armorer` already
  does it for upgrades; the gap is that `payCost` exhausts resources in array order with no choice,
  which strands a resource the player meant to play.
- **Bounty is gated behind capture**, not resources: "when this unit is defeated **or captured**".

The 292 vanilla and keyword-only cards need no ticket. That count reconciles exactly, set by set, with
`PLAYABLE_AS_PRINTED` in `data/implementedCards.ts`, so both figures are corroborated.

29 cards with ability text are printed in more than one set, covering 30 extra card ids for no extra
work: abilities register per id, so one implementation serves every printing. Reprints skew vanilla,
existing mostly to balance sealed pools, so the win is real but small.

## Deferred

- **#397 offensive pinning.** Its direct-pinning half is cut: two-ply (#425) computes "do not deploy
  the leader into a board that kills it" from the real resolver, so a hand-coded power-versus-HP
  check would duplicate the search and then need keeping consistent with it. The 2.5% leader-death-
  after-deploy rate becomes a #425 behaviour readout. What remains is recognising when **we** pin
  their leader and holding the unit ready, which no board-score maximiser finds because holding is a
  non-action. Unsized, so measure before building.
- **Web Worker** for the AI. **Downgraded, and probably unnecessary.** It existed to stop a blocking
  search freezing a phone's UI, and Sealed is desktop only, where ~85 ms a decision reads as instant
  on the main thread. `beam` ships without one. Revisit only if a winning configuration lands in the
  hundreds of milliseconds, or if the mobile adaptation below ever happens.
- **Mobile and PWA adaptation** (#482). Sealed plays on a phone but the layout needs more screen than
  one has. A redesign rather than breakpoints, and it would reinstate the Web Worker question.
- **Token-unit art**, and a permanent set for ASH tokens.
- **Unique rule on change of control.** The rule itself is built for both units and upgrades, and is
  per-player, but `takeControlOfUnit` never re-checks it. Two cases slip through: stealing a unique
  unit you already control, and (more likely) your unique being stolen, you legally play your own
  second copy, then regroup handing the first one back. The unit fix is a `uniqueUnitCheck` call for
  the receiving player; the upgrade check separately keys on the upgrade's owner rather than the
  controlling unit's controller, which is wrong for a stolen unit carrying one. Raising a mandatory
  choice during regroup needs thought before either is built.

## How to measure a change

Rules learned the hard way.

- **Default a new weight to off, then sweep upward.** Shipping the default before the A/B ran once
  inverted the whole reading, because the candidate was then the ablation and below 50% meant better.
  It also put an unproven term in the shipped model for the length of the run.
- **Measure a lethal or a threat as a single action.** Players alternate actions, so aggregate reach
  across ready units is an intention the opponent gets several chances to answer, not a kill. Reading
  it as aggregate overstated lethal threefold and diluted the very signal being looked for.
- **A corpus is filled game by game, so a short one is all openings.** Anything read off one is
  measuring turn three. This has now produced three wrong readings: a search costing 142.6 ms measured
  5.8 ms at 30 states, and a width whose real effect is 2.7% of decisions measured 0.5% at 200. Use
  1000 states for a rate, 200 for a cost, and never compare two numbers taken at different depths.
- **A cost ratio does not tell you what is consuming the budget.** Raising the node rail made a search
  ten times slower, which read as the rail truncating nearly every decision. It truncates 4%. The
  difference was a heavy tail, and only a counter (`--budget`) could tell the two apart.
- **Self-play cannot measure a strategy neither side plays.** A shielded Sentinel shutting a lane is
  something a human builds on purpose. Bench decks are generated and both seats are the same bot, so
  it appears in **0.5%** of decisions and never lasts a round, while play-testers hit it constantly.
  Defects of that shape need a **scripted position** as the acceptance criterion, and an A/B gated on
  **non-inferiority**: expecting a win rate the bench structurally cannot show will fail a correct
  fix. This is why #410 and #425 used `sentinelWall` and `crackBack` before their A/Bs.
- **Measure the complaint, not a proxy for it.** "A shield is present" (15.8% of decisions) is not "a
  lane is shut" (0.5%), and a board-wide reading is not a per-arena one. A precise measurement of the
  wrong quantity reads as a null and retires a real defect.
- **Diagnose before fixing, and build the instrument if the diagnosis will not come.** Four
  consecutive explanations for the lockout were wrong, each argued from the code rather than measured.
  `BeamLimits.explain` records the principal variation behind every root candidate, and answered it in
  one run: both the acting and the passing line peak at the same level, so any discount on later
  boards shifts them equally and cannot reorder them. Reach for it before the third hypothesis.

## Tried and rejected

Recorded so nobody spends an evening re-deriving a null result. All measured against the identical
AI with the change switched off, across the coverage decks.

- **A conditional initiative term (`initiativeHorizon`).** Prices holding the initiative when the
  holder is the side facing lethal next round, which is 13.0% of claim offers and zero elsewhere.
  Measured **+1.87 at weight 3 and +1.0 at weight 6**, the two indistinguishable from each other, so
  no reliable gradient, at **65-70% more wall clock** because the predicate calls `reachSteady` and
  `canFinishNow` on the `evaluate` hot path. Stays at 0 with a zero guard, so the shipped bot pays
  nothing.

  The premise survives the result and is worth keeping: the bot's claim rate is **flat across all four
  horizon buckets**, so the blindness is real. Pricing it is what failed. Build the horizon instead.
- **Offensive pinning (#397).** Holding a ready unit that would kill an enemy leader on deployment is
  the one behaviour no depth can reach, since the value is in *not* acting. It is also far too rare to
  measure: **17 decisions in 44 games (0.8%)**, of which the bot spent the pin on 3. Leaders deploy
  around 7-8 HP and most units are power 2-5, so single-unit pins barely exist in this pool. The
  opponent also deploys into a pin 8.1% of the time, so neither side plays around the threat and
  self-play could not reward it even if it were built.
- **Restricting the search tie-break by decision kind.** `kinds:answer|play|resource` measured **+4.25
  against the unrestricted +4.9** on matched seeds, with five of ten shards byte-identical. No
  detectable difference, so the simpler unrestricted form ships. Useful as a diagnostic (it confirms
  the benefit concentrates in those kinds) rather than as a configuration.
- **One ply as the second opinion**, which `planned-work.md` itself recommended for #396 and #398. It
  gets the shielded-Sentinel lockout wrong, preferring passing 52 to 43, where `reply: 'null'`
  separates the same position 56.1 to 52. When the worst case cannot tell two moves apart, the upside
  can.

- **A `shield` term.** The evaluation genuinely cannot see a Shield (printed 0/0, works through a
  prevention hook, so a strip leaves a board scoring identically), and the bot strips one on **7.4%**
  of opportunities against random play's **17.9%**. Making it visible does not win: **50.0% ± 1.3%**
  at weight 3 and **48.2% ± 1.3%** at weight 8 over 5,500 games a cell, with every shard below 50% at
  weight 8. Flat then harmful, so no peak exists above zero. The term stays in the code at 0 because
  it costs nothing measurable and is the only way to re-measure.

  Two lessons worth more than the result. **A flat per-token weight buys indiscriminate strips**,
  when the value is entirely contextual: large when the strip enables a kill this action, nil
  otherwise. Only a contextual version is worth revisiting. And **"worse than random" was an
  overstatement on my part**: random strips by accident rather than correctly, so stripping less often
  than chance is not by itself evidence of an error.
- **A deeper beam.** Depth 4 alongside a pessimistic reply, at a node budget matched so that neither
  cell exhausts, measured **47.6% ± 1.0%** against depth 3 over 9600 games and 10 seeds, with **every
  shard below 50%**. Not a null: depth 4 is about 2.4 points **worse**, and costs 1.48x more per
  decision. An earlier reading of 59.4% against 57.5% was taken without a reply policy and at
  mismatched budgets, and both differences mattered. The depth curve alongside a reply peaks at 3
  (+10.2, then +2.7, then negative), and the likely cause is that pessimism compounds: four
  most-inconvenient opponent replies in succession model a player far stronger than the one being
  faced. **Do not revisit without changing the reply policy**; the natural test is whether `selfish`
  degrades less at depth 4.
- **A wider beam.** Width 8 alongside a pessimistic reply measured **49.5% ± 1.1%** against the
  shipped width 4 over 8400 games and 12 seeds, six shards either side of 50%. Predicted as a null
  beforehand, from the move-disagreement curve: width 8 changes only 2.7% of decisions, and narrowing
  changes more than widening (3.4% at width 2, 6.0% at width 1), which puts width 4 at diminishing
  returns. **Narrowing is not worth testing either**, since width 2 costs 108 ms against width 4's
  110: even an exactly equal result would save 2% of compute. The axis is closed in both directions.
- **Concave resource pool.** Valuing surplus resources below the `card` weight made the bot skip
  12.5% of regroups, all at a pool of exactly the knee. It measured **49.7% ± 1.9%** over 5040 games,
  and worse as the knee lowered (46.1% at 6, 45.6% at 5). The pool ships flat. Worth re-testing after
  role-aware evaluation, since the bot does leave 1 to 2 resources unspent per round late on.
- **Deriving the AI's role per candidate move.** Fixing it from the position being decided in is not
  a detail: 32.5% of decisions have candidates landing in different roles, so per-candidate roles
  compare scores computed with different weight sets. It measured 44.2% at shift 1 down to 26.3% at
  shift 4. The role is now fixed once per decision.
- **Scaling the "I have a play" hand bonus by the card's value.** A bomb's hand value and its board
  value are the same order of magnitude, so the bot refused to play its own bombs. **40.5%**. The
  bonus is flat.
- **Pricing Advantage as the one-off it is.** The premise is correct: the token lasts only until its
  unit next completes an attack or defence and the whole stack goes at once, so printed power is a
  recurring stream and a token is a single payment. Prevalence cleared the gate at **20.7%** of
  decisions against Shield's 15.8%.

  Two shapes, both shipping as no-ops and swept downward. Flat (`advantage`) measured 47.5% at weight
  1 and 42.5% at 0 against a 47.5% control. A readiness split (`advantageExhausted`, discounting only
  carriers that cannot spend the token this round) measured 52.5% at weight 1, which did not survive
  contact with a real sample: **49.6% +/- 2.3% over 1,800 games**.

  **Why it fails despite the premise:** 76% of tokens are eventually spent, so they do deliver their
  point of power. The honest discount is therefore small, a small discount changes about 1% of
  decisions and measures nothing, and a large one measurably hurts.

  Both weights stay at their no-op defaults, **guarded on the hot path**: counting tokens on every
  evaluation measured around 1% per decision for a correction that is provably zero at those weights.

  Two lessons. The ticket predicted that spending on **defence** was the worst case; it is 4.6%, while
  tokens that are **never used at all** are 23.5%. And a promising screen result is not a result: the
  52.5% arm and a flat arm that landed exactly on the control each changed **8 of 600 decisions**, so
  equal causes gave opposite effects.
- **An UNGATED `blockedReach` term.** Pricing the reach denied by *any* Sentinel measured **25.0%**
  (CI 15.7-34.3) against the shipped bot at weight 12, over 80 games with a self-play control on
  exactly 50.0%. Adding a tie-break did not rescue it (26.3%).

  Two independent reasons, both checkable in seconds and neither checked at the time. **The weight was
  out of scale:** every other weight is 1 to 7, so 12 is triple a whole unit, and with
  `blockedReachCap: 10` the term reaches 120 points where a unit is worth 4. **And the quantity was
  far commoner than the defect:** it keyed on `sentinelLocked`, true for any Sentinel, so it was live
  on **24.2%** of decisions against a 2.1% lockout, at a mean quantity of 6.6. A scripted position was
  allowed to name the weight, and nobody asked how often the term would fire.

  Read a new term against the model's scale and against how often it is live, not only against the
  position that motivated it.
- **A GATED `blockedReach` term, at the weight that works.** Gating to **shielded** blockers is the
  right narrowing (an unshielded Sentinel is answerable by attacking it, and the material terms
  already price that), and it removed the catastrophic loss: 25.0% became 48.8% at 80 games. The term
  changes real decisions rather than being inert, and on the filed report it lifts the strip rate from
  **1 of 18 to 10 of 18**.

  It still does not ship. `beam-reply+blockedReach=3` measured **49.6% +/- 1.0% (48.6% - 50.6%)** over
  9,600 games and 10 seeds, no games dropped, against a pre-registered rule requiring a lower bound at
  or above 49.0%. Inconclusive: consistent with neutral and equally consistent with a 1.4-point cost,
  with 6 of 10 shards below 50%. **The term stays at 0.**

  Weight 3 is the efficient point and was chosen by mechanism, not by win rate: the strip rate on the
  filed report plateaus there (10 of 18, the same as weight 12) while disturbance keeps climbing (1.5%
  of decisions at weight 1, 5.5% at weight 12). Do not sweep weights on win rate to refine this; the
  differences are far below what 9,600 games can resolve.

  Two fixture artefacts to distrust if this is revisited. The scripted lockout in `aiTieBreak.test.ts`
  turns into a **tie** at any non-zero weight and needs the tie-break to convert it; the real boards
  are an 11-point deficit that the term tips **on its own**, and there the tie-break scores one strip
  *fewer* at every weight. A scripted position told us the weight (12) and the mechanism (tie-break),
  and was wrong about both.
