import type { Action, AttackTarget } from './actions'
import type { GameState, PlayerId, UnitState } from './types'
import type { PendingChoice } from './types'
import { opponentOf, updatePlayer, activeChoice, popChoice, findChoice, removeChoice, hasPendingChoices, pushChoice } from './types'
import { addResourceFromHand, payCost, readyAllResources } from './resources'
import { effectiveCost, enemyAttackTargets, supportGrantedKeywords } from './legalMoves'
import { runTrigger, runUnitTrigger, getCardDefinition, actionAbilityKey, type TriggerPoint, type EffectContext } from './abilities'
import { applyUnitDamage, dealDamageToUnit } from './combat'
import { exhaustUnit, findUnit } from './effects'
import { seededShuffle, nextSeed } from './rng'
import { effectivePower, effectiveHp } from './stats'
import { hasKeyword, unitHasKeyword, unitKeywordValue, unitNegatesOverwhelm } from './keywords'
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
        if (played.winner !== null) return played
        // An on-play trigger (Ambush) keeps the turn with the active player to
        // resolve it before passing (#334).
        if (activeChoice(played)) return resetPasses(played)
        return advanceTurn(resetPasses(played))
      })
    case 'playUpgrade':
      return requirePhase(state, 'action', () => {
        const played = playUpgrade(state, action.handIndex, action.targetInstanceId)
        return played.winner !== null ? played : advanceTurn(resetPasses(played))
      })
    case 'deployLeader':
      return requirePhase(state, 'action', () => advanceTurn(resetPasses(deployLeader(state))))
    case 'useAbility':
      return requirePhase(state, 'action', () => useAbility(state, action.instanceId, action.cardId, action.index))
    case 'attack':
      return requirePhase(state, 'action', () => {
        // An attack resolves a pending choice, if one is active (#334/#343). Support
        // lends its keywords to the chosen attacker; Improvised Identity's mayAttack
        // lends the discarded unit's full abilities.
        const choice = activeChoice(state)
        const before = choice?.kind === 'support'
          ? grantSupportKeywords(state, choice.unitId, action.attackerId)
          : choice?.kind === 'mayAttack' && choice.grantCardId
            ? grantAbilityCard(state, action.attackerId, choice.grantCardId)
            : state
        let attacked = attack(before, action.attackerId, action.target)
        // Consume the ambush/support choice this attack resolved. Support-granted
        // keywords are cleared inside completeAttack (after they're used), so they
        // survive a mid-combat On Defense suspension.
        if (choice) attacked = popChoice(attacked)
        // A choice the attack raised (Camtono onAttackEnd, On Defense) keeps the turn.
        return attacked.winner !== null || hasPendingChoices(attacked) ? attacked : advanceTurn(resetPasses(attacked))
      })
    case 'takeInitiative':
      return requirePhase(state, 'action', () => takeInitiative(state))
    case 'pass':
      return requirePhase(state, 'action', () => pass(state))
    case 'skipTrigger':
      return requirePhase(state, 'action', () => resolveSkip(state, action.choiceId))
    case 'acceptChoice':
      return requirePhase(state, 'action', () => resolveAccept(state, action.choiceId, action.targetInstanceId, action.deckIndex))
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

/**
 * Bring a unit `cardId` into play under `owner` (#342). Shared by playing a unit from
 * hand and free-play effects (e.g. Camtono). Handles Shielded/Hidden on entry, opens
 * the Ambush/Support pending choice, and fires "When Played". The caller is
 * responsible for spending cost / removing the card from its source zone, and for the
 * win check afterwards.
 */
function enterUnit(state: GameState, owner: PlayerId, cardId: string): GameState {
  const card = state.cards[cardId]
  // Ambush: the unit may immediately attack an enemy unit, so it enters ready (#334).
  const ambush = hasKeyword(state, cardId, 'Ambush')
  const newUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId,
    arena: card?.arena ?? 'ground',
    damage: 0,
    exhausted: !ambush, // units normally enter exhausted (CR 1.5.4b); Ambush enters ready
    isLeader: false,
    // Shielded: the unit enters play with a shield token (#334).
    upgrades: hasKeyword(state, cardId, 'Shielded') ? [{ cardId: TOKEN_SHIELD, owner }] : [],
    // Hidden: the unit enters play hidden — unattackable until the next phase (#334).
    ...(hasKeyword(state, cardId, 'Hidden') ? { hidden: true } : {}),
  }

  let next = updatePlayer(state, owner, { units: [...state.players[owner].units, newUnit] })
  next = { ...next, instanceCounter: state.instanceCounter + 1 }

  // Ambush: open the pending attack only if there's actually an enemy to hit;
  // otherwise the unit just enters play exhausted, as normal (#334).
  if (ambush) {
    if (enemyAttackTargets(next, newUnit).targets.length > 0) {
      next = pushChoice(next, { kind: 'ambush', id: newUnit.instanceId, controller: owner, unitId: newUnit.instanceId })
    } else {
      next = updatePlayer(next, owner, {
        units: next.players[owner].units.map(u => (u.instanceId === newUnit.instanceId ? { ...u, exhausted: true } : u)),
      })
    }
  } else if (hasKeyword(state, cardId, 'Support')) {
    // Support: open the pending attack if there's another ready unit to attack with.
    const others = next.players[owner].units.filter(u => u.instanceId !== newUnit.instanceId && !u.exhausted)
    if (others.length > 0) {
      next = pushChoice(next, { kind: 'support', id: newUnit.instanceId, controller: owner, unitId: newUnit.instanceId })
    }
  }

  // "When Played" abilities fire after the card enters play (CR 6.2.0f).
  return runTrigger(next, 'whenPlayed', { owner, cardId, sourceInstanceId: newUnit.instanceId })
}

function playCard(state: GameState, handIndex: number): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'unit') {
    throw new Error(`playCard: hand index ${handIndex} is not a playable unit`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  const next = updatePlayer(state, playerId, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
  // whenPlayed effects can defeat a base, so the win check runs afterwards.
  return checkWin(enterUnit(next, playerId, card.id))
}

/** Lend a Support unit's keywords to the chosen attacker for one attack (#334). */
function grantSupportKeywords(state: GameState, supportUnitId: string, attackerId: string): GameState {
  const granted = supportGrantedKeywords(state, supportUnitId)
  if (granted.length === 0) return state
  const playerId = state.activePlayer
  return updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u => (u.instanceId === attackerId ? { ...u, grantedKeywords: granted } : u)),
  })
}

/** Strip transient per-attack grants (Support keywords #334, Improvised Identity
 *  granted abilities #343) from every unit once the attack that used them is done. */
function clearGrantedKeywords(state: GameState): GameState {
  let next = state
  for (const id of ['player', 'opponent'] as PlayerId[]) {
    const units = next.players[id].units
    if (units.some(u => u.grantedKeywords || u.grantedAbilityCardIds)) {
      next = updatePlayer(next, id, {
        units: units.map(u => (u.grantedKeywords || u.grantedAbilityCardIds ? { ...u, grantedKeywords: undefined, grantedAbilityCardIds: undefined } : u)),
      })
    }
  }
  return next
}

/** Grant a unit the full abilities (keywords + triggered) of `cardId` for one attack
 *  (Improvised Identity, #343). Cleared by `clearGrantedKeywords` after the attack. */
function grantAbilityCard(state: GameState, attackerId: string, cardId: string): GameState {
  const playerId = state.activePlayer
  return updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u => (u.instanceId === attackerId ? { ...u, grantedAbilityCardIds: [cardId] } : u)),
  })
}

/**
 * Resume once a choice resolves (#342). While others remain, hand to the right
 * decider — the active player finishes their own simultaneous choices first (they
 * order them), then control passes to the other side. When the queue drains,
 * round-start `whenReadies` choices resume the action phase with the initiative
 * holder; mid-turn choices pass the turn as normal.
 */
function resumeAfterChoice(state: GameState, resolved: PendingChoice): GameState {
  if (hasPendingChoices(state)) {
    const activeHasMore = state.pendingChoices!.some(c => c.controller === state.activePlayer)
    return activeHasMore ? state : { ...state, activePlayer: opponentOf(state.activePlayer) }
  }
  // A combat suspended for an On Defense choice resumes once the queue drains (#342).
  if (state.pendingAttack) return resumePendingAttack(state)
  if (resolved.kind === 'payOrExhaust' && resolved.resumeAtInitiative) {
    return { ...state, activePlayer: state.initiative }
  }
  return advanceTurn(resetPasses(state))
}

/** Finish a combat suspended by an On Defense ability (#342): deal the combat damage
 *  (from the post-choice board) as the original attacker, then pass the turn. */
function resumePendingAttack(state: GameState): GameState {
  const pa = state.pendingAttack!
  let next: GameState = { ...state, pendingAttack: undefined, activePlayer: pa.activePlayer }
  next = completeAttack(next, pa.attackerId, pa.target)
  return next.winner !== null ? next : advanceTurn(resetPasses(next))
}

/** Decline a pending choice (#334/#342). Ambush and pay-or-exhaust leave the unit
 *  exhausted; Support and may-play do nothing. `choiceId` picks one of several. */
function resolveSkip(state: GameState, choiceId?: string): GameState {
  const choice = choiceId ? findChoice(state, choiceId) : activeChoice(state)
  if (!choice) throw new Error('skipTrigger: no pending choice')
  let next = removeChoice(state, choice.id)
  if (choice.kind === 'ambush' || choice.kind === 'payOrExhaust') {
    next = updatePlayer(next, choice.controller, {
      units: next.players[choice.controller].units.map(u => (u.instanceId === choice.unitId ? { ...u, exhausted: true } : u)),
    })
  }
  return resumeAfterChoice(next, choice)
}

/** Accept a pending "may…" choice — pay the cost / play the card / search (#342/#343). */
function resolveAccept(state: GameState, choiceId: string, targetInstanceId?: string, deckIndex?: number): GameState {
  const choice = findChoice(state, choiceId)
  if (!choice) throw new Error(`acceptChoice: no choice ${choiceId}`)
  let next = removeChoice(state, choice.id)
  switch (choice.kind) {
    case 'payOrExhaust':
      // Pay the cost; the unit simply stays ready (no exhaust).
      next = updatePlayer(next, choice.controller, payCost(next.players[choice.controller], choice.cost))
      break
    case 'mayPlayTopFree': {
      next = playTopCardFree(next, choice.controller, choice.cardId, targetInstanceId)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'mayDamageExhaust':
      // DDC Defender: deal 1 to a chosen unit in the arena and exhaust it.
      if (targetInstanceId) {
        next = dealDamageToUnit(next, targetInstanceId, 1)
        next = exhaustUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    case 'search':
      // Improvised Identity: discard the chosen revealed ground unit, then offer the
      // follow-up attack that grants its abilities.
      if (deckIndex !== undefined) {
        const owner = choice.controller
        const discarded = next.players[owner].deck[deckIndex]
        if (discarded !== undefined) {
          next = updatePlayer(next, owner, {
            deck: next.players[owner].deck.filter((_, i) => i !== deckIndex),
            discard: [...next.players[owner].discard, discarded],
          })
          next = pushChoice(next, { kind: 'mayAttack', id: choice.unitId, controller: owner, unitId: choice.unitId, grantCardId: discarded })
        }
      }
      break
    default:
      throw new Error(`acceptChoice: ${choice.kind} is not acceptable`)
  }
  return resumeAfterChoice(next, choice)
}

/**
 * Play the revealed top-of-deck card for free (Camtono, #342). Unit → enters play;
 * upgrade → attaches to `targetInstanceId`; event → a temporary rule discards it with
 * no effect (until events are built). A no-op if the top card moved.
 */
function playTopCardFree(state: GameState, owner: PlayerId, cardId: string, targetInstanceId?: string): GameState {
  if (state.players[owner].deck[0] !== cardId) return state // top card changed; abort safely
  const type = state.cards[cardId]?.type
  let next = updatePlayer(state, owner, { deck: state.players[owner].deck.slice(1) }) // remove from deck

  if (type === 'unit') {
    return enterUnit(next, owner, cardId)
  }
  if (type === 'upgrade' && targetInstanceId) {
    const targetOwner = (['player', 'opponent'] as PlayerId[]).find(id =>
      next.players[id].units.some(u => u.instanceId === targetInstanceId),
    )
    if (!targetOwner) return next // target gone
    next = updatePlayer(next, targetOwner, {
      units: next.players[targetOwner].units.map(u =>
        u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId, owner }] } : u,
      ),
    })
    return runTrigger(next, 'whenPlayed', { owner, cardId, sourceInstanceId: targetInstanceId })
  }
  // Event (or an upgrade with no target): temporary stub — discard with no effect.
  return updatePlayer(next, owner, { discard: [...next.players[owner].discard, cardId] })
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
  const targetUnit = state.players[targetOwner].units.find(u => u.instanceId === targetInstanceId)

  const paid = payCost(p, effectiveCost(state, playerId, card, targetUnit))
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

/**
 * Use a unit's activated "Action:" ability (#343). A once-per-round ability is marked
 * spent before its effect runs (so effects that raise a choice carry the mark), then
 * the turn passes — unless the ability raised a pending choice (e.g. a search), which
 * keeps the turn with the active player to resolve it.
 */
function useAbility(state: GameState, instanceId: string, cardId: string, index: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found) throw new Error(`useAbility: no unit ${instanceId}`)
  const ability = getCardDefinition(cardId)?.actionAbilities?.[index]
  if (!ability) throw new Error(`useAbility: no ability ${cardId}#${index}`)
  const owner = found.owner

  let next = state
  if (ability.oncePerRound) {
    const key = actionAbilityKey(cardId, index)
    next = updatePlayer(next, owner, {
      units: next.players[owner].units.map(u =>
        u.instanceId === instanceId ? { ...u, usedAbilities: [...(u.usedAbilities ?? []), key] } : u,
      ),
    })
  }
  next = ability.effect(next, { owner, cardId, sourceInstanceId: instanceId })
  next = checkWin(next)
  if (next.winner !== null) return next
  return hasPendingChoices(next) ? next : advanceTurn(resetPasses(next))
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

/** Fire "When Attack Ends" abilities on the attacker (card + upgrades), if it
 *  survived the combat (#340). `ctx` carries what the attack did (target, whether
 *  it damaged the base) for abilities like Whistling Birds (#342). */
function fireAttackEnd(state: GameState, owner: PlayerId, attackerId: string, ctx: Partial<EffectContext>): GameState {
  const attacker = state.players[owner].units.find(u => u.instanceId === attackerId)
  return attacker ? runUnitTrigger(state, 'onAttackEnd', attacker, owner, ctx) : state
}

/** Fire a trigger for every unit in play (both sides), re-finding each in case an
 *  earlier ability changed it. Used for board-wide events like regroup start (#340). */
function fireForAllUnits(state: GameState, point: TriggerPoint): GameState {
  let next = state
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    for (const id of next.players[owner].units.map(u => u.instanceId)) {
      const unit = next.players[owner].units.find(u => u.instanceId === id)
      if (unit) next = runUnitTrigger(next, point, unit, owner)
    }
  }
  return next
}

/**
 * Begin an attack (#342): exhaust the attacker and apply Restore, then either finish
 * inline or — if the defender has an "On Defense" ability that raises a choice —
 * suspend the combat before damage and hand control to the defender. Combat damage
 * itself is dealt by `completeAttack` (immediately, or on resume after the choice).
 */
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

  // Restore N: heals the attacking player's base when the unit attacks (CR 7.5).
  const restore = unitKeywordValue(next, attacker, 'Restore')
  if (restore > 0) {
    const own = next.players[playerId]
    next = updatePlayer(next, playerId, {
      base: { ...own.base, damage: Math.max(0, own.base.damage - restore) },
    })
  }

  // A base has no defender and no "On Defense" step.
  if (target.kind === 'base') return completeAttack(next, attackerId, target)

  const defender = next.players[enemyId].units.find(u => u.instanceId === target.instanceId)
  if (!defender) throw new Error(`attack: no enemy unit ${target.instanceId}`)

  // "On Defense" abilities may act before combat damage (#342). If one raises a
  // choice, suspend the attack and hand control to the defender to resolve it.
  const beforeChoices = next.pendingChoices?.length ?? 0
  next = runUnitTrigger(next, 'onDefense', defender, enemyId)
  if ((next.pendingChoices?.length ?? 0) > beforeChoices) {
    return { ...next, pendingAttack: { attackerId, target, activePlayer: playerId }, activePlayer: enemyId }
  }
  return completeAttack(next, attackerId, target)
}

/**
 * Deal the combat damage (#342) — calculated from the *current* (post-"On Defense")
 * state, per CR 6.3.4. The attacker or defender may have been defeated by an On
 * Defense ability, in which case the attack fizzles. Clears any transient
 * Support-granted keywords once the calculation that used them is done.
 */
function completeAttack(state: GameState, attackerId: string, target: AttackTarget): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  // The attacker may have been defeated before damage (e.g. an On Defense ping).
  if (!attacker) return clearGrantedKeywords(checkWin(state))

  const attackerPower = effectivePower(state, attacker, { attacking: true, attackingBase: target.kind === 'base' })

  if (target.kind === 'base') {
    const enemy = state.players[enemyId]
    let next = updatePlayer(state, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + attackerPower } })
    next = consumeAdvantage(next, playerId, attackerId) // the attack completed
    next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, dealtDamageToBase: attackerPower > 0 })
    return clearGrantedKeywords(checkWin(next))
  }

  const defender = state.players[enemyId].units.find(u => u.instanceId === target.instanceId)
  // The defender may have been defeated before damage → the attack fizzles.
  if (!defender) {
    let next = consumeAdvantage(state, playerId, attackerId)
    next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, dealtDamageToBase: false })
    return clearGrantedKeywords(checkWin(next))
  }

  const counterPower = effectivePower(state, defender)

  // Overwhelm: excess combat damage beyond the defender's remaining HP hits the
  // defending player's base (CR 1.9.11). A shielded defender takes no damage, so
  // there is no excess to trample (#308).
  const remainingHp = effectiveHp(state, defender) - defender.damage
  const overwhelmExcess = unitHasKeyword(state, attacker, 'Overwhelm')
    && !hasToken(defender.upgrades, TOKEN_SHIELD)
    && !unitNegatesOverwhelm(state, defender)
    ? Math.max(0, attackerPower - remainingHp)
    : 0

  // Simultaneous combat damage (CR 1.9.10).
  let next = applyUnitDamage(state, enemyId, new Map([[defender.instanceId, attackerPower]]))
  next = applyUnitDamage(next, playerId, new Map([[attacker.instanceId, counterPower]]))

  if (overwhelmExcess > 0) {
    const enemy = next.players[enemyId]
    next = updatePlayer(next, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + overwhelmExcess } })
  }

  // Both units completed a combat — spend any Advantage on the survivors (#308).
  next = consumeAdvantage(next, playerId, attackerId)
  next = consumeAdvantage(next, enemyId, defender.instanceId)
  next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, dealtDamageToBase: overwhelmExcess > 0 })
  return clearGrantedKeywords(checkWin(next))
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

/** Clear every unit's Hidden state — it lasts only until the next phase (#334). */
function clearHidden(state: GameState): GameState {
  let next = state
  for (const id of ['player', 'opponent'] as PlayerId[]) {
    const units = next.players[id].units
    if (units.some(u => u.hidden)) {
      next = updatePlayer(next, id, { units: units.map(u => (u.hidden ? { ...u, hidden: false } : u)) })
    }
  }
  return next
}

function enterRegroup(state: GameState): GameState {
  let next: GameState = clearHidden({ ...state, phase: 'regroup', consecutivePasses: 0 })
  next = drawForRegroup(next, 'player')
  next = drawForRegroup(next, 'opponent')
  next = checkWin(next)
  if (next.winner !== null) return next
  // "When the regroup phase starts" abilities (e.g. Heightened Awareness) (#340).
  next = checkWin(fireForAllUnits(next, 'whenRegroupStarts'))
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
  const justReadied = p.units.filter(u => u.exhausted).map(u => u.instanceId)
  let next = updatePlayer(state, id, {
    resources: readied.resources,
    // Ready units and clear their once-per-round action-ability usage (#343).
    units: p.units.map(u => (u.exhausted || u.usedAbilities ? { ...u, exhausted: false, usedAbilities: undefined } : u)),
    leader: p.leader.exhausted ? { ...p.leader, exhausted: false } : p.leader,
  })
  // "When this unit readies" abilities fire for each unit that just readied (#342).
  for (const instanceId of justReadied) {
    const unit = next.players[id].units.find(u => u.instanceId === instanceId)
    if (unit) next = runUnitTrigger(next, 'whenReadies', unit, id)
  }
  return next
}

/** Whoever decides the first pending choice — the initiative holder if they have one
 *  (they resolve first), else the other player; the initiative holder otherwise. */
function firstDecider(state: GameState, initiative: PlayerId): PlayerId {
  const choices = state.pendingChoices ?? []
  if (choices.length === 0) return initiative
  return choices.some(c => c.controller === initiative) ? initiative : opponentOf(initiative)
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
    // A whenReadies choice (e.g. The Conflict Within) is resolved before play begins.
    activePlayer: firstDecider(next, next.initiative),
  }
  return next
}
