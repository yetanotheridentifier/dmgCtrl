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

### A tied initiative is worth nothing either way

`beam-claim-ties` (always take a tied initiative) against `beam-hold-ties` (never take one) measured
**+0.00 points** (sd 0.84, se 0.24 over 12 shards, 5 of 12 favouring, 2016 games). The spread is
non-zero, so the arms genuinely diverge; the per-shard differences scatter both ways and cancel.

So the seeded coin flip that ships is the right answer, to within about half a point. **Reading both
extremes is what makes that legible**: a single arm against the flip cannot separate "balanced" from
"underpowered to detect", and at 80 games those same arms read +1.25 and +0.00, which settles nothing.

It does **not** rule out a conditional policy. A zero gap between two blanket arms is also what you
would see if taking were right half the time and wrong the other half, which the split of tying
candidates hints at: attack 46%, pass 38%. The ceiling is low enough not to chase it, since the tie is
8.2% of claim offers and fourth of five blind spots on the corrected metric.

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

Two candidate explanations, neither settled: the modelled opponent tail may be dead weight (it is most
of the cost, and the free run changes nothing measurable in 79% of claims), or crossing may make
**passing** more attractive, since a line that ends the phase now lands on a regroup where both sides
ready everything and bank a resource.

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
to trim on an inert reading.

## Avenues closed off

Recorded so nobody spends an evening re-deriving a null result. All measured against the identical AI
with the change switched off, across the coverage decks.

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
- **Blocked reach**, priced as damage a shielded Sentinel denies. At the weight first tried it measured
  **25.0%** against the shipped bot, because it was triple the value of a whole unit on a scale where a
  unit is the biggest thing you can win or lose. In-scale values do not create the tie it was meant to
  break, and a sweep found the term invisible over ~2,500 games. The weight was allowed to be named by
  a single scripted position and never read against the model's own scale, which costs seconds.
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

### Refuted assumptions

- **"The bot accepts every optional trigger."** It declines 12% of them, and its accept rate varies by
  kind from 71% to 91% against a uniform picker's 70.5%. Accepting above chance is not evidence of a
  defect: optional abilities are designed to be usually good.
- **A concave resource pool.** Measured 49.7% against flat and degraded further as the knee lowered.
  The pool ships flat, which is also what makes the knee inert.
- **Per-candidate role assignment.** The role belongs to the decision, not the candidate.
- **Deeper search.** Depth 4, covered above.
