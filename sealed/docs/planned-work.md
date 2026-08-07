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
the shipped search, after #447 settles the configuration. The measured constraints live in
[ai-model.md](ai-model.md); the tool is `npm run tune`.

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
opponent to cooperate. **The curve is still climbing at depth 3**, which is now #447's question.

`min(evaluate(s, me))` leads `argmax(evaluate(s, foe))` by about a point at both depths, not separably
at this width.

### Some of what the model knows may be standing in for search

`lethalExposure` is a static proxy for "they can kill me next action"; `role` is a static proxy for
trajectory. A deeper search computes both directly, so their measured value should **shrink** as depth
rises, and once #425 models the reply, `lethalExposure` risks double-counting outright.

That decides what transfers between search configurations. Changes that add **information the search
cannot get** carry over; changes that **proxy for search** do not. `--terms` is the instrument: watch
the Bearing column for those two terms as depth rises. It is recorded on #447 so it can be judged
rather than argued.

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

1. **#447 the search configuration**, brought forward, and now with a specific question rather than a
   sweep. `beam-reply` ships at depth 3 and **the depth curve was still climbing** (54.5, 64.7, 67.4
   against a reply-blind beam). Width is the other axis and has never been swept alongside a reply.

   The instrumentation for it is built, and it moved the numbers this ticket has to plan around.
   **Depth 4 with a reply costs 1495 ms a decision, not the ~180 ms estimated from a wall clock**:
   802x greedy, against `beam-reply`'s 70x. A/B sizing has to start from that.

   Two things are now known that were assumptions. **Alpha-beta is not the lever.** It is sound at the
   deepest level of the beam as well as at depth 1, and measured there it saves 10.8% of nodes at the
   shipped configuration and **nothing at all at depth 4**, so it does not make a deeper cell
   affordable. And **the node rail is not quietly setting the width and depth**: it fires on 4.0% of
   decisions for `beam` and 8.5% for `beam-reply`. A raised-budget control cell is still worth
   carrying, but the earlier depth-4 result is much less confounded by the rail than it looked.

   What the rail measurement did turn up is **#488**: the search shares one budget between resolving
   owed choices and expanding the beam, and **the chain takes 80% to 98% of it**. Raising the budget
   twentyfold moves the beam's own spend from 128 nodes to 135 while the chain's goes from 510 to
   6885, so a raised rail costs ten times as much and buys no search at all. Where the rail fires it
   is starving the lookahead at exactly the complicated positions.

   **Sizing, and why the two remaining axes are not the same experiment.** A game runs ~96 decisions a
   side (derived from #410's 840 games in 5055s at known per-decision costs), so an A/B costs
   `games × 96 × (costA + costB)`. To ±1%, roughly 9600 games:

   Sizing is now **anchored on a real sharded run** rather than on core-hours, because core-hours
   mislead here: `nproc` reports 16 but the machine is **8 physical cores with hyperthreading**, and
   12 shards on 8 cores run at roughly two thirds speed each. A predicted 5.4 hours took **8.8**.

   The anchor: **9600 games of a 0.252 s-per-decision matchup took 8.8 wall hours at 12 shards.**
   Scale by the combined per-decision cost of whatever is being compared.

   | experiment | combined cost/decision | wall hours to ±1% |
   | --- | --- | --- |
   | width 8 vs width 4 | 0.225 s | **~8** |
   | depth 4 vs depth 3 | 1.621 s | **~56** |

   Width is an overnight run. Depth is two and a half days, or 14 hours if ±2% will do, which is
   marginal against an effect that looked like +2 points. Still local work; still not worth building
   cloud infrastructure for.
2. **#487 re-tune the weights for the shipped search**, after #447 and not before. See above: the
   "re-weighting is exhausted" result measured a one-ply evaluator, and #430 identified exactly why
   several weights could not matter there. This is the largest unexamined lever, and it is expensive,
   so size it with `--cost` before sweeping anything.
3. **Re-run `--terms`**, with two caveats discovered since it was scheduled. The instrument picks
   moves with a **one-ply** scorer, so it currently reports term sensitivity for a bot we no longer
   ship; testing #430's pre-registered prediction needs the perturbations driven through the real
   search. That also makes it roughly 70x more expensive, so scope it to the weights the prediction
   names. The payoff grew: `lethalExposure` and `role` are proxies for search, and a reply policy
   computes the first directly, so this is now a route to **deleting** model complexity.
4. **#446 claim the initiative when it converts to lethal**, and **measure its headroom first**. #433
   sized lethal detection at +0.8 against a bot that has since improved by 17 points, so the rate that
   justified this has probably shrunk. An hour of measurement could retire the ticket.

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

## Tried and rejected

Recorded so nobody spends an evening re-deriving a null result. All measured against the identical
AI with the change switched off, across the coverage decks.

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
