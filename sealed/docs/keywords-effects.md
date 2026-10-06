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

Steps 3 to 5 for power and HP are one sum, `stats.offCardStatDelta`: the part of a stat no card on
the table prints. The board's buff and debuff pills show exactly that sum, so any new source of a
stat change that goes through those steps is displayed without touching the UI. The printed-stat
replacement in step 1, Grit and Raid are left off the pills.

Step 1 is narrower than the source data suggests. SWUDB's `Keywords` is a union over everything a
card's text mentions, so a card that gains a keyword conditionally, or hands one to other units,
ships it as a printed keyword of its own. Only what is printed on the card belongs in step 1, so
**`toKeywords` keeps a unit's or leader's listed keyword only where its text prints it**: at the start
of a line or a sentence, or in a printed list ("AMBUSH, OVERWHELM"). A keyword the text only mentions
("this unit gains Sentinel", "give a unit Sentinel", "a unit with Sentinel") is dropped, and the
ability grants it back where it belongs, at step 3 or 4. A wrongly held Sentinel is the one that bites,
since it redirects enemy attacks. `printedKeywords.test.ts` pins every keyword the rule drops across the
bundled sets, so a new set's surprises arrive as a diff to review.

The union is literal enough to catch the **word** "Keyword" or "Keywords" where a card's text names a
keyword it does not have (Admiral Yularen's "the chosen Keyword"). The rule drops those too.

For a **leader**, the source's `Keywords` describes the unit side, and the card's BackText spells that
side's keywords out line by line, which is the text the rule reads. A keyword the back prints that the
source omits is simply missing (The Warrior's Ambush and Raid 1): that, and a keyword the source gets
wrong in the other direction, are what `cardDataCorrections.ts` still holds.

**Upgrades are left as the source lists them**, since an upgrade's keyword is its attached unit's; an
upgrade whose keyword is conditional, or given beyond its host, is stripped by a correction and granted
by its ability. One unit is a stated exception: Millennium Falcon's "if you play this unit from your
hand, it gains Ambush" cannot be read, since nothing records how a unit was played, so a correction
keeps its Ambush, right in the usual case and wrong only when it is smuggled.

### Which cards supply a unit's abilities

`abilityCardIds(state, unit)` (abilities.ts) is the single definition: the unit's own card, each
attached upgrade, and any card lent for a single attack, less whatever a "loses all abilities" effect
has taken away (below). **Every ability lookup routes through it.** The list used to be spelt out at
each site and the spellings drifted, so an ability whose hook happened to live at a granted-blind site
was silently never lent. `carriedAbilityCardIds(unit)` (types.ts) is the raw set before any loss, read
by the gate itself and by `unitTraits`, since a trait is not an ability.

Duplicates are deliberate and must not be collapsed: two copies of the same upgrade on one host each
contribute.

Abilities travel; **printed traits do not**.

### Losing all abilities

CR 8.14.2: "the card ceases to have any abilities, including abilities given to it by other cards, for
the duration of the 'lose' effect. The card cannot gain abilities for the duration of the effect."
Keyword abilities are abilities (CR 7.1.2), so printed keywords go too. Power, HP and modifiers are
not abilities and stay: an upgrade's +X/+Y, a "+2/+0 for this phase", another unit's aura's +1/+0.

A unit that has lost its abilities keeps **only** the upgrades whose printed text does not say
"gains" (CR 3.6.10: Entrenched's "attached unit can't attack bases" still binds a unit Force Lightning
has blanked), plus whatever the loss itself keeps. It gains nothing from an aura (`grantsAbilities`,
an aura's keywords), a lasting effect (`abilityCardIds`, `keywords`), or a lent card. An upgrade that
prints both kinds is treated as a giver as a whole, and so is a lent attack rider: a blanked unit
attacking through One Way Out or Flash the Vents loses the rider's +X/+0 along with its keyword, since
the carrier card holds both.

| Source | Declared as | Cards |
| --- | --- | --- |
| a lasting effect for a phase, a round or an attack | `LastingEffect.losesAllAbilities` | Force Lightning, There Is No Escape, Mind Trick, The Tree Remembers, One Way Out |
| an attached upgrade | `blanksHost(state, host)`, returning what it `keep`s | Imprisoned, Condemn (while its host attacks), Exiled from the Force (keeps its own Grit) |
| a unit's constant ability over cards anywhere | `blanksCard(state, source, side, cardId, owner)` | Brain Invaders (each leader), Galen Erso (the named card an opponent owns) |
| an event as it resolves | `blanksPlayedEvent` | Relentless (the first each opponent plays each round) |

A card-level loss reaches a card wherever it is: a unit in play, an upgrade, an event being played
(still paid for and discarded, it just does nothing), an undeployed leader (`leaderAbilitiesBlanked`:
its actions, triggers, aura and aspect waiver; the epic action stays), and the cost hooks, Exploit,
Smuggle and Plot of a card in hand or resources. A source that has itself lost its abilities projects
nothing, read from its own direct loss only, so two card-level sources never ask each other.

Everything is read live off the board, so a loss ends the moment its source does. An ability that has
already triggered resolves regardless (CR 8.14.3 for one already resolving; a trigger already collected
is treated the same way). A unit blanked before it is defeated has no When Defeated to fire.

"While attached unit is attacking" (Condemn) reads `GameState.attackingInstanceId`, set as the attack is
declared (before Restore and On Attack are read) and cleared with the other per-attack state.

**The gate is on the hottest path in the engine** (tens of millions of reads a game), so its common
case is memoised: a card pool with no `blanksHost` or `blanksCard` card, and a board with no lasting
loss, cost one identity comparison. A beam self-play run measured about 5% slower than without the
gate after that; a naive version was twice as slow and timed out two AI tests.

Enemy Credit tokens losing their abilities (Conveyex Security Captain) is `suppressesEnemyCredits`,
read where a Credit token is offered as a payment. Advantage tokens losing theirs (Eviscerator) is
`suppressesFriendlyAdvantage`. Tokens that are not upgrades have no unit to blank.

### Granted ability blocks

A card that hands a unit a whole ability block ("Attached unit gains: 'On Attack: ...'", "For this
phase, each friendly unit gains: ...", "Each other friendly unit gains: ...") needs no plumbing of its
own. There are three routes, and each reaches the unit's triggered **and** "Action:" abilities:

| Route | Declared as | Read by |
| --- | --- | --- |
| an attached upgrade ("Attached unit gains:") | the upgrade's own `abilities`, `actionAbilities` and hooks | `abilityCardIds` |
| an aura in play (General Krell, Satine Kryze) | `grantsAbilities` on the source, naming a carrier card | `collectUnitTriggers`, `unitActionAbilities` |
| a lasting effect ("for this phase", Pyrrhic Assault, Implicate) | `LastingEffect.abilityCardIds` | `collectUnitTriggers`, `unitActionAbilities` |

An upgrade's granted ability fires for the host with `ctx.sourceInstanceId` the host and `ctx.owner`
the host's controller, so "this unit" and "your base" read as they would printed on the unit. A grant
that holds only while the host qualifies ("If attached unit is a Force unit, it gains: ...") gates the
triggered ability with `hears`, so a host that does not qualify never has it, and gates a constant hook
inside the hook.

The aura and lasting routes are not part of `abilityCardIds`, which is what a unit carries: a constant hook
(`statModifier`, `cannotBeTargetedByEnemyAbility` and the rest) reaches a unit only through what it
carries. No printed card grants a constant ability by aura or for a phase; one that did would need
those readers widened.

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
//   losesAllAbilities?, noCombatDamage?, attackersPower?, cannotReady?, whileSourceInPlay?, preventNext?, preventEach?,
//   preventCombat?, survivesNoHp?, redirectDamageTo?, printedHp? }
```

`printedHp` replaces the unit's printed HP for the duration ("its printed HP is considered to be 1 for
this phase", Adventurer Sniper Rifle), read with `printedStats`, so upgrades still add to it.

`addLastingEffect` appends one; `lastingEffectTotals(state, instanceId)` sums those aimed at a unit.
Folded into stats and keywords exactly like auras.

**The card's text decides how long one lasts**, and there are three durations:

| Text | Effect | Expires |
| --- | --- | --- |
| "for this phase" | the default | at the start of the regroup phase, in `clearLastingEffects` |
| "for this attack" | `untilEndOfAttack: true` | when that attack finishes, in `clearAttackGrants` |
| "this round (including during the regroup phase)" | `untilRoundEnd: true` | as the next round starts, after the ready step, in `clearRoundEffects` |
| "while this unit is in play" (a specific source, not a round/phase boundary) | `whileSourceInPlay: <sourceInstanceId>` | never pruned; read live against `findUnit` each time |

A phase-scoped effect is gone before regroup resolves, so a unit defeated *during* regroup uses its
base stats. `whileSourceInPlay` is the odd one out: both `clearLastingEffects` and `clearRoundEffects`
keep an entry carrying it instead of dropping it at their usual boundary, so it can outlive any number
of rounds, and it lifts the instant `findUnit` can no longer find its source (Cantwell Arrestor
Cruiser's "that unit can't ready while this unit is in play").

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

## Credit tokens

A Credit token is neither a unit nor an upgrade: it belongs to a **player**, not to a unit, so it has
no board identity and no attach event. `PlayerState.creditTokens` is a plain count (`undefined` reads
as 0), read and written by `friendlyCreditTokens`/`createCreditTokens`/`defeatCreditTokens`/
`takeControlOfCreditTokens` in `engine/effects.ts`. "Take control of an enemy Credit token" is the
count moving from one player to the other, not a target changing controller.

Its printed rule, "While paying resources, you may defeat this token. If you do, pay 1 less", is a
**standing payment step**, not a card-level declaration: `exploitTerms` (`engine/legalMoves.ts`) offers
it as a fourth mode of the Exploit/`whilePlaying` step (see "Exploit" below) whenever the payer holds
any Credit token and the card being played carries no `whilePlaying` mode of its own. No sealed card
combines Exploit (or Greater Sarlacc's or Vernestra Rwoh's own `whilePlaying` modes) with holding a
Credit token, so the two are not offered together; a card with its own mode simply does not also see
Credit's discount. The `exploit` choice's `credit` flag reads picks by ordinal position (0 to however
many are held), the same as Greater Sarlacc's `resources` mode, since one Credit token cannot be told
apart from another. A defeated Credit triggers nothing and, unlike a defeated ready resource, does not
reduce what is left to pay with: it is a separate currency.

An ability that plays a card from hand offers the step only where it raises it itself, as Count
Dooku's front and Jabba the Hutt's deployed action do (`raiseExploit`). The `exploit` choice's
`creditGrant` is what the played unit gains for the phase when at least one Credit paid for it
(Jabba: Ambush): `finishExploit` turns it into a `nextUnitGrant` for that card id before the unit
enters, so an entry keyword fires exactly as a printed one would.

**"Defeat a friendly token" spans every kind a player can hold** (Alliance Outpost): a token upgrade
they own on a unit, a token unit they control, a Credit token, or their Force token. The kind is asked
first only when more than one is available, then which one where that matters (an upgrade or a unit).

`createCreditTokens` records `phaseEvents.tokensCreated` like `giveTokens`/`createTokenUnits`, so "if
you created a token this phase" (The Client) sees a Credit token too.

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
applies to every instance for its duration. A `preventCombat` lasting effect (Aayla Secura: "prevent
all combat damage that would be dealt to this unit for this attack", set with `untilEndOfAttack`) is
counted there too and stops the whole of any combat instance, leaving ability damage alone.

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
- **Protection.** `protectedFromEnemyAbility` ("Enemy ability protection" below) is read for the
  `'capture'` action, only when the capturing side differs from the target's own controller — the
  printed text is always "can't be captured **by enemy card abilities**", so a unit may still capture
  its own. `captureReplacement` is unconditional (IG-11: "if this unit would be captured, defeat him
  ... instead") and is checked first; when it fires, the capture itself never happens.
- **What's built and what isn't.** The primitive above is complete and CR-correct. `captureWp`
  (mirroring `damageWp`/`targetWp`) covers a single fixed guardian and one immediate chosen target.
  A chosen guardian AND a chosen target in the same action (either order) is `captureGuardianTargetWp`/
  `captureTargetGuardianWp`: two ordinary `selectUnitThen` picks chained through `IfYouDo`/`step`/`unit`,
  the same way `unitDealsWp` chains its dealer-then-target — no new choice kind, and no new primitive.
  `appendCaptured` is the one door that writes a card under a guardian (`captureUnit`, `baseCapturesUnit`,
  and Bothan-5's own discard-pile capture all go through it). Still on the follow-up ticket named in
  `planned-work.md`: a budgeted multi-target capture ("up to 3 units with 8 or less combined remaining
  HP", or "any number of guardians, each capturing its own target"), a capture that must land before an
  embedded play's own When Played, a base guardian with a scheduled rescue, and playing a captured card
  outright.

## Enemy ability protection

"This unit can't be \<captured/damaged/defeated/exhausted/returned to hand/taken control of\> by
enemy card abilities" (Lurking TIE Phantom, Shadowed Intentions, Rey, Willrow Hood, Mythosaur, Cassian
Andor): one primitive, `protectedFromEnemyAbility` (`effects.ts`), asked at every site that can do one
of those six things to a unit, plus `upgradeProtectedFromEnemyAbility` for the one printed case that
lands on an attached upgrade rather than a unit.

- **`ProtectedAction`** (`abilities.ts`) names the six: `'capture' | 'damage' | 'defeat' | 'exhaust' |
  'return' | 'takeControl'`.
- **Three shapes contribute**, all on `CardDefinition`:
  - `cannotBeTargetedByEnemyAbility(state, self, action)` — a unit protecting itself, read off its own
    `abilityCardIds` (so an upgrade that grants the text to its host, Shadowed Intentions, reaches it
    with no separate wiring).
  - `grantsEnemyAbilityProtection(state, source, target, sameController, action)` — the aura form,
    another card in play granting the protection to a DIFFERENT unit (Mythosaur: friendly upgraded
    units). Scanned the same way `auraContributions` scans `aura`.
  - `protectsAttachedUpgrade(state, host, upgrade, action)` — Willrow Hood's shape: the host's own card
    protects one attached upgrade (`'defeat' | 'return'` only), asked at the position-addressed
    `defeatUpgradeAt`/`returnUpgradeToHand` rather than at a unit site.
- **Guarded sites**: `defeatUnit`/`defeatUnits` (`'defeat'`), `applyUnitDamage` for ability damage only
  — combat damage never asks, since no printed instance of this text reaches it (`'damage'`),
  `exhaustUnit` (`'exhaust'`), `returnUnitToHand` (`'return'`), `takeControlOfUnit` (`'takeControl'`),
  `attemptCapture` (`'capture'`), and `defeatUpgradeAt`/`returnUpgradeToHand` for the upgrade shape.
- **Who is "enemy"** is read off `state.resolvingSource` (set for the duration of every ability effect
  by `runAttributed`/`whileResolving`, #684) or an explicit `DamageSource` where a site already carries
  one (`applyUnitDamage`'s `source` parameter) — the same `source ?? state.resolvingSource` fallback
  `abilityDamageBonus`/`damageDealer` already use to name who dealt damage. No traceable source (a
  state-based sweep, a delayed effect, `payPreventionCost`) reads as the unit's own side would: not
  blocked. `takeControlOfUnit` is the one exception: since only two players exist, `to` gaining control
  is always an opponent of `from` losing it, so it asks with no source needed.

## Bounty

"Bounty - \<reward\>. (When this unit is defeated or captured, your opponent collects its bounty.)"
(CR 13). A Bounty ability resolves like a triggered ability considered controlled by an **opponent**
of the unit's own controller, the reverse of every other trigger point in this file, and collecting
one is always optional whatever its printed wording says.

- **Trigger point.** `'bounty'` fires at both places a Bountied unit can leave play that way:
  combat's defeat (`finishDefeats`) and `attemptCapture`. Both collect it with `owner` passed as
  `opponentOf(<the unit's own controller>)`, and `ctx.bountyUnit` carries the unit's own snapshot
  (its stats, exhausted state and card id), since the unit is already out of play by the time an
  ability reads it — a card whose Bounty is conditional on the unit itself (Synara San, Unlicensed
  Headhunter: "while this unit is exhausted") reads `ctx.bountyUnit` directly rather than a
  self-referential aura, which could never find a unit no longer on the board.
- **Always a choice.** `runPendingTrigger` never runs a `bounty` ability's effect directly: it raises
  a `mayCollectBounty` choice (accept/skip, no target) instead, answered by `runBountyCollection` in
  `abilities.ts`. This is the dispatcher's job rather than each card's own `ifYouDo`, because a
  reward may need its own internal continuation (Rich Reward's `expUpTo`) that a card-level optional
  gate would collide with.
- **Reacting to a collection.** Resolving `mayCollectBounty` announces the collection as a
  `whenAbilityUsed` use at `point: 'bounty'` (`resolve.ts`, once `runBountyCollection` actually
  changed something), the same announcement any other resolved ability gets from `runOne` (see
  `abilities.md` "Trigger points" for why this one call site builds it rather than that one). SHD_010
  Bossk's back ("When you collect a BOUNTY: you may collect that BOUNTY again. Use this ability only
  once each round.") hears it and runs the identical handle again through `runAbilitiesAgain`, which
  resolves as a fresh `mayCollectBounty` choice rather than an automatic second reward, since
  collecting a Bounty is optional however it was raised.
- **Independent per source.** An upgrade carrying its own Bounty (Wanted, Public Enemy, Rich Reward,
  Top Target, Guild Target, Price on Your Head, Death Mark) is collected through the same
  `abilityCardIds` sweep that reads any other attached-card ability, so it fires alongside the host's
  own printed Bounty as a separate source: two Bounty sources on one unit raise the ordinary
  `chooseNextTrigger` pick between two abilities owed to the same controller (CR 7.6.9), not a single
  merged effect.
- **Reading "has a Bounty".** No new primitive: Bounty is parsed like any other printed keyword, so
  `unitHasKeyword(s, u, 'Bounty')` already answers it, live, for cards that only read the condition
  (Reputable Hunter's cost, Chain Code Collector's On Attack debuff, Jango Fett's conditional power
  and Overwhelm, Krrsantan's When Played, Bossk's leader front) or grant it conditionally
  (Hunter of the Haxion Brood's Shielded, granted the same way Privateer Scyk's is: a live
  `conditionalKeywords` read at entry, not the printed keyword).
- **Rewards reuse the When Played helpers.** Every reward is written with the same builders a When
  Played ability uses (`damageChoice`, `healChoice`, `shieldChoice`, `targetChoice`, `expUpTo`,
  `readyResource`) and wrapped in `bounty()`, which remaps a `whenPlayed`-shaped definition's trigger
  to `'bounty'`, mirroring the existing `defeated()` idiom for When Defeated.

## Disclose

"Disclose \<aspect icons\>" (reveal cards from your hand with these aspect icons among them) is SEC's
set mechanic. `need` is a flat multiset of aspect names — `['Command', 'Command', 'Villainy']` for
"disclose Command Command Villainy" — matched against each hand card's own `aspects` array, which can
itself repeat an entry: a card printed with two icons of the same aspect (Chancellor Valorum's two
Command icons) counts twice toward that aspect's requirement on its own.

- **The choice.** `disclose` (`PendingChoice`, `types.ts`) mirrors `exploit`'s shape: `picks` are hand
  indices already revealed, offered one at a time (`legalMoves.ts`), and nothing ever leaves hand —
  disclosing only reveals. `acceptChoice` with no `handIndex` finishes it, offered once
  `discloseRemaining(need, contributed)` (`effects.ts`) is empty, and runs the card's `ifYouDo` hook
  told the revealed card ids as `disclosed`. `skipTrigger` declines, offered only while `picks` is
  still empty (once you have shown a card there is no rule to un-show it).
- **No dead ends.** A pick is only offered when revealing it still leaves the rest of the hand able to
  finish the job: `legalMoves` re-checks completability against every remaining hand card before
  offering each pick, so a bad early choice (revealing a card that "uses up" the wrong icon) can never
  strand the choice with no legal move.
- **`onDecline`** runs a literal side effect on decline instead (`{ damageOwnBase: N }`), for the one
  card whose only branch is "if you don't" (Warrior of Clan Ordo). **`hookOnDecline`** runs the SAME
  `then` on decline too, told `disclosed: []`, for a card whose ability goes on regardless (Ebon Hawk:
  "Heroism and/or Villainy" is two independent optional disclosures chained one after the other;
  declining the first still offers the second).
- **Multi-stage cards** chain through the card's own `ifYouDo`, exactly as `unitThen`/`selectUnitThen`
  chains already do elsewhere: `ctx.step` names the stage, and `ctx.unitChosen` (via `IfYouDo.unit`)
  carries an earlier pick forward when a later stage needs it (Relief Request's second heal excludes
  the first target; Ebon Hawk's Villainy debuff needs the defender chosen before either disclosure
  was raised; Charged with Corruption chains disclose → guardian → target → `captureUnit`, the same
  shape `captureGuardianTargetWp` uses, inlined rather than reused since that helper owns its own
  `ifYouDo`).
- **28 of the 33 cards Disclose unlocked need nothing else.** Three needed a genuinely separate small
  primitive each: `LastingEffect.whileSourceInPlay` narrows `cannotReady` to last only while its own
  source stays in play, read live rather than pruned on a round/phase boundary (Cantwell Arrestor
  Cruiser); the `discardOrDamage` choice offers the target's controller a hand-discard cost that
  cancels the damage, distinct from `mayPreventDamage`'s standing, in-play prevention (Syril Karn);
  and Chairman Papanoida needed no new trigger point at all — `whenDrawCards` already fires for every
  draw, gated inline on `s.phase === 'action'` the same way HMW_169/LAW_052/JTL_111 already do.

## Smuggle

"Smuggle \<cost\> \<aspects\>. (If this card is a resource, you may play it for its smuggle cost.
Replace it with the top card of your deck.)" is SHD's set mechanic (CR 14): an **alternate cost**, not
a discount, that plays a resource straight out of the resource zone. The printed bracket ("Smuggle
[C=4 Cunning]") replaces both the numeral **and** the aspect list checked for the aspect penalty,
which can differ from the card's own printed aspects — Hotshot DL-44 Blaster is Aggression but
smuggles as Cunning.

- **Parsed off the card, not declared per card.** `EngineCard.smuggle?: { cost, aspects, extra? }`
  (`cardDb.ts`) is read out of `FrontText`/`BackText` by a dedicated regex, because the bracket's
  shape (`\[\{?C=N\}?\s+aspects...\]`, sometimes every token wrapped in the source's own icon-markup
  braces, e.g. DJ's `[{C=7} {Cunning} {Cunning}]`) does not fit the simple "Keyword N" numeral
  `toKeywords` already reads. `extra` catches a trailing comma-led additional cost this parser does
  not resolve (First Light: "deal 4 damage to a friendly unit"), kept only so the card is not silently
  miscounted as plain. No card needs a hand-declared `smuggle` field: the bracket is the one source of
  truth, so a wrong number here is a data bug, not two places to keep in sync.
- **A standing action, not a raised choice.** Unlike `playCardFrom` (#468), which something else has
  to raise, Smuggle is read straight off the resource zone every time legal moves are generated
  (`smuggleMoves`, `legalMoves.ts`), exactly the way a `DiscardPlayGrant`'s `playFromDiscard` is: a new
  `{ type: 'smuggle', resourceIndex, targetInstanceId? }` `Action`, one per card that carries the
  keyword and can afford it (one per legal host, for an upgrade). `takeSmuggle` (`resolve.ts`) reads
  the card's `smuggle` bracket fresh and hands it to the existing `playFromZone` door with an
  `altCost` term and a `resourceTop` tail — the cost rules, the ownership rule and the three type
  doors (unit/upgrade/event) are the same ones `playCardFrom` uses, not a parallel mechanism.
- **`effectiveCost` grew one optional parameter**, `altCost?: { cost, aspects }`: when given, it swaps
  in for `card.cost` and `card.aspects` in the sum, but every other modifier (a card's own
  `costModifier`, board discounts, "your next unit" grants, a named-card surcharge, halving) still
  applies on top, because none of them are specific to which printed cost started the sum.
  `PlayFromTerms.altCost` carries it through `playFromCost` the same way `costDelta`/`waive` already do.
- **"When played using Smuggle"** (Cassian Andor, Hotshot DL-44 Blaster, Privateer Crew) reads a flag
  the play recorded on the unit/upgrade itself — `UnitState.playedUsingSmuggle` /
  `UpgradeAttachment.usingSmuggle`, set at construction from `PlayFromTail.usingSmuggle` — the same way
  Weequay Pirate already reads `resourcesPaidToPlay`. `whenPlayed`'s `ctx` carries no notion of which
  zone a play came from (that is what `ctx.playedFromResources` on the *global* `whenPlayCard` watch is
  for, Bail Organa), so a card's own ability has to read it off itself instead. An upgrade reads its
  own attachment entry the same way Blade of Talzin already finds itself among a host's upgrades:
  `host.upgrades.find(u => u.cardId === ctx.cardId)`.
- **27 of the SHD cards Smuggle unlocked need nothing else** (of a set-wide 34 that print the keyword;
  Scanning Officer only detects it on revealed enemy resources and was already built). Five print
  nothing beyond the keyword and Ambush/Sentinel, already implemented, and need no registration at
  all. Not shipped, each needing a genuinely separate piece: **DJ** (taking control of an enemy
  resource, and handing it back when DJ leaves play — the one piece of the resource zone `#475` did not
  build); **Tech** (grants Smuggle to OTHER resources at a computed cost — a keyword *grant*, not a
  play); **First Light** (its own bracket carries the additional cost the `extra` field above catches);
  **Hondo Ohnaka and Lando Calrissian** (both leaders read/use "play a card using SMUGGLE" globally
  rather than printing the keyword themselves — a watch flag on `whenPlayCard` plus, for Lando, an
  ability that *initiates* a smuggle play at a further discount, neither exercised by any shipped card);
  and **Millennium Falcon** ("if you play this unit from your hand" needs a zone-specific read the
  engine does not yet have: every non-resource-zone play door already collapses to the same
  `fromResources`-shaped boolean, which is not precise enough to tell "from hand" apart from a deck-top
  or discard-pile play).

## Piloting

"Piloting \<cost\> \<aspects\> (You may play this as an upgrade on a friendly Vehicle without a Pilot.)"
is JTL's set mechanic: a Pilot unit card has a second way to be played, as an upgrade, and what it is
depends on how it was played.

- **The bracket is parsed like Smuggle's.** `EngineCard.piloting?: { cost, aspects }` comes off the
  text by the same parser (`parseBracket`, `cardDb.ts`), and the play prices it through
  `effectiveCost`'s `altCost`, so every other modifier still applies on top. The +X/+Y a unit card adds
  as an upgrade is printed beside its own power and HP and is not in the card source at all, so it
  comes from `PILOT_UPGRADE_STATS` (`upgradeStatOverrides.ts`, the publisher's `upgradePower`/
  `upgradeHp`) as `EngineCard.upgradePower`/`upgradeHp`, and `upgradeModifier` reads it for a
  `unitCard` attachment where an upgrade card's own `power`/`hp` is read otherwise.
- **The play is `playUpgrade` with `piloting`.** `legalMoves` offers one per friendly host
  `canTakePilot` accepts: a Vehicle with fewer Pilot upgrades than its room, which is one plus each
  `extraPilots` among its abilities (Millennium Falcon, and R2-D2's granted ability), unless the card's
  upgrade side `ignoresPilotLimit` (R2-D2, who still counts as one of the Pilots on it). The card goes
  through the one upgrade door, `playUpgradeCardOnto`, attached as `{ cardId, owner, unitCard: true }`.
  A move of an attached upgrade checks the same rule (`canMoveOnto`), so a Pilot moves only onto a
  Vehicle with room.
- **Two sides, two registry keys.** The unit side is the card's own definition; the upgrade side is
  registered under `upgradeSideId(cardId)` (`PILOT_<id>`, with `sourceCardId` naming the card), and
  `carriedAbilityCardIds` lists that key for a `unitCard` attachment. So "When played as an upgrade" is
  the upgrade side's `whenPlayed`, "When played as a unit" the unit side's, an "Attached unit gains"
  block fires for the host, and a card printed the same way on both sides registers one definition
  twice. The key has no database entry, which is what keeps the unit side's printed keywords (Biggs's
  Grit and Overwhelm, Academy Graduate's Sentinel) off the host: the upgrade side grants what its text
  says through `conditionalKeywords`.
- **"When a Pilot attaches"** is the host's `whenUpgradeAttached`, told the attaching card in
  `ctx.attachedCardId` by the play and by `moveUpgrade` (Red Leader, Razor Crest, Iden Versio's "when
  this upgrade attaches").
- **A Pilot leader deploys either way.** A leader with a printed upgrade +X/+Y is offered a
  `deployLeader` with a `targetInstanceId` for each friendly Vehicle `canTakePilot` accepts, beside the
  deploy as a unit. `deployLeaderAsPilot` (resolve.ts) attaches the leader card as a `unitCard`
  attachment, marks the leader deployed, and fires the host's attach reactions with the upgrade side's
  own `whenDeployed` ("When deployed as an upgrade") as one batch; a deploy as a unit fires only the unit
  side's. Poe Dameron's front arrives through the same function without spending the epic action.
- **A leader card is never put in a pile.** Every site that takes an upgrade off a unit (a defeat of
  the upgrade or its host, a bounce of either, a capture) hands it to `sendAttachmentFromPlay`
  (effects.ts), which sends a token nowhere, a leader back to its owner's base zone exhausted and not
  deployed, and anything else to the owner's discard or hand. The epic action stays spent, so it does
  not deploy again.
- **A Pilot can be played out of a zone using Piloting.** `piloting` on a `playCardFrom` choice (and
  `PlayFromTerms`) prices the card at its bracket and sends it to the attach step with the friendly
  Vehicles that can take it as targets, then through `playUpgradeCardOnto` as a `unitCard` (Wedge
  Antilles' front).
- **A unit can become an upgrade in play.** `attachUnitAsUpgrade` (effects.ts) takes a unit off the
  board and attaches its card to a host as a `unitCard` under the unit's controller (Poe Dameron and
  Sidon Ithano "when played as a unit", Phantom II onto The Ghost, Corvus taking a friendly Pilot unit,
  Pantoran Starship Thief). Its upgrades are defeated, its damage goes with it and anything it captured
  is released; it is not defeated and does not leave play, and the host's attach reactions fire. A
  card that is not a Pilot gets its upgrade side's stats from its printed text (Phantom II's +3/+3), so
  its `upgradePower`/`upgradeHp` stay empty.
- **A Pilot upgrade can become a unit in play.** `moveAttachmentToGround` detaches a `unitCard`
  attachment and puts it in the ground arena exhausted under the attachment's owner (Eject); a leader
  card becomes that player's leader unit, still deployed. It is neither played nor entering play.
- **Defeats a Pilot replaces.** An upgrade side with `defeatedMovesToGround` (Luke Skywalker) goes to
  the ground arena instead whenever `sendAttachmentFromPlay` would send it to the discard, which covers
  its own defeat and its host's; it is not a defeated upgrade, so "when a friendly upgrade is defeated"
  does not hear it, and the engine always takes the "may". A unit with `insteadOfDefeat` (L3-37) is
  taken off the board undefeated in `finishDefeats` when it names a host, with its upgrades defeated as
  usual, and its controller picks the host or declines (`selectUnitThen` with `hookOnDecline`). A
  decline puts her in the discard pile counted as a defeat, but nothing that reacts to a unit being
  defeated hears it.
- **A control change can last while an upgrade is attached.** `controlUntil: { whileAttached }` hands
  the unit back once no copy of that card is attached to it (Pantoran Starship Thief: "When this upgrade
  detaches from a unit: That unit's owner takes control of it"), checked after every action by
  `returnControlledUnits`.
- **Corvus asks once.** Its pick lists the friendly Pilot units and the units carrying a friendly Pilot
  upgrade it has room for; a friendly Pilot unit attaches itself, any other unit hands over that Pilot
  upgrade (`moveUpgrade`).
- **Limits.** A Pilot played as an upgrade is recorded as played like any card, so a "unit you played this phase" count that reads the card's type
  still sees a unit. A leader deployed as a Pilot is not a leader *unit* leaving play when it goes, so
  "a leader unit left play this phase" does not hear it.

## Plot

"Plot. (When you deploy a leader, you may play this card from your resources, paying its cost.
Replace it with the top card of your deck.)" is SEC's set mechanic (CR 14): unlike Smuggle, it is an
alternate **route** into play, not an alternate **cost** (`isPlot`, `types.ts`, a plain keyword check
with no bracket to parse).

- **A reaction to the controller's own leader deploying, not a per-card ability.** A Plot card sits
  inert in the resource zone (it has no `whenDeployed` of its own to register), so `deployLeader`
  (`resolve.ts`) calls `offerPlotPlays` once the leader is in play, which raises **one**
  `playCardFrom` choice over every Plot card in the deploying player's own resources
  (`playFromCandidates(state, playerId, 'resources', {}, isPlot)`), re-offered via `then: {
  resourceTop, again: true }` until the player declines or none are left, the same "one at a time"
  shape Endless Legions already uses for its own repeated plays.
- **Full printed cost, no discount.** Unlike Smuggle's bracket, Plot carries no alternate cost or
  aspect list: the card is paid for exactly as a hand play would be, through the same `playFromZone`
  door every other zone-play uses. "Replace it with the top card of your deck" is the existing
  `resourceTop` tail.
- **28 of the 31 candidate cards need nothing else** (recounted from the ticket's stale "unlocks 27";
  29 sole-blocked per the triage aggregate, plus two the tool itself misses: **Lurking Snub Fighter**
  (SEC_189), whose source record ships no `Keywords` array at all despite printing the full Plot
  reminder in `FrontText` (fixed via `CARD_DATA_CORRECTIONS`, the `ASH_127`-class of source-data gap),
  and **First Light** (SEC_088), flagged as blocked on its trigger head too because that head's text
  is not a literal string in `EXISTING_TRIGGERS`, though the point it needs (`onAttackEnd` +
  `ctx.defenderDefeated`) already dispatches. Both are a source-data/trigger-matching gap in the
  triage tool, not its own lists, a fourth and fifth class of triage inaccuracy alongside the
  reminder-text, built-keywords-list and bracketed-cost gaps #711/#713/#469 already found.
- **Chancellor Palpatine (SEC_001), front only**: "search the top 5 cards of your deck for a card
  with Plot, reveal it, and draw it" needs nothing beyond `isPlot` as a `searchDraw` predicate. His
  back ("the next card you play using Plot this phase costs 3 less") needs a new `NextUnitGrant`
  restriction plus threading which door a play came through into `effectiveCost`, and is not built.
- **When Has Become Now (SEC_245)** plays a Plot card from resources itself (a `whenPlayed` ability,
  not the leader-deploy reaction), reusing `playFromZoneChoice` with `{ zone: 'resources', test:
  isPlot, then: { resourceTop } }` exactly as the reaction does, just raised from a different trigger.
- **Two small additions shipped alongside the mechanic**, each needed by exactly one card:
  `CardDefinition.cannotPlayFromHand` (One in a Million, SEC_053, whose only route into play is Plot,
  so the Play a Card action's hand scan must skip it) and `GameState.eventsBanned` /
  `eventsBannedFor()` (Trade Route Taxation, SEC_126, "that opponent can't play events this phase").
- **One in a Million never shows as played by the `--sweep` coverage tool.** It is an event
  (`playCoverage.ts` only credits an event through the `playEvent` action, by design: "an event played
  through a choice rather than through `playEvent` is missed... the intended direction of error"),
  and `cannotPlayFromHand` closes off `playEvent` as a route entirely, so `playCardFrom`'s
  `acceptChoice` is its ONLY way into play, always uncredited. Confirmed still firing correctly:
  direct engine stepping over 1,000 games on the one deck that decks it found it resourced 945 times,
  offered as a Plot candidate 323 times and actually chosen 173 times, and its own unit test
  (`plot.test.ts`) exercises the same path. The card genuinely plays; the sweep's own documented
  blind spot just cannot see it, and no other shipped card yet has an event with no route but a
  choice, so this is the first permanent instance of it rather than an occasional miss.
- **Not shipped, each needing something Plot itself does not touch, on #726**: Sly Moore (SEC_033,
  needs a phase-scoped "-2/-0 while attacking a base" modifier no existing `LastingEffect` shape
  reaches), Vigil (SEC_050, needs constant damage-prevention/redirection primitives beyond the
  existing per-phase ones), Fully Armed and Operational (SEC_194, needs "as their immediately
  preceding action" sequencing, which the engine does not track), and Chancellor Palpatine's back,
  above. Galen Erso (SEC_046) plays by Plot like any other card; his own ability is one of the
  "loses all abilities" sources (Losing all abilities, above).

## Indirect damage

"Indirect damage. (They assign that much unpreventable damage among their base and units.)" is JTL's
damage mechanic: unlike every other instance of damage, the RECEIVING player, not the dealer, decides
where it lands, one point at a time, and it ignores Shields and every base-damage prevention outright.

- **`dealIndirectDamage`** (`combat.ts`) is the entry point: it folds in `indirectDamageBonus` (Hunting
  Aggressor's "+1 to opponents"), checks whether a card flips the assignment to the dealer instead
  (`indirectDamageAssignedByDealer`, Devastator's "you assign all indirect damage you deal to
  opponents"), then raises **one** `distributeIndirectDamage` choice controlled by whichever player
  assigns it. Both hooks (`CardDefinition.indirectDamageBonus` / `.assignsIndirectDamage`) are asked
  only of units the DEALER controls, mirroring `abilityDamageBonus`'s shape but never of the target's
  own side.
- **The distribution is mandatory, unlike `distributeDamage`'s "may stop early".** Nobody may decline
  to absorb indirect damage, so the choice never offers a Done while any amount remains. The target
  player's own base is always one of the offered targets and can never leave play, so the choice can
  never strand even once every eligible unit on that side is dead — no completability recheck (#603's
  class of fix) was needed for this shape.
- **Unpreventable is a flag on the instance, not a card hook.** `DamageSource.unpreventable` is a new,
  general field `damageIsUnpreventable` checks first, before the existing `makesDamageUnpreventable`
  hook scan (Gorian Shard's Corsair) — indirect damage's own printed reminder sets it directly on every
  instance, since every printing means the same thing and none needs a hook of its own. `dealDamageToBase`
  also gained a `boost` parameter (mirroring `dealDamageToUnit`'s existing one) so a multi-point
  distribution to the base only ever applies `abilityDamageBonus` once, on the instance's first point.
- **Allegiant General Pryde's "When indirect damage is dealt to a unit" needs no trigger point of its
  own.** `DamageSource.indirect` threads through to `DamageDealt.indirect` exactly the way `byCombat`
  already does, so the existing `whenDamageDealt` point (heard on both sides already) is filtered on it
  — the same treatment "dealt damage and survives" already gets, above.
- **Follow-ups that read what the distribution actually hit** ("if a base is damaged this way, ready
  this unit"; "exhaust each unit damaged this way") are carried on the choice itself as an
  `IndirectDamageFollowUp` (`readyIfBaseDamaged` / `drawIfBaseDamaged` / `exhaustUnitsDamaged`), applied
  once the whole amount is spent, off the base-hit flag and unit-id list the distribution recorded as
  it went.
- **"Deal N indirect damage to a player"** is a genuine choice between both players (`choosePlayerThen`,
  the same convention "defeat a Credit token belonging to any player" already uses), never assumed to
  mean the opponent. A card whose text instead names "the defending player" or "each opponent" deals it
  to a fixed target and raises no such choice.
- **18 of the 22 candidate cards need nothing else** (recounted against `registeredCardIds()`; the
  ticket's stale count read 15). Boba Fett's leader front (JTL_009, "when you deal non-combat damage") reads
  the shared `whenDamageDealt` point rather than one of its own. Left out: Targeting Computer and Superheavy Ion Cannon
  (JTL_171/JTL_227, both need a granted-ability block), and Dengar (JTL_139, needs Piloting) — each
  noted on the ticket that already owns its remaining blocker.

## Coordinate

"Coordinate - <printed effect>. (Gain this ability while you control 3 or more units[, including this
one].)" is a conditional ability grant keyed on the controller's own board state, not a keyword with
rules of its own: everything after the dash is the card's real printed keyword, stat buff, aura or
triggered ability, active only while the condition holds.

- **`hasCoordinate`/`unitHasCoordinate`** (`cardDefinitions.ts`) are the one condition: `s.players[owner].units.length >= 3`.
  It is a live, continuously read board state, the same treatment `conditionalKeywords`/`statModifier`/
  `aura` already give every other conditional grant: it turns on and off mid-round as units enter or
  leave play, never cached, so a Coordinate unit's buff or keyword can drop mid-combat if a
  Sentinel'd ally is defeated first. A one-shot ability (When Played, When Defeated) settles the
  condition once, at the moment it would fire, exactly like every other triggered ability.
- **No hook of its own.** A stat buff uses `statModifier` (Mandalorian Super Commandos'
  "+2/+0 while you control a leader unit" is the precedent), a self-keyword grant uses
  `conditionalKeywords`, an effect on OTHER units or the current defender uses `aura`, and a gated
  When Played effect (create a token, an optional damage pair, a capture) checks the condition inline,
  the same shape Lifetree Caravan's "If you control 3 or more units (including this one), you may
  resource the top card of your deck" already uses. A Coordinate On Attack (Anakin Skywalker, Kit
  Fisto, Padmé Amidala, Aayla Secura) or "when an opponent plays their second card each phase"
  (Ki-Adi-Mundi) is gated with the ability's `hears`, so a unit without Coordinate when the event
  happens never triggers. A leader's front "Coordinate - Action" (Ahsoka Tano, Padmé Amidala) is
  gated by its action's `usable`, and its back reads the same condition for the deployed unit.
- **An upgrade can grant a Coordinate ability** (For The Republic: "Attached unit gains:
  'Coordinate - Restore 2.'"). It is the upgrade's own `conditionalKeywords`, which already land on its
  host, gated on `unitHasCoordinate` of the host, so the host's controller is the one counted. The
  source lists the upgrade's keywords as `["Coordinate", "Restore"]`, which would give every host
  Restore unconditionally, so `cardDataCorrections.ts` empties them.
- **A bundled keyword is left out of the card's base keywords** by `toKeywords`, like every other
  conditional keyword: the source lists "Coordinate - Sentinel" as `["Coordinate", "Sentinel"]`, which
  would make Sentinel permanent left alone. A keyword
  the card also has UNCONDITIONALLY, on its own separate printed line (Plo Koon's Ambush, Kit Fisto's
  Saboteur, Padmé Amidala's leader-back Restore 1), is left in place alongside `Coordinate`.
- **Every TWI card carrying Coordinate is built**: 21 units and upgrades plus both sides of the two
  leaders.

## The Force

LOF's set mechanic (CR 8.37): a Force token, capped at **one per player**, unlike Credit's plain
count. "The Force is with you" creates it, a no-op while one is already held. "Use the Force" is
**always optional**, even on a card whose own printed text omits the word "may" (CR 8.37.4), and is
never offered without a token held.

- **`PlayerState.forceToken?: boolean`** (a flag, not a count) with `hasForceToken`/
  `createForceToken`/`defeatForceToken` (`effects.ts`), mirroring Credit's shape.
- **Two cost surfaces, both extensions of existing machinery, not new mechanisms:**
  - `mayPayThen.useForce`, a fourth mode of the choice `cost`/`damageSelf`/`revealEvent` already
    share, for "You may use the Force. If you do, <effect>". `legalMoves.ts` offers `acceptChoice`
    only while the controller holds a token; accepting defeats it instead of paying resources.
    `mayUseForceWp` (`cardDefinitions.ts`) wraps `whenPlayed` the way `mayPayWp` does, and its
    `declineStep` runs the `ifYouDo` hook on a decline too, at that step, for a card that goes on
    either way regardless of the answer (Savage Opress: "if you don't, deal 9 damage to your base";
    Do or Do Not: "if you do not, draw a card").
  - `useForceCost` on `ActionAbilityDef`/`LeaderActionAbilityDef`, alongside `exhaustCost`, for
    "Action [Exhaust, use the Force]:". Gated and paid everywhere `exhaustCost` already is
    (`legalMoves.ts`'s `actionPhaseMoves`, `resolve.ts`'s `useAbility`/`useLeaderAbility`).
- **"While the Force is with you" passive grants get the same live-board-read treatment as
  Coordinate**: `unitHasForce` (a live read of the unit's own controller's token, never cached)
  feeding `conditionalKeywords`/`statModifier`/`aura`, with `toKeywords` leaving out a bundled
  conditional keyword the source lists as permanent (Jedi Sentinel's
  Sentinel, Plo Koon's Grit, Darth Tyranus's Ambush — its unconditional Shielded stays).
- **28 of the 57 sole-blocked cards shipped** (recounted against `registeredCardIds()` via
  `--triage LOF`; the ticket's "unlocks 57" is correct once LOF_033's false-positive match is
  discounted, see "Triage tooling" below). Everything shipped needed nothing beyond the primitive
  above. Left for a follow-up: the 8 identical "When a friendly Force unit attacks" bases plus 3 more
  bases, all needing a new `baseAbilities` primitive for a base's own printed ability (nothing today
  covers a base's own triggered or action ability beyond `epicAction`/`aura`/upgrade-granted
  actions/`interceptDamage`); a new `whenUseForce` player-level trigger point (Yoda, The Father); a
  Force-gated option inside a "Choose one:" (Shatterpoint); an exhaust-a-unit-OR-use-the-Force
  alternate cost (Impossible Escape); Leia Organa's own gated Action; Chirrut Îmwe, whose `onDefense`
  context now carries the attacker's id; a `whenUpgradeAttached` context read (Kylo
  Ren); filtering "when you play another unit" down to unique units (Luke Skywalker); and a new "when
  damage is dealt to your base" trigger point (The Daughter).
- **Triage tooling**: `bench/triage.ts`'s `force-token` regex (`/\bthe Force\b|\bForce token\b/i`)
  also matches LOF_033 and SEC_054, whose printed text is about a unit **losing the Force trait**
  ("Each enemy unit loses the Force trait for this phase"), which needs trait removal and has nothing
  to do with the token. A false positive, not a real blocker; the real sole count for LOF is 57 once
  it is discounted.
