import type { Action } from './actions'
import type { EngineCard, GameState, HandCardRef, PlayerId, ResourceUpgradeRef, UnitState } from './types'
import { opponentOf, hasPendingChoices, nextUnitGrantMatches } from './types'
import { canAfford, readyResourceCount } from './resources'
import { unitHasKeyword } from './keywords'
import { getCardDefinition, unitActionAbilities, actionAbilityKey, leaderActions } from './abilities'
import './cardDefinitions' // side effect: registers all real card behaviours (#341+)

/**
 * The enemy units `attacker` (a unit controlled by the active player) may attack,
 * and whether Sentinel locks the attack onto them (so the base is off-limits).
 * Sentinel forces the attack; Hidden removes a unit as a target unless it also has
 * Sentinel; Saboteur ignores Sentinel (#334).
 */
export function enemyAttackTargets(state: GameState, attacker: UnitState): { targets: UnitState[]; sentinelLocked: boolean } {
  const enemy = state.players[opponentOf(state.activePlayer)]
  const sameArena = enemy.units.filter(e => e.arena === attacker.arena)
  const attackable = sameArena.filter(e => !e.hidden || unitHasKeyword(state, e, 'Sentinel'))
  const sentinels = attackable.filter(e => unitHasKeyword(state, e, 'Sentinel'))
  const sentinelLocked = sentinels.length > 0 && !unitHasKeyword(state, attacker, 'Saboteur')
  return { targets: sentinelLocked ? sentinels : attackable, sentinelLocked }
}

/**
 * Effective cost of playing a card, including the aspect penalty (CR 8.1):
 * +2 resources per aspect icon on the card beyond those provided by the
 * player's leader and base. Icons match as a multiset — a doubled icon on a
 * card needs two provided copies to avoid the penalty.
 */
export function effectiveCost(state: GameState, playerId: PlayerId, card: EngineCard, target?: UnitState): number {
  const p = state.players[playerId]
  const provided: string[] = [
    ...(state.cards[p.leader.cardId]?.aspects ?? []),
    ...(state.cards[p.base.cardId]?.aspects ?? []),
  ]
  // A unit may provide its aspect icons while its controller pays costs — The Darksaber (#343).
  for (const u of p.units) {
    for (const cardId of [u.cardId, ...u.upgrades.map(x => x.cardId)]) {
      provided.push(...(getCardDefinition(cardId)?.providesAspects?.(state, u) ?? []))
    }
  }
  let penalty = 0
  for (const icon of card.aspects) {
    const i = provided.indexOf(icon)
    if (i === -1) {
      penalty += 2
    } else {
      provided.splice(i, 1)
    }
  }
  // Card-specific cost modifiers (e.g. −1 on an Imperial/Mandalorian unit) (#340).
  const modifier = getCardDefinition(card.id)?.costModifier?.(state, playerId, target) ?? 0
  // "Your next unit …" cost grants that match this card — Mouse Droid's −1 to the next Imperial (#355).
  const grantDelta = (p.nextUnitGrants ?? []).reduce((sum, g) => sum + (nextUnitGrantMatches(card, g) ? (g.costDelta ?? 0) : 0), 0)
  return Math.max(0, card.cost + penalty + modifier + grantDelta)
}

/**
 * Hand units `owner` can afford to play via an ability (#348): each unit card whose effective cost
 * (plus `costDelta`, floored at 0) fits the ready resources left after `extraResourceCost` (the
 * ability's own C=… cost). Used both to gate the ability (`usable`) and to build the play choice.
 */
export function affordableHandUnits(state: GameState, owner: PlayerId, extraResourceCost: number, costDelta: number): HandCardRef[] {
  const p = state.players[owner]
  const budget = readyResourceCount(p) - extraResourceCost
  const out: HandCardRef[] = []
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (card?.type !== 'unit') return
    if (Math.max(0, effectiveCost(state, owner, card) + costDelta) <= budget) out.push({ handIndex, cardId })
  })
  return out
}

/**
 * Valid targets for playing the resource upgrade at `resourceIndex` (#348): units from `targetUnits`
 * that pass the upgrade's attach restriction and — when `payCost` — are affordable from the ready
 * resources left after the upgrade itself leaves the resource pool.
 */
export function validUpgradeTargets(state: GameState, owner: PlayerId, resourceIndex: number, cardId: string, payCost: boolean, targetUnits: string[]): string[] {
  const p = state.players[owner]
  const resource = p.resources[resourceIndex]
  const card = state.cards[cardId]
  if (!resource || resource.cardId !== cardId || card?.type !== 'upgrade') return []
  const available = readyResourceCount(p) - (resource.exhausted ? 0 : 1)
  const restriction = getCardDefinition(cardId)?.attachRestriction
  const inPlay = [...state.players.player.units, ...state.players.opponent.units]
  return targetUnits.filter(id => {
    const tu = inPlay.find(u => u.instanceId === id)
    if (!tu || (restriction && !restriction(state, tu))) return false
    return !payCost || effectiveCost(state, owner, card, tu) <= available
  })
}

/** Upgrades in `owner`'s resource zone that can be played on at least one of `targetUnits` (#348). */
export function resourceUpgradeCandidates(state: GameState, owner: PlayerId, payCost: boolean, targetUnits: string[]): ResourceUpgradeRef[] {
  const out: ResourceUpgradeRef[] = []
  state.players[owner].resources.forEach((r, resourceIndex) => {
    if (state.cards[r.cardId]?.type !== 'upgrade') return
    if (validUpgradeTargets(state, owner, resourceIndex, r.cardId, payCost, targetUnits).length > 0) out.push({ resourceIndex, cardId: r.cardId })
  })
  return out
}

/**
 * Legal move generator (T2.4) — every action the active player may take.
 * The single source of truth for legality: the resolver applies actions
 * produced here without re-validating game rules.
 */
export function legalMoves(state: GameState): Action[] {
  if (state.winner !== null) return []

  switch (state.phase) {
    case 'setup':
      return setupMoves(state)
    case 'action':
      return actionPhaseMoves(state)
    case 'regroup':
      return regroupPhaseMoves(state)
  }
}

function setupMoves(state: GameState): Action[] {
  // CR 5.2.1e: first, each player decides whether to take their one mulligan.
  if (state.setupStage === 'mulligan') {
    return [{ type: 'mulligan' }, { type: 'keepHand' }]
  }
  // CR 5.2.1f: then each player resources two cards, one pick at a time.
  return state.players[state.activePlayer].hand.map(
    (_, handIndex): Action => ({ type: 'setupResource', handIndex }),
  )
}

function actionPhaseMoves(state: GameState): Action[] {
  // A pending choice (Ambush/Support/pay-or-exhaust …) overrides the normal moves.
  if (hasPendingChoices(state)) return choiceMoves(state)

  const moves: Action[] = []
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const enemy = state.players[opponentOf(playerId)]

  // Play a Card (units only in MVP — see actions.ts)
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (!card || card.type !== 'unit') return
    if (canAfford(p, effectiveCost(state, playerId, card))) {
      moves.push({ type: 'playCard', handIndex })
    }
  })

  // Play an Upgrade — attach to any unit in play (either player's) by default; a
  // card's attachRestriction narrows that, and its cost may depend on the target
  // (#308/#340).
  const allUnits = [...p.units, ...enemy.units]
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (!card || card.type !== 'upgrade') return
    const restriction = getCardDefinition(card.id)?.attachRestriction
    for (const target of allUnits) {
      if (restriction && !restriction(state, target)) continue
      if (!canAfford(p, effectiveCost(state, playerId, card, target))) continue
      moves.push({ type: 'playUpgrade', handIndex, targetInstanceId: target.instanceId })
    }
  })

  // Attack With a Unit — ready units; targets are enemy units in the same
  // arena, or the enemy base (CR 1.15.3, 3.2.3). Sentinel forces the attack
  // onto a Sentinel unit in that arena — even the base is off-limits — unless
  // the attacker has Saboteur (CR 6.3.2b).
  for (const unit of p.units) {
    if (unit.exhausted) continue

    const { targets, sentinelLocked } = enemyAttackTargets(state, unit)
    for (const enemyUnit of targets) {
      moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'unit', instanceId: enemyUnit.instanceId } })
    }
    if (!sentinelLocked) {
      moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'base' } })
    }
  }

  // Deploy Leader — epic action; requires CONTROLLING resources equal to the leader's
  // cost (CR 2.6.1 — controlled, not spent; exhausted ones count), unless the leader
  // supplies a custom deploy condition (e.g. Bo-Katan) (#309).
  const leaderCard = state.cards[p.leader.cardId]
  if (leaderCard && !p.leader.deployed && !p.leader.epicActionUsed) {
    const condition = getCardDefinition(p.leader.cardId)?.deployCondition
    const canDeploy = condition ? condition(state, playerId) : p.resources.length >= leaderCard.cost
    if (canDeploy) moves.push({ type: 'deployLeader' })
  }

  // Use a unit's activated "Action:" ability (#343) — e.g. Improvised Identity. Each
  // is addressed by its source card + index; once-per-round ones drop once used.
  for (const u of p.units) {
    for (const { cardId, index, ability } of unitActionAbilities(u)) {
      if (ability.oncePerRound && u.usedAbilities?.includes(actionAbilityKey(cardId, index))) continue
      if (!canAfford(p, ability.cost ?? 0)) continue
      if (ability.usable && !ability.usable(state, u)) continue
      moves.push({ type: 'useAbility', instanceId: u.instanceId, cardId, index })
    }
  }

  // Use an undeployed leader's activated "Action:" ability (#309). A targeted ability
  // yields one move per valid target (none = not usable); a target-less one is gated by
  // `usable` and affordability.
  if (!p.leader.deployed && !p.leader.exhausted) {
    leaderActions(p.leader.cardId).forEach((ability, index) => {
      if (!canAfford(p, ability.cost ?? 0)) return
      if (ability.targets) {
        for (const targetInstanceId of ability.targets(state, playerId)) {
          moves.push({ type: 'useLeaderAbility', index, targetInstanceId })
        }
      } else if (!ability.usable || ability.usable(state, playerId)) {
        moves.push({ type: 'useLeaderAbility', index })
      }
    })
  }

  // Take the Initiative — once per round across both players (CR 1.15.5a).
  if (state.initiativeTakenBy === null) {
    moves.push({ type: 'takeInitiative' })
  }

  moves.push({ type: 'pass' })
  return moves
}

/**
 * Moves while choices are pending (#334/#342). The active player resolves their own
 * simultaneous choices in any order (each is addressable by id, honouring active-player
 * trigger ordering). Ambush: the played unit may attack an enemy unit (never the base).
 * Support: any OTHER ready unit may attack (unit or base), gaining the support unit's
 * keywords. Pay-or-exhaust (The Conflict Within): pay if affordable, or decline. Any
 * choice can be skipped.
 */
function choiceMoves(state: GameState): Action[] {
  const p = state.players[state.activePlayer]
  const moves: Action[] = []

  for (const choice of state.pendingChoices ?? []) {
    if (choice.controller !== state.activePlayer) continue
    switch (choice.kind) {
      case 'ambush': {
        const unit = p.units.find(u => u.instanceId === choice.unitId)
        if (unit) {
          for (const e of enemyAttackTargets(state, unit).targets) {
            moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          }
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'support': {
        // The chosen attacker gains the Support source's full abilities for the attack (#348), so
        // its granted keywords (Saboteur, Sentinel-ignoring…) shape the legal targets here too.
        const sourceCardId = p.units.find(u => u.instanceId === choice.unitId)?.cardId
        for (const candidate of p.units) {
          if (candidate.exhausted || candidate.instanceId === choice.unitId) continue
          const attacker = sourceCardId ? { ...candidate, grantedAbilityCardIds: [sourceCardId] } : candidate
          const { targets, sentinelLocked } = enemyAttackTargets(state, attacker)
          for (const e of targets) {
            moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          }
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'base' } })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'payOrExhaust': {
        if (readyResourceCount(p) >= choice.cost) moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPlayTopFree': {
        // The card is always revealed (a "look at"); it can only be PLAYED free if it costs
        // ≤ 2. A unit/event needs no target; an upgrade offers one accept per valid attach
        // target (like playUpgrade).
        const top = state.cards[choice.cardId]
        if (top && top.cost <= 2) {
          if (top.type === 'upgrade') {
            const restriction = getCardDefinition(top.id)?.attachRestriction
            for (const t of [...state.players.player.units, ...state.players.opponent.units]) {
              if (restriction && !restriction(state, t)) continue
              moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: t.instanceId })
            }
          } else {
            moves.push({ type: 'acceptChoice', choiceId: choice.id })
          }
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDamageExhaust': {
        // DDC Defender: pick any unit in this unit's arena to deal 1 + exhaust, or decline.
        for (const t of [...state.players.player.units, ...state.players.opponent.units]) {
          if (t.arena === choice.arena) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: t.instanceId })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'search': {
        // Improvised Identity: pick which revealed ground unit to discard (mandatory —
        // the choice is only raised when at least one is present).
        choice.revealed.forEach((cid, i) => {
          const c = state.cards[cid]
          if (c?.type === 'unit' && c.arena === 'ground') moves.push({ type: 'acceptChoice', choiceId: choice.id, deckIndex: i })
        })
        break
      }
      case 'mayAdvantageEach':
      case 'mayLastingBuff':
      case 'mayGiveAdvantage':
      case 'mayExhaustLeaderGiveAdvantage':
      case 'mayExhaustLeaderExhaustUnit':
      case 'mayExhaustUnit':
      case 'multiPick': {
        // Optional targeted effects (#309/#347/#355): pick an eligible target, or decline / finish.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDamage':
      case 'mayGiveTokens': {
        // Targeted damage / token grant (#309/#355): a decline is offered unless the effect is
        // mandatory (`optional: false`, e.g. Snub Fighter Squadron's "Deal 1 to a space unit").
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        if (choice.optional !== false) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'chooseOne': {
        // Choose-one/modal (#348): one move per option, no decline (mandatory).
        choice.options.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        break
      }
      case 'selectUpgradeToDefeat': {
        // Vane (#348): pick a candidate upgrade to defeat; Cancel only on the optional (deployed) form.
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectDamageTarget':
      case 'selectHealTarget': {
        // Deal/heal N to a chosen unit or base (#348) — mandatory unless `optional` (Nebulon-C's "may heal").
        for (const id of choice.unitTargets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        for (const bp of choice.baseTargets) moves.push({ type: 'acceptChoice', choiceId: choice.id, baseTarget: bp })
        if (choice.kind === 'selectHealTarget' && choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayExhaustLeaderHealUnit': {
        // Luke front: a yes/no — the healed unit is fixed (the attacker).
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'playUnitFromHand': {
        // Play a chosen hand unit (#348) — one move per affordable candidate. Mandatory.
        for (const { handIndex } of choice.candidates) moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex })
        break
      }
      case 'selectUnitToExhaust': {
        // Fennec's "exhaust a friendly unit" additional cost (#348) — pick one. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'selectResourceUpgrade': {
        // The Armorer (#348): pick a resource upgrade to play; Cancel only on the optional (deployed) form.
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'attachResourceUpgrade': {
        // Attach the chosen resource upgrade to a valid unit (#348). Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'mayExhaustLeaderForAdvantage': {
        // Greef Karga front: a yes/no — the target unit is fixed (#309).
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPayToDraw': {
        // Mandalorian (#348): a yes/no — accept only if the cost is affordable.
        if (readyResourceCount(p) >= choice.cost) moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectDiscard': {
        // Mos Espa Watermonger (#355): discard a card from hand — any hand card is eligible.
        p.hand.forEach((_, handIndex) => moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDeployLeader': {
        // Grogu (#348): a yes/no to deploy via the triggered epic action.
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectUniqueToDefeat': {
        // Unique rule (#348): pick which duplicate to defeat. Mandatory (must reduce to one).
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        break
      }
      case 'selectUniqueUnitToDefeat': {
        // Unique unit rule (#348): pick which duplicate unit to defeat (board target). Mandatory.
        for (const id of choice.candidates) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'attackWithRestore': {
        // Thrawn front (#348): attack with any ready unit (the Restore grant is applied on resolve).
        for (const u of p.units) {
          if (u.exhausted) continue
          const { targets, sentinelLocked } = enemyAttackTargets(state, u)
          for (const e of targets) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'base' } })
        }
        break
      }
      case 'mayDefeatEnemyUnit': {
        // Thrawn deployed (#348): pick a non-leader enemy unit to defeat, or decline.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'opponentGivesAdvantage': {
        // Sabine front (#348): the opponent picks which of their units gets the Advantage tokens. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'mayAttack': {
        // Improvised Identity's optional follow-up attack, with the discarded unit's
        // abilities granted (so granted Saboteur etc. shape the legal targets).
        const u = p.units.find(x => x.instanceId === choice.unitId)
        if (u && !u.exhausted) {
          const attacker = choice.grantCardId ? { ...u, grantedAbilityCardIds: [choice.grantCardId] } : u
          const { targets, sentinelLocked } = enemyAttackTargets(state, attacker)
          for (const e of targets) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'base' } })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
    }
  }
  return moves
}

function regroupPhaseMoves(state: GameState): Action[] {
  if (state.regroupResourced[state.activePlayer]) return []

  const moves: Action[] = state.players[state.activePlayer].hand.map(
    (_, handIndex): Action => ({ type: 'resourceCard', handIndex }),
  )
  moves.push({ type: 'skipResource' })
  return moves
}

// Re-exported for callers that only need affordability checks.
export { readyResourceCount }
