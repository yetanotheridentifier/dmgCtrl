# Planned work

Where the next session picks up. **This is the only doc that tracks tickets**; every other file
describes what the software does now.

**It does not record findings.** [experiments.md](experiments.md) holds what has been measured and
which avenues that closes off, and [ai-model.md](ai-model.md) holds the measured constraints that
explain the model's current shape. Evidence appears below only where it decides what to build next,
and then in one line with a pointer.

## Next up

Ordered on one principle: **correctness, then structure, then calibration.** Anything that changes the
engine or the horizon invalidates a calibration done before it.

1. **#516 extend the search across the round boundary.** The structural item, and the one that unblocks
   most of what is stuck.

   `search.ts` drops any node that leaves the action phase, so no board the bot can reach ever contains
   next round's damage. Four separate findings all terminate here: the initiative tie is the largest
   blind spot in the model at 15.3% of offers; the bot's claim rate is flat across every horizon
   bucket, so it demonstrably cannot see the difference; two evaluation weights cannot be judged
   dormant or dead until it can; and the shielded-Sentinel lockout pays out on the far side of it.

   **Four attempts to price something on the other side of that boundary have all failed** (see
   experiments.md). Build the horizon rather than a fifth proxy for it.

   The hidden-information rule is settled: the two cards drawn at regroup are **not** read, though one
   may be assumed resourceable. `drawCards` slices a fully-ordered deck held in state, so a search
   crossing regroup would otherwise see both players' actual draws. Deck-composition probabilities are
   deliberately out of scope.

   **Re-ask the lockout the moment it works**, and re-run term sensitivity: if the search can reach
   next round, the strip line finally contains its own payoff and two dormant weights become judgeable.
2. **Run the matchup matrix.** Now unblocked: the weights are settled, so it will not need repeating.
   Roughly **23 hours sharded** at 10 games a cell, against 169 serial.

   Per-cell numbers are noise at that size (±50% at 4 games). The readable aggregates are deck strength
   (±5.8%) and leader strength (±2.9%), and the genuinely interesting output is any leader whose
   measured strength disagrees with its real-play reputation, which is a queue of bot blind spots.

   It measures the **deck generator**, not the sealed metagame: one algorithmic build per leader and
   base. That gap is the point rather than a caveat.
3. **Two candidates from review, neither ticketed yet.** Both add information rather than re-pricing
   it, which is the strongest steer available: of six attempts to re-price something, one worked, and
   it was a search change.
   - **Claiming the initiative charges nothing for the cards it stops you playing.** The cost term
     counts ready units forfeited only, so claiming while holding an affordable bomb is free.
   - **Ready and exhausted power are priced identically.** Splitting them has a proven pattern: the
     Advantage weights already ship equal to `power`, so the correction is a provable no-op until
     swept.
4. **#479 complete the module list in `ai-benchmark.md`**, mostly done in passing.

## Gated on the horizon

Optional abilities, token value, and hand and resource optionality are all "value something whose
payoff arrives later", and all were closed once the search tie-break turned out to be the answer rather
than a new term. **One idea survived unbuilt** and is worth a ticket if the horizon lands: resource
count and hand SIZE are **public**, so "I am holding up three resources" may legitimately outrank the
board score, where "I hold Vanquish" cannot.

Re-run the decision diagnostic once the horizon extends, and build only what still ties.

That is the heuristic baseline. **Stop there before ML.**

### What ML would look like, and why the GPU sits idle until then

The machine has an **RTX 2080 Max-Q (8 GB)** and CUDA works under WSL2. It is untouched by any current
work, and that is correct rather than wasteful.

**The search cannot use it.** A GPU runs 32 threads in lockstep, so it needs many threads doing the
same operation on regular data. `resolve` is the opposite: a large switch over action types, card
abilities dispatched as registered closures, and a fresh object graph per call. Divergent branches
serialise, closures do not compile to kernels, and the state is not a flat array. GPU game simulation
works for bitboard games; the card-ability system is exactly the part of this engine that cannot
vectorise, and it is the part worth keeping.

**MCTS plus a network is where it fits**, in the standard split: tree search and self-play generation
on CPU, batched position evaluation on GPU.

- **MCTS probably arrives with the network, not before it.** Classic MCTS wants thousands of cheap
  playouts a move; `resolve` gives a few hundred nodes per 126 ms, so naive MCTS could easily be weaker
  than the shipped beam for want of samples. The network is what removes the need to play games out.
- **CPU and GPU share a thermal budget on a Max-Q laptop.** The GPU idles at 61 C purely from a
  saturated CPU, so expect alternating phases rather than both flat out.

The sharded bench harness is already the CPU half of this. Not a detour.

## Gated on the baseline: the opponent model

**#434**, which consolidated the five sub-tickets that used to sit under it.

The gate is **whatever the public search fails to recover**, and the measured headroom is small: a
one-action lethal is available to the opponent in 2.2% of decisions, absent before round 5, and 86% of
those positions are unavoidable. The belief model does not need to beat zero, it needs to beat the
public version, and it is the heaviest machinery in the series.

If it is built, the first customer should be the **general tap-out risk gate**, which applies to every
action-phase decision, rather than the carried initiative rules, which are worth 2 to 3 points across
about nine decisions a game.

One design question to settle deliberately rather than by accident: the opponent's deck comes from our
own generator, so a sampler could draw from the true generating distribution instead of inferring from
revealed aspects. More accurate, arguably legitimate, but a different honesty claim.

## After the baseline

- **Epic 7 data pipeline** (#403 export, #404 consent, #405 collection Worker, #406 training store).
  #403 is small and would let a self-play corpus accumulate from the current bot immediately.

## The card programme (parallel stream)

ASH is implemented. The other nine sets are not: 1,960 distinct cards, triaged by what the engine
cannot yet express rather than by how hard the text looks. The triage is repeatable and fetches live,
so the next set can be sized on release day. See [ai-benchmark.md](ai-benchmark.md).

It runs on its own branch alongside the AI work and shares nothing with it.

**The programme is #452 to #478.** GitHub holds them and their current state; this section holds only
the shape.

Two prerequisites block everything, neither of them card work. (A third, counting cards *played*
rather than *decked*, has shipped: the sweep reports `cardsPlayed` and names what was decked but never
drawn, which is what every acceptance criterion below rests on.)

- **#452** the sweep pool is hard-wired to ASH. Tickets are cut per mechanic, so every group's cards
  span all nine sets.
- **#478** the setup panel counts registered cards for ASH only, and the test that keeps the manifest
  honest filters to `ASH_` ids first. The first card registered outside ASH is invisible and nothing
  fails. It bites on the first card of #453.

Then two phases:

- **Phase 1 (#453 to #460), 1,073 cards blocked by nothing.** 65% of the pool is expressible with the
  primitives already in `engine/effects.ts`. Cut by trigger point. Events (#453) are the largest and
  most uniform batch.
- **Phase 2 (#461 to #476), 487 cards blocked by exactly one mechanic each**, ordered by how many cards
  each unlocks on its own.

**Batches shrink, never grow.** A card that turns out not to fit is lifted into #477 and the batch
ships without it. The classification is regex triage over ability prose: it catches new nouns but not
familiar nouns in an unfamiliar shape, and roughly 40 cards are expected to fall out this way.

Three findings that contradict the assumptions the programme started from:

- **Experience tokens are the largest single unlock at 89 cards, and were unplanned.** Printed in every
  set, and with Shield the most common token in the game.
- **Resource manipulation is near the bottom at 15 cards, not the top.** Most resource prose already
  exists. What matters is *playing a card out of the resource zone* (#468), which gates Smuggle and
  Plot, roughly 50 cards. The gap is that `payCost` exhausts resources in array order with no choice,
  stranding a resource the player meant to play.
- **Bounty is gated behind capture**, not resources.

The 292 vanilla and keyword-only cards need no ticket, reconciling set by set with `PLAYABLE_AS_PRINTED`
in `data/implementedCards.ts`. 29 cards with ability text are printed in more than one set, covering 30
extra ids for no extra work.

## Deferred

- **Web Worker** for the AI. **Downgraded, probably unnecessary.** It existed to stop a blocking search
  freezing a phone's UI, and Sealed is desktop only, where ~85 ms a decision reads as instant. Revisit
  only if a winning configuration lands in the hundreds of milliseconds, or if mobile happens.
- **Mobile and PWA adaptation** (#482). A redesign rather than breakpoints, and it would reinstate the
  Web Worker question.
- **Token-unit art**, and a permanent set for ASH tokens.
- **Unique rule on change of control.** The rule is built for units and upgrades and is per-player, but
  `takeControlOfUnit` never re-checks it. Two cases slip through: stealing a unique unit you already
  control, and your unique being stolen, you legally play your own second copy, then regroup handing
  the first back. The unit fix is a `uniqueUnitCheck` call for the receiving player; the upgrade check
  separately keys on the upgrade's owner rather than the controlling unit's controller, which is wrong
  for a stolen unit carrying one. Raising a mandatory choice during regroup needs thought first.
- **Per-player unique-symbol rule** (defeat a duplicate).
- **Offensive pinning.** Closed on prevalence rather than deferred; see experiments.md.
