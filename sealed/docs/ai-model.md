# The AI model

What the opponent AI thinks, and the constraints that keep it coherent. Read this when changing how
the AI evaluates a position. For measuring a change, see [ai-benchmark.md](ai-benchmark.md).

## The driver

`makeGreedyAi(evaluate)` is one ply: for each legal move, apply it, score the resulting board from
the acting seat, take the highest. Because `resolve` is pure and `legalMoves` enumerates everything
including how choices are answered, this one loop covers playing, attacking, resourcing, claiming the
initiative and answering triggers, with no per-card rules.

Ties break from `state.rngSeed`, never `Math.random`, so replays and saved records reproduce exactly.

## A win in one action is always taken

`evaluate` returns +/-WIN = 1,000,000 for a decided game, while every other term is a small weight
times a board-sized quantity. No reachable material score approaches a million, so **a move that wins
is always the unique maximum** and the driver must pick it. That is arithmetic, not tuning, and
`takesLethal.test.ts` pins it: capping the evaluation, normalising it, or letting the private hand
term escape its `[0, 1)` bound would each quietly turn "certain win" into "quite a good move".

The guarantee stops at **one action**. A lethal needing two attacks is not one action, and since
players alternate, the opponent acts in between and may remove the attacker, gain a Shield or put up
a Sentinel. One ply can start such a sequence but cannot promise it. `ai/race.ts` distinguishes the
two directly: `canFinishThisAction` (one unit, guaranteed) against `canFinishNow` (aggregate reach,
an intention).

## Quiescent scoring: only finished actions are evaluated

A move that raises a choice has **not finished resolving**. A when-played effect has picked no
target, a mandatory unique defeat has not happened, a suspended attack has not dealt its damage.
Scoring that board ranks the move on a position nobody will ever play from.

`ai/search.ts` wraps the evaluation so the owed chain is resolved first: **max** over our own
answers, since they are an opportunity, and **min** over the opponent's, since they are a threat.
Whose turn it is comes from `state.activePlayer`, because the engine hands the turn over when an
action raises a choice the opponent controls and `legalMoves` enumerates only the active player's
answers. It stops the moment nothing is owed, so it never looks past the end of the action it was
given.

It is a decorator over any `Evaluator`, not a change to `evaluate`, so the greedy driver takes either
one and a measurement isolates it.

**Worth 76.7% and 78.4% ± 2.9% across two seeds (1700 mirror games) and 72.7% ± 3.4% on the
conservative matchup harness (648 games), against the identical evaluation scoring half-resolved
boards.** By some distance the largest single improvement in the series, because it is a correction
rather than a refinement: 11.3% of the moves the bot committed to were ranked on a fiction.

The starkest case was the unique rule. Playing a second copy of a unique raises a **mandatory**
defeat, and the board was scored with both copies still on it, so a duplicate 3/3 read about 13
points too high and the bot paid a real card for a unit it had to defeat immediately.

Two properties worth keeping:

- **It costs about 2.5x wall clock**: 420 games in 74.7s against 29.8s, so a few hundred games a
  minute either way. A single decision stays far inside interactive latency at this depth, so no Web
  Worker is needed for it.
- **A node budget bounds the worst case.** `support` fans out across every ready unit and every legal
  target, so the cap is a safety rail against the card pool, not a tuning knob. Exhausting it scores
  the board where it stopped, degrading to the old answer rather than a wrong one.

The search shares that one budget between resolving owed chains and expanding the beam, and the chain
will take nearly all of it if allowed to. Raising the rail twentyfold moves the beam's own spend from
128 nodes to 135 while the chain's goes from 510 to 6885, so a bigger budget costs about ten times as
much per decision and buys no extra search. `--budget` reports this; do not infer it from a wall
clock, which reads the heavy tail as if it were the common case.

**So no single chain may take more than `chainNodes` of the pool**, defaulting to the 256 that
one-ply quiescence has always given each candidate. This is the discipline the beam lost by taking a
raw evaluator rather than a new parameter: `greedy` hands every candidate a fresh budget, so a runaway
`support` fan-out costs 256 and the next candidate starts clean.

The cap does not raise the ceiling, so worst-case work per decision is unchanged and what a chain is
not allowed to take stays available to the search. Measured over 200 decisions for `beam-reply`:

| | shared pool | per-chain cap |
| --- | --- | --- |
| budget exhausted | 8.5% | **6.0%** |
| chain nodes | 943 | 715 |
| beam nodes | 376 | **493** |
| chain share | 71.5% | **59.2%** |
| cost vs `greedy` | 67x | **66x** |

A typical chain costs about 2.5 nodes, so the cap sits ~100x above normal play and bites only on a
fan-out that was going to run away. It changes the chosen move on **2.0%** of decisions.

It is a trade rather than a free win: a chain capped at 256 may pick a worse answer than one allowed
thousands, so beam completeness is bought with chain thoroughness. `beam-reply-shared` in the registry
is the control that measures it.

**Measured, the trade is neutral on strength: 49.7% ± 1.0% over 9600 games** (12 seeds, no games
dropped), so the cap is kept for the cheaper, better-bounded search rather than for a win rate. Do not
expect points from it, and do not read the null as a reason to remove it: it is what stops one
`support` fan-out consuming a decision's whole budget, and it is what makes the budget mean the search
rather than the card pool.

`greedy-flat` in the registry is the same AI without this, kept so the comparison can be re-run as
the evaluation changes underneath it.

## Own-turn lookahead: the beam

One ply scores each move in isolation, so it can never play a line whose first step is a loss.
Sacrificing a chump into a Sentinel to clear the path is the canonical case: the sacrifice is simply
bad, and the payoff arrives two actions later.

The beam expands a sequence of **our own** actions and values a move by the best board its follow-ups
reach. It ships at **width 4, depth 3**, and measures **60.0%** against one-ply greedy over three
seeds and 2580 games (57.5%, 59.0%, 63.5%), where greedy against itself reads 50.4%.

### The null-move assumption

Players alternate single actions, so continuing our own sequence means pretending the opponent does
nothing in between. **That assumption, not the search, is where the strength comes from and where it
leaks.** Since the beam maximises over leaves, it systematically prefers the branch most dependent on
the assumption holding.

It models this format better than it sounds. There is no instant-speed interaction and a played unit
arrives exhausted, so an opponent cannot answer mid-sequence with a card they have just cast. Their
whole in-sequence toolkit is: attack with something already ready, play an event, play an Ambush
unit, deploy their leader (which arrives ready, and is the largest of these), or claim.

The null move is the real `pass` action rather than a rewrite of `activePlayer`, which is safe because
every real action resets the pass counter before handing the turn over, so alternating our-action and
their-pass never reaches the two-pass phase end. The search never passes on our own behalf.

### Three properties that are not obvious

- **Each root keeps its own beam.** A single global frontier would defeat the purpose: these lines
  open with a move that is bad in isolation, so trimming by immediate score prunes exactly the roots
  worth exploring. Per-root beams cost roughly `roots × width × depth` instead of `width × depth`, and
  that is the price of the feature working rather than an optimisation left unclaimed.
- **Decisive scores are discounted by depth.** Without it the beam is indifferent between winning now
  and winning in three actions, since both score WIN. A deferred win is certain only if the opponent
  really does nothing. The discount touches decided boards only, so it reorders no material judgement.
- **The beam expands actions; quiescence owns the chains.** `resolveChain` settles an owed choice and
  returns the board, so depth counts genuine actions. Otherwise a `support` chain would consume beam
  width and depth would mean something different in every position.

### Width and depth

Depth does the work; width barely matters and is mildly harmful past 4.

| | Win rate | ms/decision |
| --- | --- | --- |
| depth 2 (any width) | 54.0% | |
| width 2, depth 3 | 59.2% | 62 |
| **width 4, depth 3** | **60.0%** | **85** |
| width 8, depth 3 | 56.1% | 122 |

Width is provably irrelevant at depth 2, where the trim is never used, and every depth-2 cell returns
bit-identical numbers. Width 8 losing to width 4 is consistent with the optimism story: a wider beam
keeps more mediocre states, and a max over more leaves is more optimistic.

**Width 4 sits at the point of diminishing returns**, which is visible without playing a game.
Measured over 1000 real decisions alongside a pessimistic reply, how often each width picks a
different move from the shipped width 4:

| width | 1 | 2 | **4** | 8 | 16 |
| --- | --- | --- | --- | --- | --- |
| moves changed | 6.0% | 3.4% | — | 2.7% | 3.3% |

Narrowing changes more than widening, so below 4 the trim is removing options that matter and above it
mostly is not. Cost moves even less: 108, 110 and 115 ms a decision at widths 2, 4 and 8, since an
eightfold width rise buys only +53% beam spend (322 to 492 nodes). The frontier is usually smaller
than the cap, so the cap is not what bounds the search.

**Read a disagreement rate off a deep corpus or not at all.** The same measurement over 200 states
reported 0.5% for width 8 rather than 2.7%, understating every rate about fivefold, because a corpus
is filled game by game and a short one is nothing but openings where few units are in play and the
beam has little to choose between. This is the same hazard that makes a small `--cost` corpus report
5.8 ms for a search that costs 142.6 ms.

**Depth 4 is better and is deliberately not shipped.** It measures 59.4% against depth 3's 57.5% on
the same seed, but only once the node budget is raised: at the default budget it reports 54.4%,
because the rail truncates it. It costs 2.45x, and its value rests on four consecutive opponent
non-actions, which is exactly what a modelled reply changes. The decision belongs with the reply
policy rather than before it.

## The opponent's reply

The beam assumes the opponent does nothing between our actions. That assumption is what makes a
multi-step line of ours look playable, and it is also where the model leaks: since the beam maximises
over leaves, it systematically prefers the branch most dependent on the assumption holding.

A **reply policy** replaces the null move with the opponent's best answer, so the board scored is one
they have had a say in. It is a parameter of the same search rather than a second one, which is what
collapsing the three search tickets into one bought:

| Policy | The opponent |
| --- | --- |
| `null` | does nothing. Optimistic. This is the beam. |
| `pessimistic` | does the most inconvenient thing we can see: `min(evaluate(s, me))` |
| `selfish` | plays their own read of the race: `argmax(evaluate(s, foe))` |

The last two differ because role-adjusted weights are **not** zero-sum: an aggressor and a defender
price the same board differently by design.

**Looking one move ahead at the opponent beats looking three moves ahead at yourself.** Two-ply at
depth 1 measures **54.5%** against a reply-blind beam over three seeds and 2580 games, above 50 on
every seed. `selfish` measures 53.2% on the same runs, so pure pessimism leads, though not separably
at that width.

### Depth and pessimism compose, and that was not the expectation

The worry was that they would cancel: one policy is optimistic and the other pessimistic, so stacking
them could land anywhere. They are strongly **super-additive**.

| Against a reply-blind beam | Mean over 2580 games |
| --- | --- |
| reply only (depth 1) | 54.5% |
| reply + depth 2 | 64.7% |
| **reply + depth 3 (shipped)** | **67.4% ± 1.9%** |

Depth without a reply is worth +10 (beam over greedy). Depth **on top of** a reply is worth +12.9. The
reason is that a reply at every level makes the search proper minimax, so depth compounds rather than
extending lines that only work if the opponent cooperates. The curve is still climbing at depth 3.

Three measurements cross-check: beam beats greedy 60.0%, reply beats beam 54.5%, so reply should beat
greedy by about 64.5%. Measured directly, **64.4%**.

Two properties keep it honest:

- **Never negate.** `evaluate` stopped being zero-sum when the private hand term landed, so the
  opponent's side is scored with `evaluate(s, foe)` directly. `-evaluate(s, me)` would read their hand.
- **Their role is fixed once**, from the position they are deciding in, the same discipline #395
  imposed on ours. Deriving it per candidate compares scores computed with different weight sets.

### Bounded by alpha-beta, not by trimming

The obvious saving is to expand replies only for the top-scoring candidates. That is exactly the error
the beam already paid for: trimming by pre-expansion score prunes the moves whose value only appears
**after** the reply, which is the entire reason for looking at replies.

Alpha-beta never changes the answer, only the work. The cut carries a **margin equal to the board's
depth**, which is arithmetic rather than caution: leaves are scored with a depth discount on decided
boards, so the running minimum and the value the caller computes can differ by exactly that much.

It applies to `pessimistic` only, since `selfish` maximises a different function and our bound does
not hold on it, and then only where a board is a **leaf**: the root board at depth 1, and the deepest
level of the beam, whose boards feed the score and the winner check but are never continued from. At
any interior level a branch's value is the max over everything below it, so a poor immediate reply
bounds nothing, and cutting would also change which board the frontier continues from.

Measured over 200 real decisions, the deepest-level cut saves **10.8% of nodes and about 8% of wall
clock** at the shipped width 4, depth 3. It saves **nothing at depth 4**, so it is not the lever that
makes a deeper configuration affordable.

It is answer-preserving in the way that matters and not quite in the way it sounds: over those 200
decisions the pruned and exhaustive searches chose differently exactly once, on a position where the
**node budget** ran out. Both searches draw on one rail and the cheaper one gets further down it, so
where the rail binds they legitimately see different amounts of the tree. On every decision that
completed within budget they agreed. Anything asking whether a win **exists** rather than what it
scores must still turn the pruning off outright, which is what `beamReachesWin` does.

## Lethal detection

`ai/lethal.ts` answers "can this seat win from here using only its own actions", under the same
null-move assumption as the beam. `hasLethal` returns whether a line exists; `findLethal` returns the
move that opens the **shortest** one.

Under that assumption most of the question is closed form. Aggregate ready reach IS a kill, because
the attacks are taken consecutively while the opponent passes, so `attacksToFinish` settles it by
counting rather than searching. Search only adds what the board cannot show: the **hand** (a burn
event, a pump), the **leader** (which deploys ready and is not in `units` until it does), and
**Sentinel clearing**, where one attack removes a blocker so the rest can reach.

Measured over 36,384 decisions: lethal exists in **6.6%**, of which 4.8 points are the closed form and
the shipped beam already finds 5.8 points. The beam misses a win in **0.9% to 1.5%** of decisions,
depending on how deep the solver is allowed to look.

**It is not wired into the bot**, and that is a measured decision rather than an omission. As an
override in front of the beam it scored 50.1%, 51.4% and 50.8% over three seeds and 2580 games:
**+0.8 points, the same sign every time, and indistinguishable from neutral.** Separating an effect
that small from zero would take roughly 10,000 games. It remains as a primitive because the initiative
work needs it.

Three properties are worth keeping in mind if it is ever revisited:

- **It is a lower bound.** Pruning and the node budget can each make it miss a line, so `false` means
  "none found within budget". An exhaustive oracle run against it on real positions found **zero**
  missed lines in 1,200 checks, so the bound is tight in practice.
- **It must return the fastest kill, not any kill.** Returning whichever line came first measured
  **47.8%**, losing two points, because a five-action line hands the opponent five chances to answer
  while a two-action line hands them two. This is the same rule the beam's depth discount encodes.
- **Existence and shortest-line are separate questions.** One full-depth pass answers the first; only
  if it succeeds is it worth deepening iteratively for the second. Doing both unconditionally cost
  **509 ms** a call against **151 ms**, because a line exists in only ~12% of the positions the gate
  admits.

A gate keeps it off the decisions where it cannot pay: before round 4 (lethal has never once been
observed in rounds 1 to 3), and where a single action already wins (`WIN` dominates, so the driver is
proven to take it). That skips ~45% of decisions and, measured against an ungated run, cost **zero**
winnable positions.

## The two halves of `evaluate`

The split is a **hidden-information boundary**, not a tidiness one.

**`publicScore`** reads only what both players can see, hand SIZE included but never hand contents.
It is **integer-valued**, and zero-sum while both seats read the same role.

**`handValue`** reads card identities, which are hidden, so it is applied to the scored seat **only**.
Subtracting the opponent's would be peeking at their hand.

`evaluate` is therefore subjective rather than zero-sum, which costs nothing at one ply because
greedy only ever scores from the acting seat.

> **Anything scoring a position from both seats must call `evaluate(s, foe)`, never negate
> `evaluate(s, me)`.**

### The private half is a tie-break, not a vote

Hand value is squashed into `[0, 1)`. Since `publicScore` is integer-valued, that makes it
**provably incapable of overriding a public preference**: it can only order moves the board score
rates equally, which is exactly where the blind spots are.

This bound is load-bearing, not stylistic. A private term applies to *every* decision while fixing
one, so its distortion grows with its weight: measured against the same AI with the term off, a
bounded term returns **53.5% ± 1.9%**, an unbounded one competing with the board score returns 49.9%,
and larger weights degrade to 39.8% and 26.0%.

**Every public weight must stay an integer**, or the bound silently stops holding.

## What the evaluation values

Public terms, in `ai/evaluate.ts`:

| Term | Meaning |
| --- | --- |
| `base` | per point of damage on a base, the win condition |
| `unit` | per unit in play, the dominant board term |
| `power`, `hp` | per point of effective power / remaining HP |
| `card` | per card in hand (size only) |
| `resource`, `resourceSurplus`, `saturation` | the resource pool, see below |
| `readyUnit` | a light tempo term |
| `initiative`, `claimCost` | turn order, see below |
| `lethalExposure` | handing the opponent a one-action kill, see below |
| `roleShift` | how far the role bends the weights, see below |

The board term is built around what decides trades: unit **count** is the biggest swing, then power.
Remaining HP counts lightly, so damage reads as progress toward removal without a
surviving-but-damaged unit looking like a large loss. Only defeating a unit is the real swing.

### Which weights are actually doing work

Measured directly rather than inferred from win rate, by `npm run bench --prefix sealed -- --terms`
over 8503 decisions. A weight matters at one ply only if its quantity differs across the candidates
being compared, since an equal term adds the same constant to every score and cancels.

`base`, `power`, `resource` and `hand.hold` carry the model: each changes the chosen move in 14% to
23% of decisions when switched off. At the other end, **`saturation` changes nothing at all**, in any
column, which is what a genuinely dead weight looks like. `hand.canAct` is close behind at 0.1%.

Two results are worth holding onto because they contradict the obvious reading:

- **`hand.hold` is load-bearing but not tunable.** It has the widest-varying quantity in the model, a
  spread of 13.9, and rescaling it changes **no** decision, because the hand term is squashed into
  `[0, 1)` and scaling is nearly a monotone transform of its own ordering. Switching it off changes
  13.8% of decisions overall and **75.9% of regroups**. It cannot be tuned and must not be deleted.
- **`card` is the mirror image**: sensitive to a nudge (13.3%) but barely load-bearing (2.9%). What
  matters is its difference from `resource`, and zeroing it leaves that difference the right sign.
  Its apparent sensitivity is the banking cliff below, not headroom.

`claimCost` varies in 43.0% of decisions and changes the pick in 1.0%, which is the "live but not
worth tuning" quadrant and independent support for the note under Initiative that at
`initiative: 1` the brake may be doing little.

`lethalExposure` is bearing in only 1.0% of decisions, which is not in tension with the +3.8 points
it measured: it is rare and decisive rather than broad, exactly as the exposure sizing predicted.

Several weights are expected to be **dormant rather than dead**, pricing futures that one ply has no
way to see. Re-running this after lookahead lands is how the two are told apart, and the claim to
test is the Bearing column rather than Varies.

### Banking: `resource` must exceed `card`

The sharpest constraint in the weight set, and the only cliff rather than a curve. Banking at regroup
swaps a card for a resource, so the sign of that decision is `resource - card` and nothing else. A
5x5 grid over both weights, 840 games a cell, depends on the **difference alone** and never on either
magnitude:

| `resource - card` | Win rate | Behaviour |
| --- | --- | --- |
| ≥ 1 | ~50% | banks; `resource=6, card=0` is no better than `resource=3, card=2` |
| 0 | **15.8%** | banking is an exact tie, so the seeded coin flip decides it |
| ≤ −1 | **1.8%** | never banks, so never builds a pool |

Two dimensions collapse to one binary condition. Either weight can be re-tuned freely while the gap
holds, and `resourceValue.test.ts` asserts it, because losing 98% of games is not a tuning
regression.

### The resource pool is flat

`resourceSurplus` equals `resource`, which also makes `saturation` **algebraically** inert:
`resourceValue` collapses to `resource × pool` when the two rates are equal, so the knee cancels out.
Sweeping `saturation` alone therefore cannot move anything, and measuring it produced four identical
numbers. Term sensitivity confirms it from the other direction: `saturation` changes no decision when
nudged and none when switched off entirely.

A concave pool, valuing surplus resources below the `card` weight, is implemented and switched off.

It works behaviourally: it makes the bot skip 12.5% of regroups, all at a pool of exactly the knee.
It measured **49.7% ± 1.9%** over 5040 games against a flat pool, and worse as the knee lowered
(46.1% at 6, 45.6% at 5). Do not reintroduce it without new evidence. The mechanism is kept only so
the question can be re-asked cheaply.

Worth knowing if it is revisited: the bot does leave 1 to 2 resources unspent per round late on
(mean spend 5.9 against pools of 7 to 8), so idle resources are real and the premise was not the
problem.

A `resourceSurplus` × `saturation` grid re-measured this after quiescent scoring landed and it still
does not pay. Concavity costs in proportion to how hard the knee bites (49.7% at surplus 1 with the
knee at 4, converging to flat as the knee rises out of reach), while **convexity does nothing at
all**: valuing surplus above the full rate changes no decision, because banking is already always
chosen.

### The hand

`ai/cardValue.ts` scores a card as if it were cast: effective cost, stat total, keywords, **registered
abilities**, rarity, aspect icons, uniqueness. Counting implemented abilities rather than parsing
printed text is deliberate and more accurate, because a card whose ability is not built genuinely
does nothing in this engine.

Statless cards take a cost-scaled stat equivalent, so an event is not ranked below every unit. That
is a placeholder: an event's worth is its effect magnitude, which needs the same machinery as
optional-ability scoring.

`ai/handValue.ts` combines a **flat** bonus for holding at least one castable card with a discounted
sum over the whole hand, where the discount reflects how soon each card can be cast and never reaches
zero.

The bonus is flat because scaling it by the castable card's value makes a bomb's hand value and board
value the same size, so the bot refuses to play its own bombs: **40.5%**. It is bounded on both
sides, and both bounds are tests: below what the board pays for the cheapest body, above the
discounted value of the best uncastable card in the pool.

Two properties of the private half fall out of its design rather than its tuning, and a
`canAct` × `hold` grid confirmed both exactly, to four decimal places:

- **`hold`'s magnitude cannot matter, only its sign.** It scales a sum inside a term that is squashed
  into `[0, 1)` and used only to break public ties, and a monotone scalar cannot reorder a tie-break.
  0.12 and 0.4 measure identically; **0 measures 46.6%**, because the ordering collapses and the coin
  flip returns.
- **`canAct` is inert in self-play.** It is flat over the whole hand, so it cancels between candidate
  moves unless one of them spends the last castable card. Values 0, 3 and 6 change no decision at any
  `hold` setting. It is a guard against a rare position rather than a working term, and its measured
  contribution is zero.

### Initiative

Claiming the initiative makes you pass for the rest of the round, so the model prices both halves:

```
initiativeValue(me) = initiative * (holder === me ? +1 : -1)
                    - claimCost  * forfeitedTempo(me)
                    + claimCost  * forfeitedTempo(foe)
```

`forfeitedTempo` is a player's ready units while the phase is still running and they have claimed.
That guard is what makes claiming into an already-passed opponent cheap **without a special case**:
such a claim ends the phase, so the resulting state is not in the action phase and nothing is
charged.

Turn order is worth **far less than it looks**. Raising `initiative` is monotonically worse (46.8% at
4, 35.4% at 6, 29.4% at 8), because the bot buys it by giving up whole turns. A bonus with no cost
term is the always-claim failure mode and measures 41.1%; a cost with no bonus is inert at 50.0%.
Both halves are load-bearing.

**The two weights interact, and the interaction is the point.** The higher `initiative`, the more
`claimCost` it takes to pay for it (840 games a cell, and the shipped pair is `1 / 2`):

| | `claimCost` 0 | 2 | 3 | 5 |
| --- | --- | --- | --- | --- |
| `initiative` 0 | 48.9% | 47.7% | 47.6% | 47.6% |
| `initiative` 1 *(shipped)* | 50.6% | **50.7%** | 50.2% | 50.2% |
| `initiative` 2 | 47.0% | 50.0% | 50.1% | 50.0% |
| `initiative` 3 | 46.1% | 48.0% | 49.3% | 50.0% |

`initiative: 3` needs `claimCost: 5` just to reach parity, while `initiative: 1` is fine even at
`claimCost: 0`: a cheap valuation of turn order needs no brake, an expensive one does. The
`initiative: 0` row is uniformly worst, which is the direct evidence that the term earns its place.

The pair moved from `2 / 3` to `1 / 2` on this evidence, confirmed by six paired seeds at 8400 games
each: **+0.62%, positive on every seed** (+0.45, +0.51, +0.97, +0.13, +0.88, +0.80 against a matched
control) over 100,800 games. Small, but it is the only weight change a 146-cell grid and roughly half
a million games could find, which is the more useful fact: **the weight set is at a local optimum and
further strength has to come from new information rather than re-weighting.**

One thing left untested: at `initiative: 1` the brake may be doing little, since `claimCost: 0`
measured 50.6% against the shipped cell's 50.7%. That deserves its own A/B rather than an assumption.

A constraint worth knowing before anyone sweeps finer: `publicScore` must stay integer-valued so the
private hand term remains a tie-break, so `initiative` can be 1 or 2 but never 1.5. If the true
optimum lies between them, the model cannot express it.

### Lethal exposure

The defensive mirror of "a win in one action is always taken": prefer a move that does not leave the
**opponent** able to win with a single action. `lethalExposure` scores the difference between the two
seats' `canFinishThisAction` readings, so it is symmetric, integer and public.

It is worth **+3.8 points**. Removing it (`lethalExposure=0`) measures 46.5%, 46.5% and 45.7% against
the shipped model over three seeds of ~8500 games each, well outside the ±1.1% intervals. The
response curve is monotone and saturates early: 0 → 46.6%, 8 → 49.3%, 16 → 49.9%, 24 → 50.4%,
32 → 50.6%, 48 → 50.6% at 840 games a cell. **24** ships. A confirmation of 32 at ~8500 games gave
50.35% and 50.33%, which is inside noise on both seeds, so the top of the curve is flat rather than
still climbing.

Behaviourally it moves what it was built to move: the **avoidable** share of exposures falls from
18.0% to 13.7%, and the loss-rate penalty for making one disappears. Total exposure barely moves,
because 86% of exposures are unavoidable, and no evaluation term can help there.

Three properties keep it from disturbing anything else:

- **It cancels where every move is exposed.** An identical penalty on all candidates leaves the
  ordering untouched, which is why the unavoidable 86% costs nothing and no special case is needed.
- **It cannot outvote a win.** `WIN` is 1,000,000, so avoiding exposure never declines a kill.
- **The cost is immaterial**: 0.071 ms on a 4.4 ms decision, 1.6%, measured over an identical corpus
  of 2932 real decision states. The predicate is called twice per `publicScore` and quiescence scores
  many candidates per decision, so this was worth checking rather than assuming.

The reading is a lower bound. `canFinishThisAction` sees only damage already on the board, so an
event finisher, an Ambush unit or a pump in hand is invisible to it. Closing that gap is search, not
a weight.

Two of the gaps are **public** rather than hidden, and are worth knowing before the bound is trusted.
A leader deploys **ready** and deploys on resources controlled rather than spent, so an undeployed
leader is a ready attacker its owner can produce at will; deploying is itself an action, so it is
normally a two-action line, but a leader granted Ambush on deploy swings in the same action. And a
few units ready themselves while some events ready an exhausted one, so `exhausted` is not the last
word on whether a body can attack again this round. Both are narrow enough not to earn a term, and
both make the race model under-read a player who is about to deploy.

### Role: read the race, not the board

The same board is good news for the aggressor and bad news for the defender, so `ai/race.ts` decides
which the AI currently is, from **who gets to lethal first**.

The signal is reach, not presence: **board power is not damage that can reach a base**. A control
player who plays a Sentinel adds one point of power and kills nothing, yet stops the opponent's clock
dead. At round 3 the faster clock predicts the winner **68.0%** of the time against 62.0% for the
board leader, rising to 80.5% by round 5.

Reach is computed through `enemyAttackTargets`, the rules' own targeting function, so Sentinel,
Saboteur, arena and Hidden resolve once rather than being re-derived. Overwhelm tramples past a wall,
Restore lengthens the attacker's clock, and the clock splits "this round" (ready units only) from the
steady rate, which is what makes it a race rather than an average.

The role bends `base`, `unit` and `initiative` by `roleShift`. The aggressor pushes damage; the
defender values trades and board clearing, and wants the initiative.

Two constraints:

- **The role belongs to the DECISION, not the candidate.** `makeGreedyAi` fixes it once from the
  position it is deciding in and passes it to every candidate. Deriving it per candidate compares
  scores computed with different weight sets, because 32.5% of decisions have candidates landing in
  different roles, and measures 44.2% down to 26.3% as the shift grows.
- **Role awareness deliberately breaks zero-sum** when the seats read different roles. That is the
  point: a single fixed evaluation cannot play both sides of a matchup. Zero-sum holds while both
  seats share a role.

`roleShift` is small because the data supports no more: 1 and 2 tie, 3 and 4 are worse, and the
effect is **51.4% ± 0.9%** over ~11,340 games. Setting it to 0 disables role awareness cleanly.

## Setup

`ai/setupAi.ts` handles the mulligan and the two opening resources, because random setup decisions
are catastrophically bad even for the weakest opponent. It keeps a hand only if it holds a turn-1
play, and banks the pair that best preserves the early curve.

## Adding a model

Implement `(state) => Action | null`, choosing from `legalMoves(state)` and drawing any randomness
from `state.rngSeed`. Register it by name in `ai/registry.ts`, which is the single seam the whole AI
series hangs off, then measure it. Deploy by setting `OPPONENT_AI` in `src/config.ts` to its
registered name; tests inject their own.

`greedy-baseline` is a frozen early evaluation kept only as a fixed reference for measurement. Do not
"improve" it; its whole value is that it never changes.
