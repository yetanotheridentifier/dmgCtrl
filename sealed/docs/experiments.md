# Experiments

**What has been measured, and what it rules out.** Read this before proposing a change to the AI: most
of the obvious ideas have been tried, and the ones that failed cost days of compute to establish.

Nothing here is a plan. [planned-work.md](planned-work.md) holds what is next. Nothing here describes
current behaviour either: [ai-model.md](ai-model.md) owns what the model does now, and where a
measurement explains a shipped value it is recorded there as a property. This file is the **evidence**,
including the evidence for avenues that are closed.

## How to measure a change

Rules learned the hard way, each of them from getting it wrong first.

- **Read an arm against its matched control, never a theoretical baseline.** Identical bots measure
  **48.70%** over the coverage decks, not 50%, and the generalisation harness reads **50.4%** on the
  same decks. The baseline is a property of the harness. The same 2,040 games read +1.1 and not
  significant against 50, and **+2.35 at p < 0.001** against a control on the same seeds: one arm, one
  dataset, opposite conclusions. Pairing also removes deck variance, which dominates the coverage pool.
- **A result that shrinks as the sample grows was never there at full size.** One arm measured 55.0% at
  80 games, 53.5% at 800 and 51.1% at 2,040. Agreement between a small screen and a larger run is not
  replication when the screen's interval is wide enough to contain almost anything.
- **Run the cheap instrument before the expensive experiment.** Term sensitivity costs an hour and cut
  a twelve-arm weight sweep to one arm by showing three of four candidate weights had not moved. The
  sweep it replaced spent 400,000 games to conclude nothing.
- **Default a new weight to off, then sweep upward.** Shipping the default before the A/B ran once
  inverted a whole reading, because the candidate was then the ablation and below 50% meant better.
- **Screen at ~80 games before booking a long run**, with a matched control. It is a disaster filter,
  never evidence of parity.
- **Measure a lethal or a threat as a single action.** Players alternate actions, so aggregate reach
  across ready units is an intention the opponent gets several chances to answer, not a kill. Reading
  it as aggregate overstated lethal threefold.
- **A corpus is filled game by game, so a short one is all openings.** A search costing 142.6 ms
  measured 5.8 ms at 30 states; a width whose real effect is 2.7% of decisions measured 0.5% at 200.
  Use 1000 states for a rate, 200 for a cost, and never compare two numbers taken at different depths.
- **A cost ratio does not tell you what is consuming the budget.** Raising the node rail made a search
  ten times slower, which read as the rail truncating nearly every decision. It truncates 4%. The
  difference was a heavy tail, and only a counter could tell them apart.
- **Self-play cannot measure a strategy neither side plays.** A shielded Sentinel shutting a lane is
  something a human builds on purpose; it appears in **0.5%** of bench decisions and never lasts a
  round, while play-testers hit it constantly. Defects of that shape need a **scripted position** as
  the acceptance criterion and an A/B gated on **non-inferiority**.
- **Measure the complaint, not a proxy for it.** "A shield is present" (15.8% of decisions) is not "a
  lane is shut" (0.5%), and board-wide is not per-arena. A precise measurement of the wrong quantity
  reads as a null and retires a real defect.
- **Prevalence justifies an attempt; it does not predict the outcome.** Shields appear in 15.8% of
  decisions and the term still measured neutral-to-harmful.
- **Influence is not incorrectness.** A weight can change many decisions and already sit at its
  optimum. Conflating the two is what motivated a sweep that found nothing.
- **Diagnose before fixing, and build the instrument if the diagnosis will not come.** Four
  consecutive explanations for one defect were wrong, each argued from the code rather than measured.
  A principal-variation readout settled it in a single run.

### Sizing a run

Size from a measured run, never from per-decision costs or core-hours: both understate, independently.
`nproc` reports 16 but the machine is 8 physical cores with hyperthreading, so twelve shards give about
**7.3x**, not 12. Memory binds before cores do, at roughly 365 MB a searching shard.

| measured run | mode | games | shards | per game |
| --- | --- | --- | --- | --- |
| `beam-reply` vs `beam-reply-shared` | A/B | 9600 | 12 | 39.6 s |
| `beam-reply` self-play | A/B | 2040 | 12 | 53.9 s |
| `greedy` matrix | matrix | 2628 | 1 | 0.164 s |
| `beam-reply` | `--decisions` | 420 | 1 | 15.0 s |

An anchor only transfers to a run of the same shape: sizing the decision diagnostic from the A/B
anchors overestimated it threefold, because they play different decks and average a different number of
decisions a game.

## What the measurements settled

### The search configuration

**Width 4, depth 3, pessimistic reply.** One move of looking at the opponent beats three moves of
looking at yourself: a reply alone beats a reply-blind beam by 4.5 points. Stacking them was expected
to be fraught, since one policy is optimistic and the other pessimistic, and they are strongly
super-additive.

| Against a reply-blind beam | Mean over 2580 games |
| --- | --- |
| reply only | 54.5% |
| reply + depth 2 | 64.7% |
| **reply + depth 3, shipped** | **67.4%** |

Depth without a reply is worth +10; depth on top of a reply is worth +12.9, because a reply at every
level makes the search proper minimax and depth compounds rather than extending lines that need the
opponent to cooperate.

**The curve peaks there.** Depth 4 at matched budgets measured 47.6% ± 1.0% over 9600 games with every
shard below 50%, so the gains run +10.2, +2.7, then negative. Width is flat over the same range.
Minimising our own score leads maximising theirs by about a point, not separably at this width.

### Re-weighting is exhausted, at one ply and under search

A 146-cell interaction grid plus 8400-game validation, roughly 400,000 games, put the weight set at a
local optimum. That measured a **one-ply evaluator**, and the optimum for a leaf function is not
necessarily the optimum for a bot that plays its own scores directly, so it was retested against the
shipped search.

It holds. Of four weights predicted to become influential once lookahead landed, **one did**: the role
shift, pivotal on 12.1% of decisions against 7.7% one ply deep. Swept around its shipped value at 480
games an arm, every arm came back inside noise (largest t = 0.72 against 2.228), confirming the
plateau the original sweep found.

Two weights could not be judged at the time, because both price things that pay off across the round
boundary the search could not cross. They have since been told apart by running the same instrument
through a search that can cross it: `resourceSurplus` is alive and only at regroup, `hand.canAct` is
inert. See "Dormant and dead, told apart at last" below. Notably the one weight that woke here is the
only one of the four whose value concerns the **current** board.

A third is **provably inert**: the resource pool is priced flat, so the knee that splits it collapses
out of the arithmetic and cannot change any answer whatever it is set to.

### Splitting power by readiness is the most pivotal quantity in the model

The weight set is at a local optimum, but that is a statement about **re-pricing quantities the model
already has**. Splitting one into two is a different move, and the readiness split is the clearest
case of it available.

Power is charged per point whether or not the unit can act. Readiness is priced, but only by
`readyUnit`, a **flat per-body** term that cannot express that holding nine points of unspent power
is worth more than holding two. `powerReady` splits the rate instead, and ships equal to `power` so
it is a provable no-op until swept.

Term sensitivity over 9,317 decisions puts it **first in the model by pivotal rate**:

| weight | varies | pivotal | bearing |
| --- | --- | --- | --- |
| `powerReady` | 57.4% | **9.5%** | 13.4% |
| `base` | 41.9% | 9.2% | 21.6% |
| `power` | 64.2% | 9.0% | 15.8% |
| `readyUnit` | 51.9% | 2.2% | 2.9% |
| `claimCost` | 42.3% | 0.5% | 1.6% |

A nudge changes the chosen move on 9.5% of decisions, above `power` and `base` themselves, while the
flat version of the same idea sits near the bottom at 2.2%. So readiness is worth pricing and the
existing term is the wrong shape for it, which is a different claim from "the weights are mistuned".

**Two caveats that the number cannot carry.** `--terms` runs the **one-ply** scorer, not the shipped
beam, so this sizes the evaluation rather than the bot; a deeper search sees more and may be less
sensitive. And `powerReady` overlaps `readyUnit` by construction, so sweeping one while the other is
live attributes shared effect to whichever moved.

**Pivotal is not positive.** It says the quantity can change the pick, which is what justifies a
sweep, not that changing it wins. Shields appear in 15.8% of decisions and still measured
neutral-to-harmful.

Screened at `powerReady: 6` against a matched control on eight seeds, 96 games: **+3.12 points**
(sd 14.73, t = 0.60 on 7 df, not significant, 0 games dropped). That is a disaster filter and it
found no disaster. It is not evidence of a gain, and the point estimate rests on three shards against
three, so treat it as an overestimate until a full-size run says otherwise.

### The hidden information is small, and what matters is public

A one-action lethal is available to the opponent in **2.2%** of decisions and is **absent before round
5** (twice in 60,749 decisions across rounds 1 to 4). Of the positions where they could finish, **86%
are unavoidable**: every legal move leads there and no policy recovers them.

All of that was measured from **public** information, so the headroom belongs to evaluation and search
rather than to a belief model.

### A real lethal solver is worth very little

A one-ply lethal check reads only damage already on the board, so an event finisher, a pump or a
when-played base hit is invisible to it. A full solver that sees the hand, the leader and
Sentinel-clearing lines closes that gap, and the shipped beam already finds **5.8 of the 6.6 points**
of lethal that exists. Wired in as an override it measured **+0.8 points** over three seeds and 2580
games: same sign every time, indistinguishable from neutral, not shipped.

**That +0.8 is a lower bound, not a value.** The arm ran with its node budget binding, so it was a
solver that abandoned most of its searches part way through rather than the one the design specifies.
See the sizing below for how far short the budget falls.

### The lethal solver's node budget is what binds, not its depth

The solver takes a depth and a node budget, and the budget is described as a safety rail. It does not
behave as one: at the budgets in use it fires on nearly every call, so a figure recorded against a
solver depth describes where the budget cut rather than the depth its name advertises.

Two readings agree on where a budget stops binding, and **cost is the sharper of the two**. The count
of lethal positions found stops rising, and so does the wall clock per call. A search that terminates
on its own cannot spend a budget it is given, so a cell whose cost is still climbing is still
truncating, while a flat count can also just mean there was nothing more to find.

Over a fixed 142-decision corpus (2 coverage decks, one game each), as lethal positions found and
milliseconds per solver call:

| solver depth | 4,000 | 40,000 | 200,000 | 1,000,000 | budget needed |
| --- | --- | --- | --- | --- | --- |
| 2 | 12 / 13 ms | 14 / 20 ms | 14 / 20 ms | 14 / 21 ms | ~40,000 |
| 3 | 10 / 29 ms | 15 / 93 ms | 16 / 104 ms | 16 / 103 ms | ~200,000 |
| 4 | 11 / 31 ms | 13 / 151 ms | 16 / 361 ms | 16 / 397 ms | ~200,000 |
| 5 | 11 / 29 ms | 13 / 170 ms | 15 / 473 ms | 16 / 1,078 ms | over 1,000,000 |
| 6 | 10 / 27 ms | 13 / 164 ms | 15 / 475 ms | 16 / 1,181 ms | over 1,000,000 |

**The requirement grows faster than linearly**, so a budget scaled as `depth * 4000` is the wrong
shape as well as the wrong size: depth 2 needs five times that expression and depth 5 more than
thirty times it.

**The monotonicity invariant holds only once the budget is lifted.** At 4,000 nodes depth 4 finds
fewer lethal positions than depth 2 (11 against 12), and at 40,000 it still does (13 against 14),
which depth alone cannot produce.

**Read that table for the budget column only.** It is a 142-decision corpus and it misleads about
everything else: it holds sixteen lethal positions, every depth from 3 up finds all sixteen, and the
beam independently finds all sixteen too, so `beam missed` is zero in all twenty cells. A corpus that
small is mostly openings, which is the same distortion `--cost` carries, and it under-reads the cost
per call by three to four times.

### What a solver that finishes actually buys

Over the full coverage corpus (42 decks, one game each, 3,119 decisions, identical in every cell,
with the beam arm fixed at `DEFAULT_BEAM_LIMITS` so only the solver varies):

| solver depth / nodes | lethal found | beam missed | ms per call |
| --- | --- | --- | --- |
| 4 / 4,000 | 192 | 20 | 39 ms |
| 2 / 40,000 | 161 | 1 | 62 ms |
| 3 / 200,000 | 194 | 11 | 444 ms |
| 4 / 200,000 | 212 | 25 | ~780 ms |

**`beam missed` is a property of depth, not of budget.** The beam searches three actions, so a solver
at depth 2 or 3 is looking at a horizon the beam already covers and finds almost nothing it misses:
one position at depth 2, eleven at depth 3, against twenty-five at depth 4. Headroom lives entirely
in lines longer than the beam can reach.

**Lifting the rail costs 20x and buys a quarter more headroom.** At depth 4, going from 4,000 nodes
to 200,000 moves `beam missed` from 20 to 25 of 3,119 decisions, 0.6% to 0.8%, for 39 ms to about
780 ms a call. Four runs of that same cell measured 755, 772, 772 and 798 ms, so per-call cost
carries roughly 5% run-to-run variance and is not worth quoting to three figures. That is the price of the override the design specifies, against the one that was measured.

**Whether 200,000 is enough at this corpus size is not established.** The budget column above was
sized on the 142-decision corpus, which under-reads cost several-fold, so the point where cost stops
climbing may sit higher here. Nothing above depends on it: 200,000 is a lower bound on the budget a
depth-4 solver wants, and the cost of that solver is therefore also a lower bound.

**A funded solver is close to inert at game level.** Screened at 80 games against a matched `beam`
control on the same eight seeds, `beam-lethal:4x3:4:200000` measures a paired difference of **-1.25
points** (sd 6.41, t = -0.55 on 7 df, 1 of 8 shards favouring the arm). Eighty games is a disaster
filter and cannot establish parity, so the number to read is not the -1.25: it is that **five of the
eight shards measured a difference of exactly zero**, meaning the arm and the control played
identical games. An override that fires on 0.8% of decisions mostly does not reach the result, which
is the same fact the decision-level slice states, confirmed at the level that pays for it.

### The lethal gate's cheap saving is the power bound, not a later round

Every gate is a way of not finding a line, so each is scored against a solver running **ungated** on
the same corpus: `skipped` is the compute saved, and `COST A WIN` counts positions the gate declines
where a line existed **and the beam also misses it**. Only that last number is a loss, and a variant
is usable only at zero.

Full coverage corpus, 3,119 decisions, solver at depth 4 and 200,000 nodes:

| gate | skipped | had lethal | cost a win |
| --- | --- | --- | --- |
| shipped: round 4+, skip single-action | 40.8% (1,273) | 51 | 0 |
| round 5+ | 62.8% (1,960) | 59 | 3 |
| round 6+ | 82.0% (2,559) | 136 | 12 |
| power bound on | 61.8% (1,928) | 51 | **0** |
| power bound on, round 5+ | 72.6% (2,265) | 59 | 3 |
| single-action check off | 39.2% (1,222) | 0 | 0 |

**Round 4 cannot be skipped.** It carries 688 decisions and 9 lethal positions, 3 of which the beam
misses, so a `minRound: 5` floor throws away 3 of the 25 positions that are the feature's entire
headroom. Rounds 5 and 6 are where lethal concentrates, but the tail into round 4 is not empty and it
is disproportionately the part worth having.

**The power bound costs nothing here and saves a third of the calls.** It skips 655 decisions beyond
the shipped gate and **not one of them held a line**: `had lethal` is 51 either way. Solver calls fall
from 59.2% of decisions to 38.2%.

That is a measurement on this card pool rather than a proof. The bound sums printed power, so an
event that deals damage with none is invisible to it, and the reason it measures safe is that a kill
carried entirely by events does not occur in this corpus. A set with stronger burn would need this
re-run before the gate could be trusted, and the failure would be silent.

**`skipWhenSingleAction` is nearly inert**, worth 51 decisions of skipping in 3,119. It accounts for
every one of the shipped gate's lethal skips, all safe because a single-action win is one the
evaluation cannot get wrong.

### A lossy gate on ready damage skips 77% of decisions for nothing

Every gate above is admissible: it sums generously so it can never skip a real line, and that safety
is exactly why each saves so little. The alternative is to start from what can actually attack now,
ready units plus the leader (which deploys ready), and allow a fixed number of points for what might
materialise from a pump, an upgrade or a burn event. That is deliberately lossy, so the allowance is
a measurement rather than a judgement.

Same corpus, 3,119 decisions:

| gate | skipped | had lethal | cost a win |
| --- | --- | --- | --- |
`time left` is the share of solver work surviving the gate, which is the only column a cost decision
rests on. Every other column counts decisions.

| gate | skipped | cost a win | time left |
| --- | --- | --- | --- |
| ready damage + 0 | 95.0% | 15 | 14.0% |
| ready damage + 3 | 90.1% | 4 | 22.5% |
| ready damage + 5 | 85.5% | 3 | 32.7% |
| ready damage + 7 | 80.5% | 3 | 50.1% |
| ready damage + 8 | 76.9% | **0** | 55.9% |
| ready damage + 10 | 71.8% | 0 | 69.8% |
| ready damage + 12 | 65.6% | 0 | 81.1% |

The quantity must be **power, not reach**. `unitReach` reads a Sentinel-locked unit as zero, so a
reach-based gate would skip the positions where the solver's job is to clear the blocker or grant
Saboteur so that ready power reaches the base.

**Eight is the first safe value, not a comfortable one.** Seven still costs 3, and the zero at eight
is measured against 25 headroom positions in total. Ten and twelve buy margin at a third and a half
of the saving.

### Counting skipped decisions overstates every gate's saving

The same run, read as time rather than decisions, says the gates were never doing what their skip
rates suggest:

| gate | skipped | time left |
| --- | --- | --- |
| shipped: round 4+, skip single-action | 40.8% | **97.2%** |
| single-action check off | 39.2% | 97.2% |
| power bound on | 61.8% | 64.0% |
| ready damage + 8 | 76.9% | 55.9% |

**The shipped gate declines 40.8% of decisions and saves 2.8% of the time**, because the positions it
skips are the cheap ones. `skipWhenSingleAction` saves nothing measurable at all. The best safe
variant found, a lossy ready-damage gate at slack 8, is worth **1.79x** rather than the 2.6x to 4.8x
that extrapolating from per-class node means predicted.

**The cost lives where the feature does.** Solver time concentrates in the complex late-game boards
where lethal is plausible, and those are exactly the positions no gate can decline without losing
lines. The evidence is how tight the boundary is: slack 7 leaves 50.1% of the work and costs 3
winnable positions, slack 8 leaves 55.9% and costs none. There is no large safe saving left on this
axis.

### A second opinion on a tie is worth +2.35 points

When the pessimistic search rates several candidates equal, re-searching only those under an optimistic
reply and taking whichever now leads is worth **+2.35 points** (t = 4.94 on 11 df, p < 0.001, 11 of 12
shards positive, 2,040 games against a matched control) for **+2.1%** per decision.

**It is the only intervention in this whole sequence that measured positive**, and it is a *search*
change rather than an evaluation one. It also fixes no specific reported defect: the aggregate is its
whole case.

One ply is **not** the right second opinion, which was the original proposal. It gets the
shielded-Sentinel lockout wrong, preferring passing, where an optimistic reply separates the same
position correctly. When the worst case cannot tell two moves apart, the upside can.

It **resolves far less than its name suggests**, which is worth knowing before building anything on top
of it: 86.4% of the ties handed to it are still level afterwards, narrowed from an average 3.2
candidates to 2.4. The +2.35 stands, because resolving 13.6% of a 38% tie rate still moves about 5% of
decisions.

### Charging for doing nothing is worth +2.43 points

The bot made **2.7 discretionary mid-round passes a game**, against roughly 0.15 for a competent
player: passing while play continued, handing the opponent that many free turns. Charging `pass` 8
evaluation points at the root brings it to 0.21 and measures **+2.43 points** (t = 3.19 on 11 df, 10 of
12 shards positive, 2016 games against a matched control).

**It was built to fix a behaviour, not to win games**, and the bar set beforehand was non-inferiority:
self-play cannot normally see a habit both sides share, so a flat result was the expected outcome of a
success. It measured positive instead, which the mechanism explains without strain, since the opponent
was being handed 2.7 turns a game for nothing.

The charge cannot be an evaluation weight. `evaluate` prices boards, and passing barely changes the
board, which is the whole defect. It belongs on the candidate, in the search, where moves are compared.

The response curve, in mid-round passes a game: **2.71 at 0, 0.67 at 4, 0.36 at 6, 0.21 at 8, 0.10 at
12, 0.02 at 16 and above.** 8 is the smallest value inside the target band rather than the best value
found; whether 12 wins more is unmeasured.

**Overcharging is the failure mode to watch**, since a bot that must not pass will play a card for no
benefit instead, which is worse than the habit being fixed. Forced passes are the tripwire, because
burning a hand means running out of legal moves sooner, and they move only from 223 to 232 across the
whole range. It did not appear at any value tested.

Two measurement notes that cost time to learn. Every round ends with a pass by construction, so a raw
pass count is dominated by structure at ~5.3 forced passes a game: **the defect is only visible once
mid-round passes are separated out**. And ending a round is not the defensible pass, because claiming
makes you done for the round rather than passing out of it, so the only pass that ends a spent round is
the forced one.

### The pass charge is right at 8

`pass=12` against the shipped `pass=8` measured **+0.55 points** (t = 1.37 on 11 df, 6 of 12 shards
favouring, sd 1.38, 2016 games against a matched control). The interval runs about -0.3 to +1.4, so a
larger charge is not established as better and cannot be much better if it is.

8 stays for a second reason beyond the number: it is the smaller charge, so it applies less pressure
toward the failure mode the whole design is bounded against, playing a card for no benefit rather than
passing. The response curve is in the entry above.

### Charging more for a claim is the wrong direction

Taking the initiative forfeits the rest of your actions this round. `claimCost` prices that by
counting **ready units** forfeited and nothing for the cards a claim stops you playing, so claiming
while holding an affordable body is free. That looks like an under-charge worth fixing. It is not,
for two reasons that point the same way.

**The axis is saturated.** A 146-cell grid swept `initiative` against `claimCost`, and the chosen
cell was confirmed at +0.62% across six paired seeds and 100,800 games. Whatever is left on this axis
is smaller than that.

**The residual points the other way.** Removing the charge entirely, `claimCost: 0` against the
shipped bot on matched seeds, measured **+2.50 points** (sd 14.88, t = 0.48 on 7 df, not significant,
80 games). That is a disaster filter rather than a result and it establishes nothing on its own, but
it found no disaster and its sign says the existing charge is if anything already too high. It
matches the note recorded on the weight itself, that `claimCost: 0` measured 50.6% against 50.7% at
`initiative: 1`.

Adding a second charge to an axis that is already saturated, and whose residual sign is negative, is
not worth the compute it would take to resolve.

**The reason a claim can be right while holding cards is real, and already priced.** Everything
readies at the regroup phase, and the shipped search never crosses that boundary, so both halves of
the trade are invisible to it. `initiativeHorizon` is exactly that term, for the case where the
holder is the side facing lethal next round. It measured +1.87 at one weight and **ships at 0**.

### A tied initiative is worth nothing either way

`beam-claim-ties` (always take a tied initiative) against `beam-hold-ties` (never take one) measured
**+0.00 points** (sd 0.84, se 0.24 over 12 shards, 5 of 12 favouring, 2016 games). The spread is
non-zero, so the arms genuinely diverge; the per-shard differences scatter both ways and cancel.

So the seeded coin flip that ships is the right answer, to within about half a point. **Reading both
extremes is what makes that legible**: a single arm against the flip cannot separate "balanced" from
"underpowered to detect", and at 80 games those same arms read +1.25 and +0.00, which settles nothing.

It does **not** rule out a conditional policy. A zero gap between two blanket arms is also what you
would see if taking were right half the time and wrong the other half, which the split of tying
candidates hints at: attack 46%, pass 38%. The ceiling is low enough not to chase it, since on the
corrected metric the tie is **2.0% of claim offers** (2.0 / 2.1 / 2.1 over three seeds), the lowest
tie rate of the five decision kinds.

### A class of upgrades is invisible to a board evaluation

Some upgrades do nothing when played and everything later: -3 power while attacking a base, doubled
incoming damage, a burn when the attack ends, a tax on every ready. **The evaluation prices boards, so
it cannot tell a friendly target from an enemy one**, and the seeded pick decides.

It only bites when nothing can act inside the horizon. Where the host or the enemy target can attack,
the search plays it out, the engine applies the effect, and it chooses correctly: **5 of 5 over 126
games**, and 4 against 16 on a scripted board. Where nothing can act, every target scores the same.
"The search is blind to this" and "the search returned a tie" are therefore the same set of positions,
which is why a **tie-only** rule covers the whole defect and can never overrule a real judgement.

Two signals, in order, because neither alone is sufficient across the ASH pool:

- **The computed delta first**, comparing the host's power, HP and keywords with and without the
  upgrade in the contexts where conditional effects apply. Catches the stat penalty and the damage
  multiplier.
- **The CONDITION trait only when the delta is silent.** Two of the five work through granted triggered
  abilities, which cannot be priced without simulating them.

**Keywords must never offset a stat loss.** Nowhere to Hide grants Sentinel and takes 2 power, and it
is a card you give the opponent; an early version counted the grant against the loss and read it as a
buff. Keywords now only rule out the trait fallback.

Hostility is measured against the **specific host**, which makes two things fall out rather than needing
special cases: the card is worth more against a unit that already has Sentinel and gains nothing, and a
-2 modifier on a 1-power unit costs 1 rather than 2, because power floors at zero.

Screened at 80 games against a matched control: **sd 0.00, no game diverged**. That is the expected
result for a rule this narrow, not evidence either way, and it is why the acceptance was the replayed
position rather than a win rate.

### Searching past the round boundary works, and loses

A line can be made to cross regroup and play on into the next round. Built, measured, **not shipped**:
**-3.72 points** (t = -1.95 on 11 df, 3 of 12 shards positive, 2016 games against a matched control) at
**1.84x** the per-decision cost.

The interesting part is that the mechanism did what it was designed to do. The claim rate went from
discriminating weakly across the horizon buckets to discriminating strongly, χ² 9.47 to 34.5 against a
7.815 critical value, concentrated in the case where claiming means acting first into our own win
(17.8% to 28.9%). **The bot judges the claim decision better and plays worse overall.**

Two candidate explanations were open: the modelled opponent tail may be dead weight (it is most of the
cost, and the free run changes nothing measurable in 79% of claims), or crossing may make **passing**
more attractive, since a line that ends the phase now lands on a regroup where both sides ready
everything and bank a resource.

**It is the second, and the tail is not required for it.** A crossing-only arm
(`beam-reply/horizon=cross:1,tail:0`) against the shipped bot, `--decisions`, 44 games on the same
seeds and the coverage decks:

| | `cross:0` | `cross:1,tail:0` |
| --- | --- | --- |
| chosen passes a game | 0.75 | **1.11** |
| passed when it had a choice | 1.6% | **2.6%** |
| of those, **ending the action phase** | **0.0%** | **53.1%** |
| of those, worse than claiming | 0 | 3 |

The crossing invents a behaviour the shipped bot does not have: **it ends rounds early.** Over half of
its chosen passes end the action phase, against none at all without the crossing, which is exactly the
mechanism the horizon result predicted. The search can now see the fresh round on the far side of
regroup and takes the max over it, so stopping the current round early scores well.

Mid-round passes actually **fall** (0.75 to 0.52), so a raw pass rate reads this as an improvement. It
is not one.

**The root pass charge does not prevent it**, which retires the hypothesis that the -3.72 would read
differently now that the charge ships: the charge is applied at the root while the attraction lies in
the max over post-regroup boards. Three of the crossing arm's passes are *worse than claiming*, where
the two moves end the phase identically except that claiming also takes the initiative: the same
board, one strictly better move, and the shipped bot does this zero times.

So a crossing-only arm is **not** "both cheaper and better". It is cheaper and carries its own
passivity defect, and sweeping `tailActions` beneath it would be tuning the half that is not the
problem.

### The horizon does not touch the shielded-Sentinel lockout

The question the horizon was built for, asked on the two scripted positions rather than on a win rate,
because a lane genuinely shut is 0.5% of coverage decisions. **It changes nothing, and not by a
little.**

| | shipped | with the horizon | with `blockedReach` at 3 |
| --- | --- | --- | --- |
| gap, passing minus stripping (scripted board) | 10 | **10** | 0 |
| strips, of 18 locked boards from a filed game | 1 | **1** | 10 |

Zero movement rather than insufficient movement, so no heavier configuration completes it. The reason
was already proven and is a property of the **search** rather than of the depth: the passing line and
the stripping line reach the **same end board at the same level**, differing only in the route, and a
value that is a max over reachable boards discards the route. Giving such a search more boards to
reach cannot separate two candidates that already converge.

The root pass charge is spending its full 8 points on that position and still loses: the raw gap is
**18**, and 10 after the charge. Real work in the right direction, less than half of what is needed,
and not raisable, since it applies to every pass in the game and is already sized to about a competent
player's rate.

**This closes the horizon as an answer to the lockout**, which was the last live alternative to pricing
it in the evaluation.

### Concavity on the hand works where concavity on the pool did not, but only as a conjunction

Three experiments put a knee on the resource pool and each lost, monotonically in how hard the knee
bit. Moving the same curve onto the HAND reproduces that result exactly when it is charged on hand size
alone, and reverses it when it is conditioned on the pool as well.

Charged on hand size alone, over 504 games a cell against a matched control:

| | knee 2 | knee 3 | knee 4 |
| --- | --- | --- | --- |
| `cardScarcity` 3 | +0.40 | **-3.52** (2016 games) | **-20.04** |
| `cardScarcity` 4 | -0.40 | **-4.37** | **-18.85** |
| `cardScarcity` 6 | -0.40 | **-4.56** | **-17.06** |

Monotone in the knee and flat in the magnitude, which is what a binary decision looks like once its
sign has flipped. A knee of 2 is a no-op by construction: above a hand of 2 the quantity is constant
and cancels.

**The cost is early skipping, not hoarding.** A scripted position isolates it: with a deployed leader,
a pool of 2 and three cards it cannot afford, the hand-size rule declines the resource, which is
precisely when a resource is worth most. Conditioning the bonus on the pool having reached the knee
removes every skip before round six and turns -3.52 into **+0.77** over 4032 games, 95% interval
[+0.20, +1.34], across two seed blocks reading +0.94 and +0.59. That is the cell the model carries.

The conjunction also gives `saturation` a second job. As a rate it stays algebraically absent while
the pool is flat; as the threshold the bonus fires behind it reaches 2.4% of regroup decisions, so a
term-sensitivity run that reads it as inert is now measuring a broken gate rather than confirming one.

The intermediate finding is worth keeping because it is the one that misleads: a separate
leader-deploy weight also recovered the loss, from -3.52 to -0.30, by suppressing early skips. It is
unnecessary. The knee already rises to an undeployed leader's cost, so the conjunction subsumes the
gate and the extra weight changes no decision.

### An evaluation term on hand size prices every decision, not one

`cardScarcity` reads hand size, and playing a card reduces hand size, so the term charges the play
decision as well as the regroup one. That is inherent to pricing a decision through a static
evaluation of board states, and it is not avoidable by tuning.

Measured, it costs nothing: the two arms that differ only in the leader-deploy weight carry the
distortion identically and differ by 3.5 points, which locates the cost in skip timing rather than in
card play. The bot's declined-play profile is also unchanged against the shipped bot, same cards and
same pass count, with 0.2 more cards held.

### Crossing the boundary safely means redacting the draw

The regroup deals both players two cards off a fully-ordered deck held in state, so a search crossing it
scores a hand holding cards nobody has drawn. The fix is a board-level flag stamped once at the root,
not a check at each crossing site: there were three, and the property has to hold however the boundary
is reached.

The rest of the model is settled and not up for rediscovery: the two drawn cards are not read, one is
assumed banked (the shipped weights put `resource - card` at +2, so banking is always chosen), the cards
still leave the deck so the deck-out clock is honest, and the resourcing choice is settled rather than
offered, since deciding the opponent's would mean reading their hand.

Test it by **permuting the deck and requiring the same move**. An assertion that the hand did not grow
passes the moment someone crosses the boundary a different way.

### Claiming the initiative to deny a lethal does not convert

Followed to the end of the game, a claim made where the opponent finishes next round and we do not buys
time and nothing else: 42.4% survive the round the claim bought against 19.6% of declines, and 1.4
rounds against 1.1, but it **wins 12.1% against declining's 13.2%**.

The comparison is confounded, and the direction of the bias is what makes it readable: declined
decisions are hopeless 41.6% of the time against claimed's 15.2%, so that column is loaded with lost
positions and should look worse. It does not. A low denial claim rate is defensible behaviour rather
than a blind spot.

### Dormant and dead, told apart at last

Two weights priced things that pay off across the round boundary, and could not be judged until a
horizon existed to price them against. Term sensitivity run through **`beam-horizon`**, 42 games and
2736 decisions, answers both:

| weight | varies | pivotal | bearing | bearing by kind |
| --- | --- | --- | --- | --- |
| `resourceSurplus` | 1.4% | 1.2% | 1.4% | action 0.0%, **regroup 8.6%**, answering 0.0% |
| `hand.canAct` | 4.7% | **0.0%** | **0.0%** | action 0.0%, regroup 0.2%, answering 0.0% |

**`resourceSurplus` is alive, and only at regroup.** Narrow, and exactly where the resourcing decision
is, so it belongs to that question rather than to the horizon.

**`hand.canAct` is inert.** Its quantity varies across candidates 4.7% of the time, so it is not
structurally flat, and yet nudging the weight changes the pick zero times and zeroing it changes the
pick zero times. Dead **even with the horizon that was supposed to wake it**, which is the strongest
form of that answer available.

**That does not make it deletable, and the reason generalises.** `handValue.test.ts` asserts a lower
bound: keeping a castable card must beat holding the biggest uncastable bomb in the pool, or the model
banks its last play. At `canAct` of 0 that bound reduces to `poorest > 0.3 x richest` over the real
pool, which it does not satisfy, so removing the weight inverts a preference.

Both are true at once: **it changes no decision the bench reaches, and removing it would invert a
preference in a situation the bench does not reach.** A measured null is evidence about the corpus, not
about the rule. An earlier version of this same area cost 9.5 points of win rate, so it is not a corner
to trim on an inert reading. The section below settles which of the two readings governs.

### `hand.canAct` is a rule, not a patch

The inert reading and the arithmetic bound describe different populations, so a scripted position
decides between them rather than more games. `aiHandCanAct.test.ts` builds it from the real pool: the
poorest castable card beside the richest card three or more resources out of reach.

**At `canAct` of 0 the shipped bot banks its only castable card** and keeps one it cannot play, at a
two-card hand and again at a five-card hand. At 3 it banks the bomb and keeps the play. The candidate
scores are 18.115 against 18.035 at zero and 18.115 against 18.252 at three, so this is a decision and
not a tie broken by a seed.

**The decision is a public tie**, which is why the term can reach it at all: banking any card leaves
hand size and pool identical, so every public term scores both options alike and the squashed hand
value is the only thing left to order them.

**The position is not rare, and it is not about small hands.** Over the 44 coverage decks, 540 banking
decisions: exactly one card is castable in **6.7%** of them (7.0% on a `greedy` screen), and 22 of
those 36 decisions were at a **five-card** hand against 1 at two cards. It is an opening phenomenon:
**21.6% in round 1**, 11.4% in round 2, and 4 cases in 276 decisions from round 4 on, because
resources outgrow the curve. Forced discards raise the same quantity and are covered by the same term.

**The weight must exceed 2.07**, measured as the largest margin by which a stranded card outscores a
castable one across every pool size. The binding pair is a high-value card **one** resource out of
reach, not a distant bomb. The shipped 3 clears it; 0.0% of pairs are still wrong at 3.

**The upper bound cannot bind.** It predates the squash. At `canAct` of 3, 10, 100, 1000 and 100000 the
bot develops its castable card every time, and the evaluated gain converges to 7.0 against a public
gain of 8, because a term confined to `[0, 1)` cannot override an integer-valued public preference. The
bound is correct and inert; the lower bound is the one that governs the weight.

### Reshaping `reach` does not retire `hand.canAct`

Eleven decay curves over the real pool, at six pool sizes, scoring the share of castable-against-
stranded card pairs that bank the last play at `canAct` of 0, and the smallest weight that fixes every
pair.

| curve | needs the guard | guard must exceed | stranded pairs scoring alike |
| --- | --- | --- | --- |
| **shipped** step 0.25, floor 0.30 | 38.8% | 2.07 | 1.9% |
| linear 0.10 a resource | 72.6% | 2.56 | 1.4% |
| linear 0.25 a resource | 29.0% | 2.07 | 13.9% |
| linear 0.33 a resource | 19.0% | **1.81** | 13.6% |
| shipped step, floor 0.15 | 28.9% | 2.07 | 1.6% |
| shipped step, floor 0.00 | 27.9% | 2.07 | **28.0%** |
| geometric 0.85^d | 66.4% | 2.39 | 1.1% |

**No curve removes the need for the weight**, because the binding case is a card one resource out of
reach at a 0.75 multiplier, which no change to the floor touches. Nine of the eleven report the
identical 2.07 for that reason.

**A gentler decay is worse.** The shipped curve is already linear at 0.25 a resource, floored at 0.30
from three out, so a 0.10 decay is more generous everywhere inside seven resources and nearly doubles
the region needing the guard.

**The floor earns its place by keeping the ordering alive.** Remove it and 28.0% of stranded-against-
stranded pairs score exactly alike, so choosing between two cards you cannot play returns to a coin
flip.

Two curves beat the shipped one on both columns (step with a 0.15 floor, and linear 0.25 with a 0.10
floor). **That is not evidence they play better**: with the guard present at 3, every curve in the
table makes the identical decision in this family. A floor change would bite on which card leaves a
five-card hand, which is the decision `hand.hold` drives on 75.9% of regroups and which none of this
measures.

## Avenues closed off

Recorded so nobody spends an evening re-deriving a null result. All measured against the identical AI
with the change switched off, across the coverage decks.

### The lethal solver is not worth pursuing, and cannot be made cheap enough to change that

The override is a narrow one by construction: even with a budget that lets it finish, the whole slice
where it can act is **25 decisions in 3,119**, and outside that slice it returns exactly what the beam
returns. Everything measured about it points the same way.

- **Its cost is 20x its headroom.** A depth-4 solver needs 200,000 nodes rather than the 4,000 it
  ships with, which takes the lines the beam misses from 20 to 25 and the cost from 39 ms to about
  780 ms a call.
- **It is close to inert at game level.** Screened at 80 games against a matched control, five of
  eight shards played *identical games*, and the paired difference was -1.25 points.
- **Gating cannot rescue it.** The best safe gate found leaves 55.9% of the work, worth 1.79x, and
  the reason is structural: solver time concentrates in the complex late-game boards where lethal is
  plausible, which are exactly the positions a gate must not decline.
- **Pruning inside the search cannot either.** Negatives are 97.3% of node work, so perfect rejection
  would be worth ~36x, but the best admissible damage bound available rejects 16% of them. A sound
  tighter bound needs a per-card damage ceiling that accounts for events dealing damage with no
  printed power, which does not exist.

What would change the picture is a **cheaper engine**, not a cleverer search: at roughly 43
microseconds per node, the price is `resolve` and `legalMoves` rather than tree size.

### Six attempts to price something the search misses; one worked

Every premise below was **correct**, and every evaluation term built on one was worth approximately
nothing. The single intervention that paid changed **how candidates are compared**, not what a board is
worth. That is the strongest steer this project has: the wins are in what the bot can see, not in what
it charges for what it already sees.

- **A shield term.** The evaluation genuinely cannot see a Shield (printed 0/0, works through a
  prevention hook, so a strip leaves a board scoring identically), and the bot strips one on **7.4%**
  of opportunities against random play's **17.9%**. Making it visible does not win: **50.0% ± 1.3%** at
  weight 3 and **48.2% ± 1.3%** at weight 8 over 5,500 games a cell, with every shard below 50% at
  weight 8. Flat then harmful, so no peak exists above zero.

  Two lessons worth more than the result. A flat per-token weight buys **indiscriminate strips** when
  the value is entirely contextual: large when the strip enables a kill this action, nil otherwise.
  Only a contextual version is worth revisiting. And "worse than random" was an overstatement: random
  strips by accident rather than correctly, so stripping less often than chance is not by itself
  evidence of an error.
- **Blocked reach**, priced as damage a shielded Sentinel denies. **Ungated** it measured **25.0%**
  against the shipped bot at weight 12, because it fired on 24.2% of decisions as a board-wide grudge
  against Sentinels while the lockout it was written for is 2%, at triple the value of a whole unit.
  Gating it to *shielded* blockers is what fixed that, and the gate ships. Gated, weight 12 read
  **48.8%**, and an in-scale sweep found the term **invisible** over ~2,500 games.

  "Invisible", never "harmful": the 25.0% belongs to the ungated term and does not transfer.

  **Every one of those numbers predates four changes to what was being measured**, so none of them is
  a current reading. The in-scale sweep ran the day before the search tie-break shipped, two days
  before every price in the model doubled, and three weeks before the bench's seat bias was fixed.
  That last one matters most: self-play controls through the head-to-head path these A/Bs used read
  50.0%, **48.8%** and 46.3%, pooling to 48.3% where an unbiased harness gives 50, so the gated
  reading coincides exactly with a known-biased control. Not proof it was the bias, and not a number
  to quote either.

  **The tie-break's absence is the mechanistic suspect.** Escaping the lockout needs two things: the
  term must turn the position into a tie, and the second opinion must then resolve that tie toward
  acting. On the day of the sweep the shipped bot had no second opinion, so the term was measured
  without the half of the mechanism it depends on.

  The weight was also allowed to be named by a single scripted position and never read against the
  model's own scale, which costs seconds. Every weight from 1 to 16 escapes the scripted lockout and
  all produce the identical two-way tie, so 12 was simply the first value tried.

  **Re-screened at weight 3 on a population that contains the position** (`--decks lockout`), 80 games
  a side with a matched control on the same seeds:

  | | wall decks | coverage decks |
  | --- | --- | --- |
  | paired difference | **+10.00** | **+1.25** |
  | t (9 df) | 2.75, significant at 5% | 0.43, not significant |
  | shards favouring the arm | 6 of 10 | 1 of 10 |
  | shards favouring the control | **0** | 1 |
  | shards byte-identical | 4 | **8** |

  The mechanism agrees with the win rate, which is what a proxy measurement would not do. Over the
  same games the term takes an available strip on **23.3%** of chances against the shipped bot's
  14.7%, halves the rounds spent locked (10.1% to 5.1%), and leaves 25% fewer shielded blockers
  standing.

  **The full paired runs, 1,678 games an arm**, which is what those screens are worth once played out:

  | | wall decks | coverage decks |
  | --- | --- | --- |
  | paired difference | **+1.88** | **+0.14** |
  | t | 1.73 on 10 df vs 2.228 | 0.19 on 9 df vs 2.262 |
  | | **not significant** | not significant |
  | shards favouring the arm | 7 of 11 | 6 of 10 |

  The screens read +10.00 and +1.25, so both shrank hard at twenty times the sample, exactly as the
  tie-break did (55.0% at 80 games, 51.1% at 2,040). **Screens are disaster filters and this is what
  they are worth.**

  **Shipped at 3 anyway**, on this ticket's stated gate of a scripted position plus non-inferiority
  rather than a win rate, because a shut lane is 2.2% of coverage decisions and no aggregate can carry
  it. Positive point estimates on both populations, neutral where the position does not occur, a
  measured mechanism, and a defect reported twice from real play. Recorded as **not significant**, not
  as a win.

  **Cost is a precondition, not a footnote.** The quantity runs the targeting rules per unit, so with
  the weight non-zero it evaluates on every board. Shipping it unguarded measured **1.26x** the
  per-decision cost; gating on "the enemy holds a unit that is both a Sentinel and shielded" brings it
  inside noise (three runs read 1.11x in the term's favour, then 1.09x and 1.05x against). A term this
  narrow has to pay nothing on the boards where it cannot fire.
- **Advantage priced as a one-off.** The token is +1/0 until its unit next completes an attack or
  defence, so a permanent model over-values it. Prevalence passed the gate at 20.7% of decisions, and
  six arms plus 1,800 games measured nothing: 76% of tokens are spent, so the honest discount is small
  enough to change ~1% of decisions, and anything large enough to measure hurts.
- **A conditional initiative term.** Prices holding the initiative when the holder is the side facing
  lethal next round, 13.0% of claim offers and zero elsewhere. Measured **+1.87** at one weight and
  **+1.0** at double it, the two indistinguishable, so no reliable gradient, at **65-70% more wall
  clock** because the predicate runs reach and lethal checks on the evaluation hot path.

  The premise survives the result: the bot's claim rate is **flat across all four horizon buckets**
  (21.1%, 15.1%, 9.5% and a 12.3% control; chi-square ~5.9 on 3 df against 7.8), so the blindness is
  real and measured. Pricing it is what failed.
- **Re-weighting the role shift**, covered above. The plateau holds.
- **Restricting the search tie-break by decision kind.** Measured **+4.25 against the unrestricted
  +4.9** on matched seeds, with five of ten shards byte-identical. No detectable difference, so the
  simpler unrestricted form ships. Useful as a diagnostic (it confirms the benefit concentrates in
  answering, playing and resourcing) rather than as a configuration.

### Too rare to measure

- **Offensive pinning.** Holding a ready unit that would kill an enemy leader on deployment is the one
  behaviour no depth reaches, since the value is in *not* acting. It is also far too rare: **17
  decisions in 44 games (0.8%)**, of which the bot spent the pin on 3. Leaders deploy around 7-8 HP and
  most units are power 2-5, so single-unit pins barely exist in this pool. The opponent deploys into a
  pin 8.1% of the time, so neither side plays around the threat and self-play could not reward the
  behaviour even if it were built.
- **The shielded-Sentinel lockout was in this category, and no longer is.** A deck population can be
  built for a strategy self-play will not play. See below.

### Building a population for a strategy self-play will not play

The lockout defeated measurement for a year because it is a **human** strategy: a shut lane appears on
2.2% of coverage decisions and never lasts a full round, while play-testers hit it constantly and one
filed game ran four consecutive rounds. `blockedReach` was written off as "invisible over ~2,500
games" on exactly that population.

The fix is a deck set built to contain the position: one seat gets an ordinary coverage deck, the
other a wall of self-shielding ground Sentinels plus the cards that put a Shield back after a strip.
`--decks lockout`. Measured **with `blockedReach` at 0**, the bot as it was before that term shipped,
44 games a side on the same seeds. That is what the population holds, not what the current bot does:

| `beam-reply`, `blockedReach: 0` | coverage | lockout |
| --- | --- | --- |
| a lane shut | 2.2% | **6.4%** |
| rounds locked | 1.3% | **10.1%** |
| longest lockout in one game | **1 round** | **4 rounds** |
| the bot took an available strip | 9.3% | 14.7% |
| **passed with an attack available** | 57.6% | **96.7%** |

**Both columns are the calibration.** The coverage column reproduces the historical record and the
lockout column reproduces the filed game, which is what distinguishes an instrument from a large
number.

Three properties of such a set, learned building this one:

- **It must be asymmetric, and that costs the absolute win rate.** A mirror where both seats hold the
  wall cannot show a bot finding a way *through* one. The price is that the pairing has a favourite
  before either bot moves, so only a paired difference against a matched control means anything.
- **The benefit is measured on the built population; non-inferiority stays on the ordinary one.** A
  term tuned only against a manufactured population is tuned against nobody's game.
- **Read the qualified rate, not the raw one.** The raw pass rate barely moves between the two
  populations (0.75 a game against 0.68); what changes is that the bot passes *with an attack
  available* almost every time. A rate alone reads this as no difference.

### An engine change cannot be A/B-ed, and self-play cannot see it at all

A change inside `resolve` sits under every AI, so there is no name to put on the other arm. Worse,
**a self-play control is blind to it by construction**: both seats carry the change, so the control
reads ~50% whatever happened.

What works is a **fixed weaker reference on identical seeds, run once per build**: `beam-reply` against
`greedy`, same decks, same shuffles, before and after. If the change hurt the strong bot, its margin
over the weak one shrinks. Validating the trigger-probe fix that way, 12 shards of 120 games:

| | pre-fix | post-fix |
| --- | --- | --- |
| pooled | 79.6% ± 2.1% | 79.6% ± 2.1% |
| shards identical | **11 of 12** | |
| the twelfth | 118 completed, **2 dropped** | **120 completed, 0 dropped** |
| wall clock | 2813.1 s | 2807.5 s |

Read it as "the matchup is unchanged", not "the bot is as strong in absolute terms": both sides moved
together, and no before-and-after across commits can separate those. It is the strongest available
reading for an engine change, and it is worth the hour.

The sharper evidence here was not the win rate but the **drop count**, which measures the defect
directly rather than through a proxy.

### Refuted assumptions

- **"The bot accepts every optional trigger."** It declines 12% of them, and its accept rate varies by
  kind from 71% to 91% against a uniform picker's 70.5%. Accepting above chance is not evidence of a
  defect: optional abilities are designed to be usually good.
- **A concave resource pool.** Measured 49.7% against flat and degraded further as the knee lowered.
  The pool ships flat as a rate. The knee is no longer inert, because the regroup rule fires behind it.
- **"The bot hoards cards it could play."** At a chosen pass it holds 2.09 playable cards of 3.32, and
  the cards it declines most are the ones it plays most: Pathfinder Sergeant 46 plays against 10
  declines, Moff Gideon 36 against 12. Four of the six most-declined are unique units whose value
  depends on board state. Holding is situational, not a failure to develop, so the resourcing decision
  is not downstream of a play-quality problem.
- **"The bot will not deploy expensive bodies."** It plays an 8-cost 6/6 into an empty board, a board it
  outclasses, and a board that could trade with it. Repeated declines of specific bombs in the corpus
  are positional and remain unexplained; the general claim is not.
- **Per-candidate role assignment.** The role belongs to the decision, not the candidate.
- **Deeper search.** Depth 4, covered above.
