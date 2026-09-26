# Keywords, auras and effects

How a unit's live power, HP and keywords are computed, and how effects that outlast a single action
are represented. Read this when working on combat, stats, or anything that modifies another card.

## Where a unit's stats come from

`stats.effectivePower` / `effectiveHp` and `keywords.unitKeywords` are the only sanctioned readers.
Each sums, in order:

1. printed values from the card database, or the replacement a card in play declares for them
   (`printedStats`: Obi-Wan Kenobi makes each friendly unit's printed power and HP 7, Size Matters Not
   makes its host's 5);
2. attached upgrades, which add on top of whichever of those two applies;
3. `statModifier` / `conditionalKeywords` hooks on the unit's card and its upgrades;
4. **auras** from other units in play (`auraContributions`);
5. **lasting effects** aimed at the unit (`lastingEffectTotals`).

Combat and every defeat check go through these helpers, so a keyword granted by an aura or a
"this phase" buff shapes attack targeting for free.

Step 1 is narrower than the source data suggests. SWUDB's `Keywords` is a union over everything a
card's text mentions, so a card that gains a keyword conditionally, or hands one to other units,
ships it as a printed keyword of its own. Only what is printed on the card belongs in step 1:
`cardDataCorrections.ts` strips the rest, and the ability grants it back where it belongs, at step 3
or 4. A wrongly printed Sentinel is the one that bites, since it redirects enemy attacks.

The union is literal enough to catch the **word** "Keyword" or "Keywords" where a card's text names a
keyword it does not have: a card that hands out "the chosen Keyword" (Admiral Yularen) or counts "more
different Keywords" (Maul) ships `Keyword` in its own list. None of those is a keyword, and they are
`cardDataCorrections.ts` entries like the rest.

For a **leader**, the source's `Keywords` describes the unit side, and the card's BackText spells that
side's keywords out line by line. So a keyword the source lists that the back does not print belongs to
whichever units the leader gives it to (Omega's Grit), one the back prints that the source omits is
simply missing (The Warrior's Ambush and Raid 1), and a numeral the source drops is restored from the
back (Darth Vader's Raid 1). All three are `cardDataCorrections.ts` entries.

### Which cards supply a unit's abilities

`abilityCardIds(unit)` is the single definition: the unit's own card, each attached upgrade, and any
card lent for a single attack. **Every ability lookup routes through it.** The list used to be spelt
out at each site and the spellings drifted, so an ability whose hook happened to live at a
granted-blind site was silently never lent.

Duplicates are deliberate and must not be collapsed: two copies of the same upgrade on one host each
contribute.

Abilities travel; **printed traits do not**.

### Swapping one keyword for another

```ts
CardDefinition.swappedKeywords?: (state, unit) => [from, to][]
```

"For this attack, replace any Raid it has or gains with Restore, or vice versa" (Asajj Ventress).
Each pair is registered in both directions and applied as a **rename over the unit's finished keyword
list**, after every grant and every removal: each instance keeps its numeral and answers to the other
name, so a Raid 2 reads as Restore 2 wherever Restore is read.

Running last is what makes "has **or gains**" true. The alternative, granting the counterpart and
suppressing the original, has to read the old numeral before hiding it, and suppression is by name
and applies to the whole list, so the grant would strip itself. A rename has neither problem and sees
sources that do not exist yet when the ability resolves.

A swap is a property of the cards on the unit, so it rides in on `abilityCardIds` like any other
hook: Asajj's is on a carrier card lent to the attacker for one attack, and it ends when the loan does.

## Traits: one read for a card anywhere

```ts
cardTraits(state, cardId, owner?)   // a card's traits, in play or not
unitTraits(state, unit)             // that, plus what is attached to the unit
```

`cardTraits` is the read every trait question goes through, because a trait is a property of the
**card**, not of the unit it happens to be on, and two effects address cards no unit hook can reach:

- a card gives itself traits **wherever it is** (`CardDefinition.cardTraits`, Zam Wesell copies her
  controller's leader's Traits except Force, in hand and deck as well as in play);
- an effect takes a trait off **one player's whole card pool** for the phase
  (`GameState.traitsRemoved`, The First Legion names one, and it reaches cards not in play).

Both need to know whose copy is being read, which is what `owner` is for: the grant reads that
player's board, and the removal is aimed at one player's cards. A read with no owner gets the printed
traits, which is all that can be said about a card nobody owns.

`unitTraits` adds what an upgrade lends (`grantedTraits`, The Darksaber) and takes away
(`removedTraits`). It looks the controller up only when a card-level rule is actually live, so the
ordinary case costs what it always did.

**A filter that takes an `EngineCard` rather than a card id reads the printed row** (`printedTrait`,
and the `test` hooks on the play-from-hand and play-from-zone choices). Those see neither of the two
effects above.

## Auras: constant effects on other units

```ts
CardDefinition.aura?: (state, source, target, sameController) => { power?, hp?, keywords? } | undefined
```

Applies while the source unit (or an attached upgrade) is in play, to **other** units.
`auraContributions(state, target)` scans every in-play unit and sums the contributions.

**Constraint:** an aura must not read the target's *computed* keywords or power, because that
recurses through the aura pass. Inspect card data and traits instead; `unitHasTrait` is safe, and
`nonAuraKeywords` answers "which keywords does this unit have, with their numerals" from every source
except auras. `nonAuraKeywordNames` and `nonAuraKeywordValue` are the two shapes of it callers
usually want. That is what a card which reacts to a keyword (Kylo Ren's Command Shuttle) or scales
one (Marchion Ro doubles Raid) needs, and the same read serves an aura asking about its own
**source** rather than its target: The Ghost lends the other friendly Spectres whatever it has, so
what another aura gives The Ghost does not travel on.

An aura can be combat-conditional: the combat roles are threaded into the aura call, so "while
attacking" and "while defending" auras work. `CombatContext` carries `attackerInstanceId`,
`defenderInstanceId` and whether the attack was declared `viaAmbush`, and it reaches **both** sides'
stat contexts: an aura can therefore debuff the attacker (Lando Calrissian, Electrostaff) as well as
the defender, and can read a property of someone else's attack (Enfys Nest takes 3 power off the
defender while any friendly unit attacks using Ambush). The combat reaches the keyword pass too, so an
aura can grant a keyword for one attack (Miraj Scintel: a friendly attacker gains Overwhelm against a
damaged defender).

**"While this unit is in play, the chosen unit gets ..."** (BD-1, Huyang) is an aura, not a lasting
effect: the source records its pick in `UnitState.chosenUnitId` and its aura reads that field. It
outlives the phase, and it ends the moment either unit leaves play, with nothing to clean up.
A pick that is a **keyword** rather than a unit works the same way in `UnitState.namedKeyword`
(Admiral Yularen: "each friendly Vehicle unit gains the chosen Keyword").

## Reading a computed stat from inside the pass that computes it

Some cards genuinely have to: "while you control a unit with 4 or more power" (Praetorian Guard),
"while this unit has 4 or more power, it gains Overwhelm" (Vonreg's TIE Interceptor). Power reads
Raid, Raid is a keyword, and keywords read these hooks, so the two passes can re-enter each other and
two such units can recurse forever.

Both passes therefore hold a set of the instance ids they are currently computing, and answer a
**nested request for an id already in flight** from a cheaper source: `unitKeywords` falls back to
printed keywords alone, and `effectivePower` to printed-and-upgraded power plus "this phase" buffs.
Neither can change a non-cyclic computation, which never re-enters the same id, and the fallbacks are
what the recursion is trying to avoid rather than an approximation of it. `statModifier` has held the
same guard since a pair of Kelleran Beqs blew the stack.

## Lasting effects

```ts
GameState.lastingEffects?: LastingEffect[]
// { targetInstanceId, power?, hp?, keywords?, untilEndOfAttack?, untilRoundEnd?, abilityCardIds?,
//   cannotAttack?, cannotAttackBases?, cannotBeAttacked?, unlessSentinel?, removeKeywords?,
//   noCombatDamage?, attackersPower?, cannotReady?, preventNext?, preventEach?, survivesNoHp?,
//   redirectDamageTo? }
```

`addLastingEffect` appends one; `lastingEffectTotals(state, instanceId)` sums those aimed at a unit.
Folded into stats and keywords exactly like auras.

**The card's text decides how long one lasts**, and there are three durations:

| Text | Effect | Expires |
| --- | --- | --- |
| "for this phase" | the default | at the start of the regroup phase, in `clearLastingEffects` |
| "for this attack" | `untilEndOfAttack: true` | when that attack finishes, in `clearAttackGrants` |
| "this round (including during the regroup phase)" | `untilRoundEnd: true` | as the next round starts, after the ready step, in `clearRoundEffects` |

A phase-scoped effect is gone before regroup resolves, so a unit defeated *during* regroup uses its
base stats.

`cannotAttack: true` is a prohibition rather than a stat: "it can't attack your base or units you
control for this phase" (Chaotic Diversion). `unitCannotAttack` reads it alongside the printed
`cannotAttack` hook, so it closes every source of an attack at once, exactly as Loth-Wolf's does.
`cannotBeAttacked: true` is the defending half (Dooku), read by `unitCannotBeAttacked`, and
`unlessSentinel` lifts it while the unit has Sentinel (On Top of Things). `removeKeywords` takes
keywords away for the duration (SpecForce Soldier's Sentinel, Tusken Tracker's Hidden), applied with
the other removals after every grant. Hidden also protects through the unit's `hidden` mark, so an
effect that takes Hidden away clears the mark as well.

The other prohibitions follow the same pattern, each read beside the printed hook it mirrors:
`cannotAttackBases` (Fly Casual) by `unitCannotAttackBases`, `cannotReady` (No Good to Me Dead) by
`unitCannotReady`, and `noCombatDamage` (Betrayed Trust) by the combat step, which deals nothing for that
unit while it still attacks and defends. `attackersPower` sits on a defender and changes the power of any
unit attacking it (I Have the High Ground's -4/-0), read by `effectivePower` from the attacker's combat
context. `survivesNoHp` keeps a unit in play at damage ≥ HP (The Tragedy of Plagueis); when it expires,
the state-based check below defeats the unit. A card can say the same of itself with the static hook of
that name (Chirrut Îmwe, during the action phase only), which the regroup sweep then catches. `preventNext` stops that much of the next instance of
damage to the unit and is then spent (see Damage prevention).

The game carries two phase-long effects that are not about a unit: `bannedNames`, card names nobody may
play (Transmission Jamming, read by `namedByOpponent` alongside Ryder Azadi's names), and `shieldedBases`,
bases whose next damage is prevented whole (Close the Shield Gate, read by `baseDamageAfterPrevention`
and spent by `dealDamageToBase`). Both clear with the phase's lasting effects.

The phase and attack expiries run the same **state-based defeat check** immediately afterwards: a unit that only the
expired +HP buff kept alive, now at damage ≥ HP, is defeated then, routing through the normal discard,
leader-return and `whenDefeated` path.

`clearAttackGrants` is the single point where everything an attack lent expires — `untilEndOfAttack`
effects alongside the per-attack `grantedKeywords` (Support) and `grantedAbilityCardIds` (Support,
Improvised Identity) — so a duration is declared by the card and cleaned up in one place.

A card whose bonus is conditional on attacking can instead express it as a `statModifier` gated on
`ctx.attacking` (Masterstroke), which needs no expiry at all.

## Delayed effects

`GameState.delayedEffects` holds what a card leaves to happen later:
`{ cardId, owner, when, unitId?, arena? }`. `unitId` names the unit the effect is about (the unit Sneak
Attack played) and `arena` the arena it is about (the one Seismic Detonation chose).
`when` is `regroupStart` (Sneak Attack defeats the unit it played, Triple Dark Raid returns its Vehicle to
hand, Final Showdown loses the game), `actionPhaseStart` (The Eye of Aldhani, whose pay-or-exhaust choices
are answered before play begins, like a whenReadies choice), or `takeInitiative`, the next time `owner`
takes the initiative this phase (Premonition of Doom). At its moment each due effect is dropped and then
run by its card's `delayed` hook, so none runs twice; a `takeInitiative` effect that never ran lapses as
the regroup phase starts. "At the end of the phase" (Triple Dark Raid) is read as the start of the regroup
phase that follows it.

## Experience tokens

An Experience token is a **+1/+1 upgrade** (`TOKEN_EXPERIENCE` in `engine/tokenUpgrades.ts`), so it needs
nothing of the stats pipeline: attached upgrades already add their printed power and HP, and the token
card carries 1/1. Unlike a Shield or an Advantage it is never spent, so it lasts as long as its host.

**A card's whole grant is one attach event.** `giveTokens(state, id, token, n)` attaches all `n` and
fires "when 1 or more upgrades attach" once; `giveMixedTokens(state, id, tokenIds)` does the same for a
grant of different kinds, which is what "give an Experience token and a Shield token to it" is. Granting
them in a loop would fire Sabine Wren once per token for something the card states as one giving. Two
*separate* effects in the same action are still two events.

The choice a card raises to pick a recipient is `mayGiveTokens` (`token`, `count`, `targets`,
`optional`), the same one Shield and Advantage use. Its `controller` is who chooses, which is not always
the ability's owner: Wartime Mercenaries and Watto hand the decision to the opponent.

Three related pieces sit elsewhere. `PlayFromHandOptions.thenTokens` lists the tokens a unit played by an
ability receives, attached together once it is on the board. `UnitState.resourcesPaidToPlay` records what
was actually exhausted for a play, because payment happens before the unit exists and nothing else
remembers it (Weequay Pirate: "if no resources were paid to play this unit"). `phaseEvents.tokensCreated`
credits the grant to the player who made it.

## Weakness tokens

A Weakness token is a **-1/-1 upgrade** with the Condition trait and no text (`TOKEN_WEAKNESS`). The
comprehensive rules predate it, so its card is recorded from the publisher's card list. It is the
Experience token with the signs flipped: the stats pipeline reads the -1/-1 off the token card,
`giveTokens` attaches it and `mayGiveTokens` offers a target. Power never drops below 0.

**A unit it takes to 0 HP is defeated by the state-based sweep** that closes every action
(`sweepStateBasedDefeats`), not at the moment the token lands, which is the same rule Morgan Elsbeth's
-2/-2 uses. Within one action such a unit is therefore still on the board but **doomed** (`isDoomed` in
`engine/combat.ts`), and a distribution that re-offers targets (`distributeTokens`) leaves doomed units
out. `distributeTokens` offers the controller's own units unless `anyUnit` is set ("among any number of
units", Ravage).

"A unit with a token upgrade on it" (Bossk) reads the card type, so Shield, Experience, Advantage and
Weakness all qualify. A Weakness token counts as an upgrade wherever upgrades are counted, as every token
upgrade does.

## Token units

A token unit (Mandalorian, Spy, X-Wing, TIE Fighter, Clone Trooper, Battle Droid, Beast) is a built-in
`unit` card in `engine/tokenUnits.ts`, merged into every card db, so every stat, keyword and trait helper
reads it like a deck card. Its id carries the `TOKEN_` prefix, which is what `isTokenCard` checks: a
token unit that leaves play ceases to exist rather than going to a discard pile or a hand.

**Printed stats are recorded, not fetched.** The card API has no token units, so the stats are read off
the publisher's card list and pinned by test: Spy 0/2 ground with Raid 2, X-Wing 2/2 space, TIE Fighter
1/1 space, Clone Trooper 2/2 ground, Battle Droid 1/1 ground, Beast 3/3 ground. Aspects and traits
matter as much as the numbers (a Clone Trooper is a Heroism Republic Trooper; a Beast has no aspect and is
a Creature).

`createTokenUnits(state, owner, token, n)` makes `n` of them for `owner`, who need not be the ability's
controller ("an opponent creates 2 Battle Droid tokens"). A created unit enters play **exhausted**
(CR 1.5.4b) unless an ability says otherwise: "create ... and ready it" readies the ones just made, and a
unit whose definition has `tokensEnterReady` (Chancellor Palpatine) makes every token unit its controller
creates enter ready. `unitsEnterReady` (Ritual Dragon) goes further, to every unit its controller plays or
creates: `friendlyUnitsEnterReady` reads it both here and in `playUnitCard`. A Shielded token enters with its Shield. Creating counts as entering play
(`enteredPlayThisPhase`) but not as playing, so it fires no "When Played" and no `whenPlayUnit` ("when
you play another unit", Poggle the Lesser). Each token created raises `whenCreateUnit` and
`whenFriendlyEntersPlay` from `createTokenUnit`, the one place token units are made, so "when you play or
create a unit" (Greef Karga) and "when a friendly unit enters play" (Outcast) see every one of them.

## Spent tokens are defeated upgrades

A Shield that soaks damage and an Advantage token that finishes a combat are both **defeats**, as
each token card says. They go through `fireUpgradesDefeated`, the single place an upgrade's defeat is
settled, which marks the phase and fires `whenFriendlyUpgradeDefeated`.

| Site | What spends the token |
| --- | --- |
| `applyUnitDamage` | a Shield soaking an instance of damage |
| `consumeAdvantage` | Advantage, when its unit completes an attack or defence |
| Saboteur's pre-combat step | the defender's Shields, defeated before damage |

The two whole-unit forms share `defeatTokensOn`; the shield soak sits inside a damage batch and hands
its owners to `finishDefeats` so the whole event settles in one pass.

Ownership is **per attachment**, not per host: an enemy-owned upgrade on your unit counts for them.

`fireUpgradesDefeated` takes **one entry per upgrade** and fires for each. A unit dying with three
upgrades is three reactions, and three lots of any resulting damage. Repeated firings push choices
sharing a source instance id, which is safe because `pushChoice` de-collides ids.

The exception is a card that explicitly blanks the tokens: if they are never spent, nothing is
defeated and nothing fires.

## Which upgrades an effect may target

Card text asks this several ways, and hand-rolled scans conflated them, so one helper
(`upgradeCandidates` in `engine/cardDefinitions.ts`) answers it:

| Text | Filter |
| --- | --- |
| "a friendly upgrade" | `owner`, whoever played it |
| "an upgrade on a friendly unit" | `hostController`, whoever controls the host |
| "an upgrade" | neither |
| "an upgrade on a unit", "attached to a unit" | `on: 'unit'` |
| "an upgrade on a base" | `on: 'base'` |

Owner and host controller genuinely differ: an opponent can attach an upgrade to your unit and it
stays theirs, returning to **their** discard when defeated.

**An upgrade on a base (Fortify) is a candidate** unless the text says where the upgrade is. Its
`UpgradeRef` names the host `baseHostId(owner)` in place of a unit id, and `defeatUpgradeAt`,
`returnUpgradeToHand` and `upgradeAt` read either kind of host. `hostController` is a unit's
controller, so it offers units only, as do moves and "take control and attach it to a unit", since a
Fortify upgrade attaches only to a base. The upgrade picker treats a base as a host like a unit: step
one highlights it on the board.

**Token upgrades are always candidates.** They are upgrades, they cost 0, and "defeat an upgrade" can
legally take one. No card in the set says otherwise, so there is deliberately no cards-only option to
get wrong.

A token targeted by a **return to hand** is **defeated** instead, since there is no card to put in a
hand, and that routes through the defeat path so the reaction fires. Anything offering a free replay
of the returned card must skip that branch for tokens.

## Attack targeting

`enemyAttackTargets(state, attacker, owner?)` answers what a unit may attack, resolving arena,
Hidden, "cannot be attacked", Saboteur and Sentinel-lock together. It returns the legal unit
`targets`, whether Sentinel `sentinelLocked` the attack, and `canAttackBase`.

**`canAttackBase` belongs with the target list because it is the same kind of rule.** Two separate
things shut the base off: Sentinel forcing, and "can't attack bases" (Wicket). A site that derived
base legality from `sentinelLocked` alone would enforce one and drop the other.

**"This unit can't attack" (Loth-Wolf) is answered here too**, and it empties the target list and the
base together. It is the same rule shape, so it binds all five sources of an attack by being stated
once. Such a unit can still be given Sentinel, and still forces enemy attacks onto itself: what it
may attack and what may attack it are different questions.

`attackMoves` is the single enumeration built on that answer, and every source of an attack goes
through it: the action phase, Ambush, Support and the two "attack with a unit" choices. They differ
only in which units are candidates, what abilities they lend the attacker, and whether the base is
offered at all (Ambush reads "attack an enemy unit", so it is not, unless a card in play says its
controller's units "can attack bases while using Ambush": Fett's Firespray, read by `ambushAttacksBases`).
One statement of a targeting rule therefore binds all five. Whether an Ambush has anything to hit, which
decides if the unit enters ready and the choice is raised, is `ambushHasTarget`, which reads the same
permission.

**The restriction is on the target, not on the damage.** An attack declares a legal target and only
then computes damage, so a unit that cannot attack bases still trickles Overwhelm excess onto one
after attacking a unit: it attacked a unit, and the surplus trampled through. `canAttackBase`
governs what may be declared, never where damage lands.

`owner` defaults to the active player, which is every rules call site. It is explicit so the AI can
ask the same question of both seats when reading the race. Re-deriving this logic anywhere else
would let it drift from the rules.

An ability that grants a **mandatory** attack (Thrawn, the rider events) is gated on an attack being
legal, since its choice carries no decline and raising it with nothing to attack would leave the
player no legal move. `offerAttack` raises the choice and holds the gate: it asks `eligibleAttacker`
who may attack ("a Vehicle unit", "a damaged unit", "even if it's exhausted") and then asks the same
enumeration `choiceMoves` offers from, **with the rider lent**, so a rider that forbids bases cannot
leave a unit that could only have hit a base counted as able.

**Sentinel forces only from the attacker's own arena.** It reads "enemy units **in this arena** must
attack a Sentinel when they attack you", so the forcing is scoped by where the attacker stands, not by
what it can reach. That distinction is invisible for an ordinary unit, whose targets are same-arena by
construction, and decisive for one that reaches across: a ground Sentinel must not lock a space
attacker that merely *may* attack into the ground arena. Widening the target list must not widen the
lock.

## Damage prevention

There are two kinds, and the difference is whether anyone is asked.

**A prevention the controller chooses** (`canPreventDamage` / `payPreventionCost`: The Mandalorian
defeats one of his own Shields) is settled **after** the powers are known but **before** anything is
committed, so first strike, Overwhelm and attack-end still see correct values. Each side is asked at
most once per combat. Nothing has been written at that point, so suspending and re-running the whole
combat on resume is safe.

**A prevention the card just applies** (`preventUnitDamage`: Cassian Andor, Boba Fett's Armor,
Malakili, Umbaran Mobile Cannon) has nothing to decide, so it lives in `applyUnitDamage`, where every
instance of unit damage passes. Each in-play unit on both sides is asked how much of the instance it
stops, and the total is capped at the damage. It settles **before the Shield token**: damage a card
prevents is never dealt, so no shield is spent soaking it, and the unit is not "damaged this phase"
either. What a card stopped is recorded in `phaseEvents.damagePrevented`, which is what a prevention
limited to once a phase reads, since `damagedUnits` by definition cannot hold it. A `preventNext`
lasting effect on the unit (Shien Flurry) is applied in the same place, after the cards, and is spent by
the first instance it meets. A `preventEach` lasting effect (Finn: "for this phase, if damage would be
dealt to that unit, prevent 1 of that damage") is counted with the cards and never spent, so it
applies to every instance for its duration.

Unpreventable damage ignores both kinds, and ignores Shields entirely: the token is not even spent.

**The price of a chosen prevention can be a pick.** Queen Amidala prevents damage to herself by defeating
another friendly unit that shares a trait with her, so her offer (`preventionCostTargets`) carries the
units that can pay and is answered with one of them. Mid-combat it suspends the attack exactly as The
Mandalorian's does; her counter damage still lands when the combat resumes.

## Replacing damage before it is dealt

A replacement effect (CR 7.7.5, "would ... instead") settles as the damage is about to be dealt, before
any prevention is asked about it, so a prevention sees the damage that would really land.

- **Where it goes.** A `redirectDamageTo` lasting effect sends damage headed for its unit to another unit
  while that one is in play (Maul: "all damage that would be dealt to this unit during this attack is
  dealt to the chosen unit instead", so it is set with `untilEndOfAttack`). The defender's combat damage
  follows it and stays combat damage; the unit it lands on can soak it with its own Shield. Redirected
  damage is not redirected again.
- **How much.** `abilityDamageBonus` adds to one instance of **ability** damage, to a unit
  (`dealDamageToUnit`) or a base (`dealDamageToBase`), and never to combat damage. Ty Yorrick adds 1 to a
  friendly ability's damage. Her "you may" is answered by the engine rather than asked: taken when the
  damage is aimed at an opponent's unit or base, and declined when it is aimed at her own side, where more
  damage is only ever a cost. Damage divided among units is one instance per unit, so the plus 1 lands on
  a unit's first point only.
- **What it is read from.** `dealsCombatDamageByHp` makes an attacker's combat damage its remaining HP
  instead of its power (Babu Frik's Droid, for one attack). Power itself is unchanged, so nothing else
  that reads it is affected.

A friendly ability is read from the damage's source, or from the card whose choice is being answered:
answering a choice runs as that card, so damage dealt by the answer is its card's.

## Healing

`healUnit` and `healBase` are the only places damage comes off a unit or a base, Restore included.
That is what lets one card switch a whole category off: Confederate Tri-Fighter's "bases can't be
healed" is a `suppressesBaseHealing` hook consulted inside `healBase`, and it covers both players'
bases, as the card reads. The same check reads `GameState.basesUnhealable`, set for one phase by
Shifty Suspects and cleared with the lasting effects as the regroup phase starts. Restore used to
subtract from the base inline in `attack`, where no such card could ever have reached it.

`healUnit` records the unit in `phaseEvents.healedUnits` when damage actually comes off, so "each
friendly unit that was healed this phase" (Barriss Offee) counts every source of healing and nothing
else: healing an undamaged unit heals nothing and is not recorded.

Two more phase records are written at the one place each event happens. `dealDamageToBase` adds what a
base was actually dealt to `phaseEvents.baseDamageTaken` ("if you've dealt 3 or more damage to an enemy
base this phase", Cassian Andor). `phaseEvents.tokensCreated` holds each player who created a token:
`createTokenUnit`, `giveTokens` and a Shielded entry all record it, crediting a token upgrade to the
controller of the unit it lands on, which is who created it for every card that gives one to its own
side (The Client).

`phaseEvents.tokenUpgradesGiven` answers a narrower question and is kept apart for two reasons: it
counts **token upgrades only**, not a token unit being created, and it credits the player who
**gave** the token rather than the controller of the unit it landed on ("if you gave a token upgrade
to a unit this phase", Jar Jar Binks). The two differ for a Weakness token and for a Shield handed to
the other side, so `giveToken`/`giveTokens`/`giveMixedTokens` take a `givenBy` that defaults to the
host's controller, and every caller that can land a token on an enemy unit passes it: a choice passes
whoever answered it, which is exact.

## Capture

A unit — or, once, a base (Arrest) — can capture another unit (CR 33): the captured card leaves
play, held face-down under the "guardian" that captured it, until it is rescued or the guardian
itself leaves play. It is not the same event as a defeat: `whenDefeated` never sees a captured unit,
only `whenUnitLeavesPlay` does, and its own `whenFriendlyUnitDefeated`/`whenEnemyUnitDefeated`
listeners stay silent too.

- **Where it lives.** `UnitState.captured` and `BaseState.captured` hold `CapturedCard[]`
  (`{cardId, owner}`), not bare card ids: a captured card keeps its own owner throughout, which
  matters the moment the guardian is on the OTHER side from the card it captured (Lando Calrissian:
  "the enemy unit captures the friendly unit"). Releasing or rescuing it returns it to play under
  that owner, never under the guardian's controller.
- **What happens to it.** `captureUnit` (a unit guardian) and `baseCapturesUnit` (a base guardian)
  share one path in `effects.ts`: the target's card-upgrades are defeated (token upgrades vanish, as
  when a unit is defeated), its damage is moot once it's out of play, whatever it was itself guarding
  is released (CR 33.4 — capturing is also the target leaving play), and `whenUnitLeavesPlay` fires.
  A token unit is set aside instead of guarded (CR 33.5): nothing to rescue later, but it still
  counts as having left play. Capturing a unit no longer in play (the guardian left first) is a no-op,
  as is capturing a target no longer in play.
- **Coming back.** `releaseCaptured` frees everything a guardian held at once, when the guardian
  leaves play (CR 33.4); `rescueCaptured` frees one named card from a specific guardian (Unexpected
  Escape, Cad Bane's On Attack). Both funnel through `enterCapturedCard`, which is `unitPlaySites.test.ts`'s
  one door for this: exhausted, in its own arena, entering play but not *played* — no When Played, no
  cost, no Shielded shield token, no Ambush. `discardCaptured` sends one named card to its own owner's
  discard instead (Altering the Deal).
- **Protection.** `CardDefinition.cannotBeCaptured` is read only when the capturing side differs from
  the target's own controller — the printed text is always "can't be captured **by enemy card
  abilities**", so a unit may still capture its own. `captureReplacement` is unconditional (IG-11: "if
  this unit would be captured, defeat him ... instead") and is checked first; when it fires, the
  capture itself never happens.
- **What #466 shipped and what didn't.** The primitive above is complete and CR-correct. The first
  wave of cards registered against it are the ones with a single guardian and one immediate chosen
  target (`captureWp`, mirroring `damageWp`/`targetWp`). Cards needing a chosen guardian AND a chosen
  target in the same action, a budgeted multi-target capture ("up to 3 units with 8 or less combined
  remaining HP"), a base guardian, or a scheduled rescue at the regroup phase, are on the follow-up
  ticket named in `planned-work.md`. Bounty's own "when this unit is captured" half is #467's, not
  built here: nothing in this ticket fires a dedicated capture trigger point, since nothing shipped
  needs one yet.
