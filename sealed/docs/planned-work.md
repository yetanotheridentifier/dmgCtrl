# Planned work

Where the next session picks up. **This is the only doc that tracks tickets and history**; every
other file describes what the software does now.

## Next up

The AI's remaining blind spots are measured, not guessed. `npm run bench --prefix sealed --
--decisions` reports how often every candidate move scores identically, so the seeded tie-break
picks at random:

| Decision | Coin-flip rate | Options |
| --- | --- | --- |
| Initiative | 18.2% | n/a |
| Which card to play | 7.4% | 4.7 |
| Attacks | 1.6% | 7.8 |
| Regroup: which card | 0.1% | 4.8 |

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

### The order from here

1. **#410 own-turn beam.** The genuinely expensive part: expanding **separate actions**, with a null
   move for the opponent, beam width K over depth, role fixed once at the root. The null-move
   assumption is where the strength comes from and where it leaks: it is what makes a
   sacrifice-into-Sentinel look right, and what will over-value lines the opponent can interrupt.
2. **#425 opponent reply.** The same pessimism one level wider, beam-limited to the top candidates.

**Re-measure before starting #410.** Quiescence moved every rate it touches: attack ties fell from
10.2% to 1.6%, and attacks were the blind spot #410 was sized against. Its case now rests on the
multi-step lines themselves rather than on a tie rate, so take the numbers again first.

**Measure four configurations, not two.** #410 is optimistic (the opponent does nothing) while #425
is pessimistic (they do the worst visible thing). Those pull in opposite directions and may not
compose additively, so the matrix is: neither, #410 alone, #425 alone, both.

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
