# Planned work

Where the next session picks up. **This is the only doc that tracks tickets and history**; every
other file describes what the software does now.

## Next up

The AI's remaining blind spots are measured, not guessed. `npm run bench --prefix sealed --
--decisions` reports how often every candidate move scores identically, so the seeded tie-break
picks at random:

| Decision | Coin-flip rate | Options | Coin flips per game |
| --- | --- | --- | --- |
| Initiative | 18.2% | n/a | **~7.4** |
| Which card to play | 7.4% | 4.6 | ~1.5 |
| Answering a choice | 7.4% | 8.7 | ~0.9 |
| Attacks | 1.7% | 7.8 | ~0.5 |
| Regroup: which card | 0.1% | 4.8 | ~0 |

The last column is what actually ranks the work: a rate is meaningless without how often the decision
arises. **Initiative is the largest remaining blind spot by a wide margin.**

### One search, three policies

The search tickets are not separate features. They are **one bounded tree search over `legalMoves`**
where a node's owner is `state.activePlayer`, differing only in what happens when that owner is not
us:

| Ticket | At an opponent node | Depth |
| --- | --- | --- |
| #400 (shipped) | minimise our evaluation | the owed-choice chain only |
| #410 | null move (pass), continue our own sequence | our own actions, budgeted |
| #425 | minimise our evaluation | one full reply |

They share `ai/search.ts`: determinism, the node budget and the leaf-scoring rule live in one place,
and each ticket is a measurement rather than a separate implementation. It also makes #425's standing
question (does two-ply justify its cost, given MCTS supersedes it?) a config flag rather than a new
bot.

### #400 quiescent scoring: shipped

Measuring who owes the unresolved answer decided the order, and inverted it. The pessimistic half
that #400 originally scoped touched 5.1% of positions; the same recursion pointed at our **own** owed
choices touched 42.9%. So the ticket became "never score a half-resolved action", both sides at once.

**76.7% and 78.4% ± 2.9% across two seeds (1700 mirror games), 72.7% ± 3.4% on the matchup harness.**
The largest single improvement in the series, because it corrects a fiction rather than refining a
judgement. See [ai-model.md](ai-model.md) for the model and its properties.

### Weight tuning is closed

A 146-cell interaction grid plus 8400-game validation across multiple seeds found the weight set at a
local optimum. **Further strength must come from new information, not from re-weighting what is
there.** The measured constraints are in [ai-model.md](ai-model.md); the tool is `npm run tune`.

The sweep also showed *why* so much of the model is inert: a one-ply evaluation only ever compares
candidates from one position, so any term equal across them cancels exactly. Several weights are not
dead but **dormant**, pricing futures that one ply cannot see. #430 makes that testable.

### The order from here

Three cheap measurements first, because the last two rounds of work both showed that measuring beats
guessing by a wide margin.

1. **#430 term sensitivity.** Which evaluation terms actually vary across candidates. Minutes of
   compute, and it would have predicted every null result in the 400,000-game sweep. Also the gate
   for deciding which dormant terms wake up after lookahead.
2. ~~**#431 bench harness fixes.**~~ Done. Seats and first player now alternate independently across
   all three harnesses, and the wall clock no longer decides a game's fate. An AI measured against
   itself reads 49.99% over six seeds, against 49.67% before. See
   [ai-benchmark.md](ai-benchmark.md).
3. **#432 hidden-information sizing.** Both cheap measurements are **done**, over 1260 games.
   Lethal is available to the opponent in 6.6% of decisions and is **nearly absent before round 5**
   (twice in 60,749 decisions), so the initiative-lethal rules are narrow. Of the positions where
   they could finish, **76.6% were unavoidable**, and the remaining avoidable ones carry a 10.5 point
   loss-rate penalty at five standard errors.

   **All of it is public**, so the headroom belongs to a deeper public search rather than to a belief
   model, which raises the bar for #434 to #436 considerably. The next step is a **public tap-out
   gate A/B** rather than the oracle originally scoped: it turns a correlation into a measured win
   rate, ships on its own merits if it wins, and cleanly separates "cannot search" from "cannot see
   their hand".

Then the search work:

4. **#433 `hasLethal`.** A shared one-turn lethal solver, perfect information. #410 needs it
   regardless of what #432 says.
5. **#410 own-turn beam.** Expanding **separate actions**, with a null move for the opponent, beam
   width K over depth, role fixed once at the root. The null-move assumption is where the strength
   comes from and where it leaks. **Its original justification is gone**: it was sized on attack ties
   at 10.2%, now 1.6% after quiescence. It now rests on initiative (18.2% ties, the largest remaining
   blind spot) and on the multi-step lines themselves, which need a scripted position rather than a
   rate.
6. **#425 opponent reply**, public information only. The cheap first step.

**Measure four configurations, not two.** #410 is optimistic (the opponent does nothing) while #425
is pessimistic (they do the worst visible thing). Those pull in opposite directions and may not
compose additively, so the matrix is: neither, #410 alone, #425 alone, both.

### The opponent model, gated

#434 pool, #435 sampler, #436 `P(lethal)`, #437 calibration, #438 learned priors, #439 PIMC. All
**gated on #432**: they are the heaviest machinery in the series, and their originally proposed first
customer (the carried initiative rules) is the weakest term in the evaluation, worth 2 to 3 points in
total. If the belief model is built, its first customer should be the **general tap-out risk gate**,
which applies to every action-phase decision rather than the ~9 initiative decisions a game.

#432 also settles a question that should not be decided by accident: the opponent's deck comes from
our own generator, so a sampler could draw from the true generating distribution instead of inferring
from revealed aspects. More accurate, arguably legitimate, but a different honesty claim.

**Measure four configurations, not two.** #410 is optimistic (the opponent does nothing) while #400
and #425 are pessimistic (they do the worst visible thing). Those pull in opposite directions and may
not compose additively, so the matrix is: neither, #410 alone, #425 alone, both.

### Then re-measure before building any more evaluation terms

**#396** (optional abilities and tokens) and **#398** (hand and resource optionality) are both "value
something whose payoff arrives later", and search covers the part of "later" inside its horizon. Both
are now gated: land the search matrix, re-run `--decisions`, build only what still ties. The residue
is genuinely latent value, a Shield's worth being what it will prevent, held removal being worth the
target it has not met yet.

That is the heuristic baseline. Stop there before ML.

## After the baseline

- **Epic 7 data pipeline** (#403 export, #404 consent, #405 collection Worker, #406 training store).
  #403 is small and would let a self-play corpus accumulate from the current bot immediately.

## Deferred

- **#397 offensive pinning.** Its direct-pinning half is cut: two-ply (#425) computes "do not deploy
  the leader into a board that kills it" from the real resolver, so a hand-coded power-versus-HP
  check would duplicate the search and then need keeping consistent with it. The 2.5% leader-death-
  after-deploy rate becomes a #425 behaviour readout. What remains is recognising when **we** pin
  their leader and holding the unit ready, which no board-score maximiser finds because holding is a
  non-action. Unsized, so measure before building.
- **Web Worker** for the AI, needed before shipping anything deeper than one ply **in-app**.
  Benchmarks are headless, so measure the whole search matrix first and build the Worker only if the
  winning configuration needs it.
- **Token-unit art**, and a permanent set for ASH tokens.
- **Unique rule on change of control.** The rule itself is built for both units and upgrades, and is
  per-player, but `takeControlOfUnit` never re-checks it. Two cases slip through: stealing a unique
  unit you already control, and (more likely) your unique being stolen, you legally play your own
  second copy, then regroup handing the first one back. The unit fix is a `uniqueUnitCheck` call for
  the receiving player; the upgrade check separately keys on the upgrade's owner rather than the
  controlling unit's controller, which is wrong for a stolen unit carrying one. Raising a mandatory
  choice during regroup needs thought before either is built.

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
