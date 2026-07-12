import type { Action, AttackTarget } from './actions'
import type { GameState, PlayerId, PlayerState, UnitState } from './types'
import { opponentOf } from './types'
import { addResourceFromHand, payCost, readyAllResources } from './resources'
import { effectiveCost } from './legalMoves'
import { runTrigger } from './abilities'
import { seededShuffle, nextSeed } from './rng'
import { effectivePower, effectiveHp } from './stats'
import { unitHasKeyword, unitKeywordValue } from './keywords'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, removeFirst, hasToken } from './tokenUpgrades'

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
      return requirePhase(state, 'action', () => {
        const played = playCard(state, action.handIndex)
        return played.winner !== null ? played : advanceTurn(resetPasses(played))
      })
    case 'playUpgrade':
      return requirePhase(state, 'action', () => {
        const played = playUpgrade(state, action.handIndex, action.targetInstanceId)
        return played.winner !== null ? played : advanceTurn(resetPasses(played))
      })
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
    case 'mulligan':
      return requirePhase(state, 'setup', () => setupDecision(state, true))
    case 'keepHand':
      return requirePhase(state, 'setup', () => setupDecision(state, false))
    case 'setupResource':
      return requirePhase(state, 'setup', () => setupResourceChoice(state, action.handIndex))
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
// Setup phase (CR 5.2.1e–f): mulligan decisions, initiative holder first,
// then both players take 2 starting resources and round 1 begins.
// ---------------------------------------------------------------------------


function setupDecision(state: GameState, takeMulligan: boolean): GameState {
  if (state.setupStage !== 'mulligan') {
    throw new Error('Mulligan decisions are only legal in the mulligan stage of setup')
  }
  const playerId = state.activePlayer
  let next = state

  if (takeMulligan) {
    // Shuffle the entire hand back into the deck and draw a new 6 (CR 5.2.1e).
    const p = state.players[playerId]
    const reshuffled = seededShuffle([...p.hand, ...p.deck], state.rngSeed)
    next = updatePlayer(state, playerId, {
      hand: reshuffled.slice(0, p.hand.length),
      deck: reshuffled.slice(p.hand.length),
    })
    next = { ...next, rngSeed: nextSeed(state.rngSeed) }
  }

  // Initiative holder decides first; after the other player's decision the
  // resource stage begins, back with the initiative holder (CR 5.2.1f).
  if (playerId === next.initiative) {
    return { ...next, activePlayer: opponentOf(playerId) }
  }
  return { ...next, setupStage: 'resource', activePlayer: next.initiative }
}

const SETUP_RESOURCES = 2

/**
 * Resource one chosen hand card, facedown and ready (CR 5.2.1f). Each player
 * picks one card at a time until they hold two starting resources; once both
 * players are done, round 1's action phase begins with the initiative holder.
 */
function setupResourceChoice(state: GameState, handIndex: number): GameState {
  if (state.setupStage !== 'resource') {
    throw new Error('setupResource is only legal in the resource stage of setup')
  }
  const playerId = state.activePlayer
  const p = state.players[playerId]
  if (handIndex < 0 || handIndex >= p.hand.length) {
    throw new Error(`setupResource: invalid hand index ${handIndex}`)
  }

  const next = updatePlayer(state, playerId, {
    hand: p.hand.filter((_, i) => i !== handIndex),
    resources: [...p.resources, { cardId: p.hand[handIndex], exhausted: false }],
  })

  const mine = next.players[playerId].resources.length
  if (mine < SETUP_RESOURCES) {
    return next // same player picks again
  }
  if (playerId === next.initiative) {
    return { ...next, activePlayer: opponentOf(playerId) }
  }
  return { ...next, phase: 'action', activePlayer: next.initiative }
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

  let next = updatePlayer(state, playerId, {
    ...paid,
    hand: paid.hand.filter((_, i) => i !== handIndex),
    units: [...paid.units, newUnit],
  })
  next = { ...next, instanceCounter: state.instanceCounter + 1 }

  // "When Played" abilities fire after the card enters play (CR 6.2.0f);
  // their effects can defeat a base, so the win check runs afterwards.
  next = runTrigger(next, 'whenPlayed', {
    owner: playerId,
    cardId: card.id,
    sourceInstanceId: newUnit.instanceId,
  })
  return checkWin(next)
}

/**
 * Play an upgrade from hand and attach it to a unit (#308). Any unit in play is a
 * valid target by default; per-card restrictions are #337. Cost + aspect penalty
 * apply as for units; the upgrade's power/HP and keywords then modify the unit
 * (via the stats/keyword helpers).
 */
function playUpgrade(state: GameState, handIndex: number, targetInstanceId: string): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'upgrade') {
    throw new Error(`playUpgrade: hand index ${handIndex} is not a playable upgrade`)
  }

  const targetOwner = (['player', 'opponent'] as PlayerId[]).find(id =>
    state.players[id].units.some(u => u.instanceId === targetInstanceId),
  )
  if (!targetOwner) {
    throw new Error(`playUpgrade: no unit ${targetInstanceId} to attach to`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  let next = updatePlayer(state, playerId, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
  next = updatePlayer(next, targetOwner, {
    units: next.players[targetOwner].units.map(u =>
      u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId: card.id, owner: playerId }] } : u,
    ),
  })

  // "When Played" abilities fire after the upgrade attaches (CR 6.2.0f).
  next = runTrigger(next, 'whenPlayed', {
    owner: playerId,
    cardId: card.id,
    sourceInstanceId: targetInstanceId,
  })
  return checkWin(next)
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

/** Apply damage to a player's units, defeating any with damage ≥ HP (CR 1.9.6). */
function applyUnitDamage(state: GameState, owner: PlayerId, damaged: Map<string, number>): GameState {
  const p = state.players[owner]
  const survivors: UnitState[] = []
  const defeated: UnitState[] = []

  for (const u of p.units) {
    let extra = damaged.get(u.instanceId) ?? 0
    let upgrades = u.upgrades
    // A shield token prevents one instance of incoming damage, then is removed (#308).
    if (extra > 0 && hasToken(upgrades, TOKEN_SHIELD)) {
      upgrades = removeFirst(upgrades, a => a.cardId === TOKEN_SHIELD)
      extra = 0
    }
    const total = u.damage + extra
    const next = extra > 0 || upgrades !== u.upgrades ? { ...u, damage: total, upgrades } : u
    if (total >= effectiveHp(state, next)) {
      defeated.push(next)
    } else {
      survivors.push(next)
    }
  }

  // Defeated card-upgrades return to their OWNER's discard, which may differ from
  // the unit's controller when an upgrade was attached to an enemy unit (#308).
  // Token upgrades (type `token`) simply cease to exist. Collect per owner.
  const defeatedUpgrades = defeated
    .flatMap(u => u.upgrades)
    .filter(a => state.cards[a.cardId]?.type !== 'token')

  // Non-leader defeated units go to their owner's discard pile (CR 1.5.5c).
  let result = updatePlayer(state, owner, {
    units: survivors,
    discard: [
      ...p.discard,
      ...defeated.filter(u => !u.isLeader).map(u => u.cardId),
      ...defeatedUpgrades.filter(a => a.owner === owner).map(a => a.cardId),
    ],
  })

  const other = opponentOf(owner)
  const othersUpgrades = defeatedUpgrades.filter(a => a.owner === other).map(a => a.cardId)
  if (othersUpgrades.length > 0) {
    result = updatePlayer(result, other, { discard: [...result.players[other].discard, ...othersUpgrades] })
  }

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

/**
 * Advantage gives +1/0 until the unit next completes an attack or defence, then
 * the token is removed (#308/#334). Called for the attacker and defender after
 * combat; a no-op if the unit has no Advantage token (or was defeated).
 */
function consumeAdvantage(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const p = state.players[owner]
  const unit = p.units.find(u => u.instanceId === instanceId)
  if (!unit || !hasToken(unit.upgrades, TOKEN_ADVANTAGE)) return state
  return updatePlayer(state, owner, {
    units: p.units.map(u =>
      u.instanceId === instanceId ? { ...u, upgrades: removeFirst(u.upgrades, a => a.cardId === TOKEN_ADVANTAGE) } : u,
    ),
  })
}

function attack(state: GameState, attackerId: string, target: AttackTarget): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  if (!attacker) throw new Error(`attack: no friendly unit ${attackerId}`)
  if (attacker.exhausted) throw new Error(`attack: unit ${attackerId} is exhausted`)

  // Combat damage is CALCULATED before it is dealt (CR 6.3.4): both amounts
  // come from the pre-damage state, so e.g. a Grit defender's counter uses its
  // pre-attack damage.
  const attackerPower = effectivePower(state, attacker, { attacking: true })

  // Attacking exhausts the attacker (CR 1.5.4d).
  let next = updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u =>
      u.instanceId === attackerId ? { ...u, exhausted: true } : u,
    ),
  })

  // Restore N: heals the attacking player's base when the unit attacks (CR 7.5).
  const restore = unitKeywordValue(next, attacker, 'Restore')
  if (restore > 0) {
    const own = next.players[playerId]
    next = updatePlayer(next, playerId, {
      base: { ...own.base, damage: Math.max(0, own.base.damage - restore) },
    })
  }

  if (target.kind === 'base') {
    const enemy = next.players[enemyId]
    next = updatePlayer(next, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + attackerPower } })
    next = consumeAdvantage(next, playerId, attackerId) // the attack completed
    return checkWin(next)
  }

  const defender = next.players[enemyId].units.find(u => u.instanceId === target.instanceId)
  if (!defender) throw new Error(`attack: no enemy unit ${target.instanceId}`)

  const counterPower = effectivePower(next, defender)

  // Overwhelm: excess combat damage beyond the defender's remaining HP hits the
  // defending player's base (CR 1.9.11). A shielded defender takes no damage, so
  // there is no excess to trample (#308).
  const remainingHp = effectiveHp(next, defender) - defender.damage
  const overwhelmExcess = unitHasKeyword(next, attacker, 'Overwhelm') && !hasToken(defender.upgrades, TOKEN_SHIELD)
    ? Math.max(0, attackerPower - remainingHp)
    : 0

  // Simultaneous combat damage (CR 1.9.10).
  next = applyUnitDamage(next, enemyId, new Map([[defender.instanceId, attackerPower]]))
  next = applyUnitDamage(next, playerId, new Map([[attacker.instanceId, counterPower]]))

  if (overwhelmExcess > 0) {
    const enemy = next.players[enemyId]
    next = updatePlayer(next, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + overwhelmExcess } })
  }

  // Both units completed a combat — spend any Advantage on the survivors (#308).
  next = consumeAdvantage(next, playerId, attackerId)
  next = consumeAdvantage(next, enemyId, defender.instanceId)
  return checkWin(next)
}

/**
 * A base with damage ≥ HP defeats its owner (CR 1.9.7, 3.2.5). Both bases are
 * evaluated so that if a single action defeats both at once the game is a draw
 * rather than awarding the win to whichever was checked first (#323).
 */
function checkWin(state: GameState): GameState {
  const defeated = (id: PlayerId): boolean => {
    const base = state.players[id].base
    return base.damage >= (state.cards[base.cardId]?.hp ?? 0)
  }
  const playerLost = defeated('player')
  const opponentLost = defeated('opponent')
  if (playerLost && opponentLost) return { ...state, winner: 'draw' }
  if (playerLost) return { ...state, winner: 'opponent' }
  if (opponentLost) return { ...state, winner: 'player' }
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
