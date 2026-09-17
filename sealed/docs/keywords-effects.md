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

### Which cards supply a unit's abilities

`abilityCardIds(unit)` is the single definition: the unit's own card, each attached upgrade, and any
card lent for a single attack. **Every ability lookup routes through it.** The list used to be spelt
out at each site and the spellings drifted, so an ability whose hook happened to live at a
granted-blind site was silently never lent.

Duplicates are deliberate and must not be collapsed: two copies of the same upgrade on one host each
contribute.

Abilities travel; **printed traits do not**.

## Auras: constant effects on other units

```ts
CardDefinition.aura?: (state, source, target, sameController) => { power?, hp?, keywords? } | undefined
```

Applies while the source unit (or an attached upgrade) is in play, to **other** units.
`auraContributions(state, target)` scans every in-play unit and sums the contributions.

**Constraint:** an aura must not read the target's *computed* keywords or power, because that
recurses through the aura pass. Inspect card data and traits instead; `unitHasTrait` is safe, and
`nonAuraKeywordNames` / `nonAuraKeywordValue` answer "does the target have this keyword, and what is
its numeral" from every source except auras, which is what a card that reacts to a keyword
(Kylo Ren's Command Shuttle) or scales one (Marchion Ro doubles Raid) needs.

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
//   noCombatDamage?, attackersPower?, cannotReady?, preventNext?, survivesNoHp? }
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
the state-based check below defeats the unit. `preventNext` stops that much of the next instance of
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

`GameState.delayedEffects` holds what a card leaves to happen later: `{ cardId, owner, when, unitId? }`.
`when` is `regroupStart` (Sneak Attack defeats the unit it played, Triple Dark Raid returns its Vehicle to
hand, Final Showdown loses the game), `actionPhaseStart` (The Eye of Aldhani, whose pay-or-exhaust choices
are answered before play begins, like a whenReadies choice), or `takeInitiative`, the next time `owner`
takes the initiative this phase (Premonition of Doom). At its moment each due effect is dropped and then
run by its card's `delayed` hook, so none runs twice; a `takeInitiative` effect that never ran lapses as
the regroup phase starts. "At the end of the phase" (Triple Dark Raid) is read as the start of the regroup
phase that follows it.

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

Card text asks this three ways, and hand-rolled scans conflated them, so one helper
(`upgradeCandidates` in `engine/cardDefinitions.ts`) answers it:

| Text | Filter |
| --- | --- |
| "a friendly upgrade" | `owner`, whoever played it |
| "an upgrade on a friendly unit" | `hostController`, whoever controls the host |
| "an upgrade" | neither |

Owner and host controller genuinely differ: an opponent can attach an upgrade to your unit and it
stays theirs, returning to **their** discard when defeated.

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
offered at all (Ambush reads "attack an enemy unit", so it never is). One statement of a targeting
rule therefore binds all five.

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
the first instance it meets.

Unpreventable damage ignores both kinds, and ignores Shields entirely: the token is not even spent.

## Healing

`healUnit` and `healBase` are the only places damage comes off a unit or a base, Restore included.
That is what lets one card switch a whole category off: Confederate Tri-Fighter's "bases can't be
healed" is a `suppressesBaseHealing` hook consulted inside `healBase`, and it covers both players'
bases, as the card reads. Restore used to subtract from the base inline in `attack`, where no such
card could ever have reached it.

`healUnit` records the unit in `phaseEvents.healedUnits` when damage actually comes off, so "each
friendly unit that was healed this phase" (Barriss Offee) counts every source of healing and nothing
else: healing an undamaged unit heals nothing and is not recorded.
