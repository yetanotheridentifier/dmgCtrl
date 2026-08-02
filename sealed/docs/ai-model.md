# The AI model

What the opponent AI thinks, and the constraints that keep it coherent. Read this when changing how
the AI evaluates a position. For measuring a change, see [ai-benchmark.md](ai-benchmark.md).

## The driver

`makeGreedyAi(evaluate)` is one ply: for each legal move, apply it, score the resulting board from
the acting seat, take the highest. Because `resolve` is pure and `legalMoves` enumerates everything
including how choices are answered, this one loop covers playing, attacking, resourcing, claiming the
initiative and answering triggers, with no per-card rules.

Ties break from `state.rngSeed`, never `Math.random`, so replays and saved records reproduce exactly.

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
- **A node budget bounds the worst case**, defaulting well above observed chains. `support` fans out
  across every ready unit and every legal target, so the cap is a safety rail against the card pool,
  not a tuning knob. Exhausting it scores the board where it stopped, degrading to the old answer
  rather than a wrong one.

`greedy-flat` in the registry is the same AI without this, kept so the comparison can be re-run as
the evaluation changes underneath it.

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
| `roleShift` | how far the role bends the weights, see below |

The board term is built around what decides trades: unit **count** is the biggest swing, then power.
Remaining HP counts lightly, so damage reads as progress toward removal without a
surviving-but-damaged unit looking like a large loss. Only defeating a unit is the real swing.

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
numbers.

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
