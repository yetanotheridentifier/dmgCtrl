import type { Action } from './actions'
import type { EngineCard, GameState, KeywordInstance, PlayerId, UnitState } from './types'
import { opponentOf } from './types'
import { canAfford, readyResourceCount } from './resources'
import { unitHasKeyword } from './keywords'
import { getCardDefinition } from './abilities'
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
  return Math.max(0, card.cost + penalty + modifier)
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
  // A pending on-play trigger (Ambush) overrides the normal moves: resolve it first.
  if (state.pendingTrigger) return triggerMoves(state)

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

  // Deploy Leader — epic action; requires CONTROLLING resources equal to the
  // leader's cost (CR 2.6.1 — controlled, not spent; exhausted ones count).
  const leaderCard = state.cards[p.leader.cardId]
  if (
    leaderCard &&
    !p.leader.deployed &&
    !p.leader.epicActionUsed &&
    p.resources.length >= leaderCard.cost
  ) {
    moves.push({ type: 'deployLeader' })
  }

  // Take the Initiative — once per round across both players (CR 1.15.5a).
  if (state.initiativeTakenBy === null) {
    moves.push({ type: 'takeInitiative' })
  }

  moves.push({ type: 'pass' })
  return moves
}

/**
 * The keywords a Support unit lends to another attacker for one attack — its card's
 * and upgrades' keywords, excluding Support itself (no chaining) (#334).
 */
export function supportGrantedKeywords(state: GameState, supportUnitId: string): KeywordInstance[] {
  const su = state.players[state.activePlayer].units.find(u => u.instanceId === supportUnitId)
  if (!su) return []
  const kws = [
    ...(state.cards[su.cardId]?.keywords ?? []),
    ...su.upgrades.flatMap(a => state.cards[a.cardId]?.keywords ?? []),
  ]
  return kws.filter(k => k.name !== 'Support')
}

/**
 * Moves while a pending on-play trigger is unresolved (#334). Ambush: the played
 * unit may attack an enemy unit (never the base). Support: any OTHER ready unit may
 * attack (unit or base), gaining the support unit's keywords. Either can be skipped.
 */
function triggerMoves(state: GameState): Action[] {
  const trigger = state.pendingTrigger!
  const p = state.players[state.activePlayer]
  const moves: Action[] = []

  if (trigger.kind === 'ambush') {
    const unit = p.units.find(u => u.instanceId === trigger.unitId)
    if (unit) {
      for (const e of enemyAttackTargets(state, unit).targets) {
        moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
      }
    }
  } else {
    // Support: each other ready unit may attack, seeing the granted keywords (e.g.
    // a granted Saboteur ignoring Sentinel). Support attacks may hit the base too.
    const granted = supportGrantedKeywords(state, trigger.unitId)
    for (const candidate of p.units) {
      if (candidate.exhausted || candidate.instanceId === trigger.unitId) continue
      const attacker = granted.length ? { ...candidate, grantedKeywords: granted } : candidate
      const { targets, sentinelLocked } = enemyAttackTargets(state, attacker)
      for (const e of targets) {
        moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
      }
      if (!sentinelLocked) moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'base' } })
    }
  }

  moves.push({ type: 'skipTrigger' })
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
