# Planned work

Where the next session picks up. **This is the only doc that tracks tickets and history**; every
other file describes what the software does now.

## Next up

The AI's remaining blind spots are measured, not guessed. `npm run bench --prefix sealed --
--decisions` reports how often every candidate move scores identically, so the seeded tie-break
picks at random:

| Decision | Frequency | Coin-flip rate | Options |
| --- | --- | --- | --- |
| Attacks | ~34/game | 10.4% | 8.4 |
| Answering a pending choice | ~6/game | 26.8% | 6.5 |
| Initiative | ~9/game | 16.5% | n/a |
| Which card to play | ~23/game | 5.8% | 4.9 |

### One search, three policies

The three remaining search tickets are not three features. They are **one bounded tree search over
`legalMoves`** where a node's owner is `state.activePlayer`, differing only in what happens when that
owner is not us:

| Ticket | At an opponent node | Depth |
| --- | --- | --- |
| #400 | minimise our evaluation | the intervening-choice chain only |
| #410 | null move (pass), continue our own sequence | our own actions, budgeted |
| #425 | minimise our evaluation | one full reply |

So they share `ai/search.ts`: determinism, the node budget and the leaf-scoring rule live in one
place, and each ticket is a measurement rather than a separate implementation. It also makes #425's
standing question (does two-ply justify its cost, given MCTS supersedes it?) a config flag rather
than a new bot.

### Measured: who owes the unresolved answer

`--decisions` reports how often a candidate move is scored before its action has finished, split by
who owes the outstanding choice. Over 210 games, 14,536 decisions, 142,640 candidates:

| | positions | candidates | chosen move |
| --- | --- | --- | --- |
| **We** owe the answer | **42.9%** | 18.5% | **11.3%** |
| **They** owe the answer | 5.1% | 1.3% | 0.5% |

Our own owed choices, by kind: `mayLastingBuff` 8929, `selectUniqueUnitToDefeat` 3615, `support`
1762, `mayDamage` 1037. Theirs are a thin spread: `mayGiveTokens` 421, `damageAnyBases` 399,
`mayPreventDamage` 284, `peekTopDiscard` 281.

Two things follow.

**The pessimistic half is a footnote and the self half is the main event.** Modelling the opponent's
intervening choices touches 5.1% of decisions and 0.5% of actual moves. Finishing our own action
before scoring it touches 42.9% and 11.3%.

**`selectUniqueUnitToDefeat` at 3615 is a live blunder, not a horizon effect.** Playing a second copy
of a unique raises a mandatory defeat choice, and greedy scores the board with **both copies still on
it**: `unit` 4 plus power and HP, so a duplicate 3/3 reads about 13 points too high. The bot is
paying real cards for a unit it is about to be forced to defeat.

### The order

1. **#400 quiescent scoring.** Never score a half-resolved action: expand the owed-choice chain
   before evaluating, taking the max over ours and the min over theirs. Both sides at once, because
   it is one recursion and the ticket already owns the pessimistic half. Bounded by the chain, so it
   needs no beam and no budget, and it is where the measurement says the value is.
2. **#410 own-turn beam.** The genuinely expensive part: expanding **separate actions**, with a null
   move for the opponent, beam width K over depth, role fixed once at the root. Note `support` (1762)
   sits on this side of the line rather than in quiescence, since it opens a whole extra attack. The
   null-move assumption is where the strength comes from and where it leaks: it is what makes a
   sacrifice-into-Sentinel look right, and what will over-value lines the opponent can interrupt.
3. **#425 opponent reply.** The same pessimism one level wider, beam-limited to the top candidates.

Quiescence still goes first for the original reason as well: a beam scores hundreds of leaves where
greedy scored a dozen, so **any half-resolved leaf scoring is inherited and multiplied**. Fix leaf
scoring before deepening.

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
