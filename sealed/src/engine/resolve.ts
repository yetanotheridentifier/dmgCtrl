import type { Action, AttackTarget } from './actions'
import type { GameState, PlayerId, PlayerState, UnitState } from './types'
import { opponentOf } from './types'
import { addResourceFromHand, payCost, readyAllResources } from './resources'
import { effectiveCost } from './legalMoves'

/**
 * Action resolver (T2.5) — pure `(state, action) => state`.
 *
 * Legality lives in the legal-move generator; the resolver applies actions and
 * throws on engine-invariant violations (wrong phase, unknown ids, game over)
 * rather than re-validating game rules.
 */
export function resolve(state: GameState, action: Action): GameState {
  if (state.winner !== null) {
    throw new Error('Cannot resolve actions: the game is over')
  }

  switch (action.type) {
    case 'playCard':
      return requirePhase(state, 'action', () => advanceTurn(resetPasses(playCard(state, action.handIndex))))
    case 'deployLeader':
      return requirePhase(state, 'action', () => advanceTurn(resetPasses(deployLeader(state))))
    case 'attack':
      return requirePhase(state, 'action', () => {
        const attacked = attack(state, action.attackerId, action.target)
        return attacked.winner !== null ? attacked : advanceTurn(resetPasses(attacked))
      })
    case 'takeInitiative':
      return requirePhase(state, 'action', () => takeInitiative(state))
    case 'pass':
      return requirePhase(state, 'action', () => pass(state))
    case 'resourceCard':
      return requirePhase(state, 'regroup', () => regroupChoice(state, action.handIndex))
    case 'skipResource':
      return requirePhase(state, 'regroup', () => regroupChoice(state, null))
  }
}

function requirePhase(state: GameState, phase: GameState['phase'], fn: () => GameState): GameState {
  if (state.phase !== phase) {
    throw new Error(`Action requires the ${phase} phase (current: ${state.phase})`)
  }
  return fn()
}

// ---------------------------------------------------------------------------
// Shared state helpers
// ---------------------------------------------------------------------------

function updatePlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: { ...state.players, [id]: { ...state.players[id], ...patch } },
  }
}

function resetPasses(state: GameState): GameState {
  return state.consecutivePasses === 0 ? state : { ...state, consecutivePasses: 0 }
}

/**
 * Hand the turn to the other player. If they hard-passed by taking the
 * initiative, their turn resolves as an automatic pass (CR 1.15.5b) and the
 * turn bounces back — possibly ending the phase when it completes the
 * consecutive-pass pair.
 */
function advanceTurn(state: GameState): GameState {
  const next = opponentOf(state.activePlayer)
  if (state.initiativeTakenBy === next) {
    const passes = state.consecutivePasses + 1
    if (passes >= 2) return enterRegroup(state)
    return { ...state, consecutivePasses: passes } // active player unchanged
  }
  return { ...state, activePlayer: next }
}

// ---------------------------------------------------------------------------
// Action phase
// ---------------------------------------------------------------------------

function playCard(state: GameState, handIndex: number): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'unit') {
    throw new Error(`playCard: hand index ${handIndex} is not a playable unit`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  const newUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId: card.id,
    arena: card.arena ?? 'ground',
    damage: 0,
    exhausted: true, // units enter play exhausted (CR 1.5.4b)
    isLeader: false,
    upgrades: [],
  }

  const next = updatePlayer(state, playerId, {
    ...paid,
    hand: paid.hand.filter((_, i) => i !== handIndex),
    units: [...paid.units, newUnit],
  })
  return { ...next, instanceCounter: state.instanceCounter + 1 }
}

function deployLeader(state: GameState): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  if (p.leader.deployed || p.leader.epicActionUsed) {
    throw new Error('deployLeader: leader cannot deploy')
  }

  // Deploying is an epic action: no resources are spent (CR 2.6.1); the leader
  // arrives in the ground arena, ready (CR 3.4.4).
  const leaderUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId: p.leader.cardId,
    arena: 'ground',
    damage: 0,
    exhausted: false,
    isLeader: true,
    upgrades: [],
  }

  const next = updatePlayer(state, playerId, {
    leader: { ...p.leader, deployed: true, epicActionUsed: true },
    units: [...p.units, leaderUnit],
  })
  return { ...next, instanceCounter: state.instanceCounter + 1 }
}

function takeInitiative(state: GameState): GameState {
  const playerId = state.activePlayer
  const taken: GameState = {
    ...state,
    initiative: playerId,
    initiativeTakenBy: playerId,
  }
  // Taking the initiative immediately after an opponent's pass ends the
  // action phase (CR 1.15.5c).
  if (state.consecutivePasses >= 1) return enterRegroup(taken)
  return { ...taken, activePlayer: opponentOf(playerId) }
}

function pass(state: GameState): GameState {
  const passes = state.consecutivePasses + 1
  if (passes >= 2) return enterRegroup(state)
  return advanceTurn({ ...state, consecutivePasses: passes })
}

// ---------------------------------------------------------------------------
// Combat (basic resolution — T2.5/T3.2/T3.3)
// ---------------------------------------------------------------------------

function unitPower(state: GameState, u: UnitState): number {
  return state.cards[u.cardId]?.power ?? 0
}

function unitHp(state: GameState, u: UnitState): number {
  return state.cards[u.cardId]?.hp ?? 0
}

/** Apply damage to a player's units, defeating any with damage ≥ HP (CR 1.9.6). */
function applyUnitDamage(state: GameState, owner: PlayerId, damaged: Map<string, number>): GameState {
  const p = state.players[owner]
  const survivors: UnitState[] = []
  const defeated: UnitState[] = []

  for (const u of p.units) {
    const extra = damaged.get(u.instanceId) ?? 0
    const total = u.damage + extra
    const next = extra > 0 ? { ...u, damage: total } : u
    if (total >= unitHp(state, next)) {
      defeated.push(next)
    } else {
      survivors.push(next)
    }
  }

  let result = updatePlayer(state, owner, {
    units: survivors,
    // Non-leader defeated units go to their owner's discard pile (CR 1.5.5c).
    discard: [...p.discard, ...defeated.filter(u => !u.isLeader).map(u => u.cardId)],
  })

  // A defeated Leader Unit returns to the base zone, exhausted, undeployed;
  // its epic action stays used so it cannot redeploy (CR 3.4.5).
  if (defeated.some(u => u.isLeader)) {
    const owner2 = result.players[owner]
    result = updatePlayer(result, owner, {
      leader: { ...owner2.leader, deployed: false, exhausted: true },
    })
  }

  return result
}

function attack(state: GameState, attackerId: string, target: AttackTarget): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  if (!attacker) throw new Error(`attack: no friendly unit ${attackerId}`)
  if (attacker.exhausted) throw new Error(`attack: unit ${attackerId} is exhausted`)

  // Attacking exhausts the attacker (CR 1.5.4d).
  let next = updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u =>
      u.instanceId === attackerId ? { ...u, exhausted: true } : u,
    ),
  })

  if (target.kind === 'base') {
    const enemy = next.players[enemyId]
    const damage = enemy.base.damage + unitPower(next, attacker)
    next = updatePlayer(next, enemyId, { base: { ...enemy.base, damage } })
    return checkWin(next)
  }

  const defender = next.players[enemyId].units.find(u => u.instanceId === target.instanceId)
  if (!defender) throw new Error(`attack: no enemy unit ${target.instanceId}`)

  // Combat damage is simultaneous (CR 1.9.10): attacker's power to defender,
  // defender's power back to attacker.
  next = applyUnitDamage(next, enemyId, new Map([[defender.instanceId, unitPower(next, attacker)]]))
  next = applyUnitDamage(next, playerId, new Map([[attacker.instanceId, unitPower(next, defender)]]))
  return next
}

/** Base with damage ≥ HP defeats its owner (CR 1.9.7, 3.2.5). */
function checkWin(state: GameState): GameState {
  for (const id of ['player', 'opponent'] as const) {
    const base = state.players[id].base
    const hp = state.cards[base.cardId]?.hp ?? 0
    if (base.damage >= hp) {
      return { ...state, winner: opponentOf(id) }
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Regroup phase (CR 5.5): draw 2 → each player may resource 1 → ready all
// ---------------------------------------------------------------------------

const REGROUP_DRAW = 2
/**
 * Drawing from an empty deck deals 3 damage to the drawing player's base per
 * missed card. (CR 8.6 Empty Deck — section absent from the docs PDF; this is
 * the standard rule. Flagged for verification against the full CR.)
 */
const EMPTY_DECK_DAMAGE = 3

function drawForRegroup(state: GameState, id: PlayerId): GameState {
  const p = state.players[id]
  const drawn = p.deck.slice(0, REGROUP_DRAW)
  const missed = REGROUP_DRAW - drawn.length
  return updatePlayer(state, id, {
    hand: [...p.hand, ...drawn],
    deck: p.deck.slice(REGROUP_DRAW),
    base: missed > 0 ? { ...p.base, damage: p.base.damage + missed * EMPTY_DECK_DAMAGE } : p.base,
  })
}

function enterRegroup(state: GameState): GameState {
  let next: GameState = { ...state, phase: 'regroup', consecutivePasses: 0 }
  next = drawForRegroup(next, 'player')
  next = drawForRegroup(next, 'opponent')
  next = checkWin(next)
  if (next.winner !== null) return next
  return {
    ...next,
    activePlayer: next.initiative,
    regroupResourced: { player: false, opponent: false },
  }
}

function regroupChoice(state: GameState, handIndex: number | null): GameState {
  const playerId = state.activePlayer
  if (state.regroupResourced[playerId]) {
    throw new Error(`regroup: ${playerId} has already chosen`)
  }

  let next = state
  if (handIndex !== null) {
    next = updatePlayer(state, playerId, addResourceFromHand(state.players[playerId], handIndex))
  }
  next = { ...next, regroupResourced: { ...next.regroupResourced, [playerId]: true } }

  const other = opponentOf(playerId)
  if (!next.regroupResourced[other]) {
    return { ...next, activePlayer: other }
  }
  return startNextRound(next)
}

function readyEverything(state: GameState, id: PlayerId): GameState {
  const p = state.players[id]
  const readied = readyAllResources(p)
  return updatePlayer(state, id, {
    resources: readied.resources,
    units: p.units.map(u => (u.exhausted ? { ...u, exhausted: false } : u)),
    leader: p.leader.exhausted ? { ...p.leader, exhausted: false } : p.leader,
  })
}

function startNextRound(state: GameState): GameState {
  let next = readyEverything(readyEverything(state, 'player'), 'opponent')
  next = {
    ...next,
    phase: 'action',
    round: state.round + 1,
    consecutivePasses: 0,
    initiativeTakenBy: null, // counter flips back to available (CR 1.12.2b)
    regroupResourced: { player: false, opponent: false },
    activePlayer: next.initiative,
  }
  return next
}
