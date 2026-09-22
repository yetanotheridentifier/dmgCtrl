import type { DamageDealt, DamageSource, GameState, IfYouDo, NextUnitGrant, PendingTrigger, PlayerId, TriggerContext, UnitState, UpgradeAttachment } from './types'
import { baseHostId, baseHostOwner, opponentOf, updatePlayer, pushChoice, recordBaseCombatDamage, recordBaseDamaged, recordCardsDrawn, recordTokenCreated, recordUpgradeDefeated, recordUnitEntered, recordUnitHealed, recordUnitLeftPlay, abilityCardIds, baseAbilityCardIds } from './types'
import { TOKEN_SHIELD } from './tokenUpgrades'
import { isTokenCard } from './tokenUnits'
import type { TriggerPoint } from './abilities'
import { getCardDefinition, collectArrivalTriggers, collectPlayerTriggers, collectUnitTriggers } from './abilities'
import { enqueueTriggers, drainTriggers } from './triggerQueue'

/**
 * Run one event's triggered abilities: enqueue them as a batch and drain as far as they go.
 *
 * The single way an event fires its abilities. Collecting first is what lets the controller order the
 * batch (CR 7.6.9-7.6.10) and lets each ability resolve **fully** before the next begins (CR 7.6.12),
 * so an ability that resolves later sees the board as the earlier ones left it, rather than a board
 * snapshotted when the event happened.
 *
 * Nothing owed means nothing to do: draining an empty batch would resolve whatever an OUTER batch
 * still owes, at a point that is not its turn.
 */
export function fireBatch(state: GameState, owed: PendingTrigger[], sameEvent = false): GameState {
  return owed.length === 0 ? state : drainTriggers(enqueueTriggers(state, owed, sameEvent))
}

/**
 * "Then, ...": owe the rest of an ability (its card's `ifYouDo` at `then`) until everything it has
 * raised so far has resolved, however many choices deep that goes ("choose two, in any order": the
 * second choice waits for the first mode's own picks). Queued as a trigger entry, because the queue
 * already resolves nothing while a choice is open; it is drained by whatever answers the last one.
 *
 * Inside a choice's own continuation, chain the next choice directly instead. Two of these owed at
 * once would nest the second under the first and resolve it first.
 */
export function thenAfterChoices(state: GameState, then: IfYouDo): GameState {
  return enqueueTriggers(state, [{
    id: `then-${then.cardId}-${then.step ?? ''}`,
    controller: then.owner, point: 'whenPlayed', cardId: then.cardId, abilityIndex: -1, layer: 0,
    ...(then.sourceInstanceId ? { sourceInstanceId: then.sourceInstanceId } : {}),
    resume: then,
  }])
}

/**
 * How many cards a search by `owner` looks at: the base count times every `searchModifier` **anything
 * they control** contributes (Arcana Star Map x2).
 *
 * **Scoped to the player, not to the searching unit.** Arcana Star Map reads "Attached unit gains: 'If
 * *you* would search a number of cards from your deck, search twice that number of cards instead'",
 * and "you" is the controller: units do not search, players do. The upgrade grants its host an ability
 * whose effect is about the player, so every search that player makes is doubled while the host is in
 * play, whichever card does the searching.
 *
 * This was previously keyed on the searching unit's own upgrades, which made the card do nothing
 * except in the one case where the Star Map happened to sit on the very unit that searched.
 *
 * Modifiers multiply, so two would be x4. Arcana Star Map is Unique, but that is a property of the
 * card rather than of this rule.
 */
export function searchCount(state: GameState, owner: PlayerId, baseCount: number): number {
  let n = baseCount
  for (const unit of state.players[owner].units) {
    for (const cardId of abilityCardIds(unit)) {
      n *= getCardDefinition(cardId)?.searchModifier?.(state, unit) ?? 1
    }
  }
  return n
}

/**
 * Effect primitives: pure `(state, …) => state` building blocks that card
 * abilities compose. Card-type-agnostic and reused across units/leaders/events/
 * upgrades. Unit-targeting primitives take an instance id and find it on either
 * side, so an ability doesn't need to know who controls the unit. Grown as needed.
 */

/** Find a unit by instance id on either side. */
export function findUnit(state: GameState, instanceId: string): { owner: PlayerId; unit: UnitState } | undefined {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const unit = state.players[owner].units.find(u => u.instanceId === instanceId)
    if (unit) return { owner, unit }
  }
  return undefined
}

/**
 * Move a unit from `from` to `to`, unchanged in every other respect. `owner` records where the card
 * came from so it can go home: to that player's discard if it's defeated, or back under their
 * control when the change ends. Moving a unit that was already stolen keeps the ORIGINAL owner, and a
 * unit returning to its owner drops both fields entirely.
 *
 * `until` is how long the change lasts (see `UnitState.controlUntil`); omitted, it ends as the regroup
 * phase starts.
 */
export function takeControlOfUnit(state: GameState, from: PlayerId, to: PlayerId, instanceId: string, until?: UnitState['controlUntil']): GameState {
  const unit = state.players[from].units.find(u => u.instanceId === instanceId)
  if (!unit || from === to) return state
  const cardOwner = unit.owner ?? from
  const moved: UnitState = cardOwner === to
    ? { ...unit, owner: undefined, controlUntil: undefined }
    : { ...unit, owner: cardOwner, controlUntil: until }
  const without = updatePlayer(state, from, { units: state.players[from].units.filter(u => u.instanceId !== instanceId) })
  return updatePlayer(without, to, { units: [...without.players[to].units, moved] })
}

/**
 * Hand back every unit whose change of control has ended. `atRegroup` also ends the plain "until the
 * regroup phase" ones; otherwise only those tied to a unit that has since left play (Grand Moff
 * Tarkin) go home. A permanent change never does.
 */
export function returnControlledUnits(state: GameState, atRegroup: boolean): GameState {
  const inPlay = new Set([...state.players.player.units, ...state.players.opponent.units].map(u => u.instanceId))
  const ended = (u: UnitState): boolean =>
    u.controlUntil === undefined ? atRegroup : u.controlUntil !== 'permanent' && !inPlay.has(u.controlUntil)
  let next = state
  for (const controller of ['player', 'opponent'] as PlayerId[]) {
    for (const u of next.players[controller].units.filter(x => x.owner !== undefined && x.owner !== controller && ended(x))) {
      next = takeControlOfUnit(next, controller, u.owner!, u.instanceId)
    }
  }
  return next
}

function patchUnit(state: GameState, owner: PlayerId, instanceId: string, patch: (u: UnitState) => UnitState): GameState {
  const p = state.players[owner]
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, units: p.units.map(u => (u.instanceId === instanceId ? patch(u) : u)) } },
  }
}

/**
 * Attach `count` token upgrades (Shield/Experience/Advantage) to a unit, owned by its controller.
 *
 * **All of them attach, then the trigger fires once** (#498). Sabine Wren reads "When 1 or more
 * upgrades attach to this unit", so a three-token grant is one event, not three. Granting them
 * one-at-a-time raised three separate choices on prod and let the opponent exhaust two units off a
 * single Zeb play.
 *
 * The boundary is one **call**, which is one trigger's worth of attaching. Two separate effects each
 * granting in the same action are two events and fire twice, which is the reading two judges
 * confirmed: Unfettered Ambition attaching, then its own effect granting Advantage, is two.
 *
 * A count of zero is not an attach event, so it neither attaches nor fires.
 */
export function giveTokens(state: GameState, instanceId: string, tokenId: string, count: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found || count <= 0) return state
  const tokens = Array.from({ length: count }, () => ({ cardId: tokenId, owner: found.owner }))
  return fireUpgradeAttached(attachUpgrades(recordTokenCreated(state, found.owner), instanceId, tokens), instanceId)
}

/**
 * Put `upgrades` on a unit: **the engine's one write that attaches an upgrade.** Every way an upgrade
 * reaches a unit comes through here, so they cannot disagree about what attaching is:
 *
 * - **played** (`played` true, only from `playUpgradeCardOnto`): also counts toward the unit's
 *   `upgradesPlayedThisRound`;
 * - **created** (a token given by an effect, the Shield from Shielded, CR 3.7.2 and 3.7.2b) and **moved** from
 *   another unit (CR 3.6.14: detached and attached simultaneously): attached, never played.
 *
 * It fires nothing, because an attach belongs to whatever batch the event that caused it is building (a
 * play's own When Played, a unit entering). The caller fires the host's attach reactions with
 * {@link collectUpgradeAttached} or {@link fireUpgradeAttached}, passing `upgradePlayed` only for a play.
 * (A leader deploying with Shielded fires none: no leader has an attach reaction.)
 */
export function attachUpgrades(state: GameState, instanceId: string, upgrades: UnitState['upgrades'], played = false): GameState {
  const found = findUnit(state, instanceId)
  if (!found || upgrades.length === 0) return state
  return patchUnit(state, found.owner, instanceId, u => ({
    ...u,
    upgrades: [...u.upgrades, ...upgrades],
    // Per unit and per round ("the first upgrade you play on this unit each round", Guardian of the Whills).
    ...(played ? { upgradesPlayedThisRound: (u.upgradesPlayedThisRound ?? 0) + 1 } : {}),
  }))
}

/** Attach a single token upgrade. See {@link giveTokens} for why the count-many form exists. */
export function giveToken(state: GameState, instanceId: string, tokenId: string): GameState {
  return giveTokens(state, instanceId, tokenId, 1)
}

/**
 * Attach tokens of **different kinds** to one unit in a single attach event, for the cards that print
 * "give an Experience token and a Shield token to it". {@link giveTokens} is one kind at a time, and
 * calling it twice would be two events, firing Sabine Wren twice for what the card states as one grant.
 */
export function giveMixedTokens(state: GameState, instanceId: string, tokenIds: readonly string[]): GameState {
  const found = findUnit(state, instanceId)
  if (!found || tokenIds.length === 0) return state
  const recorded = tokenIds.reduce(acc => recordTokenCreated(acc, found.owner), state)
  const tokens = tokenIds.map(cardId => ({ cardId, owner: found.owner }))
  return fireUpgradeAttached(attachUpgrades(recorded, instanceId, tokens), instanceId)
}

/**
 * Move a unit to the other arena (Blue Leader: "move this unit to the ground arena"). The unit keeps
 * its damage, upgrades and ready state: only where it fights changes, and every arena test in the
 * engine reads `arena`, so nothing else has to be told.
 */
export function moveUnitToArena(state: GameState, instanceId: string, arena: UnitState['arena']): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.arena === arena) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, arena }))
}

/**
 * Fire "when 1 or more upgrades attach to this unit" (Sabine Wren) on the receiving unit.
 * Follows every {@link attachUpgrades}: token grants (here), a play, a Shielded entry, and a move.
 * Batching is {@link giveTokens}' job: this fires once per call, so callers granting several tokens
 * must attach them together rather than in a loop.
 */
export function fireUpgradeAttached(state: GameState, instanceId: string, upgradePlayed = false): GameState {
  return fireBatch(state, collectUpgradeAttached(state, instanceId, upgradePlayed))
}

/**
 * Open the Support pending choice: another ready unit may attack, gaining the Support source's
 * abilities for that attack (see the `support` case in the attack dispatcher). No choice if there is
 * no other ready unit. Shared by playing a Support unit and deploying a Support leader.
 */
export function openSupportChoice(state: GameState, owner: PlayerId, sourceInstanceId: string): GameState {
  const others = state.players[owner].units.filter(u => u.instanceId !== sourceInstanceId && !u.exhausted)
  if (others.length === 0) return state
  // Record the source card as well as the instance: the Support unit can leave play before the
  // choice is answered, and an instance id that no longer resolves cannot name anything (#374).
  const sourceCardId = state.players[owner].units.find(u => u.instanceId === sourceInstanceId)?.cardId
  return pushChoice(state, {
    kind: 'support',
    id: sourceInstanceId,
    controller: owner,
    unitId: sourceInstanceId,
    ...(sourceCardId ? { source: { cardId: sourceCardId, controller: owner } } : {}),
  })
}

/** {@link fireUpgradeAttached} as data, for a caller folding it into a wider batch (a unit entering). */
export function collectUpgradeAttached(state: GameState, instanceId: string, upgradePlayed = false, playingPlayer?: PlayerId): PendingTrigger[] {
  const found = findUnit(state, instanceId)
  // Who played it, since an opponent can play an upgrade on your unit ("when YOU play an upgrade on this unit").
  return found ? collectUnitTriggers(state, 'whenUpgradeAttached', found.unit, found.owner, { upgradePlayed, ...(playingPlayer ? { playingPlayer } : {}) }) : []
}

/**
 * Queue a "your next unit …" grant for `owner` this phase. The grant (keywords, a cost
 * delta, and/or enters-ready, with an optional trait/power filter) is consumed by the next unit that
 * matches its filter — cost in `effectiveCost`, the rest in `playUnitCard`; cleared at regroup. Generic:
 * Sabine (Shielded), Mouse Droid (−1 to the next Imperial), Neel (next ≤1-power unit enters ready).
 */
export function grantNextUnit(state: GameState, owner: PlayerId, grant: NextUnitGrant): GameState {
  return updatePlayer(state, owner, { nextUnitGrants: [...(state.players[owner].nextUnitGrants ?? []), grant] })
}

/**
 * Deal `amount` damage to a player's base. The caller runs the win check.
 *
 * `combat` names the attacking unit when this is combat damage, which is what lets the base owner's
 * side tell an attack from an ability's ping (Populist Advisor gains Sentinel only against an enemy
 * unit's combat damage). It is absent for every ability that damages a base.
 */
export function dealDamageToBase(state: GameState, player: PlayerId, amount: number, source?: DamageSource, combat?: { attackerInstanceId: string }): GameState {
  // The base's own prevention (Alliance Shield Generator), which settles the damage entirely when it acts.
  if (amount > 0 && !damageIsUnpreventable(state, source)) {
    for (const cardId of baseAbilityCardIds(state.players[player].base)) {
      const intercepted = getCardDefinition(cardId)?.baseAbilities?.interceptDamage?.(state, player, amount)
      if (intercepted) return intercepted
    }
  }
  const p = state.players[player]
  const dealt = baseDamageAfterPrevention(state, player, amount, source)
  // A shielded base used its prevention up on this damage.
  if (amount > 0 && dealt === 0 && state.shieldedBases?.includes(player) && !damageIsUnpreventable(state, source)) {
    const left = state.shieldedBases.filter(b => b !== player)
    return { ...state, shieldedBases: left.length > 0 ? left : undefined }
  }
  if (dealt <= 0) return state
  let next: GameState = { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: p.base.damage + dealt } } } }
  next = recordBaseDamaged(next, player, dealt) // "an enemy base was damaged this phase" (Baylan Skoll)
  // Only combat damage that actually LANDED counts, which is why this sits below the prevention
  // above rather than beside `recordBaseAttacked` at the declaration (Moff Gideon).
  if (combat) next = recordBaseCombatDamage(next, combat.attackerInstanceId)
  // One damage event, heard by both sides: "when your base is dealt damage" (Blade Three) and "when
  // you deal damage to an enemy base" (Cassian Andor) are its two readings.
  const dealer = damageDealer(state, source, combat !== undefined)
  return fireBatch(next, collectDamageDealt(next, { owner: player, units: [], base: dealt, byCombat: combat !== undefined, ...(dealer ? { dealer } : {}) }))
}

/**
 * Who dealt damage from `source`: the card and controller, and the unit when a unit in play dealt it.
 * With no source named, the effect resolving at the time dealt it (`GameState.resolvingSource`); with
 * neither, nobody is named, and a card that reads "you deal" does not hear it.
 *
 * Combat damage is always a unit's, including a defender that the same damage step defeats, so its
 * instance is taken as given rather than looked up.
 */
export function damageDealer(state: GameState, source: DamageSource | undefined, byCombat: boolean): DamageDealt['dealer'] {
  const from = source ?? state.resolvingSource
  if (!from) return undefined
  // A choice's stamped source names the card; the resolving effect may also know its instance.
  const instanceId = from.instanceId ?? (state.resolvingSource?.cardId === from.cardId ? state.resolvingSource.instanceId : undefined)
  const isUnit = instanceId !== undefined && (byCombat || findUnit(state, instanceId) !== undefined)
  return { controller: from.controller, cardId: from.cardId, ...(isUnit ? { unitId: instanceId } : {}) }
}

/** Everything one damage event triggers: both players' undeployed leaders, bases and units, the damaged side first. */
export function collectDamageDealt(state: GameState, event: DamageDealt): PendingTrigger[] {
  const ctx = { damageDealt: event }
  return [event.owner, opponentOf(event.owner)].flatMap(p => [
    ...collectPlayerTriggers(state, 'whenDamageDealt', p, ctx),
    ...collectUnitsTrigger(state, 'whenDamageDealt', p, ctx),
  ])
}

/**
 * Settle a set of upgrades being defeated: mark the phase for Baylan Skoll and fire "when a friendly
 * upgrade is defeated" (Zeb Orrelios).
 *
 * `upgradeOwners` carries ONE ENTRY PER UPGRADE, not one per player, and the trigger fires once for
 * each. Zeb reads "When a friendly upgrade is defeated: Deal 1 damage to a base" with no
 * once-each-round clause, and this set states that limit whenever it applies, so a unit dying with
 * three upgrades really is three reactions. Duplicate ids are de-collided by `pushChoice`, so each
 * firing leaves its own answerable choice.
 *
 * An upgrade belongs to whoever PLAYED it, not to the host's controller (#378), so a mixed stack
 * reaches each side's watchers separately.
 */
export function fireUpgradesDefeated(state: GameState, upgradeOwners: PlayerId[]): GameState {
  let next = state
  // One batch, not one per upgrade: they are defeated by the same event, so their reactions are
  // simultaneous and belong in one ordering question rather than nested under each other.
  const owed: PendingTrigger[] = []
  for (const owner of upgradeOwners) {
    next = recordUpgradeDefeated(next, owner)
    owed.push(...collectUnitsTrigger(next, 'whenFriendlyUpgradeDefeated', owner))
  }
  return fireBatch(next, owed)
}

/**
 * How much of `amount` actually lands on `player`'s base after their own units' prevention effects
 * (At Attin Safety Droid caps an instance at 4). Exposed separately so callers that report the
 * damage dealt (When Attack Ends → Hera Syndulla) quote the post-prevention figure.
 */
export function baseDamageAfterPrevention(state: GameState, player: PlayerId, amount: number, source?: DamageSource): number {
  if (damageIsUnpreventable(state, source)) return amount
  // Close the Shield Gate: the next damage to this base this phase is prevented whole.
  if (amount > 0 && state.shieldedBases?.includes(player)) return 0
  let out = amount
  for (const u of state.players[player].units) {
    for (const cid of abilityCardIds(u)) {
      const hook = getCardDefinition(cid)?.preventBaseDamage
      if (hook) out = hook(state, u, out)
    }
  }
  return Math.max(0, out)
}

/**
 * True if this instance of damage ignores Shields and base-damage prevention (Gorian Shard's
 * Corsair). Asked of every unit in play belonging to the damage's controller.
 */
export function damageIsUnpreventable(state: GameState, source?: DamageSource): boolean {
  if (!source) return false
  return state.players[source.controller].units.some(u =>
    abilityCardIds(u).some(id => getCardDefinition(id)?.makesDamageUnpreventable?.(state, u, source) ?? false),
  )
}

/** Heal `amount` damage from a unit — remove that much damage, never below 0. No-op if absent. */
export function healUnit(state: GameState, instanceId: string, amount: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.damage === 0 || amount <= 0) return state
  // "Each friendly unit that was healed this phase" (Barriss Offee) — recorded here, which is the
  // one place a unit is healed, so every source of healing counts.
  const amountHealed = Math.min(amount, found.unit.damage)
  const healed = recordUnitHealed(patchUnit(state, found.owner, instanceId, u => ({ ...u, damage: u.damage - amountHealed })), instanceId)
  // "When 1 or more damage is healed from this unit" (Silver Angel), with what the heal removed.
  const unit = findUnit(healed, instanceId)!.unit
  return fireBatch(healed, collectUnitTriggers(healed, 'whenHealed', unit, found.owner, { amountHealed }))
}

/**
 * Resource the top card of a player's deck: move deck[0] into resources. No-op if empty.
 *
 * **Exhausted, per CR 1.7.7**: "if an ability instructs a player to resource a card, the card is placed
 * facedown and exhausted in that player's resource zone unless otherwise specified". Only a card whose
 * text says otherwise arrives ready, and neither card reaching this path does (Long Live the Empire,
 * The Armorer), so the default is all this needs to implement.
 *
 * The distinction is tempo rather than economy: a ready resource is spendable in the same action that
 * created it, so ramp that arrives ready funds itself a round early.
 */
export function resourceTopOfDeck(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  if (p.deck.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: [...p.resources, { cardId: p.deck[0], exhausted: true }], deck: p.deck.slice(1) } } }
}

/**
 * Heal `amount` damage from a player's base — never below 0.
 *
 * **The only place a base is healed**, Restore included, which is what lets one card shut all of it
 * off (Confederate Tri-Fighter: "bases can't be healed"). Restore used to subtract from the base
 * inline in `attack`, where no such card could have reached it.
 */
export function healBase(state: GameState, player: PlayerId, amount: number): GameState {
  const p = state.players[player]
  if (p.base.damage === 0 || baseHealingSuppressed(state)) return state
  return { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: Math.max(0, p.base.damage - amount) } } } }
}

/**
 * True while a card in play stops bases being healed, or one did for this phase (Shifty Suspects).
 * Either side's base: the cards say "bases".
 */
function baseHealingSuppressed(state: GameState): boolean {
  if (state.basesUnhealable) return true
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    for (const u of state.players[side].units) {
      for (const cardId of abilityCardIds(u)) {
        if (getCardDefinition(cardId)?.suppressesBaseHealing?.(state, u) ?? false) return true
      }
    }
  }
  return false
}

/** Exhaust a unit (no-op if already exhausted or absent). */
export function exhaustUnit(state: GameState, instanceId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.exhausted) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, exhausted: true }))
}

/**
 * A leader lives in one of two places and carries its ready state wherever it is: `leader.exhausted`
 * while it sits in the base zone, and the unit's own `exhausted` once it has deployed. `deployLeader`
 * never touches the base-zone flag again, and regroup readies the two independently, so a cost paid
 * against the flag charges a deployed leader nothing.
 *
 * These two are the only correct way to ask about, and to charge, an "exhaust a friendly leader" cost.
 */
export function deployedLeaderUnit(state: GameState, owner: PlayerId): UnitState | undefined {
  const p = state.players[owner]
  return p.leader.deployed ? p.units.find(u => u.isLeader) : undefined
}

/** Whether an "exhaust a friendly leader" cost can still be paid. */
export function leaderCanExhaust(state: GameState, owner: PlayerId): boolean {
  const onBoard = deployedLeaderUnit(state, owner)
  // A deployed leader answers for itself; the base-zone flag is stale once it has left.
  if (state.players[owner].leader.deployed) return onBoard !== undefined && !onBoard.exhausted
  return !state.players[owner].leader.exhausted
}

/** Pay that cost, wherever the leader currently is. No-op if it cannot be paid. */
export function exhaustLeader(state: GameState, owner: PlayerId): GameState {
  const onBoard = deployedLeaderUnit(state, owner)
  if (onBoard) return exhaustUnit(state, onBoard.instanceId)
  if (state.players[owner].leader.deployed) return state // deployed but defeated: nothing to exhaust
  const p = state.players[owner]
  return p.leader.exhausted ? state : updatePlayer(state, owner, { leader: { ...p.leader, exhausted: true } })
}

/**
 * Create a token unit for `owner` — a fresh in-play unit from a built-in
 * token card (e.g. the Mandalorian). A Shielded token enters play with a shield
 * token, per its keyword. Consumes one instance id.
 */
/**
 * Create `count` token units, then offer any "double the tokens" replacement (Moff Jerjerrod).
 *
 * The card reads "if you would create N tokens, you may defeat this unit to create 2N instead". Rather
 * than pause mid-effect for that choice (which would need a resumable pipeline), we lean on the
 * equivalence **2N ≡ N then N more**: create the N, then offer a yes/no to defeat the replacer and top
 * up by another N. Same end state, no interrupt. The batch `count` is why this API exists — creating
 * one at a time would only ever let it add +1.
 */
export function createTokenUnits(state: GameState, owner: PlayerId, tokenCardId: string, count: number): GameState {
  let next = state
  for (let i = 0; i < count; i++) next = createTokenUnit(next, owner, tokenCardId)
  if (count <= 0) return next
  const replacer = next.players[owner].units.find(u =>
    abilityCardIds(u).some(id => getCardDefinition(id)?.doublesTokenCreation?.(next, u) ?? false),
  )
  return replacer
    ? pushChoice(next, { kind: 'mayDoubleTokens', id: `${replacer.instanceId}-double`, controller: owner, unitId: replacer.instanceId, token: tokenCardId, count })
    : next
}

/** Whether a unit `owner` plays or creates enters play ready because of a unit they control (Ritual Dragon). */
export function friendlyUnitsEnterReady(state: GameState, owner: PlayerId): boolean {
  return state.players[owner].units.some(u => abilityCardIds(u).some(id => getCardDefinition(id)?.unitsEnterReady?.(state, u) ?? false))
}

export function createTokenUnit(state: GameState, owner: PlayerId, tokenCardId: string): GameState {
  const tokenCard = state.cards[tokenCardId]
  const shielded = (tokenCard?.keywords ?? []).some(k => k.name === 'Shielded')
  const p = state.players[owner]
  const entersReady = friendlyUnitsEnterReady(state, owner)
    || p.units.some(u => abilityCardIds(u).some(id => getCardDefinition(id)?.tokensEnterReady?.(state, u) ?? false))
  const token: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId: tokenCardId,
    arena: tokenCard?.arena ?? 'ground',
    damage: 0,
    exhausted: !entersReady, // created units enter exhausted (CR 1.5.4b) unless an ability says otherwise
    isLeader: false,
    upgrades: shielded ? [{ cardId: TOKEN_SHIELD, owner }] : [],
  }
  // A created token enters play, so it counts for "units that entered play this phase" (Padmé Amidala).
  const next = recordUnitEntered(recordTokenCreated({
    ...state,
    instanceCounter: state.instanceCounter + 1,
    players: { ...state.players, [owner]: { ...p, units: [...p.units, token] } },
  }, owner), owner, token.instanceId)
  // Every token unit is created here, so this is the one place "when you create a unit" fires. Each
  // token is its own arrival: "create 2" gives Greef Karga two Advantage tokens to hand out.
  return fireBatch(next, collectArrivalTriggers(next, 'whenCreateUnit', owner, token.instanceId))
}

/** Draw `n` cards for a player (takes what's there if the deck is short). */
export function drawCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const drawn = p.deck.slice(0, n)
  if (drawn.length === 0) return state // nothing drawn → not a draw event
  const next = recordCardsDrawn({
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: [...p.hand, ...drawn], deck: p.deck.slice(drawn.length) } },
  }, owner, drawn.length)
  // "When you draw 1 or more cards" (Axe Woves) — once per event, however many cards.
  //
  // Fired on BOTH players' units, because the point is also printed from the far side ("when an
  // opponent draws 1 or more cards", Crosshair) and a listener that only ever saw its own
  // controller's draws could not express that. Who drew is in `ctx.drawingPlayer`, and every
  // registration compares it against `ctx.owner` rather than assuming one side.
  const ctx = { drawingPlayer: owner, cardsDrawn: drawn.length }
  return fireUnitsTrigger(fireUnitsTrigger(next, 'whenDrawCards', owner, ctx), 'whenDrawCards', opponentOf(owner), ctx)
}

/** Every ability `owner`'s units have at `point`: one event, so one batch. */
export function collectUnitsTrigger(state: GameState, point: TriggerPoint, owner: PlayerId, ctx?: TriggerContext): PendingTrigger[] {
  return state.players[owner].units.flatMap(u => collectUnitTriggers(state, point, u, owner, ctx))
}

/** Fire `point` on every unit `owner` controls, as one ordered batch. */
export function fireUnitsTrigger(state: GameState, point: TriggerPoint, owner: PlayerId, ctx?: TriggerContext): GameState {
  return fireBatch(state, collectUnitsTrigger(state, point, owner, ctx))
}

/**
 * Return a unit from the board to its owner's hand (Purrgil Ultra). The unit's card goes to
 * hand (a token unit can't return — it ceases to exist); its card-upgrades go to their owners'
 * discards; token upgrades vanish. No-op if the unit isn't in play.
 */
export function returnUnitToHand(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const u = state.players[owner].units.find(x => x.instanceId === instanceId)
    if (!u) continue
    // The card returns to its OWNER's hand, which may not be its controller (a stolen unit).
    const cardOwner = u.owner ?? owner
    let next = updatePlayer(state, owner, { units: state.players[owner].units.filter(x => x.instanceId !== instanceId) })
    if (!isTokenCard(u.cardId)) {
      next = updatePlayer(next, cardOwner, { hand: [...next.players[cardOwner].hand, u.cardId] })
    }
    for (const up of u.upgrades) {
      if (state.cards[up.cardId]?.type === 'token') continue // token upgrades cease to exist
      next = updatePlayer(next, up.owner, { discard: [...next.players[up.owner].discard, up.cardId] })
    }
    next = recordUnitLeftPlay(next, owner, u.cardId, u.isLeader)
    // Leaving play releases whatever it had captured.
    return releaseCaptured(next, owner, u.captured ?? [])
  }
  return state
}

/**
 * Release the cards a unit had captured (Bothan-5): each returns to PLAY under its owner's
 * control, exhausted, in its own arena. It is not being *played*, so nothing that keys off playing
 * happens: no "When Played" (or play/create) trigger, no Shielded shield token, no Ambush attack,
 * and no cost. It IS entering play, though (CR 7.1: a card enters play when it moves from an
 * out-of-play zone to an in-play zone), so it counts as having entered play this phase and raises
 * the arrival triggers that read an entry rather than a play. Token cards can't come back: they
 * ceased to exist when captured.
 */
export function releaseCaptured(state: GameState, owner: PlayerId, cardIds: string[]): GameState {
  let next = state
  for (const cardId of cardIds) {
    if (isTokenCard(cardId)) continue
    const card = next.cards[cardId]
    const instanceId = `u${next.instanceCounter}`
    next = {
      ...next,
      instanceCounter: next.instanceCounter + 1,
      players: {
        ...next.players,
        [owner]: {
          ...next.players[owner],
          units: [...next.players[owner].units, {
            instanceId,
            cardId,
            arena: card?.arena ?? 'ground',
            damage: 0,
            exhausted: true, // rescued units arrive exhausted
            isLeader: false,
            upgrades: [],
          }],
        },
      },
    }
    // Each rescued card is its own arrival, so each gets its own batch, as a created token does.
    next = recordUnitEntered(next, owner, instanceId)
    next = fireBatch(next, collectArrivalTriggers(next, undefined, owner, instanceId))
  }
  return next
}

/** Exhaust one ready resource of `owner` (Mandalorian Scout). No-op if none is ready. */
export function exhaustReadyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => !r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: true } : r)) } } }
}

/** Ready a unit (clear its exhausted flag) wherever it is (Grand Admiral Thrawn). No-op if not in play. */
export function readyUnit(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const unit = state.players[owner].units.find(u => u.instanceId === instanceId)
    if (unit) {
      if (unitCannotReady(state, unit)) return state
      return updatePlayer(state, owner, { units: state.players[owner].units.map(u => (u.instanceId === instanceId ? { ...u, exhausted: false } : u)) })
    }
  }
  return state
}

/** True while something on the unit says it can't ready (Frozen in Carbonite). */
export function unitCannotReady(state: GameState, unit: UnitState): boolean {
  if ((state.lastingEffects ?? []).some(e => e.cannotReady && e.targetInstanceId === unit.instanceId)) return true
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.cannotReady?.(state, unit) ?? false)
}

/** Ready one exhausted resource of `owner` (Emperor's Messenger). No-op if none is exhausted. */
export function readyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: false } : r)) } } }
}

/** Move the top `n` cards of a player's deck to the bottom, preserving order (Clan Wren Loyalist). */
export function bottomTopCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const top = p.deck.slice(0, n)
  if (top.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, deck: [...p.deck.slice(top.length), ...top] } } }
}

/** Discard the card at `handIndex` from a player's hand to their discard pile. No-op if out of range. */
export function discardFromHand(state: GameState, owner: PlayerId, handIndex: number): GameState {
  const p = state.players[owner]
  const cardId = p.hand[handIndex]
  if (cardId === undefined) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: p.hand.filter((_, i) => i !== handIndex), discard: [...p.discard, cardId] } },
  }
}

/**
 * Defeat EVERY `tokenCardId` token on a unit: the "it was spent" form (#419).
 *
 * A Shield soaking damage and an Advantage token finishing a combat are both DEFEATS, as each token
 * card says, so they must settle the same consequences a card-upgrade's defeat does: the phase is
 * marked for Baylan Skoll and "when a friendly upgrade is defeated" fires (Zeb Orrelios) for each
 * token's OWNER, who need not be the host's controller. They were previously filtered out of the
 * `upgrades` array in place, which settled nothing. Tokens cease to exist, so nothing is discarded.
 *
 * One reaction per token, as `fireUpgradesDefeated` does throughout: spending three Advantage
 * tokens on one attack defeats three upgrades, so Zeb Orrelios fires three times.
 */
export function defeatTokensOn(state: GameState, owner: PlayerId, instanceId: string, tokenCardId: string): GameState {
  const host = state.players[owner].units.find(u => u.instanceId === instanceId)
  const spent = host?.upgrades.filter(a => a.cardId === tokenCardId) ?? []
  if (spent.length === 0) return state
  const next = updatePlayer(state, owner, {
    units: state.players[owner].units.map(u =>
      u.instanceId === instanceId ? { ...u, upgrades: u.upgrades.filter(a => a.cardId !== tokenCardId) } : u,
    ),
  })
  return fireUpgradesDefeated(next, spent.map(a => a.owner))
}

/**
 * Defeat the first upgrade with `cardId` on a unit: remove it from the unit;
 * a card-upgrade goes to its OWNER's discard, a token simply ceases to exist. A no-op
 * if the unit or upgrade is gone (e.g. the host was already defeated). Used by
 * self-sacrificing upgrades like Grav Charge.
 */
export function defeatUpgrade(state: GameState, instanceId: string, cardId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found) return state
  const idx = found.unit.upgrades.findIndex(a => a.cardId === cardId)
  if (idx === -1) return state
  const removed = found.unit.upgrades[idx]

  let next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== idx) }))
  if (state.cards[cardId]?.type !== 'token') {
    const op = next.players[removed.owner]
    next = { ...next, players: { ...next.players, [removed.owner]: { ...op, discard: [...op.discard, cardId] } } }
  }
  return fireUpgradesDefeated(next, [removed.owner])
}

/**
 * Defeat the first upgrade with `cardId` on `baseOwner`'s base: the base-zone form of `defeatUpgrade`.
 * A card upgrade goes to its OWNER's discard pile, a token ceases to exist, and "when a friendly upgrade
 * is defeated" fires for its owner. A no-op if the upgrade is no longer there.
 */
export function defeatBaseUpgrade(state: GameState, baseOwner: PlayerId, cardId: string): GameState {
  return defeatUpgradeAt(state, baseHostId(baseOwner), (state.players[baseOwner].base.upgrades ?? []).findIndex(a => a.cardId === cardId))
}

/** Remove the upgrade at `index` from `baseOwner`'s base, returning it with the new state. */
function detachBaseUpgrade(state: GameState, baseOwner: PlayerId, index: number): { next: GameState; removed?: UpgradeAttachment } {
  const base = state.players[baseOwner].base
  const removed = base.upgrades?.[index]
  if (!removed) return { next: state }
  const left = base.upgrades!.filter((_, i) => i !== index)
  return { next: updatePlayer(state, baseOwner, { base: { ...base, upgrades: left.length > 0 ? left : undefined } }), removed }
}

/** The upgrade an `UpgradeRef`'s host and position name, on a unit or a base, if it is still there. */
export function upgradeAt(state: GameState, hostId: string, index: number): UpgradeAttachment | undefined {
  const baseOwner = baseHostOwner(hostId)
  return baseOwner ? state.players[baseOwner].base.upgrades?.[index] : findUnit(state, hostId)?.unit.upgrades[index]
}

/**
 * Defeat the upgrade at position `index` on a unit or, for `baseHostId(owner)`, on that base: the
 * precise-instance form of `defeatUpgrade`, so a chosen upgrade (e.g. one of two identical Advantage
 * tokens) is removed exactly. A card-upgrade goes to its owner's discard; a token ceases to exist.
 * No-op if the host or index is gone.
 */
export function defeatUpgradeAt(state: GameState, instanceId: string, index: number): GameState {
  const baseOwner = baseHostOwner(instanceId)
  if (baseOwner) {
    const { next, removed } = detachBaseUpgrade(state, baseOwner, index)
    if (!removed) return state
    const discarded = state.cards[removed.cardId]?.type === 'token'
      ? next
      : updatePlayer(next, removed.owner, { discard: [...next.players[removed.owner].discard, removed.cardId] })
    return fireUpgradesDefeated(discarded, [removed.owner])
  }
  const found = findUnit(state, instanceId)
  const removed = found?.unit.upgrades[index]
  if (!found || !removed) return state
  let next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== index) }))
  if (state.cards[removed.cardId]?.type !== 'token') {
    const op = next.players[removed.owner]
    next = { ...next, players: { ...next.players, [removed.owner]: { ...op, discard: [...op.discard, removed.cardId] } } }
  }
  return fireUpgradesDefeated(next, [removed.owner])
}

/**
 * Return the upgrade at `index` to **its owner's** hand (Jabba the Hutt, Full of Surprises), which
 * may not be the host unit's controller.
 *
 * A TOKEN upgrade has no card to put in a hand, so it is DEFEATED instead (#401). That routes
 * through `defeatUpgradeAt`, so "when a friendly upgrade is defeated" fires for the token's owner;
 * it used to be deleted silently, firing nothing. Returning a real card is still not a defeat, so
 * that path fires no trigger.
 */
export function returnUpgradeToHand(state: GameState, instanceId: string, index: number): GameState {
  const baseOwner = baseHostOwner(instanceId)
  if (baseOwner) {
    const { next, removed } = detachBaseUpgrade(state, baseOwner, index)
    if (!removed) return state
    if (state.cards[removed.cardId]?.type === 'token') return defeatUpgradeAt(state, instanceId, index)
    return updatePlayer(next, removed.owner, { hand: [...next.players[removed.owner].hand, removed.cardId] })
  }
  const found = findUnit(state, instanceId)
  const removed = found?.unit.upgrades[index]
  if (!found || !removed) return state
  if (state.cards[removed.cardId]?.type === 'token') return defeatUpgradeAt(state, instanceId, index)
  const next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== index) }))
  const op = next.players[removed.owner]
  return { ...next, players: { ...next.players, [removed.owner]: { ...op, hand: [...op.hand, removed.cardId] } } }
}

/**
 * Move one copy of `cardId` from a player's discard pile to their hand. A no-op if it isn't there.
 * Card type does not matter: Blade of Talzin returns itself as an upgrade, Darth Sion as a unit that
 * was defeated at 7 or more power.
 */
export function returnCardFromDiscardToHand(state: GameState, owner: PlayerId, cardId: string): GameState {
  const p = state.players[owner]
  const idx = p.discard.indexOf(cardId)
  if (idx === -1) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, discard: p.discard.filter((_, i) => i !== idx), hand: [...p.hand, cardId] } },
  }
}

/**
 * Return every card-upgrade on a unit (except `exceptCardId` and tokens) to its
 * OWNER's hand — each upgrade routes to the player who owns it.
 */
export function returnOtherUpgradesToHand(state: GameState, instanceId: string, exceptCardId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found) return state
  const returned = found.unit.upgrades.filter(u => u.cardId !== exceptCardId && state.cards[u.cardId]?.type !== 'token')
  if (returned.length === 0) return state

  let next = patchUnit(state, found.owner, instanceId, u => ({
    ...u,
    upgrades: u.upgrades.filter(a => !returned.includes(a)),
  }))
  for (const up of returned) {
    const op = next.players[up.owner]
    next = { ...next, players: { ...next.players, [up.owner]: { ...op, hand: [...op.hand, up.cardId] } } }
  }
  return next
}
