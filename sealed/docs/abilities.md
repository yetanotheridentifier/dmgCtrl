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
runTrigger(state, point, ctx)         // called by resolve
runUnitTrigger(state, point, unit, owner, extra?)
```

`effect: (state, ctx) => state` is pure like everything else in the engine, with
`ctx: { owner, cardId, sourceInstanceId?, ... }`. Replays are deterministic **per app version**;
records already carry that dependency implicitly and the registry makes it explicit.

Real card behaviour is registered in `engine/cardDefinitions.ts`, a side-effect module imported by
`legalMoves.ts`.

## Dispatch

**`runUnitTrigger`** is the key entry point: it fires the unit's own card abilities, each attached
upgrade's abilities, any card lent for the attack, cards granted by an aura, and abilities handed
over for the phase by a lasting effect. `extra` merges into the `EffectContext`, which is how the
attack outcome reaches `onAttackEnd` and the captured unit reaches `whenDefeated` (the unit has left
play by then).

Each ability is attributed to the card it came from, not the host, so an upgrade's ability names the
upgrade.

### Trigger points

`whenPlayed`, `onAttack`, `onAttackEnd`, `onDefense`, `whenDefeated`, `whenReadies`,
`whenRegroupStarts`, `whenTakeInitiative`, `whenPlayOrCreateUnit`, `whenUpgradeAttached`,
`whenFriendlyUpgradeDefeated`, `whenFriendlyUnitDefeated`, `whenEnemyUnitDefeated`,
`whenFriendlyDamagedSurvives`, `whenEnemyAttacksBase`, `whenOwnBaseDamaged`, `whenFriendlyAttackEnds`.

Two attack-end points read the same on cards but mean different things, and conflating them makes a
unit fire on other units' attacks:

- **`onAttackEnd`** fires for the **attacker only**: "when *this* unit's attack ends".
- **`whenFriendlyAttackEnds`** fires for **every unit its controller has, plus their undeployed
  leader**: "when a *friendly* unit's attack ends".

`onAttackEnd` still fires if the attacker was defeated in the combat (CR 7.6), falling back to its
last-known state with its upgrades.

## Static hooks

Card-type-agnostic, all on `CardDefinition`:

| Hook | Effect |
| --- | --- |
| `costModifier` | cost delta, applied in `effectiveCost` |
| `costDiscount` | a unit in play discounting cards its controller plays |
| `waivesAspectPenalty` | a unit in play zeroing the aspect penalty |
| `attachRestriction` | may this upgrade attach to that unit |
| `conditionalKeywords` | extra keywords, folded into `unitKeywords` |
| `suppressedKeywords` | keywords removed while a condition holds |
| `statModifier` | power/HP deltas, folded into `effectivePower`/`effectiveHp` |
| `aura` | power/HP/keywords granted to **other** units |
| `damageMultiplier` | scales each incoming damage instance |
| `negatesOverwhelm` | defender-side, cancels trample |
| `preventBaseDamage` | caps an instance of base damage |
| `makesDamageUnpreventable` | ignores Shields and prevention |
| `dealsDamageFirst` | strikes before the defender |
| `spillsExcessToUnit` | excess damage to another unit instead of the base |
| `attacksEitherArena` | ignores the arena split |
| `cannotAttackBases` | never contributes base damage |
| `providesAspects` | supplies aspect icons while paying costs |
| `deployCondition` | replaces the resource gate on deploying a leader |
| `suppressesFriendlyAdvantage` | Advantage tokens are not spent after combat |

## Leaders

A leader has two sides and they register separately on one card id:

- **`leaderAbilities`** is the undeployed (front) side: `actions` are activated, appearing in
  `legalMoves` as `useLeaderAbility` and gated on the leader being ready and affordable; `abilities`
  are triggered, and fire regardless of exhaustion.
- The top-level `abilities` are the deployed (back) side, registering exactly like a unit's.

**Exhaustion only blocks abilities whose cost is exhausting.** A triggered front-side ability whose
cost is resources fires whether the leader is exhausted or not; a card that costs exhausting the
leader checks `leader.exhausted` itself.

Deploying is an epic action requiring the player to **control** resources equal to the leader's
printed cost, not to spend them. A `deployCondition` hook replaces that gate where a card says
something else.

## Once each round

`markAbilityUsed(state, owner, instanceId, key)` sets a key on the unit's `usedAbilities`. A
triggered ability guards on `usedAbilities.includes(key)` and passes `markUsed: { instanceId, key }`
in its choice, so the mark lands on **acceptance** and declining does not spend it. The list clears
when the unit readies at regroup, shared with the activated-ability path.

## Testing conventions

Per-card registrations get table-driven tests (registered card in, expected state out) using
`engineFixtures`. The framework itself is covered in `engineAbilities.test.ts` and
`abilityFramework.test.ts`.

Card text is authoritative from the card API, which serves the printed ability text; only Power/HP
are missing for some upgrades and are filled from `upgradeStatOverrides.ts`. Values the source data
gets wrong are corrected in `cardDataCorrections.ts`.

The whole-pool fuzz sweep (`npm run bench --prefix sealed -- --sweep`) plays every card in the set
and surfaces a hang or throw as a dropped game with a replayable fixture, which is the broadest net
for a new card breaking an interaction.
