# Player choices

How a decision is put to a player, answered, and described. Read this when touching anything that
interrupts play to ask a question: a "may" ability, a target selection, a search, or a prompt.

## The model

An interactive decision cannot be a callback, because the resolver is pure and game records replay
`initialState + moves`. So a choice becomes **game state**:

```ts
GameState.pendingChoices?: PendingChoice[]
```

`PendingChoice` is a discriminated union of ~86 `kind`s in `engine/types.ts`. Every variant carries
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

A card offers only the modes that can do something as it resolves, and a mode that would raise a
mandatory attack is offered only while an attack is possible, so picking it never strands the player.
Most modes are engine keys resolved in `applyChosenMode`. A `chooseMode` with `then` is resolved by
the card instead: its `ifYouDo` runs with the picked mode as `step`, and `labels` name each button
(Teeka, Mon Cal Cruiser). Hunter's "choose two" raises its second choice once the first has resolved:
at once after a Shield, or from the attack's end after an attack, as an attack sequence does.

"Choose two, in any order" (Vigilance, Command, Aggression, Cunning) is `chooseTwoWp`: a `chooseMode`
over the modes that can do something, keyed `1:<mode>`; the picked mode runs, and the second choice
(`2:<mode>`, over the rest) is owed through `thenAfterChoices`, so it is raised only once every pick the
first mode made has been answered. The player therefore orders the two by choosing them one at a time.
A mode that needs picks of its own (Command's friendly unit, then the enemy it damages; Aggression's
second upgrade) chains them through the card's `ifYouDo` steps.

`resumeAfterChoice` decides what happens as the queue drains: the active player finishes theirs
first, then control passes; round-start choices begin the action phase with the initiative holder,
mid-turn choices `advanceTurn`. A round-start choice is one the action phase opened with (a `whenReadies`
pick, or a delayed effect "at the start of the next action phase" such as Han Solo's defeat), which
`startNextRound` marks with `pendingRoundStart`; a `payOrExhaust` raised by readying also carries
`resumeAtInitiative`.

**Control returns to the player whose action it was.** A choice another player answers (an opponent's
On Attack pick, a combat prevention offer, a trigger order that puts the other side first, a reactive
trigger's "may") hands `activePlayer` to its controller and records the actor in `pendingResumeActive`.
Once every choice and trigger has drained, `resumeAfterChoice` restores that actor and clears the
marker **before** any of its exits (a suspended attack, regroup, a deferred initiative), so no marker
outlives its choices. A leftover one would be read by the next choice to drain and give the other
player two actions in a row. `resumeMarker.test.ts` plays every set's coverage decks and asserts no
marker is set in a live position with nothing outstanding.

### The rest of an ability

A choice is data, so it cannot hold the closure that finishes the ability that raised it. Most kinds
carry a named tail instead (`thenDraw`, `thenReadyIt`), which suits a follow-up many cards share. For
one card's own follow-up the choice carries an `IfYouDo` (`cardId`, `owner`, `sourceInstanceId`, an
optional `step`), and answering it runs that card's `ifYouDo` hook, told what was settled: the chosen
unit, upgrade or hand card, or the discarded card.

- **`mayPayThen`** is "you may <cost>. If you do, <effect>": resources, damage to the source, or only
  revealing an event. It is not raised when the resources cannot be paid. With `declineStep` the hook
  also runs on a decline, at that step, for an ability that goes on either way: "you may deal 5 instead"
  (Attack From All Sides), or a yes-or-no the opponent answers (I Am Your Father, whose "no" is the
  accept).
- **`selectUnitThen`**, **`selectUpgradeThen`** and **`selectHandCardThen`** pick one thing and hand
  it on, for an ability that does several things to one pick or depends on it.
- **`selectCardThen`** picks a card id, from a discard pile or from cards revealed off a deck, and hands
  on the card and its option index; the hook decides where the card goes (Psychometry, Restock, For a
  Cause I Believe In). A deck holds duplicates, so a hook that needs a position reads the index.
- **`choosePlayerThen`** ("choose a player": the opponent, then yourself) and **`chooseArenaThen`**
  (ground, then space) are never optional and hand on `playerChosen` or `arenaChosen`.
- **`chooseNumber`** with an `IfYouDo` hands on the number as `optionIndex` (Choke on Aspirations'
  "up to 5").
- A **`selectDiscard`** with `then.ifYouDo` hands on the card discarded (R2-D2, Ahsoka Tano).

`owner` is the player whose ability it is, not the one answering: Governor's Shuttle's second pick and
Ahsoka Tano's discard are the opponent's to answer and still the player's ability to finish. `step`
tells stages apart and carries what a later stage needs (Death Trooper's friendly then enemy pick; the
units already picked by an "each of up to N"). `IfYouDo.unit` carries a unit an earlier stage chose to
the next (Strike True's friendly unit, then the enemy it damages). A card that picks several things in
turn keeps the picks so far in its step, so "another" and "sharing a Trait" can be checked against
them (Attack Pattern Delta, Bold Resistance, Unlimited Power, whose damage all lands after the last
pick). `hookOnDecline` runs the hook once more on Done, on `selectUnitThen`, `selectUpgradeThen` and
`selectCardThen`, for an ability that goes on after its picks stop (AAT Incinerator, Sweep the Area,
Jump to Lightspeed).

A hook resumed this way runs as its card's (`resumeAbility`): the choices it raises carry that card as
their source, and damage it deals is dealt by that card. Answering any choice runs the same way, as the
card named in its `source`, so damage the answer deals without naming a source is that card's (a
friendly ability's damage, for Ty Yorrick). The prevention offer is the exception: its `source` is the
damage being prevented, which is not the answering player's card.

### Replacement effects

A "you may ... instead" (CR 7.7.5) is asked where the event it replaces is about to happen, and the
event waits on the answer.

- **`mayPreventDamage`** is the damage case. Mid-combat it suspends the attack into `pendingAttack`
  before any damage is committed; for ability damage the damage is deferred into the choice. With
  `costTargets` its price is a unit the player picks (Queen Amidala: another friendly unit sharing a
  trait with her), one accept per unit.
- **`mayDefeatInstead`** is Vice Admiral Rampart's: "If an upgrade on your base would be defeated, you may
  defeat this unit instead." Every defeat of an upgrade on a base goes through `defeatUpgradeAt`, which
  raises it while its controller has such a unit, and the upgrade stays until it is answered. Accepted,
  the unit is defeated and the upgrade stays; declined, or if the unit has left play meanwhile, the upgrade
  is defeated. Whatever defeated the upgrade carries on either way, because a replaced cost is still paid
  (CR 1.8.10) and the text after "If you do" still resolves (CR 8.9.2): Bacta Tank's action still puts the
  card on the deck, and Insurgent Camp still readies the unit. The unique rule's defeat of a duplicate is
  not offered, since the rule would find the two copies again at once.

**"Then, ..." after a part that may raise any number of choices** is `thenAfterChoices`: it owes the
card's `ifYouDo` at a step as an entry in the trigger queue (`PendingTrigger.resume`). The queue
resolves nothing while a choice is open, so the step runs once the last pick the ability raised has
been answered, whichever choice kind that was. Owe one at a time: a second owed while the first waits
nests under it and resolves first, so a part's own follow-up picks chain through its steps instead.

`selectUpgradeToReturn` offers a free replay only with `replayFree`, which is Jabba the Hutt's own
text; other cards that return an upgrade print no such thing. The replay (`mayPlayUpgradeFree`) offers
only units the upgrade's `attachRestriction` allows and plays it through `playUpgradeOnto`, like any
upgrade whose cost is already dealt with: the upgrade's own When Played fires, it counts as played, and
the unique rule applies.

`distributeDamage` with `enemiesOf` is Emperor Palpatine's "divided among enemy units": it re-offers
only enemy units and has no Done while one remains. `distributeHealing` heals a point at a time from
units or bases until Done, then deals what it healed to `damageUnit` when there is one (Redemption; Midnight
Repairs has none), and `oneUnit` keeps every point on the first unit picked (Kashyyyk Defender).

`lookAtHand` narrows a compelled discard with `discardFilter` (a non-unit card, or an event) or
`discardAspects` (a card sharing an aspect with a unit, Hold For Questioning). `playUnitFromHand` can
also damage its controller's base by the unit's cost (`thenDamageOwnBase`), give the unit a lasting
effect (`thenLasting`), leave a delayed effect about it (`thenDelay`), and defeat a set of units once the
play is settled whether it was played or declined (`thenDefeat`, Consolidation of Power). With `then` it
hands on to the card's hook once the unit is on the board and paid for, with the played card in
`cardChosen`: General Grievous's "play 2 units from your hand (one at a time)" is two plays rather than
two simultaneous offers, so the second prices its candidates against the resources the first one left.
`searchPlayFree` caps its plays with `maxPlays` (U-Wing Reinforcement's "up to 3") and takes `thenDelay`
too, caps each unit's own cost with `filter.maxCost` where there is no combined budget, and deals
`thenDamage` to each unit as it is played (Darth Vader, Any Methods Necessary); `searchDraw` with `shuffle` shuffles the deck after a search of all of it (Search Your Feelings), and
with `then` hands on to the card's hook once the search is settled, whether a card was drawn or not
(Captain Vaughn puts a card from his hand back on the deck, and it can be the one just drawn).
`nameCard` with `phaseBan` bans the name for both players until the phase ends (Transmission Jamming);
with `then` it records nothing and hands the name to the card's hook as `nameChosen` (Zuckuss, Chimaera).

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

`searchPlayUpgrade` (Reforge) offers only upgrades whose `attachRestriction` allows the unit, pays the
cost less its `discount`, bottoms the leftovers, and then plays the chosen card through the same door as
an upgrade played from hand.

### Exploit: units chosen while paying

**Exploit X** (CR 7.5.16) is "while playing this card, you may defeat up to X friendly units; for each
unit defeated this way, this card costs 2 less". It is used at step 3 of Play a Card (determine the
cost), so it is a step inside the play rather than an ability that triggers from it.

`exploitTerms` says whether a card asks and on what terms: the printed numeral, plus any Exploit the
card gains as it is played (instances stack, 7.5.16.b): a `NextUnitGrant` with `exploit` (Count
Dooku's deployed side), or `extra` from the ability doing the playing (his front). The limit is capped
at the friendly units there are, and a card with none to pick asks nothing. The Marauder is the same
step on its own terms, declared as its `whilePlaying` hook: any number of units, each dealt 1 damage
and each saving 1. Greater Sarlacc is the step on **resources**: "defeat any number of ready resources
you control; for each, this unit costs 3 less". Its picks are cards in the resource zone, answered by
`optionIndex` from the menu rather than the board, since facedown resources are not on it. Any card in
the zone may be picked, up to the ready count, because which cards are the ready ones is the player's to
arrange (CR 1.7.4); each defeated counts as a ready one, so the ready count falls by one per pick.

- **Legality reads the best case.** `canAffordFromHand` asks whether the effective cost less what the
  step could save fits the ready resources. For units that is the most it could save. For resources
  each pick is also one fewer resource to pay with, so every number of picks is tried: three ready
  resources play a 9-cost Greater Sarlacc for nothing, and two cannot.
- **The `exploit` choice comes before anything is paid.** The card stays in hand; the player picks
  friendly units one at a time. **Done is offered only once what is left to pay is affordable**, so a
  play that needs its discount cannot be stranded half paid, and reaching the limit finishes the play
  by itself.
- **The cost is read before the units go** (`exploitCost`), with the chosen units still in play: a
  unit that was discounting the card or providing an aspect icon still counts, since the cost is
  determined at step 3.
- **The defeats' abilities join the play's batch.** "Abilities that trigger while defeating units using
  Exploit resolve only after the Play a Card action has finished resolving, at the same time that a
  unit's When Played abilities resolve" (7.5.16.d). `defeatForCost` defeats the units and hands their
  collected abilities back, and the play fires them with its own, so the player orders an exploited
  unit's When Defeated against the new card's When Played. The Marauder's damage is dealt as ordinary
  damage and resolves what it triggers at once. A defeated resource triggers nothing.
- **The exploited units' powers are recorded** on the unit played (`exploitedPowers`), as read when
  they were defeated, for the When Played that counts them (Count Dooku).

The step belongs to the Play a Card action from hand (`playUnit`, `playEvent`) and to Count Dooku's
front, which raises it itself with its Exploit 1. **The other ways to play a card do not offer it**:
`playCardFrom`, `playUnitFromHand`, the free plays and the discard grants pay the card's effective cost
with no exploit step. No card in the sealed sets both has Exploit and is commonly played that way.

In the AI the step is an ordinary chain: quiescence scores Done and each pick, within its budget.

### Playing a card out of another zone

**`playCardFrom` is the one door for a play that is not the Play a Card action**: a card of any type,
out of `zone`, answered by `optionIndex` into its `candidates`. The zones are `hand`, `resources`,
`opponentResources`, `deckTop`, `discard` and `opponentDiscard`, plus three **paired** zones for a
card offered out of either of two places at once: `handOrResources`, `handOrDiscard` and `anyDiscard`
(both players' piles). A paired zone is one zone holding one list, in the order the card names them,
so an index past the first half names the second.

`free` bypasses the cost and the aspect penalty (CR 8.5), `costDelta` adjusts it, and `waive` forgives
aspect penalties: all of them, the ones from named icons (Osha's Villainy), or exactly one of the
named icons (the LAW bases' "1 of its Vigilance, Command, Aggression, or Cunning"). "One of" needs no
pick from the player, since every penalty is the same 2 resources.

**A card played out of a zone somebody else owns is still theirs.** CR 1.5.2 ties ownership to the
deck a card started in, and playing it does not move it: `zoneCardOwner` reads the owner off the zone
and the index (for a resource, off `ResourceState.owner` where it is recorded), and the three type doors
take it as `cardOwner`. The doors also tell "when you play a card" whether the card came out of a
resource zone (`ctx.playedFromResources`, Bail Organa). So a unit played out of an opponent's
discard pile enters play under its player but is defeated into **its owner's** pile, an upgrade
attaches with that owner recorded on the attachment, and an event goes back to their discard when it
resolves. A unit whose owner and controller differ this way is `controlUntil: 'permanent'`, since
nothing hands the card back.

An upgrade cannot be priced until its host is known, so it goes on to **`attachPlayedCard`** and pays
there. `then` is how the play differs from a plain one and what follows it: the replacement resource
(`resourceTop`), Osha's "you may resource a card from your hand" (`mayResourceFromHand`, its own
choice), Endless Legions' "one at a time" (`again`, re-offering the rest re-indexed against the
shortened zone, capped by `againLimit` where the card reads "up to N"), Improvise's "if you don't,
you may discard it" (`elseMayDiscardTop`, offered only on the decline), and, about the card just put
into play, `entersReady`, `delay` ("at the start of the next regroup phase, defeat it"), `damageIt`
and `tokens`. The `again` re-offer fires from **either** step, since a unit's or an event's play
finishes at the pick and an upgrade's at the attach. `always` raises the choice even with nothing
playable, so a player still sees what they looked at and the decline's tail still runs.

**Two comprehensive-rules facts decide what it costs**, and neither is inferable from the engine:

- **A card in its controller's own resource zone helps pay for itself.** CR 6.2.f orders the steps
  "Pay cost(s)" (4) then "Put card into play" (5), so the card is still a resource while the cost is
  paid; CR 14.e says so outright for Smuggle. The budget is therefore the whole ready count, the card
  included, and `payCost`'s `prefer` exhausts that card before any other, which costs its controller
  nothing because it is leaving the zone anyway.
- **Which resources a payment exhausts is not a player decision.** CR 1.7.4 lets a player rearrange
  their resources at any time up to the point a specific one is chosen, including which are ready and
  which exhausted, so long as the counts hold. Only the counts are game state, so no payment can
  strand a particular card and there is nothing here to put to the player.

`playUnitFromHand` remains the shorthand for an ability that plays a **unit** from hand, which 23
cards use and which is answered by `handIndex`; `playCardFrom` is what a play of any other type, or
out of any other zone, uses.

### "For this phase, you may play that card from a discard pile"

The one play-from-a-pile shape that is **not** a choice. It is a standing permission on the **Play a
Card action**, taken later, on a turn of the player's own, among their normal moves, so a pending
choice (answered now or declined now) is the wrong instrument for it.

A `DiscardPlayGrant` in `state.discardPlayGrants` names who may take the play, whose pile the card is
in, which card it is, and its terms (`free`, `costDelta`, `waive`, and `tokens` for the unit once it
arrives). `legalMoves` turns each live grant into a `playFromDiscard` action, one per legal host where
the card is an upgrade, re-reading affordability and legality each time, because a grant outlives the
board that created it. A grant whose card has left the pile offers nothing.

**The permission resolves through `playFromZone`**, exactly as a `playCardFrom` does, so paying, taking
the card out of the zone and handing it to the door for its type is stated once for both shapes. The
grant is spent on use and cleared unused as the regroup phase starts, alongside `bannedNames`.

The permission need not be its own player's: Stolen AT-Hauler gives an opponent a free play out of
**its owner's** pile, which is the case ownership above exists for. `searchDraw` can leave one
directly, with `discardIt` putting its find in the pile instead of the hand and `grantPlay` naming
the terms ("search the top 10, discard it, and for this phase you may play that card from your
discard pile").

**Every play of an upgrade goes through one door**, `playUpgradeCardOnto`, whatever zone the card came
from and whether or not it was paid for: from hand (`playUpgradeOnto`, including Cin Drallig's and
Jabba's free plays), from a deck search (Reforge), from another zone (`attachPlayedCard`) and from the
top of the deck (Camtono's `mayPlayTopFree`). The caller takes the
card out of its zone and deals with the cost; the door attaches it, records it as played (for the phase,
and on the host for the round), fires the upgrade's own When Played in one batch with the host's attach
reactions (with `upgradePlayed`, so "when you play an upgrade on this unit" fires too), and runs the
unique rule.

**Every attach, played or not, is one write**, `attachUpgrades` in `effects.ts`, which only the door calls
with `played`. The attaches that are not plays still fire the new host's "when 1 or more upgrades attach
to this unit" (Sabine Wren), but not "when you play an upgrade on this unit" (Gar Saxon), and never count
as played:

| attach | why it is not a play | host's attach reaction |
| --- | --- | --- |
| a token given by an effect (`giveTokens`) | tokens are created, not played (CR 3.7.2, 3.7.2b) | fired once per grant |
| the Shield on a Shielded unit entering (`applyEntryKeywords`) | Shielded gives a Shield token (CR 7.5.12a) | fired in the unit's entry batch |
| Jocasta Nu moving an upgrade to a different unit | the upgrade detaches and attaches simultaneously (CR 3.6.14) | fired on the new host |

Detaching is not being defeated, so a move fires nothing on the old host ("when a friendly upgrade is
defeated" stays silent). A leader deploying with Shielded gets its Shield without an attach reaction
firing; no leader has one. `upgradeAttachSites.test.ts` checks that `attachUpgrades` is the only append to
a unit's upgrades and names every call to it, so a new attach fails until it is classified.

**Every play of a unit goes through one door too**, `playUnitCard`: from hand as an action (`playUnit`),
and from each ability that plays a unit, whether from hand (`playUnitFromHand`), a deck search
(`searchPlayFree`), the discard (`mayPlayUnitFromDiscard`) or the top of the deck (Camtono's
`mayPlayTopFree`). An ability play is still a play (CR 6.2.0a), so the door records it as played this
phase before anything else, then enters the unit, fires its arrival batch and runs the unique rule. A unit
that arrives without being played (a token created, control taken, a captured card released, a leader
deployed) does not record. Each of those still *enters play*, though, and raises the arrival triggers for
it; taking control is the exception, since that unit is already in play. `unitPlaySites.test.ts` names
every append to a player's units, every call to `recordCardPlayed` and which arrivals collect the arrival
triggers, so a new arrival fails until it is classified.

## Unique rule

A player cannot control two cards with the same unique title. Both checks are keyed by card id
(a deck's duplicates share one), applied **per controller**, and re-run so three or more copies
resolve down to one.

- **Upgrades:** `uniqueUpgradeCheck(state, owner)` runs after every attach path. Two or more unique
  upgrades of one card id raises `selectUniqueToDefeat`; you pick one to defeat (mandatory, no
  cancel, centre-screen overlay). Keyed on the upgrade's `owner`, so the opponent's copy does not
  conflict.
- **Units:** `uniqueUnitCheck(state, owner)` runs at the end of `playUnitCard`, covering every
  play-a-unit path. It raises `selectUniqueUnitToDefeat` as a **board-target** selection, since the
  copies may differ in damage and upgrades.
