# Player choices

How a decision is put to a player, answered, and described. Read this when touching anything that
interrupts play to ask a question: a "may" ability, a target selection, a search, or a prompt.

## The model

An interactive decision cannot be a callback, because the resolver is pure and game records replay
`initialState + moves`. So a choice becomes **game state**:

```ts
GameState.pendingChoices?: PendingChoice[]
```

`PendingChoice` is a discriminated union of ~71 `kind`s in `engine/types.ts`. Every variant carries
`id`, `controller`, and an optional `source` naming the card that raised it. Helpers live alongside
it: `activeChoice`, `findChoice`, `hasPendingChoices`, `pushChoice`, `removeChoice`.

`pushChoice` **guarantees a unique id** among pending choices, suffixing `#1`, `#2` on collision. Two
triggers on the same played unit would otherwise share an id and mislabel each other, and an ability
that fires more than once for one event relies on it.

## Answering

`legalMoves` → `choiceMoves` offers options for **every** pending choice the active player controls,
not just the head, so a player answers their own outstanding choices in any order they like.

- **`acceptChoice { choiceId, targetInstanceId?, deckIndex?, optionIndex?, baseTarget?, handIndex?, cardName? }`**
  takes the positive option.
- **`skipTrigger { choiceId? }`** declines.
- An **attack** can itself be the answer (Ambush, Support, "you may attack"), so `attack` carries an
  optional `choiceId` naming which choice it answers.

Choices are always removed **by id**. A player may answer any of their outstanding choices rather
than the head, so a "remove the head" helper consumed the wrong one and left the real choice pending,
making the answered ability appear not to resolve. There is deliberately no such helper.

**Whether a choice can be declined is a property of the card, not of the kind.** A kind shared by
cards that print "may" and cards that do not carries an `optional` flag, and `choiceMoves` offers
`skipTrigger` only when it is set. The unit and upgrade picks work this way: `selectUnitToDefeat`,
`selectUnitToReady`, `selectUnitToReturn`, `selectUnitToSteal`, `selectDistributeSource`,
`returnFriendlyUnit`, `selectPair`, `selectUpgradeToReturn`, `selectDamageTarget`, `selectHealTarget`
and `mayAttackAnyUnit`, and so do `mayLastingBuff` and `mayExhaustUnit`. Display of Strength and
Evasive Maneuver print no "may", so a kind whose name begins `may` is not by itself evidence that every
card using it offers a way out. (`mayDamage` and `mayGiveTokens` are the exceptions that default the
other way, and mandatory cards set `optional: false` on them.) `selectPair` changes nothing until both
units are picked, so an optional pair can still be declined at its second pick.

`distributeTokens` places every token (CR 3.7.2.b) unless the card says otherwise. `upTo` ("up to 5",
Elzar Mann) stops at any point (CR 8.30.1). `optional` ("you may", Helgait) declines only before the
first token: a player who takes a "may" must resolve as much of it as possible (CR 8.32.1).

`searchDraw` reads `upTo` the same way. A plain search is mandatory while anything matches, but "up to
2" (Grand Moff Tarkin) may draw two, one or none, so it keeps its Done from the first offer onwards.

Under the rules a mandatory effect with a legal target must take one, even when the only legal target
is the player's own unit. The AI needs nothing extra for that: it scores the legal answers, and a
choice with one answer is simply that answer. `multiPick` keeps its Done and `mayPlayUnitFromDiscard`
its decline, because every card using them reads "up to", "any number" or "you may", where stopping at
zero is legal. `chooseMode` has no decline: "choose one" is never optional.

`resumeAfterChoice` decides what happens as the queue drains: the active player finishes theirs
first, then control passes; round-start choices (`resumeAtInitiative`) begin the action phase with
the initiative holder, mid-turn choices `advanceTurn`.

### The rest of an ability

A choice is data, so it cannot hold the closure that finishes the ability that raised it. Most kinds
carry a named tail instead (`thenDraw`, `thenReadyIt`), which suits a follow-up many cards share. For
one card's own follow-up the choice carries an `IfYouDo` (`cardId`, `owner`, `sourceInstanceId`, an
optional `step`), and answering it runs that card's `ifYouDo` hook, told what was settled: the chosen
unit, upgrade or hand card, or the discarded card.

- **`mayPayThen`** is "you may <cost>. If you do, <effect>": resources, damage to the source, or only
  revealing an event. It is not raised when the resources cannot be paid.
- **`selectUnitThen`**, **`selectUpgradeThen`** and **`selectHandCardThen`** pick one thing and hand
  it on, for an ability that does several things to one pick or depends on it.
- A **`selectDiscard`** with `then.ifYouDo` hands on the card discarded (R2-D2, Ahsoka Tano).

`owner` is the player whose ability it is, not the one answering: Governor's Shuttle's second pick and
Ahsoka Tano's discard are the opponent's to answer and still the player's ability to finish. `step`
tells stages apart and carries what a later stage needs (Death Trooper's friendly then enemy pick; the
units already picked by an "each of up to N"). `hookOnDecline` runs the hook once more on Done, for an
ability that goes on after its picks stop (AAT Incinerator).

`selectUpgradeToReturn` offers a free replay only with `replayFree`, which is Jabba the Hutt's own
text; other cards that return an upgrade print no such thing.

`distributeDamage` with `enemiesOf` is Emperor Palpatine's "divided among enemy units": it re-offers
only enemy units and has no Done while one remains. `distributeHealing` heals a point at a time from
units or bases until Done, then deals what it healed to `damageUnit` (Redemption), and `oneUnit` keeps
every point on the first unit picked (Kashyyyk Defender).

## Ordering triggered abilities

The rules let players order triggered **abilities** (CR 7.6.9 - 7.6.12). That is a different queue from
the one above, and it has to be: most abilities resolve without asking the player anything, so a batch
is not visible in `pendingChoices` at all. A trade where one side draws a card and the other looks at a
deck top leaves a single entry there, which reads as "only one side owes something" and asks nothing.

So abilities are collected as data before they run:

```ts
GameState.pendingTriggers?: PendingTrigger[]
```

One entry per **ability**, not per unit: a unit's own ability and one granted by an upgrade attached to
it are two abilities their controller orders. `collectUnitTriggers` snapshots the card list at the
moment of triggering, which is also the more correct reading of when an aura's grant is settled.
`drainTriggers` then resolves the batch, stopping wherever a player has something to decide.

**Every** event's abilities go through this, not just defeats. That is what makes an ability read the
board as the abilities before it in the batch left it, rather than as it stood when the event happened:
a leader deployed by one ability is a friendly unit by the time a later "give a Shield to another
friendly unit" in the same batch picks its targets. `abilities.md` owns the collecting half.

### The two questions

| Choice | Rule | Asked when |
| --- | --- | --- |
| `chooseTriggerOrder` | CR 7.6.10 | abilities owed on **both** sides: the **active player** picks which player goes first, and only that |
| `chooseNextTrigger` | CR 7.6.9 | that player owes **two or more distinguishable** abilities: they pick which of their own resolves next |

Neither is ever offered over the opponent's internal order. `chooseNextTrigger` carries each candidate's
own `cardId` and `sourceInstanceId`: a prompt that cannot name the card is useless where one unit
carries two, and one that cannot name the unit is useless where two units carry the same card.

Two things keep the question to the cases where it is a decision.

**Indistinguishable** abilities are not offered. The same ability, on the same card, on the same unit,
firing more than once for one event offers nothing to choose between: three upgrades leaving a unit at
once is three identical Zeb Orrelios reactions.

**Inert** abilities are not offered either. A conditional trigger whose condition is unmet, or one with
no legal target, would change nothing, and `inertNow` asks by running it and seeing whether the state
comes back unchanged. Effects are pure, so the probed board is discarded and only the answer kept, and
a card states an unmet condition by returning the state it was given, which is what makes the question
answerable without a per-card declaration that could drift from its own effect. Probing happens only
where two or more abilities are owed, since one resolves either way.

**The probe runs with the trigger already off the queue**, exactly as `runOne` resolves it, and that is
load-bearing rather than tidy. An effect can fire a nested batch: attaching a token fires "when an
upgrade attaches". If the probe ran against a board that still owed the ability being probed, that
nested drain would find it waiting and probe it again, unboundedly. It overflowed the stack on a real
board, and made a single decision cost a minute on another. The comparison is against the probed board
rather than the original, or removing the trigger would itself read as a change and nothing would ever
look inert.

**Inert is a fact about now, not about the ability**, so it is re-asked on every pass rather than
settled when the batch was collected. An ability that can act resolves before one that cannot, and the
board is read again afterwards: playing Luke Skywalker (ASH_112) with two units out triggers his "if you
control at least 4 units" alongside Grogu's deploy offer, and deploying Grogu is what meets it. Spending
Luke while he was still inert would decide that for the player.

Where nothing in the batch can act, order cannot matter: none of them can change what the others see.

**Both gate the queue.** While either is pending, `choiceMoves` offers only that choice. Without the
gate a player could answer one of their own triggers instead and settle the order by accident.

### Nesting is a layer, not a position

**CR 7.6.11 and 7.6.12**: an ability triggered *while resolving* another resolves before anything
triggered at the same time as its parent, and each layer resolves fully before returning to an earlier
one. A nested ability is therefore **not orderable** against the batch it interrupted, so ordering
questions are asked within a layer and never across two.

`enqueueTriggers` assigns the layer, and the signal is simply that **the queue was not empty**: it is
only non-empty between firing and draining, so anything arriving in that window was triggered by
resolving something already in it. The exception is a caller filling one event across several calls,
which passes `sameEvent`: the combat damage step damages each side separately, but the units it defeats
die together.

Assigned at enqueue rather than after the answering action completes, because a drain can happen in
between. Damage dealt while answering a trigger's choice defeats a unit, and `applyUnitDamage` drains
before control returns to the resolver, so a layer assigned later is assigned too late.

The CR's worked example is the test: two units trade, one's When Defeated defeats a third unit, and that
third unit's trigger resolves before the opponent's original, with no ordering prompt in between.

### Draining, and who is active

`drainTriggers` moves `activePlayer` to each ability's controller so a choice it raises reaches the
right side, and **restores it on a full drain**. Only on a full drain: stopping to ask a question
deliberately leaves it on the chooser.

The restore is load-bearing. A batch that resolved silently once left `activePlayer` parked on the last
ability's owner, the attack path read "the attacker" back out of that state and got the defender,
and `advanceTurn` then flipped the turn to the wrong player for the rest of the game.

### The AI

The bot answers both through quiescent scoring, which drives the owed chain before scoring, so each
option is priced by the boards it reaches rather than the board it starts from. Where options tie,
`settleTriggerOrderTie` takes option 0: resolving first for CR 7.6.10, and collection order for
CR 7.6.9. That is a regression guard rather than a preference. Both were fixed sensible answers before
the questions existed, and asking must not turn them into a coin flip.

**Neither is raised by a card**, so both are exemptions in the source-attribution guarantee below.
`chooseNextTrigger` more than covers the gap: it names every waiting ability's source individually,
which is more than a single stamped source could say.

**Prompt volume is a known cost.** Three of one player's units dying together asks two questions even
when all three abilities do the same thing. Suppressing the prompt where order cannot matter is
deliberately not attempted: "cannot matter" is hard to establish, and getting it wrong silently removes
a real decision.

### A decided game has no pending choices

**CR 6.6.2**: once a player's base has 0 remaining HP they "cannot take any actions, and cannot resolve
any abilities or effects", and CR 1.16.5 ranks base defeat first among the state-based situations that
pre-empt waiting triggers. So winning discards whatever was waiting, in two places:

- `checkWin` clears `pendingChoices` when it sets a winner.
- `pushChoice` refuses to add one to a decided game.

Both, because whether a trigger is raised before or after the win check varies by card and by code path.
A choice left pending on a won game is **unanswerable**, since `legalMoves` returns nothing once
`winner` is set, so it strands whatever is presenting it: an attack that won the game while triggering
Camtono put a card-reveal on top of the game-over screen that could be neither played nor dismissed, and
the menu could not be reached.

The rule belongs in the engine rather than in overlay ordering. A choice that does not exist cannot be
rendered, whereas a UI fix would leave the impossible state in the model for the next surface to trip
over.

### Suspending combat

An attack that raises a choice mid-flight splits into `beginAttack` (exhaust, Restore, `onDefense`,
suspend into `GameState.pendingAttack` if a choice is raised) and `completeAttack` (the damage step,
recomputed on the post-choice board per CR 6.3.4). It re-finds attacker and defender, so a ping that
defeats either fizzles gracefully, and clears Support-granted keywords last so they survive the
suspension.

## Every choice can name the card that raised it

A prompt has to be able to say *why* the player is being asked, which matters most when the choice
came from the opponent's card.

**One exemption, and it should stay at one.** `chooseTriggerOrder` is raised by the rules rather than by
a card: it exists precisely *because* two cards triggered at once, so naming either would be arbitrary
and misleading. Its overlay lists the waiting triggers with their own sources, which is the real answer
to "why am I being asked this". `choiceSource.test.ts` carries the exemption as a one-element list, and
anything a card raises must still name that card.

Threading a source through by hand does not hold: there are **~185 `pushChoice` call sites**. There
are only **five** places an ability effect is invoked, and each already knows its card, so the source
is **stamped automatically**:

- `PendingChoice` gains `source?: DamageSource` via a **distributive conditional**
  (`T extends unknown ? T & { source? } : never`). A plain intersection collapses the union and
  breaks every `Extract<PendingChoice, { kind: 'x' }>` in the UI and tests.
- `stampChoiceSource(before, after, source)` diffs choice **ids**, not array length, because an
  effect can remove choices as well as add them. A choice that already names a source keeps it, so
  the most specific source wins when effects nest.
- Follow-ups raised while *answering* a choice inherit the answered choice's source, carrying the
  original card down an arbitrarily long chain. The resolved choice's own id counts as absent there,
  because repeatable picks (`multiPick`, `distributeDamage`, `dealOwnBaseForDiscount`) re-offer
  themselves under the same id and still need the source.
- A `GRANT_*` pseudo card is an internal ability carrier with no card-database entry, so it declares
  `sourceCardId` naming the real card, and prompts show that instead.

## Every choice also says what it is asking

Naming the source is half of a usable prompt. `choiceBody` in `utils/describeChoice.ts` writes the
instruction, and it is an **exhaustive switch**: the `default` branch assigns `choice` to `never`, so
adding a kind to `PendingChoice` without a prompt is a **compile error**.

That matters because the fallback is not merely vague, it can be wrong. A damage-prevention offer
rendered as "choose a target on the board" reads as *pick something to hit*, which is the opposite of
what it asks, and a player will reasonably conclude the decision was handed to the wrong side.

Two guards, catching different failures:

| Guard | Catches |
| --- | --- |
| Exhaustive `switch` on `choice.kind` | a new kind with no prompt, at compile time |
| `choicePrompt.test.ts` coverage sweep | a prompt that exists but renders as the fallback or empty in a real game |
| `choiceSource.test.ts` coverage sweep | a choice that cannot name the card that raised it |

The combined guarantee is that every choice reaching a player renders as
**`<the card that caused it>: <what you must do>`**.

Button labels are the same problem in a different place. `describeAction` never falls through to a
kind's internal name, and a bare `Accept`/`Decline` is avoided where it would be ambiguous: a
prevention offer reads `Prevent 1` / `Take the damage`.

**A tail effect belongs in both.** `selectDamageTarget.thenHealBase` carries the second sentence of a
card that damages and then heals, and the prompt and the log entry both name it. The log is the only
record of an effect the board can hide: a base healed and then hit again on the opponent's next
action looks like a heal that never happened.

## Presentation

- **Board-target kinds** (`BOARD_TARGET_KINDS` in `describeChoice.ts`) are answered by clicking a
  highlighted unit or base. The list lives next to the prompt table so the two cannot drift.
- **`CardSelectOverlay`** is the centre-screen card picker: click the highlighted card to choose it,
  with a Cancel only when the choice is optional. Token art included.
- **"Look at a card" is PRIVATE.** The overlay renders only for the human's own choice, so the AI's
  look-at never surfaces and hidden information is preserved. A future public "reveal" reuses the
  shell with a public prompt and a confirm action.
- **A look that leads somewhere raises the follow-up from both answers.** Qi'ra looks at a hand and
  then names a card, and her look is view-only, so Done is the only way to answer it: a tail hung on
  the accept path alone would never fire. `lookAtHand.thenNameCard` is raised on the skip path too.
  `multiPick.thenAttackWith` is the same rule: Hotshot Maneuver's attack follows its damage picks
  whether they ran out or the player pressed Done.
- **An attack that follows another waits for it to end.** "Attack with 2 units (one at a time)" lends
  the first attacker a carrier whose attack-end ability raises the second `mayAttackAnyUnit`. Raising
  both up front would let the second be answered while the first is still suspended on an On Defense
  or prevention choice, since a player may answer any outstanding choice. The follow-up excludes the
  unit that just attacked, and each step's `attacker` filter and `optional` flag come from the card.
- **Naming a card either forbids it or prices it.** `nameCard` without a surcharge records a
  prohibition, enforced in `legalMoves` (Ryder Azadi). With one, the named card stays playable and
  costs the opponent that much more, charged in `effectiveCost` (Qi'ra). The two must not be confused:
  a surcharge left in the prohibition set would make the card unplayable instead of dear, so
  `namedByOpponent` filters those units out.

### Searching always shows what it looked at

A search reveals the cards it examined even when none of them match, because they are about to go to
the bottom of the deck and knowing which ones is worth having. Pressing **Done** sends them there.

The trap is that some search kinds are mandatory and have no decline, so pushing an empty-eligible
choice would leave zero legal moves and deadlock the game. The rule is therefore: **offer the
acknowledge move only when nothing is eligible**, which keeps a real pick mandatory.

**What a search is looking for lives on the choice, not in the resolver.** `searchPlayFree` carries a
`filter` (trait, aspect or arena) and applies it again on every re-offer, because a search that plays
several cards re-derives its eligible set after each one. Hardcoding one card's filter there made every
other search-and-play offer the wrong cards, silently: Admiral Ackbar's "space unit" is not L3-37's
Droid or Darth Vader's Villainy unit.

**Where the cards physically are decides how they are put back**, and getting it wrong either
duplicates them or deletes them. `searchPlayFree` holds its window *out* of the deck while the choice
stands, so it bottoms the leftovers by appending. A first-pass `searchDraw` leaves the window on top of
the deck and bottoms by rotating. A multi-draw re-offer is the mixed case and marks itself `held`, so
both its accept and its Done treat the window as already removed.

A search that **plays** what it finds is normally free, and `budget` is the combined cost it may spend.
`costDelta` is the other form: a discounted purchase (Kelleran Beq's "it costs 3 less"), where
eligibility is what the player can still afford rather than what fits the budget, and the resources are
spent as the card is taken.

## Unique rule

A player cannot control two cards with the same unique title. Both checks are keyed by card id
(a deck's duplicates share one), applied **per controller**, and re-run so three or more copies
resolve down to one.

- **Upgrades:** `uniqueUpgradeCheck(state, owner)` runs after every attach path. Two or more unique
  upgrades of one card id raises `selectUniqueToDefeat`; you pick one to defeat (mandatory, no
  cancel, centre-screen overlay). Keyed on the upgrade's `owner`, so the opponent's copy does not
  conflict.
- **Units:** `uniqueUnitCheck(state, owner)` runs at the end of `enterUnit`, covering every
  play-a-unit path. It raises `selectUniqueUnitToDefeat` as a **board-target** selection, since the
  copies may differ in damage and upgrades.
