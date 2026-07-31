# Keywords, auras and effects

How a unit's live power, HP and keywords are computed, and how effects that outlast a single action
are represented. Read this when working on combat, stats, or anything that modifies another card.

## Where a unit's stats come from

`stats.effectivePower` / `effectiveHp` and `keywords.unitKeywords` are the only sanctioned readers.
Each sums, in order:

1. printed values from the card database;
2. attached upgrades;
3. `statModifier` / `conditionalKeywords` hooks on the unit's card and its upgrades;
4. **auras** from other units in play (`auraContributions`);
5. **lasting effects** aimed at the unit (`lastingEffectTotals`).

Combat and every defeat check go through these helpers, so a keyword granted by an aura or a
"this phase" buff shapes attack targeting for free.

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
recurses through the aura pass. Inspect card data and traits instead; `unitHasTrait` is safe.

An aura can be combat-conditional: the combat roles (`attackerInstanceId`, `defenderInstanceId`) are
threaded into the aura call, so "while attacking" and "while defending" auras work.

## Lasting effects: "this phase"

```ts
GameState.lastingEffects?: LastingEffect[]   // { targetInstanceId, power?, hp?, keywords? }
```

`addLastingEffect` appends one; `lastingEffectTotals(state, instanceId)` sums those aimed at a unit.
Folded into stats and keywords exactly like auras.

**Cleared at the start of the regroup phase**, so a unit defeated *during* regroup uses its base
stats. Immediately after they clear, a **state-based defeat check** runs: a unit that only the
expired +HP buff kept alive, now at damage ≥ HP, is defeated then, routing through the normal
discard, leader-return and `whenDefeated` path.

This is broader than the per-attack `grantedKeywords` / `grantedAbilityCardIds`, which clear after a
single attack.

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
Hidden, "cannot be attacked", Saboteur and Sentinel-lock together, and reporting whether Sentinel
locks the attack (so the base is off-limits).

`owner` defaults to the active player, which is every rules call site. It is explicit so the AI can
ask the same question of both seats when reading the race. Re-deriving this logic anywhere else
would let it drift from the rules.

## Damage prevention

Prevention is settled **after** the powers are known but **before** anything is committed, so first
strike, Overwhelm and attack-end still see correct values. Each side is asked at most once per
combat. Nothing has been written at that point, so suspending and re-running the whole combat on
resume is safe.

Unpreventable damage ignores Shields entirely: the token is not even spent.
