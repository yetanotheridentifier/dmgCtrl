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

### Re-weighting is exhausted, and only one weight is dead

A 146-cell interaction grid plus 8400-game validation across multiple seeds put the weight set at a
local optimum. **Further strength must come from new information, not from re-weighting what is
there.** The measured constraints live in [ai-model.md](ai-model.md); the tool is `npm run tune`.

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

1. **#425 opponent reply**, public information only. The cheap first step into pessimistic search, and
   the counterweight to the beam's optimism: the beam maximises over leaves, so it systematically
   prefers the branch most dependent on the opponent doing nothing. It also unblocks #447 and is the
   gate on the whole belief-model programme.
2. **#446 claim the initiative when it converts to lethal.** `hasLethal` from #433 now exists, so the
   only thing left to build is continuing the sequence across a **round boundary** rather than to the
   end of a turn. Initiative is still the largest single tie at 18.2%, ~7.4 coin flips a game. Temper
   expectations: #433 showed lethal detection itself is worth only ~+0.8 points, and this applies it
   to a narrower slice.
3. **Re-run `--terms`** once the matrix lands, and compare against the pre-registered predictions on
   #430: `resourceSurplus`, `saturation`, `hand.canAct` and `roleShift` should start mattering if they
   were dormant. Anything still flat is dead and can be deleted.
4. **#447 final search configuration**, after #425 and not before. Depth, width and reply policy get
   chosen jointly, because they are not independent: depth 4 measured **better** than the shipped
   depth 3 and was banked rather than shipped, since its value rests on four consecutive opponent
   non-actions and #425 is what changes that.

**Measure four configurations, not two.** #410 is optimistic (the opponent does nothing) while #425
is pessimistic (they do the worst visible thing). Those pull in opposite directions and may not
compose additively, so the matrix is: neither, #410 alone, #425 alone, both.

## Gated on the search matrix

**#396** (optional abilities and tokens) and **#398** (hand and resource optionality) are both "value
something whose payoff arrives later", and search covers the part of "later" inside its horizon. Land
the matrix, re-run `--decisions`, build only what still ties. The residue is genuinely latent value: a
Shield's worth being what it will prevent, held removal being worth the target it has not met yet.

That is the heuristic baseline. Stop there before ML.

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

Two rules, both learned the hard way.

- **Default a new weight to off, then sweep upward.** Shipping the default before the A/B ran once
  inverted the whole reading, because the candidate was then the ablation and below 50% meant better.
  It also put an unproven term in the shipped model for the length of the run.
- **Measure a lethal or a threat as a single action.** Players alternate actions, so aggregate reach
  across ready units is an intention the opponent gets several chances to answer, not a kill. Reading
  it as aggregate overstated lethal threefold and diluted the very signal being looked for.

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
