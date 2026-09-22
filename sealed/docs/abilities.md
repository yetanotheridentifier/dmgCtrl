# Card abilities

How a card's behaviour is declared, registered and dispatched. Read this when adding or fixing a
card.

## The approach: data-driven keywords, hand-coded effects

Keywords arrive structured in the card data (`Keywords[]`), so they drive engine hooks directly.
Card-specific abilities are hand-registered per card id and composed from a shared effect-primitives
library.

Parsing ability prose into effects was rejected: the source text is unstructured, so a parser is
brittle and every new phrasing is a bug. Hand-coding is tractable because a Sealed environment is one
set of roughly 250 cards, many of them vanilla, and each ability ends up precise and testable.

**Vanilla-by-default is the load-bearing property.** A card with no registry entry plays with its
printed stats and keywords. Card behaviour ships incrementally, card by card, without the engine ever
breaking.

## Why the registry is not in GameState

`GameState` is pure JSON: game records store `initialState + moves` and replay through the resolver,
and cheap structural cloning matters for search. Functions cannot serialise, so ability code lives in
a module-level registry in `engine/abilities.ts`:

```ts
registerCard(cardId, definition)      // merges: abilities append, hooks overwrite
getCardDefinition(cardId)             // the hooks
getAbilities(cardId)                  // the triggered abilities
collectUnitTriggers(state, point, unit, owner, ctx?)   // a unit's (and its upgrades') abilities, as data
collectCardTriggers(point, cardId, owner, src?, ctx?)  // a card with no instance: an event, an upgrade
collectLeaderTriggers(state, point, owner, ctx?)       // an undeployed leader's front side
triggerAbility(trigger)                                // the ability a collected trigger stands for
runPendingTrigger(state, trigger)                      // resolve one collected ability
fireBatch(state, owed)                                 // effects.ts: enqueue an event's batch and drain
```

`effect: (state, ctx) => state` is pure like everything else in the engine, with
`ctx: { owner, cardId, sourceInstanceId?, ... }`. Replays are deterministic **per app version**;
records already carry that dependency implicitly and the registry makes it explicit.

Real card behaviour is registered in `engine/cardDefinitions.ts`, a side-effect module imported by
`legalMoves.ts`.

## Dispatch

**Nothing fires on the spot.** An event collects everything it triggered as data, then hands the whole
batch to `fireBatch`, which enqueues it and drains it one ability at a time
(`engine/triggerQueue.ts`). Two properties follow, and both are the point:

- the controller orders the batch (CR 7.6.9, 7.6.10), including abilities that raise no choice and so
  would otherwise be over before anything could be asked;
- each ability resolves **fully** before the next begins (CR 7.6.12), so one that resolves later reads
  the board the earlier ones left rather than a snapshot of the moment the event happened.

The second is why a unit's targets are chosen as its ability resolves: a leader deployed by an earlier
ability in the batch is a friendly unit by the time a later "give a Shield to another friendly unit"
looks for targets.

`collectUnitTriggers` gathers a unit's own card abilities, each attached upgrade's, any card lent for
the attack, cards granted by an aura, and abilities handed over for the phase by a lasting effect. The
card list is snapshotted when the ability triggers rather than recomputed at resolution, so whether an
aura or a lasting effect granted it is settled at the moment of the event.

Each ability is attributed to the card it came from, not the host, so an upgrade's ability names the
upgrade. The `ctx` argument becomes `PendingTrigger.ctx` and is merged back into the `EffectContext`
when the ability runs, which is how the attack outcome reaches `onAttackEnd` and the captured unit
reaches `whenDefeated` (the unit has left play by then).

Most When Defeated abilities are written with the When Played helpers through `defeated` in
`cardDefinitions.ts`, as On Attack abilities are through `onAttack`. The source instance names no unit in
play, so "another" leaves nothing out, and an ability that reads the unit itself (Raddus's power) reads
`ctx.defeatedUnit`, the unit as it last was.

`runPendingTrigger` addresses one ability by `cardId` + `abilityIndex`, indexing the card's **full**
ability list, with `fromLeader` choosing between a card's unit abilities and an undeployed leader's.
A card carrying two abilities at the same point is exactly the case the ordering prompt exists for, so
they must stay individually addressable. `triggerAbility` is the same lookup, shared with the prompt
that names each waiting ability.

### One event, one batch

A batch is an *event*, not a call site: a unit entering play collects the upgrades it arrived with
attaching, its own When Played, and every "when you play or create a unit" reaction, and fires them
together. Splitting one event across several `fireBatch` calls would nest the later ones under the
earlier as though they had been triggered by them (CR 7.6.11), which is what `sameEvent` exists to
prevent where a caller genuinely must fill a batch in stages.

Ordering is only asked where it is a decision. Two kinds of ability resolve without a prompt:
**indistinguishable** ones (the same ability, on the same card, on the same unit, firing more than once
for one event, as when three upgrades leave a unit at once) and **inert** ones (a conditional trigger
whose condition is unmet *at that moment*, or one with no legal target). Inert is re-checked on every
pass, since an ability resolving earlier in the batch can meet a later one's condition. `choices.md`
owns both rules.

The inert probe runs within one side only. Whether **both** sides have something in the batch is
asked of the collected abilities as they stand, so an ability that triggers only to do nothing can put
a "who goes first" question to the active player. An ability whose condition is a property of the
event ("a **friendly** unit is dealt **non-combat** damage") states it as `hears` on its `AbilityDef`:
every collector checks it when the event happens, and an event it does not describe never collects
the ability. It is the trigger condition in the rules' sense, settled once, where inert is re-read on
every pass. The points heard on both sides are where it earns its place (`whenDamageDealt` uses it for
every registration).

### Ambush and Support are abilities, not keywords

Both read as keywords but each is a When Played ability ("When you play this unit, you may attack …"),
so they are registered as the pseudo cards `KEYWORD_AMBUSH` and `KEYWORD_SUPPORT` and collected into
the play batch like anything else. That is what puts them into the ordering question alongside the
card's own When Played. Raising their choice directly instead would stop the rest of the batch until
it was answered, since a choice on the board holds everything behind it.

Pseudo cards (`KEYWORD_*`, and the `GRANT_*` abilities one card hands to others) are not cards. The
setup panel's manifest, `data/implementedCards.ts`, must list every registered card id in any set, and
its test counts only ids shaped `<SET>_<number>`, so a pseudo card is left out and any other shape fails.

The unit's ready state is not part of that: entering ready so Ambush can attack is part of entering
play, and stays in `playUnitCard`.

**Shielded and Hidden are read from the unit's LIVE keywords once it is in play** (`applyEntryKeywords`,
shared by a unit played from hand and a leader deploying), for the same reason Ambush is: a unit can
gain either one only once there is a unit to look at. Privateer Scyk has Shielded while you control
another Cunning unit, and every friendly Inquisitor gains Hidden from the Grand Inquisitor; read from
the card alone, both are silently dropped. The Shield token is attached before anything reacts to the
unit arriving, so "when 1 or more upgrades attach to this unit" still fires for it.

### Trigger points

`whenPlayed`, `onAttack`, `whenUnitAttacks`, `onAttackEnd`, `onDefense`, `whenHealed`, `whenDefeated`, `whenReadies`,
`whenReadyStep`, `whenDrawn`, `whenUnitLeavesPlay`, `whenRegroupStarts`, `whenTakeInitiative`, `whenPlayUnit`, `whenCreateUnit`, `whenFriendlyEntersPlay`,
`whenUpgradeAttached`,
`whenFriendlyUpgradeDefeated`, `whenFriendlyUnitDefeated`, `whenEnemyUnitDefeated`,
`whenDamageDealt`, `whenEnemyAttacksBase`,
`whenFriendlyAttackEnds`, `whenDeployed`, `whenPlayUpgrade`, `whenPlayCard`, `whenUnitEntersPlay`,
`whenActionPhaseStarts`.

`whenPlayUpgrade` ("when you play an upgrade") fires on the player's undeployed leader, base and units,
with the card in `ctx.playedCardId` and, unless it went on a base, the unit it went on in
`ctx.targetInstanceId` ("when you play an upgrade on a unit: deal 1 damage to that unit", Dengar).
"When you play an upgrade on **this** unit" is not that point but the host's `whenUpgradeAttached`
with `ctx.upgradePlayed`, which carries who played it in `ctx.playingPlayer`: an opponent can play an
upgrade on your unit, and that is not "you". `whenPlayCard` ("when you play a Heroism card", Agent Kallus)
covers a card of **any** type, so it fires from all three play doors; the card is in
`ctx.playedCardId` and the condition on it belongs to the registering card. It fires on **both**
players' leaders, bases and units, the playing player's first, with who played in
`ctx.playingPlayer`, because the point is also printed from the far side ("when an opponent plays an
event", Saw Gerrera). As with `whenDrawCards`, every registration at this point compares
`ctx.playingPlayer` against `ctx.owner`. A card played out of a resource zone carries
`ctx.playedFromResources` ("when you play a card from your resources", Bail Organa). `whenUnitEntersPlay`
is collected from both players' bases and from every unit in play but the one arriving, for any unit
either player brings into play (Trap Field, and Phee Genoa hearing an enemy leader deploy).

The three defeat points (`whenDefeated`, `whenFriendlyUnitDefeated`, `whenEnemyUnitDefeated`) carry
`ctx.defeatedWhileAttacking` for an attacker defeated by the combat damage of its own attack, and the
phase records whose unit that was (`phaseEvents.defeatedWhileAttacking`, Oppression Breeds Rebellion).
`whenFriendlyUnitDefeated` reaches the controller's undeployed leader as well as their base and
surviving units (Luthen Rael).

`whenHealed` ("when 1 or more damage is healed from this unit", Silver Angel) fires on the healed unit
from `healUnit`, which is the one place a unit is healed, with what the heal actually removed in
`ctx.amountHealed` (Baze Malbus deals that much). A heal that removes nothing raises nothing.

`whenReadyStep` ("when you ready cards during the regroup phase", Millennium Falcon) is the player's
ready step, raised on every unit they control whether or not it was exhausted, in the same batch as
`whenReadies` (which fires only on a unit that actually readied). Its `payOrExhaust` with `orReturn`
returns the unit to its owner's hand on a decline, and resumes with the initiative holder as every
ready-step choice does.

`whenDrawn` ("when you draw this card", Rey) is an ability of a card in **hand**: `drawCards` collects it
from each card it drew, once the draw's `whenDrawCards` batch is done, with `ctx.drawingPlayer`. The
source instance is a `drawn-<card>-<index>` id, since a hand card has none.

`whenUnitLeavesPlay` ("when an enemy unit leaves play", Boba Fett) is raised wherever the phase
record's `leftPlay` is written: a defeat (in the defeat batch) and a return to hand. It is heard by both
players' undeployed leaders, bases and units, with the unit and its controller in `ctx.unitLeftPlay`.

`whenActionPhaseStarts` ("when the action phase starts", Beast Lair) fires for every unit in play and
each player's leader and base as the next round's action phase begins, on the same boundary as an
`actionPhaseStart` delayed effect and before play resumes. The game's **first** action phase raises
nothing, which is right for every card that can read it: a card has to be played during an action
phase to be in play to read the next one.

**A unit entering play raises its arrival triggers through one function, `collectArrivalTriggers`**, and
every route in goes through it: a play, a token being created, a leader deploying and a captured card
released back into play. All four fire `whenFriendlyEntersPlay` ("when a friendly unit enters play",
Outcast) on the controller's undeployed leader, base and **other** units, and `whenUnitEntersPlay` (Trap
Field) on both players' bases and other units, with the arriving unit in `ctx.targetInstanceId`. "When
you deploy a leader" is `whenFriendlyEntersPlay` with a guard that the arriving unit is a leader, and
"when an enemy leader deploys" is `whenUnitEntersPlay` with the same guard on the far side.

The route matters only where a card reads it. `whenPlayUnit` ("when you play a unit", Maz Kanata, Poggle
the Lesser) fires for a play alone, and `whenCreateUnit` for a token being created, so a card that reads
"play or create" (Greef Karga) registers both. **A deploy and a rescue raise neither**: a deployed leader
is considered deployed, not played (CR 3), and a released card is not being played either, but both are
entering play (CR 7.1), which is the distinction `whenFriendlyEntersPlay` exists to draw.

The arriving unit is left out of its own arrival, so a card that also reads "including this one"
(Outcast) covers that half with its own When Played, and one that does not (Boba Fett, Family Found)
gets the printed behaviour for free. Taking control of a unit raises nothing: it is already in play.

**Damage dealt is one point, `whenDamageDealt`**, for every card that reads damage from either end:
the damaged unit or base ("when this unit is dealt damage and survives", "when your base is dealt
damage", "when non-combat damage is dealt to a friendly unit or base") and the dealer ("when you deal
damage to an enemy base", "when you deal 4 or more damage", "when a friendly unit deals damage to an
enemy unit"). It fires once for each application of damage: one call of `applyUnitDamage` (so the
defender's and the attacker's combat damage are two events) or of `dealDamageToBase`. It is heard by
**both** players' undeployed leaders, bases and units, the damaged side first, and it joins the batch
of the defeats the same damage caused. `ctx.damageDealt` carries:

- `owner`: whose units or base took it;
- `units`: every unit dealt damage after prevention and Shields, with the amount and `survived`. A
  unit the damage defeated is still named (Logray reads the cost of one);
- `base`: the damage to `owner`'s base;
- `byCombat`, the only difference between Arena Acklay, who fires on an ability's ping, and Tarfful,
  whose head reads "dealt **combat** damage and isn't defeated";
- `dealer`: the controller and card, plus `unitId` when a unit in play dealt it. Combat damage names
  the attacker or the defender. Otherwise it is the source the damage was dealt with, or, when an
  effect deals damage without naming one, the effect resolving at the time
  (`GameState.resolvingSource`, set by `runAttributed` around every ability, action and resumed
  ability, and by answering a choice, as the card that raised it; never at rest). Damage with neither is dealt by nobody, which is correct for the
  damage a player deals their own base as a cost. The fallback feeds the event only: prevention
  still reads only a named source.

**Every registration's condition is its `hears`**, not a guard in its effect. The point is heard on
both sides, and an ability collected only to do nothing still puts its side in the batch; a batch
with both sides in it asks the active player who goes first. `hears` is the trigger condition,
settled when the event happens, so an event the card does not describe never collects it. The
readers in `cardDefinitions.ts` (`damageToFriendly`, `friendlySurvivors`, `survivedItself`,
`friendlyBaseDamaged`, `dealtByYou`) are the shared phrasings. A card printed "when **this** unit is
dealt damage and survives" is the survivors filtered to `ctx.sourceInstanceId`, and "a friendly unit"
(Jabba the Hutt) is the same list with the source dropped: there is no second point for either.

It is **not** the point for "when this unit deals combat damage to a base" (Obi-Wan Kenobi, Chopper,
Seventh Sister), which is `onAttackEnd` with `ctx.combatDamageToBase`: that is the attacking unit
itself rather than every unit that hears the event.

`whenDrawCards` fires on **both** players' units, with who drew in `ctx.drawingPlayer` and the size
of the draw in `ctx.cardsDrawn`. A card reads it either about itself ("when you draw", Axe Woves) or
about the other side ("when an opponent draws 1 or more cards during the action phase", Crosshair),
so **every registration at this point compares `ctx.drawingPlayer` against `ctx.owner`**; one that
does not will fire on both sides' draws.

A unit that dealt combat damage to a base is also recorded for the phase
(`dealtBaseCombatDamageThisPhase`), for the cards whose consequence outlives the attack (Moff
Gideon's surcharge on the units that opponent plays this phase). That record sits below base-damage
prevention, so an attack a prevention soaked entirely does not count, which is the distinction from
`baseAttackersThisPhase`: that one is written when the attack is declared. `whenDeployed` fires on a leader unit as it deploys, after its entry
keywords, in the same batch as that leader's arrival triggers.

Two attack-end points read the same on cards but mean different things, and conflating them makes a
unit fire on other units' attacks:

- **`onAttackEnd`** fires for the **attacker only**: "when *this* unit's attack ends".
- **`whenFriendlyAttackEnds`** fires for **every unit its controller has, plus their undeployed
  leader**: "when a *friendly* unit's attack ends".

`onAttackEnd` still fires if the attacker was defeated in the combat (CR 7.6), falling back to its
last-known state with its upgrades, and carries that attacker's card in `ctx.attackerCardId` so a
card can still read it ("another unit that costs less than it", Colonel Yularen). A card printed
"when this unit completes an attack (and survives)" is `onAttackEnd` with a guard that the unit is
still in play: the bracket is reminder text, not a point of its own. "When this unit attacks and
defeats a unit" is `onAttackEnd` with `ctx.defenderDefeated`; when the combat did the defeating, the
unit itself is in `ctx.defeatedDefender` (its cost, Drengir Spawn) and the damage past its remaining
HP in `ctx.excessCombatDamage` (Blizzard Assault AT-AT), as `whenDefeated` carries `defeatedUnit`.

The declaration has the same pair. **`onAttack`** is the attacker's own "On Attack";
**`whenUnitAttacks`** is the same event heard by **both** players' undeployed leaders, bases and
units, the attacker's own included, in the same batch as the On Attack. It carries the attacker in
`ctx.attackerInstanceId`, its target in `ctx.attackTarget` and whose attack it is in
`ctx.attackingPlayer`, so a card reads "a friendly unit attacks" (Boonta Eve Flagbearer), "another
friendly Official unit attacks" (Major Partagaz) or "an enemy unit attacks" (Barriss Offee) from one
point. As at `whenDrawCards`, **every registration compares `ctx.attackingPlayer` against
`ctx.owner`**. `whenEnemyAttacksBase` is narrower and older: the attacked player's units only, for
base attacks only, raised as the damage lands.

Two triggers fire **once per event, not once per item**, matching cards worded "1 or more":

- **`whenUpgradeAttached`** fires once however many upgrades attach together. Giving a unit three
  Advantage tokens is one event, so Sabine Wren offers one exhaust, not three. The boundary is one
  call to `giveTokens`, which attaches the whole batch and then fires: an upgrade attaching and that
  upgrade's own effect then granting tokens are two separate events and do fire twice.
- **`whenDrawCards`** fires once per draw, however many cards it drew.

Granting tokens one at a time in a loop therefore fires these triggers repeatedly and is a bug; use
`giveTokens` with a count.

### A compound trigger head is one block registered at each of its points

Cards are printed with a head that joins two or three trigger points with a slash: `When Played/On
Attack:`, `When Played/When Defeated:`, `When Played/On Attack/When Defeated:`. One ability block,
firing at either point.

There is no "fires at either" trigger and there wants to be none. `alsoAt(def, ...points)` in
`cardDefinitions.ts` writes the block once with the When Played helpers and copies it to each further
point, so the card carries one ability per printed point, sharing the block's text. Two copies at two
points is what the rest of the engine needs: `runPendingTrigger` addresses an ability by `cardId` plus
its index into the card's full list, so both stay individually addressable when both are waiting in one
batch and the ordering prompt has to name them apart. Only the When Played abilities are copied, so a
constant hook or a second printed ability at a third point rides along untouched (The Twins).

A card whose effect closes over the trigger name, to keep the two copies' choice ids apart, declares
its abilities explicitly instead, since `alsoAt` hands both copies one closure.

`onAttack` and `defeated` are the same retargeting for a block printed at **one** point that is not
When Played; they move the ability rather than copying it.

## Static hooks

Card-type-agnostic, all on `CardDefinition`:

| Hook | Effect |
| --- | --- |
| `costModifier` | cost delta, applied in `effectiveCost` |
| `whilePlaying` | Exploit's step on the card's own terms: any number of friendly units, each dealt `damage` and saving `discount` (The Marauder), or with `resources` any number of ready resources, each defeated and saving `discount` (Greater Sarlacc); see `choices.md` |
| `costDiscount` | a unit in play discounting cards its controller plays |
| `waivesAspectPenalty` | a unit in play zeroing the aspect penalty |
| `ignoresOwnAspectPenalty` | the aspect icons whose penalty a card ignores while it is played (Rey with Kylo Ren) |
| `attachRestriction` | may this upgrade attach to that unit, when this player plays it ("a friendly unit") |
| `conditionalKeywords` | extra keywords, folded into `unitKeywords` |
| `suppressedKeywords` | keywords removed while a condition holds |
| `swappedKeywords` | pairs of keyword names traded for one another, renamed over the finished list (Asajj Ventress); see `keywords-effects.md` |
| `statModifier` | power/HP deltas, folded into `effectivePower`/`effectiveHp` |
| `aura` | power/HP/keywords granted to **other** units |
| `damageMultiplier` | scales each incoming damage instance |
| `negatesOverwhelm` | defender-side, cancels trample |
| `preventBaseDamage` | caps an instance of base damage |
| `makesDamageUnpreventable` | ignores Shields and prevention |
| `dealsDamageFirst` | strikes before the defender |
| `spillsExcessToUnit` | excess damage to another unit instead of the base |
| `attacksEitherArena` | may attack units in either arena, not just its own |
| `cannotAttackBases` | the enemy base is not a legal attack target |
| `cannotBeAttacked` | not a legal target, and not a forced Sentinel target either |
| `cannotAttack` | may not declare an attack at all, on a unit or a base |
| `preventUnitDamage` | stops some of an instance of damage, with nothing to decide |
| `suppressesBaseHealing` | bases can't be healed while this card is in play |
| `readiesInRegroup` | whether this unit readies at regroup; absent means it does |
| `survivesNoHp` | the unit isn't defeated by having no remaining HP while this holds; the state-based sweep defeats it once it stops |
| `cannotReady` | the unit readies neither at regroup nor by an ability (Frozen in Carbonite) |
| `ifYouDo` | the rest of an ability after a choice partway through it (see [choices.md](choices.md)) |
| `delayed` | runs an effect the card left for later, once (see Delayed effects in [keywords-effects.md](keywords-effects.md)) |
| `printedStats` | replaces a unit's printed power/HP, before upgrades are added |
| `enemyCostDelta` | changes what an **opponent** pays for a card |
| `halvesCosts` | its controller pays half, rounded up, applied last |
| `providesAspects` | supplies aspect icons while paying costs |
| `deployCondition` | replaces the resource gate on deploying a leader |
| `suppressesFriendlyAdvantage` | Advantage tokens are not spent after combat |
| `searchModifier` | multiplies how many cards a **search** looks at |
| `doublesTokenCreation` | doubles a batch of created tokens |
| `entersReady` | the unit arrives ready, alongside Ambush and enters-ready grants |
| `unitsEnterReady` | every unit its controller plays or creates arrives ready (Ritual Dragon) |
| `ambushAttacksBases` | its controller's units may attack a base while using Ambush (Fett's Firespray) |
| `grantsAbilities` | hands an ability block to the host unit |
| `grantedTraits` | extra traits, e.g. The Darksaber granting Mandalorian |
| `cardTraits` | extra traits the card has **wherever it is**, in play or not (Zam Wesell copies her leader's) |
| `makesLeaderUnit` | the host counts as a leader unit |
| `actionAbilities` | activated "Action:" abilities, with `usable`, `oncePerRound`, `exhaustCost`, and `anyPlayer` for one offered on an enemy unit too, paid for and owned by whoever uses it |
| `canPreventDamage` / `payPreventionCost` | offers a prevention, and collects its price if taken |
| `preventionCostTargets` / `preventionCostText` | the units a prevention's price is picked from, and how the prompt names it (Queen Amidala) |
| `abilityDamageBonus` | adds to an instance of ability damage (Ty Yorrick's "plus 1") |
| `defeatsInsteadOfBaseUpgrade` | offers the unit's defeat in place of an upgrade on its controller's base (Vice Admiral Rampart) |
| `dealsCombatDamageByHp` | the attacker's combat damage is its remaining HP, not its power (Babu Frik's attack grant) |

Three of these are scoped more narrowly than they read.

**`attacksEitherArena` widens what a unit may target and must not widen what forces it.** Sentinel is
scoped by the arena the attacker stands in, so a ground Sentinel does not lock a space unit that merely
*may* reach the ground arena. See [keywords-effects.md](keywords-effects.md).

**`cannotAttackBases` restricts the attack target, not the damage.** An attack picks a legal target and
only then computes damage, so a unit with this hook still lands Overwhelm excess on the base after
attacking a *unit*. It bars declaring the base, nothing more, and it is one half of `canAttackBase`
(Sentinel forcing is the other).

**`searchModifier` belongs to the player, not the searching unit.** Arcana Star Map grants its host
"if **you** would search a number of cards from your deck, search twice that number instead", and units
do not search: players do. So every search that player makes is doubled while the host is in play,
whichever card is doing the searching, and `searchCount` takes the owner rather than a unit. Scoped to
the searching unit it would do nothing except when the upgrade happened to sit on the very unit that
searched.

## Leaders

A leader has two sides and they register separately on one card id:

- **`leaderAbilities`** is the undeployed (front) side: `actions` are activated, appearing in
  `legalMoves` as `useLeaderAbility` and gated on the leader being ready and affordable; `abilities`
  are triggered, and fire regardless of exhaustion.
- The top-level `abilities` are the deployed (back) side, registering exactly like a unit's.

The front side also carries two constant hooks, since an undeployed leader is not a unit and the unit
hooks never see it: `leaderAbilities.aura` (Director Krennic's "each friendly damaged unit gets
+1/+0"), shaped like `aura` with the leader's controller in place of a source unit and folded into the
same aura pass, and `leaderAbilities.waivesAspectPenalty` (Hera Syndulla), read by `effectiveCost`.
An undeployed leader's triggered abilities fire at `whenRegroupStarts` as well as at the leader-specific
points.

A front action is written with the When Played helpers through `leaderFront` in `cardDefinitions.ts`:
its effect is handed a context whose source is `<cardId>-leader`, so "another unit" excludes nothing
and every choice it raises still has a stable id. `usable` gates it, so an action is never offered
when it could do nothing. A card whose front and back both resume after a choice tell the two apart by
`step`.

A deployed leader and a created token unit both count as entering play (`enteredPlayThisPhase`), as a
unit played from hand does.

**Exhaustion only blocks abilities whose cost is exhausting.** A triggered front-side ability whose
cost is resources fires whether the leader is exhausted or not.

**A leader carries its ready state wherever it is, and "exhaust a friendly leader" has to follow it.**
In the base zone that is `leader.exhausted`; once deployed it is the leader unit's own `exhausted`,
and the base-zone flag is stale from that moment, since deploying never clears it and regroup readies
the two separately. `leaderCanExhaust` and `exhaustLeader` in `effects.ts` are the only correct way to
ask and to charge, and every handler for such a cost uses them.

The distinction is invisible for the four leader-FRONT costs, because `collectLeaderTriggers` returns
nothing once the leader deploys, so those can never meet a deployed leader. It is decisive for a cost
raised by a **unit** ability (Mando's N-1 Starfighter), which fires whatever the controller's leader is
doing. Charging the flag there left a deployed leader ready and its action unspent.

Deploying is an epic action requiring the player to **control** resources equal to the leader's
printed cost, not to spend them. A `deployCondition` hook replaces that gate where a card says
something else.

## Bases

A base is never played, never leaves play and is not a unit, so `baseAbilities` on the base's card id
belongs to the player whose base zone holds it:

- **`epicAction`** is an "Epic Action:", offered in `legalMoves` as `useBaseAbility` and usable once
  each game (`BaseState.epicActionUsed`). Taking it is that player's action for the turn. It picks
  nothing itself: an ability with a target raises a choice, as a leader's front-side action does.
  `usable` gates it, so the one use a game is never spent on nothing.
- **`aura`** is a constant over units in play (Pau City: "each leader unit you control gets +0/+1"),
  shaped like `leaderAbilities.aura` with the base's controller in place of a source unit, and folded
  into the same aura pass.
- **`startingHandDelta`** changes how many cards its controller draws to start (Colossus: one fewer),
  read by `initGame`.
- **`deckMinimumDelta`** changes the smallest legal deck (Data Vault: +10), read by `minimumDeckSize`
  where a decklist is checked. It is a deck-building rule, so the rules engine never consults it, and
  the bench's deck generator builds 30 cards whatever the base.

Epic Actions are written through `baseEpic` in `cardDefinitions.ts`, with `basePlay` for the ones that
play a unit from hand. The effect's source is `<cardId>-base`, so every choice it raises has a stable
id and "another unit" excludes nothing.

### Upgrades on a base (Fortify)

A card with the **Fortify** keyword ("Attach this to your base, not a unit") is played with
`playBaseUpgrade`, which names no target: it attaches to its player's own base, in `BaseState.upgrades`,
and never to a unit. `playUpgradeCardOnto` is still the one door, so an ability that plays such a card
from another zone sends it to the base whatever unit it named.

"Attached base gains: ..." makes the upgrade's ability the base's, so the base's abilities come from
`baseAbilityCardIds`: the base card and each upgrade on it.

- A **constant** is `baseAbilities.aura` on the upgrade card (Landing Pad), folded into the aura pass.
- A **triggered ability** is an ordinary `abilities` entry on the upgrade card, collected by
  `collectBaseTriggers` for the base's controller wherever an undeployed leader's would be
  (`collectPlayerTriggers`), plus friendly defeats and units entering play. Its source is `<cardId>-base`,
  and "this upgrade" is the first copy of the card on that player's base.
- An **action** is `baseAbilities.actions`, offered as `useBaseAbility` with the card and index. A
  `defeatsSelf` action pays "[defeat this upgrade]" before its effect; a `oncePerPhase` one is counted per
  copy in `PhaseEvents.baseActionsUsed`.
- **Damage prevention on the base** is `baseAbilities.interceptDamage`, asked first by `dealDamageToBase`
  (Alliance Shield Generator).

`defeatBaseUpgrade` defeats one: a card goes to its owner's discard pile and "when a friendly upgrade is
defeated" fires, as for an upgrade on a unit. An effect that picks "an upgrade" or "a friendly upgrade" sees one
on a base, named by the host `baseHostId(owner)` (see "Which upgrades an effect may target" in
`keywords-effects.md`); one that says "on a unit" does not. Nothing that reads a unit's upgrades counts
a base's, and the cards that read a base's upgrades count `BaseState.upgrades` directly.

## Once each round

`markAbilityUsed(state, owner, instanceId, key)` sets a key on the unit's `usedAbilities`. A
triggered ability guards on `usedAbilities.includes(key)` and passes `markUsed: { instanceId, key }`
in its choice, so the mark lands on **acceptance** and declining does not spend it. The list clears
when the unit readies at regroup, shared with the activated-ability path.

A `playCardFrom` choice carrying `markUsed` spends it before the play, so the play's own triggers
already see it spent. "Use this ability only once each phase" on a trigger that reads a play (L3-37
replaying an event) uses the same key: cards are played only in the action phase, and the list
clears before the next one begins, so once each round is once each phase there.

## Testing conventions

Per-card registrations get table-driven tests (registered card in, expected state out) using
`engineFixtures`. The framework itself is covered in `engineAbilities.test.ts` and
`abilityFramework.test.ts`.

Card text is authoritative from the card API, which serves the printed ability text; only Power/HP
are missing for some upgrades and are filled from `upgradeStatOverrides.ts`. Values the source data
gets wrong are corrected in `cardDataCorrections.ts`.

The whole-pool fuzz sweep (`npm run bench --prefix sealed -- --sweep`, with `--set` for sets other
than ASH) plays every card in the pool and surfaces a hang or throw as a dropped game with a replayable fixture, which is the broadest net
for a new card breaking an interaction.
