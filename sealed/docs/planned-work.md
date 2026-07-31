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

1. **#410 self-lookahead** is the main gap. One ply cannot play a multi-step line at all: sacrificing
   into a Sentinel to clear it, or chipping a unit so a later ping finishes it, both look bad at the
   setup step. No evaluation tuning fixes that. It targets attacks, the highest-volume decision, and
   needs no opponent modelling, so it is far cheaper than #425.
2. **#396 optional abilities and tokens** next. Highest tie rate of anything measured, bounded scope,
   and it can reuse `ai/cardValue.ts` rather than growing a second value scale. It should absorb
   event valuation, since both need "score the state the effect produces".

Then stop and treat that as the heuristic baseline before ML.

## After the baseline

- **#398** hand and resource optionality. Largely subsumed by #410 plus #396; its held-removal value
  is private information, so it must be a tie-break unless there is evidence to promote it.
- **#400** worst-case opponent choices during your own action. Narrow.
- **#425** two-ply minimax. Deliberately last: MCTS supersedes it, so the standing question is
  whether the strength justifies the cost.
- **Epic 7 data pipeline** (#403 export, #404 consent, #405 collection Worker, #406 training store).
  #403 is small and would let a self-play corpus accumulate from the current bot immediately.

## Deferred

- **#397 leader deployment timing.** Measured as low impact: leaders die within a round of deploying
  only 2.5% of the time, and average deploy round is 4.7. Re-measure after role work changes timing.
- **Web Worker** for the AI before any search deeper than one ply, to keep in-app play responsive.
- **Token-unit art**, and a permanent set for ASH tokens.
- **Per-player unique-symbol rule**: controlling a second copy of a unique defeats one.

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
